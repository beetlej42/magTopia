import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_COMPARISON_PRESETS,
  getAssetComparisonContract,
  normalizeAssetComparisonConfig
} from "../src/generators/assetComparisonLab.js";

test("comparison mode normalizes synchronized view and depth controls", () => {
  const normalized = normalizeAssetComparisonConfig({
    ...ASSET_COMPARISON_PRESETS.cottageDepthVsHunyuan,
    comparisonYaw: 240,
    depthStrength: -2,
    separation: 22,
    showBounds: 0.2,
    depthWireframe: 0.8
  });
  assert.equal(normalized.comparisonYaw, 180);
  assert.equal(normalized.depthStrength, 0);
  assert.equal(normalized.separation, 10);
  assert.equal(normalized.showBounds, 0);
  assert.equal(normalized.depthWireframe, 1);
  assert.equal(normalized.fitSurfaces, "all");
});

test("comparison mode retains the walls and ground fitting variant", () => {
  const normalized = normalizeAssetComparisonConfig(ASSET_COMPARISON_PRESETS.cottageWallsGroundVsHunyuan);
  assert.equal(normalized.fitSurfaces, "walls-ground");
  assert.equal(getAssetComparisonContract(normalized).fitSurfaces, "walls-ground");
});

test("comparison mode retains the metric indoor small variant", () => {
  const normalized = normalizeAssetComparisonConfig(ASSET_COMPARISON_PRESETS.cottageMetricIndoorSmallVsHunyuan);
  assert.equal(normalized.fitSurfaces, "metric-indoor-small");
  assert.equal(getAssetComparisonContract(normalized).fitSurfaces, "metric-indoor-small");
});

test("comparison contract keeps both representations on the same parcel", () => {
  const contract = getAssetComparisonContract({ comparisonYaw: 35, depthStrength: 1.2 });
  assert.equal(contract.mode, "comparison");
  assert.deepEqual(contract.parcelDimensions, { length: 4, width: 4, height: 4, unit: "world" });
  assert.equal(contract.synchronizedYaw, 35);
  assert.equal(contract.depthStrength, 1.2);
});

test("every generated starter building has a comparison preset", () => {
  const comparedAssetIds = [...new Set(Object.values(ASSET_COMPARISON_PRESETS)
    .map((preset) => preset.assetId))]
    .sort();
  assert.deepEqual(comparedAssetIds, [
    "starter-cottage-001",
    "starter-herbalist-001",
    "starter-workshop-001"
  ]);
});
