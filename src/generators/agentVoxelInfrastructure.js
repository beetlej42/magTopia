import * as THREE from "three";
import {
  AGENT_VOXEL_ROAD_RENDER_CONTRACT,
  CARDINAL_ROAD_OFFSETS,
  agentNorthIsPositiveWorldZ,
  deriveCardinalRoadPorts
} from "../city/road-topology.js";
import { createRng } from "../utils/random.js";
import { VoxelInstanceBuffer, VOXEL_SIZE, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";
import { addSharedVoxelRoadTile, classifyVoxelRoadTopology } from "./voxelIntentDistrict.js";

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

export function createAgentVoxelVegetationLayer({ state, grid, seed = "agent-vegetation" }) {
  const group = new THREE.Group();
  group.name = "AgentVoxelVegetation";
  const buffer = new VoxelInstanceBuffer(`${seed}:voxel-vegetation`);
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

  const counts = { trees: 0, shrubs: 0, flowers: 0 };
  grid.cells.forEach((cell, index) => {
    if (blocked.has(cell.id) || !cell.strictBuildable) return;
    const rng = createRng(`${seed}:${cell.id}`);
    const biome = cell.surface?.biome ?? "meadow";
    const treeChance = biome === "woodland" ? 0.12 : biome === "heath" ? 0.055 : 0.035;
    const shrubChance = biome === "heath" ? 0.12 : 0.07;
    const roll = rng();
    const groundY = Number(cell.surface?.maxElevationVoxels ?? 0) + 1;
    const centerX = Math.round(cell.center.x / VOXEL_SIZE) + Math.floor((rng() - 0.5) * 12);
    const centerZ = Math.round(cell.center.z / VOXEL_SIZE) + Math.floor((rng() - 0.5) * 12);
    const write = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: cell.id };

    if (roll < treeChance) {
      addTree(buffer, centerX, groundY, centerZ, rng, index, write, biome === "woodland");
      counts.trees += 1;
      return;
    }
    if (roll < treeChance + shrubChance) {
      addShrub(buffer, centerX, groundY, centerZ, rng, index, write);
      counts.shrubs += 1;
      if (rng() > 0.55) counts.flowers += 1;
    }
  });

  buffer.createMeshes({ strategy: "greedy", chunkSizeVoxels: 128, maxMergeSpanVoxels: 8 }).forEach((mesh) => group.add(mesh));
  group.userData.contract = {
    renderer: "state-aware-voxel-vegetation-v1",
    ...counts,
    voxelCount: buffer.occupiedVoxelCount,
    renderStats: buffer.renderStats,
    clearsRoadsAndEntrances: true
  };
  group.userData.updateDaylight = () => {};
  return group;
}

function addTree(buffer, x, groundY, z, rng, shade, write, broadCrown) {
  const height = 9 + Math.floor(rng() * 6);
  buffer.addBox("timber", x, groundY, z, 2, height, 2, shade, write);
  const crownY = groundY + height - 2;
  const radius = broadCrown ? 4 : 3;
  buffer.addBox("foliageDark", x - radius, crownY, z - radius, radius * 2 + 2, 4, radius * 2 + 2, shade + 1, write);
  buffer.addBox("foliage", x - radius + 1, crownY + 4, z - radius + 1, radius * 2, 3, radius * 2, shade + 2, write);
  buffer.addBox("foliageLight", x - 1, crownY + 7, z - 1, 4, 2, 4, shade + 3, write);
}

function addShrub(buffer, x, groundY, z, rng, shade, write) {
  buffer.addBox("foliageDark", x - 2, groundY, z - 1, 5, 2, 4, shade, write);
  buffer.addBox("foliage", x - 1, groundY + 2, z, 3, 2, 2, shade + 1, write);
  if (rng() > 0.55) {
    const blossom = rng() > 0.5 ? "blossomPink" : "blossomGold";
    buffer.addVoxel(blossom, x - 1, groundY + 4, z, shade + 2, write);
    buffer.addVoxel(blossom, x + 1, groundY + 4, z + 1, shade + 3, write);
  }
}
