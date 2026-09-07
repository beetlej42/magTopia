import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RAILWAY_STATION_LEVELS } from "../city/railway-gateway.js";
import { VoxelInstanceBuffer, VOXEL_SIZE, createVoxelMassingLodLevels } from "./voxelBuildingLab.js";
import { createPublicBuildingStylePreset } from "./publicBuildingStyleComparison.js";
import { createVoxelAssetLod, updateVoxelLods } from "./magicLondonStarterDistrict.js";
import { createVoxelTreeLodRenderer, getVoxelTreeMetrics } from "./agentVoxelTrees.js";
import { getVoxelSphereFrame, addSharedVoxelRoadLamp } from "./voxelIntentDistrict.js";

// Match the runtime street-life scale while leaving the landmark station full size.
export const RAILWAY_VEHICLE_SCALE = 0.65;
const RAIL_TOP_WORLD_Y = 3.5 * VOXEL_SIZE * RAILWAY_VEHICLE_SCALE;

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
    widthCells: 6, depthCells: 3,
    sunTime: options.sunTime, nightLighting: options.nightLighting
  });
  spec.masses = stationArchitecturalMasses(stationLevel);
  spec.masses.push({
    id: "grand-train-shed", role: "platform_canopy", type: "framed",
    cells: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2]],
    heightVoxels: [40, 48, 56][stationLevel - 1],
    cap: { type: "glass_barrel", heightVoxels: [16, 20, 24][stationLevel - 1], orientation: "east_west" },
    materials: { frame: "iron", trim: "limestone", panel: "lightGlass", roof: "lightGlass" }
  });
  spec.relations = [];
  spec.metadata = {
    ...spec.metadata, publicProgram: "railway_station", stationLevel, fixedFootprint: "6x3",
    visualReference: "St Pancras Gothic Revival frontage and a longitudinal iron-glass train shed",
    architectureGrammar: ["gothic", "mansard", "gable", "spire", "asymmetric_clock_tower"],
    railwayFeatures: ["booking_hall", "pointed_entrance", "landscaped_forecourt", "longitudinal_train_shed", ...(stationLevel > 1 ? ["clock_tower", "gabled_dormers"] : [])]
  };
  return spec;
}

export function createVoxelRailTrack({ lengthWorld = 216, platformLengthWorld = 28, platformCenterWorld = 0, seed = "railway-track" } = {}) {
  const buffer = new VoxelInstanceBuffer(seed);
  const length = Math.max(64, Math.round(lengthWorld / VOXEL_SIZE));
  const startX = -Math.round(length / 2);
  const platformStart = Math.round((platformCenterWorld - platformLengthWorld / 2) / VOXEL_SIZE);
  const platformLength = Math.round(platformLengthWorld / VOXEL_SIZE);

  buffer.addBox("stoneShadow", startX, -2, -12, length, 2, 24, 1);
  buffer.addBox("pavement", startX, -1, -10, length, 1, 20, 2);
  for (let x = startX; x < startX + length; x += 8) {
    buffer.addBox("timber", x, 0, -10, 3, 1, 20, x);
    for (const z of [-7, 5]) {
      buffer.addBox("iron", x, 1, z - 1, 3, 1, 4, x);
      buffer.addBox("stoneShadow", x + 1, 2, z - 1, 1, 1, 1, x);
    }
  }
  for (const z of [-7, 5]) {
    buffer.addBox("iron", startX, 1, z, length, 1, 2, 3);
    buffer.addBox("iron", startX, 2, z, length, 1, 1, 4);
    buffer.addBox("patinaMetal", startX, 3, z, length, 1, 2, 5);
  }
  // Keep the full station-length platform, with a human-scale boarding edge.
  // Its coping sits within half a scaled voxel of the coach floor.
  buffer.addBox("brickBrown", platformStart, 0, -46, platformLength, 14, 34, 5);
  buffer.addBox("pavement", platformStart, 14, -46, platformLength, 1, 34, 6);
  buffer.addBox("limestone", platformStart, 14, -14, platformLength, 1, 2, 7);
  for (let step = 0; step < 4; step++) {
    buffer.addBox("sandstone", platformStart, 0, -58 + step * 3, platformLength, (step + 1) * 3, 3, 8 + step);
  }
  for (const x of [platformStart - 12, platformStart + platformLength + 8]) {
    buffer.addBox("iron", x, 0, -24, 2, 32, 2);
    buffer.addBox("limestone", x - 1, 15, -25, 4, 10, 4);
    buffer.addBox("brickRed", x - 1, 30, -25, 13, 3, 2);
    buffer.addBox("warmWindow", x - 1, 27, -26, 3, 3, 1);
  }

  const root = meshBuffer(buffer, "VoxelRailTrack");
  root.scale.set(1, RAILWAY_VEHICLE_SCALE, RAILWAY_VEHICLE_SCALE);
  root.userData.contract = {
    asset: "victorian-through-railway-v1",
    gaugeVoxels: 12,
    gaugeWorld: 12 * VOXEL_SIZE * RAILWAY_VEHICLE_SCALE,
    railTopWorldY: RAIL_TOP_WORLD_Y,
    platformTopWorldY: 14.5 * VOXEL_SIZE * RAILWAY_VEHICLE_SCALE,
    sleeperPitchVoxels: 8,
    platformLengthWorld,
    materialCounts: buffer.materialCounts(),
    renderStats: structuredClone(buffer.renderStats)
  };
  return root;
}

