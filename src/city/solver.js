import { getFootprintCells } from "./contracts.js";
import { canOccupyFootprint } from "./state.js";

const ROAD_COST = { coins: 8, timber: 1, stone: 1 };
const BRIDGE_COST = { coins: 30, timber: 5, stone: 8 };
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
    const entranceDirections = allowedEntrances(state, occupancy.cells);
    if (!entranceDirections.length) continue;
    candidates.push({
      lotId: lot.id,
      footprintCells: occupancy.cells,
      center: lot.center,
      entranceDirections,
      score: scoreLot(state, lot, criteria),
      context: { adjacentRoad: entranceDirections.some((direction) => adjacentRoad(state, occupancy.cells, direction)), scenic: lot.column < 18 ? "waterfront" : "urban" }
    });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, criteria.limit ?? 24);
}

export function previewConstruction(state, proposal) {
  const lot = state.cells[proposal.site.lotId];
  const occupancy = canOccupyFootprint(state, proposal.site.lotId, proposal.site.footprint);
  if (!occupancy.ok) return { feasible: false, errors: [occupancy.reason] };
  const availableEntrances = allowedEntrances(state, occupancy.cells);
  if (!availableEntrances.includes(proposal.site.entrance)) return { feasible: false, errors: [`Entrance ${proposal.site.entrance} has no buildable frontage`] };
  const route = proposal.connectionRequest ? solveConnection(state, occupancy.cells, proposal.connectionRequest, proposal.site.entrance) : emptyRoute();
  if (!route.feasible) return { feasible: false, errors: [route.reason] };
  const buildingCost = buildingCostFor(proposal.site.footprint, proposal.program.archetype);
  const cost = addCosts(buildingCost, route.cost);
  const resourcesAfter = subtractCosts(state.resources, cost);
  const shortages = Object.entries(resourcesAfter).filter(([, value]) => value < 0).map(([key]) => key);
  return {
    feasible: shortages.length === 0,
    errors: shortages.length ? [`Insufficient ${shortages.join(", ")}`] : [],
    footprintCells: occupancy.cells,
    allowedEntrances: availableEntrances,
    connectionPlan: route,
    cost,
    resourcesAfter,
    warnings: route.bridgeCells.length ? [`Bridge required across ${route.bridgeCells.length} water cell(s).`] : []
  };
}

export function solveConnection(state, footprintCells, request, entrance = "south") {
  const targetBuilding = request.toBuildingId ? state.buildings[request.toBuildingId] : null;
  const targetFootprintCells = targetBuilding?.footprintCells ?? [];
  const targetEntrance = request.targetEntrance ?? targetBuilding?.site?.entrance ?? null;
  const startIds = getEntranceFrontageCells(state, footprintCells, entrance);
  const targetIds = targetBuilding
    ? getEntranceFrontageCells(state, targetFootprintCells, targetEntrance)
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
  const bridgeCells = route.filter((cellId) => !state.cells[cellId]);
  const roadCells = route.filter((cellId) => state.cells[cellId] && !footprintCells.includes(cellId) && !targetFootprintCells.includes(cellId) && state.cells[cellId].infrastructure !== "road");
  return { feasible: true, targetId, targetBuildingId: request.toBuildingId ?? null, entrance, targetEntrance, entranceCellId: startId, route, roadCells, bridgeCells, cost: addCosts(scaleCost(ROAD_COST, roadCells.length), scaleCost(BRIDGE_COST, bridgeCells.length)) };
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
  return solveConnection(state, source.footprintCells, request, source.entrance);
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
      entrance: endpoint.entrance ?? building.site.entrance
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

function firstRouteableDirection(state, cellId) {
  const cell = state.cells[cellId];
  return DIRECTIONS.find((direction) => {
    const candidate = state.cells[neighborId(cell, direction)];
    return candidate && !candidate.occupancy && (!candidate.infrastructure || candidate.infrastructure === "road");
  }) ?? "south";
}

function emptyRoute() { return { feasible: true, route: [], roadCells: [], bridgeCells: [], cost: { coins: 0, timber: 0, stone: 0 } }; }
function allowedEntrances(state, cells) { return DIRECTIONS.filter((direction) => getEntranceFrontageCells(state, cells, direction).length > 0); }
function adjacentRoad(state, cells, direction) { return cells.some((id) => state.cells[neighborId(state.cells[id], direction)]?.infrastructure === "road"); }
function neighborId(cell, direction) { const [x, y] = DIRECTION_OFFSETS[direction]; return `cell-${cell.column + x}-${cell.row + y}`; }
function scoreLot(state, lot, criteria) { const near = criteria.near?.includes("riverfront") && lot.column < 18 ? 20 : 0; const road = Object.values(state.cells).some((cell) => cell.infrastructure === "road" && Math.abs(cell.column - lot.column) + Math.abs(cell.row - lot.row) < 4) ? 12 : 0; return near + road - Math.abs(lot.row - 25) * 0.1; }

export function getEntranceFrontageCells(state, footprintCells, direction) {
  if (!DIRECTION_OFFSETS[direction]) return [];
  const footprint = new Set(footprintCells);
  return footprintCells.flatMap((cellId) => {
    const cell = state.cells[cellId];
    if (!cell) return [];
    const frontageId = neighborId(cell, direction);
    const frontage = state.cells[frontageId];
    if (!frontage || footprint.has(frontageId) || frontage.occupancy) return [];
    if (frontage.infrastructure && frontage.infrastructure !== "road") return [];
    return [frontageId];
  }).filter((cellId, index, all) => all.indexOf(cellId) === index);
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
      if (cell?.occupancy) continue;
      if (cell?.infrastructure && cell.infrastructure !== "road") continue;
      const stepCost = cell?.infrastructure === "road" ? 0.22 : cell ? 1 : 8;
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
function buildingCostFor(footprint, archetype) { const area = getFootprintCells({ column: 0, row: 0 }, footprint).length; const landmark = /station|hall|library|academy/.test(archetype); return { coins: area * (landmark ? 90 : 45), timber: area * 8, stone: area * (landmark ? 16 : 8) }; }
function scaleCost(cost, amount) { return Object.fromEntries(Object.entries(cost).map(([key, value]) => [key, value * amount])); }
function addCosts(...costs) { return costs.reduce((sum, cost) => ({ coins: sum.coins + cost.coins, timber: sum.timber + cost.timber, stone: sum.stone + cost.stone }), { coins: 0, timber: 0, stone: 0 }); }
function subtractCosts(resources, cost) { return { coins: resources.coins - cost.coins, timber: resources.timber - cost.timber, stone: resources.stone - cost.stone }; }
