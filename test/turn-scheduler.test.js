import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";
import { createCityState } from "../src/city/state.js";
import { resolveTurn } from "../src/gameplay/simulation.js";
import { dueActionFor, initializeTurnSchedule, isTurnResolveLocked, openNextTurn, shouldOpenNextTurn } from "../src/gameplay/turn.js";

const TURN_COOLDOWN_SECONDS = 60;

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-turn-scheduler-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7,
  turnCooldownSeconds: TURN_COOLDOWN_SECONDS,
  turnSchedulerPollMs: 5
};

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

test("a fresh city receives a cooldown schedule from the first scheduler poll", async () => {
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
    assert.equal(state.gameplay.turnDeadlineAt, null, "no deadline auto-settle is ever written");
    assert.equal(state.gameplay.nextTurnUnlockAt, new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString());
  } finally {
    await app.close();
  }
});

test("resolve before the cooldown elapses is rejected with TURN_NOT_UNLOCKED and succeeds after", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();

    clock.advance((TURN_COOLDOWN_SECONDS - 10) * 1000);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.turn_status, "open");
    assert.ok(before.next_turn_unlock_at);

    const locked = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-locked" },
      payload: { expected_city_version: before.city_version }
    }));
    assert.equal(locked.statusCode, 422, "a pre-unlock resolve is rejected");
    assert.equal(locked.json().code, "TURN_NOT_UNLOCKED");
    assert.equal(locked.json().next_turn_unlock_at, before.next_turn_unlock_at);

    const untouched = await repository.getCityForScheduler(city.id);
    assert.equal(untouched.state.turn, 0, "a rejected resolve advances nothing");
    assert.equal(untouched.state.version, before.city_version, "a rejected resolve writes no state");

    clock.advance(11 * 1000);
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-after-unlock" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.turn, 1);
    assert.equal(settled.facts.wallClock.settledBy, "agent");
  } finally {
    await app.close();
  }
});

test("wall-clock far past the cooldown never auto-settles a turn without an active resolve", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city } = await openCity(app, repository);
    await scheduler.pollOnce();
    const before = (await repository.getCityForScheduler(city.id)).state;

    clock.advance(10 * TURN_COOLDOWN_SECONDS * 1000);
    const sweep = await scheduler.pollOnce();
    assert.equal(sweep.filter((entry) => entry.status === "deadline_resolved").length, 0, "the scheduler never settles a turn");
    assert.equal(sweep.length, 0, "an active overdue turn is not due for any scheduler action");

    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.turn, 0, "no turn advanced from elapsed wall-clock");
    assert.equal(state.gameplay.turnStatus, "open", "the turn stays open until someone resolves it");
    assert.equal(state.gameplay.resources.coins, before.gameplay.resources.coins, "no income was granted without a settlement");
  } finally {
    await app.close();
  }
});

test("the scheduler opens exactly one next turn at the unlock slot and never manufactures turns", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();
    clock.advance(TURN_COOLDOWN_SECONDS * 1000);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-slot" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.turn, 1);
    const incomeAfterFirst = (await repository.getCityForScheduler(city.id)).state.gameplay.resources.coins;

    clock.advance(5 * 86_400_000);
    const results = await scheduler.pollOnce();
    const opened = results.filter((entry) => entry.status === "opened");
    assert.equal(opened.length, 1, "exactly one turn opens no matter how much wall-clock elapsed");

    const { state } = await repository.getCityForScheduler(city.id);
    assert.equal(state.turn, 1, "opening the next turn does not manufacture an extra settlement");
    assert.equal(state.gameplay.turnStatus, "open");
    assert.equal(state.gameplay.resources.coins, incomeAfterFirst, "no income was granted for the skipped time");

    const noop = await scheduler.pollOnce();
    assert.equal(noop.length, 0, "re-polling the same moment opens nothing further");
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
    assert.equal(dueActionFor(untouched, clock.now()), null, "an active turn is never due to be settled or advanced");
  } finally {
    await app.close();
  }
});

