import assert from "node:assert/strict";
import test from "node:test";

import { getVoxelLodThresholds, selectScreenSpaceVoxelLod } from "../src/render/voxelLodQuality.js";

test("far view retains near geometry longer than the previous two-pixel cutoff", () => {
  const thresholds = getVoxelLodThresholds({ viewMode: "far" });
  assert.equal(selectScreenSpaceVoxelLod(null, {
    visibleInFrustum: true,
    projectedVoxelPx: 1.3,
    projectedDiameterPx: 70
  }, { thresholds }), 0);
});

test("screen-space diameter prevents recognizable buildings from collapsing to far LOD", () => {
  const thresholds = getVoxelLodThresholds({ viewMode: "far" });
  assert.equal(selectScreenSpaceVoxelLod(null, {
    visibleInFrustum: true,
    projectedVoxelPx: 0.2,
    projectedDiameterPx: 90
  }, { thresholds }), 0);
  assert.equal(selectScreenSpaceVoxelLod(null, {
    visibleInFrustum: true,
    projectedVoxelPx: 0.2,
    projectedDiameterPx: 40
  }, { thresholds }), 1);
});
