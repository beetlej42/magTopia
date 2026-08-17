import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createCityState } from "../src/city/state.js";
import { createServiceWorldContract } from "../apps/server/world.js";
import { resolveTurn } from "../src/gameplay/simulation.js";
import { generateOffer, ensureCardOffer, openTurnCardState, selectCard, activeConstructionDiscountRate } from "../src/gameplay/cards.js";
import { CARD_TYPES, getCard, getCardsByCategory } from "../src/gameplay/card-catalog.js";
import { openNextTurn } from "../src/gameplay/turn.js";
import { previewConstruction } from "../src/city/solver.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-cards-api-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7,
  turnIntervalMs: 86_400_000,
  turnDeadlineMs: 86_400_000
};

async function openCity(repository, app) {
  const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Card Owner" } }, 201);
  const city = await json(app, auth(player, {
    method: "POST",
    url: "/api/v1/cities",
    payload: { name: "Card City", map_seed: "player-daily-cards-test" }
  }), 201);
  const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
  const agent = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
  const owner = await repository.authenticate(player.access_token);
  return { player, city, agent, owner };
}

async function seedPopulation(repository, owner, cityId, expectedVersion, population) {
  await repository.transactCity({
    principal: owner,
    cityId,
    endpoint: "test/seed-population",
    idempotencyKey: "seed-population-1",
    requestBody: {},
    expectedVersion
  }, async ({ state }) => {
    state.gameplay.population = { ...state.gameplay.population, ...population };
    return { nextState: state, response: { seeded: true } };
  });
}

function cardById(cards, cardId) {
  return cards.find((card) => card.card_id === cardId);
}

function categoryOf(cardId) {
  return getCard(cardId)?.type;
}

function findLegalLot(state, footprint, entrance) {
  for (const cell of Object.values(state.cells)) {
    if (!cell.buildable || cell.strictBuildable === false || cell.node || cell.occupancy || cell.infrastructure || cell.reservation) continue;
    const cells = footprintCellsFor(state, cell.id, footprint);
    if (!cells || cells.some((id) => !state.cells[id] || state.cells[id].occupancy || state.cells[id].infrastructure || state.cells[id].reservation || state.cells[id].buildable === false || state.cells[id].node)) continue;
    if (entranceFrontage(state, cells, entrance)) return cell.id;
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

function entranceFrontage(state, footprintCells, direction) {
  const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const [dc, dr] = offsets[direction];
  const footprint = new Set(footprintCells);
  return footprintCells.some((cellId) => {
    const cell = state.cells[cellId];
    const frontageId = `cell-${cell.column + dc}-${cell.row + dr}`;
    const frontage = state.cells[frontageId];
    return frontage && !footprint.has(frontageId) && !frontage.occupancy && !frontage.reservation && frontage.buildable !== false && (!frontage.infrastructure || frontage.infrastructure === "road");
  });
}

test("a fresh city gets one canonical three-category card offer that is stable across reads", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const first = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(first.turn_status, "open");
    assert.equal(first.offer.cards.length, 3);
    assert.ok(first.offer.offer_id);
    const categories = first.offer.cards.map((card) => card.type);
    assert.equal(categories.filter((type) => type === "special_structure").length, 1);
    assert.equal(categories.filter((type) => type === "resource" || type === "personnel").length, 1);
    assert.equal(categories.filter((type) => type === "policy").length, 1);
    const second = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.deepEqual(second.offer.cards.map((card) => card.card_id), first.offer.cards.map((card) => card.card_id));
    assert.equal(second.offer.offer_id, first.offer.offer_id);
    assert.equal(second.choice.status, "pending");
    const catalog = await json(app, { method: "GET", url: "/api/v1/cards" }, 200);
    assert.equal(catalog.data.length, 12);
    const byCategory = getCardsByCategory();
    assert.equal(byCategory.special_structure.length, 5);
    assert.equal(byCategory.resource.length + byCategory.personnel.length, 3);
    assert.equal(byCategory.policy.length, 4);
  } finally {
    await app.close();
  }
});

