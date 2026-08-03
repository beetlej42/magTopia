import assert from "node:assert/strict";
import test from "node:test";
import { createVoxelMassingLab } from "../src/generators/voxelBuildingLab.js";
import {
  MASSING_CELL_VOXELS,
  MASSING_MAX_GRID_SPAN,
  URBAN_MASSING_SPEC_VERSION,
  VOXEL_MASSING_PRESETS,
  createRandomVoxelMassingConfig,
  createUrbanMassingSpec,
  getUrbanMassingCatalog,
  normalizeMassingFootprint
} from "../src/generators/voxelMassingGrammar.js";

test("massing footprints accept edge-connected masks inside a 6x6 site", () => {
  const footprint = normalizeMassingFootprint([
    { x: 4, z: 7, use: "mass" },
    { x: 5, z: 7, use: "mass" },
    { x: 4, z: 8, use: "ground" },
    { x: 4, z: 9, use: "reserved" }
  ]);

  assert.equal(MASSING_MAX_GRID_SPAN, 6);
  assert.equal(MASSING_CELL_VOXELS, 32);
  assert.equal(footprint.widthCells, 2);
  assert.equal(footprint.depthCells, 3);
  assert.equal(footprint.cellCount, 4);
  assert.equal(footprint.massCellCount, 2);
  assert.equal(footprint.groundCellCount, 1);
  assert.equal(footprint.reservedCellCount, 1);
  assert.deepEqual(footprint.cells[0], { x: 0, z: 0, use: "mass" });
});

test("massing footprints reject oversized and diagonal-only sites", () => {
  assert.throws(
    () => normalizeMassingFootprint([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]),
    /fit inside 6x6/
  );
  assert.throws(
    () => normalizeMassingFootprint([[0, 0], [1, 1]]),
    /edge-connected/
  );
});

test("massing specs normalize four enclosure types, voids, caps, and typed relations", () => {
  const spec = createUrbanMassingSpec({
    id: "civic-composition",
    seed: "civic-composition-seed",
    widthCells: 2,
    depthCells: 2,
    masses: [
      {
        id: "main",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 32,
        profile: { type: "uniform" },
        cap: { type: "mansard", heightVoxels: 8 },
        voids: [{ type: "arch", direction: "south", widthVoxels: 8, depthVoxels: 4 }]
      },
      {
        id: "greenhouse",
        type: "framed",
        cells: [[1, 0]],
        heightVoxels: 22,
        cap: { type: "glass_ridge", heightVoxels: 8 }
      },
      {
        id: "arcade",
        type: "open",
        cells: [[0, 1]],
        heightVoxels: 12,
        cap: { type: "flat" }
      },
      {
        id: "plaza",
        type: "ground",
        cells: [[1, 1]],
        heightVoxels: 2,
        cap: { type: "flat" }
      },
      {
        id: "tower",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 36,
        planShape: "octagonal",
        profile: { type: "tapered", stepHeightVoxels: 12, stepVoxels: 1 },
        cap: { type: "spire", heightVoxels: 18 }
      }
    ],
    relations: [
      { type: "portal", from: "main", to: "greenhouse", widthVoxels: 6, heightVoxels: 12 },
      { type: "stacked", from: "main", to: "tower" }
    ]
  });

  assert.equal(spec.specVersion, URBAN_MASSING_SPEC_VERSION);
  assert.deepEqual(spec.masses.slice(0, 4).map((mass) => mass.type), ["solid", "framed", "open", "ground"]);
  assert.equal(spec.masses.find((mass) => mass.id === "tower").baseYVoxels, 32);
  assert.deepEqual(spec.relations.map((relation) => relation.type), ["portal", "stacked"]);
  assert.equal(spec.masses[0].voids[0].type, "arch");
  assert.equal(spec.constraints.railIntegration, false);
});

