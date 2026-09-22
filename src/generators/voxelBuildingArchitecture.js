import { createRng, pick } from "../utils/random.js";

export const PUBLIC_BUILDING_PROGRAM_IDS = Object.freeze([
  "library",
  "academy",
  "greenhouse",
  "workshop",
  "civic",
  "generic_public",
  "residential"
]);

const PROGRAM_KEYWORDS = Object.freeze({
  library: ["library", "archive", "reading", "records", "图书", "档案", "阅览", "藏书"],
  academy: ["school", "academy", "college", "university", "observatory", "学院", "学校", "大学", "天文台"],
  greenhouse: ["greenhouse", "conservatory", "botanical", "garden", "plant", "温室", "植物", "花园", "温室"],
  workshop: ["workshop", "factory", "forge", "mill", "works", "repair", "工坊", "工厂", "铸造", "修理", "作坊"],
  civic: ["hall", "museum", "market", "civic", "opera", "municipal", "市政", "大厅", "市场", "博物", "歌剧"],
  residential: ["residence", "residential", "house", "home", "cottage", "townhouse", "住宅", "民宅", "房屋", "小屋"]
});

export const PUBLIC_BUILDING_PROGRAM_PROFILES = Object.freeze({
  library: Object.freeze({
    label: "library / archive",
    expectedFeatures: ["main hall or reading hall", "clear public entrance"],
    allowedFeatures: ["wing", "courtyard", "tower", "portico", "dome"],
    discouragedFeatures: ["greenhouse", "industrial sawtooth roof", "service-yard dominant layout"]
  }),
  academy: Object.freeze({
    label: "academy / school",
    expectedFeatures: ["main hall or teaching wing", "clear public entrance"],
    allowedFeatures: ["courtyard", "tower", "arcade", "portico"],
    discouragedFeatures: ["greenhouse as the dominant volume", "industrial sawtooth roof"]
  }),
  greenhouse: Object.freeze({
    label: "greenhouse / botanical facility",
    expectedFeatures: ["framed glass volume", "garden or open court"],
    allowedFeatures: ["glass hall", "glass barrel roof", "service wing", "tower"],
    discouragedFeatures: ["fully enclosed civic block with no framed volume"]
  }),
  workshop: Object.freeze({
    label: "workshop / factory",
    expectedFeatures: ["service-oriented mass", "large-bay or industrial roof language"],
    allowedFeatures: ["service yard", "chimney", "loading canopy", "tower"],
    discouragedFeatures: ["ceremonial dome as the dominant feature", "greenhouse as the only major volume"]
  }),
  civic: Object.freeze({
    label: "civic / cultural building",
    expectedFeatures: ["primary hall", "clear public entrance"],
    allowedFeatures: ["portico", "dome", "wing", "courtyard", "tower"],
    discouragedFeatures: ["greenhouse-only composition", "service-yard dominant layout"]
  }),
  generic_public: Object.freeze({
    label: "public building",
    expectedFeatures: ["legible primary mass", "clear public entrance"],
    allowedFeatures: ["wing", "courtyard", "tower", "portico", "glass hall"],
    discouragedFeatures: []
  }),
  residential: Object.freeze({
    label: "residential building",
    expectedFeatures: ["human-scale entrance", "coherent street frontage"],
    allowedFeatures: ["gable", "mansard", "small courtyard"],
    discouragedFeatures: ["civic dome", "industrial sawtooth roof", "large greenhouse volume"]
  })
});

const VARIANTS_BY_PROGRAM = Object.freeze({
  library: ["reading_hall", "courtyard_archive", "clocktower_library", "winged_archive"],
  academy: ["courtyard_academy", "tower_academy", "hall_academy", "arcade_academy"],
  greenhouse: ["glass_hall", "glass_court", "conservatory_tower", "glass_wing"],
  workshop: ["sawtooth_bay", "service_yard", "boiler_block", "workshop_tower"],
  civic: ["portico_hall", "dome_hall", "winged_hall", "civic_tower"],
  generic_public: ["compact_hall", "courtyard_hall", "tower_hall", "asymmetric_campus"]
});

