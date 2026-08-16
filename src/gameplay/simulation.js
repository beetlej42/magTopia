import { deriveGameplayBuilding } from "./building-metadata.js";
import {
  applyExposureChange,
  exposureDelta,
  exposurePressure,
  incidentDifficulty,
  incidentProbability,
  incidentSeverity,
  isSealedExposure,
  neighborhoodConcealment
} from "./exposure.js";
import { incidentAttribute, incidentDefinition } from "./incidents.js";
import { chance, createRoller, pick, rollDice } from "./random.js";
import {
  deepFreeze,
  INCIDENT_TYPES,
  normalizeExposureIncident,
  normalizeGameplayResources,
  normalizePopulationState,
  normalizeRollRecord,
  normalizeTurnFacts,
  SEALED_EXPOSURE_THRESHOLD
} from "./schema.js";

export const DEFAULT_BASE_COINS = 24;
export const DEFAULT_BASE_MAGIC = 0;

function asMap(state, field) {
  return Object.fromEntries(Object.entries(state?.buildings ?? {}).map(([id, building]) => [
    id,
    building.metadata ?? deriveGameplayBuilding(building)
  ]));
}

export function effectiveBuildings(metadataMap) {
  return Object.entries(metadataMap).filter(([, metadata]) => metadata.status !== "sealed");
}

export function settleResources(state, metadataMap, options = {}) {
  const baseCoins = Number(options.baseCoins ?? DEFAULT_BASE_COINS);
  const baseMagic = Number(options.baseMagic ?? DEFAULT_BASE_MAGIC);
  const income = effectiveBuildings(metadataMap).reduce((acc, [, metadata]) => {
    acc.coins += Number(metadata.coinOutput ?? 0);
    acc.magic += Number(metadata.magicOutput ?? 0);
    return acc;
  }, { coins: baseCoins, magic: baseMagic });
  const before = normalizeGameplayResources(state.gameplay?.resources);
  const after = normalizeGameplayResources({ coins: before.coins + income.coins, magic: before.magic + income.magic });
  return { before, after, income };
}

export function settlePopulation(state, metadataMap, options = {}) {
  const capacities = { muggles: 0, wizards: 0 };
  for (const [, metadata] of effectiveBuildings(metadataMap)) {
    capacities.muggles += Number(metadata.muggleCapacity ?? 0);
    capacities.wizards += Number(metadata.wizardCapacity ?? 0);
  }
  const before = normalizePopulationState(state.gameplay?.population);
  const migrate = (bucket, capacity, rate) => {
    const target = Math.min(capacity, bucket.current + Math.ceil(Math.max(0, capacity - bucket.current) * rate));
    return { current: target, capacity };
  };
  const muggleRate = Number(options.muggleMigrationRate ?? 0.1);
  const wizardRate = Number(options.wizardMigrationRate ?? 0.1);
  return {
    before,
    after: {
      muggles: migrate(before.muggles, capacities.muggles, muggleRate),
      wizards: migrate(before.wizards, capacities.wizards, wizardRate)
    },
    capacityDelta: capacities
  };
}

export function updateExposures(state, metadataMap, options = {}) {
  const changes = {};
  const nextMetadata = { ...metadataMap };
  for (const [id, metadata] of Object.entries(metadataMap)) {
    if (metadata.status === "sealed") continue;
    const concealment = neighborhoodConcealment(state, { ...state.buildings[id], id }, { metadataOf: (neighbor) => nextMetadata[neighbor.id] });
    const pressure = exposurePressure(metadata, concealment, { visibility: metadata.visibility ?? 0.5, modifier: options.modifier });
    const delta = exposureDelta(pressure, options);
    const from = metadata.exposure;
    const to = applyExposureChange(from, delta);
    changes[id] = { from, to, delta, pressure, concealment, sealed: isSealedExposure(to) };
    nextMetadata[id] = { ...metadata, exposure: to, status: changes[id].sealed ? "sealed" : metadata.status };
  }
  return { changes, nextMetadata };
}

