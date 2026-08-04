import { createRng } from "../utils/random.js";

export const URBAN_MASSING_SPEC_VERSION = "0.1";
export const MASSING_MAX_GRID_SPAN = 6;
export const MASSING_CELL_VOXELS = 32;

export const MASS_TYPE_IDS = Object.freeze(["solid", "framed", "open", "ground"]);
export const MASS_PLAN_SHAPE_IDS = Object.freeze(["rectangular", "chamfered", "octagonal", "semicircle"]);
export const MASS_VERTICAL_PROFILE_IDS = Object.freeze(["uniform", "stepped", "tapered", "stacked"]);
export const MASS_CAP_IDS = Object.freeze([
  "flat",
  "parapet",
  "gable",
  "hip",
  "mansard",
  "glass_ridge",
  "glass_barrel",
  "sawtooth",
  "dome",
  "spire"
]);
export const MASS_VOID_IDS = Object.freeze(["courtyard", "passage", "recess", "arch"]);
export const MASS_RELATION_IDS = Object.freeze(["separate", "adjoin", "portal", "stacked"]);
export const SITE_CELL_USE_IDS = Object.freeze(["mass", "ground", "reserved"]);
export const CARDINAL_DIRECTION_IDS = Object.freeze(["north", "east", "south", "west"]);
export const OPEN_SIDE_MODE_IDS = Object.freeze(["auto", "columns", "open", "wall"]);
export const GROUND_TREATMENT_IDS = Object.freeze(["plain", "bordered", "courtyard", "garden"]);
export const MASS_FACADE_ORDER_IDS = Object.freeze(["plain", "classical", "industrial", "gothic"]);

const DEFAULT_MATERIALS = Object.freeze({
  wall: "brickRed",
  trim: "sandstone",
  roof: "slate",
  frame: "iron",
  panel: "glass",
  ground: "pavement",
  window: "warmWindow",
  door: "timber"
});

