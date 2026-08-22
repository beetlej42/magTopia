import { getFootprintCells } from "./contracts.js";
import { districtBlockForCell, districtBlockProgress } from "./district-layout.js";
import { districtSuggestions, districtSpatialObservations } from "./district-guidance.js";
import { canOccupyFootprint } from "./state.js";
import { calculateBuildingConstructionCost, calculateRoadCost, roundConstructionCoins } from "../gameplay/construction-cost.js";

const DIRECTIONS = ["north", "east", "south", "west"];
const DIRECTION_OFFSETS = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0]
};

export function findCandidateParcels(state, criteria = {}) {
  const footprint = criteria.footprint ?? "1x1";
  const candidates = [];
  for (const lot of Object.values(state.cells)) {
    const occupancy = canOccupyFootprint(state, lot.id, footprint);
    if (!occupancy.ok) continue;
    if (!footprintWithinBounds(state, occupancy.cells, criteria.bounds)) continue;
    const entranceDirections = allowedEntrances(state, occupancy.cells);
    if (!entranceDirections.length) continue;
    const roadFrontageDirections = entranceDirections.filter((direction) => adjacentRoad(state, occupancy.cells, direction));
    const roadDistance = nearestRoadDistance(state, lot);
    const block = criteria.layout ? districtBlockForCell(lot, criteria.layout) : null;
    const blockProgress = block ? criteria.blockProgress?.blocks?.find((entry) => entry.id === block.id) : null;
    const blockRole = block ? (isBlockPerimeterCell(lot, block) ? "perimeter" : "interior") : null;
    candidates.push({
      lotId: lot.id,
      footprintCells: occupancy.cells,
      center: lot.center,
      entranceDirections,
      terrainSummary: summarizeTerrain(state, occupancy.cells),
      context: {
        districtId: criteria.districtId ?? null,
        adjacentRoad: roadFrontageDirections.length > 0,
        roadFrontageDirections,
        nearestRoadDistance: Number.isFinite(roadDistance) ? roadDistance : null,
        scenic: isNearWater(state, lot, 3) ? "waterfront" : "urban",
        boundsMatched: Boolean(criteria.bounds),
        blockId: block?.id ?? null,
        blockBounds: block ? {
          minColumn: block.minColumn,
          minRow: block.minRow,
          maxColumn: block.maxColumn,
          maxRow: block.maxRow
        } : null,
        blockRole,
        blockPerimeterClosed: blockProgress?.perimeter.closed ?? false,
        boundarySidesCovered: blockProgress?.perimeter.sidesCovered ?? 0,
        boundaryCoverage: blockProgress?.perimeter.coverage ?? 0,
        recommendedForBlockFill: blockRole === "interior"
          && Boolean(blockProgress?.access.hasRoad || blockProgress?.counts.buildings),
        // Compatibility field. This is descriptive only; it never blocks a
        // legal construction proposal.
        eligibleForBlockFill: blockRole === "interior"
          && Boolean(blockProgress?.access.hasRoad || blockProgress?.counts.buildings)
      }
    });
  }
  return candidates
    .sort((left, right) => state.cells[left.lotId].row - state.cells[right.lotId].row
      || state.cells[left.lotId].column - state.cells[right.lotId].column
      || left.lotId.localeCompare(right.lotId))
    .slice(0, criteria.limit ?? 24);
}