test("the generic massing compiler renders all base enclosures and aligned portals", () => {
  const object = createVoxelMassingLab({
    id: "massing-render-smoke",
    seed: "massing-render-smoke",
    widthCells: 2,
    depthCells: 2,
    masses: [
      {
        id: "main",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 28,
        cap: { type: "hip", heightVoxels: 7 },
        voids: [{ type: "recess", direction: "south", widthVoxels: 8, depthVoxels: 3 }]
      },
      {
        id: "glass-hall",
        type: "framed",
        cells: [[1, 0]],
        heightVoxels: 20,
        cap: { type: "glass_ridge", heightVoxels: 7 }
      },
      {
        id: "portico",
        type: "open",
        cells: [[0, 1]],
        heightVoxels: 10,
        cap: { type: "parapet" }
      },
      {
        id: "court",
        type: "ground",
        cells: [[1, 1]],
        heightVoxels: 2,
        cap: { type: "flat" }
      }
    ],
    relations: [
      { type: "portal", from: "main", to: "glass-hall", widthVoxels: 6, heightVoxels: 12 }
    ]
  });
  const diagnostics = object.userData.getVoxelDiagnostics();

  assert.equal(diagnostics.renderer, "voxel-massing-v1");
  assert.equal(diagnostics.footprintCells, 4);
  assert.deepEqual(diagnostics.footprintSpan, [2, 2]);
  assert.deepEqual(diagnostics.massTypes, ["solid", "framed", "open", "ground"]);
  assert.equal(diagnostics.relationCuts, 2);
  assert.equal(diagnostics.voidCount, 1);
  assert.ok(diagnostics.materialCounts.lightGlass > 0);
  assert.ok(diagnostics.materialCounts.iron > 0);
  assert.ok(diagnostics.materialCounts.brickRed > 0);
  assert.ok(diagnostics.instanceCount > 1_000);
  assert.ok(diagnostics.drawCalls <= 12);
});

test("the public massing catalog exposes the complete minimum capability set", () => {
  const catalog = getUrbanMassingCatalog();

  assert.deepEqual(catalog.massTypes, ["solid", "framed", "open", "ground"]);
  assert.ok(catalog.planShapes.includes("semicircle"));
  assert.deepEqual(catalog.verticalProfiles, ["uniform", "stepped", "tapered", "stacked"]);
  assert.ok(catalog.caps.includes("dome"));
  assert.ok(catalog.caps.includes("spire"));
  assert.ok(catalog.caps.includes("sawtooth"));
  assert.deepEqual(catalog.voids, ["courtyard", "passage", "recess", "arch"]);
  assert.deepEqual(catalog.relations, ["separate", "adjoin", "portal", "stacked"]);
  assert.deepEqual(catalog.openSideModes, ["auto", "columns", "open", "wall"]);
  assert.deepEqual(catalog.facadeOrders, ["plain", "classical", "industrial", "gothic"]);
  assert.equal(catalog.singleCellDimensions.parameter, "dimensionsVoxels");
  assert.equal(catalog.singleCellDimensions.logicalCellVoxels, 32);
  assert.deepEqual(catalog.placement.controls, ["setbacksVoxels", "offsetVoxels"]);
  assert.deepEqual(catalog.groundTreatment.patterns, ["plain", "bordered", "courtyard", "garden"]);
  assert.ok(catalog.framedEnclosure.controls.includes("reliefDepthVoxels"));
  assert.ok(catalog.relationFinish.controls.includes("baseCourseHeightVoxels"));
});

test("random massing is seed-stable and changes visible geometry across seeds", () => {
  const first = createRandomVoxelMassingConfig("random-a");
  const replay = createRandomVoxelMassingConfig("random-a");
  const second = createRandomVoxelMassingConfig("random-b");
  const visibleChoices = (spec) => spec.masses.map((mass) => ({
    id: mass.id,
    heightVoxels: mass.heightVoxels,
    planShape: mass.planShape,
    profile: mass.profile.type,
    cap: mass.cap.type,
    capHeight: mass.cap.heightVoxels,
    wall: mass.materials.wall
  }));

  assert.deepEqual(replay, first);
  assert.notDeepEqual(visibleChoices(second), visibleChoices(first));
});

test("steep tower caps compile as continuous one-layer shell steps", () => {
  const object = createVoxelMassingLab({
    id: "connected-spire",
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "tower",
      type: "solid",
      cells: [[0, 0]],
      heightVoxels: 28,
      planShape: "octagonal",
      cap: { type: "spire", heightVoxels: 28 }
    }]
  });
  const diagnostics = object.userData.getVoxelDiagnostics();
  const towerCap = diagnostics.capPlans.find((cap) => cap.id === "tower");

  assert.equal(towerCap.maximumStep, 1);
  assert.equal(towerCap.bridgeVoxels, 0);
  assert.ok(towerCap.surfaceVoxels > 0);
  assert.equal(diagnostics.capBridgeVoxels, towerCap.bridgeVoxels);
});

