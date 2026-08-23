import assert from "node:assert/strict";
import test from "node:test";
import {
  ECONOMY_RULES,
  capacitiesFromCanonicalUnits,
  incomeForCanonicalBuildings,
  migratePopulationBucket,
  residentialCapacityForUnit
} from "../src/gameplay/economy.js";
import { runNoServiceScenario } from "../src/gameplay/simulation-harness.js";
import { createCityState } from "../src/city/state.js";
import { resolveTurn } from "../src/gameplay/simulation.js";
import { normalizeTurnFacts } from "../src/gameplay/schema.js";

test("residential functional cells split discrete capacity into integer buckets", () => {
  assert.deepEqual(residentialCapacityForUnit({ purpose: "residential", area: 1, magicRatio: 0.25 }), { muggles: 3, wizards: 1 });
  assert.deepEqual(capacitiesFromCanonicalUnits([
    { purpose: "residential", area: 2, magicRatio: 0.5 },
    { purpose: "commercial", area: 20, magicRatio: 1 }
  ]), { muggles: 4, wizards: 4 });
});

test("population moves toward the no-service 50% target without overshoot", () => {
  let population = { current: 0, capacity: 20 };
  const target = 10;
  const observed = [];
  for (let turn = 0; turn < 20; turn += 1) {
    population = migratePopulationBucket(population, target, ECONOMY_RULES.defaultMigrationRate);
    observed.push(population.current);
  }
  assert.equal(observed[0], 3);
  assert.equal(observed.at(-1), target);
  assert.ok(observed.every((value, index) => value <= target && (index === 0 || value >= observed[index - 1])));
});

test("capacity reductions migrate residents out and preserve signed deltas", () => {
  const first = runNoServiceScenario(1);
  assert.equal(first.final.population.muggles.current, 1);
  // The pure migration function never overshoots when a target is lowered.
  assert.deepEqual(migratePopulationBucket({ current: 4, capacity: 4 }, 0, 0.25), { current: 3, capacity: 4 });
  const facts = normalizeTurnFacts({ populationDelta: { muggles: { current: -1, capacity: -2 }, wizards: {} } });
  assert.deepEqual(facts.populationDelta.muggles, { current: -1, capacity: -2 });
});

test("canonical income uses start-of-turn residents and preserves AE fractions", () => {
  const metadata = {
    residence: { canonical: true, units: [{ purpose: "residential", area: 1, magicRatio: 0.5 }] },
    market: { canonical: true, units: [{ purpose: "commercial", area: 1, magicRatio: 0.5 }] },
    factory: { canonical: true, units: [{ purpose: "production", area: 1, magicRatio: 0 }] },
    glasshouse: { canonical: true, units: [{ purpose: "greenhouse", area: 1, magicRatio: 1 }] }
  };
  assert.deepEqual(incomeForCanonicalBuildings(metadata, {
    muggles: { current: 2 },
    wizards: { current: 2 }
  }), { coins: 50, arcaneEnergy: 7 });
});

test("invalid persisted canonical units are unsupported and cannot leak legacy output", () => {
  const invalid = {
    broken: { canonical: true, units: [{ purpose: "residential", area: 1, magicRatio: 0.63 }] },
    legacy: { canonical: false, coinOutput: 9999, magicOutput: 9999, muggleCapacity: 9999 }
  };
  assert.deepEqual(incomeForCanonicalBuildings(invalid, { muggles: { current: 0 }, wizards: { current: 0 } }), { coins: 0, arcaneEnergy: 0 });
  assert.deepEqual(capacitiesFromCanonicalUnits(invalid.broken.units), { muggles: 0, wizards: 0 });
});

test("reproducible no-service harness shows gradual population and differentiated outputs", () => {
  const result = runNoServiceScenario(12);
  assert.equal(result.turns[0].population.muggles.current, 1);
  assert.equal(result.turns[0].population.wizards.current, 1);
  assert.equal(result.final.population.muggles.current, 2);
  assert.equal(result.final.population.wizards.current, 2);
  assert.equal(result.capacities.muggles, 4);
  assert.equal(result.capacities.wizards, 4);
  assert.ok(result.final.resources.arcaneEnergy % 1 !== 0, "greenhouse + wizard income accumulates fractional AE");
  assert.ok(result.final.resources.coins > ECONOMY_RULES.initialCoins);
});

test("resolveTurn freezes start-population income before migration and is retry-safe", () => {
  const cells = [];
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
    cells.push({ id: `cell-${column}-${row}`, column, row, buildable: true });
  }
  const state = createCityState({ mapId: "economy-fixture", grid: { columns: 4, rows: 4, cells } });
  state.gameplay.population = {
    muggles: { current: 1, capacity: 3 },
    wizards: { current: 1, capacity: 1 }
  };
  state.buildings.home = {
    id: "home", status: "completed", footprintCells: ["cell-1-1"],
    gameplay: { canonical: true, units: [{ purpose: "residential", area: 1, magicRatio: 0.25 }] }
  };
  state.buildings.shop = {
    id: "shop", status: "completed", footprintCells: ["cell-2-1"],
    gameplay: { canonical: true, units: [{ purpose: "commercial", area: 1, magicRatio: 0.5 }] }
  };
  state.cells["cell-1-1"].occupancy = "home";
  state.cells["cell-2-1"].occupancy = "shop";
  const result = resolveTurn(state, {}, { seed: "economy-fixture", now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(result.error, null);
  assert.deepEqual(result.facts.resourceDelta, { coins: 16, arcaneEnergy: 0.75 });
  assert.deepEqual(result.facts.populationDelta.muggles, { current: 1, capacity: 0 });
  assert.deepEqual(result.nextState.gameplay.population.muggles, { current: 2, capacity: 3 });
  assert.deepEqual(result.nextState.gameplay.resources, { coins: 616, arcaneEnergy: 0.75 });
  const retry = resolveTurn(result.nextState, {}, { seed: "different", now: () => "2026-08-24T00:00:00.000Z" });
  assert.equal(retry.error.code, "TURN_ALREADY_RESOLVED");
  assert.equal(retry.nextState, result.nextState);
});