export function previewConstruction(state, proposal, options = {}) {
  if (!proposal.gameplayBuilding) {
    return {
      feasible: false,
      code: "GAMEPLAY_BUILDING_REQUIRED",
      errors: ["Canonical gameplayBuilding functional units are required for v0.3 construction"],
      resourcesAfter: { ...state.resources }
    };
  }
  const district = proposal.districtId ? state.districts?.[proposal.districtId] : null;
  if (district?.status === "cancelled") {
    return { feasible: false, errors: [`District ${proposal.districtId} is cancelled; choose a new district or omit district_id`] };
  }
  const lot = state.cells[proposal.site.lotId];
  const occupancy = canOccupyFootprint(state, proposal.site.lotId, proposal.site.footprint);
  if (!occupancy.ok) return { feasible: false, errors: [occupancy.reason] };
  const availableEntrances = allowedEntrances(state, occupancy.cells);
  if (!availableEntrances.includes(proposal.site.entrance)) return { feasible: false, errors: [`Entrance ${proposal.site.entrance} has no buildable frontage`] };
  const explicitEntrance = proposal.site.entranceCellId;
  if (explicitEntrance && !getEntranceFrontageCells(state, occupancy.cells, proposal.site.entrance).includes(explicitEntrance)) {
    return { feasible: false, errors: [`Entrance port ${explicitEntrance} is not routeable from the ${proposal.site.entrance} facade`] };
  }
  const route = proposal.connectionRequest
    ? solveConnection(state, occupancy.cells, proposal.connectionRequest, proposal.site.entrance, explicitEntrance)
    : emptyRoute();
  if (!route.feasible) return { feasible: false, errors: [route.reason] };
  let buildingCost;
  try {
    buildingCost = calculateBuildingConstructionCost(proposal);
  } catch (error) {
    return {
      feasible: false,
      code: classifyConstructionCostError(error),
      errors: [error.message],
      resourcesAfter: { ...state.resources }
    };
  }
  // System-owned construction policy discount (City Construction Mobilization).
  // Consumed through the unified preview path so every construction cost stays
  // in one solver. Client input never carries the discount.
  let discountedBuildingCost;
  try {
    const discountRate = Math.min(1, Math.max(0, Number(options.constructionDiscountRate ?? 0)));
    discountedBuildingCost = { coins: roundConstructionCoins(buildingCost.coins * (1 - discountRate)) };
  } catch (error) {
    return {
      feasible: false,
      code: classifyConstructionCostError(error),
      errors: [error.message],
      resourcesAfter: { ...state.resources }
    };
  }
  const cost = addCosts(discountedBuildingCost, route.cost);
  const resourcesAfter = subtractCosts(state.resources, cost);
  const shortages = Object.entries(resourcesAfter).filter(([, value]) => value < 0).map(([key]) => key);
  return {
    feasible: shortages.length === 0,
    errors: shortages.length ? [`Insufficient ${shortages.join(", ")}`] : [],
    footprintCells: occupancy.cells,
    gradingPlan: createGradingPlan(state, occupancy.cells),
    allowedEntrances: availableEntrances,
    connectionPlan: route,
    guidance: constructionGuidance(state, proposal, occupancy.cells),
    cost,
    buildingCost,
    resourcesAfter,
    warnings: route.bridgeCells.length ? [`Bridge required across ${route.bridgeCells.length} water cell(s).`] : []
  };
}

function createGradingPlan(state, cellIds) {
  const minimum = Math.min(...cellIds.map((cellId) => Number(state.cells[cellId]?.surface?.minElevationVoxels ?? 0)));
  const maximum = Math.max(...cellIds.map((cellId) => Number(state.cells[cellId]?.surface?.maxElevationVoxels ?? 0)));
  return {
    strategy: "grade_to_global_construction_datum",
    sourceElevationRangeVoxels: [minimum, maximum],
    maximumCutFillVoxels: Math.max(Math.abs(minimum), Math.abs(maximum)),
    roadSurfaceVoxelY: Number(state.world?.constructionDatum?.roadSurfaceVoxelY ?? -1),
    buildingBaseVoxelY: Number(state.world?.constructionDatum?.buildingBaseVoxelY ?? 0),
    finishedConstructionHeightWorld: Number(state.world?.constructionDatum?.finishedConstructionHeightWorld ?? -0.0625)
  };
}

