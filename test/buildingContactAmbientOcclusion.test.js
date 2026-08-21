import assert from "node:assert/strict";
import test from "node:test";

import { createBuildingContactAmbientOcclusion } from "../src/render/buildingContactAmbientOcclusion.js";

test("building contact AO adds a faded footprint patch with negligible geometry", () => {
  const mesh = createBuildingContactAmbientOcclusion({
    buildings: [{ footprintCells: ["0:0"] }],
    cells: [{ id: "0:0", center: { x: 2, z: -3 } }],
    cellWorldSize: 4,
    sampleGroundHeight: () => 0.5,
    margin: 0.5,
    opacity: 0.24
  });

  assert.equal(mesh.userData.patchCount, 1);
  assert.equal(mesh.userData.triangleCount, 18);
  assert.equal(mesh.geometry.getAttribute("position").count, 16);
  assert.equal(mesh.geometry.getAttribute("color").itemSize, 4);
  assert.equal(mesh.geometry.getAttribute("color").getW(0), 0);
  assert.ok(Math.abs(mesh.geometry.getAttribute("color").getW(5) - 0.24) < 1e-6);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.userData.flatVoxelGeometry, true);
});

test("building contact AO skips unresolved footprint cells", () => {
  const mesh = createBuildingContactAmbientOcclusion({
    buildings: [{ footprintCells: ["missing"] }],
    cells: []
  });

  assert.equal(mesh.userData.patchCount, 0);
  assert.equal(mesh.geometry.getAttribute("position").count, 0);
});
