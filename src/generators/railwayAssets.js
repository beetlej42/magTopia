import * as THREE from "three";
import { RAILWAY_STATION_LEVELS } from "../city/railway-gateway.js";
import { VoxelInstanceBuffer, VOXEL_SIZE } from "./voxelBuildingLab.js";
import { createVoxelMassingLab } from "./voxelBuildingLab.js";
import { createPublicBuildingStylePreset } from "./publicBuildingStyleComparison.js";
import { getVoxelSphereFrame } from "./voxelIntentDistrict.js";

const CELL_VOXELS = 32;

export const RAILWAY_ASSET_PRESETS = Object.freeze({
  waysideStation: Object.freeze({ seed: "railway-wayside-001", stationLevel: 1, sunTime: 0.58, nightLighting: 0.08, trainProgress: 0.5 }),
  metropolitanStation: Object.freeze({ seed: "railway-metropolitan-001", stationLevel: 2, sunTime: 0.58, nightLighting: 0.08, trainProgress: 0.5 }),
  grandStation: Object.freeze({ seed: "railway-grand-001", stationLevel: 3, sunTime: 0.18, nightLighting: 0.68, trainProgress: 0.5 })
});

export function normalizeRailwayAssetConfig(config = {}) {
  const base = { ...RAILWAY_ASSET_PRESETS.metropolitanStation, ...config };
  return {
    id: String(base.id ?? "railway-asset-lab"),
    seed: String(base.seed ?? "railway-asset-lab-001"),
    stationLevel: clampInteger(base.stationLevel ?? 2, 1, 3),
    sunTime: clamp(base.sunTime ?? 0.58, 0, 1),
    nightLighting: clamp(base.nightLighting ?? 0.08, 0, 1),
    trainProgress: clamp(base.trainProgress ?? 0.5, 0, 1),
    trainSpeed: clamp(base.trainSpeed ?? 0.35, 0, 1.5),
    viewFraming: { horizontalOffset: 0, zoom: 1 }
  };
}

export function createRailwayStationSpec(level = 1, options = {}) {
  const stationLevel = clampInteger(level, 1, 3);
  const spec = createPublicBuildingStylePreset("victorian_gothic", {
    id: options.id ?? `railway-station-level-${stationLevel}`,
    seed: options.seed ?? `railway-station-level-${stationLevel}`,
    widthCells: 6,
    depthCells: 3,
    sunTime: options.sunTime,
    nightLighting: options.nightLighting
  });
  const hall = spec.masses.find((mass) => mass.id === "great-hall");
  const tower = spec.masses.find((mass) => mass.id === "teaching-tower");
  const entrance = spec.masses.find((mass) => mass.id === "pointed-gatehouse");

  hall.id = "booking-hall";
  hall.heightVoxels = [28, 38, 48][stationLevel - 1];
  hall.cap = {
    type: "gable",
    heightVoxels: [10, 15, 20][stationLevel - 1],
    orientation: "east_west",
    ridgeRailHeightVoxels: stationLevel
  };
  hall.materials = { wall: "brickBrown", trim: "sandstone", roof: "slate", frame: "iron", window: "warmWindow", door: "timber" };
  hall.facade = { ...hall.facade, openness: 0.34 + stationLevel * 0.07, entranceEmphasis: 0.58, bayWidthVoxels: stationLevel === 1 ? 10 : 8 };

  entrance.id = "city-entrance";
  entrance.heightVoxels = [20, 27, 34][stationLevel - 1];
  entrance.cap.heightVoxels = [8, 12, 15][stationLevel - 1];
  entrance.materials = { ...entrance.materials, wall: "brickRed", window: "warmWindow" };

  if (stationLevel === 1) {
    spec.masses = spec.masses.filter((mass) => !["teaching-tower", "west-buttress", "east-buttress"].includes(mass.id));
  } else {
    tower.id = "clock-tower";
    tower.cells = [[3, 1]];
    tower.dimensionsVoxels = { width: stationLevel === 2 ? 22 : 26, depth: stationLevel === 2 ? 22 : 26 };
    tower.heightVoxels = stationLevel === 2 ? 72 : 94;
    tower.cap = stationLevel === 2
      ? { type: "hip", heightVoxels: 20, ridgeRatio: 0.5, finialHeightVoxels: 6 }
      : { type: "spire", heightVoxels: 34, ribCount: 8, ringCount: 2, finialHeightVoxels: 9 };
    tower.materials = { ...tower.materials, wall: "brickRed", window: "warmWindow", trim: stationLevel === 3 ? "limestone" : "sandstone" };
  }

  if (stationLevel === 3) {
    spec.masses.push({
      id: "grand-train-shed",
      role: "platform_canopy",
      type: "framed",
      cells: [[1, 1], [2, 1], [3, 1], [4, 1]],
      heightVoxels: 18,
      cap: { type: "glass_barrel", heightVoxels: 15, orientation: "east_west", ribCount: 12, ringCount: 2, finialHeightVoxels: 4 },
      framing: { baySpacingVoxels: 8, frameWidthVoxels: 2, floorBeamSpacingVoxels: 8, reliefDepthVoxels: 1 },
      materials: { frame: "iron", trim: "gildedMetal", panel: "lightGlass", roof: "lightGlass" }
    });
  }

  spec.metadata = {
    ...spec.metadata,
    publicProgram: "railway_station",
    stationLevel,
    fixedFootprint: "6x3",
    railwayFeatures: stationLevel === 1
      ? ["booking_hall", "platform_canopy"]
      : stationLevel === 2
        ? ["booking_hall", "clock_tower", "iron_glass_canopy"]
        : ["grand_hall", "clock_tower", "glazed_train_shed", "gilded_crest"]
  };
  return spec;
}