test("a server restart re-discovers unlockable turns from persisted timestamps", async () => {
  const clock = fakeClock();
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "magictown-scheduler-"));
  const storagePath = path.join(storageDir, "state.json");

  const first = createMemoryRepository(config, { storagePath });
  const app1 = await createApp({ repository: first, config, now: clock.now, logger: false });
  const scheduler1 = createTurnScheduler({ repository: first, config, now: clock.now, logger: { error() {} } });
  let cityId;
  try {
    const { city, agent } = await openCity(app1, first);
    cityId = city.id;
    await scheduler1.pollOnce();
    clock.advance(TURN_COOLDOWN_SECONDS * 1000);
    const before = await json(app1, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await json(app1, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-restart" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    // The server "goes down" before it opens the next turn.
  } finally {
    scheduler1.stop();
    await app1.close();
  }

  const second = createMemoryRepository(config, { storagePath });
  const app2 = await createApp({ repository: second, config, now: clock.now, logger: false });
  const scheduler2 = createTurnScheduler({ repository: second, config, now: clock.now, logger: { error() {} } });
  try {
    const rows = await second.scanCitiesForScheduler(clock.iso());
    assert.equal(rows.length, 1, "the persisted unlockable city is rediscovered after restart");
    const results = await scheduler2.pollOnce();
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "opened", "the restarted scheduler only opens the next turn, never settles");
    const { state } = await second.getCityForScheduler(cityId);
    assert.equal(state.turn, 1);
    assert.equal(state.gameplay.turnStatus, "open");
  } finally {
    scheduler2.stop();
    await app2.close();
  }
});

