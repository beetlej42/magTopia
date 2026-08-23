import assert from "node:assert/strict";
import test from "node:test";
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
});
