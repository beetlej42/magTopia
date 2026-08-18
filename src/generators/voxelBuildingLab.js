import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BUILDING_ARCHETYPE_IDS,
  BUILDING_SPEC_VERSION,
  FLOOR_BALCONY_IDS,
  FLOOR_USE_IDS,
  ROOF_FORM_IDS,
  VOXEL_STYLE_KIT_IDS,
  createBuildingSpec
} from "./voxelBuildingGrammar.js";
import {
  MASSING_CELL_VOXELS,
  createUrbanMassingSpec,
  getUrbanMassingCatalog
} from "./voxelMassingGrammar.js";
import { getVoxelSkyState } from "../city/voxel-sky.js";

export const VOXEL_SIZE = 0.125;
export const SEMANTIC_GRID_SIGN_VOXEL_SIZE = VOXEL_SIZE / 2;
export const VOXEL_PARCEL = Object.freeze({
  width: 32,
  depth: 36,
  floorHeight: 20,
  worldWidth: 4,
  worldDepth: 4.5
});
export const CORNER_FACADE_MODE_IDS = Object.freeze(["none", "left", "right", "both"]);

const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];
export const VOXEL_WRITE_PRIORITIES = Object.freeze({
  terrain: 0,
  structure: 10,
  roof: 20,
  opening: 30,
  trim: 40,
  decoration: 50,
  effect: 60
});

const MATERIAL_LIBRARY = Object.freeze({
  brickRed: {
    colors: ["#9f5847", "#a9634f", "#8f4d40", "#b06b54"],
    roughness: 0.94
  },
  brickBrown: {
    colors: ["#62453f", "#704b42", "#583d39", "#795148"],
    roughness: 0.96
  },
  sandstone: {
    colors: ["#c9b796", "#d4c4a6", "#baa783"],
    roughness: 0.9
  },
  stoneShadow: {
    colors: ["#8f8475", "#9b8e7d", "#7c746a"],
    roughness: 0.94
  },
  limestone: {
    colors: ["#d8d0c0", "#c9c1b4", "#e0d9ca"],
    roughness: 0.92
  },
  slate: {
    colors: ["#485262", "#566173", "#3c4655", "#626b7a"],
    roughness: 0.91
  },
  timber: {
    colors: ["#273f3d", "#2e4d48", "#3f312c", "#4c382f"],
    roughness: 0.88
  },
  glass: {
    colors: ["#263a43", "#304b51", "#36545a"],
    roughness: 0.3,
    metalness: 0.05,
    opacity: 0.72
  },
  lightGlass: {
    colors: ["#a9ced3", "#bbdadd", "#91bdc5"],
    roughness: 0.34,
    metalness: 0.02,
    opacity: 0.5
  },
  warmWindow: {
    colors: ["#f1b65b", "#ffc96d", "#df9345"],
    roughness: 0.55,
    emissive: "#f2a94f",
    emissiveIntensity: 0.35
  },
  foliage: {
    colors: ["#557748", "#6d8b50", "#3f6849", "#8b9950"],
    roughness: 1
  },
  foliageDark: {
    colors: ["#355b43", "#41694a", "#294e3b"],
    roughness: 1
  },
  foliageLight: {
    colors: ["#78965a", "#8aa568", "#66884f"],
    roughness: 1
  },
  blossomPink: {
    colors: ["#d99aa2", "#e5aeb4", "#c98391"],
    roughness: 0.96
  },
  blossomGold: {
    colors: ["#d8bc62", "#e5ce78", "#c7a84e"],
    roughness: 0.96
  },
  grass: {
    colors: ["#76925a", "#819d61", "#68844e", "#8ca66b"],
    roughness: 1
  },
  grassLight: {
    colors: ["#91a967", "#9ab374", "#829d5d"],
    roughness: 1
  },
  grassDark: {
    colors: ["#4f7047", "#5b7b4e", "#45643f"],
    roughness: 1
  },
  soil: {
    colors: ["#765442", "#684939", "#815d48"],
    roughness: 1
  },
  water: {
    colors: ["#3e87aa", "#4a96b8", "#367a9d"],
    roughness: 0.34,
    metalness: 0.04,
    opacity: 0.9
  },
  waterLight: {
    colors: ["#70b4c9", "#62a8c1", "#82bfd0"],
    roughness: 0.28,
    metalness: 0.04,
    opacity: 0.82
  },
  violetMagic: {
    colors: ["#8067b8", "#9a79d0", "#684f9e"],
    roughness: 0.5,
    emissive: "#7650bd",
    emissiveIntensity: 0.45
  },
  tealMagic: {
    colors: ["#5dacaa", "#78c4b9", "#438f91"],
    roughness: 0.5,
    emissive: "#4eb6ae",
    emissiveIntensity: 0.45
  },
  iron: {
    colors: ["#252b31", "#343a40", "#1c2228"],
    roughness: 0.8,
    metalness: 0.25
  },
  patinaMetal: {
    colors: ["#536d6b", "#607b77", "#405c5b"],
    roughness: 0.76,
    metalness: 0.2
  },
  gildedMetal: {
    colors: ["#c59a3a", "#ddb854", "#a87824", "#edcf73"],
    roughness: 0.48,
    metalness: 0.58
  },
  tealGlass: {
    colors: ["#5b9c9a", "#74b8ae", "#417d80"],
    roughness: 0.3,
    metalness: 0.04,
    opacity: 0.58,
    emissive: "#3b8f8a",
    emissiveIntensity: 0.12
  },
  pavement: {
    colors: ["#aaa49a", "#b9b2a6", "#96938e"],
    roughness: 1
  },
  road: {
    colors: ["#686b70", "#74767a", "#5e6268"],
    roughness: 1
  }
});

const VOXEL_MATERIAL_MODES = new Set(["standard", "diffuse"]);
let voxelMaterialMode = "standard";

export function setVoxelMaterialMode(mode = "standard") {
  const normalized = String(mode).trim().toLowerCase();
  voxelMaterialMode = VOXEL_MATERIAL_MODES.has(normalized) ? normalized : "standard";
  return voxelMaterialMode;
}

export function getVoxelMaterialMode() {
  return voxelMaterialMode;
}

export const VOXEL_BUILDING_PRESETS = Object.freeze({
  semanticShopSigns: {
    seed: "semantic-shop-signs-001",
    sunTime: 0.16,
    nightLighting: 0.78,
    buildingCount: 3,
    floors: 2,
    expansionFloors: 0,
    materialScheme: 0,
    archetypeVariant: 1,
    styleVariant: 0,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none", windowRatio: 0.88 },
      { purpose: "home", setbackVoxels: 0, balcony: "none", windowRatio: 0.36 }
    ],
    ridgePosition: 0.5,
    roofForm: "gable_street",
    cornerFacades: "both",
    windowRatio: 0.62,
    variation: 0.54,
    parcelWidth: 32,
    parcelDepth: 36,
    detailDensity: 0.82,
    includeStreetLamps: false,
    decorationsByBuilding: {
      "voxel-building-1": {
        items: [{
          id: "potion-sign",
          type: "semantic_grid_sign",
          anchor: "main/floor-0/facade-south/entrance",
          parameters: {
            label: "魔药",
            grid: ["0110", "0110", "1001", "1111"],
            frameMaterial: "patinaMetal",
            boardMaterial: "slate",
            emissiveMaterial: "tealMagic",
            frameStyle: "crowned",
            mount: "projecting"
          }
        }]
      },
      "voxel-building-2": {
        items: [{
          id: "broom-sign",
          type: "semantic_grid_sign",
          anchor: "main/floor-0/facade-south/entrance",
          parameters: {
            label: "扫帚",
            grid: ["0001", "0010", "0111", "1110"],
            frameMaterial: "iron",
            boardMaterial: "timber",
            emissiveMaterial: "warmWindow",
            frameStyle: "riveted",
            mount: "projecting"
          }
        }]
      },
      "voxel-building-3": {
        items: [{
          id: "wand-sign",
          type: "semantic_grid_sign",
          anchor: "main/floor-0/facade-south/entrance",
          parameters: {
            label: "魔杖",
            grid: ["1001", "0010", "0100", "1000"],
            frameMaterial: "sandstone",
            boardMaterial: "iron",
            emissiveMaterial: "violetMagic",
            frameStyle: "simple",
            mount: "projecting"
          }
        }]
      }
    }
  },
  connectedTerraceDay: {
    seed: "voxel-terrace-day-001",
    sunTime: 0.52,
    nightLighting: 0.08,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    materialScheme: 0,
    archetypeVariant: 0,
    styleVariant: 0,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none", windowRatio: 0.82 },
      { purpose: "home", setbackVoxels: 0, balcony: "selective", windowRatio: 0.38 },
      { purpose: "home", setbackVoxels: 0, balcony: "none", windowRatio: 0.34 }
    ],
    ridgePosition: 0.5,
    roofForm: "gable_street",
    cornerFacades: "right",
    windowRatio: 0.58,
    variation: 0.58,
    parcelWidth: 32,
    parcelDepth: 36,
    detailDensity: 0.82
  },
  connectedTerraceNight: {
    seed: "voxel-terrace-night-001",
    sunTime: 0.03,
    nightLighting: 1,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    materialScheme: 0,
    archetypeVariant: 1,
    styleVariant: 1,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none", windowRatio: 0.88 },
      { purpose: "home", setbackVoxels: 2, balcony: "full", windowRatio: 0.42 },
      { purpose: "home", setbackVoxels: 0, balcony: "none", windowRatio: 0.36 }
    ],
    ridgePosition: 0.36,
    roofForm: "hip",
    cornerFacades: "both",
    windowRatio: 0.62,
    variation: 0.72,
    parcelWidth: 32,
    parcelDepth: 36,
    detailDensity: 0.92
  },
  addFloorStudy: {
    seed: "voxel-add-floor-001",
    sunTime: 0.42,
    nightLighting: 0.3,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 1,
    materialScheme: 1,
    archetypeVariant: 0,
    styleVariant: 0,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none", windowRatio: 0.8 },
      { purpose: "home", setbackVoxels: 0, balcony: "selective", windowRatio: 0.42 },
      { purpose: "home", setbackVoxels: 2, balcony: "none", windowRatio: 0.36 },
      { purpose: "home", setbackVoxels: 0, balcony: "selective", windowRatio: 0.34 }
    ],
    ridgePosition: 0.62,
    roofForm: "gable_cross",
    cornerFacades: "right",
    windowRatio: 0.55,
    variation: 0.66,
    parcelWidth: 32,
    parcelDepth: 36,
    detailDensity: 0.9
  },
  grammarTownhouses: {
    seed: "grammar-townhouses-001",
    sunTime: 0.6,
    nightLighting: 0.12,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    materialScheme: 0,
    archetypeVariant: 0,
    styleVariant: 0,
    floorPrograms: [
      { purpose: "home", setbackVoxels: 0, balcony: "none", windowRatio: 0.42 },
      { purpose: "home", setbackVoxels: 0, balcony: "selective", windowRatio: 0.38 },
      { purpose: "home", setbackVoxels: 2, balcony: "none", windowRatio: 0.32 }
    ],
    ridgePosition: 0.5,
    roofForm: "gable_street",
    cornerFacades: "none",
    windowRatio: 0.48,
    variation: 0.5,
    parcelWidth: 32,
    parcelDepth: 36,
    detailDensity: 0.7
  },
  grammarMagicShops: {
    seed: "grammar-magic-shops-001",
    sunTime: 0.18,
    nightLighting: 0.8,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    materialScheme: 1,
    archetypeVariant: 1,
    styleVariant: 1,
    floorPrograms: [
      { purpose: "shop", setbackVoxels: 0, balcony: "none", windowRatio: 0.9 },
      { purpose: "home", setbackVoxels: 2, balcony: "full", windowRatio: 0.46 },
      { purpose: "home", setbackVoxels: 0, balcony: "selective", windowRatio: 0.4 }
    ],
    ridgePosition: 0.28,
    roofForm: "hip",
    cornerFacades: "both",
    windowRatio: 0.68,
    variation: 0.82,
    parcelWidth: 36,
    parcelDepth: 40,
    detailDensity: 1
  },
  grammarWorkshops: {
    seed: "grammar-workshops-001",
    sunTime: 0.48,
    nightLighting: 0.3,
    buildingCount: 3,
    floors: 2,
    expansionFloors: 0,
    materialScheme: 2,
    archetypeVariant: 2,
    styleVariant: 2,
    floorPrograms: [
      { purpose: "workshop", setbackVoxels: 0, balcony: "none", windowRatio: 0.62 },
      { purpose: "storage", setbackVoxels: 2, balcony: "none", windowRatio: 0.24 }
    ],
    ridgePosition: 0,
    roofForm: "gable_cross",
    cornerFacades: "right",
    windowRatio: 0.38,
    variation: 0.76,
    parcelWidth: 36,
    parcelDepth: 32,
    detailDensity: 0.86
  }
});

export function normalizeVoxelBuildingConfig(config = {}) {
  const base = { ...VOXEL_BUILDING_PRESETS.connectedTerraceDay, ...config };
  const requestedArchetypeVariant = enumIndex(
    BUILDING_ARCHETYPE_IDS,
    config.archetype,
    base.archetypeVariant
  );
  const requestedStyleVariant = Object.hasOwn(config, "styleVariant")
    ? config.styleVariant
    : (Object.hasOwn(config, "materialScheme") ? config.materialScheme : base.styleVariant);
  const styleVariant = enumIndex(VOXEL_STYLE_KIT_IDS, config.style, requestedStyleVariant);
  const floors = Math.round(clamp(base.floors, 1, 5));
  const windowRatio = clamp(base.windowRatio ?? 0.58, 0.15, 0.9);
  const floorPrograms = normalizeConfiguredFloorPrograms(
    base.floorPrograms,
    floors + Math.round(clamp(base.expansionFloors, 0, 2)),
    BUILDING_ARCHETYPE_IDS[requestedArchetypeVariant],
    windowRatio,
    Object.hasOwn(config, "windowRatio") && !Object.hasOwn(config, "floorPrograms")
  );
  const derivedArchetype = archetypeForFloorPurpose(floorPrograms[0].purpose);
  const archetypeVariant = BUILDING_ARCHETYPE_IDS.indexOf(derivedArchetype);
  return {
    ...base,
    seed: String(base.seed || "voxel-terrace-001"),
    sunTime: clamp(base.sunTime, 0, 1),
    nightLighting: clamp(base.nightLighting, 0, 1),
    buildingCount: Math.round(clamp(base.buildingCount, 1, 3)),
    floors,
    expansionFloors: Math.round(clamp(base.expansionFloors, 0, 2)),
    roofVariant: 0,
    roofType: "pitched",
    roofForm: ROOF_FORM_IDS.includes(base.roofForm) ? base.roofForm : "gable_street",
    cornerFacades: CORNER_FACADE_MODE_IDS.includes(base.cornerFacades) ? base.cornerFacades : "none",
    ridgePosition: clamp(base.ridgePosition ?? 0.5, 0, 1),
    windowRatio,
    floorPrograms,
    materialScheme: styleVariant,
    archetypeVariant,
    archetype: BUILDING_ARCHETYPE_IDS[archetypeVariant],
    styleVariant,
    style: VOXEL_STYLE_KIT_IDS[styleVariant],
    variation: clamp(base.variation, 0, 1),
    parcelWidth: Math.round(clamp(base.parcelWidth, 24, 40)),
    parcelDepth: Math.round(clamp(base.parcelDepth, 28, 44)),
    detailDensity: clamp(base.detailDensity, 0, 1),
    decorationsByBuilding: normalizeStreetDecorationSpecs(base.decorationsByBuilding, Math.round(clamp(base.buildingCount, 1, 3))),
    includeStreetBase: base.includeStreetBase !== false,
    includeStreetLamps: base.includeStreetLamps !== false
  };
}

function normalizeStreetDecorationSpecs(value, buildingCount) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Array.from({ length: buildingCount }, (_, index) => {
    const buildingId = `voxel-building-${index + 1}`;
    const items = Array.isArray(value[buildingId]?.items) ? value[buildingId].items : [];
    return [buildingId, { specVersion: String(value[buildingId]?.specVersion ?? "0.1"), items: structuredClone(items) }];
  }).filter(([, spec]) => spec.items.length));
}

export function planVoxelStreet(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const streetWidth = params.buildingCount * params.parcelWidth;
  const firstX = -streetWidth / 2;
  const expansionIndex = Math.floor(params.buildingCount / 2);
  const archetype = BUILDING_ARCHETYPE_IDS[params.archetypeVariant];
  const style = VOXEL_STYLE_KIT_IDS[params.styleVariant];

  const buildings = Array.from({ length: params.buildingCount }, (_, index) => {
    const expandedBy = index === expansionIndex ? params.expansionFloors : 0;
    const id = `voxel-building-${index + 1}`;
    const sideFacadeSides = [];
    if (index === 0 && (params.cornerFacades === "left" || params.cornerFacades === "both")) {
      sideFacadeSides.push("left");
    }
    if (index === params.buildingCount - 1 && (params.cornerFacades === "right" || params.cornerFacades === "both")) {
      sideFacadeSides.push("right");
    }
    return createBuildingSpec({
      id,
      index,
      seed: params.seed,
      archetype,
      style,
      variation: params.variation,
      widthVoxels: params.parcelWidth,
      depthVoxels: params.parcelDepth,
      baseFloors: params.floors,
      expandedBy,
      floorHeight: VOXEL_PARCEL.floorHeight,
      voxelSize: VOXEL_SIZE,
      ridgePosition: params.ridgePosition,
      roofForm: params.roofForm,
      floorPrograms: params.floorPrograms,
      windowRatio: params.windowRatio,
      detailDensity: params.detailDensity,
      intent: params.intent,
      metadata: params.metadata,
      sideFacadeSides,
      origin: {
        x: firstX + index * params.parcelWidth,
        y: 0,
        z: -params.parcelDepth / 2
      },
      adjacency: {
        left: index > 0 ? `voxel-building-${index}` : null,
        right: index < params.buildingCount - 1 ? `voxel-building-${index + 2}` : null,
        exposedLeftWall: index === 0,
        exposedRightWall: index === params.buildingCount - 1
      }
    });
  });

  return {
    renderer: "voxel-procedural-v1",
    seed: params.seed,
    voxelSize: VOXEL_SIZE,
    specVersion: BUILDING_SPEC_VERSION,
    parcel: {
      ...structuredClone(VOXEL_PARCEL),
      width: params.parcelWidth,
      depth: params.parcelDepth,
      worldWidth: params.parcelWidth * VOXEL_SIZE,
      worldDepth: params.parcelDepth * VOXEL_SIZE
    },
    streetWidthVoxels: streetWidth,
    buildings,
    connections: buildings.slice(0, -1).map((building, index) => ({
      type: "party_wall",
      from: building.id,
      to: buildings[index + 1].id,
      sharedBoundaryX: building.origin.x + building.footprint.widthVoxels
    }))
  };
}

export function getVoxelBuildingContract(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const plan = planVoxelStreet(params);
  return {
    mode: "voxel",
    renderer: plan.renderer,
    sourceOfTruth: "deterministic BuildingSpec + seed; rendered voxels are derived",
    resolution: {
      voxelSize: VOXEL_SIZE,
      voxelUnit: "world",
      voxelsPerFourUnitParcel: VOXEL_PARCEL.width
    },
    meshing: {
      prototypeStrategy: "mutually-exclusive sparse voxel field + surface-culled instanced boxes",
      conflictPolicy: "higher semantic phase wins; equal-priority writes use last-write-wins",
      solidInteriors: false,
      productionTarget: "chunked greedy surface mesh"
    },
    buildingGrammar: {
      specVersion: BUILDING_SPEC_VERSION,
      pipeline: ["BuildingSpec", "legacy solid mass", "floor stack", "facade bays", "2D roof height field", "decorations", "voxel field"],
      stableSubSeeds: true,
      archetypes: BUILDING_ARCHETYPE_IDS,
      styleKits: VOXEL_STYLE_KIT_IDS,
      floorPurposes: FLOOR_USE_IDS,
      floorBalconies: FLOOR_BALCONY_IDS,
      roofForms: ROOF_FORM_IDS,
      cornerFacadeModes: CORNER_FACADE_MODE_IDS
    },
    massingGrammar: {
      ...getUrbanMassingCatalog(),
      pipeline: ["up-to-6x6 cell mask", "mass nodes", "vertical profiles", "voids", "caps", "relations", "voxel field"],
      legacyCompatibility: "Every BuildingSpec v0.2 exposes one derived solid mass without changing its renderer."
    },
    roofSystem: {
      type: "two-dimensional voxel height field",
      forms: ROOF_FORM_IDS,
      parameters: ["width", "depth", "ridge height", "ridge position 0..1", "overhang", "thickness"],
      extremes: "gable ridge positions 0 and 1 become opposite mono-pitch roofs",
      endCaps: "left/right and front/back closures are height-field-derived; party-wall exposure samples the shared boundary"
    },
    agentControl: {
      simple: ["floorPrograms", "floorPrograms[].windowRatio", "footprint", "style", "roofForm", "ridgePosition", "cornerFacades", "decorationsByBuilding"],
      advanced: ["floor purpose", "floor setback", "floor balcony", "facade.rhythm", "component materials", "decoration slots"],
      decoration: "stable-anchor runtime attachments applied after deterministic generation",
      semanticGridSign: {
        type: "semantic_grid_sign",
        grid: "four rows of four cells using 0/1 or ./#",
        anchors: ["main/floor-{index}/facade-{direction}/entrance", "main/floor-{index}/facade-{direction}/bay-{index}"],
        frameMaterials: ["iron", "patinaMetal", "timber", "sandstone", "limestone"],
        boardMaterials: ["timber", "slate", "iron", "patinaMetal"],
        emissiveMaterials: ["tealMagic", "violetMagic", "warmWindow"],
        frameStyles: ["simple", "riveted", "crowned"],
        mounts: ["projecting", "wall"],
        defaultMount: "projecting",
        microVoxelSize: { fixed: SEMANTIC_GRID_SIGN_VOXEL_SIZE, buildingVoxelRatio: 0.5, unit: "world_meter" },
        buildingVoxelSize: VOXEL_SIZE
      }
    },
    expansion: {
      supported: true,
      strategy: "preserve lower floors, append floor modules, regenerate roof"
    },
    adjacency: {
      supported: true,
      strategy: "party-wall ports suppress shared exterior faces"
    },
    materialIds: Object.keys(MATERIAL_LIBRARY),
    config: params,
    plan
  };
}

export function createVoxelBuildingLab(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const { plan, buffer, exposedPartyWallVoxels } = compileVoxelBuilding(params);
  const root = new THREE.Group();
  root.name = "VoxelBuildingLab";

  const materialMeshes = buffer.createMeshes({
    strategy: params.renderStrategy,
    chunkSizeVoxels: params.voxelChunkSize,
    maxMergeSpanVoxels: params.maxMergeSpanVoxels
  });
  materialMeshes.forEach((mesh) => root.add(mesh));

  const lamps = params.includeStreetLamps ? addStreetLamps(root, plan) : [];
  const windowLights = addWindowLights(root, plan);
  const designDecorations = addStreetDesignDecorations(root, plan, params.decorationsByBuilding);
  const magicWindowCount = plan.buildings.filter((building) => building.decorations.magicWindow).length;
  const diagnostics = {
    specVersion: plan.specVersion,
    voxelSize: VOXEL_SIZE,
    instanceCount: buffer.instanceCount,
    drawCalls: materialMeshes.length,
    materialCounts: buffer.materialCounts(),
    buildingCount: plan.buildings.length,
    connectionCount: plan.connections.length,
    omittedPartyWalls: plan.connections.length * 2,
    exposedPartyWallVoxels,
    overwrittenVoxels: buffer.overwrittenVoxelCount,
    rejectedLowerPriorityVoxels: buffer.rejectedVoxelCount,
    culledInteriorVoxels: buffer.culledInteriorVoxelCount,
    occupiedVoxels: buffer.occupiedVoxelCount,
    renderStats: structuredClone(buffer.renderStats),
    surfaceOnly: true,
    expandedBuildingId: plan.buildings.find((building) => building.expandedBy > 0)?.id ?? null,
    archetypes: [...new Set(plan.buildings.map((building) => building.archetype))],
    styleKits: [...new Set(plan.buildings.map((building) => building.style))],
    facadeRhythms: plan.buildings.map((building) => building.facade.rhythm),
    sideFacadeRhythms: plan.buildings.map((building) => Object.fromEntries(
      Object.entries(building.sideFacades).map(([side, facade]) => [side, facade.rhythm])
    )),
    floorStacks: plan.buildings.map((building) => building.floorSpecs.map((floor) => ({
      purpose: floor.purpose,
      setbackVoxels: floor.setbackVoxels,
      frontSetbackVoxels: floor.frontSetbackVoxels,
      balcony: floor.balcony,
      windowRatio: floor.windowRatio
    }))),
    ridgePositions: plan.buildings.map((building) => building.roof.ridgeRatio),
    roofForms: plan.buildings.map((building) => building.roof.form),
    streetLampCount: lamps.length,
    decorationCount: designDecorations.length,
    semanticGridSignCount: designDecorations.filter((entry) => entry.group.userData.decorationType === "semantic_grid_sign").length,
    streetFixturesOwnedByBuilding: params.includeStreetLamps,
    magicWindowCount,
    magicDecorationPlacement: "upper_window"
  };

  root.userData.config = params;
  root.userData.plan = plan;
  root.userData.contract = getVoxelBuildingContract(params);
  root.userData.diagnostics = diagnostics;
  root.userData.getVoxelDiagnostics = () => structuredClone(diagnostics);
  root.userData.getVoxelContract = () => structuredClone(root.userData.contract);
  root.userData.updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, params.nightLighting), 0, 1);
    materialMeshes.forEach((mesh) => {
      const materialId = mesh.userData.materialId;
      const definition = MATERIAL_LIBRARY[materialId];
      if (!definition?.emissive) return;
      const magic = materialId === "violetMagic" || materialId === "tealMagic";
      mesh.material.emissiveIntensity = (magic ? 0.48 : 0.15) + night * (magic ? 1.55 : 1.8);
    });
    windowLights.forEach((light, index) => {
      light.intensity = night * (index === 1 ? 8 : 6);
      light.distance = 5 + night * 1.5;
    });
    lamps.forEach((lamp) => {
      lamp.light.intensity = night * 4.5;
      lamp.bulb.material.emissiveIntensity = 0.25 + night * 2;
    });
    designDecorations.forEach((entry) => updateDesignDecorationDaylight(entry, night));
  };
  root.userData.updateDaylight(voxelDaylightStyle(params.sunTime));
  return root;
}