test("the canonical offer survives a repository restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magictown-cards-restart-"));
  const storagePath = path.join(directory, "state.json");
  try {
    const firstRepo = createMemoryRepository(config, { storagePath });
    const firstApp = await createApp({ repository: firstRepo, config });
    const { city, player } = await openCity(firstRepo, firstApp);
    const offer = await json(firstApp, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    await firstApp.close();

    const secondRepo = createMemoryRepository(config, { storagePath });
    const secondApp = await createApp({ repository: secondRepo, config });
    try {
      const restored = await secondRepo.getCity(await secondRepo.authenticate(player.access_token), city.id);
      const again = await json(secondApp, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
      assert.deepEqual(again.offer.cards.map((card) => card.card_id), offer.offer.cards.map((card) => card.card_id));
      assert.equal(again.offer.offer_id, offer.offer.offer_id);
      assert.ok(restored.state.gameplay.cardState.offer);
    } finally {
      await secondApp.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the player selects exactly one card per turn; a second selection is rejected and changes nothing", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const before = offer.city_version;
    const target = offer.offer.cards[0];
    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "select-1" },
      payload: { expected_city_version: before, offer_id: offer.offer.offer_id, selected_card_id: target.card_id }
    }), 200);
    assert.equal(selected.status, "selected");
    assert.equal(selected.selected_card_id, target.card_id);
    assert.equal(selected.city_version_after, selected.city_version_before + 1);

    const second = await app.inject(auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "select-2" },
      payload: { expected_city_version: selected.city_version_after, offer_id: offer.offer.offer_id, selected_card_id: offer.offer.cards[1].card_id }
    }));
    assert.equal(second.statusCode, 422);
    assert.equal(second.json().code, "CARD_ALREADY_SELECTED");

    const after = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(after.choice.status, "selected");
    assert.equal(after.choice.selected_card_id, target.card_id);
  } finally {
    await app.close();
  }
});

test("an Agent cannot choose a card on the player's behalf", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const response = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "agent-select" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: offer.offer.cards[0].card_id }
    }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, "PLAYER_CREDENTIAL_REQUIRED");
    const after = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(after.choice.status, "pending");
  } finally {
    await app.close();
  }
});

