import { createRng } from "../utils/random.js";

export const BUILDING_SPEC_VERSION = "0.1";

export const BUILDING_ARCHETYPES = Object.freeze({
  townhouse: Object.freeze({
    id: "townhouse",
    label: "Townhouse",
    preferredBays: 3,
    groundPurpose: "home",
    upperPurpose: "home",
    groundModules: ["window", "entrance"],
    roofTypes: ["gable", "mansard"],
    balconyChance: 0.2,
    flowerBoxChance: 0.55,
    magicWindowChance: 0.08
  }),
  magic_shop: Object.freeze({
    id: "magic_shop",
    label: "Magic Shop",
    preferredBays: 4,
    groundPurpose: "shop",
    upperPurpose: "home",
    groundModules: ["shop_window", "entrance"],
    roofTypes: ["magic_asymmetric", "mansard", "gable"],
    balconyChance: 0.12,
    flowerBoxChance: 0.3,
    magicWindowChance: 1
  }),
  workshop: Object.freeze({
    id: "workshop",
    label: "Workshop",
    preferredBays: 3,
    groundPurpose: "workshop",
    upperPurpose: "atelier",
    groundModules: ["workshop_window", "service_door"],
    roofTypes: ["gable", "mansard"],
    balconyChance: 0.08,
    flowerBoxChance: 0.18,
    magicWindowChance: 0.25
  })
});

export const VOXEL_STYLE_KITS = Object.freeze({
  london_brick: Object.freeze({
    id: "london_brick",
    label: "London Brick",
    wallChoices: ["brickRed", "brickBrown", "brickRed"],
    trimChoices: ["sandstone", "limestone"],
    roof: "slate",
    shopfront: "timber",
    window: "warmWindow",
    door: "timber",
    metal: "iron",
    magicPrimary: "violetMagic",
    magicSecondary: "tealMagic",
    roofTypes: ["gable", "mansard"],
    roofPitchRange: [0.3, 0.38],
    greeneryMultiplier: 0.85,
    magicMultiplier: 0.55
  }),
  violet_alchemist: Object.freeze({
    id: "violet_alchemist",
    label: "Violet Alchemist",
    wallChoices: ["brickBrown", "brickRed", "brickBrown"],
    trimChoices: ["limestone", "sandstone"],
    roof: "slate",
    shopfront: "timber",
    window: "warmWindow",
    door: "timber",
    metal: "iron",
    magicPrimary: "violetMagic",
    magicSecondary: "tealMagic",
    roofTypes: ["magic_asymmetric", "mansard", "gable"],
    roofPitchRange: [0.34, 0.44],
    greeneryMultiplier: 0.55,
    magicMultiplier: 1
  }),
  forest_craft: Object.freeze({
    id: "forest_craft",
    label: "Forest Craft",
    wallChoices: ["sandstone", "brickBrown", "sandstone"],
    trimChoices: ["timber", "sandstone"],
    roof: "slate",
    shopfront: "timber",
    window: "warmWindow",
    door: "timber",
    metal: "iron",
    magicPrimary: "tealMagic",
    magicSecondary: "violetMagic",
    roofTypes: ["gable", "mansard"],
    roofPitchRange: [0.32, 0.4],
    greeneryMultiplier: 1.45,
    magicMultiplier: 0.7
  })
});

export const BUILDING_ARCHETYPE_IDS = Object.freeze(Object.keys(BUILDING_ARCHETYPES));
export const VOXEL_STYLE_KIT_IDS = Object.freeze(Object.keys(VOXEL_STYLE_KITS));

