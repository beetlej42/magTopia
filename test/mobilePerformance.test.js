import assert from "node:assert/strict";
import test from "node:test";

import { chooseAdaptiveQuality, detectMobileRenderProfile } from "../src/render/mobilePerformance.js";

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
  assert.equal(profile.initialPixelRatio, 1.6);
  assert.equal(profile.maxPixelRatio, 1.79);
  assert.ok(390 * 844 * profile.maxPixelRatio ** 2 <= profile.pixelBudget * 1.01);
});

test("adaptive quality protects 60fps before restoring resolution", () => {
  assert.deepEqual(chooseAdaptiveQuality({ averageFrameMs: 23, pixelRatio: 1.6, minPixelRatio: 1, maxPixelRatio: 1.8 }), {
    pixelRatio: 1.4,
    depthOfFieldScale: 0
  });
  assert.deepEqual(chooseAdaptiveQuality({ averageFrameMs: 14, pixelRatio: 1.6, minPixelRatio: 1, maxPixelRatio: 1.8 }), {
    pixelRatio: 1.7,
    depthOfFieldScale: 1
  });
});