test("the strategy context exposes cooldown fields read-only plus playbook guidance", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app, scheduler } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    await scheduler.pollOnce();
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(before.turn_status, "open");
    assert.equal(before.turn_deadline_at, null, "the deprecated deadline field is always null");
    assert.equal(before.next_turn_unlock_at, new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString());
    assert.ok(Array.isArray(before.gameplay_guidance), "progressive playbook guidance is disclosed");
    assert.ok(before.gameplay_guidance.length > 0);
    assert.match(before.playbook_url, /agent\/playbook\.md$/);

    const snapshot = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/snapshot` }), 200);
    assert.ok(Array.isArray(snapshot.gameplay_guidance) && snapshot.gameplay_guidance.length > 0, "the snapshot read model discloses guidance");
    assert.match(snapshot.links.playbook, /agent\/playbook\.md$/, "the snapshot points at the playbook");
  } finally {
    await app.close();
  }
});

test("OpenAPI advertises the cooldown read-only fields and guidance", async () => {
  const repository = createMemoryRepository(config);
  const { app } = await setup(fakeClock(), repository);
  try {
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    const context = openapi.components.schemas.StrategyContext.properties;
    assert.ok("turn_deadline_at" in context);
    assert.ok("next_turn_unlock_at" in context);
    assert.ok("settled_by" in context);
    assert.ok("gameplay_guidance" in context);
    assert.ok("playbook_url" in context);
    assert.ok("unaddressedIncidents" in openapi.components.schemas.TurnFacts.properties);
  } finally {
    await app.close();
  }
});

test("Agent API cannot forge unlock, deadline, force, or scheduler trigger fields", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
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
    assert.equal(after.state.gameplay.nextTurnUnlockAt, null, "no unlock was forged into state (no scheduler poll happened)");
    assert.equal(after.state.gameplay.turnDeadlineAt, null, "no deadline was forged into state");
    assert.equal(after.state.turn, 0);
  } finally {
    await app.close();
  }
});

test("pure domain transitions are deterministic and injectable-clock driven", () => {
  const clock = fakeClock();
  const base = { version: 0, turn: 0, gameplay: { turnStatus: "open", turnOpenedAt: null, turnDeadlineAt: null, nextTurnUnlockAt: null, scheduler: null } };
  assert.equal(dueActionFor(base, clock.now()), "init");
  const initialized = initializeTurnSchedule(base, clock.now(), config);
  assert.equal(initialized.gameplay.turnDeadlineAt, null, "initialization writes no deadline");
  assert.equal(initialized.gameplay.nextTurnUnlockAt, new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString());
  assert.equal(isTurnResolveLocked(initialized, clock.now()), true, "the fresh turn is locked until its cooldown elapses");
  assert.equal(dueActionFor(initialized, clock.now()), null);
  clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1);
  assert.equal(isTurnResolveLocked(initialized, clock.now()), false, "the turn unlocks exactly at the cooldown");
  assert.equal(dueActionFor(initialized, clock.now()), null, "an unlocked active turn still needs an active resolve; it is never due");

  const resolved = { version: 2, turn: 1, gameplay: { ...initialized.gameplay, turnStatus: "resolved", turnOpenedAt: clock.iso(), nextTurnUnlockAt: new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString(), scheduler: { openedAt: clock.iso() } } };
  assert.equal(shouldOpenNextTurn(resolved, clock.now()), false);
  clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1);
  assert.equal(shouldOpenNextTurn(resolved, clock.now()), true);
  assert.equal(dueActionFor(resolved, clock.now()), "open-next");
  const opened = openNextTurn(resolved, clock.now(), config);
  assert.equal(opened.gameplay.turnStatus, "open");
  assert.equal(opened.gameplay.turnDeadlineAt, null);
  assert.equal(opened.gameplay.nextTurnUnlockAt, new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString(), "the reopened turn gets its own cooldown gate");
});

test("an immediate Agent resolve anchors the next unlock to the openedAt slot", () => {
  const clock = fakeClock("2026-08-01T00:00:00.000Z");
  const openedAt = clock.iso();
  const base = { version: 0, turn: 0, gameplay: { schemaVersion: 1, turnStatus: "open", turnOpenedAt: openedAt, turnDeadlineAt: null, nextTurnUnlockAt: new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString(), scheduler: { schemaVersion: 1, openedAt, resolvedAt: null, settledBy: null } } };
  const immediate = resolveTurn(structuredClone(base), {}, {
    seed: "cadence-test",
    now: () => clock.iso(),
    options: { turnCooldownSeconds: TURN_COOLDOWN_SECONDS }
  });
  assert.equal(immediate.error, null);
  const immediateUnlock = immediate.nextState.gameplay.nextTurnUnlockAt;
  assert.equal(immediateUnlock, new Date(clock.now().getTime() + TURN_COOLDOWN_SECONDS * 1000).toISOString(), "immediate resolve anchors the next unlock to the openedAt slot");
  assert.equal(immediate.nextState.gameplay.turnDeadlineAt, null);

  clock.advance((TURN_COOLDOWN_SECONDS + 1000) * 1000);
  const late = resolveTurn(structuredClone(base), {}, {
    seed: "cadence-test",
    now: () => clock.iso(),
    options: { turnCooldownSeconds: TURN_COOLDOWN_SECONDS }
  });
  assert.equal(late.error, null);
  assert.equal(late.nextState.gameplay.nextTurnUnlockAt, immediateUnlock, "a late resolve keeps the same next-turn cadence");
  assert.equal(shouldOpenNextTurn(late.nextState, clock.now()), true, "the settled turn may reopen once its slot arrived");
  const reopened = openNextTurn(late.nextState, clock.now(), { turnCooldownSeconds: TURN_COOLDOWN_SECONDS });
  assert.equal(reopened.gameplay.turnStatus, "open");
  assert.equal(reopened.turn, 1, "opening the next turn does not manufacture an extra settlement");
});

test("cooldown config only changes the timing gate, never the gameplay balance result", () => {
  const fast = { turnCooldownSeconds: 10 };
  const production = { turnCooldownSeconds: 86_400 };
  const state = (cooldown) => {
    const base = { version: 0, turn: 0, cityId: "city-x", gameplay: { schemaVersion: 1, turnStatus: "open", turnOpenedAt: "2026-08-01T00:00:00.000Z", turnDeadlineAt: null, nextTurnUnlockAt: new Date("2026-08-01T00:00:00.000Z").getTime() + cooldown.turnCooldownSeconds * 1000, scheduler: null } };
    const result = resolveTurn(structuredClone(base), {}, {
      seed: "balance-test",
      now: () => "2026-08-01T00:00:02.000Z",
      options: cooldown
    });
    assert.equal(result.error, null);
    return result.facts;
  };
  const a = state(fast);
  const b = state(production);
  assert.deepEqual(a.resourceDelta, b.resourceDelta, "resource settlement is identical across timing configs");
  assert.deepEqual(a.populationDelta, b.populationDelta);
  assert.deepEqual(a.exposureChanges, b.exposureChanges);
  assert.deepEqual(a.incidents, b.incidents);
});

test("a new city resource contract is coins-only with a single authoritative ledger", () => {
  const world = {
    mapId: "resource-test",
    grid: {
      columns: 5,
      rows: 5,
      cellWorldSize: 4,
      cells: Array.from({ length: 25 }, (_, index) => {
        const column = index % 5;
        const row = Math.floor(index / 5);
        return { id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: -row * 4 }, buildable: true, strictBuildable: true };
      })
    }
  };
  const state = createCityState(world);
  assert.deepEqual(state.resources, { coins: 600 }, "a fresh city holds only coins at the authoritative default");
  assert.deepEqual(state.gameplay.resources, { coins: 600, magic: 0 });
  assert.equal(state.gameplay.resources.coins, state.resources.coins, "state and gameplay share one coins ledger");
  assert.ok(!("timber" in state.resources) && !("stone" in state.resources), "timber/stone are never initialized as core resources");
});

test("construction spend survives settlement: balance after resolve is the debited base plus income", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config);
  const { app } = await setup(clock, repository);
  try {
    const { city, agent } = await openCity(app, repository);
    const startingCoins = (await repository.getCityForScheduler(city.id)).state.resources.coins;

    const sites = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/site-searches`, payload: { footprint: "1x1", limit: 10 } }), 200);
    const site = sites.data[0];
    const build = {
      expected_city_version: sites.city_version,
      site: { lot_id: site.lotId, footprint: "1x1", entrance: "south" },
      program: { archetype: "starter_residence", name: "Ledger Cottage", purpose: "residential" },
      design: { district_style: "london_common", creative_brief: "A warm brick cottage." },
      asset: { mode: "reuse", asset_id: "starter-cottage-001" }
    };
    const preview = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${city.id}/construction-previews`, payload: build }), 200);
    assert.equal(preview.feasible, true);
    assert.ok(preview.cost.coins > 0, "construction debits coins");

    const order = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/construction-orders`,
      headers: { "idempotency-key": "ledger-build-1" },
      payload: build
    }), 201);
    assert.equal(order.status, "completed");

    const spentState = (await repository.getCityForScheduler(city.id)).state;
    const spentBalance = spentState.resources.coins;
    assert.equal(spentBalance, startingCoins - preview.cost.coins, "the construction cost was debited from state.resources");

    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "ledger-resolve-1" },
      payload: { expected_city_version: order.city_version_after }
    }), 200);
    assert.equal(settled.status, "resolved");

    const afterState = (await repository.getCityForScheduler(city.id)).state;
    const income = settled.facts.resourceDelta.coins;
    assert.equal(afterState.resources.coins, spentBalance + income, "settlement starts from the debited balance, never wiping the construction cost");
    assert.equal(afterState.gameplay.resources.coins, afterState.resources.coins, "state and gameplay coins share one ledger after settlement");
  } finally {
    await app.close();
  }
});

