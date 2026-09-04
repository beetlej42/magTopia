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

export const HEIGHT_MULTIPLIER_STEP = 0.05;

export function constructionPriceGuide() {
  return {
    currency: "coins",
    authority: "estimate_only; the confirmed-design construction preview is the exact quote",
    building_rate_per_footprint_cell_per_floor: { ...BUILDING_COST_BY_PURPOSE },
    ordinary_residential_examples: {
      "1x1_one_floor": BUILDING_COST_BY_PURPOSE.residential,
      "1x1_two_floors": roundCoins(BUILDING_COST_BY_PURPOSE.residential * 2 * ordinaryResidentialHeightMultiplier(2)),
      "2x2_two_floors": roundCoins(BUILDING_COST_BY_PURPOSE.residential * 8 * ordinaryResidentialHeightMultiplier(2))
    },
    road_rate_per_cell: ROAD_COST_BY_KIND.standard,
    bridge_rate_per_cell: ROAD_COST_BY_KIND.bridge,
    note: "Footprint and floor count come from the confirmed BuildingDesign; Agents never submit functional area."
  };
}

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
 * multiplier. Floors are a safe positive integer; the design's formula is
 * intentionally allowed to continue beyond the examples in the document.
 */
export function ordinaryResidentialHeightMultiplier(floors) {
  const count = integer(floors, "ordinary residential floor count");
  const multiplier = 1 + HEIGHT_MULTIPLIER_STEP * (count - 1);
  if (!Number.isFinite(multiplier)) throw new Error("ordinary residential height multiplier is not finite");
  return Number(multiplier.toFixed(2));
}

export const heightMultiplierForFloors = ordinaryResidentialHeightMultiplier;

function roundCoins(value) {
  // Construction money is an integer ledger. All rounding happens once at
  // the final building total, using the same nearest-coin rule every time.
  return Math.round(value);
}

function isOrdinaryResidentialFloorGrammar(metadata) {
  const facts = metadata?.pricingFacts;
  if (!metadata?.units?.length) return false;
  return Number.isSafeInteger(facts?.effectiveFloorCount)
    && facts.effectiveFloorCount > 0
    && metadata.units.every((unit) => unit.purpose === "residential");
}

function canonicalCostBreakdown(metadata) {
  const eligibleForHeight = isOrdinaryResidentialFloorGrammar(metadata);
  const floors = eligibleForHeight
    ? metadata.pricingFacts.effectiveFloorCount
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
 * deriveGameplayBuilding. Normalized metadata is trusted only when the
 * caller explicitly opts in; HTTP/request-shaped objects are always
 * re-normalized from their selected grammar so canonical/pricingFacts cannot
 * be forged. Invalid canonical input throws. Legacy category pricing is
 * available only through an explicit opt-in.
 */
export function calculateBuildingConstructionCost(building, options = {}) {
  const metadata = options.trustedMetadata === true
    && building?.canonical && building?.units && building?.functionalAreas
    ? building
    : deriveGameplayBuilding(building, options);
  if (!metadata?.canonical || !Array.isArray(metadata.units)) {
    if (options.allowLegacy === true) return legacyBuildingConstructionCost(building);
    throw new Error("Canonical GameplayBuilding functional units are required for v0.3 construction cost");
  }
  const result = canonicalCostBreakdown(metadata);
  const unrounded = result.breakdown.reduce((total, entry) => total + entry.cost, 0);
  const coins = roundConstructionCoins(unrounded);
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
  const coins = roundConstructionCoins(road * ROAD_COST_BY_KIND.standard + bridge * ROAD_COST_BY_KIND.bridge);
  return {
    coins,
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
  const rounded = roundCoins(Number(value));
  if (!Number.isSafeInteger(rounded)) throw new Error(`Construction cost exceeds the safe integer coin ledger; received ${String(value)}`);
  return rounded;
}
