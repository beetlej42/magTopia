import * as THREE from "three";
import {
  AGENT_VOXEL_ROAD_RENDER_CONTRACT,
  CARDINAL_ROAD_OFFSETS,
  agentNorthIsPositiveWorldZ,
  deriveCardinalRoadPorts
} from "../city/road-topology.js";
import { createRng, randRange } from "../utils/random.js";
import { VoxelInstanceBuffer, VOXEL_SIZE, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";
import { addSharedVoxelRoadTile, classifyVoxelRoadTopology } from "./voxelIntentDistrict.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const CELL_VOXELS = 32;
const ROAD_WIDTH = 16;
const ROAD_INSET = (CELL_VOXELS - ROAD_WIDTH) / 2;
const BRIDGE_DECK_WIDTH = 30;
const BRIDGE_WALKWAY_WIDTH = 7;
export function createAgentVoxelRoadLayer({ state, grid, seed = "agent-roads" }) {
  const group = new THREE.Group();
  group.name = "AgentVoxelRoads";
  const buffer = new VoxelInstanceBuffer(`${seed}:voxel-roads`);
  const isNetworkCell = (cell) => state.cells[cell.id]?.infrastructure === "road" || state.infrastructure?.[cell.id]?.type === "bridge";
  const roadCells = grid.cells.filter(isNetworkCell);
  const roadsByCoordinate = new Map(roadCells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const bridgeCells = roadCells.filter((cell) => state.infrastructure?.[cell.id]?.type === "bridge");
  const bridgeCellIds = new Set(bridgeCells.map((cell) => cell.id));
  const bridgeSpans = collectBridgeSpans(bridgeCells, roadsByCoordinate);
  const topologyCounts = {};
  const renderedRoadPorts = {};
  const roadAssetCounts = { curbVoxels: 0, markingVoxels: 0, wearVoxels: 0, lampCount: 0 };
  const northIsPositiveZ = agentNorthIsPositiveWorldZ(state.world?.coordinateSystem);

  roadCells.forEach((cell, index) => {
    const ports = deriveCardinalRoadPorts(cell, roadsByCoordinate);
    renderedRoadPorts[cell.id] = ports;
    const topology = classifyVoxelRoadTopology(ports);
    topologyCounts[topology] = (topologyCounts[topology] ?? 0) + 1;
    const isBridge = bridgeCellIds.has(cell.id);

    const minX = Math.round((cell.center.x - 2) / VOXEL_SIZE);
    const minZ = Math.round((cell.center.z - 2) / VOXEL_SIZE);
    const surfaceY = Number(cell.surface?.maxElevationVoxels ?? 0) + 1;
    // Bridge spans are graded and authored as one continuous structure below.
    // Treating each water cell like a terrain tile creates a visibly stepped
    // road because shore cells and deep-water cells have different elevations.
    if (isBridge) return;

    const assetDiagnostics = addSharedVoxelRoadTile(buffer, {
      minX,
      minZ,
      surfaceY,
      ports,
      tileIndex: index,
      owner: cell.id,
      // Agent-world rows decrease toward +Z, opposite the authored district
      // layout. This flag is what fixes the formerly reversed N/S road arms.
      northIsPositiveZ
    });
    Object.keys(roadAssetCounts).forEach((key) => { roadAssetCounts[key] += assetDiagnostics[key] ?? 0; });
  });

  const renderedBridgeSpans = bridgeSpans.map((span, index) => addVictorianBridgeSpan({
    buffer,
    span,
    roadsByCoordinate,
    seed: `${seed}:bridge:${span.cells[0]?.id ?? index}`,
    shade: roadCells.length + index * 97
  }));
  const bridgeStyles = renderedBridgeSpans.reduce((counts, span) => {
    counts[span.style] = (counts[span.style] ?? 0) + 1;
    return counts;
  }, {});

  buffer.createMeshes({ strategy: "greedy", chunkSizeVoxels: 128, maxMergeSpanVoxels: 16 }).forEach((mesh) => group.add(mesh));
  group.userData.contract = {
    renderer: AGENT_VOXEL_ROAD_RENDER_CONTRACT.infrastructureRenderer,
    roadCellCount: roadCells.length,
    bridgeCellCount: bridgeCells.length,
    bridgeSpanCount: renderedBridgeSpans.length,
    bridgeStyles,
    bridgeSpans: renderedBridgeSpans,
    adaptiveSpanRules: true,
    roadAsset: AGENT_VOXEL_ROAD_RENDER_CONTRACT.roadAsset,
    topologySource: AGENT_VOXEL_ROAD_RENDER_CONTRACT.topologySource,
    agentSuppliesVisualDirections: AGENT_VOXEL_ROAD_RENDER_CONTRACT.agentSuppliesVisualDirections,
    northIsPositiveWorldZ: northIsPositiveZ,
    renderedRoadPorts,
    ...roadAssetCounts,
    renderedRoadTopologies: topologyCounts,
    voxelCount: buffer.occupiedVoxelCount,
    renderStats: buffer.renderStats
  };
  group.userData.updateDaylight = () => {};
  return group;
}

function collectBridgeSpans(bridgeCells, roadsByCoordinate) {
  const pending = new Map(bridgeCells.map((cell) => [cell.id, cell]));
  const spans = [];
  while (pending.size) {
    const first = pending.values().next().value;
    const component = [];
    const queue = [first];
    pending.delete(first.id);
    while (queue.length) {
      const cell = queue.shift();
      component.push(cell);
      Object.values(CARDINAL_ROAD_OFFSETS).forEach(([dc, dr]) => {
        const neighbor = roadsByCoordinate.get(`${cell.column + dc}:${cell.row + dr}`);
        if (neighbor && pending.has(neighbor.id)) {
          pending.delete(neighbor.id);
          queue.push(neighbor);
        }
      });
    }
    const columns = component.map((cell) => cell.column);
    const rows = component.map((cell) => cell.row);
    const columnSpan = Math.max(...columns) - Math.min(...columns);
    const rowSpan = Math.max(...rows) - Math.min(...rows);
    // Water crossings generated by the route solver are normally straight.
    // A dominant-axis fallback still produces a coherent deck for a rare bend.
    const axis = columnSpan >= rowSpan ? "x" : "z";
    component.sort((a, b) => axis === "x" ? a.column - b.column : a.row - b.row);
    spans.push({ axis, cells: component });
  }
  return spans;
}

function addVictorianBridgeSpan({ buffer, span, roadsByCoordinate, seed, shade }) {
  const rng = createRng(seed);
  const { axis, cells } = span;
  const alongValues = cells.map((cell) => cellVoxelBounds(cell)[axis === "x" ? "minX" : "minZ"]);
  const crossValues = cells.map((cell) => cellVoxelBounds(cell)[axis === "x" ? "minZ" : "minX"]);
  const alongStart = Math.min(...alongValues);
  const alongLength = Math.max(...alongValues) - alongStart + CELL_VOXELS;
  const crossStart = Math.round(crossValues.reduce((total, value) => total + value, 0) / crossValues.length);
  const approachCells = findBridgeApproaches(span, roadsByCoordinate);
  const gradingCells = [...cells, ...approachCells];
  const roadY = Math.max(...gradingCells.map((cell) => Number(cell.surface?.maxElevationVoxels ?? 0) + 1));
  const waterY = Math.min(...cells.map((cell) => Number(cell.surface?.minElevationVoxels ?? roadY - 6)));
  const baseY = Math.min(roadY - 4, waterY);
  const style = selectVictorianBridgeStyle(seed, cells.length);
  const structureWrite = { priority: VOXEL_WRITE_PRIORITIES.structure, owner: `bridge:${cells[0]?.id}` };
  const detailWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: `bridge:${cells[0]?.id}:detail` };
  const lightWrite = { priority: VOXEL_WRITE_PRIORITIES.effect, owner: `bridge:${cells[0]?.id}:light` };
  const context = {
    buffer,
    axis,
    alongStart,
    alongLength,
    crossStart,
    roadY,
    baseY,
    shade,
    rng,
    structureWrite,
    detailWrite,
    lightWrite
  };

  addBridgeDeck(context);
  addBridgeAbutments(context);
  if (style === "masonry_arch") addMasonryArchBridge(context);
  else if (style === "iron_truss") addIronTrussBridge(context);
  else addSuspensionBridge(context);

  return {
    id: `bridge-span-${cells[0]?.id}`,
    style,
    axis,
    cellCount: cells.length,
    spanVoxels: alongLength,
    spanWorldUnits: alongLength * VOXEL_SIZE,
    deckVoxelY: roadY,
    waterVoxelY: waterY,
    railings: true,
    abutments: true,
    piers: style !== "suspension_bridge" || cells.length >= 3,
    suspensionCables: style === "suspension_bridge"
  };
}

export function selectVictorianBridgeStyle(seed, spanCellCount) {
  const count = Math.max(1, Number(spanCellCount) || 1);
  const candidates = count <= 1
    ? ["masonry_arch", "iron_truss"]
    : count === 2
      ? ["masonry_arch", "iron_truss", "masonry_arch"]
      : count <= 4
        ? ["iron_truss", "suspension_bridge", "masonry_arch"]
        : ["suspension_bridge", "iron_truss", "suspension_bridge", "masonry_arch"];
  const rng = createRng(seed);
  return candidates[Math.floor(rng() * candidates.length) % candidates.length];
}

function findBridgeApproaches(span, roadsByCoordinate) {
  const { axis, cells } = span;
  const first = cells[0];
  const last = cells.at(-1);
  const offsets = axis === "x"
    ? [[-1, 0, first], [1, 0, last]]
    : [[0, -1, first], [0, 1, last]];
  return offsets
    .map(([dc, dr, cell]) => roadsByCoordinate.get(`${cell.column + dc}:${cell.row + dr}`))
    .filter(Boolean);
}

function cellVoxelBounds(cell) {
  return {
    minX: Math.round((cell.center.x - 2) / VOXEL_SIZE),
    minZ: Math.round((cell.center.z - 2) / VOXEL_SIZE)
  };
}

function addBridgeDeck(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, shade, structureWrite, detailWrite } = context;
  const deckCross = crossStart + (CELL_VOXELS - BRIDGE_DECK_WIDTH) / 2;
  const roadCross = crossStart + ROAD_INSET;
  addOrientedBox(buffer, axis, "stoneShadow", alongStart, roadY - 2, deckCross, alongLength, 2, BRIDGE_DECK_WIDTH, shade, structureWrite);
  addOrientedBox(buffer, axis, "pavement", alongStart, roadY, deckCross, alongLength, 1, BRIDGE_WALKWAY_WIDTH, shade + 1, structureWrite);
  addOrientedBox(buffer, axis, "road", alongStart, roadY, roadCross, alongLength, 1, ROAD_WIDTH, shade + 2, structureWrite);
  addOrientedBox(buffer, axis, "pavement", alongStart, roadY, roadCross + ROAD_WIDTH, alongLength, 1, BRIDGE_WALKWAY_WIDTH, shade + 3, structureWrite);
  // Pale kerbs clearly separate the carriageway from the footways.
  addOrientedBox(buffer, axis, "limestone", alongStart, roadY + 1, roadCross - 1, alongLength, 1, 1, shade + 4, detailWrite);
  addOrientedBox(buffer, axis, "limestone", alongStart, roadY + 1, roadCross + ROAD_WIDTH, alongLength, 1, 1, shade + 5, detailWrite);
}