export function createVoxelBuildingFromSpec(sourceSpec, options = {}) {
  if (!sourceSpec?.specVersion || !sourceSpec?.floorSpecs?.length) throw new Error("A complete BuildingSpec is required");
  const building = structuredClone(sourceSpec);
  const params = normalizeVoxelBuildingConfig({
    seed: building.seed,
    buildingCount: 1,
    floors: building.floors,
    floorPrograms: building.floorSpecs.map((floor) => ({
      purpose: floor.purpose,
      setbackVoxels: floor.frontSetbackVoxels,
      balcony: floor.balcony,
      windowRatio: floor.windowRatio
    })),
    style: building.style,
    roofForm: building.roof.form,
    ridgePosition: building.roof.ridgeRatio,
    parcelWidth: building.footprint.widthVoxels,
    parcelDepth: building.footprint.depthVoxels,
    includeStreetBase: false,
    includeStreetLamps: false,
    renderStrategy: options.renderStrategy,
    voxelChunkSize: options.voxelChunkSize,
    maxMergeSpanVoxels: options.maxMergeSpanVoxels,
    nightLighting: options.nightLighting ?? 0
  });
  const plan = {
    renderer: "voxel-procedural-v1",
    seed: building.seed,
    voxelSize: VOXEL_SIZE,
    specVersion: building.specVersion,
    parcel: {
      ...structuredClone(VOXEL_PARCEL),
      width: building.footprint.widthVoxels,
      depth: building.footprint.depthVoxels,
      worldWidth: building.footprint.worldWidth,
      worldDepth: building.footprint.worldDepth
    },
    streetWidthVoxels: building.footprint.widthVoxels,
    buildings: [building],
    connections: []
  };
  const buffer = new VoxelInstanceBuffer(building.seed);
  addBuilding(buffer, building, params);
  const root = new THREE.Group();
  root.name = `VoxelBuilding-${building.id}`;
  const materialMeshes = buffer.createMeshes({
    strategy: options.renderStrategy,
    chunkSizeVoxels: options.voxelChunkSize,
    maxMergeSpanVoxels: options.maxMergeSpanVoxels
  });
  materialMeshes.forEach((mesh) => {
    mesh.castShadow = true;
    root.add(mesh);
  });
  const windowLights = addWindowLights(root, plan);
  const designDecorations = addFloorStackDesignDecorations(root, building, options.decorations?.items ?? []);
  const diagnostics = {
    renderer: "voxel-building-spec-v1",
    specVersion: building.specVersion,
    voxelSize: VOXEL_SIZE,
    occupiedVoxels: buffer.occupiedVoxelCount,
    instanceCount: buffer.instanceCount,
    drawCalls: materialMeshes.length,
    materialCounts: buffer.materialCounts(),
    renderStats: structuredClone(buffer.renderStats),
    decorationCount: designDecorations.length,
    surfaceOnly: true
  };
  root.userData.plan = plan;
  root.userData.spec = building;
  root.userData.diagnostics = diagnostics;
  root.userData.contract = {
    mode: "floor_stack",
    sourceOfTruth: "versioned BuildingSpec + DecorationSpec",
    renderer: diagnostics.renderer
  };
  root.userData.getVoxelDiagnostics = () => structuredClone(diagnostics);
  root.userData.updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, options.nightLighting ?? 0), 0, 1);
    materialMeshes.forEach((mesh) => {
      const definition = MATERIAL_LIBRARY[mesh.userData.materialId];
      if (!definition?.emissive) return;
      const magic = mesh.userData.materialId === "violetMagic" || mesh.userData.materialId === "tealMagic";
      mesh.material.emissiveIntensity = (magic ? 0.48 : 0.15) + night * (magic ? 1.55 : 1.8);
    });
    windowLights.forEach((light) => { light.intensity = night * 6; });
    designDecorations.forEach((entry) => {
      updateDesignDecorationDaylight(entry, night);
    });
  };
  root.userData.updateDaylight(voxelDaylightStyle(options.sunTime ?? 0.52));
  return root;
}

export function createVoxelBuildingLodLevels(config = {}, factors = [1, 2, 3]) {
  const params = normalizeVoxelBuildingConfig(config);
  const { plan, buffer } = compileVoxelBuilding(params);
  const normalizedFactors = [...new Set(factors.map((factor) => Math.max(1, Math.round(factor))))]
    .sort((left, right) => left - right);
  const levels = createVoxelLodGroups(buffer, normalizedFactors, {
    strategy: params.renderStrategy,
    chunkSizeVoxels: params.voxelChunkSize,
    maxMergeSpanVoxels: params.maxMergeSpanVoxels
  }, "VoxelBuildingLOD");
  const updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, params.nightLighting), 0, 1);
    levels.flatMap((level) => level.meshes).forEach((mesh) => {
      const materialId = mesh.userData.materialId;
      const definition = MATERIAL_LIBRARY[materialId];
      if (!definition?.emissive) return;
      const magic = materialId === "violetMagic" || materialId === "tealMagic";
      mesh.material.emissiveIntensity = (magic ? 0.48 : 0.15) + night * (magic ? 1.55 : 1.8);
    });
  };
  updateDaylight(voxelDaylightStyle(params.sunTime));
  return {
    renderer: "voxel-building-mip-lod-v1",
    sourceOfTruth: "one procedural voxel occupancy field aggregated on fixed 2x and 3x grids",
    params,
    plan,
    levels,
    updateDaylight
  };
}

export function createVoxelBuildingLodLevelsFromSpec(sourceSpec, options = {}, factors = [1, 2, 3]) {
  if (!sourceSpec?.specVersion || !sourceSpec?.floorSpecs?.length) {
    throw new Error("A complete BuildingSpec is required");
  }
  const building = structuredClone(sourceSpec);
  const params = normalizeVoxelBuildingConfig({
    seed: building.seed,
    buildingCount: 1,
    floors: building.floors,
    floorPrograms: building.floorSpecs.map((floor) => ({
      purpose: floor.purpose,
      setbackVoxels: floor.frontSetbackVoxels,
      balcony: floor.balcony,
      windowRatio: floor.windowRatio
    })),
    style: building.style,
    roofForm: building.roof.form,
    ridgePosition: building.roof.ridgeRatio,
    parcelWidth: building.footprint.widthVoxels,
    parcelDepth: building.footprint.depthVoxels,
    includeStreetBase: false,
    includeStreetLamps: false,
    renderStrategy: options.renderStrategy ?? "greedy",
    voxelChunkSize: options.voxelChunkSize ?? 128,
    maxMergeSpanVoxels: options.maxMergeSpanVoxels ?? 16,
    nightLighting: options.nightLighting ?? 0
  });
  const buffer = new VoxelInstanceBuffer(building.seed);
  addBuilding(buffer, building, params);
  const levels = createVoxelLodGroups(buffer, factors, {
    strategy: params.renderStrategy,
    chunkSizeVoxels: params.voxelChunkSize,
    maxMergeSpanVoxels: params.maxMergeSpanVoxels
  }, `VoxelBuildingSpecLOD-${building.id}`);
  const updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, params.nightLighting), 0, 1);
    levels.flatMap((level) => level.meshes).forEach((mesh) => {
      const definition = MATERIAL_LIBRARY[mesh.userData.materialId];
      if (!definition?.emissive) return;
      const magic = mesh.userData.materialId === "violetMagic" || mesh.userData.materialId === "tealMagic";
      mesh.material.emissiveIntensity = (magic ? 0.48 : 0.15) + night * (magic ? 1.55 : 1.8);
    });
  };
  updateDaylight(voxelDaylightStyle(params.sunTime ?? 0.52));
  return {
    renderer: "voxel-building-spec-mip-lod-v1",
    sourceOfTruth: "versioned BuildingSpec compiled into one occupancy field and fixed 2x/3x macrovoxels",
    params,
    building,
    levels,
    updateDaylight
  };
}

export function createVoxelMassingLodLevels(input = {}, factors = [1, 2, 3]) {
  const source = input.spec ?? input;
  const spec = createUrbanMassingSpec(source);
  const compiled = compileVoxelMassing(spec);
  const levels = createVoxelLodGroups(compiled.buffer, factors, {
    strategy: input.renderStrategy ?? "greedy",
    chunkSizeVoxels: input.voxelChunkSize ?? 128,
    maxMergeSpanVoxels: input.maxMergeSpanVoxels ?? 16
  }, `VoxelMassingLOD-${spec.id}`);
  const updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, input.nightLighting ?? 0), 0, 1);
    levels.flatMap((level) => level.meshes).forEach((mesh) => {
      const definition = MATERIAL_LIBRARY[mesh.userData.materialId];
      if (!definition?.emissive) return;
      mesh.material.emissiveIntensity = definition.emissiveIntensity + night * 1.6;
    });
  };
  updateDaylight(voxelDaylightStyle(input.sunTime ?? 0.52));
  return {
    renderer: "voxel-massing-mip-lod-v1",
    sourceOfTruth: "deterministic UrbanMassingSpec compiled into one occupancy field and fixed 2x/3x macrovoxels",
    spec,
    levels,
    updateDaylight
  };
}

function createVoxelLodGroups(buffer, factors, options, name) {
  const normalizedFactors = [...new Set(factors.map((factor) => Math.max(1, Math.round(factor))))]
    .sort((left, right) => left - right);
  return normalizedFactors.map((factor) => {
    const levelBuffer = factor === 1 ? buffer : buffer.createDownsampled(factor);
    const group = new THREE.Group();
    group.name = `${name}-${factor}x`;
    const meshes = levelBuffer.createMeshes({
      strategy: options.strategy,
      chunkSizeVoxels: Math.max(8, Math.ceil((options.chunkSizeVoxels ?? 128) / factor)),
      maxMergeSpanVoxels: Math.max(1, Math.ceil((options.maxMergeSpanVoxels ?? 16) / factor))
    });
    meshes.forEach((mesh) => group.add(mesh));
    group.userData.lodFactor = factor;
    return {
      factor,
      group,
      meshes,
      diagnostics: {
        factor,
        voxelSize: levelBuffer.voxelSize,
        occupiedVoxels: levelBuffer.occupiedVoxelCount,
        materialCounts: levelBuffer.materialCounts(),
        renderStats: structuredClone(levelBuffer.renderStats),
        downsample: structuredClone(levelBuffer.downsampleDiagnostics ?? null)
      }
    };
  });
}

function compileVoxelBuilding(params) {
  const plan = planVoxelStreet(params);
  const buffer = new VoxelInstanceBuffer(params.seed);
  if (params.includeStreetBase) addStreetBase(buffer, plan);
  plan.buildings.forEach((building) => addBuilding(buffer, building, params));
  const exposedPartyWallVoxels = addPartyWallExposures(buffer, plan);
  return { plan, buffer, exposedPartyWallVoxels };
}

export function createVoxelMassingLab(input = {}) {
  const source = input.spec ?? input;
  const spec = createUrbanMassingSpec(source);
  const root = new THREE.Group();
  root.name = `VoxelMassingLab-${spec.id}`;
  const { buffer, relationCuts, compiledMasses, groundDetails, relationFinishes, capPlans } = compileVoxelMassing(spec);
  const massPlans = compiledMasses.map((compiled) => compiled.diagnostics);
  const materialMeshes = buffer.createMeshes({
    strategy: input.renderStrategy,
    chunkSizeVoxels: input.voxelChunkSize,
    maxMergeSpanVoxels: input.maxMergeSpanVoxels
  });
  materialMeshes.forEach((mesh) => {
    mesh.castShadow = true;
    root.add(mesh);
  });
  const designDecorations = addMassingDesignDecorations(root, spec, input.decorations?.items ?? []);
  const diagnostics = {
    specVersion: spec.specVersion,
    renderer: "voxel-massing-v1",
    voxelSize: VOXEL_SIZE,
    cellSizeVoxels: MASSING_CELL_VOXELS,
    footprintCells: spec.footprint.cellCount,
    footprintSpan: [spec.footprint.widthCells, spec.footprint.depthCells],
    massCount: spec.masses.length,
    massTypes: [...new Set(spec.masses.map((mass) => mass.type))],
    planShapes: [...new Set(spec.masses.map((mass) => mass.planShape))],
    verticalProfiles: [...new Set(spec.masses.map((mass) => mass.profile.type))],
    capTypes: [...new Set(spec.masses.map((mass) => mass.cap.type))],
    capPlans,
    capBridgeVoxels: capPlans.reduce((total, cap) => total + cap.bridgeVoxels, 0),
    maximumCapStep: Math.max(0, ...capPlans.map((cap) => cap.maximumStep)),
    voidCount: spec.masses.reduce((total, mass) => total + mass.voids.length, 0),
    relationCount: spec.relations.length,
    relationCuts: relationCuts.length,
    relationFinishes,
    relationFinishVoxels: relationFinishes.reduce((total, finish) => total + finish.voxels, 0),
    groundDetails,
    groundDetailVoxels: groundDetails.reduce((total, detail) => total + detail.voxels, 0),
    massPlans,
    occupiedVoxels: buffer.occupiedVoxelCount,
    instanceCount: buffer.instanceCount,
    culledInteriorVoxels: buffer.culledInteriorVoxelCount,
    overwrittenVoxels: buffer.overwrittenVoxelCount,
    drawCalls: materialMeshes.length,
    materialCounts: buffer.materialCounts(),
    renderStats: structuredClone(buffer.renderStats),
    decorationCount: designDecorations.length,
    surfaceOnly: true
  };
  root.userData.spec = spec;
  root.userData.diagnostics = diagnostics;
  root.userData.contract = {
    mode: "voxel-massing",
    renderer: diagnostics.renderer,
    sourceOfTruth: "deterministic UrbanMassingSpec + seed",
    catalog: getUrbanMassingCatalog(),
    compiler: {
      footprint: "edge-connected cell mask inside an up-to-6x6 site",
      geometry: "surface-only voxel shells derived from mass nodes",
      connections: "separate, adjoining shell removal, aligned portal, or vertical stacking",
      railIntegration: false
    }
  };
  root.userData.getVoxelDiagnostics = () => structuredClone(diagnostics);
  root.userData.getVoxelContract = () => structuredClone(root.userData.contract);
  root.userData.updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, input.nightLighting ?? 0), 0, 1);
    materialMeshes.forEach((mesh) => {
      const definition = MATERIAL_LIBRARY[mesh.userData.materialId];
      if (!definition?.emissive) return;
      mesh.material.emissiveIntensity = definition.emissiveIntensity + night * 1.6;
    });
    designDecorations.forEach((entry) => {
      if (entry.light) entry.light.intensity = night * Number(entry.parameters.lightIntensity ?? 2.5);
    });
  };
  root.userData.updateDaylight(voxelDaylightStyle(input.sunTime ?? 0.52));
  return root;
}

function compileVoxelMassing(spec) {
  const buffer = new VoxelInstanceBuffer(spec.seed);
  const siteOrigin = {
    x: -Math.round(spec.footprint.widthCells * MASSING_CELL_VOXELS / 2),
    z: -Math.round(spec.footprint.depthCells * MASSING_CELL_VOXELS / 2)
  };
  addMassingSiteBase(buffer, spec, siteOrigin);
  const relationCuts = planMassingRelationCuts(spec, siteOrigin);
  const basePlansById = new Map(spec.masses.map((mass) => [
    mass.id,
    planMassingBase(mass, siteOrigin)
  ]));
  const compiledMasses = spec.masses.map((mass) => addMassingNode(
    buffer,
    spec,
    mass,
    siteOrigin,
    relationCuts.filter((cut) => cut.massId === mass.id),
    basePlansById.get(mass.id),
    spec.masses
      .filter((candidate) => candidate.id !== mass.id && candidate.type !== "ground")
      .map((candidate) => ({ mass: candidate, plan: basePlansById.get(candidate.id) }))
  ));
  const groundDetails = compiledMasses
    .filter((compiled) => compiled.mass.type === "ground")
    .map((compiled) => addMassingGroundDetails(buffer, spec, compiled.mass, compiled.basePlan));
  const relationFinishes = addMassingRelationFinishes(buffer, spec, relationCuts, compiledMasses);
  const capPlans = compiledMasses.map((compiled) => {
    const stackedChildren = spec.relations
      .filter((relation) => relation.type === "stacked" && relation.from === compiled.mass.id)
      .map((relation) => compiledMasses.find((candidate) => candidate.mass.id === relation.to))
      .filter(Boolean);
    const bodyTopY = compiled.mass.baseYVoxels + compiled.mass.heightVoxels;
    const capExclusions = new Set(stackedChildren
      .filter((child) => child.mass.baseYVoxels <= bodyTopY + 1)
      .flatMap((child) => [...child.basePlan]));
    const capOccluders = spec.masses
      .filter((candidate) => candidate.id !== compiled.mass.id && candidate.type !== "ground")
      .map((candidate) => ({ mass: candidate, plan: basePlansById.get(candidate.id) }));
    return {
      id: compiled.mass.id,
      ...addMassingCap(buffer, spec, compiled.mass, compiled.topPlan, capExclusions, capOccluders)
    };
  });
  return { buffer, relationCuts, compiledMasses, groundDetails, relationFinishes, capPlans };
}

function addFloorStackDesignDecorations(root, building, items) {
  return items.map((item) => {
    const anchor = resolveFloorStackDecorationAnchor(building, item.anchor, item);
    const decoration = createDesignDecoration(item, anchor);
    root.add(decoration.group);
    return decoration;
  });
}

function addStreetDesignDecorations(root, plan, specsByBuilding = {}) {
  return plan.buildings.flatMap((building) => (
    addFloorStackDesignDecorations(root, building, specsByBuilding?.[building.id]?.items ?? [])
  ));
}

function addMassingDesignDecorations(root, spec, items) {
  const siteOrigin = {
    x: -Math.round(spec.footprint.widthCells * MASSING_CELL_VOXELS / 2),
    z: -Math.round(spec.footprint.depthCells * MASSING_CELL_VOXELS / 2)
  };
  return items.map((item) => {
    const massId = String(item.anchor).split("/")[0];
    const mass = spec.masses.find((candidate) => candidate.id === massId)
      ?? spec.masses.find((candidate) => candidate.role === "primary")
      ?? spec.masses[0];
    const xs = mass.cells.map((cell) => siteOrigin.x + cell.x * MASSING_CELL_VOXELS);
    const zs = mass.cells.map((cell) => siteOrigin.z + cell.z * MASSING_CELL_VOXELS);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + MASSING_CELL_VOXELS;
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs) + MASSING_CELL_VOXELS;
    const face = decorationFace(item.anchor);
    const roofAnchor = /roof|cap/i.test(item.anchor);
    const anchor = {
      face,
      x: face === "west" ? minX : face === "east" ? maxX : (minX + maxX) / 2,
      y: roofAnchor ? mass.baseYVoxels + mass.heightVoxels + Math.max(2, mass.cap?.heightVoxels ?? 0) : mass.baseYVoxels + mass.heightVoxels * 0.48,
      z: face === "north" ? minZ : face === "south" ? maxZ : (minZ + maxZ) / 2
    };
    const decoration = createDesignDecoration(item, anchor);
    root.add(decoration.group);
    return decoration;
  });
}

function resolveFloorStackDecorationAnchor(building, path, item = {}) {
  const floorIndex = Number(/floor-(\d+)/i.exec(path)?.[1] ?? 0);
  const entranceAnchor = /\/entrance(?:\/|$)/i.test(path);
  const face = decorationFace(path);
  const facade = face === "west" ? building.sideFacades.left
    : face === "east" ? building.sideFacades.right
      : building.facade;
  const bayIndex = entranceAnchor
    ? (facade?.entranceBay ?? building.facade.entranceBay ?? 0)
    : Number(/bay-(\d+)/i.exec(path)?.[1] ?? building.facade.entranceBay ?? 0);
  const bay = facade?.bays?.[bayIndex] ?? building.facade.bays[building.facade.entranceBay] ?? building.facade.bays[0];
  const floorPlan = facade?.floors?.[floorIndex];
  const module = floorPlan?.modules?.find((candidate) => candidate.bay === bayIndex);
  const opening = module?.opening;
  const autoEntranceSidePlacement = entranceAnchor && item.type === "semantic_grid_sign" && opening;
  const facadeSpan = face === "east" || face === "west"
    ? building.footprint.depthVoxels
    : building.footprint.widthVoxels;
  let along = bay?.center ?? facadeSpan / 2;
  let mountingSide = null;
  if (autoEntranceSidePlacement) {
    const before = opening.xStart - 2;
    const after = opening.xEnd + 2;
    const beforeValid = before >= 2;
    const afterValid = after <= facadeSpan - 2;
    const useBefore = beforeValid && (!afterValid || opening.xStart >= facadeSpan - 1 - opening.xEnd);
    along = useBefore ? before : afterValid ? after : clamp(before, 2, facadeSpan - 2);
    mountingSide = useBefore ? "before" : "after";
  }
  const roofAnchor = /roof|cap/i.test(path);
  const x = face === "west"
    ? building.origin.x
    : face === "east"
      ? building.origin.x + building.footprint.widthVoxels
      : building.origin.x + along;
  const z = face === "north"
    ? building.origin.z
    : face === "south"
      ? building.origin.z + building.footprint.depthVoxels
      : building.origin.z + along;
  const lintelTopYVoxels = autoEntranceSidePlacement
    ? floorPlan.y + opening.yEnd + 3
    : null;
  const panelOuterHalfVoxels = semanticGridSignPanelOuterHalf() / VOXEL_SIZE;
  return {
    face,
    x,
    y: roofAnchor
      ? building.wallHeightVoxels + Math.max(2, building.roof.ridgeHeight ?? 0)
      : autoEntranceSidePlacement
        ? lintelTopYVoxels + 1 + panelOuterHalfVoxels
      : floorIndex * building.floorHeight + building.floorHeight * 0.56,
    z,
    ...(autoEntranceSidePlacement ? {
      placement: "entrance-side-lintel-clear",
      mountingSide,
      lintelTopYVoxels,
      lintelClearanceVoxels: 1,
      entranceOpening: structuredClone(opening)
    } : {})
  };
}

function decorationFace(path) {
  return /(?:facade-|face-)(north|east|south|west)/i.exec(String(path))?.[1]?.toLowerCase() ?? "south";
}

function createDesignDecoration(item, anchor) {
  const parameters = item.parameters ?? {};
  const group = new THREE.Group();
  group.name = `DesignDecoration-${item.id}`;
  group.position.set(anchor.x * VOXEL_SIZE, anchor.y * VOXEL_SIZE, anchor.z * VOXEL_SIZE);
  group.rotation.y = anchor.face === "east" ? Math.PI / 2 : anchor.face === "west" ? -Math.PI / 2 : anchor.face === "north" ? Math.PI : 0;
  group.userData = {
    decorationId: item.id,
    decorationType: item.type,
    anchor: item.anchor,
    anchorGeometry: structuredClone(anchor),
    parameters: structuredClone(parameters)
  };
  if (item.type === "semantic_grid_sign") {
    return createSemanticGridSignDecoration(item, group, parameters);
  }
  const material = new THREE.MeshStandardMaterial({
    color: parameters.color ?? decorationColor(parameters.material),
    roughness: 0.86,
    metalness: parameters.material === "iron" ? 0.45 : 0.03
  });
  let light = null;
  if (item.type === "hanging_sign") {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.09), material);
    board.position.set(0.32, 0, 0.18);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.48), new THREE.MeshStandardMaterial({ color: "#343331", roughness: 0.72, metalness: 0.5 }));
    bracket.position.set(0, 0.26, 0.02);
    group.add(board, bracket);
  } else if (item.type === "facade_lamp" || item.type === "magic_lamp") {
    const bulbMaterial = new THREE.MeshStandardMaterial({ color: parameters.color ?? "#f3bd64", emissive: parameters.emissive ?? "#e6a34d", emissiveIntensity: 1.2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMaterial);
    bulb.position.z = 0.2;
    light = new THREE.PointLight(parameters.emissive ?? "#f0ad58", 0, 4, 2);
    light.position.copy(bulb.position);
    group.add(bulb, light);
  } else if (item.type === "roof_finial") {
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.72, 6), material);
    finial.position.y = 0.36;
    group.add(finial);
  } else {
    const width = Number(parameters.width ?? 0.72);
    const height = Number(parameters.height ?? 0.28);
    const depth = Number(parameters.depth ?? 0.24);
    const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    block.position.z = depth / 2;
    group.add(block);
  }
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return { group, light, parameters, emissiveMaterials: [] };
}

function createSemanticGridSignDecoration(item, group, parameters) {
  const { unit, cellSize, cellGap, gridSpan, panelSize, panelDepth } = semanticGridSignPanelMetrics();
  const rows = normalizeSemanticGridRows(parameters.grid);
  const frameMaterialId = semanticSignMaterialId(parameters.frameMaterial, ["iron", "patinaMetal", "timber", "sandstone", "limestone"], "iron");
  const boardMaterialId = semanticSignMaterialId(parameters.boardMaterial, ["timber", "slate", "iron", "patinaMetal"], "timber");
  const emissiveMaterialId = semanticSignMaterialId(parameters.emissiveMaterial, ["tealMagic", "violetMagic", "warmWindow"], "violetMagic");
  const frameStyle = ["simple", "riveted", "crowned"].includes(parameters.frameStyle) ? parameters.frameStyle : "simple";
  const mount = parameters.mount === "wall" ? "wall" : "projecting";
  const panel = new THREE.Group();
  panel.name = `SemanticGridSign-${item.id}`;
  const frameMaterial = createSemanticSignMaterial(frameMaterialId);
  const boardMaterial = createSemanticSignMaterial(boardMaterialId);
  const emissiveMaterial = createSemanticSignMaterial(emissiveMaterialId, {
    emissiveIntensity: clamp(Number(parameters.emissiveIntensity ?? 1.35), 0, 3)
  });
  const autoPlaced = group.userData.anchorGeometry?.placement === "entrance-side-lintel-clear";
  const offsetX = autoPlaced ? 0 : Number(parameters.offsetX ?? 0);
  const offsetY = autoPlaced ? 0 : Number(parameters.offsetY ?? 0.72);
  const facadeClearance = mount === "projecting" ? VOXEL_SIZE : 0;
  const panelCenterZ = mount === "projecting"
    ? semanticGridSignPanelOuterHalf() + facadeClearance
    : panelDepth * 0.5 + 0.015;
  panel.position.set(offsetX, offsetY, panelCenterZ);
  if (mount === "projecting") panel.rotation.y = Math.PI / 2;
  const board = new THREE.Mesh(new THREE.BoxGeometry(panelSize, panelSize, panelDepth), boardMaterial);
  board.userData.materialId = boardMaterialId;
  panel.add(board);

  const frameThickness = unit * 0.52;
  const frameDepth = unit;
  const horizontalFrameGeometry = new THREE.BoxGeometry(panelSize + frameThickness * 1.8, frameThickness, frameDepth);
  const verticalFrameGeometry = new THREE.BoxGeometry(frameThickness, panelSize, frameDepth);
  const topFrame = new THREE.Mesh(horizontalFrameGeometry, frameMaterial);
  const bottomFrame = new THREE.Mesh(horizontalFrameGeometry, frameMaterial);
  const leftFrame = new THREE.Mesh(verticalFrameGeometry, frameMaterial);
  const rightFrame = new THREE.Mesh(verticalFrameGeometry, frameMaterial);
  topFrame.position.set(0, panelSize / 2 + frameThickness / 2, 0);
  bottomFrame.position.set(0, -panelSize / 2 - frameThickness / 2, 0);
  leftFrame.position.set(-panelSize / 2 - frameThickness / 2, 0, 0);
  rightFrame.position.set(panelSize / 2 + frameThickness / 2, 0, 0);
  [topFrame, bottomFrame, leftFrame, rightFrame].forEach((mesh) => { mesh.userData.materialId = frameMaterialId; });
  panel.add(topFrame, bottomFrame, leftFrame, rightFrame);

  const pixelDepth = unit * 0.55;
  const cellGeometry = new THREE.BoxGeometry(cellSize, cellSize, pixelDepth);
  rows.forEach((row, rowIndex) => [...row].forEach((cell, columnIndex) => {
    if (cell !== "1") return;
    const x = -gridSpan / 2 + cellSize / 2 + columnIndex * (cellSize + cellGap);
    const y = gridSpan / 2 - cellSize / 2 - rowIndex * (cellSize + cellGap);
    [-1, 1].forEach((side) => {
      const pixel = new THREE.Mesh(cellGeometry, emissiveMaterial);
      pixel.position.set(x, y, side * (panelDepth / 2 + pixelDepth / 2 + unit * 0.04));
      pixel.userData.materialId = emissiveMaterialId;
      panel.add(pixel);
    });
  }));

  if (frameStyle === "riveted") addSemanticSignRivets(panel, panelSize, frameDepth / 2, frameMaterial, frameMaterialId, unit);
  if (frameStyle === "crowned") addSemanticSignCrown(panel, panelSize, frameMaterial, frameMaterialId, unit);
  if (mount === "projecting") addSemanticSignBracket(
    group,
    frameMaterial,
    frameMaterialId,
    unit,
    panelSize,
    panelCenterZ,
    offsetX,
    offsetY
  );

  const lightDefinition = MATERIAL_LIBRARY[emissiveMaterialId];
  const lightColor = lightDefinition?.emissive ?? lightDefinition?.colors?.[0] ?? "#f0ad58";
  const light = new THREE.PointLight(lightColor, 0, Math.max(1.1, panelSize * 3.4), 2);
  light.position.set(0, 0, panelDepth + unit * 1.2);
  panel.add(light);
  group.add(panel);
  group.userData.semanticGridSign = {
    label: String(parameters.label ?? ""),
    grid: rows,
    frameMaterial: frameMaterialId,
    boardMaterial: boardMaterialId,
    emissiveMaterial: emissiveMaterialId,
    frameStyle,
    mount,
    microVoxelSize: SEMANTIC_GRID_SIGN_VOXEL_SIZE,
    buildingVoxelRatio: SEMANTIC_GRID_SIGN_VOXEL_SIZE / VOXEL_SIZE,
    renderedMicroVoxelSize: SEMANTIC_GRID_SIGN_VOXEL_SIZE,
    panelSize,
    doubleSided: true,
    facadeClearanceVoxels: facadeClearance / VOXEL_SIZE,
    projectionDepth: panelCenterZ + semanticGridSignPanelOuterHalf(),
    placement: group.userData.anchorGeometry?.placement ?? "manual-anchor-offset",
    lintelClearanceVoxels: group.userData.anchorGeometry?.lintelClearanceVoxels ?? null,
    mountingSide: group.userData.anchorGeometry?.mountingSide ?? null
  };
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return { group, light, parameters, emissiveMaterials: [emissiveMaterial] };
}

