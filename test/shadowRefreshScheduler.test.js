import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSurfaceShadowRefreshThreshold,
  defaultShadowRefreshThreshold,
  shadowDirectionExceedsThreshold
} from "../src/render/shadowRefreshScheduler.js";

const MOBILE_SURFACE_VIEW = Object.freeze({
  viewportHeight: 844,
  renderScale: 1.7,
  fovDegrees: 40,
  cameraDistance: 58,
  voxelSize: 0.125,
  shadowFootprintRadius: 16
});

test("surface shadow threshold stays below one render pixel in the near view", () => {
  const threshold = calculateSurfaceShadowRefreshThreshold({
    ...MOBILE_SURFACE_VIEW,
    cameraScale: 1
  });

  assert.ok(Math.abs(threshold.thresholdDegrees - 0.10537) < 0.0001);
  assert.ok(Math.abs(threshold.allowedWorldDisplacement - threshold.renderPixelWorldSize) < 1e-9);
  assert.ok(threshold.allowedWorldDisplacement < threshold.voxelDisplacementLimit);
});

test("far view threshold is capped at one quarter voxel", () => {
  const threshold = calculateSurfaceShadowRefreshThreshold({
    ...MOBILE_SURFACE_VIEW,
    cameraScale: 1.9
  });

  assert.ok(Math.abs(threshold.thresholdDegrees - 0.11191) < 0.0001);
  assert.equal(threshold.allowedWorldDisplacement, 0.03125);
  assert.equal(threshold.voxelDisplacementLimit, 0.03125);
  assert.ok(threshold.renderPixelWorldSize > threshold.voxelDisplacementLimit);
});

test("shadow direction comparison refreshes only after the derived angular threshold", () => {
  const threshold = calculateSurfaceShadowRefreshThreshold({
    ...MOBILE_SURFACE_VIEW,
    cameraScale: 1
  });
  const belowThresholdDot = Math.cos((threshold.thresholdDegrees * 0.9) * Math.PI / 180);
  const aboveThresholdDot = Math.cos((threshold.thresholdDegrees * 1.1) * Math.PI / 180);

  assert.equal(shadowDirectionExceedsThreshold(belowThresholdDot, threshold.thresholdCosine), false);
  assert.equal(shadowDirectionExceedsThreshold(aboveThresholdDot, threshold.thresholdCosine), true);
});

test("non-surface views retain the existing conservative default", () => {
  const threshold = defaultShadowRefreshThreshold();

  assert.equal(threshold.thresholdDegrees, 0.05);
  assert.ok(Math.abs(threshold.thresholdCosine - Math.cos(0.05 * Math.PI / 180)) < 1e-12);
});