export const VOXEL_MASSING_PRESETS = Object.freeze({
  minimumCapabilityStudy: Object.freeze({
    id: "minimum-capability-study",
    seed: "minimum-capability-study",
    sunTime: 0.52,
    nightLighting: 0.08,
    widthCells: 2,
    depthCells: 2,
    masses: [
      {
        id: "main-hall",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 32,
        cap: { type: "mansard", heightVoxels: 8 },
        voids: [{ type: "arch", direction: "south", widthVoxels: 8, depthVoxels: 4 }]
      },
      {
        id: "glass-hall",
        type: "framed",
        cells: [[1, 0]],
        heightVoxels: 22,
        cap: { type: "glass_ridge", heightVoxels: 8 },
        framing: {
          baySpacingVoxels: 8,
          frameWidthVoxels: 2,
          floorBeamSpacingVoxels: 8,
          reliefDepthVoxels: 1
        },
        materials: { frame: "limestone", trim: "limestone", panel: "lightGlass" }
      },
      {
        id: "portico",
        type: "open",
        cells: [[0, 1]],
        heightVoxels: 12,
        cap: { type: "parapet" }
      },
      {
        id: "plaza",
        type: "ground",
        cells: [[1, 1]],
        heightVoxels: 2,
        cap: { type: "flat" },
        groundTreatment: { pattern: "bordered", pathWidthVoxels: 8 }
      },
      {
        id: "tower",
        type: "solid",
        cells: [[0, 0]],
        dimensionsVoxels: { width: 22, depth: 22 },
        heightVoxels: 34,
        planShape: "octagonal",
        profile: { type: "tapered", stepHeightVoxels: 12, stepVoxels: 1 },
        cap: { type: "spire", heightVoxels: 18 },
        facade: {
          openness: 0.34,
          entranceEmphasis: 0,
          bayWidthVoxels: 8,
          detailDensity: 0.78
        }
      }
    ],
    relations: [
      { type: "portal", from: "main-hall", to: "glass-hall", widthVoxels: 6, heightVoxels: 12 },
      { type: "stacked", from: "main-hall", to: "tower" }
    ]
  }),
  towerCourtyard: Object.freeze({
    id: "tower-courtyard",
    seed: "tower-courtyard",
    viewFraming: { horizontalOffset: 1.8, zoom: 1.1 },
    sunTime: 0.58,
    nightLighting: 0.12,
    widthCells: 2,
    depthCells: 2,
    masses: [
      {
        id: "main",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 26,
        cap: {
          type: "hip",
          heightVoxels: 8,
          dormerCount: 2,
          ridgeRailHeightVoxels: 2
        },
        facade: {
          openness: 0.42,
          entranceEmphasis: 1,
          detailDensity: 1,
          floorHeightVoxels: 13,
          bayWidthVoxels: 8,
          order: "classical",
          baseCourseHeightVoxels: 3,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 3,
          cornerPierWidthVoxels: 1,
          pedimentHeightVoxels: 5,
          pedimentWidthVoxels: 14,
          rooflineOrnaments: 3
        }
      },
      {
        id: "side-wing",
        type: "solid",
        cells: [[1, 0]],
        heightVoxels: 20,
        cap: {
          type: "gable",
          heightVoxels: 8,
          orientation: "north_south",
          dormerCount: 2,
          ridgeRailHeightVoxels: 2
        },
        facade: {
          openness: 0.36,
          entranceEmphasis: 1,
          detailDensity: 0.95,
          floorHeightVoxels: 10,
          bayWidthVoxels: 8,
          order: "classical",
          baseCourseHeightVoxels: 2,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 2,
          cornerPierWidthVoxels: 1,
          pedimentHeightVoxels: 5,
          pedimentWidthVoxels: 14,
          rooflineOrnaments: 3,
          accentWindow: {
            type: "oculus",
            face: "south",
            diameterVoxels: 11,
            centerYRatio: 0.66,
            material: "warmWindow"
          }
        }
      },
      {
        id: "tower",
        type: "solid",
        cells: [[0, 0]],
        placement: {
          setbacksVoxels: { north: 6, east: 6, south: 6, west: 6 }
        },
        heightVoxels: 42,
        planShape: "octagonal",
        profile: { type: "tapered", stepHeightVoxels: 12, stepVoxels: 1 },
        cap: {
          type: "spire",
          heightVoxels: 17,
          ribCount: 8,
          ringCount: 1,
          finialHeightVoxels: 5
        },
        facade: {
          openness: 0.3,
          entranceEmphasis: 0,
          bayWidthVoxels: 8,
          detailDensity: 1,
          floorHeightVoxels: 14,
          order: "classical",
          baseCourseHeightVoxels: 2,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 2,
          cornerPierWidthVoxels: 1,
          accentWindow: {
            type: "oculus",
            face: "south",
            diameterVoxels: 11,
            centerYRatio: 0.68,
            material: "violetMagic"
          }
        }
      },
      {
        id: "arcade",
        type: "open",
        cells: [[0, 1]],
        dimensionsVoxels: { width: 30, depth: 12 },
        placement: { offsetVoxels: { z: -10 } },
        heightVoxels: 14,
        cap: { type: "parapet", parapetHeightVoxels: 3 },
        enclosure: {
          sides: { north: "auto", east: "open", south: "columns", west: "open" },
          columnSpacingVoxels: 8,
          columnWidthVoxels: 2,
          beamHeightVoxels: 2,
          plinthHeightVoxels: 1,
          archRiseVoxels: 6,
          archThicknessVoxels: 2,
          capitalHeightVoxels: 2
        },
        materials: { frame: "limestone", trim: "limestone" }
      },
      {
        id: "court",
        type: "ground",
        cells: [[1, 1]],
        heightVoxels: 2,
        cap: { type: "flat" },
        groundTreatment: {
          pattern: "courtyard",
          borderWidthVoxels: 1,
          pathWidthVoxels: 8,
          axisMaterial: "stoneShadow",
          planterCount: 5,
          fenceHeightVoxels: 3,
          lampCount: 4,
          stepWidthVoxels: 20,
          stepDepthVoxels: 7
        }
      }
    ],
    relations: [
      { type: "portal", from: "main", to: "side-wing", widthVoxels: 7, heightVoxels: 13 },
      { type: "stacked", from: "main", to: "tower" }
    ]
  }),
  greenhouseArcade: Object.freeze({
    id: "greenhouse-arcade",
    seed: "greenhouse-arcade",
    viewFraming: { horizontalOffset: 4.2, zoom: 1.16 },
    sunTime: 0.64,
    nightLighting: 0.06,
    widthCells: 3,
    depthCells: 2,
    masses: [
      {
        id: "garden-house",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 30,
        cap: {
          type: "mansard",
          heightVoxels: 10,
          dormerCount: 3,
          ridgeRailHeightVoxels: 2
        },
        materials: { wall: "brickBrown", trim: "limestone" },
        facade: {
          openness: 0.34,
          entranceEmphasis: 1,
          detailDensity: 1,
          floorHeightVoxels: 10,
          bayWidthVoxels: 8,
          order: "classical",
          baseCourseHeightVoxels: 3,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 3,
          cornerPierWidthVoxels: 1,
          pedimentHeightVoxels: 4,
          pedimentWidthVoxels: 12,
          rooflineOrnaments: 3
        }
      },
      {
        id: "greenhouse",
        type: "framed",
        cells: [[1, 0], [2, 0]],
        heightVoxels: 11,
        planShape: "rectangular",
        orientation: "east",
        cap: {
          type: "glass_barrel",
          heightVoxels: 16,
          orientation: "east_west",
          ribCount: 9,
          ringCount: 2,
          finialHeightVoxels: 5
        },
        framing: {
          baySpacingVoxels: 8,
          frameWidthVoxels: 2,
          floorBeamSpacingVoxels: 8,
          reliefDepthVoxels: 1
        },
        materials: { frame: "limestone", trim: "limestone", panel: "lightGlass" }
      },
      {
        id: "entry-arcade",
        type: "open",
        cells: [[0, 1]],
        dimensionsVoxels: { width: 30, depth: 12 },
        placement: { offsetVoxels: { z: -10 } },
        heightVoxels: 14,
        cap: { type: "parapet", parapetHeightVoxels: 3 },
        enclosure: {
          sides: { north: "auto", east: "open", south: "columns", west: "open" },
          columnSpacingVoxels: 8,
          columnWidthVoxels: 2,
          beamHeightVoxels: 2,
          plinthHeightVoxels: 1,
          archRiseVoxels: 6,
          archThicknessVoxels: 2,
          capitalHeightVoxels: 2
        },
        materials: { frame: "limestone", trim: "limestone" }
      },
      {
        id: "garden-court",
        type: "ground",
        cells: [[1, 1], [2, 1]],
        heightVoxels: 2,
        cap: { type: "flat" },
        groundTreatment: {
          pattern: "garden",
          borderWidthVoxels: 1,
          pathWidthVoxels: 7,
          planterCount: 6,
          fenceHeightVoxels: 3,
          lampCount: 4,
          stepWidthVoxels: 12,
          stepDepthVoxels: 4
        }
      }
    ],
    relations: [
      { type: "portal", from: "garden-house", to: "greenhouse", widthVoxels: 8, heightVoxels: 14 }
    ]
  }),
  civicDome: Object.freeze({
    id: "civic-dome",
    seed: "civic-dome",
    viewFraming: { horizontalOffset: 2.1, zoom: 1.12 },
    sunTime: 0.54,
    nightLighting: 0.1,
    widthCells: 3,
    depthCells: 2,
    masses: [
      {
        id: "central-hall",
        type: "solid",
        cells: [[1, 0]],
        dimensionsVoxels: { width: 32, depth: 26 },
        placement: { offsetVoxels: { z: -3 } },
        heightVoxels: 32,
        cap: { type: "flat" },
        materials: { wall: "sandstone", trim: "limestone" },
        facade: {
          symmetry: 1,
          openness: 0.4,
          entranceEmphasis: 1,
          detailDensity: 1,
          floorHeightVoxels: 16,
          bayWidthVoxels: 9,
          order: "classical",
          baseCourseHeightVoxels: 4,
          stringCourseHeightVoxels: 2,
          corniceHeightVoxels: 3,
          cornerPierWidthVoxels: 2,
          pedimentHeightVoxels: 8,
          pedimentWidthVoxels: 22
        }
      },
      {
        id: "west-wing",
        type: "solid",
        cells: [[0, 0]],
        dimensionsVoxels: { width: 32, depth: 26 },
        placement: { offsetVoxels: { z: -3 } },
        heightVoxels: 24,
        cap: {
          type: "mansard",
          heightVoxels: 8,
          dormerCount: 3,
          ridgeRailHeightVoxels: 2
        },
        materials: { wall: "brickRed", trim: "limestone" },
        facade: {
          symmetry: 1,
          openness: 0.34,
          entranceEmphasis: 0.24,
          detailDensity: 0.95,
          floorHeightVoxels: 12,
          bayWidthVoxels: 8,
          order: "classical",
          baseCourseHeightVoxels: 3,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 3,
          cornerPierWidthVoxels: 1,
          rooflineOrnaments: 2
        }
      },
      {
        id: "east-wing",
        type: "solid",
        cells: [[2, 0]],
        dimensionsVoxels: { width: 32, depth: 26 },
        placement: { offsetVoxels: { z: -3 } },
        heightVoxels: 24,
        cap: {
          type: "mansard",
          heightVoxels: 8,
          dormerCount: 3,
          ridgeRailHeightVoxels: 2
        },
        materials: { wall: "brickRed", trim: "limestone" },
        facade: {
          symmetry: 1,
          openness: 0.34,
          entranceEmphasis: 0.24,
          detailDensity: 0.95,
          floorHeightVoxels: 12,
          bayWidthVoxels: 8,
          order: "classical",
          baseCourseHeightVoxels: 3,
          stringCourseHeightVoxels: 1,
          corniceHeightVoxels: 3,
          cornerPierWidthVoxels: 1,
          rooflineOrnaments: 2
        }
      },
      {
        id: "dome-drum",
        type: "solid",
        cells: [[1, 0]],
        dimensionsVoxels: { width: 22, depth: 22 },
        placement: { offsetVoxels: { z: -3 } },
        heightVoxels: 12,
        planShape: "octagonal",
        cap: {
          type: "dome",
          heightVoxels: 16,
          ribCount: 8,
          ringCount: 1
        },
        materials: {
          wall: "limestone",
          trim: "limestone",
          roof: "slate",
          window: "warmWindow",
          frame: "patinaMetal"
        },
        facade: {
          openness: 0.5,
          entranceEmphasis: 0,
          detailDensity: 1,
          floorHeightVoxels: 12,
          bayWidthVoxels: 7,
          order: "classical",
          baseCourseHeightVoxels: 2,
          corniceHeightVoxels: 2,
          cornerPierWidthVoxels: 1
        }
      },
      {
        id: "dome-lantern",
        type: "solid",
        role: "crown",
        cells: [[1, 0]],
        baseYVoxels: 60,
        dimensionsVoxels: { width: 12, depth: 12 },
        placement: { offsetVoxels: { z: -3 } },
        heightVoxels: 7,
        planShape: "octagonal",
        cap: {
          type: "spire",
          heightVoxels: 8,
          ribCount: 8,
          ringCount: 1,
          finialHeightVoxels: 3
        },
        materials: {
          wall: "limestone",
          trim: "limestone",
          roof: "slate",
          window: "violetMagic"
        },
        facade: {
          openness: 0.72,
          entranceEmphasis: 0,
          detailDensity: 0.9,
          floorHeightVoxels: 10,
          bayWidthVoxels: 6,
          order: "classical",
          baseCourseHeightVoxels: 1,
          corniceHeightVoxels: 1
        }
      },
      {
        id: "entrance-vestibule",
        type: "solid",
        role: "entrance",
        cells: [[1, 1]],
        dimensionsVoxels: { width: 14, depth: 8 },
        placement: { offsetVoxels: { z: -18 } },
        heightVoxels: 14,
        cap: { type: "flat" },
        materials: { wall: "brickBrown", trim: "limestone" },
        facade: {
          symmetry: 1,
          openness: 0.52,
          entranceEmphasis: 1,
          detailDensity: 1,
          floorHeightVoxels: 14,
          bayWidthVoxels: 14,
          entranceFace: "south",
          order: "classical",
          baseCourseHeightVoxels: 2,
          corniceHeightVoxels: 2,
          cornerPierWidthVoxels: 1
        }
      },
      {
        id: "front-portico",
        type: "open",
        cells: [[1, 1]],
        dimensionsVoxels: { width: 30, depth: 16 },
        placement: { offsetVoxels: { z: -18 } },
        heightVoxels: 22,
        cap: { type: "gable", heightVoxels: 10, orientation: "north_south" },
        enclosure: {
          sides: { north: "auto", east: "columns", south: "columns", west: "columns" },
          columnSpacingVoxels: 6,
          columnWidthVoxels: 3,
          beamHeightVoxels: 3,
          plinthHeightVoxels: 3,
          capitalHeightVoxels: 3
        },
        materials: { wall: "limestone", frame: "limestone", trim: "limestone" }
      },
      {
        id: "civic-plaza",
        type: "ground",
        cells: [[0, 1], [1, 1], [2, 1]],
        heightVoxels: 2,
        cap: { type: "flat" },
        groundTreatment: {
          pattern: "garden",
          borderWidthVoxels: 2,
          pathWidthVoxels: 12,
          axisMaterial: "stoneShadow",
          planterCount: 8,
          fenceHeightVoxels: 3,
          lampCount: 6,
          stepWidthVoxels: 24,
          stepDepthVoxels: 8
        }
      }
    ],
    relations: [
      { type: "portal", from: "west-wing", to: "central-hall", widthVoxels: 7, heightVoxels: 14 },
      { type: "portal", from: "central-hall", to: "east-wing", widthVoxels: 7, heightVoxels: 14 },
      { type: "stacked", from: "central-hall", to: "dome-drum" },
      { type: "stacked", from: "dome-drum", to: "dome-lantern" }
    ]
  })
});

