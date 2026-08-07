import { VOXEL_MASSING_PRESETS } from "./voxelMassingGrammar.js";
import { createPublicBuildingStylePreset } from "./publicBuildingStyleComparison.js";
import {
  applyPublicBuildingVariation,
  createDistrictArchitectureContext,
  inferPublicBuildingProgram
} from "./voxelBuildingArchitecture.js";

export const BUILDING_INTENT_VERSION = "0.1";
export const BUILDING_COMPOSITION_IDS = Object.freeze(["street", "court", "hall", "tower", "yard"]);
export const BUILDING_FRONTAGE_IDS = Object.freeze([
  "residential",
  "display",
  "workshop",
  "institutional",
  "large_bay"
]);
export const BUILDING_ACCESS_IDS = Object.freeze(["private", "public", "service", "ceremonial"]);
export const BUILDING_PROMINENCE_IDS = Object.freeze(["ordinary", "important", "landmark"]);
export const BUILDING_STYLE_IDS = Object.freeze([
  "victorian_domestic",
  "victorian_gothic",
  "civic_classical",
  "industrial_iron",
  "alchemical_glass"
]);

export const BUILDING_SITE_PROFILES = Object.freeze({
  ordinary: Object.freeze({ widthCells: 2, depthCells: 2 }),
  important: Object.freeze({ widthCells: 3, depthCells: 2 }),
  landmark: Object.freeze({ widthCells: 5, depthCells: 3 })
});

const STREET_STYLE_BY_INTENT = Object.freeze({
  victorian_domestic: "london_brick",
  victorian_gothic: "violet_alchemist",
  civic_classical: "london_brick",
  industrial_iron: "forest_craft",
  alchemical_glass: "violet_alchemist"
});

const MASSING_PALETTE_BY_STYLE = Object.freeze({
  victorian_domestic: Object.freeze({ wall: "brickRed", trim: "sandstone", roof: "slate", frame: "timber", window: "warmWindow", door: "timber" }),
  victorian_gothic: Object.freeze({ wall: "brickBrown", trim: "sandstone", roof: "slate", frame: "iron", window: "violetMagic", door: "timber" }),
  civic_classical: Object.freeze({ wall: "sandstone", trim: "limestone", roof: "slate", frame: "limestone", window: "warmWindow", door: "timber" }),
  industrial_iron: Object.freeze({ wall: "brickBrown", trim: "iron", roof: "iron", frame: "iron", window: "lightGlass", door: "iron" }),
  alchemical_glass: Object.freeze({ wall: "brickBrown", trim: "patinaMetal", roof: "slate", frame: "patinaMetal", window: "tealMagic", door: "iron" })
});

export function normalizeBuildingIntent(input = {}) {
  const purpose = text(input.purpose, "mixed use");
  const frontage = enumValue(BUILDING_FRONTAGE_IDS, input.frontage, "residential");
  const prominence = enumValue(BUILDING_PROMINENCE_IDS, input.prominence, "ordinary");
  const defaultStyle = frontage === "institutional" || prominence === "landmark"
    ? "civic_classical"
    : "victorian_domestic";
  return {
    intentVersion: BUILDING_INTENT_VERSION,
    name: text(input.name, titleFromPurpose(purpose)),
    purpose,
    description: text(input.description, ""),
    signText: text(input.signText, ""),
    composition: enumValue(BUILDING_COMPOSITION_IDS, input.composition, "street"),
    frontage,
    access: enumValue(BUILDING_ACCESS_IDS, input.access, "private"),
    style: enumValue(BUILDING_STYLE_IDS, input.style, defaultStyle),
    prominence,
    magicLevel: clampNumber(input.magicLevel ?? 0.35, 0, 1),
    districtStyle: text(input.districtStyle ?? input.district_style, ""),
    variationIntent: text(input.variationIntent ?? input.variation_intent, "")
  };
}

