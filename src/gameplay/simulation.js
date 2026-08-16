import { deriveGameplayBuilding } from "./building-metadata.js";
import {
  applyExposureChange,
  exposureDelta,
  exposurePressure,
  incidentDifficulty,
  incidentProbability,
  incidentSeverity,
  incidentSummary,
  isSealedExposure,
  neighborhoodConcealment
} from "./exposure.js";
import { chance, createRoller, pick } from "./random.js";
import {
  deepFreeze,
  INCIDENT_TYPES,
  normalizeExposureIncident,
  normalizeGameplayResources,
  normalizePopulationState,
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
    incidents.push(normalizeExposureIncident({
      id: options.createId?.("incident") ?? `incident-${id}-${options.turn ?? 0}`,
      buildingId: id,
      type,
      difficulty,
      severity,
      exposureAtCreation: metadata.exposure,
      summary: incidentSummary(type, buildingName),
      status: "open",
      createdAtTurn: options.turn ?? state.turn
    }));
  }
  return incidents;
}

export function resolveTurn(state, input = {}, context = {}) {
  const options = { ...(input.options ?? {}), ...(context.options ?? {}) };
  const createId = context.createId ?? ((prefix) => `${prefix}-${state.turn}`);
  const now = context.now ?? (() => new Date().toISOString());
  const roller = createRoller(context);
  const next = {
    ...state,
    gameplay: {
      ...(state.gameplay ?? {}),
      resources: normalizeGameplayResources(state.gameplay?.resources),
      population: normalizePopulationState(state.gameplay?.population),
      wardens: { ...(state.gameplay?.wardens ?? {}) },
      incidents: { ...(state.gameplay?.incidents ?? {}) }
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
    incidents,
    assignments: [...(input.assignments ?? [])].map((entry) => ({ ...entry })),
    rolls: [],
    outcomes: [],
    sealedBuildings,
    nextRisks
  });

  next.gameplay.lastTurnFacts = deepFreeze(facts);
  next.gameplay.turnStatus = "resolved";
  next.gameplay.turnOpenedAt = next.gameplay.turnOpenedAt ?? resolvedAt;
  next.resources = { ...next.resources, coins: resourceSettlement.after.coins, magic: resourceSettlement.after.magic };
  next.turn = state.turn + 1;
  next.version = (next.version ?? 0) + 1;

  return { nextState: next, facts };
}
