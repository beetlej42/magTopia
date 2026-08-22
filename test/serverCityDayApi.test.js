import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { resolveTurn } from "../src/gameplay/simulation.js";
import { openNextTurn } from "../src/gameplay/turn.js";
import { ensureCardOffer, openTurnCardState, selectCard, placeSpecialStructure } from "../src/gameplay/cards.js";
import { CARD_TYPES, getCard } from "../src/gameplay/card-catalog.js";
import {
  agentWorkStartedForTurn,
  cardChoicePending,
  deriveCityDayPresentation,
  incidentPhaseActive,
  playerPlacementPending
} from "../src/gameplay/city-day.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-city-day-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7,
  turnIntervalMs: 86_400_000,
  turnDeadlineMs: 86_400_000
};

const VESPER = { id: "officer-vesper", name: "Vesper", archetype: "investigation", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 };

async function openCity(repository, app) {
  const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "City Day Owner" } }, 201);
  const city = await json(app, auth(player, {
    method: "POST",
    url: "/api/v1/cities",
    payload: { name: "City Day City", map_seed: "city-day-test" }
  }), 201);
  const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
  const connected = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
  const agent = { access_token: connected.access_token };
  const owner = await repository.authenticate(player.access_token);
  return { player, city, agent, owner };
}

function pushAgentEvent(state, overrides = {}) {
  state.events.push({
    id: `event-${state.events.length + 1}`,
    turn: state.turn,
    cityVersion: state.version,
    at: new Date().toISOString(),
    type: "building_constructed",
    actor: "agent:credential-1",
    buildingId: "building-1",
    ...overrides
  });
  return state;
}

function specialCardId(offer) {
  const cardId = offer?.offer?.cards?.find((card) => card.type === CARD_TYPES.special_structure)?.card_id;
  assert.ok(cardId, "offer must contain a special structure card");
  return cardId;
}

function nonSpecialCardId(offer, type) {
  const cardId = offer?.offer?.cards?.find((card) => card.type === type)?.card_id;
  assert.ok(cardId, `offer must contain a ${type} card`);
  return cardId;
}

function findLegalLot(state, footprint) {
  for (const cell of Object.values(state.cells)) {
    if (!cell.buildable || cell.strictBuildable === false || cell.node || cell.occupancy || cell.infrastructure || cell.reservation) continue;
    const cells = footprintCellsFor(state, cell.id, footprint);
    if (!cells || cells.some((id) => !state.cells[id] || state.cells[id].occupancy || state.cells[id].infrastructure || state.cells[id].reservation || state.cells[id].buildable === false || state.cells[id].node)) continue;
    return cell.id;
  }
  return null;
}

function footprintCellsFor(state, lotId, footprint) {
  const match = /^(\d+)x(\d+)$/.exec(footprint);
  if (!match) return null;
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  const lot = state.cells[lotId];
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push(`cell-${lot.column + column}-${lot.row + row}`);
    }
  }
  return cells;
}

