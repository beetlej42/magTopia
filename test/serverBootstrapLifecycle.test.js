import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-bootstrap-lifecycle",
  assetProvider: "fixture",
  workerPollMs: 5,
  gameplaySeed: 7,
  turnCooldownSeconds: 60,
  turnSchedulerPollMs: 5
};

test("bootstrap is a read-only no-card turn and Turn 1 receives the first canonical offer", async () => {
  const clock = fakeClock();
  const repository = createMemoryRepository(config, { now: clock.now });
  const app = await createApp({ repository, config, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config, now: clock.now, logger: { error() {} } });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Bootstrap Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Bootstrap City", map_seed: "bootstrap-lifecycle" } }), 201);
    const owner = await repository.authenticate(player.access_token);
    const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const agent = await json(app, { method: "POST", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);

    const snapshot = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/snapshot` }), 200);
    assert.equal(snapshot.bootstrap.progress.gatewayNodeId, "old_town_entry");
    assert.ok(snapshot.bootstrap.progress.gatewayLocation.cell_id);
    assert.equal(snapshot.agent_turn_plan.next_action.url.endsWith("/districts"), true);
    assert.equal(snapshot.agent_turn_plan.next_action.headers["Idempotency-Key"], `bootstrap-district-v${snapshot.city_version}`);
    const starterBounds = snapshot.agent_turn_plan.next_action.body.bounds;
    assert.equal(starterBounds.maxColumn - starterBounds.minColumn + 1, 5);
    assert.equal(starterBounds.maxRow - starterBounds.minRow + 1, 6);
    assert.ok(starterBounds.maxColumn < snapshot.bootstrap.progress.gatewayLocation.column);
    assert.equal(snapshot.construction_price_guide.currency, "coins");
    assert.deepEqual(snapshot.population.current.muggles, { current: 0, capacity: 0 });
    assert.equal(snapshot.public_service.serviceCoverage, 0);
    assert.equal(snapshot.economy.current.coins, snapshot.resources.coins);
    assert.ok(snapshot.development_priorities.some((entry) => entry.system === "economy"));
    assert.ok(snapshot.development_priorities.some((entry) => entry.system === "arcane_energy"));
    assert.deepEqual(
      snapshot.agent_turn_plan.starter_builds[0].gameplay_profile,
      { purpose: "residential", magic_ratio: 0 },
      "bootstrap examples separate system magic ratio from visual magic level"
    );
    assert.equal(snapshot.links.viewer, `${config.publicBaseUrl}/cities/${city.id}`);

    const getSites = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/site-searches?footprint=1x1&limit=2` }), 200);
    assert.equal(getSites.city_version, snapshot.city_version);
    assert.equal(getSites.data.length, 2, "the low-friction GET fallback returns candidates instead of a 404");

    const badSpatial = await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/spatial?min_col=-1&max_col=2&min_row=0&max_row=2` }));
    assert.equal(badSpatial.statusCode, 400);
    assert.equal(badSpatial.json().code, "SPATIAL_BOUNDS_OUT_OF_RANGE");
    assert.equal(badSpatial.json().details.grid.columns, snapshot.world.grid.columns);
    assert.match(badSpatial.json().details.recovery, /grid limits/i);

    const first = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    const second = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(first.turn, 0);
    assert.equal(first.offer, null);
    assert.equal(first.choice.status, "not_applicable");
    assert.equal(second.city_version, first.city_version, "bootstrap card reads never persist state");

    const strategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(strategy.turn_kind, "bootstrap");
    assert.equal(strategy.bootstrap.progress.gatewayConnected, false);
    assert.match(strategy.bootstrap.guidance, /advisory/i);

    const rejected = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/cards/select`,
      headers: { "idempotency-key": "bootstrap-card-select" },
      payload: { expected_city_version: first.city_version, offer_id: "legacy-offer", selected_card_id: "ministry-grant" }
    }), 422);
    assert.equal(rejected.code, "BOOTSTRAP_TURN_NO_CARD");

    // Simulate an old archive: it has no schedule and contains a stale selected
    // Turn-0 offer with forged effects. The scheduler may repair timing only.
    const beforeLegacy = await repository.getCity(owner, city.id);
    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "test/legacy-bootstrap",
      idempotencyKey: "legacy-bootstrap-1",
      requestBody: {},
      expectedVersion: beforeLegacy.state.version
    }, async ({ state }) => {
      const next = structuredClone(state);
      next.version += 1;
      next.gameplay.turnKind = "normal";
      next.gameplay.turnOpenedAt = null;
      next.gameplay.nextTurnUnlockAt = null;
      next.gameplay.scheduler = null;
      next.gameplay.cardState.offer = { offerId: "legacy-offer", turn: 0, offeredCardIds: ["ministry-grant", "wizard-settlement-initiative", "diagon-alley-entrance"], generatedAt: clock.now().toISOString() };
      next.gameplay.cardState.choice = { offerId: "legacy-offer", status: "selected", selectedCardId: "ministry-grant", decisionMode: "immediate", choiceResolvedAt: clock.now().toISOString(), cardEffects: { resources: { coins: 999999 } } };
      const cell = Object.values(next.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
      next.cells[cell.id].occupancy = "building-bootstrap-home";
      next.buildings["building-bootstrap-home"] = { id: "building-bootstrap-home", status: "completed", footprintCells: [cell.id], program: { purpose: "residential", name: "Bootstrap Home" } };
      next.events.push({ type: "construction_reserved", turn: 0, proposalId: "proposal-bootstrap", reservationId: "reservation-bootstrap" });
      next.events.push({ type: "construction_reservation_completed", turn: 0, reservationId: "reservation-bootstrap", buildingId: "building-bootstrap-home" });
      return { nextState: next, response: { seeded: true } };
    });

    const repaired = await scheduler.pollOnce();
    assert.equal(repaired.some((entry) => entry.status === "opened"), true);
    let scheduled = await repository.getCityForScheduler(city.id);
    assert.equal(scheduled.state.turn, 0);
    assert.equal(scheduled.state.gameplay.turnStatus, "open", "schedule repair never settles bootstrap");
    assert.ok(scheduled.state.gameplay.nextTurnUnlockAt);
    assert.equal((await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200)).offer, null);

    clock.advance(60_000);
    await scheduler.pollOnce();
    scheduled = await repository.getCityForScheduler(city.id);
    assert.equal(scheduled.state.turn, 0, "elapsed wall clock never auto-resolves bootstrap");

    const unlocked = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-bootstrap" },
      payload: { expected_city_version: unlocked.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.ok(settled.agent_turn_plan?.next_action, "resolve returns the next handoff without a follow-up strategy read");
    assert.equal(settled.facts.turnKind, "bootstrap");
    assert.equal(settled.facts.choiceStatus, "not_applicable");
    assert.equal(settled.facts.selectedCardId, null);
    assert.equal(settled.facts.cardEffects.resources, undefined, "legacy selected effects are discarded");
    assert.deepEqual(settled.facts.buildingsStarted, ["building-bootstrap-home"]);
    assert.equal(settled.facts.buildingsStarted.includes("forged"), false);
    assert.ok(settled.facts.constructionRefs.some((entry) => entry.reservationId === "reservation-bootstrap"));

    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    assert.equal(context.turnKind, "bootstrap");
    assert.ok(context.bootstrapProgress);
    assert.ok(context.factRefs.includes("fact-building-building-bootstrap-home"));
    assert.ok(context.constructionRefs.some((entry) => entry.reservationId === "reservation-bootstrap"));

    const opened = await scheduler.pollOnce();
    assert.equal(opened.some((entry) => entry.status === "opened"), true);
    let normal = await repository.getCityForScheduler(city.id);
    assert.equal(normal.state.turn, 1);
    assert.equal(normal.state.gameplay.turnStatus, "open");
    assert.equal(normal.state.gameplay.cardState.offer.turn, 1);
    assert.equal(normal.state.gameplay.cardState.offer.offeredCardIds.length, 3);

    // Stale descriptive metadata cannot turn an authoritative Turn 1 back into
    // bootstrap or hide its offer.
    normal.state.gameplay.turnKind = "bootstrap";
    const turnOneCards = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/cards/current` }), 200);
    assert.equal(turnOneCards.turn, 1);
    assert.equal(turnOneCards.offer.cards.length, 3);
    const turnOneStrategy = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(turnOneStrategy.turn_kind, "normal");
    assert.equal(turnOneStrategy.bootstrap, null);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

function fakeClock(start = "2026-08-01T00:00:00.000Z") {
  let ms = new Date(start).getTime();
  return { now: () => new Date(ms), advance: (amount) => { ms += amount; } };
}

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