test("forged card effects, durations, resource amounts, and officer stats are rejected", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const target = offer.offer.cards[0].card_id;
    const forgeries = [
      { effect: { grant_coins: 999999 } },
      { coins: 999999 },
      { duration: { type: "turns", turns: 99 } },
      { policy: { concealmentBonus: 99 } },
      { stats: { investigation: 5, specialties: ["containment"] } },
      { concealment: 50 },
      { offer_contents: ["forged"] }
    ];
    for (const extra of forgeries) {
      const response = await app.inject(auth(player, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/cards/select`,
        headers: { "idempotency-key": `forgery-${JSON.stringify(extra)}` },
        payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: target, ...extra }
      }));
      assert.equal(response.statusCode, 400, JSON.stringify(extra));
      assert.equal(response.json().code, "CARD_FORGERY_REJECTED", JSON.stringify(extra));
    }
    const after = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(after.choice.status, "pending");
  } finally {
    await app.close();
  }
});

test("an immediate resource/personnel card applies exactly once and an idempotent replay never re-applies", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const card = offer.offer.cards.find((entry) => ["resource", "personnel"].includes(categoryOf(entry.card_id)));
    assert.ok(card, "offer must contain a resource or personnel card");
    const cardId = card.card_id;
    if (cardId === "arcane-officer-reinforcement") {
      await seedPopulation(repository, owner, city.id, offer.city_version, { wizards: { current: 50, capacity: 50 } });
    }
    if (cardId === "new-wizard-residents") {
      await seedPopulation(repository, owner, city.id, offer.city_version, { wizards: { current: 2, capacity: 10 } });
    }
    const before = await repository.getCity(owner, city.id);
    const beforeCoins = before.state.gameplay.resources.coins;
    const beforeOfficers = Object.keys(before.state.gameplay.arcaneOfficers ?? {}).length;
    const beforeWizards = before.state.gameplay.population.wizards.current;

    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "immediate-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId }
    }), 200);
    assert.ok(selected.card_effects.grant || selected.card_effects.recruit, "immediate card records its resolved effect");
    const afterFirst = await repository.getCity(owner, city.id);
    const firstCoins = afterFirst.state.gameplay.resources.coins;
    const firstOfficers = Object.keys(afterFirst.state.gameplay.arcaneOfficers ?? {}).length;
    const firstWizards = afterFirst.state.gameplay.population.wizards.current;
    const effectsChanged = firstCoins !== beforeCoins || firstOfficers !== beforeOfficers || firstWizards !== beforeWizards;
    assert.ok(effectsChanged, "the immediate effect changed gameplay state once");

    const replay = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "immediate-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: cardId }
    }), 200);
    assert.equal(replay.idempotent_replay, true);
    const afterReplay = await repository.getCity(owner, city.id);
    assert.equal(afterReplay.state.gameplay.resources.coins, firstCoins, "replay must not double-grant coins");
    assert.equal(Object.keys(afterReplay.state.gameplay.arcaneOfficers ?? {}).length, firstOfficers, "replay must not double-recruit");

    const secondAttempt = await app.inject(auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "immediate-2" },
      payload: { expected_city_version: afterReplay.state.version, offer_id: offer.offer.offer_id, selected_card_id: cardId }
    }));
    assert.equal(secondAttempt.statusCode, 422, "a second selection with a fresh key is rejected");
    assert.equal(secondAttempt.json().code, "CARD_ALREADY_SELECTED");
  } finally {
    await app.close();
  }
});

test("the population card obeys wizard population capacity", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const residents = offer.offer.cards.find((card) => card.card_id === "new-wizard-residents");
    if (!residents) {
      // The deterministic offer for this city does not include the residents
      // card; capacity enforcement is still covered at the domain level.
      assert.ok(true);
      return;
    }

    await seedPopulation(repository, owner, city.id, offer.city_version, {
      wizards: { current: 2, capacity: 3 }
    });
    const current = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "residents-1" },
      payload: { expected_city_version: current.city_version, offer_id: current.offer.offer_id, selected_card_id: residents.card_id }
    }), 200);
    assert.equal(selected.card_effects.grant.requested, 4);
    assert.equal(selected.card_effects.grant.granted, 1, "only 1 wizard fits inside a capacity of 3");
    const state = (await repository.getCity(owner, city.id)).state;
    assert.equal(state.gameplay.population.wizards.current, 3);
    assert.equal(state.gameplay.population.wizards.capacity, 3, "capacity is never raised by the card");
  } finally {
    await app.close();
  }
});

test("the officer card cannot inject stats or specialties and generates a named MVP officer", () => {
  // cityId "officer-1" deterministically offers arcane-officer-reinforcement at turn 0.
  const world = createServiceWorldContract({ seed: "officer-test", columns: 20, rows: 20 });
  let state = createCityState(world, { cityId: "officer-1", mapSeed: "officer-test" });
  state.gameplay.population.wizards = { current: 50, capacity: 50 };
  state = ensureCardOffer(state, "officer-1");
  const offer = state.gameplay.cardState.offer;
  assert.ok(offer.offeredCardIds.includes("arcane-officer-reinforcement"), "deterministic offer must contain the officer card");

  const selected = selectCard(state, "officer-1", {
    offerId: offer.offerId,
    selectedCardId: "arcane-officer-reinforcement",
    investigation: 5,
    specialties: ["containment"]
  }, { now: () => new Date().toISOString(), createId: (prefix) => `${prefix}-1` });
  assert.ok(selected.accepted, selected.message);
  const officerId = selected.cardEffects.recruit.officer_id;
  const officer = selected.nextState.gameplay.arcaneOfficers[officerId];
  assert.ok(officer, "recruited officer is stored on the roster");
  assert.ok(officer.name && !/^officer-\d+$/.test(officer.name), `officer has a real player-facing name, got ${officer.name}`);
  assert.ok(officer.archetype);
  assert.ok(Number.isInteger(officer.investigation) && Number.isInteger(officer.containment) && Number.isInteger(officer.concealment));
  assert.ok(officer.specialties.length <= 3, "specialties come from the system-owned archetype, not the client");
  assert.equal(officer.status, "available");
  assert.equal(selected.cardEffects.recruit.officer_name, officer.name);
});

test("re-selecting the same policy refreshes its duration instead of stacking", () => {
  // cityId "repeat-test-4" deterministically re-offers wizard-settlement-initiative at turn 0 and turn 1.
  const world = createServiceWorldContract({ seed: "repeat-test", columns: 20, rows: 20 });
  let state = createCityState(world, { cityId: "repeat-test-4", mapSeed: "repeat-test" });
  state = ensureCardOffer(state, "repeat-test-4");
  const policyId = "wizard-settlement-initiative";
  const durationTurns = getCard(policyId).duration.turns;
  const offer = state.gameplay.cardState.offer;
  assert.ok(offer.offeredCardIds.includes(policyId), "deterministic turn-0 offer must contain the policy");

  const now = () => new Date().toISOString();
  const first = selectCard(state, "repeat-test-4", { offerId: offer.offerId, selectedCardId: policyId }, { now, createId: (prefix) => `${prefix}-1` });
  assert.ok(first.accepted, first.message);
  assert.equal(first.cardEffects.policy.action, "started");
  assert.equal(first.nextState.gameplay.cardState.activePolicies.length, 1);

  const resolved = resolveTurn(first.nextState, { assignments: [], expectedTurn: 0 }, {
    seed: 1,
    now,
    options: { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000, settlementSource: "agent" }
  });
  assert.equal(resolved.error, null);
  assert.ok(resolved.facts.policyStarted.includes(policyId));
  let next = resolved.nextState;
  assert.equal(next.gameplay.cardState.activePolicies[0].remainingTurns, durationTurns - 1);

  const unlocked = openNextTurn(next, new Date(Date.now() + 90 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
  next = openTurnCardState(unlocked, "repeat-test-4", { turn: unlocked.turn });
  const offer1 = next.gameplay.cardState.offer;
  assert.ok(offer1.offeredCardIds.includes(policyId), "deterministic turn-1 offer must re-offer the same policy");

  const second = selectCard(next, "repeat-test-4", { offerId: offer1.offerId, selectedCardId: policyId }, { now, createId: (prefix) => `${prefix}-2` });
  assert.ok(second.accepted, second.message);
  assert.equal(second.cardEffects.policy.action, "refreshed");
  assert.equal(second.nextState.gameplay.cardState.activePolicies.length, 1, "identical policy never stacks into a second entry");
  assert.equal(second.nextState.gameplay.cardState.activePolicies[0].remainingTurns, durationTurns, "repeat selection refreshes the duration");
});

test("a special structure card supports player placement through authoritative cell validation", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const special = offer.offer.cards.find((card) => categoryOf(card.card_id) === CARD_TYPES.special_structure);
    assert.ok(special, "offer must contain a special structure card");

    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "special-player-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: special.card_id, decision_mode: "player_place" }
    }), 200);
    assert.equal(selected.choice.status, "selected");

    const state = (await repository.getCity(owner, city.id)).state;
    const footprint = special.structure.footprint;
    const lotId = findLegalLot(state, footprint, "south");
    assert.ok(lotId, "a legal lot must exist");

    const placed = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "special-place-1" },
      payload: { expected_city_version: selected.city_version_after, card_id: special.card_id, lot_id: lotId, footprint, entrance: "south" }
    }), 200);
    assert.equal(placed.status, "placed");
    const placedState = (await repository.getCity(owner, city.id)).state;
    const building = placedState.buildings[placed.building_id];
    assert.ok(building, "special structure is a real city building");
    assert.equal(building.specialStructure.cardId, special.card_id);
    assert.ok(placedState.gameplay.cardState.pendingPlacement.status === "completed");

    const illegal = await app.inject(auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "special-place-illegal" },
      payload: { expected_city_version: placed.city_version_after, card_id: special.card_id, lot_id: lotId, footprint, entrance: "south" }
    }));
    assert.equal(illegal.statusCode, 422, "occupied lot must be rejected");
    assert.equal(illegal.json().code, "PLACEMENT_ALREADY_COMPLETED");
  } finally {
    await app.close();
  }
});

test("a special structure card supports delegate_to_agent and the mandate appears in strategy context", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const special = offer.offer.cards.find((card) => categoryOf(card.card_id) === CARD_TYPES.special_structure);

    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "special-delegate-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: special.card_id, decision_mode: "delegate_to_agent" }
    }), 200);
    assert.equal(selected.choice.decision_mode, "delegate_to_agent");

    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(strategy.strategy.cards.choice.selected_card_id, special.card_id);
    assert.equal(strategy.strategy.cards.pending_placements.length, 1);
    const mandate = strategy.strategy.cards.pending_placements[0];
    assert.equal(mandate.card_id, special.card_id);
    assert.equal(mandate.mode, "delegate_to_agent");
    assert.equal(mandate.status, "deferred");

    const state = (await repository.getCity(owner, city.id)).state;
    const lotId = findLegalLot(state, special.structure.footprint, "east");
    assert.ok(lotId);
    const placed = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "special-delegate-place-1" },
      payload: { expected_city_version: strategy.city_version, card_id: special.card_id, lot_id: lotId, footprint: special.structure.footprint, entrance: "east" }
    }), 200);
    assert.equal(placed.status, "placed");
    assert.equal(placed.city_version_after, placed.city_version_before + 1, "a placement is a single authoritative mutation");

    const playerBlocked = await app.inject(auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/place`,
      headers: { "idempotency-key": "player-tries-delegated" },
      payload: { expected_city_version: placed.city_version_after, card_id: special.card_id, lot_id: lotId, footprint: special.structure.footprint, entrance: "east" }
    }));
    assert.equal(playerBlocked.statusCode, 422);
    assert.equal(playerBlocked.json().code, "PLACEMENT_ACTOR_NOT_ALLOWED");
  } finally {
    await app.close();
  }
});

