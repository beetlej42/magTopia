export const GAMEPLAY_SCHEMA_VERSION = 2;

// v0.3 gameplay is expressed in functional units.  Keep this contract
// separate from GAMEPLAY_SCHEMA_VERSION, which is the persisted turn/state
// schema and still has legacy consumers during the migration.
export const GAMEPLAY_BUILDING_SCHEMA_VERSION = 1;
export const GAMEPLAY_PURPOSES = Object.freeze([
  "residential",
  "commercial",
  "public_service",
  "production",
  "greenhouse"
]);
export const MAGIC_RATIOS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
export const GAMEPLAY_GRAMMAR_FIELDS = Object.freeze([
  "units",
  "functionalUnits",
  "floors",
  "floorSpecs",
  "floorPrograms",
  "masses",
  "massSpecs"
]);
// Accepted grammar spellings are deliberately enumerated so a near-miss
// such as floor_specs cannot silently fall through to a different source.
export const GAMEPLAY_GRAMMAR_ARRAY_FIELDS = Object.freeze([
  ...GAMEPLAY_GRAMMAR_FIELDS,
  "floor_specs",
  "functional_units",
  "floor_programs",
  "mass_specs"
]);

export const TURN_STATUSES = Object.freeze(["open", "building", "strategy", "resolved", "reported", "closed"]);

export const CARD_CHOICE_STATUSES = Object.freeze(["pending", "selected", "skipped", "resolved"]);

export const CARD_DECISION_MODES = Object.freeze(["immediate", "player_place", "delegate_to_agent"]);

export const PLACEMENT_STATUSES = Object.freeze(["pending", "deferred", "completed", "cancelled"]);

export const POLICY_DURATION_TYPES = Object.freeze(["instant", "turns", "until_replaced"]);

export const ARCANE_OFFICER_STATUSES = Object.freeze(["available", "assigned", "unavailable"]);

export const INCIDENT_TYPES = Object.freeze(["investigation", "containment", "concealment"]);

export const INCIDENT_STATUSES = Object.freeze(["open", "assigned", "resolved", "failed", "escalated"]);

export const RESULT_GRADES = Object.freeze(["critical_success", "success", "failure", "critical_failure"]);

export const SEALED_EXPOSURE_THRESHOLD = 100;

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Normalize a v0.3 gameplay purpose.  Purpose aliases from the old
 * category model are deliberately not accepted here: callers must migrate
 * them explicitly instead of silently changing the gameplay contract.
 */
export function normalizeGameplayPurpose(value) {
  const purpose = String(value ?? "").trim().toLowerCase();
  if (!GAMEPLAY_PURPOSES.includes(purpose)) {
    throw new Error(`Unsupported gameplay purpose: ${String(value)}`);
  }
  return purpose;
}

/**
 * Normalize the discrete magic-ratio contract.  Missing values default to
 * ordinary non-magical use (0); finite values must be exactly one of the
 * five allowed steps.  Rejecting values such as 0.63 is intentional so an
 * Agent cannot smuggle a continuous ratio into v0.3 by way of normalization.
 */
export function normalizeMagicRatio(value = 0) {
  if (value == null) return 0;
  if (typeof value === "boolean" || (typeof value === "string" && value.trim() === "")) {
    throw new Error(`magicRatio must be one of ${MAGIC_RATIOS.join(", ")}; received ${String(value)}`);
  }
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || !MAGIC_RATIOS.some((allowed) => Math.abs(allowed - ratio) < Number.EPSILON * 8)) {
    throw new Error(`magicRatio must be one of ${MAGIC_RATIOS.join(", ")}; received ${String(value)}`);
  }
  return MAGIC_RATIOS.find((allowed) => Math.abs(allowed - ratio) < Number.EPSILON * 8);
}

function normalizeFunctionalArea(value, label = "functional unit") {
  const area = Number(value);
  if (!Number.isSafeInteger(area) || area < 1) {
    throw new Error(`${label} area must be a positive integer; received ${String(value)}`);
  }
  return area;
}

function areaFromCells(value) {
  if (Array.isArray(value)) return value.length;
  if (Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value);
  return null;
}