export function normalizeVoxelMassingConfig(config = {}) {
  const base = { ...VOXEL_MASSING_PRESETS.minimumCapabilityStudy, ...config };
  return {
    ...createUrbanMassingSpec(base),
    sunTime: clampNumber(base.sunTime ?? 0.52, 0, 1),
    nightLighting: clampNumber(base.nightLighting ?? 0.08, 0, 1),
    viewFraming: {
      horizontalOffset: clampNumber(base.viewFraming?.horizontalOffset ?? 1.75, -6, 6),
      zoom: clampNumber(base.viewFraming?.zoom ?? 1.12, 0.9, 1.35)
    }
  };
}

export function createRandomVoxelMassingConfig(seed = Date.now()) {
  const stableSeed = String(seed);
  const rng = createRng(stableSeed);
  const source = structuredClone(VOXEL_MASSING_PRESETS.minimumCapabilityStudy);
  const palette = pick(rng, [
    { wall: "brickRed", trim: "sandstone" },
    { wall: "brickBrown", trim: "limestone" },
    { wall: "sandstone", trim: "limestone" }
  ]);
  const main = source.masses.find((mass) => mass.id === "main-hall");
  const glassHall = source.masses.find((mass) => mass.id === "glass-hall");
  const portico = source.masses.find((mass) => mass.id === "portico");
  const tower = source.masses.find((mass) => mass.id === "tower");

  main.heightVoxels = 26 + Math.floor(rng() * 13);
  main.planShape = pick(rng, ["rectangular", "chamfered"]);
  main.cap = {
    type: pick(rng, ["gable", "hip", "mansard"]),
    heightVoxels: 6 + Math.floor(rng() * 7),
    orientation: pick(rng, ["east_west", "north_south"]),
    ridgeRatio: Number((0.3 + rng() * 0.4).toFixed(3))
  };
  main.materials = { ...palette };
  main.facade = {
    openness: Number((0.28 + rng() * 0.35).toFixed(3)),
    entranceEmphasis: Number((0.45 + rng() * 0.5).toFixed(3)),
    bayWidthVoxels: pick(rng, [8, 10, 12])
  };

  glassHall.heightVoxels = 18 + Math.floor(rng() * 11);
  glassHall.planShape = pick(rng, ["rectangular", "semicircle"]);
  glassHall.cap = {
    type: "glass_ridge",
    heightVoxels: 6 + Math.floor(rng() * 7),
    orientation: pick(rng, ["east_west", "north_south"]),
    ridgeRatio: Number((0.35 + rng() * 0.3).toFixed(3))
  };

  portico.heightVoxels = 9 + Math.floor(rng() * 7);
  portico.cap = {
    type: pick(rng, ["flat", "parapet"]),
    parapetHeightVoxels: 2 + Math.floor(rng() * 4)
  };

  tower.heightVoxels = 28 + Math.floor(rng() * 19);
  tower.planShape = pick(rng, ["chamfered", "octagonal"]);
  tower.profile = {
    type: pick(rng, ["stepped", "tapered"]),
    stepHeightVoxels: pick(rng, [8, 10, 12, 14]),
    stepVoxels: pick(rng, [1, 1, 2]),
    maxInsetVoxels: 8 + Math.floor(rng() * 7)
  };
  tower.cap = {
    type: pick(rng, ["spire", "dome", "hip"]),
    heightVoxels: 12 + Math.floor(rng() * 13),
    ridgeRatio: 0.5
  };
  tower.materials = { ...palette };
  tower.facade = {
    openness: Number((0.2 + rng() * 0.25).toFixed(3)),
    entranceEmphasis: 0,
    bayWidthVoxels: pick(rng, [8, 10])
  };

  return normalizeVoxelMassingConfig({
    ...source,
    id: `random-massing-${stableSeed}`,
    seed: stableSeed
  });
}