export function createVoxelRailTrack({ lengthWorld = 216, platformLengthWorld = 28, seed = "railway-track" } = {}) {
  const buffer = new VoxelInstanceBuffer(seed);
  const length = Math.max(64, Math.round(lengthWorld / VOXEL_SIZE));
  const startX = -Math.round(length / 2);
  const platformStart = -Math.round(platformLengthWorld / VOXEL_SIZE / 2);
  const platformLength = Math.round(platformLengthWorld / VOXEL_SIZE);

  buffer.addBox("stoneShadow", startX, -2, -11, length, 2, 22, 1);
  for (let x = startX; x < startX + length; x += 8) buffer.addBox("timber", x, 0, -9, 4, 2, 18, x);
  buffer.addBox("iron", startX, 2, -7, length, 2, 2, 3);
  buffer.addBox("iron", startX, 2, 5, length, 2, 2, 4);
  buffer.addBox("pavement", platformStart, 0, -24, platformLength, 5, 11, 5);
  buffer.addBox("sandstone", platformStart, 0, -14, platformLength, 4, 2, 6);

  const root = meshBuffer(buffer, "VoxelRailTrack");
  root.userData.contract = {
    asset: "victorian-through-railway-v1",
    gaugeVoxels: 12,
    sleeperPitchVoxels: 8,
    platformLengthWorld,
    materialCounts: buffer.materialCounts(),
    renderStats: structuredClone(buffer.renderStats)
  };
  return root;
}

export function createVoxelSteamTrain({ seed = "steam-train", coachCount = 2 } = {}) {
  const buffer = new VoxelInstanceBuffer(seed);
  const wheelCenters = [];
  let x = -84;
  addCoach(buffer, x, 48, 0, wheelCenters, 101);
  x += 54;
  addCoach(buffer, x, 48, 0, wheelCenters, 201);
  x += 54;
  addTender(buffer, x, wheelCenters);
  x += 34;
  addLocomotive(buffer, x, wheelCenters);
  const root = meshBuffer(buffer, "VoxelSteamTrain");
  root.userData.sphereProjectionRoot = true;
  root.userData.dynamic = true;
  root.userData.contract = {
    asset: "victorian-voxel-steam-train-v1",
    coachCount: clampInteger(coachCount, 1, 2),
    lengthVoxels: 198,
    wheelCount: wheelCenters.length,
    steamEffects: "four reusable voxel puffs",
    materialCounts: buffer.materialCounts(),
    renderStats: structuredClone(buffer.renderStats)
  };
  const puffs = createSteamPuffs();
  puffs.position.set(8.6, 3.2, 0);
  root.add(puffs);
  root.userData.updateSteam = (elapsed) => {
    puffs.children.forEach((puff, index) => {
      const phase = (elapsed * 0.32 + index / puffs.children.length) % 1;
      puff.position.set(-phase * 2.2, phase * 2.5, Math.sin(phase * Math.PI * 2 + index) * 0.18);
      const scale = 0.55 + phase * 1.25;
      puff.scale.setScalar(scale);
      puff.material.opacity = (1 - phase) * 0.58;
    });
  };
  return root;
}