function footprintAreaFromGeometry(value) {
  const explicit = value?.footprintArea;
  if (explicit != null) return normalizeFunctionalArea(explicit, "authoritative footprint");
  const cells = areaFromCells(value?.footprintCells)
    ?? areaFromCells(value?.footprint?.cells)
    ?? (Number.isSafeInteger(Number(value?.footprint?.widthCells))
      && Number.isSafeInteger(Number(value?.footprint?.depthCells))
      && Number(value.footprint.widthCells) > 0
      && Number(value.footprint.depthCells) > 0
      ? Number(value.footprint.widthCells) * Number(value.footprint.depthCells)
      : null);
  if (cells != null) return cells;
  const footprint = value?.site?.footprint ?? value?.footprint;
  if (typeof footprint === "string" && /^(\d+)x(\d+)$/.test(footprint)) {
    const [columns, rows] = footprint.split("x").map(Number);
    return normalizeFunctionalArea(columns * rows, "authoritative footprint");
  }
  return null;
}

/** Normalize one stable v0.3 functional unit. */
export function normalizeFunctionalUnit(value = {}, index = 0, defaults = {}) {
  const purpose = normalizeGameplayPurpose(value.purpose ?? defaults.purpose);
  const area = normalizeFunctionalArea(
    value.area ?? value.functionalArea ?? areaFromCells(value.cells) ?? defaults.area,
    `functional unit ${index + 1}`
  );
  return {
    purpose,
    area,
    magicRatio: normalizeMagicRatio(value.magicRatio ?? defaults.magicRatio)
  };
}