const VARIANT_COMPATIBILITY = Object.freeze({
  courtyard_archive: Object.freeze({ minimumLogicalCells: 4, minimumColumns: 2, minimumRows: 2, requiredFeatures: ["courtyard"] }),
  courtyard_academy: Object.freeze({ minimumLogicalCells: 4, minimumColumns: 2, minimumRows: 2, requiredFeatures: ["courtyard"] }),
  glass_court: Object.freeze({ minimumLogicalCells: 4, minimumColumns: 2, minimumRows: 2, requiredFeatures: ["framedGlassVolume", "courtyard"] }),
  courtyard_hall: Object.freeze({ minimumLogicalCells: 4, minimumColumns: 2, minimumRows: 2, requiredFeatures: ["courtyard"] }),
  asymmetric_campus: Object.freeze({ minimumLogicalCells: 4, minimumColumns: 2, minimumRows: 2, requiredFeatures: ["wingCount"] }),
  winged_archive: Object.freeze({ minimumLogicalCells: 2, minimumSpan: 2, requiredFeatures: ["wingCount"] }),
  glass_wing: Object.freeze({ minimumLogicalCells: 2, minimumSpan: 2, requiredFeatures: ["framedGlassVolume", "wingCount"] }),
  winged_hall: Object.freeze({ minimumLogicalCells: 2, minimumSpan: 2, requiredFeatures: ["wingCount"] }),
  service_yard: Object.freeze({ minimumLogicalCells: 2, minimumSpan: 2, requiredFeatures: [] }),
  clocktower_library: Object.freeze({ requiredFeatures: ["tower"] }),
  tower_academy: Object.freeze({ requiredFeatures: ["tower"] }),
  conservatory_tower: Object.freeze({ requiredFeatures: ["framedGlassVolume", "tower"] }),
  workshop_tower: Object.freeze({ requiredFeatures: ["tower"] }),
  civic_tower: Object.freeze({ requiredFeatures: ["tower"] }),
  tower_hall: Object.freeze({ requiredFeatures: ["tower"] }),
  glass_hall: Object.freeze({ requiredFeatures: ["framedGlassVolume"] }),
  portico_hall: Object.freeze({ requiredFeatures: ["publicEntrance"] }),
  dome_hall: Object.freeze({ requiredFeatures: ["dome"] }),
  sawtooth_bay: Object.freeze({ requiredFeatures: ["primaryHall"] })
});

const DEFAULT_VARIANT_COMPATIBILITY = Object.freeze({
  minimumLogicalCells: 1,
  minimumColumns: 1,
  minimumRows: 1,
  minimumSpan: 1,
  rotatable: true,
  siteLayouts: Object.freeze(["building"]),
  requiredFeatures: Object.freeze(["primaryHall"])
});

export class PublicBuildingVariantError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PublicBuildingVariantError";
    this.code = "BUILDING_VARIANT_INCOMPATIBLE";
    this.details = details;
  }
}

const PRIMARY_CAPS_BY_STYLE = Object.freeze({
  civic_classical: ["gable", "hip", "mansard"],
  industrial_iron: ["sawtooth", "parapet", "gable"],
  victorian_gothic: ["gable", "hip"],
  alchemical_glass: ["mansard", "gable", "hip"],
  victorian_domestic: ["gable", "hip", "mansard"]
});

export function inferPublicBuildingProgram(purpose = "") {
  const text = String(purpose ?? "").trim().toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) return program;
  }
  return "generic_public";
}

export function getPublicBuildingVariantCatalog(program = null) {
  if (program === "residential") return [];
  if (program && VARIANTS_BY_PROGRAM[program]) return [...VARIANTS_BY_PROGRAM[program]];
  return Object.fromEntries(Object.entries(VARIANTS_BY_PROGRAM).map(([key, values]) => [key, [...values]]));
}

export function getPublicBuildingVariantDefinitions(program = null) {
  if (program === "residential") return [];
  const programs = program && VARIANTS_BY_PROGRAM[program]
    ? [[program, VARIANTS_BY_PROGRAM[program]]]
    : Object.entries(VARIANTS_BY_PROGRAM);
  const definitions = programs.flatMap(([programId, variants]) => variants.map((id) => {
    const compatibility = VARIANT_COMPATIBILITY[id] ?? {};
    return {
      id,
      program: programId,
      minimumLogicalCells: compatibility.minimumLogicalCells ?? DEFAULT_VARIANT_COMPATIBILITY.minimumLogicalCells,
      minimumColumns: compatibility.minimumColumns ?? DEFAULT_VARIANT_COMPATIBILITY.minimumColumns,
      minimumRows: compatibility.minimumRows ?? DEFAULT_VARIANT_COMPATIBILITY.minimumRows,
      minimumSpan: compatibility.minimumSpan ?? DEFAULT_VARIANT_COMPATIBILITY.minimumSpan,
      rotatable: compatibility.rotatable ?? DEFAULT_VARIANT_COMPATIBILITY.rotatable,
      siteLayouts: [...(compatibility.siteLayouts ?? DEFAULT_VARIANT_COMPATIBILITY.siteLayouts)],
      requiredFeatures: [...(compatibility.requiredFeatures ?? DEFAULT_VARIANT_COMPATIBILITY.requiredFeatures)]
    };
  }));
  if (program) return definitions;
  return Object.fromEntries(Object.keys(VARIANTS_BY_PROGRAM).map((programId) => [
    programId,
    definitions.filter((definition) => definition.program === programId)
  ]));
}