function addBridgeAbutments(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, baseY, shade, structureWrite } = context;
  const height = Math.max(2, roadY - 2 - baseY);
  const endDepth = Math.min(5, Math.max(3, Math.round(alongLength * 0.08)));
  addOrientedBox(buffer, axis, "sandstone", alongStart, baseY, crossStart, endDepth, height, CELL_VOXELS, shade + 6, structureWrite);
  addOrientedBox(buffer, axis, "sandstone", alongStart + alongLength - endDepth, baseY, crossStart, endDepth, height, CELL_VOXELS, shade + 7, structureWrite);
  addOrientedBox(buffer, axis, "limestone", alongStart - 1, roadY - 2, crossStart, endDepth + 2, 1, CELL_VOXELS, shade + 8, structureWrite);
  addOrientedBox(buffer, axis, "limestone", alongStart + alongLength - endDepth - 1, roadY - 2, crossStart, endDepth + 2, 1, CELL_VOXELS, shade + 9, structureWrite);
}

function addMasonryArchBridge(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, baseY, shade, structureWrite, detailWrite } = context;
  const bayCount = Math.max(1, Math.min(4, Math.round(alongLength / 46)));
  const sideCrosses = [crossStart + 1, crossStart + CELL_VOXELS - 3];
  const boundaries = Array.from({ length: bayCount + 1 }, (_, index) => Math.round(alongStart + alongLength * index / bayCount));

  sideCrosses.forEach((sideCross, sideIndex) => {
    for (let bay = 0; bay < bayCount; bay += 1) {
      const start = boundaries[bay];
      const end = boundaries[bay + 1];
      const center = (start + end) / 2;
      const radius = Math.max(4, (end - start) / 2 - 2);
      for (let along = start; along < end; along += 1) {
        const normalized = Math.min(1, Math.abs(along + 0.5 - center) / radius);
        const archRise = Math.sqrt(Math.max(0, 1 - normalized * normalized));
        const ceilingY = Math.round(baseY + 1 + archRise * Math.max(2, roadY - baseY - 4));
        addOrientedBox(buffer, axis, bay % 2 ? "stoneShadow" : "sandstone", along, ceilingY, sideCross, 1, Math.max(1, roadY - ceilingY), 2, shade + bay + sideIndex, structureWrite);
      }
    }
  });

  boundaries.forEach((position, index) => {
    const pierAlong = Math.max(alongStart, Math.min(alongStart + alongLength - 4, position - 2));
    addOrientedBox(buffer, axis, index % 2 ? "stoneShadow" : "sandstone", pierAlong, baseY, crossStart + 1, 4, Math.max(2, roadY - baseY - 1), 30, shade + 20 + index, structureWrite);
    addOrientedBox(buffer, axis, "limestone", pierAlong - 1, baseY, crossStart, 6, 2, 32, shade + 30 + index, structureWrite);
  });
  addStoneAndIronRailings(context);
  addBridgeLamps(context, Math.max(24, Math.round(alongLength / (bayCount + 1))), detailWrite);
}

