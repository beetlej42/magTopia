import { deriveGameplayBuilding } from "./building-metadata.js";
import {
  advancePolicies,
  cardFacts,
  collectPolicyEffects,
  ensureCardOffer,
  markChoiceSkipped,
  specialStructureConcealment,
  specialStructureExposureModifier
} from "./cards.js";
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
import { normalizeTurnSchedule } from "./turn.js";
import {
  deepFreeze,
  INCIDENT_TYPES,
  normalizeExposureIncident,
  normalizeGameplayResources,
  normalizePopulationState,
  normalizeRollRecord,
  normalizeScheduler,
  normalizeTurnFacts,
  SEALED_EXPOSURE_THRESHOLD
} from "./schema.js";
import {
  ECONOMY_RULES,
  capacitiesFromCanonicalUnits,
  incomeForCanonicalBuildings,
  migratePopulationBucket,
  supportedPopulationTarget
} from "./economy.js";

// Kept as named exports for callers that used the old tuning surface. PR C
// deliberately has no unconditional base income; all canonical income comes
// from residents or functional cells.
export const DEFAULT_BASE_COINS = 0;
export const DEFAULT_BASE_MAGIC = 0;

// How many resolved turns keep their frozen facts available for backfilled Owl
// Daily reports. Older turns stop being reportable; gameplay never depends on
// this history.
export const MAX_TURN_FACTS_HISTORY = 200;

// Records a freshly frozen settlement into the per-turn history, keeping the
// most recent MAX_TURN_FACTS_HISTORY entries.
export function appendTurnFacts(history = {}, facts) {
  const turn = Number(facts?.turn);
  if (!Number.isFinite(turn)) return history;
  const next = { ...history, [turn]: facts };
  const turns = Object.keys(next).map(Number).sort((a, b) => a - b);
  if (turns.length > MAX_TURN_FACTS_HISTORY) {
    for (const stale of turns.slice(0, turns.length - MAX_TURN_FACTS_HISTORY)) delete next[stale];
  }
  return next;
}

function asMap(state, field) {
  return Object.fromEntries(Object.entries(state?.buildings ?? {}).map(([id, building]) => [
    id,
    // Completed canonical buildings persist system-derived units next to the
    // original request grammar. Legacy category metadata is still derived for
    // exposure compatibility, but is explicitly marked non-canonical and is
    // never eligible for PR C economy/capacity.
    (() => {
      const persisted = building.metadata ?? (building.gameplay?.canonical ? building.gameplay : null);
      const metadata = persisted ?? deriveGameplayBuilding(building);
      // One committed card owns an explicit legacy effect. It is migrated by
      // card id only; arbitrary old `magicOutput` fields never enter economy.
      const systemOwnedIncome = building.specialStructure?.cardId === "moonlight-herb-plot"
        ? { arcaneEnergy: Number.isFinite(Number(building.specialStructure.effect?.magicOutput))
          ? Math.max(0, Number(building.specialStructure.effect.magicOutput))
          : 0 }
        : null;
      return {
        ...metadata,
        canonical: metadata.canonical === true,
        status: building.status ?? metadata.status ?? "active",
        exposure: Number.isFinite(Number(building.exposure)) ? Number(building.exposure) : (metadata.exposure ?? 0),
        ...(systemOwnedIncome ? { systemOwnedIncome } : {})
      };
    })()
  ]));
}

export function effectiveBuildings(metadataMap) {
  return Object.entries(metadataMap).filter(([, metadata]) => metadata.canonical === true
    && (metadata.status == null || metadata.status === "completed")
    && metadata.status !== "sealed");
}

