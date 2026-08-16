import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";
import { resolveTurn } from "../src/gameplay/simulation.js";
import { dueActionFor, initializeTurnSchedule, isTurnOverdue, openNextTurn, shouldOpenNextTurn } from "../src/gameplay/turn.js";

const TURN_INTERVAL_MS = 60_000;
const TURN_DEADLINE_MS = 60_000;

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-turn-scheduler-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7,
  turnIntervalMs: TURN_INTERVAL_MS,
  turnDeadlineMs: TURN_DEADLINE_MS,
  turnSchedulerPollMs: 5
};

const VESPER = { id: "officer-vesper", name: "Vesper", archetype: "investigation", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 };

function fakeClock(start = "2026-08-01T00:00:00.000Z") {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    advance: (amount) => { ms += amount; },
    iso: () => new Date(ms).toISOString()
  };
}

async function setup(clock, repository) {
  const app = await createApp({ repository, config, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config, now: clock.now, logger: { error() {} } });
  return { app, scheduler };
}

async function openCity(app, repository) {
  const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Scheduler Owner" } }, 201);
  const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Scheduler City", map_seed: "turn-scheduler-test" } }), 201);
  const owner = await repository.authenticate(player.access_token);
  const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
  const connected = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
  const agent = { access_token: connected.access_token };
  return { player, city, owner, agent };
}

async function seedState(repository, owner, cityId, expectedVersion, overrides = {}) {
  await repository.transactCity({
    principal: owner,
    cityId,
    endpoint: "test/seed-scheduler",
    idempotencyKey: "seed-scheduler-1",
    requestBody: {},
    expectedVersion
  }, async ({ state }) => {
    const cell = Object.values(state.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
    state.cells[cell.id].occupancy = "building-1";
    state.buildings["building-1"] = {
      id: "building-1",
      footprintCells: [cell.id],
      site: { lotId: cell.id, footprint: "1x1" },
      program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.6, prominence: "important" } },
      status: "completed",
      exposure: overrides.exposure ?? 40
    };
    if (overrides.incidents) state.gameplay.incidents = structuredClone(overrides.incidents);
    if (overrides.officers) state.gameplay.arcaneOfficers = structuredClone(overrides.officers);
    if (overrides.turnStatus) state.gameplay.turnStatus = overrides.turnStatus;
    if (overrides.pendingAssignments) state.gameplay.pendingAssignments = structuredClone(overrides.pendingAssignments);
    return { nextState: state, response: { seeded: true } };
  });
}

function openIncident(overrides = {}) {
  return {
    id: "incident-1",
    buildingId: "building-1",
    type: "investigation",
    attribute: "investigation",
    difficulty: 3,
    severity: 3,
    exposureAtCreation: 40,
    summary: "Unresolved magical anomaly reported near Lantern Tower.",
    status: "open",
    createdAtTurn: 0,
    ...overrides
  };
}

test("a fresh city receives a wall-clock schedule from the first scheduler poll", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city } = await openCity(app, repository);
    const results = await scheduler.pollOnce();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "opened");

    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.gameplay.turnStatus, "open");
    assert.equal(state.gameplay.turnOpenedAt, clock.iso());
    assert.equal(state.gameplay.turnDeadlineAt, new Date(clock.now().getTime() + TURN_DEADLINE_MS).toISOString());
    assert.equal(state.gameplay.nextTurnUnlockAt, null);
  } finally {
    await app.close();
  }
});

test("a resolved turn cannot reopen before unlock and opens exactly one new turn at unlock", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();

    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.turn_status, "open");
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-a" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.turn, 1);
    assert.equal(settled.facts.wallClock.settledBy, "agent");
    assert.equal(settled.facts.wallClock.nextTurnUnlockAt, new Date(clock.now().getTime() + TURN_INTERVAL_MS).toISOString());

    clock.advance(TURN_INTERVAL_MS - 1000);
    const locked = await scheduler.pollOnce();
    assert.equal(locked.length, 0, "nothing may open before the persisted unlock time");

    clock.advance(2000);
    const opened = await scheduler.pollOnce();
    assert.equal(opened.length, 1);
    assert.equal(opened[0].status, "opened");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.turn, 1, "the turn number advanced exactly once at resolve");
    assert.equal(after.turn_status, "open", "the settled turn opened at its unlock time");
    assert.equal(after.turn_opened_at, clock.iso());
    assert.equal(after.next_turn_unlock_at, null);

    const noop = await scheduler.pollOnce();
    assert.equal(noop.length, 0, "re-polling the same moment does not open a second turn");
  } finally {
    await app.close();
  }
});