function addIronTrussBridge(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, baseY, shade, structureWrite, detailWrite } = context;
  const sides = [crossStart + 1, crossStart + CELL_VOXELS - 2];
  const topY = roadY + Math.min(12, Math.max(8, Math.round(alongLength * 0.1)));
  sides.forEach((cross, sideIndex) => {
    addOrientedBox(buffer, axis, "iron", alongStart, roadY + 2, cross, alongLength, 2, 1, shade + sideIndex, detailWrite);
    addOrientedBox(buffer, axis, "iron", alongStart, topY, cross, alongLength, 2, 1, shade + 2 + sideIndex, detailWrite);
    const panel = Math.max(10, Math.min(16, Math.round(alongLength / Math.max(2, Math.round(alongLength / 14)))));
    for (let position = alongStart; position <= alongStart + alongLength; position += panel) {
      const clamped = Math.min(alongStart + alongLength - 1, position);
      addOrientedBox(buffer, axis, "iron", clamped, roadY + 2, cross, 2, topY - roadY, 1, shade + position, detailWrite);
    }
    for (let position = alongStart; position < alongStart + alongLength; position += panel) {
      const end = Math.min(alongStart + alongLength - 1, position + panel);
      const rising = Math.floor((position - alongStart) / panel) % 2 === 0;
      addOrientedLine(buffer, axis, "patinaMetal", position, rising ? roadY + 3 : topY, cross, end, rising ? topY : roadY + 3, shade + position + sideIndex, detailWrite);
    }
  });
  const pierCount = Math.max(0, Math.floor((alongLength - 1) / 64));
  for (let index = 1; index <= pierCount; index += 1) {
    const position = Math.round(alongStart + alongLength * index / (pierCount + 1)) - 2;
    addOrientedBox(buffer, axis, "stoneShadow", position, baseY, crossStart + 4, 5, Math.max(2, roadY - baseY - 1), 24, shade + 40 + index, structureWrite);
    addOrientedBox(buffer, axis, "limestone", position - 1, baseY, crossStart + 3, 7, 2, 26, shade + 50 + index, structureWrite);
  }
  addIronRailings(context);
  addBridgeLamps(context, Math.max(32, Math.round(alongLength / 3)), detailWrite);
}

function addSuspensionBridge(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, baseY, shade, structureWrite, detailWrite, lightWrite } = context;
  const towerInset = Math.max(7, Math.min(14, Math.round(alongLength * 0.12)));
  const leftTower = alongStart + towerInset;
  const rightTower = alongStart + alongLength - towerInset - 3;
  const towerTop = roadY + Math.min(18, Math.max(14, Math.round(alongLength * 0.14)));
  const towerCrosses = [crossStart + 2, crossStart + CELL_VOXELS - 5];

  [leftTower, rightTower].forEach((towerAlong, towerIndex) => {
    towerCrosses.forEach((towerCross, sideIndex) => {
      addOrientedBox(buffer, axis, "sandstone", towerAlong, baseY, towerCross, 3, towerTop - baseY + 1, 3, shade + towerIndex * 5 + sideIndex, structureWrite);
      addOrientedBox(buffer, axis, "limestone", towerAlong - 1, roadY + 5, towerCross - 1, 5, 2, 5, shade + 10 + towerIndex + sideIndex, detailWrite);
      addOrientedBox(buffer, axis, "limestone", towerAlong - 1, towerTop, towerCross - 1, 5, 2, 5, shade + 14 + towerIndex + sideIndex, detailWrite);
      addOrientedBox(buffer, axis, "warmWindow", towerAlong, towerTop + 2, towerCross, 3, 3, 3, shade + 18 + towerIndex + sideIndex, lightWrite);
    });
    addOrientedBox(buffer, axis, "iron", towerAlong, towerTop - 2, crossStart + 5, 3, 2, CELL_VOXELS - 10, shade + 22 + towerIndex, detailWrite);
  });

  const cableCrosses = [crossStart, crossStart + CELL_VOXELS - 1];
  cableCrosses.forEach((cross, sideIndex) => {
    let previous = null;
    for (let along = alongStart; along < alongStart + alongLength; along += 2) {
      const cableY = suspensionCableHeight(along, alongStart, alongLength, leftTower + 1, rightTower + 1, roadY, towerTop);
      if (previous) addOrientedLine(buffer, axis, "iron", previous.along, previous.y, cross, along, cableY, shade + along + sideIndex, detailWrite);
      if ((along - alongStart) % 8 === 0 && along > leftTower && along < rightTower + 3) {
        addOrientedBox(buffer, axis, "iron", along, roadY + 3, cross, 1, Math.max(1, cableY - roadY - 2), 1, shade + 30 + along, detailWrite);
      }
      previous = { along, y: cableY };
    }
  });
  // The tower foundations read as proper river piers rather than unsupported posts.
  [leftTower, rightTower].forEach((position, index) => {
    addOrientedBox(buffer, axis, "stoneShadow", position - 1, baseY, crossStart + 1, 5, Math.max(2, roadY - baseY - 1), 30, shade + 60 + index, structureWrite);
    addOrientedBox(buffer, axis, "limestone", position - 2, baseY, crossStart, 7, 2, 32, shade + 64 + index, structureWrite);
  });
  addIronRailings(context);
}

