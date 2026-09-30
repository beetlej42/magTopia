import assert from "node:assert/strict";
import test from "node:test";
import {
  createVoxelBuildingFromSpec, createVoxelBuildingLodLevelsFromSpec,
  deriveRearFacade, VoxelInstanceBuffer
} from "../src/generators/voxelBuildingLab.js";
import { renderBuildingVisualization } from "../src/render/buildingVisualization.js";
import { createBuildingSpec } from "../src/generators/voxelBuildingGrammar.js";

function house(options = {}) {
  return createBuildingSpec({ id: "legacy-home", seed: "rear-test", floors: 3,
    floorPrograms: Array.from({ length: 3 }, () => ({ purpose: "home" })), ...options });
}

function captureVoxels(spec) {
  const createMeshes = VoxelInstanceBuffer.prototype.createMeshes;
  let voxels;
  VoxelInstanceBuffer.prototype.createMeshes = function (...args) {
    voxels = [...this.voxels.values()].map((voxel) => ({ ...voxel }));
    return createMeshes.apply(this, args);
  };
  try {
    const root = createVoxelBuildingFromSpec(spec, { renderStrategy: "greedy" });
    root.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
    return voxels;
  } finally {
    VoxelInstanceBuffer.prototype.createMeshes = createMeshes;
  }
}

test("legacy homes derive deterministic sparse rear modules without spec mutation", () => {
  const spec = house();
  const before = structuredClone(spec);
  const plan = deriveRearFacade(spec);
  assert.deepEqual(plan, deriveRearFacade(structuredClone(spec)));
  assert.equal(plan.floors.length, 3);
  assert.ok(plan.floors.every((floor) => floor.modules.length >= 1 && floor.modules.length <= 3));
  assert.ok(plan.floors.flatMap((floor) => floor.modules).filter((module) => module.type === "service_door").length <= 1);
  const first = captureVoxels(spec);
  assert.deepEqual(first, captureVoxels(structuredClone(spec)));
  assert.deepEqual(spec, before);
  assert.equal(Object.hasOwn(spec, "rearFacade"), false);
  for (const floor of plan.floors) {
    for (const module of floor.modules) {
      const { opening } = module;
      const voxel = first.find((v) => v.x === spec.origin.x + opening.xStart
        && v.y === floor.y + opening.yStart && v.z === spec.origin.z);
      assert.equal(voxel?.owner, `${spec.id}:rear-opening`);
      assert.equal(voxel.materialId, module.type === "service_door" ? spec.materials.door : spec.materials.window);
    }
  }
  assert.ok(first.some((v) => v.owner === `${spec.id}:rear-trim` && v.z < spec.origin.z));
  assert.ok(first.some((v) => v.owner === `${spec.id}:back-wall`));
  const lod = createVoxelBuildingLodLevelsFromSpec(spec, {}, [1, 2, 3]);
  assert.equal(lod.levels.length, 3);
  for (const level of lod.levels) {
    assert.ok(level.meshes.length > 0);
    level.meshes.forEach((mesh) => mesh.geometry.dispose());
  }
});

test("rear plan uses no adjacency inputs and stays within narrow and low legacy floors", () => {
  for (const widthVoxels of [20, 32, 48]) {
    const spec = house({ widthVoxels, floorHeight: 12 });
    const plan = deriveRearFacade(spec);
    const neighborChange = { ...spec, adjacency: { left: true, right: true }, sideFacades: {} };
    assert.deepEqual(plan, deriveRearFacade(neighborChange));
    for (const floor of plan.floors) for (const { opening } of floor.modules) {
      assert.ok(opening.xStart >= 2 && opening.xEnd <= widthVoxels - 3);
      assert.ok(opening.yEnd >= opening.yStart && opening.yEnd + 2 < 12);
    }
  }
});

test("non-residential intent and shop/workshop legacy paths retain solid rear walls", () => {
  for (const spec of [house({ intent: { purpose: "library" } }),
    house({ intent: { purpose: "ministry_of_magic" } }),
    house({ floorPrograms: [{ purpose: "shop" }, { purpose: "home" }, { purpose: "home" }] }),
    house({ floorPrograms: [{ purpose: "workshop" }, { purpose: "storage" }, { purpose: "storage" }] })]) {
    assert.equal(deriveRearFacade(spec), null);
    const voxels = captureVoxels(spec);
    assert.equal(voxels.some((v) => v.owner?.startsWith(`${spec.id}:rear-`)), false);
    const rear = voxels.filter((v) => v.owner === `${spec.id}:back-wall`);
    assert.equal(rear.length, spec.footprint.widthVoxels * spec.wallHeightVoxels);
  }
  assert.equal(deriveRearFacade({ intent: { purpose: "residential" }, masses: [] }), null);
});


test("back-view visualization deterministically exposes rear modules", () => {
  const spec = house();
  const rear = renderBuildingVisualization(spec, { view: "back", size: 256 });
  assert.deepEqual(rear.png, renderBuildingVisualization(structuredClone(spec), { view: "back", size: 256 }).png);
  const solid = renderBuildingVisualization({ ...spec, intent: { purpose: "public_service" } }, { view: "back", size: 256 });
  assert.notDeepEqual(rear.png, solid.png);
  assert.ok(rear.triangleCount > solid.triangleCount);
});
