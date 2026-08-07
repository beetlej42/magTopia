import {
  adaptBuildingIntentToMassingConfig,
  adaptBuildingIntentToStreetConfig,
  getBuildingIntentCatalog,
  normalizeBuildingIntent
} from "../generators/buildingIntent.js";
import { createBuildingSpec } from "../generators/voxelBuildingGrammar.js";
import { createUrbanMassingSpec } from "../generators/voxelMassingGrammar.js";
import {
  SEMANTIC_GRID_SIGN_VOXEL_SIZE,
  createVoxelBuildingFromSpec,
  createVoxelMassingLab
} from "../generators/voxelBuildingLab.js";
import {
  createDistrictArchitectureContext,
  createPublicArchitectureReview,
  getPublicBuildingVariantCatalog,
  inferPublicBuildingProgram,
  summarizeFloorStackArchitecture,
  summarizeMassingArchitecture
} from "../generators/voxelBuildingArchitecture.js";

export const BUILDING_DESIGN_VERSION = "1.0";
export const DECORATION_SPEC_VERSION = "0.1";
export const BUILDING_GENERATION_MODES = Object.freeze(["floor_stack", "urban_massing"]);
export const BUILDING_DECORATION_TYPES = Object.freeze([
  "hanging_sign",
  "semantic_grid_sign",
  "facade_lamp",
  "magic_lamp",
  "roof_finial"
]);
export const SEMANTIC_GRID_SIGN_MATERIALS = Object.freeze({
  frame: Object.freeze(["iron", "patinaMetal", "timber", "sandstone", "limestone"]),
  board: Object.freeze(["timber", "slate", "iron", "patinaMetal"]),
  emissive: Object.freeze(["tealMagic", "violetMagic", "warmWindow"])
});
export const SEMANTIC_GRID_SIGN_FRAME_STYLES = Object.freeze(["simple", "riveted", "crowned"]);
export const SEMANTIC_GRID_SIGN_MICRO_VOXEL = Object.freeze({
  fixed: SEMANTIC_GRID_SIGN_VOXEL_SIZE,
  buildingVoxelRatio: 0.5,
  unit: "world_meter"
});

const COMMON_OPERATIONS = Object.freeze([
  "set_intent",
  "regenerate_from_intent",
  "set_roof",
  "set_material",
  "add_decoration",
  "update_decoration",
  "remove_decoration"
]);

const MODE_OPERATIONS = Object.freeze({
  floor_stack: Object.freeze(["add_floor", "set_floor_program"]),
  urban_massing: Object.freeze(["add_floor", "add_mass", "update_mass", "remove_mass"])
});

export function createBuildingDesignDraft(input = {}, context = {}) {
  const intent = normalizeIntentAliases(input.intent ?? input.program ?? {});
  const requestedMode = normalizeMode(input.generation_mode ?? input.generationMode ?? "auto", true);
  const requestedFootprint = normalizeRequestedFootprint(
    input.site?.footprint ?? input.requirements?.maximum_footprint ?? input.requirements?.maximumFootprint
  );
  const mode = requestedMode === "auto" ? recommendGenerationMode(intent, requestedFootprint) : requestedMode;
  if (mode === "floor_stack" && requestedFootprint && requestedFootprint !== "1x1") {
    throw new Error("floor_stack currently requires a 1x1 logical site; use urban_massing for larger footprints");
  }

  const id = String(context.id ?? input.id ?? `design-${Date.now()}`);
  const seed = String(input.seed ?? context.seed ?? id);
  const site = recommendSite(input.site, requestedFootprint, mode, intent);
  const requirements = input.requirements ?? {};
  const districtContext = createDistrictArchitectureContext(input.district_context ?? input.districtContext);
  const generation = recommendGeneration({ id, seed, intent, mode, site, requirements, districtContext });
  const design = {
    designVersion: BUILDING_DESIGN_VERSION,
    id,
    revision: 1,
    status: "editable",
    source: { kind: "new" },
    intent,
    site,
    districtContext,
    generation,
    ports: [createPrimaryEntrancePort(site)],
    decorations: normalizeDecorationSpec(input.decorations),
    locks: normalizeLocks(input.locks),
    availableOperations: availableOperations(mode, intent),
    createdBy: context.actor ?? input.actor ?? "agent:unknown"
  };
  return finalizeDesign(design, context);
}

export function createBuildingUpgradeDraft(building, input = {}, context = {}) {
  if (!building?.id) throw new Error("Upgrade design requires an existing building");
  const prior = building.voxelDesign;
  if (!prior?.generation?.sourceSpec) {
    throw new Error("Building does not have a versioned voxel design and cannot use structured upgrades");
  }
  const id = String(context.id ?? input.id ?? `upgrade-${building.id}-${Date.now()}`);
  const base = structuredClone(prior);
  const design = {
    ...base,
    id,
    revision: 1,
    status: "editable",
    source: {
      kind: "upgrade",
      buildingId: building.id,
      baseDesignId: prior.id,
      baseDesignRevision: prior.revision
    },
    createdBy: context.actor ?? input.actor ?? "agent:unknown",
    availableOperations: availableOperations(base.generation.mode, base.intent)
  };
  delete design.specHash;

  const goal = input.goal ?? {};
  if (goal.type === "add_floors" || goal.type === "add_floor") {
    design.revision = 0;
    return reviseBuildingDesign(design, {
      expected_revision: 0,
      operations: [{ op: "add_floor", count: goal.count ?? 1 }]
    }, context);
  }
  return finalizeDesign(design, context);
}