function suspensionCableHeight(along, start, length, leftTower, rightTower, roadY, towerTop) {
  const end = start + length - 1;
  if (along <= leftTower) {
    const t = (along - start) / Math.max(1, leftTower - start);
    return Math.round(roadY + 4 + (towerTop - roadY - 4) * t);
  }
  if (along >= rightTower) {
    const t = (end - along) / Math.max(1, end - rightTower);
    return Math.round(roadY + 4 + (towerTop - roadY - 4) * t);
  }
  const t = (along - leftTower) / Math.max(1, rightTower - leftTower);
  const towerHeight = towerTop - roadY;
  const sagHeight = Math.max(7, Math.round(towerHeight * 0.48));
  const parabola = (2 * t - 1) ** 2;
  return Math.round(roadY + sagHeight + (towerHeight - sagHeight) * parabola);
}

function addStoneAndIronRailings(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, shade, detailWrite } = context;
  [crossStart + 1, crossStart + CELL_VOXELS - 2].forEach((cross, sideIndex) => {
    addOrientedBox(buffer, axis, "sandstone", alongStart, roadY + 1, cross, alongLength, 2, 1, shade + sideIndex, detailWrite);
    addOrientedBox(buffer, axis, "limestone", alongStart, roadY + 5, cross, alongLength, 1, 1, shade + 2 + sideIndex, detailWrite);
    for (let position = alongStart; position < alongStart + alongLength; position += 10) {
      addOrientedBox(buffer, axis, "sandstone", position, roadY + 1, cross, 2, 5, 2, shade + position, detailWrite);
    }
  });
}

function addIronRailings(context) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, shade, detailWrite } = context;
  [crossStart + 1, crossStart + CELL_VOXELS - 2].forEach((cross, sideIndex) => {
    addOrientedBox(buffer, axis, "iron", alongStart, roadY + 2, cross, alongLength, 1, 1, shade + sideIndex, detailWrite);
    addOrientedBox(buffer, axis, "iron", alongStart, roadY + 6, cross, alongLength, 1, 1, shade + 2 + sideIndex, detailWrite);
    for (let position = alongStart; position < alongStart + alongLength; position += 8) {
      addOrientedBox(buffer, axis, position % 16 ? "iron" : "patinaMetal", position, roadY + 1, cross, 1, 6, 1, shade + position, detailWrite);
    }
  });
}

function addBridgeLamps(context, spacing, detailWrite) {
  const { buffer, axis, alongStart, alongLength, crossStart, roadY, shade, lightWrite } = context;
  const positions = [];
  for (let along = alongStart + Math.round(spacing / 2); along < alongStart + alongLength; along += spacing) positions.push(along);
  positions.forEach((along, index) => {
    const cross = index % 2 === 0 ? crossStart + 3 : crossStart + CELL_VOXELS - 4;
    addOrientedBox(buffer, axis, "iron", along, roadY + 1, cross, 1, 9, 1, shade + 70 + index, detailWrite);
    addOrientedBox(buffer, axis, "warmWindow", along - 1, roadY + 9, cross - 1, 3, 3, 3, shade + 80 + index, lightWrite);
    addOrientedBox(buffer, axis, "iron", along - 1, roadY + 12, cross - 1, 3, 1, 3, shade + 90 + index, detailWrite);
  });
}

function addOrientedBox(buffer, axis, material, along, y, cross, alongLength, height, crossWidth, shade, write) {
  if (axis === "x") buffer.addBox(material, along, y, cross, alongLength, height, crossWidth, shade, write);
  else buffer.addBox(material, cross, y, along, crossWidth, height, alongLength, shade, write);
}

