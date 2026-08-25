import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import {
  EXPOSURE_RADIUS,
  LEGACY_EXPOSURE_RADIUS,
  calculateMagicLoad,
  inspectBuildingRisk,
  inspectSpatialExposure,
  neighborhoodConcealment,
  spatialDistanceWeight
} from "../src/gameplay/exposure.js";
import { normalizeMaxRisks, resolveTurn } from "../src/gameplay/simulation.js";
import { deepFreeze, normalizeGameplayBuilding, normalizeTurnFacts } from "../src/gameplay/schema.js";

function building(id, cells, extra = {}) {
  return { id, footprintCells: cells, status: "completed", ...extra };
}

function canonical(units) {
  return { canonical: true, units };
}

function productionState(withCover = false) {
  const cells = [];
  for (let row = 0; row < 12; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
    }
  }
  const state = createCityState({ mapId: "spatial-production", grid: { columns: 12, rows: 12, cells } }, { resources: { coins: 99999 } });
  state.cells["cell-5-5"].occupancy = "greenhouse";
  state.buildings.greenhouse = {
    id: "greenhouse",
    footprintCells: ["cell-5-5"],
    site: { lotId: "cell-5-5", footprint: "1x1" },
    gameplay: canonical([{ purpose: "greenhouse", area: 1, magicRatio: 1 }]),
    status: "completed"
  };
  if (withCover) {
    for (const [id, cell, purpose] of [
      ["house", "cell-4-5", "residential"],
      ["market", "cell-6-5", "commercial"],
      ["courtyard", "cell-5-4", "public_service"]
    ]) {
      state.cells[cell].occupancy = id;
      state.buildings[id] = {
        id,
        footprintCells: [cell],
        site: { lotId: cell, footprint: "1x1" },
        gameplay: canonical([{ purpose, area: 1, magicRatio: 0 }]),
        status: "completed"
      };
    }
  }
  return state;
}

function productionContext() {
  return { now: () => "2026-07-22T12:00:00.000Z", seed: "spatial-production", createId: (prefix) => `${prefix}-spatial` };
}

function fixture() {
  const greenhouse = building("greenhouse", ["cell-5-5"]);
  const state = { buildings: { greenhouse }, cells: {} };
  const metadata = { greenhouse: canonical([{ purpose: "greenhouse", area: 1, magicRatio: 1 }]) };
  return {
    state,
    greenhouse,
    metadata,
    inspect: () => inspectBuildingRisk(state, greenhouse, { metadataOf: (candidate) => metadata[candidate.id] })
  };
}

test("isolated high-magic greenhouse includes its own source and reaches bare high risk", () => {
  const { inspect } = fixture();
  const result = inspect();
  assert.equal(result.magicLoad, 4);
  assert.equal(result.baseRisk, 0.1);
  assert.equal(result.localMagicRatio, 1);
  assert.equal(result.spatialModifier, 1);
  assert.equal(result.finalIncidentChance, 0.1);
  assert.equal(result.contributions[0].distance, 0);
  assert.equal(result.contributions[0].weight, 1);
});

test("ordinary residential and commercial surroundings dilute local magic", () => {
  const { state, greenhouse, metadata, inspect } = fixture();
  const alone = inspect();
  for (const [id, cell, purpose] of [
    ["house", "cell-4-5", "residential"],
    ["market", "cell-6-5", "commercial"],
    ["civic", "cell-5-4", "public_service"]
  ]) {
    state.buildings[id] = building(id, [cell]);
    metadata[id] = canonical([{ purpose, area: 1, magicRatio: 0 }]);
  }
  const surrounded = inspect();
  assert.ok(surrounded.localMagicRatio < alone.localMagicRatio);
  assert.ok(surrounded.finalIncidentChance < alone.finalIncidentChance);
  assert.equal(surrounded.magicLoad, 4);
  assert.equal(surrounded.baseRisk, 0.1);

  state.buildings.courtyard = building("courtyard", ["cell-4-4", "cell-4-6", "cell-5-6", "cell-6-6"]);
  metadata.courtyard = canonical([{ purpose: "public_service", area: 4, magicRatio: 0 }]);
  const withCourtyard = inspect();
  assert.ok(withCourtyard.localMagicRatio < surrounded.localMagicRatio);
  assert.ok(withCourtyard.finalIncidentChance < surrounded.finalIncidentChance);
  assert.equal(greenhouse.id, "greenhouse");
});

test("pure magic facilities approach bare risk while mixed ordinary area does not", () => {
  const { state, metadata, inspect } = fixture();
  const second = building("factory", ["cell-6-5"]);
  state.buildings.factory = second;
  metadata.factory = canonical([{ purpose: "production", area: 2, magicRatio: 1 }]);
  const clustered = inspect();
  assert.ok(clustered.localMagicRatio > 0.9);
  assert.ok(clustered.finalIncidentChance > 0.09);
});