export function reviseBuildingDesign(current, input = {}, context = {}) {
  if (!current?.id) throw new Error("Building design is required");
  if (current.status !== "editable") throw new Error(`Building design is ${current.status} and cannot be revised`);
  const expected = Number(input.expected_revision ?? input.expectedRevision);
  if (!Number.isInteger(expected)) throw new Error("expected_revision is required");
  if (expected !== current.revision) throw new Error(`Building design revision conflict: expected ${expected}, actual ${current.revision}`);
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (!operations.length) throw new Error("At least one design operation is required");

  const next = structuredClone(current);
  const changes = [];
  for (const operation of operations) {
    changes.push(applyOperation(next, operation));
  }
  next.revision += 1;
  next.lastChanges = changes;
  next.availableOperations = availableOperations(next.generation.mode, next.intent);
  delete next.specHash;
  return finalizeDesign(next, context);
}

export function confirmBuildingDesign(current, input = {}, context = {}) {
  if (!current?.id) throw new Error("Building design is required");
  const expected = Number(input.expected_revision ?? input.expectedRevision);
  if (!Number.isInteger(expected)) throw new Error("expected_revision is required");
  if (expected !== current.revision) throw new Error(`Building design revision conflict: expected ${expected}, actual ${current.revision}`);
  if (current.status === "built") throw new Error("Built designs cannot be confirmed again");
  const compileDiagnostics = compileBuildingDesign(current);
  const confirmed = {
    ...structuredClone(current),
    status: "confirmed",
    compileDiagnostics,
    confirmedAt: context.now?.() ?? new Date().toISOString()
  };
  return finalizeDesign(confirmed, context);
}

export function recommendGenerationMode(input = {}, requestedFootprint = null) {
  const intent = input.intentVersion ? input : normalizeIntentAliases(input);
  const footprint = requestedFootprint ? parseFootprint(requestedFootprint) : null;
  if (footprint && footprint.columns * footprint.rows > 1) return "urban_massing";
  if (intent.frontage === "institutional" || intent.prominence === "landmark") return "urban_massing";
  if (["court", "hall", "tower", "yard"].includes(intent.composition)) return "urban_massing";
  return "floor_stack";
}

export function buildingDesignToConstructionBody(design, input = {}) {
  if (!design?.generation?.sourceSpec) throw new Error("Building design has no source spec");
  if (!["confirmed", "built"].includes(design.status)) throw new Error(`Building design must be confirmed before construction; current status is ${design.status}`);
  const footprint = design.site.footprint;
  const floors = design.generation.mode === "floor_stack"
    ? design.generation.sourceSpec.floors
    : estimateMassingStoreys(design.generation.sourceSpec);
  return {
    ...input,
    design_id: design.id,
    design_revision: design.revision,
    design_hash: design.specHash,
    site: {
      lot_id: design.site.lotId,
      footprint,
      entrance: design.site.entrance,
      entrance_cell_id: design.ports?.find((port) => port.type === "primary_entrance")?.frontageCellId
    },
    program: {
      archetype: `voxel_${design.generation.mode}`,
      purpose: design.intent.purpose,
      name: design.intent.name,
      description: design.intent.description,
      attributes: { voxelFloors: floors }
    },
    design: {
      district_style: design.intent.style,
      patterns: [],
      creative_brief: design.intent.description || design.intent.purpose
    },
    asset: { mode: "voxel" },
    agent_guidance: createAgentGuidance(design),
    actual_architecture: structuredClone(design.actualArchitecture ?? null),
    architecture_review: structuredClone(design.architectureReview ?? null),
    voxel_design: structuredClone(design)
  };
}

function recommendGeneration({ id, seed, intent, mode, site, requirements, districtContext = null }) {
  if (mode === "floor_stack") {
    const recommended = adaptBuildingIntentToStreetConfig(intent, {
      seed,
      buildingCount: 1,
      parcelWidth: 32,
      parcelDepth: 32,
      districtContext
    });
    const preferredFloors = integerInRange(requirements.preferred_floors ?? requirements.preferredFloors, 1, 8, recommended.floors);
    const sourceSpec = createBuildingSpec({
      ...recommended,
      id: `${id}-building`,
      seed,
      widthVoxels: 32,
      depthVoxels: 32,
      origin: { x: -16, y: 0, z: -16 },
      baseFloors: preferredFloors,
      floors: preferredFloors,
      intent
    });
    return {
      mode,
      specVersion: `building-spec@${sourceSpec.specVersion}`,
      generatorVersion: "voxel-building@0.3",
      sourceSpec
    };
  }

  const shape = parseFootprint(site.footprint);
  const rotated = site.entrance === "east" || site.entrance === "west";
  const recommended = adaptBuildingIntentToMassingConfig(intent, {
    id: `${id}-massing`,
    seed,
    // Runtime rotates the authored south/north facade toward the requested
    // entrance. Swap rectangular source dimensions before a quarter turn so
    // the resulting geometry still fits the reserved logical footprint.
    widthCells: rotated ? shape.rows : shape.columns,
    depthCells: rotated ? shape.columns : shape.rows,
    variantId: requirements.variant_id ?? requirements.variantId,
    districtContext
  });
  let sourceSpec;
  try {
    sourceSpec = createUrbanMassingSpec(recommended);
  } catch (error) {
    // Semantic presets are authored at preferred dimensions. A smaller or
    // rotated legal parcel must still receive a valid recommendation rather
    // than exposing a late preset indexing error to the agent.
    sourceSpec = createUrbanMassingSpec(createGenericMassingRecommendation({
      id: `${id}-massing`,
      seed,
      widthCells: rotated ? shape.rows : shape.columns,
      depthCells: rotated ? shape.columns : shape.rows,
      intent,
      cause: error.message
    }));
  }
  return {
    mode,
    specVersion: `urban-massing@${sourceSpec.specVersion}`,
    generatorVersion: "voxel-massing@0.1",
    sourceSpec
  };
}

