/**
 * District layout is a planning aid, not a zoning contract. A district may
 * be any legal rectangle; these values only describe the scale at which a
 * small, walkable block is usually easy for an Agent to compose.
 */
export const DISTRICT_BLOCK_RECOMMENDATION = Object.freeze({
  targetColumns: 6,
  targetRows: 6,
  typicalArea: Object.freeze([24, 48]),
  preferredShortSide: Object.freeze([5, 6]),
  preferredLongSide: Object.freeze([6, 8]),
  preferredAspectRatio: Object.freeze([1, 1.7]),
  typicalBlockCount: Object.freeze([1, 2])
});

// Kept as a compatibility alias for clients that imported the old name. It
// no longer describes a hard maximum and must not be used to reject bounds.
export const DISTRICT_BLOCK_CONTRACT = DISTRICT_BLOCK_RECOMMENDATION;

export function normalizeDistrictLayout(bounds) {
  const width = bounds.maxColumn - bounds.minColumn + 1;
  const height = bounds.maxRow - bounds.minRow + 1;
  const area = width * height;
  const orientation = width <= 8 && height <= 8
    ? { columns: width, rows: height, rotated: false }
    : width >= height
      ? { columns: Math.min(6, width), rows: Math.min(8, height), rotated: false }
      : { columns: Math.min(8, width), rows: Math.min(6, height), rotated: true };
  const tileColumns = Math.max(1, orientation.columns);
  const tileRows = Math.max(1, orientation.rows);
  const blockCount = Math.ceil(width / tileColumns) * Math.ceil(height / tileRows);
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  const warnings = [];

  if (area < DISTRICT_BLOCK_RECOMMENDATION.typicalArea[0]) warnings.push({
    code: "DISTRICT_SMALL_SCALE",
    message: "This district is smaller than the usual 24-cell composition reference."
  });
  if (area > DISTRICT_BLOCK_RECOMMENDATION.typicalArea[1]) warnings.push({
    code: "DISTRICT_LARGE_SCALE",
    message: "This district is larger than the usual 24–48-cell composition reference; consider treating it as several block-sized steps."
  });
  if (aspectRatio > DISTRICT_BLOCK_RECOMMENDATION.preferredAspectRatio[1]) warnings.push({
    code: "DISTRICT_NARROW_SHAPE",
    message: "The district is relatively narrow. A cross street, corner, or deliberately linear street character may help it read as an intentional composition."
  });
  if (blockCount > DISTRICT_BLOCK_RECOMMENDATION.typicalBlockCount[1]) warnings.push({
    code: "DISTRICT_MANY_BLOCKS",
    message: "The district contains more than two recommended block-sized work areas; develop it in visible steps rather than treating the whole rectangle as one task."
  });

  const blocks = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row += tileRows) {
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += tileColumns) {
      const block = {
        id: `block-${blocks.length + 1}`,
        minColumn: column,
        minRow: row,
        maxColumn: Math.min(bounds.maxColumn, column + tileColumns - 1),
        maxRow: Math.min(bounds.maxRow, row + tileRows - 1)
      };
      blocks.push({
        ...block,
        width: block.maxColumn - block.minColumn + 1,
        height: block.maxRow - block.minRow + 1
      });
    }
  }

  return {
    contract: "district-layout-v2-soft",
    blockSize: { columns: tileColumns, rows: tileRows },
    targetBlockSize: {
      columns: DISTRICT_BLOCK_RECOMMENDATION.targetColumns,
      rows: DISTRICT_BLOCK_RECOMMENDATION.targetRows
    },
    recommendation: {
      typicalArea: [...DISTRICT_BLOCK_RECOMMENDATION.typicalArea],
      preferredShortSide: [...DISTRICT_BLOCK_RECOMMENDATION.preferredShortSide],
      preferredLongSide: [...DISTRICT_BLOCK_RECOMMENDATION.preferredLongSide],
      preferredAspectRatio: [...DISTRICT_BLOCK_RECOMMENDATION.preferredAspectRatio],
      typicalBlockCount: [...DISTRICT_BLOCK_RECOMMENDATION.typicalBlockCount],
      note: "Planning reference only. The Agent may intentionally choose another scale or shape."
    },
    dimensions: { width, height, area, aspectRatio },
    orientation: orientation.rotated ? "rotated" : "standard",
    blockCount: blocks.length,
    withinRecommendation: warnings.length === 0,
    // Old consumers used this field to decide whether to reject the district.
    // Keep it true so the recommendation cannot become an accidental gate.
    withinContract: true,
    softWarnings: warnings,
    blocks
  };
}

