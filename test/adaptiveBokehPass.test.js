import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { AdaptiveBokehPass } from "../src/render/adaptiveBokehPass.js";

test("adaptive bokeh scales its cached depth and blur targets before lowering scene resolution", () => {
  const pass = new AdaptiveBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera(), { quality: 1 });
  pass.setSize(1000, 500);
  assert.equal(pass.depthTarget.width, 400);
  assert.equal(pass.depthTarget.height, 200);
  assert.equal(pass.bokehTarget.width, 400);
  assert.equal(pass.uniforms.quality.value, 1);

  pass.setQuality(0.5);
  assert.equal(pass.depthTarget.width, 250);
  assert.equal(pass.depthTarget.height, 125);
  assert.equal(pass.bokehTarget.width, 250);
  assert.equal(pass.uniforms.quality.value, 0.5);
  pass.dispose();
});

test("adaptive bokeh reports main-pass depth reuse before any fallback depth render", () => {
  const pass = new AdaptiveBokehPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  assert.deepEqual(pass.getDiagnostics(), {
    usingSharedDepth: false,
    sharedDepthFrames: 0,
    fallbackDepthRenders: 0
  });
  assert.equal(pass.uniforms.depthPacking.value, 1);
  assert.equal(pass.compositeUniforms.depthPacking.value, 1);
  pass.dispose();
});