export function createVoxelSteamTrain({ seed = "steam-train", coachCount = 2 } = {}) {
  const buffer = new VoxelInstanceBuffer(seed);
  const wheels = [];
  const count = clampInteger(coachCount, 1, 2);
  for (let i = 0; i < count; i++) addCoach(buffer, -92 + i * 58, 52, i, wheels, 100 + i * 100);
  const tenderX = -92 + count * 58;
  addTender(buffer, tenderX, wheels);
  const engineX = tenderX + 36;
  addLocomotive(buffer, engineX, wheels);
  const root = meshBuffer(buffer, "VoxelSteamTrain", true);
  root.scale.setScalar(RAILWAY_VEHICLE_SCALE);
  root.userData.sphereProjectionRoot = true;
  root.userData.dynamic = true;
  const runningGear = new THREE.Group();
  runningGear.name = "AnimatedRunningGear";
  const steel = new THREE.MeshStandardMaterial({ color: "#b4b4a3", roughness: 0.4, metalness: 0.55 });
  const wheelParts = [];
  const rimGeometry = new THREE.CylinderGeometry(1, 1, 0.24, 16).rotateX(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.73, 0.73, 0.27, 12).rotateX(Math.PI / 2);
  const colorPart = (geometry, color) => {
    const rgb = new THREE.Color(color);
    const values = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < values.length; i += 3) rgb.toArray(values, i);
    geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    wheelParts.push(geometry);
  };
  colorPart(rimGeometry, "#252d32");
  colorPart(hubGeometry, "#9d2636");
  for (let i = 0; i < 4; i++) colorPart(new THREE.BoxGeometry(1.65, 0.12, 0.29).rotateZ(i * Math.PI / 4), "#b4b4a3");
  const wheelGeometry = mergeGeometries(wheelParts);
  wheelParts.forEach((part) => part.dispose());
  const wheelMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.54, metalness: 0.3 });
  const wheelMesh = new THREE.InstancedMesh(wheelGeometry, wheelMaterial, wheels.length);
  wheelMesh.name = "SpokedWheels";
  wheelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheelMesh.castShadow = false;
  runningGear.add(wheelMesh);
  const wheelMeshes = [wheelMesh];
  for (const segments of [10, 6]) {
    const geometry = new THREE.CylinderGeometry(1, 1, 0.25, segments).rotateX(Math.PI / 2);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const color = new THREE.Color("#772c36");
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.InstancedMesh(geometry, wheelMaterial, wheels.length);
    mesh.name = `SteamTrainWheels-${segments}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.visible = false;
    runningGear.add(mesh);
    wheelMeshes.push(mesh);
  }
  const wheelShadow = wheelMeshes[1].clone();
  wheelShadow.name = "SteamTrainWheelShadowProxy";
  wheelShadow.geometry = wheelShadow.geometry.clone();
  wheelShadow.material = wheelMaterial.clone();
  wheelShadow.material.colorWrite = false;
  wheelShadow.material.depthWrite = false;
  wheelShadow.castShadow = true;
  wheelShadow.visible = true;
  wheelShadow.userData.shadowProxy = true;
  runningGear.add(wheelShadow);
  const wheelTransform = new THREE.Object3D();
  const rods = [-8.6, 8.6].map((z) => {
    const rod = new THREE.Mesh(new THREE.BoxGeometry(28 * VOXEL_SIZE, 1.6 * VOXEL_SIZE, VOXEL_SIZE), steel);
    rod.position.set((engineX + 30) * VOXEL_SIZE, 8 * VOXEL_SIZE, z * VOXEL_SIZE);
    runningGear.add(rod);
    return rod;
  });
  root.add(runningGear);
  const puffs = createSteamPuffs();
  puffs.position.set((engineX + 50) * VOXEL_SIZE, 43 * VOXEL_SIZE, 0);
  root.add(puffs);
  let wheelAngle = 0;
  root.userData.updateSteam = (elapsed, distance = 0) => {
    wheelAngle += distance / (8 * VOXEL_SIZE);
    wheels.forEach(([x, y, z, radius], index) => {
      wheelTransform.position.set(x * VOXEL_SIZE, y * VOXEL_SIZE, z * VOXEL_SIZE);
      wheelTransform.scale.setScalar(radius * VOXEL_SIZE);
      wheelTransform.rotation.z = -wheelAngle * 8 / radius;
      wheelTransform.updateMatrix();
      for (const mesh of [...wheelMeshes, wheelShadow]) mesh.setMatrixAt(index, wheelTransform.matrix);
    });
    for (const mesh of [...wheelMeshes, wheelShadow]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    rods.forEach((rod) => {
      rod.position.x = (engineX + 30 + Math.cos(wheelAngle) * 2.5) * VOXEL_SIZE;
      rod.position.y = (9 + Math.sin(wheelAngle) * 2.5) * VOXEL_SIZE;
    });
    puffs.userData.update(elapsed);
  };
  root.userData.contract = {
    asset: "victorian-voxel-steam-train-v1", coachCount: count,
    vehicleScale: RAILWAY_VEHICLE_SCALE,
    lengthVoxels: count * 58 + 104, wheelCount: wheels.length,
    steamEffects: "12 layered cloud clusters / 84 instanced lobes",
    materialSpace: "model-attached enamel and metal; no world-space procedural highlights",
    chimneyLocal: puffs.position.toArray(),
    materialCounts: buffer.materialCounts(), renderStats: structuredClone(buffer.renderStats)
  };
  const bodyLods = root.children.filter((object) => object.isLOD);
  root.userData.updateLodEffects = () => {
    const level = bodyLods[0]?.userData.currentLevel ?? 0;
    wheelMeshes.forEach((mesh, index) => { mesh.visible = index === level; });
    rods.forEach((rod) => { rod.visible = level < 2; });
    puffs.visible = level < 3;
    const clusters = [12, 8, 4, 0][level];
    puffs.children[0].count = clusters * 2;
    puffs.children[1].count = clusters * 5;
  };
  root.userData.updateView = (camera, _maxLights = 4, viewport = {}) => {
    updateVoxelLods(bodyLods, camera, viewport);
    root.userData.updateLodEffects();
  };
  root.userData.updateSteam(0);
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
  const buildingOriginWorldY = Number(state.world?.constructionDatum?.buildingOriginWorldY ?? 0);
  const roadSurfaceVoxelY = Number(state.world?.constructionDatum?.roadSurfaceVoxelY ?? -1);

  const track = createVoxelRailTrack({ lengthWorld: worldWidth + 20, platformLengthWorld: Number(grid.cellWorldSize) * 7, platformCenterWorld: trackZ < stationZ ? -stationX : stationX, seed: `${seed}:track` });
  track.position.set(0, buildingOriginWorldY, trackZ);
  track.scale.multiply(new THREE.Vector3(1, stationScale, stationScale));
  if (trackZ < stationZ) track.rotation.y = Math.PI;
  root.add(track);

  const station = createVictorianStation(level, { seed: `${seed}:station:${level}`, trackOffsetVoxels: Math.abs(trackZ - stationZ) / (VOXEL_SIZE * stationScale) });
  station.name = `RailwayStation-Level-${level}`;
  station.position.set(stationX, buildingOriginWorldY, stationZ);
  station.scale.setScalar(stationScale);
  // The authored facade looks toward -Z; new cities face +Z, toward the centre.
  station.rotation.y = trackZ < stationZ ? Math.PI : 0;
  root.add(station);
  const forecourt = addForecourts(root, railway, byId, Number(grid.cellWorldSize), seed, roadSurfaceVoxelY, level);

  const train = createVoxelSteamTrain({ seed: `${seed}:train` });
  train.name = "ThroughSteamTrain";
  train.position.set(-worldWidth / 2 - 16, buildingOriginWorldY + RAIL_TOP_WORLD_Y * stationScale, trackZ);
  train.scale.multiplyScalar(stationScale);
  root.add(train);
  const fixedProgress = trainProgress == null ? null : clamp(trainProgress, 0, 1);
  let sphericalRadius = null;
  const trainBasis = new THREE.Matrix4();
  let previousX = null;
  const updateTrain = (elapsed) => {
    const progress = fixedProgress ?? (animateTrain ? ((elapsed + 21) % 42) / 42 : 0.5);
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
      train.position.copy(frame.surface).addScaledVector(frame.normal, buildingOriginWorldY + RAIL_TOP_WORLD_Y * stationScale);
    } else {
      train.position.x = x;
    }
    const distance = previousX == null || Math.abs(x - previousX) > 30 ? 0 : (x - previousX) / (stationScale * RAILWAY_VEHICLE_SCALE);
    train.userData.updateSteam?.(elapsed, distance);
    previousX = x;
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
    station: structuredClone(station.userData.spec.metadata),
    constructionDatum: { buildingOriginWorldY, roadSurfaceVoxelY }
  };
  const lods = [];
  root.traverse((object) => { if (object.isLOD) lods.push(object); });
  root.userData.updateView = (camera, _maxLights = 4, viewport = {}) => {
    updateVoxelLods(lods, camera, viewport);
    forecourt?.userData.updateTrees?.(camera, viewport);
    train.userData.updateLodEffects?.();
  };
  root.userData.getRailwayLodDiagnostics = () => lods.map((lod) => ({ name: lod.name, level: lod.userData.currentLevel, factors: lod.userData.lodFactors, levels: lod.userData.levelDiagnostics }));
  root.userData.getVoxelDiagnostics = () => structuredClone(root.userData.contract);
  root.userData.update = (elapsed) => updateTrain(elapsed);
  root.userData.enableSphericalTrain = (radius) => {
    sphericalRadius = Number(radius) || null;
    updateTrain(0);
  };
  root.userData.updateDaylight = (style) => {
    station.userData.updateDaylight?.(style);
    forecourt?.userData.updateDaylight?.(style);
  };
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
  const trackRow = 14;
  const stationIds = rectangleIds(22, 11, 6, 3);
  const forecourtIds = rectangleIds(22, 8, 6, 3);
  const railway = {
    orientation: "east_west",
    trackCellIds: cells.filter((cell) => cell.row === trackRow).map((cell) => cell.id),
    station: { level: params.stationLevel, maxLevel: 3, footprint: "6x3", startColumn: 22, startRow: 11, cellIds: stationIds },
    forecourt: { cellIds: forecourtIds, leftCellIds: forecourtIds.filter((id) => Number(id.split("-")[1]) < 25), rightCellIds: forecourtIds.filter((id) => Number(id.split("-")[1]) > 25) },
    urbanConnectionPoint: { nodeId: "old_town_entry", cellId: "cell-25-8", direction: "north" }
  };
  const state = { nodes: { old_town_entry: { stationLevel: params.stationLevel, railway } } };
  const root = createRailwayGatewayLayer({ state, grid: { columns, rows, cellWorldSize, cells }, seed: params.seed, animateTrain: false, trainProgress: params.trainProgress });
  root.name = `RailwayAssetLab-Level-${params.stationLevel}`;
  root.userData.config = params;
  root.userData.contract.mode = "railway-asset-studio";
  root.userData.contract.upgradeLevels = structuredClone(RAILWAY_STATION_LEVELS);
  return root;
}

function stationArchitecturalMasses(level) {
  const i = level - 1;
  const gothic = createPublicBuildingStylePreset("victorian_gothic").masses[0].facade;
  const materials = { wall: "brickRed", trim: "sandstone", roof: "slate", frame: "iron", window: "warmWindow", door: "timber" };
  const mass = (id, x, z, width, depth, height, cap, extra = {}) => {
    const column = Math.round((x + 80) / 32), row = Math.round((z + 32) / 32);
    return {
      id, railwayArchitecture: true, type: "solid", role: "secondary",
      cells: [[column, row]], dimensionsVoxels: { width, depth },
      placement: { offsetVoxels: { x: x - (column * 32 - 80), z: z - (row * 32 - 32) } },
      baseYVoxels: 3, heightVoxels: height, cap, materials: { ...materials },
      facade: { ...gothic, openness: 0.38, entranceEmphasis: 0, floorHeightVoxels: 20, bayWidthVoxels: 8, baseCourseHeightVoxels: 4, stringCourseHeightVoxels: 1, corniceHeightVoxels: 3, cornerPierWidthVoxels: 2, rooflineOrnaments: 2 },
      ...extra
    };
  };
  const height = [44, 62, 80][i];
  const masses = [
    mass("booking-hall", 0, -25, 172, 32, height,
      { type: "mansard", heightVoxels: [14, 20, 26][i], dormerCount: [5, 7, 9][i], ridgeRailHeightVoxels: 2 }, { role: "primary" }),
    mass("grand-gatehouse", 0, -29, 30, 34, height + 12,
      { type: "gable", heightVoxels: [18, 24, 30][i], orientation: "north_south", finialHeightVoxels: 5 },
      { role: "entrance", facade: { ...gothic, openness: 0.38, entranceEmphasis: 1, floorHeightVoxels: 22, bayWidthVoxels: 10, stringCourseHeightVoxels: 1, corniceHeightVoxels: 2, cornerPierWidthVoxels: 2, pedimentHeightVoxels: 10, pedimentWidthVoxels: 22 } })
  ];
  for (const side of [-1, 1]) {
    masses.push(mass(`return-wing-${side}`, side * 77, 6, 22, 50, height - 14,
      { type: "mansard", heightVoxels: 16, dormerCount: 3, ridgeRailHeightVoxels: 2 }));
    masses.push(mass(`gabled-bay-${side}`, side * 34, -28, 19, 34, height + (side < 0 ? 4 : 10),
      { type: "gable", heightVoxels: 19, orientation: "north_south", finialHeightVoxels: 4 }));
  }
  const clockHeight = [68, 112, 150][i];
  masses.push(mass(level === 1 ? "west-pavilion" : "clock-tower", -65, -27, 28, 34, clockHeight,
    { type: "parapet", parapetHeightVoxels: 4 }, { role: "crown" }));
  masses.push(mass("clock-crown", -65, -27, 24, 28, 10,
    { type: "spire", heightVoxels: [20, 30, 42][i], ribCount: 4, ringCount: 2, finialHeightVoxels: 8 },
    { baseYVoxels: clockHeight + 7, materials: { ...materials, trim: "limestone" } }));
  masses.push(mass("east-octagonal-turret", 79, -27, 22, 28, [60, 82, 108][i],
    { type: "spire", heightVoxels: [20, 28, 36][i], ribCount: 8, ringCount: 2, finialHeightVoxels: 6 }, { planShape: "octagonal" }));
  return masses;
}

export function createVictorianStation(level = 1, options = {}) {
  level = clampInteger(level, 1, 3);
  const spec = createRailwayStationSpec(level, options);
  const root = new THREE.Group();
  root.name = `VictorianStation-${level}`;
  const architecturePipeline = createVoxelMassingLodLevels({ ...spec, masses: spec.masses.filter((mass) => mass.railwayArchitecture), renderStrategy: "greedy", maxMergeSpanVoxels: 12 });
  const architecture = createVoxelAssetLod(architecturePipeline.levels[0].group, { ...architecturePipeline, levels: architecturePipeline.levels.slice(1) });
  architecture.userData.lodFactors = [1, 2, 3];
  architecture.name = "RailwayPublicArchitecture";
  root.add(architecture);
  const buffer = new VoxelInstanceBuffer(`${spec.seed}:bespoke`);
  // Brick chimneys, striped stone string courses, and small corner pinnacles
  // break up the mansard silhouette without replacing the massing grammar.
  const height = [44, 62, 80][level - 1];
  for (const x of [-46, -22, 22, 48, 66]) {
    buffer.addBox("brickBrown", x, height + 12, -19, 5, 16, 6);
    buffer.addBox("sandstone", x - 1, height + 24, -20, 7, 2, 8);
    for (const dx of [0, 3]) buffer.addBox("brickRed", x + dx, height + 28, -18, 2, 4, 3);
  }
  for (let x = -84; x <= 84; x += 8) {
    buffer.addBox("sandstone", x, height - 2, -43, 2, 3, 3);
  }
  // A recessed city entrance with a pointed archivolt and a glazed iron porch.
  for (let dx = -11; dx <= 11; dx++) {
    const archY = 13 + Math.round(12 * (1 - Math.abs(dx) / 12));
    buffer.addBox("iron", dx, 3, -47, 1, archY - 3, 1);
    buffer.addBox("sandstone", dx, archY, -49, 1, 3, 3);
    if (dx % 4 === 0) buffer.addBox("gildedMetal", dx, 4, -48, 1, archY - 5, 1);
  }
  buffer.addBox("lightGlass", -20, 27, -48, 40, 2, 8);
  for (const x of [-20, 18]) buffer.addBox("iron", x, 3, -48, 2, 24, 2);
  if (level > 1) {
    const cy = [0, 100, 138][level - 1];
    for (const z of [-47, -8]) {
      for (let dx = -10; dx <= 10; dx++) for (let dy = -10; dy <= 10; dy++) {
        const rr = dx * dx + dy * dy;
        if (rr <= 100) buffer.addVoxel(rr > 77 ? "sandstone" : "limestone", -65 + dx, cy + dy, z);
      }
      const face = z === -47 ? z - 1 : z + 1;
      for (const [dx, dy] of [[0, 8], [8, 0], [0, -8], [-8, 0]]) buffer.addBox("iron", -65 + dx, cy + dy, face, 1, 2, 1);
      buffer.addBox("iron", -65, cy, face, 1, 7, 1);
      buffer.addBox("iron", -65, cy, face, 6, 1, 1);
    }
    for (const x of [-78, -54]) for (const z of [-43, -12]) {
      buffer.addBox("sandstone", x, cy + 11, z, 2, 10, 2);
      buffer.addBox("gildedMetal", x, cy + 21, z, 1, 4, 1);
    }
  }
  const details = meshBuffer(buffer, "StPancrasBespokeDetails");
  root.add(details);
  const shed = createLongitudinalTrainShed(level, { seed: spec.seed, trackOffsetVoxels: options.trackOffsetVoxels ?? 64 });
  root.add(shed);
  root.userData.spec = spec;
  root.userData.architectureDiagnostics = architecturePipeline.levels.map((level) => level.diagnostics);
  root.userData.spec.metadata.trainShed = structuredClone(shed.userData.contract);
  const windows = [];
  root.traverse((object) => { if (object.userData.materialId === "warmWindow") windows.push(object.material); });
  root.userData.updateDaylight = (style) => {
    architecture.userData.updateDaylight?.(style);
    const night = style.nightFactor ?? style.night ?? style.nightLighting ?? 0;
    for (const material of windows) material.emissiveIntensity = 0.3 + night * 1.5;
  };
  return root;
}

export function createLongitudinalTrainShed(level = 1, { seed = "train-shed", trackOffsetVoxels = 64 } = {}) {
  level = clampInteger(level, 1, 3);
  const buffer = new VoxelInstanceBuffer(`${seed}:longitudinal-shed`);
  const length = [176, 224, 256][level - 1], radius = 16;
  const spring = [40, 48, 56][level - 1], rise = [16, 20, 24][level - 1];
  const trackZ = Math.round(trackOffsetVoxels);
  // Long axis X follows the railway. No end walls or cross-track columns:
  // only the arched roof and posts outside the train's swept clearance box.
  for (let dz = -radius; dz <= radius; dz++) {
    const y = spring + Math.round(Math.sqrt(1 - dz * dz / (radius * radius)) * rise);
    const adjacent = Math.min(radius, Math.abs(dz) + 1);
    const lowerY = spring + Math.round(Math.sqrt(1 - adjacent * adjacent / (radius * radius)) * rise);
    // Fill the vertical riser as well as its tread: adjacent samples can differ
    // by several voxels near the eaves. A one-voxel strip leaves visible holes.
    buffer.addBox("lightGlass", -length / 2, lowerY, trackZ + dz, length, y - lowerY + 2, 1);
    for (let x = -length / 2; x <= length / 2; x += 16) buffer.addBox("iron", x, lowerY + 1, trackZ + dz, 2, y - lowerY + 3, 1);
  }
  for (const z of [trackZ - radius, trackZ + radius]) {
    buffer.addBox("iron", -length / 2, spring, z, length, 2, 2);
    for (let x = -length / 2; x <= length / 2; x += 32) {
      buffer.addBox("iron", x, 0, z, 2, spring, 2);
      buffer.addBox("sandstone", x - 1, 0, z - 1, 4, 5, 4);
      for (let d = 0; d < 6; d++) buffer.addBox("iron", x - d, spring - 7 + d, z, 2 * d + 2, 1, 2);
    }
  }
  // A raised continuous ridge vent gives the steam a visible escape route.
  buffer.addBox("iron", -length / 2, spring + rise + 3, trackZ - 3, length, 2, 7);
  for (let x = -length / 2; x <= length / 2; x += 16) buffer.addBox("iron", x, spring + rise, trackZ, 1, 4, 1);
  const root = meshBuffer(buffer, "LongitudinalTrainShed", false, { preserveThinSurfaces: true });
  root.userData.contract = { axis: "east_west", trackCenterLocalZ: trackZ * VOXEL_SIZE, lengthWorld: length * VOXEL_SIZE, halfWidthWorld: radius * VOXEL_SIZE, minimumRoofHeightWorld: spring * VOXEL_SIZE, openEnds: true };
  return root;
}

function addForecourts(root, railway, byId, cellWorldSize, seed, roadSurfaceVoxelY = -1, level = 1) {
  const paving = new VoxelInstanceBuffer(`${seed}:forecourt`);
  const furniture = new VoxelInstanceBuffer(`${seed}:forecourt-gardens`);
  const trees = [];
  const cells = railway.forecourt.cellIds.map((id) => byId.get(id)).filter(Boolean);
  if (!cells.length) return;
  const cx = Math.round(average(cells.map((cell) => cell.center.x)) / VOXEL_SIZE);
  const cz = Math.round(average(cells.map((cell) => cell.center.z)) / VOXEL_SIZE);
  const groundY = roadSurfaceVoxelY + 1;
  const halfX = Math.round(cellWorldSize * 3 / VOXEL_SIZE), halfZ = Math.round(cellWorldSize * 1.5 / VOXEL_SIZE);
  for (const cell of cells) {
    const minX = Math.round((cell.center.x - cellWorldSize / 2) / VOXEL_SIZE);
    const minZ = Math.round((cell.center.z - cellWorldSize / 2) / VOXEL_SIZE);
    const size = Math.round(cellWorldSize / VOXEL_SIZE);
    for (let x = minX; x < minX + size; x++) for (let z = minZ; z < minZ + size; z++) {
      const dx = x - cx, dz = z - cz;
      const border = Math.abs(dx) >= halfX - 3 || Math.abs(dz) >= halfZ - 3;
      const axis = Math.abs(dx - 8) < 24;
      const inlay = !axis && ((Math.abs(dx) + Math.abs(dz)) % 24 < 2);
      const material = cell.id === railway.urbanConnectionPoint.cellId ? "road" : border ? "sandstone" : axis ? "limestone" : inlay ? "stoneShadow" : "pavement";
      paving.addVoxel(material, x, roadSurfaceVoxelY, z);
    }
  }
  const box = (material, x, y, z, w, h, d) => furniture.addBox(material, cx + x, groundY + y, cz + z, w, h, d);
  const gardenX = Math.round(halfX * 0.66), gardenZ = Math.round(halfZ * 0.55);
  for (const x of [-gardenX, gardenX]) for (const z of [-gardenZ, gardenZ]) {
    box("sandstone", x - 13, 0, z - 9, 26, 3, 18);
    box("soil", x - 11, 3, z - 7, 22, 1, 14);
    box("foliageDark", x - 10, 4, z - 6, 20, 3, 12);
    for (const dx of [-7, 6]) for (const dz of [-4, 3]) box("blossomPink", x + dx, 7, z + dz, 3, 2, 3);
    const template = z < 0 ? "round-0" : "round-1";
    const scale = 0.66;
    const metrics = getVoxelTreeMetrics(template, scale);
    trees.push({ x: cx + x, y: groundY + 4, z: cz + z, template, scale,
      rotation: 0, shade: trees.length * 3, heightVoxels: metrics.height,
      crownWidth: metrics.crownWidth, trunkWidth: metrics.trunkWidth });
  }
  for (const x of [-gardenX, gardenX]) {
    box("iron", x - 10, 0, -4, 2, 5, 2); box("iron", x + 8, 0, -4, 2, 5, 2);
    box("timber", x - 12, 5, -5, 24, 2, 6); box("timber", x - 12, 7, -5, 24, 6, 1);
  }
  for (const x of [-halfX + 9, halfX - 9]) for (const z of [-halfZ + 10, halfZ - 10]) {
    addSharedVoxelRoadLamp(furniture, { x: cx + x, z: cz + z, surfaceY: roadSurfaceVoxelY, shade: x + z });
  }
  // Two low ornamental basins sit beside the clear central arrival route.
  if (level >= 2) for (const x of [-gardenX + 23, gardenX - 21]) {
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      if (Math.abs(dx) + Math.abs(dz) > 12) continue;
      box(Math.abs(dx) + Math.abs(dz) > 9 ? "sandstone" : "waterLight", x + dx, 1, dz, 1, 3, 1);
    }
    box("limestone", x - 1, 4, -1, 3, 5, 3);
    box("waterLight", x, 9, 0, 1, 5, 1);
  }
  root.add(meshBuffer(paving, "RailwayStationForecourts"));
  const gardens = meshBuffer(furniture, "RailwayForecourtGardens");
  gardens.userData.contract = { clearArrivalAxis: true, gardens: 4, benches: 2, lamps: 4, fountains: level > 1 ? 2 : 0 };
  const treeRenderer = createVoxelTreeLodRenderer(trees, { initialLod: 0 });
  treeRenderer.name = "RailwayForecourtTrees";
  root.add(treeRenderer);
  gardens.userData.updateTrees = (camera, viewport) => treeRenderer.userData.updateView(camera, viewport);
  gardens.userData.getTreeDiagnostics = () => treeRenderer.userData.getDiagnostics();
  const lamps = [];
  gardens.traverse((mesh) => { if (mesh.userData.materialId === "warmWindow") lamps.push(mesh.material); });
  gardens.userData.updateDaylight = (style) => {
    const night = style.nightFactor ?? style.night ?? 0;
    for (const material of lamps) material.emissiveIntensity = 0.3 + night * 1.5;
  };
  root.add(gardens);
  return gardens;
}

function addLocomotive(buffer, x, wheels) {
  buffer.addBox("iron", x, 9, -9, 64, 3, 18);
  // Cab at the tender end; cylindrical boiler and chimney at the leading +X end.
  buffer.addBox("brickRed", x + 1, 12, -9, 15, 23, 18);
  for (const z of [-10, 9]) buffer.addBox("warmWindow", x + 4, 23, z, 9, 9, 1);
  buffer.addBox("iron", x - 1, 35, -11, 19, 3, 22);
  for (let y = -9; y <= 9; y++) {
    const half = Math.floor(Math.sqrt(81 - y * y));
    buffer.addBox("brickRed", x + 16, 23 + y, -half, 37, 1, Math.max(1, half * 2));
    buffer.addBox("iron", x + 53, 23 + y, -half, 8, 1, Math.max(1, half * 2));
    for (const band of [20, 35, 50]) buffer.addBox("gildedMetal", x + band, 23 + y, -half, 1, 1, Math.max(1, half * 2));
  }
  buffer.addBox("iron", x + 47, 30, -3, 6, 11, 6);
  buffer.addBox("iron", x + 45, 40, -5, 10, 3, 10);
  buffer.addBox("gildedMetal", x + 27, 31, -3, 6, 4, 6);
  buffer.addBox("brickRed", x + 62, 10, -11, 3, 4, 22);
  for (const z of [-8, 6]) buffer.addBox("iron", x + 65, 10, z, 3, 3, 3);
  buffer.addBox("warmWindow", x + 61, 24, -2, 2, 4, 4);
  for (const z of [-10, 9]) buffer.addBox("gildedMetal", x + 4, 17, z, 8, 3, 1);
  for (const cx of [x + 17, x + 31, x + 45]) addWheelPair(buffer, cx, 8, wheels, 0, 8);
  addWheelPair(buffer, x + 58, 5, wheels, 0, 5);
}

function addTender(buffer, x, wheels) {
  buffer.addBox("iron", x, 8, -8, 30, 3, 16);
  buffer.addBox("brickRed", x + 1, 11, -8, 28, 15, 16);
  buffer.addBox("iron", x + 3, 25, -6, 24, 2, 12);
  for (let dx = 4; dx < 26; dx += 5) buffer.addBox("iron", x + dx, 27, -4 + dx % 3, 4, 2 + dx % 4, 5);
  for (const z of [-9, 8]) {
    buffer.addBox("gildedMetal", x + 3, 13, z, 24, 1, 1);
    buffer.addBox("gildedMetal", x + 12, 18, z, 7, 4, 1);
  }
  for (const dx of [6, 15, 24]) addWheelPair(buffer, x + dx, 5, wheels, 0, 5);
}

function addCoach(buffer, x, length, _index, wheels, shade) {
  buffer.addBox("iron", x - 2, 8, -7, length + 4, 3, 14, shade);
  buffer.addBox("brickRed", x, 11, -9, length, 21, 18, shade);
  for (let z = -10; z <= 10; z++) {
    const roofY = 32 + Math.round(4 * Math.sqrt(Math.max(0, 1 - z * z / 100)));
    buffer.addBox("slate", x - 1, roofY, z, length + 2, 2, 1, shade);
  }
  for (const z of [-10, 9]) {
    for (let wx = x + 5; wx < x + length - 4; wx += 9) {
      buffer.addBox("sandstone", wx - 1, 21, z, 7, 9, 1, shade);
      buffer.addBox("warmWindow", wx, 22, z, 5, 7, 1, shade);
    }
    buffer.addBox("gildedMetal", x + 1, 18, z, length - 2, 1, 1, shade);
    buffer.addBox("gildedMetal", x + 1, 12, z, length - 2, 1, 1, shade);
  }
  for (const dx of [7, 15, length - 15, length - 7]) addWheelPair(buffer, x + dx, 5, wheels, shade, 5);
}

function addWheelPair(_buffer, centerX, centerY, wheels, _shade, radius = 6) {
  for (const z of [-7, 7]) wheels.push([centerX, centerY, z, radius]);
}

function createSteamPuffs() {
  const group = new THREE.Group();
  group.name = "LayeredSteamClouds";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const light = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: "#fff5df", transparent: true, opacity: 0.64, depthWrite: false }), 60);
  const shade = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: "#b9c7cf", transparent: true, opacity: 0.36, depthWrite: false }), 24);
  group.add(shade, light);
  const dummy = new THREE.Object3D();
  for (const mesh of [light, shade]) { mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  group.userData.update = (elapsed) => {
    let li = 0, si = 0;
    for (let i = 0; i < 12; i++) {
      const phase = ((elapsed * 0.23 + i / 12) % 1 + 1) % 1;
      const envelope = Math.sin(Math.PI * phase) ** 0.45;
      const size = (0.4 + phase * 1.7) * envelope;
      for (let j = 0; j < 7; j++) {
        const angle = j * 2.399 + i * 0.7;
        dummy.position.set(-phase * 5.5 + Math.cos(angle) * size * 0.65 + Math.sin(i * 1.9) * phase * 0.35, phase * 5.7 + Math.sin(angle) * size * 0.42, Math.sin(angle * 1.3) * size * 0.75);
        dummy.scale.set(size * (0.8 + j % 3 * 0.16), size * (0.55 + j % 2 * 0.24), size * 0.85);
        dummy.rotation.set(0, Math.sin(angle) * 0.12, 0);
        dummy.updateMatrix();
        if (j < 2) shade.setMatrixAt(si++, dummy.matrix); else light.setMatrixAt(li++, dummy.matrix);
      }
    }
    light.instanceMatrix.needsUpdate = true;
    shade.instanceMatrix.needsUpdate = true;
  };
  return group;
}

function meshBuffer(buffer, name, moving = false, { preserveThinSurfaces = false } = {}) {
  const group = new THREE.Group();
  group.name = name;
  // Rails are selected in short sections; one map-wide bounding sphere would
  // permanently force the whole corridor to the finest building LOD.
  const chunks = new Map();
  for (const voxel of buffer.voxels.values()) {
    const key = name === "VoxelRailTrack" ? Math.floor(voxel.x / 128) : 0;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(voxel);
  }
  const totals = { renderedTriangles: 0, meshCount: 0, sourceVoxelCount: buffer.voxels.size, strategy: "greedy-chunks-mip-lod" };
  for (const [key, voxels] of chunks) {
    const minX = Math.min(...voxels.map((v) => v.x)), maxX = Math.max(...voxels.map((v) => v.x));
    const minZ = Math.min(...voxels.map((v) => v.z)), maxZ = Math.max(...voxels.map((v) => v.z));
    // Align the local origin to all three mip grids so world anchoring survives
    // the 1x/2x/3x aggregation and the spherical prefab projection.
    const ox = Math.round((minX + maxX) / 12) * 6, oz = Math.round((minZ + maxZ) / 12) * 6;
    const local = new VoxelInstanceBuffer(`${buffer.seed}:${key}`);
    for (const v of voxels) local.addVoxel(v.materialId, v.x - ox, v.y, v.z - oz, v.shadeKey, { priority: v.priority, owner: v.owner });
    const levels = [1, 2, 3].map((factor) => {
      const field = factor === 1 ? local : local.createDownsampled(factor, preserveThinSurfaces ? { minimumOccupancy: 1 } : {});
      const rendered = renderRailwayBuffer(field, `${name}-${factor}x`, moving);
      rendered.userData.lodFactor = factor;
      if (factor === 1) {
        totals.renderedTriangles += field.renderStats.renderedTriangles;
        totals.meshCount += field.renderStats.meshCount;
      }
      return { factor, group: rendered, meshes: rendered.children, diagnostics: structuredClone(field.renderStats) };
    });
    const lod = createVoxelAssetLod(levels[0].group, { levels: levels.slice(1) });
    lod.name = `${name}-LOD-${key}`;
    lod.position.set(ox * VOXEL_SIZE, 0, oz * VOXEL_SIZE);
    lod.userData.lodFactors = [1, 2, 3];
    lod.userData.levelDiagnostics = levels.map((level) => level.diagnostics);
    group.add(lod);
  }
  buffer.renderStats = totals;
  return group;
}

function renderRailwayBuffer(buffer, name, moving) {
  const group = new THREE.Group();
  group.name = name;
  const palette = {
    brickRed: ["#8d2433", 0.48, 0.18], iron: ["#252d32", 0.6, 0.35],
    slate: ["#30383c", 0.82, 0.12], gildedMetal: ["#d5ad64", 0.4, 0.55],
    sandstone: ["#c6a47b", 0.76, 0], warmWindow: ["#e5b773", 0.38, 0.08]
  };
  buffer.createMeshes({ strategy: "greedy", chunkSizeVoxels: 256, maxMergeSpanVoxels: 24, mergeOpaque: !moving }).forEach((mesh) => {
    if (moving) {
      const [color, roughness, metalness] = palette[mesh.userData.materialId] ?? ["#513c35", 0.8, 0];
      mesh.material.dispose();
      mesh.material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      if (mesh.userData.materialId === "warmWindow") {
        mesh.material.emissive.set("#b87836");
        mesh.material.emissiveIntensity = 0.32;
      }
      mesh.material.userData.textureSpace = "local";
    }
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