export function districtBlockForCell(cell, layout) {
  return layout?.blocks?.find((block) => (
    cell.column >= block.minColumn && cell.column <= block.maxColumn
      && cell.row >= block.minRow && cell.row <= block.maxRow
  )) ?? null;
}

/** The buildable edge of a block. Roads live outside this edge when possible. */
export function blockPerimeterCellIds(block, state) {
  return Object.values(state.cells)
    .filter((cell) => cell.column >= block.minColumn && cell.column <= block.maxColumn
      && cell.row >= block.minRow && cell.row <= block.maxRow
      && (cell.column === block.minColumn || cell.column === block.maxColumn
        || cell.row === block.minRow || cell.row === block.maxRow))
    .map((cell) => cell.id);
}

export function districtBlockProgress(state, district) {
  const layout = district.layout?.contract === "district-layout-v2-soft"
    ? district.layout
    : normalizeDistrictLayout(district.bounds);
  const blocks = layout.blocks.map((block) => {
    const cells = cellsInBounds(state, block);
    const perimeterCellIds = blockPerimeterCellIds(block, state);
    const perimeter = new Set(perimeterCellIds);
    const buildableCells = cells.filter(isBuildableCell);
    const buildableInterior = buildableCells.filter((cell) => !perimeter.has(cell.id));
    const occupiedCells = buildableCells.filter((cell) => cell.occupancy);
    const occupiedInterior = buildableInterior.filter((cell) => cell.occupancy);
    const buildingIds = new Set(cells.map((cell) => cell.occupancy).filter(Boolean));
    const roadCellIds = cells.filter((cell) => isRoadCell(state, cell.id)).map((cell) => cell.id);
    const boundary = inspectBlockBoundary(state, block);
    const remainingBuildableCells = Math.max(0, buildableCells.length - occupiedCells.length);
    const roadAccess = boundary.roadCellIds.length > 0 || roadCellIds.length > 0;
    const closed = boundary.closed;
    const status = !roadAccess && buildingIds.size === 0
      ? "unstarted"
      : closed
        ? remainingBuildableCells > 0 ? "ready_to_fill" : "complete"
        : "forming_composition";

    return {
      ...block,
      counts: {
        cells: cells.length,
        buildableCells: buildableCells.length,
        buildableInteriorCells: buildableInterior.length,
        occupiedCells: occupiedCells.length,
        occupiedInteriorCells: occupiedInterior.length,
        remainingBuildableCells,
        remainingInteriorCells: Math.max(0, buildableInterior.length - occupiedInterior.length),
        buildings: buildingIds.size,
        roads: roadCellIds.length
      },
      perimeter: {
        cells: perimeterCellIds.length,
        roadCells: boundary.roadCellIds.length,
        roadBoundaryCells: boundary.roadCellIds,
        coverage: boundary.coverage,
        sides: boundary.sides,
        sidesCovered: boundary.sides.filter((side) => side.coverage > 0).length,
        closed
      },
      access: {
        hasRoad: roadAccess,
        boundaryRoads: boundary.roadCellIds.length,
        connectedToCity: boundary.connectedToCity
      },
      status
    };
  });
  const active = blocks.find((block) => block.status !== "complete") ?? null;
  return {
    contract: layout.contract,
    blockCount: blocks.length,
    completedBlocks: blocks.filter((block) => block.status === "complete").length,
    blocks,
    activeBlockId: active?.id ?? null,
    allBlocksComplete: blocks.length > 0 && blocks.every((block) => block.status === "complete"),
    withinContract: true,
    withinRecommendation: layout.withinRecommendation,
    softWarnings: layout.softWarnings ?? []
  };
}