function semanticGridSignPanelMetrics() {
  const unit = SEMANTIC_GRID_SIGN_VOXEL_SIZE;
  const cellSize = unit;
  const cellGap = unit * 0.24;
  const gridSpan = cellSize * 4 + cellGap * 3;
  const panelSize = gridSpan + unit * 2.2;
  return {
    unit,
    cellSize,
    cellGap,
    gridSpan,
    panelSize,
    panelDepth: unit * 0.7
  };
}

function semanticGridSignPanelOuterHalf() {
  const { unit, panelSize } = semanticGridSignPanelMetrics();
  return panelSize / 2 + unit * 0.52 / 2;
}

function normalizeSemanticGridRows(value) {
  const rows = Array.isArray(value) ? value.map((row) => String(row).replace(/\s+/g, "")) : [];
  if (rows.length !== 4 || rows.some((row) => !/^[01.#]{4}$/.test(row))) {
    throw new Error("semantic_grid_sign grid must contain four 4-cell rows using 0/1 or ./#");
  }
  return rows.map((row) => row.replace(/[.#]/g, (cell) => cell === "#" ? "1" : "0"));
}

function semanticSignMaterialId(value, allowed, fallback) {
  const materialId = String(value ?? fallback);
  return allowed.includes(materialId) && MATERIAL_LIBRARY[materialId] ? materialId : fallback;
}

function createSemanticSignMaterial(materialId, overrides = {}) {
  const definition = MATERIAL_LIBRARY[materialId] ?? MATERIAL_LIBRARY.timber;
  const material = new THREE.MeshStandardMaterial({
    color: definition.colors?.[0] ?? "#70483d",
    roughness: definition.roughness ?? 0.86,
    metalness: definition.metalness ?? 0.03,
    transparent: Number(definition.opacity ?? 1) < 1,
    opacity: definition.opacity ?? 1,
    ...(definition.emissive ? { emissive: definition.emissive } : {}),
    emissiveIntensity: overrides.emissiveIntensity ?? definition.emissiveIntensity ?? 0
  });
  material.userData.semanticBaseEmissiveIntensity = material.emissiveIntensity;
  material.userData.materialId = materialId;
  return material;
}

function addSemanticSignRivets(panel, panelSize, z, material, materialId, unit) {
  const geometry = new THREE.SphereGeometry(unit * 0.18, 6, 4);
  const inset = panelSize * 0.43;
  [[-inset, -inset], [-inset, inset], [inset, -inset], [inset, inset]].forEach(([x, y]) => {
    [-1, 1].forEach((side) => {
      const rivet = new THREE.Mesh(geometry, material);
      rivet.position.set(x, y, side * (z + unit * 0.08));
      rivet.userData.materialId = materialId;
      panel.add(rivet);
    });
  });
}

function addSemanticSignCrown(panel, panelSize, material, materialId, unit) {
  const crown = new THREE.Mesh(new THREE.BoxGeometry(panelSize * 0.62, unit * 0.5, unit * 1.05), material);
  crown.position.set(0, panelSize / 2 + unit * 0.8, 0);
  crown.userData.materialId = materialId;
  const finial = new THREE.Mesh(new THREE.ConeGeometry(unit * 0.42, unit * 1.15, 6), material);
  finial.position.set(0, panelSize / 2 + unit * 1.62, 0);
  finial.userData.materialId = materialId;
  panel.add(crown, finial);
}

function addSemanticSignBracket(group, material, materialId, unit, panelSize, panelCenterZ, offsetX, offsetY) {
  const armLength = panelCenterZ + panelSize * 0.54;
  const armY = offsetY + panelSize / 2 + unit * 1.7;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.42, unit * 0.42, armLength), material);
  arm.position.set(offsetX, armY, armLength / 2);
  arm.userData.materialId = materialId;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(unit * 1.15, unit * 2.8, unit * 0.38), material);
  plate.position.set(offsetX, armY - unit * 0.55, unit * 0.16);
  plate.userData.materialId = materialId;
  const hangerLength = unit * 1.45;
  const hangers = [-0.28, 0.28].map((ratio) => {
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(unit * 0.28, hangerLength, unit * 0.28), material);
    hanger.position.set(offsetX, armY - hangerLength / 2, panelCenterZ + panelSize * ratio);
    hanger.userData.materialId = materialId;
    return hanger;
  });
  group.add(arm, plate, ...hangers);
}

function updateDesignDecorationDaylight(entry, night) {
  if (entry.light) entry.light.intensity = night * Number(entry.parameters.lightIntensity ?? 1.4);
  (entry.emissiveMaterials ?? []).forEach((material) => {
    const base = Number(material.userData.semanticBaseEmissiveIntensity ?? 0.45);
    material.emissiveIntensity = base * (0.52 + night * 0.9);
  });
}

function decorationColor(material) {
  return {
    aged_timber: "#4c382f",
    timber: "#4c382f",
    iron: "#34383d",
    limestone: "#d8d0c0",
    sandstone: "#c9b796",
    violet_magic: "#8067b8",
    teal_magic: "#5dacaa"
  }[material] ?? "#70483d";
}

export function voxelDaylightStyle(sunTime = 0.52) {
  const state = getVoxelSkyState(sunTime);
  const daylight = state.daylight;
  const moonlight = state.night;
  const goldenHour = state.twilight;
  const skyColor = state.topColor.clone().lerp(state.horizonColor, 0.36);
  const sunColor = new THREE.Color("#e17d5c")
    .lerp(new THREE.Color("#fff0c7"), daylight)
    .lerp(new THREE.Color("#b8c9ff"), moonlight * 0.34);
  return {
    sunColor,
    skyColor,
    rgbTint: new THREE.Color("#8192c5").lerp(new THREE.Color("#fff7e8"), daylight),
    rgbStrength: 0.68 + daylight * 0.39,
    ambientSky: new THREE.Color("#202a49").lerp(new THREE.Color("#dceef2"), daylight),
    ambientGround: new THREE.Color("#202738").lerp(new THREE.Color("#99a58f"), daylight),
    ambientIntensity: 0.68 + daylight * 1.66 + goldenHour * 0.68,
    sunIntensity: 0.12 + daylight * 2.65 + goldenHour * 0.72,
    rimIntensity: 0.55 + moonlight * 0.95 + goldenHour * 0.28,
    nightFactor: state.night,
    daylightFactor: daylight,
    twilightFactor: goldenHour,
    starOpacity: state.starOpacity,
    sunPosition: new THREE.Vector3(
      -Math.cos(state.solarAngle) * 10,
      0.8 + Math.max(0, state.solarHeight) * 11.2,
      6.5
    )
  };
}

export function planPitchedRoof(options = {}) {
  const width = Math.max(4, Math.round(options.width ?? VOXEL_PARCEL.width));
  const depth = Math.max(4, Math.round(options.depth ?? VOXEL_PARCEL.depth));
  const baseY = Math.round(options.baseY ?? 0);
  const overhang = Math.max(0, Math.round(options.overhang ?? 1));
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const ridgeRatio = clamp(options.ridgeRatio ?? 0.5, 0, 1);
  const ridgeHeight = Math.max(2, Math.round(options.ridgeHeight ?? depth * 0.34));
  const backExponent = clamp(options.backExponent ?? 1, 0.5, 3);
  const frontExponent = clamp(options.frontExponent ?? 1, 0.5, 3);
  const capLeft = options.capLeft !== false;
  const capRight = options.capRight !== false;
  const crossSpan = depth + overhang * 2;
  const ridgeIndex = Math.round((crossSpan - 1) * ridgeRatio);
  const xStart = capLeft ? -overhang : 0;
  const xEnd = width - 1 + (capRight ? overhang : 0);
  const profile = [];
  const surface = [];
  const surfaceKeys = new Set();
  const endCaps = { left: [], right: [] };
  const edgeCaps = { back: [], front: [] };

  for (let index = 0; index < crossSpan; index += 1) {
    const z = index - overhang;
    const approachingRidge = index <= ridgeIndex;
    const run = approachingRidge ? ridgeIndex : crossSpan - 1 - ridgeIndex;
    const distance = approachingRidge ? index : crossSpan - 1 - index;
    const t = run === 0 ? 1 : clamp(distance / run, 0, 1);
    const exponent = approachingRidge ? backExponent : frontExponent;
    const rise = Math.round(ridgeHeight * (1 - ((1 - t) ** exponent)));
    const y = baseY + rise;
    profile.push({ z, y });
  }

  let maximumProfileStep = 0;
  profile.forEach((row, index) => {
    const previousY = profile[index - 1]?.y ?? row.y;
    const lowerY = Math.min(previousY, row.y);
    const upperY = Math.max(previousY, row.y);
    maximumProfileStep = Math.max(maximumProfileStep, upperY - lowerY);
    for (let x = xStart; x <= xEnd; x += 1) {
      for (let bridgeY = lowerY; bridgeY <= upperY; bridgeY += 1) {
        for (let layer = 0; layer < thickness; layer += 1) {
          const y = bridgeY - layer;
          const key = `${x},${y},${row.z}`;
          if (surfaceKeys.has(key)) continue;
          surfaceKeys.add(key);
          surface.push({ x, y, z: row.z });
        }
      }
    }
  });

  for (let localZ = 0; localZ < depth; localZ += 1) {
    const roofY = profile[localZ + overhang].y;
    if (capLeft) {
      for (let y = baseY; y < roofY; y += 1) endCaps.left.push({ x: 0, y, z: localZ });
    }
    if (capRight) {
      for (let y = baseY; y < roofY; y += 1) endCaps.right.push({ x: width - 1, y, z: localZ });
    }
  }
  const backRoofY = profile[overhang].y;
  const frontRoofY = profile[overhang + depth - 1].y;
  for (let x = 0; x < width; x += 1) {
    for (let y = baseY; y < backRoofY; y += 1) edgeCaps.back.push({ x, y, z: 0 });
    for (let y = baseY; y < frontRoofY; y += 1) edgeCaps.front.push({ x, y, z: depth - 1 });
  }

  return {
    width,
    depth,
    baseY,
    overhang,
    thickness,
    ridgeRatio,
    ridgeHeight,
    ridgeIndex,
    ridgeZ: ridgeIndex - overhang,
    ridgeY: baseY + ridgeHeight,
    maximumProfileStep,
    profile,
    surface,
    endCaps,
    edgeCaps
  };
}

export function planVoxelRoof(options = {}) {
  const width = Math.max(4, Math.round(options.width ?? VOXEL_PARCEL.width));
  const depth = Math.max(4, Math.round(options.depth ?? VOXEL_PARCEL.depth));
  const baseY = Math.round(options.baseY ?? 0);
  const overhang = Math.max(0, Math.round(options.overhang ?? 1));
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const ridgeRatio = clamp(options.ridgeRatio ?? 0.5, 0, 1);
  const ridgeHeight = Math.max(2, Math.round(options.ridgeHeight ?? depth * 0.34));
  const form = ROOF_FORM_IDS.includes(options.form) ? options.form : "gable_street";
  const capLeft = options.capLeft !== false;
  const capRight = options.capRight !== false;
  const fullXSpan = width + overhang * 2;
  const fullZSpan = depth + overhang * 2;
  const xStart = capLeft ? -overhang : 0;
  const xEnd = width - 1 + (capRight ? overhang : 0);
  const zStart = -overhang;
  const zEnd = depth - 1 + overhang;
  const heightField = [];
  const heightByCoordinate = new Map();

  for (let z = zStart; z <= zEnd; z += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      const xIndex = x + overhang;
      const zIndex = z + overhang;
      let rise;
      if (form === "gable_cross") {
        rise = linearTentRise(xIndex, fullXSpan, ridgeRatio, ridgeHeight);
      } else if (form === "hip") {
        const distanceToEave = Math.min(
          xIndex,
          fullXSpan - 1 - xIndex,
          zIndex,
          fullZSpan - 1 - zIndex
        );
        const maximumDistance = Math.max(1, Math.floor((Math.min(fullXSpan, fullZSpan) - 1) / 2));
        rise = Math.round(ridgeHeight * clamp(distanceToEave / maximumDistance, 0, 1));
      } else {
        rise = linearTentRise(zIndex, fullZSpan, ridgeRatio, ridgeHeight);
      }
      const cell = { x, y: baseY + rise, z };
      heightField.push(cell);
      heightByCoordinate.set(`${x},${z}`, cell.y);
    }
  }

  const surface = [];
  const surfaceKeys = new Set();
  let maximumProfileStep = 0;
  const addSurfaceColumn = (x, z, fromY, toY) => {
    for (let bridgeY = Math.min(fromY, toY); bridgeY <= Math.max(fromY, toY); bridgeY += 1) {
      for (let layer = 0; layer < thickness; layer += 1) {
        const y = bridgeY - layer;
        const key = `${x},${y},${z}`;
        if (surfaceKeys.has(key)) continue;
        surfaceKeys.add(key);
        surface.push({ x, y, z });
      }
    }
  };
  heightField.forEach((cell) => {
    addSurfaceColumn(cell.x, cell.z, cell.y, cell.y);
    const leftY = heightByCoordinate.get(`${cell.x - 1},${cell.z}`);
    const backY = heightByCoordinate.get(`${cell.x},${cell.z - 1}`);
    if (leftY != null) {
      maximumProfileStep = Math.max(maximumProfileStep, Math.abs(cell.y - leftY));
      addSurfaceColumn(cell.x, cell.z, cell.y, leftY);
    }
    if (backY != null) {
      maximumProfileStep = Math.max(maximumProfileStep, Math.abs(cell.y - backY));
      addSurfaceColumn(cell.x, cell.z, cell.y, backY);
    }
  });

  const endCaps = { left: [], right: [] };
  const edgeCaps = { back: [], front: [] };
  for (let localZ = 0; localZ < depth; localZ += 1) {
    const leftRoofY = heightByCoordinate.get(`0,${localZ}`) ?? baseY;
    const rightRoofY = heightByCoordinate.get(`${width - 1},${localZ}`) ?? baseY;
    if (capLeft) {
      for (let y = baseY; y < leftRoofY; y += 1) endCaps.left.push({ x: 0, y, z: localZ });
    }
    if (capRight) {
      for (let y = baseY; y < rightRoofY; y += 1) endCaps.right.push({ x: width - 1, y, z: localZ });
    }
  }
  for (let x = 0; x < width; x += 1) {
    const backRoofY = heightByCoordinate.get(`${x},0`) ?? baseY;
    const frontRoofY = heightByCoordinate.get(`${x},${depth - 1}`) ?? baseY;
    for (let y = baseY; y < backRoofY; y += 1) edgeCaps.back.push({ x, y, z: 0 });
    for (let y = baseY; y < frontRoofY; y += 1) edgeCaps.front.push({ x, y, z: depth - 1 });
  }

  const ridgeY = Math.max(...heightField.map((cell) => cell.y));
  const ridgeCells = heightField.filter((cell) => cell.y === ridgeY);
  const representativeRidge = ridgeCells[Math.floor(ridgeCells.length / 2)] ?? { x: 0, z: 0 };
  const profile = Array.from({ length: fullZSpan }, (_, index) => {
    const z = index - overhang;
    const row = heightField.filter((cell) => cell.z === z);
    return { z, y: Math.max(...row.map((cell) => cell.y)) };
  });

  return {
    form,
    width,
    depth,
    baseY,
    overhang,
    thickness,
    ridgeRatio,
    ridgeHeight,
    ridgeY,
    ridgeX: representativeRidge.x,
    ridgeZ: representativeRidge.z,
    maximumProfileStep,
    profile,
    heightField,
    ridgeCells,
    surface,
    endCaps,
    edgeCaps
  };
}

export class VoxelInstanceBuffer {
  constructor(seed, options = {}) {
    this.seed = seed;
    this.voxelScale = Math.max(1, Math.round(options.voxelScale ?? 1));
    this.voxelSize = VOXEL_SIZE * this.voxelScale;
    this.aggregationFactor = Math.max(1, Math.round(options.aggregationFactor ?? this.voxelScale));
    this.voxels = new Map();
    this.visibleInstances = null;
    this.instanceCount = 0;
    this.occupiedVoxelCount = 0;
    this.overwrittenVoxelCount = 0;
    this.rejectedVoxelCount = 0;
    this.culledInteriorVoxelCount = 0;
    this.renderStats = null;
  }

  addVoxel(materialId, x, y, z, shadeKey = 0, options = {}) {
    if (!MATERIAL_LIBRARY[materialId]) throw new Error(`Unknown voxel material: ${materialId}`);
    const positionX = Math.round(x);
    const positionY = Math.round(y);
    const positionZ = Math.round(z);
    const key = voxelKey(positionX, positionY, positionZ);
    const current = this.voxels.get(key);
    const priority = Number(options.priority ?? 0);
    if (current && current.priority > priority) {
      this.rejectedVoxelCount += 1;
      return false;
    }
    if (current) this.overwrittenVoxelCount += 1;
    this.voxels.set(key, {
      x: positionX,
      y: positionY,
      z: positionZ,
      materialId,
      shadeKey,
      priority,
      owner: options.owner ?? null
    });
    this.visibleInstances = null;
    this.occupiedVoxelCount = this.voxels.size;
    return true;
  }

  addBox(materialId, x, y, z, width, height, depth, shadeKey = 0, options = {}) {
    if (!MATERIAL_LIBRARY[materialId]) throw new Error(`Unknown voxel material: ${materialId}`);
    if (width <= 0 || height <= 0 || depth <= 0) return;
    const minX = Math.round(x);
    const minY = Math.round(y);
    const minZ = Math.round(z);
    const maxX = minX + Math.round(width);
    const maxY = minY + Math.round(height);
    const maxZ = minZ + Math.round(depth);
    for (let voxelY = minY; voxelY < maxY; voxelY += 1) {
      for (let voxelZ = minZ; voxelZ < maxZ; voxelZ += 1) {
        for (let voxelX = minX; voxelX < maxX; voxelX += 1) {
          this.addVoxel(materialId, voxelX, voxelY, voxelZ, shadeKey, options);
        }
      }
    }
  }

  materialCounts() {
    return Object.fromEntries([...this.getVisibleInstances()].map(([id, instances]) => [id, instances.length]));
  }

  getMaterialAt(x, y, z) {
    return this.voxels.get(voxelKey(x, y, z))?.materialId ?? null;
  }

