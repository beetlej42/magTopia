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
    presentPlacementMode({ onRotate, onConfirm, onCancel }) {
      mock.presentCount = (mock.presentCount ?? 0) + 1;
      mock.onRotate = onRotate;
      mock.onConfirm = onConfirm;
      mock.onCancel = onCancel;
      state.placementOpen = true;
    },
    updatePlacementControls() {},
    closePlacement() { state.placementOpen = false; },
    closeCards() {
      state.cardOpen = false;
      layers.cards.hidden = true;
    },
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

function idempotencyKeyOf(call) {
  return call?.init?.headers?.get?.("idempotency-key") ?? call?.init?.headers?.["Idempotency-Key"] ?? null;
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
  controller.setPlacementTarget({
    hasTarget: true,
    lotId: candidate.lotId,
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    isLegal: true,
    reason: null,
    center: candidate.center
  }, { viewMode: "near" });
  await experience.onConfirm?.();
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

test("every controller JSON POST carries Content-Type: application/json", async () => {
  const experience = createMockExperience();
  let day = {
    phase: "dawn",
    settled: false,
    report: { ready: true, dismissed: false, turn: 2, report_id: "report-x" },
    card: { choicePending: false, playerPlacementPending: false },
    agent: { workStarted: false },
    incident: { phaseActive: false }
  };
  let cardsCurrent = {
    city_id: "city-1",
    city_version: 9,
    turn: 1,
    offer: OFFER,
    choice: { status: "pending" }
  };
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": () => ({ body: day }),
    "/api/v1/cities/city-1/reports/report-x": { body: { report: { masthead: { title: "T" }, edition: "Day 1", headline: "H", lead: "L", articles: [] } } },
    "/api/v1/cities/city-1/cards/current": () => ({ body: cardsCurrent }),
    "/api/v1/cards": { body: { data: [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }] } },
    "/api/v1/cities/city-1/cards/select": { body: { status: "selected", choice: { selected_card_id: "ministry-grant", status: "selected" } } },
    "/api/v1/cities/city-1/site-searches": { body: { city_version: 9, data: [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }] } },
    "/api/v1/cities/city-1/cards/place": { body: { status: "placed" } },
    "/api/v1/cities/city-1/city-day/report-dismissed": { body: { dismissed: true, report_turn: 2 } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });

  const jsonPosts = () => calls.filter((call) => (call.init.method ?? "") === "POST");
  const contentTypeOf = (call) => call.init.headers.get("content-type");

  await controller.sync();
  assert.equal(experience.state.reportOpen, true, "the ready report is presented");
  await controller.dismissReport();
  const dismissCall = jsonPosts().find((call) => call.url.endsWith("/city-day/report-dismissed"));
  assert.ok(dismissCall, "dismissal posts the ack");
  assert.equal(contentTypeOf(dismissCall), "application/json");

  day = { ...day, report: { ready: false, dismissed: false }, card: { choicePending: true, playerPlacementPending: false } };
  await controller.sync();
  await experience.onCardPick?.(OFFER.cards[0], experience.currentOffer);
  const selectCall = jsonPosts().find((call) => call.url.endsWith("/cards/select"));
  assert.ok(selectCall, "card selection posts to /cards/select");
  assert.equal(contentTypeOf(selectCall), "application/json");

  day = { ...day, card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" } };
  cardsCurrent = {
    ...cardsCurrent,
    choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } }
  };
  await controller.sync();
  const searchCall = jsonPosts().find((call) => call.url.endsWith("/site-searches"));
  assert.ok(searchCall, "placement fetches legal lots through a POST");
  assert.equal(contentTypeOf(searchCall), "application/json");
  assert.equal(experience.state.placementOpen, true, "placement mode opened");
  controller.setPlacementTarget({
    hasTarget: true,
    lotId: "cell-2-3",
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    isLegal: true,
    reason: null,
    center: { x: 2, z: -3 }
  }, { viewMode: "near" });
  await experience.onConfirm?.({ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] });
  const placeCall = jsonPosts().find((call) => call.url.endsWith("/cards/place"));
  assert.ok(placeCall, "placement posts to /cards/place");
  assert.equal(contentTypeOf(placeCall), "application/json");
});

