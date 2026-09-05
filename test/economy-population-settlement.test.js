import assert from "node:assert/strict";
import test from "node:test";
import {
  ECONOMY_RULES,
  capacitiesFromCanonicalUnits,
  capacitiesFromSettlementMetadata,
  incomeForCanonicalBuildings,
  incomeForSettlement,
  migratePopulationBucket,
  publicServiceCoverageForSettlement,
  supportedPopulationTargetsForSettlement,
  residentialCapacityForUnit,
  supportedPopulationTargets,
  systemOwnedBonusForBuilding,
  EconomyDataError
} from "../src/gameplay/economy.js";
import { runNoServiceScenario, runPublicServiceScenario } from "../src/gameplay/simulation-harness.js";
import { createCityState } from "../src/city/state.js";
import { resolveTurn, settlePopulation } from "../src/gameplay/simulation.js";
import { GAMEPLAY_SCHEMA_VERSION, normalizeGameplayResources, normalizeTurnFacts } from "../src/gameplay/schema.js";
import { executeCityCommand } from "../src/city/engine.js";
import { getCard } from "../src/gameplay/card-catalog.js";
import { buildReportContext, factsDigest } from "../src/gameplay/owl-report.js";
import { calculateDailyIncome } from "../src/city/engine.js";

test("residential functional cells split discrete capacity into integer buckets", () => {
  assert.deepEqual(residentialCapacityForUnit({ purpose: "residential", area: 1, magicRatio: 0.25 }), { muggles: 3, wizards: 1 });
  assert.deepEqual(capacitiesFromCanonicalUnits([
    { purpose: "residential", area: 2, magicRatio: 0.5 },
    { purpose: "commercial", area: 20, magicRatio: 1 }
  ]), { muggles: 4, wizards: 4 });
});

test("joint supported targets round total housing once and use largest-remainder ties", () => {
  assert.deepEqual(supportedPopulationTargets({ muggles: 3, wizards: 1 }), { muggles: 2, wizards: 0, total: 2, source: "occupancy" });
  assert.deepEqual(supportedPopulationTargets({ muggles: 0, wizards: 1 }), { muggles: 0, wizards: 1, total: 1, source: "occupancy" });
  assert.deepEqual(supportedPopulationTargets({ muggles: 2, wizards: 2 }), { muggles: 1, wizards: 1, total: 2, source: "occupancy" });
  assert.deepEqual(supportedPopulationTargets({ muggles: 3, wizards: 1 }, { supportedTargetPopulation: { muggles: 3, wizards: 1 } }), { muggles: 3, wizards: 1, total: 4, source: "explicit_absolute" });
  assert.equal(supportedPopulationTargets({ muggles: 3, wizards: 1 }, { supportedTargetPopulation: { muggles: 99, wizards: 99 } }).total, 4);
});

test("public service uses Manhattan radius 5 and counts vertical functional area once", () => {
  const state = {
    cells: Object.fromEntries([
      ["home", { column: 0, row: 0 }],
      ["service-at-5", { column: 0, row: 5 }],
      ["service-at-6", { column: 0, row: 6 }]
    ]),
    buildings: {
      home: { footprintCells: ["home"] },
      service: { footprintCells: ["service-at-5"] }
    }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 3, magicRatio: 0.5 }] },
    service: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 2, magicRatio: 0 }] }
  };
  const covered = publicServiceCoverageForSettlement(state, metadata);
  assert.equal(covered.radius, 5);
  assert.equal(covered.details[0].serviceArea, 2, "two vertical service units count once, not once per footprint cell");
  assert.equal(covered.details[0].serviceCoverage, 1, "two service functional cells support three residential functional cells");
  state.buildings.service.footprintCells = ["service-at-6"];
  assert.equal(publicServiceCoverageForSettlement(state, metadata).details[0].serviceCoverage, 0, "distance 6 is outside the radius");
});

