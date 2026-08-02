export const CARDINAL_ROAD_DIRECTIONS = Object.freeze(["north", "east", "south", "west"]);

export const CARDINAL_ROAD_OFFSETS = Object.freeze({
  north: Object.freeze([0, -1]),
  east: Object.freeze([1, 0]),
  south: Object.freeze([0, 1]),
  west: Object.freeze([-1, 0])
});

export function roadNeighborId(cell, direction) {
  const [columnOffset, rowOffset] = CARDINAL_ROAD_OFFSETS[direction] ?? [0, 0];
  return `cell-${cell.column + columnOffset}-${cell.row + rowOffset}`;
}

/**
 * Cardinal ports are always derived from adjacent logical network cells. The
 * Agent API submits endpoints only; neither agents nor persisted state author
 * visual directions by hand.
 */
export function deriveCardinalRoadPorts(cell, network, fallbackPorts = []) {
  const hasCoordinate = network instanceof Map
    ? (column, row) => network.has(`${column}:${row}`)
    : network instanceof Set
      ? (column, row) => network.has(`cell-${column}-${row}`)
      : typeof network === "function"
        ? (column, row) => Boolean(network(`cell-${column}-${row}`, column, row))
        : () => false;
  const ports = CARDINAL_ROAD_DIRECTIONS.filter((direction) => {
    const [columnOffset, rowOffset] = CARDINAL_ROAD_OFFSETS[direction];
    return hasCoordinate(cell.column + columnOffset, cell.row + rowOffset);
  });
  if (!ports.length) ports.push(...fallbackPorts);
  return ports;
}

export function agentNorthIsPositiveWorldZ(coordinateSystem = null) {
  const declaredNorth = coordinateSystem?.worldAxes?.north;
  if (declaredNorth === "-z") return false;
  return true;
}

export const AGENT_VOXEL_ROAD_RENDER_CONTRACT = Object.freeze({
  infrastructureRenderer: "state-driven-voxel-road-v2-victorian-bridges",
  roadAsset: "shared-victorian-voxel-road-tile-v1",
  topologySource: "adjacent-logical-network-cells",
  directionAuthority: "coordinate-system-cardinal-offsets",
  agentSuppliesVisualDirections: false,
  bridgeRenderer: "adaptive-victorian-voxel-bridge-spans"
});
