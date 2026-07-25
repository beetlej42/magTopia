import assert from "node:assert/strict";
import test from "node:test";
import {
  VOXEL_PARCEL,
  VOXEL_SIZE,
  VoxelInstanceBuffer,
  createVoxelBuildingLab,
  getVoxelBuildingContract,
  normalizeVoxelBuildingConfig,
  planPitchedRoof,
  planVoxelStreet,
  VOXEL_WRITE_PRIORITIES
} from "../src/generators/voxelBuildingLab.js";
import {
  BUILDING_SPEC_VERSION,
  createBuildingSpec,
  planFacadeGrammar
} from "../src/generators/voxelBuildingGrammar.js";

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
  assert.equal(config.archetypeVariant, 0);
  assert.equal(config.styleVariant, 0);
  assert.equal(config.parcelWidth, 32);
  assert.equal(config.parcelDepth, 36);
  assert.equal(config.detailDensity, 1);
});

test("simple agent names resolve to archetype, style kit, and roof family", () => {
  const config = normalizeVoxelBuildingConfig({
    archetype: "workshop",
    style: "forest_craft",
    roofType: "mansard"
  });

  assert.equal(config.archetype, "workshop");
  assert.equal(config.archetypeVariant, 2);
  assert.equal(config.style, "forest_craft");
  assert.equal(config.styleVariant, 2);
  assert.equal(config.materialScheme, 2);
  assert.equal(config.roofType, "mansard");
  assert.equal(config.roofVariant, 1);
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
  assert.deepEqual(
    after.buildings[1].facade.floors.slice(0, before.buildings[1].floors),
    before.buildings[1].facade.floors
  );
  assert.deepEqual(after.buildings[1].materials, before.buildings[1].materials);
});

test("voxel contract exposes simple agent controls and derived rendering", () => {
  const contract = getVoxelBuildingContract({ buildingCount: 2, floors: 4 });

  assert.equal(contract.renderer, "voxel-procedural-v1");
  assert.equal(contract.buildingGrammar.specVersion, BUILDING_SPEC_VERSION);
  assert.equal(contract.buildingGrammar.stableSubSeeds, true);
  assert.equal(contract.sourceOfTruth.includes("BuildingSpec"), true);
  assert.equal(contract.meshing.solidInteriors, false);
  assert.equal(contract.expansion.supported, true);
  assert.equal(contract.adjacency.supported, true);
  assert.ok(contract.agentControl.simple.includes("archetype"));
  assert.ok(contract.materialIds.includes("warmWindow"));
  assert.equal(contract.plan.buildings.length, 2);
});

test("voxel occupancy is mutually exclusive and later materials win", () => {
  const buffer = new VoxelInstanceBuffer("last-write-wins");
  buffer.addVoxel("brickRed", 4, 8, 12);
  buffer.addVoxel("sandstone", 4, 8, 12);

  assert.equal(buffer.occupiedVoxelCount, 1);
  assert.equal(buffer.overwrittenVoxelCount, 1);
  assert.equal(buffer.getMaterialAt(4, 8, 12), "sandstone");
});

test("semantic voxel priorities reject lower-phase writes but preserve equal-phase last-write-wins", () => {
  const buffer = new VoxelInstanceBuffer("semantic-write-priority");
  buffer.addVoxel("sandstone", 1, 2, 3, 0, { priority: VOXEL_WRITE_PRIORITIES.trim });
  buffer.addVoxel("brickRed", 1, 2, 3, 0, { priority: VOXEL_WRITE_PRIORITIES.structure });
  assert.equal(buffer.getMaterialAt(1, 2, 3), "sandstone");
  assert.equal(buffer.rejectedVoxelCount, 1);

  buffer.addVoxel("limestone", 1, 2, 3, 0, { priority: VOXEL_WRITE_PRIORITIES.trim });
  assert.equal(buffer.getMaterialAt(1, 2, 3), "limestone");
});

test("BuildingSpec v0.1 produces bounded facade bays and stable lower-floor sub-seeds", () => {
  const before = createBuildingSpec({
    id: "stable-magic-shop",
    seed: "facade-stability",
    archetype: "magic_shop",
    style: "violet_alchemist",
    widthVoxels: 36,
    depthVoxels: 40,
    baseFloors: 2,
    expandedBy: 0,
    variation: 0.8,
    detailDensity: 1
  });
  const after = createBuildingSpec({
    id: "stable-magic-shop",
    seed: "facade-stability",
    archetype: "magic_shop",
    style: "violet_alchemist",
    widthVoxels: 36,
    depthVoxels: 40,
    baseFloors: 2,
    expandedBy: 1,
    variation: 0.8,
    detailDensity: 1
  });

  assert.equal(before.specVersion, BUILDING_SPEC_VERSION);
  assert.deepEqual(after.facade.floors.slice(0, before.floors), before.facade.floors);
  assert.deepEqual(after.materials, before.materials);
  assert.equal(after.roof.type, before.roof.type);
  assert.deepEqual(after.decorations.magicWindow, before.decorations.magicWindow);
  assert.equal(before.facade.bays.reduce((total, bay) => total + bay.width, 0), 32);
  assert.equal(before.facade.bays[0].start, 2);
  assert.equal(
    before.facade.bays.at(-1).start + before.facade.bays.at(-1).width,
    before.footprint.widthVoxels - 2
  );
});

