// PR G — City-day experience controller.
//
// Wires the presentation overlay to the authoritative server read/ack/card
// endpoints. The controller never invents gameplay: it submits card selections
// and placements through the existing API and projects light from the
// server-derived phase. After a reload it restores from the city-day read model,
// so an acknowledged report is never replayed and a second card is never
// offered for the same turn.

import { phaseLightTarget } from "./cityDayExperience.js";

export function createCityDayController({ experience, api, setLight, onPlayerTurnComplete = () => {} }) {
  let syncing = false;
  let cardCatalog = null;
  let activeOffer = null;

  async function fetchJson(path, init = {}) {
    const headers = new Headers(init.headers ?? {});
    const token = typeof api.token === "function" ? api.token() : api.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${api.baseUrl}${path}`, { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message ?? `${payload.code ?? response.status}`);
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function ensureCardCatalog() {
    if (cardCatalog) return cardCatalog;
    const payload = await fetchJson("/api/v1/cards");
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
      const day = await fetchJson(`/api/v1/cities/${api.cityId}/city-day`);
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
        const payload = await fetchJson(`/api/v1/cities/${api.cityId}/reports/${day.report.report_id}`);
        report = payload.report ?? null;
      } catch {
        report = null;
      }
    }
    experience.presentReport(report, day.report);
  }

  async function openCards() {
    const payload = await fetchJson(`/api/v1/cities/${api.cityId}/cards/current`);
    activeOffer = payload.offer;
    await ensureCardCatalog();
    experience.presentCards(payload.offer, onCardPick);
  }

  async function onCardPick(card, offer) {
    if (card.type === "special_structure") {
      experience.presentPlacementChoice(card, (mode) => submitCardSelection(card, offer, mode));
      return;
    }
    await submitCardSelection(card, offer, "immediate");
  }

  async function submitCardSelection(card, offer, decisionMode) {
    try {
      const payload = await fetchJson(`/api/v1/cities/${api.cityId}/cards/select`, {
        method: "POST",
        body: JSON.stringify({
          expected_city_version: offer.city_version,
          offer_id: offer.offer_id,
          selected_card_id: card.card_id,
          decision_mode: decisionMode
        })
      });
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
      await sync();
    }
  }

  async function openPendingPlacement() {
    const day = await fetchJson(`/api/v1/cities/${api.cityId}/city-day`);
    const choice = day.card;
    const cardsCurrent = await fetchJson(`/api/v1/cities/${api.cityId}/cards/current`);
    const placementId = cardsCurrent.choice?.card_effects?.placement?.placement_id ?? null;
    await ensureCardCatalog();
    const card = cardForId(choice.selectedCardId);
    const footprint = card?.structure?.footprint ?? "1x1";
    let candidates = [];
    try {
      const payload = await fetchJson(`/api/v1/cities/${api.cityId}/site-searches`, {
        method: "POST",
        body: JSON.stringify({ footprint, limit: 24 })
      });
      candidates = payload.data ?? [];
    } catch {
      candidates = [];
    }
    experience.presentPlacementMode({
      card: card ?? { title: "特殊建筑", card_id: choice.selectedCardId },
      candidates,
      onPlace: (candidate) => placeCard(card, choice.selectedCardId, placementId, candidate),
      onCancel: () => closeChoiceLayers()
    });
  }

  async function placeCard(card, cardId, placementId, candidate) {
    const day = await fetchJson(`/api/v1/cities/${api.cityId}/city-day`);
    try {
      const payload = await fetchJson(`/api/v1/cities/${api.cityId}/cards/place`, {
        method: "POST",
        body: JSON.stringify({
          expected_city_version: day.city_version,
          card_id: cardId,
          placement_id: placementId,
          lot_id: candidate.lotId,
          footprint: card?.structure?.footprint ?? "1x1",
          entrance: "south"
        })
      });
      if (payload.status !== "placed") throw new Error(payload.message ?? "放置被拒绝");
      experience.closePlacement();
      closeChoiceLayers();
      onPlayerTurnComplete();
      await sync();
    } catch (error) {
      experience.showIdleNote(error.message);
    }
  }

  async function dismissReport() {
    const day = experience.state.presentation;
    const reportTurn = day?.report?.turn;
    if (reportTurn != null) {
      try {
        await fetchJson(`/api/v1/cities/${api.cityId}/city-day/report-dismissed`, {
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
    experience.closePlacement();
    if (experience.state.cardOpen) {
      experience.layers.cards.hidden = true;
      experience.state.cardOpen = false;
      experience.root.hidden = !experience.state.placementOpen;
    }
  }

  return { sync, dismissReport, closeChoiceLayers, phaseLightTarget };
}