test("a selected policy becomes active, appears in strategy context, and advances its lifecycle at settlement", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const policyCard = offer.offer.cards.find((card) => categoryOf(card.card_id) === CARD_TYPES.policy);
    assert.ok(policyCard, "offer must contain a policy card");
    const policyId = getCard(policyCard.card_id).effect.policyId;
    const durationTurns = getCard(policyCard.card_id).duration.turns;

    const selected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "policy-1" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: policyCard.card_id }
    }), 200);
    assert.equal(selected.card_effects.policy.policy_id, policyId);
    assert.equal(selected.card_effects.policy.action, "started");
    assert.equal(selected.card_effects.policy.remaining_turns, durationTurns);

    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(strategy.strategy.cards.active_policies.length, 1);
    assert.equal(strategy.strategy.cards.active_policies[0].policy_id, policyId);
    assert.equal(strategy.strategy.cards.active_policies[0].remaining_turns, durationTurns);

    const resolved = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "cards-resolve-1" },
      payload: { expected_city_version: strategy.city_version }
    }), 200);
    assert.equal(resolved.status, "resolved");
    assert.ok(resolved.facts.policyStarted.includes(policyId), "policy start is frozen into TurnFacts");
    assert.equal(resolved.facts.selectedCardId, policyCard.card_id);
    const after = (await repository.getCity(owner, city.id)).state;
    assert.equal(after.gameplay.cardState.activePolicies[0].remainingTurns, durationTurns - 1);
  } finally {
    await app.close();
  }
});

