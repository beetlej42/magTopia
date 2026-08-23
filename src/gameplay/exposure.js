import {
  FUNCTIONAL_TYPE_INTENSITY,
  GAMEPLAY_PURPOSES,
  MAGIC_RATIOS,
  SEALED_EXPOSURE_THRESHOLD
} from "./schema.js";

// PR-E spatial exposure is deliberately independent of districts and blocks.
// Distances are measured in city cells and the boundary is strict: a source
// farther than five cells contributes no weight at all.
export const EXPOSURE_RADIUS = 5;
export const SPATIAL_RISK_MODIFIER_MIN = 0.2;
export const SPATIAL_RISK_MODIFIER_MAX = 1;
export const BASE_RISK_BY_TIER = Object.freeze({ low: 0.02, medium: 0.05, high: 0.1 });

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function cellCoordinates(cellId, state = null) {
  const match = /^cell-(\d+)-(\d+)$/.exec(String(cellId ?? ""));
  if (!match) return null;
  return { column: Number(match[1]), row: Number(match[2]) };
}

function cellCoordinatesInState(cellId, state) {
  return cellCoordinates(cellId) ?? (() => {
    const cell = state?.cells?.[cellId]
      ?? state?.grid?.cells?.find((candidate) => candidate?.id === cellId);
    if (!cell || !Number.isFinite(Number(cell.column)) || !Number.isFinite(Number(cell.row))) return null;
    return { column: Number(cell.column), row: Number(cell.row) };
  })();
}

