import * as THREE from "three";
import { CARDINAL_ROAD_OFFSETS } from "../city/road-topology.js";
import { createRng, pick, randRange } from "../utils/random.js";
import { getVoxelSphereFrame } from "./voxelIntentDistrict.js";
import { createPedestrianAsset, createVehicleAsset } from "./streetLifeAssets.js";

const PERSON_CITY_SCALE = 0.62;
const CAR_CITY_SCALE = 0.68;
const BUS_CITY_SCALE = 0.62;
const ROAD_WIDTH = 2;
const LANE_WIDTH = ROAD_WIDTH / 2;
const SIDEWALK_OFFSET = 1.43;
const VEHICLE_LANE_OFFSET = 0.5;
const LOD_IDS = ["near", "medium", "culled"];

export function createStreetLifeCityPlan({ state, grid, seed = "city-street-life", density = 1 } = {}) {
  const stableDensity = clamp(Number(density), 0, 1.5);
  const roadCells = collectRoadCells(state, grid);
  const roadsById = new Map(roadCells.map((cell) => [cell.id, cell]));
  const roadsByCoordinate = new Map(roadCells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const adjacency = createRoadAdjacency(roadCells, roadsByCoordinate);
  const components = collectRoadComponents(roadCells, adjacency);
  const primaryComponent = components[0] ?? [];
  const primaryIds = new Set(primaryComponent);
  const entranceIds = collectBuildingEntranceRoadIds(state, roadsById).filter((id) => primaryIds.has(id));
  const rng = createRng(`${seed}:plan`);
  if (primaryComponent.length < 2 || stableDensity <= 0) {
    return emptyStreetLifePlan(seed, roadCells.length, components.length);
  }

  const pedestrianCount = Math.round(clamp(
    Math.max(6, entranceIds.length * 2, primaryComponent.length * 0.16) * stableDensity,
    0,
    28
  ));
  const vehicleCount = Math.round(clamp(primaryComponent.length / 7 * stableDensity, 2, 12));
  const pedestrianTargets = entranceIds.length >= 2 ? entranceIds : primaryComponent;
  const pedestrians = Array.from({ length: pedestrianCount }, (_, index) => {
    const routeIds = chooseRoundTripRoute(pedestrianTargets, adjacency, rng, index);
    return {
      id: `pedestrian-${index}`,
      seed: `${seed}:pedestrian:${index}`,
      kind: "pedestrian",
      routeCellIds: routeIds,
      sidewalkSide: rng() < 0.5 ? -1 : 1,
      speed: randRange(rng, 0.48, 0.82),
      phase: rng()
    };
  }).filter((entry) => entry.routeCellIds.length >= 2);
  const vehicles = Array.from({ length: vehicleCount }, (_, index) => {
    const routeIds = chooseRoundTripRoute(primaryComponent, adjacency, rng, index + 97);
    return {
      id: `vehicle-${index}`,
      seed: `${seed}:vehicle:${index}`,
      kind: "vehicle",
      type: index === 0 ? "hatchback" : index === 1 ? "saloon" : index === 2 && primaryComponent.length >= 9 ? "bus" : pick(rng, ["hatchback", "saloon"]),
      flying: index > 1 && rng() < 0.055,
      routeCellIds: routeIds,
      laneSide: index % 2 === 0 ? -1 : 1,
      speed: randRange(rng, 1.05, 1.72),
      phase: rng()
    };
  }).filter((entry) => entry.routeCellIds.length >= 2);

  return {
    seed: String(seed),
    renderer: "street-life-routed-lod-v1",
    coordinateAuthority: "flat Agent road graph",
    roadCellCount: roadCells.length,
    connectedComponentCount: components.length,
    primaryComponentCellCount: primaryComponent.length,
    buildingEntranceCount: entranceIds.length,
    pedestrianCount: pedestrians.length,
    vehicleCount: vehicles.length,
    pedestrians,
    vehicles
  };
}

export function createStreetLifeCityLayer({
  state,
  grid,
  seed = "city-street-life",
  planetRadius = 220,
  sampleGroundHeight = () => 0,
  density = 1
} = {}) {
  const plan = createStreetLifeCityPlan({ state, grid, seed, density });
  const group = new THREE.Group();
  group.name = "AgentAcceptanceStreetLife";
  group.userData.dynamicSubtree = true;
  const cellsById = new Map((grid?.cells ?? []).map((cell) => [cell.id, cell]));
  const entities = [];

  plan.pedestrians.forEach((spec) => {
    const route = createRouteCurve(spec.routeCellIds, cellsById, {
      offset: SIDEWALK_OFFSET * spec.sidewalkSide,
      sampleGroundHeight,
      crossing: true
    });
    if (!route) return;
    const near = createPedestrianAsset({
      seed: spec.seed,
      magicRatio: 0.31,
      capeRatio: 0.52
    });
    near.name = `${spec.id}-Near`;
    near.traverse(disableDynamicShadows);
    const entity = createLodEntity(spec, route, near, null, {
      planetRadius,
      scale: PERSON_CITY_SCALE,
      forwardAxis: "z",
      boundingDiameter: 1.45,
      distanceLod: false
    });
    entities.push(entity);
    group.add(entity.root);
  });

  plan.vehicles.forEach((spec) => {
    const route = createRouteCurve(spec.routeCellIds, cellsById, {
      offset: VEHICLE_LANE_OFFSET * spec.laneSide,
      sampleGroundHeight,
      crossing: false
    });
    if (!route) return;
    const near = createVehicleAsset({ seed: spec.seed, type: spec.type, flying: spec.flying });
    near.name = `${spec.id}-Near`;
    near.traverse(disableDynamicShadows);
    const medium = createMediumVehicle(near.userData.variant);
    const entity = createLodEntity(spec, route, near, medium, {
      planetRadius,
      scale: spec.type === "bus" ? BUS_CITY_SCALE : CAR_CITY_SCALE,
      forwardAxis: "x",
      boundingDiameter: spec.type === "bus" ? 3 : 2.15
    });
    entities.push(entity);
    group.add(entity.root);
  });

  const diagnostics = {
    renderer: plan.renderer,
    sourceRoadCells: plan.roadCellCount,
    connectedComponents: plan.connectedComponentCount,
    routedBuildingEntrances: plan.buildingEntranceCount,
    pedestrianCount: entities.filter((entry) => entry.spec.kind === "pedestrian").length,
    vehicleCount: entities.filter((entry) => entry.spec.kind === "vehicle").length,
    flyingVehicleCount: entities.filter((entry) => entry.spec.kind === "vehicle" && entry.spec.flying).length,
    cityScale: {
      pedestrian: PERSON_CITY_SCALE,
      roadWidth: ROAD_WIDTH,
      laneWidth: LANE_WIDTH,
      hatchback: { scale: CAR_CITY_SCALE, length: 2.35 * CAR_CITY_SCALE, width: 1.12 * CAR_CITY_SCALE },
      saloon: { scale: CAR_CITY_SCALE, length: 2.75 * CAR_CITY_SCALE, width: 1.15 * CAR_CITY_SCALE },
      bus: { scale: BUS_CITY_SCALE, length: 4.4 * BUS_CITY_SCALE, width: 1.48 * BUS_CITY_SCALE }
    },
    lodPolicy: {
      levels: [...LOD_IDS],
      pedestrians: "full-detail while inside the view frustum; no distance LOD",
      vehicles: "near/medium/culled distance LOD",
      nearMinimumDiameterPx: 32,
      mediumMinimumDiameterPx: 7,
      mediumUpdateHz: 15,
      culledUpdateHz: 0,
      shadowPolicy: "street-life-never-casts-dynamic-shadows"
    },
    animationPolicy: {
      pedestrians: "walk-cycle enabled in near view; frozen pose in far view",
      pedestrianWalkIntensity: 0.9
    },
    currentLodCounts: { near: entities.length, medium: 0, culled: 0 },
    updatedEntitiesLastFrame: 0
  };

  group.userData.plan = plan;
  group.userData.diagnostics = diagnostics;
  group.userData.update = (elapsed) => {
    let updated = 0;
    entities.forEach((entity) => {
      if (entity.level === 2) return;
      if (entity.level === 1 && elapsed - entity.lastUpdateAt < 1 / 15) return;
      updateEntityAlongRoute(entity, elapsed);
      entity.lastUpdateAt = elapsed;
      updated += 1;
    });
    diagnostics.updatedEntitiesLastFrame = updated;
  };
  group.userData.updateView = (camera, viewport = {}) => {
    const pedestrianAnimationEnabled = viewport.viewMode !== "far";
    entities.forEach((entity) => {
      if (entity.spec.kind === "pedestrian") entity.pedestrianAnimationEnabled = pedestrianAnimationEnabled;
    });
    updateStreetLifeLod(entities, camera, viewport, diagnostics);
  };
  group.userData.getDiagnostics = () => structuredClone(diagnostics);
  group.userData.getContract = () => ({
    renderer: plan.renderer,
    movement: {
      pedestrians: "building entrance routes offset onto sidewalks, with endpoint crossings",
      vehicles: "connected Agent road graph with stable lane offsets",
      flyingCars: "rare road-route vehicle variant with local hover"
    },
    scale: structuredClone(diagnostics.cityScale),
    lod: structuredClone(diagnostics.lodPolicy),
    animation: structuredClone(diagnostics.animationPolicy)
  });
  group.userData.update(0);
  return group;
}

function collectRoadCells(state, grid) {
  return (grid?.cells ?? [])
    .filter((cell) => state?.cells?.[cell.id]?.infrastructure === "road" || state?.infrastructure?.[cell.id]?.type === "bridge")
    .sort((left, right) => left.row - right.row || left.column - right.column || left.id.localeCompare(right.id));
}

function createRoadAdjacency(roadCells, roadsByCoordinate) {
  return new Map(roadCells.map((cell) => [cell.id, Object.values(CARDINAL_ROAD_OFFSETS)
    .map(([dc, dr]) => roadsByCoordinate.get(`${cell.column + dc}:${cell.row + dr}`)?.id)
    .filter(Boolean)
    .sort()]));
}

function collectRoadComponents(roadCells, adjacency) {
  const pending = new Set(roadCells.map((cell) => cell.id));
  const components = [];
  while (pending.size) {
    const start = pending.values().next().value;
    const component = [];
    const queue = [start];
    pending.delete(start);
    while (queue.length) {
      const id = queue.shift();
      component.push(id);
      (adjacency.get(id) ?? []).forEach((neighbor) => {
        if (!pending.has(neighbor)) return;
        pending.delete(neighbor);
        queue.push(neighbor);
      });
    }
    components.push(component.sort());
  }
  return components.sort((left, right) => right.length - left.length || left[0]?.localeCompare(right[0]));
}

function collectBuildingEntranceRoadIds(state, roadsById) {
  return [...new Set(Object.values(state?.buildings ?? {}).map((building) => (
    building.site?.entranceCellId
      ?? building.voxelDesign?.ports?.find((port) => port.type === "primary_entrance")?.frontageCellId
  )).filter((id) => roadsById.has(id)))].sort();
}

function chooseRoundTripRoute(targetIds, adjacency, rng, salt) {
  if (targetIds.length < 2) return [];
  const startIndex = Math.floor(rng() * targetIds.length + salt) % targetIds.length;
  const start = targetIds[startIndex];
  const candidates = targetIds.filter((id) => id !== start);
  const target = candidates[Math.floor(rng() * candidates.length) % candidates.length];
  const outbound = findShortestRoadPath(start, target, adjacency);
  if (outbound.length < 2) return [];
  return [...outbound, ...outbound.slice(1, -1).reverse()];
}

export function findShortestRoadPath(start, target, adjacency) {
  if (start === target) return [start];
  const previous = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of adjacency.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (neighbor === target) {
        const path = [target];
        for (let cursor = current; cursor; cursor = previous.get(cursor)) path.push(cursor);
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return [];
}

function createRouteCurve(cellIds, cellsById, { offset, sampleGroundHeight, crossing }) {
  const cells = cellIds.map((id) => cellsById.get(id)).filter(Boolean);
  if (cells.length < 2) return null;
  const points = cells.map((cell, index) => {
    const previous = cells[Math.max(0, index - 1)];
    const next = cells[Math.min(cells.length - 1, index + 1)];
    const dx = next.center.x - previous.center.x;
    const dz = next.center.z - previous.center.z;
    const length = Math.hypot(dx, dz) || 1;
    const endpointBlend = crossing && (index === 0 || index === cells.length - 1) ? 0.18 : 1;
    const x = cell.center.x + (-dz / length) * offset * endpointBlend;
    const z = cell.center.z + (dx / length) * offset * endpointBlend;
    return new THREE.Vector3(x, sampleGroundHeight(x, z) + 0.11, z);
  });
  const lengths = [];
  let totalLength = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const length = points[index].distanceTo(next);
    lengths.push(length);
    totalLength += length;
  }
  return totalLength > 0.01 ? { points, lengths, totalLength } : null;
}

function createLodEntity(spec, route, near, medium, options) {
  const root = new THREE.Group();
  root.name = `StreetLife-${spec.id}`;
  root.scale.setScalar(options.scale);
  root.add(near);
  if (medium) root.add(medium);
  near.visible = true;
  if (medium) medium.visible = false;
  return {
    root,
    near,
    medium,
    spec,
    route,
    level: 0,
    lastUpdateAt: -Infinity,
    planetRadius: options.planetRadius,
    forwardAxis: options.forwardAxis,
    boundingDiameter: options.boundingDiameter,
    distanceLod: options.distanceLod !== false,
    pedestrianAnimationEnabled: spec.kind === "pedestrian"
  };
}

function updateEntityAlongRoute(entity, elapsed) {
  const distance = (entity.spec.phase * entity.route.totalLength + elapsed * entity.spec.speed) % entity.route.totalLength;
  const sample = sampleRoute(entity.route, distance);
  const yaw = entity.forwardAxis === "x"
    ? Math.atan2(-sample.direction.z, sample.direction.x)
    : Math.atan2(sample.direction.x, sample.direction.z);
  placeOnVoxelSphere(entity.root, sample.position.x, sample.position.z, sample.position.y, yaw, entity.planetRadius);
  if (entity.spec.kind === "pedestrian" && entity.pedestrianAnimationEnabled) {
    entity.near.userData.updateWalk(elapsed * entity.spec.speed, 0.9);
  }
  if (entity.level === 0 && entity.spec.kind === "vehicle" && entity.spec.flying) {
    entity.near.userData.updateMotion(elapsed);
  }
}

function sampleRoute(route, distance) {
  let remaining = distance;
  for (let index = 0; index < route.points.length; index += 1) {
    const length = route.lengths[index];
    if (remaining <= length || index === route.points.length - 1) {
      const start = route.points[index];
      const end = route.points[(index + 1) % route.points.length];
      const alpha = length > 0.0001 ? remaining / length : 0;
      return {
        position: start.clone().lerp(end, alpha),
        direction: end.clone().sub(start).normalize()
      };
    }
    remaining -= length;
  }
  return { position: route.points[0].clone(), direction: new THREE.Vector3(1, 0, 0) };
}

function placeOnVoxelSphere(object, x, z, height, yaw, radius) {
  const frame = getVoxelSphereFrame(x, z, radius);
  const basis = new THREE.Matrix4().makeBasis(frame.tangentX, frame.normal, frame.tangentZ);
  const surfaceQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  object.position.copy(frame.surface).addScaledVector(frame.normal, height);
  object.quaternion.copy(surfaceQuaternion).multiply(yawQuaternion);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function updateStreetLifeLod(entities, camera, viewport, diagnostics) {
  if (!camera) return;
  const viewportHeight = Math.max(1, Number(viewport.height) || 720) * Math.max(1, Number(viewport.renderScale) || 1);
  const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
  const counts = { near: 0, medium: 0, culled: 0 };
  const farView = viewport.viewMode === "far";
  const quality = clamp(Number(viewport.qualityScale) || 1, 0.8, 1.5);
  const nearThreshold = (farView ? 42 : 32) * quality;
  const mediumThreshold = (farView ? 9 : 7) * quality;
  entities.forEach((entity) => {
    const worldPosition = entity.root.getWorldPosition(new THREE.Vector3());
    const visible = frustum.intersectsSphere(new THREE.Sphere(worldPosition, entity.boundingDiameter * 0.65));
    const viewPosition = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
    const viewDepth = Math.max(0.001, -viewPosition.z);
    const pixelsPerWorldUnit = camera.isPerspectiveCamera
      ? viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDepth)
      : viewportHeight / Math.max(0.001, (camera.top - camera.bottom) / camera.zoom);
    const projectedDiameter = entity.boundingDiameter * pixelsPerWorldUnit;
    const level = !visible || viewPosition.z >= 0
      ? 2
      : !entity.distanceLod
        ? 0
        : projectedDiameter >= nearThreshold
          ? 0
          : projectedDiameter >= mediumThreshold ? 1 : 2;
    setEntityLod(entity, level);
    counts[LOD_IDS[level]] += 1;
  });
  diagnostics.currentLodCounts = counts;
}

function setEntityLod(entity, level) {
  if (entity.level === level) return;
  entity.level = level;
  entity.root.visible = level < 2;
  entity.near.visible = level === 0;
  if (entity.medium) entity.medium.visible = level === 1;
  if (level < 2) entity.lastUpdateAt = -Infinity;
}

function createMediumVehicle(variant) {
  const group = new THREE.Group();
  group.name = "VehicleMediumLod";
  const bodyMaterial = new THREE.MeshLambertMaterial({ color: variant.color });
  const darkMaterial = new THREE.MeshLambertMaterial({ color: "#202225" });
  const spec = variant.type === "bus"
    ? { length: 4.4, width: 1.48, baseY: 0.72, cabinLength: 4.05, cabinHeight: 1.9, cabinY: 1.72, wheelRadius: 0.38, axles: [-1.48, 1.48] }
    : variant.type === "saloon"
      ? { length: 2.75, width: 1.15, baseY: 0.58, cabinLength: 1.62, cabinHeight: 0.62, cabinY: 1.1, wheelRadius: 0.3, axles: [-0.87, 0.91] }
      : { length: 2.35, width: 1.12, baseY: 0.56, cabinLength: 1.7, cabinHeight: 0.66, cabinY: 1.12, wheelRadius: 0.29, axles: [-0.72, 0.72] };
  group.add(meshBox(spec.length, spec.baseY, spec.width, bodyMaterial, 0, spec.wheelRadius + spec.baseY * 0.45, 0));
  group.add(meshBox(spec.cabinLength, spec.cabinHeight, spec.width * 0.88, bodyMaterial, variant.type === "hatchback" ? 0.18 : -0.03, spec.cabinY, 0));
  spec.axles.forEach((x) => [-1, 1].forEach((side) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.16, 8), darkMaterial);
    wheel.position.set(x, spec.wheelRadius, side * (spec.width / 2 + 0.03));
    wheel.rotation.x = Math.PI / 2;
    group.add(wheel);
  }));
  group.traverse(disableDynamicShadows);
  return group;
}

function meshBox(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function disableDynamicShadows(object) {
  if (!object.isMesh) return;
  object.castShadow = false;
  object.receiveShadow = false;
}

function emptyStreetLifePlan(seed, roadCellCount, componentCount) {
  return {
    seed: String(seed),
    renderer: "street-life-routed-lod-v1",
    coordinateAuthority: "flat Agent road graph",
    roadCellCount,
    connectedComponentCount: componentCount,
    primaryComponentCellCount: 0,
    buildingEntranceCount: 0,
    pedestrianCount: 0,
    vehicleCount: 0,
    pedestrians: [],
    vehicles: []
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);
}