async function resolveAndPublish(app, repository, { player, agent, city }, { turn }) {
  const owner = await repository.authenticate(player.access_token);
  const current = await repository.getCity(owner, city.id);
  // Mark the current turn as already-scheduled and already-unlocked so the
  // city-day walk can settle it without waiting for a real cooldown.
  await repository.transactCity({
    principal: owner,
    cityId: city.id,
    endpoint: "test/cityday-force-unlocked",
    idempotencyKey: `cityday-force-unlocked-${turn}`,
    requestBody: {},
    expectedVersion: current.state.version
  }, async ({ state }) => {
    state.gameplay.turnOpenedAt = "2000-01-01T00:00:00.000Z";
    state.gameplay.nextTurnUnlockAt = "2000-01-01T00:00:00.000Z";
    state.gameplay.turnDeadlineAt = null;
    return { nextState: state, response: { forced: true } };
  });
  const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
  const settled = await json(app, auth(agent, {
    method: "POST",
    url: `/api/v1/cities/${city.id}/strategy/resolve`,
    headers: { "idempotency-key": `cityday-resolve-${turn}` },
    payload: { expected_city_version: strategy.city_version }
  }), 200);
  assert.equal(settled.status, "resolved");
  const factsTurn = settled.facts.turn;
  const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=${factsTurn}` }), 200);
  const report = {
    masthead: { title: "The Hooting Herald", subtitle: "An Independent Daily of the Wizarding City" },
    edition: `Day ${context.turn} Edition`,
    headline: "A Quiet Day of Measured Growth",
    lead: "The city woke to another day of measured growth.",
    articles: [{ id: "article-a", headline: "New Homes", body: "New homes appeared.", category: "development", importance: "front_page" }],
    briefs: [{ id: "brief-b", text: "Population shifted.", category: "population", relatedFactRefs: [context.populationDelta.factRef] }],
    tomorrowWatch: [{ id: "tw", text: "Watch the exposed buildings.", factRefs: context.nextRisks.map((entry) => entry.factRef) }]
  };
  const published = await json(app, auth(agent, {
    method: "POST",
    url: `/api/v1/cities/${city.id}/reports`,
    headers: { "idempotency-key": `cityday-report-${turn}` },
    payload: { turn: context.turn, facts_digest: context.factsDigest, report }
  }), 201);
  assert.ok(published.report_id);
  return { settled, published };
}
test("a fresh city reaches card choice directly: phase early_morning with no report", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "early_morning");
    assert.equal(day.settled, false);
    assert.equal(day.report.turn, null);
    assert.equal(day.report.ready, false);
    assert.equal(day.card.choicePending, true);
    assert.equal(day.agent.workStarted, false);
    assert.equal(day.incident.phaseActive, false);
  } finally {
    await app.close();
  }
});

test("after a resolved prior day, presentation opens at dawn with the completed report ready", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    await resolveAndPublish(app, repository, { player, agent, city }, { turn: 1 });
    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "dawn");
    assert.equal(day.settled, true);
    assert.equal(day.report.turn, 1);
    assert.equal(day.report.ready, true);
    assert.equal(day.report.dismissed, false);
    assert.ok(day.report.report_id);
    assert.ok(day.report.headline);
  } finally {
    await app.close();
  }
});

test("dismissing the report advances to card choice without changing gameplay state", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    await resolveAndPublish(app, repository, { player, agent, city }, { turn: 1 });
    const before = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    const dismissed = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/city-day/report-dismissed`,
      payload: { report_turn: 1 }
    }), 200);
    assert.equal(dismissed.dismissed, true);
    const after = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(after.report.dismissed, true);
    assert.equal(after.card.choicePending, false, "the settled turn still has no pending card choice");
    assert.equal(after.city_version, before.city_version, "dismissal is pure acknowledgement; it never mutates city state");
  } finally {
    await app.close();
  }
});

test("reopening after dismissal does not replay the mandatory report flow", async () => {
  const directory = await import("node:fs/promises").then(({ mkdtemp, rm }) => mkdtemp("/tmp/cityday-restart-"));
  try {
    const firstRepo = createMemoryRepository(config, { storagePath: `${directory}/state.json` });
    const firstApp = await createApp({ repository: firstRepo, config });
    let player; let city; let agent;
    try {
      ({ player, city, agent } = await openCity(firstRepo, firstApp));
      await resolveAndPublish(firstApp, firstRepo, { player, agent, city }, { turn: 1 });
      await json(firstApp, auth(player, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/city-day/report-dismissed`,
        payload: { report_turn: 1 }
      }), 200);
    } finally {
      await firstApp.close();
    }

    const secondRepo = createMemoryRepository(config, { storagePath: `${directory}/state.json` });
    const secondApp = await createApp({ repository: secondRepo, config });
    try {
      const day = await json(secondApp, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
      assert.equal(day.report.dismissed, true, "acknowledgement survives restart");
      assert.equal(day.report.ready, true);
    } finally {
      await secondApp.close();
    }
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(directory, { recursive: true, force: true }));
  }
});

test("a non-player Agent cannot dismiss the player's report", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    await resolveAndPublish(app, repository, { player, agent, city }, { turn: 1 });
    const response = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/city-day/report-dismissed`,
      payload: { report_turn: 1 }
    }));
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("selecting an immediate card completes the player action exactly once and the city waits in morning", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const cardId = nonSpecialCardId(offer, CARD_TYPES.policy);
    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-select-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId }
    }), 200);
    assert.equal(selected.status, "selected");

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "morning", "a completed choice with no Agent action waits in morning");
    assert.equal(day.card.choicePending, false);
    assert.equal(day.card.selectedCardId, cardId);
    assert.equal(day.agent.workStarted, false);
  } finally {
    await app.close();
  }
});