  getVisibleInstances() {
    if (this.visibleInstances) return this.visibleInstances;
    const instances = new Map();
    let culled = 0;
    for (const voxel of this.voxels.values()) {
      const hidden = VOXEL_NEIGHBORS.every(([dx, dy, dz]) => (
        this.voxels.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))
      ));
      if (hidden) {
        culled += 1;
        continue;
      }
      if (!instances.has(voxel.materialId)) instances.set(voxel.materialId, []);
      instances.get(voxel.materialId).push(voxel);
    }
    this.visibleInstances = instances;
    this.culledInteriorVoxelCount = culled;
    this.instanceCount = [...instances.values()].reduce((total, values) => total + values.length, 0);
    return instances;
  }

  createDownsampled(factor = 2, options = {}) {
    const scale = Math.max(1, Math.round(factor));
    if (scale === 1) return this;
    const blocks = new Map();
    for (const voxel of this.voxels.values()) {
      const x = Math.floor(voxel.x / scale);
      const y = Math.floor(voxel.y / scale);
      const z = Math.floor(voxel.z / scale);
      const key = voxelKey(x, y, z);
      if (!blocks.has(key)) blocks.set(key, { x, y, z, count: 0, materials: new Map() });
      const block = blocks.get(key);
      block.count += 1;
      if (!block.materials.has(voxel.materialId)) {
        block.materials.set(voxel.materialId, {
          materialId: voxel.materialId,
          count: 0,
          maximumPriority: Number.NEGATIVE_INFINITY,
          shadeTotal: 0,
          owners: new Map()
        });
      }
      const material = block.materials.get(voxel.materialId);
      material.count += 1;
      material.maximumPriority = Math.max(material.maximumPriority, voxel.priority);
      material.shadeTotal += Number(voxel.shadeKey ?? 0);
      const owner = voxel.owner ?? null;
      material.owners.set(owner, (material.owners.get(owner) ?? 0) + 1);
    }
    const minimumOccupancy = Math.max(
      1,
      Math.round(options.minimumOccupancy ?? Math.ceil((scale * scale) / 3))
    );
    const result = new VoxelInstanceBuffer(`${this.seed}:lod-${scale}`, {
      voxelScale: this.voxelScale * scale,
      aggregationFactor: this.aggregationFactor * scale
    });
    for (const block of blocks.values()) {
      if (block.count < minimumOccupancy) continue;
      const material = [...block.materials.values()].sort((left, right) => (
        right.count - left.count
          || right.maximumPriority - left.maximumPriority
          || left.materialId.localeCompare(right.materialId)
      ))[0];
      const owner = [...material.owners.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      result.addVoxel(
        material.materialId,
        block.x,
        block.y,
        block.z,
        Math.round(material.shadeTotal / material.count),
        { priority: material.maximumPriority, owner }
      );
    }
    result.downsampleDiagnostics = {
      factor: scale,
      sourceVoxelCount: this.voxels.size,
      aggregatedVoxelCount: result.voxels.size,
      minimumOccupancy,
      materialRule: "majority count, then semantic write priority",
      coordinateRule: "floor-divided fixed world grid"
    };
    return result;
  }

  createMeshes(options = {}) {
    if (options.strategy === "greedy") return this.createGreedyMeshes(options);
    const dummy = new THREE.Object3D();
    const meshes = [...this.getVisibleInstances()].map(([materialId, instances]) => {
      const definition = MATERIAL_LIBRARY[materialId];
      const material = createVoxelMaterial(definition);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, instances.length);
      mesh.name = `VoxelMaterial-${materialId}`;
      mesh.userData.materialId = materialId;
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      instances.forEach((instance, index) => {
        const gap = 0.985;
        dummy.position.set(
          (instance.x + 0.5) * this.voxelSize,
          (instance.y + 0.5) * this.voxelSize,
          (instance.z + 0.5) * this.voxelSize
        );
        dummy.scale.set(
          this.voxelSize * gap,
          this.voxelSize * gap,
          this.voxelSize * gap
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    });
    this.renderStats = {
      strategy: "instanced-cubes",
      sourceVoxelCount: this.instanceCount,
      sourceFaceCount: this.instanceCount * 6,
      mergedQuadCount: this.instanceCount * 6,
      renderedTriangles: this.instanceCount * 12,
      chunkCount: 1,
      meshCount: meshes.length,
      aggregationFactor: this.aggregationFactor,
      voxelSize: this.voxelSize
    };
    return meshes;
  }

  createGreedyMeshes(options = {}) {
    const chunkSize = Math.max(8, Math.round(options.chunkSizeVoxels ?? 128));
    const maxMergeSpan = Math.max(1, Math.round(options.maxMergeSpanVoxels ?? 16));
    const meshes = [];
    let sourceFaceCount = 0;
    let mergedQuadCount = 0;
    let renderedTriangles = 0;
    const chunks = new Set();

    for (const [materialId, instances] of this.getVisibleInstances()) {
      const materialChunks = new Map();
      instances.forEach((voxel) => {
        const chunkX = Math.floor(voxel.x / chunkSize);
        const chunkZ = Math.floor(voxel.z / chunkSize);
        const chunkKey = (chunkX + 128) * 4096 + (chunkZ + 128);
        chunks.add(chunkKey);
        if (!materialChunks.has(chunkKey)) {
          materialChunks.set(chunkKey, {
            chunk: [chunkX, 0, chunkZ],
            sourceVoxelCount: 0,
            faces: new Map()
          });
        }
        const entry = materialChunks.get(chunkKey);
        entry.sourceVoxelCount += 1;
        GREEDY_FACE_DIRECTIONS.forEach((face) => {
          if (this.voxels.has(voxelKey(
            voxel.x + face.normal[0],
            voxel.y + face.normal[1],
            voxel.z + face.normal[2]
          ))) return;
          const plane = (face.axis === 0 ? voxel.x : face.axis === 1 ? voxel.y : voxel.z)
            + (face.normal[face.axis] > 0 ? 1 : 0);
          const u = face.uAxis === 0 ? voxel.x : face.uAxis === 1 ? voxel.y : voxel.z;
          const v = face.vAxis === 0 ? voxel.x : face.vAxis === 1 ? voxel.y : voxel.z;
          const faceKey = face.index * FACE_PLANE_STRIDE + (plane + FACE_PLANE_OFFSET);
          let faceEntry = entry.faces.get(faceKey);
          if (!faceEntry) {
            faceEntry = { face, plane, cells: new Set() };
            entry.faces.set(faceKey, faceEntry);
          }
          faceEntry.cells.add(faceCellKey(u, v));
          sourceFaceCount += 1;
        });
      });

      for (const [chunkKey, entry] of materialChunks) {
        const positions = [];
        const normals = [];
        const indices = [];
        entry.faces.forEach(({ face, plane, cells }) => {
          emitGreedyFaceRectangles({
            face,
            plane,
            cells,
            maxMergeSpan,
            positions,
            normals,
            indices,
            voxelSize: this.voxelSize
          });
        });
        if (!positions.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, createVoxelMaterial(MATERIAL_LIBRARY[materialId]));
        mesh.name = `VoxelGreedy-${materialId}-${chunkKey}`;
        mesh.userData.materialId = materialId;
        mesh.userData.voxelRenderStrategy = "greedy-chunk";
        mesh.userData.flatVoxelGeometry = true;
        mesh.userData.sourceVoxelCount = entry.sourceVoxelCount;
        mesh.userData.chunk = entry.chunk;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        meshes.push(mesh);
        const quads = indices.length / 6;
        mergedQuadCount += quads;
        renderedTriangles += quads * 2;
      }
    }
    const mergedMeshes = mergeOpaqueGreedyMeshes(meshes);
    this.renderStats = {
      strategy: "greedy-chunks",
      sourceVoxelCount: this.instanceCount,
      sourceFaceCount,
      mergedQuadCount,
      renderedTriangles,
      chunkCount: chunks.size,
      meshCount: mergedMeshes.length,
      chunkSizeVoxels: chunkSize,
      maxMergeSpanVoxels: maxMergeSpan,
      aggregationFactor: this.aggregationFactor,
      voxelSize: this.voxelSize
    };
    return mergedMeshes;
  }
}

const GREEDY_FACE_DIRECTIONS = Object.freeze([
  Object.freeze({ id: "px", index: 0, axis: 0, uAxis: 1, vAxis: 2, normal: [1, 0, 0] }),
  Object.freeze({ id: "nx", index: 1, axis: 0, uAxis: 2, vAxis: 1, normal: [-1, 0, 0] }),
  Object.freeze({ id: "py", index: 2, axis: 1, uAxis: 2, vAxis: 0, normal: [0, 1, 0] }),
  Object.freeze({ id: "ny", index: 3, axis: 1, uAxis: 0, vAxis: 2, normal: [0, -1, 0] }),
  Object.freeze({ id: "pz", index: 4, axis: 2, uAxis: 0, vAxis: 1, normal: [0, 0, 1] }),
  Object.freeze({ id: "nz", index: 5, axis: 2, uAxis: 1, vAxis: 0, normal: [0, 0, -1] })
]);

function emitGreedyFaceRectangles({ face, plane, cells, maxMergeSpan, positions, normals, indices, voxelSize }) {
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  cells.forEach((key) => {
    const u = Math.floor(key / FACE_CELL_STRIDE) - VOXEL_KEY_OFFSET;
    const v = (key % FACE_CELL_STRIDE) - VOXEL_KEY_OFFSET;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  });
  for (let startV = minV; startV <= maxV; startV += 1) {
    for (let startU = minU; startU <= maxU; startU += 1) {
      if (!cells.has(faceCellKey(startU, startV))) continue;
      let width = 1;
      while (width < maxMergeSpan && cells.has(faceCellKey(startU + width, startV))) width += 1;
      let height = 1;
      heightLoop: while (height < maxMergeSpan) {
        for (let offset = 0; offset < width; offset += 1) {
          if (!cells.has(faceCellKey(startU + offset, startV + height))) break heightLoop;
        }
        height += 1;
      }
      for (let v = 0; v < height; v += 1) {
        for (let u = 0; u < width; u += 1) cells.delete(faceCellKey(startU + u, startV + v));
      }
      appendVoxelFaceQuad({
        face,
        plane,
        u: startU,
        v: startV,
        width,
        height,
        positions,
        normals,
        indices,
        voxelSize
      });
    }
  }
}

function appendVoxelFaceQuad({ face, plane, u, v, width, height, positions, normals, indices, voxelSize = VOXEL_SIZE }) {
  const base = positions.length / 3;
  const corners = [
    [u, v],
    [u + width, v],
    [u + width, v + height],
    [u, v + height]
  ];
  corners.forEach(([cornerU, cornerV]) => {
    const point = [0, 0, 0];
    point[face.axis] = plane;
    point[face.uAxis] = cornerU;
    point[face.vAxis] = cornerV;
    positions.push(point[0] * voxelSize, point[1] * voxelSize, point[2] * voxelSize);
    normals.push(...face.normal);
  });
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const VOXEL_DIRECT_SPECULAR = "reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );";
const VOXEL_INDIRECT_SPECULAR = "#define RE_IndirectSpecular\t\tRE_IndirectSpecular_Physical";
const VOXEL_DIFFUSE_LIGHTING_CHUNK = THREE.ShaderChunk.lights_physical_pars_fragment
  .replace(VOXEL_DIRECT_SPECULAR, "// Voxel diffuse shader: rough opaque surfaces omit direct GGX specular.")
  .replace(VOXEL_INDIRECT_SPECULAR, "// Voxel diffuse shader: no indirect specular path.");

class VoxelDiffuseMaterial extends THREE.MeshStandardMaterial {
  constructor(parameters = {}) {
    super(parameters);
    this.name = "VoxelDiffuseMaterial";
    this.userData.voxelShader = "diffuse";
    this.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_physical_pars_fragment>",
        VOXEL_DIFFUSE_LIGHTING_CHUNK
      );
    };
  }

  customProgramCacheKey() {
    return "voxel-diffuse-v1";
  }
}

function createVoxelMaterial(definition) {
  const parameters = {
    color: definition.colors[0],
    roughness: definition.roughness,
    metalness: definition.metalness ?? 0,
    emissive: definition.emissive ?? "#000000",
    emissiveIntensity: definition.emissiveIntensity ?? 0,
    transparent: Number(definition.opacity ?? 1) < 1,
    opacity: definition.opacity ?? 1,
    flatShading: true
  };
  if (!supportsDiffuseVoxelShader(definition)) return new THREE.MeshStandardMaterial(parameters);
  if (voxelMaterialMode === "diffuse") return new VoxelDiffuseMaterial(parameters);
  return new THREE.MeshStandardMaterial(parameters);
}

function supportsDiffuseVoxelShader(definition) {
  return voxelMaterialMode !== "standard"
    && Number(definition.opacity ?? 1) >= 1
    && Number(definition.metalness ?? 0) <= 0.05
    && Number(definition.roughness ?? 1) >= 0.8
    && !definition.emissive;
}

function createOpaquePaletteMaterial() {
  const parameters = {
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.02,
    flatShading: true
  };
  if (voxelMaterialMode === "diffuse") return new VoxelDiffuseMaterial(parameters);
  return new THREE.MeshStandardMaterial(parameters);
}

function mergeOpaqueGreedyMeshes(meshes) {
  const opaqueByChunk = new Map();
  const retained = [];
  meshes.forEach((mesh) => {
    const definition = MATERIAL_LIBRARY[mesh.userData.materialId];
    const opaque = Number(definition.opacity ?? 1) >= 1 && !definition.emissive;
    if (!opaque) {
      retained.push(mesh);
      return;
    }
    const chunkKey = mesh.userData.chunk.join(":");
    if (!opaqueByChunk.has(chunkKey)) opaqueByChunk.set(chunkKey, []);
    opaqueByChunk.get(chunkKey).push(mesh);
  });
  opaqueByChunk.forEach((chunkMeshes, chunkKey) => {
    const sourceVoxelCount = chunkMeshes.reduce((total, mesh) => total + mesh.userData.sourceVoxelCount, 0);
    const geometries = chunkMeshes.map((mesh) => {
      const geometry = mesh.geometry;
      const color = new THREE.Color(MATERIAL_LIBRARY[mesh.userData.materialId].colors[0]);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let index = 0; index < geometry.attributes.position.count; index += 1) {
        colors[index * 3] = color.r;
        colors[index * 3 + 1] = color.g;
        colors[index * 3 + 2] = color.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    if (!geometry) {
      retained.push(...chunkMeshes);
      return;
    }
    chunkMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    geometry.computeBoundingSphere();
    const material = createOpaquePaletteMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `VoxelGreedy-Opaque-${chunkKey}`;
    mesh.userData.materialId = "opaquePalette";
    mesh.userData.voxelRenderStrategy = "greedy-chunk";
    mesh.userData.flatVoxelGeometry = true;
    mesh.userData.sourceVoxelCount = sourceVoxelCount;
    mesh.userData.chunk = chunkMeshes[0].userData.chunk;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    retained.push(mesh);
  });
  return retained;
}

function addMassingSiteBase(buffer, spec, origin) {
  const write = { priority: VOXEL_WRITE_PRIORITIES.terrain, owner: `${spec.id}:site` };
  spec.footprint.cells.forEach((cell, index) => {
    const material = cell.use === "reserved" ? "limestone" : "pavement";
    buffer.addBox(
      material,
      origin.x + cell.x * MASSING_CELL_VOXELS,
      -2,
      origin.z + cell.z * MASSING_CELL_VOXELS,
      MASSING_CELL_VOXELS,
      2,
      MASSING_CELL_VOXELS,
      index,
      write
    );
  });
}

function addMassingNode(buffer, spec, mass, origin, relationCuts, plannedBase, occluders = []) {
  const basePlan = plannedBase ?? planMassingBase(mass, origin);
  const baseBounds = massingPlanBounds(basePlan);
  const insetPlans = new Map([[0, basePlan]]);
  const planAtY = (localY) => {
    const inset = massingInsetAtY(mass, localY);
    if (!insetPlans.has(inset)) insetPlans.set(inset, erodeMassingPlan(basePlan, inset));
    const plan = insetPlans.get(inset);
    return new Set([...plan].filter((key) => {
      const [x, z] = parseMassingPoint(key);
      return !mass.voids.some((voidSpec) => massingVoidContains(voidSpec, x, localY, z, baseBounds));
    }));
  };
  const structureWrite = {
    priority: VOXEL_WRITE_PRIORITIES.structure,
    owner: `${spec.id}:${mass.id}:structure`
  };
  const facadeFeatures = mass.type === "solid"
    ? planMassingFacadeFeatures(mass, planAtY)
    : [];
  let previousPlan = new Set();
  let maximumPlanSize = 0;
  let autoOccludedFaceVoxels = 0;
  for (let localY = 0; localY < mass.heightVoxels; localY += 1) {
    const currentPlan = planAtY(localY);
    const nextPlan = localY + 1 < mass.heightVoxels ? planAtY(localY + 1) : new Set();
    maximumPlanSize = Math.max(maximumPlanSize, currentPlan.size);
    for (const key of currentPlan) {
      const [x, z] = parseMassingPoint(key);
      const boundaryFaces = massingBoundaryFaces(currentPlan, x, z);
      const visibleBoundaryFaces = mass.type === "open"
        ? boundaryFaces.filter((face) => {
            const occluded = massingOpenFaceAutoOccluded(
              mass,
              face,
              x,
              mass.baseYVoxels + localY,
              z,
              occluders
            );
            if (occluded) autoOccludedFaceVoxels += 1;
            return !occluded;
          })
        : boundaryFaces;
      const topSurface = !nextPlan.has(key);
      const newlyExposedFloor = localY > 0 && !previousPlan.has(key);
      if (!visibleBoundaryFaces.length && !topSurface && !newlyExposedFloor) continue;
      if (relationCuts.some((cut) => massingRelationCutsVoxel(cut, x, mass.baseYVoxels + localY, z))) {
        continue;
      }
      const material = massingSurfaceMaterial(
        mass,
        visibleBoundaryFaces,
        x,
        localY,
        z,
        baseBounds,
        topSurface,
        facadeFeatures
      );
      if (!material) continue;
      buffer.addVoxel(
        material,
        x,
        mass.baseYVoxels + localY,
        z,
        hashNumber(spec.seed, mass.id, x, localY, z),
        structureWrite
      );
    }
    previousPlan = currentPlan;
  }
  if (facadeFeatures.length) {
    addMassingFacadeRelief(buffer, spec, mass, facadeFeatures, relationCuts);
  }
  const architecturalDetail = mass.type === "solid"
    ? addMassingArchitecturalDetail(buffer, spec, mass, planAtY)
    : { voxels: 0, bands: 0, cornerPiers: 0, pedimentVoxels: 0, ornaments: 0 };
  const framedReliefVoxels = mass.type === "framed"
    ? addMassingFramedRelief(buffer, spec, mass, planAtY, relationCuts, occluders)
    : 0;
  const greenhouseDetailVoxels = mass.type === "framed"
    && mass.cap.type === "glass_barrel"
    ? addMassingGreenhouseEndDetail(buffer, spec, mass, basePlan)
    : 0;
  const arcadeReliefVoxels = mass.type === "open"
    ? addMassingArcadeRelief(buffer, spec, mass, planAtY(0), occluders)
    : 0;
  return {
    mass,
    basePlan,
    topPlan: planAtY(Math.max(0, mass.heightVoxels - 1)),
    diagnostics: {
      id: mass.id,
      type: mass.type,
      basePlanVoxels: basePlan.size,
      maximumLayerVoxels: maximumPlanSize,
      heightVoxels: mass.heightVoxels,
      baseYVoxels: mass.baseYVoxels,
      baseBounds: { ...baseBounds },
      placement: structuredClone(mass.placement),
      enclosure: structuredClone(mass.enclosure),
      framing: structuredClone(mass.framing),
      groundTreatment: structuredClone(mass.groundTreatment),
      autoOccludedFaceVoxels,
      framedReliefVoxels,
      greenhouseDetailVoxels,
      arcadeReliefVoxels,
      architecturalDetail,
      facadeFeatures: facadeFeatures.map((feature) => ({ ...feature })),
      facadeFeatureCount: facadeFeatures.length,
      windowCount: facadeFeatures.filter((feature) => feature.type === "window").length,
      doorCount: facadeFeatures.filter((feature) => feature.type === "door").length
    }
  };
}

function planMassingBase(mass, origin) {
  const rawPlan = new Set();
  const cellBounds = {
    minX: origin.x + Math.min(...mass.cells.map((cell) => cell.x)) * MASSING_CELL_VOXELS,
    maxX: origin.x + (Math.max(...mass.cells.map((cell) => cell.x)) + 1) * MASSING_CELL_VOXELS - 1,
    minZ: origin.z + Math.min(...mass.cells.map((cell) => cell.z)) * MASSING_CELL_VOXELS,
    maxZ: origin.z + (Math.max(...mass.cells.map((cell) => cell.z)) + 1) * MASSING_CELL_VOXELS - 1
  };
  if (mass.dimensionsVoxels && mass.cells.length === 1) {
    const centerX = Math.round((cellBounds.minX + cellBounds.maxX) / 2);
    const centerZ = Math.round((cellBounds.minZ + cellBounds.maxZ) / 2);
    const minX = centerX - Math.floor(mass.dimensionsVoxels.width / 2);
    const minZ = centerZ - Math.floor(mass.dimensionsVoxels.depth / 2);
    for (let z = minZ; z < minZ + mass.dimensionsVoxels.depth; z += 1) {
      for (let x = minX; x < minX + mass.dimensionsVoxels.width; x += 1) {
        rawPlan.add(massingPointKey(x, z));
      }
    }
  } else {
    mass.cells.forEach((cell) => {
      const startX = origin.x + cell.x * MASSING_CELL_VOXELS;
      const startZ = origin.z + cell.z * MASSING_CELL_VOXELS;
      for (let z = startZ; z < startZ + MASSING_CELL_VOXELS; z += 1) {
        for (let x = startX; x < startX + MASSING_CELL_VOXELS; x += 1) {
          rawPlan.add(massingPointKey(x, z));
        }
      }
    });
  }
  const placement = mass.placement ?? {
    setbacksVoxels: { north: 0, east: 0, south: 0, west: 0 },
    offsetVoxels: { x: 0, z: 0 }
  };
  const setbackPlan = mass.dimensionsVoxels
    ? rawPlan
    : new Set([...rawPlan].filter((key) => {
        const [x, z] = parseMassingPoint(key);
        return x >= cellBounds.minX + placement.setbacksVoxels.west
          && x <= cellBounds.maxX - placement.setbacksVoxels.east
          && z >= cellBounds.minZ + placement.setbacksVoxels.north
          && z <= cellBounds.maxZ - placement.setbacksVoxels.south;
      }));
  const positionedPlan = new Set([...setbackPlan].map((key) => {
    const [x, z] = parseMassingPoint(key);
    return massingPointKey(
      x + placement.offsetVoxels.x,
      z + placement.offsetVoxels.z
    );
  }));
  const bounds = massingPlanBounds(positionedPlan);
  return new Set([...positionedPlan].filter((key) => {
    const [x, z] = parseMassingPoint(key);
    return massingPlanShapeContains(mass.planShape, mass.orientation, x, z, bounds);
  }));
}

function massingOpenFaceAutoOccluded(mass, face, x, y, z, occluders) {
  if (mass.enclosure.sides[face] !== "auto") return false;
  const [dx, dz] = face === "north"
    ? [0, -1]
    : face === "east"
      ? [1, 0]
      : face === "south"
        ? [0, 1]
        : [-1, 0];
  return occluders.some(({ mass: candidate, plan }) => (
    y >= candidate.baseYVoxels
    && y < candidate.baseYVoxels + candidate.heightVoxels
    && plan.has(massingPointKey(x + dx, z + dz))
  ));
}

function massingPlanShapeContains(shape, orientation, x, z, bounds) {
  if (shape === "rectangular") return true;
  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  if (shape === "chamfered" || shape === "octagonal") {
    const trim = Math.max(2, Math.round(Math.min(width, depth) * (shape === "octagonal" ? 0.22 : 0.1)));
    const left = x - bounds.minX;
    const right = bounds.maxX - x;
    const back = z - bounds.minZ;
    const front = bounds.maxZ - z;
    return left + back >= trim
      && right + back >= trim
      && left + front >= trim
      && right + front >= trim;
  }
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  if (orientation === "north" || orientation === "south") {
    const radiusX = Math.max(1, width / 2);
    const splitZ = orientation === "south"
      ? bounds.minZ + depth / 2
      : bounds.maxZ - depth / 2;
    const rectangularHalf = orientation === "south" ? z <= splitZ : z >= splitZ;
    if (rectangularHalf) return true;
    return ((x - centerX) / radiusX) ** 2 + ((z - splitZ) / Math.max(1, depth / 2)) ** 2 <= 1;
  }
  const radiusZ = Math.max(1, depth / 2);
  const splitX = orientation === "east"
    ? bounds.minX + width / 2
    : bounds.maxX - width / 2;
  const rectangularHalf = orientation === "east" ? x <= splitX : x >= splitX;
  if (rectangularHalf) return true;
  return ((z - centerZ) / radiusZ) ** 2 + ((x - splitX) / Math.max(1, width / 2)) ** 2 <= 1;
}

function massingInsetAtY(mass, localY) {
  if (mass.profile.type === "uniform") return 0;
  if (mass.profile.type === "stacked") {
    let bandStart = 0;
    for (const band of mass.profile.bands) {
      if (localY < bandStart + band.heightVoxels) return band.insetVoxels;
      bandStart += band.heightVoxels;
    }
    return mass.profile.bands.at(-1)?.insetVoxels ?? 0;
  }
  const steps = Math.floor(localY / mass.profile.stepHeightVoxels);
  return Math.min(mass.profile.maxInsetVoxels, steps * mass.profile.stepVoxels);
}

function erodeMassingPlan(source, steps) {
  let plan = new Set(source);
  for (let step = 0; step < steps && plan.size; step += 1) {
    plan = new Set([...plan].filter((key) => {
      const [x, z] = parseMassingPoint(key);
      return [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .every(([dx, dz]) => plan.has(massingPointKey(x + dx, z + dz)));
    }));
  }
  return plan;
}

function massingVoidContains(voidSpec, x, localY, z, bounds) {
  if (voidSpec.type === "courtyard") {
    return x >= bounds.minX + voidSpec.marginVoxels
      && x <= bounds.maxX - voidSpec.marginVoxels
      && z >= bounds.minZ + voidSpec.marginVoxels
      && z <= bounds.maxZ - voidSpec.marginVoxels;
  }
  if (localY >= voidSpec.heightVoxels) return false;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const northSouth = voidSpec.direction === "north" || voidSpec.direction === "south";
  const across = northSouth ? Math.abs(x - centerX) : Math.abs(z - centerZ);
  if (across > voidSpec.widthVoxels / 2) return false;
  const reachesDepth = directionalDepthContains(voidSpec, x, z, bounds);
  if (!reachesDepth) return false;
  if (voidSpec.type !== "arch") return true;
  const radius = Math.max(1, voidSpec.widthVoxels / 2);
  const straightHeight = Math.max(2, voidSpec.heightVoxels - radius);
  const archTop = straightHeight + Math.sqrt(Math.max(0, radius ** 2 - across ** 2));
  return localY <= archTop;
}

function directionalDepthContains(voidSpec, x, z, bounds) {
  if (voidSpec.type === "passage") return true;
  if (voidSpec.direction === "north") return z <= bounds.minZ + voidSpec.depthVoxels;
  if (voidSpec.direction === "south") return z >= bounds.maxZ - voidSpec.depthVoxels;
  if (voidSpec.direction === "west") return x <= bounds.minX + voidSpec.depthVoxels;
  return x >= bounds.maxX - voidSpec.depthVoxels;
}

function planMassingFacadeFeatures(mass, planAtY) {
  const features = [];
  const floorHeight = mass.facade.floorHeightVoxels;
  const floorCount = Math.ceil(mass.heightVoxels / floorHeight);
  for (let floor = 0; floor < floorCount; floor += 1) {
    const floorBaseY = floor * floorHeight;
    const sampleY = Math.min(mass.heightVoxels - 1, floorBaseY + Math.min(6, floorHeight - 1));
    const plan = planAtY(sampleY);
    if (!plan.size) continue;
    const bounds = massingPlanBounds(plan);
    const floorFeatures = [];
    for (const face of ["north", "east", "south", "west"]) {
      const runs = principalMassingFacadeRuns(plan, bounds, face);
      for (const run of runs) {
        const bays = distributeMassingFacadeBays(run.start, run.end, mass.facade.bayWidthVoxels);
        for (const bay of bays) {
          const maximumOpeningWidth = Math.max(2, bay.width - 2);
          const tierScale = floor === 0
            ? 1.08
            : floor === floorCount - 1 && floorCount > 1
              ? 0.78
              : 0.92;
          const openingWidth = Math.max(
            2,
            Math.min(
              maximumOpeningWidth,
              Math.round(maximumOpeningWidth * mass.facade.openness * tierScale)
            )
          );
          const alongStart = bay.start + Math.floor((bay.width - openingWidth) / 2);
          const compactFloor = floorHeight <= 12;
          const tierInset = floor === 0
            ? (compactFloor ? 2 : 4)
            : floor === floorCount - 1 && floorCount > 1
              ? (compactFloor ? 4 : 7)
              : (compactFloor ? 3 : 6);
          const yStart = floorBaseY + tierInset;
          const yEnd = Math.min(
            mass.heightVoxels - 2,
            floorBaseY + floorHeight - (
              floor === 0
                ? (compactFloor ? 2 : 3)
                : floor === floorCount - 1 && floorCount > 1
                  ? (compactFloor ? 3 : 6)
                  : (compactFloor ? 2 : 5)
            )
          );
          if (yEnd < yStart) continue;
          floorFeatures.push({
            type: "window",
            face,
            plane: run.plane,
            alongStart,
            alongEnd: alongStart + openingWidth - 1,
            yStart,
            yEnd,
            bayStart: bay.start,
            bayEnd: bay.end,
            bayCenter: bay.center,
            runStart: run.start,
            runEnd: run.end,
            floorTier: floor === 0 ? "ground" : floor === floorCount - 1 ? "top" : "middle"
          });
        }
      }
    }
    if (floor === 0 && mass.facade.entranceEmphasis > 0.05) {
      const entranceCandidates = floorFeatures.filter((feature) => feature.face === mass.facade.entranceFace);
      if (entranceCandidates.length) {
        const faceCenter = mass.facade.entranceFace === "north" || mass.facade.entranceFace === "south"
          ? (bounds.minX + bounds.maxX) / 2
          : (bounds.minZ + bounds.maxZ) / 2;
        const entrance = entranceCandidates.reduce((nearest, candidate) => (
          Math.abs(candidate.bayCenter - faceCenter) < Math.abs(nearest.bayCenter - faceCenter)
            ? candidate
            : nearest
        ));
        const maximumDoorWidth = Math.max(
          4,
          entrance.runEnd - entrance.runStart - 5
        );
        const doorWidth = Math.min(
          maximumDoorWidth,
          8 + Math.round(mass.facade.entranceEmphasis * 4)
        );
        entrance.type = "door";
        entrance.alongStart = Math.round(entrance.bayCenter - doorWidth / 2);
        entrance.alongEnd = entrance.alongStart + doorWidth - 1;
        entrance.yStart = 1;
        const entranceHeight = mass.facade.order === "classical"
          && mass.facade.entranceEmphasis >= 0.8
          ? mass.facade.floorHeightVoxels + 4
          : 14;
        entrance.yEnd = Math.min(entranceHeight, mass.heightVoxels - 2);
      }
    }
    features.push(...floorFeatures);
  }
  return features.map(({
    bayStart,
    bayEnd,
    bayCenter,
    runStart,
    runEnd,
    ...feature
  }) => feature);
}

function principalMassingFacadeRuns(plan, bounds, face) {
  const points = [...plan].map(parseMassingPoint);
  const alongValues = points
    .filter(([x, z]) => {
      if (face === "north") return z === bounds.minZ && !plan.has(massingPointKey(x, z - 1));
      if (face === "south") return z === bounds.maxZ && !plan.has(massingPointKey(x, z + 1));
      if (face === "west") return x === bounds.minX && !plan.has(massingPointKey(x - 1, z));
      return x === bounds.maxX && !plan.has(massingPointKey(x + 1, z));
    })
    .map(([x, z]) => (face === "north" || face === "south" ? x : z))
    .sort((left, right) => left - right);
  if (!alongValues.length) return [];
  const plane = face === "north"
    ? bounds.minZ
    : face === "south"
      ? bounds.maxZ
      : face === "west"
        ? bounds.minX
        : bounds.maxX;
  const runs = [];
  let start = alongValues[0];
  let previous = alongValues[0];
  for (const value of alongValues.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    runs.push({ face, plane, start, end: previous });
    start = value;
    previous = value;
  }
  runs.push({ face, plane, start, end: previous });
  return runs.filter((run) => run.end - run.start + 1 >= 6);
}

function distributeMassingFacadeBays(start, end, preferredWidth) {
  const span = end - start + 1;
  const margin = span < 10 ? 1 : 3;
  const usableStart = start + margin;
  const usableEnd = end - margin;
  const usableWidth = usableEnd - usableStart + 1;
  if (usableWidth < 4) return [];
  const count = Math.max(1, Math.floor(usableWidth / preferredWidth));
  const baseWidth = Math.floor(usableWidth / count);
  const remainder = usableWidth % count;
  let cursor = usableStart;
  return Array.from({ length: count }, (_, index) => {
    const width = baseWidth + (index < remainder ? 1 : 0);
    const bay = {
      start: cursor,
      end: cursor + width - 1,
      width,
      center: cursor + (width - 1) / 2
    };
    cursor += width;
    return bay;
  });
}

function addMassingFacadeRelief(buffer, spec, mass, features, relationCuts) {
  const openingWrite = {
    priority: VOXEL_WRITE_PRIORITIES.opening,
    owner: `${spec.id}:${mass.id}:facade-opening`
  };
  const trimWrite = {
    priority: VOXEL_WRITE_PRIORITIES.trim,
    owner: `${spec.id}:${mass.id}:facade-trim`
  };
  const decorationWrite = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${spec.id}:${mass.id}:facade-decoration`
  };
  features.forEach((feature) => {
    const centerAlong = Math.round((feature.alongStart + feature.alongEnd) / 2);
    const centerY = mass.baseYVoxels + Math.round((feature.yStart + feature.yEnd) / 2);
    const centerX = feature.face === "north" || feature.face === "south" ? centerAlong : feature.plane;
    const centerZ = feature.face === "north" || feature.face === "south" ? feature.plane : centerAlong;
    if (relationCuts.some((cut) => massingRelationCutsVoxel(cut, centerX, centerY, centerZ))) return;
    addMassingFacadeFeature(
      buffer,
      mass,
      feature,
      hashNumber(spec.seed, mass.id, feature.face, feature.alongStart, feature.yStart),
      openingWrite,
      trimWrite,
      decorationWrite
    );
  });
}

function addMassingArchitecturalDetail(buffer, spec, mass, planAtY) {
  const facade = mass.facade;
  if (facade.order === "plain") {
    const accentVoxels = addMassingFacadeAccent(buffer, spec, mass, planAtY);
    return {
      voxels: accentVoxels,
      bands: 0,
      cornerPiers: 0,
      pedimentVoxels: 0,
      ornaments: 0,
      accentVoxels
    };
  }
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${spec.id}:${mass.id}:architectural-order`
  };
  let voxels = 0;
  let bands = 0;
  let cornerPiers = 0;

  if (facade.baseCourseHeightVoxels > 0) {
    voxels += addProjectedMassingBand(
      buffer,
      mass,
      planAtY(0),
      mass.baseYVoxels,
      facade.baseCourseHeightVoxels,
      1,
      "base-course",
      write
    );
    bands += 1;
  }

  if (facade.stringCourseHeightVoxels > 0) {
    for (
      let localY = facade.floorHeightVoxels;
      localY < mass.heightVoxels - facade.corniceHeightVoxels;
      localY += facade.floorHeightVoxels
    ) {
      voxels += addProjectedMassingBand(
        buffer,
        mass,
        planAtY(Math.min(mass.heightVoxels - 1, localY)),
        mass.baseYVoxels + localY - 1,
        facade.stringCourseHeightVoxels,
        1,
        `string-course-${localY}`,
        write
      );
      bands += 1;
    }
  }

  if (facade.corniceHeightVoxels > 0) {
    const corniceLocalY = Math.max(0, mass.heightVoxels - facade.corniceHeightVoxels);
    voxels += addProjectedMassingBand(
      buffer,
      mass,
      planAtY(corniceLocalY),
      mass.baseYVoxels + corniceLocalY,
      facade.corniceHeightVoxels,
      facade.order === "classical" ? 2 : 1,
      "cornice",
      write
    );
    bands += 1;
  }

  if (facade.cornerPierWidthVoxels > 0) {
    const pierResult = addMassingCornerPiers(buffer, spec, mass, planAtY(0), write);
    voxels += pierResult.voxels;
    cornerPiers = pierResult.count;
  }

  const pedimentVoxels = facade.pedimentHeightVoxels > 0
    ? addMassingEntrancePediment(buffer, spec, mass, planAtY(mass.heightVoxels - 1), write)
    : 0;
  voxels += pedimentVoxels;

  const accentVoxels = addMassingFacadeAccent(buffer, spec, mass, planAtY);
  voxels += accentVoxels;

  return {
    voxels,
    bands,
    cornerPiers,
    pedimentVoxels,
    ornaments: 0,
    accentVoxels
  };
}

function addProjectedMassingBand(
  buffer,
  mass,
  plan,
  yStart,
  height,
  projection,
  label,
  write
) {
  if (!plan.size || height <= 0) return 0;
  const coordinates = new Set();
  for (const key of plan) {
    const [x, z] = parseMassingPoint(key);
    for (const face of massingBoundaryFaces(plan, x, z)) {
      const [dx, dz] = massingFaceOffset(face);
      for (let depth = 1; depth <= projection; depth += 1) {
        for (let y = yStart; y < yStart + height; y += 1) {
          coordinates.add(`${x + dx * depth},${y},${z + dz * depth}`);
        }
      }
    }
  }
  coordinates.forEach((coordinate) => {
    const [x, y, z] = coordinate.split(",").map(Number);
    buffer.addVoxel(
      mass.materials.trim,
      x,
      y,
      z,
      hashNumber(mass.id, label, x, y, z),
      write
    );
  });
  return coordinates.size;
}

function addMassingCornerPiers(buffer, spec, mass, plan, write) {
  if (!plan.size) return { voxels: 0, count: 0 };
  const bounds = massingPlanBounds(plan);
  const width = mass.facade.cornerPierWidthVoxels;
  const startY = mass.baseYVoxels + mass.facade.baseCourseHeightVoxels;
  const height = Math.max(
    0,
    mass.heightVoxels
      - mass.facade.baseCourseHeightVoxels
      - mass.facade.corniceHeightVoxels
  );
  const coordinates = new Set();
  let count = 0;

  for (const face of ["north", "east", "south", "west"]) {
    for (const run of principalMassingFacadeRuns(plan, bounds, face)) {
      const pierRanges = [
        [run.start, Math.min(run.end, run.start + width - 1)],
        [Math.max(run.start, run.end - width + 1), run.end]
      ];
      for (const [start, end] of pierRanges) {
        count += 1;
        for (let along = start; along <= end; along += 1) {
          for (let y = startY; y < startY + height; y += 1) {
            const [x, z] = massingFacadeCoordinate(face, run.plane, along, 1);
            coordinates.add(`${x},${y},${z}`);
          }
        }
      }
    }
  }

  coordinates.forEach((coordinate) => {
    const [x, y, z] = coordinate.split(",").map(Number);
    buffer.addVoxel(
      mass.materials.trim,
      x,
      y,
      z,
      hashNumber(spec.seed, mass.id, "corner-pier", x, y, z),
      write
    );
  });
  return { voxels: coordinates.size, count };
}

function addMassingEntrancePediment(buffer, spec, mass, plan, write) {
  if (!plan.size) return 0;
  const face = mass.facade.entranceFace;
  const bounds = massingPlanBounds(plan);
  const runs = principalMassingFacadeRuns(plan, bounds, face);
  if (!runs.length) return 0;
  const center = face === "north" || face === "south"
    ? (bounds.minX + bounds.maxX) / 2
    : (bounds.minZ + bounds.maxZ) / 2;
  const run = runs.reduce((best, candidate) => {
    const candidateCenter = (candidate.start + candidate.end) / 2;
    const bestCenter = (best.start + best.end) / 2;
    return Math.abs(candidateCenter - center) < Math.abs(bestCenter - center)
      ? candidate
      : best;
  });
  const width = Math.min(
    run.end - run.start + 1,
    Math.max(6, mass.facade.pedimentWidthVoxels)
  );
  const height = mass.facade.pedimentHeightVoxels;
  const centerAlong = Math.round((run.start + run.end) / 2);
  const coordinates = new Map();

  for (let row = 0; row < height; row += 1) {
    const rowWidth = Math.max(1, Math.round(width * (1 - row / height)));
    const rowStart = centerAlong - Math.floor(rowWidth / 2);
    const rowEnd = rowStart + rowWidth - 1;
    const y = mass.baseYVoxels + mass.heightVoxels + row;
    for (let along = rowStart; along <= rowEnd; along += 1) {
      const edge = along === rowStart || along === rowEnd || row === 0;
      const [x, z] = massingFacadeCoordinate(face, run.plane, along, edge ? 2 : 1);
      coordinates.set(`${x},${y},${z}`, edge ? mass.materials.trim : mass.materials.wall);
    }
  }

  coordinates.forEach((material, coordinate) => {
    const [x, y, z] = coordinate.split(",").map(Number);
    buffer.addVoxel(
      material,
      x,
      y,
      z,
      hashNumber(spec.seed, mass.id, "pediment", x, y, z),
      write
    );
  });
  return coordinates.size;
}

function addMassingCapRooflineOrnaments(buffer, spec, mass, activePlan, heightField) {
  if (
    mass.facade.rooflineOrnaments <= 0
    || !["flat", "gable", "hip", "mansard"].includes(mass.cap.type)
  ) return { voxels: 0, placements: [] };
  const placements = planMassingRooflineOrnaments(
    activePlan,
    heightField,
    mass.facade.rooflineOrnaments
  );
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${spec.id}:${mass.id}:roofline-ornaments`
  };
  let voxels = 0;
  placements.forEach(({ centerX, centerZ, baseY }, index) => {
    const height = 7 + (index % 2);
    buffer.addBox(
      mass.materials.wall,
      centerX - 1,
      baseY,
      centerZ - 1,
      3,
      height,
      3,
      hashNumber(spec.seed, mass.id, "chimney", index),
      write
    );
    buffer.addBox(
      mass.materials.trim,
      centerX - 2,
      baseY + height,
      centerZ - 2,
      5,
      2,
      5,
      hashNumber(spec.seed, mass.id, "chimney-cap", index),
      write
    );
    voxels += 3 * height * 3 + 5 * 2 * 5;
  });
  return { voxels, placements };
}

function planMassingRooflineOrnaments(activePlan, heightField, requestedCount) {
  const candidates = [...activePlan].map((key) => {
    const [centerX, centerZ] = parseMassingPoint(key);
    const supportKeys = [];
    for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
      for (let x = centerX - 1; x <= centerX + 1; x += 1) {
        supportKeys.push(massingPointKey(x, z));
      }
    }
    if (!supportKeys.every((supportKey) => activePlan.has(supportKey) && heightField.has(supportKey))) {
      return null;
    }
    return {
      centerX,
      centerZ,
      baseY: Math.max(...supportKeys.map((supportKey) => heightField.get(supportKey))) - 1
    };
  }).filter(Boolean);
  if (!candidates.length) return [];
  const bounds = massingPlanBounds(activePlan);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  candidates.sort((left, right) => {
    const leftDistance = (left.centerX - centerX) ** 2 + (left.centerZ - centerZ) ** 2;
    const rightDistance = (right.centerX - centerX) ** 2 + (right.centerZ - centerZ) ** 2;
    return rightDistance - leftDistance
      || left.centerZ - right.centerZ
      || left.centerX - right.centerX;
  });
  const placements = [];
  for (const candidate of candidates) {
    if (placements.some((placement) => Math.hypot(
      placement.centerX - candidate.centerX,
      placement.centerZ - candidate.centerZ
    ) < 12)) continue;
    placements.push(candidate);
    if (placements.length >= requestedCount) break;
  }
  return placements;
}

function addMassingFacadeAccent(buffer, spec, mass, planAtY) {
  const accent = mass.facade.accentWindow;
  if (accent.type !== "oculus") return 0;
  const localCenterY = Math.round((mass.heightVoxels - 1) * accent.centerYRatio);
  const plan = planAtY(localCenterY);
  if (!plan.size) return 0;
  const bounds = massingPlanBounds(plan);
  const runs = principalMassingFacadeRuns(plan, bounds, accent.face);
  if (!runs.length) return 0;
  const planCenter = accent.face === "north" || accent.face === "south"
    ? (bounds.minX + bounds.maxX) / 2
    : (bounds.minZ + bounds.maxZ) / 2;
  const run = runs.reduce((best, candidate) => (
    Math.abs((candidate.start + candidate.end) / 2 - planCenter)
      < Math.abs((best.start + best.end) / 2 - planCenter)
      ? candidate
      : best
  ));
  const centerAlong = Math.round((run.start + run.end) / 2);
  const radius = Math.floor(accent.diameterVoxels / 2);
  const innerRadius = Math.max(1, radius - 2);
  const centerY = mass.baseYVoxels + localCenterY;
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.effect,
    owner: `${spec.id}:${mass.id}:facade-accent`
  };
  let voxels = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let da = -radius; da <= radius; da += 1) {
      const distance = Math.sqrt(da ** 2 + dy ** 2);
      if (distance > radius + 0.35) continue;
      const material = distance >= innerRadius - 0.2
        ? mass.materials.trim
        : accent.material;
      for (let projection = 1; projection <= 4; projection += 1) {
        const [x, z] = massingFacadeCoordinate(
          accent.face,
          run.plane,
          centerAlong + da,
          projection
        );
        if (buffer.addVoxel(
          material,
          x,
          centerY + dy,
          z,
          hashNumber(spec.seed, mass.id, "oculus", da, dy, projection),
          write
        )) voxels += 1;
      }
    }
  }
  for (let offset = -innerRadius + 1; offset < innerRadius; offset += 1) {
    const [verticalX, verticalZ] = massingFacadeCoordinate(
      accent.face,
      run.plane,
      centerAlong,
      3
    );
    if (buffer.addVoxel(
      mass.materials.frame,
      verticalX,
      centerY + offset,
      verticalZ,
      hashNumber(spec.seed, mass.id, "oculus-vertical", offset),
      write
    )) voxels += 1;
    const [horizontalX, horizontalZ] = massingFacadeCoordinate(
      accent.face,
      run.plane,
      centerAlong + offset,
      3
    );
    if (buffer.addVoxel(
      mass.materials.frame,
      horizontalX,
      centerY,
      horizontalZ,
      hashNumber(spec.seed, mass.id, "oculus-horizontal", offset),
      write
    )) voxels += 1;
  }
  return voxels;
}

function massingFacadeCoordinate(face, plane, along, projection = 1) {
  const [dx, dz] = massingFaceOffset(face);
  return face === "north" || face === "south"
    ? [along, plane + dz * projection]
    : [plane + dx * projection, along];
}

function addMassingFacadeFeature(
  buffer,
  mass,
  feature,
  shade,
  openingWrite,
  trimWrite,
  decorationWrite
) {
  const width = feature.alongEnd - feature.alongStart + 1;
  const height = feature.yEnd - feature.yStart + 1;
  const y = mass.baseYVoxels + feature.yStart;
  const panelMaterial = feature.type === "door" ? mass.materials.door : mass.materials.window;
  const northSouth = feature.face === "north" || feature.face === "south";
  const positiveFace = feature.face === "south" || feature.face === "east";
  const recessDepth = feature.type === "door"
    ? 3 + Math.round(mass.facade.entranceEmphasis)
    : 0;
  if (northSouth) {
    const panelZ = feature.type === "door"
      ? feature.plane + (positiveFace ? -recessDepth : recessDepth)
      : feature.plane + (positiveFace ? 1 : -1);
    const frameZ = feature.plane + (positiveFace ? 1 : -2);
    const surroundZ = feature.plane + (positiveFace ? 1 : -3);
    buffer.addBox(panelMaterial, feature.alongStart, y, panelZ, width, height, 1, shade, openingWrite);
    if (feature.type === "door") {
      for (let depth = 0; depth <= recessDepth; depth += 1) {
        const tunnelZ = feature.plane + (positiveFace ? -depth : depth);
        const revealMaterial = depth <= 1 ? mass.materials.trim : "brickBrown";
        buffer.addBox(revealMaterial, feature.alongStart - 1, y - 1, tunnelZ, 1, height + 2, 1, shade + 30 + depth, trimWrite);
        buffer.addBox(revealMaterial, feature.alongEnd + 1, y - 1, tunnelZ, 1, height + 2, 1, shade + 40 + depth, trimWrite);
        buffer.addBox(revealMaterial, feature.alongStart - 1, y + height, tunnelZ, width + 2, 2, 1, shade + 50 + depth, trimWrite);
      }
    }
    buffer.addBox(mass.materials.trim, feature.alongStart - 1, y - 1, frameZ, 1, height + 2, 2, shade + 1, trimWrite);
    buffer.addBox(mass.materials.trim, feature.alongEnd + 1, y - 1, frameZ, 1, height + 2, 2, shade + 2, trimWrite);
    buffer.addBox(mass.materials.trim, feature.alongStart - 2, y - 2, surroundZ, width + 4, 2, 3, shade + 3, trimWrite);
    buffer.addBox(mass.materials.trim, feature.alongStart - 1, y + height, surroundZ, width + 2, 2, 3, shade + 4, trimWrite);
    addMassingFacadeFeatureBars(
      buffer,
      mass,
      feature,
      { x: feature.alongStart, y, z: feature.type === "door" ? panelZ : frameZ, width, height, depth: feature.type === "door" ? 1 : 2, northSouth: true },
      shade,
      openingWrite,
      trimWrite
    );
    addMassingFacadeFeatureOrnaments(
      buffer,
      mass,
      feature,
      { x: feature.alongStart, y, z: surroundZ, width, height, depth: 3, northSouth: true },
      shade,
      decorationWrite
    );
    return;
  }
  const panelX = feature.type === "door"
    ? feature.plane + (positiveFace ? -recessDepth : recessDepth)
    : feature.plane + (positiveFace ? 1 : -1);
  const frameX = feature.plane + (positiveFace ? 1 : -2);
  const surroundX = feature.plane + (positiveFace ? 1 : -3);
  buffer.addBox(panelMaterial, panelX, y, feature.alongStart, 1, height, width, shade, openingWrite);
  if (feature.type === "door") {
    for (let depth = 0; depth <= recessDepth; depth += 1) {
      const tunnelX = feature.plane + (positiveFace ? -depth : depth);
      const revealMaterial = depth <= 1 ? mass.materials.trim : "brickBrown";
      buffer.addBox(revealMaterial, tunnelX, y - 1, feature.alongStart - 1, 1, height + 2, 1, shade + 30 + depth, trimWrite);
      buffer.addBox(revealMaterial, tunnelX, y - 1, feature.alongEnd + 1, 1, height + 2, 1, shade + 40 + depth, trimWrite);
      buffer.addBox(revealMaterial, tunnelX, y + height, feature.alongStart - 1, 1, 2, width + 2, shade + 50 + depth, trimWrite);
    }
  }
  buffer.addBox(mass.materials.trim, frameX, y - 1, feature.alongStart - 1, 2, height + 2, 1, shade + 1, trimWrite);
  buffer.addBox(mass.materials.trim, frameX, y - 1, feature.alongEnd + 1, 2, height + 2, 1, shade + 2, trimWrite);
  buffer.addBox(mass.materials.trim, surroundX, y - 2, feature.alongStart - 2, 3, 2, width + 4, shade + 3, trimWrite);
  buffer.addBox(mass.materials.trim, surroundX, y + height, feature.alongStart - 1, 3, 2, width + 2, shade + 4, trimWrite);
  addMassingFacadeFeatureBars(
    buffer,
    mass,
    feature,
    { x: feature.type === "door" ? panelX : frameX, y, z: feature.alongStart, width: feature.type === "door" ? 1 : 2, height, depth: width, northSouth: false },
    shade,
    openingWrite,
    trimWrite
  );
  addMassingFacadeFeatureOrnaments(
    buffer,
    mass,
    feature,
    { x: surroundX, y, z: feature.alongStart, width: 3, height, depth: width, northSouth: false },
    shade,
    decorationWrite
  );
}

function addMassingFacadeFeatureBars(buffer, mass, feature, box, shade, openingWrite, trimWrite) {
  const alongCenter = Math.floor((feature.alongStart + feature.alongEnd) / 2);
  const centerY = box.y + Math.floor(box.height / 2);
  const sashMaterial = feature.type === "door" ? mass.materials.trim : mass.materials.frame;
  if (feature.type === "door") {
    const transomHeight = Math.min(4, box.height);
    if (box.northSouth) {
      buffer.addBox(mass.materials.window, feature.alongStart, box.y + box.height - transomHeight, box.z, feature.alongEnd - feature.alongStart + 1, transomHeight, box.depth, shade + 5, openingWrite);
      buffer.addBox(sashMaterial, alongCenter, box.y, box.z, 1, box.height, box.depth, shade + 6, trimWrite);
      buffer.addBox(sashMaterial, feature.alongStart, box.y + box.height - transomHeight - 1, box.z, feature.alongEnd - feature.alongStart + 1, 1, box.depth, shade + 7, trimWrite);
    } else {
      buffer.addBox(mass.materials.window, box.x, box.y + box.height - transomHeight, feature.alongStart, box.width, transomHeight, feature.alongEnd - feature.alongStart + 1, shade + 5, openingWrite);
      buffer.addBox(sashMaterial, box.x, box.y, alongCenter, box.width, box.height, 1, shade + 6, trimWrite);
      buffer.addBox(sashMaterial, box.x, box.y + box.height - transomHeight - 1, feature.alongStart, box.width, 1, feature.alongEnd - feature.alongStart + 1, shade + 7, trimWrite);
    }
    return;
  }
  if (box.northSouth) {
    if (box.width >= 4) buffer.addBox(sashMaterial, alongCenter, box.y, box.z, 1, box.height, box.depth, shade + 5, trimWrite);
    if (box.height >= 7) buffer.addBox(sashMaterial, feature.alongStart, centerY, box.z, feature.alongEnd - feature.alongStart + 1, 1, box.depth, shade + 6, trimWrite);
  } else {
    if (box.depth >= 4) buffer.addBox(sashMaterial, box.x, box.y, alongCenter, box.width, box.height, 1, shade + 5, trimWrite);
    if (box.height >= 7) buffer.addBox(sashMaterial, box.x, centerY, feature.alongStart, box.width, 1, feature.alongEnd - feature.alongStart + 1, shade + 6, trimWrite);
  }
}

function addMassingFacadeFeatureOrnaments(buffer, mass, feature, box, shade, write) {
  const detail = mass.facade.detailDensity;
  if (detail < 0.35) return;
  const positiveFace = feature.face === "south" || feature.face === "east";
  const alongCenter = Math.floor((feature.alongStart + feature.alongEnd) / 2);
  const openingWidth = feature.alongEnd - feature.alongStart + 1;
  if (feature.type === "door") {
    const emphasis = mass.facade.entranceEmphasis;
    const stairCount = 2 + Math.round(emphasis * 3);
    for (let step = 0; step < stairCount; step += 1) {
      const stepHeight = stairCount - step;
      const stepWidth = openingWidth + 2 + step * 2;
      if (box.northSouth) {
        const stepZ = positiveFace
          ? feature.plane + 1 + step
          : feature.plane - 1 - step;
        buffer.addBox(
          "stoneShadow",
          feature.alongStart - 1 - step,
          mass.baseYVoxels,
          stepZ,
          stepWidth,
          stepHeight,
          1,
          shade + 8 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          feature.alongStart - 1 - step,
          mass.baseYVoxels + stepHeight - 1,
          stepZ,
          stepWidth,
          1,
          2,
          shade + 80 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          feature.alongStart - 2 - step,
          mass.baseYVoxels,
          stepZ,
          1,
          stepHeight + 2,
          2,
          shade + 60 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          feature.alongEnd + 2 + step,
          mass.baseYVoxels,
          stepZ,
          1,
          stepHeight + 2,
          2,
          shade + 70 + step,
          write
        );
      } else {
        const stepX = positiveFace
          ? feature.plane + 1 + step
          : feature.plane - 1 - step;
        buffer.addBox(
          "stoneShadow",
          stepX,
          mass.baseYVoxels,
          feature.alongStart - 1 - step,
          1,
          stepHeight,
          stepWidth,
          shade + 8 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          stepX,
          mass.baseYVoxels + stepHeight - 1,
          feature.alongStart - 1 - step,
          2,
          1,
          stepWidth,
          shade + 80 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          stepX,
          mass.baseYVoxels,
          feature.alongStart - 2 - step,
          2,
          stepHeight + 2,
          1,
          shade + 60 + step,
          write
        );
        buffer.addBox(
          mass.materials.trim,
          stepX,
          mass.baseYVoxels,
          feature.alongEnd + 2 + step,
          2,
          stepHeight + 2,
          1,
          shade + 70 + step,
          write
        );
      }
    }
    const canopyY = box.y + box.height + 2;
    const canopyDepth = 3 + Math.round(emphasis * 2);
    if (box.northSouth) {
      const canopyZ = feature.plane + (positiveFace ? 1 : -canopyDepth);
      buffer.addBox(mass.materials.trim, feature.alongStart - 2, canopyY, canopyZ, openingWidth + 4, 2, canopyDepth, shade + 11, write);
      buffer.addBox(mass.materials.trim, feature.alongStart - 2, canopyY - 2, canopyZ, 1, 2, canopyDepth, shade + 12, write);
      buffer.addBox(mass.materials.trim, feature.alongEnd + 2, canopyY - 2, canopyZ, 1, 2, canopyDepth, shade + 13, write);
      if (emphasis >= 0.72) {
        const columnZ = positiveFace
          ? canopyZ + canopyDepth - 2
          : canopyZ;
        const columnHeight = Math.max(4, canopyY - mass.baseYVoxels);
        buffer.addBox(mass.materials.trim, feature.alongStart - 3, mass.baseYVoxels, columnZ, 2, columnHeight, 2, shade + 14, write);
        buffer.addBox(mass.materials.trim, feature.alongEnd + 2, mass.baseYVoxels, columnZ, 2, columnHeight, 2, shade + 15, write);
        for (let row = 0; row < 4; row += 1) {
          const pedimentWidth = openingWidth + 8 - row * 2;
          buffer.addBox(
            row === 0 ? mass.materials.trim : mass.materials.wall,
            alongCenter - Math.floor(pedimentWidth / 2),
            canopyY + 2 + row,
            columnZ,
            pedimentWidth,
            1,
            2,
            shade + 16 + row,
            write
          );
        }
        const lampZ = columnZ + (positiveFace ? 2 : -1);
        for (const lampX of [feature.alongStart - 4, feature.alongEnd + 4]) {
          buffer.addBox("patinaMetal", lampX, mass.baseYVoxels + 7, lampZ, 1, 5, 1, shade + 20 + lampX, write);
          buffer.addBox("warmWindow", lampX - 1, mass.baseYVoxels + 10, lampZ - 1, 3, 3, 3, shade + 21 + lampX, write);
        }
      }
    } else {
      const canopyX = feature.plane + (positiveFace ? 1 : -canopyDepth);
      buffer.addBox(mass.materials.trim, canopyX, canopyY, feature.alongStart - 2, canopyDepth, 2, openingWidth + 4, shade + 11, write);
      buffer.addBox(mass.materials.trim, canopyX, canopyY - 2, feature.alongStart - 2, canopyDepth, 2, 1, shade + 12, write);
      buffer.addBox(mass.materials.trim, canopyX, canopyY - 2, feature.alongEnd + 2, canopyDepth, 2, 1, shade + 13, write);
      if (emphasis >= 0.72) {
        const columnX = positiveFace
          ? canopyX + canopyDepth - 2
          : canopyX;
        const columnHeight = Math.max(4, canopyY - mass.baseYVoxels);
        buffer.addBox(mass.materials.trim, columnX, mass.baseYVoxels, feature.alongStart - 3, 2, columnHeight, 2, shade + 14, write);
        buffer.addBox(mass.materials.trim, columnX, mass.baseYVoxels, feature.alongEnd + 2, 2, columnHeight, 2, shade + 15, write);
        for (let row = 0; row < 4; row += 1) {
          const pedimentWidth = openingWidth + 8 - row * 2;
          buffer.addBox(
            row === 0 ? mass.materials.trim : mass.materials.wall,
            columnX,
            canopyY + 2 + row,
            alongCenter - Math.floor(pedimentWidth / 2),
            2,
            1,
            pedimentWidth,
            shade + 16 + row,
            write
          );
        }
        const lampX = columnX + (positiveFace ? 2 : -1);
        for (const lampZ of [feature.alongStart - 4, feature.alongEnd + 4]) {
          buffer.addBox("patinaMetal", lampX, mass.baseYVoxels + 7, lampZ, 1, 5, 1, shade + 20 + lampZ, write);
          buffer.addBox("warmWindow", lampX - 1, mass.baseYVoxels + 10, lampZ - 1, 3, 3, 3, shade + 21 + lampZ, write);
        }
      }
    }
    return;
  }
  if (
    feature.floorTier === "ground"
    && mass.facade.order === "classical"
    && detail >= 0.58
  ) {
    const radius = Math.max(1, openingWidth / 2);
    for (let along = feature.alongStart; along <= feature.alongEnd; along += 1) {
      const normalized = Math.abs((along - alongCenter) / radius);
      const rise = Math.round(3 * Math.sqrt(Math.max(0, 1 - normalized ** 2)));
      const [x, z] = massingFacadeCoordinate(feature.face, feature.plane, along, 4);
      buffer.addBox(
        mass.materials.trim,
        x,
        box.y + box.height + rise,
        z,
        1,
        2,
        1,
        shade + 90 + along,
        write
      );
    }
  } else if (mass.facade.order === "gothic" && detail >= 0.5) {
    const peakHeight = Math.max(3, Math.min(7, Math.round(openingWidth * 0.7)));
    for (let rise = 0; rise < peakHeight; rise += 1) {
      const halfWidth = Math.max(0, Math.round((peakHeight - rise) * openingWidth / (peakHeight * 2)));
      for (const along of new Set([alongCenter - halfWidth, alongCenter + halfWidth])) {
        const [x, z] = massingFacadeCoordinate(feature.face, feature.plane, along, 4);
        buffer.addBox(
          mass.materials.trim,
          x,
          box.y + box.height + rise,
          z,
          1,
          2,
          1,
          shade + 100 + rise + along,
          write
        );
      }
    }
  } else if (detail >= 0.58) {
    if (box.northSouth) {
      const crownZ = feature.plane + (positiveFace ? 1 : -4);
      buffer.addBox(mass.materials.trim, alongCenter, box.y + box.height + 1, crownZ, 1, 2, 4, shade + 14, write);
    } else {
      const crownX = feature.plane + (positiveFace ? 1 : -4);
      buffer.addBox(mass.materials.trim, crownX, box.y + box.height + 1, alongCenter, 4, 2, 1, shade + 14, write);
    }
  }
}

function addMassingFramedRelief(buffer, spec, mass, planAtY, relationCuts, occluders) {
  if (mass.framing.reliefDepthVoxels <= 0) return 0;
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.trim,
    owner: `${spec.id}:${mass.id}:framing-relief`
  };
  let voxels = 0;
  for (let localY = 0; localY < mass.heightVoxels; localY += 1) {
    const plan = planAtY(localY);
    for (const key of plan) {
      const [x, z] = parseMassingPoint(key);
      const faces = massingBoundaryFaces(plan, x, z);
      if (!faces.length || !massingFramedGridContains(mass, faces, x, localY, z)) continue;
      if (relationCuts.some((cut) => massingRelationCutsVoxel(
        cut,
        x,
        mass.baseYVoxels + localY,
        z
      ))) continue;
      faces.forEach((face) => {
        const [dx, dz] = massingFaceOffset(face);
        const worldY = mass.baseYVoxels + localY;
        const touchesAnotherMass = occluders.some(({ mass: candidate, plan: candidatePlan }) => (
          worldY >= candidate.baseYVoxels
          && worldY < candidate.baseYVoxels + candidate.heightVoxels
          && candidatePlan.has(massingPointKey(x + dx, z + dz))
        ));
        if (touchesAnotherMass) return;
        for (let depth = 1; depth <= mass.framing.reliefDepthVoxels; depth += 1) {
          const added = buffer.addVoxel(
            mass.materials.frame,
            x + dx * depth,
            worldY,
            z + dz * depth,
            hashNumber(spec.seed, mass.id, "frame-relief", face, x, localY, z, depth),
            write
          );
          if (added) voxels += 1;
        }
      });
    }
  }
  return voxels;
}

function addMassingGreenhouseEndDetail(buffer, spec, mass, plan) {
  if (!plan.size) return 0;
  const bounds = massingPlanBounds(plan);
  const northSouth = mass.cap.orientation === "north_south";
  const alongStart = northSouth ? bounds.minX : bounds.minZ;
  const alongEnd = northSouth ? bounds.maxX : bounds.maxZ;
  const endFaces = northSouth
    ? [
        { face: "north", plane: bounds.minZ },
        { face: "south", plane: bounds.maxZ }
      ]
    : [
        { face: "west", plane: bounds.minX },
        { face: "east", plane: bounds.maxX }
      ];
  return endFaces.reduce((total, { face, plane }) => (
    total + addMassingGreenhouseHeroEnd(
      buffer,
      spec,
      mass,
      face,
      plane,
      alongStart,
      alongEnd
    )
  ), 0);
}

function addMassingGreenhouseHeroEnd(
  buffer,
  spec,
  mass,
  face,
  plane,
  alongStart,
  alongEnd
) {
  const centerAlong = Math.round((alongStart + alongEnd) / 2);
  const radius = Math.max(2, (alongEnd - alongStart + 1) / 2);
  const springY = mass.baseYVoxels + mass.heightVoxels;
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.trim,
    owner: `${spec.id}:${mass.id}:greenhouse-end`
  };
  let voxels = 0;
  for (let along = alongStart; along <= alongEnd; along += 1) {
    const normalized = Math.abs((along - centerAlong) / radius);
    const archY = springY + Math.round(
      mass.cap.heightVoxels * Math.sqrt(Math.max(0, 1 - normalized ** 2))
    );
    for (let thickness = 0; thickness < 2; thickness += 1) {
      for (let projection = 1; projection <= 3; projection += 1) {
        const [x, z] = massingFacadeCoordinate(face, plane, along, projection);
        if (buffer.addVoxel(
          mass.materials.frame,
          x,
          archY - thickness,
          z,
          hashNumber(spec.seed, mass.id, "end-arch", along, thickness, projection),
          write
        )) voxels += 1;
      }
    }
  }
  const topY = springY + mass.cap.heightVoxels;
  for (let along = alongStart; along <= alongEnd; along += 1) {
    const [x, z] = massingFacadeCoordinate(face, plane, along, 3);
    if (buffer.addVoxel(
      mass.materials.frame,
      x,
      springY,
      z,
      hashNumber(spec.seed, mass.id, "end-spring-beam", along),
      write
    )) voxels += 1;
  }
  for (const ratio of [0.1, 0.22, 0.34, 0.5, 0.66, 0.78, 0.9]) {
    const targetAlong = Math.round(alongStart + (alongEnd - alongStart) * ratio);
    const normalized = Math.abs((targetAlong - centerAlong) / radius);
    const targetY = springY + Math.round(
      mass.cap.heightVoxels * Math.sqrt(Math.max(0, 1 - normalized ** 2))
    );
    const steps = Math.max(Math.abs(targetAlong - centerAlong), targetY - springY);
    for (let step = 0; step <= steps; step += 1) {
      const progress = steps > 0 ? step / steps : 0;
      const along = Math.round(centerAlong + (targetAlong - centerAlong) * progress);
      const y = Math.round(springY + (targetY - springY) * progress);
      const [x, z] = massingFacadeCoordinate(face, plane, along, 4);
      if (buffer.addVoxel(
        mass.materials.frame,
        x,
        y,
        z,
        hashNumber(spec.seed, mass.id, "end-spoke", ratio, step),
        write
      )) voxels += 1;
    }
  }
  for (let y = mass.baseYVoxels; y <= topY; y += 1) {
    for (let projection = 1; projection <= 3; projection += 1) {
      const [x, z] = massingFacadeCoordinate(face, plane, centerAlong, projection);
      if (buffer.addVoxel(
        mass.materials.frame,
        x,
        y,
        z,
        hashNumber(spec.seed, mass.id, "end-center-frame", y, projection),
        write
      )) voxels += 1;
    }
  }
  const doorWidth = 12;
  const doorHeight = Math.min(10, mass.heightVoxels - 1);
  const doorStart = centerAlong - Math.floor(doorWidth / 2);
  for (let along = doorStart; along < doorStart + doorWidth; along += 1) {
    for (let localY = 1; localY <= doorHeight; localY += 1) {
      const border = along <= doorStart + 1
        || along >= doorStart + doorWidth - 2
        || localY >= doorHeight - 1;
      const [x, z] = massingFacadeCoordinate(face, plane, along, 4);
      const material = border || along === centerAlong
        ? mass.materials.frame
        : localY <= 4
          ? mass.materials.door
          : "warmWindow";
      if (buffer.addVoxel(
        material,
        x,
        mass.baseYVoxels + localY,
        z,
        hashNumber(spec.seed, mass.id, "end-door", along, localY),
        write
      )) voxels += 1;
    }
  }
  return voxels;
}

function addMassingArcadeRelief(buffer, spec, mass, plan, occluders) {
  if (!plan.size) return 0;
  const bounds = massingPlanBounds(plan);
  const write = {
    priority: VOXEL_WRITE_PRIORITIES.trim,
    owner: `${spec.id}:${mass.id}:arcade-relief`
  };
  let voxels = 0;
  for (const key of plan) {
    const [x, z] = parseMassingPoint(key);
    if (buffer.addVoxel(
      "stoneShadow",
      x,
      mass.baseYVoxels,
      z,
      hashNumber(spec.seed, mass.id, "arcade-shadow-floor", x, z),
      write
    )) voxels += 1;
  }
  for (const face of ["north", "east", "south", "west"]) {
    const mode = mass.enclosure.sides[face];
    if (mode === "open" || mode === "wall") continue;
    for (const run of principalMassingFacadeRuns(plan, bounds, face)) {
      for (let along = run.start; along <= run.end; along += 1) {
        const bayPosition = positiveModulo(
          along - run.start,
          mass.enclosure.columnSpacingVoxels
        );
        const halfBay = mass.enclosure.columnSpacingVoxels / 2;
        const normalizedAcross = clamp(
          (bayPosition - halfBay) / Math.max(1, halfBay),
          -1,
          1
        );
        const archSpringY = mass.heightVoxels
          - mass.enclosure.beamHeightVoxels
          - mass.enclosure.archRiseVoxels;
        const archCurveY = archSpringY + Math.round(
          mass.enclosure.archRiseVoxels
            * Math.sqrt(Math.max(0, 1 - normalizedAcross ** 2))
        );
        for (let localY = 0; localY < mass.heightVoxels; localY += 1) {
          const column = bayPosition < mass.enclosure.columnWidthVoxels
            || along >= run.end - mass.enclosure.columnWidthVoxels + 1;
          const entablature = localY >= mass.heightVoxels - mass.enclosure.beamHeightVoxels;
          const arch = mass.enclosure.archRiseVoxels > 0
            && localY >= archCurveY - mass.enclosure.archThicknessVoxels + 1
            && localY <= archCurveY;
          const capital = mass.enclosure.capitalHeightVoxels > 0
            && localY >= archSpringY - mass.enclosure.capitalHeightVoxels
            && localY < archSpringY
            && (
              bayPosition <= mass.enclosure.columnWidthVoxels
              || bayPosition >= mass.enclosure.columnSpacingVoxels
                - mass.enclosure.columnWidthVoxels
            );
          const plinth = localY < mass.enclosure.plinthHeightVoxels;
          if (!column && !entablature && !arch && !capital && !plinth) continue;
          const [surfaceX, surfaceZ] = massingFacadeCoordinate(face, run.plane, along, 0);
          const worldY = mass.baseYVoxels + localY;
          if (massingOpenFaceAutoOccluded(
            mass,
            face,
            surfaceX,
            worldY,
            surfaceZ,
            occluders
          )) continue;
          if (arch) {
            const [shadowX, shadowZ] = massingFacadeCoordinate(
              face,
              run.plane,
              along,
              -1
            );
            if (buffer.addVoxel(
              "stoneShadow",
              shadowX,
              worldY,
              shadowZ,
              hashNumber(
                spec.seed,
                mass.id,
                "arcade-arch-shadow",
                face,
                along,
                localY
              ),
              write
            )) voxels += 1;
          }
          const reliefDepth = arch || capital || plinth ? 2 : 1;
          for (let projection = 1; projection <= reliefDepth; projection += 1) {
            const [x, z] = massingFacadeCoordinate(face, run.plane, along, projection);
            if (buffer.addVoxel(
              mass.materials.trim,
              x,
              worldY,
              z,
              hashNumber(
                spec.seed,
                mass.id,
                "arcade-relief",
                face,
                along,
                localY,
                projection
              ),
              write
            )) voxels += 1;
          }
        }
      }
    }
  }
  return voxels;
}

function massingFramedGridContains(mass, faces, x, localY, z) {
  const width = mass.framing.frameWidthVoxels;
  const horizontalBeam = positiveModulo(localY, mass.framing.floorBeamSpacingVoxels) < width;
  const verticalFrame = faces.some((face) => {
    const along = face === "north" || face === "south" ? x : z;
    return positiveModulo(along, mass.framing.baySpacingVoxels) < width;
  });
  return horizontalBeam || verticalFrame;
}

function massingFaceOffset(face) {
  if (face === "north") return [0, -1];
  if (face === "east") return [1, 0];
  if (face === "south") return [0, 1];
  return [-1, 0];
}

function massingSurfaceMaterial(mass, faces, x, localY, z, bounds, topSurface, facadeFeatures = []) {
  if (mass.type === "ground") return mass.materials.ground;
  if (mass.type === "open") {
    for (const face of faces) {
      const mode = mass.enclosure.sides[face];
      if (mode === "open") continue;
      if (mode === "wall") return mass.materials.wall;
      const along = face === "north" || face === "south"
        ? x - bounds.minX
        : z - bounds.minZ;
      const column = positiveModulo(along, mass.enclosure.columnSpacingVoxels)
        < mass.enclosure.columnWidthVoxels;
      const beam = localY >= mass.heightVoxels - mass.enclosure.beamHeightVoxels;
      const plinth = localY < mass.enclosure.plinthHeightVoxels;
      const bayPosition = positiveModulo(along, mass.enclosure.columnSpacingVoxels);
      const halfBay = mass.enclosure.columnSpacingVoxels / 2;
      const archSpringY = mass.heightVoxels
        - mass.enclosure.beamHeightVoxels
        - mass.enclosure.archRiseVoxels;
      const normalizedAcross = clamp((bayPosition - halfBay) / Math.max(1, halfBay), -1, 1);
      const archCurveY = archSpringY + Math.round(
        mass.enclosure.archRiseVoxels
          * Math.sqrt(Math.max(0, 1 - normalizedAcross ** 2))
      );
      const arch = mass.enclosure.archRiseVoxels > 0
        && localY >= archCurveY - mass.enclosure.archThicknessVoxels + 1
        && localY <= archCurveY;
      const capital = mass.enclosure.capitalHeightVoxels > 0
        && localY >= archSpringY - mass.enclosure.capitalHeightVoxels
        && localY < archSpringY
        && (
          bayPosition < mass.enclosure.columnWidthVoxels + 1
          || bayPosition >= mass.enclosure.columnSpacingVoxels
            - mass.enclosure.columnWidthVoxels - 1
        );
      if (column || beam || plinth || arch || capital) return mass.materials.frame;
    }
    return null;
  }
  if (mass.type === "framed") {
    if (topSurface) return mass.materials.frame;
    const beam = massingFramedGridContains(mass, faces, x, localY, z);
    return beam ? mass.materials.frame : mass.materials.panel;
  }
  if (topSurface) return mass.materials.trim;
  if (faces.length > 1 && mass.planShape === "rectangular") return mass.materials.trim;
  const facadeMaterial = genericMassingFacadeMaterial(mass, facadeFeatures, faces, x, localY, z);
  if (facadeMaterial === false) return null;
  return facadeMaterial ?? mass.materials.wall;
}

function genericMassingFacadeMaterial(mass, features, faces, x, localY, z) {
  if (!faces.length) return null;
  for (const feature of features) {
    if (!faces.includes(feature.face)) continue;
    const along = feature.face === "north" || feature.face === "south" ? x : z;
    const plane = feature.face === "north" || feature.face === "south" ? z : x;
    if (plane !== feature.plane) continue;
    const insideOuter = along >= feature.alongStart - 1
      && along <= feature.alongEnd + 1
      && localY >= feature.yStart - 1
      && localY <= feature.yEnd + 1;
    if (!insideOuter) continue;
    const insideOpening = along >= feature.alongStart
      && along <= feature.alongEnd
      && localY >= feature.yStart
      && localY <= feature.yEnd;
    if (!insideOpening) return mass.materials.trim;
    const centerAlong = Math.round((feature.alongStart + feature.alongEnd) / 2);
    if (feature.type === "door") {
      return false;
    }
    const centerY = Math.round((feature.yStart + feature.yEnd) / 2);
    if (
      (feature.alongEnd - feature.alongStart >= 4 && along === centerAlong)
      || (feature.yEnd - feature.yStart >= 6 && localY === centerY)
    ) return mass.materials.trim;
    return mass.materials.window;
  }
  return null;
}

function addMassingGroundDetails(buffer, spec, mass, plan) {
  const treatment = mass.groundTreatment;
  const result = {
    id: mass.id,
    pattern: treatment.pattern,
    planterCount: 0,
    voxels: 0
  };
  if (treatment.pattern === "plain" || !plan.size) return result;
  const bounds = massingPlanBounds(plan);
  const surfaceY = mass.baseYVoxels + mass.heightVoxels - 1;
  const curbY = surfaceY + 1;
  const trimWrite = {
    priority: VOXEL_WRITE_PRIORITIES.trim,
    owner: `${spec.id}:${mass.id}:ground-pattern`
  };
  const decorationWrite = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${spec.id}:${mass.id}:ground-fixtures`
  };
  const innerPlan = erodeMassingPlan(plan, treatment.borderWidthVoxels);
  const pathHalf = Math.floor(treatment.pathWidthVoxels / 2);
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const centerZ = Math.round((bounds.minZ + bounds.maxZ) / 2);

  for (const key of plan) {
    const [x, z] = parseMassingPoint(key);
    const entranceAxis = Math.abs(x - centerX) <= pathHalf;
    const path = entranceAxis || Math.abs(z - centerZ) <= pathHalf;
    if ((treatment.pattern === "courtyard" || treatment.pattern === "garden") && path) {
      if (buffer.addVoxel(
        entranceAxis && treatment.axisMaterial
          ? treatment.axisMaterial
          : mass.materials.trim,
        x,
        surfaceY,
        z,
        hashNumber(spec.seed, mass.id, "ground-path", x, z),
        trimWrite
      )) result.voxels += 1;
    }
    if (innerPlan.has(key)) continue;
    const accessGap = massingBoundaryFaces(plan, x, z).some((face) => (
      (face === "north" || face === "south")
        ? Math.abs(x - centerX) <= pathHalf
        : Math.abs(z - centerZ) <= pathHalf
    ));
    if (accessGap) continue;
    if (buffer.addVoxel(
      mass.materials.trim,
      x,
      curbY,
      z,
      hashNumber(spec.seed, mass.id, "ground-curb", x, z),
      trimWrite
    )) result.voxels += 1;
  }

  const candidates = [
    [0.24, 0.24],
    [0.76, 0.24],
    [0.24, 0.76],
    [0.76, 0.76],
    [0.5, 0.24],
    [0.5, 0.76],
    [0.24, 0.5],
    [0.76, 0.5]
  ]
    .map(([nx, nz]) => ({
      x: Math.round(bounds.minX + (bounds.maxX - bounds.minX) * nx),
      z: Math.round(bounds.minZ + (bounds.maxZ - bounds.minZ) * nz)
    }));

  for (const candidate of candidates) {
    if (result.planterCount >= treatment.planterCount) break;
    const footprint = [];
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        footprint.push(massingPointKey(candidate.x + dx, candidate.z + dz));
      }
    }
    if (!footprint.every((key) => plan.has(key))) continue;
    if (
      treatment.pattern !== "garden"
      && (Math.abs(candidate.x - centerX) <= pathHalf || Math.abs(candidate.z - centerZ) <= pathHalf)
    ) continue;
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        if (!edge) continue;
        if (buffer.addVoxel(
          mass.materials.trim,
          candidate.x + dx,
          curbY,
          candidate.z + dz,
          hashNumber(spec.seed, mass.id, "planter-edge", candidate.x, candidate.z, dx, dz),
          decorationWrite
        )) result.voxels += 1;
      }
    }
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (buffer.addVoxel(
          "foliage",
          candidate.x + dx,
          curbY + 1 + positiveModulo(dx + dz, 2),
          candidate.z + dz,
          hashNumber(spec.seed, mass.id, "planter-foliage", candidate.x, candidate.z, dx, dz),
          decorationWrite
        )) result.voxels += 1;
      }
    }
    result.planterCount += 1;
  }
  if (treatment.fenceHeightVoxels > 0) {
    const fenceCoordinates = new Set();
    for (const key of plan) {
      const [x, z] = parseMassingPoint(key);
      for (const face of massingBoundaryFaces(plan, x, z)) {
        const accessGap = (face === "north" || face === "south")
          ? Math.abs(x - centerX) <= pathHalf
          : Math.abs(z - centerZ) <= pathHalf;
        if (accessGap) continue;
        const along = face === "north" || face === "south" ? x : z;
        const post = positiveModulo(along, 6) === 0;
        for (let height = 1; height <= treatment.fenceHeightVoxels; height += 1) {
          if (!post && height !== treatment.fenceHeightVoxels) continue;
          fenceCoordinates.add(`${x},${curbY + height},${z}`);
        }
      }
    }
    fenceCoordinates.forEach((coordinate) => {
      const [x, y, z] = coordinate.split(",").map(Number);
      if (buffer.addVoxel(
        "patinaMetal",
        x,
        y,
        z,
        hashNumber(spec.seed, mass.id, "fence", x, y, z),
        decorationWrite
      )) result.voxels += 1;
    });
  }

  const lampPositions = [
    [bounds.minX + 2, bounds.minZ + 2],
    [bounds.maxX - 2, bounds.minZ + 2],
    [bounds.minX + 2, bounds.maxZ - 2],
    [bounds.maxX - 2, bounds.maxZ - 2],
    [centerX - pathHalf - 2, bounds.minZ + 2],
    [centerX + pathHalf + 2, bounds.minZ + 2],
    [centerX - pathHalf - 2, bounds.maxZ - 2],
    [centerX + pathHalf + 2, bounds.maxZ - 2]
  ].slice(0, treatment.lampCount);
  lampPositions.forEach(([x, z], index) => {
    if (!plan.has(massingPointKey(x, z))) return;
    buffer.addBox(
      "patinaMetal",
      x,
      curbY + 1,
      z,
      1,
      6,
      1,
      hashNumber(spec.seed, mass.id, "lamp-post", index),
      decorationWrite
    );
    buffer.addBox(
      "warmWindow",
      x - 1,
      curbY + 7,
      z - 1,
      3,
      3,
      3,
      hashNumber(spec.seed, mass.id, "lamp", index),
      decorationWrite
    );
    buffer.addBox(
      "patinaMetal",
      x - 1,
      curbY + 10,
      z - 1,
      3,
      1,
      3,
      hashNumber(spec.seed, mass.id, "lamp-cap", index),
      decorationWrite
    );
    result.voxels += 6 + 27 + 9;
  });

  if (treatment.stepWidthVoxels > 0 && treatment.stepDepthVoxels > 0) {
    const stepStartX = centerX - Math.floor(treatment.stepWidthVoxels / 2);
    for (let depth = 0; depth < treatment.stepDepthVoxels; depth += 1) {
      const stepY = surfaceY + 1
        + Math.floor((treatment.stepDepthVoxels - depth - 1) / 2);
      buffer.addBox(
        "stoneShadow",
        stepStartX,
        surfaceY + 1,
        bounds.minZ + depth,
        treatment.stepWidthVoxels,
        Math.max(1, stepY - surfaceY),
        1,
        hashNumber(spec.seed, mass.id, "entrance-step-riser", depth),
        decorationWrite
      );
      buffer.addBox(
        mass.materials.trim,
        stepStartX,
        stepY,
        bounds.minZ + depth,
        treatment.stepWidthVoxels,
        1,
        1,
        hashNumber(spec.seed, mass.id, "entrance-step", depth),
        decorationWrite
      );
      result.voxels += treatment.stepWidthVoxels;
    }
  }
  return result;
}