export function generateIncidents(state, metadataMap, roller, options = {}) {
  const threshold = Number(options.incidentThreshold) || SEALED_EXPOSURE_THRESHOLD / 2;
  const incidents = [];
  for (const [id, metadata] of Object.entries(metadataMap)) {
    if (metadata.status === "sealed") continue;
    const probability = incidentProbability(metadata.exposure, threshold);
    if (!chance(roller, probability)) continue;
    const type = pick(roller, INCIDENT_TYPES);
    const severity = incidentSeverity(metadata.exposure);
    const difficulty = incidentDifficulty(severity, options);
    const buildingName = state.buildings?.[id]?.program?.name;
    const definition = incidentDefinition(type);
    incidents.push(normalizeExposureIncident({
      id: options.createId?.("incident") ?? `incident-${id}-${options.turn ?? 0}`,
      buildingId: id,
      type,
      attribute: incidentAttribute(type),
      difficulty,
      severity,
      exposureAtCreation: metadata.exposure,
      summary: definition.summaryTemplate(buildingName),
      status: "open",
      createdAtTurn: options.turn ?? state.turn
    }));
  }
  return incidents;
}

export function gradeRoll(roll, total, difficulty) {
  if (roll === 20) return "critical_success";
  if (roll === 1) return "critical_failure";
  if (total >= difficulty + 5) return "critical_success";
  if (total >= difficulty) return "success";
  if (total <= difficulty - 5) return "critical_failure";
  return "failure";
}

export function resolveIncidentRoll({ incident, officer, modifier = 0, roller, options = {} }) {
  const definition = incidentDefinition(incident.type);
  const attribute = definition.attribute;
  const attributeValue = Number(officer?.[attribute] ?? 0);
  const specialtyBonus = (officer?.specialties ?? []).includes(incident.type)
    ? Number(options.specialtyBonus ?? 2)
    : 0;
  const roll = rollDice(roller, 20);
  const difficulty = Number(incident.difficulty ?? 3);
  const modifierValue = Number(modifier ?? 0);
  const total = roll + attributeValue + specialtyBonus + modifierValue;
  const outcome = gradeRoll(roll, total, difficulty);
  return { roll, total, attribute, attributeValue, specialtyBonus, modifier: modifierValue, difficulty, outcome };
}

export function validateAssignments(state, incidents, assignments = []) {
  if (!Array.isArray(assignments) || assignments.length === 0) return { ok: true, errors: [] };
  const errors = [];
  const usedOfficers = new Set();
  const usedIncidents = new Set();
  for (const assignment of assignments) {
    const incidentId = String(assignment.incidentId ?? assignment.incident_id ?? "");
    const officerId = String(assignment.arcaneOfficerId ?? assignment.arcane_officer_id ?? "");
    if (!incidentId || !officerId) {
      errors.push({ incidentId, officerId, code: "ASSIGNMENT_INCOMPLETE", message: "Assignment requires both incidentId and arcaneOfficerId" });
      continue;
    }
    if (assignment.roll != null || assignment.outcome != null || assignment.total != null) {
      errors.push({ incidentId, officerId, code: "ASSIGNMENT_CARRIES_OUTCOME", message: "Assignment must not include dice roll or outcome" });
    }
    if (assignment.modifier != null) {
      errors.push({ incidentId, officerId, code: "ASSIGNMENT_CARRIES_MODIFIER", message: "Assignment must not carry a modifier; modifiers are system-determined" });
    }
    const incident = state.gameplay?.incidents?.[incidentId] ?? incidents.find((entry) => entry.id === incidentId);
    if (!incident) {
      errors.push({ incidentId, officerId, code: "INCIDENT_NOT_FOUND", message: `Unknown incident ${incidentId}` });
      continue;
    }
    if (incident.status !== "open") {
      errors.push({ incidentId, officerId, code: "INCIDENT_NOT_OPEN", message: `Incident ${incidentId} is not open for assignment` });
    }
    if (usedIncidents.has(incidentId)) {
      errors.push({ incidentId, officerId, code: "INCIDENT_ALREADY_ASSIGNED", message: `Incident ${incidentId} is assigned more than once` });
    }
    usedIncidents.add(incidentId);
    const officer = state.gameplay?.arcaneOfficers?.[officerId];
    if (!officer) {
      errors.push({ incidentId, officerId, code: "ARCANE_OFFICER_NOT_FOUND", message: `Unknown arcane officer ${officerId}` });
      continue;
    }
    if (officer.status !== "available") {
      errors.push({ incidentId, officerId, code: "ARCANE_OFFICER_UNAVAILABLE", message: `Arcane officer ${officerId} is not available` });
    }
    if (usedOfficers.has(officerId)) {
      errors.push({ incidentId, officerId, code: "ARCANE_OFFICER_ALREADY_ASSIGNED", message: `Arcane officer ${officerId} is assigned to more than one incident` });
    }
    usedOfficers.add(officerId);
  }
  return { ok: errors.length === 0, errors };
}