export function settleResources(state, metadataMap, options = {}) {
  const population = normalizePopulationState(state.gameplay?.population);
  const income = incomeForCanonicalBuildings(Object.fromEntries(effectiveBuildings(metadataMap)), population, {
    rules: options.economyRules ?? ECONOMY_RULES
  });
  // Optional baseCoins is an explicit harness hook only; the PR-C default is
  // zero and no legacy coinOutput/magicOutput field is read.
  const baseCoins = Number.isSafeInteger(Number(options.baseCoins)) && Number(options.baseCoins) >= 0
    ? Number(options.baseCoins)
    : DEFAULT_BASE_COINS;
  const baseArcaneEnergy = Number.isFinite(Number(options.baseArcaneEnergy ?? options.baseMagic))
    ? Math.max(0, Number(options.baseArcaneEnergy ?? options.baseMagic))
    : DEFAULT_BASE_MAGIC;
  income.coins += baseCoins;
  income.arcaneEnergy += baseArcaneEnergy;
  for (const [, metadata] of Object.entries(metadataMap)) {
    if ((metadata.status == null || metadata.status === "completed") && metadata.systemOwnedIncome) {
      income.arcaneEnergy += Math.max(0, Number(metadata.systemOwnedIncome.arcaneEnergy) || 0);
    }
  }
  // Coins have one authoritative source: `state.resources.coins`, which is
  // debited by construction/road/reservation mutations and credited by card
  // grants. `gameplay.resources` mirrors it at settlement. Basing the settle on
  // `state.resources.coins` means a construction spend is never wiped out by a
  // stale gameplay ledger value.
  const gameplayBefore = normalizeGameplayResources(state.gameplay?.resources);
  const outerCoins = Number(state.resources?.coins);
  const spendableCoins = Number.isSafeInteger(outerCoins) && outerCoins >= 0 ? outerCoins : gameplayBefore.coins;
  const before = { ...gameplayBefore, coins: spendableCoins };
  const after = normalizeGameplayResources({ coins: before.coins + income.coins, arcaneEnergy: before.arcaneEnergy + income.arcaneEnergy });
  return { before, after, income };
}

export function settlePopulation(state, metadataMap, options = {}) {
  const capacities = effectiveBuildings(metadataMap).reduce((total, [, metadata]) => {
    const current = capacitiesFromCanonicalUnits(metadata.units);
    total.muggles += current.muggles;
    total.wizards += current.wizards;
    return total;
  }, { muggles: 0, wizards: 0 });
  const before = normalizePopulationState(state.gameplay?.population);
  const muggleTarget = supportedPopulationTarget(capacities.muggles, "muggles", options);
  const wizardTarget = supportedPopulationTarget(capacities.wizards, "wizards", options);
  const migrationRate = options.migrationRate;
  const muggleRate = migrationRate ?? options.muggleMigrationRate ?? ECONOMY_RULES.defaultMigrationRate;
  const wizardRate = migrationRate ?? options.wizardMigrationRate ?? ECONOMY_RULES.defaultMigrationRate;
  return {
    before,
    after: {
      muggles: { ...migratePopulationBucket(before.muggles, muggleTarget, muggleRate), capacity: capacities.muggles },
      wizards: { ...migratePopulationBucket(before.wizards, wizardTarget, wizardRate), capacity: capacities.wizards }
    },
    capacityDelta: capacities,
    target: { muggles: muggleTarget, wizards: wizardTarget }
  };
}

