import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createDatabase, migrateDatabase } from "../apps/server/database.js";
import { createRepository } from "../apps/server/repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";

const databaseUrl = process.env.MAGICTOWN_TEST_DATABASE_URL;
const TURN_INTERVAL_MS = 60_000;
const TURN_DEADLINE_MS = 60_000;

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  assetProvider: "fixture",
  assetOutputRoot: "/tmp/magictown-scheduler-integration",
  workerPollMs: 5,
  turnIntervalMs: TURN_INTERVAL_MS,
  turnDeadlineMs: TURN_DEADLINE_MS,
  turnSchedulerPollMs: 5
};

test("turn scheduler settles overdue turns and discovers them after restart", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const database = createDatabase(databaseUrl);
  await migrateDatabase(database);
  await database.query("TRUNCATE agent_action_log, outbox_jobs, construction_orders, asset_jobs, command_receipts, city_events, agent_credentials, agent_capabilities, city_memberships, cities, asset_definitions, players CASCADE");
  const repository = createRepository(database, config);

  const clock = fakeClock();
  const app = await createApp({ repository, config, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config, now: clock.now, logger: { error() {} } });

  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Scheduler Integration Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Scheduler Integration City", map_seed: "scheduler-integration" } }), 201);
    const owner = await repository.authenticate(player.access_token);

    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "integration/seed-incident",
      idempotencyKey: "seed-incident-1",
      requestBody: {},
      expectedVersion: 0
    }, async ({ state }) => {
      const cell = Object.values(state.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
      state.cells[cell.id].occupancy = "building-1";
      state.buildings["building-1"] = {
        id: "building-1",
        footprintCells: [cell.id],
        site: { lotId: cell.id, footprint: "1x1" },
        program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.6, prominence: "important" } },
        status: "completed",
        exposure: 40
      };
      state.gameplay.incidents = {
        "incident-1": {
          id: "incident-1", buildingId: "building-1", type: "investigation", attribute: "investigation",
          difficulty: 3, severity: 3, exposureAtCreation: 40,
          summary: "Unresolved magical anomaly near Lantern Tower.",
          status: "open", createdAtTurn: 0
        }
      };
      return { nextState: state, response: { seeded: true } };
    });

    await scheduler.pollOnce();
    assert.equal((await repository.getCityForScheduler(city.id)).state.gameplay.turnStatus, "open");

    // The server "goes down" before the deadline fires.
    clock.advance(TURN_DEADLINE_MS + 5000);
    await app.close();

    // A restarted server + scheduler rediscovers the overdue turn from persisted state.
    const restarted = createRepository(database, config);
    const app2 = await createApp({ repository: restarted, config, now: clock.now, logger: false });
    const scheduler2 = createTurnScheduler({ repository: restarted, config, now: clock.now, logger: { error() {} } });
    try {
      const scanned = await restarted.scanCitiesForScheduler(clock.iso());
      assert.equal(scanned.length, 1, "restart rediscovers the overdue city");
      const results = await scheduler2.pollOnce();
      assert.equal(results.length, 1);
      assert.equal(results[0].status, "deadline_resolved");
      const { state } = await restarted.getCityForScheduler(city.id);
      assert.equal(state.turn, 1, "the overdue turn settled exactly once after restart");
      assert.equal(state.gameplay.turnStatus, "resolved");
      assert.equal(state.gameplay.lastTurnFacts.wallClock.settledBy, "deadline");
      assert.equal(state.gameplay.lastTurnFacts.unaddressedIncidents.length, 1, "the unassigned incident took the conservative path");

      const second = await scheduler2.pollOnce();
      assert.equal(second.length, 0, "re-polling does not settle the turn again");
    } finally {
      scheduler2.stop();
      await app2.close();
    }
  } finally {
    scheduler.stop();
    await app.close();
    await database.close();
  }
});

test("concurrent scheduler and Agent settlements settle a turn exactly once", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const database = createDatabase(databaseUrl);
  await migrateDatabase(database);
  await database.query("TRUNCATE agent_action_log, outbox_jobs, construction_orders, asset_jobs, command_receipts, city_events, agent_credentials, agent_capabilities, city_memberships, cities, asset_definitions, players CASCADE");
  const repository = createRepository(database, config);

  const clock = fakeClock();
  const app = await createApp({ repository, config, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config, now: clock.now, logger: { error() {} } });

  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Concurrency Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Concurrency City", map_seed: "scheduler-concurrency" } }), 201);
    const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const connected = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
    const agent = { access_token: connected.access_token };

    await scheduler.pollOnce();

    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const dispatch = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/assignments`,
      headers: { "idempotency-key": "dispatch-concurrent" },
      payload: { expected_city_version: before.city_version, assignments: [] }
    }), 200);
    assert.equal(dispatch.status, "accepted");

    clock.advance(TURN_DEADLINE_MS + 1000);

    // The Agent resolve and the deadline scheduler race; the row lock + version
    // guard mean exactly one of them performs the settlement.
    const [agentSettled, schedulerSweep] = await Promise.all([
      app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/strategy/resolve`,
        headers: { "idempotency-key": "resolve-concurrent" },
        payload: { expected_city_version: dispatch.city_version_after }
      })),
      scheduler.pollOnce()
    ]);

    const winner = agentSettled.json();
    const agentWon = winner.status === "resolved";
    if (agentWon) {
      assert.equal(winner.turn, 1);
      assert.ok(schedulerSweep.every((entry) => entry.status === "noop"), "the scheduler has nothing to settle once the Agent won");
    } else {
      assert.equal(agentSettled.statusCode, 409, "the losing Agent resolve reports a version conflict");
      assert.equal(winner.code, "CITY_VERSION_CONFLICT");
      assert.equal(schedulerSweep.filter((entry) => entry.status === "deadline_resolved").length, 1, "the scheduler settled the overdue turn");
    }

    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.turn, 1, "the turn was settled exactly once under concurrency");
    assert.equal(state.gameplay.turnStatus, "resolved");
    assert.equal(state.gameplay.resources.coins, 600 + state.gameplay.lastTurnFacts.resourceDelta.coins, "income was granted exactly once");
  } finally {
    scheduler.stop();
    await app.close();
    await database.close();
  }
});

function fakeClock(start = "2026-08-01T00:00:00.000Z") {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    advance: (amount) => { ms += amount; },
    iso: () => new Date(ms).toISOString()
  };
}

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
