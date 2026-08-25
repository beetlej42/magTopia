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
  inspectSpatialExposure,
  neighborhoodConcealment
} from "./exposure.js";
import { incidentAttribute, incidentDefinition } from "./incidents.js";
import { createRoller, pick, rollDice } from "./random.js";
import { maintenanceForRoster, normalizeRecruitmentState } from "./arcane-officers.js";
import { normalizeTurnSchedule } from "./turn.js";
import {
  deepFreeze,
  GAMEPLAY_SCHEMA_VERSION,
  INCIDENT_TYPES,
  normalizeExposureIncident,
  normalizeArcaneOfficer,
  normalizeGameplayResources,
  normalizePopulationState,
  normalizeRollRecord,
  normalizeScheduler,
  normalizeTurnFacts,
} from "./schema.js";
import {
  ECONOMY_RULES,
  capacitiesFromSettlementMetadata,
  incomeForSettlement,
  migratePopulationBucket,
  supportedPopulationTargets,
  supportedPopulationTargetsForSettlement,
  clampRate,
  EconomyDataError,
  systemOwnedBonusForBuilding
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

export function normalizeMaxRisks(value = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number)));
}

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
      const systemOwnedBonus = systemOwnedBonusForBuilding(building);
      return {
        ...metadata,
        canonical: metadata.canonical === true,
        status: building.status ?? metadata.status ?? "active",
        exposure: Number.isFinite(Number(building.exposure)) ? Number(building.exposure) : (metadata.exposure ?? 0),
        ...(systemOwnedBonus ? { systemOwnedCardId: building.specialStructure.cardId } : {})
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
  const income = incomeForSettlement(metadataMap, population, {
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
  if (!Number.isSafeInteger(income.coins + baseCoins)) throw new EconomyDataError("coin income exceeds the safe integer range");
  income.coins += baseCoins;
  const maintenance = options.chargeOfficerMaintenance === true ? maintenanceForRoster(state, options) : { count: 0, rate: 0, total: 0 };
  const openingCoins = beforeSafeCoins(state);
  const availableForMaintenance = openingCoins + income.coins;
  const maintenanceCharged = Math.min(availableForMaintenance, maintenance.total);
  if (!Number.isFinite(income.arcaneEnergy + baseArcaneEnergy) || income.arcaneEnergy + baseArcaneEnergy > Number.MAX_SAFE_INTEGER) {
    throw new EconomyDataError("arcane income exceeds the safe range");
  }
  income.arcaneEnergy += baseArcaneEnergy;
  const netIncome = { ...income, coins: income.coins - maintenanceCharged };
  // Coins have one authoritative source: `state.resources.coins`, which is
  // debited by construction/road/reservation mutations and credited by card
  // grants. `gameplay.resources` mirrors it at settlement. Basing the settle on
  // `state.resources.coins` means a construction spend is never wiped out by a
  // stale gameplay ledger value.
  const gameplayBefore = normalizeGameplayResources(state.gameplay?.resources);
  const hasOuterCoins = Object.prototype.hasOwnProperty.call(state.resources ?? {}, "coins");
  const outerCoins = Number(state.resources?.coins);
  if (hasOuterCoins && (!Number.isSafeInteger(outerCoins) || outerCoins < 0)) {
    throw new EconomyDataError("outer construction coins ledger is invalid", "INVALID_COINS_LEDGER");
  }
  const spendableCoins = Number.isSafeInteger(outerCoins) && outerCoins >= 0 ? outerCoins : gameplayBefore.coins;
  const before = { ...gameplayBefore, coins: spendableCoins };
  if (!Number.isSafeInteger(before.coins + netIncome.coins)) throw new EconomyDataError("coin balance exceeds the safe integer range");
  if (!Number.isFinite(before.arcaneEnergy + income.arcaneEnergy) || before.arcaneEnergy + income.arcaneEnergy > Number.MAX_SAFE_INTEGER) {
    throw new EconomyDataError("arcane balance exceeds the safe range");
  }
  const after = normalizeGameplayResources({ coins: Math.max(0, availableForMaintenance - maintenance.total), arcaneEnergy: before.arcaneEnergy + netIncome.arcaneEnergy });
  return { before, after, income, netIncome, maintenance: { ...maintenance, charged: maintenanceCharged, unpaid: maintenance.total - maintenanceCharged } };
}

function beforeSafeCoins(state) {
  const value = Number(state?.resources?.coins);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function settlePopulation(state, metadataMap, options = {}) {
  const before = normalizePopulationState(state.gameplay?.population);
  const targets = supportedPopulationTargetsForSettlement(state, metadataMap, options);
  const capacities = capacitiesFromSettlementMetadata(metadataMap);
  const serviceCoverage = targets.service?.serviceCoverage ?? 0;
  const serviceRules = (options.rules ?? ECONOMY_RULES).publicService ?? ECONOMY_RULES.publicService;
  const serviceRate = ECONOMY_RULES.defaultMigrationRate
    + (serviceRules.servicedMigrationRate - ECONOMY_RULES.defaultMigrationRate) * serviceCoverage;
  const wizardBonus = Number(options.wizardMigrationRateBonus ?? 0);
  const muggleRate = clampRate(options.migrationRate ?? options.muggleMigrationRate ?? serviceRate);
  const wizardRate = clampRate((options.wizardMigrationRate ?? options.migrationRate ?? serviceRate) + wizardBonus);
  const defaultOutbound = options.migrationRate != null ? options.migrationRate : ECONOMY_RULES.defaultMigrationRate;
  const muggleOutboundRate = options.muggleOutboundMigrationRate ?? options.outboundMigrationRate ?? defaultOutbound;
  const wizardOutboundRate = options.wizardOutboundMigrationRate ?? options.outboundMigrationRate
    ?? (options.wizardMigrationRate != null ? options.wizardMigrationRate : defaultOutbound);
  return {
    before,
    after: {
      muggles: { ...migratePopulationBucket(before.muggles, targets.muggles, muggleRate, muggleOutboundRate), capacity: capacities.muggles },
      wizards: { ...migratePopulationBucket(before.wizards, targets.wizards, wizardRate, wizardOutboundRate), capacity: capacities.wizards }
    },
    capacityDelta: capacities,
    target: targets,
    publicService: {
      ...targets.service,
      supportedTarget: { muggles: targets.muggles, wizards: targets.wizards, total: targets.total },
      migrationRate: { muggles: muggleRate, wizards: wizardRate },
      outboundMigrationRate: { muggles: clampRate(muggleOutboundRate), wizards: clampRate(wizardOutboundRate) },
      supportedOccupancy: targets.service
        ? (targets.baseSupportedOccupancy ?? ECONOMY_RULES.defaultSupportedOccupancy)
          + ((targets.servicedMaxOccupancy ?? serviceRules.servicedMaxOccupancy) - (targets.baseSupportedOccupancy ?? ECONOMY_RULES.defaultSupportedOccupancy)) * (targets.service.serviceCoverage ?? 0)
        : ECONOMY_RULES.defaultSupportedOccupancy
    }
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
    // Exposure is an inspectable spatial signal; historicalRisk is the sole
    // authority for incident sealing in PR-F. Reaching the legacy exposure
    // accumulator cap must not create a second sealing rule.
    changes[id] = { from, to, delta, pressure, concealment, sealed: metadata.status === "sealed" };
    nextMetadata[id] = { ...metadata, exposure: to };
  }
  return { changes, nextMetadata };
}

const INCIDENT_PURPOSES = Object.freeze({
  investigation: Object.freeze({ residential: 2, commercial: 1, public_service: 1, production: 1, greenhouse: 1 }),
  suppression: Object.freeze({ residential: 1, commercial: 1, public_service: 1, production: 2, greenhouse: 2 }),
  cover_up: Object.freeze({ residential: 1, commercial: 2, public_service: 2, production: 1, greenhouse: 1 })
});

function clampUnit(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

function weightedChoice(roller, weights) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const roll = roller.next();
  let cursor = roll * total;
  for (const key of Object.keys(weights)) {
    cursor -= weights[key];
    if (cursor < 0) return { value: key, roll };
  }
  return { value: Object.keys(weights).at(-1), roll };
}

function purposeWeightsForRisk(risk) {
  const weights = {};
  for (const unit of risk.magicLoadBreakdown ?? []) {
    const purpose = String(unit.purpose ?? "");
    // Ordinary zero-load units dilute LocalMagicRatio, but are not an
    // incident source. Source-purpose weights therefore use MagicLoad only.
    const contribution = Math.max(0, Number(unit.magicLoad) || 0);
    if (!purpose || contribution <= 0) continue;
    weights[purpose] = (weights[purpose] ?? 0) + contribution;
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return {};
  return Object.fromEntries(Object.entries(weights).sort(([a], [b]) => a.localeCompare(b)).map(([purpose, value]) => [purpose, value / total]));
}

function incidentTypeWeights(risk) {
  const purposeWeights = purposeWeightsForRisk(risk);
  const ratio = clampUnit(risk.localMagicRatio);
  const weights = Object.fromEntries(INCIDENT_TYPES.map((type) => [type, 1]));
  for (const type of INCIDENT_TYPES) {
    weights[type] += Object.entries(purposeWeights).reduce((sum, [purpose, share]) => sum + (INCIDENT_PURPOSES[type][purpose] ?? 1) * share, 0);
  }
  // A high magic ratio makes active suppression somewhat more likely, while
  // a low ratio leaves ambiguity/cover-up relatively more likely. These are
  // weights only: no purpose is hard-bound to one incident type.
  weights.suppression += ratio * 2;
  weights.investigation += (1 - ratio);
  weights.cover_up += (1 - ratio) * 0.5;
  return weights;
}

function sourcePurposeForRisk(risk) {
  const purposeWeights = purposeWeightsForRisk(risk);
  return Object.entries(purposeWeights).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function difficultyWeights(risk, historicalRisk) {
  const pressure = clampUnit((Number(risk.finalIncidentChance) || 0) / 0.1);
  const riskScore = clampUnit((pressure + Math.max(0, Number(historicalRisk) || 0) / 4) / 2);
  return {
    normal: Math.max(1, 6 - riskScore * 5),
    hard: 1 + riskScore * 4,
    severe: 1 + riskScore * 5
  };
}

export function generateIncidents(state, metadataMap, roller, options = {}) {
  const risks = inspectSpatialExposure(state, {
    metadataOf: (building) => metadataMap[building.id],
    typeIntensityResolver: options.typeIntensityResolver
  })
    .filter((risk) => risk.authoritative && risk.eligible && risk.magicLoad > 0
      && state.buildings?.[risk.buildingId]?.status !== "sealed"
      && metadataMap[risk.buildingId]?.status !== "sealed")
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  // Freeze all threshold rolls first. This makes the occurrence of building B
  // independent of whether building A happened to hit its chance roll.
  const thresholdRolls = risks.map((risk) => ({ risk, thresholdRoll: roller.next() }));
  const incidents = [];
  for (const { risk, thresholdRoll } of thresholdRolls) {
    const hit = thresholdRoll < risk.finalIncidentChance;
    options.incidentRolls?.push({
      buildingId: risk.buildingId,
      finalIncidentChance: risk.finalIncidentChance,
      thresholdRoll,
      hit,
      magicLoad: risk.magicLoad,
      baseRisk: risk.baseRisk,
      spatialModifier: risk.spatialModifier,
      historicalRisk: Number(state.buildings?.[risk.buildingId]?.historicalRisk ?? 0),
      sourcePurpose: sourcePurposeForRisk(risk),
      purposeWeights: purposeWeightsForRisk(risk)
    });
    if (!hit) continue;
    const id = risk.buildingId;
    const metadata = metadataMap[id] ?? {};
    const historicalRisk = Number(state.buildings?.[id]?.historicalRisk ?? metadata.historicalRisk ?? 0);
    const typeChoice = weightedChoice(roller, incidentTypeWeights(risk));
    const dcChoice = weightedChoice(roller, difficultyWeights(risk, historicalRisk));
    const dc = { normal: 10, hard: 14, severe: 18 }[dcChoice.value];
    const type = typeChoice.value;
    const buildingName = state.buildings?.[id]?.program?.name;
    const definition = incidentDefinition(type);
    incidents.push(normalizeExposureIncident({
      id: options.createId?.("incident") ?? `incident-${id}-${options.turn ?? 0}`,
      buildingId: id,
      type,
      attribute: incidentAttribute(type),
      dc,
      difficultyTier: dcChoice.value,
      severity: dcChoice.value === "severe" ? 3 : dcChoice.value === "hard" ? 2 : 1,
      exposureAtCreation: metadata.exposure,
      historicalRiskAtCreation: historicalRisk,
      sourceRisk: {
        finalIncidentChance: risk.finalIncidentChance,
        baseRisk: risk.baseRisk,
        spatialModifier: risk.spatialModifier,
        localMagicRatio: risk.localMagicRatio,
        magicLoad: risk.magicLoad,
        sourcePurpose: sourcePurposeForRisk(risk),
        purposeWeights: purposeWeightsForRisk(risk),
        thresholdRoll,
        typeWeights: incidentTypeWeights(risk),
        difficultyWeights: difficultyWeights(risk, historicalRisk)
      },
      typeRoll: typeChoice.roll,
      sourcePurpose: sourcePurposeForRisk(risk),
      purposeWeights: purposeWeightsForRisk(risk),
      typeWeights: incidentTypeWeights(risk),
      dcRoll: dcChoice.roll,
      dcWeights: difficultyWeights(risk, historicalRisk),
      summary: definition.summaryTemplate(buildingName),
      status: "open",
      createdAtTurn: options.turn ?? state.turn
    }));
  }
  return incidents.sort((a, b) => a.buildingId.localeCompare(b.buildingId) || a.id.localeCompare(b.id));
}

// The first parameter remains for callers of the old helper signature; it is
// deliberately ignored. Outcome is a pure function of total - DC margin.
export function gradeRoll(_roll, total, dc) {
  const margin = Number(total) - Number(dc);
  if (margin >= 5) return "critical_success";
  if (margin >= 0) return "success";
  if (margin <= -5) return "critical_failure";
  return "failure";
}

export function resolveIncidentRoll({ incident, officer, modifier = 0, roller, options = {} }) {
  const definition = incidentDefinition(incident.type);
  const attribute = definition.attribute;
  const attributeValue = Number(officer?.[attribute] ?? 0);
  // New identities specialize in a building purpose. Legacy type-specialty
  // archives remain readable, but cannot receive a purpose bonus when the
  // incident carries the authoritative sourcePurpose.
  const sourcePurpose = incident?.sourcePurpose == null ? null : String(incident.sourcePurpose);
  const purposeSpecialty = officer?.specialty ?? ((officer?.specialties ?? []).length === 1 && ["residential", "commercial", "public_service", "production", "greenhouse"].includes(officer.specialties[0]) ? officer.specialties[0] : null);
  const specialtyBonus = sourcePurpose != null && purposeSpecialty === sourcePurpose
    ? Number(options.specialtyBonus ?? 2)
    : 0;
  const roll = rollDice(roller, 20);
  const dc = Number(incident.dc ?? incident.difficulty ?? 10);
  const modifierValue = Number(modifier ?? 0);
  const total = roll + attributeValue + specialtyBonus + modifierValue;
  const margin = total - dc;
  const outcome = gradeRoll(roll, total, dc);
  return { roll, total, attribute, attributeValue, specialtyBonus, otherModifiers: modifierValue, dc, margin, outcome };
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
    const allowedFields = new Set(["incidentId", "incident_id", "arcaneOfficerId", "arcane_officer_id", "rationale"]);
    for (const key of Object.keys(assignment ?? {})) {
      if (!allowedFields.has(key)) errors.push({ incidentId, officerId, code: "ASSIGNMENT_CARRIES_SYSTEM_PARAMETER", message: `Assignment must not carry ${key}; dice, DC, modifiers, outcomes, and balance fields are system-controlled` });
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
  const historicalRiskChanges = {};
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
    const eligibleForGrowth = ["success", "critical_success"].includes(result.outcome);
    const atCap = Number(officer?.[result.attribute] ?? 0) >= Number(options.attributeCap ?? 5);
    const growthChance = !eligibleForGrowth || atCap ? 0 : result.outcome === "critical_success" ? Number(options.criticalGrowthChance ?? 0.2) : Number(options.growthChance ?? 0.08);
    const growthRoll = roller.next();
    const canGrow = eligibleForGrowth && !atCap;
    const gained = canGrow && growthRoll < growthChance ? 1 : 0;
    const attributeBefore = Number(officer?.[result.attribute] ?? 0);
    const attributeAfter = Math.min(Number(options.attributeCap ?? 5), attributeBefore + gained);
    const building = state.buildings?.[incident.buildingId] ?? {};
    const beforeRisk = Math.max(0, Math.min(4, Number(building.historicalRisk ?? 0)));
    const riskDelta = result.outcome === "critical_failure" ? 2 : result.outcome === "failure" ? 1 : 0;
    const afterRisk = Math.min(4, beforeRisk + riskDelta);
    normalized.push({ incidentId, arcaneOfficerId: officerId, ...(assignment.rationale != null ? { rationale: String(assignment.rationale) } : {}) });
    rolls.push(normalizeRollRecord({ ...result, incidentId, arcaneOfficerId: officerId, historicalRiskBefore: beforeRisk, historicalRiskAfter: afterRisk, historicalRiskDelta: afterRisk - beforeRisk, sealed: afterRisk >= 4 }));
    outcomes.push({
      incidentId,
      buildingId: incident.buildingId,
      arcaneOfficerId: officerId,
      outcome: result.outcome,
      exposureDelta: outcome.exposureDelta,
      incidentStatus: outcome.incidentStatus,
      arcaneOfficerStatus: outcome.arcaneOfficerStatus,
      historicalRiskBefore: beforeRisk,
      historicalRiskAfter: afterRisk,
      historicalRiskDelta: riskDelta,
      sealed: afterRisk >= 4,
      resolution: "assigned"
    });
    const historyEntry = {
      turn: state.turn,
      incidentId: incident.id,
      buildingId: incident.buildingId,
      sourcePurpose: incident.sourcePurpose ?? null,
      attribute: result.attribute,
      outcome: result.outcome,
      growthRoll,
      growthChance,
      before: attributeBefore,
      after: attributeAfter,
      gained
    };
    outcomes.at(-1).growth = { attribute: result.attribute, roll: growthRoll, chance: growthChance, before: attributeBefore, after: attributeAfter, gained };
    historicalRiskChanges[incident.buildingId] = {
      buildingId: incident.buildingId,
      before: historicalRiskChanges[incident.buildingId]?.before ?? beforeRisk,
      after: afterRisk,
      delta: (historicalRiskChanges[incident.buildingId]?.delta ?? 0) + riskDelta,
      incidentIds: [...(historicalRiskChanges[incident.buildingId]?.incidentIds ?? []), incidentId],
      sealed: afterRisk >= 4
    };
    if (state.gameplay?.incidents?.[incidentId]) state.gameplay.incidents[incidentId] = { ...incident, status: outcome.incidentStatus };
    if (state.gameplay?.arcaneOfficers?.[officerId]) state.gameplay.arcaneOfficers[officerId] = normalizeArcaneOfficer({ ...officer, status: outcome.arcaneOfficerStatus, [result.attribute]: attributeAfter, history: [...(officer.history ?? []), historyEntry].slice(-50) });
    if (state.buildings?.[incident.buildingId]) state.buildings[incident.buildingId] = {
      ...state.buildings[incident.buildingId], historicalRisk: afterRisk, ...(afterRisk >= 4 ? { status: "sealed" } : {})
    };
  }
  return { assignments: normalized, rolls, outcomes, historicalRiskChanges };
}

function applyOutcome(outcome, options = {}) {
  switch (outcome) {
    case "critical_success":
      return {
        exposureDelta: 0,
        incidentStatus: "resolved",
        arcaneOfficerStatus: "available"
      };
    case "success":
      return {
        exposureDelta: 0,
        incidentStatus: "resolved",
        arcaneOfficerStatus: "available"
      };
    case "failure":
      return {
        exposureDelta: 0,
        incidentStatus: "failed",
        arcaneOfficerStatus: "available"
      };
    case "critical_failure":
      return {
        exposureDelta: 0,
        incidentStatus: "failed",
        arcaneOfficerStatus: "available"
      };
    default:
      return { exposureDelta: 0, incidentStatus: "open", arcaneOfficerStatus: "available" };
  }
}

// Production settlement always runs the complete gameplay stack. The baseline
// wrapper below is the only supported way for deterministic PR-D balance
// harnesses to omit later systems; callers cannot toggle individual systems on
// the normal resolveTurn context.
export function resolveTurn(state, input = {}, context = {}) {
  return resolveTurnInternal(state, input, context, "production");
}

export function resolvePublicServiceBaselineTurn(state, input = {}, context = {}) {
  return resolveTurnInternal(state, input, context, "public_service_baseline");
}

function resolveTurnInternal(state, input = {}, context = {}, profile = "production") {
  const guardError = guardTurnResolve(state, input);
  if (guardError) return { nextState: state, facts: null, error: guardError };
  const gameplay = migrateGameplay(state);
  const options = { ...(context.options ?? {}) };
  const createId = context.createId ?? ((prefix) => `${prefix}-${state.turn}`);
  const now = context.now ?? (() => new Date().toISOString());
  const roller = createRoller(context);
  let normalizedResources;
  try {
    normalizedResources = normalizeGameplayResources(gameplay.resources);
  } catch (error) {
    return { nextState: state, facts: null, error: { code: error?.code ?? "INVALID_ECONOMY_DATA", message: error?.message ?? "Gameplay resources are invalid" } };
  }
  let next = {
    ...state,
    buildings: Object.fromEntries(Object.entries(state.buildings ?? {}).map(([id, building]) => {
      const historicalRisk = Math.max(0, Math.min(4, Number(building?.historicalRisk ?? 0)));
      return [id, { ...building, historicalRisk, ...(historicalRisk >= 4 ? { status: "sealed" } : {}) }];
    })),
    gameplay: {
      ...gameplay,
      resources: normalizedResources,
      population: normalizePopulationState(gameplay.population),
      arcaneOfficers: Object.fromEntries(Object.entries(gameplay.arcaneOfficers ?? {}).map(([id, officer]) => [id, normalizeArcaneOfficer(officer)])),
      arcaneOfficerRecruitment: normalizeRecruitmentState(gameplay.arcaneOfficerRecruitment),
      incidents: Object.fromEntries(Object.entries(gameplay.incidents ?? {}).map(([id, incident]) => [id, normalizeExposureIncident(incident)]))
    }
  };

  // PR F — Player daily cards. Settlement owns the card facts: the offer for
  // this turn is ensured, an un-answered choice is recorded explicitly as
  // skipped (never blocking settlement), active policy modifiers feed the
  // deterministic simulation, and the policy lifecycle advances exactly once.
  // Headless balance runs deliberately stay on the PR-D economy surface. The
  // explicit internal profile keeps later systems out of that wrapper while
  // preserving the complete production resolve path for normal callers.
  const enableCards = profile === "production";
  const enableIncidents = profile === "production";
  const enableExposure = profile === "production";
  const cityId = state.cityId ?? "";
  if (enableCards) {
    next = ensureCardOffer(next, cityId);
    next = markChoiceSkipped(next, { now });
  }
  const policyEffects = enableCards ? collectPolicyEffects(next) : {};

  let metadataMap;
  let resourceSettlement;
  let populationSettlement;
  try {
    metadataMap = asMap(next, "metadata");
    resourceSettlement = settleResources(next, metadataMap, { ...options, chargeOfficerMaintenance: enableCards || profile === "production" });
    next.gameplay.resources = resourceSettlement.after;
    populationSettlement = settlePopulation(next, metadataMap, {
      ...options,
      wizardMigrationRateBonus: policyEffects.wizardGrowthBonusRate
    });
    next.gameplay.population = populationSettlement.after;
  } catch (error) {
    return {
      nextState: state,
      facts: null,
      error: {
        code: error?.code ?? "INVALID_ECONOMY_DATA",
        message: error?.message ?? "Canonical economy data is invalid"
      }
    };
  }

  const exposureSettlement = enableExposure
    ? updateExposures(next, metadataMap, {
      ...options,
      modifier: Number(options.modifier ?? 0) + specialStructureExposureModifier(next),
      concealmentBonus: policyEffects.concealmentBonus,
      concealmentBonusFor: (building) => specialStructureConcealment(next, building)
    })
    : { changes: {}, nextMetadata: metadataMap };
  const exposureChanges = exposureSettlement.changes;
  const incidentRolls = [];
  const incidents = enableIncidents
    ? generateIncidents(next, exposureSettlement.nextMetadata, roller, {
      ...options,
      createId,
      turn: state.turn,
      incidentRolls
    })
    : [];
  for (const incident of incidents) next.gameplay.incidents[incident.id] = incident;

  const assignmentValidation = validateAssignments(next, incidents, input.assignments, {
    responseCapacityBonus: policyEffects.incidentResponseBonus
  });
  if (!assignmentValidation.ok) {
    return { nextState: state, facts: null, error: { code: "INVALID_ASSIGNMENT", message: assignmentValidation.errors.map((entry) => entry.message).join("; "), assignmentErrors: assignmentValidation.errors } };
  }
  const assignmentSettlement = settleAssignments(next, incidents, input.assignments, roller, options);
  const assignedIncidentIds = new Set(assignmentSettlement.outcomes.map((outcome) => outcome.incidentId));
  const unaddressed = Object.entries(next.gameplay.incidents ?? {})
    .filter(([, incident]) => incident.status === "open" && !assignedIncidentIds.has(incident.id))
    .map(([, incident]) => ({
      incidentId: incident.id,
      buildingId: incident.buildingId,
      type: incident.type,
      severity: incident.severity,
      status: "failed",
      createdAtTurn: incident.createdAtTurn
    }));
  const historicalRiskChanges = { ...assignmentSettlement.historicalRiskChanges };
  const unaddressedOutcomes = [];
  for (const entry of unaddressed) {
    const incident = next.gameplay.incidents[entry.incidentId];
    if (incident) next.gameplay.incidents[entry.incidentId] = { ...incident, status: "failed" };
    const building = next.buildings[entry.buildingId];
    const beforeRisk = Math.max(0, Math.min(4, Number(building?.historicalRisk ?? 0)));
    const riskDelta = beforeRisk >= 4 ? 0 : 1;
    const afterRisk = Math.min(4, beforeRisk + riskDelta);
    entry.historicalRiskBefore = beforeRisk;
    entry.historicalRiskAfter = afterRisk;
    entry.historicalRiskDelta = riskDelta;
    entry.outcome = "failure";
    entry.resolution = "unaddressed";
    entry.sealed = afterRisk >= 4;
    const change = historicalRiskChanges[entry.buildingId] ?? {
      buildingId: entry.buildingId,
      before: beforeRisk,
      after: beforeRisk,
      delta: 0,
      incidentIds: [],
      sealed: false
    };
    change.after = afterRisk;
    change.delta += riskDelta;
    change.incidentIds = [...change.incidentIds, entry.incidentId];
    change.sealed = afterRisk >= 4;
    historicalRiskChanges[entry.buildingId] = change;
    if (building) next.buildings[entry.buildingId] = {
      ...building,
      historicalRisk: afterRisk,
      ...(afterRisk >= 4 ? { status: "sealed" } : {})
    };
    unaddressedOutcomes.push({
      incidentId: entry.incidentId,
      buildingId: entry.buildingId,
      outcome: "failure",
      resolution: "unaddressed",
      historicalRiskBefore: beforeRisk,
      historicalRiskAfter: afterRisk,
      historicalRiskDelta: riskDelta,
      sealed: afterRisk >= 4,
      incidentStatus: "failed"
    });
    const exposureChange = exposureChanges[entry.buildingId];
    if (exposureChange) {
      exposureChange.to = applyExposureChange(exposureChange.to, 0);
      exposureChange.delta = exposureChange.to - exposureChange.from;
      exposureChange.sealed = exposureChange.sealed || afterRisk >= 4;
    }
  }
  assignmentSettlement.outcomes.push(...unaddressedOutcomes);

  const sealedBuildings = [...new Set([
    ...Object.entries(exposureChanges).filter(([, change]) => change.sealed).map(([id]) => id),
    ...Object.entries(historicalRiskChanges).filter(([, change]) => change.sealed).map(([id]) => id)
  ])].sort();
  for (const [id, change] of Object.entries(exposureChanges)) {
    if (!next.buildings[id]) continue;
    next.buildings[id] = {
      ...next.buildings[id],
      exposure: change.to,
      ...(change.sealed ? { status: "sealed" } : {})
    };
  }

  const legacyNextRisks = Object.entries(exposureChanges)
    .filter(([, change]) => change.to > 0)
    .sort((a, b) => b[1].pressure - a[1].pressure)
    .slice(0, normalizeMaxRisks(options.maxRisks))
    .map(([buildingId, change]) => ({ buildingId, exposure: change.to, pressure: change.pressure, concealment: change.concealment }));

  // PR-E risk inspection is an observable production projection, but does
  // not alter the existing exposure accumulator or incident roll. Only
  // canonical functional-unit buildings with positive MagicLoad participate.
  const spatialRiskSnapshot = inspectSpatialExposure(next, {
    metadataOf: (building) => metadataMap[building.id],
    typeIntensityResolver: options.typeIntensityResolver
  })
    .filter((risk) => risk.authoritative && risk.eligible && risk.magicLoad > 0)
    .map((risk) => ({
      ...risk,
      // Preserve the legacy projection fields for consumers that already
      // render nextRisks, while the PR-E fields explain the authoritative
      // spatial risk alongside them.
      exposure: exposureChanges[risk.buildingId]?.to ?? metadataMap[risk.buildingId]?.exposure ?? 0,
      pressure: exposureChanges[risk.buildingId]?.pressure ?? 0,
      concealment: exposureChanges[risk.buildingId]?.concealment ?? 0
    }))
    .sort((a, b) => b.finalIncidentChance - a.finalIncidentChance || a.buildingId.localeCompare(b.buildingId))
    .slice(0, normalizeMaxRisks(options.maxRisks));
  // Legacy-only states retain their historical nextRisks shape for API
  // compatibility. As soon as canonical buildings exist, the projection is
  // exclusively the authoritative PR-E snapshot.
  const hasCanonicalBuilding = Object.values(metadataMap).some((metadata) => metadata?.canonical === true);
  const nextRisks = hasCanonicalBuilding ? spatialRiskSnapshot : legacyNextRisks;

  // Freeze a complete incident snapshot into the facts so a later backfilled
  // report reads exactly what this turn saw. The frozen facts must be the only
  // source of historical gameplay content: incidents generated this turn, the
  // ones the Agent dispatched (post-settlement status), and the ones left
  // unaddressed are all captured here. A later live change to an incident can
  // never rewrite an earlier turn's ReportContext.
  const factsIncidentsById = new Map();
  for (const incident of incidents) {
    factsIncidentsById.set(incident.id, normalizeExposureIncident(next.gameplay.incidents[incident.id] ?? incident));
  }
  for (const outcome of assignmentSettlement.outcomes) {
    if (factsIncidentsById.has(outcome.incidentId)) continue;
    const full = next.gameplay.incidents[outcome.incidentId];
    if (full) factsIncidentsById.set(outcome.incidentId, normalizeExposureIncident(full));
  }
  for (const entry of unaddressed) {
    if (factsIncidentsById.has(entry.incidentId)) continue;
    const full = next.gameplay.incidents[entry.incidentId];
    if (full) factsIncidentsById.set(entry.incidentId, normalizeExposureIncident(full));
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
  const policyAdvance = enableCards
    ? advancePolicies(next, { now, turn: state.turn })
    : { nextState: next };
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
    netResourceDelta: {
      coins: resourceSettlement.after.coins - resourceSettlement.before.coins,
      arcaneEnergy: resourceSettlement.after.arcaneEnergy - resourceSettlement.before.arcaneEnergy
    },
    officerMaintenance: resourceSettlement.maintenance,
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
    publicService: populationSettlement.publicService,
    buildingsStarted: [...(input.buildingsStarted ?? [])],
    buildingsCompleted: [...(input.buildingsCompleted ?? [])],
    exposureChanges,
    incidents: factsIncidents,
    incidentRolls,
    unaddressedIncidents: unaddressed,
    assignments: assignmentSettlement.assignments,
    rolls: assignmentSettlement.rolls,
    outcomes: assignmentSettlement.outcomes,
    historicalRiskChanges,
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
      schemaVersion: GAMEPLAY_SCHEMA_VERSION,
      turnStatus: "open",
      turnOpenedAt: null,
      turnDeadlineAt: null,
      nextTurnUnlockAt: null,
      scheduler: null,
      resources: { coins, arcaneEnergy: 0 },
      population: { muggles: { current: 0, capacity: 0 }, wizards: { current: 0, capacity: 0 } },
      arcaneOfficers: {},
      arcaneOfficerRecruitment: { schemaVersion: 1, window: null, candidates: {} },
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
  migrated.schemaVersion = GAMEPLAY_SCHEMA_VERSION;
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
  if (migrated.arcaneOfficerRecruitment == null) migrated.arcaneOfficerRecruitment = { schemaVersion: 1, window: null, candidates: {} };
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