export function getCompatiblePublicBuildingVariants(program, options = {}) {
  return getPublicBuildingVariantDefinitions(program).filter((definition) => variantCompatibility(definition, options).compatible);
}

export function resolvePublicBuildingVariant(intent = {}, options = {}) {
  const program = inferPublicBuildingProgram(intent.purpose);
  const requestedVariantId = options.variantId ?? options.variant_id ?? null;
  const siteLayout = options.siteLayout ?? options.site_layout ?? "building";
  const definitions = getPublicBuildingVariantDefinitions(program);
  const compatibilityOptions = {
    widthCells: options.widthCells,
    depthCells: options.depthCells,
    siteLayout
  };
  const compatible = definitions.filter((definition) => variantCompatibility(definition, compatibilityOptions).compatible);
  const compatibleVariantIds = compatible.map((definition) => definition.id);
  const requested = requestedVariantId
    ? definitions.find((definition) => definition.id === requestedVariantId)
    : null;
  const incompatibility = requestedVariantId
    ? requested
      ? variantCompatibility(requested, compatibilityOptions)
      : { compatible: false, reasons: [`Variant ${requestedVariantId} does not belong to program ${program}`] }
    : null;

  if (requestedVariantId && incompatibility.compatible) {
    return selection({ program, requestedVariantId, appliedVariantId: requestedVariantId, source: "explicit", compatibleVariantIds });
  }

  const requestedFootprint = options.requestedFootprint ?? `${options.widthCells ?? 1}x${options.depthCells ?? 1}`;
  if (requestedVariantId && !options.allowFallback) {
    throw new PublicBuildingVariantError(
      `Variant ${requestedVariantId} is not compatible with ${requestedFootprint} ${siteLayout} public-site generation`,
      {
        requested_variant: requestedVariantId,
        requested_footprint: requestedFootprint,
        site_layout: siteLayout,
        program,
        reasons: incompatibility.reasons,
        compatible_variants: compatibleVariantIds,
        suggested_correction: compatibleVariantIds.length
          ? `Use one of: ${compatibleVariantIds.join(", ")}`
          : "Choose site_layout=building or a larger footprint, or omit variant_id for automatic compatible selection."
      }
    );
  }

  if (!compatible.length) {
    if (requestedVariantId && options.allowFallback) {
      return selection({
        program,
        requestedVariantId,
        appliedVariantId: null,
        source: "fallback",
        compatibleVariantIds,
        fallbackReason: incompatibility.reasons.join("; ")
      });
    }
    throw new PublicBuildingVariantError(`No ${program} variant is compatible with the requested public site`, {
      requested_variant: requestedVariantId,
      requested_footprint: requestedFootprint,
      site_layout: siteLayout,
      program,
      compatible_variants: []
    });
  }

  const rng = createRng(`${options.seed ?? "public-building"}:public-variant-selection`);
  const towerVariants = compatible.filter((definition) => definition.id.includes("tower") || definition.id.includes("clocktower"));
  const candidates = intent.composition === "tower" && towerVariants.length ? towerVariants : compatible;
  const applied = pick(rng, candidates).id;
  return selection({
    program,
    requestedVariantId,
    appliedVariantId: applied,
    source: requestedVariantId ? "fallback" : "seeded",
    compatibleVariantIds,
    fallbackReason: requestedVariantId ? incompatibility.reasons.join("; ") : null
  });
}