export function createUrbanMassingSpec(options = {}) {
  const id = String(options.id || "urban-massing-1");
  const seed = String(options.seed || id);
  const footprintSource = options.footprint?.cells ?? options.footprintCells;
  const footprintResult = normalizeFootprintWithOffset(
    footprintSource,
    options.widthCells,
    options.depthCells
  );
  const footprint = footprintResult.footprint;
  const siteCells = new Map(footprint.cells.map((cell) => [cellKey(cell.x, cell.z), cell]));
  const rawMasses = Array.isArray(options.masses) && options.masses.length
    ? options.masses
    : [{
        id: "main",
        type: "solid",
        cells: footprint.cells.filter((cell) => cell.use === "mass")
      }];
  const masses = rawMasses.map((mass, index) => normalizeMass(
    mass,
    index,
    siteCells,
    footprintResult.offset
  ));
  assertUniqueIds(masses, "mass");

  const massIds = new Set(masses.map((mass) => mass.id));
  const relations = (Array.isArray(options.relations) ? options.relations : [])
    .map((relation, index) => normalizeRelation(relation, index, massIds));

  relations.forEach((relation) => {
    if (relation.type !== "stacked") return;
    const host = masses.find((mass) => mass.id === relation.from);
    const child = masses.find((mass) => mass.id === relation.to);
    if (!child.baseYExplicit) child.baseYVoxels = host.baseYVoxels + host.heightVoxels;
  });
  masses.forEach((mass) => delete mass.baseYExplicit);

  return {
    specVersion: URBAN_MASSING_SPEC_VERSION,
    id,
    seed,
    grid: {
      cellSizeVoxels: MASSING_CELL_VOXELS,
      maxColumns: MASSING_MAX_GRID_SPAN,
      maxRows: MASSING_MAX_GRID_SPAN
    },
    footprint,
    masses,
    relations,
    ...(options.intent ? { intent: structuredClone(options.intent) } : {}),
    ...(options.metadata ? { metadata: structuredClone(options.metadata) } : {}),
    ports: normalizePorts(options.ports),
    constraints: {
      maxGridSpan: MASSING_MAX_GRID_SPAN,
      contiguousFootprint: true,
      diagonalOnlyConnections: false,
      railIntegration: false
    }
  };
}

