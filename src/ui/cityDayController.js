// PR G — City-day experience controller.
//
// Wires the presentation overlay to the authoritative server read/ack/card
// endpoints. The controller never invents gameplay: it submits card selections
// and placements through the existing API and projects light from the
// server-derived phase. After a reload it restores from the city-day read model,
// so an acknowledged report is never replayed and a second card is never
// offered for the same turn.
//
// Path convention: every path is relative to `api.baseUrl` (e.g. `/api/v1`).
// `api.token` may be a string or a function returning the current token.

import { phaseLightTarget } from "./cityDayExperience.js";

export function createCityDayController({ experience, api, setLight, placementLayer = null, onPlayerTurnComplete = () => {} }) {
  let syncing = false;
  let cardCatalog = null;
  let activeOffer = null;
  let placement = null;

  function pathFor(relative) {
    const base = String(api.baseUrl ?? "").replace(/\/+$/, "");
    return `${base}${relative.startsWith("/") ? relative : `/${relative}`}`;
  }

  async function fetchJson(relative, init = {}) {
    const headers = new Headers(init.headers ?? {});
    const token = typeof api.token === "function" ? api.token() : api.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // A JSON request body must be declared; without Content-Type a real
    // Fastify route rejects the payload. Never overwrite an explicitly
    // supplied caller content type.
    if (init.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(pathFor(relative), { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message ?? `${payload.code ?? response.status}`);
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function createIdempotencyKey() {
    return crypto.randomUUID();
  }

  // Submits a mutating command to a server command endpoint. The command
  // contract (POST /cards/select, POST /cards/place) requires an
  // Idempotency-Key so a retried submission of the same logical command can be
  // replayed instead of double-applied. The key is generated once per logical
  // command and is reused if that command retries — pass the same key on the
  // retry. New user actions get a fresh key. Pure query/search POSTs that the
  // server does not require a key for must NOT go through this helper.
  async function postCommand(relative, body, { idempotencyKey = createIdempotencyKey() } = {}) {
    return fetchJson(relative, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body)
    });
  }

  async function ensureCardCatalog() {
    if (cardCatalog) return cardCatalog;
    const payload = await fetchJson("/cards");
    cardCatalog = Object.fromEntries((payload.data ?? []).map((card) => [card.card_id, card]));
    return cardCatalog;
  }

  function cardForId(cardId) {
    return cardCatalog?.[cardId] ?? null;
  }

  // Reads the authoritative presentation and drives the overlay.
  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const day = await fetchJson(`/cities/${api.cityId}/city-day`);
      experience.applyPresentation(day);
      setLight(day.phase);

      if (day.report.ready && !day.report.dismissed) {
        if (!experience.state.reportOpen) await openReport(day);
        return;
      }

      if (day.card.choicePending) {
        await openCards();
        return;
      }

      if (day.card.playerPlacementPending) {
        await openPendingPlacement();
        return;
      }

      closeChoiceLayers();
      if (day.phase === "morning") {
        experience.showIdleNote("今日决定已完成，城市正等待市政 Agent 开始工作。");
      } else if (day.phase === "day") {
        experience.showIdleNote("市政 Agent 正在建设城市。");
      } else if (day.phase === "night") {
        experience.showIdleNote("城市进入夜间，Arcane Officer 正在处理事件。");
      } else {
        experience.showIdleNote("");
      }
    } finally {
      syncing = false;
    }
  }

  async function openReport(day) {
    let report = null;
    if (day.report.report_id) {
      try {
        const payload = await fetchJson(`/cities/${api.cityId}/reports/${day.report.report_id}`);
        report = payload.report ?? null;
      } catch {
        report = null;
      }
    }
    experience.presentReport(report, day.report);
  }

  async function openCards() {
    // /cards/current returns { city_version, turn, turn_status, offer, choice }.
    // The authoritative city_version is top-level, not inside offer. Preserve it
    // alongside the offer so every selection submits the correct concurrency
    // guard instead of undefined.
    const payload = await fetchJson(`/cities/${api.cityId}/cards/current`);
    activeOffer = {
      ...payload.offer,
      city_version: payload.city_version,
      turn: payload.turn
    };
    await ensureCardCatalog();
    experience.presentCards(activeOffer, onCardPick);
  }

  async function onCardPick(card, offer) {
    if (card.type === "special_structure") {
      experience.presentPlacementChoice(card, (mode) => submitCardSelection(card, offer, mode));
      return;
    }
    await submitCardSelection(card, offer, "immediate");
  }

  async function submitCardSelection(card, offer, decisionMode) {
    const expectedCityVersion = offer?.city_version ?? offer?.expectedCityVersion;
    // One key per logical selection command; a network retry of this same
    // submission must reuse it so the server can replay instead of double-apply.
    const idempotencyKey = createIdempotencyKey();
    try {
      const payload = await postCommand(`/cities/${api.cityId}/cards/select`, {
        expected_city_version: expectedCityVersion,
        offer_id: offer.offer_id,
        selected_card_id: card.card_id,
        decision_mode: decisionMode
      }, { idempotencyKey });
      if (payload.status !== "selected") throw new Error(payload.message ?? "卡牌选择被拒绝");
      if (decisionMode === "player_place") {
        await openPendingPlacement();
      } else {
        closeChoiceLayers();
        onPlayerTurnComplete();
        await sync();
      }
    } catch (error) {
      experience.showIdleNote(error.message);
      // A version conflict / stale offer: refresh authoritative state.
      activeOffer = null;
      await sync();
    }
  }

  // ---- Placement mode -------------------------------------------------------

  async function openPendingPlacement() {
    const day = await fetchJson(`/cities/${api.cityId}/city-day`);
    const choice = day.card;
    const cardsCurrent = await fetchJson(`/cities/${api.cityId}/cards/current`);
    const placementId = cardsCurrent.choice?.card_effects?.placement?.placement_id ?? null;
    await ensureCardCatalog();
    const card = cardForId(choice.selectedCardId);
    const footprint = card?.structure?.footprint ?? "1x1";
    let candidates = [];
    let cityVersion = cardsCurrent.city_version;
    try {
      const payload = await fetchJson(`/cities/${api.cityId}/site-searches`, {
        method: "POST",
        body: JSON.stringify({ footprint, limit: 40 })
      });
      candidates = payload.data ?? [];
      cityVersion = payload.city_version ?? cityVersion;
    } catch {
      candidates = [];
    }
    placement = { card: card ?? { title: "特殊建筑", card_id: choice.selectedCardId }, cardId: choice.selectedCardId, placementId, cityVersion, footprint };
    if (placementLayer) {
      placementLayer.setCandidates(candidates, {
        radius: placementLayer.radius ?? undefined,
        cellWorldSize: placementLayer.cellWorldSize ?? undefined
      });
    }
    experience.presentPlacementMode({
      card: placement.card,
      candidates,
      onPlace: (candidate) => placeCard(placement, candidate),
      onPickCandidate: (candidate) => placementLayer?.select(candidate),
      onCancel: () => closePlacement()
    });
  }

  async function placeCard(activePlacement, candidate) {
    // One key per logical placement command; a network retry of this same
    // submission must reuse it so the server can replay instead of double-apply.
    const idempotencyKey = createIdempotencyKey();
    try {
      const payload = await postCommand(`/cities/${api.cityId}/cards/place`, {
        expected_city_version: activePlacement.cityVersion,
        card_id: activePlacement.cardId,
        placement_id: activePlacement.placementId,
        lot_id: candidate.lotId,
        footprint: activePlacement.footprint,
        entrance: candidate.entranceDirections?.[0] ?? "south"
      }, { idempotencyKey });
      if (payload.status !== "placed") throw new Error(payload.message ?? "放置被拒绝");
      experience.closePlacement();
      placementLayer?.clear();
      closeChoiceLayers();
      onPlayerTurnComplete();
      await sync();
    } catch (error) {
      experience.showIdleNote(error.message);
      await sync();
    }
  }

  function closePlacement() {
    placement = null;
    placementLayer?.clear();
    experience.closePlacement();
  }

  async function dismissReport() {
    const day = experience.state.presentation;
    const reportTurn = day?.report?.turn;
    if (reportTurn != null) {
      try {
        await fetchJson(`/cities/${api.cityId}/city-day/report-dismissed`, {
          method: "POST",
          body: JSON.stringify({ report_turn: reportTurn })
        });
      } catch {
        // Acknowledgement failures are non-fatal; the overlay still closes.
      }
    }
    await sync();
  }

  function closeChoiceLayers() {
    closePlacement();
    experience.closeCards?.();
  }

  return { sync, dismissReport, closeChoiceLayers, closePlacement, postCommand, phaseLightTarget };
}
