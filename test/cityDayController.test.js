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
  await experience.onPlace?.(candidate);
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
  await experience.onPlace?.({ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] });
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
  experience.onPlace?.({ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] });

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
    await experience.onPlace?.({ lotId: "cell-2-3", center: { x: 2, z: -3 }, entranceDirections: ["south"] });

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
