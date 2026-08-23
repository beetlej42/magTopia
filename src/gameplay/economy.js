import { GAMEPLAY_PURPOSES, normalizeMagicRatio } from "./schema.js";
import { getCard } from "./card-catalog.js";

export class EconomyDataError extends Error {
  constructor(message, code = "INVALID_ECONOMY_DATA") {
    super(message);
    this.name = "EconomyDataError";
    this.code = code;
  }
}

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

// These are the only special-structure effects that participate in the PR-C
// economy. Values come from the system-owned card catalog; a building or
// Agent cannot author an arbitrary effect by copying old metadata fields.
const SYSTEM_OWNED_ECONOMY_CARDS = Object.freeze(new Set([
  "owl-tower",
  "floo-fireplace-station",
  "moonlight-herb-plot"
]));

export function systemOwnedBonusForBuilding(building = {}) {
  const cardId = building?.specialStructure?.cardId;
  if (!SYSTEM_OWNED_ECONOMY_CARDS.has(cardId) || building.status !== "completed") {
    return null;
  }
  const definition = getCard(cardId);
  const catalogEffect = definition?.effect ?? {};
  const persistedEffect = building.specialStructure?.effect ?? {};
  if (cardId === "owl-tower") {
    return { coins: Number(catalogEffect.coinOutput), arcaneEnergy: 0, wizardCapacity: Number(catalogEffect.wizardCapacity) };
  }
  if (cardId === "floo-fireplace-station") {
    return { coins: Number(catalogEffect.coinOutput), arcaneEnergy: 0, wizardCapacity: Number(catalogEffect.wizardCapacity) };
  }
  // `magicOutput` is accepted only for an already-persisted Moonlight card;
  // new catalog/persisted effects use arcaneEnergyOutput. The card id remains
  // the authority, so unrelated legacy metadata cannot create income.
  const arcaneEnergy = persistedEffect.arcaneEnergyOutput ?? persistedEffect.magicOutput ?? catalogEffect.arcaneEnergyOutput;
  return { coins: 0, arcaneEnergy: Number(arcaneEnergy), wizardCapacity: 0 };
}

function systemOwnedBonusForMetadata(metadata = {}) {
  const cardId = metadata.systemOwnedCardId;
  if (!SYSTEM_OWNED_ECONOMY_CARDS.has(cardId) || metadata.status !== "completed") return null;
  const effect = getCard(cardId)?.effect ?? {};
  if (cardId === "moonlight-herb-plot") return metadata.systemOwnedBonus ?? { coins: 0, arcaneEnergy: Number(effect.arcaneEnergyOutput), wizardCapacity: 0 };
  return {
    coins: Number(effect.coinOutput),
    arcaneEnergy: 0,
    wizardCapacity: Number(effect.wizardCapacity)
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function checkedNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new EconomyDataError(`${label} must be a non-negative safe integer`);
  }
  return number;
}