test("legacy timber/stone resource overrides never become a second authoritative ledger on resolve", () => {
  const world = {
    mapId: "resource-legacy-test",
    grid: {
      columns: 5,
      rows: 5,
      cellWorldSize: 4,
      cells: Array.from({ length: 25 }, (_, index) => {
        const column = index % 5;
        const row = Math.floor(index / 5);
        return { id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: -row * 4 }, buildable: true, strictBuildable: true };
      })
    }
  };
  // A caller still injecting legacy fields must not make them authoritative:
  // settlement only advances the coins ledger.
  const state = createCityState(world, { resources: { coins: 900, timber: 800, stone: 700 } });
  state.gameplay.resources = { coins: 900, magic: 0 };
  const { nextState, facts } = resolveTurn(structuredClone(state), {}, {
    seed: "ledger-test",
    now: () => "2026-08-01T00:00:00.000Z",
    options: { turnCooldownSeconds: 60 }
  });
  assert.equal(nextState.gameplay.resources.coins, 900 + facts.resourceDelta.coins, "gameplay is the single coins authority");
  assert.equal(nextState.gameplay.resources.coins, nextState.resources.coins, "state.resources follows the gameplay ledger");
  assert.deepEqual(facts.resourceDelta, { coins: 24, magic: 0 });
});

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