export function adaptBuildingIntentToStreetConfig(input = {}, overrides = {}) {
  const intent = normalizeBuildingIntent(input);
  const groundPurpose = intent.frontage === "display"
    ? "shop"
    : intent.frontage === "workshop" || intent.frontage === "large_bay"
      ? "workshop"
      : "home";
  const floors = intent.prominence === "landmark" ? 4 : intent.prominence === "important" ? 3 : 2;
  const upperPurpose = groundPurpose === "workshop" ? "storage" : "home";
  const groundWindowRatio = intent.frontage === "display"
    ? 0.86
    : intent.frontage === "large_bay"
      ? 0.7
      : intent.frontage === "workshop"
        ? 0.58
        : intent.frontage === "institutional"
          ? 0.5
          : 0.38;
  const floorPrograms = Array.from({ length: floors }, (_, index) => ({
    purpose: index === 0 ? groundPurpose : upperPurpose,
    setbackVoxels: index > 1 && intent.prominence === "important" ? 2 : 0,
    balcony: index === 1 && intent.frontage === "display" ? "selective" : "none",
    windowRatio: index === 0 ? groundWindowRatio : upperPurpose === "storage" ? 0.28 : 0.38
  }));
  const style = STREET_STYLE_BY_INTENT[intent.style];
  const variationIntent = intent.variationIntent.toLowerCase();
  const roofForm = variationIntent.includes("hip") || variationIntent.includes("corner")
    ? "hip"
    : intent.composition === "hall" || intent.frontage === "large_bay"
      ? "gable_cross"
      : "gable_street";
  return {
    seed: text(overrides.seed, `${slug(intent.name)}-street`),
    sunTime: clampNumber(overrides.sunTime ?? 0.56, 0, 1),
    nightLighting: clampNumber(overrides.nightLighting ?? intent.magicLevel * 0.18, 0, 1),
    buildingCount: clampInteger(overrides.buildingCount ?? 2, 1, 3),
    floors,
    expansionFloors: 0,
    floorPrograms,
    style,
    materialScheme: ["london_brick", "violet_alchemist", "forest_craft"].indexOf(style),
    roofForm,
    cornerFacades: intent.access === "private" && !variationIntent.includes("corner") ? "right" : "both",
    ridgePosition: intent.style === "industrial_iron" ? 0.2 : 0.5,
    windowRatio: groundWindowRatio,
    variation: clampNumber(0.48 + intent.magicLevel * 0.35, 0, 1),
    parcelWidth: clampInteger(overrides.parcelWidth ?? 32, 24, 40),
    parcelDepth: clampInteger(overrides.parcelDepth ?? 36, 28, 44),
    detailDensity: clampNumber(overrides.detailDensity ?? 0.7 + intent.magicLevel * 0.25, 0, 1),
    ...overrides,
    intent,
    metadata: {
      ...semanticMetadata(intent),
      ...(intent.districtStyle ? { districtStyle: intent.districtStyle } : {}),
      ...(intent.variationIntent ? { variationIntent: intent.variationIntent } : {}),
      ...(overrides.districtContext ? { districtContext: createDistrictArchitectureContext(overrides.districtContext) } : {}),
      ...(overrides.metadata ?? {})
    }
  };
}