function addMassingRelationFinishes(buffer, spec, relationCuts, compiledMasses) {
  const compiledById = new Map(compiledMasses.map((compiled) => [compiled.mass.id, compiled]));
  return spec.relations.flatMap((relation) => {
    if (relation.type === "portal") {
      const cuts = relationCuts.filter((cut) => (
        cut.relationId === relation.id && cut.relationType === "portal"
      ));
      let voxels = 0;
      cuts.forEach((cut) => {
        const mass = compiledById.get(cut.massId)?.mass;
        if (!mass || relation.finish.trimWidthVoxels <= 0) return;
        const write = {
          priority: VOXEL_WRITE_PRIORITIES.trim,
          owner: `${spec.id}:${relation.id}:${cut.massId}:portal-finish`
        };
        const trimWidth = relation.finish.trimWidthVoxels;
        for (let trim = 1; trim <= trimWidth; trim += 1) {
          for (let y = cut.minimumY; y <= cut.maximumY + trimWidth; y += 1) {
            const starts = [cut.alongStart - trim, cut.alongEnd + trim];
            starts.forEach((along) => {
              const x = cut.axis === "x" ? cut.coordinate : along;
              const z = cut.axis === "z" ? cut.coordinate : along;
              if (buffer.addVoxel(
                mass.materials.trim,
                x,
                y,
                z,
                hashNumber(spec.seed, relation.id, cut.massId, "jamb", trim, along, y),
                write
              )) voxels += 1;
            });
          }
          for (let along = cut.alongStart - trim; along <= cut.alongEnd + trim; along += 1) {
            const x = cut.axis === "x" ? cut.coordinate : along;
            const z = cut.axis === "z" ? cut.coordinate : along;
            if (buffer.addVoxel(
              mass.materials.trim,
              x,
              cut.maximumY + trim,
              z,
              hashNumber(spec.seed, relation.id, cut.massId, "lintel", trim, along),
              write
            )) voxels += 1;
          }
        }
        for (let threshold = 0; threshold < relation.finish.thresholdVoxels; threshold += 1) {
          for (let along = cut.alongStart; along <= cut.alongEnd; along += 1) {
            const x = cut.axis === "x" ? cut.coordinate : along;
            const z = cut.axis === "z" ? cut.coordinate : along;
            if (buffer.addVoxel(
              mass.materials.trim,
              x,
              cut.minimumY + threshold,
              z,
              hashNumber(spec.seed, relation.id, cut.massId, "threshold", threshold, along),
              write
            )) voxels += 1;
          }
        }
      });
      return [{
        id: relation.id,
        type: relation.type,
        cutCount: cuts.length,
        voxels
      }];
    }
    if (relation.type === "stacked") {
      const host = compiledById.get(relation.from);
      const child = compiledById.get(relation.to);
      if (!host || !child) return [];
      const write = {
        priority: VOXEL_WRITE_PRIORITIES.trim,
        owner: `${spec.id}:${relation.id}:stacked-base`
      };
      let voxels = 0;
      const childBoundary = new Set([...child.basePlan].filter((key) => {
        const [x, z] = parseMassingPoint(key);
        return massingBoundaryFaces(child.basePlan, x, z).length > 0;
      }));
      for (const key of childBoundary) {
        const [x, z] = parseMassingPoint(key);
        for (let y = 0; y < relation.finish.baseCourseHeightVoxels; y += 1) {
          if (buffer.addVoxel(
            child.mass.materials.trim,
            x,
            child.mass.baseYVoxels + y,
            z,
            hashNumber(spec.seed, relation.id, "base-course", x, y, z),
            write
          )) voxels += 1;
        }
      }
      let expanded = new Set(child.basePlan);
      for (let width = 0; width < relation.finish.apronWidthVoxels; width += 1) {
        const next = new Set(expanded);
        for (const key of expanded) {
          const [x, z] = parseMassingPoint(key);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const candidate = massingPointKey(x + dx, z + dz);
            if (!child.basePlan.has(candidate) && host.topPlan.has(candidate)) next.add(candidate);
          }
        }
        expanded = next;
      }
      for (const key of expanded) {
        if (child.basePlan.has(key)) continue;
        const [x, z] = parseMassingPoint(key);
        if (buffer.addVoxel(
          child.mass.materials.trim,
          x,
          child.mass.baseYVoxels,
          z,
          hashNumber(spec.seed, relation.id, "apron", x, z),
          write
        )) voxels += 1;
      }
      return [{
        id: relation.id,
        type: relation.type,
        cutCount: 0,
        voxels
      }];
    }
    return [];
  });
}