export function updateExposures(state, metadataMap, options = {}) {
  const changes = {};
  const nextMetadata = { ...metadataMap };
  const flatConcealmentBonus = Number(options.concealmentBonus ?? 0);
  const concealmentBonusFor = options.concealmentBonusFor ?? (() => 0);
  for (const [id, metadata] of Object.entries(metadataMap)) {
    if (metadata.status === "sealed") continue;
    const concealment = neighborhoodConcealment(state, { ...state.buildings[id], id }, { metadataOf: (neighbor) => nextMetadata[neighbor.id] })
      + flatConcealmentBonus
      + concealmentBonusFor({ ...state.buildings[id], id });
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

export function validateAssignments(state, incidents, assignments = [], options = {}) {
  if (!Array.isArray(assignments) || assignments.length === 0) return { ok: true, errors: [] };
  const errors = [];
  const usedIncidents = new Set();
  // Per-officer response capacity. By default one Arcane Officer responds to
  // one incident per turn. The Arcane Officer Special Duty Order policy grants
  // +1 response slot per officer (a capacity increase, never a dice modifier).
  const responseCapacityBonus = Math.max(0, Math.floor(Number(options.responseCapacityBonus ?? 0)));
  const officerLoad = new Map();
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
    const officerCapacity = 1 + responseCapacityBonus;
    const load = (officerLoad.get(officerId) ?? 0) + 1;
    officerLoad.set(officerId, load);
    if (load > officerCapacity) {
      errors.push({ incidentId, officerId, code: "ARCANE_OFFICER_ALREADY_ASSIGNED", message: `Arcane officer ${officerId} is already at response capacity (${officerCapacity} incident${officerCapacity === 1 ? "" : "s"} this turn${responseCapacityBonus ? ", including the special duty bonus" : ""})` });
    }
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
    normalized.push({ incidentId, arcaneOfficerId: officerId, ...(assignment.rationale != null ? { rationale: String(assignment.rationale) } : {}) });
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
  let next = {
    ...state,
    gameplay: {
      ...gameplay,
      resources: normalizeGameplayResources(gameplay.resources),
      population: normalizePopulationState(gameplay.population),
      arcaneOfficers: { ...(gameplay.arcaneOfficers ?? {}) },
      incidents: { ...(gameplay.incidents ?? {}) }
    }
  };

  // PR F — Player daily cards. Settlement owns the card facts: the offer for
  // this turn is ensured, an un-answered choice is recorded explicitly as
  // skipped (never blocking settlement), active policy modifiers feed the
  // deterministic simulation, and the policy lifecycle advances exactly once.
  const cityId = state.cityId ?? "";
  next = ensureCardOffer(next, cityId);
  next = markChoiceSkipped(next, { now });
  const policyEffects = collectPolicyEffects(next);

  const metadataMap = asMap(next, "metadata");
  const resourceSettlement = settleResources(next, metadataMap, options);
  next.gameplay.resources = resourceSettlement.after;

  const populationSettlement = settlePopulation(next, metadataMap, {
    ...options,
    wizardMigrationRate: Number(options.wizardMigrationRate ?? 0.1) + policyEffects.wizardGrowthBonusRate
  });
  next.gameplay.population = populationSettlement.after;

  const exposureSettlement = updateExposures(next, metadataMap, {
    ...options,
    modifier: Number(options.modifier ?? 0) + specialStructureExposureModifier(next),
    concealmentBonus: policyEffects.concealmentBonus,
    concealmentBonusFor: (building) => specialStructureConcealment(next, building)
  });
  const exposureChanges = exposureSettlement.changes;
  const incidents = generateIncidents(next, exposureSettlement.nextMetadata, roller, {
    ...options,
    createId,
    turn: state.turn
  });
  for (const incident of incidents) next.gameplay.incidents[incident.id] = incident;

  const assignmentValidation = validateAssignments(next, incidents, input.assignments, {
    responseCapacityBonus: policyEffects.incidentResponseBonus
  });
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

  const assignedIncidentIds = new Set(assignmentSettlement.outcomes.map((outcome) => outcome.incidentId));
  const unaddressed = Object.entries(next.gameplay.incidents ?? {})
    .filter(([, incident]) => incident.status === "open" && !assignedIncidentIds.has(incident.id))
    .map(([, incident]) => ({
      incidentId: incident.id,
      buildingId: incident.buildingId,
      type: incident.type,
      severity: incident.severity,
      status: "open",
      createdAtTurn: incident.createdAtTurn
    }));
  const unaddressedExposure = Number(options.unaddressedExposure ?? 1);
  const penalizedBuildings = new Set();
  for (const entry of unaddressed) {
    if (penalizedBuildings.has(entry.buildingId)) continue;
    penalizedBuildings.add(entry.buildingId);
    const change = exposureChanges[entry.buildingId];
    if (change) {
      change.to = applyExposureChange(change.to, unaddressedExposure);
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

  // Freeze a complete incident snapshot into the facts so a later backfilled
  // report reads exactly what this turn saw. The frozen facts must be the only
  // source of historical gameplay content: incidents generated this turn, the
  // ones the Agent dispatched (post-settlement status), and the ones left
  // unaddressed are all captured here. A later live change to an incident can
  // never rewrite an earlier turn's ReportContext.
  const factsIncidentsById = new Map();
  for (const incident of incidents) {
    factsIncidentsById.set(incident.id, next.gameplay.incidents[incident.id] ?? incident);
  }
  for (const outcome of assignmentSettlement.outcomes) {
    if (factsIncidentsById.has(outcome.incidentId)) continue;
    const full = next.gameplay.incidents[outcome.incidentId];
    if (full) factsIncidentsById.set(outcome.incidentId, full);
  }
  for (const entry of unaddressed) {
    if (factsIncidentsById.has(entry.incidentId)) continue;
    const full = next.gameplay.incidents[entry.incidentId];
    if (full) factsIncidentsById.set(entry.incidentId, full);
  }
  const factsIncidents = [...factsIncidentsById.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const resolvedAt = now();
  const schedule = normalizeTurnSchedule(options);
  // The next unlock is anchored to the current turn's wall-clock slot, not to
  // the settlement moment, so an early Agent resolve produces the same cadence
  // as a late one: a turn always unlocks one turnCooldownMs after it opened,
  // no matter when it was settled. There is no deadline auto-settle.
  const turnOpenedAt = next.gameplay.turnOpenedAt ?? resolvedAt;
  const nextTurnUnlockAt = new Date(new Date(turnOpenedAt).getTime() + schedule.turnCooldownMs).toISOString();
  const settledBy = options.settlementSource === "deadline" ? "deadline" : "agent";
  // Advance the deterministic policy lifecycle after this turn's effects have
  // been consumed. The choice's started/refreshed/expired records are captured
  // for the frozen facts, and the offer stays open for the player to read.
  const policyAdvance = advancePolicies(next, { now, turn: state.turn });
  next.gameplay.cardState = policyAdvance.nextState.gameplay.cardState;
  const cardStateFacts = cardFacts(next, state.turn);
  const facts = normalizeTurnFacts({
    turn: state.turn + 1,
    wallClock: {
      openedAt: state.gameplay?.turnOpenedAt ?? null,
      resolvedAt,
      settledBy,
      nextTurnUnlockAt,
      // Deprecated legacy field, always null: turns no longer have a deadline
      // auto-settle.
      turnDeadlineAt: null
    },
    resourceDelta: {
      coins: resourceSettlement.income.coins,
      arcaneEnergy: resourceSettlement.income.arcaneEnergy
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
    incidents: factsIncidents,
    unaddressedIncidents: unaddressed,
    assignments: assignmentSettlement.assignments,
    rolls: assignmentSettlement.rolls,
    outcomes: assignmentSettlement.outcomes,
    sealedBuildings,
    nextRisks,
    cardOfferId: cardStateFacts.cardOfferId,
    offeredCardIds: cardStateFacts.offeredCardIds,
    selectedCardId: cardStateFacts.selectedCardId,
    choiceStatus: cardStateFacts.choiceStatus,
    choiceResolvedAt: cardStateFacts.choiceResolvedAt,
    cardEffects: cardStateFacts.cardEffects,
    policyStarted: cardStateFacts.policyStarted,
    policyRefreshed: cardStateFacts.policyRefreshed,
    policyExpired: cardStateFacts.policyExpired,
    specialPlacementMandate: cardStateFacts.specialPlacementMandate,
    specialPlacementsCompleted: cardStateFacts.specialPlacementsCompleted
  });

  next.gameplay.lastTurnFacts = deepFreeze(facts);
  next.gameplay.turnFacts = appendTurnFacts(next.gameplay.turnFacts, facts);
  next.gameplay.turnStatus = "resolved";
  next.gameplay.turnOpenedAt = next.gameplay.turnOpenedAt ?? resolvedAt;
  next.gameplay.turnDeadlineAt = null;
  next.gameplay.nextTurnUnlockAt = nextTurnUnlockAt;
  next.gameplay.scheduler = normalizeScheduler({
    ...(next.gameplay.scheduler ?? {}),
    openedAt: next.gameplay.turnOpenedAt ?? null,
    resolvedAt,
    settledBy
  });
  // Construction owns the outer coins ledger. Gameplay owns Arcane Energy;
  // do not mirror it into construction resources or retain the legacy `magic`
  // key as a second account.
  next.resources = { coins: resourceSettlement.after.coins };
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
      turnDeadlineAt: null,
      nextTurnUnlockAt: null,
      scheduler: null,
      resources: { coins, arcaneEnergy: 0 },
      population: { muggles: { current: 0, capacity: 0 }, wizards: { current: 0, capacity: 0 } },
      arcaneOfficers: {},
      incidents: {},
      turnFacts: {},
      lastTurnFacts: null,
      cardState: {
        offer: null,
        choice: { offerId: null, status: "pending", selectedCardId: null, decisionMode: null, choiceResolvedAt: null, cardEffects: {}, policyStarted: [], policyRefreshed: [], policyExpired: [], officerRecruitedId: null, specialPlacementMandate: null, specialPlacementsCompleted: [] },
        activePolicies: [],
        pendingPlacement: null,
        placements: {}
      }
    };
  }
  const migrated = { ...existing };
  // Normalize legacy `magic` on the first resolve; no legacy key is copied to
  // the canonical state. The resource normalizer below also handles old
  // persisted gameplay resources that have no explicit migration marker.
  const legacyRoster = migrated.wardens != null && Object.keys(migrated.wardens).length > 0;
  const newRoster = migrated.arcaneOfficers != null && Object.keys(migrated.arcaneOfficers).length > 0;
  if (legacyRoster && !newRoster) {
    migrated.arcaneOfficers = migrated.wardens;
  }
  delete migrated.wardens;
  if (migrated.turnFacts == null) migrated.turnFacts = {};
  if (migrated.cardState == null) {
    migrated.cardState = {
      offer: null,
      choice: { offerId: null, status: "pending", selectedCardId: null, decisionMode: null, choiceResolvedAt: null, cardEffects: {}, policyStarted: [], policyRefreshed: [], policyExpired: [], officerRecruitedId: null, specialPlacementMandate: null, specialPlacementsCompleted: [] },
      activePolicies: [],
      pendingPlacement: null,
      placements: {}
    };
  }
  return migrated;
}