test("a deadline that passes without an Agent settlement auto-resolves exactly once through resolveTurn", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city } = await openCity(app, repository);
    await scheduler.pollOnce();

    clock.advance(TURN_DEADLINE_MS + 1000);
    const results = await scheduler.pollOnce();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "deadline_resolved");
    assert.equal(results[0].settled_by, "deadline");

    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.turn, 1);
    assert.equal(state.gameplay.turnStatus, "resolved");
    assert.equal(state.gameplay.lastTurnFacts.wallClock.settledBy, "deadline");
    assert.ok(state.gameplay.lastTurnFacts.resourceDelta.coins > 0, "income was settled through the authoritative resolveTurn");
    const incomeGrantedOnce = state.gameplay.resources.coins;

    const second = await scheduler.pollOnce();
    assert.equal(second.length, 1, "the settled turn opens its next turn once its unlock slot is reached");
    assert.equal(second[0].status, "opened", "the deadline settle does not re-settle; it only opens the next turn");
    assert.equal(second[0].settled_by, undefined, "an opened turn has no settlement source");

    const { state: after } = await repository.getCityForScheduler(city.id);
    assert.equal(after.gameplay.resources.coins, incomeGrantedOnce, "resources did not change on the second poll");
    assert.equal(after.turn, 1, "opening the next turn does not grant another turn's income");
  } finally {
    await app.close();
  }
});

test("unassigned open incidents take the conservative unaddressed path on deadline settlement", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, owner } = await openCity(app, repository);
    await seedState(repository, owner, city.id, 0, { incidents: { "incident-1": openIncident() } });
    await scheduler.pollOnce();

    const before = await repository.getCityForScheduler(city.id);
    assert.equal(before.state.buildings["building-1"].exposure, 40);

    clock.advance(TURN_DEADLINE_MS + 1000);
    const results = await scheduler.pollOnce();
    assert.equal(results[0].status, "deadline_resolved");

    const { state } = await repository.getCityForScheduler(city.id);
    const facts = state.gameplay.lastTurnFacts;
    assert.equal(facts.unaddressedIncidents.length, 1, "the unassigned incident is recorded as unaddressed");
    assert.equal(facts.unaddressedIncidents[0].incidentId, "incident-1");
    assert.equal(state.gameplay.incidents["incident-1"].status, "open", "an unaddressed incident stays open instead of resolving for free");
    assert.ok(state.buildings["building-1"].exposure > 40, "an unaddressed incident applies a gentle exposure penalty");
  } finally {
    await app.close();
  }
});

test("an Agent resolve and a deadline settle race but only one settlement wins", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, owner, agent } = await openCity(app, repository);
    await seedState(repository, owner, city.id, 0, { incidents: { "incident-1": openIncident() }, officers: { [VESPER.id]: VESPER } });
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const dispatch = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-race" },
      payload: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper" }] }
    }), 200);
    assert.equal(dispatch.status, "accepted");

    // The Agent settles first while the scheduler is due.
    clock.advance(TURN_DEADLINE_MS + 1000);
    const agentSettled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-race-agent" },
      payload: { expected_city_version: dispatch.city_version_after }
    }), 200);
    assert.equal(agentSettled.status, "resolved");
    assert.equal(agentSettled.facts.wallClock.settledBy, "agent");
    assert.equal(agentSettled.facts.assignments.length, 1, "the pending dispatch plan was honored");

    const schedulerSweep = await scheduler.pollOnce();
    assert.equal(schedulerSweep.filter((entry) => entry.status === "deadline_resolved").length, 0, "the deadline scheduler finds nothing left to settle");
    assert.equal(schedulerSweep.filter((entry) => entry.status === "opened").length, 1, "the sweep only opens the next turn now that its unlock slot is reached");

    const after = await repository.getCityForScheduler(city.id);
    assert.equal(after.state.turn, 1, "the turn was settled exactly once");
  } finally {
    await app.close();
  }
});