test("service target is computed per residential unit before aggregation", () => {
  const state = {
    cells: { high: { column: 0, row: 0 }, low: { column: 10, row: 0 }, service: { column: 0, row: 5 } },
    buildings: { high: { footprintCells: ["high"] }, low: { footprintCells: ["low"] }, service: { footprintCells: ["service"] } }
  };
  const metadata = {
    high: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 2, magicRatio: 0.75 }] },
    low: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 2, magicRatio: 0 }] },
    service: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 2, magicRatio: 0 }] }
  };
  const target = supportedPopulationTargetsForSettlement(state, metadata);
  const byBuilding = Object.fromEntries(target.service.details.map((detail) => [detail.buildingId, detail]));
  assert.equal(byBuilding.high.serviceCoverage, 1);
  assert.equal(byBuilding.low.serviceCoverage, 0);
  assert.deepEqual(byBuilding.high.supportedTarget, { muggles: 2, wizards: 4, total: 6 });
  assert.deepEqual(byBuilding.low.supportedTarget, { muggles: 4, wizards: 0, total: 4 });
  assert.deepEqual(target, supportedPopulationTargetsForSettlement(state, metadata), "spatial target is deterministic");

  metadata.high.units[0].magicRatio = 0;
  metadata.low.units[0].magicRatio = 0.75;
  const reverse = supportedPopulationTargetsForSettlement(state, metadata);
  const reverseByBuilding = Object.fromEntries(reverse.service.details.map((detail) => [detail.buildingId, detail]));
  assert.deepEqual(reverseByBuilding.high.supportedTarget, { muggles: 6, wizards: 0, total: 6 });
  assert.deepEqual(reverseByBuilding.low.supportedTarget, { muggles: 1, wizards: 3, total: 4 });
});

test("one service source shares finite capacity across four, five, and eight homes", () => {
  const coordinates = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 0], [1, 1], [1, 2]];
  const metadataFor = (count) => {
    const metadata = { service: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] } };
    for (let index = 0; index < count; index += 1) {
      metadata[`home-${index}`] = { canonical: true, status: "completed", units: [{ purpose: "residential", area: 1, magicRatio: 0 }] };
    }
    return metadata;
  };
  const stateFor = (count) => {
    const cells = { service: { column: 0, row: 0 } };
    const buildings = { service: { footprintCells: ["service"] } };
    for (let index = 0; index < count; index += 1) {
      const id = `home-${index}`;
      cells[id] = { column: coordinates[index][0], row: coordinates[index][1] };
      buildings[id] = { footprintCells: [id] };
    }
    return { cells, buildings };
  };
  const four = publicServiceCoverageForSettlement(stateFor(4), metadataFor(4));
  const five = publicServiceCoverageForSettlement(stateFor(5), metadataFor(5));
  const eight = publicServiceCoverageForSettlement(stateFor(8), metadataFor(8));
  assert.equal(four.serviceCapacity, 4, "source capacity is counted once");
  assert.deepEqual(four.details.map((entry) => entry.serviceCoverage), [1, 1, 1, 1]);
  assert.deepEqual(five.details.map((entry) => entry.serviceCoverage), [0.8, 0.8, 0.8, 0.8, 0.8]);
  assert.deepEqual(eight.details.map((entry) => entry.serviceCoverage), Array(8).fill(0.5));
  assert.equal(eight.serviceCapacity, 4, "adding homes cannot duplicate the same source capacity");
});

test("zero service capacity is a finite baseline with no NaN or null facts", () => {
  const state = {
    cells: { home: { column: 0, row: 0 }, service: { column: 0, row: 1 } },
    buildings: { home: { footprintCells: ["home"] }, service: { footprintCells: ["service"] } }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 2, magicRatio: 0.5 }] },
    service: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] }
  };
  const result = supportedPopulationTargetsForSettlement(state, metadata, { serviceCapacityPerFunctionalCell: 0 });
  const assertFinite = (value) => {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `non-finite value: ${value}`);
    else if (Array.isArray(value)) value.forEach(assertFinite);
    else if (value && typeof value === "object") Object.values(value).forEach(assertFinite);
  };
  assertFinite(result);
  assert.equal(result.service.serviceCapacity, 0);
  assert.equal(result.service.details[0].serviceArea, 0);
  assert.equal(result.service.details[0].serviceCoverage, 0);
  assert.equal(result.total, 4, "zero service capacity keeps the baseline 50% target");
});