// ---- Idempotency-Key on command endpoints ----------------------------------
//
// The server contract marks POST /cards/select and POST /cards/place as command
// operations (OpenAPI commandOperation, repository.transactCity) that require
// an Idempotency-Key so a retried submission can be replayed. The read/search
// POSTs (site-searches, city-day/report-dismissed) are plain operations and
// must NOT carry one.

const CITY_DAY_CARDS = {
  phase: "early_morning",
  settled: false,
  report: { ready: false, dismissed: false },
  card: { choicePending: true, playerPlacementPending: false },
  agent: { workStarted: false },
  incident: { phaseActive: false }
};

test("card selection submits POST with Content-Type and a non-empty Idempotency-Key", async () => {
  const experience = createMockExperience();
  let selectInit = null;
  stubFetch({
    "/api/v1/cities/city-1/city-day": { body: CITY_DAY_CARDS },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
    "/api/v1/cards": { body: { data: [] } },
    "/api/v1/cities/city-1/cards/select": (init) => {
      selectInit = init;
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

  assert.ok(selectInit, "a card select was submitted");
  assert.equal(selectInit.method, "POST");
  assert.equal(selectInit.headers.get("content-type"), "application/json");
  const key = idempotencyKeyOf({ init: selectInit });
  assert.ok(key, "cards/select carries an Idempotency-Key");
  assert.ok(key.length > 0, "the Idempotency-Key is non-empty");
});

test("special structure placement submits POST with a non-empty Idempotency-Key", async () => {
  const experience = createMockExperience();
  let placeInit = null;
  stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { ...CITY_DAY_CARDS, card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } } } },
    "/api/v1/cards": { body: { data: [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }] } },
    "/api/v1/cities/city-1/site-searches": { body: { city_version: 8, data: [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }] } },
    "/api/v1/cities/city-1/cards/place": (init) => {
      placeInit = init;
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
  assert.equal(experience.state.placementOpen, true, "placement mode opened");
  controller.setPlacementTarget({
    hasTarget: true,
    lotId: "cell-2-3",
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    isLegal: true,
    reason: null,
    center: { x: 2, z: -3 }
  }, { viewMode: "near" });
  experience.onConfirm?.();

  assert.ok(placeInit, "a placement was submitted");
  assert.equal(placeInit.method, "POST");
  const key = idempotencyKeyOf({ init: placeInit });
  assert.ok(key, "cards/place carries an Idempotency-Key");
  assert.ok(key.length > 0, "the Idempotency-Key is non-empty");
});

test("report-dismissed, a plain ack operation, carries no Idempotency-Key", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { phase: "dawn", settled: false, report: { ready: true, dismissed: false, turn: 3 }, card: { choicePending: true }, agent: { workStarted: false }, incident: { phaseActive: false } } },
    "/api/v1/cities/city-1/reports/report-x": { body: { report: { masthead: { title: "T" }, edition: "Day 3", headline: "H", lead: "L", articles: [] } } },
    "/api/v1/cities/city-1/city-day/report-dismissed": { status: 200, body: { dismissed: true, report_turn: 3 } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  await controller.dismissReport();
  const dismissCall = calls.find((call) => call.url.endsWith("/city-day/report-dismissed"));
  assert.ok(dismissCall, "dismissal posts the ack");
  assert.equal(idempotencyKeyOf(dismissCall), null, "the plain ack operation must not carry an Idempotency-Key");
});

test("site-searches, a pure read POST, carries no Idempotency-Key", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: { ...CITY_DAY_CARDS, card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" } } },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } } } },
    "/api/v1/cards": { body: { data: [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }] } },
    "/api/v1/cities/city-1/site-searches": { body: { city_version: 8, data: [] } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  const searchCall = calls.find((call) => call.url.endsWith("/site-searches"));
  assert.ok(searchCall, "site-searches is called for legal lots");
  assert.equal(idempotencyKeyOf(searchCall), null, "the pure search POST must not carry an Idempotency-Key");
});