export function validateFunctionalUnit(value = {}) {
  try {
    normalizeFunctionalUnit(value);
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}

function aggregateFunctionalAreas(units) {
  return Object.fromEntries(GAMEPLAY_PURPOSES.map((purpose) => [
    purpose,
    units.filter((unit) => unit.purpose === purpose).reduce((total, unit) => total + unit.area, 0)
  ]));
}

function hasGrammarArrays(value) {
  return Boolean(value) && GAMEPLAY_GRAMMAR_ARRAY_FIELDS.some((field) => Array.isArray(value[field]));
}

function collectGrammarArrays(value, path = "gameplayBuilding", result = [], visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return result;
  visited.add(value);
  for (const field of GAMEPLAY_GRAMMAR_ARRAY_FIELDS) {
    if (Array.isArray(value[field])) result.push({ field, path: `${path}.${field}`, value: value[field] });
  }
  for (const container of ["grammar", "massing", "gameplay", "gameplayBuilding"]) {
    if (value[container] && typeof value[container] === "object") {
      collectGrammarArrays(value[container], `${path}.${container}`, result, visited);
    }
  }
  return result;
}

export function assertUnambiguousGameplayGrammar(value) {
  const arrays = collectGrammarArrays(value);
  const aliases = arrays.filter(({ field }) => field.includes("_"));
  if (aliases.length) {
    throw new Error(`Unsupported gameplay grammar field ${aliases[0].path}; use the documented camelCase grammar field`);
  }
  if (arrays.length > 1) {
    throw new Error(`Ambiguous GameplayBuilding grammar; choose exactly one array: ${arrays.map(({ path }) => path).join(", ")}`);
  }
  if (arrays.length === 1 && arrays[0].value.length === 0) {
    throw new Error("GameplayBuilding functional grammar must not be empty");
  }
}

export function hasGameplayGrammar(value = {}) {
  return hasGrammarArrays(value) || hasGrammarArrays(value.grammar) || hasGrammarArrays(value.massing);
}

function gameplayGrammar(value) {
  if (hasGrammarArrays(value)) return value;
  if (hasGrammarArrays(value.massing)) return value.massing;
  if (hasGrammarArrays(value.grammar)) return value.grammar;
  return value;
}

function effectiveDefaultMagicRatio(value) {
  const grammar = gameplayGrammar(value);
  return normalizeMagicRatio(value.defaultMagicRatio
    ?? value.magicRatio
    ?? grammar.defaultMagicRatio
    ?? grammar.magicRatio);
}

function canonicalPricingFacts(value, units = []) {
  const grammar = gameplayGrammar(value);
  const unitSource = value.units ?? value.functionalUnits ?? grammar.units ?? grammar.functionalUnits;
  const sourceKind = Array.isArray(unitSource) ? "units" : null;
  const floors = value.floors ?? value.floorSpecs ?? value.floorPrograms
    ?? grammar.floors ?? grammar.floorSpecs ?? grammar.floorPrograms;
  const floorCount = Array.isArray(floors) ? floors.length : null;
  const masses = value.masses ?? value.massSpecs ?? grammar.masses ?? grammar.massSpecs;
  const kind = sourceKind ?? (Array.isArray(floors) ? "floors" : Array.isArray(masses) ? "masses" : "single");
  const footprintArea = footprintAreaFromGeometry(value);
  const allResidential = units.length > 0 && units.every((unit) => unit.purpose === "residential");
  let effectiveFloorCount = null;
  if (allResidential) {
    if (!footprintArea) throw new Error("Pure residential GameplayBuilding requires an authoritative footprint area");
    const totalArea = units.reduce((total, unit) => total + unit.area, 0);
    if (totalArea < footprintArea || totalArea % footprintArea !== 0) {
      throw new Error(`Pure residential functional area ${totalArea} must be a positive integer multiple of footprint area ${footprintArea}`);
    }
    effectiveFloorCount = totalArea / footprintArea;
    if (kind === "floors" && floorCount !== effectiveFloorCount) {
      throw new Error(`Residential floor grammar count ${floorCount} does not match effective floor count ${effectiveFloorCount}`);
    }
  }
  return { sourceKind: kind, floorCount, footprintArea, effectiveFloorCount };
}

function canonicalUnitsFromGrammar(value) {
  const grammar = gameplayGrammar(value);
  if (Object.prototype.hasOwnProperty.call(value, "purpose")) normalizeGameplayPurpose(value.purpose);
  if (grammar !== value && Object.prototype.hasOwnProperty.call(grammar, "purpose")) {
    normalizeGameplayPurpose(grammar.purpose);
  }
  const defaultMagicRatio = effectiveDefaultMagicRatio(value);
  const unitSource = value.units ?? value.functionalUnits ?? grammar.units ?? grammar.functionalUnits;
  if (Array.isArray(unitSource)) {
    if (!unitSource.length) throw new Error("GameplayBuilding functional units must not be empty");
    const source = unitSource;
    return source.map((unit, index) => normalizeFunctionalUnit(unit, index, { magicRatio: defaultMagicRatio }));
  }

  // A floor is one functional cell per footprint cell.  This is the natural
  // grammar produced by voxel building specs and keeps vertical floors in
  // the area total.
  const floors = value.floors ?? value.floorSpecs ?? value.floorPrograms
    ?? grammar.floors ?? grammar.floorSpecs ?? grammar.floorPrograms;
  if (Array.isArray(floors)) {
    if (!floors.length) throw new Error("GameplayBuilding floor grammar must not be empty");
    const footprintArea = value.footprintArea ?? grammar.footprintArea
      ?? areaFromCells(value.footprintCells)
      ?? areaFromCells(value.footprint?.cells)
      ?? areaFromCells(grammar.footprintCells)
      ?? areaFromCells(grammar.footprint?.cells)
      ?? (value.footprint?.widthCells && value.footprint?.depthCells
        ? Number(value.footprint.widthCells) * Number(value.footprint.depthCells)
        : grammar.footprint?.widthCells && grammar.footprint?.depthCells
          ? Number(grammar.footprint.widthCells) * Number(grammar.footprint.depthCells)
        : null)
      ?? (typeof value.site?.footprint === "string" && /^(\d+)x(\d+)$/.test(value.site.footprint)
        ? value.site.footprint.split("x").reduce((total, part) => total * Number(part), 1)
        : typeof grammar.site?.footprint === "string" && /^(\d+)x(\d+)$/.test(grammar.site.footprint)
          ? grammar.site.footprint.split("x").reduce((total, part) => total * Number(part), 1)
        : 1);
    return floors.map((floor, index) => normalizeFunctionalUnit(floor, index, {
      area: footprintArea,
      magicRatio: defaultMagicRatio
    }));
  }

  // Public/civic massing has no reliable floor count.  Each occupied site
  // cell is therefore one functional cell unless the mass explicitly gives
  // an area or functionalArea.
  const masses = value.masses ?? value.massSpecs ?? grammar.masses ?? grammar.massSpecs;
  if (Array.isArray(masses)) {
    if (!masses.length) throw new Error("GameplayBuilding mass grammar must not be empty");
    return masses.map((mass, index) => normalizeFunctionalUnit(mass, index, {
      area: areaFromCells(mass.cells) ?? 1,
      purpose: value.purpose ?? grammar.purpose,
      magicRatio: defaultMagicRatio
    }));
  }

  if (value.purpose != null || grammar.purpose != null) {
    return [normalizeFunctionalUnit(value, 0, {
      area: value.area ?? value.functionalArea ?? 1,
      purpose: grammar.purpose,
      magicRatio: defaultMagicRatio
    })];
  }
  throw new Error("GameplayBuilding requires units, floors, masses, or a purpose");
}

/**
 * Normalize the v0.3 GameplayBuilding contract.  This function intentionally
 * only enters canonical mode when the caller supplies units/grammar or an
 * explicit canonical option; legacy category metadata remains supported by
 * the compatibility branch below.
 */
export function normalizeGameplayBuilding(value = {}, options = {}) {
  assertUnambiguousGameplayGrammar(value);
  const canonical = options.canonical === true
    || hasGameplayGrammar(value)
    || Object.prototype.hasOwnProperty.call(value, "purpose")
    || value.schemaVersion === GAMEPLAY_BUILDING_SCHEMA_VERSION;
  if (canonical) {
    const units = canonicalUnitsFromGrammar(value);
    return {
      schemaVersion: GAMEPLAY_BUILDING_SCHEMA_VERSION,
      canonical: true,
      units,
      functionalAreas: aggregateFunctionalAreas(units),
      defaultMagicRatio: effectiveDefaultMagicRatio(value),
      pricingFacts: canonicalPricingFacts(value, units)
    };
  }

  // Legacy compatibility shape.  Do not add v0.3 units here: old category /
  // magicLevel values are not authoritative functional-unit semantics.
  return normalizeLegacyGameplayBuilding(value);
}

export function validateGameplayBuilding(value = {}, options = {}) {
  try {
    const normalized = normalizeGameplayBuilding(value, options);
    if (normalized.units) {
      if (!normalized.units.length) throw new Error("GameplayBuilding requires at least one functional unit");
      return { valid: true, errors: [], value: normalized };
    }
    return { valid: true, errors: [], value: normalized };
  } catch (error) {
    return { valid: false, errors: [error.message], value: null };
  }
}

export function normalizeGameplayResources(value = {}) {
  return {
    coins: clampNumber(value.coins, 0, 0, Number.MAX_SAFE_INTEGER),
    magic: clampNumber(value.magic, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function normalizePopulationBucket(value = {}) {
  return {
    current: clampNumber(value.current, 0, 0, Number.MAX_SAFE_INTEGER),
    capacity: clampNumber(value.capacity, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function normalizePopulationState(value = {}) {
  return {
    muggles: normalizePopulationBucket(value.muggles),
    wizards: normalizePopulationBucket(value.wizards)
  };
}

function normalizeLegacyGameplayBuilding(value = {}) {
  return {
    category: String(value.category ?? "mixed"),
    magicLevel: clampNumber(value.magicLevel, 0.35, 0, 1),
    muggleCapacity: clampNumber(value.muggleCapacity, 0, 0, Number.MAX_SAFE_INTEGER),
    wizardCapacity: clampNumber(value.wizardCapacity, 0, 0, Number.MAX_SAFE_INTEGER),
    coinOutput: clampNumber(value.coinOutput, 0, 0, Number.MAX_SAFE_INTEGER),
    magicOutput: clampNumber(value.magicOutput, 0, 0, Number.MAX_SAFE_INTEGER),
    concealment: clampNumber(value.concealment, 0, 0, Number.MAX_SAFE_INTEGER),
    activity: clampNumber(value.activity, 0.3, 0, 1),
    visibility: clampNumber(value.visibility, 0.5, 0.25, 2),
    jobs: clampNumber(value.jobs, 0, 0, Number.MAX_SAFE_INTEGER),
    exposure: clampNumber(value.exposure, 0, 0, SEALED_EXPOSURE_THRESHOLD),
    status: value.status ?? "active"
  };
}

export function normalizeArcaneOfficer(value = {}) {
  const status = String(value.status ?? "available");
  if (!ARCANE_OFFICER_STATUSES.includes(status)) throw new Error(`Unsupported arcane officer status: ${status}`);
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    archetype: String(value.archetype ?? "trainee"),
    investigation: clampNumber(value.investigation, 0, 0, 5),
    containment: clampNumber(value.containment, 0, 0, 5),
    concealment: clampNumber(value.concealment, 0, 0, 5),
    specialties: Array.isArray(value.specialties) ? [...value.specialties].map(String) : [],
    status,
    hiredAtTurn: clampNumber(value.hiredAtTurn, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function normalizeScheduler(value = {}) {
  const settledBy = value.settledBy == null ? null : String(value.settledBy);
  if (settledBy != null && !["agent", "deadline"].includes(settledBy)) {
    throw new Error(`Unsupported settlement source: ${settledBy}`);
  }
  return {
    schemaVersion: 1,
    openedAt: value.openedAt != null ? String(value.openedAt) : null,
    resolvedAt: value.resolvedAt != null ? String(value.resolvedAt) : null,
    settledBy
  };
}

export function normalizeExposureIncident(value = {}) {
  const type = String(value.type ?? "investigation");
  if (!INCIDENT_TYPES.includes(type)) throw new Error(`Unsupported incident type: ${type}`);
  const status = String(value.status ?? "open");
  if (!INCIDENT_STATUSES.includes(status)) throw new Error(`Unsupported incident status: ${status}`);
  return {
    id: String(value.id ?? ""),
    buildingId: String(value.buildingId ?? ""),
    type,
    attribute: String(value.attribute ?? type),
    difficulty: clampNumber(value.difficulty, 3, 1, 10),
    severity: clampNumber(value.severity, 2, 1, 5),
    exposureAtCreation: clampNumber(value.exposureAtCreation, 0, 0, SEALED_EXPOSURE_THRESHOLD),
    summary: String(value.summary ?? ""),
    status,
    createdAtTurn: clampNumber(value.createdAtTurn, 0, 0, Number.MAX_SAFE_INTEGER)
  };
}

export function normalizeRollRecord(value = {}) {
  return {
    incidentId: String(value.incidentId ?? ""),
    arcaneOfficerId: String(value.arcaneOfficerId ?? ""),
    attribute: String(value.attribute ?? ""),
    rawRoll: clampNumber(value.rawRoll ?? value.roll, 0, 0, 100),
    attributeValue: clampNumber(value.attributeValue, 0, 0, 5),
    specialtyBonus: clampNumber(value.specialtyBonus, 0, 0, 5),
    modifier: clampNumber(value.modifier, 0, 0, 100),
    difficulty: clampNumber(value.difficulty, 3, 1, 10),
    outcome: String(value.outcome ?? "pending")
  };
}

export function normalizeCardOffer(value = {}) {
  return {
    offerId: String(value.offerId ?? ""),
    turn: clampNumber(value.turn, 0, 0, Number.MAX_SAFE_INTEGER),
    offeredCardIds: [...(value.offeredCardIds ?? [])].map(String)
  };
}

export function normalizePlacementCompletion(value = {}) {
  return {
    placementId: String(value.placementId ?? ""),
    cardId: String(value.cardId ?? ""),
    buildingId: String(value.buildingId ?? ""),
    mode: String(value.mode ?? "player_place")
  };
}

export function normalizeCardChoice(value = {}) {
  const status = String(value.status ?? "pending");
  if (!CARD_CHOICE_STATUSES.includes(status)) throw new Error(`Unsupported card choice status: ${status}`);
  const decisionMode = value.decisionMode == null ? null : String(value.decisionMode);
  if (decisionMode != null && !CARD_DECISION_MODES.includes(decisionMode)) {
    throw new Error(`Unsupported card decision mode: ${decisionMode}`);
  }
  return {
    offerId: String(value.offerId ?? ""),
    status,
    selectedCardId: value.selectedCardId == null ? null : String(value.selectedCardId),
    decisionMode,
    choiceResolvedAt: value.choiceResolvedAt == null ? null : String(value.choiceResolvedAt),
    cardEffects: value.cardEffects ? { ...value.cardEffects } : {},
    policyStarted: value.policyStarted ? [...value.policyStarted].map(String) : [],
    policyRefreshed: value.policyRefreshed ? [...value.policyRefreshed].map(String) : [],
    policyExpired: value.policyExpired ? [...value.policyExpired].map(String) : [],
    officerRecruitedId: value.officerRecruitedId == null ? null : String(value.officerRecruitedId),
    specialPlacementMandate: value.specialPlacementMandate ? { ...value.specialPlacementMandate } : null,
    // Attributed completions: each entry records which placement/card/building
    // was completed, so a later turn completing an older delegated mandate is
    // never misattributed to the current turn's selected card.
    specialPlacementsCompleted: [...(value.specialPlacementsCompleted ?? [])].map(normalizePlacementCompletion)
  };
}

export function normalizeActivePolicy(value = {}) {
  const durationType = String(value.durationType ?? "turns");
  if (!POLICY_DURATION_TYPES.includes(durationType)) throw new Error(`Unsupported policy duration type: ${durationType}`);
  return {
    policyId: String(value.policyId ?? ""),
    sourceCardId: String(value.sourceCardId ?? ""),
    startedAtTurn: clampNumber(value.startedAtTurn, 0, 0, Number.MAX_SAFE_INTEGER),
    durationType,
    durationTurns: clampNumber(value.durationTurns, 1, 0, Number.MAX_SAFE_INTEGER),
    remainingTurns: clampNumber(value.remainingTurns, 0, 0, Number.MAX_SAFE_INTEGER),
    effects: Array.isArray(value.effects) ? [...value.effects].map((entry) => ({ ...entry })) : []
  };
}

export function normalizePendingPlacement(value = {}) {
  const status = String(value.status ?? "pending");
  if (!PLACEMENT_STATUSES.includes(status)) throw new Error(`Unsupported placement status: ${status}`);
  return {
    cardId: String(value.cardId ?? ""),
    placementId: String(value.placementId ?? ""),
    mode: String(value.mode ?? "player_place"),
    status,
    delegatedAtTurn: clampNumber(value.delegatedAtTurn, 0, 0, Number.MAX_SAFE_INTEGER),
    buildingId: value.buildingId == null ? null : String(value.buildingId),
    lotId: value.lotId == null ? null : String(value.lotId),
    footprint: value.footprint == null ? null : String(value.footprint),
    entrance: value.entrance == null ? null : String(value.entrance)
  };
}

export function normalizeCardState(value = {}) {
  return {
    offer: value.offer ? normalizeCardOffer(value.offer) : null,
    choice: normalizeCardChoice(value.choice ?? {}),
    activePolicies: [...(value.activePolicies ?? [])].map(normalizeActivePolicy),
    pendingPlacement: value.pendingPlacement ? normalizePendingPlacement(value.pendingPlacement) : null,
    placements: Object.fromEntries(Object.entries(value.placements ?? {}).map(([id, entry]) => [id, normalizePendingPlacement(entry)]))
  };
}

export function normalizeTurnFacts(value = {}) {
  return {
    schemaVersion: GAMEPLAY_SCHEMA_VERSION,
    turn: clampNumber(value.turn, 0, 0, Number.MAX_SAFE_INTEGER),
    wallClock: value.wallClock ? { ...value.wallClock } : null,
    resourceDelta: normalizeGameplayResources(value.resourceDelta),
    populationDelta: normalizePopulationState(value.populationDelta),
    buildingsStarted: [...(value.buildingsStarted ?? [])],
    buildingsCompleted: [...(value.buildingsCompleted ?? [])],
    exposureChanges: Object.fromEntries(Object.entries(value.exposureChanges ?? {}).map(([id, change]) => [id, { ...change }])),
    incidents: [...(value.incidents ?? [])].map(normalizeExposureIncident),
    unaddressedIncidents: [...(value.unaddressedIncidents ?? [])].map((entry) => ({ ...entry })),
    assignments: [...(value.assignments ?? [])].map((entry) => ({ ...entry })),
    rolls: [...(value.rolls ?? [])].map(normalizeRollRecord),
    outcomes: [...(value.outcomes ?? [])].map((entry) => ({ ...entry })),
    sealedBuildings: [...(value.sealedBuildings ?? [])],
    nextRisks: [...(value.nextRisks ?? [])].map((entry) => ({ ...entry })),
    cardOfferId: value.cardOfferId == null ? null : String(value.cardOfferId),
    offeredCardIds: [...(value.offeredCardIds ?? [])].map(String),
    selectedCardId: value.selectedCardId == null ? null : String(value.selectedCardId),
    choiceStatus: String(value.choiceStatus ?? "pending"),
    choiceResolvedAt: value.choiceResolvedAt == null ? null : String(value.choiceResolvedAt),
    cardEffects: value.cardEffects ? { ...value.cardEffects } : {},
    policyStarted: [...(value.policyStarted ?? [])].map(String),
    policyRefreshed: [...(value.policyRefreshed ?? [])].map(String),
    policyExpired: [...(value.policyExpired ?? [])].map(String),
    specialPlacementMandate: value.specialPlacementMandate ? { ...value.specialPlacementMandate } : null,
    specialPlacementsCompleted: [...(value.specialPlacementsCompleted ?? [])].map(normalizePlacementCompletion)
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