test("spatial aggregate overflow rejects safe individual areas", () => {
  const area = Math.floor(Number.MAX_SAFE_INTEGER / 4);
  const cells = {};
  const buildings = {};
  const metadata = {};
  for (let index = 0; index < 5; index += 1) {
    const id = `home-${index}`;
    cells[id] = { column: index, row: 0 };
    buildings[id] = { footprintCells: [id] };
    metadata[id] = { canonical: true, status: "completed", units: [{ purpose: "residential", area, magicRatio: 0 }] };
  }
  assert.throws(() => publicServiceCoverageForSettlement({ cells, buildings }, metadata), EconomyDataError);
});

test("overlapping service units stack by functional unit, while legacy/inactive sources are ignored", () => {
  const state = {
    cells: { home: { column: 0, row: 0 }, service: { column: 0, row: 1 } },
    buildings: {
      home: { footprintCells: ["home"] },
      first: { footprintCells: ["service"] },
      second: { footprintCells: ["service"] },
      inactive: { footprintCells: ["service"] },
      sealed: { footprintCells: ["service"] },
      legacy: { footprintCells: ["service"] }
    }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 2, magicRatio: 0 }] },
    first: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] },
    second: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] },
    inactive: { canonical: true, status: "inactive", units: [{ purpose: "public_service", area: 99, magicRatio: 0 }] },
    sealed: { canonical: true, status: "sealed", units: [{ purpose: "public_service", area: 99, magicRatio: 0 }] },
    legacy: { canonical: false, status: "completed", units: [{ purpose: "public_service", area: 99, magicRatio: 0 }], publicServiceRadius: 999 }
  };
  const coverage = publicServiceCoverageForSettlement(state, metadata);
  assert.equal(coverage.details[0].serviceArea, 2);
  assert.equal(coverage.details[0].serviceCoverage, 1);
  assert.equal(coverage.serviceCapacity, 8, "overlapping source units contribute their own finite capacity once");
  assert.deepEqual(coverage.details[0].nearbyPublicServiceUnits, ["first:0", "second:0"]);
});

test("spatial service output is stable under building and unit insertion order", () => {
  const state = {
    cells: { home: { column: 0, row: 0 }, service: { column: 0, row: 1 } },
    buildings: { home: { footprintCells: ["home"] }, zed: { footprintCells: ["service"] }, alpha: { footprintCells: ["service"] } }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [
      { purpose: "residential", area: 1, magicRatio: 0 },
      { purpose: "residential", area: 1, magicRatio: 0.5 }
    ] },
    zed: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] },
    alpha: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] }
  };
  const reorderedState = {
    ...state,
    buildings: { alpha: state.buildings.alpha, home: state.buildings.home, zed: state.buildings.zed }
  };
  const reorderedMetadata = {
    zed: metadata.zed,
    home: metadata.home,
    alpha: metadata.alpha
  };
  assert.deepEqual(
    supportedPopulationTargetsForSettlement(state, metadata),
    supportedPopulationTargetsForSettlement(reorderedState, reorderedMetadata),
    "building order and functional-unit insertion order do not affect targets/details"
  );
});

test("multi-cell footprints use nearest Manhattan distance at radius 5/6", () => {
  const state = {
    cells: {
      homeA: { column: 5, row: 0 }, homeB: { column: 5, row: 1 },
      serviceA: { column: 0, row: 0 }, serviceB: { column: 0, row: 1 }
    },
    buildings: { home: { footprintCells: ["homeA", "homeB"] }, service: { footprintCells: ["serviceA", "serviceB"] } }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
    service: { canonical: true, status: "completed", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] }
  };
  assert.equal(publicServiceCoverageForSettlement(state, metadata).details[0].serviceCoverage, 1);
  state.buildings.home.footprintCells = ["homeA"];
  state.cells.homeA = { column: 6, row: 0 };
  assert.equal(publicServiceCoverageForSettlement(state, metadata).details[0].serviceCoverage, 0);
});

