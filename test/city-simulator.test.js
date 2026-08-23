import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { getEntranceFrontageCells } from "../src/city/solver.js";
import { createBlankVoxelWorldContract } from "../src/city/voxel-world.js";
import { resolvePublicServiceBaselineTurn, resolveTurn } from "../src/gameplay/simulation.js";
import { runCitySimulation } from "../src/gameplay/city-simulator.js";

test("headless city simulation is deterministic and uses the canonical ledger", () => {
  const first = runCitySimulation({ turns: 20, strategy: "balanced", seed: "test-city" });
  const second = runCitySimulation({ turns: 20, strategy: "balanced", seed: "test-city" });
  assert.deepEqual(first, second);
  assert.equal(first.timeline.length, 20);
  assert.equal(first.summary.anomalies.length, 0);
  assert.ok(first.summary.cumulativeConstruction.buildings > 0);
  assert.ok(first.timeline.every((entry) => entry.invariants.every((invariant) => invariant.ok)));
  assert.ok(first.timeline.some((entry) => entry.construction.spend > 0));
  assert.ok(first.timeline.some((entry) => entry.coins.income > 0));
  assert.ok(first.finalState.events.some((event) => event.type === "building_constructed"));
});

test("simulated buildings all expose a legal road-fronting entrance and ledger spends roads", () => {
  const report = runCitySimulation({ turns: 30, strategy: "balanced", seed: "audit" });
  const state = report.finalState;
  for (const building of Object.values(state.buildings)) {
    const frontage = getEntranceFrontageCells(state, building.footprintCells, building.site.entrance);
    assert.ok(frontage.includes(building.site.entranceCellId));
    assert.ok(frontage.some((cellId) => state.cells[cellId]?.infrastructure === "road" || state.infrastructure[cellId]?.type === "bridge"));
  }
  assert.ok(report.summary.cumulativeRoad.coins > 0);
  assert.ok(report.summary.cumulativeRoad.cells > 0);
  assert.ok(report.timeline.every((entry) => entry.invariants.every((invariant) => invariant.ok)));
});

test("baseline settlement is an explicit PR-D profile while production retains later systems", () => {
  const world = createBlankVoxelWorldContract({ seed: "profile", columns: 10, rows: 10, terrainSubdivisions: 4 });
  const state = createCityState(world, { cityId: "profile-city" });
  const production = resolveTurn(state, {}, { now: () => "2040-01-02T08:00:00.000Z", seed: "profile" });
  const baseline = resolvePublicServiceBaselineTurn(state, {}, { now: () => "2040-01-02T08:00:00.000Z", seed: "profile" });
  assert.equal(production.error, null);
  assert.equal(baseline.error, null);
  assert.ok(production.nextState.gameplay.cardState.offer);
  assert.equal(baseline.nextState.gameplay.cardState.offer, null);
  assert.equal(baseline.facts.incidents.length, 0);
});

test("schedule is monotonic through the authoritative openNextTurn transition and retry is rejected", () => {
  const report = runCitySimulation({ turns: 100, strategy: "balanced", seed: "schedule" });
  const reopened = report.timeline.map((entry) => entry.schedule.reopenedAt);
  const resolved = report.timeline.map((entry) => entry.schedule.resolvedAt);
  assert.ok(reopened.every((value, index) => index === 0 || value > reopened[index - 1]));
  assert.ok(resolved.every((value, index) => index === 0 || value > resolved[index - 1]));
  assert.ok(report.timeline.every((entry) => entry.actions.some((action) => action.type === "resolve_turn_retry" && !action.accepted && action.code === "TURN_ALREADY_RESOLVED" && action.stateUnchanged)));
});

test("public service changes coverage, target and migration rate in the report", () => {
  const report = runCitySimulation({ turns: 30, strategy: "balanced", seed: "coverage" });
  const entries = report.timeline.map((entry) => entry.publicService);
  assert.ok(entries.some((entry) => entry.coverage > 0));
  assert.ok(entries.at(-1).target.total <= report.finalState.gameplay.population.muggles.capacity + report.finalState.gameplay.population.wizards.capacity);
  assert.ok(entries.every((entry) => Number.isFinite(entry.coverage) && Object.values(entry.migrationRates).every(Number.isFinite)));
});
test("all supported strategies run 30 turns and intentionally diverge", () => {
  const strategies = ["balanced", "housing-first", "economy-first", "service-first"];
  const reports = strategies.map((strategy) => runCitySimulation({ turns: 30, strategy, seed: "strategy-city" }));
  assert.ok(reports.every((report) => report.timeline.length === 30));
  assert.ok(reports.every((report) => report.summary.anomalies.length === 0));
  const signatures = new Set(reports.map((report) => JSON.stringify(report.summary.cumulativeConstruction.byPurpose)));
  assert.equal(signatures.size, strategies.length);
  assert.ok(reports.every((report) => report.timeline.every((entry) => entry.invariants.every((invariant) => invariant.ok))));
});

test("invalid simulator arguments fail clearly", () => {
  assert.throws(() => runCitySimulation({ turns: 0 }), /turns must be an integer/);
  assert.throws(() => runCitySimulation({ turns: 20, strategy: "random" }), /strategy must be one of/);
  const json = spawnSync(process.execPath, ["scripts/simulate-city.mjs", "--turns", "20", "--strategy", "balanced", "--seed", "cli", "--json"], { encoding: "utf8" });
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).summary.turns, 20);
  const invalid = spawnSync(process.execPath, ["scripts/simulate-city.mjs", "--turns", "nope"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /turns must be an integer/);
});