export function compileBuildingDesign(design) {
  if (!design?.generation?.sourceSpec) throw new Error("Building design has no source spec to compile");
  let object;
  try {
    object = design.generation.mode === "urban_massing"
      ? createVoxelMassingLab({ spec: design.generation.sourceSpec, decorations: design.decorations, renderStrategy: "greedy" })
      : createVoxelBuildingFromSpec(design.generation.sourceSpec, { decorations: design.decorations, renderStrategy: "greedy" });
  } catch (error) {
    throw new Error(`Voxel design compile failed: ${error.message}`);
  }
  const source = object.userData?.diagnostics ?? {};
  const metrics = { objectCount: 0, meshCount: 0, vertexCount: 0, triangleCount: 0 };
  object.traverse((child) => {
    metrics.objectCount += 1;
    if (!child.isMesh) return;
    metrics.meshCount += 1;
    const positions = child.geometry?.getAttribute?.("position");
    const indices = child.geometry?.getIndex?.();
    metrics.vertexCount += positions?.count ?? 0;
    metrics.triangleCount += indices ? Math.floor(indices.count / 3) : Math.floor((positions?.count ?? 0) / 3);
  });
  const diagnostics = {
    status: "compiled",
    renderer: object.userData?.contract?.renderer ?? object.userData?.contract?.mode ?? `voxel-${design.generation.mode}`,
    generationMode: design.generation.mode,
    occupiedVoxels: Number(source.occupiedVoxels ?? source.voxelCount ?? object.userData?.sourceVoxelCount ?? 0),
    decorationCount: design.decorations?.items?.length ?? 0,
    footprint: structuredClone(design.generation.sourceSpec.footprint ?? null),
    coordinateTransform: {
      authoredEntranceFace: "south",
      worldEntranceFace: design.site.entrance,
      quarterTurns: ({ north: 0, east: 1, south: 2, west: -1 })[design.site.entrance] ?? 2,
      sourceDimensionsSwapped: design.generation.mode === "urban_massing" && ["east", "west"].includes(design.site.entrance)
    },
    primaryEntrancePort: structuredClone(design.ports?.find((port) => port.type === "primary_entrance") ?? null),
    ...metrics
  };
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
    else child.material?.dispose?.();
  });
  if (diagnostics.occupiedVoxels <= 0 || diagnostics.meshCount <= 0) throw new Error("Voxel design compile produced no occupied geometry");
  return diagnostics;
}

function createGenericMassingRecommendation({ id, seed, widthCells, depthCells, intent, cause }) {
  const cells = [];
  for (let z = 0; z < depthCells; z += 1) for (let x = 0; x < widthCells; x += 1) cells.push([x, z]);
  const heightVoxels = intent.prominence === "landmark" ? 52 : intent.prominence === "important" ? 40 : 30;
  return {
    id,
    seed,
    widthCells,
    depthCells,
    intent,
    metadata: { recommendationFallback: "parcel_fitted_primary_mass", presetFailure: cause },
    masses: [{
      id: "primary",
      role: "primary",
      type: "solid",
      cells,
      heightVoxels,
      cap: { type: intent.composition === "tower" ? "spire" : intent.composition === "hall" ? "gable" : "mansard", heightVoxels: 10 },
      facade: { entranceEmphasis: 1, openness: 0.38, detailDensity: 0.8, floorHeightVoxels: 15, bayWidthVoxels: 8 },
      materials: { wall: intent.style === "industrial_iron" ? "brickBrown" : "brickRed", trim: "limestone", roof: "slate", window: "warmWindow", door: "timber" }
    }],
    relations: []
  };
}

function createPrimaryEntrancePort(site) {
  const lot = /^cell-(-?\d+)-(-?\d+)$/.exec(site.lotId);
  const shape = parseFootprint(site.footprint);
  if (!lot) return { id: "primary-entrance", type: "primary_entrance", face: site.entrance, frontageCellId: null };
  const column = Number(lot[1]);
  const row = Number(lot[2]);
  const localColumn = site.entrance === "east" ? shape.columns - 1 : site.entrance === "west" ? 0 : Math.floor((shape.columns - 1) / 2);
  const localRow = site.entrance === "south" ? shape.rows - 1 : site.entrance === "north" ? 0 : Math.floor((shape.rows - 1) / 2);
  const frontageColumn = column + localColumn + (site.entrance === "east" ? 1 : site.entrance === "west" ? -1 : 0);
  const frontageRow = row + localRow + (site.entrance === "south" ? 1 : site.entrance === "north" ? -1 : 0);
  return {
    id: "primary-entrance",
    type: "primary_entrance",
    face: site.entrance,
    localCell: { column: localColumn, row: localRow },
    alongRatio: 0.5,
    frontageCellId: `cell-${frontageColumn}-${frontageRow}`
  };
}