export function normalizeMassingFootprint(cells, widthCells = 1, depthCells = 1) {
  return normalizeFootprintWithOffset(cells, widthCells, depthCells).footprint;
}

export function createLegacyBuildingMassingSpec(building) {
  const capType = building.roof?.type === "pitched" ? "gable" : "flat";
  return createUrbanMassingSpec({
    id: `${building.id}-massing`,
    seed: building.seed,
    widthCells: 1,
    depthCells: 1,
    masses: [{
      id: "legacy-main",
      type: "solid",
      heightVoxels: building.wallHeightVoxels,
      dimensionsVoxels: {
        width: building.footprint.widthVoxels,
        depth: building.footprint.depthVoxels
      },
      profile: {
        type: building.floorSpecs?.some((floor) => floor.frontSetbackVoxels > 0)
          ? "stepped"
          : "uniform",
        stepHeightVoxels: building.floorHeight,
        stepVoxels: 0,
        maxInsetVoxels: 0
      },
      cap: {
        type: capType,
        orientation: building.roof?.form === "gable_cross" ? "north_south" : "east_west",
        heightVoxels: building.roof?.ridgeHeight ?? 0,
        ridgeRatio: building.roof?.ridgeRatio ?? 0.5,
        overhangVoxels: building.roof?.overhang ?? 0
      },
      materials: {
        wall: building.materials.wall,
        trim: building.materials.trim,
        roof: building.materials.roof,
        frame: building.materials.metal,
        panel: "glass",
        window: building.materials.window,
        door: building.materials.door
      }
    }]
  });
}

export function getUrbanMassingCatalog() {
  return {
    specVersion: URBAN_MASSING_SPEC_VERSION,
    maxGridSpan: MASSING_MAX_GRID_SPAN,
    cellSizeVoxels: MASSING_CELL_VOXELS,
    massTypes: [...MASS_TYPE_IDS],
    planShapes: [...MASS_PLAN_SHAPE_IDS],
    verticalProfiles: [...MASS_VERTICAL_PROFILE_IDS],
    caps: [...MASS_CAP_IDS],
    voids: [...MASS_VOID_IDS],
    relations: [...MASS_RELATION_IDS],
    siteCellUses: [...SITE_CELL_USE_IDS],
    directions: [...CARDINAL_DIRECTION_IDS],
    openSideModes: [...OPEN_SIDE_MODE_IDS],
    facadeOrders: [...MASS_FACADE_ORDER_IDS],
    singleCellDimensions: {
      parameter: "dimensionsVoxels",
      minimum: 4,
      logicalCellVoxels: MASSING_CELL_VOXELS
    },
    placement: {
      parameter: "placement",
      controls: ["setbacksVoxels", "offsetVoxels"]
    },
    openEnclosure: {
      parameter: "enclosure",
      controls: [
        "sides",
        "columnSpacingVoxels",
        "columnWidthVoxels",
        "beamHeightVoxels",
        "plinthHeightVoxels",
        "archRiseVoxels",
        "archThicknessVoxels",
        "capitalHeightVoxels"
      ]
    },
    framedEnclosure: {
      parameter: "framing",
      controls: [
        "baySpacingVoxels",
        "frameWidthVoxels",
        "floorBeamSpacingVoxels",
        "reliefDepthVoxels"
      ]
    },
    groundTreatment: {
      parameter: "groundTreatment",
      patterns: [...GROUND_TREATMENT_IDS],
      controls: [
        "borderWidthVoxels",
        "pathWidthVoxels",
        "axisMaterial",
        "planterCount",
        "fenceHeightVoxels",
        "lampCount",
        "stepWidthVoxels",
        "stepDepthVoxels"
      ]
    },
    capDetail: {
      parameter: "cap",
      controls: [
        "ribCount",
        "ringCount",
        "dormerCount",
        "finialHeightVoxels",
        "ridgeRailHeightVoxels"
      ]
    },
    relationFinish: {
      parameter: "finish",
      controls: [
        "trimWidthVoxels",
        "thresholdVoxels",
        "baseCourseHeightVoxels",
        "apronWidthVoxels"
      ]
    }
  };
}