test("public service harness reaches a higher target and faster migration than baseline", () => {
  const baseline = runNoServiceScenario(12);
  const serviced = runPublicServiceScenario(12);
  assert.ok(serviced.final.population.muggles.current + serviced.final.population.wizards.current
    > baseline.final.population.muggles.current + baseline.final.population.wizards.current);
  assert.equal(serviced.target.service.serviceCoverage, 1);
  assert.equal(serviced.target.service.radius, 5);
  assert.ok(serviced.turns[0].population.muggles.current >= baseline.turns[0].population.muggles.current);
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

test("zero migration rate leaves both inbound and outbound population unchanged", () => {
  assert.deepEqual(migratePopulationBucket({ current: 0, capacity: 4 }, 4, 0), { current: 0, capacity: 4 });
  assert.deepEqual(migratePopulationBucket({ current: 4, capacity: 4 }, 0, 0), { current: 4, capacity: 4 });
});

test("an immediate wizard-arrival card survives its same-turn settlement", () => {
  const state = {
    cells: {},
    buildings: {},
    gameplay: {
      population: { muggles: { current: 0, capacity: 0 }, wizards: { current: 2, capacity: 2 } },
      cardState: {
        choice: {
          status: "selected",
          selectedCardId: "ordinary-people-migration",
          cardEffects: { grant: { kind: "population", requested: 2, granted: 1, capacity: 2 } }
        }
      }
    }
  };
  const metadata = {
    floo: { canonical: false, status: "completed", systemOwnedCardId: "floo-fireplace-station" }
  };

  const protectedSettlement = settlePopulation(state, metadata);
  assert.equal(protectedSettlement.target.wizards, 1, "the ordinary support target remains honest");
  assert.equal(protectedSettlement.before.wizards.current, 2);
  assert.equal(protectedSettlement.after.wizards.current, 2, "the player's immediate grant is not removed at night");

  const nextTurn = structuredClone(state);
  nextTurn.gameplay.cardState.choice = { status: "pending", cardEffects: {} };
  assert.equal(settlePopulation(nextTurn, metadata).after.wizards.current, 1, "later retention still follows public-service support");
});

test("wizard migration bonus is wizard-only and explicit wizard baselines still receive it", () => {
  const state = {
    cells: { home: { column: 0, row: 0 } },
    buildings: { home: { footprintCells: ["home"] } },
    gameplay: { population: { muggles: { current: 0 }, wizards: { current: 0 } } }
  };
  const metadata = { home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 20, magicRatio: 0.5 }] } };
  const baseline = settlePopulation(state, metadata, { wizardMigrationRate: 0.1 });
  const settled = settlePopulation(state, metadata, { wizardMigrationRateBonus: 0.2, wizardMigrationRate: 0.1 });
  assert.equal(settled.publicService.migrationRate.muggles, 0.25);
  assert.ok(Math.abs(settled.publicService.migrationRate.wizards - 0.3) < Number.EPSILON);
  assert.equal(baseline.after.muggles.current, settled.after.muggles.current, "wizard policy does not change muggle migration");
  assert.ok(settled.after.wizards.current > baseline.after.wizards.current, "wizard policy changes actual wizard migration for a large gap");
});