export function createRailwayGatewayLayer({ state, grid, seed = "railway-gateway", animateTrain = true, trainProgress = null } = {}) {
  const railway = state?.nodes?.old_town_entry?.railway;
  const root = new THREE.Group();
  root.name = "RailwayGatewayLayer";
  if (!railway || !grid?.cells?.length) {
    root.userData.contract = { asset: "railway-gateway-v1", status: "not_available" };
    return root;
  }
  const byId = new Map(grid.cells.map((cell) => [cell.id, cell]));
  const trackCells = railway.trackCellIds.map((id) => byId.get(id)).filter(Boolean);
  const stationCells = railway.station.cellIds.map((id) => byId.get(id)).filter(Boolean);
  const trackZ = average(trackCells.map((cell) => Number(cell.center?.z ?? 0)));
  const stationX = average(stationCells.map((cell) => Number(cell.center?.x ?? 0)));
  const stationZ = average(stationCells.map((cell) => Number(cell.center?.z ?? 0)));
  const worldWidth = Number(grid.columns) * Number(grid.cellWorldSize);
  const level = clampInteger(state.nodes.old_town_entry.stationLevel ?? railway.station.level ?? 1, 1, 3);
  const stationScale = Number(grid.cellWorldSize) / 4;

  const track = createVoxelRailTrack({ lengthWorld: worldWidth + 20, platformLengthWorld: Number(grid.cellWorldSize) * 7, seed: `${seed}:track` });
  track.position.set(0, 0, trackZ);
  track.scale.set(1, stationScale, stationScale);
  root.add(track);

  const station = createVoxelMassingLab({
    ...createRailwayStationSpec(level, { seed: `${seed}:station:${level}` }),
    renderStrategy: "greedy",
    maxMergeSpanVoxels: 12
  });
  station.name = `RailwayStation-Level-${level}`;
  station.position.set(stationX, 0, stationZ);
  station.scale.setScalar(stationScale);
  root.add(station);
  addStationFixedDetails(root, { stationX, stationZ, trackZ, level, cellWorldSize: Number(grid.cellWorldSize), stationScale, seed });
  addForecourts(root, railway, byId, Number(grid.cellWorldSize), seed);

  const train = createVoxelSteamTrain({ seed: `${seed}:train` });
  train.name = "ThroughSteamTrain";
  train.position.set(-worldWidth / 2 - 16, 0.55, trackZ);
  train.scale.setScalar(stationScale);
  root.add(train);
  const fixedProgress = trainProgress == null ? null : clamp(trainProgress, 0, 1);
  let sphericalRadius = null;
  const trainBasis = new THREE.Matrix4();
  const updateTrain = (elapsed) => {
    const progress = fixedProgress ?? (animateTrain ? (elapsed % 42) / 42 : 0.5);
    const west = -worldWidth / 2 - 18;
    const east = worldWidth / 2 + 18;
    let x;
    if (progress < 0.42) x = lerp(west, stationX, progress / 0.42);
    else if (progress < 0.58) x = stationX;
    else x = lerp(stationX, east, (progress - 0.58) / 0.42);
    if (sphericalRadius) {
      const frame = getVoxelSphereFrame(x, trackZ, sphericalRadius);
      trainBasis.makeBasis(frame.tangentX, frame.normal, frame.tangentZ);
      train.quaternion.setFromRotationMatrix(trainBasis);
      train.position.copy(frame.surface).addScaledVector(frame.normal, 0.55);
    } else {
      train.position.x = x;
    }
    train.userData.updateSteam?.(elapsed);
  };
  updateTrain(0);

  root.userData.contract = {
    asset: "railway-gateway-v1",
    orientation: railway.orientation,
    throughService: true,
    stationLevel: level,
    stationFootprint: railway.station.footprint,
    stationCellIds: [...railway.station.cellIds],
    forecourtCellIds: [...railway.forecourt.cellIds],
    urbanConnectionPoint: structuredClone(railway.urbanConnectionPoint),
    track: structuredClone(track.userData.contract),
    train: structuredClone(train.userData.contract),
    station: structuredClone(station.userData.spec.metadata)
  };
  root.userData.getVoxelDiagnostics = () => structuredClone(root.userData.contract);
  root.userData.update = (elapsed) => updateTrain(elapsed);
  root.userData.enableSphericalTrain = (radius) => {
    sphericalRadius = Number(radius) || null;
    updateTrain(0);
  };
  root.userData.updateDaylight = (style) => station.userData.updateDaylight?.(style);
  return root;
}

