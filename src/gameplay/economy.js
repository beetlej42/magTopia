import { GAMEPLAY_PURPOSES, normalizeMagicRatio } from "./schema.js";

// Phase 2 economy constants live in one module so later balancing or the
// public-service phase can inject policy without scattering magic numbers.
export const ECONOMY_RULES = Object.freeze({
  initialCoins: 600,
  initialArcaneEnergy: 0,
  residentialCapacityPerCell: 4,
  defaultSupportedOccupancy: 0.5,
  defaultMigrationRate: 0.25,
  residentialCoinsPerResident: 2,
  residentialArcaneEnergyPerWizard: 0.25,
  functionalOutput: Object.freeze({
    residential: Object.freeze({ coins: 0, arcaneEnergy: 0 }),
    commercial: Object.freeze({ coins: 12, arcaneEnergy: 1 }),
    public_service: Object.freeze({ coins: 0, arcaneEnergy: 0 }),
    production: Object.freeze({ coins: 18, arcaneEnergy: 4 }),
    greenhouse: Object.freeze({ coins: 12, arcaneEnergy: 6 })
  })
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampRate(value, fallback = ECONOMY_RULES.defaultMigrationRate) {
  const rate = finiteNumber(value, fallback);
  return Math.min(1, Math.max(0, rate));
}

export function clampOccupancy(value, fallback = ECONOMY_RULES.defaultSupportedOccupancy) {
  const occupancy = finiteNumber(value, fallback);
  return Math.min(1, Math.max(0, occupancy));
}

/** Centralized integer rounding for supported population targets. */
export function roundPopulationTarget(value) {
  const number = finiteNumber(value, 0);
  if (number <= 0) return 0;
  if (!Number.isSafeInteger(Math.round(number))) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round(number));
}

/**
 * Return the integer muggle/wizard capacity of one residential functional
 * cell. Discrete ratios make this exact rather than a floating point split.
 */
export function residentialCapacityForUnit(unit = {}) {
  if (unit.purpose !== "residential") return { muggles: 0, wizards: 0 };
  const area = Number.isSafeInteger(Number(unit.area)) && Number(unit.area) > 0 ? Number(unit.area) : 0;
  if (!area) return { muggles: 0, wizards: 0 };
  let ratio;
  try {
    ratio = normalizeMagicRatio(unit.magicRatio);
  } catch {
    return { muggles: 0, wizards: 0 };
  }
  const housing = area * ECONOMY_RULES.residentialCapacityPerCell;
  return {
    muggles: Math.round(housing * (1 - ratio)),
    wizards: Math.round(housing * ratio)
  };
}

export function capacitiesFromCanonicalUnits(units = []) {
  return units.reduce((capacity, unit) => {
    const cellCapacity = residentialCapacityForUnit(unit);
    capacity.muggles += cellCapacity.muggles;
    capacity.wizards += cellCapacity.wizards;
    return capacity;
  }, { muggles: 0, wizards: 0 });
}

function configuredOccupancy(options, bucket, capacity) {
  const configured = options.supportedOccupancy
    ?? options.supportedTargetOccupancy
    ?? options.supportedTarget;
  if (typeof configured === "function") {
    return clampOccupancy(configured({ bucket, capacity }));
  }
  if (configured && typeof configured === "object") {
    const value = configured[bucket] ?? configured.default;
    if (value != null) {
      // An injected absolute target is useful to PR D, while a fraction keeps
      // the default API compact. Values in [0, 1] are interpreted as ratios.
      if (Number(value) >= 0 && Number(value) <= 1) return clampOccupancy(value);
      return capacity > 0 ? clampOccupancy(Number(value) / capacity) : 0;
    }
  }
  if (configured != null) {
    if (Number(configured) >= 0 && Number(configured) <= 1) return clampOccupancy(configured);
    return capacity > 0 ? clampOccupancy(Number(configured) / capacity) : 0;
  }
  return ECONOMY_RULES.defaultSupportedOccupancy;
}

/** Resolve a deterministic integer supported target for one population bucket. */
export function supportedPopulationTarget(capacity, bucket, options = {}) {
  const safeCapacity = Number.isSafeInteger(Number(capacity)) && Number(capacity) > 0 ? Number(capacity) : 0;
  const explicitTargets = options.supportedTargetPopulation ?? options.targetPopulation;
  if (explicitTargets && typeof explicitTargets === "object" && explicitTargets[bucket] != null) {
    return Math.min(safeCapacity, Math.max(0, roundPopulationTarget(explicitTargets[bucket])));
  }
  const occupancy = configuredOccupancy(options, bucket, safeCapacity);
  return Math.min(safeCapacity, roundPopulationTarget(safeCapacity * occupancy));
}

/**
 * Move one integer bucket toward target. `ceil` means every non-zero gap
 * eventually closes, and the clamp prevents overshooting after a capacity
 * reduction.
 */
export function migratePopulationBucket(bucket = {}, target = 0, rate = ECONOMY_RULES.defaultMigrationRate) {
  const current = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(finiteNumber(bucket.current, 0))));
  const safeTarget = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(finiteNumber(target, 0))));
  const gap = safeTarget - current;
  if (gap === 0) return { current, capacity: Math.max(0, Math.trunc(finiteNumber(bucket.capacity, 0))) };
  const step = Math.max(1, Math.ceil(Math.abs(gap) * clampRate(rate)));
  const nextCurrent = gap > 0
    ? Math.min(safeTarget, current + step)
    : Math.max(safeTarget, current - step);
  return {
    current: Math.max(0, nextCurrent),
    capacity: Math.max(0, Math.trunc(finiteNumber(bucket.capacity, 0)))
  };
}