test("framed masses default to light limestone structure instead of dark iron", () => {
  const spec = createUrbanMassingSpec({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "greenhouse",
      type: "framed",
      cells: [[0, 0]],
      heightVoxels: 20
    }]
  });

  assert.equal(spec.masses[0].materials.frame, "limestone");
  assert.equal(spec.masses[0].materials.trim, "limestone");
  assert.equal(spec.masses[0].materials.panel, "lightGlass");
  const rendered = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  assert.ok(rendered.materialCounts.limestone > 0);
  assert.ok(rendered.materialCounts.lightGlass > 0);
  assert.equal(rendered.materialCounts.iron, undefined);
  assert.equal(rendered.materialCounts.brickRed, undefined);
});

test("framed masses expose deterministic bay rhythm and projected structural relief", () => {
  const render = (reliefDepthVoxels) => {
    const spec = createUrbanMassingSpec({
      widthCells: 1,
      depthCells: 1,
      masses: [{
        id: "glass-hall",
        type: "framed",
        cells: [[0, 0]],
        heightVoxels: 20,
        cap: { type: "glass_ridge", heightVoxels: 7 },
        framing: {
          baySpacingVoxels: 6,
          frameWidthVoxels: 1,
          floorBeamSpacingVoxels: 7,
          reliefDepthVoxels
        }
      }]
    });
    return {
      spec,
      diagnostics: createVoxelMassingLab(spec).userData.getVoxelDiagnostics()
    };
  };
  const flush = render(0);
  const projected = render(2);
  const projectedMass = projected.diagnostics.massPlans[0];

  assert.deepEqual(projected.spec.masses[0].framing, {
    baySpacingVoxels: 6,
    frameWidthVoxels: 1,
    floorBeamSpacingVoxels: 7,
    reliefDepthVoxels: 2
  });
  assert.equal(flush.diagnostics.massPlans[0].framedReliefVoxels, 0);
  assert.ok(projectedMass.framedReliefVoxels > 0);
  assert.ok(projected.diagnostics.materialCounts.limestone > flush.diagnostics.materialCounts.limestone);
});

test("portal and stacked relations derive architectural interface finishes", () => {
  const spec = createUrbanMassingSpec({
    widthCells: 2,
    depthCells: 1,
    masses: [
      {
        id: "hall",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 20,
        cap: { type: "flat" }
      },
      {
        id: "wing",
        type: "solid",
        cells: [[1, 0]],
        heightVoxels: 16,
        cap: { type: "flat" }
      },
      {
        id: "tower",
        type: "solid",
        cells: [[0, 0]],
        dimensionsVoxels: { width: 18, depth: 18 },
        heightVoxels: 18,
        cap: { type: "spire", heightVoxels: 10 }
      }
    ],
    relations: [
      {
        id: "hall-wing-door",
        type: "portal",
        from: "hall",
        to: "wing",
        widthVoxels: 6,
        heightVoxels: 11,
        finish: { trimWidthVoxels: 2, thresholdVoxels: 1 }
      },
      {
        id: "tower-base",
        type: "stacked",
        from: "hall",
        to: "tower",
        finish: { baseCourseHeightVoxels: 3, apronWidthVoxels: 2 }
      }
    ]
  });
  const diagnostics = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const portal = diagnostics.relationFinishes.find((finish) => finish.id === "hall-wing-door");
  const stacked = diagnostics.relationFinishes.find((finish) => finish.id === "tower-base");

  assert.deepEqual(spec.relations[0].finish, {
    trimWidthVoxels: 2,
    thresholdVoxels: 1,
    baseCourseHeightVoxels: 0,
    apronWidthVoxels: 0
  });
  assert.deepEqual(spec.relations[1].finish, {
    trimWidthVoxels: 0,
    thresholdVoxels: 0,
    baseCourseHeightVoxels: 3,
    apronWidthVoxels: 2
  });
  assert.equal(portal.cutCount, 2);
  assert.ok(portal.voxels > 0);
  assert.ok(stacked.voxels > 0);
  assert.equal(diagnostics.relationFinishVoxels, portal.voxels + stacked.voxels);
});