export function createBuildingSpec(options = {}) {
  const seed = String(options.seed || "building-001");
  const id = String(options.id || "voxel-building-1");
  const widthVoxels = clampInteger(options.widthVoxels ?? 32, 20, 48);
  const depthVoxels = clampInteger(options.depthVoxels ?? 36, 24, 52);
  const baseFloors = clampInteger(options.baseFloors ?? options.floors ?? 3, 1, 8);
  const expandedBy = clampInteger(options.expandedBy ?? 0, 0, 4);
  const floors = baseFloors + expandedBy;
  const floorHeight = clampInteger(options.floorHeight ?? 20, 12, 28);
  const variation = clampNumber(options.variation ?? 0.65, 0, 1);
  const archetype = resolveArchetype(options.archetype);
  const style = resolveStyleKit(options.style);
  const adjacency = normalizeAdjacency(options.adjacency);
  const origin = {
    x: Math.round(options.origin?.x ?? 0),
    y: Math.round(options.origin?.y ?? 0),
    z: Math.round(options.origin?.z ?? -depthVoxels / 2)
  };
  const facade = planFacadeGrammar({
    seed: stableSeed(seed, id, "facade"),
    width: widthVoxels,
    floors,
    floorHeight,
    variation,
    archetype
  });
  const materials = planMaterials(style, stableSeed(seed, id, "materials"));
  const roof = planRoofGrammar({
    seed: stableSeed(seed, id, "roof"),
    depth: depthVoxels,
    variation,
    archetype,
    style,
    roofOverride: options.roofOverride
  });
  const decorations = planDecorations({
    seed: stableSeed(seed, id, "decorations"),
    floors,
    facade,
    variation,
    archetype,
    style,
    detailDensity: options.detailDensity
  });

  return {
    specVersion: BUILDING_SPEC_VERSION,
    id,
    index: Math.max(0, Math.round(options.index ?? 0)),
    seed,
    archetype: archetype.id,
    style: style.id,
    variation,
    origin,
    footprint: {
      widthVoxels,
      depthVoxels,
      worldWidth: widthVoxels * Number(options.voxelSize ?? 0.125),
      worldDepth: depthVoxels * Number(options.voxelSize ?? 0.125)
    },
    baseFloors,
    floors,
    expandedBy,
    floorHeight,
    floorSpecs: Array.from({ length: floors }, (_, floor) => ({
      index: floor,
      heightVoxels: floorHeight,
      purpose: floor === 0 ? archetype.groundPurpose : archetype.upperPurpose,
      seed: stableSeed(seed, id, "floor", floor)
    })),
    wallHeightVoxels: floors * floorHeight,
    facade,
    roof,
    materials,
    decorations,
    adjacency,
    ports: {
      entrance: {
        face: "south",
        bay: facade.entranceBay,
        x: facade.bays[facade.entranceBay]?.center ?? Math.floor(widthVoxels / 2),
        y: 0,
        z: depthVoxels - 1
      },
      verticalExpansion: { face: "up", floor: floors },
      leftPartyWall: Boolean(adjacency.left),
      rightPartyWall: Boolean(adjacency.right)
    }
  };
}

export function planFacadeGrammar(options = {}) {
  const width = clampInteger(options.width ?? 32, 20, 48);
  const floors = clampInteger(options.floors ?? 3, 1, 12);
  const floorHeight = clampInteger(options.floorHeight ?? 20, 12, 28);
  const variation = clampNumber(options.variation ?? 0.65, 0, 1);
  const archetype = resolveArchetype(options.archetype);
  const seed = String(options.seed || "facade-001");
  const rhythmRng = createRng(stableSeed(seed, "rhythm"));
  const maximumBays = Math.max(2, Math.floor((width - 4) / 6));
  const bayNudge = variation > 0.55 ? choose(rhythmRng, [-1, 0, 0, 1]) : 0;
  const bayCount = clampInteger(archetype.preferredBays + bayNudge, 2, maximumBays);
  const bays = distributeBays(width, bayCount);
  const entranceRng = createRng(stableSeed(seed, "entrance"));
  const entranceBay = archetype.id === "workshop"
    ? (entranceRng() < 0.5 ? 0 : bayCount - 1)
    : Math.floor(entranceRng() * bayCount);
  const symmetry = Number((1 - variation * (0.18 + rhythmRng() * 0.38)).toFixed(3));
  const floorPlans = Array.from({ length: floors }, (_, floor) => {
    const floorRng = createRng(stableSeed(seed, "floor", floor));
    return {
      index: floor,
      y: floor * floorHeight,
      modules: bays.map((bay) => (
        floor === 0
          ? planGroundModule(bay, entranceBay, archetype, floorHeight)
          : planUpperModule(bay, floor, floorHeight, archetype, variation, floorRng)
      ))
    };
  });

  return {
    grammar: "facade-bays-v0.1",
    rhythm: `${bayCount}-bay`,
    bayCount,
    entranceBay,
    symmetry,
    bays,
    floors: floorPlans
  };
}

export function stableSeed(seed, ...path) {
  return [String(seed), ...path.map(String)].join(":");
}

function planGroundModule(bay, entranceBay, archetype, floorHeight) {
  const isEntrance = bay.index === entranceBay;
  let type;
  if (isEntrance) {
    type = archetype.id === "workshop" ? "service_door" : "entrance";
  } else if (archetype.id === "magic_shop") {
    type = "shop_window";
  } else if (archetype.id === "workshop") {
    type = "workshop_window";
  } else {
    type = "window";
  }
  const inset = type === "workshop_window" ? 1 : 2;
  const start = bay.start + inset;
  const end = bay.start + bay.width - inset - 1;
  const yStart = type === "entrance" || type === "service_door" ? 2 : 4;
  const yEnd = type === "workshop_window" ? floorHeight - 4 : floorHeight - 5;
  return {
    bay: bay.index,
    type,
    opening: { xStart: start, xEnd: Math.max(start, end), yStart, yEnd }
  };
}

function planUpperModule(bay, floor, floorHeight, archetype, variation, rng) {
  const blankChance = variation * (archetype.id === "workshop" ? 0.22 : 0.08);
  if (rng() < blankChance) return { bay: bay.index, type: "blank", opening: null };
  const inset = bay.width >= 9 ? 2 : 1;
  const start = bay.start + inset;
  const end = bay.start + bay.width - inset - 1;
  return {
    bay: bay.index,
    type: "upper_window",
    opening: {
      xStart: start,
      xEnd: Math.max(start, end),
      yStart: 5,
      yEnd: Math.min(floorHeight - 5, 15)
    },
    balcony: floor === 1 && rng() < archetype.balconyChance * (0.55 + variation),
    flowerBox: rng() < archetype.flowerBoxChance * (0.5 + variation * 0.7)
  };
}