test("client unit intensity cannot change load, while trusted prefab resolver can", () => {
  const { state, greenhouse, metadata } = fixture();
  metadata.greenhouse = canonical([{ purpose: "greenhouse", area: 1, magicRatio: 0.5, typeIntensity: 7 }]);
  assert.equal(calculateMagicLoad(metadata.greenhouse), 2);
  const clientResult = inspectBuildingRisk(state, greenhouse, { metadataOf: () => metadata.greenhouse });
  assert.equal(clientResult.magicLoadBreakdown[0].typeIntensity, 4);
  assert.equal(clientResult.magicLoad, 2);
  const trustedResult = inspectBuildingRisk(state, greenhouse, {
    metadataOf: () => metadata.greenhouse,
    typeIntensityResolver: ({ building, unit }) => building.id === "greenhouse" && unit.purpose === "greenhouse" ? 7 : null
  });
  assert.equal(trustedResult.magicLoadBreakdown[0].typeIntensity, 7);
  assert.equal(trustedResult.magicLoad, 3.5);
  const malformedResult = inspectBuildingRisk(state, greenhouse, {
    metadataOf: () => metadata.greenhouse,
    typeIntensityResolver: () => Number.POSITIVE_INFINITY
  });
  assert.ok(Number.isFinite(malformedResult.magicLoad));
  assert.ok(Number.isFinite(malformedResult.finalIncidentChance));
});

test("canonical schema does not persist client-supplied typeIntensity", () => {
  const normalized = normalizeGameplayBuilding({
    units: [{ purpose: "greenhouse", area: 1, magicRatio: 1, typeIntensity: 0 }]
  });
  assert.deepEqual(normalized.units, [{ purpose: "greenhouse", area: 1, magicRatio: 1 }]);
});

test("distance boundary and multi-cell footprint use shortest Manhattan distance", () => {
  const { state, greenhouse, metadata, inspect } = fixture();
  const edge = building("edge", ["cell-10-5", "cell-11-5"]);
  state.buildings.edge = edge;
  metadata.edge = canonical([{ purpose: "production", area: 2, magicRatio: 1 }]);
  const atBoundary = inspect();
  assert.equal(atBoundary.contributions.find((entry) => entry.buildingId === "edge").distance, EXPOSURE_RADIUS);
  assert.ok(atBoundary.contributions.find((entry) => entry.buildingId === "edge").weight > 0);

  edge.footprintCells = ["cell-11-5", "cell-12-5"];
  const outside = inspect();
  assert.equal(outside.contributions.some((entry) => entry.buildingId === "edge"), false);
  assert.equal(spatialDistanceWeight(EXPOSURE_RADIUS + 0.001), 0);
  assert.equal(greenhouse.id, "greenhouse");
});

test("risk inspection is independent of district and block labels", () => {
  const left = fixture();
  const right = fixture();
  left.state.districtId = "district-a";
  left.state.buildings.greenhouse.blockId = "block-a";
  right.state.districtId = "district-z";
  right.state.buildings.greenhouse.blockId = "block-z";
  assert.deepEqual(inspectSpatialExposure(left.state, { metadataOf: (candidate) => left.metadata[candidate.id] }), inspectSpatialExposure(right.state, { metadataOf: (candidate) => right.metadata[candidate.id] }));
});

test("string building ids resolve map keys even when stored buildings omit embedded id", () => {
  const state = { buildings: { greenhouse: { footprintCells: ["cell-5-5"], status: "completed" } } };
  const result = inspectBuildingRisk(state, "greenhouse", {
    metadataOf: (candidate) => candidate.id === "greenhouse" ? canonical([{ purpose: "greenhouse", area: 1, magicRatio: 1 }]) : null
  });
  assert.equal(result.buildingId, "greenhouse");
  assert.equal(result.magicLoad, 4);
  assert.equal(result.localMagicRatio, 1);
});

test("production TurnFacts expose canonical spatial risks and ordinary cover lowers them", () => {
  const alone = resolveTurn(productionState(), {}, productionContext());
  const covered = resolveTurn(productionState(true), {}, productionContext());
  assert.equal(alone.error, null);
  assert.equal(covered.error, null);
  const bare = alone.facts.nextRisks.find((risk) => risk.buildingId === "greenhouse");
  const diluted = covered.facts.nextRisks.find((risk) => risk.buildingId === "greenhouse");
  assert.ok(bare && diluted);
  for (const key of ["magicLoad", "riskTier", "baseRisk", "localMagicRatio", "spatialModifier", "finalIncidentChance"]) {
    assert.ok(key in bare, `nextRisks greenhouse has ${key}`);
  }
  assert.ok(diluted.localMagicRatio < bare.localMagicRatio);
  assert.ok(diluted.finalIncidentChance < bare.finalIncidentChance);
  assert.equal("spatialRisks" in alone.facts, false);

  const relabeled = productionState(true);
  relabeled.districtId = "different-district";
  relabeled.buildings.greenhouse.blockId = "different-block";
  const relabeledResult = resolveTurn(relabeled, {}, productionContext());
  assert.equal(relabeledResult.facts.nextRisks.find((risk) => risk.buildingId === "greenhouse").finalIncidentChance, diluted.finalIncidentChance);
});