test("ground treatments derive borders, paving axes, and deterministic planters", () => {
  const spec = createUrbanMassingSpec({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "garden-court",
      type: "ground",
      cells: [[0, 0]],
      heightVoxels: 2,
      cap: { type: "flat" },
      groundTreatment: {
        pattern: "garden",
        borderWidthVoxels: 1,
        pathWidthVoxels: 7,
        planterCount: 4
      }
    }]
  });
  const first = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const replay = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const details = first.groundDetails[0];

  assert.deepEqual(spec.masses[0].groundTreatment, {
    pattern: "garden",
    borderWidthVoxels: 1,
    pathWidthVoxels: 7,
    axisMaterial: "",
    planterCount: 4,
    fenceHeightVoxels: 0,
    lampCount: 0,
    stepWidthVoxels: 0,
    stepDepthVoxels: 0
  });
  assert.equal(details.planterCount, 4);
  assert.ok(details.voxels > 0);
  assert.ok(first.materialCounts.foliage > 0);
  assert.deepEqual(replay.groundDetails, first.groundDetails);
});

test("persisted v0.1 specs without the new detail fields hydrate compatibly", () => {
  const persisted = createUrbanMassingSpec({
    id: "legacy-v0.1-detail-shape",
    widthCells: 2,
    depthCells: 1,
    masses: [
      { id: "hall", type: "solid", cells: [[0, 0]], heightVoxels: 18 },
      { id: "glass", type: "framed", cells: [[1, 0]], heightVoxels: 16 }
    ],
    relations: [
      { id: "old-portal", type: "portal", from: "hall", to: "glass" }
    ]
  });
  persisted.masses.forEach((mass) => {
    delete mass.framing;
    delete mass.groundTreatment;
  });
  persisted.relations.forEach((relation) => delete relation.finish);

  const object = createVoxelMassingLab(persisted);
  const hydrated = object.userData.spec;
  const diagnostics = object.userData.getVoxelDiagnostics();

  assert.equal(hydrated.masses.find((mass) => mass.id === "glass").framing.reliefDepthVoxels, 1);
  assert.equal(hydrated.relations[0].finish.trimWidthVoxels, 1);
  assert.ok(diagnostics.relationFinishVoxels > 0);
});

test("solid mass windows add trim frames around the luminous opening", () => {
  const render = (heightVoxels) => createVoxelMassingLab({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "tower",
      type: "solid",
      cells: [[0, 0]],
      heightVoxels,
      cap: { type: "flat" },
      facade: {
        openness: 0.4,
        entranceEmphasis: 0,
        floorHeightVoxels: 20,
        bayWidthVoxels: 8
      }
    }]
  }).userData.getVoxelDiagnostics();
  const short = render(5);
  const windowed = render(20);

  assert.ok(windowed.materialCounts.warmWindow > 0);
  assert.ok(windowed.materialCounts.sandstone > short.materialCounts.sandstone);
  assert.ok(windowed.materialCounts.iron > 0);
});

test("single-cell tower dimensions control its physical plan without changing logical occupancy", () => {
  const spec = createUrbanMassingSpec({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "slender-tower",
      type: "solid",
      cells: [[0, 0]],
      dimensionsVoxels: { width: 18, depth: 20 },
      heightVoxels: 36,
      cap: { type: "flat" }
    }]
  });
  const diagnostics = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const tower = diagnostics.massPlans[0];

  assert.equal(spec.footprint.cellCount, 1);
  assert.deepEqual(spec.masses[0].dimensionsVoxels, { width: 18, depth: 20 });
  assert.equal(tower.baseBounds.maxX - tower.baseBounds.minX + 1, 18);
  assert.equal(tower.baseBounds.maxZ - tower.baseBounds.minZ + 1, 20);
});

test("placement setbacks and offsets position a mass inside its logical base", () => {
  const spec = createUrbanMassingSpec({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "setback-tower",
      type: "solid",
      cells: [[0, 0]],
      placement: {
        setbacksVoxels: { north: 4, east: 8, south: 6, west: 2 },
        offsetVoxels: { x: 1, z: -1 }
      },
      heightVoxels: 24,
      cap: { type: "flat" }
    }]
  });
  const tower = createVoxelMassingLab(spec).userData.getVoxelDiagnostics().massPlans[0];

  assert.equal(tower.baseBounds.maxX - tower.baseBounds.minX + 1, 22);
  assert.equal(tower.baseBounds.maxZ - tower.baseBounds.minZ + 1, 22);
  assert.deepEqual(tower.placement.offsetVoxels, { x: 1, z: -1 });
});

