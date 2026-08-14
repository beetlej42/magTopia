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
  assert.equal(profile.initialPixelRatio, 1.7);
  assert.equal(profile.maxPixelRatio, 1.79);
  assert.ok(390 * 844 * profile.maxPixelRatio ** 2 <= profile.pixelBudget * 1.01);
});

test("Bokeh is on by default on mobile and remains explicitly controllable", () => {
  assert.equal(shouldEnableBokeh({ mobile: true }), true);
  assert.equal(shouldEnableBokeh({ mobile: false }), true);
  assert.equal(shouldEnableBokeh({ requestedValue: "1", mobile: true }), true);
  assert.equal(shouldEnableBokeh({ requestedValue: "0", mobile: false }), false);
});

test("adaptive quality protects 60fps before restoring resolution", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 23,
    pixelRatio: 1.7,
    minPixelRatio: 1,
    maxPixelRatio: 1.8,
    bokehQuality: 1
  }), {
    pixelRatio: 1.7,
    depthOfFieldScale: 1,
    bokehQuality: 0.5,
    lodQualityScale: 1.1
  });
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 23,
    pixelRatio: 1.7,
    minPixelRatio: 1,
    maxPixelRatio: 1.8,
    bokehQuality: 0.5
  }), {
    pixelRatio: 1.6,
    depthOfFieldScale: 1,
    bokehQuality: 0.5,
    lodQualityScale: 1.1
  });
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 14,
    pixelRatio: 1.7,
    minPixelRatio: 1,
    maxPixelRatio: 1.8,
    bokehQuality: 0.5
  }), {
    pixelRatio: 1.7,
    depthOfFieldScale: 1,
    bokehQuality: 1,
    lodQualityScale: 1
  });
});

test("adaptive quality skips disabled Bokeh and reduces scene resolution immediately", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 23,
    pixelRatio: 1.7,
    minPixelRatio: 1,
    maxPixelRatio: 1.8,
    bokehQuality: 1,
    bokehEnabled: false
  }), {
    pixelRatio: 1.6,
    depthOfFieldScale: 0,
    bokehQuality: 1,
    lodQualityScale: 1.1
  });
});

test("adaptive quality keeps low-cost Bokeh active during severe frame pressure", () => {
  assert.deepEqual(chooseAdaptiveQuality({
    averageFrameMs: 34,
    pixelRatio: 1.4,
    minPixelRatio: 1,
    maxPixelRatio: 1.8,
    bokehQuality: 0.5,
    bokehEnabled: true
  }), {
    pixelRatio: 1.3,
    depthOfFieldScale: 1,
    bokehQuality: 0.5,
    lodQualityScale: 1.2
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