test("a stale deadline settle hits a version conflict and never double-settles", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, owner, agent } = await openCity(app, repository);
    await seedState(repository, owner, city.id, 0);
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    // A scheduler scan reads the city at the current version...
    clock.advance(TURN_DEADLINE_MS + 1000);
    const staleRow = (await repository.scanCitiesForScheduler(clock.iso()))[0];
    assert.ok(staleRow);
    const staleVersion = Number(staleRow.state_jsonb.version);

    // ...but the Agent resolves first, advancing the version.
    const agentSettled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-race-stale" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(agentSettled.status, "resolved");

    // The stale scheduler read now conflicts; the scheduler re-reads and no-ops.
    let conflictObserved = false;
    const patched = { ...scheduler, processCity: async (row) => {
      try {
        await repository.schedulerTransact({
          cityId: row.id,
          endpoint: `turn-scheduler/resolve-deadline`,
          idempotencyKey: `resolve-deadline-${staleRow.state_jsonb.turn}`,
          requestBody: {},
          expectedVersion: staleVersion
        }, () => ({ nextState: null, response: { status: "should-not-run" } }));
      } catch (error) {
        assert.equal(error.code, "CITY_VERSION_CONFLICT");
        conflictObserved = true;
      }
      const latest = await repository.getCityForScheduler(row.id);
      assert.equal(dueActionFor(latest.state, clock.now()), "open-next", "after the Agent settle the scheduler only opens the next turn, never re-settles");
      return { city_id: row.id, status: "noop" };
    } };
    await patched.processCity(staleRow);
    assert.equal(conflictObserved, true, "the stale version conflict was surfaced");

    const after = await repository.getCityForScheduler(city.id);
    assert.equal(after.state.turn, 1, "the turn was settled exactly once");
    assert.equal(after.state.gameplay.turnStatus, "resolved");
  } finally {
    await app.close();
  }
});

test("elapsed wall-clock of many days never backfills many turns or grants many incomes", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, owner, agent } = await openCity(app, repository);
    await seedState(repository, owner, city.id, 0);
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-days" },
      payload: { expected_city_version: before.city_version }
    }), 200);

    const incomeAfterFirst = (await repository.getCityForScheduler(city.id)).state.gameplay.resources.coins;
    clock.advance(5 * 86_400_000);

    const results = await scheduler.pollOnce();
    const opened = results.filter((entry) => entry.status === "opened");
    assert.equal(opened.length, 1, "exactly one turn opens no matter how many days elapsed");
    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.turn, 1, "no extra turns were manufactured from the elapsed wall-clock");
    assert.equal(state.gameplay.turnStatus, "open");
    assert.equal(state.gameplay.resources.coins, incomeAfterFirst, "no income was granted for the skipped days");
  } finally {
    await app.close();
  }
});

test("changing the wall clock without a scheduler poll changes no gameplay state", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city } = await openCity(app, repository);
    await scheduler.pollOnce();
    const before = (await repository.getCityForScheduler(city.id)).state;
    clock.advance(10 * 86_400_000);
    const untouched = (await repository.getCityForScheduler(city.id)).state;
    assert.deepEqual(untouched.gameplay.resources, before.gameplay.resources);
    assert.equal(untouched.turn, before.turn);
    assert.equal(untouched.version, before.version);
    assert.equal(dueActionFor(untouched, clock.now()), "resolve-deadline", "only the scheduler poll turns elapsed time into a settlement");
  } finally {
    await app.close();
  }
});

test("Agent API cannot forge unlock, deadline, force, or scheduler trigger fields", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app } = await setup(clock, repository);
  try {
    const { city, owner, agent } = await openCity(app, repository);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const resolveBodies = [
      { key: "force", body: { expected_city_version: before.city_version, force: true } },
      { key: "trigger", body: { expected_city_version: before.city_version, trigger: "deadline" } },
      { key: "unlock_at", body: { expected_city_version: before.city_version, next_turn_unlock_at: clock.iso() } },
      { key: "deadline_at", body: { expected_city_version: before.city_version, turn_deadline_at: clock.iso() } },
      { key: "scheduler", body: { expected_city_version: before.city_version, scheduler: { nextTurnUnlockAt: clock.iso() } } }
    ];
    for (const { key, body } of resolveBodies) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/strategy/resolve`,
        headers: { "idempotency-key": `forge-resolve-${key}` },
        payload: body
      }));
      assert.equal(response.statusCode, 400, key);
      assert.equal(response.json().code, "UNKNOWN_STRATEGY_REQUEST_FIELD", key);
    }

    const assignmentBodies = [
      { key: "force", body: { expected_city_version: before.city_version, assignments: [], force: true } },
      { key: "deadline_at", body: { expected_city_version: before.city_version, assignments: [], turn_deadline_at: clock.iso() } },
      { key: "assignment-force", body: { expected_city_version: before.city_version, assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper", force: true }] } }
    ];
    for (const { key, body } of assignmentBodies) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/strategy/assignments`,
        headers: { "idempotency-key": `forge-assign-${key}` },
        payload: body
      }));
      assert.equal(response.statusCode, 400, key);
      assert.ok(["UNKNOWN_STRATEGY_REQUEST_FIELD", "INVALID_ASSIGNMENT"].includes(response.json().code), key);
    }

    const after = await repository.getCityForScheduler(city.id);
    assert.equal(after.state.gameplay.nextTurnUnlockAt, null, "no unlock was forged into state");
    assert.equal(after.state.gameplay.turnDeadlineAt, null, "no deadline was forged into state");
    assert.equal(after.state.turn, 0);
  } finally {
    await app.close();
  }
});