test("open masses expose per-side column controls and auto-remove a touching face", () => {
  const render = (northMode) => createVoxelMassingLab({
    widthCells: 1,
    depthCells: 2,
    masses: [
      {
        id: "hall",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 16,
        cap: { type: "flat" }
      },
      {
        id: "portico",
        type: "open",
        cells: [[0, 1]],
        heightVoxels: 12,
        cap: { type: "parapet", parapetHeightVoxels: 3 },
        enclosure: {
          sides: {
            north: northMode,
            east: "columns",
            south: "open",
            west: "columns"
          },
          columnSpacingVoxels: 7,
          columnWidthVoxels: 2,
          beamHeightVoxels: 2
        }
      }
    ]
  }).userData.getVoxelDiagnostics();
  const automatic = render("auto");
  const retained = render("columns");
  const automaticPortico = automatic.massPlans.find((mass) => mass.id === "portico");
  const retainedPortico = retained.massPlans.find((mass) => mass.id === "portico");

  assert.equal(automaticPortico.enclosure.sides.south, "open");
  assert.equal(automaticPortico.enclosure.columnSpacingVoxels, 7);
  assert.ok(automaticPortico.autoOccludedFaceVoxels > 0);
  assert.equal(retainedPortico.autoOccludedFaceVoxels, 0);
  assert.ok(automatic.materialCounts.iron < retained.materialCounts.iron);
  assert.ok(automatic.materialCounts.sandstone < retained.materialCounts.sandstone);
});

test("octagonal tower openings stay on principal facade planes and away from corners", () => {
  const diagnostics = createVoxelMassingLab({
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "octagonal-tower",
      type: "solid",
      cells: [[0, 0]],
      planShape: "octagonal",
      heightVoxels: 32,
      cap: { type: "flat" },
      facade: {
        openness: 0.42,
        entranceEmphasis: 0.8,
        floorHeightVoxels: 16,
        bayWidthVoxels: 8
      }
    }]
  }).userData.getVoxelDiagnostics();
  const tower = diagnostics.massPlans[0];
  const { minX, maxX, minZ, maxZ } = tower.baseBounds;

  assert.ok(tower.windowCount > 0);
  assert.ok(tower.doorCount > 0);
  tower.facadeFeatures.forEach((feature) => {
    if (feature.face === "north" || feature.face === "south") {
      assert.equal(feature.plane, feature.face === "north" ? minZ : maxZ);
      assert.ok(feature.alongStart > minX);
      assert.ok(feature.alongEnd < maxX);
    } else {
      assert.equal(feature.plane, feature.face === "west" ? minX : maxX);
      assert.ok(feature.alongStart > minZ);
      assert.ok(feature.alongEnd < maxZ);
    }
  });
});

test("massing dormers anchor to continuous local roof edges instead of the cap bounding box", () => {
  const diagnostics = createVoxelMassingLab({
    id: "l-shaped-dormer-roof",
    widthCells: 2,
    depthCells: 2,
    masses: [{
      id: "l-wing",
      type: "solid",
      cells: [[0, 0], [1, 0], [0, 1]],
      heightVoxels: 40,
      cap: { type: "mansard", heightVoxels: 10, dormerCount: 6 }
    }]
  }).userData.getVoxelDiagnostics();
  const cap = diagnostics.capPlans.find((entry) => entry.id === "l-wing");
  const occupiedByRoof = (x, z) => (
    (x >= -32 && x <= 31 && z >= -32 && z <= -1)
    || (x >= -32 && x <= -1 && z >= 0 && z <= 31)
  );

  assert.ok(cap.dormerPlacements.length > 0);
  assert.ok(cap.dormerPlacements.length <= 6);
  cap.dormerPlacements.forEach((placement) => {
    assert.equal(placement.startZ, placement.boundaryZ - 2);
    for (let z = placement.boundaryZ - 2; z <= placement.boundaryZ; z += 1) {
      for (let x = placement.centerX - 3; x <= placement.centerX + 3; x += 1) {
        assert.equal(occupiedByRoof(x, z), true);
      }
    }
  });
});

