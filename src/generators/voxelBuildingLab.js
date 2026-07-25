import * as THREE from "three";
import {
  BUILDING_ARCHETYPE_IDS,
  BUILDING_SPEC_VERSION,
  FLOOR_BALCONY_IDS,
  FLOOR_USE_IDS,
  ROOF_FORM_IDS,
  VOXEL_STYLE_KIT_IDS,
  createBuildingSpec
} from "./voxelBuildingGrammar.js";

export const VOXEL_SIZE = 0.125;
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
    metalness: 0.05
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
  pavement: {
    colors: ["#aaa49a", "#b9b2a6", "#96938e"],
    roughness: 1
  },
  road: {
    colors: ["#686b70", "#74767a", "#5e6268"],
    roughness: 1
  }
});

export const VOXEL_BUILDING_PRESETS = Object.freeze({
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
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 0, balcony: "selective" },
      { purpose: "home", setbackVoxels: 0, balcony: "none" }
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
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" },
      { purpose: "home", setbackVoxels: 0, balcony: "none" }
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
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 0, balcony: "selective" },
      { purpose: "home", setbackVoxels: 2, balcony: "none" },
      { purpose: "home", setbackVoxels: 0, balcony: "selective" }
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
      { purpose: "home", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 0, balcony: "selective" },
      { purpose: "home", setbackVoxels: 2, balcony: "none" }
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
      { purpose: "shop", setbackVoxels: 0, balcony: "none" },
      { purpose: "home", setbackVoxels: 2, balcony: "full" },
      { purpose: "home", setbackVoxels: 0, balcony: "selective" }
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
      { purpose: "workshop", setbackVoxels: 0, balcony: "none" },
      { purpose: "storage", setbackVoxels: 2, balcony: "none" }
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
    windowRatio
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
    detailDensity: clamp(base.detailDensity, 0, 1)
  };
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
      pipeline: ["BuildingSpec", "floor stack", "facade bays", "2D roof height field", "decorations", "voxel field"],
      stableSubSeeds: true,
      archetypes: BUILDING_ARCHETYPE_IDS,
      styleKits: VOXEL_STYLE_KIT_IDS,
      floorPurposes: FLOOR_USE_IDS,
      floorBalconies: FLOOR_BALCONY_IDS,
      roofForms: ROOF_FORM_IDS,
      cornerFacadeModes: CORNER_FACADE_MODE_IDS
    },
    roofSystem: {
      type: "two-dimensional voxel height field",
      forms: ROOF_FORM_IDS,
      parameters: ["width", "depth", "ridge height", "ridge position 0..1", "overhang", "thickness"],
      extremes: "gable ridge positions 0 and 1 become opposite mono-pitch roofs",
      endCaps: "left/right and front/back closures are height-field-derived; party-wall exposure samples the shared boundary"
    },
    agentControl: {
      simple: ["floorPrograms", "footprint", "style", "roofForm", "ridgePosition", "cornerFacades", "windowRatio"],
      advanced: ["floor purpose", "floor setback", "floor balcony", "facade.rhythm", "component materials", "decoration slots"],
      decoration: "sparse voxel patches applied after deterministic generation"
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
  const plan = planVoxelStreet(params);
  const root = new THREE.Group();
  root.name = "VoxelBuildingLab";

  const buffer = new VoxelInstanceBuffer(params.seed);
  addStreetBase(buffer, plan);
  plan.buildings.forEach((building) => addBuilding(buffer, building, params));
  const exposedPartyWallVoxels = addPartyWallExposures(buffer, plan);

  const materialMeshes = buffer.createMeshes();
  materialMeshes.forEach((mesh) => root.add(mesh));

  const lamps = addStreetLamps(root, plan);
  const windowLights = addWindowLights(root, plan);
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
  };
  root.userData.updateDaylight(voxelDaylightStyle(params.sunTime));
  return root;
}

export function voxelDaylightStyle(sunTime = 0.52) {
  const time = clamp(sunTime, 0, 1);
  const noon = Math.sin(time * Math.PI);
  const nightFactor = Math.pow(1 - noon, 1.35);
  const skyColor = new THREE.Color("#172238").lerp(new THREE.Color("#c5deea"), noon);
  const sunColor = new THREE.Color("#e39a66").lerp(new THREE.Color("#fff0cc"), noon);
  return {
    sunColor,
    skyColor,
    rgbTint: new THREE.Color("#8d83b8").lerp(new THREE.Color("#fff7e8"), noon),
    ambientSky: new THREE.Color("#27314a").lerp(new THREE.Color("#e5f2f5"), noon),
    ambientGround: new THREE.Color("#242c37").lerp(new THREE.Color("#9da992"), noon),
    ambientIntensity: 0.48 + noon * 1.85,
    sunIntensity: 0.22 + noon * 2.5,
    rimIntensity: 0.55 + nightFactor * 0.9,
    nightFactor,
    sunPosition: new THREE.Vector3(-8 + time * 16, 2 + noon * 10, 7)
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
  constructor(seed) {
    this.seed = seed;
    this.voxels = new Map();
    this.visibleInstances = null;
    this.instanceCount = 0;
    this.occupiedVoxelCount = 0;
    this.overwrittenVoxelCount = 0;
    this.rejectedVoxelCount = 0;
    this.culledInteriorVoxelCount = 0;
  }

  addVoxel(materialId, x, y, z, shadeKey = 0, options = {}) {
    if (!MATERIAL_LIBRARY[materialId]) throw new Error(`Unknown voxel material: ${materialId}`);
    const position = {
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z)
    };
    const key = voxelKey(position.x, position.y, position.z);
    const current = this.voxels.get(key);
    const priority = Number(options.priority ?? 0);
    if (current && current.priority > priority) {
      this.rejectedVoxelCount += 1;
      return false;
    }
    if (current) this.overwrittenVoxelCount += 1;
    this.voxels.set(key, {
      ...position,
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

  createMeshes() {
    const dummy = new THREE.Object3D();
    return [...this.getVisibleInstances()].map(([materialId, instances]) => {
      const definition = MATERIAL_LIBRARY[materialId];
      const material = new THREE.MeshStandardMaterial({
        color: definition.colors[0],
        roughness: definition.roughness,
        metalness: definition.metalness ?? 0,
        emissive: definition.emissive ?? "#000000",
        emissiveIntensity: definition.emissiveIntensity ?? 0,
        flatShading: true
      });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, instances.length);
      mesh.name = `VoxelMaterial-${materialId}`;
      mesh.userData.materialId = materialId;
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      instances.forEach((instance, index) => {
        const gap = 0.985;
        dummy.position.set(
          (instance.x + 0.5) * VOXEL_SIZE,
          (instance.y + 0.5) * VOXEL_SIZE,
          (instance.z + 0.5) * VOXEL_SIZE
        );
        dummy.scale.set(
          VOXEL_SIZE * gap,
          VOXEL_SIZE * gap,
          VOXEL_SIZE * gap
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    });
  }
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

function voxelKey(x, y, z) {
  return `${x},${y},${z}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function enumIndex(values, requestedName, fallbackIndex) {
  const namedIndex = values.indexOf(requestedName);
  if (namedIndex >= 0) return namedIndex;
  return Math.round(clamp(fallbackIndex, 0, values.length - 1));
}

function normalizeConfiguredFloorPrograms(source, requestedFloors, archetype, windowRatio) {
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
      windowRatio: clamp(windowRatio, 0.15, 0.9)
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