test("facade grammar varies deterministically across seeds without leaving its parcel", () => {
  const first = planFacadeGrammar({
    seed: "facade-a",
    width: 28,
    floors: 3,
    archetype: "workshop",
    variation: 1
  });
  const replay = planFacadeGrammar({
    seed: "facade-a",
    width: 28,
    floors: 3,
    archetype: "workshop",
    variation: 1
  });
  const second = planFacadeGrammar({
    seed: "facade-b",
    width: 28,
    floors: 3,
    archetype: "workshop",
    variation: 1
  });

  assert.deepEqual(replay, first);
  assert.notDeepEqual(second, first);
  first.floors.flatMap((floor) => floor.modules).forEach((module) => {
    if (!module.opening) return;
    assert.ok(module.opening.xStart >= 2);
    assert.ok(module.opening.xEnd < 26);
  });
});

test("procedural pitched roofs adapt to dimensions and fill both end gables", () => {
  const narrow = planPitchedRoof({ width: 16, depth: 20, baseY: 40, ridgeHeight: 7 });
  const wide = planPitchedRoof({ width: 48, depth: 30, baseY: 60, ridgeHeight: 11 });

  assert.equal(narrow.ridgeY, 47);
  assert.equal(wide.ridgeY, 71);
  assert.equal(narrow.profile.length, narrow.depth + narrow.overhang * 2);
  assert.equal(wide.profile.length, wide.depth + wide.overhang * 2);
  assert.ok(wide.surface.length > narrow.surface.length);

  for (const roof of [narrow, wide]) {
    for (let z = 0; z < roof.depth; z += 1) {
      const roofY = roof.profile[z + roof.overhang].y;
      const leftColumn = roof.endCaps.left.filter((voxel) => voxel.z === z);
      const rightColumn = roof.endCaps.right.filter((voxel) => voxel.z === z);
      assert.equal(leftColumn.length, roofY - roof.baseY);
      assert.equal(rightColumn.length, roofY - roof.baseY);
      assert.equal(leftColumn[0]?.y ?? roof.baseY, roof.baseY);
      assert.equal(rightColumn[0]?.y ?? roof.baseY, roof.baseY);
    }
  }
});

test("technical slice batches surface voxels into a bounded material draw-call set", () => {
  const object = createVoxelBuildingLab({
    seed: "render-batch-test",
    buildingCount: 3,
    floors: 3,
    expansionFloors: 1,
    detailDensity: 1,
    archetypeVariant: 1,
    styleVariant: 1,
    roofVariant: 2
  });
  const diagnostics = object.userData.getVoxelDiagnostics();

  assert.equal(diagnostics.buildingCount, 3);
  assert.equal(diagnostics.connectionCount, 2);
  assert.equal(diagnostics.omittedPartyWalls, 4);
  assert.equal(diagnostics.surfaceOnly, true);
  assert.equal(diagnostics.expandedBuildingId, "voxel-building-2");
  assert.equal(diagnostics.magicDecorationPlacement, "upper_window");
  assert.equal(diagnostics.specVersion, BUILDING_SPEC_VERSION);
  assert.deepEqual(diagnostics.archetypes, ["magic_shop"]);
  assert.deepEqual(diagnostics.styleKits, ["violet_alchemist"]);
  assert.ok(diagnostics.magicWindowCount > 0);
  assert.ok(diagnostics.overwrittenVoxels > 0);
  assert.ok(diagnostics.rejectedLowerPriorityVoxels > 0);
  assert.ok(diagnostics.exposedPartyWallVoxels > 0);
  assert.ok(diagnostics.culledInteriorVoxels > 0);
  assert.ok(diagnostics.instanceCount > 8_000);
  assert.ok(diagnostics.instanceCount < 50_000);
  assert.ok(diagnostics.drawCalls <= 14);
  assert.equal(
    object.children.filter((child) => child.isInstancedMesh).length,
    diagnostics.drawCalls
  );
  const magicMesh = object.children.find((child) => child.userData.materialId === "violetMagic");
  const daylightEmission = magicMesh.material.emissiveIntensity;
  object.userData.updateDaylight({ nightFactor: 1 });
  assert.ok(magicMesh.material.emissiveIntensity > daylightEmission);
});