export function createRailwayAssetLab(config = {}) {
  const params = normalizeRailwayAssetConfig(config);
  const columns = 50;
  const rows = 18;
  const cellWorldSize = 4;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: (column + 0.5 - columns / 2) * cellWorldSize, z: (rows / 2 - row - 0.5) * cellWorldSize } });
    }
  }
  const trackRow = 3;
  const stationIds = rectangleIds(22, 4, 6, 3);
  const forecourtIds = rectangleIds(22, 7, 6, 3);
  const railway = {
    orientation: "east_west",
    trackCellIds: cells.filter((cell) => cell.row === trackRow).map((cell) => cell.id),
    station: { level: params.stationLevel, maxLevel: 3, footprint: "6x3", startColumn: 22, startRow: 4, cellIds: stationIds },
    forecourt: { cellIds: forecourtIds, leftCellIds: forecourtIds.filter((id) => Number(id.split("-")[1]) < 25), rightCellIds: forecourtIds.filter((id) => Number(id.split("-")[1]) > 25) },
    urbanConnectionPoint: { nodeId: "old_town_entry", cellId: "cell-25-9", direction: "south" }
  };
  const state = { nodes: { old_town_entry: { stationLevel: params.stationLevel, railway } } };
  const root = createRailwayGatewayLayer({ state, grid: { columns, rows, cellWorldSize, cells }, seed: params.seed, animateTrain: false, trainProgress: params.trainProgress });
  root.name = `RailwayAssetLab-Level-${params.stationLevel}`;
  root.userData.config = params;
  root.userData.contract.mode = "railway-asset-studio";
  root.userData.contract.upgradeLevels = structuredClone(RAILWAY_STATION_LEVELS);
  return root;
}

function addStationFixedDetails(root, { stationX, stationZ, trackZ, level, cellWorldSize, stationScale, seed }) {
  const buffer = new VoxelInstanceBuffer(`${seed}:station-fixed:${level}`);
  const centerX = 0;
  // The six-cell site is centred between cells 2 and 3; the clock tower sits
  // on cell 3, one half-cell east of the site origin.
  const towerCenterX = 16;
  const canopyZ = Math.round((trackZ - stationZ) / (VOXEL_SIZE * stationScale));
  const width = Math.round(cellWorldSize * (level === 1 ? 4.6 : level === 2 ? 5.3 : 5.8) / (VOXEL_SIZE * stationScale));
  const startX = centerX - Math.round(width / 2);
  const postHeight = level === 1 ? 16 : level === 2 ? 22 : 28;
  for (let x = startX; x <= startX + width; x += level === 1 ? 24 : 18) {
    buffer.addBox(level === 1 ? "timber" : "iron", x, 4, canopyZ - 4, 2, postHeight, 2, x);
  }
  buffer.addBox(level === 1 ? "slate" : "lightGlass", startX - 2, 4 + postHeight, canopyZ - 8, width + 4, 2, 10, 44);
  if (level >= 2) {
    const clockY = level === 2 ? 60 : 82;
    buffer.addBox("limestone", towerCenterX - 7, clockY, -50, 14, 14, 2, 71);
    buffer.addBox("iron", towerCenterX - 1, clockY + 3, -52, 2, 5, 1, 72);
    buffer.addBox("iron", towerCenterX - 1, clockY + 7, -52, 5, 2, 1, 73);
  }
  if (level === 3) buffer.addBox("gildedMetal", towerCenterX - 8, 92, -50, 16, 3, 2, 91);
  const lampXs = level === 3 ? [-72, -24, 24, 72] : [-64, 64];
  for (const lampX of lampXs) {
    buffer.addBox("iron", lampX, 1, -83, 2, 18, 2, lampX + 120);
    buffer.addBox("warmWindow", lampX - 2, 18, -85, 6, 6, 6, lampX + 220);
    buffer.addBox("iron", lampX - 3, 24, -86, 8, 2, 8, lampX + 320);
  }
  const details = meshBuffer(buffer, `RailwayStationFixedDetails-Level-${level}`);
  details.position.set(stationX, 0, stationZ);
  details.scale.setScalar(stationScale);
  root.add(details);
}

