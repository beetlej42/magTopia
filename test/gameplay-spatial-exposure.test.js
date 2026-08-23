import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPOSURE_RADIUS,
  calculateMagicLoad,
  inspectBuildingRisk,
  inspectSpatialExposure,
  spatialDistanceWeight
} from "../src/gameplay/exposure.js";

function building(id, cells, extra = {}) {
  return { id, footprintCells: cells, status: "completed", ...extra };
}

function canonical(units) {
  return { canonical: true, units };
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

test("system-owned prefab intensity overrides the purpose default without changing magic ratio", () => {
  const { state, greenhouse, metadata } = fixture();
  metadata.greenhouse = canonical([{ purpose: "greenhouse", area: 1, magicRatio: 0.5, typeIntensity: 7 }]);
  assert.equal(calculateMagicLoad(metadata.greenhouse), 3.5);
  const result = inspectBuildingRisk(state, greenhouse, { metadataOf: () => metadata.greenhouse });
  assert.equal(result.magicLoadBreakdown[0].typeIntensity, 7);
  assert.equal(result.magicLoad, 3.5);
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

test("legacy category metadata is never promoted to authoritative PR-E load", () => {
  const legacy = building("legacy", ["cell-1-1"], { program: { purpose: "greenhouse", intent: { magicLevel: 1 } } });
  const state = { buildings: { legacy } };
  const result = inspectBuildingRisk(state, legacy);
  assert.equal(result.authoritative, false);
  assert.equal(result.status, "UNSUPPORTED_LEGACY_METADATA");
  assert.equal(result.magicLoad, 0);
  assert.equal(calculateMagicLoad({ category: "green", magicLevel: 1 }), 0);
});