export function settleAssignments(state, incidents, assignments = [], roller, options = {}) {
  const rolls = [];
  const outcomes = [];
  const normalized = [];
  if (!Array.isArray(assignments)) return { assignments: normalized, rolls, outcomes };
  const modifier = Number(options.modifier ?? 0);
  for (const assignment of assignments) {
    const incidentId = String(assignment.incidentId ?? assignment.incident_id ?? "");
    const officerId = String(assignment.arcaneOfficerId ?? assignment.arcane_officer_id ?? "");
    const incident = state.gameplay?.incidents?.[incidentId] ?? incidents.find((entry) => entry.id === incidentId);
    const officer = state.gameplay?.arcaneOfficers?.[officerId];
    if (!incident || !officer) continue;
    const result = resolveIncidentRoll({ incident, officer, modifier, roller, options });
    const outcome = applyOutcome(result.outcome, options);
    normalized.push({ incidentId, arcaneOfficerId: officerId });
    rolls.push(normalizeRollRecord({ ...result, incidentId, arcaneOfficerId: officerId }));
    outcomes.push({
      incidentId,
      buildingId: incident.buildingId,
      arcaneOfficerId: officerId,
      outcome: result.outcome,
      exposureDelta: outcome.exposureDelta,
      incidentStatus: outcome.incidentStatus,
      arcaneOfficerStatus: outcome.arcaneOfficerStatus
    });
    if (state.gameplay?.incidents?.[incidentId]) state.gameplay.incidents[incidentId] = { ...incident, status: outcome.incidentStatus };
    if (state.gameplay?.arcaneOfficers?.[officerId]) state.gameplay.arcaneOfficers[officerId] = { ...officer, status: outcome.arcaneOfficerStatus };
  }
  return { assignments: normalized, rolls, outcomes };
}

function applyOutcome(outcome, options = {}) {
  switch (outcome) {
    case "critical_success":
      return {
        exposureDelta: -Number(options.criticalSuccessExposure ?? 5),
        incidentStatus: "resolved",
        arcaneOfficerStatus: "available"
      };
    case "success":
      return {
        exposureDelta: -Number(options.successExposure ?? 2),
        incidentStatus: "resolved",
        arcaneOfficerStatus: "available"
      };
    case "failure":
      return {
        exposureDelta: Number(options.failureExposure ?? 1),
        incidentStatus: "open",
        arcaneOfficerStatus: "available"
      };
    case "critical_failure":
      return {
        exposureDelta: Number(options.criticalFailureExposure ?? 3),
        incidentStatus: "escalated",
        arcaneOfficerStatus: "unavailable"
      };
    default:
      return { exposureDelta: 0, incidentStatus: "open", arcaneOfficerStatus: "available" };
  }
}

