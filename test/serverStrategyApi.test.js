import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { gradeRoll } from "../src/gameplay/simulation.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-strategy-api-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7
};

const VESPER = { id: "officer-vesper", name: "Vesper", archetype: "investigation", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 };
const MILO = { id: "officer-milo", name: "Milo", archetype: "trainee", investigation: 1, containment: 1, concealment: 1, specialties: [], status: "available", hiredAtTurn: 0 };

function openIncident(overrides = {}) {
  return {
    id: "incident-1",
    buildingId: "building-1",
    type: "investigation",
    attribute: "investigation",
    difficulty: 3,
    severity: 3,
    exposureAtCreation: 70,
    summary: "Unresolved magical anomaly reported near Lantern Tower; origin requires investigation.",
    status: "open",
    createdAtTurn: 0,
    ...overrides
  };
}

async function openCity(repository, app) {
  const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Strategy Owner" } }, 201);
  const city = await json(app, auth(player, {
    method: "POST",
    url: "/api/v1/cities",
    payload: { name: "Strategy City", map_seed: "strategy-api-test" }
  }), 201);
  const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
  const agent = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
  const owner = await repository.authenticate(player.access_token);
  return { player, city, agent, owner };
}

async function seedState(repository, owner, cityId, expectedVersion, { officers = { [VESPER.id]: VESPER, [MILO.id]: MILO }, incidents = { "incident-1": openIncident() } } = {}) {
  await repository.transactCity({
    principal: owner,
    cityId,
    endpoint: "test/seed-strategy",
    idempotencyKey: "seed-strategy-1",
    requestBody: {},
    expectedVersion
  }, async ({ state }) => {
    const cell = Object.values(state.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
    state.cells[cell.id].occupancy = "building-1";
    state.buildings["building-1"] = {
      id: "building-1",
      footprintCells: [cell.id],
      site: { lotId: cell.id, footprint: "1x1" },
      program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.9, prominence: "important" } },
      status: "completed",
      exposure: 70
    };
    state.gameplay.arcaneOfficers = structuredClone(officers);
    state.gameplay.incidents = structuredClone(incidents);
    state.gameplay.turnStatus = "strategy";
    return { nextState: state, response: { seeded: true } };
  });
}

test("an Agent completes the closed loop: read incidents, dispatch an officer, settle, read results", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);

    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.turn, 0);
    assert.equal(before.turn_status, "strategy");
    assert.equal(before.strategy.incidents.length, 1);
    assert.equal(before.strategy.incidents[0].id, "incident-1");
    assert.equal(before.strategy.incidents[0].status, "open");
    assert.equal(before.strategy.incidents[0].building_name, "Lantern Tower");
    assert.equal(before.strategy.arcane_officers.length, 2);
    assert.ok(before.strategy.arcane_officers.every((officer) => officer.status === "available"));
    assert.deepEqual(before.strategy.arcane_officers.find((officer) => officer.id === "officer-vesper").specialties, ["investigation"]);

    const assigned = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-1" },
      payload: {
        expected_city_version: before.city_version,
        assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper", rationale: "matched investigation specialty" }]
      }
    }), 200);
    assert.equal(assigned.status, "accepted");
    assert.equal(assigned.city_version_after, assigned.city_version_before + 1, "accepting the plan advances the city version");
    assert.equal(assigned.strategy.pending_assignments.length, 1);
    assert.equal(assigned.strategy.pending_assignments[0].rationale, "matched investigation specialty");

    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-1" },
      payload: { expected_city_version: assigned.city_version_after }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.turn, 1);
    assert.equal(settled.city_version_after, settled.city_version_before + 1);
    assert.equal(settled.facts.assignments.length, 1);
    assert.equal(settled.facts.assignments[0].incidentId, "incident-1");
    assert.equal(settled.facts.assignments[0].arcaneOfficerId, "officer-vesper");
    assert.equal(settled.facts.assignments[0].rationale, "matched investigation specialty", "rationale survives settlement into the frozen facts");
    assert.equal(settled.facts.rolls.length, 1);
    const roll = settled.facts.rolls[0];
    assert.ok(roll.rawRoll >= 1 && roll.rawRoll <= 20);
    assert.equal(roll.incidentId, "incident-1");
    const outcome = settled.facts.outcomes[0];
    assert.equal(outcome.outcome, roll.outcome);
    assert.ok(["critical_success", "success"].includes(outcome.outcome), "strong officer against low difficulty cannot fail");
    assert.equal(gradeRoll(roll.rawRoll, roll.rawRoll + roll.attributeValue + roll.specialtyBonus + roll.modifier, roll.difficulty), outcome.outcome);
    assert.equal(outcome.incidentStatus, "resolved");
    assert.equal(outcome.arcaneOfficerStatus, "available");
    assert.equal(settled.strategy.incidents.filter((incident) => incident.id === "incident-1").length, 0, "resolved incident is no longer listed as open");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.turn, 1);
    assert.equal(after.turn_status, "resolved");
    assert.ok(after.last_turn_facts);
    assert.equal(after.last_turn_facts.assignments.length, 1);
    assert.equal(after.last_turn_facts.assignments[0].rationale, "matched investigation specialty", "rationale stays readable from last_turn_facts after resolve");
    const vesper = after.strategy.arcane_officers.find((officer) => officer.id === "officer-vesper");
    assert.equal(vesper.status, outcome.arcaneOfficerStatus);
  } finally {
    await app.close();
  }
});

