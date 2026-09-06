const STATION_WIDTH_CELLS = 6;
const STATION_DEPTH_CELLS = 3;
const FORECOURT_DEPTH_CELLS = 3;

export const RAILWAY_GATEWAY_VERSION = "railway-gateway@1";
export const RAILWAY_STATION_LEVELS = Object.freeze({
  1: Object.freeze({ name: "Wayside Station", upgradeCost: 0 }),
  2: Object.freeze({ name: "Metropolitan Station", upgradeCost: 480 }),
  3: Object.freeze({ name: "Grand Railway Station", upgradeCost: 960 })
});

export function planRailwayGateway(worldContract = {}) {
  const columns = Number(worldContract.grid?.columns ?? 50);
  const rows = Number(worldContract.grid?.rows ?? 50);
  const cells = worldContract.grid?.cells ?? [];
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const centerColumn = Math.floor(columns / 2);
  const targetTrackRow = clampInteger(Math.round(rows * 0.12), 1, rows - 8);
  const startColumn = clampInteger(centerColumn - Math.floor(STATION_WIDTH_CELLS / 2), 0, columns - STATION_WIDTH_CELLS);
  const candidateRows = Array.from({ length: Math.max(1, rows - 7) }, (_, row) => row + 1)
    .sort((left, right) => Math.abs(left - targetTrackRow) - Math.abs(right - targetTrackRow) || left - right);
  const trackRow = candidateRows.find((row) => gatewaySiteIsDry(byId, startColumn, row)) ?? targetTrackRow;
  const stationCellIds = rectangleIds(startColumn, trackRow + 1, STATION_WIDTH_CELLS, STATION_DEPTH_CELLS)
    .filter((id) => byId.has(id));
  const forecourtCellIds = rectangleIds(startColumn, trackRow + 1 + STATION_DEPTH_CELLS, STATION_WIDTH_CELLS, FORECOURT_DEPTH_CELLS)
    .filter((id) => byId.has(id));
  const axisColumn = startColumn + Math.floor(STATION_WIDTH_CELLS / 2);
  const urbanCellId = `cell-${axisColumn}-${trackRow + STATION_DEPTH_CELLS + FORECOURT_DEPTH_CELLS}`;
  const leftForecourtCellIds = forecourtCellIds.filter((id) => byId.get(id)?.column < axisColumn);
  const rightForecourtCellIds = forecourtCellIds.filter((id) => byId.get(id)?.column > axisColumn);
  const trackCellIds = cells.filter((cell) => cell.row === trackRow).map((cell) => cell.id);

  return {
    version: RAILWAY_GATEWAY_VERSION,
    orientation: "east_west",
    citySide: "south",
    urbanDirection: "south",
    trackRow,
    trackCellIds,
    station: {
      level: 1,
      maxLevel: 3,
      footprint: `${STATION_WIDTH_CELLS}x${STATION_DEPTH_CELLS}`,
      startColumn,
      startRow: trackRow + 1,
      cellIds: stationCellIds
    },
    forecourt: {
      depthCells: FORECOURT_DEPTH_CELLS,
      cellIds: forecourtCellIds,
      leftCellIds: leftForecourtCellIds,
      rightCellIds: rightForecourtCellIds
    },
    urbanConnectionPoint: {
      nodeId: "old_town_entry",
      cellId: byId.has(urbanCellId) ? urbanCellId : forecourtCellIds.at(-1),
      direction: "south"
    },
    train: {
      movement: "through_service",
      spawnEdge: "west",
      exitEdge: "east",
      stopAtStation: true
    }
  };
}

export function applyRailwayGatewayToCells(cells, plan) {
  for (const cellId of plan.trackCellIds) {
    if (cells[cellId]) cells[cellId].infrastructure = "railway";
  }
  for (const cellId of plan.station.cellIds) {
    if (cells[cellId]) cells[cellId].infrastructure = "railway_station";
  }
  for (const cellId of plan.forecourt.cellIds) {
    if (cells[cellId]) cells[cellId].infrastructure = "station_plaza";
  }
  const gatewayCell = cells[plan.urbanConnectionPoint.cellId];
  if (gatewayCell) {
    // The renderer gives this threshold one road-textured paving cell, but the
    // authoritative road network begins only when the Agent extends it into
    // the city. This keeps the first road command meaningful.
    gatewayCell.infrastructure = "station_plaza";
    gatewayCell.node = plan.urbanConnectionPoint.nodeId;
  }
  return cells;
}

export function nextRailwayStationLevel(node) {
  const level = clampInteger(node?.stationLevel ?? node?.railway?.station?.level ?? 1, 1, 3);
  return Math.min(3, level + 1);
}

function gatewaySiteIsDry(byId, startColumn, trackRow) {
  return rectangleIds(startColumn, trackRow + 1, STATION_WIDTH_CELLS, STATION_DEPTH_CELLS + FORECOURT_DEPTH_CELLS)
    .every((id) => {
      const cell = byId.get(id);
      return cell && cell.buildable !== false && cell.strictBuildable !== false;
    });
}

function rectangleIds(startColumn, startRow, width, depth) {
  const ids = [];
  for (let row = startRow; row < startRow + depth; row += 1) {
    for (let column = startColumn; column < startColumn + width; column += 1) ids.push(`cell-${column}-${row}`);
  }
  return ids;
}

function clampInteger(value, minimum, maximum) {
  return Math.round(Math.min(maximum, Math.max(minimum, Number(value))));
}