export function adaptBuildingIntentToMassingConfig(input = {}, overrides = {}) {
  const intent = normalizeBuildingIntent(input);
  const seed = text(overrides.seed, `${slug(intent.name)}-massing`);
  const basePreset = structuredClone(resolveMassingPreset(intent, { ...overrides, seed }));
  const program = inferPublicBuildingProgram(intent.purpose);
  const residentialProgram = program === "residential" || intent.frontage === "residential";
  const shouldVaryPublic = !residentialProgram && (intent.frontage === "institutional"
    || intent.prominence !== "ordinary"
    || ["public", "ceremonial"].includes(intent.access)
    || ["library", "academy", "greenhouse", "workshop", "civic"].includes(program));
  const preset = shouldVaryPublic
    ? applyPublicBuildingVariation(basePreset, intent, {
        seed,
        variantId: overrides.variantId ?? overrides.variant_id
      })
    : basePreset;
  const palette = MASSING_PALETTE_BY_STYLE[intent.style];
  preset.masses = preset.masses.map((mass) => {
    if (mass.type === "solid") {
      return {
        ...mass,
        materials: {
          ...palette,
          ...(mass.materials ?? {})
        },
        facade: {
          ...(mass.facade ?? {}),
          entranceEmphasis: mass.role === "entrance" || mass.role === "primary" || mass.id.includes("main") || mass.id.includes("hall")
            ? intent.access === "private" ? 0.55 : 1
            : mass.facade?.entranceEmphasis ?? 0,
          detailDensity: clampNumber(0.72 + intent.magicLevel * 0.25, 0, 1)
        }
      };
    }
    if (mass.type === "framed") {
      return {
        ...mass,
        materials: { frame: palette.frame, trim: palette.trim, panel: intent.style === "alchemical_glass" ? "tealGlass" : "lightGlass", ...(mass.materials ?? {}) }
      };
    }
    return mass;
  });
  return {
    ...preset,
    ...overrides,
    id: text(overrides.id, `${slug(intent.name)}-massing`),
    seed,
    sunTime: clampNumber(overrides.sunTime ?? 0.56, 0, 1),
    nightLighting: clampNumber(overrides.nightLighting ?? intent.magicLevel * 0.18, 0, 1),
    intent,
    metadata: {
      ...(preset.metadata ?? {}),
      ...semanticMetadata(intent),
      ...(intent.districtStyle ? { districtStyle: intent.districtStyle } : {}),
      ...(intent.variationIntent ? { variationIntent: intent.variationIntent } : {}),
      ...(overrides.districtContext ? { districtContext: createDistrictArchitectureContext(overrides.districtContext) } : {}),
      ...(overrides.metadata ?? {})
    }
  };
}

export function getBuildingIntentCatalog() {
  return {
    intentVersion: BUILDING_INTENT_VERSION,
    composition: [...BUILDING_COMPOSITION_IDS],
    frontage: [...BUILDING_FRONTAGE_IDS],
    access: [...BUILDING_ACCESS_IDS],
    style: [...BUILDING_STYLE_IDS],
    prominence: [...BUILDING_PROMINENCE_IDS],
    magicLevelRange: [0, 1],
    semanticFields: ["name", "purpose", "description", "signText"],
    variationFields: ["districtStyle", "variationIntent"],
    publicPrograms: ["library", "academy", "greenhouse", "workshop", "civic", "generic_public"],
    site: {
      cellSizeVoxels: 32,
      maximumSpanCells: 6,
      adapterOverrides: ["widthCells", "depthCells"],
      prominenceDefaults: structuredClone(BUILDING_SITE_PROFILES)
    }
  };
}

function resolveMassingPreset(intent, overrides = {}) {
  if (["industrial_iron", "victorian_gothic", "alchemical_glass", "victorian_domestic"].includes(intent.style)) {
    return createPublicBuildingStylePreset(intent.style, {
      widthCells: overrides.widthCells,
      depthCells: overrides.depthCells,
      id: `${slug(intent.name)}-${intent.style}`,
      seed: overrides.seed ?? `${slug(intent.name)}-${intent.style}`
    });
  }
  if (intent.frontage === "institutional" || intent.prominence === "landmark") {
    return createInstitutionalCampusPreset(intent, overrides);
  }
  if (intent.composition === "tower") return VOXEL_MASSING_PRESETS.towerCourtyard;
  if (intent.composition === "hall" || intent.composition === "yard") return VOXEL_MASSING_PRESETS.greenhouseArcade;
  return VOXEL_MASSING_PRESETS.civicDome;
}