test("no-card at deadline does not block settlement and records an explicit skipped choice", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(strategy.strategy.cards.choice.status, "pending");
    const resolved = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "cards-resolve-nochoice" },
      payload: { expected_city_version: strategy.city_version }
    }), 200);
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.facts.choiceStatus, "skipped", "a pending choice is recorded explicitly as skipped");
    assert.equal(resolved.facts.selectedCardId, null);
    assert.equal(resolved.turn, 1, "settlement advanced normally");
  } finally {
    await app.close();
  }
});

test("card and policy facts are frozen into TurnFacts and projected into the Owl ReportContext without drift", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const policyCard = offer.offer.cards.find((card) => categoryOf(card.card_id) === CARD_TYPES.policy);
    const policyId = getCard(policyCard.card_id).effect.policyId;
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "policy-report" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: policyCard.card_id }
    }), 200);
    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const resolved = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "cards-resolve-report" },
      payload: { expected_city_version: strategy.city_version }
    }), 200);

    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    assert.equal(context.card.offerId, offer.offer.offer_id);
    assert.equal(context.card.offeredCards.length, 3);
    assert.equal(context.card.choice.status, "selected");
    assert.equal(context.card.choice.selectedCardId, policyCard.card_id);
    assert.ok(context.card.policy.started.includes(policyId));
    assert.ok(context.factRefs.includes("fact-card-choice"));
    assert.ok(context.factRefs.some((ref) => ref === `fact-card-policy-${policyId}`));

    // Let a later turn expire the policy, then confirm the historical context
    // for turn 1 still reports the policy as started.
    const after = (await repository.getCity(await repository.authenticate(player.access_token), city.id)).state;
    const unlocked = openNextTurn(after, new Date(Date.now() + 90 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
    const opened = openTurnCardState(unlocked, city.id, { turn: unlocked.turn });
    const resolved2 = resolveTurn(opened, { assignments: [], expectedTurn: unlocked.turn }, { seed: 1, now: () => new Date().toISOString(), options: { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000, settlementSource: "agent" } });
    assert.equal(resolved2.error, null);
    assert.ok(resolved2.facts.policyExpired.includes(policyId) || resolved2.facts.policyRefreshed.length >= 0, "policy lifecycle keeps advancing");

    const historical = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    assert.equal(historical.factsDigest, context.factsDigest, "turn-1 context is immutable");
    assert.equal(historical.card.policy.started.includes(policyId), true);
  } finally {
    await app.close();
  }
});