function normalizeFootprintWithOffset(source, requestedWidth = 1, requestedDepth = 1) {
  const rawCells = Array.isArray(source) && source.length
    ? source.map((cell, index) => parseCell(cell, index))
    : rectangleCells(
        clampInteger(requestedWidth ?? 1, 1, MASSING_MAX_GRID_SPAN),
        clampInteger(requestedDepth ?? 1, 1, MASSING_MAX_GRID_SPAN)
      );
  const deduplicated = [...new Map(rawCells.map((cell) => [cellKey(cell.x, cell.z), cell])).values()];
  const minimumX = Math.min(...deduplicated.map((cell) => cell.x));
  const minimumZ = Math.min(...deduplicated.map((cell) => cell.z));
  const cells = deduplicated
    .map((cell) => ({
      x: cell.x - minimumX,
      z: cell.z - minimumZ,
      use: SITE_CELL_USE_IDS.includes(cell.use) ? cell.use : "mass"
    }))
    .sort(compareCells);
  const width = Math.max(...cells.map((cell) => cell.x)) + 1;
  const depth = Math.max(...cells.map((cell) => cell.z)) + 1;
  if (width > MASSING_MAX_GRID_SPAN || depth > MASSING_MAX_GRID_SPAN) {
    throw new Error(`Massing footprint must fit inside ${MASSING_MAX_GRID_SPAN}x${MASSING_MAX_GRID_SPAN} cells`);
  }
  if (!isEdgeConnected(cells)) {
    throw new Error("Massing footprint cells must form one edge-connected site");
  }
  return {
    offset: { x: minimumX, z: minimumZ },
    footprint: {
      cells,
      widthCells: width,
      depthCells: depth,
      cellCount: cells.length,
      massCellCount: cells.filter((cell) => cell.use === "mass").length,
      groundCellCount: cells.filter((cell) => cell.use === "ground").length,
      reservedCellCount: cells.filter((cell) => cell.use === "reserved").length
    }
  };
}

function normalizeMass(source = {}, index, siteCells, footprintOffset) {
  const id = String(source.id || `mass-${index + 1}`);
  const type = enumValue(MASS_TYPE_IDS, source.type, "solid");
  const defaultCells = [...siteCells.values()]
    .filter((cell) => cell.use !== "reserved" && (type === "ground" || cell.use === "mass"));
  const cells = (Array.isArray(source.cells) && source.cells.length
    ? source.cells.map((cell, cellIndex) => {
        const parsed = parseCell(cell, cellIndex);
        return {
          x: parsed.x - footprintOffset.x,
          z: parsed.z - footprintOffset.z
        };
      })
    : defaultCells.map(({ x, z }) => ({ x, z })))
    .map(({ x, z }) => ({ x, z }))
    .sort(compareCells);
  if (!cells.length) throw new Error(`Mass ${id} requires at least one cell`);
  cells.forEach((cell) => {
    if (!siteCells.has(cellKey(cell.x, cell.z))) {
      throw new Error(`Mass ${id} references cell ${cell.x},${cell.z} outside the site footprint`);
    }
  });
  if (!isEdgeConnected(cells)) throw new Error(`Mass ${id} cells must be edge-connected`);

  const baseYExplicit = source.baseYVoxels != null;
  const profile = normalizeProfile(source.profile);
  const heightVoxels = profile.type === "stacked" && profile.bands.length
    ? profile.bands.reduce((total, band) => total + band.heightVoxels, 0)
    : clampInteger(
        source.heightVoxels ?? (type === "ground" ? 2 : 40),
        type === "ground" ? 1 : 4,
        192
      );
  return {
    id,
    type,
    role: String(source.role || (index === 0 ? "primary" : "secondary")),
    cells,
    baseYVoxels: clampInteger(source.baseYVoxels ?? 0, 0, 256),
    baseYExplicit,
    heightVoxels,
    dimensionsVoxels: source.dimensionsVoxels
      ? {
          width: clampInteger(source.dimensionsVoxels.width, 4, MASSING_CELL_VOXELS * MASSING_MAX_GRID_SPAN),
          depth: clampInteger(source.dimensionsVoxels.depth, 4, MASSING_CELL_VOXELS * MASSING_MAX_GRID_SPAN)
        }
      : null,
    placement: normalizeMassingPlacement(source.placement),
    planShape: enumValue(MASS_PLAN_SHAPE_IDS, source.planShape, "rectangular"),
    orientation: enumValue(CARDINAL_DIRECTION_IDS, source.orientation, "south"),
    profile,
    cap: normalizeCap(source.cap, type),
    voids: (Array.isArray(source.voids) ? source.voids : [])
      .map((entry, voidIndex) => normalizeVoid(entry, voidIndex)),
    facade: normalizeFacadeIntent(source.facade, type),
    enclosure: normalizeMassingEnclosure(source.enclosure, type),
    framing: normalizeMassingFraming(source.framing, type),
    groundTreatment: normalizeGroundTreatment(source.groundTreatment, type),
    materials: {
      ...DEFAULT_MATERIALS,
      ...(type === "framed"
        ? { frame: "limestone", trim: "limestone", panel: "lightGlass" }
        : {}),
      ...(source.materials ?? {})
    }
  };
}

function normalizeMassingFraming(source = {}, massType) {
  const active = massType === "framed";
  return {
    baySpacingVoxels: clampInteger(source.baySpacingVoxels ?? 8, 4, 20),
    frameWidthVoxels: clampInteger(source.frameWidthVoxels ?? 2, 1, 4),
    floorBeamSpacingVoxels: clampInteger(source.floorBeamSpacingVoxels ?? 8, 4, 24),
    reliefDepthVoxels: active
      ? clampInteger(source.reliefDepthVoxels ?? 1, 0, 2)
      : 0
  };
}