function applyOperation(design, rawOperation = {}) {
  const operation = normalizeOperation(rawOperation);
  if (![...COMMON_OPERATIONS, ...MODE_OPERATIONS[design.generation.mode]].includes(operation.op)) {
    throw new Error(`Operation ${operation.op} is not available for ${design.generation.mode}`);
  }
  const lockedScope = lockedScopeForOperation(design.locks, operation.op);
  if (lockedScope) throw new Error(`Operation ${operation.op} is blocked by the ${lockedScope} design lock`);
  switch (operation.op) {
    case "set_intent":
      design.intent = normalizeIntentAliases({ ...design.intent, ...(operation.intent ?? operation.value ?? {}) });
      return { op: operation.op, fields: Object.keys(operation.intent ?? operation.value ?? {}) };
    case "regenerate_from_intent":
      return regenerateFromIntent(design, operation);
    case "add_decoration":
      return addDecoration(design, operation);
    case "update_decoration":
      return updateDecoration(design, operation);
    case "remove_decoration":
      return removeDecoration(design, operation);
    case "add_floor":
      return addFloor(design, operation);
    case "set_floor_program":
      return setFloorProgram(design, operation);
    case "set_roof":
      return setRoof(design, operation);
    case "set_material":
      return setMaterial(design, operation);
    case "add_mass":
      return addMass(design, operation);
    case "update_mass":
      return updateMass(design, operation);
    case "remove_mass":
      return removeMass(design, operation);
    default:
      throw new Error(`Unsupported design operation: ${operation.op}`);
  }
}

function addFloor(design, operation) {
  const count = integerInRange(operation.count, 1, 2, 1);
  if (design.generation.mode === "floor_stack") {
    const current = design.generation.sourceSpec;
    const nextFloors = Math.min(8, current.floors + count);
    if (nextFloors === current.floors) throw new Error("floor_stack has reached its maximum floor count");
    const programs = current.floorSpecs.map(floorProgramFromSpec);
    while (programs.length < nextFloors) programs.push({ ...programs.at(-1), balcony: "none" });
    design.generation.sourceSpec = createBuildingSpec({
      ...buildingOptionsFromSpec(current),
      baseFloors: nextFloors,
      expandedBy: 0,
      floorPrograms: programs,
      intent: design.intent
    });
    return { op: operation.op, addedFloors: nextFloors - current.floors, preservedFloorIds: current.floorSpecs.map((floor) => floor.index) };
  }

  const current = design.generation.sourceSpec;
  const primary = current.masses.find((mass) => mass.role === "primary") ?? current.masses.find((mass) => mass.type !== "ground");
  if (!primary) throw new Error("urban_massing has no structural mass to extend");
  const floorHeight = primary.facade?.floorHeightVoxels ?? 20;
  const masses = current.masses.map((mass) => mass.id === primary.id
    ? { ...mass, heightVoxels: Math.min(192, mass.heightVoxels + floorHeight * count) }
    : mass);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses, intent: design.intent });
  return { op: operation.op, massId: primary.id, addedFloors: count, addedHeightVoxels: floorHeight * count };
}

function setFloorProgram(design, operation) {
  const current = design.generation.sourceSpec;
  const index = Number(operation.floor_index ?? operation.floorIndex ?? operation.floor_id?.replace(/^floor-/, ""));
  if (!Number.isInteger(index) || index < 0 || index >= current.floors) throw new Error("set_floor_program requires an existing floor_index");
  const programs = current.floorSpecs.map(floorProgramFromSpec);
  programs[index] = {
    ...programs[index],
    ...(operation.program ?? {}),
    ...(operation.purpose ? { purpose: operation.purpose } : {}),
    ...(operation.window_ratio != null ? { windowRatio: operation.window_ratio } : {}),
    ...(operation.windowRatio != null ? { windowRatio: operation.windowRatio } : {})
  };
  design.generation.sourceSpec = createBuildingSpec({
    ...buildingOptionsFromSpec(current),
    floorPrograms: programs,
    intent: design.intent
  });
  return { op: operation.op, floorIndex: index };
}

function setRoof(design, operation) {
  const roof = operation.roof ?? operation.cap ?? operation.value ?? {};
  if (design.generation.mode === "floor_stack") {
    const current = design.generation.sourceSpec;
    const regenerated = createBuildingSpec({
      ...buildingOptionsFromSpec(current),
      roofForm: roof.form ?? roof.type ?? current.roof.form,
      ridgePosition: roof.ridge_ratio ?? roof.ridgeRatio ?? current.roof.ridgeRatio,
      intent: design.intent
    });
    regenerated.roof = { ...regenerated.roof, ...camelizeRoof(roof) };
    design.generation.sourceSpec = regenerated;
    return { op: operation.op, target: "building" };
  }
  const current = design.generation.sourceSpec;
  const massId = operation.mass_id ?? operation.massId ?? current.masses.find((mass) => mass.role === "primary")?.id ?? current.masses[0]?.id;
  const masses = current.masses.map((mass) => mass.id === massId ? { ...mass, cap: { ...mass.cap, ...roof } } : mass);
  if (!masses.some((mass) => mass.id === massId)) throw new Error(`Unknown mass ${massId}`);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses, intent: design.intent });
  return { op: operation.op, massId };
}