export function manhattanDistance(cellIdA, cellIdB) {
  const a = cellCoordinates(cellIdA);
  const b = cellCoordinates(cellIdB);
  if (!a || !b) return Infinity;
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

function manhattanDistanceInState(cellIdA, cellIdB, state) {
  const a = cellCoordinatesInState(cellIdA, state);
  const b = cellCoordinatesInState(cellIdB, state);
  if (!a || !b) return Infinity;
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

export function cellFootprint(building, state = null) {
  const cells = building?.footprintCells?.filter((cellId) => cellCoordinatesInState(cellId, state)) ?? [];
  return cells.length ? cells : [building?.site?.lotId ?? building?.id].filter(Boolean);
}

function footprintDistance(buildingA, buildingB, state) {
  const a = cellFootprint(buildingA, state);
  const b = cellFootprint(buildingB, state);
  return a.reduce((best, cellA) => b.reduce((innerBest, cellB) => Math.min(
    innerBest,
    manhattanDistanceInState(cellA, cellB, state)
  ), best), Infinity);
}

/** Distance falloff shared by every PR-E spatial calculation. */
export function spatialDistanceWeight(distance, options = {}) {
  const radius = Math.max(0, finiteNumber(options.radius, EXPOSURE_RADIUS));
  const d = finiteNumber(distance, Infinity);
  if (!Number.isFinite(d) || d > radius) return 0;
  // Linear falloff keeps the edge visible while making the source itself the
  // strongest contributor. It is intentionally a single, auditable curve.
  return Math.max(0, (radius - d + 1) / (radius + 1));
}

function canonicalMetadataFor(building, options = {}) {
  const supplied = options.metadataOf?.(building)
    ?? options.metadataByBuilding?.[building?.id]
    ?? building?.metadata
    ?? (building?.gameplay?.canonical ? building.gameplay : null);
  if (supplied?.canonical === true && Array.isArray(supplied.units)
      && supplied.units.length > 0
      && supplied.units.every((unit) => GAMEPLAY_PURPOSES.includes(unit?.purpose)
        && Number.isSafeInteger(Number(unit?.area))
        && Number(unit.area) > 0
        && MAGIC_RATIOS.some((ratio) => Math.abs(ratio - Number(unit?.magicRatio)) < Number.EPSILON * 8))) {
    return supplied;
  }
  // This adapter intentionally does not derive PR-E data from the legacy
  // category/magicLevel shape. A missing canonical contract is an explicit
  // unsupported result, rather than an implicit gameplay rule.
  return null;
}

function stateBuildings(state) {
  return Object.entries(state?.buildings ?? {}).map(([id, building]) => ({
    ...building,
    id: building?.id ?? id
  }));
}

function canonicalUnits(metadata) {
  return metadata?.canonical === true && Array.isArray(metadata?.units)
    ? metadata.units.filter((unit) => Number.isFinite(Number(unit?.area))
      && Number(unit.area) > 0
      && Number.isFinite(Number(unit?.magicRatio))
      && GAMEPLAY_PURPOSES.includes(unit?.purpose)
      && MAGIC_RATIOS.some((ratio) => Math.abs(ratio - Number(unit.magicRatio)) < Number.EPSILON * 8))
    : [];
}

export function typeIntensityForUnit(unit, options = {}) {
  const explicit = unit?.typeIntensity ?? options.typeIntensityByPurpose?.[unit?.purpose];
  if (explicit != null && Number.isFinite(Number(explicit)) && Number(explicit) >= 0) return Number(explicit);
  return FUNCTIONAL_TYPE_INTENSITY[unit?.purpose] ?? 0;
}

/**
 * Return an auditable MagicLoad decomposition for one canonical building.
 * `magicLoad` is the sum of functionalArea × discrete magicRatio × intensity;
 * no legacy metadata is accepted as an authority.
 */
export function magicLoadDetails(metadata, options = {}) {
  const units = canonicalUnits(metadata);
  const details = units.map((unit, index) => {
    const area = Number(unit.area);
    const magicRatio = Number(unit.magicRatio);
    const typeIntensity = typeIntensityForUnit(unit, options);
    return {
      unitIndex: index,
      purpose: unit.purpose,
      area,
      magicRatio,
      typeIntensity,
      magicLoad: area * magicRatio * typeIntensity,
      magicArea: area * magicRatio
    };
  });
  return {
    authoritative: Boolean(metadata?.canonical === true && Array.isArray(metadata?.units)),
    totalFunctionalArea: details.reduce((total, unit) => total + unit.area, 0),
    magicArea: details.reduce((total, unit) => total + unit.magicArea, 0),
    magicLoad: details.reduce((total, unit) => total + unit.magicLoad, 0),
    units: details
  };
}

/** Numeric convenience form used by callers that only need MagicLoad. */
export function calculateMagicLoad(metadata, options = {}) {
  return magicLoadDetails(metadata, options).magicLoad;
}

export const buildingMagicLoad = calculateMagicLoad;

function sourceArea(metadata, building, state) {
  const details = magicLoadDetails(metadata);
  // Functional areas (not footprint cells) are authoritative. A building
  // with vertical/multi-floor area still contributes exactly that area.
  if (details.totalFunctionalArea > 0) return details.totalFunctionalArea;
  // No canonical units means no PR-E spatial source. Keep the return explicit
  // so callers can include a stable zero contribution in an audit record.
  void building;
  void state;
  return 0;
}

/**
 * Compute LocalMagicRatio for a building, including the source's own area.
 * Neighbour contribution is weighted by the shortest footprint-to-footprint
 * Manhattan distance and ignored strictly beyond the fixed radius.
 */
export function calculateLocalMagicRatio(state, building, options = {}) {
  const targetMetadata = canonicalMetadataFor(building, options);
  if (!targetMetadata) return 0;
  const radius = options.radius ?? EXPOSURE_RADIUS;
  const buildings = stateBuildings(state);
  const candidates = buildings.some((candidate) => candidate?.id === building?.id)
    ? buildings
    : [building, ...buildings];
  let weightedMagicArea = 0;
  let weightedArea = 0;
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const metadata = canonicalMetadataFor(candidate, options);
    if (!metadata) continue;
    if (metadata.status === "sealed" || candidate.status === "sealed") continue;
    const area = sourceArea(metadata, candidate, state);
    if (!(area > 0)) continue;
    const distance = footprintDistance(building, candidate, state);
    const weight = spatialDistanceWeight(distance, { radius });
    if (!(weight > 0)) continue;
    const magicArea = magicLoadDetails(metadata).magicArea;
    weightedArea += weight * area;
    weightedMagicArea += weight * magicArea;
  }
  return weightedArea > 0 ? weightedMagicArea / weightedArea : 0;
}

export const localMagicRatio = calculateLocalMagicRatio;

function riskTierForLoad(details) {
  if (!(details.magicLoad > 0)) return "none";
  const density = details.magicLoad / Math.max(1, details.totalFunctionalArea);
  if (density >= 3) return "high";
  if (density >= 1.5) return "medium";
  return "low";
}

export function baseRiskForMagicLoad(details) {
  const tier = riskTierForLoad(details);
  return BASE_RISK_BY_TIER[tier] ?? 0;
}

export function spatialRiskModifier(localRatio) {
  const ratio = Math.max(0, Math.min(1, finiteNumber(localRatio)));
  // Anchors: 20% => .3, 40% => .5, 60% => .7, 80% => .9, 100% => 1.
  return Math.max(SPATIAL_RISK_MODIFIER_MIN, Math.min(SPATIAL_RISK_MODIFIER_MAX, 0.1 + ratio));
}

function contributionDetails(state, building, options = {}) {
  const radius = options.radius ?? EXPOSURE_RADIUS;
  const entries = [];
  const buildings = stateBuildings(state);
  const candidates = buildings.some((candidate) => candidate.id === building?.id)
    ? buildings
    : [building, ...buildings];
  for (const candidate of candidates) {
    const metadata = canonicalMetadataFor(candidate, options);
    if (!metadata || metadata.status === "sealed" || candidate.status === "sealed") continue;
    const area = sourceArea(metadata, candidate, state);
    if (!(area > 0)) continue;
    const distance = footprintDistance(building, candidate, state);
    const weight = spatialDistanceWeight(distance, { radius });
    if (!(weight > 0)) continue;
    const details = magicLoadDetails(metadata);
    entries.push({
      buildingId: String(candidate.id),
      distance,
      weight,
      area,
      magicArea: details.magicArea,
      weightedArea: weight * area,
      weightedMagicArea: weight * details.magicArea
    });
  }
  return entries.sort((a, b) => a.buildingId.localeCompare(b.buildingId));
}

/**
 * Stable, explainable PR-E inspection result. It is safe for APIs to expose
 * directly: all numbers are deterministic and contributions are sorted by id.
 */
export function inspectBuildingRisk(state, buildingOrId, options = {}) {
  const building = typeof buildingOrId === "string" ? state?.buildings?.[buildingOrId] : buildingOrId;
  const buildingId = String(building?.id ?? buildingOrId ?? "");
  const metadata = canonicalMetadataFor(building, options);
  const details = magicLoadDetails(metadata);
  const contributions = metadata ? contributionDetails(state, building, options) : [];
  const weightedArea = contributions.reduce((total, entry) => total + entry.weightedArea, 0);
  const weightedMagicArea = contributions.reduce((total, entry) => total + entry.weightedMagicArea, 0);
  const localRatio = weightedArea > 0 ? weightedMagicArea / weightedArea : 0;
  const tier = riskTierForLoad(details);
  const baseRisk = baseRiskForMagicLoad(details);
  const modifier = spatialRiskModifier(localRatio);
  return {
    buildingId,
    authoritative: Boolean(metadata),
    status: metadata ? "ok" : "UNSUPPORTED_LEGACY_METADATA",
    radius: options.radius ?? EXPOSURE_RADIUS,
    magicLoad: details.magicLoad,
    magicLoadBreakdown: details.units,
    totalFunctionalArea: details.totalFunctionalArea,
    magicArea: details.magicArea,
    riskTier: tier,
    baseRisk,
    baseRiskPercent: baseRisk * 100,
    localMagicRatio: localRatio,
    spatialModifier: modifier,
    finalIncidentChance: baseRisk * modifier,
    finalIncidentChancePercent: baseRisk * modifier * 100,
    weightedArea,
    weightedMagicArea,
    contributions
  };
}

export const inspectRisk = inspectBuildingRisk;
export const riskInspection = inspectBuildingRisk;

export function inspectSpatialExposure(state, options = {}) {
  return stateBuildings(state)
    .map((building) => inspectBuildingRisk(state, building, options))
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
}

export function buildingsWithinRadius(state, building, options = {}) {
  const radius = options.radius ?? EXPOSURE_RADIUS;
  const footprint = cellFootprint(building);
  const others = Object.values(state?.buildings ?? {}).filter((candidate) => candidate.id !== building.id);
  return others.filter((candidate) => {
    const candidateCells = cellFootprint(candidate);
    return candidateCells.some((candidateCell) => footprint.some((ownCell) => manhattanDistance(ownCell, candidateCell) <= radius));
  });
}

export function concealmentOf(building, metadata = null) {
  const concealment = metadata?.concealment ?? building?.metadata?.concealment ?? building?.attributes?.concealment ?? 0;
  return Math.max(0, Number(concealment) || 0);
}

export function neighborhoodConcealment(state, building, options = {}) {
  const radius = options.radius ?? EXPOSURE_RADIUS;
  const falloff = options.falloff ?? 0.5;
  const metadataOf = options.metadataOf ?? (() => null);
  const neighbors = buildingsWithinRadius(state, building, { radius });
  let total = 0;
  for (const neighbor of neighbors) {
    const metadata = metadataOf(neighbor);
    if (metadata?.status === "sealed") continue;
    const distance = cellFootprint(neighbor)
      .map((cellId) => Math.min(...cellFootprint(building).map((ownCell) => manhattanDistance(ownCell, cellId))))
      .reduce((best, candidate) => Math.min(best, candidate), Infinity);
    if (!Number.isFinite(distance)) continue;
    total += concealmentOf(neighbor, metadata) * falloff ** Math.max(0, distance - 1);
  }
  return total;
}

export function exposurePressure(metadata, concealment, options = {}) {
  const magicLevel = Number(metadata?.magicLevel ?? 0);
  const activity = Number(metadata?.activity ?? 0);
  const visibility = Number(metadata?.visibility ?? options.visibility ?? 0.5);
  const modifier = Number(options.modifier ?? 0);
  return magicLevel * activity * visibility - concealment + modifier;
}

export function exposureDelta(pressure, options = {}) {
  const growth = options.growth ?? 1;
  const recovery = options.recovery ?? 0.5;
  return pressure >= 0 ? Math.ceil(pressure * growth) : Math.round(pressure * recovery);
}

export function applyExposureChange(current, delta) {
  return Math.min(SEALED_EXPOSURE_THRESHOLD, Math.max(0, current + delta));
}

export function isSealedExposure(exposure) {
  return exposure >= SEALED_EXPOSURE_THRESHOLD;
}

export function incidentCandidateThreshold() {
  return SEALED_EXPOSURE_THRESHOLD / 2;
}

export function incidentProbability(exposure, threshold = incidentCandidateThreshold()) {
  if (exposure <= threshold) return 0;
  const range = SEALED_EXPOSURE_THRESHOLD - threshold;
  return Math.min(0.9, 0.15 + (exposure - threshold) / range * 0.6);
}

export function incidentSeverity(exposure) {
  const threshold = incidentCandidateThreshold();
  const range = SEALED_EXPOSURE_THRESHOLD - threshold;
  const normalized = Math.max(0, Math.min(1, (exposure - threshold) / range));
  return 1 + Math.round(normalized * 4);
}

export function incidentDifficulty(severity, options = {}) {
  return Math.max(1, Math.min(10, Math.round(severity + (options.base ?? 2))));
}

export function incidentSummary(type, buildingName) {
  const name = String(buildingName ?? "a building");
  switch (type) {
    case "investigation": return `Unresolved magical anomaly reported near ${name}; origin requires investigation.`;
    case "containment": return `Uncontrolled magical activity detected at ${name}; requires containment.`;
    case "concealment": return `Ordinary citizens noticed unusual events around ${name}; needs concealment work.`;
    default: return `Magic-related incident reported around ${name}.`;
  }
}
