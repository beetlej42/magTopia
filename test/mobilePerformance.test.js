import assert from "node:assert/strict";
import test from "node:test";

import { chooseAdaptiveQuality, detectMobileRenderProfile, shouldEnableBokeh } from "../src/render/mobilePerformance.js";

test("iPhone Safari uses the largest DPR inside its post-processing pixel budget", () => {
  const profile = detectMobileRenderProfile({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
    coarsePointer: true,
    width: 390,
    height: 844,
    devicePixelRatio: 3
  });

  assert.equal(profile.iosSafari, true);
  assert.equal(profile.mobile, true);
  assert.equal(profile.initialPixelRatio, 2);
  assert.equal(profile.maxPixelRatio, 2);
  assert.ok(390 * 844 * profile.maxPixelRatio ** 2 <= profile.pixelBudget * 1.01);
});

test("Bokeh is on by default on mobile and remains explicitly controllable", () => {
  assert.equal(shouldEnableBokeh({ mobile: true }), true);
  assert.equal(shouldEnableBokeh({ mobile: false }), true);
  assert.equal(shouldEnableBokeh({ requestedValue: "1", mobile: true }), true);
  assert.equal(shouldEnableBokeh({ requestedValue: "0", mobile: false }), false);
});

test("adaptive quality uses high and balanced DPR tiers without degrading Bokeh or LOD", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 19,
    pixelRatio: 2,
    minPixelRatio: 1.2,
    maxPixelRatio: 2,
    bokehQuality: 1
  }), {
    pixelRatio: 1.8,
    depthOfFieldScale: 1,
    bokehQuality: 1,
    lodQualityScale: 1
  });

  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 14,
    pixelRatio: 1.8,
    minPixelRatio: 1.2,
    maxPixelRatio: 2,
    bokehQuality: 1
  }), {
    pixelRatio: 2,
    depthOfFieldScale: 1,
    bokehQuality: 1,
    lodQualityScale: 1
  });
});

test("balanced tier respects device pixel-ratio caps", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 20,
    pixelRatio: 1.7,
    minPixelRatio: 1.2,
    maxPixelRatio: 1.7,
    bokehQuality: 1
  }), {
    pixelRatio: 1.7,
    depthOfFieldScale: 1,
    bokehQuality: 1,
    lodQualityScale: 1
  });
});

test("adaptive quality keeps Bokeh disabled when explicitly requested", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 19,
    pixelRatio: 2,
    minPixelRatio: 1.2,
    maxPixelRatio: 2,
    bokehQuality: 1,
    bokehEnabled: false
  }), {
    pixelRatio: 1.8,
    depthOfFieldScale: 0,
    bokehQuality: 1,
    lodQualityScale: 1
  });
});

test("desktop pixel-ratio bounds never invert on a 4K viewport", () => {
  const profile = detectMobileRenderProfile({
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/126 Safari/537.36",
    width: 3840,
    height: 2160,
    devicePixelRatio: 2
  });
  assert.ok(profile.minPixelRatio <= profile.initialPixelRatio);
  assert.ok(profile.initialPixelRatio <= profile.maxPixelRatio);
});