export function solveConnection(state, footprintCells, request, entrance = "south", entranceCellId = null) {
  const targetBuilding = request.toBuildingId ? state.buildings[request.toBuildingId] : null;
  const targetFootprintCells = targetBuilding?.footprintCells ?? [];
  const targetEntrance = request.targetEntrance ?? targetBuilding?.site?.entrance ?? null;
  const startIds = entranceCellId ? [entranceCellId] : getEntranceFrontageCells(state, footprintCells, entrance);
  const targetIds = targetBuilding
    ? (authoritativeEntranceCellId(targetBuilding) ? [authoritativeEntranceCellId(targetBuilding)] : getEntranceFrontageCells(state, targetFootprintCells, targetEntrance))
    : [request.toCellId ?? state.nodes[request.to]?.cellId].filter(Boolean);
  if (!targetIds.length || !targetIds.some((cellId) => state.cells[cellId])) return { feasible: false, reason: "Connection target is not a known city node" };
  if (!startIds.length) return { feasible: false, reason: `Entrance ${entrance} has no routeable frontage` };

  const blocked = new Set([...footprintCells, ...targetFootprintCells]);
  let best = null;
  for (const startId of startIds) {
    for (const targetId of targetIds) {
      const candidate = findRoadRoute(state, startId, targetId, blocked);
      if (candidate && (!best || candidate.cost < best.cost)) best = { ...candidate, startId, targetId };
    }
  }
  if (!best) return { feasible: false, reason: "No unblocked route exists between the two entrances" };

  const { route, startId, targetId } = best;
  const bridgeRouteCells = route.filter((cellId) => isWaterCell(state.cells[cellId]));
  const bridgeCells = bridgeRouteCells.filter((cellId) => state.infrastructure[cellId]?.type !== "bridge");
  const roadCells = route.filter((cellId) => {
    const cell = state.cells[cellId];
    return cell
      && !isWaterCell(cell)
      && !footprintCells.includes(cellId)
      && !targetFootprintCells.includes(cellId)
      && cell.infrastructure !== "road";
  });
  const roadCost = calculateRoadCost({ roadCells: roadCells.length, bridgeCells: bridgeCells.length });
  return { feasible: true, targetId, targetBuildingId: request.toBuildingId ?? null, entrance, targetEntrance, entranceCellId: startId, route, roadCells, bridgeCells, bridgeRouteCells, cost: { coins: roadCost.coins }, roadCost };
}

export function previewConnectionBetween(state, from, to) {
  const source = resolveConnectionEndpoint(state, from, "from");
  const target = resolveConnectionEndpoint(state, to, "to");
  if (!source.ok) return { feasible: false, reason: source.reason };
  if (!target.ok) return { feasible: false, reason: target.reason };
  if (source.key === target.key) return { feasible: false, reason: "Connection endpoints must be different" };

  const request = target.kind === "building"
    ? { toBuildingId: target.id, targetEntrance: target.entrance }
    : { toCellId: target.cellId };
  return solveConnection(state, source.footprintCells, request, source.entrance, source.entranceCellId);
}

function resolveConnectionEndpoint(state, endpoint, label) {
  if (endpoint.kind === "building") {
    const building = state.buildings[endpoint.id];
    if (!building) return { ok: false, reason: `Unknown ${label} building ${endpoint.id}` };
    return {
      ok: true,
      key: `building:${endpoint.id}`,
      kind: "building",
      id: endpoint.id,
      footprintCells: building.footprintCells,
      entrance: endpoint.entrance ?? building.site.entrance,
      entranceCellId: authoritativeEntranceCellId(building)
    };
  }
  const cellId = endpoint.kind === "node" ? state.nodes[endpoint.id]?.cellId : endpoint.id;
  if (!cellId || !state.cells[cellId]) return { ok: false, reason: `Unknown ${label} ${endpoint.kind} ${endpoint.id}` };
  return {
    ok: true,
    key: `${endpoint.kind}:${endpoint.id}`,
    kind: endpoint.kind,
    id: endpoint.id,
    cellId,
    footprintCells: [cellId],
    entrance: endpoint.entrance ?? firstRouteableDirection(state, cellId)
  };
}