test("assignments that carry system dice, outcome, or balance parameters are rejected and never stored", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const cases = [
      { key: "roll", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", roll: 20 } },
      { key: "outcome", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", outcome: "critical_success" } },
      { key: "modifier", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", modifier: 100 } },
      { key: "total", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", total: 999 } },
      { key: "success_probability", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", success_probability: 1 } },
      { key: "specialty_bonus", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", specialty_bonus: 50 } },
      { key: "attribute", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", attribute: "containment" } },
      { key: "officer_attributes", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", investigation: 5, specialties: ["investigation", "containment"] } },
      { key: "profile", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", profile: { investigation: 5 } } },
      { key: "cost", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", cost: 0 } },
      { key: "unknown-field", assignment: { incident_id: "incident-1", arcane_officer_id: "officer-vesper", mystery_field: 1 } }
    ];

    for (const { key, assignment } of cases) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/strategy/assignments`,
        headers: { "idempotency-key": `bad-${key}` },
        payload: { expected_city_version: before.city_version, assignments: [assignment] }
      }));
      assert.equal(response.statusCode, 400, key);
      assert.ok(["ASSIGNMENT_CARRIES_SYSTEM_PARAMETER", "INVALID_ASSIGNMENT"].includes(response.json().code), key);
    }

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.strategy.pending_assignments.length, 0, "no illegal assignment reached the dispatch plan");
    assert.equal(after.city_version, before.city_version, "no state was written by rejected submissions");
  } finally {
    await app.close();
  }
});

test("illegal dispatches are rejected by the authoritative domain validation", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0, {
      incidents: {
        "incident-1": openIncident(),
        "incident-2": openIncident({ id: "incident-2", summary: "Containment needed at the workshop." })
      }
    });
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const malformed = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "illegal-missing-officer-field" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1" }] }
    }));
    assert.equal(malformed.statusCode, 400, "a missing officer id is a malformed assignment");
    assert.equal(malformed.json().code, "INVALID_ASSIGNMENT");

    const cases = [
      { key: "unknown-incident", assignments: [{ incident_id: "incident-missing", arcane_officer_id: "officer-vesper" }] },
      { key: "unknown-officer", assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-missing" }] },
      { key: "duplicate-incident", assignments: [
        { incident_id: "incident-1", arcane_officer_id: "officer-vesper" },
        { incident_id: "incident-1", arcane_officer_id: "officer-milo" }
      ] },
      { key: "duplicate-officer", assignments: [
        { incident_id: "incident-1", arcane_officer_id: "officer-vesper" },
        { incident_id: "incident-2", arcane_officer_id: "officer-vesper" }
      ] }
    ];
    for (const { key, assignments } of cases) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/strategy/assignments`,
        headers: { "idempotency-key": `illegal-${key}` },
        payload: { expected_city_version: before.city_version, assignments }
      }));
      assert.equal(response.statusCode, 422, key);
      assert.equal(response.json().code, "INVALID_ASSIGNMENT", key);
    }

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.strategy.pending_assignments.length, 0);
  } finally {
    await app.close();
  }
});

test("an unavailable officer and a resolved incident cannot be dispatched", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0, {
      officers: { [MILO.id]: { ...MILO, status: "unavailable" } },
      incidents: { "incident-1": openIncident({ status: "resolved" }) }
    });
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const busy = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "busy-officer" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-milo" }] }
    }));
    assert.equal(busy.statusCode, 422);
    assert.ok(busy.json().errors.some((entry) => entry.code === "ARCANE_OFFICER_UNAVAILABLE"));

    const closed = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "resolved-incident" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper" }] }
    }));
    assert.equal(closed.statusCode, 422);
    assert.ok(closed.json().errors.some((entry) => entry.code === "INCIDENT_NOT_OPEN"));
  } finally {
    await app.close();
  }
});