function canonicalUnits(metadata) {
  if (metadata?.canonical !== true || !Array.isArray(metadata.units)) return [];
  // Persisted state can predate validation or be manually corrupted. Invalid
  // units are unsupported rather than a source of guessed legacy output.
  return metadata.units.filter((unit) => {
    if (!GAMEPLAY_PURPOSES.includes(unit?.purpose)) return false;
    if (!Number.isSafeInteger(Number(unit?.area)) || Number(unit.area) < 1) return false;
    try {
      normalizeMagicRatio(unit.magicRatio);
      return true;
    } catch {
      return false;
    }
  });
}

/** Calculate this turn's canonical income from start-of-turn residents. */
export function incomeForCanonicalBuildings(metadataMap = {}, population = {}, options = {}) {
  const income = { coins: 0, arcaneEnergy: 0 };
  const muggles = Math.max(0, Math.trunc(finiteNumber(population.muggles?.current, 0)));
  const wizards = Math.max(0, Math.trunc(finiteNumber(population.wizards?.current, 0)));
  const rules = options.rules ?? ECONOMY_RULES;
  for (const metadata of Object.values(metadataMap)) {
    for (const unit of canonicalUnits(metadata)) {
      const area = Number.isSafeInteger(Number(unit.area)) && Number(unit.area) > 0 ? Number(unit.area) : 0;
      if (!GAMEPLAY_PURPOSES.includes(unit.purpose) || !area) continue;
      if (unit.purpose === "residential") {
        continue;
      }
      const output = rules.functionalOutput[unit.purpose];
      if (!output) continue;
      income.coins += area * output.coins;
      income.arcaneEnergy += area * normalizeMagicRatio(unit.magicRatio) * output.arcaneEnergy;
    }
  }
  // Population is aggregate across residential units. Capacity normalization
  // guarantees these residents are already integer and bounded.
  income.coins += (muggles + wizards) * rules.residentialCoinsPerResident;
  income.arcaneEnergy += wizards * rules.residentialArcaneEnergyPerWizard;
  // Keep coins an integer while allowing AE to accumulate as a fraction.
  income.coins = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(income.coins)));
  income.arcaneEnergy = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, income.arcaneEnergy));
  return income;
}