function variantCompatibility(definition, options = {}) {
  const widthCells = Math.max(1, Number(options.widthCells) || 1);
  const depthCells = Math.max(1, Number(options.depthCells) || 1);
  const siteLayout = options.siteLayout ?? "building";
  const reasons = [];
  if (!definition.siteLayouts.includes(siteLayout)) reasons.push(`Variant supports site_layout=${definition.siteLayouts.join("|")}, not ${siteLayout}`);
  if (widthCells * depthCells < definition.minimumLogicalCells) reasons.push(`Variant requires at least ${definition.minimumLogicalCells} logical cells`);
  const directFit = widthCells >= definition.minimumColumns && depthCells >= definition.minimumRows;
  const rotatedFit = definition.rotatable && widthCells >= definition.minimumRows && depthCells >= definition.minimumColumns;
  if (!directFit && !rotatedFit) reasons.push(`Variant requires at least ${definition.minimumColumns} columns x ${definition.minimumRows} rows${definition.rotatable ? " in either orientation" : ""}`);
  if (Math.max(widthCells, depthCells) < definition.minimumSpan) reasons.push(`Variant requires a span of at least ${definition.minimumSpan} cells`);
  return { compatible: reasons.length === 0, reasons };
}

function selection({ program, requestedVariantId, appliedVariantId, source, compatibleVariantIds, fallbackReason = null }) {
  return {
    program,
    requestedVariantId,
    appliedVariantId,
    source,
    fallbackApplied: source === "fallback",
    fallbackReason,
    compatibleVariantIds: [...compatibleVariantIds]
  };
}

/**
 * Apply a bounded, seed-stable architectural variation to a public-building
 * preset. The base style grammar remains the source of truth for materials
 * and component legality; this function only changes the high-level scheme
 * inside the selected program family.
 */
export function applyPublicBuildingVariation(preset, intent = {}, options = {}) {
  const program = inferPublicBuildingProgram(intent.purpose);
  const seed = String(options.seed ?? preset.seed ?? "public-building");
  const rng = createRng(`${seed}:public-architecture`);
  const variantSelection = resolvePublicBuildingVariant(intent, {
    seed,
    variantId: options.variantId ?? options.variant_id,
    allowFallback: options.allowFallback ?? options.allow_fallback,
    widthCells: options.widthCells ?? preset.widthCells,
    depthCells: options.depthCells ?? preset.depthCells,
    requestedFootprint: options.requestedFootprint,
    siteLayout: "building"
  });
  const variantId = variantSelection.appliedVariantId;
  const source = structuredClone(preset);
  const masses = source.masses ?? [];
  const structural = masses.filter((mass) => mass.type !== "ground");
  const primary = structural.find((mass) => mass.role === "primary") ?? structural[0];
  const crown = structural.find((mass) => mass.role === "crown");
  const open = masses.find((mass) => mass.type === "open");
  const ground = masses.find((mass) => mass.type === "ground");

  if (primary) {
    const capChoices = PRIMARY_CAPS_BY_STYLE[intent.style] ?? PRIMARY_CAPS_BY_STYLE.civic_classical;
    const capType = choosePrimaryCap(variantId, intent.style, capChoices, rng);
    primary.cap = { ...(primary.cap ?? {}), type: capType };
    primary.heightVoxels = varyHeight(primary.heightVoxels, variantId, rng);
    primary.planShape = choosePlanShape(primary.planShape, variantId, rng);
    primary.facade = varyFacade(primary.facade, variantId, rng);
  }

  if (ground) {
    const pattern = variantId.includes("courtyard") || variantId.includes("court")
      ? "courtyard"
      : variantId.includes("garden") || program === "greenhouse"
        ? "garden"
        : ground.groundTreatment?.pattern;
    if (pattern) ground.groundTreatment = { ...(ground.groundTreatment ?? {}), pattern };
  }

  if (open) {
    open.heightVoxels = Math.max(8, varyHeight(open.heightVoxels ?? 12, variantId, rng, 0.18));
    if (variantId.includes("arcade") || variantId.includes("portico")) {
      open.role = "entrance";
      open.cap = { ...(open.cap ?? {}), type: "gable" };
    }
  }

  if (variantId.includes("winged") || variantId.endsWith("_wing") || variantId.includes("asymmetric")) {
    varyWingHeights(structural, primary, rng);
    ensureVariantWing(source, structural, primary, rng);
  }

  if (["reading_hall", "hall_academy", "compact_hall"].includes(variantId)) {
    simplifyHallLayout(source);
  }

  if (shouldRemoveCrown(variantId, program)) {
    removeCrown(source, crown);
  }

  if (variantId.includes("tower") || variantId.includes("clocktower")) {
    addOrVaryTower({ source, structural, primary, crown, program, rng });
  }

  if (variantId.includes("dome")) {
    addOrVaryDome({ source, primary, crown });
  }

  if (variantId.includes("glass") || program === "greenhouse") {
    tuneGlassVolume(source, structural, rng);
  }

  if (variantId === "service_yard" || variantId === "boiler_block" || variantId === "sawtooth_bay") {
    const service = structural.find((mass) => mass.role === "service");
    if (service) service.heightVoxels = Math.max(20, varyHeight(service.heightVoxels ?? 24, variantId, rng, 0.14));
  }

  source.seed = seed;
  source.metadata = {
    ...(source.metadata ?? {}),
    publicProgram: program,
    variantId,
    variantFamily: "seeded-functional-massing-v1",
    variationAxes: ["silhouette", "roofline", "height_rhythm"],
    variantChoices: [...variantSelection.compatibleVariantIds],
    generationSelection: variantSelection
  };
  return source;
}