function authoritativeEntranceCellId(building) {
  return building?.voxelDesign?.ports?.find((port) => port.type === "primary_entrance")?.frontageCellId
    ?? building?.site?.entranceCellId
    ?? null;
}

function firstRouteableDirection(state, cellId) {
  const cell = state.cells[cellId];
  return DIRECTIONS.find((direction) => {
    const candidate = state.cells[neighborId(cell, direction)];
    return candidate && !candidate.occupancy && !candidate.reservation && (!candidate.infrastructure || candidate.infrastructure === "road");
  }) ?? "south";
}

function emptyRoute() { return { feasible: true, route: [], roadCells: [], bridgeCells: [], cost: { coins: 0 }, roadCost: calculateRoadCost() }; }
function allowedEntrances(state, cells) { return DIRECTIONS.filter((direction) => getEntranceFrontageCells(state, cells, direction).length > 0); }
function adjacentRoad(state, cells, direction) {
  return getEntranceFrontageCells(state, cells, direction).some((cellId) => (
    state.cells[cellId]?.infrastructure === "road" || state.infrastructure[cellId]?.type === "bridge"
  ));
}
function neighborId(cell, direction) { const [x, y] = DIRECTION_OFFSETS[direction]; return `cell-${cell.column + x}-${cell.row + y}`; }

function constructionGuidance(state, proposal, footprintCells) {
  const guidance = [];
  const districts = state.districts ?? {};
  const district = proposal.districtId ? districts[proposal.districtId] : null;
  if (!Object.keys(districts).length) {
    guidance.push({ code: "define_development_district_first", message: "Name and designate a development district before starting a new building cluster." });
    return guidance;
  }
  if (!proposal.districtId) {
    guidance.push({ code: "choose_development_district", message: "Associate this building with a named development district so later actions share one spatial intention." });
    return guidance;
  }
  if (!district) {
    guidance.push({ code: "district_not_found", message: `The referenced district ${proposal.districtId} does not exist.` });
    return guidance;
  }
  const blockProgress = districtBlockProgress(state, district);
  const observations = districtSpatialObservations(state, district, blockProgress);
  const suggestions = districtSuggestions(state, district, observations);
  if (!footprintWithinBounds(state, footprintCells, district.bounds)) {
    guidance.push({ code: "site_outside_district", message: `${proposal.program.name} is outside the bounds of ${district.name}.` });
  }
  if (observations.road_cells === 0) {
    guidance.push({ code: "district_has_no_roads", message: `${district.name} has no nearby road network yet; adding access first may make this building easier to integrate.` });
  } else if (!adjacentRoad(state, footprintCells, proposal.site.entrance)) {
    guidance.push({ code: "entrance_not_on_existing_road", message: `The ${proposal.site.entrance} entrance does not face an existing road in ${district.name}.` });
  }
  suggestions.forEach((suggestion) => guidance.push({
    code: suggestion.code.toLowerCase(),
    action: suggestion.action,
    priority: suggestion.priority,
    message: suggestion.message,
    optional: true
  }));
  return guidance;
}

function isBlockPerimeterCell(cell, block) {
  return cell.column === block.minColumn || cell.column === block.maxColumn
    || cell.row === block.minRow || cell.row === block.maxRow;
}

