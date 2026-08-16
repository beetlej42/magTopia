import { SEALED_EXPOSURE_THRESHOLD } from "./schema.js";

export const EXPOSURE_RADIUS = 2;

export function cellCoordinates(cellId) {
  const match = /^cell-(\d+)-(\d+)$/.exec(String(cellId ?? ""));
  if (!match) return null;
  return { column: Number(match[1]), row: Number(match[2]) };
}

export function manhattanDistance(cellIdA, cellIdB) {
  const a = cellCoordinates(cellIdA);
  const b = cellCoordinates(cellIdB);
  if (!a || !b) return Infinity;
  return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
}

export function cellFootprint(building) {
  const cells = building?.footprintCells?.filter(cellCoordinates) ?? [];
  return cells.length ? cells : [building?.site?.lotId ?? building?.id].filter(Boolean);
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