function choosePrimaryCap(variantId, style, choices, rng) {
  if (style === "industrial_iron" && choices.includes("sawtooth")) return "sawtooth";
  if (variantId.includes("dome") && style === "civic_classical") return "mansard";
  if (variantId.includes("sawtooth") && choices.includes("sawtooth")) return "sawtooth";
  if (variantId.includes("glass") && style === "alchemical_glass") return "mansard";
  return pick(rng, choices);
}

function choosePlanShape(current, variantId, rng) {
  if (variantId.includes("compact") || variantId.includes("block")) return "rectangular";
  if (variantId.includes("tower") || variantId.includes("clocktower")) return current === "octagonal" ? current : "chamfered";
  if (variantId.includes("asymmetric")) return pick(rng, ["rectangular", "chamfered"]);
  return current ?? pick(rng, ["rectangular", "chamfered"]);
}

function varyHeight(value, variantId, rng, amplitude = 0.22) {
  const base = Math.max(12, Number(value) || 24);
  if (variantId.includes("tower") || variantId.includes("clocktower")) return base;
  const direction = variantId.includes("tower") || variantId.includes("clocktower") ? 1.12 : 1;
  const factor = direction * (1 - amplitude / 2 + rng() * amplitude);
  return Math.max(12, Math.round(base * factor));
}

function varyFacade(facade = {}, variantId, rng) {
  return {
    ...facade,
    symmetry: round(clamp(Number(facade.symmetry ?? 0.7) + (variantId.includes("asymmetric") ? -0.18 : (rng() - 0.5) * 0.12), 0, 1)),
    openness: round(clamp(Number(facade.openness ?? 0.4) + (rng() - 0.5) * 0.12, 0.08, 0.92)),
    entranceEmphasis: round(clamp(Number(facade.entranceEmphasis ?? 0.5) + (variantId.includes("portico") ? 0.18 : (rng() - 0.5) * 0.12), 0, 1)),
    bayWidthVoxels: Math.max(4, Math.round(Number(facade.bayWidthVoxels ?? 8) + (rng() > 0.5 ? 1 : -1)))
  };
}

function varyWingHeights(structural, primary, rng) {
  structural
    .filter((mass) => mass !== primary && mass.type === "solid" && mass.role !== "crown")
    .forEach((mass, index) => {
      const factor = index % 2 === 0 ? 0.88 + rng() * 0.08 : 1.02 + rng() * 0.1;
      mass.heightVoxels = Math.max(14, Math.round((mass.heightVoxels ?? 24) * factor));
      mass.cap = { ...(mass.cap ?? {}), type: index % 2 === 0 ? (mass.cap?.type ?? "mansard") : "gable" };
    });
}

function ensureVariantWing(source, structural, primary, rng) {
  if (!primary || structural.some((mass) => ["wing", "secondary"].includes(mass.role))) return;
  const widthCells = Math.max(1, Number(source.widthCells) || 1);
  const depthCells = Math.max(1, Number(source.depthCells) || 1);
  const primaryCell = primary.cells?.[0] ?? [0, 0];
  const wingCell = widthCells > 1
    ? [primaryCell[0] === 0 ? widthCells - 1 : 0, primaryCell[1]]
    : [primaryCell[0], primaryCell[1] === 0 ? depthCells - 1 : 0];
  const wing = {
    id: "variant-wing",
    role: "wing",
    type: "solid",
    cells: [wingCell],
    heightVoxels: Math.max(14, Math.round((primary.heightVoxels ?? 28) * (0.72 + rng() * 0.12))),
    cap: { ...(primary.cap ?? {}), type: "gable", heightVoxels: Math.max(7, Math.round(Number(primary.cap?.heightVoxels ?? 10) * 0.8)) },
    materials: { ...(primary.materials ?? {}) },
    facade: { ...(primary.facade ?? {}), entranceEmphasis: 0, symmetry: 0.35 }
  };
  source.masses.push(wing);
  source.relations = [...(source.relations ?? []), { type: "portal", from: primary.id, to: wing.id, widthVoxels: 7, heightVoxels: 13 }];
  structural.push(wing);
}