test("wall-clock elapsed alone and Agent presence alone never move morning to day", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-wait-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: nonSpecialCardId(offer, CARD_TYPES.policy) }
    }), 200);

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "morning");
    assert.equal(day.agent.workStarted, false);

    // The Agent is present (credential exists) but has performed no accepted
    // city-work command: presentation must stay morning.
    const dayFromAgent = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(dayFromAgent.phase, "morning");
    assert.equal(dayFromAgent.agent.workStarted, false);
  } finally {
    await app.close();
  }
});

test("first accepted meaningful Agent city work moves presentation to day", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-day-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: nonSpecialCardId(offer, CARD_TYPES.policy) }
    }), 200);

    // The Agent performs a real construction order.
    const sites = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/site-searches`, payload: { footprint: "1x1", limit: 10 } }), 200);
    const site = sites.data[0];
    const build = {
      expected_city_version: sites.city_version,
      site: { lot_id: site.lotId, footprint: "1x1", entrance: "south" },
      program: { archetype: "starter_residence", name: "Daylight House", purpose: "residential" },
      gameplay_building: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
      design: { district_style: "london_common", creative_brief: "A warm brick cottage." },
      asset: { mode: "reuse", asset_id: "starter-cottage-001" }
    };
    const order = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "cityday-build-1" },
      payload: build
    }), 201);
    assert.equal(order.status, "completed");
    const replay = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "cityday-build-1" },
      payload: build
    }), 201);
    assert.equal(replay.idempotent_replay, true, "canonical construction replay does not debit twice");

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.agent.workStarted, true, "the accepted construction is the start-of-work signal");
    assert.equal(day.phase, "day");
  } finally {
    await app.close();
  }
});

test("the incident/strategy phase moves presentation to night and elapsed time alone cannot", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "test/seed-cityday-night",
      idempotencyKey: "cityday-night-seed",
      requestBody: {},
      expectedVersion: 0
    }, async ({ state }) => {
      const cell = Object.values(state.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
      state.cells[cell.id].occupancy = "building-1";
      state.buildings["building-1"] = { id: "building-1", footprintCells: [cell.id], site: { lotId: cell.id, footprint: "1x1" }, program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.9, prominence: "important" } }, status: "completed", exposure: 70 };
      state.gameplay.arcaneOfficers = { [VESPER.id]: VESPER };
      state.gameplay.incidents = { "incident-1": { id: "incident-1", buildingId: "building-1", type: "investigation", attribute: "investigation", difficulty: 3, severity: 3, exposureAtCreation: 70, summary: "x", status: "open", createdAtTurn: 0 } };
      state.gameplay.turnStatus = "strategy";
      return { nextState: state, response: { seeded: true } };
    });

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.incident.phaseActive, true);
    assert.equal(day.phase, "night");
    assert.equal(day.agent.workStarted, false, "night is driven by the incident workflow, not by Agent building");
  } finally {
    await app.close();
  }
});

test("agentWorkStartedForTurn is driven by accepted agent events, not connection", () => {
  let state = { turn: 0, version: 0, events: [], gameplay: { turnOpenedAt: new Date().toISOString() } };
  assert.equal(agentWorkStartedForTurn(state), false, "no events means no work");
  pushAgentEvent(state, { type: "road_connected", actor: "agent:credential-9" });
  assert.equal(agentWorkStartedForTurn(state), true, "an accepted agent command is work");
  assert.equal(agentWorkStartedForTurn({ ...state, events: [] }), false);
});

test("daylight projection never mutates gameplay by itself", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const before = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(before.settled, false);
    const after = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(after.city_version, before.city_version, "re-reading the presentation projection changes nothing");
  } finally {
    await app.close();
  }
});

test("special structure selection supports player_place and delegate_to_agent for the same card", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const cardId = offer.offer.cards.find((card) => card.type === CARD_TYPES.special_structure).card_id;
    assert.ok(cardId);

    // Same card, two independent cities: both decision modes are accepted and
    // resolve the same underlying card (never two cards).
    for (const mode of ["player_place", "delegate_to_agent"]) {
      const { city: modeCity, player: modePlayer } = await openCity(repository, app);
      const modeOffer = await json(app, auth(modePlayer, { method: "GET", url: `/api/v1/cities/${modeCity.id}/cards/current` }), 200);
      const modeCardId = modeOffer.offer.cards.find((card) => card.type === CARD_TYPES.special_structure).card_id;
      const selected = await json(app, auth(modePlayer, {
        method: "POST",
        url: `/api/v1/cities/${modeCity.id}/cards/select`,
        headers: { "idempotency-key": `cityday-special-${mode}-${modeCity.id}` },
        payload: { expected_city_version: modeOffer.city_version, offer_id: modeOffer.offer.offer_id, selected_card_id: modeCardId, decision_mode: mode }
      }), 200);
      assert.equal(selected.status, "selected", `${mode} selection succeeds`);
      assert.equal(selected.choice.selected_card_id, modeCardId);
      assert.equal(selected.choice.decision_mode, mode);
    }
  } finally {
    await app.close();
  }
});

test("delegating special placement completes the player turn without opening placement mode", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const cardId = offer.offer.cards.find((card) => card.type === CARD_TYPES.special_structure).card_id;
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-delegate" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId, decision_mode: "delegate_to_agent" }
    }), 200);
    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.card.playerPlacementPending, false, "a delegated placement does not owe a player placement");
    assert.equal(day.phase, "morning", "delegation completes the player turn and waits for the Agent");
  } finally {
    await app.close();
  }
});

test("a player-owned pending placement keeps the player turn open until legally placed", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const cardId = offer.offer.cards.find((card) => card.type === CARD_TYPES.special_structure).card_id;
    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-place" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId, decision_mode: "player_place" }
    }), 200);

    const pending = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(pending.card.playerPlacementPending, true, "manual placement is still owed");
    assert.equal(pending.phase, "early_morning");

    const state = (await repository.getCity(owner, city.id)).state;
    const placementId = selected.choice.card_effects?.placement?.placement_id;
    const lot = findLegalLot(state, getCard(cardId).structure.footprint);
    assert.ok(lot, "a legal lot exists");
    const placed = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "cityday-place-lot" },
      payload: { expected_city_version: pending.city_version, card_id: cardId, placement_id: placementId, lot_id: lot, footprint: getCard(cardId).structure.footprint, entrance: "south" }
    }), 200);
    assert.equal(placed.status, "placed");

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.card.playerPlacementPending, false);
    assert.equal(day.phase, "morning", "successful manual placement completes the player portion");
  } finally {
    await app.close();
  }
});

test("an illegal manual placement is rejected without consuming the pending entitlement", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const cardId = offer.offer.cards.find((card) => card.type === CARD_TYPES.special_structure).card_id;
    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-illegal" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId, decision_mode: "player_place" }
    }), 200);

    const response = await app.inject(auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "cityday-illegal-lot" },
      payload: { expected_city_version: selected.city_version_after, card_id: cardId, placement_id: selected.choice.card_effects?.placement?.placement_id, lot_id: "cell-9999-9999", footprint: getCard(cardId).structure.footprint, entrance: "south" }
    }));
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().code, "PLACEMENT_ILLEGAL");

    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.card.playerPlacementPending, true, "the entitlement is preserved after a rejected placement");
  } finally {
    await app.close();
  }
});

test("reload during morning/day/night restores the same phase without a second card choice", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "cityday-reload" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: nonSpecialCardId(offer, CARD_TYPES.policy) }
    }), 200);

    const morning = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(morning.phase, "morning");
    assert.equal(morning.card.choicePending, false, "no duplicate card choice is offered");

    // First meaningful Agent work -> day; reload still restores day.
    const sites = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/site-searches`, payload: { footprint: "1x1", limit: 10 } }), 200);
    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "cityday-reload-build" },
      payload: {
        expected_city_version: sites.city_version,
        site: { lot_id: sites.data[0].lotId, footprint: "1x1", entrance: "south" },
        program: { archetype: "starter_residence", name: "Reload House", purpose: "residential" },
        gameplay_building: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
        design: { district_style: "london_common", creative_brief: "A brick cottage." },
        asset: { mode: "reuse", asset_id: "starter-cottage-001" }
      }
    }), 201);
    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "day");
    const dayAgain = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(dayAgain.phase, "day");
  } finally {
    await app.close();
  }
});

