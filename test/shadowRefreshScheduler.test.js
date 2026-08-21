import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateShadowViewExtent,
  calculateSurfaceShadowRefreshThreshold,
  defaultShadowRefreshThreshold,
  shadowDirectionExceedsThreshold,
  shouldCommitShadowRefresh
} from "../src/render/shadowRefreshScheduler.js";

test("perspective shadow extent covers the visible surface patch plus padding", () => {
  const fit = calculateShadowViewExtent({
    perspective: true,
    fovDegrees: 34,
    cameraDistance: 58,
    aspect: 16 / 9,
    padding: 8
  });

  assert.ok(fit.visibleWidth > 60 && fit.visibleWidth < 64);
  assert.ok(fit.extent > 38 && fit.extent < 40);
});

test("orthographic shadow extent follows the larger viewport dimension", () => {
  const fit = calculateShadowViewExtent({
    perspective: false,
    orthographicWidth: 40,
    orthographicHeight: 24,
    padding: 6
  });

  assert.equal(fit.extent, 26);
});

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

test("surface shadow refresh waits for camera motion to settle and respects its cadence", () => {
  assert.equal(shouldCommitShadowRefresh({
    pending: true,
    surfaceWorld: true,
    cameraInMotion: true,
    nowMs: 500,
    lastCommittedAtMs: 0,
    minIntervalMs: 100
  }), false);
  assert.equal(shouldCommitShadowRefresh({
    pending: true,
    surfaceWorld: true,
    cameraInMotion: false,
    nowMs: 90,
    lastCommittedAtMs: 0,
    minIntervalMs: 100
  }), false);
  assert.equal(shouldCommitShadowRefresh({
    pending: true,
    surfaceWorld: true,
    cameraInMotion: false,
    nowMs: 100,
    lastCommittedAtMs: 0,
    minIntervalMs: 100
  }), true);
});

test("urgent shadow refresh bypasses motion and cadence", () => {
  assert.equal(shouldCommitShadowRefresh({
    pending: true,
    urgent: true,
    surfaceWorld: true,
    cameraInMotion: true,
    nowMs: 1,
    lastCommittedAtMs: 0,
    minIntervalMs: 160
  }), true);
  assert.equal(shouldCommitShadowRefresh({ pending: false, urgent: true }), false);
});