export function getEntranceFrontageCells(state, footprintCells, direction) {
  if (!DIRECTION_OFFSETS[direction]) return [];
  const footprint = new Set(footprintCells);
  const routeable = footprintCells.flatMap((cellId) => {
    const cell = state.cells[cellId];
    if (!cell) return [];
    const frontageId = neighborId(cell, direction);
    const frontage = state.cells[frontageId];
    if (!frontage || footprint.has(frontageId) || frontage.occupancy || frontage.reservation) return [];
    if (frontage.infrastructure && frontage.infrastructure !== "road") return [];
    return [frontageId];
  }).filter((cellId, index, all) => all.indexOf(cellId) === index);
  // Voxel grammars place the main door near the facade centre. Limit routing
  // to its one or two centre cells so a successful logical road reaches the
  // door rather than an arbitrary corner of a wide facade.
  const axis = direction === "north" || direction === "south" ? "column" : "row";
  routeable.sort((left, right) => state.cells[left][axis] - state.cells[right][axis] || left.localeCompare(right));
  if (routeable.length <= 2) return routeable;
  const middle = (routeable.length - 1) / 2;
  return routeable.filter((_, index) => Math.abs(index - middle) <= 0.5);
}

function findRoadRoute(state, startId, targetId, blocked) {
  if (!state.cells[startId] || !state.cells[targetId]) return null;
  const bounds = getGridBounds(state);
  const cameFrom = new Map();
  const gScore = new Map([[startId, 0]]);
  const fScore = new Map([[startId, routeHeuristic(startId, targetId)]]);
  const open = [];
  pushRouteCandidate(open, { id: startId, score: fScore.get(startId) });

  while (open.length) {
    const candidate = popRouteCandidate(open);
    if (candidate.score !== fScore.get(candidate.id)) continue;
    const current = candidate.id;
    if (current === targetId) {
      const route = reconstructRoute(cameFrom, current);
      return { route, cost: gScore.get(current) ?? Infinity };
    }
    for (const neighbor of routeNeighbors(current, bounds)) {
      if (blocked.has(neighbor)) continue;
      const cell = state.cells[neighbor];
      if (!cell) continue;
      if (cell?.occupancy) continue;
      if (cell?.reservation) continue;
      if (cell?.infrastructure && cell.infrastructure !== "road") continue;
      const existingBridge = state.infrastructure[neighbor]?.type === "bridge";
      const stepCost = cell.infrastructure === "road" || existingBridge ? 0.22 : isWaterCell(cell) ? 8 : 1;
      const tentative = (gScore.get(current) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(neighbor) ?? Infinity)) continue;
      cameFrom.set(neighbor, current);
      gScore.set(neighbor, tentative);
      const nextScore = tentative + routeHeuristic(neighbor, targetId);
      fScore.set(neighbor, nextScore);
      pushRouteCandidate(open, { id: neighbor, score: nextScore });
    }
  }
  return null;
}

function isWaterCell(cell) {
  return Boolean(cell && (cell.bridgeRequired || cell.surface?.kind === "water" || cell.ground === "water"));
}

function footprintWithinBounds(state, cellIds, bounds) {
  if (!bounds) return true;
  const minColumn = Number(bounds.min_column ?? bounds.minColumn ?? -Infinity);
  const maxColumn = Number(bounds.max_column ?? bounds.maxColumn ?? Infinity);
  const minRow = Number(bounds.min_row ?? bounds.minRow ?? -Infinity);
  const maxRow = Number(bounds.max_row ?? bounds.maxRow ?? Infinity);
  return cellIds.every((cellId) => {
    const cell = state.cells[cellId];
    return cell.column >= minColumn && cell.column <= maxColumn && cell.row >= minRow && cell.row <= maxRow;
  });
}

function summarizeTerrain(state, cellIds) {
  const cells = cellIds.map((cellId) => state.cells[cellId]);
  return {
    kinds: [...new Set(cells.map((cell) => cell.surface?.kind ?? cell.ground ?? "unknown"))],
    strictBuildable: cells.every((cell) => cell.strictBuildable !== false),
    maximumHeightRangeVoxels: Math.max(0, ...cells.map((cell) => Number(cell.surface?.heightRangeVoxels ?? 0))),
    maximumElevationVoxels: Math.max(0, ...cells.map((cell) => Number(cell.surface?.maxElevationVoxels ?? 0)))
  };
}

