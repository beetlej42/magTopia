import assert from "node:assert/strict";
import test from "node:test";
import {
  CORNER_FACADE_MODE_IDS,
  VOXEL_PARCEL,
  VOXEL_SIZE,
  VoxelInstanceBuffer,
  createVoxelBuildingLab,
  getVoxelBuildingContract,
  normalizeVoxelBuildingConfig,
  planPitchedRoof,
  planVoxelRoof,
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

test("corner facade modes only decorate exposed terrace ends", () => {
  const plan = planVoxelStreet({
    seed: "corner-facade-test",
    buildingCount: 3,
    floors: 2,
    cornerFacades: "both",
    floorPrograms: [
      { purpose: "shop" },
      { purpose: "home" }
    ]
  });

  assert.deepEqual(CORNER_FACADE_MODE_IDS, ["none", "left", "right", "both"]);
  assert.deepEqual(Object.keys(plan.buildings[0].sideFacades), ["left"]);
  assert.deepEqual(Object.keys(plan.buildings[1].sideFacades), []);
  assert.deepEqual(Object.keys(plan.buildings[2].sideFacades), ["right"]);
  assert.ok(
    plan.buildings[2].sideFacades.right.floors[0].modules.some((module) => module.type === "shop_window")
  );
  assert.ok(plan.buildings[2].ports.sideEntrances.some((port) => port.face === "right"));
  assert.deepEqual(plan, planVoxelStreet({
    seed: "corner-facade-test",
    buildingCount: 3,
    floors: 2,
    cornerFacades: "both",
    floorPrograms: [
      { purpose: "shop" },
      { purpose: "home" }
    ]
  }));
});

test("side facades add real shopfront voxels while blank sides remain plain", () => {
  const plain = createVoxelBuildingLab({
    seed: "corner-shopfront-render",
    buildingCount: 1,
    floors: 1,
    cornerFacades: "none",
    floorPrograms: [{ purpose: "shop" }]
  }).userData.diagnostics;
  const corner = createVoxelBuildingLab({
    seed: "corner-shopfront-render",
    buildingCount: 1,
    floors: 1,
    cornerFacades: "right",
    floorPrograms: [{ purpose: "shop" }]
  }).userData.diagnostics;

  assert.deepEqual(plain.sideFacadeRhythms, [{}]);
  assert.ok(corner.sideFacadeRhythms[0].right);
  assert.ok(corner.materialCounts.warmWindow > plain.materialCounts.warmWindow);
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
  assert.deepEqual(
    after.buildings[2].sideFacades.right.floors.slice(0, before.buildings[2].floors),
    before.buildings[2].sideFacades.right.floors
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

test("each floor keeps an independent window share across front and corner facades", () => {
  const plan = planVoxelStreet({
    seed: "per-floor-window-share",
    buildingCount: 1,
    floors: 2,
    cornerFacades: "right",
    floorPrograms: [
      { purpose: "shop", windowRatio: 0.88 },
      { purpose: "home", windowRatio: 0.24 }
    ]
  });
  const building = plan.buildings[0];
  const openingArea = (module) => (
    (module.opening.xEnd - module.opening.xStart + 1)
    * (module.opening.yEnd - module.opening.yStart + 1)
  );
  const largestOpening = (facade, floor) => Math.max(
    ...facade.floors[floor].modules.filter((module) => module.opening).map(openingArea)
  );

  assert.deepEqual(building.floorSpecs.map((floor) => floor.windowRatio), [0.88, 0.24]);
  assert.deepEqual(building.facade.floors.map((floor) => floor.windowRatio), [0.88, 0.24]);
  assert.deepEqual(building.sideFacades.right.floors.map((floor) => floor.windowRatio), [0.88, 0.24]);
  assert.ok(largestOpening(building.facade, 0) > largestOpening(building.facade, 1));
  assert.ok(largestOpening(building.sideFacades.right, 0) > largestOpening(building.sideFacades.right, 1));
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
    assert.ok(roof.surface.length >= roof.profile.length * (roof.width + roof.overhang * 2) * roof.thickness);
    roof.profile.forEach((row, index) => {
      assert.equal(row.z, index - roof.overhang);
      assert.ok(roof.surface.some((voxel) => voxel.z === row.z));
    });
  }
});

test("near-edge ridges bridge every skipped height so 7% and 93% roofs stay face-connected", () => {
  for (const ridgeRatio of [0.07, 0.93]) {
    const roof = planPitchedRoof({ width: 18, depth: 36, ridgeRatio, ridgeHeight: 14 });
    assert.ok(roof.maximumProfileStep > 1);
    roof.profile.forEach((row, index) => {
      const previousY = roof.profile[index - 1]?.y ?? row.y;
      const lowerY = Math.min(previousY, row.y);
      const upperY = Math.max(previousY, row.y);
      const sliceY = new Set(
        roof.surface
          .filter((voxel) => voxel.x === 0 && voxel.z === row.z)
          .map((voxel) => voxel.y)
      );
      for (let y = lowerY; y <= upperY; y += 1) {
        assert.ok(sliceY.has(y), `ridge ${ridgeRatio} missing bridge voxel at z=${row.z}, y=${y}`);
      }
    });
  }
});

test("two-dimensional roof fields support both gable axes and a four-slope hip", () => {
  const streetGable = planVoxelRoof({
    form: "gable_street",
    width: 32,
    depth: 36,
    ridgeRatio: 0.35,
    ridgeHeight: 12
  });
  const crossGable = planVoxelRoof({
    form: "gable_cross",
    width: 32,
    depth: 36,
    ridgeRatio: 0.65,
    ridgeHeight: 12
  });
  const hip = planVoxelRoof({
    form: "hip",
    width: 32,
    depth: 36,
    ridgeHeight: 12
  });
  const heightAt = (roof, x, z) => roof.heightField.find((cell) => cell.x === x && cell.z === z).y;

  assert.equal(heightAt(streetGable, 2, 10), heightAt(streetGable, 28, 10));
  assert.notEqual(heightAt(streetGable, 16, 2), heightAt(streetGable, 16, 12));
  assert.equal(heightAt(crossGable, 10, 2), heightAt(crossGable, 10, 30));
  assert.notEqual(heightAt(crossGable, 2, 18), heightAt(crossGable, 20, 18));

  assert.equal(heightAt(hip, -1, -1), hip.baseY);
  assert.equal(heightAt(hip, 32, 36), hip.baseY);
  assert.ok(hip.ridgeCells.length > 1);
  assert.ok(hip.ridgeY > hip.baseY);

  for (const roof of [streetGable, crossGable, hip]) {
    const field = new Map(roof.heightField.map((cell) => [`${cell.x},${cell.z}`, cell.y]));
    roof.heightField.forEach((cell) => {
      for (const [dx, dz] of [[-1, 0], [0, -1]]) {
        const neighborY = field.get(`${cell.x + dx},${cell.z + dz}`);
        if (neighborY == null) continue;
        const sliceY = new Set(
          roof.surface
            .filter((voxel) => voxel.x === cell.x && voxel.z === cell.z)
            .map((voxel) => voxel.y)
        );
        for (let y = Math.min(cell.y, neighborY); y <= Math.max(cell.y, neighborY); y += 1) {
          assert.ok(sliceY.has(y), `${roof.form} missing bridge at ${cell.x},${y},${cell.z}`);
        }
      }
    });
  }
});

test("street plans preserve the requested roof form", () => {
  for (const roofForm of ["gable_street", "gable_cross", "hip"]) {
    const plan = planVoxelStreet({ seed: `roof-form-${roofForm}`, roofForm });
    assert.ok(plan.buildings.every((building) => building.roof.form === roofForm));
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
