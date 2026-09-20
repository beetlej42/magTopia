export const DEFAULT_CONSTRUCTION_DATUM = Object.freeze({
  roadSurfaceVoxelY: -1,
  buildingBaseVoxelY: 0,
  finishedConstructionHeightWorld: -0.0625
});

const GRADED_INFRASTRUCTURE = Object.freeze({
  road: "roads",
  railway: "railways",
  railway_station: "stations",
  station_plaza: "plazas"
});

export function resolveConstructionDatum(stateOrWorld = {}) {
  const world = stateOrWorld.world ?? stateOrWorld;
  const datum = world?.constructionDatum ?? {};
  return {
    roadSurfaceVoxelY: finiteNumber(datum.roadSurfaceVoxelY, DEFAULT_CONSTRUCTION_DATUM.roadSurfaceVoxelY),
    buildingBaseVoxelY: finiteNumber(datum.buildingBaseVoxelY, DEFAULT_CONSTRUCTION_DATUM.buildingBaseVoxelY),
    finishedConstructionHeightWorld: finiteNumber(
      datum.finishedConstructionHeightWorld,
      DEFAULT_CONSTRUCTION_DATUM.finishedConstructionHeightWorld
    )
  };
}

export function deriveRuntimeConstructionGrade(state = {}) {
  const cells = state.cells ?? {};
  const categories = {
    buildings: new Set(),
    roads: new Set(),
    railways: new Set(),
    stations: new Set(),
    plazas: new Set()
  };
  const cellIds = new Set();
  const excludedWaterCellIds = new Set();

  const add = (category, cellId) => {
    const cell = cells[cellId];
    if (!cell) return;
    if (isWaterCell(cell) || state.infrastructure?.[cellId]?.type === "bridge") {
      excludedWaterCellIds.add(cellId);
      return;
    }
    categories[category].add(cellId);
    cellIds.add(cellId);
  };

  Object.values(state.buildings ?? {}).forEach((building) => {
    const footprint = building.footprintCells?.length
      ? building.footprintCells
      : [building.site?.lotId].filter(Boolean);
    footprint.forEach((cellId) => add("buildings", cellId));
  });

  Object.values(cells).forEach((cell) => {
    const category = GRADED_INFRASTRUCTURE[cell.infrastructure];
    if (category) add(category, cell.id);
  });
  Object.entries(state.infrastructure ?? {}).forEach(([cellId, infrastructure]) => {
    if (infrastructure?.type === "bridge") excludedWaterCellIds.add(cellId);
  });

  return {
    cellIds,
    categories,
    excludedWaterCellIds,
    datum: resolveConstructionDatum(state)
  };
}

export function createRuntimeConstructionHeightSampler(state, grid, options = {}) {
  const naturalDatum = finiteNumber(options.naturalDatum, DEFAULT_CONSTRUCTION_DATUM.finishedConstructionHeightWorld);
  const voxelSize = finiteNumber(options.voxelSize, 0.125);
  const gradeConstruction = options.gradeConstruction !== false;
  const byCoordinate = new Map(grid.cells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const constructionGrade = deriveRuntimeConstructionGrade(state);
  return (x, z) => {
    const column = Math.floor((x + grid.columns * grid.cellWorldSize / 2) / grid.cellWorldSize);
    const row = Math.floor((grid.rows * grid.cellWorldSize / 2 - z) / grid.cellWorldSize);
    const cell = byCoordinate.get(`${column}:${row}`);
    if (!cell) return naturalDatum;
    if (gradeConstruction && constructionGrade.cellIds.has(cell.id)) {
      return constructionGrade.datum.finishedConstructionHeightWorld;
    }
    return naturalDatum + Number(cell.surface?.maxElevationVoxels ?? 0) * voxelSize;
  };
}

function isWaterCell(cell) {
  return cell?.surface?.kind === "water"
    || cell?.ground === "water"
    || Number(cell?.surface?.waterVoxels ?? 0) > 0;
}

function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