test("a server restart re-discovers overdue and unlockable turns from persisted timestamps", async () => {
  const clock = fakeClock();
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "magictown-scheduler-"));
  const storagePath = path.join(storageDir, "state.json");

  const first = createMemoryRepository(config, { storagePath });
  const app1 = await createApp({ repository: first, config, now: clock.now, logger: false });
  const scheduler1 = createTurnScheduler({ repository: first, config, now: clock.now, logger: { error() {} } });
  try {
    const { city } = await openCity(app1, first);
    await scheduler1.pollOnce();
    // The server "goes down" before its deadline ever fires.
    clock.advance(TURN_DEADLINE_MS + 5000);
  } finally {
    scheduler1.stop();
    await app1.close();
  }

  const second = createMemoryRepository(config, { storagePath });
  const app2 = await createApp({ repository: second, config, now: clock.now, logger: false });
  const scheduler2 = createTurnScheduler({ repository: second, config, now: clock.now, logger: { error() {} } });
  try {
    const rows = await second.scanCitiesForScheduler(clock.iso());
    assert.equal(rows.length, 1, "the persisted overdue city is rediscovered after restart");
    const results = await scheduler2.pollOnce();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "deadline_resolved");
    const { state } = await second.getCityForScheduler(rows[0].id);
    assert.equal(state.turn, 1, "the overdue turn settled exactly once after restart");
    assert.equal(state.gameplay.turnStatus, "resolved");
  } finally {
    scheduler2.stop();
    await app2.close();
  }
});

test("the strategy context exposes the server-owned unlock and deadline read-only", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.turn_status, "open");
    assert.equal(before.turn_deadline_at, new Date(clock.now().getTime() + TURN_DEADLINE_MS).toISOString());
    assert.equal(before.next_turn_unlock_at, null);
  } finally {
    await app.close();
  }
});

test("OpenAPI advertises the scheduler read-only fields", async () => {
  const repository = createMemoryRepository(config);
  const { app } = await setup(fakeClock(), repository);
  try {
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    const context = openapi.components.schemas.StrategyContext.properties;
    assert.ok("turn_deadline_at" in context);
    assert.ok("next_turn_unlock_at" in context);
    assert.ok("settled_by" in context);
    assert.ok("unaddressedIncidents" in openapi.components.schemas.TurnFacts.properties);
  } finally {
    await app.close();
  }
});

test("scheduler idempotency is isolated per city so equal turn numbers never collide", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const first = await openCity(app, repository);
    const second = await openCity(app, repository);
    await scheduler.pollOnce();
    clock.advance(TURN_DEADLINE_MS + 1000);
    const results = await scheduler.pollOnce();
    assert.equal(results.filter((entry) => entry.status === "deadline_resolved").length, 2, "both overdue cities settled");
    const stateA = (await repository.getCityForScheduler(first.city.id)).state;
    const stateB = (await repository.getCityForScheduler(second.city.id)).state;
    assert.equal(stateA.turn, 1);
    assert.equal(stateB.turn, 1);
    assert.equal(stateA.gameplay.turnStatus, "resolved");
    assert.equal(stateB.gameplay.turnStatus, "resolved");
  } finally {
    await app.close();
  }
});

