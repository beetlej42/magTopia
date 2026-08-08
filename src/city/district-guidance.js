import { cellsInBounds, connectedRoadCellIds, districtBlockForCell, districtBlockProgress, isRoadCell } from "./district-layout.js";

const CARDINALS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Return facts about the current composition. These are deliberately
 * geometry-level observations; they do not rank legal sites or veto Agent
 * decisions.
 */
export function districtSpatialObservations(state, district, progress = districtBlockProgress(state, district)) {
  const districtCells = cellsInBounds(state, district.bounds);
  const nearbyRoads = Object.values(state.cells).filter((cell) => (
    isRoadCell(state, cell.id) && cell.column >= district.bounds.minColumn - 1
      && cell.column <= district.bounds.maxColumn + 1
      && cell.row >= district.bounds.minRow - 1
      && cell.row <= district.bounds.maxRow + 1
  ));
  const nearbyRoadIds = new Set(nearbyRoads.map((cell) => cell.id));
  const connectedRoadIds = connectedRoadCellIds(state);
  const roadDegrees = nearbyRoads.map((cell) => roadNeighbors(state, cell, nearbyRoadIds).length);
  const buildings = districtBuildings(state, district);
  const buildingFrontages = buildings.map((building) => ({
    id: building.id,
    keys: frontageKeys(state, building),
    key: frontageKeys(state, building)[0] ?? null
  }));
  const frontageCounts = countValues(buildingFrontages.map((entry) => entry.key).filter(Boolean));
  const frontageTotal = Object.values(frontageCounts).reduce((sum, value) => sum + value, 0);
  const dominantFrontage = Object.entries(frontageCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? null;
  const buildableCells = districtCells.filter((cell) => (
    cell.buildable !== false && cell.strictBuildable !== false && !cell.infrastructure && !cell.node
  ));
  const occupiedBuildableCells = buildableCells.filter((cell) => cell.occupancy);
  const occupiedRatio = buildableCells.length ? occupiedBuildableCells.length / buildableCells.length : 0;
  const blockFrontages = progress.blocks.flatMap((block) => block.perimeter.sides.filter((side) => side.coverage > 0).map((side) => `${block.id}:${side.side}`));

  return {
    connected_to_city: nearbyRoads.some((cell) => connectedRoadIds.has(cell.id)),
    road_cells: nearbyRoads.length,
    road_junctions: roadDegrees.filter((degree) => degree >= 3).length,
    road_endpoints: roadDegrees.filter((degree) => degree <= 1).length,
    linear_road_risk: buildings.length >= 3 && roadDegrees.filter((degree) => degree >= 3).length === 0,
    building_count: buildings.length,
    building_clusters: countBuildingClusters(state, buildings),
    frontage_count: Object.keys(frontageCounts).length,
    frontages: Object.entries(frontageCounts).map(([key, count]) => ({ key, buildings: count })),
    dominant_frontage: dominantFrontage?.[0] ?? null,
    dominant_frontage_ratio: frontageTotal ? dominantFrontage[1] / frontageTotal : 0,
    same_frontage_streak: longestStreak(buildingFrontages.map((entry) => entry.key).filter(Boolean)),
    occupied_buildable_ratio: occupiedRatio,
    open_buildable_ratio: Math.max(0, 1 - occupiedRatio),
    shared_boundary_opportunities: sharedBoundaryRoads(state, district, nearbyRoads),
    boundary_frontages: blockFrontages,
    blocks: progress.blocks.map((block) => ({
      id: block.id,
      dimensions: { width: block.width, height: block.height },
      boundary_sides_covered: block.perimeter.sidesCovered,
      boundary_coverage: block.perimeter.coverage,
      buildings: block.counts.buildings,
      open_buildable_cells: block.counts.remainingBuildableCells,
      connected_to_city: block.access.connectedToCity,
      status: block.status
    }))
  };
}

/** Return at most two optional prompts, prioritised by spatial usefulness. */
export function districtSuggestions(state, district, observations = districtSpatialObservations(state, district)) {
  const suggestions = [];
  if (observations.road_cells === 0) {
    suggestions.push({
      code: "CONNECT_DISTRICT_TO_CITY",
      action: "connect_to_city",
      priority: "high",
      message: "This district has no nearby road yet. Consider connecting it to the existing city network, unless an intentionally secluded layout is desired."
    });
  } else if (!observations.connected_to_city) {
    suggestions.push({
      code: "CONNECT_ROAD_NETWORK",
      action: "connect_to_city",
      priority: "high",
      message: "Nearby roads are not connected to the city gateway. Consider establishing access before adding more local frontage."
    });
  }

  if (observations.linear_road_risk && observations.road_junctions === 0) {
    suggestions.push({
      code: "LINEAR_ROAD_RISK",
      action: "extend_secondary_street",
      priority: "medium",
      message: "The current composition is becoming a single linear frontage. Consider a side street, corner, loop, or public-space anchor; continuing as a deliberate linear street is also valid."
    });
  } else if (observations.building_count >= 3 && observations.dominant_frontage_ratio >= 0.7) {
    suggestions.push({
      code: "CONSIDER_SECOND_FRONTAGE",
      action: "switch_frontage",
      priority: "medium",
      message: "Most buildings currently face the same frontage. Consider developing another side or corner, unless the concentration is an intentional street character."
    });
  }

  if (observations.shared_boundary_opportunities.length > 0 && suggestions.length < 2) {
    suggestions.push({
      code: "SHARED_MAIN_ROAD",
      action: "consider_shared_boundary",
      priority: "low",
      message: "A nearby road can serve as a shared boundary for buildable space on both sides. Consider starting the next block from that road instead of duplicating a parallel street."
    });
  }

  if (observations.occupied_buildable_ratio >= 0.82 && suggestions.length < 2) {
    suggestions.push({
      code: "PRESERVE_OPEN_SPACE",
      action: "preserve_open_space",
      priority: "medium",
      message: "Buildable space is becoming highly occupied. Consider leaving a courtyard, garden, square, or future expansion reserve."
    });
  }

  return suggestions.slice(0, 2);
}

export function districtCompositionReview(state, district, progress, observations, suggestions) {
  const started = observations.road_cells > 0 || observations.building_count > 0;
  const ready = started && (
    observations.building_count >= 2
      || progress.blocks.some((block) => block.perimeter.sidesCovered >= 2)
      || observations.open_buildable_ratio <= 0.25
  );
  return {
    status: ready ? "ready_for_review" : started ? "in_progress" : "not_started",
    reasons: [
      observations.connected_to_city ? "road network reaches the city" : "city connection is not yet established",
      `${observations.building_count} building(s) occupy the district`,
      `${observations.frontage_count} distinct frontage pattern(s) are visible`,
      `${Math.round(observations.open_buildable_ratio * 100)}% of buildable space remains open`
    ],
    suggestions,
    note: "Review status is advisory. The Agent may continue, pause, preserve space, or intentionally keep a linear composition."
  };
}

function districtBuildings(state, district) {
  const bounds = district.bounds;
  return Object.values(state.buildings).filter((building) => (
    building.districtId === district.id
      || building.program?.attributes?.districtId === district.id
      || (building.footprintCells ?? []).some((cellId) => {
        const cell = state.cells[cellId];
        return cell && cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
          && cell.row >= bounds.minRow && cell.row <= bounds.maxRow;
      })
  ));
}

function frontageKeys(state, building) {
  const keys = new Set();
  for (const cellId of building.footprintCells ?? []) {
    const cell = state.cells[cellId];
    if (!cell) continue;
    for (const [dx, dy] of CARDINALS) {
      const road = state.cells[`cell-${cell.column + dx}-${cell.row + dy}`];
      if (!road || !isRoadCell(state, road.id)) continue;
      keys.add(dx === 0 ? `row:${road.row}` : `column:${road.column}`);
    }
  }
  return [...keys].sort();
}

function countBuildingClusters(state, buildings) {
  const remaining = new Set(buildings.map((building) => building.id));
  let clusters = 0;
  while (remaining.size) {
    clusters += 1;
    const startId = remaining.values().next().value;
    remaining.delete(startId);
    const queue = [buildings.find((building) => building.id === startId)];
    while (queue.length) {
      const current = queue.shift();
      for (const other of buildings) {
        if (!remaining.has(other.id) || !buildingsTouch(state, current, other)) continue;
        remaining.delete(other.id);
        queue.push(other);
      }
    }
  }
  return clusters;
}

function buildingsTouch(state, left, right) {
  const rightCells = new Set(right.footprintCells ?? []);
  return (left.footprintCells ?? []).some((cellId) => {
    const cell = state.cells[cellId];
    if (!cell) return false;
    return CARDINALS.some(([dx, dy]) => rightCells.has(`cell-${cell.column + dx}-${cell.row + dy}`));
  });
}

function sharedBoundaryRoads(state, district, roads) {
  const result = [];
  for (const road of roads) {
    const buildableNeighbors = CARDINALS.map(([dx, dy]) => state.cells[`cell-${road.column + dx}-${road.row + dy}`])
      .filter((cell) => cell && cell.buildable !== false && cell.strictBuildable !== false);
    const inside = buildableNeighbors.some((cell) => inBounds(cell, district.bounds));
    const outside = buildableNeighbors.some((cell) => !inBounds(cell, district.bounds));
    const blockIds = new Set(buildableNeighbors
      .map((cell) => districtBlockForCell(cell, district.layout)?.id)
      .filter(Boolean));
    if (buildableNeighbors.length >= 2 && ((inside && outside) || blockIds.size >= 2)) result.push(road.id);
  }
  return result;
}

function inBounds(cell, bounds) {
  return cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
    && cell.row >= bounds.minRow && cell.row <= bounds.maxRow;
}

function roadNeighbors(state, cell, roadIds) {
  return CARDINALS.map(([dx, dy]) => `cell-${cell.column + dx}-${cell.row + dy}`).filter((id) => roadIds.has(id));
}

function countValues(values) {
  return values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

function longestStreak(values) {
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const value of values) {
    current = value === previous ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = value;
  }
  return longest;
}