function checkedAdd(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new EconomyDataError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function checkedMultiply(left, right, label) {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new EconomyDataError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function checkedArcane(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
    throw new EconomyDataError(`${label} must be finite and within the safe range`);
  }
  return number;
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
  if (!Number.isSafeInteger(Math.round(number))) throw new EconomyDataError("population target exceeds the safe integer range");
  return Math.max(0, Math.round(number));
}

/**
 * Return the integer muggle/wizard capacity of one residential functional
 * cell. Discrete ratios make this exact rather than a floating point split.
 */
export function residentialCapacityForUnit(unit = {}) {
  if (unit.purpose !== "residential") return { muggles: 0, wizards: 0 };
  const area = checkedNonNegativeInteger(unit.area, "residential functional area");
  if (area < 1) throw new EconomyDataError("residential functional area must be positive");
  let ratio;
  try {
    ratio = normalizeMagicRatio(unit.magicRatio);
  } catch {
    throw new EconomyDataError("residential magicRatio is invalid");
  }
  const housing = checkedMultiply(area, ECONOMY_RULES.residentialCapacityPerCell, "residential capacity");
  return {
    muggles: Math.round(housing * (1 - ratio)),
    wizards: Math.round(housing * ratio)
  };
}

export function capacitiesFromCanonicalUnits(units = []) {
  return units.reduce((capacity, unit) => {
    const cellCapacity = residentialCapacityForUnit(unit);
    capacity.muggles = checkedAdd(capacity.muggles, cellCapacity.muggles, "muggle capacity");
    capacity.wizards = checkedAdd(capacity.wizards, cellCapacity.wizards, "wizard capacity");
    return capacity;
  }, { muggles: 0, wizards: 0 });
}

export function capacitiesFromSettlementMetadata(metadataMap = {}) {
  const capacities = Object.values(metadataMap).reduce((capacity, metadata) => {
    if (metadata?.canonical === true && (metadata.status == null || metadata.status === "completed") && metadata.status !== "sealed") {
      const current = capacitiesFromCanonicalUnits(metadata.units);
      capacity.muggles = checkedAdd(capacity.muggles, current.muggles, "muggle capacity");
      capacity.wizards = checkedAdd(capacity.wizards, current.wizards, "wizard capacity");
    }
    const systemBonus = systemOwnedBonusForMetadata(metadata);
    if (systemBonus) {
      const bonus = checkedNonNegativeInteger(systemBonus.wizardCapacity ?? 0, "system wizard capacity");
      capacity.wizards = checkedAdd(capacity.wizards, bonus, "wizard capacity");
    }
    return capacity;
  }, { muggles: 0, wizards: 0 });
  return capacities;
}

function configuredOccupancy(options, capacities) {
  const configured = options.supportedOccupancy ?? options.supportedTargetOccupancy ?? options.supportedTarget;
  if (typeof configured === "function") {
    return clampOccupancy(configured({ capacities, totalCapacity: capacities.muggles + capacities.wizards }));
  }
  if (configured && typeof configured === "object") return clampOccupancy(configured.total ?? configured.default ?? ECONOMY_RULES.defaultSupportedOccupancy);
  if (configured != null) return clampOccupancy(configured);
  return ECONOMY_RULES.defaultSupportedOccupancy;
}

function allocateTargetByCapacity(totalTarget, capacities) {
  const totalCapacity = checkedAdd(capacities.muggles, capacities.wizards, "housing capacity");
  const target = Math.min(totalCapacity, checkedNonNegativeInteger(totalTarget, "supported population target"));
  if (totalCapacity === 0 || target === 0) return { muggles: 0, wizards: 0, total: target };
  const buckets = [
    { key: "muggles", capacity: capacities.muggles, priority: 0 },
    { key: "wizards", capacity: capacities.wizards, priority: 1 }
  ];
  const allocations = Object.fromEntries(buckets.map(({ key, capacity }) => [key, Math.floor(target * capacity / totalCapacity)]));
  let remaining = target - allocations.muggles - allocations.wizards;
  const ranked = buckets.map((bucket) => ({
    ...bucket,
    remainder: target * bucket.capacity / totalCapacity - allocations[bucket.key]
  })).sort((a, b) => b.remainder - a.remainder || a.priority - b.priority);
  for (const bucket of ranked) {
    if (remaining <= 0) break;
    if (allocations[bucket.key] < bucket.capacity) {
      allocations[bucket.key] += 1;
      remaining -= 1;
    }
  }
  return { ...allocations, total: target };
}

/**
 * Jointly calculate supported targets. The default first rounds one total
 * target, then uses largest remainder proportional allocation; ties prefer
 * muggles, then wizards. Explicit bucket targets are an absolute PR-D hook,
 * clamped per bucket and proportionally reduced if their sum exceeds housing.
 */
export function supportedPopulationTargets(capacities = {}, options = {}) {
  const safeCapacities = {
    muggles: checkedNonNegativeInteger(capacities.muggles ?? 0, "muggle capacity"),
    wizards: checkedNonNegativeInteger(capacities.wizards ?? 0, "wizard capacity")
  };
  const totalCapacity = checkedAdd(safeCapacities.muggles, safeCapacities.wizards, "housing capacity");
  const explicit = options.supportedTargetPopulation ?? options.targetPopulation;
  if (explicit && typeof explicit === "object" && (explicit.muggles != null || explicit.wizards != null)) {
    const requested = {
      muggles: Math.min(safeCapacities.muggles, checkedNonNegativeInteger(explicit.muggles ?? 0, "muggle target")),
      wizards: Math.min(safeCapacities.wizards, checkedNonNegativeInteger(explicit.wizards ?? 0, "wizard target"))
    };
    const sum = checkedAdd(requested.muggles, requested.wizards, "supported population target");
    if (sum <= totalCapacity) return { ...requested, total: sum, source: "explicit_absolute" };
    return { ...allocateTargetByCapacity(totalCapacity, requested), source: "explicit_absolute_clamped" };
  }
  const occupancy = configuredOccupancy(options, safeCapacities);
  const totalTarget = roundPopulationTarget(totalCapacity * occupancy);
  return { ...allocateTargetByCapacity(totalTarget, safeCapacities), source: "occupancy" };
}

/** Backward-compatible single-bucket view; settlement uses the joint API. */
export function supportedPopulationTarget(capacity, bucket, options = {}) {
  const capacities = bucket === "muggles" ? { muggles: capacity, wizards: 0 } : { muggles: 0, wizards: capacity };
  return supportedPopulationTargets(capacities, options)[bucket];
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
  const normalizedRate = clampRate(rate);
  if (normalizedRate === 0) return { current, capacity: Math.max(0, Math.trunc(finiteNumber(bucket.capacity, 0))) };
  const step = Math.max(1, Math.ceil(Math.abs(gap) * normalizedRate));
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
  if (metadata.status != null && metadata.status !== "completed") return [];
  // Persisted state can predate validation or be manually corrupted. Invalid
  // canonical units reject settlement rather than becoming guessed output.
  return metadata.units.filter((unit) => {
    if (!GAMEPLAY_PURPOSES.includes(unit?.purpose)) throw new EconomyDataError("canonical functional purpose is invalid");
    if (!Number.isSafeInteger(Number(unit?.area)) || Number(unit.area) < 1) throw new EconomyDataError("canonical functional area is not a safe positive integer");
    try {
      normalizeMagicRatio(unit.magicRatio);
      return true;
    } catch {
      throw new EconomyDataError("canonical magicRatio is invalid");
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
      const area = checkedNonNegativeInteger(unit.area, "functional area");
      if (unit.purpose === "residential") {
        continue;
      }
      const output = rules.functionalOutput[unit.purpose];
      if (!output) continue;
      income.coins = checkedAdd(income.coins, checkedMultiply(area, output.coins, `${unit.purpose} coin output`), "coin income");
      const arcane = checkedArcane(area * normalizeMagicRatio(unit.magicRatio) * output.arcaneEnergy, `${unit.purpose} arcane output`);
      income.arcaneEnergy = checkedArcane(income.arcaneEnergy + arcane, "arcane income");
    }
  }
  // Population is aggregate across residential units. Capacity normalization
  // guarantees these residents are already integer and bounded.
  const residents = checkedAdd(checkedNonNegativeInteger(muggles, "muggle population"), checkedNonNegativeInteger(wizards, "wizard population"), "resident population");
  income.coins = checkedAdd(income.coins, checkedMultiply(residents, rules.residentialCoinsPerResident, "residential tax"), "coin income");
  income.arcaneEnergy = checkedArcane(income.arcaneEnergy + checkedArcane(wizards * rules.residentialArcaneEnergyPerWizard, "residential arcane output"), "arcane income");
  return income;
}

/** Shared settlement/preview aggregation, including whitelisted system cards. */
export function incomeForSettlement(metadataMap = {}, population = {}, options = {}) {
  const income = incomeForCanonicalBuildings(metadataMap, population, options);
  for (const metadata of Object.values(metadataMap)) {
    const systemBonus = systemOwnedBonusForMetadata(metadata);
    if (!systemBonus) continue;
    const coins = checkedNonNegativeInteger(systemBonus.coins ?? 0, "system coin output");
    const arcaneEnergy = checkedArcane(systemBonus.arcaneEnergy ?? 0, "system arcane output");
    income.coins = checkedAdd(income.coins, coins, "coin income");
    income.arcaneEnergy = checkedArcane(income.arcaneEnergy + arcaneEnergy, "arcane income");
  }
  return income;
}
