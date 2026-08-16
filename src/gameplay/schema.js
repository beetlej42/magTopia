export const GAMEPLAY_SCHEMA_VERSION = 1;

export const TURN_STATUSES = Object.freeze(["open", "building", "strategy", "resolved", "reported", "closed"]);

export const WARDEN_STATUSES = Object.freeze(["available", "assigned", "unavailable"]);

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

export function normalizeVeilWarden(value = {}) {
  const status = String(value.status ?? "available");
  if (!WARDEN_STATUSES.includes(status)) throw new Error(`Unsupported warden status: ${status}`);
  return {
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    investigation: clampNumber(value.investigation, 0, 0, 5),
    containment: clampNumber(value.containment, 0, 0, 5),
    concealment: clampNumber(value.concealment, 0, 0, 5),
    specialties: Array.isArray(value.specialties) ? [...value.specialties].map(String) : [],
    status,
    hiredAtTurn: clampNumber(value.hiredAtTurn, 0, 0, Number.MAX_SAFE_INTEGER)
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
    wardenId: String(value.wardenId ?? ""),
    attribute: String(value.attribute ?? ""),
    rawRoll: clampNumber(value.rawRoll, 0, 0, 100),
    attributeValue: clampNumber(value.attributeValue, 0, 0, 5),
    specialtyBonus: clampNumber(value.specialtyBonus, 0, 0, 5),
    modifier: clampNumber(value.modifier, 0, 0, 100),
    difficulty: clampNumber(value.difficulty, 3, 1, 10),
    outcome: String(value.outcome ?? "pending")
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
    assignments: [...(value.assignments ?? [])].map((entry) => ({ ...entry })),
    rolls: [...(value.rolls ?? [])].map(normalizeRollRecord),
    outcomes: [...(value.outcomes ?? [])].map((entry) => ({ ...entry })),
    sealedBuildings: [...(value.sealedBuildings ?? [])],
    nextRisks: [...(value.nextRisks ?? [])].map((entry) => ({ ...entry }))
  };
}

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