function nearestRoadDistance(state, lot) {
  let distance = Infinity;
  for (const cell of Object.values(state.cells)) {
    if (cell.infrastructure !== "road" && state.infrastructure[cell.id]?.type !== "bridge") continue;
    distance = Math.min(distance, Math.abs(cell.column - lot.column) + Math.abs(cell.row - lot.row));
  }
  return distance;
}

function isNearWater(state, lot, radius) {
  for (let row = lot.row - radius; row <= lot.row + radius; row += 1) {
    for (let column = lot.column - radius; column <= lot.column + radius; column += 1) {
      if (Math.abs(column - lot.column) + Math.abs(row - lot.row) > radius) continue;
      if (isWaterCell(state.cells[`cell-${column}-${row}`])) return true;
    }
  }
  return false;
}

function pushRouteCandidate(heap, candidate) {
  heap.push(candidate);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRouteCandidates(heap[parent], candidate) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = candidate;
}

function popRouteCandidate(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareRouteCandidates(heap[left], heap[smallest]) < 0) smallest = left;
    if (right < heap.length && compareRouteCandidates(heap[right], heap[smallest]) < 0) smallest = right;
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
  return first;
}

function compareRouteCandidates(a, b) {
  return a.score - b.score || a.id.localeCompare(b.id);
}

function getGridBounds(state) {
  const cells = Object.values(state.cells);
  return {
    minColumn: Math.min(...cells.map((cell) => cell.column)),
    maxColumn: Math.max(...cells.map((cell) => cell.column)),
    minRow: Math.min(...cells.map((cell) => cell.row)),
    maxRow: Math.max(...cells.map((cell) => cell.row))
  };
}

function routeNeighbors(cellId, bounds) {
  const { column, row } = parseCellId(cellId);
  return Object.values(DIRECTION_OFFSETS).flatMap(([dx, dy]) => {
    const nextColumn = column + dx;
    const nextRow = row + dy;
    if (nextColumn < bounds.minColumn || nextColumn > bounds.maxColumn || nextRow < bounds.minRow || nextRow > bounds.maxRow) return [];
    return [`cell-${nextColumn}-${nextRow}`];
  });
}

function reconstructRoute(cameFrom, current) {
  const route = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    route.unshift(current);
  }
  return route;
}

function routeHeuristic(fromId, toId) {
  const from = parseCellId(fromId);
  const to = parseCellId(toId);
  return (Math.abs(from.column - to.column) + Math.abs(from.row - to.row)) * 0.2;
}

function parseCellId(cellId) {
  const match = /^cell-(-?\d+)-(-?\d+)$/.exec(cellId ?? "");
  return match ? { column: Number(match[1]), row: Number(match[2]) } : { column: 0, row: 0 };
}

function classifyConstructionCostError(error) {
  const text = String(error?.message ?? error);
  if (/Ambiguous GameplayBuilding grammar/i.test(text)) return "AMBIGUOUS_GAMEPLAY_GRAMMAR";
  if (/Unsupported gameplay grammar field/i.test(text)) return "INVALID_GAMEPLAY_GRAMMAR";
  if (/magicRatio/i.test(text)) return "INVALID_MAGIC_RATIO";
  if (/Unsupported gameplay purpose/i.test(text)) return "INVALID_GAMEPLAY_PURPOSE";
  if (/area must be|functional units must|requires units|requires a purpose/i.test(text)) return "INVALID_GAMEPLAY_BUILDING";
  if (/floor|height/i.test(text)) return "INVALID_BUILDING_HEIGHT";
  if (/safe integer|finite/i.test(text)) return "CONSTRUCTION_COST_UNSAFE";
  if (/Canonical GameplayBuilding/i.test(text)) return "GAMEPLAY_BUILDING_REQUIRED";
  return "INVALID_CONSTRUCTION_COST";
}
function addCosts(...costs) { return costs.reduce((sum, cost) => ({ coins: sum.coins + cost.coins }), { coins: 0 }); }
function subtractCosts(resources, cost) { return { coins: resources.coins - cost.coins }; }