export function isRoadCell(state, cellId) {
  return state.cells[cellId]?.infrastructure === "road" || state.infrastructure[cellId]?.type === "bridge";
}

export function cellsInBounds(state, bounds) {
  return Object.values(state.cells).filter((cell) => cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
    && cell.row >= bounds.minRow && cell.row <= bounds.maxRow);
}

function inspectBlockBoundary(state, block) {
  const sides = ["north", "east", "south", "west"].map((side) => {
    const slots = boundarySlots(state, block, side);
    const covered = slots.filter((slot) => slot.roadCellId).length;
    return { side, cells: slots.length, covered, coverage: slots.length ? covered / slots.length : 0 };
  });
  const roadCellIds = [...new Set(sides.flatMap((side) => boundarySlots(state, block, side.side).map((slot) => slot.roadCellId).filter(Boolean)))];
  const boundarySlotCount = sides.reduce((sum, side) => sum + side.cells, 0);
  const coveredSlotCount = sides.reduce((sum, side) => sum + side.covered, 0);
  const connectedRoads = connectedRoadCellIds(state);
  return {
    roadCellIds,
    sides,
    coverage: boundarySlotCount ? coveredSlotCount / boundarySlotCount : 0,
    closed: sides.every((side) => side.coverage >= 0.75) && roadCellIds.length > 0,
    connectedToCity: roadCellIds.some((cellId) => connectedRoads.has(cellId))
  };
}

function boundarySlots(state, block, side) {
  const result = [];
  const min = side === "north" || side === "south" ? block.minColumn : block.minRow;
  const max = side === "north" || side === "south" ? block.maxColumn : block.maxRow;
  for (let offset = min; offset <= max; offset += 1) {
    const column = side === "north" || side === "south" ? offset : side === "west" ? block.minColumn : block.maxColumn;
    const row = side === "north" ? block.minRow : side === "south" ? block.maxRow : offset;
    const cell = state.cells[`cell-${column}-${row}`];
    if (!cell) continue;
    const [dx, dy] = side === "north" ? [0, -1]
      : side === "east" ? [1, 0]
        : side === "south" ? [0, 1] : [-1, 0];
    const outside = state.cells[`cell-${column + dx}-${row + dy}`];
    const roadCellId = isRoadCell(state, outside?.id) ? outside.id : isRoadCell(state, cell.id) ? cell.id : null;
    result.push({ cellId: cell.id, roadCellId });
  }
  return result;
}

export function connectedRoadCellIds(state) {
  const roadCells = Object.values(state.cells).filter((cell) => isRoadCell(state, cell.id));
  const roadIds = new Set(roadCells.map((cell) => cell.id));
  const gatewayId = state.nodes?.old_town_entry?.cellId;
  if (!gatewayId) return new Set();
  const gateway = state.cells[gatewayId];
  const seeds = [gatewayId, ...CARDINALS.map(([dx, dy]) => `cell-${gateway.column + dx}-${gateway.row + dy}`)]
    .filter((cellId) => roadIds.has(cellId));
  if (!seeds.length) return new Set();
  const connected = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = state.cells[queue.shift()];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nextId = `cell-${current.column + dx}-${current.row + dy}`;
      if (roadIds.has(nextId) && !connected.has(nextId)) {
        connected.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return connected;
}

function isBuildableCell(cell) {
  return cell.buildable !== false && cell.strictBuildable !== false && !cell.infrastructure && !cell.node;
}

const CARDINALS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