function createInstitutionalCampusPreset(intent, overrides = {}) {
  const profile = BUILDING_SITE_PROFILES[intent.prominence];
  const widthCells = clampInteger(overrides.widthCells ?? profile.widthCells, 2, 6);
  const depthCells = clampInteger(overrides.depthCells ?? profile.depthCells, 2, 6);
  if (widthCells === 2 && depthCells === 2) {
    return scaleCompactInstitutionPreset(intent, widthCells, depthCells);
  }

  const center = Math.floor(widthCells / 2);
  const frontRow = depthCells - 1;
  const courtRows = range(1, frontRow);
  const westWingCells = [
    ...range(0, center).map((x) => [x, 0]),
    ...courtRows.map((z) => [0, z])
  ];
  const eastWingCells = [
    ...range(center + 1, widthCells).map((x) => [x, 0]),
    ...courtRows.map((z) => [widthCells - 1, z])
  ];
  const courtCells = [
    ...courtRows.flatMap((z) => range(1, widthCells - 1).map((x) => [x, z])),
    ...range(0, widthCells).map((x) => [x, frontRow])
  ];
  const isTower = intent.composition === "tower";
  const crownId = isTower ? "teaching-tower" : "dome-drum";
  const crownHeight = isTower ? 46 : 18;
  const crownCap = isTower
    ? { type: "spire", heightVoxels: 24, ribCount: 8, ringCount: 2, finialHeightVoxels: 7 }
    : { type: "dome", heightVoxels: 22, ribCount: 8, ringCount: 2, finialHeightVoxels: 4 };

  return {
    id: `institutional-${intent.composition}-campus`,
    seed: `institutional-${intent.composition}-campus`,
    viewFraming: { horizontalOffset: 0, zoom: widthCells >= 6 || depthCells >= 5 ? 0.93 : 1.02 },
    sunTime: 0.56,
    nightLighting: 0.12,
    widthCells,
    depthCells,
    masses: [
      {
        id: "central-hall",
        role: "primary",
        type: "solid",
        cells: [[center, 0]],
        dimensionsVoxels: { width: 30, depth: 30 },
        heightVoxels: 60,
        cap: { type: "flat" },
        facade: institutionalFacade({ floors: 3, entranceEmphasis: 1, pedimentHeightVoxels: 9 })
      },
      {
        id: "west-wing",
        type: "solid",
        cells: westWingCells,
        heightVoxels: 40,
        cap: { type: "mansard", heightVoxels: 10, dormerCount: 5, ridgeRailHeightVoxels: 2 },
        facade: institutionalFacade({ floors: 2, entranceEmphasis: 0.16, openness: 0.36 })
      },
      {
        id: "east-wing",
        type: "solid",
        cells: eastWingCells,
        heightVoxels: 40,
        cap: { type: "mansard", heightVoxels: 10, dormerCount: 5, ridgeRailHeightVoxels: 2 },
        facade: institutionalFacade({ floors: 2, entranceEmphasis: 0.16, openness: 0.36 })
      },
      {
        id: crownId,
        role: "crown",
        type: "solid",
        cells: [[center, 0]],
        dimensionsVoxels: { width: isTower ? 20 : 24, depth: isTower ? 20 : 24 },
        heightVoxels: crownHeight,
        planShape: "octagonal",
        profile: isTower ? { type: "tapered", stepHeightVoxels: 15, stepVoxels: 1, maxInsetVoxels: 7 } : undefined,
        cap: crownCap,
        facade: institutionalFacade({ floors: isTower ? 2 : 1, entranceEmphasis: 0, openness: isTower ? 0.32 : 0.5 })
      },
      {
        id: "entrance-vestibule",
        role: "entrance",
        type: "solid",
        cells: [[center, frontRow]],
        dimensionsVoxels: { width: 18, depth: 10 },
        placement: { offsetVoxels: { z: -9 } },
        heightVoxels: 18,
        cap: { type: "flat" },
        facade: institutionalFacade({ floors: 1, entranceEmphasis: 1, openness: 0.5 })
      },
      {
        id: "front-portico",
        type: "open",
        cells: [[center, frontRow]],
        dimensionsVoxels: { width: 30, depth: 16 },
        placement: { offsetVoxels: { z: -8 } },
        heightVoxels: 24,
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
        id: "ceremonial-court",
        type: "ground",
        cells: courtCells,
        heightVoxels: 2,
        cap: { type: "flat" },
        groundTreatment: {
          pattern: "garden",
          borderWidthVoxels: 2,
          pathWidthVoxels: 12,
          axisMaterial: "stoneShadow",
          planterCount: 8,
          fenceHeightVoxels: 3,
          lampCount: 8,
          stepWidthVoxels: 24,
          stepDepthVoxels: 8
        }
      }
    ],
    relations: [
      { type: "portal", from: "west-wing", to: "central-hall", widthVoxels: 8, heightVoxels: 18 },
      { type: "portal", from: "central-hall", to: "east-wing", widthVoxels: 8, heightVoxels: 18 },
      { type: "stacked", from: "central-hall", to: crownId }
    ]
  };
}