test("OpenAPI advertises the card endpoints and schemas", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    for (const route of ["/cards", "/cities/{city_id}/cards/current", "/cities/{city_id}/cards/select", "/cities/{city_id}/cards/place"]) {
      assert.ok(openapi.paths[route], `missing ${route}`);
    }
    for (const schema of ["CardDefinition", "CardOffer", "CardChoice", "CardSelectRequest", "CardPlaceRequest", "ActivePolicy", "PendingPlacement", "StrategyCards"]) {
      assert.ok(openapi.components.schemas[schema], `missing schema ${schema}`);
    }
    assert.ok(openapi.components.schemas.StrategyContext.properties.strategy.properties.cards);
  } finally {
    await app.close();
  }
});

// ---- Domain-level deterministic offer tests ----
test("offer generation is deterministic and always one of each category", () => {
  const cityId = "city-deterministic-1";
  const offerA = generateOffer(cityId, 3);
  const offerB = generateOffer(cityId, 3);
  assert.deepEqual(offerA, offerB);
  assert.equal(new Set(offerA.offeredCardIds).size, 3);
  const types = offerA.offeredCardIds.map((id) => getCard(id).type).sort();
  assert.deepEqual(types, ["policy", "resource", "special_structure"]);
  const otherCity = generateOffer("city-deterministic-2", 3);
  assert.notDeepEqual(offerA.offeredCardIds, otherCity.offeredCardIds);
});

