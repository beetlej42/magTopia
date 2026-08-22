import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDING_COST_BY_PURPOSE,
  ROAD_COST_BY_KIND,
  calculateBuildingConstructionCost,
  calculateRoadCost,
  ordinaryResidentialHeightMultiplier
} from "../src/gameplay/construction-cost.js";
import { normalizeConstructionProposal } from "../src/city/contracts.js";
import { deriveGameplayBuilding } from "../src/gameplay/building-metadata.js";
import { normalizeGameplayBuilding } from "../src/gameplay/schema.js";

test("canonical ordinary multi-floor residence aggregates every functional cell and applies height cost", () => {
  const input = {
    footprintCells: ["a", "b"],
    floorSpecs: [
      { purpose: "residential", magicRatio: 0 },
      { purpose: "residential", magicRatio: 0.25 },
      { purpose: "residential", magicRatio: 0.5 }
    ]
  };
  const cost = calculateBuildingConstructionCost(input);
  assert.equal(cost.source, "canonical_functional_units");
  assert.equal(cost.heightFloors, 3);
  assert.equal(cost.heightMultiplier, 1.1);
  assert.equal(cost.coins, 330);
  assert.deepEqual(cost.functionalAreas, {
    residential: 6, commercial: 0, public_service: 0, production: 0, greenhouse: 0
  });
  assert.deepEqual(cost.breakdown.map(({ purpose, area, magicRatio }) => ({ purpose, area, magicRatio })), [
    { purpose: "residential", area: 2, magicRatio: 0 },
    { purpose: "residential", area: 2, magicRatio: 0.25 },
    { purpose: "residential", area: 2, magicRatio: 0.5 }
  ]);
});

test("mixed-use floors use purpose rates and do not receive the ordinary-residence multiplier", () => {
  const cost = calculateBuildingConstructionCost({
    site: { footprint: "2x1" },
    floorPrograms: [
      { purpose: "commercial", magicRatio: 0.25 },
      { purpose: "residential", magicRatio: 0.5 },
      { purpose: "residential", magicRatio: 0.75 }
    ]
  });
  assert.equal(cost.heightPricingApplied, false);
  assert.equal(cost.coins, 320); // 2*60 + 4*50
  assert.deepEqual(cost.functionalAreas, {
    residential: 4, commercial: 2, public_service: 0, production: 0, greenhouse: 0
  });
});

test("compound public mass grammar is not interpreted as floors", () => {
  const cost = calculateBuildingConstructionCost({
    purpose: "public_service",
    masses: [
      { purpose: "public_service", cells: [[0, 0], [0, 1]], magicRatio: 0.25 },
      { purpose: "greenhouse", cells: [[1, 0]], magicRatio: 1 },
      { purpose: "public_service", area: 1, magicRatio: 0 }
    ]
  });
  assert.equal(cost.heightPricingApplied, false);
  assert.equal(cost.coins, 300); // 2*70 + 1*90 + 1*70
  assert.equal(cost.breakdown.length, 3);
});

test("all five base purpose rates are centralized and deterministic", () => {
  for (const [purpose, rate] of Object.entries(BUILDING_COST_BY_PURPOSE)) {
    const input = { units: [{ purpose, area: 2, magicRatio: 0.5 }] };
    const first = calculateBuildingConstructionCost(input);
    assert.equal(first.coins, rate * 2);
    assert.deepEqual(first, calculateBuildingConstructionCost(input));
  }
});

test("height multiplier has explicit boundaries and expected values", () => {
  assert.equal(ordinaryResidentialHeightMultiplier(1), 1);
  assert.equal(ordinaryResidentialHeightMultiplier(2), 1.05);
  assert.equal(ordinaryResidentialHeightMultiplier(3), 1.1);
  assert.equal(ordinaryResidentialHeightMultiplier(4), 1.15);
  assert.equal(ordinaryResidentialHeightMultiplier(21), 2);
  assert.throws(() => ordinaryResidentialHeightMultiplier(0), /floor count/);
  assert.throws(() => ordinaryResidentialHeightMultiplier(1.5), /floor count/);
});