test("GET reads never carry an Idempotency-Key", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": { body: CITY_DAY_CARDS },
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
  const gets = calls.filter((call) => (call.init.method ?? "GET") === "GET");
  assert.ok(gets.length >= 2, "the read flow issues GET requests");
  for (const call of gets) {
    assert.equal(idempotencyKeyOf(call), null, `GET ${call.url} must not carry an Idempotency-Key`);
  }
});

test("postCommand honors a caller-supplied Idempotency-Key", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({ "/api/v1/cards/select": { status: 200, body: { status: "selected" } } });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.postCommand("/cards/select", {}, { idempotencyKey: "fixed-key" });
  assert.equal(calls.length, 1);
  assert.equal(idempotencyKeyOf(calls[0]), "fixed-key", "a caller-supplied key is not overridden");
});

test("independent commands generate distinct Idempotency-Keys", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cards/select": { status: 200, body: { status: "selected" } },
    "/api/v1/cards/place": { status: 200, body: { status: "placed" } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.postCommand("/cards/select", { a: 1 });
  await controller.postCommand("/cards/place", { b: 2 });
  const keyA = idempotencyKeyOf(calls[0]);
  const keyB = idempotencyKeyOf(calls[1]);
  assert.ok(keyA && keyB, "both commands carry a key");
  assert.notEqual(keyA, keyB, "two independent commands must use different keys");
});

test("retrying a command with the same key reuses that Idempotency-Key", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({ "/api/v1/cards/select": { status: 200, body: { status: "selected" } } });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  const key = "retry-shared-key";
  await controller.postCommand("/cards/select", {}, { idempotencyKey: key });
  await controller.postCommand("/cards/select", {}, { idempotencyKey: key });
  assert.equal(calls.length, 2);
  assert.equal(idempotencyKeyOf(calls[0]), key, "the first attempt uses the shared key");
  assert.equal(idempotencyKeyOf(calls[1]), key, "the retry reuses the same key");
});

// ---- Non-secure-context fallback -------------------------------------------
//
// crypto.randomUUID is only exposed in secure contexts (HTTPS or localhost).
// The live city page is served over plain http://, where it is undefined and a
// direct call would throw inside the card click handler before any POST — the
// deployed regression that left every selection silently un-submitted. These
// tests simulate that environment and lock in the getRandomValues fallback.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function withoutRandomUUID(run) {
  const original = crypto.randomUUID;
  crypto.randomUUID = undefined;
  try {
    await run();
  } finally {
    crypto.randomUUID = original;
  }
}

