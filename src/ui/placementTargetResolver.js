// Interactive special-building placement — FOV-center target resolution.
//
// PR #52: the manual placement flow for player-placed special structures is a
// city-builder-style in-world placement mode driven by the camera FOV center,
// not a legal-lot button list. The authoritative `/site-searches` candidate set
// is fetched once on entering placement; every per-frame/per-drag re-evaluation
// below is a pure local lookup over the render-state so no network request is
// made while the camera moves. The server stays the final authority at
// `/cards/place`.
//
// The FOV center maps to a logical grid cell through the exact same flat
// coordinate pipeline the viewer already uses for center-focused district /
// building selection (see cellAtFlatPoint in cityInfoOverlay.js). The footprint
// is anchored at that cell (north-west corner), extending `columns` east and
// `rows` south — the same convention as getFootprintCells in contracts.js.
//
// Building rotation is a separate state variable from camera rotation. Pressing
// rotate turns the footprint rectangle 90° clockwise around the anchor and
// rotates the entrance direction with it; camera rotation never changes the
// proposed building's world orientation.

const DIRECTIONS = ["north", "east", "south", "west"];
const DIRECTION_OFFSETS = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0]
};
// Clockwise rotation order: rotating the building 90° clockwise moves its
// entrance from south to west to north to east.
const CLOCKWISE_ORDER = ["south", "west", "north", "east"];

export function normalizeFootprintDims(footprint = "1x1") {
  const match = /^(\d+)x(\d+)$/.exec(String(footprint).toLowerCase().trim());
  if (!match) return { columns: 1, rows: 1 };
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    return { columns: 1, rows: 1 };
  }
  return { columns, rows };
}

export function footprintDimsForQuarterTurns(footprint = "1x1", quarterTurns = 0) {
  const dims = normalizeFootprintDims(footprint);
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q % 2 === 1) return { columns: dims.rows, rows: dims.columns };
  return dims;
}

export function rotateEntrance(entrance = "south", quarterTurns = 0) {
  const q = ((quarterTurns % 4) + 4) % 4;
  const index = CLOCKWISE_ORDER.indexOf(String(entrance).toLowerCase());
  if (index < 0) return entrance;
  return CLOCKWISE_ORDER[(index + q) % CLOCKWISE_ORDER.length];
}

export function footprintCellsFor(columns, rows, column, row) {
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      cells.push(`cell-${column + c}-${row + r}`);
    }
  }
  return cells;
}

function neighborId(cell, direction) {
  const [dx, dy] = DIRECTION_OFFSETS[direction];
  return `cell-${cell.column + dx}-${cell.row + dy}`;
}

// Local mirror of getEntranceFrontageCells in solver.js: returns the routeable
// frontage cells of the given footprint for a facade direction. The centre one
// or two cells of a wide facade are the only routeable ports (matching the
// voxel-grammar door placement), but any non-empty result means the direction
// has buildable frontage.
export function entranceFrontageCells(state, footprintCells, direction) {
  if (!DIRECTION_OFFSETS[direction]) return [];
  const footprint = new Set(footprintCells);
  const routeable = [];
  for (const cellId of footprintCells) {
    const cell = state.cells[cellId];
    if (!cell) continue;
    const frontageId = neighborId(cell, direction);
    const frontage = state.cells[frontageId];
    if (!frontage || footprint.has(frontageId) || frontage.occupancy || frontage.reservation) continue;
    if (frontage.infrastructure && frontage.infrastructure !== "road") continue;
    routeable.push(frontageId);
  }
  if (!routeable.length) return [];
  const unique = [...new Set(routeable)];
  if (unique.length <= 2) return unique;
  const axis = direction === "north" || direction === "south" ? "column" : "row";
  unique.sort((left, right) => state.cells[left][axis] - state.cells[right][axis] || left.localeCompare(right));
  const middle = (unique.length - 1) / 2;
  return unique.filter((_, index) => Math.abs(index - middle) <= 0.5);
}

// Local mirror of canOccupyFootprint in state.js.
export function checkFootprintCells(state, footprintCells) {
  for (const cellId of footprintCells) {
    const cell = state.cells[cellId];
    if (!cell) return { ok: false, reason: "目标超出可建造范围" };
    if (cell.buildable === false) return { ok: false, reason: "目标位于水域或不可建造地形" };
    if (cell.strictBuildable === false) return { ok: false, reason: "目标位于岸边地形，需要干燥建造地块" };
    if (cell.node) return { ok: false, reason: "目标地块被城市节点保留" };
    if (cell.occupancy || cell.infrastructure || cell.reservation) {
      return { ok: false, reason: "目标地块已被占用或预留" };
    }
  }
  return { ok: true };
}

export function allLegalEntrances(state, footprintCells) {
  return DIRECTIONS.filter((direction) => entranceFrontageCells(state, footprintCells, direction).length > 0);
}

function hasRoadFrontage(state, footprintCells, direction) {
  const frontage = entranceFrontageCells(state, footprintCells, direction);
  return frontage.some((cellId) => state.cells[cellId]?.infrastructure === "road"
    || (state.infrastructure?.[cellId]?.type === "bridge"));
}