test("standard resolve settles exactly once and returns presentation to the next dawn", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    await resolveAndPublish(app, repository, { player, agent, city }, { turn: 1 });
    const day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.settled, true);
    assert.equal(day.phase, "dawn");
    assert.equal(day.report.turn, 1);
  } finally {
    await app.close();
  }
});

test("the domain derivation never fabricates a day from elapsed time alone", () => {
  const open = { turn: 0, version: 0, events: [], gameplay: { turnStatus: "open", turnOpenedAt: "2000-01-01T00:00:00.000Z" } };
  const now = new Date().toISOString();
  const farFuture = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const morning = deriveCityDayPresentation(open, { reportReady: false, reportDismissed: false, turnOpenedAt: now });
  assert.equal(morning.phase, "early_morning");
  const stillMorning = deriveCityDayPresentation(open, { reportReady: false, reportDismissed: false, turnOpenedAt: farFuture });
  assert.equal(stillMorning.phase, "early_morning", "a far-future deadline alone never advances the phase");
});

test("helper predicates reflect authoritative state only", () => {
  const pending = { gameplay: { cardState: { choice: { status: "pending" } } } };
  const selected = { gameplay: { cardState: { choice: { status: "selected" }, placements: { p1: { mode: "player_place", status: "pending" } } } } };
  const strategy = { gameplay: { turnStatus: "strategy" } };
  assert.equal(cardChoicePending(pending), true);
  assert.equal(cardChoicePending(selected), false);
  assert.equal(playerPlacementPending(selected), true);
  assert.equal(playerPlacementPending(pending), false);
  assert.equal(incidentPhaseActive(strategy), true);
  assert.equal(incidentPhaseActive({ gameplay: { turnStatus: "open" } }), false);
});

