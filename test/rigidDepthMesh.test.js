import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrthographicCameraBasis,
  mapPointThroughBaseFit,
  reconstructRigidDepthPoint
} from "../src/generators/magicLondonStarterDistrict.js";
import { getIsometricDevelopmentContract } from "../src/generators/isometricAssetRelief.js";

const anchors = {
  left: [0.22666666666666663, 0.35632478632478637],
  near: [0.5, 0.2301709401709402],
  right: [0.7733333333333334, 0.35632478632478637]
};
const reconstruction = {
  baseAnchorsUv: anchors,
  dimensions: { length: 4, width: 4, height: 4 },
  camera: { yaw: 45, elevation: 55 },
  depthEncoding: { minimumViewDepth: -3, maximumViewDepth: 5 }
};

test("rigid depth reconstruction applies no spatial anchor correction", () => {
  const encodedDepth = 0.61;
  const point = reconstructRigidDepthPoint({ ...reconstruction, uv: anchors.near, encodedDepth });
  const basis = createOrthographicCameraBasis(reconstruction.camera);
  assert.ok(Math.abs(point.dot(basis.view) - (-3 + encodedDepth * 8)) < 1e-10);
});

test("rigid reconstruction has no building or screen-position input", () => {
  const input = { ...reconstruction, uv: [0.48, 0.76], encodedDepth: 0.61 };
  const center = reconstructRigidDepthPoint(input);
  const repeated = reconstructRigidDepthPoint(input);
  assert.ok(center.distanceTo(repeated) < 1e-12);
  assert.deepEqual(Object.keys(input).sort(), ["baseAnchorsUv", "camera", "depthEncoding", "dimensions", "encodedDepth", "uv"]);
});

test("guide camera basis is orthonormal and position independent", () => {
  const basis = createOrthographicCameraBasis({ yaw: 45, elevation: 55 });
  assert.ok(Math.abs(basis.right.length() - 1) < 1e-12);
  assert.ok(Math.abs(basis.up.length() - 1) < 1e-12);
  assert.ok(Math.abs(basis.view.length() - 1) < 1e-12);
  assert.ok(Math.abs(basis.right.dot(basis.up)) < 1e-12);
  assert.ok(Math.abs(basis.right.dot(basis.view)) < 1e-12);
  assert.ok(Math.abs(basis.up.dot(basis.view)) < 1e-12);
});

test("triangle mapping still pins the three guideplate anchors", () => {
  const targets = { left: [-2, 2], near: [2, 2], right: [2, -2] };
  for (const key of Object.keys(targets)) {
    assert.deepEqual(mapPointThroughBaseFit(anchors[key], anchors, targets), targets[key]);
  }
});

test("exported camera contract reports the projection actually selected by Perspective", () => {
  assert.equal(getIsometricDevelopmentContract({ perspective: 0 }).camera.projection, "orthographic");
  const perspective = getIsometricDevelopmentContract({ perspective: 1 }).camera;
  assert.equal(perspective.projection, "perspective");
  assert.equal(perspective.perspective, 1);
});