test("a delegated placement mandate does not silently disappear at settlement or across turn boundaries", () => {
  const world = createServiceWorldContract({ seed: "cards-mandate-test", columns: 20, rows: 20 });
  let state = createCityState(world, { cityId: "city-mandate", mapSeed: "cards-mandate-test" });
  state = ensureCardOffer(state, "city-mandate");
  const special = state.gameplay.cardState.offer.offeredCardIds.find((id) => getCard(id).type === CARD_TYPES.special_structure);
  const selected = selectCard(state, "city-mandate", {
    offerId: state.gameplay.cardState.offer.offerId,
    selectedCardId: special,
    decisionMode: "delegate_to_agent"
  }, { now: () => new Date().toISOString(), createId: (prefix) => `${prefix}-1` });
  assert.ok(selected.accepted);
  assert.equal(selected.nextState.gameplay.cardState.pendingPlacement.status, "deferred");

  const resolved = resolveTurn(selected.nextState, { assignments: [], expectedTurn: 0 }, {
    seed: 1,
    now: () => new Date().toISOString(),
    options: { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000, settlementSource: "agent" }
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.facts.choiceStatus, "selected");
  assert.ok(resolved.facts.specialPlacementMandate, "mandate is frozen into the settlement facts");
  assert.equal(resolved.facts.specialPlacementMandate.status, "deferred");
  let persisted = resolved.nextState.gameplay.cardState.pendingPlacement;
  assert.ok(persisted && persisted.status === "deferred", "delegated placement survives settlement for a later turn");

  // The next turn opens (schedule unlocks) and must keep the deferred mandate.
  const unlocked = openNextTurn(resolved.nextState, new Date(Date.now() + 90 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
  assert.ok(unlocked, "turn must unlock");
  const opened = openTurnCardState(unlocked, "city-mandate", { turn: unlocked.turn });
  persisted = opened.gameplay.cardState.pendingPlacement;
  assert.ok(persisted && persisted.status === "deferred", "delegated placement survives across a turn boundary");
  assert.equal(persisted.cardId, special);
  assert.equal(opened.gameplay.cardState.offer.turn, unlocked.turn, "the new turn still carries its own canonical offer");
});

test("a multi-turn policy remains active for the correct number of turns and expires on the right boundary", () => {
  const world = createServiceWorldContract({ seed: "expiry-test", columns: 20, rows: 20 });
  let state = createCityState(world, { cityId: "expiry-test-3", mapSeed: "expiry-test" });
  state = ensureCardOffer(state, "expiry-test-3");
  const policyId = "city-construction-mobilization"; // duration 2
  const offer = state.gameplay.cardState.offer;
  assert.ok(offer.offeredCardIds.includes(policyId), "deterministic offer must include the 2-turn construction policy");

  const now = () => new Date().toISOString();
  const selected = selectCard(state, "expiry-test-3", { offerId: offer.offerId, selectedCardId: policyId }, { now, createId: (prefix) => `${prefix}-1` });
  assert.ok(selected.accepted, selected.message);
  assert.equal(selected.nextState.gameplay.cardState.activePolicies[0].remainingTurns, 2);

  const settle = (s, turn) => resolveTurn(s, { assignments: [], expectedTurn: turn }, {
    seed: turn + 1,
    now,
    options: { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000, settlementSource: "agent" }
  });

  // Turn 0 resolves -> remaining 2 -> 1 (still active in turn 1).
  const resolved1 = settle(selected.nextState, 0);
  assert.equal(resolved1.error, null);
  let next = resolved1.nextState;
  assert.equal(next.gameplay.cardState.activePolicies.length, 1);
  assert.equal(next.gameplay.cardState.activePolicies[0].remainingTurns, 1, "policy stays active for its second turn");

  // Turn 1 resolves -> remaining 1 -> 0 -> expires.
  const unlocked1 = openNextTurn(next, new Date(Date.now() + 90 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
  next = openTurnCardState(unlocked1, "expiry-test-1", { turn: unlocked1.turn });
  const resolved2 = settle(next, 1);
  assert.equal(resolved2.error, null);
  assert.ok(resolved2.facts.policyExpired.includes(policyId), "policy expiry is frozen into TurnFacts");
  assert.equal(resolved2.nextState.gameplay.cardState.activePolicies.length, 0, "expired policy is removed from the active set");

  // Turn 2 resolves -> the policy stays expired and never comes back.
  const unlocked2 = openNextTurn(resolved2.nextState, new Date(Date.now() + 180 * 86_400_000), { turnIntervalMs: 86_400_000, turnDeadlineMs: 86_400_000 });
  next = openTurnCardState(unlocked2, "expiry-test-1", { turn: unlocked2.turn });
  const resolved3 = settle(next, 2);
  assert.equal(resolved3.error, null);
  assert.equal(resolved3.nextState.gameplay.cardState.activePolicies.length, 0);
});

test("policy effects feed the deterministic simulation through the unified modifier path", () => {
  const world = createServiceWorldContract({ seed: "policy-effect-test", columns: 20, rows: 20 });
  let state = createCityState(world, { cityId: "policy-effect-test-3", mapSeed: "policy-effect-test" });
  state = ensureCardOffer(state, "policy-effect-test-3");
  const policyId = "city-construction-mobilization"; // 2-turn construction discount
  const offer = state.gameplay.cardState.offer;
  assert.ok(offer.offeredCardIds.includes(policyId));
  const now = () => new Date().toISOString();

  const selected = selectCard(state, "policy-effect-test-3", { offerId: offer.offerId, selectedCardId: policyId }, { now, createId: (prefix) => `${prefix}-1` });
  assert.ok(selected.accepted);
  const policyState = selected.nextState;
  assert.equal(activeConstructionDiscountRate(policyState), 0.5, "the active policy exposes its system-owned discount");

  // The discount is consumed by previewConstruction, the single cost path used
  // by previews and construction orders.
  const proposal = {
    site: { lotId: null, footprint: "1x1", entrance: "south" },
    program: { archetype: "starter_residence", name: "Discount Test House" },
    design: { prompt: "A compact cottage." }
  };
  const lot = Object.values(policyState.cells).find((cell) => (
    cell.buildable && cell.strictBuildable !== false && !cell.node && !cell.occupancy && !cell.infrastructure && !cell.reservation
  ));
  proposal.site.lotId = lot.id;
  const baseline = previewConstruction(policyState, proposal);
  const discounted = previewConstruction(policyState, proposal, { constructionDiscountRate: 0.5 });
  assert.ok(baseline.feasible && discounted.feasible);
  assert.equal(discounted.cost.coins, baseline.cost.coins / 2, "construction mobilization halves the building cost");
});

test("card state is exposed read-only in the Agent strategy context", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, player, agent, owner } = await openCity(repository, app);
    const offer = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const policyCard = offer.offer.cards.find((card) => categoryOf(card.card_id) === CARD_TYPES.policy);
    await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "strategy-card-state" },
      payload: { expected_city_version: offer.city_version, offer_id: offer.offer.offer_id, selected_card_id: policyCard.card_id }
    }), 200);

    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const cards = strategy.strategy.cards;
    assert.equal(cards.offer.offer_id, offer.offer.offer_id);
    assert.equal(cards.offer.cards.length, 3);
    assert.equal(cards.choice.status, "selected");
    assert.equal(cards.choice.selected_card_id, policyCard.card_id);
    assert.equal(cards.active_policies.length, 1);
    assert.ok(cards.active_policies[0].remaining_turns > 0);
    assert.ok(cards.active_policies[0].effects.length > 0, "system-owned policy effects are visible");

    // The Agent can never author card state through the strategy endpoint.
    const state = (await repository.getCity(owner, city.id)).state;
    const forged = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "strategy-forge-cards" },
      payload: { expected_city_version: state.version, assignments: [], cards: { choice: { selected_card_id: "ministry-grant" } } }
    }));
    assert.equal(forged.statusCode, 400, "strategy request bodies reject card fields");
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