function addMassingCap(buffer, spec, mass, plan, exclusions = new Set(), occluders = []) {
  const activePlan = new Set([...plan].filter((key) => !exclusions.has(key)));
  if (!activePlan.size) {
    return {
      surfaceVoxels: 0,
      bridgeVoxels: 0,
      maximumStep: 0,
      ribVoxels: 0,
      dormerVoxels: 0,
      dormerPlacements: [],
      rooflineOrnamentVoxels: 0,
      rooflineOrnamentPlacements: [],
      finialVoxels: 0
    };
  }
  if (mass.cap.type === "flat") {
    const flatHeightField = new Map([...activePlan].map((key) => [
      key,
      mass.baseYVoxels + mass.heightVoxels
    ]));
    const ornaments = addMassingCapRooflineOrnaments(
      buffer,
      spec,
      mass,
      activePlan,
      flatHeightField
    );
    return {
      surfaceVoxels: 0,
      bridgeVoxels: 0,
      maximumStep: 0,
      ribVoxels: 0,
      dormerVoxels: 0,
      dormerPlacements: [],
      rooflineOrnamentVoxels: ornaments.voxels,
      rooflineOrnamentPlacements: ornaments.placements,
      finialVoxels: 0
    };
  }
  const bounds = massingPlanBounds(activePlan);
  const roofWrite = { priority: VOXEL_WRITE_PRIORITIES.roof, owner: `${spec.id}:${mass.id}:cap` };
  if (mass.cap.type === "parapet") {
    let surfaceVoxels = 0;
    for (const key of activePlan) {
      const [x, z] = parseMassingPoint(key);
      const exposedFaces = massingBoundaryFaces(activePlan, x, z).filter((face) => (
        mass.type !== "open"
        || !massingOpenFaceAutoOccluded(
          mass,
          face,
          x,
          mass.baseYVoxels + mass.heightVoxels - 1,
          z,
          occluders
        )
      ));
      if (!exposedFaces.length) continue;
      buffer.addBox(
        mass.materials.trim,
        x,
        mass.baseYVoxels + mass.heightVoxels,
        z,
        1,
        mass.cap.parapetHeightVoxels,
        1,
        hashNumber(spec.seed, mass.id, "parapet", x, z),
        roofWrite
      );
      surfaceVoxels += mass.cap.parapetHeightVoxels;
    }
    return {
      surfaceVoxels,
      bridgeVoxels: 0,
      maximumStep: 0,
      ribVoxels: 0,
      dormerVoxels: 0,
      dormerPlacements: [],
      rooflineOrnamentVoxels: 0,
      rooflineOrnamentPlacements: [],
      finialVoxels: 0
    };
  }
  if (mass.cap.type === "dome" || mass.cap.type === "spire") {
    return {
      ...addMassingHeroCapShell(buffer, spec, mass, activePlan, bounds, roofWrite),
      rooflineOrnamentVoxels: 0,
      rooflineOrnamentPlacements: []
    };
  }
  const heightField = new Map([...activePlan].map((key) => {
    const [x, z] = parseMassingPoint(key);
    const rise = massingCapRise(mass.cap, x, z, bounds);
    return [key, mass.baseYVoxels + mass.heightVoxels + rise];
  }));
  let surfaceVoxels = 0;
  let bridgeVoxels = 0;
  let maximumStep = 0;
  let ribVoxels = 0;
  for (const key of activePlan) {
    const [x, z] = parseMassingPoint(key);
    const roofY = heightField.get(key);
    const neighborHeights = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dz]) => heightField.get(massingPointKey(x + dx, z + dz)))
      .filter((height) => height != null);
    const bridgeBaseY = Math.min(roofY, ...neighborHeights);
    const step = roofY - bridgeBaseY;
    maximumStep = Math.max(maximumStep, step);
    const boundary = massingBoundaryFaces(activePlan, x, z).length > 0;
    const rise = roofY - mass.baseYVoxels - mass.heightVoxels;
    if (boundary && rise > 0) {
      const capFillMaterial = mass.type === "framed"
        ? ((positiveModulo(x, mass.framing.baySpacingVoxels) < mass.framing.frameWidthVoxels
          || positiveModulo(z, mass.framing.baySpacingVoxels) < mass.framing.frameWidthVoxels)
            ? mass.materials.frame
            : mass.materials.panel)
        : mass.materials.wall;
      buffer.addBox(
        capFillMaterial,
        x,
        mass.baseYVoxels + mass.heightVoxels,
        z,
        1,
        rise,
        1,
        hashNumber(spec.seed, mass.id, "cap-fill", x, z),
        roofWrite
      );
    }
    const baseRoofMaterial = ["glass_ridge", "glass_barrel"].includes(mass.cap.type)
      ? ((positiveModulo(x, mass.framing.baySpacingVoxels) < mass.framing.frameWidthVoxels
        || positiveModulo(z, mass.framing.baySpacingVoxels) < mass.framing.frameWidthVoxels)
          ? mass.materials.frame
          : mass.materials.panel)
      : mass.cap.type === "sawtooth" && sawtoothGlazingContains(mass.cap, x, z, bounds)
        ? mass.materials.window
        : mass.materials.roof;
    const roofMaterial = massingCapHeroDetailContains(mass.cap, x, z, rise, bounds)
      ? mass.materials.trim
      : baseRoofMaterial;
    if (roofMaterial === mass.materials.trim && baseRoofMaterial !== mass.materials.trim) {
      ribVoxels += step + 1;
    }
    buffer.addBox(
      roofMaterial,
      x,
      bridgeBaseY,
      z,
      1,
      step + 1,
      1,
      hashNumber(spec.seed, mass.id, "cap", x, z),
      roofWrite
    );
    surfaceVoxels += step + 1;
    bridgeVoxels += step;
  }
  const dormers = addMassingCapDormers(
    buffer,
    spec,
    mass,
    activePlan,
    heightField,
    roofWrite
  );
  const ridgeRailVoxels = addMassingRoofRidgeRail(
    buffer,
    spec,
    mass,
    bounds,
    heightField,
    roofWrite
  );
  const finialVoxels = mass.cap.type === "glass_barrel"
    ? addMassingGlassRidgeVent(buffer, spec, mass, bounds, heightField, roofWrite)
    : addMassingCapFinial(buffer, spec, mass, bounds, heightField, roofWrite);
  const ornaments = addMassingCapRooflineOrnaments(
    buffer,
    spec,
    mass,
    activePlan,
    heightField
  );
  return {
    surfaceVoxels,
    bridgeVoxels,
    maximumStep,
    ribVoxels,
    dormerVoxels: dormers.voxels,
    dormerPlacements: dormers.placements,
    rooflineOrnamentVoxels: ornaments.voxels,
    rooflineOrnamentPlacements: ornaments.placements,
    ridgeRailVoxels,
    finialVoxels
  };
}

