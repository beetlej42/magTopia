import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { AdaptiveBokehPass, calculateBokehViewAmount } from "../src/render/adaptiveBokehPass.js";

test("adaptive bokeh scales its cached depth and blur targets before lowering scene resolution", () => {
  const pass = new AdaptiveBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera(), { quality: 1 });
  pass.setSize(1000, 500);
  assert.equal(pass.depthTarget.width, 500);
  assert.equal(pass.depthTarget.height, 250);
  assert.equal(pass.blurTarget.width, 500);
  assert.equal(pass.blurTarget.height, 250);
  assert.equal(pass.bokehTarget.width, 500);
  assert.equal(pass.uniforms.quality.value, 1);

  pass.setQuality(0.5);
  assert.equal(pass.depthTarget.width, 320);
  assert.equal(pass.depthTarget.height, 160);
  assert.equal(pass.blurTarget.width, 320);
  assert.equal(pass.blurTarget.height, 160);
  assert.equal(pass.bokehTarget.width, 320);
  assert.equal(pass.uniforms.quality.value, 0.5);
  pass.dispose();
});

test("adaptive bokeh reports main-pass depth reuse before any fallback depth render", () => {
  const pass = new AdaptiveBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.deepEqual(pass.getDiagnostics(), {
    usingSharedDepth: false,
    sharedDepthFrames: 0,
    fallbackDepthRenders: 0,
    focusRange: 4,
    amount: 1,
    effectScale: 0.5,
    filter: "separable-gaussian",
    samplesPerAxis: 5
  });
  assert.equal(pass.uniforms.depthPacking.value, 1);
  assert.equal(pass.compositeUniforms.depthPacking.value, 1);
  assert.equal(pass.uniforms.focusRange.value, 4);
  assert.equal(pass.compositeUniforms.focusRange.value, 4);
  assert.equal(pass.uniforms.bokehAmount.value, 1);
  assert.equal(pass.compositeUniforms.bokehAmount.value, 1);
  pass.dispose();
});

test("Bokeh fades smoothly from the near view to zero in the far view", () => {
  assert.equal(calculateBokehViewAmount(1, 1, 1.9), 1);
  assert.equal(calculateBokehViewAmount(1.9, 1, 1.9), 0);
  assert.ok(Math.abs(calculateBokehViewAmount(1.45, 1, 1.9) - 0.5) < 1e-12);
  assert.ok(calculateBokehViewAmount(1.2, 1, 1.9) > calculateBokehViewAmount(1.7, 1, 1.9));
});