function scaleCompactInstitutionPreset(intent, widthCells, depthCells) {
  const source = structuredClone(VOXEL_MASSING_PRESETS.towerCourtyard);
  if (intent.composition !== "tower") {
    const crown = source.masses.find((mass) => mass.id === "tower");
    crown.id = "dome-drum";
    crown.heightVoxels = 30;
    crown.profile = { type: "tapered", stepHeightVoxels: 15, stepVoxels: 1, maxInsetVoxels: 5 };
    crown.cap = { type: "dome", heightVoxels: 18, ribCount: 8, ringCount: 2, finialHeightVoxels: 4 };
    source.relations = source.relations.map((relation) => relation.to === "tower"
      ? { ...relation, to: "dome-drum" }
      : relation);
  }
  source.widthCells = widthCells;
  source.depthCells = depthCells;
  source.masses = source.masses.map((mass) => {
    if (mass.type !== "solid") return mass;
    const isCrown = mass.id === "tower" || mass.id.includes("dome") || mass.role === "crown";
    const isPrimary = mass.id === "main" || mass.id === "central-hall";
    return {
      ...mass,
      ...(mass.id === "dome-lantern" ? { baseYVoxels: 100 } : {}),
      heightVoxels: isCrown ? Math.max(mass.heightVoxels, 38) : isPrimary ? 54 : Math.max(mass.heightVoxels, 36),
      facade: { ...(mass.facade ?? {}), floorHeightVoxels: 18 }
    };
  });
  return source;
}

function institutionalFacade({ floors, entranceEmphasis, openness = 0.4, pedimentHeightVoxels = 0 }) {
  return {
    symmetry: 1,
    openness,
    entranceEmphasis,
    detailDensity: 1,
    floorHeightVoxels: 20,
    bayWidthVoxels: 9,
    order: "classical",
    baseCourseHeightVoxels: 4,
    stringCourseHeightVoxels: floors > 1 ? 2 : 1,
    corniceHeightVoxels: 4,
    cornerPierWidthVoxels: 2,
    pedimentHeightVoxels,
    pedimentWidthVoxels: pedimentHeightVoxels ? 22 : 0,
    rooflineOrnaments: floors > 1 ? 4 : 0
  };
}

function range(start, end) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

function semanticMetadata(intent) {
  return {
    name: intent.name,
    purpose: intent.purpose,
    description: intent.description,
    signText: intent.signText
  };
}

function enumValue(values, value, fallback) {
  return values.includes(value) ? value : fallback;
}

function text(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function titleFromPurpose(purpose) {
  return purpose
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "agent-building";
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clampNumber(value, minimum, maximum));
}