test("integration walk: report -> dismiss -> card -> morning -> agent work -> day -> resolve -> next dawn", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);

    // Day 0: choose a card, settle, publish report -> dawn with report ready.
    const offer0 = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "walk-select-0" },
      payload: { expected_city_version: offer0.city_version, offer_id: offer0.offer.offer_id, selected_card_id: nonSpecialCardId(offer0, CARD_TYPES.policy) }
    }), 200);
    await resolveAndPublish(app, repository, { player, agent, city }, { turn: 1 });

    let day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "dawn");
    assert.equal(day.report.ready, true);

    // Dismiss the report -> dawn waiting for the next unlock, not a card replay.
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/city-day/report-dismissed`,
      payload: { report_turn: 1 }
    }), 200);
    day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.report.dismissed, true);
    assert.equal(day.phase, "dawn");

    // Open next turn -> fresh card offer. Use real-now as the open moment so
    // subsequent Agent actions land inside this turn's activity window.
    const owner = await repository.authenticate(player.access_token);
    const state = (await repository.getCity(owner, city.id)).state;
    const unlocked = openNextTurn(state, new Date(Date.now() + 90 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
    const opened = openTurnCardState(unlocked, city.id, { turn: unlocked.turn });
    opened.gameplay.turnOpenedAt = new Date().toISOString();
    // The cooldown gate for this manually opened turn already elapsed so the
    // walk can resolve it through the real API in this same test run.
    opened.gameplay.nextTurnUnlockAt = new Date(Date.now() - 1000).toISOString();
    opened.gameplay.turnDeadlineAt = null;
    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "test/walk-open-next",
      idempotencyKey: "walk-open-next",
      requestBody: {},
      expectedVersion: state.version
    }, async () => ({ nextState: opened, response: { status: "opened" } }));

    const offer1 = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(offer1.choice.status, "pending");
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "walk-select-1" },
      payload: { expected_city_version: offer1.city_version, offer_id: offer1.offer.offer_id, selected_card_id: nonSpecialCardId(offer1, CARD_TYPES.policy) }
    }), 200);
    day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "morning");

    // Agent begins building -> day.
    const sites = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/site-searches`, payload: { footprint: "1x1", limit: 10 } }), 200);
    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "walk-build-1" },
      payload: {
        expected_city_version: sites.city_version,
        site: { lot_id: sites.data[0].lotId, footprint: "1x1", entrance: "south" },
        program: { archetype: "starter_residence", name: "Walk House", purpose: "residential" },
        gameplay_building: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
        design: { district_style: "london_common", creative_brief: "A brick cottage." },
        asset: { mode: "reuse", asset_id: "starter-cottage-001" }
      }
    }), 201);
    day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.phase, "day");

    // Resolve turn 1 -> next dawn with the new report ready.
    const secondSettled = await resolveAndPublish(app, repository, { player, agent, city }, { turn: 2 });
    const secondFactsTurn = secondSettled.settled.facts.turn;
    day = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/city-day` }), 200);
    assert.equal(day.settled, true);
    assert.equal(day.phase, "dawn");
    assert.equal(day.report.turn, secondFactsTurn);
    assert.equal(day.report.ready, true);
  } finally {
    await app.close();
  }
});

test("card offer and turn stay stable across construction/road/district mutations within one turn", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    const offerBefore = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(offerBefore.turn, 0);

    // Agent performs real city work: district + road + building. None of these
    // may advance the gameplay turn or re-roll the card offer.
    const district = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/districts`,
      headers: { "idempotency-key": "same-turn-district" },
      payload: { expected_city_version: offerBefore.city_version, name: "Same Turn Quarter", purpose: "residential", bounds: { minColumn: 2, maxColumn: 8, minRow: 2, maxRow: 8 } }
    }), 201);
    const sites = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/site-searches`, payload: { district_id: district.resource.district.id, footprint: "1x1", limit: 10 } }), 200);
    const site = sites.data[0];
    const build = {
      expected_city_version: sites.city_version,
      district_id: district.resource.district.id,
      site: { lot_id: site.lotId, footprint: "1x1", entrance: "south" },
      program: { archetype: "starter_residence", name: "Same Turn House", purpose: "residential" },
      gameplay_building: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
      design: { district_style: "london_common", creative_brief: "A brick cottage." },
      asset: { mode: "reuse", asset_id: "starter-cottage-001" }
    };
    const order = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "same-turn-build" },
      payload: build
    }), 201);
    assert.equal(order.status, "completed");

    const offerAfter = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(offerAfter.turn, 0, "the turn never advanced from city work");
    assert.equal(offerAfter.offer.offer_id, offerBefore.offer.offer_id, "the card offer still belongs to the same turn");
    assert.deepEqual(offerAfter.offer.cards.map((card) => card.card_id), offerBefore.offer.cards.map((card) => card.card_id));
  } finally {
    await app.close();
  }
});

test("construction APIs reject missing or invalid gameplay grammar without mutating city state", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    const sites = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/site-searches`,
      payload: { footprint: "1x1", limit: 10 }
    }), 200);
    const lotId = sites.data[0].lotId;
    const base = {
      expected_city_version: sites.city_version,
      site: { lot_id: lotId, footprint: "1x1", entrance: "south" },
      program: { archetype: "starter_residence", name: "Boundary House", purpose: "residential" },
      design: { district_style: "london_common", creative_brief: "A compact brick cottage." },
      asset: { mode: "reuse", asset_id: "starter-cottage-001" }
    };
    const invalidCases = [
      { label: "missing gameplay_building", code: "GAMEPLAY_BUILDING_REQUIRED", body: {} },
      { label: "non-discrete magic ratio", code: "INVALID_MAGIC_RATIO", body: { gameplay_building: { units: [{ purpose: "residential", area: 1, magicRatio: 0.63 }] } } },
      { label: "unknown purpose", code: "INVALID_GAMEPLAY_PURPOSE", body: { gameplay_building: { units: [{ purpose: "workshop", area: 1, magicRatio: 0 }] } } },
      { label: "non-positive area", code: "INVALID_GAMEPLAY_BUILDING", body: { gameplay_building: { units: [{ purpose: "residential", area: 0, magicRatio: 0 }] } } }
    ];
    for (const [index, scenario] of invalidCases.entries()) {
      const before = await repository.getCity(owner, city.id);
      const body = { ...base, ...scenario.body, expected_city_version: before.state.version };
      const preview = await json(app, auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/construction-previews`,
        payload: body
      }), 200);
      assert.equal(preview.feasible, false, scenario.label);
      assert.equal(preview.code, scenario.code, scenario.label);
      assert.deepEqual(preview.resourcesAfter, before.state.resources, scenario.label);

      const order = await json(app, auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/construction-orders`,
        headers: { "idempotency-key": `invalid-gameplay-${index}` },
        payload: body
      }), 422);
      assert.equal(order.status, "rejected", scenario.label);
      assert.equal(order.code, scenario.code, scenario.label);
      const after = await repository.getCity(owner, city.id);
      assert.equal(after.state.version, before.state.version, `${scenario.label} does not advance city version`);
      assert.deepEqual(after.state.resources, before.state.resources, `${scenario.label} does not debit resources`);
      assert.deepEqual(after.state.reservations, before.state.reservations, `${scenario.label} does not create a reservation`);
    }
  } finally {
    await app.close();
  }
});

