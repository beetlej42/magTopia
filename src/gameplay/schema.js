export const GAMEPLAY_SCHEMA_VERSION = 2;

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

export function normalizeGameplayBuilding(value = {}) {
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
    specialPlacementCompleted: value.specialPlacementCompleted == null ? null : String(value.specialPlacementCompleted)
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
    specialPlacementCompleted: value.specialPlacementCompleted == null ? null : String(value.specialPlacementCompleted)
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