test("road and bridge rates are centralized, integer, and reject illegal counts", () => {
  assert.deepEqual(ROAD_COST_BY_KIND, { standard: 2, bridge: 15 });
  assert.deepEqual(calculateRoadCost({ roadCells: 4, bridgeCells: 2 }), {
    coins: 38,
    source: "canonical_road_rates",
    roadCells: 4,
    bridgeCells: 2,
    breakdown: [
      { kind: "standard", cells: 4, rate: 2, cost: 8 },
      { kind: "bridge", cells: 2, rate: 15, cost: 30 }
    ]
  });
  assert.throws(() => calculateRoadCost({ roadCells: -1 }), /road cell count/);
  assert.throws(() => calculateRoadCost({ bridgeCells: 1.5 }), /bridge cell count/);
  assert.throws(() => calculateRoadCost({ roadCells: Number.MAX_SAFE_INTEGER, bridgeCells: Number.MAX_SAFE_INTEGER }), /safe integer/);
});

test("legacy proposals are explicitly labelled adapters and cannot masquerade as canonical cost", () => {
  assert.throws(() => calculateBuildingConstructionCost({ site: { footprint: "2x1" }, program: { archetype: "starter_house" } }), /Canonical GameplayBuilding/);
  const adapter = calculateBuildingConstructionCost({ site: { footprint: "2x1" }, program: { archetype: "starter_house" } }, { allowLegacy: true });
  assert.equal(adapter.source, "legacy_category_adapter");
  assert.equal(adapter.coins, 90);
});

test("renderer-owned mesh grammar never becomes the canonical cost source", () => {
  assert.throws(() => calculateBuildingConstructionCost({
    program: { purpose: "residential", archetype: "visual-house" },
    voxelDesign: { floorSpecs: [{ purpose: "production", area: 99, magicRatio: 1 }] }
  }), /Canonical GameplayBuilding/);
});

test("raw, normalized, derived, and persisted-shaped canonical metadata keep the same pricing facts", () => {
  const raw = {
    footprintCells: ["a", "b"],
    floorSpecs: [{ purpose: "residential" }, { purpose: "residential" }]
  };
  const normalized = normalizeGameplayBuilding(raw);
  const derived = deriveGameplayBuilding(raw);
  const persisted = { ...derived, id: "building-1", gameplay: derived };
  assert.deepEqual(normalized.pricingFacts, { sourceKind: "floors", floorCount: 2 });
  assert.deepEqual(derived.pricingFacts, normalized.pricingFacts);
  assert.equal(calculateBuildingConstructionCost(raw).coins, 210);
  assert.equal(calculateBuildingConstructionCost(normalized, { trustedMetadata: true }).coins, 210);
  assert.equal(calculateBuildingConstructionCost(derived, { trustedMetadata: true }).coins, 210);
  assert.equal(calculateBuildingConstructionCost(persisted.gameplay, { trustedMetadata: true }).coins, 210);
});

test("explicit gameplay wrapper wins over a conflicting top-level floor grammar", () => {
  const input = {
    gameplayBuilding: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
    floorSpecs: [{ purpose: "residential" }, { purpose: "residential" }, { purpose: "residential" }]
  };
  const cost = calculateBuildingConstructionCost(input);
  assert.equal(cost.heightPricingApplied, false);
  assert.equal(cost.heightFloors, null);
  assert.equal(cost.coins, 50);
});

test("client-supplied canonical/pricingFacts cannot suppress real floor pricing", () => {
  const forged = {
    canonical: true,
    footprintCells: ["a"],
    floorSpecs: [{ purpose: "residential" }, { purpose: "residential" }],
    pricingFacts: { sourceKind: "units", floorCount: null }
  };
  assert.deepEqual(deriveGameplayBuilding(forged).pricingFacts, { sourceKind: "floors", floorCount: 2 });
  assert.equal(calculateBuildingConstructionCost(forged).coins, 105);
});

test("construction proposals preserve explicit canonical gameplay grammar", () => {
  const proposal = normalizeConstructionProposal({
    site: { lotId: "cell-1-1", footprint: "1x1", entrance: "south" },
    program: { archetype: "tower", purpose: "residential" },
    gameplayBuilding: { floorSpecs: [{ purpose: "residential", magicRatio: 0.5 }] },
    design: { prompt: "A compact tower." }
  });
  assert.deepEqual(proposal.gameplayBuilding, {
    floorSpecs: [{ purpose: "residential", magicRatio: 0.5 }]
  });
  assert.equal(calculateBuildingConstructionCost(proposal).source, "canonical_functional_units");
});