function distributeBays(width, count) {
  const margin = 2;
  const available = width - margin * 2;
  const baseWidth = Math.floor(available / count);
  const remainder = available % count;
  let cursor = margin;
  return Array.from({ length: count }, (_, index) => {
    const bayWidth = baseWidth + (index < remainder ? 1 : 0);
    const bay = {
      index,
      start: cursor,
      width: bayWidth,
      center: cursor + Math.floor(bayWidth / 2)
    };
    cursor += bayWidth;
    return bay;
  });
}

function planMaterials(style, seed) {
  const rng = createRng(seed);
  return {
    wall: choose(rng, style.wallChoices),
    trim: choose(rng, style.trimChoices),
    roof: style.roof,
    shopfront: style.shopfront,
    window: style.window,
    door: style.door,
    metal: style.metal,
    magicPrimary: style.magicPrimary,
    magicSecondary: style.magicSecondary
  };
}

function planRoofGrammar({ seed, depth, variation, archetype, style, roofOverride }) {
  const rng = createRng(seed);
  const allowed = archetype.roofTypes.filter((type) => style.roofTypes.includes(type));
  const candidates = allowed.length > 0 ? allowed : ["gable"];
  const type = candidates.includes(roofOverride) ? roofOverride : choose(rng, candidates);
  const [minimumPitch, maximumPitch] = style.roofPitchRange;
  const pitch = minimumPitch + (maximumPitch - minimumPitch) * (0.35 + rng() * 0.65);
  const ridgeHeight = Math.max(6, Math.round(depth * pitch));
  const asymmetry = type === "magic_asymmetric" ? 0.08 + variation * 0.08 : 0;
  const ridgeRatio = 0.5 + (rng() - 0.5) * asymmetry;
  const exponent = type === "mansard" ? 2.2 : 1;
  const chimneys = Array.from(
    { length: archetype.id === "workshop" ? 2 : (rng() < 0.55 ? 2 : 1) },
    (_, index) => ({
      xRatio: Number((0.2 + ((index + 0.5) / 2) * 0.6 + (rng() - 0.5) * 0.08).toFixed(3)),
      zRatio: Number((0.28 + index * 0.35 + (rng() - 0.5) * 0.08).toFixed(3)),
      height: 10 + Math.round(rng() * 4)
    })
  );
  return {
    grammar: "pitched-roof-v0.1",
    type,
    seed,
    overhang: 1,
    thickness: 1,
    ridgeRatio,
    ridgeHeight,
    backExponent: type === "magic_asymmetric" ? 1.2 + variation * 0.35 : exponent,
    frontExponent: type === "magic_asymmetric" ? 1.55 + variation * 0.55 : exponent,
    chimneys
  };
}

function planDecorations({ seed, floors, facade, variation, archetype, style, detailDensity }) {
  const density = clampNumber(detailDensity ?? variation, 0, 1);
  const upperFloors = facade.floors.slice(1);
  const candidateWindows = upperFloors.flatMap((floor) => (
    floor.modules
      .filter((module) => module.type === "upper_window")
      .map((module) => ({ floor: floor.index, bay: module.bay }))
  ));
  const magicChance = archetype.magicWindowChance * style.magicMultiplier * (0.35 + density * 0.65);
  const magicWindow = candidateWindows.find((candidate) => (
    createRng(stableSeed(seed, "magic-window", candidate.floor, candidate.bay))() < magicChance
  )) ?? null;
  return {
    density,
    greenery: clampNumber(density * style.greeneryMultiplier, 0, 1),
    magicWindow,
    signBay: archetype.groundPurpose === "shop" ? facade.entranceBay : null,
    roofDecoration: null,
    stableSlots: candidateWindows.map((candidate) => ({
      ...candidate,
      id: `floor-${candidate.floor}-bay-${candidate.bay}`
    }))
  };
}

function normalizeAdjacency(adjacency = {}) {
  return {
    left: adjacency.left ?? null,
    right: adjacency.right ?? null,
    exposedLeftWall: adjacency.exposedLeftWall ?? !adjacency.left,
    exposedRightWall: adjacency.exposedRightWall ?? !adjacency.right
  };
}

function resolveArchetype(value) {
  if (value && typeof value === "object" && value.id && BUILDING_ARCHETYPES[value.id]) {
    return BUILDING_ARCHETYPES[value.id];
  }
  return BUILDING_ARCHETYPES[value] ?? BUILDING_ARCHETYPES.townhouse;
}

function resolveStyleKit(value) {
  if (value && typeof value === "object" && value.id && VOXEL_STYLE_KITS[value.id]) {
    return VOXEL_STYLE_KITS[value.id];
  }
  return VOXEL_STYLE_KITS[value] ?? VOXEL_STYLE_KITS.london_brick;
}

function choose(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clampNumber(value, minimum, maximum));
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}