test("a resolved turn is never settled twice, replays return the original response, and the plan stays closed", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const dispatch = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-1" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper" }] }
    }), 200);
    const resolvePayload = { expected_city_version: dispatch.city_version_after };
    const resolve1 = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-1" },
      payload: resolvePayload
    }), 200);
    assert.equal(resolve1.status, "resolved");

    const replay = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-1" },
      payload: resolvePayload
    }), 200);
    assert.equal(replay.idempotent_replay, true);
    assert.deepEqual(replay.facts, resolve1.facts);

    const secondAttempt = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-2" },
      payload: { expected_city_version: resolve1.city_version_after }
    }));
    assert.equal(secondAttempt.statusCode, 422);
    assert.equal(secondAttempt.json().code, "TURN_ALREADY_RESOLVED");

    const postResolveAssign = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-after-resolve" },
      payload: { expected_city_version: resolve1.city_version_after, assignments: [] }
    }));
    assert.equal(postResolveAssign.statusCode, 422);
    assert.equal(postResolveAssign.json().code, "TURN_ALREADY_RESOLVED");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.turn, 1, "the turn advanced exactly once");
    assert.deepEqual(after.last_turn_facts.resourceDelta, resolve1.facts.resourceDelta, "income was granted once");
  } finally {
    await app.close();
  }
});

test("a failed settlement writes no state and a corrected plan can still resolve", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "test/seed-bad-pending",
      idempotencyKey: "seed-bad-pending-1",
      requestBody: {},
      expectedVersion: before.city_version
    }, async ({ state }) => {
      state.gameplay.pendingAssignments = [{ incidentId: "incident-missing", arcaneOfficerId: "officer-vesper" }];
      return { nextState: state, response: { seeded: true } };
    });

    const rejected = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-bad" },
      payload: { expected_city_version: before.city_version }
    }));
    assert.equal(rejected.statusCode, 422);
    assert.equal(rejected.json().code, "INVALID_ASSIGNMENT");

    const unchanged = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(unchanged.turn, 0, "failed settlement did not advance the turn");
    assert.equal(unchanged.city_version, before.city_version, "failed settlement wrote no state");
    assert.equal(unchanged.strategy.pending_assignments.length, 1, "the rejected plan is still visible for correction");

    const corrected = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-fixed" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper" }] }
    }), 200);
    assert.equal(corrected.status, "accepted");
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-fixed" },
      payload: { expected_city_version: corrected.city_version_after }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.facts.assignments.length, 1);
  } finally {
    await app.close();
  }
});

test("a stale dispatch plan cannot silently overwrite a newer plan", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const first = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-a" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper", rationale: "first plan" }] }
    }), 200);
    assert.equal(first.status, "accepted");
    assert.equal(first.city_version_after, before.city_version + 1, "the first submission advanced the version");

    const stale = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-b" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-milo", rationale: "stale second plan" }] }
    }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, "CITY_VERSION_CONFLICT");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.strategy.pending_assignments.length, 1, "the first plan is still the pending plan");
    assert.equal(after.strategy.pending_assignments[0].arcane_officer_id, "officer-vesper", "the stale plan was not applied");
    assert.equal(after.city_version, before.city_version + 1, "the rejected stale write left no version behind");
  } finally {
    await app.close();
  }
});

test("an Agent can finish the strategy phase without dispatching anyone", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0, { incidents: {} });
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.strategy.incidents.length, 0);

    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-empty" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.facts.assignments.length, 0);
    assert.equal(settled.facts.rolls.length, 0);
  } finally {
    await app.close();
  }
});

test("resolve request bodies that carry unknown fields or balance parameters are rejected, and a clean resolve keeps the system's dice", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const dispatch = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-1" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper" }] }
    }), 200);

    const injected = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-injected" },
      payload: {
        expected_city_version: dispatch.city_version_after,
        options: { modifier: 99, baseCoins: 9999 },
        force: true,
        roll: 20,
        outcome: "critical_success"
      }
    }));
    assert.equal(injected.statusCode, 400);
    assert.equal(injected.json().code, "UNKNOWN_STRATEGY_REQUEST_FIELD");

    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-clean" },
      payload: { expected_city_version: dispatch.city_version_after }
    }), 200);
    assert.equal(settled.status, "resolved");
    const roll = settled.facts.rolls[0];
    assert.equal(roll.modifier, 0, "the system owns the modifier");
    assert.ok(roll.rawRoll >= 1 && roll.rawRoll <= 20, "the system rolled its own dice");
    assert.equal(gradeRoll(roll.rawRoll, roll.rawRoll + roll.attributeValue + roll.specialtyBonus, roll.difficulty), roll.outcome, "outcome derives from the real roll");
  } finally {
    await app.close();
  }
});

test("OpenAPI advertises the strategy endpoints and schemas", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    for (const route of ["/cities/{city_id}/strategy", "/cities/{city_id}/strategy/assignments", "/cities/{city_id}/strategy/resolve"]) {
      assert.ok(openapi.paths[route], `missing ${route}`);
    }
    for (const schema of ["StrategyIncident", "ArcaneOfficer", "StrategyAssignment", "StrategyAssignmentsRequest", "StrategyResolveRequest", "TurnFacts", "StrategyContext"]) {
      assert.ok(openapi.components.schemas[schema], `missing schema ${schema}`);
    }
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