function setMaterial(design, operation) {
  const slot = String(operation.slot ?? operation.material_slot ?? "wall");
  const material = String(operation.material ?? operation.value ?? "");
  if (!material) throw new Error("set_material requires a material");
  if (design.generation.mode === "floor_stack") {
    design.generation.sourceSpec.materials = { ...design.generation.sourceSpec.materials, [slot]: material };
    return { op: operation.op, target: "building", slot, material };
  }
  const current = design.generation.sourceSpec;
  const massId = operation.mass_id ?? operation.massId ?? current.masses.find((mass) => mass.role === "primary")?.id ?? current.masses[0]?.id;
  const masses = current.masses.map((mass) => mass.id === massId
    ? { ...mass, materials: { ...mass.materials, [slot]: material } }
    : mass);
  if (!masses.some((mass) => mass.id === massId)) throw new Error(`Unknown mass ${massId}`);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses, intent: design.intent });
  return { op: operation.op, massId, slot, material };
}

function addMass(design, operation) {
  const current = design.generation.sourceSpec;
  const mass = operation.mass;
  if (!mass?.id) throw new Error("add_mass requires mass.id");
  if (current.masses.some((entry) => entry.id === mass.id)) throw new Error(`Duplicate mass id: ${mass.id}`);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses: [...current.masses, mass], intent: design.intent });
  return { op: operation.op, massId: mass.id };
}

function updateMass(design, operation) {
  const current = design.generation.sourceSpec;
  const massId = operation.mass_id ?? operation.massId;
  const patch = operation.changes ?? operation.patch ?? {};
  if (!massId || !current.masses.some((mass) => mass.id === massId)) throw new Error(`Unknown mass ${massId ?? ""}`.trim());
  const masses = current.masses.map((mass) => mass.id === massId ? deepMerge(mass, patch) : mass);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses, intent: design.intent });
  return { op: operation.op, massId, fields: Object.keys(patch) };
}

function removeMass(design, operation) {
  const current = design.generation.sourceSpec;
  const massId = operation.mass_id ?? operation.massId;
  if (!massId || !current.masses.some((mass) => mass.id === massId)) throw new Error(`Unknown mass ${massId ?? ""}`.trim());
  if (current.masses.length === 1) throw new Error("Cannot remove the final mass");
  const masses = current.masses.filter((mass) => mass.id !== massId);
  const relations = current.relations.filter((relation) => relation.from !== massId && relation.to !== massId);
  design.generation.sourceSpec = createUrbanMassingSpec({ ...current, masses, relations, intent: design.intent });
  return { op: operation.op, massId, removedRelations: current.relations.length - relations.length };
}

function addDecoration(design, operation) {
  const item = normalizeDecoration(operation.decoration ?? operation.item ?? operation);
  if (design.decorations.items.some((entry) => entry.id === item.id)) throw new Error(`Duplicate decoration id: ${item.id}`);
  design.decorations.items.push(item);
  return { op: operation.op, decorationId: item.id, anchor: item.anchor };
}

function updateDecoration(design, operation) {
  const id = String(operation.id ?? operation.decoration_id ?? "");
  const index = design.decorations.items.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error(`Unknown decoration ${id}`);
  design.decorations.items[index] = normalizeDecoration(deepMerge(design.decorations.items[index], operation.changes ?? operation.patch ?? {}));
  return { op: operation.op, decorationId: id };
}

function removeDecoration(design, operation) {
  const id = String(operation.id ?? operation.decoration_id ?? "");
  const before = design.decorations.items.length;
  design.decorations.items = design.decorations.items.filter((entry) => entry.id !== id);
  if (before === design.decorations.items.length) throw new Error(`Unknown decoration ${id}`);
  return { op: operation.op, decorationId: id };
}

function recommendSite(site = {}, requestedFootprint, mode, intent) {
  let footprint = requestedFootprint;
  if (!footprint) {
    if (mode === "floor_stack") footprint = "1x1";
    else {
      const defaults = intent.prominence === "landmark" ? [5, 3] : intent.prominence === "important" ? [3, 2] : [2, 2];
      footprint = `${defaults[0]}x${defaults[1]}`;
    }
  }
  parseFootprint(footprint);
  const lotId = site.lot_id ?? site.lotId;
  if (!lotId) throw new Error("Building design requires site.lot_id");
  const entrance = String(site.entrance ?? "south").toLowerCase();
  if (!["north", "east", "south", "west"].includes(entrance)) throw new Error(`Unsupported entrance direction: ${entrance}`);
  return { lotId: String(lotId), footprint, entrance };
}

function normalizeIntentAliases(input = {}) {
  const catalog = getBuildingIntentCatalog();
  for (const field of ["composition", "frontage", "access", "style", "prominence"]) {
    if (input[field] != null && !catalog[field].includes(input[field])) {
      throw new Error(`Unsupported building intent ${field}: ${input[field]}; expected one of ${catalog[field].join(", ")}`);
    }
  }
  return normalizeBuildingIntent({
    ...input,
    signText: input.signText ?? input.sign_text,
    magicLevel: input.magicLevel ?? input.magic_level
  });
}

function normalizeMode(value, allowAuto = false) {
  const mode = String(value ?? "auto").toLowerCase();
  if (allowAuto && mode === "auto") return mode;
  if (!BUILDING_GENERATION_MODES.includes(mode)) throw new Error(`Unsupported building generation mode: ${mode}`);
  return mode;
}

