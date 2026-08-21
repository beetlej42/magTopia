import assert from "node:assert/strict";
import test from "node:test";

import {
  sampleVoxelVertexAmbientOcclusion,
  voxelVertexAmbientOcclusion
} from "../src/render/voxelAmbientOcclusion.js";

test("voxel AO preserves exposed vertices and darkens occupied corners", () => {
  assert.equal(voxelVertexAmbientOcclusion(false, false, false), 1);
  assert.ok(voxelVertexAmbientOcclusion(true, false, false) < 1);
  assert.ok(Math.abs(voxelVertexAmbientOcclusion(true, true, false) - 0.68) < 1e-12);
  assert.ok(Math.abs(voxelVertexAmbientOcclusion(true, true, true) - 0.68) < 1e-12);
});

test("voxel AO samples the three cells outside a positive face corner", () => {
  const occupied = new Set(["1:-1:0", "1:0:-1", "1:-1:-1"]);
  const factor = sampleVoxelVertexAmbientOcclusion({
    face: { axis: 0, uAxis: 1, vAxis: 2, normal: [1, 0, 0] },
    plane: 1,
    u: 0,
    v: 0,
    width: 1,
    height: 1,
    cornerU: 0,
    cornerV: 0,
    hasVoxel: (x, y, z) => occupied.has(`${x}:${y}:${z}`)
  });

  assert.ok(Math.abs(factor - 0.68) < 1e-12);
});

test("voxel AO respects negative face orientation", () => {
  const sampled = [];
  sampleVoxelVertexAmbientOcclusion({
    face: { axis: 0, uAxis: 2, vAxis: 1, normal: [-1, 0, 0] },
    plane: 0,
    u: 0,
    v: 0,
    width: 1,
    height: 1,
    cornerU: 1,
    cornerV: 1,
    hasVoxel: (x, y, z) => {
      sampled.push([x, y, z]);
      return false;
    }
  });

  assert.deepEqual(sampled, [[-1, 0, 1], [-1, 1, 0], [-1, 1, 1]]);
});