test("service attraction rate is not reused to accelerate outbound migration", () => {
  const state = {
    cells: { home: { column: 0, row: 0 }, service: { column: 0, row: 1 } },
    buildings: { home: { footprintCells: ["home"] }, service: { footprintCells: ["service"] } },
    gameplay: { population: { muggles: { current: 11 }, wizards: { current: 0 } } }
  };
  const metadata = {
    home: { canonical: true, status: "completed", units: [{ purpose: "residential", area: 4, magicRatio: 0 }] },
    service: { canonical: true, status: "inactive", units: [{ purpose: "public_service", area: 1, magicRatio: 0 }] }
  };
  const settled = settlePopulation(state, metadata);
  assert.equal(settled.publicService.migrationRate.muggles, 0.25);
  assert.equal(settled.publicService.outboundMigrationRate.muggles, 0.25);
  assert.equal(settled.target.muggles, 8);
  assert.equal(settled.after.muggles.current, 10, "capacity drop moves out one quarter of the gap, not forty percent");
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

test("each non-residential purpose uses its independent canonical rate", () => {
  const metadata = Object.fromEntries([
    ["commercial", "commercial"], ["public", "public_service"], ["production", "production"], ["greenhouse", "greenhouse"]
  ].map(([id, purpose]) => [id, { canonical: true, status: "completed", units: [{ purpose, area: 1, magicRatio: 0.5 }] }]));
  assert.deepEqual(incomeForCanonicalBuildings({ commercial: metadata.commercial }, {}), { coins: 12, arcaneEnergy: 0.5 });
  assert.deepEqual(incomeForCanonicalBuildings({ public: metadata.public }, {}), { coins: 0, arcaneEnergy: 0 });
  assert.deepEqual(incomeForCanonicalBuildings({ production: metadata.production }, {}), { coins: 18, arcaneEnergy: 2 });
  assert.deepEqual(incomeForCanonicalBuildings({ greenhouse: metadata.greenhouse }, {}), { coins: 12, arcaneEnergy: 3 });
});

test("sealed and inactive canonical buildings provide no fixed output or capacity, while residents still pay tax", () => {
  const metadata = {
    sealedFactory: { canonical: true, status: "sealed", units: [{ purpose: "production", area: 1, magicRatio: 1 }] },
    inactiveHome: { canonical: true, status: "inactive", units: [{ purpose: "residential", area: 1, magicRatio: 0 }] }
  };
  assert.deepEqual(incomeForCanonicalBuildings(metadata, { muggles: { current: 2 }, wizards: { current: 0 } }), { coins: 4, arcaneEnergy: 0 });
  assert.deepEqual(settlePopulation({ gameplay: { population: { muggles: { current: 0 }, wizards: { current: 0 } } } }, metadata).capacityDelta, { muggles: 0, wizards: 0 });
});

test("invalid persisted canonical units are unsupported and cannot leak legacy output", () => {
  const invalid = {
    broken: { canonical: true, units: [{ purpose: "residential", area: 1, magicRatio: 0.63 }] },
    legacy: { canonical: false, coinOutput: 9999, magicOutput: 9999, muggleCapacity: 9999 }
  };
  assert.throws(() => incomeForCanonicalBuildings(invalid, { muggles: { current: 0 }, wizards: { current: 0 } }), { code: "INVALID_ECONOMY_DATA" });
  assert.throws(() => capacitiesFromCanonicalUnits([{ purpose: "residential", area: Number.MAX_SAFE_INTEGER, magicRatio: 0 }]), { code: "INVALID_ECONOMY_DATA" });
});

test("reproducible no-service harness shows gradual population and differentiated outputs", () => {
  const result = runNoServiceScenario(12);
  assert.deepEqual(runNoServiceScenario(12), result);
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

test("construct command persists canonical vertical units before settlement", () => {
  const cells = [];
  for (let row = 0; row < 6; row += 1) for (let column = 0; column < 6; column += 1) {
    cells.push({ id: `cell-${column}-${row}`, column, row, buildable: true });
  }
  const state = createCityState({ mapId: "construct-economy", grid: { columns: 6, rows: 6, cells } }, { resources: { coins: 2000 } });
  const result = executeCityCommand(state, {
    type: "construct_building",
    proposal: {
      actor: "agent:test",
      site: { lotId: "cell-2-2", footprint: "1x1", entrance: "south" },
      program: { archetype: "starter_residence", purpose: "residential", name: "Vertical Home" },
      gameplayBuilding: { floors: [{ purpose: "residential", magicRatio: 0.5 }, { purpose: "residential", magicRatio: 0.5 }] },
      design: { districtStyle: "willow_magic", patterns: [], prompt: "A compact home." }
    }
  }, { createId: (prefix) => `${prefix}-fixture`, now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(result.accepted, true);
  const building = result.state.buildings[result.building.id];
  assert.equal(building.gameplay.canonical, true);
  assert.equal(building.gameplay.functionalAreas.residential, 2);
  const settled = resolveTurn(result.state, {}, { seed: "construct-economy", now: () => "2026-08-23T01:00:00.000Z" });
  assert.equal(settled.error, null);
  assert.deepEqual(settled.nextState.gameplay.population, { muggles: { current: 1, capacity: 4 }, wizards: { current: 1, capacity: 4 } });
  assert.deepEqual(settled.facts.resourceDelta, { coins: 0, arcaneEnergy: 0 });
});

test("corrupt persisted economy returns a clear error without changing state", () => {
  const cells = [{ id: "cell-0-0", column: 0, row: 0, buildable: true }];
  const state = createCityState({ mapId: "corrupt-economy", grid: { columns: 1, rows: 1, cells } });
  state.buildings.bad = { id: "bad", status: "completed", gameplay: { canonical: true, units: [{ purpose: "production", area: Number.MAX_SAFE_INTEGER, magicRatio: 1 }] } };
  const before = structuredClone(state);
  const result = resolveTurn(state, {}, { now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(result.error.code, "INVALID_ECONOMY_DATA");
  assert.deepEqual(state, before);
});

test("resource schema version and legacy alias migration are explicit", () => {
  const state = createCityState({ mapId: "version-economy", grid: { columns: 1, rows: 1, cells: [{ id: "cell-0-0", column: 0, row: 0, buildable: true }] } });
  assert.equal(state.gameplay.schemaVersion, GAMEPLAY_SCHEMA_VERSION);
  assert.deepEqual(normalizeGameplayResources({ coins: 10, magic: 2 }), { coins: 10, arcaneEnergy: 2 });
  assert.throws(() => normalizeGameplayResources({ coins: 10, magic: 2, arcaneEnergy: 3 }), { code: "RESOURCE_ALIAS_CONFLICT" });
  assert.deepEqual(normalizeGameplayResources({ coins: 10, magic: 2, arcaneEnergy: 2 }), { coins: 10, arcaneEnergy: 2 });
});

test("Moonlight Herb Plot uses arcaneEnergyOutput and only persisted card ids read magicOutput", () => {
  const card = getCard("moonlight-herb-plot");
  assert.equal(card.effect.arcaneEnergyOutput, 6);
  assert.equal("magicOutput" in card.effect, false);
  const cells = [];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, buildable: true });
  const state = createCityState({ mapId: "moonlight-compat", grid: { columns: 3, rows: 3, cells } });
  state.buildings.plot = { id: "plot", status: "completed", specialStructure: { cardId: "moonlight-herb-plot", effect: { magicOutput: 6 } } };
  const settled = resolveTurn(state, {}, { seed: "moonlight-compat", now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(settled.error, null);
  assert.deepEqual(settled.facts.resourceDelta, { coins: 0, arcaneEnergy: 6 });
});

test("whitelisted system cards retain catalog economy bonuses and join the housing target", () => {
  assert.deepEqual(systemOwnedBonusForBuilding({ status: "completed", specialStructure: { cardId: "owl-tower", effect: { coinOutput: 999, wizardCapacity: 999 } } }), { coins: 4, arcaneEnergy: 0, wizardCapacity: 3 });
  assert.deepEqual(systemOwnedBonusForBuilding({ status: "completed", specialStructure: { cardId: "floo-fireplace-station" } }), { coins: 5, arcaneEnergy: 0, wizardCapacity: 2 });
  assert.deepEqual(systemOwnedBonusForBuilding({ status: "completed", specialStructure: { cardId: "moonlight-herb-plot", effect: { magicOutput: 999999, arcaneEnergyOutput: 999999 } } }), { coins: 0, arcaneEnergy: 6, wizardCapacity: 0 });
  assert.equal(systemOwnedBonusForBuilding({ status: "sealed", specialStructure: { cardId: "owl-tower" } }), null);
  assert.equal(systemOwnedBonusForBuilding({ status: "completed", specialStructure: { cardId: "fake-owl-tower", effect: { coinOutput: 999, wizardCapacity: 999 } } }), null);

  const metadata = {
    owl: { canonical: false, status: "completed", systemOwnedCardId: "owl-tower", systemOwnedBonus: { coins: 777, arcaneEnergy: 999, wizardCapacity: 888 } },
    floo: { canonical: false, status: "completed", systemOwnedCardId: "floo-fireplace-station", systemOwnedBonus: { coins: 777, arcaneEnergy: 999, wizardCapacity: 888 } },
    moon: { canonical: false, status: "completed", systemOwnedCardId: "moonlight-herb-plot", systemOwnedBonus: { coins: 777, arcaneEnergy: 999, wizardCapacity: 888 } }
  };
  assert.deepEqual(capacitiesFromSettlementMetadata(metadata), { muggles: 0, wizards: 5 });
  assert.deepEqual(incomeForSettlement(metadata, {}), { coins: 9, arcaneEnergy: 6 });
  assert.deepEqual(incomeForSettlement({ forged: { canonical: false, status: "completed", systemOwnedBonus: { coins: 999, arcaneEnergy: 999, wizardCapacity: 999 } } }, {}), { coins: 0, arcaneEnergy: 0 });
  assert.deepEqual(incomeForSettlement({ forgedCard: { canonical: false, status: "completed", systemOwnedCardId: "fake-owl-tower", systemOwnedBonus: { coins: 999, arcaneEnergy: 999, wizardCapacity: 999 } } }, {}), { coins: 0, arcaneEnergy: 0 });
  assert.deepEqual(incomeForSettlement({ sealed: { ...metadata.owl, status: "sealed" } }, {}), { coins: 0, arcaneEnergy: 0 });
});

test("daily income preview has parity with resolveTurn for canonical residents, units, and system cards", () => {
  const state = createCityState({ mapId: "daily-parity", grid: { columns: 2, rows: 2, cells: [
    { id: "cell-0-0", column: 0, row: 0, buildable: true },
    { id: "cell-1-0", column: 1, row: 0, buildable: true },
    { id: "cell-0-1", column: 0, row: 1, buildable: true },
    { id: "cell-1-1", column: 1, row: 1, buildable: true }
  ] } });
  state.gameplay.population = { muggles: { current: 1, capacity: 4 }, wizards: { current: 2, capacity: 4 } };
  state.buildings.market = { id: "market", status: "completed", gameplay: { canonical: true, units: [{ purpose: "commercial", area: 1, magicRatio: 0.5 }] } };
  state.buildings.owl = { id: "owl", status: "completed", specialStructure: { cardId: "owl-tower", effect: { coinOutput: 999 } } };
  state.buildings.floo = { id: "floo", status: "completed", specialStructure: { cardId: "floo-fireplace-station", effect: { wizardCapacity: 999 } } };
  state.buildings.moon = { id: "moon", status: "completed", specialStructure: { cardId: "moonlight-herb-plot", effect: { arcaneEnergyOutput: 6 } } };
  const preview = calculateDailyIncome(state);
  const settled = resolveTurn(state, {}, { seed: "daily-parity", now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(settled.error, null);
  assert.deepEqual(preview, settled.facts.resourceDelta);
});

test("legacy frozen facts project canonically without changing their content or digest", () => {
  const facts = { turn: 7, resourceDelta: { coins: 12, magic: 3 }, populationDelta: { muggles: {}, wizards: {} } };
  const before = structuredClone(facts);
  const digest = factsDigest(facts);
  const first = buildReportContext({ cityId: "legacy-facts", facts });
  const second = buildReportContext({ cityId: "legacy-facts", facts });
  assert.deepEqual(facts, before);
  assert.equal(factsDigest(facts), digest);
  assert.deepEqual(first.resourceDelta, { factRef: "fact-resource-delta", coins: 12, arcaneEnergy: 3 });
  assert.equal("magic" in first.resourceDelta, false);
  assert.deepEqual(second.resourceDelta, first.resourceDelta);
});

test("resolve migrates legacy gameplay resources while preserving old frozen facts", () => {
  const state = createCityState({ mapId: "legacy-resolve", grid: { columns: 1, rows: 1, cells: [{ id: "cell-0-0", column: 0, row: 0, buildable: true }] } });
  const oldFacts = { turn: 0, resourceDelta: { coins: 1, magic: 2 }, populationDelta: { muggles: {}, wizards: {} } };
  const oldDigest = factsDigest(oldFacts);
  state.gameplay.schemaVersion = 2;
  state.gameplay.resources = { coins: 600, magic: 2 };
  state.gameplay.turnFacts = { 0: oldFacts };
  state.gameplay.lastTurnFacts = oldFacts;
  const result = resolveTurn(state, {}, { seed: "legacy-resolve", now: () => "2026-08-23T00:00:00.000Z" });
  assert.equal(result.error, null);
  assert.equal(result.nextState.gameplay.schemaVersion, GAMEPLAY_SCHEMA_VERSION);
  assert.deepEqual(result.nextState.gameplay.resources, { coins: 600, arcaneEnergy: 2 });
  assert.deepEqual(result.facts.resourceDelta, { coins: 0, arcaneEnergy: 0 });
  assert.deepEqual(result.nextState.gameplay.turnFacts[0], oldFacts);
  assert.equal(factsDigest(result.nextState.gameplay.turnFacts[0]), oldDigest);
  assert.equal("magic" in result.nextState.gameplay.resources, false);
});
