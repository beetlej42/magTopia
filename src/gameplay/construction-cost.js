import { GAMEPLAY_PURPOSES } from "./schema.js";
import { deriveGameplayBuilding } from "./building-metadata.js";

/**
 * The v0.3 construction ledger is deliberately small and centrally owned.
 * Rates are coins per canonical functional cell; they must not be inferred
 * from an archetype, renderer asset, or the building's prose name.
 */
export const BUILDING_COST_BY_PURPOSE = Object.freeze({
  residential: 50,
  commercial: 60,
  public_service: 70,
  production: 80,
  greenhouse: 90
});

export const ROAD_COST_BY_KIND = Object.freeze({
  standard: 2,
  bridge: 15
});

export const MAX_ORDINARY_RESIDENTIAL_FLOORS = 20;
export const HEIGHT_MULTIPLIER_STEP = 0.05;

function integer(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}; received ${String(value)}`);
  }
  return number;
}

/**
 * Height pricing applies only to an ordinary, all-residential floor grammar.
 * Public/mass grammar and mixed-purpose units intentionally do not use this
 * multiplier. The 20-floor upper bound is an explicit v0.3 pricing boundary,
 * rather than an accidental extrapolation of a visual building height.
 */
export function ordinaryResidentialHeightMultiplier(floors) {
  const count = integer(floors, "ordinary residential floor count", {
    max: MAX_ORDINARY_RESIDENTIAL_FLOORS
  });
  return Number((1 + HEIGHT_MULTIPLIER_STEP * (count - 1)).toFixed(2));
}

export const heightMultiplierForFloors = ordinaryResidentialHeightMultiplier;

function roundCoins(value) {
  // Construction money is an integer ledger. All rounding happens once at
  // the final building total, using the same nearest-coin rule every time.
  return Math.round(value);
}

function canonicalGrammar(value, options = {}) {
  if (!value || typeof value !== "object") return null;
  const candidates = [options.gameplayBuilding, value, value.gameplayBuilding, value.gameplay, value.program?.gameplay,
    value.grammar, value.massing];
  return candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return ["floors", "floorSpecs", "floorPrograms", "units", "functionalUnits", "masses", "massSpecs"]
      .some((field) => Array.isArray(candidate[field]));
  }) ?? null;
}

function isOrdinaryResidentialFloorGrammar(building, metadata, options = {}) {
  const grammar = canonicalGrammar(building, options);
  if (!grammar || !metadata?.units?.length) return false;
  const hasFloors = ["floors", "floorSpecs", "floorPrograms"].some((field) => Array.isArray(grammar[field]));
  if (!hasFloors || ["masses", "massSpecs"].some((field) => Array.isArray(grammar[field]))) return false;
  return metadata.units.every((unit) => unit.purpose === "residential");
}

function canonicalCostBreakdown(metadata, building, options = {}) {
  const eligibleForHeight = isOrdinaryResidentialFloorGrammar(building, metadata, options);
  const floors = eligibleForHeight
    ? ["floors", "floorSpecs", "floorPrograms"].map((field) => canonicalGrammar(building, options)?.[field]).find(Array.isArray)?.length
    : null;
  const heightMultiplier = eligibleForHeight ? ordinaryResidentialHeightMultiplier(floors) : 1;
  const breakdown = metadata.units.map((unit, index) => ({
    unitIndex: index,
    purpose: unit.purpose,
    area: unit.area,
    magicRatio: unit.magicRatio,
    baseRate: BUILDING_COST_BY_PURPOSE[unit.purpose],
    heightMultiplier: eligibleForHeight ? heightMultiplier : 1,
    cost: unit.area * BUILDING_COST_BY_PURPOSE[unit.purpose] * (eligibleForHeight ? heightMultiplier : 1)
  }));
  return {
    breakdown,
    functionalAreas: { ...metadata.functionalAreas },
    heightMultiplier,
    heightFloors: floors,
    heightPricingApplied: eligibleForHeight
  };
}

/**
 * Calculate the authoritative v0.3 cost for a canonical GameplayBuilding.
 * `building` may be a raw canonical grammar or the metadata returned by
 * deriveGameplayBuilding. Invalid canonical input throws; it never falls
 * through to the legacy category formula.
 */
export function calculateBuildingConstructionCost(building, options = {}) {
  const metadata = building?.canonical && building?.units && building?.functionalAreas
    ? building
    : deriveGameplayBuilding(building, options);
  if (!metadata?.canonical || !Array.isArray(metadata.units)) {
    if (options.allowLegacy === false) throw new Error("Canonical GameplayBuilding functional units are required for v0.3 construction cost");
    return legacyBuildingConstructionCost(building);
  }
  const result = canonicalCostBreakdown(metadata, building, options);
  const coins = roundCoins(result.breakdown.reduce((total, entry) => total + entry.cost, 0));
  return {
    coins,
    source: "canonical_functional_units",
    rounding: "nearest_coin_at_building_total",
    ...result
  };
}

export const constructionCostForBuilding = calculateBuildingConstructionCost;

/**
 * Compatibility adapter for pre-v0.3 proposals. It remains available only
 * for callers that have not supplied canonical functional units and is
 * explicitly labelled so it cannot be mistaken for the v0.3 authority.
 */
export function legacyBuildingConstructionCost(building = {}) {
  const footprint = String(building.site?.footprint ?? building.program?.footprint ?? "1x1");
  const match = /^(\d+)x(\d+)$/.exec(footprint);
  const area = match ? Number(match[1]) * Number(match[2]) : (building.footprintCells?.length || 1);
  const archetype = String(building.program?.archetype ?? building.archetype ?? "").toLowerCase();
  const landmark = /station|hall|library|academy/.test(archetype);
  const coins = area * (landmark ? 90 : 45);
  return {
    coins,
    source: "legacy_category_adapter",
    rounding: "integer_legacy_adapter",
    breakdown: [{ purpose: null, area, baseRate: landmark ? 90 : 45, heightMultiplier: 1, cost: coins }],
    functionalAreas: Object.fromEntries(GAMEPLAY_PURPOSES.map((purpose) => [purpose, 0])),
    heightMultiplier: 1,
    heightFloors: null,
    heightPricingApplied: false
  };
}

export function calculateRoadCost({ roadCells = 0, bridgeCells = 0 } = {}) {
  const road = integer(roadCells, "road cell count", { min: 0 });
  const bridge = integer(bridgeCells, "bridge cell count", { min: 0 });
  return {
    coins: road * ROAD_COST_BY_KIND.standard + bridge * ROAD_COST_BY_KIND.bridge,
    source: "canonical_road_rates",
    roadCells: road,
    bridgeCells: bridge,
    breakdown: [
      { kind: "standard", cells: road, rate: ROAD_COST_BY_KIND.standard, cost: road * ROAD_COST_BY_KIND.standard },
      { kind: "bridge", cells: bridge, rate: ROAD_COST_BY_KIND.bridge, cost: bridge * ROAD_COST_BY_KIND.bridge }
    ]
  };
}

export function roundConstructionCoins(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`Construction coin value must be a finite non-negative number; received ${String(value)}`);
  return roundCoins(Number(value));
}
