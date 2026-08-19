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
import {
  createPlacementCandidateIndex,
  resolvePlacementTarget
} from "./placementTargetResolver.js";
import { resolveSpecialStructurePreview } from "./specialStructurePreview.js";

export function createCityDayController({ experience, api, setLight, placementLayer = null, onPlayerTurnComplete = () => {} }) {
  let syncing = false;
  let cardCatalog = null;
  let activeOffer = null;
  let placement = null;
  // Client-only set of placement ids the player has explicitly cancelled this
  // page session. Cancel is a local exit from the placement session; the
  // server's pending placement is untouched (no invented mutation), so a page
  // reload restores the pending placement. While an id stays in this set the
  // periodic city-day sync must not automatically reopen its placement HUD.
  const dismissedPlacementIds = new Set();

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
    // crypto.randomUUID is only exposed in secure contexts (HTTPS or
    // localhost). The live site is served over plain http://, where it is
    // undefined — fall back to a UUID v4 built from crypto.getRandomValues,
    // which is available in insecure contexts too.
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    // Last-resort fallback; crypto.getRandomValues is universally available.
    return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
    try {
      // One key per logical selection command; a network retry of this same
      // submission must reuse it so the server can replay instead of double-apply.
      const idempotencyKey = createIdempotencyKey();
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
  //
  // PR #52: special-structure placement is an in-world, FOV-center driven
  // placement session. The authoritative candidate set is fetched once on entry
  // and kept in a local lookup; every camera-driven re-evaluation is local, so
  // `/site-searches` is never requested per frame or per drag. Rotation is a
  // local state variable independent of camera rotation. `/cards/place` remains
  // the authoritative server validation and a rejection returns the player to
  // the recoverable placement session.

  async function openPendingPlacement() {
    const day = await fetchJson(`/cities/${api.cityId}/city-day`);
    const choice = day.card;
    const cardsCurrent = await fetchJson(`/cities/${api.cityId}/cards/current`);
    const placementId = cardsCurrent.choice?.card_effects?.placement?.placement_id ?? null;
    await ensureCardCatalog();
    const card = cardForId(choice.selectedCardId);
    const footprint = card?.structure?.footprint ?? "1x1";
    const cityVersion = cardsCurrent.city_version;

    // A placement the player explicitly cancelled this page session must not
    // silently reopen on the next periodic sync. The server-side pending
    // placement stays untouched, so a page reload restores it naturally.
    if (placementId && dismissedPlacementIds.has(placementId)) {
      closeChoiceLayers();
      experience.showIdleNote("已取消放置，可刷新页面后重新选择位置。");
      return;
    }

    // The periodic city-day sync re-enters this path while a placement is
    // pending. Reuse the live session (preserving building rotation and the
    // FOV target) and only refresh the concurrency guard; presenting a second
    // HUD would silently reset the player's rotation every few seconds.
    const sameSession = placement
      && placement.placementId === placementId
      && placement.cardId === choice.selectedCardId;
    if (sameSession) {
      placement.cityVersion = cityVersion;
      experience.updatePlacementControls(placementTargetControls());
      return;
    }

    let candidates = [];
    let sessionVersion = cityVersion;
    try {
      const payload = await fetchJson(`/cities/${api.cityId}/site-searches`, {
        method: "POST",
        body: JSON.stringify({ footprint, limit: 40 })
      });
      candidates = payload.data ?? [];
      sessionVersion = payload.city_version ?? cityVersion;
    } catch {
      candidates = [];
    }
    const grid = api.getState?.()?.world?.grid ?? {};
    const cellWorldSize = Number(grid.cellWorldSize ?? 4);
    placement = {
      card: card ?? { title: "特殊建筑", card_id: choice.selectedCardId },
      cardId: choice.selectedCardId,
      placementId,
      cityVersion: sessionVersion,
      footprint,
      // Deterministic building-shaped preview for this card, resolved through
      // the replaceable preview factory (currently a voxel grammar spec; a
      // future cardId -> prefab factory supplies the same ghost geometry).
      previewSource: resolveSpecialStructurePreview({ card: card ?? {}, cellWorldSize }),
      candidateIndex: createPlacementCandidateIndex(candidates),
      quarterTurns: 0,
      viewMode: "near",
      target: null,
      lastFlatX: null,
      lastFlatZ: null
    };
    experience.presentPlacementMode({
      card: placement.card,
      onRotate: () => rotatePlacement(),
      onConfirm: () => confirmPlacement(),
      onCancel: () => cancelPlacement()
    });
  }

  function placementTargetControls() {
    const target = placement?.target ?? null;
    return {
      viewMode: placement?.viewMode ?? "near",
      hasTarget: Boolean(target?.hasTarget),
      isLegal: Boolean(target?.isLegal),
      reason: target?.reason ?? null,
      quarterTurns: placement?.quarterTurns ?? 0
    };
  }

  // main.js resolves the FOV-center target each frame (pure local lookup) and
  // drives it here. The controller stores the target and projects the minimal
  // placement HUD state; it never fetches during camera movement.
  function setPlacementTarget(target, { viewMode = "near" } = {}) {
    if (!placement) return placement;
    placement.target = target;
    placement.viewMode = viewMode === "far" ? "far" : "near";
    if (target?.center) {
      placement.lastFlatX = target.center.x;
      placement.lastFlatZ = target.center.z;
    }
    experience.updatePlacementControls(placementTargetControls());
    return placement;
  }

  function rotatePlacement() {
    if (!placement) return;
    placement.quarterTurns = ((placement.quarterTurns ?? 0) + 1) % 4;
    const state = api.getState?.() ?? null;
    const target = resolvePlacementTarget(state, {
      flatX: placement.lastFlatX,
      flatZ: placement.lastFlatZ,
      footprint: placement.footprint,
      quarterTurns: placement.quarterTurns,
      candidateIndex: placement.candidateIndex
    });
    placement.target = target;
    experience.updatePlacementControls(placementTargetControls());
  }

  async function confirmPlacement() {
    const activePlacement = placement;
    const target = activePlacement?.target;
    if (!activePlacement || !target?.hasTarget || !target.isLegal) return;
    try {
      // One key per logical placement command; a network retry of this same
      // submission must reuse it so the server can replay instead of double-apply.
      const idempotencyKey = createIdempotencyKey();
      const payload = await postCommand(`/cities/${api.cityId}/cards/place`, {
        expected_city_version: activePlacement.cityVersion,
        card_id: activePlacement.cardId,
        placement_id: activePlacement.placementId,
        lot_id: target.lotId,
        footprint: `${target.footprintColumns}x${target.footprintRows}`,
        entrance: target.entrance
      }, { idempotencyKey });
      if (payload.status !== "placed") throw new Error(payload.message ?? "放置被拒绝");
      experience.closePlacement();
      placementLayer?.clear();
      placement = null;
      closeChoiceLayers();
      onPlayerTurnComplete();
      await sync();
    } catch (error) {
      experience.showIdleNote(error.message);
      // A stale/invalid placement must leave the player in a recoverable
      // placement session: refresh authoritative candidates/version and
      // re-evaluate the current target instead of exiting placement mode.
      await refreshPlacementState();
    }
  }

  async function refreshPlacementState() {
    const current = placement;
    if (!current) return;
    try {
      const cardsCurrent = await fetchJson(`/cities/${api.cityId}/cards/current`);
      current.cityVersion = cardsCurrent.city_version ?? current.cityVersion;
    } catch {
      // Keep the previous concurrency guard; confirm will be rejected again.
    }
    try {
      const payload = await fetchJson(`/cities/${api.cityId}/site-searches`, {
        method: "POST",
        body: JSON.stringify({ footprint: current.footprint, limit: 40 })
      });
      current.candidateIndex = createPlacementCandidateIndex(payload.data ?? []);
      current.cityVersion = payload.city_version ?? current.cityVersion;
    } catch {
      // Keep the previous candidate index; the server still validates on confirm.
    }
    const state = api.getState?.() ?? null;
    const target = resolvePlacementTarget(state, {
      flatX: current.lastFlatX,
      flatZ: current.lastFlatZ,
      footprint: current.footprint,
      quarterTurns: current.quarterTurns,
      candidateIndex: current.candidateIndex
    });
    current.target = target;
    experience.updatePlacementControls(placementTargetControls());
  }

  function cancelPlacement() {
    if (placement?.placementId) dismissedPlacementIds.add(placement.placementId);
    closePlacement();
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

  return {
    sync,
    dismissReport,
    closeChoiceLayers,
    closePlacement,
    postCommand,
    phaseLightTarget,
    setPlacementTarget,
    rotatePlacement,
    confirmPlacement,
    getPlacementState: () => placement,
    get placementActive() { return Boolean(placement); }
  };
}