function addForecourts(root, railway, byId, cellWorldSize, seed) {
  const buffer = new VoxelInstanceBuffer(`${seed}:forecourt`);
  for (const id of railway.forecourt.cellIds) {
    const cell = byId.get(id);
    if (!cell) continue;
    const minX = Math.round((cell.center.x - cellWorldSize / 2) / VOXEL_SIZE);
    const minZ = Math.round((cell.center.z - cellWorldSize / 2) / VOXEL_SIZE);
    const gateway = id === railway.urbanConnectionPoint.cellId;
    buffer.addBox(gateway ? "road" : "pavement", minX, 0, minZ, CELL_VOXELS, 1, CELL_VOXELS, cell.column + cell.row * 97);
  }
  root.add(meshBuffer(buffer, "RailwayStationForecourts"));
}

function addLocomotive(buffer, x, wheels) {
  buffer.addBox("brickBrown", x, 7, -6, 38, 18, 12, 401);
  buffer.addBox("iron", x + 2, 25, -5, 25, 6, 10, 402);
  buffer.addBox("brickBrown", x + 26, 22, -6, 12, 20, 12, 403);
  buffer.addBox("warmWindow", x + 29, 29, -7, 6, 6, 1, 404);
  buffer.addBox("iron", x + 7, 31, -3, 7, 14, 6, 405);
  buffer.addBox("iron", x + 4, 43, -5, 13, 3, 10, 406);
  buffer.addBox("gildedMetal", x + 38, 11, -2, 6, 4, 4, 407);
  for (const center of [x + 9, x + 27]) addWheelPair(buffer, center, 7, wheels, 410 + center);
}

function addTender(buffer, x, wheels) {
  buffer.addBox("iron", x, 8, -7, 29, 18, 14, 301);
  buffer.addBox("brickBrown", x + 3, 23, -6, 23, 7, 12, 302);
  addWheelPair(buffer, x + 8, 7, wheels, 303);
  addWheelPair(buffer, x + 22, 7, wheels, 304);
}

function addCoach(buffer, x, length, _index, wheels, shade) {
  buffer.addBox("brickRed", x, 9, -8, length, 24, 16, shade);
  buffer.addBox("slate", x - 2, 33, -9, length + 4, 4, 18, shade + 1);
  for (let wx = x + 5; wx < x + length - 4; wx += 9) {
    buffer.addBox("warmWindow", wx, 20, -9, 5, 7, 1, wx);
    buffer.addBox("warmWindow", wx, 20, 8, 5, 7, 1, wx + 1);
  }
  buffer.addBox("gildedMetal", x, 17, -9, length, 2, 1, shade + 2);
  addWheelPair(buffer, x + 9, 7, wheels, shade + 3);
  addWheelPair(buffer, x + length - 10, 7, wheels, shade + 4);
}

function addWheelPair(buffer, centerX, centerY, wheels, shade) {
  for (const z of [-9, 7]) {
    for (let y = -6; y <= 6; y += 1) {
      for (let x = -6; x <= 6; x += 1) {
        const radius = Math.hypot(x, y);
        if (radius <= 6 && radius >= 3.3) buffer.addVoxel("iron", centerX + x, centerY + y, z, shade + y + x);
      }
    }
    wheels.push([centerX, centerY, z]);
  }
}

function createSteamPuffs() {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  for (let index = 0; index < 4; index += 1) {
    const material = new THREE.MeshStandardMaterial({ color: "#e9e4dc", roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
    const puff = new THREE.Mesh(geometry, material);
    puff.castShadow = false;
    group.add(puff);
  }
  return group;
}

function meshBuffer(buffer, name) {
  const group = new THREE.Group();
  group.name = name;
  buffer.createMeshes({ strategy: "greedy", chunkSizeVoxels: 256, maxMergeSpanVoxels: 24 }).forEach((mesh) => {
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

function rectangleIds(startColumn, startRow, width, depth) {
  const ids = [];
  for (let row = startRow; row < startRow + depth; row += 1) {
    for (let column = startColumn; column < startColumn + width; column += 1) ids.push(`cell-${column}-${row}`);
  }
  return ids;
}

function average(values) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function lerp(start, end, amount) { return start + (end - start) * amount; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value))); }
function clampInteger(value, minimum, maximum) { return Math.round(clamp(value, minimum, maximum)); }