test("construction preview derives pricing from submitted floor grammar, never forged pricing facts", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    const sites = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/site-searches`,
      payload: { footprint: "1x1", limit: 10 }
    }), 200);
    const before = await repository.getCity(owner, city.id);
    const preview = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-previews`,
      payload: {
        expected_city_version: before.state.version,
        site: { lot_id: sites.data[0].lotId, footprint: "1x1", entrance: "south" },
        program: { archetype: "starter_residence", name: "Two Floor House", purpose: "residential" },
        gameplay_building: {
          canonical: true,
          floorSpecs: [{ purpose: "residential", magicRatio: 0 }, { purpose: "residential", magicRatio: 0 }],
          pricingFacts: { sourceKind: "units", floorCount: null }
        },
        design: { district_style: "london_common", creative_brief: "A two-storey brick cottage." },
        asset: { mode: "reuse", asset_id: "starter-cottage-001" }
      }
    }), 200);
    assert.equal(preview.feasible, true);
    assert.equal(preview.buildingCost.coins, 105, "real floor grammar retains the two-floor multiplier");
    const after = await repository.getCity(owner, city.id);
    assert.equal(after.state.version, before.state.version, "preview remains read-only");
    assert.deepEqual(after.state.resources, before.state.resources);
  } finally {
    await app.close();
  }
});

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