function normalizeGroundTreatment(source = {}, massType) {
  const active = massType === "ground";
  return {
    pattern: active
      ? enumValue(GROUND_TREATMENT_IDS, source.pattern, "plain")
      : "plain",
    borderWidthVoxels: active
      ? clampInteger(source.borderWidthVoxels ?? 1, 0, 3)
      : 0,
    pathWidthVoxels: active
      ? clampInteger(source.pathWidthVoxels ?? 7, 3, 16)
      : 0,
    axisMaterial: active ? String(source.axisMaterial || "") : "",
    planterCount: active
      ? clampInteger(source.planterCount ?? 0, 0, 8)
      : 0,
    fenceHeightVoxels: active
      ? clampInteger(source.fenceHeightVoxels ?? 0, 0, 8)
      : 0,
    lampCount: active
      ? clampInteger(source.lampCount ?? 0, 0, 8)
      : 0,
    stepWidthVoxels: active
      ? clampInteger(source.stepWidthVoxels ?? 0, 0, 24)
      : 0,
    stepDepthVoxels: active
      ? clampInteger(source.stepDepthVoxels ?? 0, 0, 8)
      : 0
  };
}

function normalizeMassingPlacement(source = {}) {
  const setbacks = source.setbacksVoxels ?? {};
  const offset = source.offsetVoxels ?? {};
  return {
    setbacksVoxels: Object.fromEntries(CARDINAL_DIRECTION_IDS.map((direction) => [
      direction,
      clampInteger(setbacks[direction] ?? 0, 0, 14)
    ])),
    offsetVoxels: {
      x: clampInteger(offset.x ?? 0, -16, 16),
      z: clampInteger(offset.z ?? 0, -16, 16)
    }
  };
}

function normalizeMassingEnclosure(source = {}, massType) {
  const defaultMode = massType === "open" ? "auto" : "wall";
  const sides = source.sides ?? {};
  return {
    sides: Object.fromEntries(CARDINAL_DIRECTION_IDS.map((direction) => [
      direction,
      enumValue(OPEN_SIDE_MODE_IDS, sides[direction], defaultMode)
    ])),
    columnSpacingVoxels: clampInteger(source.columnSpacingVoxels ?? 8, 4, 20),
    columnWidthVoxels: clampInteger(source.columnWidthVoxels ?? 2, 1, 4),
    beamHeightVoxels: clampInteger(source.beamHeightVoxels ?? 2, 1, 6),
    plinthHeightVoxels: clampInteger(source.plinthHeightVoxels ?? 0, 0, 4),
    archRiseVoxels: clampInteger(source.archRiseVoxels ?? 0, 0, 10),
    archThicknessVoxels: clampInteger(source.archThicknessVoxels ?? 1, 1, 3),
    capitalHeightVoxels: clampInteger(source.capitalHeightVoxels ?? 0, 0, 4)
  };
}

function normalizeProfile(source = {}) {
  const type = enumValue(MASS_VERTICAL_PROFILE_IDS, source.type, "uniform");
  const bands = type === "stacked"
    ? (Array.isArray(source.bands) ? source.bands : [])
      .slice(0, 12)
      .map((band, index) => ({
        id: String(band.id || `band-${index + 1}`),
        heightVoxels: clampInteger(band.heightVoxels ?? 16, 2, 64),
        insetVoxels: clampInteger(band.insetVoxels ?? 0, 0, 14),
        planShape: enumValue(MASS_PLAN_SHAPE_IDS, band.planShape, null)
      }))
    : [];
  return {
    type,
    stepHeightVoxels: clampInteger(source.stepHeightVoxels ?? 16, 2, 48),
    stepVoxels: clampInteger(source.stepVoxels ?? (type === "uniform" ? 0 : 1), 0, 8),
    maxInsetVoxels: clampInteger(source.maxInsetVoxels ?? 12, 0, 24),
    bands
  };
}

function normalizeCap(source = {}, massType) {
  const fallback = massType === "ground" ? "flat" : massType === "framed" ? "glass_ridge" : "gable";
  const type = enumValue(MASS_CAP_IDS, source.type, fallback);
  return {
    type,
    orientation: ["east_west", "north_south"].includes(source.orientation)
      ? source.orientation
      : "east_west",
    heightVoxels: clampInteger(
      source.heightVoxels ?? (["flat", "parapet"].includes(type) ? 0 : 10),
      0,
      48
    ),
    ridgeRatio: clampNumber(source.ridgeRatio ?? 0.5, 0, 1),
    overhangVoxels: clampInteger(source.overhangVoxels ?? 1, 0, 4),
    parapetHeightVoxels: clampInteger(source.parapetHeightVoxels ?? 4, 1, 12),
    ribCount: clampInteger(source.ribCount ?? 0, 0, 12),
    ringCount: clampInteger(source.ringCount ?? 0, 0, 6),
    dormerCount: clampInteger(source.dormerCount ?? 0, 0, 6),
    finialHeightVoxels: clampInteger(source.finialHeightVoxels ?? 0, 0, 12),
    ridgeRailHeightVoxels: clampInteger(source.ridgeRailHeightVoxels ?? 0, 0, 4),
    toothCount: clampInteger(source.toothCount ?? 4, 2, 8)
  };
}

function normalizeVoid(source = {}, index) {
  return {
    id: String(source.id || `void-${index + 1}`),
    type: enumValue(MASS_VOID_IDS, source.type, "courtyard"),
    direction: enumValue(CARDINAL_DIRECTION_IDS, source.direction, "south"),
    widthVoxels: clampInteger(source.widthVoxels ?? 8, 2, 48),
    depthVoxels: clampInteger(source.depthVoxels ?? 8, 1, 48),
    heightVoxels: clampInteger(source.heightVoxels ?? 14, 2, 96),
    marginVoxels: clampInteger(source.marginVoxels ?? 8, 2, 24)
  };
}