function addOrientedLine(buffer, axis, material, alongA, yA, cross, alongB, yB, shade, write) {
  const steps = Math.max(1, Math.abs(Math.round(alongB - alongA)), Math.abs(Math.round(yB - yA)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const along = Math.round(alongA + (alongB - alongA) * t);
    const y = Math.round(yA + (yB - yA) * t);
    if (axis === "x") buffer.addVoxel(material, along, y, cross, shade + step, write);
    else buffer.addVoxel(material, cross, y, along, shade + step, write);
  }
}

export function createAgentVoxelVegetationPlan({ state, grid, seed = "agent-vegetation" }) {
  const blocked = new Set();
  const occupied = [];
  Object.values(state.cells).forEach((cell) => {
    if (cell.occupancy || cell.infrastructure || state.infrastructure?.[cell.id] || cell.reservation || !cell.strictBuildable) {
      blocked.add(cell.id);
      occupied.push(cell);
    }
  });
  // Leave a one-cell visual safety margin around construction and roads so the
  // foliage never obscures an entrance or makes a connected road look blocked.
  occupied.forEach((cell) => {
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) blocked.add(`cell-${cell.column + dc}-${cell.row + dr}`);
    }
  });

  const cellWorldSize = Number(grid.cellWorldSize ?? 4);
  const clusterRecords = new Map();
  const recordFor = (clusterColumn, clusterRow) => {
    const key = `${clusterColumn}:${clusterRow}`;
    let record = clusterRecords.get(key);
    if (!record) {
      const rng = createRng(`${seed}:voxel-vegetation-cluster:${key}`);
      const inset = 0.15;
      const span = CLUSTER_SIZE - inset * 2;
      record = {
        id: key,
        clusterColumn,
        clusterRow,
        coreAnchored: { column: clusterColumn * CLUSTER_SIZE + (inset + rng() * span), row: clusterRow * CLUSTER_SIZE + (inset + rng() * span) },
        sparse: rng() < SPARSE_POCKET_FRACTION,
        radius: CLUSTER_SIZE * cellWorldSize * CLUSTER_RADIUS_FRACTION,
        falloff: CLUSTER_FALLOFF,
        entries: []
      };
      clusterRecords.set(key, record);
    }
    return record;
  };
  const worldAnchorForCell = (cell, record) => ({
    x: cell.center.x + (record.coreAnchored.column - cell.column) * cellWorldSize,
    z: cell.center.z + (record.coreAnchored.row - cell.row) * cellWorldSize
  });
  const densityFor = (cell) => {
    const clusterColumn = Math.floor(cell.column / CLUSTER_SIZE);
    const clusterRow = Math.floor(cell.row / CLUSTER_SIZE);
    let best = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const record = recordFor(clusterColumn + columnOffset, clusterRow + rowOffset);
        const anchor = worldAnchorForCell(cell, record);
        const distance = Math.hypot(cell.center.x - anchor.x, cell.center.z - anchor.z);
        let factor = 1 - distance / record.radius;
        if (factor < 0) factor = 0;
        factor = Math.pow(factor, record.falloff);
        if (record.sparse) factor *= SPARSE_POCKET_DENSITY;
        if (factor > best) best = factor;
      }
    }
    return best;
  };

  const plan = {
    trees: [],
    shrubs: [],
    clusters: [],
    zoneCounts: { meadow: 0, heath: 0, woodland: 0 },
    vegetatedCells: 0,
    skippedExcluded: 0
  };

  grid.cells.forEach((cell) => {
    if (blocked.has(cell.id) || !cell.strictBuildable) {
      plan.skippedExcluded += 1;
      return;
    }
    const biome = cell.surface?.biome ?? "meadow";
    if (biome !== "meadow" && biome !== "heath" && biome !== "woodland") {
      plan.skippedExcluded += 1;
      return;
    }
    plan.zoneCounts[biome] += 1;
    plan.vegetatedCells += 1;
    const record = recordFor(Math.floor(cell.column / CLUSTER_SIZE), Math.floor(cell.row / CLUSTER_SIZE));
    const density = densityFor(cell);
    record.entries.push({ cellId: cell.id, cell, biome, density });
  });

  clusterRecords.forEach((record) => {
    if (!record.entries.length) return;
    const ordered = record.entries.slice().sort((a, b) => {
      const anchorA = worldAnchorForCell(a.cell, record);
      const anchorB = worldAnchorForCell(b.cell, record);
      const distanceA = Math.hypot(a.cell.center.x - anchorA.x, a.cell.center.z - anchorA.z);
      const distanceB = Math.hypot(b.cell.center.x - anchorB.x, b.cell.center.z - anchorB.z);
      return distanceA - distanceB || (a.cellId < b.cellId ? -1 : a.cellId > b.cellId ? 1 : 0);
    });
    const anchor = worldAnchorForCell(ordered[0].cell, record);
    const byBiome = new Map();
    ordered.forEach((entry) => {
      if (!byBiome.has(entry.biome)) byBiome.set(entry.biome, []);
      byBiome.get(entry.biome).push(entry);
    });
    const groups = [...byBiome.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    const hasWoodland = groups.some(([biome]) => biome === "woodland");
    const zoneGroups = groups.map(([biome, entries]) => generateAgentTreeGroup(plan, record, anchor, biome, entries, seed, hasWoodland));
    plan.clusters.push({
      id: record.id,
      coreX: anchor.x,
      coreZ: anchor.z,
      coreColumn: record.coreAnchored.column - record.clusterColumn * CLUSTER_SIZE,
      coreRow: record.coreAnchored.row - record.clusterRow * CLUSTER_SIZE,
      radius: record.radius,
      sparse: record.sparse,
      cellIds: ordered.map((entry) => entry.cellId),
      zoneGroups
    });
  });

  return plan;
}

