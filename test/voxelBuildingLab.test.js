import assert from "node:assert/strict";
import test from "node:test";
import {
  VOXEL_PARCEL,
  VOXEL_SIZE,
  createVoxelBuildingLab,
  getVoxelBuildingContract,
  normalizeVoxelBuildingConfig,
  planVoxelStreet
} from "../src/generators/voxelBuildingLab.js";

test("voxel config keeps the high-resolution parcel contract bounded", () => {
  const config = normalizeVoxelBuildingConfig({
    floors: 99,
    expansionFloors: -5,
    buildingCount: 7,
    roofVariant: 8,
    materialScheme: -2,
    detailDensity: 3
  });

  assert.equal(VOXEL_SIZE, 0.125);
  assert.equal(VOXEL_PARCEL.width, 32);
  assert.equal(config.floors, 5);
  assert.equal(config.expansionFloors, 0);
  assert.equal(config.buildingCount, 3);
  assert.equal(config.roofVariant, 2);
  assert.equal(config.materialScheme, 0);
  assert.equal(config.detailDensity, 1);
});

test("adjacent buildings share deterministic party-wall ports", () => {
  const plan = planVoxelStreet({
    seed: "party-wall-test",
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0
  });

  assert.equal(plan.connections.length, 2);
  assert.equal(plan.buildings[0].origin.x + VOXEL_PARCEL.width, plan.buildings[1].origin.x);
  assert.equal(plan.buildings[1].origin.x + VOXEL_PARCEL.width, plan.buildings[2].origin.x);
  assert.equal(plan.buildings[0].adjacency.exposedLeftWall, true);
  assert.equal(plan.buildings[0].adjacency.exposedRightWall, false);
  assert.equal(plan.buildings[1].adjacency.exposedLeftWall, false);
  assert.equal(plan.buildings[1].adjacency.exposedRightWall, false);
  assert.equal(plan.buildings[2].adjacency.exposedRightWall, true);
  assert.deepEqual(plan, planVoxelStreet({
    seed: "party-wall-test",
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0
  }));
});

test("adding floors changes only the selected building and regenerates its roof base", () => {
  const before = planVoxelStreet({ seed: "vertical-expansion", buildingCount: 3, floors: 3, expansionFloors: 0 });
  const after = planVoxelStreet({ seed: "vertical-expansion", buildingCount: 3, floors: 3, expansionFloors: 1 });

  assert.equal(after.buildings[0].floors, before.buildings[0].floors);
  assert.equal(after.buildings[2].floors, before.buildings[2].floors);
  assert.equal(after.buildings[1].floors, before.buildings[1].floors + 1);
  assert.equal(after.buildings[1].wallHeightVoxels, before.buildings[1].wallHeightVoxels + VOXEL_PARCEL.floorHeight);
  assert.equal(after.buildings[1].ports.verticalExpansion.floor, 4);
  assert.equal(after.buildings[1].roof.type, before.buildings[1].roof.type);
});

test("voxel contract exposes simple agent controls and derived rendering", () => {
  const contract = getVoxelBuildingContract({ buildingCount: 2, floors: 4 });

  assert.equal(contract.renderer, "voxel-procedural-v1");
  assert.equal(contract.sourceOfTruth.includes("BuildingSpec"), true);
  assert.equal(contract.meshing.solidInteriors, false);
  assert.equal(contract.expansion.supported, true);
  assert.equal(contract.adjacency.supported, true);
  assert.ok(contract.agentControl.simple.includes("archetype"));
  assert.ok(contract.materialIds.includes("warmWindow"));
  assert.equal(contract.plan.buildings.length, 2);
});

test("technical slice batches surface voxels into a bounded material draw-call set", () => {
  const object = createVoxelBuildingLab({
    seed: "render-batch-test",
    buildingCount: 3,
    floors: 3,
    expansionFloors: 1,
    detailDensity: 1
  });
  const diagnostics = object.userData.getVoxelDiagnostics();

  assert.equal(diagnostics.buildingCount, 3);
  assert.equal(diagnostics.connectionCount, 2);
  assert.equal(diagnostics.omittedPartyWalls, 4);
  assert.equal(diagnostics.surfaceOnly, true);
  assert.equal(diagnostics.expandedBuildingId, "voxel-building-2");
  assert.ok(diagnostics.instanceCount > 8_000);
  assert.ok(diagnostics.instanceCount < 30_000);
  assert.ok(diagnostics.drawCalls <= 14);
  assert.equal(
    object.children.filter((child) => child.isInstancedMesh).length,
    diagnostics.drawCalls
  );
});
