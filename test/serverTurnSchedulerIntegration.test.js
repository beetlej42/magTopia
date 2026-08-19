import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createDatabase, migrateDatabase } from "../apps/server/database.js";
import { createRepository } from "../apps/server/repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";

const databaseUrl = process.env.MAGICTOWN_TEST_DATABASE_URL;
const TURN_COOLDOWN_SECONDS = 60;

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  assetProvider: "fixture",
  assetOutputRoot: "/tmp/magictown-scheduler-integration",
  workerPollMs: 5,
  turnCooldownSeconds: TURN_COOLDOWN_SECONDS,
  turnSchedulerPollMs: 5
};

test("turn scheduler never auto-settles and opens the next turn at the unlock slot after an Agent resolve", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const database = createDatabase(databaseUrl);
  await migrateDatabase(database);
  await database.query("TRUNCATE agent_action_log, outbox_jobs, construction_orders, asset_jobs, command_receipts, city_events, agent_credentials, agent_capabilities, city_memberships, cities, asset_definitions, players CASCADE");
  const repository = createRepository(database, config, { now: clock.now });

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

    // Far past the cooldown with no active resolve: the scheduler must not settle.
    clock.advance(10 * TURN_COOLDOWN_SECONDS * 1000);
    const idleSweep = await scheduler.pollOnce();
    assert.equal(idleSweep.filter((entry) => entry.status === "deadline_resolved").length, 0, "no auto-settle happens");
    let row = await repository.getCityForScheduler(city.id);
    assert.equal(row.state.turn, 0, "the turn stays open without an active resolve");
    assert.equal(row.state.gameplay.turnStatus, "open");

    // The Agent actively resolves (unlocked by now) with an empty plan, leaving
    // the incident unaddressed and conservatively recorded.
    const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const connected = await json(app, { method: "GET", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
    const agent = { access_token: connected.access_token };
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-integration" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.facts.wallClock.settledBy, "agent");
    assert.ok(settled.facts.unaddressedIncidents.length >= 1, "the unassigned incident took the conservative path");

    row = await repository.getCityForScheduler(city.id);
    assert.equal(row.state.turn, 1, "the Agent resolve advanced exactly one turn");
    assert.equal(row.state.gameplay.turnStatus, "resolved");

    // The server "goes down" before it opens the next turn.
    await app.close();

    // A restarted server + scheduler rediscovers the settled city at its unlock
    // slot and only opens the next turn; it never settles again.
    const restarted = createRepository(database, config, { now: clock.now });
    const app2 = await createApp({ repository: restarted, config, now: clock.now, logger: false });
    const scheduler2 = createTurnScheduler({ repository: restarted, config, now: clock.now, logger: { error() {} } });
    try {
      const scanned = await restarted.scanCitiesForScheduler(clock.iso());
      assert.equal(scanned.length, 1, "restart rediscovers the unlockable city");
      const results = await scheduler2.pollOnce();
      assert.equal(results.length, 1);
      assert.equal(results[0].status, "opened", "the restarted scheduler only opens the next turn");
      const { state } = await restarted.getCityForScheduler(city.id);
      assert.equal(state.turn, 1, "no extra settlement or turn was manufactured");
      assert.equal(state.gameplay.turnStatus, "open");

      const second = await scheduler2.pollOnce();
      assert.equal(second.filter((entry) => entry.status === "opened").length, 0, "re-polling does not open a second turn");
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

test("a new city created through the production repository is coins-only with no timber/stone", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const database = createDatabase(databaseUrl);
  await migrateDatabase(database);
  await database.query("TRUNCATE agent_action_log, outbox_jobs, construction_orders, asset_jobs, command_receipts, city_events, agent_credentials, agent_capabilities, city_memberships, cities, asset_definitions, players CASCADE");
  const repository = createRepository(database, config);
  const app = await createApp({ repository, config, logger: false });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Resource Contract Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Resource Contract City", map_seed: "resource-contract" } }), 201);
    const owner = await repository.authenticate(player.access_token);
    const { state } = await repository.getCity(owner, city.id);
    assert.deepEqual(state.resources, { coins: 600 }, "a fresh production city holds only the authoritative 600 coins");
    assert.deepEqual(state.gameplay.resources, { coins: 600, magic: 0 });
    assert.ok(!("timber" in state.resources) && !("stone" in state.resources), "timber/stone are never initialized");
  } finally {
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