function normalizeFacadeIntent(source = {}, massType) {
  return {
    symmetry: clampNumber(source.symmetry ?? 0.7, 0, 1),
    openness: clampNumber(source.openness ?? (massType === "open" ? 1 : massType === "framed" ? 0.85 : 0.42), 0, 1),
    transparency: clampNumber(source.transparency ?? (massType === "framed" ? 0.9 : 0), 0, 1),
    entranceEmphasis: clampNumber(source.entranceEmphasis ?? 0.5, 0, 1),
    detailDensity: clampNumber(source.detailDensity ?? 0.72, 0, 1),
    floorHeightVoxels: clampInteger(source.floorHeightVoxels ?? 20, 10, 32),
    bayWidthVoxels: clampInteger(source.bayWidthVoxels ?? 10, 6, 20),
    entranceFace: enumValue(CARDINAL_DIRECTION_IDS, source.entranceFace, "south"),
    order: enumValue(MASS_FACADE_ORDER_IDS, source.order, "plain"),
    baseCourseHeightVoxels: clampInteger(source.baseCourseHeightVoxels ?? 0, 0, 8),
    stringCourseHeightVoxels: clampInteger(source.stringCourseHeightVoxels ?? 0, 0, 3),
    corniceHeightVoxels: clampInteger(source.corniceHeightVoxels ?? 0, 0, 5),
    cornerPierWidthVoxels: clampInteger(source.cornerPierWidthVoxels ?? 0, 0, 5),
    pedimentHeightVoxels: clampInteger(source.pedimentHeightVoxels ?? 0, 0, 16),
    pedimentWidthVoxels: clampInteger(source.pedimentWidthVoxels ?? 0, 0, 48),
    rooflineOrnaments: clampInteger(source.rooflineOrnaments ?? 0, 0, 8),
    accentWindow: normalizeFacadeAccent(source.accentWindow)
  };
}

function normalizeFacadeAccent(source = {}) {
  const type = source.type === "oculus" ? "oculus" : "none";
  return {
    type,
    face: enumValue(CARDINAL_DIRECTION_IDS, source.face, "south"),
    diameterVoxels: clampInteger(source.diameterVoxels ?? 7, 5, 15),
    centerYRatio: clampNumber(source.centerYRatio ?? 0.66, 0.25, 0.85),
    material: String(source.material || "violetMagic")
  };
}

function normalizeRelation(source = {}, index, massIds) {
  const from = String(source.from || "");
  const to = String(source.to || "");
  if (!massIds.has(from) || !massIds.has(to) || from === to) {
    throw new Error(`Relation ${index + 1} requires two different existing mass ids`);
  }
  return {
    id: String(source.id || `relation-${index + 1}`),
    type: enumValue(MASS_RELATION_IDS, source.type, "separate"),
    from,
    to,
    widthVoxels: clampInteger(source.widthVoxels ?? 6, 2, 20),
    heightVoxels: clampInteger(source.heightVoxels ?? 14, 4, 32),
    finish: normalizeRelationFinish(source.finish, source.type)
  };
}

function normalizeRelationFinish(source = {}, relationType) {
  const type = enumValue(MASS_RELATION_IDS, relationType, "separate");
  return {
    trimWidthVoxels: clampInteger(
      source.trimWidthVoxels ?? (type === "portal" ? 1 : 0),
      0,
      3
    ),
    thresholdVoxels: clampInteger(
      source.thresholdVoxels ?? (type === "portal" ? 1 : 0),
      0,
      2
    ),
    baseCourseHeightVoxels: clampInteger(
      source.baseCourseHeightVoxels ?? (type === "stacked" ? 2 : 0),
      0,
      4
    ),
    apronWidthVoxels: clampInteger(
      source.apronWidthVoxels ?? (type === "stacked" ? 1 : 0),
      0,
      3
    )
  };
}

function normalizePorts(source) {
  return (Array.isArray(source) ? source : []).map((port, index) => ({
    id: String(port.id || `port-${index + 1}`),
    type: String(port.type || "entrance"),
    massId: port.massId ? String(port.massId) : null,
    face: enumValue(CARDINAL_DIRECTION_IDS, port.face, "south")
  }));
}

function parseCell(source, index) {
  if (typeof source === "string") {
    const [x, z] = source.split(",").map(Number);
    if (Number.isFinite(x) && Number.isFinite(z)) return { x: Math.round(x), z: Math.round(z), use: "mass" };
  }
  if (Array.isArray(source) && source.length >= 2) {
    return { x: Math.round(Number(source[0])), z: Math.round(Number(source[1])), use: "mass" };
  }
  if (source && Number.isFinite(Number(source.x)) && Number.isFinite(Number(source.z))) {
    return {
      x: Math.round(Number(source.x)),
      z: Math.round(Number(source.z)),
      use: SITE_CELL_USE_IDS.includes(source.use) ? source.use : "mass"
    };
  }
  throw new Error(`Invalid footprint cell at index ${index}`);
}

function rectangleCells(width, depth) {
  return Array.from({ length: depth }, (_, z) => (
    Array.from({ length: width }, (__, x) => ({ x, z, use: "mass" }))
  )).flat();
}

function isEdgeConnected(cells) {
  if (!cells.length) return false;
  const remaining = new Set(cells.map((cell) => cellKey(cell.x, cell.z)));
  const queue = [remaining.values().next().value];
  remaining.delete(queue[0]);
  while (queue.length) {
    const [x, z] = queue.shift().split(",").map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = cellKey(x + dx, z + dz);
      if (!remaining.has(key)) continue;
      remaining.delete(key);
      queue.push(key);
    }
  }
  return remaining.size === 0;
}

function assertUniqueIds(values, label) {
  const ids = new Set();
  values.forEach((value) => {
    if (ids.has(value.id)) throw new Error(`Duplicate ${label} id: ${value.id}`);
    ids.add(value.id);
  });
}

function enumValue(values, requested, fallback) {
  return values.includes(requested) ? requested : fallback;
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function compareCells(left, right) {
  return left.z - right.z || left.x - right.x;
}

function cellKey(x, z) {
  return `${x},${z}`;
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clampNumber(value, minimum, maximum));
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}