// Prefers a road-facing entrance in compass order, then any legal frontage.
// Falls back to the authoritative candidate's entrance hints when available.
// `footprintCells` must be the default-orientation footprint so the candidate
// hints (which are keyed to the default footprint) line up.
function chooseBaseEntrance(state, footprintCells, candidateIndex, lotId) {
  const candidate = candidateIndex?.get?.(lotId) ?? null;
  const entranceHints = candidate?.roadFrontageDirections?.length
    ? candidate.roadFrontageDirections
    : (candidate?.entranceDirections ?? []);
  if (entranceHints.length) {
    const hint = entranceHints.find((direction) => DIRECTIONS.includes(direction));
    if (hint) return hint;
  }
  const legal = allLegalEntrances(state, footprintCells);
  const roadFacing = legal.filter((direction) => hasRoadFrontage(state, footprintCells, direction));
  return roadFacing[0] ?? legal[0] ?? "south";
}

// Maps the flat camera focus to the logical grid cell. Same coordinate
// convention as cityInfoOverlay's cellAtFlatPoint: column 0 is the west edge
// (negative world X), row 0 is the north edge (positive world Z).
export function cellAtFlatPoint(state, flatX, flatZ) {
  const grid = state?.world?.grid ?? {};
  const columns = Number(grid.columns ?? 0);
  const rows = Number(grid.rows ?? 0);
  const cellWorldSize = Number(grid.cellWorldSize ?? 4);
  if (!columns || !rows || cellWorldSize <= 0) return null;
  const column = Math.floor((Number(flatX) + columns * cellWorldSize / 2) / cellWorldSize);
  const row = Math.floor((rows * cellWorldSize / 2 - Number(flatZ)) / cellWorldSize);
  if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
  const cell = state.cells?.[`cell-${column}-${row}`] ?? null;
  if (!cell) return null;
  return {
    cell,
    x: -columns * cellWorldSize / 2 + (column + 0.5) * cellWorldSize,
    z: rows * cellWorldSize / 2 - (row + 0.5) * cellWorldSize
  };
}

export function createPlacementCandidateIndex(candidates = []) {
  return new Map((candidates ?? []).filter((entry) => entry?.lotId).map((entry) => [entry.lotId, entry]));
}

function targetCells(state, footprintCells) {
  return footprintCells.map((id) => {
    const cell = state.cells?.[id] ?? null;
    return {
      id,
      column: cell?.column ?? null,
      row: cell?.row ?? null,
      centerX: Number(cell?.center?.x ?? 0),
      centerZ: Number(cell?.center?.z ?? 0)
    };
  });
}

// Resolves the current placement target from the FOV-center flat coordinates.
// Pure local evaluation; never performs network I/O.
export function resolvePlacementTarget(state, options = {}) {
  const {
    flatX = 0,
    flatZ = 0,
    footprint = "1x1",
    quarterTurns = 0,
    candidateIndex = null
  } = options;
  const center = cellAtFlatPoint(state, flatX, flatZ);
  if (!center) return { hasTarget: false, isLegal: false, reason: "视野中心不在城市范围内", entrance: "south" };
  const q = ((quarterTurns % 4) + 4) % 4;
  const dims = footprintDimsForQuarterTurns(footprint, q);
  const anchor = center.cell;
  const footprintCells = footprintCellsFor(dims.columns, dims.rows, anchor.column, anchor.row);
  // The base entrance is the building's front at its default orientation; it is
  // derived from the default-orientation footprint (so authoritative candidate
  // entrance hints line up) and rotated with the building.
  const defaultDims = normalizeFootprintDims(footprint);
  const defaultCells = footprintCellsFor(defaultDims.columns, defaultDims.rows, anchor.column, anchor.row);
  const baseEntrance = chooseBaseEntrance(state, defaultCells, candidateIndex, anchor.id);
  const entrance = rotateEntrance(baseEntrance, q);
  const occupancy = checkFootprintCells(state, footprintCells);
  const frontage = occupancy.ok ? entranceFrontageCells(state, footprintCells, entrance) : [];
  const isLegal = occupancy.ok && frontage.length > 0;
  const reason = !occupancy.ok
    ? occupancy.reason
    : frontage.length === 0
      ? `入口朝 ${entrance} 没有可建造的临街面`
      : null;
  return {
    hasTarget: true,
    lotId: anchor.id,
    anchorColumn: anchor.column,
    anchorRow: anchor.row,
    footprintCells,
    cells: targetCells(state, footprintCells),
    footprintColumns: dims.columns,
    footprintRows: dims.rows,
    quarterTurns: q,
    entrance,
    isLegal,
    reason,
    candidate: candidateIndex?.get?.(anchor.id) ?? null,
    center,
    centerCell: {
      id: anchor.id,
      column: anchor.column,
      row: anchor.row,
      x: center.x,
      z: center.z
    }
  };
}