export function resolveTurn(state, input = {}, context = {}) {
  const guardError = guardTurnResolve(state, input);
  if (guardError) return { nextState: state, facts: null, error: guardError };
  const gameplay = migrateGameplay(state);
  const options = { ...(context.options ?? {}) };
  const createId = context.createId ?? ((prefix) => `${prefix}-${state.turn}`);
  const now = context.now ?? (() => new Date().toISOString());
  const roller = createRoller(context);
  const next = {
    ...state,
    gameplay: {
      ...gameplay,
      resources: normalizeGameplayResources(gameplay.resources),
      population: normalizePopulationState(gameplay.population),
      arcaneOfficers: { ...(gameplay.arcaneOfficers ?? {}) },
      incidents: { ...(gameplay.incidents ?? {}) }
    }
  };

  const metadataMap = asMap(next, "metadata");
  const resourceSettlement = settleResources(next, metadataMap, options);
  next.gameplay.resources = resourceSettlement.after;

  const populationSettlement = settlePopulation(next, metadataMap, options);
  next.gameplay.population = populationSettlement.after;

  const exposureSettlement = updateExposures(next, metadataMap, options);
  const exposureChanges = exposureSettlement.changes;
  const incidents = generateIncidents(next, exposureSettlement.nextMetadata, roller, {
    ...options,
    createId,
    turn: state.turn
  });
  for (const incident of incidents) next.gameplay.incidents[incident.id] = incident;

  const assignmentValidation = validateAssignments(next, incidents, input.assignments);
  if (!assignmentValidation.ok) {
    return { nextState: state, facts: null, error: { code: "INVALID_ASSIGNMENT", message: assignmentValidation.errors.map((entry) => entry.message).join("; "), assignmentErrors: assignmentValidation.errors } };
  }
  const assignmentSettlement = settleAssignments(next, incidents, input.assignments, roller, options);
  for (const outcome of assignmentSettlement.outcomes) {
    const change = exposureChanges[outcome.buildingId];
    if (change) {
      change.to = applyExposureChange(change.to, outcome.exposureDelta);
      change.delta = change.to - change.from;
      change.sealed = isSealedExposure(change.to);
    }
  }

  const sealedBuildings = Object.entries(exposureChanges)
    .filter(([, change]) => change.sealed)
    .map(([id]) => id);
  for (const [id, change] of Object.entries(exposureChanges)) {
    if (!next.buildings[id]) continue;
    next.buildings[id] = { ...next.buildings[id], exposure: change.to, status: change.sealed ? "sealed" : next.buildings[id].status };
  }

  const nextRisks = Object.entries(exposureChanges)
    .filter(([, change]) => change.to > 0)
    .sort((a, b) => b[1].pressure - a[1].pressure)
    .slice(0, Number(options.maxRisks ?? 5))
    .map(([buildingId, change]) => ({ buildingId, exposure: change.to, pressure: change.pressure, concealment: change.concealment }));

  const resolvedAt = now();
  const facts = normalizeTurnFacts({
    turn: state.turn + 1,
    wallClock: { openedAt: state.gameplay?.turnOpenedAt ?? null, resolvedAt },
    resourceDelta: {
      coins: resourceSettlement.income.coins,
      magic: resourceSettlement.income.magic
    },
    populationDelta: {
      muggles: {
        current: populationSettlement.after.muggles.current - populationSettlement.before.muggles.current,
        capacity: populationSettlement.after.muggles.capacity - populationSettlement.before.muggles.capacity
      },
      wizards: {
        current: populationSettlement.after.wizards.current - populationSettlement.before.wizards.current,
        capacity: populationSettlement.after.wizards.capacity - populationSettlement.before.wizards.capacity
      }
    },
    buildingsStarted: [...(input.buildingsStarted ?? [])],
    buildingsCompleted: [...(input.buildingsCompleted ?? [])],
    exposureChanges,
    incidents: incidents.map((incident) => next.gameplay.incidents[incident.id] ?? incident),
    assignments: assignmentSettlement.assignments,
    rolls: assignmentSettlement.rolls,
    outcomes: assignmentSettlement.outcomes,
    sealedBuildings,
    nextRisks
  });

  next.gameplay.lastTurnFacts = deepFreeze(facts);
  next.gameplay.turnStatus = "resolved";
  next.gameplay.turnOpenedAt = next.gameplay.turnOpenedAt ?? resolvedAt;
  next.resources = { ...next.resources, coins: resourceSettlement.after.coins, magic: resourceSettlement.after.magic };
  next.turn = state.turn + 1;
  next.version = (next.version ?? 0) + 1;

  return { nextState: next, facts, error: null };
}

function guardTurnResolve(state, input) {
  const expectedTurn = input.expectedTurn;
  if (expectedTurn != null && Number(expectedTurn) !== Number(state.turn ?? 0)) {
    return { code: "TURN_MISMATCH", message: `resolveTurn expected turn ${expectedTurn} but state is at turn ${state.turn}` };
  }
  if (state.gameplay?.turnStatus === "resolved" && input.force !== true) {
    return { code: "TURN_ALREADY_RESOLVED", message: `Turn ${state.turn} is already resolved; refusing to resolve twice` };
  }
  return null;
}

function migrateGameplay(state) {
  const existing = state.gameplay;
  if (!existing?.schemaVersion) {
    const legacy = state.resources ?? {};
    const coins = Number.isFinite(Number(legacy.coins)) ? Number(legacy.coins) : 0;
    return {
      schemaVersion: 1,
      turnStatus: "open",
      turnOpenedAt: null,
      resources: { coins, magic: 0 },
      population: { muggles: { current: 0, capacity: 0 }, wizards: { current: 0, capacity: 0 } },
      arcaneOfficers: {},
      incidents: {},
      lastTurnFacts: null
    };
  }
  const migrated = { ...existing };
  const legacyRoster = migrated.wardens != null && Object.keys(migrated.wardens).length > 0;
  const newRoster = migrated.arcaneOfficers != null && Object.keys(migrated.arcaneOfficers).length > 0;
  if (legacyRoster && !newRoster) {
    migrated.arcaneOfficers = migrated.wardens;
  }
  delete migrated.wardens;
  return migrated;
}