function addMassingRoofRidgeRail(buffer, spec, mass, bounds, heightField, write) {
  const railHeight = mass.cap.ridgeRailHeightVoxels;
  if (
    railHeight <= 0
    || !["gable", "hip", "mansard"].includes(mass.cap.type)
    || !heightField.size
  ) return 0;
  const northSouth = mass.cap.orientation === "north_south";
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const centerZ = Math.round((bounds.minZ + bounds.maxZ) / 2);
  const start = northSouth ? bounds.minZ + 4 : bounds.minX + 4;
  const end = northSouth ? bounds.maxZ - 4 : bounds.maxX - 4;
  const baseY = Math.max(...heightField.values()) + 1;
  let voxels = 0;
  for (let along = start; along <= end; along += 1) {
    const post = along === start || along === end || positiveModulo(along - start, 5) === 0;
    const x = northSouth ? centerX : along;
    const z = northSouth ? along : centerZ;
    if (post) {
      for (let y = 0; y < railHeight; y += 1) {
        if (buffer.addVoxel(
          "patinaMetal",
          x,
          baseY + y,
          z,
          hashNumber(spec.seed, mass.id, "ridge-rail-post", along, y),
          write
        )) voxels += 1;
      }
    }
    if (buffer.addVoxel(
      "patinaMetal",
      x,
      baseY + railHeight,
      z,
      hashNumber(spec.seed, mass.id, "ridge-rail", along),
      write
    )) voxels += 1;
  }
  return voxels;
}

function addMassingGlassRidgeVent(buffer, spec, mass, bounds, heightField, write) {
  if (mass.cap.finialHeightVoxels <= 0 || !heightField.size) return 0;
  const northSouth = mass.cap.orientation === "north_south";
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const centerZ = Math.round((bounds.minZ + bounds.maxZ) / 2);
  const start = northSouth ? bounds.minZ + 2 : bounds.minX + 2;
  const end = northSouth ? bounds.maxZ - 2 : bounds.maxX - 2;
  const topY = Math.max(...heightField.values()) + 1;
  const height = mass.cap.finialHeightVoxels;
  let voxels = 0;
  for (let along = start; along <= end; along += 1) {
    const frame = along === start
      || along === end
      || positiveModulo(along - start, mass.framing.baySpacingVoxels) < 2;
    for (let localY = 0; localY < height; localY += 1) {
      for (let across = -1; across <= 1; across += 1) {
        const edge = localY === 0 || localY === height - 1;
        const material = frame || edge ? mass.materials.frame : mass.materials.panel;
        const x = northSouth ? centerX + across : along;
        const z = northSouth ? along : centerZ + across;
        if (buffer.addVoxel(
          material,
          x,
          topY + localY,
          z,
          hashNumber(spec.seed, mass.id, "ridge-vent", along, across, localY),
          write
        )) voxels += 1;
      }
    }
    for (let across = -2; across <= 2; across += 1) {
      const x = northSouth ? centerX + across : along;
      const z = northSouth ? along : centerZ + across;
      if (buffer.addVoxel(
        mass.materials.frame,
        x,
        topY + height,
        z,
        hashNumber(spec.seed, mass.id, "ridge-vent-cap", along, across),
        write
      )) voxels += 1;
    }
  }
  return voxels;
}

function addMassingHeroCapShell(buffer, spec, mass, plan, bounds, write) {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const radiusX = Math.max(1, (bounds.maxX - bounds.minX + 1) / 2);
  const radiusZ = Math.max(1, (bounds.maxZ - bounds.minZ + 1) / 2);
  const height = Math.max(1, mass.cap.heightVoxels);
  let surfaceVoxels = 0;
  let ribVoxels = 0;
  let previousLayer = new Set();
  for (let layer = 0; layer <= height; layer += 1) {
    const progress = layer / height;
    const scale = mass.cap.type === "dome"
      ? Math.sqrt(Math.max(0, 1 - progress ** 2))
      : Math.max(0, 1 - progress);
    let layerPlan = new Set([...plan].filter((key) => {
      const [x, z] = parseMassingPoint(key);
      const nx = Math.abs((x - centerX) / radiusX);
      const nz = Math.abs((z - centerZ) / radiusZ);
      const distance = mass.cap.type === "dome"
        ? Math.sqrt(nx ** 2 + nz ** 2)
        : Math.max(nx, nz);
      return distance <= scale + 0.08;
    }));
    if (!layerPlan.size) {
      const centerKey = [...plan].reduce((best, key) => {
        const [x, z] = parseMassingPoint(key);
        const [bestX, bestZ] = parseMassingPoint(best);
        return Math.hypot(x - centerX, z - centerZ)
          < Math.hypot(bestX - centerX, bestZ - centerZ)
          ? key
          : best;
      });
      layerPlan = new Set([centerKey]);
    }
    const layerY = mass.baseYVoxels + mass.heightVoxels + layer;
    const ringLayer = mass.cap.ringCount > 0
      && Array.from({ length: mass.cap.ringCount }, (_, index) => (
        Math.round((index + 1) * height / (mass.cap.ringCount + 1))
      )).some((ringY) => layer === ringY);
    for (const key of layerPlan) {
      const [x, z] = parseMassingPoint(key);
      if (massingBoundaryFaces(layerPlan, x, z).length === 0) continue;
      const dx = x - centerX;
      const dz = z - centerZ;
      const radialDistance = Math.hypot(dx, dz);
      let rib = false;
      if (mass.cap.ribCount > 0 && radialDistance >= 2.25) {
        for (let index = 0; index < mass.cap.ribCount; index += 1) {
          const angle = index / mass.cap.ribCount * Math.PI * 2;
          if (Math.abs(dx * Math.sin(angle) - dz * Math.cos(angle)) <= 0.48) {
            rib = true;
            break;
          }
        }
      }
      const material = ringLayer || rib ? mass.materials.trim : mass.materials.roof;
      if (buffer.addVoxel(
        material,
        x,
        layerY,
        z,
        hashNumber(spec.seed, mass.id, "hero-cap-shell", x, layer, z),
        write
      )) {
        surfaceVoxels += 1;
        if (material === mass.materials.trim && mass.materials.trim !== mass.materials.roof) {
          ribVoxels += 1;
        }
      }
      if (!previousLayer.has(key) && layer > 0) {
        const belowY = layerY - 1;
        if (buffer.addVoxel(
          material,
          x,
          belowY,
          z,
          hashNumber(spec.seed, mass.id, "hero-cap-bridge", x, layer, z),
          write
        )) surfaceVoxels += 1;
      }
    }
    previousLayer = layerPlan;
  }
  const finialVoxels = addMassingCapFinial(
    buffer,
    spec,
    mass,
    bounds,
    new Map([["hero-top", mass.baseYVoxels + mass.heightVoxels + height]]),
    write
  );
  return {
    surfaceVoxels,
    bridgeVoxels: 0,
    maximumStep: 1,
    ribVoxels,
    dormerVoxels: 0,
    finialVoxels
  };
}

function massingCapHeroDetailContains(cap, x, z, rise, bounds) {
  if (!["dome", "spire"].includes(cap.type) || rise <= 0) return false;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const dx = x - centerX;
  const dz = z - centerZ;
  if (cap.ribCount > 0) {
    for (let index = 0; index < cap.ribCount; index += 1) {
      const angle = index / cap.ribCount * Math.PI * 2;
      const lineDistance = Math.abs(dx * Math.sin(angle) - dz * Math.cos(angle));
      if (lineDistance <= 0.62) return true;
    }
  }
  if (cap.ringCount > 0) {
    const spacing = cap.heightVoxels / (cap.ringCount + 1);
    for (let ring = 1; ring <= cap.ringCount; ring += 1) {
      if (Math.abs(rise - ring * spacing) <= 0.65) return true;
    }
  }
  return false;
}

function addMassingCapDormers(buffer, spec, mass, activePlan, heightField, write) {
  if (
    mass.cap.dormerCount <= 0
    || !["gable", "hip", "mansard"].includes(mass.cap.type)
  ) return { voxels: 0, placements: [] };
  const placements = planMassingCapDormers(activePlan, heightField, mass.cap.dormerCount);
  let voxels = 0;
  placements.forEach(({ centerX, boundaryZ, roofBaseY }, index) => {
    const startX = centerX - 2;
    const startZ = boundaryZ - 2;
    buffer.addBox(
      mass.materials.wall,
      startX,
      roofBaseY,
      startZ,
      5,
      5,
      3,
      hashNumber(spec.seed, mass.id, "dormer-body", index),
      write
    );
    buffer.addBox(
      mass.materials.window,
      centerX - 1,
      roofBaseY + 1,
      startZ + 3,
      3,
      3,
      1,
      hashNumber(spec.seed, mass.id, "dormer-window", index),
      write
    );
    buffer.addBox(
      mass.materials.trim,
      startX - 1,
      roofBaseY,
      startZ + 3,
      1,
      5,
      1,
      hashNumber(spec.seed, mass.id, "dormer-left", index),
      write
    );
    buffer.addBox(
      mass.materials.trim,
      startX + 5,
      roofBaseY,
      startZ + 3,
      1,
      5,
      1,
      hashNumber(spec.seed, mass.id, "dormer-right", index),
      write
    );
    for (let row = 0; row < 3; row += 1) {
      buffer.addBox(
        mass.materials.roof,
        startX - 1 + row,
        roofBaseY + 5 + row,
        startZ,
        7 - row * 2,
        1,
        4,
        hashNumber(spec.seed, mass.id, "dormer-roof", index, row),
        write
      );
    }
    voxels += 5 * 5 * 3 + 3 * 3 + 10 + 7 * 4 + 5 * 4 + 3 * 4;
  });
  return {
    voxels,
    placements: placements.map((placement) => ({ ...placement, startZ: placement.boundaryZ - 2 }))
  };
}

function planMassingCapDormers(activePlan, heightField, requestedCount) {
  const southEdgesByZ = new Map();
  for (const key of activePlan) {
    const [x, z] = parseMassingPoint(key);
    if (activePlan.has(massingPointKey(x, z + 1))) continue;
    if (!southEdgesByZ.has(z)) southEdgesByZ.set(z, []);
    southEdgesByZ.get(z).push(x);
  }
  const runs = [...southEdgesByZ.entries()]
    .flatMap(([z, xValues]) => consecutiveMassingRuns(xValues).map((run) => ({ ...run, z })))
    .filter((run) => run.end - run.start + 1 >= 7)
    .sort((left, right) => right.z - left.z || left.start - right.start);
  const candidates = runs.flatMap((run) => {
    const width = run.end - run.start + 1;
    const count = Math.max(1, Math.floor((width - 6) / 7));
    return Array.from({ length: count }, (_, index) => {
      const centerX = Math.round(run.start + width * (index + 1) / (count + 1));
      const supportKeys = [];
      for (let z = run.z - 2; z <= run.z; z += 1) {
        for (let x = centerX - 3; x <= centerX + 3; x += 1) {
          supportKeys.push(massingPointKey(x, z));
        }
      }
      if (!supportKeys.every((key) => activePlan.has(key) && heightField.has(key))) return null;
      const roofBaseY = Math.max(...supportKeys.map((key) => heightField.get(key))) - 1;
      return { centerX, boundaryZ: run.z, roofBaseY };
    }).filter(Boolean);
  });
  return candidates.slice(0, requestedCount);
}

function consecutiveMassingRuns(values) {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (!sorted.length) return [];
  const runs = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    runs.push({ start, end: previous });
    start = value;
    previous = value;
  }
  runs.push({ start, end: previous });
  return runs;
}

function addMassingCapFinial(buffer, spec, mass, bounds, heightField, write) {
  if (mass.cap.finialHeightVoxels <= 0 || !heightField.size) return 0;
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const centerZ = Math.round((bounds.minZ + bounds.maxZ) / 2);
  const topY = Math.max(...heightField.values()) + 1;
  const height = mass.cap.finialHeightVoxels;
  buffer.addBox(
    mass.materials.trim,
    centerX - 1,
    topY,
    centerZ - 1,
    2,
    height,
    2,
    hashNumber(spec.seed, mass.id, "finial"),
    write
  );
  buffer.addVoxel(
    mass.materials.roof,
    centerX,
    topY + height,
    centerZ,
    hashNumber(spec.seed, mass.id, "finial-cap"),
    write
  );
  return 2 * height * 2 + 1;
}

function massingCapRise(cap, x, z, bounds) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const nx = (x - bounds.minX) / width;
  const nz = (z - bounds.minZ) / depth;
  if (cap.type === "gable" || cap.type === "glass_ridge") {
    const position = cap.orientation === "north_south" ? nx : nz;
    return linearTentRise(
      Math.round(position * 1000),
      1001,
      cap.ridgeRatio,
      cap.heightVoxels
    );
  }
  if (cap.type === "glass_barrel") {
    const position = cap.orientation === "north_south" ? nx : nz;
    const normalized = Math.abs(position - 0.5) * 2;
    return Math.round(
      cap.heightVoxels * Math.sqrt(Math.max(0, 1 - normalized ** 2))
    );
  }
  if (cap.type === "sawtooth") {
    const position = cap.orientation === "north_south" ? nx : nz;
    const phase = positiveModulo(position * cap.toothCount, 1);
    return Math.round(cap.heightVoxels * phase);
  }
  const edgeDistance = Math.min(nx, 1 - nx, nz, 1 - nz);
  if (cap.type === "hip") return Math.round(cap.heightVoxels * clamp(edgeDistance * 2, 0, 1));
  if (cap.type === "mansard") return Math.round(cap.heightVoxels * clamp(edgeDistance * 4, 0, 1));
  const radial = Math.sqrt(((nx - 0.5) * 2) ** 2 + ((nz - 0.5) * 2) ** 2);
  if (cap.type === "dome") {
    return Math.round(cap.heightVoxels * Math.sqrt(Math.max(0, 1 - radial ** 2)));
  }
  if (cap.type === "spire") {
    const squareRadius = Math.max(Math.abs((nx - 0.5) * 2), Math.abs((nz - 0.5) * 2));
    return Math.round(cap.heightVoxels * Math.max(0, 1 - squareRadius));
  }
  return 0;
}

function sawtoothGlazingContains(cap, x, z, bounds) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const position = cap.orientation === "north_south"
    ? (x - bounds.minX) / width
    : (z - bounds.minZ) / depth;
  return positiveModulo(position * cap.toothCount, 1) < 0.12;
}

function planMassingRelationCuts(spec, origin) {
  const cuts = [];
  for (const relation of spec.relations) {
    if (relation.type !== "adjoin" && relation.type !== "portal") continue;
    const from = spec.masses.find((mass) => mass.id === relation.from);
    const to = spec.masses.find((mass) => mass.id === relation.to);
    const minimumY = Math.max(from.baseYVoxels, to.baseYVoxels);
    const maximumY = relation.type === "adjoin"
      ? Math.min(from.baseYVoxels + from.heightVoxels, to.baseYVoxels + to.heightVoxels) - 1
      : minimumY + relation.heightVoxels - 1;
    for (const fromCell of from.cells) {
      for (const toCell of to.cells) {
        const dx = toCell.x - fromCell.x;
        const dz = toCell.z - fromCell.z;
        if (Math.abs(dx) + Math.abs(dz) !== 1) continue;
        const alongStart = relation.type === "adjoin"
          ? 1
          : Math.floor((MASSING_CELL_VOXELS - relation.widthVoxels) / 2);
        const alongEnd = relation.type === "adjoin"
          ? MASSING_CELL_VOXELS - 2
          : alongStart + relation.widthVoxels - 1;
        if (dx !== 0) {
          const leftCell = dx > 0 ? fromCell : toCell;
          const rightCell = dx > 0 ? toCell : fromCell;
          const leftMass = dx > 0 ? from : to;
          const rightMass = dx > 0 ? to : from;
          const boundary = origin.x + (leftCell.x + 1) * MASSING_CELL_VOXELS;
          const startZ = origin.z + leftCell.z * MASSING_CELL_VOXELS;
          cuts.push(
            {
              relationId: relation.id,
              relationType: relation.type,
              massId: leftMass.id,
              face: "east",
              axis: "x",
              coordinate: boundary - 1,
              alongStart: startZ + alongStart,
              alongEnd: startZ + alongEnd,
              minimumY,
              maximumY
            },
            {
              relationId: relation.id,
              relationType: relation.type,
              massId: rightMass.id,
              face: "west",
              axis: "x",
              coordinate: boundary,
              alongStart: startZ + alongStart,
              alongEnd: startZ + alongEnd,
              minimumY,
              maximumY
            }
          );
        } else {
          const northCell = dz > 0 ? fromCell : toCell;
          const southCell = dz > 0 ? toCell : fromCell;
          const northMass = dz > 0 ? from : to;
          const southMass = dz > 0 ? to : from;
          const boundary = origin.z + (northCell.z + 1) * MASSING_CELL_VOXELS;
          const startX = origin.x + northCell.x * MASSING_CELL_VOXELS;
          cuts.push(
            {
              relationId: relation.id,
              relationType: relation.type,
              massId: northMass.id,
              face: "south",
              axis: "z",
              coordinate: boundary - 1,
              alongStart: startX + alongStart,
              alongEnd: startX + alongEnd,
              minimumY,
              maximumY
            },
            {
              relationId: relation.id,
              relationType: relation.type,
              massId: southMass.id,
              face: "north",
              axis: "z",
              coordinate: boundary,
              alongStart: startX + alongStart,
              alongEnd: startX + alongEnd,
              minimumY,
              maximumY
            }
          );
        }
      }
    }
  }
  return cuts;
}

function massingRelationCutsVoxel(cut, x, y, z) {
  if (y < cut.minimumY || y > cut.maximumY) return false;
  if (cut.axis === "x") return x === cut.coordinate && z >= cut.alongStart && z <= cut.alongEnd;
  return z === cut.coordinate && x >= cut.alongStart && x <= cut.alongEnd;
}

function massingBoundaryFaces(plan, x, z) {
  const faces = [];
  if (!plan.has(massingPointKey(x, z - 1))) faces.push("north");
  if (!plan.has(massingPointKey(x + 1, z))) faces.push("east");
  if (!plan.has(massingPointKey(x, z + 1))) faces.push("south");
  if (!plan.has(massingPointKey(x - 1, z))) faces.push("west");
  return faces;
}

function massingPlanBounds(plan) {
  const points = [...plan].map(parseMassingPoint);
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)),
    maxZ: Math.max(...points.map(([, z]) => z))
  };
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function addStreetBase(buffer, plan) {
  const width = plan.streetWidthVoxels + 16;
  const startX = -width / 2;
  const front = plan.parcel.depth / 2;
  const terrain = { priority: VOXEL_WRITE_PRIORITIES.terrain, owner: "street" };
  buffer.addBox("pavement", startX, -2, -plan.parcel.depth / 2 - 3, width, 2, plan.parcel.depth + 18, 1, terrain);
  buffer.addBox("pavement", startX - 4, -1, front, width + 8, 2, 10, 2, terrain);
  buffer.addBox("road", startX - 8, -2, front + 10, width + 16, 1, 28, 3, terrain);

  for (let x = startX - 4; x < startX + width + 4; x += 4) {
    buffer.addBox("limestone", x, 1, front + 8, 3, 1, 2, x, terrain);
  }
}

function addBuilding(buffer, building, params) {
  const { widthVoxels: width, depthVoxels: depth } = building.footprint;
  const xStart = building.origin.x;
  const zBack = building.origin.z;
  const zFront = zBack + depth - 1;
  const wallHeight = building.wallHeightVoxels;

  addFacade(buffer, building, params, xStart, zFront, wallHeight);
  addBackWall(buffer, building, xStart, zBack, wallHeight);
  if (building.adjacency.exposedLeftWall) addSideWall(buffer, building, xStart, zBack, depth, "left");
  if (building.adjacency.exposedRightWall) addSideWall(buffer, building, xStart + width - 1, zBack, depth, "right");
  addFacadeModules(buffer, building, params, xStart, zFront);
  if (building.sideFacades.left) addSideFacadeModules(buffer, building, params, xStart, zBack, depth, "left");
  if (building.sideFacades.right) {
    addSideFacadeModules(buffer, building, params, xStart + width - 1, zBack, depth, "right");
  }
  addRoof(buffer, building, xStart, zBack, zFront);
  addChimneys(buffer, building, xStart, zBack);
  addMagicDecoration(buffer, building, params, xStart, zFront);
}

function addFacade(buffer, building, params, xStart, zFront, wallHeight) {
  const width = building.footprint.widthVoxels;
  building.floorSpecs.forEach((floorSpec) => {
    const floorY = floorSpec.index * building.floorHeight;
    const floorFront = zFront - floorSpec.frontSetbackVoxels;
    for (let localY = 0; localY < floorSpec.heightVoxels; localY += 1) {
      const y = floorY + localY;
      for (let localX = 0; localX < width; localX += 1) {
        if (isFrontOpening(localX, y, building)) continue;
        const shade = hashNumber(localX, y, building.index, params.seed);
        buffer.addVoxel(building.materials.wall, xStart + localX, y, floorFront, shade, {
          priority: VOXEL_WRITE_PRIORITIES.structure,
          owner: `${building.id}:facade:floor-${floorSpec.index}`
        });
      }
    }
  });
}

function addBackWall(buffer, building, xStart, zBack, wallHeight) {
  const width = building.footprint.widthVoxels;
  for (let y = 0; y < wallHeight; y += 1) {
    for (let localX = 0; localX < width; localX += 2) {
      buffer.addBox(
        building.materials.wall,
        xStart + localX,
        y,
        zBack,
        Math.min(2, width - localX),
        1,
        1,
        localX + y * 7,
        { priority: VOXEL_WRITE_PRIORITIES.structure, owner: `${building.id}:back-wall` }
      );
    }
  }
}

function addSideWall(buffer, building, x, zBack, depth, side) {
  building.floorSpecs.forEach((floorSpec) => {
    const floorDepth = depth - floorSpec.frontSetbackVoxels;
    const floorY = floorSpec.index * building.floorHeight;
    for (let localY = 0; localY < floorSpec.heightVoxels; localY += 1) {
      const y = floorY + localY;
      for (let localZ = 1; localZ < floorDepth - 1; localZ += 1) {
        if (isSideOpening(localZ, y, building, side)) continue;
        buffer.addVoxel(
          building.materials.wall,
          x,
          y,
          zBack + localZ,
          localZ + y * 5 + (side === "left" ? 11 : 23),
          { priority: VOXEL_WRITE_PRIORITIES.structure, owner: `${building.id}:${side}-wall:floor-${floorSpec.index}` }
        );
      }
    }
    for (let localY = 0; localY < floorSpec.heightVoxels; localY += 5) {
      const y = floorY + localY;
      buffer.addBox(
        building.materials.trim,
        x + (side === "left" ? -1 : 0),
        y,
        zBack + floorDepth - 3,
        2,
        2,
        3,
        y,
        { priority: VOXEL_WRITE_PRIORITIES.trim, owner: `${building.id}:${side}-quoins` }
      );
    }
  });
}