function addOrVaryTower({ source, structural, primary, crown, program, rng }) {
  if (crown) {
    crown.heightVoxels = Math.max(crown.heightVoxels ?? 32, Math.round((crown.heightVoxels ?? 32) * (1.08 + rng() * 0.12)));
    crown.cap = { ...(crown.cap ?? {}), type: program === "library" || program === "academy" ? "spire" : (crown.cap?.type ?? "dome") };
    return;
  }
  if (!primary) return;
  const towerId = "variant-tower";
  const hostCell = primary.cells?.[0] ?? [0, 0];
  const tower = {
    id: towerId,
    role: "crown",
    type: "solid",
    cells: [hostCell],
    dimensionsVoxels: { width: 14, depth: 14 },
    placement: { offsetVoxels: { x: -4 + Math.round(rng() * 8), z: -4 + Math.round(rng() * 8) } },
    heightVoxels: 38 + Math.round(rng() * 16),
    planShape: "octagonal",
    profile: { type: "tapered", stepHeightVoxels: 14, stepVoxels: 1, maxInsetVoxels: 4 },
    cap: { type: "spire", heightVoxels: 16 + Math.round(rng() * 8), ribCount: 8, ringCount: 1, finialHeightVoxels: 4 },
    materials: { ...(primary.materials ?? {}), window: primary.materials?.window ?? "warmWindow" },
    facade: { ...(primary.facade ?? {}), openness: 0.24, entranceEmphasis: 0, bayWidthVoxels: 7 }
  };
  source.masses.push(tower);
  source.relations = [...(source.relations ?? []), { type: "stacked", from: primary.id, to: towerId }];
  structural.push(tower);
}

function addOrVaryDome({ source, primary, crown }) {
  if (!primary) return;
  if (crown) {
    crown.role = "crown";
    crown.cap = { ...(crown.cap ?? {}), type: "dome", heightVoxels: Math.max(14, Number(crown.cap?.heightVoxels ?? 14)), ribCount: 8, ringCount: 2, finialHeightVoxels: 5 };
    return;
  }
  const dome = {
    id: "variant-dome",
    role: "crown",
    type: "solid",
    cells: [primary.cells?.[0] ?? [0, 0]],
    dimensionsVoxels: { width: 18, depth: 18 },
    heightVoxels: 12,
    planShape: "octagonal",
    cap: { type: "dome", heightVoxels: 16, ribCount: 8, ringCount: 2, finialHeightVoxels: 5 },
    materials: { ...(primary.materials ?? {}) },
    facade: { ...(primary.facade ?? {}), entranceEmphasis: 0, openness: 0.28 }
  };
  source.masses.push(dome);
  source.relations = [...(source.relations ?? []), { type: "stacked", from: primary.id, to: dome.id }];
}

function shouldRemoveCrown(variantId, program) {
  if (variantId.includes("tower") || variantId.includes("clocktower") || variantId.includes("dome")) return false;
  return [
    "reading_hall",
    "courtyard_archive",
    "winged_archive",
    "courtyard_academy",
    "hall_academy",
    "arcade_academy",
    "portico_hall",
    "winged_hall",
    "compact_hall",
    "courtyard_hall",
    "asymmetric_campus"
  ].includes(variantId) && program !== "greenhouse";
}

function removeCrown(source, crown) {
  if (!crown) return;
  source.masses = source.masses.filter((mass) => mass.id !== crown.id);
  source.relations = (source.relations ?? []).filter((relation) => relation.from !== crown.id && relation.to !== crown.id);
}

function simplifyHallLayout(source) {
  const removable = new Set(["west-wing", "east-wing"]);
  const removableIds = new Set(source.masses.filter((mass) => removable.has(mass.id)).map((mass) => mass.id));
  if (!removableIds.size) return;
  source.masses = source.masses.filter((mass) => !removableIds.has(mass.id));
  source.relations = (source.relations ?? []).filter((relation) => !removableIds.has(relation.from) && !removableIds.has(relation.to));
}

