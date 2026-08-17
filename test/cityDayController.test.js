import assert from "node:assert/strict";
import test from "node:test";
import { createCityDayController } from "../src/ui/cityDayController.js";

// Controller-level regression tests. The controller is the only layer that
// composes server URLs and submits selections/placements; these tests stub
// global fetch and assert the *actual* requested URLs and bodies, catching
// path-prefix and concurrency-guard regressions that API tests cannot see.

function createMockExperience() {
  const layers = {
    cards: { hidden: false },
    placement: { hidden: false }
  };
  const state = {
    phase: null,
    presentation: null,
    reportOpen: false,
    cardOpen: false,
    placementOpen: false
  };
  const mock = {
    root: { hidden: false },
    layers,
    state,
    currentOffer: null,
    onCardPick: null,
    onPlace: null,
    applyPresentation(presentation) {
      state.presentation = presentation;
      state.phase = presentation?.phase ?? "morning";
    },
    presentReport() { state.reportOpen = true; },
    presentCards(offer, onCardPick) {
      mock.currentOffer = offer;
      mock.onCardPick = onCardPick;
      state.cardOpen = true;
    },
    presentPlacementChoice() {},
    presentPlacementMode({ onPlace }) {
      mock.onPlace = onPlace;
      state.placementOpen = true;
    },
    selectCandidateFromLayer() {},
    closePlacement() { state.placementOpen = false; },
    showIdleNote() {},
    setHidden() {}
  };
  return mock;
}

// A fetch stub that records every request and lets the test answer each URL.
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const responder = routes[url];
    const { status = 200, body = {} } = typeof responder === "function" ? responder(init) : (responder ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
  return calls;
}

const OFFER = {
  offer_id: "offer-1",
  turn: 0,
  cards: [
    { card_id: "ministry-grant", type: "resource", title: "Ministry Grant", description: "x" },
    { card_id: "statute-of-secrecy-reinforcement", type: "policy", title: "Statute", description: "x", duration: { type: "turns", turns: 3 } },
    { card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x" }
  ]
};

test("controller requests singular /api/v1 URLs, never double-prefixed", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "early_morning", settled: false, report: { ready: false, dismissed: false }, card: { choicePending: true, playerPlacementPending: false }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
    "/api/v1/cards": { body: { data: [] } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();

  const urls = calls.map((call) => call.url);
  assert.ok(urls.includes("/api/v1/cities/city-1/city-day"), "city-day read uses the singular prefix");
  assert.ok(urls.includes("/api/v1/cities/city-1/cards/current"), "cards/current uses the singular prefix");
  assert.ok(urls.includes("/api/v1/cards"), "card catalog uses the singular prefix");
  assert.ok(urls.every((url) => !url.includes("/api/v1/api/v1")), "no double-prefixed URL is ever requested");
});

test("card selection submits the top-level authoritative city_version", async () => {
  const experience = createMockExperience();
  let selectBody = null;
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "early_morning", settled: false, report: { ready: false, dismissed: false }, card: { choicePending: true, playerPlacementPending: false }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
    "/api/v1/cards": { body: { data: [] } },
    "/api/v1/cities/city-1/cards/select": (init) => {
      selectBody = JSON.parse(String(init.body));
      return { status: 200, body: { status: "selected", choice: { selected_card_id: "ministry-grant", status: "selected" } } };
    }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  await experience.onCardPick?.(OFFER.cards[0], experience.currentOffer);

  // The controller drives selection through presentCards -> onCardPick. The
  // experience mock records the offer it received.
  assert.ok(selectBody, "a card select was submitted");
  assert.equal(selectBody.expected_city_version, 7, "expected_city_version comes from the top-level /cards/current city_version, not undefined");
  assert.equal(selectBody.offer_id, "offer-1");
  assert.equal(selectBody.selected_card_id, "ministry-grant");
});

test("a stale city_version surfaces a conflict and the controller refreshes", async () => {
  const experience = createMockExperience();
  let selectCount = 0;
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "early_morning", settled: false, report: { ready: false, dismissed: false }, card: { choicePending: true, playerPlacementPending: false }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
    "/api/v1/cards": { body: { data: [] } },
    "/api/v1/cities/city-1/cards/select": (init) => {
      selectCount += 1;
      return { status: 409, body: { code: "CITY_VERSION_CONFLICT", message: "City changed since the preview" } };
    }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  await experience.onCardPick?.(OFFER.cards[0], experience.currentOffer);

  assert.equal(selectCount, 1, "the stale selection was attempted once");
  // The controller reacts to the conflict by re-reading the authoritative state
  // (calls include a fresh cards/current and city-day after the failure).
  const selectIndex = calls.findIndex((call) => call.url.endsWith("/cards/select"));
  assert.ok(selectIndex >= 0);
  const afterConflict = calls.slice(selectIndex + 1).map((call) => call.url);
  assert.ok(afterConflict.some((url) => url.endsWith("/cards/current")), "a stale offer refreshes the authoritative card state");
});

test("special structure placement submits placement_id and a legal lot through /cards/place", async () => {
  const experience = createMockExperience();
  let placeBody = null;
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "early_morning", settled: false, report: { ready: false, dismissed: false }, card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } } } },
    "/api/v1/cards": { body: { data: [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }] } },
    "/api/v1/cities/city-1/site-searches": { body: { city_version: 8, data: [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }] } },
    "/api/v1/cities/city-1/cards/place": (init) => {
      placeBody = JSON.parse(String(init.body));
      return { status: 200, body: { status: "placed" } };
    }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  assert.ok(experience.state.placementOpen, "placement mode opened");
  assert.equal(calls.some((call) => call.url.endsWith("/site-searches")), true, "legal lots are fetched from the authoritative site search");

  const candidate = { lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] };
  experience.onPlace?.(candidate);
  assert.ok(placeBody, "a placement was submitted");
  assert.equal(placeBody.expected_city_version, 8);
  assert.equal(placeBody.placement_id, "placement-9");
  assert.equal(placeBody.lot_id, "cell-2-3");
  assert.equal(placeBody.footprint, "1x1");
  assert.equal(placeBody.entrance, "south");
});

test("report dismissal posts report_turn to the ack endpoint once", async () => {
  const experience = createMockExperience();
  let dismissBody = null;
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "dawn", settled: false, report: { ready: true, dismissed: false, turn: 3 }, card: { choicePending: true }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/reports/report-x": { body: { report: { masthead: { title: "T" }, edition: "Day 3", headline: "H", lead: "L", articles: [] } } },
    "/api/v1/cities/city-1/city-day/report-dismissed": (init) => {
      dismissBody = JSON.parse(String(init.body));
      return { status: 200, body: { dismissed: true, report_turn: 3 } };
    }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  assert.equal(experience.state.reportOpen, true, "the ready report is presented");
  await controller.dismissReport();
  assert.ok(dismissBody, "dismissal posts the ack");
  assert.equal(dismissBody.report_turn, 3);
  const dismissCalls = calls.filter((call) => call.url.endsWith("/city-day/report-dismissed"));
  assert.equal(dismissCalls.length, 1, "the ack is recorded exactly once");
});