function addSideFacadeModules(buffer, building, params, wallX, zBack, depth, side) {
  const sideFacade = building.sideFacades[side];
  const trim = building.materials.trim;
  const trimWrite = { priority: VOXEL_WRITE_PRIORITIES.trim, owner: `${building.id}:${side}-facade-trim` };
  const openingWrite = { priority: VOXEL_WRITE_PRIORITIES.opening, owner: `${building.id}:${side}-facade-opening` };

  sideFacade.floors.forEach((floorPlan) => {
    const floorY = floorPlan.y;
    const floorSpec = building.floorSpecs[floorPlan.index];
    const floorDepth = depth - floorSpec.frontSetbackVoxels;
    floorPlan.modules.forEach((module) => {
      if (!module.opening || module.opening.xEnd >= floorDepth - 1) return;
      const opening = module.opening;
      const moduleZ = zBack + opening.xStart;
      const moduleWidth = opening.xEnd - opening.xStart + 1;
      const moduleY = floorY + opening.yStart;
      const moduleHeight = opening.yEnd - opening.yStart + 1;
      if (module.type === "entrance" || module.type === "service_door") {
        buffer.addBox(
          building.materials.door,
          sideBoxX(wallX, side, 1, 2),
          moduleY,
          moduleZ,
          2,
          moduleHeight,
          moduleWidth,
          module.bay,
          openingWrite
        );
        if (module.type === "entrance" && moduleWidth >= 4) {
          buffer.addBox(
            building.materials.window,
            sideBoxX(wallX, side, 3, 1),
            moduleY + Math.max(3, moduleHeight - 6),
            moduleZ + 1,
            1,
            4,
            moduleWidth - 2,
            module.bay + 101,
            trimWrite
          );
        }
      } else {
        buffer.addBox(
          building.materials.window,
          sideBoxX(wallX, side, 1, 1),
          moduleY,
          moduleZ,
          1,
          moduleHeight,
          moduleWidth,
          floorPlan.index * 20 + module.bay,
          openingWrite
        );
        if (moduleWidth >= 5) {
          buffer.addBox(
            building.materials.shopfront,
            sideBoxX(wallX, side, 2, 1),
            moduleY,
            moduleZ + Math.floor(moduleWidth / 2),
            1,
            moduleHeight,
            1,
            module.bay + 131,
            trimWrite
          );
        }
      }
      addSideOpeningFrame(
        buffer,
        trim,
        wallX,
        moduleY,
        moduleZ,
        moduleWidth,
        moduleHeight,
        side,
        floorPlan.index * 40 + module.bay,
        trimWrite
      );
      if (module.balcony && floorSpec.balcony !== "full") {
        addSideBalcony(
          buffer,
          building,
          wallX,
          floorY + opening.yStart - 1,
          moduleZ,
          moduleWidth,
          side,
          module.bay
        );
      } else if (module.flowerBox && params.detailDensity > 0.35) {
        addSideFlowerBox(
          buffer,
          wallX,
          floorY + opening.yEnd + 1,
          moduleZ,
          moduleWidth,
          side,
          module.bay + floorPlan.index
        );
      }
    });
    if (floorSpec.balcony === "full" && floorPlan.index > 0 && floorDepth > 6) {
      addSideBalcony(
        buffer,
        building,
        wallX,
        floorY + 3,
        zBack + 2,
        floorDepth - 4,
        side,
        200 + floorPlan.index
      );
    }
    if (floorPlan.index > 0) {
      buffer.addBox(
        trim,
        sideBoxX(wallX, side, 0, 2),
        floorY - 1,
        zBack,
        2,
        2,
        floorDepth,
        floorPlan.index,
        trimWrite
      );
    }
  });

  const topFloorSpec = building.floorSpecs.at(-1);
  const topDepth = depth - topFloorSpec.frontSetbackVoxels;
  buffer.addBox(
    trim,
    sideBoxX(wallX, side, 0, 3),
    building.wallHeightVoxels - 2,
    zBack - 1,
    3,
    3,
    topDepth + 2,
    17,
    trimWrite
  );
}

function addSideOpeningFrame(buffer, material, wallX, y, z, width, height, side, shade, write) {
  const frameX = sideBoxX(wallX, side, 0, 2);
  buffer.addBox(material, frameX, y - 1, z - 1, 2, height + 2, 1, shade, write);
  buffer.addBox(material, frameX, y - 1, z + width, 2, height + 2, 1, shade + 1, write);
  buffer.addBox(material, frameX, y - 1, z - 1, 2, 1, width + 2, shade + 2, write);
  buffer.addBox(
    material,
    sideBoxX(wallX, side, 0, 3),
    y + height,
    z - 1,
    3,
    2,
    width + 2,
    shade + 3,
    write
  );
}

function addSideBalcony(buffer, building, wallX, y, z, width, side, shade) {
  const decorationWrite = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${building.id}:${side}-balcony`
  };
  buffer.addBox(
    building.materials.trim,
    sideBoxX(wallX, side, 1, 5),
    y,
    z - 1,
    5,
    2,
    width + 2,
    shade,
    decorationWrite
  );
  for (let offset = 0; offset <= width; offset += 2) {
    buffer.addBox(
      building.materials.metal,
      sideBoxX(wallX, side, 5, 1),
      y + 2,
      z + offset,
      1,
      5,
      1,
      shade + offset,
      decorationWrite
    );
  }
  buffer.addBox(
    building.materials.metal,
    sideBoxX(wallX, side, 5, 1),
    y + 6,
    z - 1,
    1,
    1,
    width + 2,
    shade + 31,
    decorationWrite
  );
}

function addSideFlowerBox(buffer, wallX, y, z, requestedWidth, side, shade) {
  const width = Math.max(2, Math.min(8, Math.round(requestedWidth)));
  const decorationWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: `${side}-flower-box` };
  buffer.addBox("timber", sideBoxX(wallX, side, 2, 2), y, z, 2, 2, width, shade, decorationWrite);
  for (let offset = 0, index = 0; offset < width; offset += 2, index += 1) {
    buffer.addBox(
      "foliage",
      sideBoxX(wallX, side, 2, 2),
      y + 2,
      z + offset,
      2,
      2 + (index % 2),
      Math.min(2, width - offset),
      shade + index,
      decorationWrite
    );
  }
}

function sideBoxX(wallX, side, outwardDistance, thickness) {
  return side === "left"
    ? wallX - outwardDistance - thickness + 1
    : wallX + outwardDistance;
}

function addFacadeModules(buffer, building, params, xStart, zFront) {
  const width = building.footprint.widthVoxels;
  const wallHeight = building.wallHeightVoxels;
  const trim = building.materials.trim;
  const trimWrite = { priority: VOXEL_WRITE_PRIORITIES.trim, owner: `${building.id}:facade-trim` };
  const openingWrite = { priority: VOXEL_WRITE_PRIORITIES.opening, owner: `${building.id}:facade-opening` };

  building.facade.floors.forEach((floorPlan) => {
    const floorY = floorPlan.y;
    const floorSpec = building.floorSpecs[floorPlan.index];
    const floorFront = zFront - floorSpec.frontSetbackVoxels;
    floorPlan.modules.forEach((module) => {
      if (!module.opening) return;
      const opening = module.opening;
      const moduleX = xStart + opening.xStart;
      const moduleWidth = opening.xEnd - opening.xStart + 1;
      const moduleY = floorY + opening.yStart;
      const moduleHeight = opening.yEnd - opening.yStart + 1;
      if (module.type === "entrance" || module.type === "service_door") {
        buffer.addBox(
          building.materials.door,
          moduleX,
          moduleY,
          floorFront + 1,
          moduleWidth,
          moduleHeight,
          2,
          module.bay,
          openingWrite
        );
        if (module.type === "entrance" && moduleWidth >= 4) {
          buffer.addBox(
            building.materials.window,
            moduleX + 1,
            moduleY + Math.max(3, moduleHeight - 6),
            floorFront + 3,
            moduleWidth - 2,
            4,
            1,
            module.bay + 101,
            trimWrite
          );
        }
      } else {
        buffer.addBox(
          building.materials.window,
          moduleX,
          moduleY,
          floorFront + 1,
          moduleWidth,
          moduleHeight,
          1,
          floorPlan.index * 20 + module.bay,
          openingWrite
        );
        if (moduleWidth >= 5) {
          const mullionX = moduleX + Math.floor(moduleWidth / 2);
          buffer.addBox(
            building.materials.shopfront,
            mullionX,
            moduleY,
            floorFront + 2,
            1,
            moduleHeight,
            1,
            module.bay + 131,
            trimWrite
          );
        }
      }
      addOpeningFrame(
        buffer,
        trim,
        moduleX,
        moduleY,
        floorFront,
        moduleWidth,
        moduleHeight,
        floorPlan.index * 40 + module.bay,
        trimWrite
      );
      if (module.balcony && floorSpec.balcony !== "full") {
        addBalcony(buffer, building, moduleX, floorY + opening.yStart - 1, floorFront, moduleWidth, module.bay);
      } else if (module.flowerBox && params.detailDensity > 0.35) {
        addFlowerBox(
          buffer,
          moduleX,
          floorY + opening.yEnd + 1,
          floorFront + 3,
          module.bay + floorPlan.index,
          moduleWidth
        );
      }
    });
    if (floorSpec.balcony === "full" && floorPlan.index > 0) {
      addBalcony(
        buffer,
        building,
        xStart + 2,
        floorY + 3,
        floorFront,
        width - 4,
        200 + floorPlan.index
      );
    }
    if (floorPlan.index > 0) {
      buffer.addBox(trim, xStart - 1, floorY - 1, floorFront, width + 2, 2, 2, floorPlan.index, trimWrite);
      const previousSetback = building.floorSpecs[floorPlan.index - 1].frontSetbackVoxels;
      const terraceDepth = floorSpec.frontSetbackVoxels - previousSetback;
      if (terraceDepth > 0) {
        buffer.addBox(
          building.materials.trim,
          xStart,
          floorY - 1,
          floorFront + 1,
          width,
          1,
          terraceDepth,
          300 + floorPlan.index,
          { priority: VOXEL_WRITE_PRIORITIES.roof, owner: `${building.id}:setback-terrace` }
        );
      }
    }
    buffer.addBox(trim, xStart, floorY, floorFront + 1, 2, floorSpec.heightVoxels, 2, 29 + floorPlan.index, trimWrite);
    buffer.addBox(trim, xStart + width - 2, floorY, floorFront + 1, 2, floorSpec.heightVoxels, 2, 31 + floorPlan.index, trimWrite);
  });

  const topFront = zFront - building.floorSpecs.at(-1).frontSetbackVoxels;
  buffer.addBox(trim, xStart - 1, wallHeight - 2, topFront - 1, width + 2, 3, 3, 17, trimWrite);
  buffer.addBox("limestone", xStart - 2, wallHeight + 1, topFront - 2, width + 4, 2, 4, 19, trimWrite);
}

function addOpeningFrame(buffer, material, x, y, z, width, height, shade, write) {
  buffer.addBox(material, x - 1, y - 1, z, 1, height + 2, 2, shade, write);
  buffer.addBox(material, x + width, y - 1, z, 1, height + 2, 2, shade + 1, write);
  buffer.addBox(material, x - 1, y - 1, z, width + 2, 1, 2, shade + 2, write);
  buffer.addBox(material, x - 1, y + height, z, width + 2, 2, 3, shade + 3, write);
}

function addBalcony(buffer, building, x, y, z, width, shade) {
  const decorationWrite = {
    priority: VOXEL_WRITE_PRIORITIES.decoration,
    owner: `${building.id}:balcony`
  };
  buffer.addBox(building.materials.trim, x - 1, y, z + 1, width + 2, 2, 5, shade, decorationWrite);
  for (let offset = 0; offset <= width; offset += 2) {
    buffer.addBox(building.materials.metal, x + offset, y + 2, z + 5, 1, 5, 1, shade + offset, decorationWrite);
  }
  buffer.addBox(building.materials.metal, x - 1, y + 6, z + 5, width + 2, 1, 1, shade + 31, decorationWrite);
}

function addFlowerBox(buffer, x, y, z, shade, requestedWidth = 6) {
  const width = Math.max(2, Math.min(8, Math.round(requestedWidth)));
  const decorationWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "flower-box" };
  buffer.addBox("timber", x, y, z, width, 2, 2, shade, decorationWrite);
  for (let offset = 0, index = 0; offset < width; offset += 2, index += 1) {
    buffer.addBox(
      "foliage",
      x + offset,
      y + 2,
      z,
      2,
      2 + (index % 2),
      2,
      shade + index,
      decorationWrite
    );
  }
}

function addRoof(buffer, building, xStart, zBack, zFront) {
  const roofPlan = roofPlanForBuilding(building);
  const roofWrite = { priority: VOXEL_WRITE_PRIORITIES.roof, owner: `${building.id}:roof` };
  roofPlan.surface.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.roof, xStart + voxel.x, voxel.y, zBack + voxel.z, index, roofWrite);
  });
  roofPlan.endCaps.left.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 101, roofWrite);
  });
  roofPlan.endCaps.right.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 211, roofWrite);
  });
  roofPlan.edgeCaps.back.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 307, roofWrite);
  });
  roofPlan.edgeCaps.front.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 409, roofWrite);
  });

  roofPlan.ridgeCells.forEach((ridgeCell, index) => {
    buffer.addVoxel(
      building.materials.metal,
      xStart + ridgeCell.x,
      ridgeCell.y + 1,
      zBack + ridgeCell.z,
      index + 47,
      { priority: VOXEL_WRITE_PRIORITIES.trim, owner: `${building.id}:ridge` }
    );
  });

  const dormerLocalZ = Math.max(4, building.roof.depthVoxels - 7);
  const dormerCenters = building.footprint.widthVoxels >= 24
    ? [Math.round(building.footprint.widthVoxels * 0.28), Math.round(building.footprint.widthVoxels * 0.72)]
    : [Math.round(building.footprint.widthVoxels * 0.5)];
  dormerCenters.forEach((center, index) => {
    const dormerRoofY = roofSurfaceYAt(roofPlan, dormerLocalZ, center);
    addDormer(
      buffer,
      xStart + center - 3,
      dormerRoofY - 2,
      zBack + dormerLocalZ,
      building.materials.trim,
      index + building.index * 3
    );
  });
}

function addDormer(buffer, x, y, z, trim, shade) {
  const write = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "dormer" };
  buffer.addBox("slate", x - 1, y, z - 2, 8, 7, 4, shade, write);
  buffer.addBox("warmWindow", x + 1, y + 2, z + 2, 4, 3, 1, shade + 1, write);
  buffer.addBox(trim, x, y + 1, z + 1, 1, 5, 2, shade + 2, write);
  buffer.addBox(trim, x + 5, y + 1, z + 1, 1, 5, 2, shade + 3, write);
  buffer.addBox(trim, x, y + 5, z + 1, 6, 1, 2, shade + 4, write);
}

function addChimneys(buffer, building, xStart, zBack) {
  const roofPlan = roofPlanForBuilding(building);
  const roofWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: `${building.id}:chimneys` };
  building.roof.chimneys.forEach((chimney, index) => {
    const localX = Math.round(clamp(chimney.xRatio, 0.08, 0.82) * (building.footprint.widthVoxels - 4));
    const localZ = Math.round(clamp(chimney.zRatio, 0.08, 0.82) * (building.roof.depthVoxels - 4));
    const top = roofSurfaceYAt(roofPlan, localZ, localX) - 1;
    const chimneyHeight = Math.max(8, chimney.height);
    buffer.addBox(building.materials.wall, xStart + localX, top, zBack + localZ, 4, chimneyHeight, 4, index, roofWrite);
    buffer.addBox(
      building.materials.trim,
      xStart + localX - 1,
      top + chimneyHeight - 1,
      zBack + localZ - 1,
      6,
      2,
      6,
      index + 1,
      roofWrite
    );
    buffer.addBox(
      building.materials.wall,
      xStart + localX,
      top + chimneyHeight + 1,
      zBack + localZ,
      1,
      3,
      1,
      index + 2,
      roofWrite
    );
    buffer.addBox(
      building.materials.wall,
      xStart + localX + 2,
      top + chimneyHeight + 1,
      zBack + localZ + 2,
      1,
      3,
      1,
      index + 3,
      roofWrite
    );
  });
}

function addMagicDecoration(buffer, building, params, xStart, zFront) {
  const slot = building.decorations.magicWindow;
  if (slot) {
    const module = building.facade.floors[slot.floor]?.modules.find((candidate) => candidate.bay === slot.bay);
    if (module?.opening) {
      const center = Math.round((module.opening.xStart + module.opening.xEnd) / 2);
      const y = slot.floor * building.floorHeight + module.opening.yStart + 2;
      const floorFront = zFront - building.floorSpecs[slot.floor].frontSetbackVoxels;
      const effectWrite = { priority: VOXEL_WRITE_PRIORITIES.effect, owner: `${building.id}:magic-window` };
      buffer.addBox(building.materials.magicPrimary, xStart + center - 1, y, floorFront + 2, 2, 6, 1, 70, effectWrite);
      buffer.addVoxel(building.materials.magicSecondary, xStart + center - 3, y + 1, floorFront + 2, 71, effectWrite);
      buffer.addVoxel(building.materials.magicSecondary, xStart + center + 2, y + 4, floorFront + 2, 72, effectWrite);
    }
  }
  if (building.decorations.greenery > 0.72) {
    const rightSide = building.index % 2 === 1;
    const localX = rightSide ? building.footprint.widthVoxels - 3 : 1;
    buffer.addBox(
      "foliage",
      xStart + localX,
      7,
      zFront + 2,
      2,
      16,
      2,
      73 + building.index,
      { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: `${building.id}:greenery` }
    );
  }
}

function addPartyWallExposures(buffer, plan) {
  let added = 0;
  for (let index = 0; index < plan.buildings.length - 1; index += 1) {
    const left = plan.buildings[index];
    const right = plan.buildings[index + 1];
    const leftRoof = roofPlanForBuilding(left);
    const rightRoof = roofPlanForBuilding(right);
    const boundaryX = right.origin.x;
    const depth = Math.min(left.roof.depthVoxels, right.roof.depthVoxels);
    for (let localZ = 0; localZ < depth; localZ += 1) {
      const leftEnvelope = roofSurfaceYAt(leftRoof, localZ, left.footprint.widthVoxels - 1) + 1;
      const rightEnvelope = roofSurfaceYAt(rightRoof, localZ, 0) + 1;
      if (leftEnvelope === rightEnvelope) continue;
      const taller = leftEnvelope > rightEnvelope ? left : right;
      const lowerEnvelope = Math.min(leftEnvelope, rightEnvelope);
      const upperEnvelope = Math.max(leftEnvelope, rightEnvelope);
      const x = taller === left ? boundaryX - 1 : boundaryX;
      const z = taller.origin.z + localZ;
      for (let y = lowerEnvelope; y < upperEnvelope - 1; y += 1) {
        buffer.addVoxel(
          taller.materials.wall,
          x,
          y,
          z,
          index * 1000 + localZ * 20 + y,
          { priority: VOXEL_WRITE_PRIORITIES.roof, owner: `${taller.id}:party-wall-exposure` }
        );
        added += 1;
      }
    }
  }
  return added;
}

function roofPlanForBuilding(building) {
  return planVoxelRoof({
    form: building.roof.form,
    width: building.footprint.widthVoxels,
    depth: building.roof.depthVoxels,
    baseY: building.wallHeightVoxels,
    overhang: building.roof.overhang,
    thickness: building.roof.thickness,
    ridgeRatio: building.roof.ridgeRatio,
    ridgeHeight: building.roof.ridgeHeight,
    capLeft: building.adjacency.exposedLeftWall,
    capRight: building.adjacency.exposedRightWall
  });
}

function roofSurfaceYAt(roofPlan, localZ, localX = Math.floor(roofPlan.width / 2)) {
  const x = Math.round(clamp(localX, 0, roofPlan.width - 1));
  const z = Math.round(clamp(localZ, 0, roofPlan.depth - 1));
  return roofPlan.heightField.find((cell) => cell.x === x && cell.z === z)?.y ?? roofPlan.baseY;
}

function addStreetLamps(root, plan) {
  const lamps = [];
  const xStart = -plan.streetWidthVoxels / 2;
  for (let index = 0; index <= plan.buildings.length; index += 1) {
    const x = (xStart + index * plan.parcel.width) * VOXEL_SIZE;
    const z = (plan.parcel.depth / 2 + 7) * VOXEL_SIZE;
    const group = new THREE.Group();
    group.name = `VoxelStreetLamp-${index + 1}`;
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(VOXEL_SIZE * 1.2, VOXEL_SIZE * 22, VOXEL_SIZE * 1.2),
      new THREE.MeshStandardMaterial({ color: "#252b31", roughness: 0.78, metalness: 0.25 })
    );
    post.position.y = VOXEL_SIZE * 11;
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: "#f5c878",
      emissive: "#f2a94f",
      emissiveIntensity: 0.25,
      roughness: 0.45
    });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(VOXEL_SIZE * 4, VOXEL_SIZE * 5, VOXEL_SIZE * 4), bulbMaterial);
    bulb.position.y = VOXEL_SIZE * 24;
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(VOXEL_SIZE * 3.1, VOXEL_SIZE * 3, 4),
      new THREE.MeshStandardMaterial({ color: "#252b31", roughness: 0.78, metalness: 0.25 })
    );
    cap.position.y = VOXEL_SIZE * 28;
    cap.rotation.y = Math.PI / 4;
    const light = new THREE.PointLight("#f2aa55", 0, 5.5, 2);
    light.position.y = VOXEL_SIZE * 24;
    group.position.set(x, 0, z);
    group.add(post, bulb, cap, light);
    root.add(group);
    lamps.push({ light, bulb });
  }
  return lamps;
}

function addWindowLights(root, plan) {
  return plan.buildings.flatMap((building) => {
    const lights = [];
    const frontLight = new THREE.PointLight("#f2aa55", 0, 6, 2);
    frontLight.position.set(
      (building.origin.x + building.footprint.widthVoxels / 2) * VOXEL_SIZE,
      VOXEL_SIZE * 10,
      VOXEL_SIZE * (building.origin.z + building.footprint.depthVoxels + 4)
    );
    root.add(frontLight);
    lights.push(frontLight);
    Object.keys(building.sideFacades).forEach((side) => {
      const sideLight = new THREE.PointLight("#f2aa55", 0, 6, 2);
      sideLight.position.set(
        VOXEL_SIZE * (
          side === "left"
            ? building.origin.x - 4
            : building.origin.x + building.footprint.widthVoxels + 4
        ),
        VOXEL_SIZE * 10,
        VOXEL_SIZE * (building.origin.z + building.footprint.depthVoxels / 2)
      );
      root.add(sideLight);
      lights.push(sideLight);
    });
    return lights;
  });
}

function isFrontOpening(localX, y, building) {
  const floor = Math.floor(y / building.floorHeight);
  const localY = y % building.floorHeight;
  const floorPlan = building.facade.floors[floor];
  if (!floorPlan) return false;
  return floorPlan.modules.some((module) => (
    module.opening
    && localX >= module.opening.xStart
    && localX <= module.opening.xEnd
    && localY >= module.opening.yStart
    && localY <= module.opening.yEnd
  ));
}

function isSideOpening(localZ, y, building, side) {
  const floor = Math.floor(y / building.floorHeight);
  const localY = y % building.floorHeight;
  const floorPlan = building.sideFacades[side]?.floors[floor];
  const floorSpec = building.floorSpecs[floor];
  if (!floorPlan || !floorSpec || localZ >= building.footprint.depthVoxels - floorSpec.frontSetbackVoxels) {
    return false;
  }
  return floorPlan.modules.some((module) => (
    module.opening
    && module.opening.xEnd < building.footprint.depthVoxels - floorSpec.frontSetbackVoxels - 1
    && localZ >= module.opening.xStart
    && localZ <= module.opening.xEnd
    && localY >= module.opening.yStart
    && localY <= module.opening.yEnd
  ));
}

function hashNumber(...values) {
  let hash = 2166136261;
  const text = values.join(":");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Voxel, face-cell, and massing coordinates stay within a bounded world, so
// they are packed into exact numeric keys instead of allocating "x,y,z"
// strings. Map/Set preserve insertion order for any key type, so this changes
// neither the traversal order nor the generated geometry — it only removes the
// string hashing and allocation churn from the hot voxel write/merge paths.
const VOXEL_KEY_OFFSET = 4096;
const VOXEL_KEY_STRIDE = 8193; // 2 * OFFSET + 1, bijective over [-OFFSET, OFFSET-1]
const FACE_CELL_STRIDE = 8193;
const FACE_PLANE_OFFSET = 8192;
const FACE_PLANE_STRIDE = 16384; // 2 * PLANE_OFFSET
const MASSING_KEY_OFFSET = 4096;
const MASSING_KEY_STRIDE = 8193;

function voxelKey(x, y, z) {
  return ((x + VOXEL_KEY_OFFSET) * VOXEL_KEY_STRIDE + (y + VOXEL_KEY_OFFSET)) * VOXEL_KEY_STRIDE + (z + VOXEL_KEY_OFFSET);
}

function faceCellKey(u, v) {
  return (u + VOXEL_KEY_OFFSET) * FACE_CELL_STRIDE + (v + VOXEL_KEY_OFFSET);
}

function massingPointKey(x, z) {
  return (x + MASSING_KEY_OFFSET) * MASSING_KEY_STRIDE + (z + MASSING_KEY_OFFSET);
}

function parseMassingPoint(key) {
  const x = Math.floor(key / MASSING_KEY_STRIDE) - MASSING_KEY_OFFSET;
  const z = (key % MASSING_KEY_STRIDE) - MASSING_KEY_OFFSET;
  return [x, z];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function enumIndex(values, requestedName, fallbackIndex) {
  const namedIndex = values.indexOf(requestedName);
  if (namedIndex >= 0) return namedIndex;
  return Math.round(clamp(fallbackIndex, 0, values.length - 1));
}

function normalizeConfiguredFloorPrograms(
  source,
  requestedFloors,
  archetype,
  windowRatio,
  forceGlobalWindowRatio = false
) {
  const programs = Array.isArray(source) ? source : [];
  const count = Math.max(5, requestedFloors);
  return Array.from({ length: count }, (_, index) => {
    const explicit = programs[index];
    const previous = programs[index - 1] ?? programs.at(-1);
    const fallbackPurpose = index === 0
      ? (archetype === "magic_shop" ? "shop" : archetype === "workshop" ? "workshop" : "home")
      : (archetype === "workshop" ? "workshop" : "home");
    const purpose = FLOOR_USE_IDS.includes(explicit?.purpose ?? explicit?.use)
      ? (explicit.purpose ?? explicit.use)
      : (FLOOR_USE_IDS.includes(previous?.purpose ?? previous?.use)
        ? (previous.purpose ?? previous.use)
        : fallbackPurpose);
    return {
      purpose,
      setbackVoxels: index === 0
        ? 0
        : Math.round(clamp(explicit?.setbackVoxels ?? explicit?.setback ?? 0, 0, 6)),
      balcony: index === 0 || !FLOOR_BALCONY_IDS.includes(explicit?.balcony)
        ? "none"
        : explicit.balcony,
      windowRatio: clamp(
        forceGlobalWindowRatio ? windowRatio : (explicit?.windowRatio ?? windowRatio),
        0.15,
        0.9
      )
    };
  });
}

function archetypeForFloorPurpose(purpose) {
  if (purpose === "shop") return "magic_shop";
  if (purpose === "workshop") return "workshop";
  return "townhouse";
}

function linearTentRise(index, span, ridgeRatio, ridgeHeight) {
  const ridgeIndex = Math.round((span - 1) * clamp(ridgeRatio, 0, 1));
  if (index <= ridgeIndex) {
    return ridgeIndex === 0 ? ridgeHeight : Math.round(ridgeHeight * clamp(index / ridgeIndex, 0, 1));
  }
  const run = span - 1 - ridgeIndex;
  return run === 0
    ? ridgeHeight
    : Math.round(ridgeHeight * clamp((span - 1 - index) / run, 0, 1));
}