export function createAgentVoxelVegetationLayer({ state, grid, seed = "agent-vegetation" }) {
  const group = new THREE.Group();
  group.name = "AgentVoxelVegetation";
  const perf = { planMs: 0, treeInstanceMs: 0, shrubVoxelMs: 0, shrubMeshMs: 0, buildMs: 0 };
  const startedAt = now();
  const plan = createAgentVoxelVegetationPlan({ state, grid, seed });
  perf.planMs = now() - startedAt;

  const archetypeCounts = {};
  const templateCounts = {};
  const tierCounts = { dominant: 0, regular: 0, small: 0 };
  const treesByTemplate = new Map();
  plan.trees.forEach((tree) => {
    archetypeCounts[tree.archetype] = (archetypeCounts[tree.archetype] ?? 0) + 1;
    templateCounts[tree.template] = (templateCounts[tree.template] ?? 0) + 1;
    tierCounts[tree.sizeClass] = (tierCounts[tree.sizeClass] ?? 0) + 1;
    if (!treesByTemplate.has(tree.template)) treesByTemplate.set(tree.template, []);
    treesByTemplate.get(tree.template).push(tree);
  });

  // Trees use shared pre-generated meshes + instanced transforms so the
  // million-voxel cost of repeated large crowns never reach the greedy voxel
  // pipeline. Shrubs stay on the cheap voxel path below.
  const treeMaterial = createTreeInstanceMaterial();
  const treeDummy = new THREE.Object3D();
  const treeMeshes = [];
  let treeTriangles = 0;
  const treeStartedAt = now();
  treesByTemplate.forEach((trees, templateId) => {
    const geometry = buildTreeGeometry(templateId);
    const mesh = new THREE.InstancedMesh(geometry, treeMaterial, trees.length);
    mesh.name = `TreeInstances-${templateId}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const geometryTriangles = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    treeTriangles += Math.round(geometryTriangles * trees.length);
    trees.forEach((tree, index) => {
      treeDummy.position.set(tree.x * VOXEL_SIZE, tree.y * VOXEL_SIZE, tree.z * VOXEL_SIZE);
      treeDummy.rotation.set(0, tree.rotation, 0);
      treeDummy.scale.setScalar(tree.scale);
      treeDummy.updateMatrix();
      mesh.setMatrixAt(index, treeDummy.matrix);
      mesh.setColorAt(index, treeTint(tree));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    treeMeshes.push(mesh);
    group.add(mesh);
  });
  perf.treeInstanceMs = now() - treeStartedAt;

  const buffer = new VoxelInstanceBuffer(`${seed}:voxel-vegetation-shrubs`);
  const fillStartedAt = now();
  plan.shrubs.forEach((shrub) => {
    const write = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: shrub.cellId };
    addVoxelShrub(buffer, shrub.x, shrub.y, shrub.z, shrub.shade, write, shrub.blossom);
  });
  perf.shrubVoxelMs = now() - fillStartedAt;
  const shrubMsStartedAt = now();
  const shrubMeshes = buffer.createMeshes({ strategy: "greedy", chunkSizeVoxels: 256, maxMergeSpanVoxels: 24 });
  perf.shrubMeshMs = now() - shrubMsStartedAt;
  shrubMeshes.forEach((mesh) => group.add(mesh));

  const meshes = [...treeMeshes, ...shrubMeshes];
  perf.buildMs = now() - startedAt;

  group.userData.contract = {
    renderer: "state-aware-voxel-vegetation-v3-groves",
    instancedTrees: true,
    clusters: plan.clusters.length,
    clusterGroups: plan.clusters.reduce((total, cluster) => total + cluster.zoneGroups.length, 0),
    groveCount: plan.clusters.reduce((total, cluster) => total + cluster.zoneGroups.filter((group) => group.treeCount >= 2).length, 0),
    vegetatedCells: plan.vegetatedCells,
    biomeCounts: plan.zoneCounts,
    trees: plan.trees.length,
    shrubs: plan.shrubs.length,
    flowers: plan.shrubs.reduce((total, shrub) => total + (shrub.blossom ? 1 : 0), 0),
    tierCounts,
    archetypeCounts,
    templateCounts,
    treeFamilies: Object.keys(archetypeCounts).sort(),
    treeMeshCount: treeMeshes.length,
    templates: TEMPLATE_IDS.map((templateId) => {
      const spec = TREE_TEMPLATES[templateId];
      const widths = spec.mounds.map((mound) => mound.w);
      const highest = spec.mounds.reduce((best, mound) => (mound.baseY > best.baseY ? mound : best), spec.mounds[0]);
      return {
        id: templateId,
        family: spec.family,
        moundCount: spec.mounds.length,
        maxSteps: Math.max(...spec.mounds.map((mound) => mound.steps ?? 1)),
        branches: (spec.branches ?? []).length,
        taper: widths.length ? Number((highest.w / Math.max(...widths)).toFixed(3)) : 1
      };
    }),
    voxelCount: buffer.occupiedVoxelCount,
    renderStats: {
      trees: {
        strategy: "instanced-tree-mesh",
        drawCalls: treeMeshes.length,
        instances: plan.trees.length,
        meshes: treeMeshes.length,
        renderedTriangles: treeTriangles
      },
      shrubs: buffer.renderStats
    },
    perf,
    clearsRoadsAndEntrances: true,
    exclusionRule: "Buildings, roads, infrastructure, reservations, non-buildable cells, and a one-cell safety margin suppress procedural vegetation.",
    compositionRule: "Sculpted voxel broadleaf groves (broad, round, tall families, two shared templates each) with dominant/regular/support tiers; grid-aligned 90-degree rotation; low vegetation is subordinate grove detail."
  };
  group.userData.updateDaylight = () => {};
  group.userData.updateView = (camera) => {
    if (!camera || !meshes.length) return;
    const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
    const viewPosition = new THREE.Vector3();
    meshes.forEach((mesh) => {
      viewPosition.setFromMatrixPosition(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      mesh.visible = viewPosition.z < 0 && frustum.intersectsObject(mesh);
    });
  };
  return group;
}

function generateAgentTreeGroup(plan, record, anchor, biome, entries, seed, edge = false) {
  const density = Math.max(...entries.map((entry) => entry.density));
  const rng = createRng(`${seed}:voxel-vegetation-trees:${record.id}:${biome}`);
  const count = agentTreeCountFor(biome, density, rng, edge);
  const shadeBase = Math.floor(randRange(rng, 0, 60));
  const anchorX = anchor.x / VOXEL_SIZE;
  const anchorZ = anchor.z / VOXEL_SIZE;
  const ranked = [];
  for (let index = 0; index < count; index += 1) {
    const host = weightedAgentHost(entries, rng);
    const family = pickFamily(rng);
    const templateId = pickTemplate(rng, family);
    const sizeClass = assignTier(rng);
    const scale = TIER_BASE_SCALE[sizeClass] + randRange(rng, -0.06, 0.06);
    const centerX = host.cell.center.x / VOXEL_SIZE;
    const centerZ = host.cell.center.z / VOXEL_SIZE;
    const pull = 0.35 + 0.4 * host.density;
    const bound = CELL_VOXELS / 2 - 4;
    const treeX = clamp(centerX + (anchorX - centerX) * pull * 0.5 + randRange(rng, -9, 9), centerX - bound, centerX + bound);
    const treeZ = clamp(centerZ + (anchorZ - centerZ) * pull * 0.5 + randRange(rng, -9, 9), centerZ - bound, centerZ + bound);
    const treeY = Number(host.cell.surface?.maxElevationVoxels ?? 0) + 1;
    const metrics = archetypeMetrics(templateId, scale);
    const tree = {
      cellId: host.cellId,
      biome: host.biome,
      x: treeX,
      y: treeY,
      z: treeZ,
      family,
      template: templateId,
      archetype: family,
      scale,
      sizeClass,
      rotation: gridRotation(rng, family),
      shade: shadeBase + index * 3,
      heightVoxels: metrics.height,
      crownWidth: metrics.crownWidth,
      trunkWidth: metrics.trunkWidth
    };
    plan.trees.push(tree);
    ranked.push(tree);
  }

  const shrubCount = agentShrubCountFor(biome, density, count, rng);
  let shrubFlowerCount = 0;
  for (let index = 0; index < shrubCount; index += 1) {
    const host = weightedAgentHost(entries, rng);
    const centerX = host.cell.center.x / VOXEL_SIZE;
    const centerZ = host.cell.center.z / VOXEL_SIZE;
    const bound = CELL_VOXELS / 2 - 4;
    const shrubX = clamp(centerX + (anchorX - centerX) * 0.25 + randRange(rng, -12, 12), centerX - bound, centerX + bound);
    const shrubZ = clamp(centerZ + (anchorZ - centerZ) * 0.25 + randRange(rng, -12, 12), centerZ - bound, centerZ + bound);
    const blossom = rng() < 0.4;
    if (blossom) shrubFlowerCount += 1;
    plan.shrubs.push({
      cellId: host.cellId,
      biome: host.biome,
      x: shrubX,
      y: Number(host.cell.surface?.maxElevationVoxels ?? 0) + 1,
      z: shrubZ,
      shade: shadeBase + 40 + index * 3,
      blossom
    });
  }
  return { biome, density, treeCount: count, shrubCount, shrubFlowerCount, cellIds: entries.map((entry) => entry.cellId), ranked };
}

function agentShrubCountFor(biome, density, treeCount, rng) {
  if (biome === "woodland") return Math.max(2, treeCount + Math.round(lerp(1, 3, density)));
  if (biome === "heath") return 1 + Math.round(lerp(2, 4, density));
  return treeCount;
}

function archetypeMetrics(templateId, scale) {
  const spec = TREE_TEMPLATES[templateId] ?? TREE_TEMPLATES["round-0"];
  const baseHeight = Math.max(spec.trunkHeight, ...spec.mounds.map((mound) => mound.baseY + mound.h));
  const baseCrownWidth = Math.max(4, ...spec.mounds.map((mound) => 2 * (Math.abs(mound.cx) + mound.w / 2)));
  return {
    height: Math.round(baseHeight * scale),
    crownWidth: Math.round(baseCrownWidth * scale),
    trunkWidth: Math.max(2, Math.round(spec.trunkWidth * scale))
  };
}

function weightedAgentHost(entries, rng) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0.05, entry.density), 0);
  let cursor = rng() * total;
  for (const entry of entries) {
    cursor -= Math.max(0.05, entry.density);
    if (cursor <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function agentTreeCountFor(biome, density, rng, edge = false) {
  if (biome === "woodland") return Math.round(lerp(2, 5, density)) + (rng() < 0.4 ? 1 : 0);
  if (biome === "heath") return Math.round(lerp(0, 1, density));
  if ((edge || density > 0.55) && rng() < 0.5) return 1;
  return 0;
}

function pickFamily(rng) {
  const roll = rng();
  let cursor = 0;
  for (const family of TREE_FAMILIES) {
    cursor += FAMILY_WEIGHTS[family];
    if (roll < cursor) return family;
  }
  return "broad";
}

function pickTemplate(rng, family) {
  const ids = FAMILY_TEMPLATE_IDS[family] ?? FAMILY_TEMPLATE_IDS.broad;
  return ids[Math.floor(rng() * ids.length) % ids.length];
}

function assignTier(rng) {
  const roll = rng();
  if (roll < 0.13) return "dominant";
  if (roll < 0.73) return "regular";
  return "small";
}

function gridRotation(rng, family) {
  const options = family === "tall" ? [0, Math.PI / 2, Math.PI, Math.PI * 1.5] : [0, Math.PI / 2];
  return options[Math.floor(rng() * options.length) % options.length];
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

const TREE_MATERIAL_COLORS = {
  timber: "#273f3d",
  foliageDark: "#355b43",
  foliage: "#557748",
  foliageLight: "#78965a"
};

function createTreeInstanceMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
}

function buildTreeGeometry(templateId) {
  const spec = TREE_TEMPLATES[templateId] ?? TREE_TEMPLATES["round-0"];
  const boxes = [];
  boxes.push(treeBox(0, 0, 0, spec.trunkWidth, spec.trunkHeight, spec.trunkWidth, TREE_MATERIAL_COLORS.timber));
  (spec.branches ?? []).forEach((branch) => {
    const thickness = 4;
    const len = branch.len;
    const y = branch.y;
    const dir = branch.dir ?? 1;
    if (branch.axis === "x") boxes.push(treeBox(dir * (spec.trunkWidth / 2 + len / 2), y, 0, len, thickness, 3, TREE_MATERIAL_COLORS.foliageDark));
    else boxes.push(treeBox(0, y, dir * (spec.trunkWidth / 2 + len / 2), 3, thickness, len, TREE_MATERIAL_COLORS.foliageDark));
  });
  spec.mounds.forEach((mound) => addCrownMound(boxes, mound));
  const geometry = mergeGeometries(boxes, false);
  if (!geometry) return new THREE.BoxGeometry(1, 1, 1);
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return geometry;
}

function addCrownMound(boxes, mound) {
  const steps = Math.max(1, mound.steps ?? 2);
  const stepHeight = mound.h / steps;
  const inset = 2;
  for (let step = 0; step < steps; step += 1) {
    const width = Math.max(2, mound.w - step * inset * 2);
    const depth = Math.max(2, mound.d - step * inset * 1.7);
    const height = Math.max(1, stepHeight);
    const tone = step === 0 ? 0 : step === steps - 1 ? 2 : 1;
    boxes.push(treeBox(mound.cx, Math.round(mound.baseY + step * stepHeight), mound.cz, Math.round(width), Math.round(height), Math.round(depth), FOLIAGE_TONES[tone]));
  }
}

function treeBox(cx, baseY, cz, width, height, depth, hexColor) {
  const color = new THREE.Color(hexColor);
  const geometry = new THREE.BoxGeometry(width * VOXEL_SIZE, height * VOXEL_SIZE, depth * VOXEL_SIZE);
  geometry.translate(cx * VOXEL_SIZE, (baseY + height / 2) * VOXEL_SIZE, cz * VOXEL_SIZE);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function treeTint(tree) {
  const base = 0.82 + ((tree.shade % 24) / 24) * 0.3;
  return new THREE.Color(base, base, base);
}

function addVoxelShrub(buffer, x, groundY, z, shade, write, blossom) {
  buffer.addBox("foliageDark", x - 2, groundY, z - 1, 5, 2, 4, shade, write);
  buffer.addBox("foliage", x - 1, groundY + 2, z, 3, 2, 2, shade + 1, write);
  if (blossom) {
    buffer.addVoxel("blossomPink", x - 1, groundY + 4, z, shade + 2, write);
    buffer.addVoxel("blossomGold", x + 1, groundY + 4, z + 1, shade + 3, write);
  }
}

const CLUSTER_SIZE = 3;
const CLUSTER_RADIUS_FRACTION = 0.62;
const CLUSTER_FALLOFF = 1.4;
const SPARSE_POCKET_FRACTION = 0.22;
const SPARSE_POCKET_DENSITY = 0.3;
const TREE_FAMILIES = ["broad", "round", "tall"];
const TEMPLATE_IDS = ["broad-0", "broad-1", "round-0", "round-1", "tall-0", "tall-1"];
const FAMILY_TEMPLATE_IDS = {
  broad: ["broad-0", "broad-1"],
  round: ["round-0", "round-1"],
  tall: ["tall-0", "tall-1"]
};
// Family share of the population: tall is an uncommon accent family.
const FAMILY_WEIGHTS = { broad: 0.45, round: 0.4, tall: 0.15 };
const TIER_BASE_SCALE = { dominant: 1.55, regular: 1, small: 0.72 };
const FOLIAGE_TONES = ["#2f4d38", "#55793d", "#7f9c5a"];

// Each template is a family-specific silhouette: a trunk, a handful of coarse
// branch stubs, and a set of overlapping crown "mounds". Each mound is emitted
// as a stepped (inset) stack of grid-aligned boxes so crowns taper toward top
// and outer edges instead of reading as full cuboids.
const TREE_TEMPLATES = {
  "broad-0": {
    family: "broad", trunkHeight: 15, trunkWidth: 6,
    branches: [{ axis: "x", y: 13, len: 6, dir: 1 }],
    mounds: [
      { cx: -7, cz: 2, baseY: 11, w: 22, d: 20, h: 12, steps: 3 },
      { cx: 8, cz: -2, baseY: 12, w: 20, d: 18, h: 11, steps: 2 },
      { cx: 0, cz: 0, baseY: 13, w: 26, d: 24, h: 15, steps: 3 },
      { cx: -5, cz: 0, baseY: 27, w: 17, d: 15, h: 10, steps: 2 },
      { cx: 6, cz: 1, baseY: 28, w: 15, d: 13, h: 9, steps: 2 },
      { cx: 0, cz: 0, baseY: 37, w: 11, d: 10, h: 8, steps: 2 }
    ]
  },
  "broad-1": {
    family: "broad", trunkHeight: 14, trunkWidth: 5,
    branches: [{ axis: "z", y: 12, len: 6, dir: -1 }],
    mounds: [
      { cx: -9, cz: -1, baseY: 11, w: 17, d: 15, h: 10, steps: 2 },
      { cx: 7, cz: 3, baseY: 12, w: 19, d: 17, h: 11, steps: 2 },
      { cx: 0, cz: 0, baseY: 12, w: 24, d: 22, h: 13, steps: 3 },
      { cx: 1, cz: 0, baseY: 22, w: 22, d: 20, h: 12, steps: 3 },
      { cx: -3, cz: 0, baseY: 32, w: 14, d: 13, h: 9, steps: 2 },
      { cx: 0, cz: 0, baseY: 39, w: 9, d: 9, h: 7, steps: 2 }
    ]
  },
  "round-0": {
    family: "round", trunkHeight: 18, trunkWidth: 4,
    branches: [{ axis: "x", y: 16, len: 5, dir: 1 }],
    mounds: [
      { cx: 0, cz: 0, baseY: 16, w: 18, d: 17, h: 9, steps: 2 },
      { cx: -3, cz: 0, baseY: 21, w: 17, d: 16, h: 11, steps: 2 },
      { cx: 3, cz: 0, baseY: 22, w: 16, d: 16, h: 10, steps: 2 },
      { cx: 0, cz: 0, baseY: 22, w: 26, d: 24, h: 13, steps: 3 },
      { cx: -1, cz: 0, baseY: 32, w: 15, d: 14, h: 9, steps: 2 },
      { cx: 0, cz: 0, baseY: 39, w: 10, d: 9, h: 7, steps: 2 }
    ]
  },
  "round-1": {
    family: "round", trunkHeight: 17, trunkWidth: 4,
    branches: [{ axis: "z", y: 15, len: 5, dir: 1 }],
    mounds: [
      { cx: 0, cz: 0, baseY: 15, w: 16, d: 16, h: 8, steps: 2 },
      { cx: -1, cz: 0, baseY: 20, w: 24, d: 22, h: 14, steps: 3 },
      { cx: 4, cz: 0, baseY: 21, w: 18, d: 18, h: 11, steps: 2 },
      { cx: -2, cz: 0, baseY: 31, w: 15, d: 14, h: 10, steps: 2 },
      { cx: 0, cz: 0, baseY: 38, w: 10, d: 9, h: 8, steps: 2 }
    ]
  },
  "tall-0": {
    family: "tall", trunkHeight: 24, trunkWidth: 3,
    branches: [],
    mounds: [
      { cx: 0, cz: 0, baseY: 22, w: 14, d: 14, h: 11, steps: 2 },
      { cx: -1, cz: 0, baseY: 31, w: 17, d: 16, h: 12, steps: 3 },
      { cx: 2, cz: 0, baseY: 32, w: 13, d: 13, h: 10, steps: 2 },
      { cx: 0, cz: 0, baseY: 41, w: 13, d: 12, h: 10, steps: 2 },
      { cx: 0, cz: 0, baseY: 49, w: 9, d: 9, h: 8, steps: 2 }
    ]
  },
  "tall-1": {
    family: "tall", trunkHeight: 26, trunkWidth: 3,
    branches: [],
    mounds: [
      { cx: 0, cz: 0, baseY: 24, w: 13, d: 13, h: 10, steps: 2 },
      { cx: 1, cz: 0, baseY: 32, w: 18, d: 15, h: 12, steps: 3 },
      { cx: -1, cz: 0, baseY: 42, w: 12, d: 12, h: 11, steps: 2 },
      { cx: 0, cz: 0, baseY: 51, w: 9, d: 9, h: 9, steps: 2 }
    ]
  }
};

function lerp(a, b, ratio) {
  return a + (b - a) * ratio;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