function normalizeRequestedFootprint(value) {
  if (value == null || value === "") return null;
  return parseFootprint(value).id;
}

function parseFootprint(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value ?? ""));
  if (!match) throw new Error(`Invalid footprint: ${value}`);
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  if (columns < 1 || rows < 1 || columns > 6 || rows > 6) throw new Error("Building design footprint must fit inside 6x6 logical cells");
  return { id: `${columns}x${rows}`, columns, rows };
}

function normalizeDecorationSpec(value = {}) {
  const items = Array.isArray(value?.items) ? value.items.map(normalizeDecoration) : [];
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Duplicate decoration id: ${item.id}`);
    ids.add(item.id);
  }
  return { specVersion: DECORATION_SPEC_VERSION, items };
}

function normalizeDecoration(value = {}) {
  const id = String(value.id ?? value.decoration_id ?? "").trim();
  const type = String(value.type ?? "").trim();
  const anchor = String(value.anchor ?? "").trim();
  if (!id || !type || !anchor) throw new Error("Decoration requires id, type, and anchor");
  if (!BUILDING_DECORATION_TYPES.includes(type)) {
    throw new Error(`Unsupported decoration type: ${type}; expected one of ${BUILDING_DECORATION_TYPES.join(", ")}`);
  }
  const parameters = type === "semantic_grid_sign"
    ? normalizeSemanticGridSignParameters(value.parameters)
    : structuredClone(value.parameters ?? {});
  return { id, type, anchor, parameters };
}

function normalizeSemanticGridSignParameters(value = {}) {
  const rows = Array.isArray(value.grid) ? value.grid.map((row) => String(row).replace(/\s+/g, "")) : [];
  if (rows.length !== 4 || rows.some((row) => !/^[01.#]{4}$/.test(row))) {
    throw new Error("semantic_grid_sign parameters.grid must contain four 4-cell rows using 0/1 or ./#");
  }
  const frameMaterial = String(value.frameMaterial ?? value.frame_material ?? "iron");
  const boardMaterial = String(value.boardMaterial ?? value.board_material ?? "timber");
  const emissiveMaterial = String(value.emissiveMaterial ?? value.emissive_material ?? "violetMagic");
  const frameStyle = String(value.frameStyle ?? value.frame_style ?? "simple");
  if (!SEMANTIC_GRID_SIGN_MATERIALS.frame.includes(frameMaterial)) {
    throw new Error(`Unsupported semantic grid sign frame material: ${frameMaterial}`);
  }
  if (!SEMANTIC_GRID_SIGN_MATERIALS.board.includes(boardMaterial)) {
    throw new Error(`Unsupported semantic grid sign board material: ${boardMaterial}`);
  }
  if (!SEMANTIC_GRID_SIGN_MATERIALS.emissive.includes(emissiveMaterial)) {
    throw new Error(`Unsupported semantic grid sign emissive material: ${emissiveMaterial}`);
  }
  if (!SEMANTIC_GRID_SIGN_FRAME_STYLES.includes(frameStyle)) {
    throw new Error(`Unsupported semantic grid sign frame style: ${frameStyle}`);
  }
  return {
    ...structuredClone(value),
    grid: rows.map((row) => row.replace(/[.#]/g, (cell) => cell === "#" ? "1" : "0")),
    frameMaterial,
    boardMaterial,
    emissiveMaterial,
    frameStyle,
    mount: value.mount === "wall" ? "wall" : "projecting",
    scale: 1,
    microVoxelSize: SEMANTIC_GRID_SIGN_MICRO_VOXEL.fixed,
    emissiveIntensity: Math.max(0, Math.min(3, Number(value.emissiveIntensity ?? value.emissive_intensity ?? 1.35))),
    lightIntensity: Math.max(0, Math.min(5, Number(value.lightIntensity ?? value.light_intensity ?? 1.4))),
    offsetX: Math.max(-1.5, Math.min(1.5, Number(value.offsetX ?? value.offset_x ?? 0))),
    offsetY: Math.max(-0.5, Math.min(1.5, Number(value.offsetY ?? value.offset_y ?? 0.72)))
  };
}

function normalizeLocks(value) {
  return [...new Set(Array.isArray(value) ? value.map(String) : [])];
}

function normalizeOperation(value) {
  if (!value || typeof value !== "object") throw new Error("Design operation must be an object");
  const op = String(value.op ?? "").trim();
  if (!op) throw new Error("Design operation requires op");
  return { ...value, op };
}

function availableOperations(mode, intent = {}) {
  return {
    common: [...COMMON_OPERATIONS],
    modeSpecific: [...MODE_OPERATIONS[normalizeMode(mode)]],
    decorationTypes: [...BUILDING_DECORATION_TYPES],
    semanticGridSign: {
      grid: "four rows of four cells using 0/1 or ./#",
      materials: structuredClone(SEMANTIC_GRID_SIGN_MATERIALS),
      frameStyles: [...SEMANTIC_GRID_SIGN_FRAME_STYLES],
      mounts: ["projecting", "wall"],
      defaultMount: "projecting",
      microVoxelSize: structuredClone(SEMANTIC_GRID_SIGN_MICRO_VOXEL)
    },
    anchorPatterns: mode === "floor_stack"
      ? [
          "main/floor-{index}/facade-{direction}/bay-{index}",
          "main/floor-{index}/facade-{direction}/entrance",
          "main/roof"
        ]
      : ["{mass_id}/facade-{direction}", "{mass_id}/cap", "site"],
    ...(mode === "urban_massing" ? {
      publicMassing: {
        program: inferPublicBuildingProgram(intent.purpose),
        variants: getPublicBuildingVariantCatalog(inferPublicBuildingProgram(intent.purpose))
      }
    } : {})
  };
}

function regenerateFromIntent(design, operation) {
  const nextIntent = normalizeIntentAliases({
    ...design.intent,
    ...(operation.intent ?? operation.value ?? {})
  });
  const footprint = parseFootprint(design.site.footprint);
  const mode = recommendGenerationMode(nextIntent, footprint.id);
  const preferredFloors = design.generation.mode === "floor_stack"
    ? design.generation.sourceSpec.floors
    : undefined;
  design.intent = nextIntent;
  design.generation = recommendGeneration({
    id: design.id,
    seed: String(operation.seed ?? design.generation.sourceSpec.seed ?? design.id),
    intent: nextIntent,
    mode,
    site: design.site,
    requirements: {
      ...(preferredFloors ? { preferred_floors: preferredFloors } : {}),
      variant_id: operation.variant_id ?? operation.variantId
    },
    districtContext: design.districtContext
  });
  design.ports = [createPrimaryEntrancePort(design.site)];
  if (!(operation.preserve_decorations ?? operation.preserveDecorations)) {
    design.decorations = normalizeDecorationSpec();
  }
  return {
    op: operation.op,
    mode,
    preserved: ["site", ...(operation.preserve_decorations ?? operation.preserveDecorations ? ["decorations"] : [])]
  };
}

function floorProgramFromSpec(floor) {
  return {
    purpose: floor.purpose,
    setbackVoxels: floor.frontSetbackVoxels ?? floor.setbackVoxels ?? 0,
    balcony: floor.balcony ?? "none",
    windowRatio: floor.windowRatio
  };
}

function buildingOptionsFromSpec(spec) {
  return {
    id: spec.id,
    seed: spec.seed,
    style: spec.style,
    widthVoxels: spec.footprint.widthVoxels,
    depthVoxels: spec.footprint.depthVoxels,
    origin: spec.origin,
    baseFloors: spec.floors,
    expandedBy: 0,
    floorHeight: spec.floorHeight,
    floorPrograms: spec.floorSpecs.map(floorProgramFromSpec),
    roofForm: spec.roof.form,
    ridgePosition: spec.roof.ridgeRatio,
    variation: spec.variation,
    sideFacadeSides: Object.keys(spec.sideFacades ?? {}),
    adjacency: spec.adjacency,
    detailDensity: spec.intent?.magicLevel ?? 0.7,
    metadata: spec.metadata
  };
}

function camelizeRoof(roof) {
  return {
    ...(["flat", "pitched"].includes(roof.type) ? { type: roof.type } : {}),
    ...(roof.form ? { form: roof.form } : {}),
    ...(roof.ridge_ratio != null ? { ridgeRatio: Number(roof.ridge_ratio) } : {}),
    ...(roof.ridgeRatio != null ? { ridgeRatio: Number(roof.ridgeRatio) } : {}),
    ...(roof.dormer_count != null ? { dormerCount: Number(roof.dormer_count) } : {}),
    ...(roof.dormerCount != null ? { dormerCount: Number(roof.dormerCount) } : {})
  };
}

function estimateMassingStoreys(spec) {
  const highest = Math.max(...spec.masses.filter((mass) => mass.type !== "ground").map((mass) => mass.baseYVoxels + mass.heightVoxels), 20);
  return Math.max(1, Math.round(highest / 20));
}

function integerInRange(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function deepMerge(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
  const result = { ...(target ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(result[key], value)
      : structuredClone(value);
  }
  return result;
}

function finalizeDesign(design, context) {
  const value = structuredClone(design);
  value.decorations.items.forEach((item) => validateDecorationAnchor(value, item));
  value.actualArchitecture = value.generation.mode === "urban_massing"
    ? summarizeMassingArchitecture(value.generation.sourceSpec)
    : summarizeFloorStackArchitecture(value.generation.sourceSpec);
  value.architectureReview = isPublicBuildingDesign(value)
    ? createPublicArchitectureReview(value.intent, value.actualArchitecture)
    : null;
  value.agentGuidance = createAgentGuidance(value);
  value.specHash = (context.hash ?? fallbackHash)(designHashSource(value));
  return value;
}

function createAgentGuidance(design) {
  const guidance = [];
  if (design.architectureReview && isPublicBuildingDesign(design)) {
    guidance.push({
      code: "public_architecture_review_required",
      phase: "design_after_generation",
      severity: design.architectureReview.conflicts.length ? "recommendation" : "review",
      blocking: false,
      message: "Review actualArchitecture against the building purpose before confirmation. If it does not fit, revise a mass or regenerate from intent.",
      actualArchitecture: structuredClone(design.actualArchitecture),
      review: structuredClone(design.architectureReview),
      suggestedActions: [
        { operation: "update_mass", when: "Only one or two components need correction." },
        { operation: "regenerate_from_intent", when: "The overall scheme does not match the intended function." }
      ]
    });
  }

  if (isResidentialDesign(design)) {
    guidance.push(createDistrictAlignmentGuidance(design));
  }

  const hasCustomSign = design.decorations?.items?.some((item) => item.type === "semantic_grid_sign");
  const groundPurpose = design.generation?.mode === "floor_stack"
    ? design.generation.sourceSpec?.floorSpecs?.[0]?.purpose
    : null;
  const isStreetShop = design.intent?.frontage === "display" || groundPurpose === "shop";
  if (isStreetShop && !hasCustomSign) guidance.push({
    code: "custom_shop_sign_recommended",
    phase: "design_before_construction",
    severity: "recommendation",
    blocking: false,
    message: "Add a custom semantic_grid_sign before construction so the shop's street-facing function is recognizable.",
    suggestedAction: {
      operation: "add_decoration",
      decorationType: "semantic_grid_sign",
      anchor: "main/floor-0/facade-south/entrance",
      agentChooses: ["grid", "frameMaterial", "boardMaterial", "emissiveMaterial", "frameStyle"]
    }
  });
  return guidance;
}

function isPublicBuildingDesign(design) {
  return design.generation?.mode === "urban_massing"
    && !isResidentialDesign(design)
    && (design.intent?.frontage === "institutional"
      || design.intent?.prominence !== "ordinary"
      || ["public", "ceremonial"].includes(design.intent?.access)
      || ["library", "academy", "greenhouse", "workshop", "civic"].includes(inferPublicBuildingProgram(design.intent?.purpose)));
}

function isResidentialDesign(design) {
  return design.intent?.frontage === "residential"
    || inferPublicBuildingProgram(design.intent?.purpose) === "residential";
}

function createDistrictAlignmentGuidance(design) {
  const context = design.districtContext;
  return {
    code: "district_architecture_alignment",
    phase: "design_before_construction",
    severity: "recommendation",
    blocking: false,
    message: context
      ? "Keep the house recognizably part of this district, then vary one or two structural cues so the street does not read as a copied row."
      : "Before confirmation, compare this house with the current district's dominant style and choose a restrained variation direction.",
    districtContext: structuredClone(context),
    suggestedAction: {
      operation: "regenerate_from_intent",
      agentChooses: ["district_style", "variation_intent", "preserve", "change"],
      preserveExamples: ["wall_material", "height_range", "roof_family", "street_setback"],
      variationExamples: ["roof_orientation", "frontage_width", "corner_condition", "step_back", "entrance_position"]
    }
  };
}

function validateDecorationAnchor(design, item) {
  if (design.generation.mode === "floor_stack") {
    if (/\/roof(?:\/|$)|\/cap(?:\/|$)/i.test(item.anchor)) return;
    const floorIndex = Number(/floor-(\d+)/i.exec(item.anchor)?.[1]);
    const bayIndex = Number(/bay-(\d+)/i.exec(item.anchor)?.[1]);
    const entranceAnchor = /\/entrance(?:\/|$)/i.test(item.anchor);
    const face = decorationAnchorFace(item.anchor);
    if (!Number.isInteger(floorIndex) || floorIndex < 0 || floorIndex >= design.generation.sourceSpec.floors) {
      throw new Error(`Decoration ${item.id} references an invalid floor anchor`);
    }
    const facade = face === "west" ? design.generation.sourceSpec.sideFacades.left
      : face === "east" ? design.generation.sourceSpec.sideFacades.right
        : design.generation.sourceSpec.facade;
    if (!facade || (!entranceAnchor && (!Number.isInteger(bayIndex) || bayIndex < 0 || bayIndex >= facade.bays.length))) {
      throw new Error(`Decoration ${item.id} references an invalid facade bay anchor`);
    }
    return;
  }
  const massId = String(item.anchor).split("/")[0];
  if (!design.generation.sourceSpec.masses.some((mass) => mass.id === massId)) {
    throw new Error(`Decoration ${item.id} references unknown mass ${massId}`);
  }
  if (!/(?:facade-(?:north|east|south|west)|roof|cap|site)(?:\/|$)/i.test(item.anchor)) {
    throw new Error(`Decoration ${item.id} requires a stable facade, roof, cap, or site anchor`);
  }
}

function decorationAnchorFace(path) {
  return /facade-(north|east|south|west)/i.exec(String(path))?.[1]?.toLowerCase() ?? "south";
}

function lockedScopeForOperation(locks, operation) {
  const values = new Set(locks ?? []);
  const scopes = {
    set_intent: ["intent"],
    regenerate_from_intent: ["intent", "layout", "form"],
    set_roof: ["roof", "form"],
    set_material: ["materials", "detail"],
    add_decoration: ["decorations", "detail"],
    update_decoration: ["decorations", "detail"],
    remove_decoration: ["decorations", "detail"],
    add_floor: ["floors", "form"],
    set_floor_program: ["floors", "detail"],
    add_mass: ["layout", "form"],
    update_mass: ["layout", "form"],
    remove_mass: ["layout", "form"]
  }[operation] ?? [];
  return scopes.find((scope) => values.has(scope)) ?? null;
}

function designHashSource(design) {
  const value = structuredClone(design);
  delete value.specHash;
  delete value.agentGuidance;
  delete value.status;
  delete value.confirmedAt;
  delete value.lastChanges;
  delete value.compileDiagnostics;
  delete value.actualArchitecture;
  delete value.architectureReview;
  return value;
}

function fallbackHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
