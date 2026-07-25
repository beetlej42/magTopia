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
  planFacadeGrammar,
  planFloorStack
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
  assert.equal(config.roofVariant, 0);
  assert.equal(config.roofType, "pitched");
  assert.equal(config.materialScheme, 0);
  assert.equal(config.archetypeVariant, 1);
  assert.equal(config.styleVariant, 0);
  assert.equal(config.parcelWidth, 32);
  assert.equal(config.parcelDepth, 36);
  assert.equal(config.detailDensity, 1);
});

test("atomic floor programs derive the building archetype and keep the selected style", () => {
  const config = normalizeVoxelBuildingConfig({
    floors: 2,
    floorPrograms: [
      { purpose: "workshop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" }
    ],
    style: "forest_craft",
    ridgePosition: 1,
    windowRatio: 0.2
  });

  assert.equal(config.archetype, "workshop");
  assert.equal(config.archetypeVariant, 2);
  assert.equal(config.style, "forest_craft");
  assert.equal(config.styleVariant, 2);
  assert.equal(config.materialScheme, 2);
  assert.equal(config.roofType, "pitched");
  assert.equal(config.ridgePosition, 1);
  assert.deepEqual(config.floorPrograms.slice(0, 2).map((floor) => floor.purpose), ["workshop", "home"]);
  assert.ok(config.floorPrograms.slice(0, 2).every((floor) => floor.windowRatio === 0.2));
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
  assert.deepEqual(
    after.buildings[1].floorSpecs.slice(0, before.buildings[1].floors),
    before.buildings[1].floorSpecs
  );
  assert.equal(after.buildings[1].floorSpecs.at(-1).setbackVoxels, 0);
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
  assert.ok(contract.agentControl.simple.includes("floorPrograms"));
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

test("BuildingSpec v0.2 produces bounded facade bays and stable lower-floor sub-seeds", () => {
  const before = createBuildingSpec({
    id: "stable-magic-shop",
    seed: "facade-stability",
    archetype: "magic_shop",
    style: "violet_alchemist",
    widthVoxels: 36,
    depthVoxels: 40,
    baseFloors: 2,
    expandedBy: 0,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" }
    ],
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
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" }
    ],
    variation: 0.8,
    detailDensity: 1
  });

  assert.equal(before.specVersion, BUILDING_SPEC_VERSION);
  assert.deepEqual(after.facade.floors.slice(0, before.floors), before.facade.floors);
  assert.deepEqual(after.materials, before.materials);
  assert.equal(after.roof.type, before.roof.type);
  assert.equal(after.roof.type, "pitched");
  assert.deepEqual(after.decorations.magicWindow, before.decorations.magicWindow);
  assert.equal(before.facade.bays.reduce((total, bay) => total + bay.width, 0), 32);
  assert.equal(before.facade.bays[0].start, 2);
  assert.equal(
    before.facade.bays.at(-1).start + before.facade.bays.at(-1).width,
    before.footprint.widthVoxels - 2
  );
});

test("floor stacks compose purpose, cumulative setbacks, balconies, and a one-floor building", () => {
  const stack = planFloorStack({
    floors: 3,
    depthVoxels: 36,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" },
      { purpose: "storage", setbackVoxels: 4, balcony: "selective" }
    ],
    windowRatio: 0.25
  });

  assert.deepEqual(stack.map((floor) => floor.purpose), ["shop", "home", "storage"]);
  assert.deepEqual(stack.map((floor) => floor.frontSetbackVoxels), [0, 2, 6]);
  assert.deepEqual(stack.map((floor) => floor.balcony), ["none", "full", "selective"]);
  assert.ok(stack.every((floor) => floor.windowRatio === 0.25));

  const oneFloor = createBuildingSpec({
    floors: 1,
    floorPrograms: [{ purpose: "shop" }],
    ridgePosition: 0
  });
  assert.equal(oneFloor.floors, 1);
  assert.equal(oneFloor.floorSpecs.length, 1);
  assert.equal(oneFloor.floorSpecs[0].purpose, "shop");
  assert.equal(oneFloor.roof.ridgeRatio, 0);
});

test("smaller window share produces genuinely smaller openings", () => {
  const compact = planFacadeGrammar({
    seed: "window-share",
    width: 32,
    floors: 2,
    floorPrograms: [{ purpose: "shop" }, { purpose: "home" }],
    windowRatio: 0.2
  });
  const generous = planFacadeGrammar({
    seed: "window-share",
    width: 32,
    floors: 2,
    floorPrograms: [{ purpose: "shop" }, { purpose: "home" }],
    windowRatio: 0.8
  });
  const compactOpening = compact.floors[1].modules.find((module) => module.opening).opening;
  const generousOpening = generous.floors[1].modules.find((module) => module.opening).opening;

  assert.ok(compactOpening.xEnd - compactOpening.xStart < generousOpening.xEnd - generousOpening.xStart);
  assert.ok(compactOpening.yEnd - compactOpening.yStart < generousOpening.yEnd - generousOpening.yStart);
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

test("ridge extremes produce continuous opposite mono-pitch profiles", () => {
  const backRidge = planPitchedRoof({ depth: 24, ridgeRatio: 0, ridgeHeight: 10 });
  const centered = planPitchedRoof({ depth: 24, ridgeRatio: 0.5, ridgeHeight: 10 });
  const frontRidge = planPitchedRoof({ depth: 24, ridgeRatio: 1, ridgeHeight: 10 });

  assert.equal(backRidge.ridgeIndex, 0);
  assert.equal(frontRidge.ridgeIndex, frontRidge.profile.length - 1);
  assert.ok(backRidge.edgeCaps.back.length > backRidge.edgeCaps.front.length);
  assert.ok(frontRidge.edgeCaps.front.length > frontRidge.edgeCaps.back.length);
  assert.ok(backRidge.profile.every((row, index, rows) => index === 0 || row.y <= rows[index - 1].y));
  assert.ok(frontRidge.profile.every((row, index, rows) => index === 0 || row.y >= rows[index - 1].y));
  for (const roof of [backRidge, centered, frontRidge]) {
    assert.equal(roof.surface.length, roof.profile.length * (roof.width + roof.overhang * 2) * roof.thickness);
    roof.profile.forEach((row, index) => {
      assert.equal(row.z, index - roof.overhang);
      assert.ok(roof.surface.some((voxel) => voxel.z === row.z));
    });
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
    styleVariant: 1
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