function tuneGlassVolume(source, structural, rng) {
  let glass = structural.find((mass) => mass.type === "framed");
  if (!glass) {
    const primary = structural.find((mass) => mass.role === "primary") ?? structural[0];
    if (!primary) return;
    glass = {
      id: "variant-glasshouse",
      role: "greenhouse",
      type: "framed",
      cells: [primary.cells?.[0] ?? [0, 0]],
      heightVoxels: 16,
      cap: { type: "glass_barrel", heightVoxels: 14, orientation: "east_west", ribCount: 8, ringCount: 2, finialHeightVoxels: 4 },
      framing: { baySpacingVoxels: 7, frameWidthVoxels: 2, floorBeamSpacingVoxels: 8, reliefDepthVoxels: 1 },
      materials: { frame: "patinaMetal", trim: "gildedMetal", panel: "tealGlass", roof: "tealGlass" }
    };
    source.masses.push(glass);
    structural.push(glass);
    if (primary) source.relations = [...(source.relations ?? []), { type: "portal", from: primary.id, to: glass.id, widthVoxels: 8, heightVoxels: 14 }];
  }
  glass.heightVoxels = Math.max(12, Math.round((glass.heightVoxels ?? 18) * (0.92 + rng() * 0.2)));
  glass.cap = { ...(glass.cap ?? {}), type: pick(rng, ["glass_ridge", "glass_barrel"]) };
  glass.framing = { ...(glass.framing ?? {}), baySpacingVoxels: pick(rng, [6, 7, 8, 9]) };
}

export function summarizeMassingArchitecture(spec = {}) {
  const masses = Array.isArray(spec.masses) ? spec.masses : [];
  const structural = masses.filter((mass) => mass.type !== "ground");
  const caps = [...new Set(structural.map((mass) => mass.cap?.type).filter(Boolean))].sort();
  const orders = [...new Set(structural.map((mass) => mass.facade?.order).filter(Boolean))].sort();
  const framed = structural.filter((mass) => mass.type === "framed" || ["glass_ridge", "glass_barrel"].includes(mass.cap?.type));
  const hasTower = structural.some((mass) => mass.role === "crown" || mass.cap?.type === "spire");
  const hasDome = structural.some((mass) => mass.cap?.type === "dome");
  const hasPortico = structural.some((mass) => mass.type === "open" && Object.values(mass.enclosure?.sides ?? {}).includes("columns"));
  const ground = masses.filter((mass) => mass.type === "ground");
  const hasCourtyard = ground.some((mass) => ["courtyard", "garden"].includes(mass.groundTreatment?.pattern));
  const primary = structural.find((mass) => mass.role === "primary") ?? structural[0] ?? null;
  const maxHeightVoxels = Math.max(...structural.map((mass) => (mass.baseYVoxels ?? 0) + (mass.heightVoxels ?? 0) + (mass.cap?.heightVoxels ?? 0)), 0);
  const wingCount = structural.filter((mass) => mass !== primary && ["secondary", "service", "wing"].includes(mass.role)).length;
  const publicEntrance = structural.some((mass) => mass.role === "entrance") || hasPortico || Number(primary?.facade?.entranceEmphasis ?? 0) >= 0.6;
  const massing = framed.length > 0
    ? (hasCourtyard ? "glass_courtyard" : "glass_hall")
    : hasTower && hasCourtyard
      ? "courtyard_tower_campus"
      : hasTower
        ? "tower_hall"
        : wingCount > 0 || structural.length >= 3
          ? "winged_hall"
          : hasCourtyard
            ? "courtyard_block"
            : "compact_block";

  return {
    specVersion: "architecture-summary@0.1",
    massing,
    footprint: {
      widthCells: spec.footprint?.widthCells ?? spec.widthCells ?? null,
      depthCells: spec.footprint?.depthCells ?? spec.depthCells ?? null,
      occupiedCells: [...new Set(masses.flatMap((mass) => (mass.cells ?? []).map((cell) => `${cell.x ?? cell[0]},${cell.z ?? cell[1]}`)))].length
    },
    components: masses.map((mass) => ({
      id: mass.id,
      role: mass.role ?? null,
      type: mass.type,
      cellCount: mass.cells?.length ?? 0,
      heightVoxels: mass.heightVoxels ?? 0,
      cap: mass.cap?.type ?? null
    })),
    roofFamilies: caps,
    facadeOrders: orders,
    features: {
      primaryHall: Boolean(primary),
      publicEntrance,
      framedGlassVolume: framed.length > 0,
      greenhouse: framed.length > 0,
      tower: hasTower,
      dome: hasDome,
      portico: hasPortico,
      courtyard: hasCourtyard,
      wingCount
    },
    scale: { maxHeightVoxels, structuralMassCount: structural.length },
    generator: {
      variantId: spec.metadata?.variantId ?? null,
      program: spec.metadata?.publicProgram ?? null,
      variantFamily: spec.metadata?.variantFamily ?? null
    }
  };
}