test("roofline chimneys require real roof support and never decorate dome or spire caps", () => {
  const lShapeDiagnostics = createVoxelMassingLab({
    id: "l-shaped-chimney-roof",
    widthCells: 2,
    depthCells: 2,
    masses: [{
      id: "l-wing",
      type: "solid",
      cells: [[0, 0], [1, 0], [0, 1]],
      heightVoxels: 40,
      cap: { type: "mansard", heightVoxels: 10 },
      facade: { rooflineOrnaments: 4 }
    }]
  }).userData.getVoxelDiagnostics();
  const lShapeCap = lShapeDiagnostics.capPlans.find((entry) => entry.id === "l-wing");
  const occupiedByRoof = (x, z) => (
    (x >= -32 && x <= 31 && z >= -32 && z <= -1)
    || (x >= -32 && x <= -1 && z >= 0 && z <= 31)
  );

  assert.equal(lShapeCap.rooflineOrnamentPlacements.length, 4);
  lShapeCap.rooflineOrnamentPlacements.forEach((placement) => {
    assert.ok(placement.baseY >= 39);
    for (let z = placement.centerZ - 1; z <= placement.centerZ + 1; z += 1) {
      for (let x = placement.centerX - 1; x <= placement.centerX + 1; x += 1) {
        assert.equal(occupiedByRoof(x, z), true);
      }
    }
  });

  const spireDiagnostics = createVoxelMassingLab({
    id: "spire-with-requested-ornaments",
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "spire",
      type: "solid",
      cells: [[0, 0]],
      heightVoxels: 36,
      planShape: "octagonal",
      cap: { type: "spire", heightVoxels: 20 },
      facade: { rooflineOrnaments: 4 }
    }]
  }).userData.getVoxelDiagnostics();
  const spireCap = spireDiagnostics.capPlans.find((entry) => entry.id === "spire");
  assert.equal(spireCap.rooflineOrnamentVoxels, 0);
  assert.deepEqual(spireCap.rooflineOrnamentPlacements, []);
});

test("studio massing presets stay compact even though the framework supports 6x6", () => {
  const presetNames = Object.keys(VOXEL_MASSING_PRESETS);

  assert.deepEqual(presetNames, [
    "minimumCapabilityStudy",
    "towerCourtyard",
    "greenhouseArcade",
    "civicDome"
  ]);
  presetNames.forEach((name) => {
    const spec = createUrbanMassingSpec(VOXEL_MASSING_PRESETS[name]);
    assert.ok(spec.footprint.widthCells <= 3);
    assert.ok(spec.footprint.depthCells <= 3);
    assert.ok(spec.masses.length >= 4);
  });
});

test("civic dome baseline compiles a coordinated classical order and crown", () => {
  const spec = createUrbanMassingSpec(VOXEL_MASSING_PRESETS.civicDome);
  const centralHall = spec.masses.find((mass) => mass.id === "central-hall");
  const domeDrum = spec.masses.find((mass) => mass.id === "dome-drum");
  const lantern = spec.masses.find((mass) => mass.id === "dome-lantern");
  const portico = spec.masses.find((mass) => mass.id === "front-portico");

  assert.equal(centralHall.facade.order, "classical");
  assert.equal(centralHall.facade.pedimentHeightVoxels, 8);
  assert.equal(domeDrum.baseYVoxels, 32);
  assert.equal(lantern.baseYVoxels, 60);
  assert.deepEqual(portico.dimensionsVoxels, { width: 30, depth: 16 });

  const diagnostics = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const centralDetails = diagnostics.massPlans
    .find((mass) => mass.id === "central-hall")
    .architecturalDetail;
  const wingDetails = diagnostics.massPlans
    .find((mass) => mass.id === "west-wing")
    .architecturalDetail;
  const wingCap = diagnostics.capPlans.find((cap) => cap.id === "west-wing");

  assert.ok(centralDetails.voxels > 1_500);
  assert.ok(centralDetails.pedimentVoxels > 0);
  assert.equal(wingDetails.ornaments, 0);
  assert.equal(wingCap.rooflineOrnamentPlacements.length, 2);
  assert.ok(diagnostics.materialCounts.violetMagic > 0);
  assert.ok(diagnostics.groundDetailVoxels > 0);
});

test("greenhouse preset compiles a barrel shell, end entrance, and ridge vent", () => {
  const spec = createUrbanMassingSpec(VOXEL_MASSING_PRESETS.greenhouseArcade);
  const greenhouse = spec.masses.find((mass) => mass.id === "greenhouse");
  const diagnostics = createVoxelMassingLab(spec).userData.getVoxelDiagnostics();
  const greenhousePlan = diagnostics.massPlans.find((mass) => mass.id === "greenhouse");
  const greenhouseCap = diagnostics.capPlans.find((cap) => cap.id === "greenhouse");

  assert.equal(greenhouse.cap.type, "glass_barrel");
  assert.equal(greenhouse.planShape, "rectangular");
  assert.ok(greenhousePlan.greenhouseDetailVoxels > 0);
  assert.ok(greenhouseCap.finialVoxels > 0);
  assert.ok(diagnostics.materialCounts.warmWindow > 0);
});