test("pure domain transitions are deterministic and injectable-clock driven", () => {
  const clock = fakeClock();
  const base = { version: 0, turn: 0, gameplay: { turnStatus: "open", turnOpenedAt: null, turnDeadlineAt: null, nextTurnUnlockAt: null, scheduler: null } };
  assert.equal(dueActionFor(base, clock.now()), "init");
  const initialized = initializeTurnSchedule(base, clock.now(), config);
  assert.ok(initialized.gameplay.turnDeadlineAt);
  assert.equal(isTurnOverdue(initialized, clock.now()), false);
  assert.equal(dueActionFor(initialized, clock.now()), null);
  clock.advance(TURN_DEADLINE_MS + 1);
  assert.equal(isTurnOverdue(initialized, clock.now()), true);
  assert.equal(dueActionFor(initialized, clock.now()), "resolve-deadline");

  const resolved = { version: 2, turn: 1, gameplay: { ...initialized.gameplay, turnStatus: "resolved", turnDeadlineAt: initialized.gameplay.turnDeadlineAt, nextTurnUnlockAt: new Date(clock.now().getTime() + TURN_INTERVAL_MS).toISOString() } };
  assert.equal(shouldOpenNextTurn(resolved, clock.now()), false);
  clock.advance(TURN_INTERVAL_MS + 1);
  assert.equal(shouldOpenNextTurn(resolved, clock.now()), true);
  assert.equal(dueActionFor(resolved, clock.now()), "open-next");
  const opened = openNextTurn(resolved, clock.now(), config);
  assert.equal(opened.gameplay.turnStatus, "open");
  assert.equal(opened.gameplay.nextTurnUnlockAt, null);
});

test("an immediate Agent resolve and a deadline settle share the same next-turn unlock slot", () => {
  const clock = fakeClock("2026-08-01T00:00:00.000Z");
  const openedAt = clock.iso();
  const base = { version: 0, turn: 0, gameplay: { schemaVersion: 1, turnStatus: "open", turnOpenedAt: openedAt, turnDeadlineAt: new Date(clock.now().getTime() + TURN_DEADLINE_MS).toISOString(), nextTurnUnlockAt: null, scheduler: { schemaVersion: 1, openedAt, resolvedAt: null, settledBy: null } } };
  const immediate = resolveTurn(structuredClone(base), {}, {
    seed: "cadence-test",
    now: () => clock.iso(),
    options: { turnIntervalMs: TURN_INTERVAL_MS, turnDeadlineMs: TURN_DEADLINE_MS }
  });
  assert.equal(immediate.error, null);
  const immediateUnlock = immediate.nextState.gameplay.nextTurnUnlockAt;
  assert.equal(immediateUnlock, new Date(clock.now().getTime() + TURN_INTERVAL_MS).toISOString(), "immediate resolve anchors the next unlock to the openedAt slot");

  // The same turn, left untouched until its deadline, settles later but must
  // anchor to the same turnOpenedAt slot rather than resolvedAt + interval.
  clock.advance(TURN_DEADLINE_MS + 1000);
  const late = resolveTurn(structuredClone(base), {}, {
    seed: "cadence-test",
    now: () => clock.iso(),
    options: { turnIntervalMs: TURN_INTERVAL_MS, turnDeadlineMs: TURN_DEADLINE_MS, settlementSource: "deadline" }
  });
  assert.equal(late.error, null);
  assert.equal(late.nextState.gameplay.nextTurnUnlockAt, immediateUnlock, "deadline resolve produces the same next-turn cadence as an immediate resolve");
  assert.notEqual(new Date(clock.now().getTime() + TURN_INTERVAL_MS).toISOString(), immediateUnlock, "the cadence is not resolvedAt-anchored anymore");

  // Because the unlock slot was already reached, the settled turn can reopen
  // on the very next poll: continuous absence is one turn per interval.
  assert.equal(shouldOpenNextTurn(late.nextState, clock.now()), true, "deadline-settled turn may reopen immediately once its slot arrived");
  const reopened = openNextTurn(late.nextState, clock.now(), config);
  assert.equal(reopened.gameplay.turnStatus, "open");
  assert.equal(reopened.turn, 1, "opening the next turn does not manufacture an extra settlement");
});

test("opening a new turn clears the previous turn's settled_by from the scheduler metadata", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.settled_by, null);

    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-reopen" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.facts.wallClock.settledBy, "agent");
    let state = (await repository.getCityForScheduler(city.id)).state;
    assert.equal(state.gameplay.scheduler.settledBy, "agent", "the resolved turn records who settled it");
    assert.ok(state.gameplay.scheduler.resolvedAt);

    clock.advance(TURN_INTERVAL_MS + 1000);
    const results = await scheduler.pollOnce();
    assert.equal(results.filter((entry) => entry.status === "opened").length, 1, "the next turn opened at its slot");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.turn_status, "open");
    assert.equal(after.settled_by, null, "an open turn no longer reports the previous settlement");

    state = (await repository.getCityForScheduler(city.id)).state;
    assert.equal(state.gameplay.scheduler.settledBy, null, "settledBy is cleared on reopen");
    assert.equal(state.gameplay.scheduler.resolvedAt, null, "resolvedAt is cleared on reopen");
    assert.equal(state.gameplay.scheduler.openedAt, after.turn_opened_at, "only the new openedAt remains");
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