export function summarizeFloorStackArchitecture(spec = {}) {
  const floors = Array.isArray(spec.floorSpecs) ? spec.floorSpecs : [];
  return {
    specVersion: "architecture-summary@0.1",
    massing: "street_stack",
    footprint: {
      widthVoxels: spec.footprint?.widthVoxels ?? null,
      depthVoxels: spec.footprint?.depthVoxels ?? null
    },
    components: [{ id: "main", role: "primary", type: "solid", cellCount: 1, heightVoxels: spec.wallHeightVoxels ?? 0, cap: spec.roof?.form ?? null }],
    roofFamilies: spec.roof?.form ? [spec.roof.form] : [],
    facadeOrders: [],
    features: {
      primaryHall: false,
      publicEntrance: Boolean(spec.ports?.entrance),
      framedGlassVolume: false,
      greenhouse: false,
      tower: false,
      dome: false,
      portico: false,
      courtyard: false,
      wingCount: 0
    },
    scale: { floors: spec.floors ?? floors.length, maxHeightVoxels: spec.wallHeightVoxels ?? 0, structuralMassCount: 1 },
    programs: floors.map((floor) => floor.purpose)
  };
}

export function createPublicArchitectureReview(intent = {}, summary = {}) {
  const program = inferPublicBuildingProgram(intent.purpose);
  const profile = PUBLIC_BUILDING_PROGRAM_PROFILES[program] ?? PUBLIC_BUILDING_PROGRAM_PROFILES.generic_public;
  const features = summary.features ?? {};
  const conflicts = [];
  const roofFamilies = summary.roofFamilies ?? [];
  if (["library", "academy", "civic"].includes(program) && features.greenhouse) {
    conflicts.push({ code: "unexpected_greenhouse", message: `${profile.label} includes a framed greenhouse/glass volume; verify that this is intentional.` });
  }
  if (["library", "academy", "civic"].includes(program) && roofFamilies.includes("sawtooth")) {
    conflicts.push({ code: "industrial_roof_for_public_program", message: `${profile.label} uses an industrial sawtooth roof; verify the chosen architectural language.` });
  }
  if (program === "greenhouse" && !features.greenhouse) {
    conflicts.push({ code: "greenhouse_program_lacks_glass_volume", message: "The greenhouse program has no framed glass volume; consider revising the massing." });
  }
  if (!features.publicEntrance) {
    conflicts.push({ code: "public_entrance_not_legible", message: "The generated building does not expose a clearly emphasized public entrance." });
  }
  return {
    status: conflicts.length ? "needs_attention" : "ready_for_agent_review",
    program,
    programLabel: profile.label,
    expectedFeatures: [...profile.expectedFeatures],
    allowedFeatures: [...profile.allowedFeatures],
    discouragedFeatures: [...profile.discouragedFeatures],
    conflicts,
    checks: [
      "Does the silhouette communicate the stated public function?",
      "Is the primary entrance legible from the selected frontage?",
      "Are any unusual volumes intentional rather than random?",
      "If the result is acceptable, confirm it; otherwise revise the mass or regenerate from intent."
    ]
  };
}

export function createDistrictArchitectureContext(value = {}) {
  if (typeof value === "string") return { style: value };
  if (!value || typeof value !== "object") return null;
  const context = {};
  for (const [target, aliases] of Object.entries({
    id: ["id", "district_id", "districtId"],
    name: ["name"],
    purpose: ["purpose"],
    style: ["style", "district_style", "districtStyle"],
    character: ["character"],
    preserve: ["preserve", "preserve_features", "preserveFeatures"],
    vary: ["vary", "change", "change_features", "changeFeatures"],
    existingFeatures: ["existing_features", "existingFeatures"],
    notes: ["notes"]
  })) {
    const sourceKey = aliases.find((alias) => value[alias] != null);
    if (sourceKey == null) continue;
    const source = value[sourceKey];
    context[target] = Array.isArray(source) ? source.map(String).slice(0, 8) : String(source).trim();
  }
  return Object.keys(context).length ? context : null;
}

function round(value) {
  return Number(Number(value).toFixed(3));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