test("cards/select still submits a non-empty Idempotency-Key when crypto.randomUUID is unavailable", async () => {
  await withoutRandomUUID(async () => {
    const experience = createMockExperience();
    let selectInit = null;
    stubFetch({
      "/api/v1/cities/city-1/city-day": { body: CITY_DAY_CARDS },
      "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
      "/api/v1/cards": { body: { data: [] } },
      "/api/v1/cities/city-1/cards/select": (init) => {
        selectInit = init;
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

    assert.ok(selectInit, "the card selection is submitted even without crypto.randomUUID");
    assert.equal(selectInit.method, "POST");
    const key = idempotencyKeyOf({ init: selectInit });
    assert.ok(key, "cards/select still carries an Idempotency-Key");
    assert.ok(key.length > 0, "the fallback Idempotency-Key is non-empty");
    assert.match(key, UUID_V4, "the fallback key is a well-formed UUID v4");
  });
});

test("cards/place still submits a non-empty Idempotency-Key when crypto.randomUUID is unavailable", async () => {
  await withoutRandomUUID(async () => {
    const experience = createMockExperience();
    let placeInit = null;
    stubFetch({
      "/api/v1/cities/city-1/city-day": { body: { ...CITY_DAY_CARDS, card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" } } },
      "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } } } },
      "/api/v1/cards": { body: { data: [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }] } },
      "/api/v1/cities/city-1/site-searches": { body: { city_version: 8, data: [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }] } },
      "/api/v1/cities/city-1/cards/place": (init) => {
        placeInit = init;
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
    assert.equal(experience.state.placementOpen, true, "placement mode opened");
    controller.setPlacementTarget({
      hasTarget: true,
      lotId: "cell-2-3",
      footprintColumns: 1,
      footprintRows: 1,
      entrance: "south",
      isLegal: true,
      reason: null,
      center: { x: 2, z: -3 }
    }, { viewMode: "near" });
    await experience.onConfirm?.();

    assert.ok(placeInit, "the placement is submitted even without crypto.randomUUID");
    assert.equal(placeInit.method, "POST");
    const key = idempotencyKeyOf({ init: placeInit });
    assert.ok(key, "cards/place still carries an Idempotency-Key");
    assert.ok(key.length > 0, "the fallback Idempotency-Key is non-empty");
    assert.match(key, UUID_V4, "the fallback key is a well-formed UUID v4");
  });
});

test("fallback Idempotency-Keys stay distinct across independent commands", async () => {
  await withoutRandomUUID(async () => {
    const experience = createMockExperience();
    const calls = stubFetch({
      "/api/v1/cards/select": { status: 200, body: { status: "selected" } },
      "/api/v1/cards/place": { status: 200, body: { status: "placed" } }
    });
    const controller = createCityDayController({
      experience,
      api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
      setLight: () => {},
      onPlayerTurnComplete: () => {}
    });
    await controller.postCommand("/cards/select", { a: 1 });
    await controller.postCommand("/cards/place", { b: 2 });
    const keyA = idempotencyKeyOf(calls[0]);
    const keyB = idempotencyKeyOf(calls[1]);
    assert.ok(keyA && keyB, "both commands carry a fallback key");
    assert.match(keyA, UUID_V4);
    assert.match(keyB, UUID_V4);
    assert.notEqual(keyA, keyB, "independent commands still get distinct fallback keys");
  });
});

// ---- PR #52 in-world placement session --------------------------------------
//
// The placement flow is now an in-world FOV-center session: the authoritative
// candidate set is fetched once on entry and re-evaluation is local. These
// tests lock in session survival across the periodic city-day sync, the
// rotation state, rejection recovery, and cancel semantics.

const PENDING_PLACEMENT_DAY = {
  phase: "early_morning",
  settled: false,
  report: { ready: false, dismissed: false },
  card: { choicePending: false, playerPlacementPending: true, selectedCardId: "owl-tower" },
  agent: { workStarted: false },
  incident: { phaseActive: false }
};

const OWL_CARD = [{ card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x", structure: { footprint: "1x1" } }];

function pendingPlacementRoutes({ searchData = [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }], onSearch } = {}) {
  return {
    "/api/v1/cities/city-1/city-day": { body: PENDING_PLACEMENT_DAY },
    "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "placement-9", mode: "player_place" } } } } },
    "/api/v1/cards": { body: { data: OWL_CARD } },
    "/api/v1/cities/city-1/site-searches": (init) => {
      onSearch?.(init);
      return { body: { city_version: 8, data: searchData } };
    },
    "/api/v1/cities/city-1/cards/cancel": { body: { status: "cancelled" } }
  };
}

function legalTarget() {
  return {
    hasTarget: true,
    lotId: "cell-2-3",
    footprintCells: ["cell-2-3"],
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    isLegal: true,
    reason: null,
    center: { x: 2, z: -3 }
  };
}

test("placement session survives the periodic sync without re-presenting or re-fetching", async () => {
  const experience = createMockExperience();
  let searchCount = 0;
  stubFetch(pendingPlacementRoutes({
    onSearch: () => { searchCount += 1; }
  }));
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  assert.equal(experience.state.placementOpen, true, "placement mode opened");
  assert.equal(experience.presentCount, 1, "the HUD is presented once on entry");

  controller.setPlacementTarget(legalTarget(), { viewMode: "near" });
  controller.rotatePlacement();
  assert.equal(controller.getPlacementState().quarterTurns, 1, "rotation is tracked locally");

  await controller.sync();
  assert.equal(experience.state.placementOpen, true, "the periodic sync keeps the session open");
  assert.equal(experience.presentCount, 1, "the HUD is not re-presented by the periodic sync");
  assert.equal(controller.getPlacementState().quarterTurns, 1, "rotation survives the periodic sync");
  assert.equal(searchCount, 1, "the candidate set is fetched once, not once per sync");
});

test("rotatePlacement re-resolves the target locally without a network request", async () => {
  const experience = createMockExperience();
  let searchCount = 0;
  stubFetch(pendingPlacementRoutes({ onSearch: () => { searchCount += 1; } }));
  const controller = createCityDayController({
    experience,
    api: {
      baseUrl: "/api/v1",
      cityId: "city-1",
      token: "session",
      getState: () => ({
        world: { grid: { columns: 5, rows: 5, cellWorldSize: 4 } },
        cells: {
          "cell-2-3": { id: "cell-2-3", column: 2, row: 3, center: { x: 2, z: -3 }, buildable: true, strictBuildable: true, occupancy: null, infrastructure: null, reservation: null, node: null },
          "cell-3-3": { id: "cell-3-3", column: 3, row: 3, center: { x: 6, z: -3 }, buildable: true, strictBuildable: true, occupancy: null, infrastructure: null, reservation: null, node: null }
        },
        infrastructure: {}
      })
    },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  controller.setPlacementTarget(legalTarget(), { viewMode: "near" });
  const before = controller.getPlacementState().target;
  assert.deepEqual(before.footprintCells, ["cell-2-3"]);

  experience.onRotate?.();
  const after = controller.getPlacementState();
  assert.equal(after.quarterTurns, 1);
  assert.equal(searchCount, 1, "rotating triggers no site-search fetch");
});

test("confirming an invalid target does not submit /cards/place", async () => {
  const experience = createMockExperience();
  let placeCount = 0;
  stubFetch({
    ...pendingPlacementRoutes(),
    "/api/v1/cities/city-1/cards/place": () => {
      placeCount += 1;
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
  controller.setPlacementTarget({
    hasTarget: true,
    lotId: "cell-2-3",
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    isLegal: false,
    reason: "入口朝 south 没有可建造的临街面",
    center: { x: 2, z: -3 }
  }, { viewMode: "near" });
  await experience.onConfirm?.();
  assert.equal(placeCount, 0, "an illegal target never submits a placement");
  assert.equal(experience.state.placementOpen, true, "the session stays open");
});

test("a server placement rejection returns the player to a recoverable session", async () => {
  const experience = createMockExperience();
  let searchCount = 0;
  stubFetch({
    ...pendingPlacementRoutes({ onSearch: () => { searchCount += 1; } }),
    "/api/v1/cities/city-1/cards/place": { status: 422, body: { code: "PLACEMENT_ILLEGAL", message: "Entrance south has no buildable frontage" } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  controller.setPlacementTarget(legalTarget(), { viewMode: "near" });
  await experience.onConfirm?.();

  assert.equal(experience.state.placementOpen, true, "a rejection leaves the player in placement mode");
  assert.ok(controller.placementActive, "the placement session survives a rejection");
  assert.equal(searchCount, 2, "the rejection refreshes the authoritative candidate set once");
});

test("cancel exits the session without placing or delegating", async () => {
  const experience = createMockExperience();
  let placeCount = 0;
  stubFetch({
    ...pendingPlacementRoutes(),
    "/api/v1/cities/city-1/cards/place": () => {
      placeCount += 1;
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
  assert.equal(experience.state.placementOpen, true);
  experience.onCancel?.();
  assert.equal(experience.state.placementOpen, false, "cancel closes the placement layer");
  assert.equal(controller.placementActive, false, "cancel clears the placement session");
  assert.equal(placeCount, 0, "cancel never submits a placement");
});

test("a cancelled placement is not silently reopened by the periodic sync", async () => {
  const experience = createMockExperience();
  let searchCount = 0;
  stubFetch(pendingPlacementRoutes({ onSearch: () => { searchCount += 1; } }));
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  assert.equal(experience.state.placementOpen, true, "placement opened");
  assert.equal(experience.presentCount, 1);

  experience.onCancel?.();
  assert.equal(experience.state.placementOpen, false, "cancel closes the placement layer");
  assert.equal(controller.placementActive, false);

  await controller.sync();
  assert.equal(experience.state.placementOpen, false, "the periodic sync does not reopen a locally cancelled placement");
  assert.equal(experience.presentCount, 1, "no placement HUD is re-presented for the cancelled placement");
  assert.equal(searchCount, 1, "the cancelled placement is not re-fetched");

  await controller.sync();
  assert.equal(experience.state.placementOpen, false, "repeated syncs keep the cancelled placement closed");
  assert.equal(experience.presentCount, 1);
});

test("a fresh placement_id opens normally after a previous cancel", async () => {
  const experience = createMockExperience();
  let placementId = "placement-9";
  let searchCount = 0;
  const routes = pendingPlacementRoutes({
    onSearch: () => { searchCount += 1; }
  });
  stubFetch({
    ...routes,
    "/api/v1/cities/city-1/cards/current": () => ({
      body: { city_id: "city-1", city_version: 8, turn: 0, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: placementId, mode: "player_place" } } } }
    })
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {},
    onPlayerTurnComplete: () => {}
  });
  await controller.sync();
  assert.equal(experience.state.placementOpen, true, "placement opened");
  experience.onCancel?.();
  await controller.sync();
  assert.equal(experience.state.placementOpen, false, "the cancelled placement stays closed");

  placementId = "placement-10";
  await controller.sync();
  assert.equal(experience.state.placementOpen, true, "a new placement id opens normally");
  assert.equal(experience.presentCount, 2, "the new placement presents a fresh HUD");
  assert.equal(searchCount, 2, "the new placement fetches its own candidate set");
});

test("reload restores an older player placement from pending_placements, not current card choice", async () => {
  const experience = createMockExperience();
  const calls = stubFetch({
    "/api/v1/cities/city-1/city-day": {
      body: {
        ...PENDING_PLACEMENT_DAY,
        turn: 6,
        card: {
          choicePending: false,
          playerPlacementPending: true,
          selectedCardId: "ordinary-resource-grant",
          pending_placements: [{ placement_id: "placement-turn-5", card_id: "owl-tower", mode: "player_place", status: "pending" }]
        }
      }
    },
    "/api/v1/cities/city-1/cards/current": {
      body: {
        city_id: "city-1", city_version: 42, turn: 6,
        offer: { ...OFFER, turn: 6, cards: [{ card_id: "ordinary-resource-grant", type: "resource", title: "Grant", description: "x" }] },
        choice: { status: "selected", selected_card_id: "ordinary-resource-grant", decision_mode: "immediate" },
        pending_placements: [{ placement_id: "placement-turn-5", card_id: "owl-tower", mode: "player_place", status: "pending" }]
      }
    },
    "/api/v1/cards": { body: { data: OWL_CARD } },
    "/api/v1/cities/city-1/site-searches": { body: { city_version: 42, data: [{ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] }] } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {}
  });
  await controller.sync();
  assert.equal(controller.getPlacementState().placementId, "placement-turn-5");
  assert.equal(controller.getPlacementState().cardId, "owl-tower");
  assert.equal(calls.some((call) => call.url.endsWith("/cards/select")), false);
});

test("player placement cancellation uses the authoritative endpoint and idempotency", async () => {
  const experience = createMockExperience();
  let cancelBody = null;
  const calls = stubFetch({
    ...pendingPlacementRoutes(),
    "/api/v1/cities/city-1/cards/cancel": (init) => {
      cancelBody = JSON.parse(String(init.body));
      return { body: { status: "cancelled" } };
    },
    "/api/v1/cities/city-1/city-day": { body: { ...PENDING_PLACEMENT_DAY, card: { ...PENDING_PLACEMENT_DAY.card, pendingPlacements: [{ placement_id: "placement-9", card_id: "owl-tower", mode: "player_place", status: "pending" }] } } }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {}
  });
  await controller.sync();
  experience.onCancel?.();
  // Let the async command and sync settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(cancelBody, { expected_city_version: 8, placement_id: "placement-9" });
  const cancelCall = calls.find((call) => call.url.endsWith("/cards/cancel"));
  assert.ok(idempotencyKeyOf(cancelCall), "cancellation carries an idempotency key");
});

test("failed placement cancellation restores the HUD without completing the player turn", async () => {
  for (const [label, cancellation] of [
    ["http failure", { status: 422, body: { code: "PLACEMENT_NOT_CANCELLABLE", message: "still pending" } }],
    ["empty 200", { status: 200, body: {} }],
    ["explicit rejection", { status: 200, body: { status: "rejected", message: "cancel rejected" } }]
  ]) {
    const experience = createMockExperience();
    let completed = 0;
    stubFetch({
      ...pendingPlacementRoutes(),
      "/api/v1/cities/city-1/cards/cancel": cancellation
    });
    const controller = createCityDayController({
      experience,
      api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
      setLight: () => {},
      onPlayerTurnComplete: () => { completed += 1; }
    });
    await controller.sync();
    await experience.onCancel?.();
    assert.equal(controller.placementActive, true, `${label}: pending placement remains recoverable`);
    assert.equal(experience.state.placementOpen, true, `${label}: placement HUD is restored`);
    assert.equal(completed, 0, `${label}: failed cancel does not complete the player turn`);
  }
});

test("multiple player placements sort by earned turn then id and continue after the first is cancelled", async () => {
  const experience = createMockExperience();
  let cancelled = false;
  const entries = () => cancelled
    ? [{ placement_id: "placement-late", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 10 }]
    : [
      { placement_id: "placement-late", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 10 },
      { placement_id: "placement-early", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 5 }
    ];
  stubFetch({
    ...pendingPlacementRoutes(),
    "/api/v1/cities/city-1/city-day": () => ({ body: { ...PENDING_PLACEMENT_DAY, card: { ...PENDING_PLACEMENT_DAY.card, pendingPlacements: entries() } } }),
    "/api/v1/cities/city-1/cards/current": () => ({ body: { city_id: "city-1", city_version: cancelled ? 9 : 8, turn: 10, offer: OFFER, choice: { status: "selected", card_effects: { placement: { placement_id: "wrong-current-choice", mode: "player_place" } } }, pending_placements: entries() } }),
    "/api/v1/cities/city-1/cards/cancel": () => { cancelled = true; return { body: { status: "cancelled" } }; }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {}
  });
  await controller.sync();
  assert.equal(controller.getPlacementState().placementId, "placement-early");
  await experience.onCancel?.();
  assert.equal(controller.getPlacementState().placementId, "placement-late", "the next mandate opens after the first is cancelled");
});

test("completing the first of multiple placements automatically opens the next mandate", async () => {
  const experience = createMockExperience();
  let placed = false;
  const entries = () => placed
    ? [{ placement_id: "placement-next", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 10 }]
    : [
      { placement_id: "placement-first", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 5 },
      { placement_id: "placement-next", card_id: "owl-tower", mode: "player_place", status: "pending", delegated_at_turn: 10 }
    ];
  stubFetch({
    ...pendingPlacementRoutes(),
    "/api/v1/cities/city-1/city-day": () => ({ body: { ...PENDING_PLACEMENT_DAY, card: { ...PENDING_PLACEMENT_DAY.card, pendingPlacements: entries() } } }),
    "/api/v1/cities/city-1/cards/current": () => ({ body: { city_id: "city-1", city_version: placed ? 9 : 8, turn: 10, offer: OFFER, choice: { status: "selected" }, pending_placements: entries() } }),
    "/api/v1/cities/city-1/cards/place": () => { placed = true; return { body: { status: "placed" } }; }
  });
  const controller = createCityDayController({
    experience,
    api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
    setLight: () => {}
  });
  await controller.sync();
  controller.setPlacementTarget(legalTarget(), { viewMode: "near" });
  await experience.onConfirm?.();
  assert.equal(controller.getPlacementState().placementId, "placement-next");
});
