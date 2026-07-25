import { createRng } from "../utils/random.js";

export const BUILDING_SPEC_VERSION = "0.2";
export const FLOOR_USE_IDS = Object.freeze(["shop", "home", "workshop", "storage"]);
export const FLOOR_BALCONY_IDS = Object.freeze(["none", "selective", "full"]);
export const ROOF_FORM_IDS = Object.freeze(["gable_street", "gable_cross", "hip"]);

export const BUILDING_ARCHETYPES = Object.freeze({
  townhouse: Object.freeze({
    id: "townhouse",
    label: "Townhouse",
    preferredBays: 3,
    groundPurpose: "home",
    upperPurpose: "home",
    groundModules: ["window", "entrance"],
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
  const requestedArchetype = resolveArchetype(options.archetype);
  const style = resolveStyleKit(options.style);
  const floorSpecs = planFloorStack({
    seed: stableSeed(seed, id, "floors"),
    floors,
    floorHeight,
    depthVoxels,
    archetype: requestedArchetype,
    floorPrograms: options.floorPrograms,
    windowRatio: options.windowRatio
  });
  const archetype = resolveArchetype(archetypeIdForPurpose(floorSpecs[0].purpose));
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
    archetype,
    floorSpecs
  });
  const requestedSideFacadeSides = normalizeSideFacadeSides(options.sideFacadeSides);
  const sideFacades = Object.fromEntries(
    requestedSideFacadeSides
      .filter((side) => (
        side === "left"
          ? adjacency.exposedLeftWall
          : adjacency.exposedRightWall
      ))
      .map((side) => [side, planFacadeGrammar({
        seed: stableSeed(seed, id, "facade", side),
        width: depthVoxels,
        depth: widthVoxels,
        floors,
        floorHeight,
        variation,
        archetype,
        floorSpecs
      })])
  );
  const materials = planMaterials(style, stableSeed(seed, id, "materials"));
  const roof = planRoofGrammar({
    seed: stableSeed(seed, id, "roof"),
    depth: depthVoxels - floorSpecs.at(-1).frontSetbackVoxels,
    archetype,
    style,
    ridgePosition: options.ridgePosition,
    roofForm: options.roofForm
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
    floorSpecs,
    wallHeightVoxels: floors * floorHeight,
    facade,
    sideFacades,
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
      sideEntrances: Object.entries(sideFacades).flatMap(([side, sideFacade]) => {
        const entranceModule = sideFacade.floors[0]?.modules.find((module) => (
          module.type === "entrance" || module.type === "service_door"
        ));
        return entranceModule?.opening
          ? [{
              face: side,
              bay: entranceModule.bay,
              x: side === "left" ? 0 : widthVoxels - 1,
              y: 0,
              z: Math.round((entranceModule.opening.xStart + entranceModule.opening.xEnd) / 2)
            }]
          : [];
      }),
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
  const floorSpecs = options.floorSpecs ?? planFloorStack({
    seed: stableSeed(options.seed || "facade-001", "floors"),
    floors,
    floorHeight,
    depthVoxels: options.depth ?? 36,
    archetype,
    floorPrograms: options.floorPrograms,
    windowRatio: options.windowRatio
  });
  const seed = String(options.seed || "facade-001");
  const rhythmRng = createRng(stableSeed(seed, "rhythm"));
  const maximumBays = Math.max(2, Math.floor((width - 4) / 6));
  const bayNudge = variation > 0.55 ? choose(rhythmRng, [-1, 0, 0, 1]) : 0;
  const bayCount = clampInteger(archetype.preferredBays + bayNudge, 2, maximumBays);
  const bays = distributeBays(width, bayCount);
  const entranceRng = createRng(stableSeed(seed, "entrance"));
  const entranceBay = floorSpecs[0].purpose === "workshop"
    ? (entranceRng() < 0.5 ? 0 : bayCount - 1)
    : Math.floor(entranceRng() * bayCount);
  const symmetry = Number((1 - variation * (0.18 + rhythmRng() * 0.38)).toFixed(3));
  const floorPlans = Array.from({ length: floors }, (_, floor) => {
    const floorRng = createRng(stableSeed(seed, "floor", floor));
    const floorSpec = floorSpecs[floor];
    const selectiveBalconyBay = floorSpec.balcony === "selective"
      ? Math.floor(floorRng() * bayCount)
      : -1;
    return {
      index: floor,
      y: floor * floorHeight,
      purpose: floorSpec.purpose,
      frontSetbackVoxels: floorSpec.frontSetbackVoxels,
      balcony: floorSpec.balcony,
      windowRatio: floorSpec.windowRatio,
      modules: bays.map((bay) => planFloorModule({
        bay,
        floor,
        entranceBay,
        floorHeight,
        floorSpec,
        archetype,
        variation,
        rng: floorRng,
        selectiveBalconyBay
      }))
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

export function planFloorStack(options = {}) {
  const floors = clampInteger(options.floors ?? 1, 1, 12);
  const floorHeight = clampInteger(options.floorHeight ?? 20, 12, 28);
  const depthVoxels = clampInteger(options.depthVoxels ?? 36, 16, 64);
  const archetype = resolveArchetype(options.archetype);
  const programs = Array.isArray(options.floorPrograms) ? options.floorPrograms : [];
  const defaultWindowRatio = clampNumber(options.windowRatio ?? 0.58, 0.15, 0.9);
  let cumulativeSetback = 0;
  return Array.from({ length: floors }, (_, index) => {
    const explicit = programs[index];
    const source = explicit ?? {
      ...(programs.at(-1) ?? {}),
      setbackVoxels: 0,
      setback: 0,
      balcony: "none"
    };
    const fallbackPurpose = index === 0 ? archetype.groundPurpose : archetype.upperPurpose;
    const purpose = FLOOR_USE_IDS.includes(source.purpose ?? source.use)
      ? (source.purpose ?? source.use)
      : normalizeFloorPurpose(fallbackPurpose);
    const setbackStep = index === 0
      ? 0
      : clampInteger(source.setbackVoxels ?? source.setback ?? 0, 0, 6);
    cumulativeSetback = Math.min(cumulativeSetback + setbackStep, Math.max(0, depthVoxels - 16));
    const balcony = index === 0 || !FLOOR_BALCONY_IDS.includes(source.balcony)
      ? "none"
      : source.balcony;
    return {
      index,
      heightVoxels: floorHeight,
      purpose,
      setbackVoxels: setbackStep,
      frontSetbackVoxels: cumulativeSetback,
      balcony,
      windowRatio: clampNumber(source.windowRatio ?? defaultWindowRatio, 0.15, 0.9),
      seed: stableSeed(options.seed || "floor-stack-001", index)
    };
  });
}

function planFloorModule({
  bay,
  floor,
  entranceBay,
  floorHeight,
  floorSpec,
  archetype,
  variation,
  rng,
  selectiveBalconyBay
}) {
  const isGroundEntrance = floor === 0 && bay.index === entranceBay;
  if (floorSpec.purpose === "storage" && rng() < 0.45 + variation * 0.25) {
    return { bay: bay.index, type: "blank", opening: null };
  }
  let type;
  if (isGroundEntrance) {
    type = floorSpec.purpose === "workshop" ? "service_door" : "entrance";
  } else if (floorSpec.purpose === "shop") {
    type = "shop_window";
  } else if (floorSpec.purpose === "workshop") {
    type = "workshop_window";
  } else if (floorSpec.purpose === "storage") {
    type = "small_window";
  } else {
    type = floor === 0 ? "window" : "upper_window";
  }
  const ratio = type === "small_window"
    ? Math.min(0.35, floorSpec.windowRatio)
    : floorSpec.windowRatio;
  const availableWidth = Math.max(2, bay.width - 2);
  const openingWidth = type === "entrance" || type === "service_door"
    ? Math.min(5, availableWidth)
    : Math.max(2, Math.round(availableWidth * ratio));
  const start = bay.start + Math.floor((bay.width - openingWidth) / 2);
  const end = start + openingWidth - 1;
  const availableHeight = floorHeight - 7;
  const openingHeight = type === "entrance" || type === "service_door"
    ? Math.min(14, availableHeight)
    : Math.max(4, Math.round(availableHeight * (0.35 + ratio * 0.65)));
  const yStart = type === "entrance" || type === "service_door"
    ? 2
    : Math.max(4, Math.round((floorHeight - openingHeight) / 2));
  const yEnd = Math.min(floorHeight - 4, yStart + openingHeight - 1);
  return {
    bay: bay.index,
    type,
    opening: {
      xStart: start,
      xEnd: end,
      yStart,
      yEnd
    },
    balcony: floorSpec.balcony === "selective" && bay.index === selectiveBalconyBay,
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

function planRoofGrammar({ seed, depth, archetype, style, ridgePosition, roofForm }) {
  const rng = createRng(seed);
  const [minimumPitch, maximumPitch] = style.roofPitchRange;
  const pitch = minimumPitch + (maximumPitch - minimumPitch) * (0.35 + rng() * 0.65);
  const ridgeHeight = Math.max(6, Math.round(depth * pitch));
  const chimneys = Array.from(
    { length: archetype.id === "workshop" ? 2 : (rng() < 0.55 ? 2 : 1) },
    (_, index) => ({
      xRatio: Number((0.2 + ((index + 0.5) / 2) * 0.6 + (rng() - 0.5) * 0.08).toFixed(3)),
      zRatio: Number((0.28 + index * 0.35 + (rng() - 0.5) * 0.08).toFixed(3)),
      height: 10 + Math.round(rng() * 4)
    })
  );
  return {
    grammar: "voxel-roof-heightfield-v0.3",
    type: "pitched",
    form: ROOF_FORM_IDS.includes(roofForm) ? roofForm : "gable_street",
    seed,
    depthVoxels: depth,
    overhang: 1,
    thickness: 1,
    ridgeRatio: clampNumber(ridgePosition ?? 0.5, 0, 1),
    ridgeHeight,
    backExponent: 1,
    frontExponent: 1,
    chimneys
  };
}

function planDecorations({ seed, floors, facade, variation, archetype, style, detailDensity }) {
  const density = clampNumber(detailDensity ?? variation, 0, 1);
  const upperFloors = facade.floors.slice(1);
  const candidateWindows = upperFloors.flatMap((floor) => (
    floor.modules
      .filter((module) => module.opening && module.type !== "entrance" && module.type !== "service_door")
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
    signBay: facade.floors[0]?.purpose === "shop" ? facade.entranceBay : null,
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

function normalizeSideFacadeSides(value) {
  const sides = Array.isArray(value)
    ? value
    : (value === "both" ? ["left", "right"] : [value]);
  return [...new Set(sides.filter((side) => side === "left" || side === "right"))];
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

function normalizeFloorPurpose(value) {
  if (value === "atelier") return "workshop";
  return FLOOR_USE_IDS.includes(value) ? value : "home";
}

function archetypeIdForPurpose(purpose) {
  if (purpose === "shop") return "magic_shop";
  if (purpose === "workshop") return "workshop";
  return "townhouse";
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clampNumber(value, minimum, maximum));
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}