test("sealed and inactive canonical buildings are omitted from production risk projection", () => {
  for (const status of ["sealed", "inactive"]) {
    const state = productionState();
    state.buildings.greenhouse.status = status;
    const inspected = inspectBuildingRisk(state, "greenhouse", {
      metadataOf: (candidate) => candidate.gameplay
    });
    assert.equal(inspected.eligible, false);
    assert.equal(inspected.finalIncidentChance, 0);
    const result = resolveTurn(state, {}, productionContext());
    assert.equal(result.error, null);
    assert.equal(result.facts.nextRisks.some((risk) => risk.buildingId === "greenhouse"), false);
  }
});

test("a canonical building sealed during settlement is omitted from next risks", () => {
  const state = productionState();
  state.buildings.greenhouse.exposure = 99;
  const result = resolveTurn(state, {}, {
    ...productionContext(),
    options: { modifier: 1 }
  });
  assert.equal(result.error, null);
  assert.equal(result.nextState.buildings.greenhouse.status, "sealed");
  assert.equal(result.facts.nextRisks.some((risk) => risk.buildingId === "greenhouse"), false);
});

test("maxRisks is a stable non-negative integer boundary", () => {
  assert.equal(normalizeMaxRisks(), 5);
  assert.equal(normalizeMaxRisks(Number.NaN), 5);
  assert.equal(normalizeMaxRisks(-2), 0);
  assert.equal(normalizeMaxRisks(2.9), 2);
  const result = resolveTurn(productionState(true), {}, {
    ...productionContext(),
    options: { maxRisks: -1 }
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.facts.nextRisks, []);
});

test("turn-fact risk normalization owns nested audit records", () => {
  const input = {
    nextRisks: [{
      buildingId: "greenhouse",
      magicLoadBreakdown: [{ purpose: "greenhouse", magicLoad: 4 }],
      contributions: [{ buildingId: "greenhouse", weightedArea: 1 }]
    }]
  };
  const normalized = normalizeTurnFacts(input);
  assert.notEqual(normalized.nextRisks[0], input.nextRisks[0]);
  assert.notEqual(normalized.nextRisks[0].magicLoadBreakdown, input.nextRisks[0].magicLoadBreakdown);
  assert.notEqual(normalized.nextRisks[0].magicLoadBreakdown[0], input.nextRisks[0].magicLoadBreakdown[0]);
  assert.notEqual(normalized.nextRisks[0].contributions, input.nextRisks[0].contributions);
  assert.notEqual(normalized.nextRisks[0].contributions[0], input.nextRisks[0].contributions[0]);
  deepFreeze(normalized);
  assert.equal(Object.isFrozen(input.nextRisks[0].magicLoadBreakdown[0]), false);
  assert.equal(Object.isFrozen(input.nextRisks[0].contributions[0]), false);
});

test("legacy category metadata is never promoted to authoritative PR-E load", () => {
  const legacy = building("legacy", ["cell-1-1"], { program: { purpose: "greenhouse", intent: { magicLevel: 1 } } });
  const state = { buildings: { legacy } };
  const result = inspectBuildingRisk(state, legacy);
  assert.equal(result.authoritative, false);
  assert.equal(result.status, "UNSUPPORTED_LEGACY_METADATA");
  assert.equal(result.magicLoad, 0);
  assert.equal(calculateMagicLoad({ category: "green", magicLevel: 1 }), 0);
});

test("legacy concealment keeps its two-cell radius while PR-E uses five cells", () => {
  const state = {
    buildings: {
      source: building("source", ["cell-5-5"]),
      near: building("near", ["cell-7-5"]),
      outside: building("outside", ["cell-8-5"])
    }
  };
  const metadata = {
    near: { concealment: 2 },
    outside: { concealment: 20 }
  };
  assert.equal(LEGACY_EXPOSURE_RADIUS, 2);
  assert.ok(neighborhoodConcealment(state, state.buildings.source, { metadataOf: (candidate) => metadata[candidate.id] }) > 0);
  state.buildings.near.footprintCells = ["cell-8-5"];
  assert.equal(neighborhoodConcealment(state, state.buildings.source, { metadataOf: (candidate) => metadata[candidate.id] }), 0);
  assert.equal(EXPOSURE_RADIUS, 5);
});
