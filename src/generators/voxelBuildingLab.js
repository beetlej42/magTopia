import * as THREE from "three";
import { createRng } from "../utils/random.js";

export const VOXEL_SIZE = 0.125;
export const VOXEL_PARCEL = Object.freeze({
  width: 32,
  depth: 36,
  floorHeight: 20,
  worldWidth: 4,
  worldDepth: 4.5
});

const ROOF_TYPES = ["gable", "mansard", "magic_asymmetric"];
const UPPER_WINDOW_CENTERS = [9, 23];
const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];
const BRICK_SCHEMES = [
  ["brickRed", "brickBrown", "brickRed"],
  ["brickBrown", "brickRed", "brickBrown"],
  ["brickRed", "brickRed", "brickBrown"]
];

const MATERIAL_LIBRARY = Object.freeze({
  brickRed: {
    colors: ["#9f5847", "#a9634f", "#8f4d40", "#b06b54"],
    roughness: 0.94
  },
  brickBrown: {
    colors: ["#62453f", "#704b42", "#583d39", "#795148"],
    roughness: 0.96
  },
  sandstone: {
    colors: ["#c9b796", "#d4c4a6", "#baa783"],
    roughness: 0.9
  },
  limestone: {
    colors: ["#d8d0c0", "#c9c1b4", "#e0d9ca"],
    roughness: 0.92
  },
  slate: {
    colors: ["#485262", "#566173", "#3c4655", "#626b7a"],
    roughness: 0.91
  },
  timber: {
    colors: ["#273f3d", "#2e4d48", "#3f312c", "#4c382f"],
    roughness: 0.88
  },
  glass: {
    colors: ["#263a43", "#304b51", "#36545a"],
    roughness: 0.3,
    metalness: 0.05
  },
  warmWindow: {
    colors: ["#f1b65b", "#ffc96d", "#df9345"],
    roughness: 0.55,
    emissive: "#f2a94f",
    emissiveIntensity: 0.35
  },
  foliage: {
    colors: ["#557748", "#6d8b50", "#3f6849", "#8b9950"],
    roughness: 1
  },
  violetMagic: {
    colors: ["#8067b8", "#9a79d0", "#684f9e"],
    roughness: 0.5,
    emissive: "#7650bd",
    emissiveIntensity: 0.45
  },
  tealMagic: {
    colors: ["#5dacaa", "#78c4b9", "#438f91"],
    roughness: 0.5,
    emissive: "#4eb6ae",
    emissiveIntensity: 0.45
  },
  iron: {
    colors: ["#252b31", "#343a40", "#1c2228"],
    roughness: 0.8,
    metalness: 0.25
  },
  pavement: {
    colors: ["#aaa49a", "#b9b2a6", "#96938e"],
    roughness: 1
  },
  road: {
    colors: ["#686b70", "#74767a", "#5e6268"],
    roughness: 1
  }
});

export const VOXEL_BUILDING_PRESETS = Object.freeze({
  connectedTerraceDay: {
    seed: "voxel-terrace-day-001",
    sunTime: 0.52,
    nightLighting: 0.08,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    roofVariant: 0,
    materialScheme: 0,
    detailDensity: 0.82
  },
  connectedTerraceNight: {
    seed: "voxel-terrace-night-001",
    sunTime: 0.03,
    nightLighting: 1,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 0,
    roofVariant: 0,
    materialScheme: 0,
    detailDensity: 0.92
  },
  addFloorStudy: {
    seed: "voxel-add-floor-001",
    sunTime: 0.42,
    nightLighting: 0.3,
    buildingCount: 3,
    floors: 3,
    expansionFloors: 1,
    roofVariant: 1,
    materialScheme: 1,
    detailDensity: 0.9
  }
});

export function normalizeVoxelBuildingConfig(config = {}) {
  const base = { ...VOXEL_BUILDING_PRESETS.connectedTerraceDay, ...config };
  return {
    ...base,
    seed: String(base.seed || "voxel-terrace-001"),
    sunTime: clamp(base.sunTime, 0, 1),
    nightLighting: clamp(base.nightLighting, 0, 1),
    buildingCount: Math.round(clamp(base.buildingCount, 1, 3)),
    floors: Math.round(clamp(base.floors, 2, 5)),
    expansionFloors: Math.round(clamp(base.expansionFloors, 0, 2)),
    roofVariant: Math.round(clamp(base.roofVariant, 0, ROOF_TYPES.length - 1)),
    materialScheme: Math.round(clamp(base.materialScheme, 0, BRICK_SCHEMES.length - 1)),
    detailDensity: clamp(base.detailDensity, 0, 1)
  };
}

export function planVoxelStreet(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const streetWidth = params.buildingCount * VOXEL_PARCEL.width;
  const firstX = -streetWidth / 2;
  const expansionIndex = Math.floor(params.buildingCount / 2);
  const scheme = BRICK_SCHEMES[params.materialScheme];
  const rng = createRng(params.seed);

  const buildings = Array.from({ length: params.buildingCount }, (_, index) => {
    const expandedBy = index === expansionIndex ? params.expansionFloors : 0;
    const floors = params.floors + expandedBy;
    const roofType = ROOF_TYPES[(params.roofVariant + index) % ROOF_TYPES.length];
    return {
      id: `voxel-building-${index + 1}`,
      index,
      origin: {
        x: firstX + index * VOXEL_PARCEL.width,
        y: 0,
        z: -VOXEL_PARCEL.depth / 2
      },
      footprint: {
        widthVoxels: VOXEL_PARCEL.width,
        depthVoxels: VOXEL_PARCEL.depth,
        worldWidth: VOXEL_PARCEL.worldWidth,
        worldDepth: VOXEL_PARCEL.worldDepth
      },
      baseFloors: params.floors,
      floors,
      expandedBy,
      wallHeightVoxels: floors * VOXEL_PARCEL.floorHeight,
      roof: {
        type: roofType,
        seed: Math.floor(rng() * 0x7fffffff),
        ...roofParametersForType(roofType, VOXEL_PARCEL.depth)
      },
      materials: {
        wall: scheme[index % scheme.length],
        trim: index === 1 ? "limestone" : "sandstone",
        roof: "slate",
        shopfront: "timber",
        window: "warmWindow"
      },
      adjacency: {
        left: index > 0 ? `voxel-building-${index}` : null,
        right: index < params.buildingCount - 1 ? `voxel-building-${index + 2}` : null,
        exposedLeftWall: index === 0,
        exposedRightWall: index === params.buildingCount - 1
      },
      ports: {
        entrance: { face: "south", x: 26, y: 0, z: VOXEL_PARCEL.depth - 1 },
        verticalExpansion: { face: "up", floor: floors },
        leftPartyWall: index > 0,
        rightPartyWall: index < params.buildingCount - 1
      }
    };
  });

  return {
    renderer: "voxel-procedural-v1",
    seed: params.seed,
    voxelSize: VOXEL_SIZE,
    parcel: structuredClone(VOXEL_PARCEL),
    streetWidthVoxels: streetWidth,
    buildings,
    connections: buildings.slice(0, -1).map((building, index) => ({
      type: "party_wall",
      from: building.id,
      to: buildings[index + 1].id,
      sharedBoundaryX: building.origin.x + VOXEL_PARCEL.width
    }))
  };
}

export function getVoxelBuildingContract(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const plan = planVoxelStreet(params);
  return {
    mode: "voxel",
    renderer: plan.renderer,
    sourceOfTruth: "deterministic BuildingSpec + seed; rendered voxels are derived",
    resolution: {
      voxelSize: VOXEL_SIZE,
      voxelUnit: "world",
      voxelsPerFourUnitParcel: VOXEL_PARCEL.width
    },
    meshing: {
      prototypeStrategy: "mutually-exclusive sparse voxel field + surface-culled instanced boxes",
      conflictPolicy: "last write wins at each integer voxel coordinate",
      solidInteriors: false,
      productionTarget: "chunked greedy surface mesh"
    },
    roofSystem: {
      type: "adaptive pitched roof profile",
      ridgeAxis: "parallel to the terrace frontage",
      parameters: ["width", "depth", "ridge height", "ridge ratio", "front exponent", "back exponent", "overhang", "thickness"],
      endCaps: "filled only on exposed outer gable ends; party-wall exposure is envelope-derived"
    },
    agentControl: {
      simple: ["archetype", "footprint", "floors", "style", "quality"],
      advanced: ["roof.type", "facade.rhythm", "component materials", "decoration slots"],
      decoration: "sparse voxel patches applied after deterministic generation"
    },
    expansion: {
      supported: true,
      strategy: "preserve lower floors, append floor modules, regenerate roof"
    },
    adjacency: {
      supported: true,
      strategy: "party-wall ports suppress shared exterior faces"
    },
    materialIds: Object.keys(MATERIAL_LIBRARY),
    config: params,
    plan
  };
}

export function createVoxelBuildingLab(config = {}) {
  const params = normalizeVoxelBuildingConfig(config);
  const plan = planVoxelStreet(params);
  const root = new THREE.Group();
  root.name = "VoxelBuildingLab";

  const buffer = new VoxelInstanceBuffer(params.seed);
  addStreetBase(buffer, plan);
  plan.buildings.forEach((building) => addBuilding(buffer, building, params));
  const exposedPartyWallVoxels = addPartyWallExposures(buffer, plan);

  const materialMeshes = buffer.createMeshes();
  materialMeshes.forEach((mesh) => root.add(mesh));

  const lamps = addStreetLamps(root, plan);
  const windowLights = addWindowLights(root, plan);
  const diagnostics = {
    voxelSize: VOXEL_SIZE,
    instanceCount: buffer.instanceCount,
    drawCalls: materialMeshes.length,
    materialCounts: buffer.materialCounts(),
    buildingCount: plan.buildings.length,
    connectionCount: plan.connections.length,
    omittedPartyWalls: plan.connections.length * 2,
    exposedPartyWallVoxels,
    overwrittenVoxels: buffer.overwrittenVoxelCount,
    culledInteriorVoxels: buffer.culledInteriorVoxelCount,
    occupiedVoxels: buffer.occupiedVoxelCount,
    surfaceOnly: true,
    expandedBuildingId: plan.buildings.find((building) => building.expandedBy > 0)?.id ?? null,
    magicDecorationPlacement: "upper_window"
  };

  root.userData.config = params;
  root.userData.plan = plan;
  root.userData.contract = getVoxelBuildingContract(params);
  root.userData.diagnostics = diagnostics;
  root.userData.getVoxelDiagnostics = () => structuredClone(diagnostics);
  root.userData.getVoxelContract = () => structuredClone(root.userData.contract);
  root.userData.updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, params.nightLighting), 0, 1);
    materialMeshes.forEach((mesh) => {
      const materialId = mesh.userData.materialId;
      const definition = MATERIAL_LIBRARY[materialId];
      if (!definition?.emissive) return;
      const magic = materialId === "violetMagic" || materialId === "tealMagic";
      mesh.material.emissiveIntensity = (magic ? 0.48 : 0.15) + night * (magic ? 1.55 : 1.8);
    });
    windowLights.forEach((light, index) => {
      light.intensity = night * (index === 1 ? 8 : 6);
      light.distance = 5 + night * 1.5;
    });
    lamps.forEach((lamp) => {
      lamp.light.intensity = night * 4.5;
      lamp.bulb.material.emissiveIntensity = 0.25 + night * 2;
    });
  };
  root.userData.updateDaylight(voxelDaylightStyle(params.sunTime));
  return root;
}

export function voxelDaylightStyle(sunTime = 0.52) {
  const time = clamp(sunTime, 0, 1);
  const noon = Math.sin(time * Math.PI);
  const nightFactor = Math.pow(1 - noon, 1.35);
  const skyColor = new THREE.Color("#172238").lerp(new THREE.Color("#c5deea"), noon);
  const sunColor = new THREE.Color("#e39a66").lerp(new THREE.Color("#fff0cc"), noon);
  return {
    sunColor,
    skyColor,
    rgbTint: new THREE.Color("#8d83b8").lerp(new THREE.Color("#fff7e8"), noon),
    ambientSky: new THREE.Color("#27314a").lerp(new THREE.Color("#e5f2f5"), noon),
    ambientGround: new THREE.Color("#242c37").lerp(new THREE.Color("#9da992"), noon),
    ambientIntensity: 0.48 + noon * 1.85,
    sunIntensity: 0.22 + noon * 2.5,
    rimIntensity: 0.55 + nightFactor * 0.9,
    nightFactor,
    sunPosition: new THREE.Vector3(-8 + time * 16, 2 + noon * 10, 7)
  };
}

export function planPitchedRoof(options = {}) {
  const width = Math.max(4, Math.round(options.width ?? VOXEL_PARCEL.width));
  const depth = Math.max(4, Math.round(options.depth ?? VOXEL_PARCEL.depth));
  const baseY = Math.round(options.baseY ?? 0);
  const overhang = Math.max(0, Math.round(options.overhang ?? 1));
  const thickness = Math.max(1, Math.round(options.thickness ?? 1));
  const ridgeRatio = clamp(options.ridgeRatio ?? 0.5, 0.2, 0.8);
  const ridgeHeight = Math.max(2, Math.round(options.ridgeHeight ?? depth * 0.34));
  const backExponent = clamp(options.backExponent ?? 1, 0.5, 3);
  const frontExponent = clamp(options.frontExponent ?? 1, 0.5, 3);
  const capLeft = options.capLeft !== false;
  const capRight = options.capRight !== false;
  const crossSpan = depth + overhang * 2;
  const ridgeIndex = Math.round(clamp((crossSpan - 1) * ridgeRatio, 1, crossSpan - 2));
  const xStart = capLeft ? -overhang : 0;
  const xEnd = width - 1 + (capRight ? overhang : 0);
  const profile = [];
  const surface = [];
  const endCaps = { left: [], right: [] };

  for (let index = 0; index < crossSpan; index += 1) {
    const z = index - overhang;
    const approachingRidge = index <= ridgeIndex;
    const run = approachingRidge ? ridgeIndex : crossSpan - 1 - ridgeIndex;
    const distance = approachingRidge ? index : crossSpan - 1 - index;
    const t = run === 0 ? 1 : clamp(distance / run, 0, 1);
    const exponent = approachingRidge ? backExponent : frontExponent;
    const rise = Math.round(ridgeHeight * (1 - ((1 - t) ** exponent)));
    const y = baseY + rise;
    profile.push({ z, y });
    for (let x = xStart; x <= xEnd; x += 1) {
      for (let layer = 0; layer < thickness; layer += 1) {
        surface.push({ x, y: y - layer, z });
      }
    }
  }

  for (let localZ = 0; localZ < depth; localZ += 1) {
    const roofY = profile[localZ + overhang].y;
    if (capLeft) {
      for (let y = baseY; y < roofY; y += 1) endCaps.left.push({ x: 0, y, z: localZ });
    }
    if (capRight) {
      for (let y = baseY; y < roofY; y += 1) endCaps.right.push({ x: width - 1, y, z: localZ });
    }
  }

  return {
    width,
    depth,
    baseY,
    overhang,
    thickness,
    ridgeRatio,
    ridgeHeight,
    ridgeIndex,
    ridgeZ: ridgeIndex - overhang,
    ridgeY: baseY + ridgeHeight,
    profile,
    surface,
    endCaps
  };
}

export class VoxelInstanceBuffer {
  constructor(seed) {
    this.seed = seed;
    this.voxels = new Map();
    this.visibleInstances = null;
    this.instanceCount = 0;
    this.occupiedVoxelCount = 0;
    this.overwrittenVoxelCount = 0;
    this.culledInteriorVoxelCount = 0;
  }

  addVoxel(materialId, x, y, z, shadeKey = 0) {
    if (!MATERIAL_LIBRARY[materialId]) throw new Error(`Unknown voxel material: ${materialId}`);
    const position = {
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z)
    };
    const key = voxelKey(position.x, position.y, position.z);
    if (this.voxels.has(key)) this.overwrittenVoxelCount += 1;
    this.voxels.set(key, { ...position, materialId, shadeKey });
    this.visibleInstances = null;
    this.occupiedVoxelCount = this.voxels.size;
  }

  addBox(materialId, x, y, z, width, height, depth, shadeKey = 0) {
    if (!MATERIAL_LIBRARY[materialId]) throw new Error(`Unknown voxel material: ${materialId}`);
    if (width <= 0 || height <= 0 || depth <= 0) return;
    const minX = Math.round(x);
    const minY = Math.round(y);
    const minZ = Math.round(z);
    const maxX = minX + Math.round(width);
    const maxY = minY + Math.round(height);
    const maxZ = minZ + Math.round(depth);
    for (let voxelY = minY; voxelY < maxY; voxelY += 1) {
      for (let voxelZ = minZ; voxelZ < maxZ; voxelZ += 1) {
        for (let voxelX = minX; voxelX < maxX; voxelX += 1) {
          this.addVoxel(materialId, voxelX, voxelY, voxelZ, shadeKey);
        }
      }
    }
  }

  materialCounts() {
    return Object.fromEntries([...this.getVisibleInstances()].map(([id, instances]) => [id, instances.length]));
  }

  getMaterialAt(x, y, z) {
    return this.voxels.get(voxelKey(x, y, z))?.materialId ?? null;
  }

  getVisibleInstances() {
    if (this.visibleInstances) return this.visibleInstances;
    const instances = new Map();
    let culled = 0;
    for (const voxel of this.voxels.values()) {
      const hidden = VOXEL_NEIGHBORS.every(([dx, dy, dz]) => (
        this.voxels.has(voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz))
      ));
      if (hidden) {
        culled += 1;
        continue;
      }
      if (!instances.has(voxel.materialId)) instances.set(voxel.materialId, []);
      instances.get(voxel.materialId).push(voxel);
    }
    this.visibleInstances = instances;
    this.culledInteriorVoxelCount = culled;
    this.instanceCount = [...instances.values()].reduce((total, values) => total + values.length, 0);
    return instances;
  }

  createMeshes() {
    const dummy = new THREE.Object3D();
    return [...this.getVisibleInstances()].map(([materialId, instances]) => {
      const definition = MATERIAL_LIBRARY[materialId];
      const material = new THREE.MeshStandardMaterial({
        color: definition.colors[0],
        roughness: definition.roughness,
        metalness: definition.metalness ?? 0,
        emissive: definition.emissive ?? "#000000",
        emissiveIntensity: definition.emissiveIntensity ?? 0,
        flatShading: true
      });
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, instances.length);
      mesh.name = `VoxelMaterial-${materialId}`;
      mesh.userData.materialId = materialId;
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      instances.forEach((instance, index) => {
        const gap = 0.985;
        dummy.position.set(
          (instance.x + 0.5) * VOXEL_SIZE,
          (instance.y + 0.5) * VOXEL_SIZE,
          (instance.z + 0.5) * VOXEL_SIZE
        );
        dummy.scale.set(
          VOXEL_SIZE * gap,
          VOXEL_SIZE * gap,
          VOXEL_SIZE * gap
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      return mesh;
    });
  }
}

function addStreetBase(buffer, plan) {
  const width = plan.streetWidthVoxels + 16;
  const startX = -width / 2;
  const front = VOXEL_PARCEL.depth / 2;
  buffer.addBox("pavement", startX, -2, -VOXEL_PARCEL.depth / 2 - 3, width, 2, VOXEL_PARCEL.depth + 18, 1);
  buffer.addBox("pavement", startX - 4, -1, front, width + 8, 2, 10, 2);
  buffer.addBox("road", startX - 8, -2, front + 10, width + 16, 1, 28, 3);

  for (let x = startX - 4; x < startX + width + 4; x += 4) {
    buffer.addBox("limestone", x, 1, front + 8, 3, 1, 2, x);
  }
}

function addBuilding(buffer, building, params) {
  const { widthVoxels: width, depthVoxels: depth } = building.footprint;
  const xStart = building.origin.x;
  const zBack = building.origin.z;
  const zFront = zBack + depth - 1;
  const wallHeight = building.wallHeightVoxels;

  addFacade(buffer, building, params, xStart, zFront, wallHeight);
  addBackWall(buffer, building, xStart, zBack, wallHeight);
  if (building.adjacency.exposedLeftWall) addSideWall(buffer, building, xStart, zBack, wallHeight, depth, "left");
  if (building.adjacency.exposedRightWall) addSideWall(buffer, building, xStart + width - 1, zBack, wallHeight, depth, "right");
  addFacadeModules(buffer, building, params, xStart, zFront);
  addRoof(buffer, building, xStart, zBack, zFront);
  addChimneys(buffer, building, xStart, zBack);
  addMagicDecoration(buffer, building, params, xStart, zFront);
}

function addFacade(buffer, building, params, xStart, zFront, wallHeight) {
  const width = building.footprint.widthVoxels;
  for (let y = 0; y < wallHeight; y += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      if (isFrontOpening(localX, y, building.floors)) continue;
      const shade = hashNumber(localX, y, building.index, params.seed);
      buffer.addVoxel(building.materials.wall, xStart + localX, y, zFront, shade);
    }
  }
}

function addBackWall(buffer, building, xStart, zBack, wallHeight) {
  const width = building.footprint.widthVoxels;
  for (let y = 0; y < wallHeight; y += 1) {
    for (let localX = 0; localX < width; localX += 2) {
      buffer.addBox(building.materials.wall, xStart + localX, y, zBack, Math.min(2, width - localX), 1, 1, localX + y * 7);
    }
  }
}

function addSideWall(buffer, building, x, zBack, wallHeight, depth, side) {
  for (let y = 0; y < wallHeight; y += 1) {
    for (let localZ = 1; localZ < depth - 1; localZ += 2) {
      buffer.addBox(
        building.materials.wall,
        x,
        y,
        zBack + localZ,
        1,
        1,
        Math.min(2, depth - 1 - localZ),
        localZ + y * 5 + (side === "left" ? 11 : 23)
      );
    }
  }
  for (let y = 0; y < wallHeight; y += 5) {
    buffer.addBox(building.materials.trim, x + (side === "left" ? -1 : 0), y, zBack + depth - 3, 2, 2, 3, y);
  }
}

function addFacadeModules(buffer, building, params, xStart, zFront) {
  const width = building.footprint.widthVoxels;
  const wallHeight = building.wallHeightVoxels;
  const trim = building.materials.trim;

  buffer.addBox("timber", xStart + 2, 2, zFront + 1, width - 4, 14, 2, building.index);
  buffer.addBox("warmWindow", xStart + 4, 4, zFront + 3, 8, 10, 1, 1);
  buffer.addBox("warmWindow", xStart + 14, 4, zFront + 3, 8, 10, 1, 2);
  buffer.addBox("timber", xStart + 24, 2, zFront + 2, 6, 14, 2, 3);
  buffer.addBox("warmWindow", xStart + 25, 8, zFront + 4, 4, 6, 1, 4);
  buffer.addBox(trim, xStart + 1, 16, zFront, width - 2, 3, 3, 5);
  buffer.addBox("timber", xStart + 3, 18, zFront + 1, width - 6, 3, 2, 6);

  for (let floor = 1; floor < building.floors; floor += 1) {
    const floorY = floor * VOXEL_PARCEL.floorHeight;
    UPPER_WINDOW_CENTERS.forEach((center, bayIndex) => {
      const windowX = xStart + center - 3;
      buffer.addBox("warmWindow", windowX, floorY + 5, zFront + 1, 6, 10, 1, floor * 10 + bayIndex);
      buffer.addBox(trim, windowX - 1, floorY + 4, zFront, 1, 12, 2, bayIndex);
      buffer.addBox(trim, windowX + 6, floorY + 4, zFront, 1, 12, 2, bayIndex + 1);
      buffer.addBox(trim, windowX - 1, floorY + 4, zFront, 8, 1, 2, bayIndex + 2);
      buffer.addBox(trim, windowX - 1, floorY + 15, zFront, 8, 2, 3, bayIndex + 3);
      buffer.addBox("timber", windowX + 2, floorY + 5, zFront + 2, 1, 10, 1, bayIndex + 4);
      if (params.detailDensity > 0.45 && (floor + bayIndex + building.index) % 2 === 0) {
        addFlowerBox(buffer, windowX, floorY + 16, zFront + 3, bayIndex + floor);
      }
    });
    buffer.addBox(trim, xStart - 1, floorY - 1, zFront, width + 2, 2, 2, floor);
  }

  buffer.addBox(trim, xStart - 1, wallHeight - 2, zFront - 1, width + 2, 3, 3, 17);
  buffer.addBox("limestone", xStart - 2, wallHeight + 1, zFront - 2, width + 4, 2, 4, 19);
  buffer.addBox(trim, xStart, 0, zFront + 1, 2, wallHeight, 2, 29);
  buffer.addBox(trim, xStart + width - 2, 0, zFront + 1, 2, wallHeight, 2, 31);
}

function addFlowerBox(buffer, x, y, z, shade) {
  buffer.addBox("timber", x, y, z, 6, 2, 2, shade);
  [0, 2, 4].forEach((offset, index) => {
    buffer.addBox("foliage", x + offset, y + 2, z, 2, 2 + (index % 2), 2, shade + index);
  });
}

function addRoof(buffer, building, xStart, zBack, zFront) {
  const roofPlan = roofPlanForBuilding(building);
  roofPlan.surface.forEach((voxel, index) => {
    buffer.addVoxel("slate", xStart + voxel.x, voxel.y, zBack + voxel.z, index);
  });
  roofPlan.endCaps.left.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 101);
  });
  roofPlan.endCaps.right.forEach((voxel, index) => {
    buffer.addVoxel(building.materials.wall, xStart + voxel.x, voxel.y, zBack + voxel.z, index + 211);
  });

  const ridgeStartX = building.adjacency.exposedLeftWall ? -roofPlan.overhang : 0;
  const ridgeEndX = building.footprint.widthVoxels - 1 + (building.adjacency.exposedRightWall ? roofPlan.overhang : 0);
  for (let localX = ridgeStartX; localX <= ridgeEndX; localX += 1) {
    buffer.addVoxel("iron", xStart + localX, roofPlan.ridgeY + 1, zBack + roofPlan.ridgeZ, localX + 47);
  }

  const dormerLocalZ = Math.max(4, building.footprint.depthVoxels - 7);
  const dormerRoofY = roofSurfaceYAt(roofPlan, dormerLocalZ);
  const dormerCenters = building.footprint.widthVoxels >= 24
    ? [Math.round(building.footprint.widthVoxels * 0.28), Math.round(building.footprint.widthVoxels * 0.72)]
    : [Math.round(building.footprint.widthVoxels * 0.5)];
  dormerCenters.forEach((center, index) => {
    addDormer(
      buffer,
      xStart + center - 3,
      dormerRoofY - 2,
      zBack + dormerLocalZ,
      building.materials.trim,
      index + building.index * 3
    );
  });
}

function addDormer(buffer, x, y, z, trim, shade) {
  buffer.addBox("slate", x - 1, y, z - 2, 8, 7, 4, shade);
  buffer.addBox("warmWindow", x + 1, y + 2, z + 2, 4, 3, 1, shade + 1);
  buffer.addBox(trim, x, y + 1, z + 1, 1, 5, 2, shade + 2);
  buffer.addBox(trim, x + 5, y + 1, z + 1, 1, 5, 2, shade + 3);
  buffer.addBox(trim, x, y + 5, z + 1, 6, 1, 2, shade + 4);
}

function addChimneys(buffer, building, xStart, zBack) {
  const roofPlan = roofPlanForBuilding(building);
  const positions = building.index % 2 === 0 ? [5, 25] : [8, 22];
  positions.forEach((localX, index) => {
    const localZ = 9 + index * 12;
    const top = roofSurfaceYAt(roofPlan, localZ) - 1;
    buffer.addBox(building.materials.wall, xStart + localX, top, zBack + localZ, 4, 12, 4, index);
    buffer.addBox("sandstone", xStart + localX - 1, top + 11, zBack + localZ - 1, 6, 2, 6, index + 1);
    buffer.addBox(building.materials.wall, xStart + localX, top + 13, zBack + localZ, 1, 3, 1, index + 2);
    buffer.addBox(building.materials.wall, xStart + localX + 2, top + 13, zBack + localZ + 2, 1, 3, 1, index + 3);
  });
}

function addMagicDecoration(buffer, building, params, xStart, zFront) {
  if (params.detailDensity < 0.25) return;
  if (building.index === Math.floor(params.buildingCount / 2)) {
    const decoratedFloor = Math.min(2, building.floors - 1);
    const windowCenter = UPPER_WINDOW_CENTERS[building.index % UPPER_WINDOW_CENTERS.length];
    const y = decoratedFloor * VOXEL_PARCEL.floorHeight + 7;
    buffer.addBox("violetMagic", xStart + windowCenter - 1, y, zFront + 2, 2, 6, 1, 70);
    buffer.addVoxel("tealMagic", xStart + windowCenter - 3, y + 1, zFront + 2, 71);
    buffer.addVoxel("tealMagic", xStart + windowCenter + 2, y + 4, zFront + 2, 72);
  } else if (params.detailDensity > 0.75) {
    buffer.addBox("foliage", xStart + (building.index === 0 ? 1 : 29), 7, zFront + 2, 2, 16, 2, 73 + building.index);
  }
}

function addPartyWallExposures(buffer, plan) {
  let added = 0;
  for (let index = 0; index < plan.buildings.length - 1; index += 1) {
    const left = plan.buildings[index];
    const right = plan.buildings[index + 1];
    const leftRoof = roofPlanForBuilding(left);
    const rightRoof = roofPlanForBuilding(right);
    const boundaryX = right.origin.x;
    const depth = Math.min(left.footprint.depthVoxels, right.footprint.depthVoxels);
    for (let localZ = 0; localZ < depth; localZ += 1) {
      const leftEnvelope = roofSurfaceYAt(leftRoof, localZ) + 1;
      const rightEnvelope = roofSurfaceYAt(rightRoof, localZ) + 1;
      if (leftEnvelope === rightEnvelope) continue;
      const taller = leftEnvelope > rightEnvelope ? left : right;
      const lowerEnvelope = Math.min(leftEnvelope, rightEnvelope);
      const upperEnvelope = Math.max(leftEnvelope, rightEnvelope);
      const x = taller === left ? boundaryX - 1 : boundaryX;
      const z = taller.origin.z + localZ;
      for (let y = lowerEnvelope; y < upperEnvelope - 1; y += 1) {
        buffer.addVoxel(taller.materials.wall, x, y, z, index * 1000 + localZ * 20 + y);
        added += 1;
      }
    }
  }
  return added;
}

function roofPlanForBuilding(building) {
  return planPitchedRoof({
    width: building.footprint.widthVoxels,
    depth: building.footprint.depthVoxels,
    baseY: building.wallHeightVoxels,
    overhang: building.roof.overhang,
    thickness: building.roof.thickness,
    ridgeRatio: building.roof.ridgeRatio,
    ridgeHeight: building.roof.ridgeHeight,
    backExponent: building.roof.backExponent,
    frontExponent: building.roof.frontExponent,
    capLeft: building.adjacency.exposedLeftWall,
    capRight: building.adjacency.exposedRightWall
  });
}

function roofSurfaceYAt(roofPlan, localZ) {
  const index = Math.round(clamp(localZ + roofPlan.overhang, 0, roofPlan.profile.length - 1));
  return roofPlan.profile[index].y;
}

function addStreetLamps(root, plan) {
  const lamps = [];
  const xStart = -plan.streetWidthVoxels / 2;
  for (let index = 0; index <= plan.buildings.length; index += 1) {
    const x = (xStart + index * VOXEL_PARCEL.width) * VOXEL_SIZE;
    const z = (VOXEL_PARCEL.depth / 2 + 7) * VOXEL_SIZE;
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(VOXEL_SIZE * 1.2, VOXEL_SIZE * 22, VOXEL_SIZE * 1.2),
      new THREE.MeshStandardMaterial({ color: "#252b31", roughness: 0.78, metalness: 0.25 })
    );
    post.position.y = VOXEL_SIZE * 11;
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: "#f5c878",
      emissive: "#f2a94f",
      emissiveIntensity: 0.25,
      roughness: 0.45
    });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(VOXEL_SIZE * 4, VOXEL_SIZE * 5, VOXEL_SIZE * 4), bulbMaterial);
    bulb.position.y = VOXEL_SIZE * 24;
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(VOXEL_SIZE * 3.1, VOXEL_SIZE * 3, 4),
      new THREE.MeshStandardMaterial({ color: "#252b31", roughness: 0.78, metalness: 0.25 })
    );
    cap.position.y = VOXEL_SIZE * 28;
    cap.rotation.y = Math.PI / 4;
    const light = new THREE.PointLight("#f2aa55", 0, 5.5, 2);
    light.position.y = VOXEL_SIZE * 24;
    group.position.set(x, 0, z);
    group.add(post, bulb, cap, light);
    root.add(group);
    lamps.push({ light, bulb });
  }
  return lamps;
}

function addWindowLights(root, plan) {
  return plan.buildings.map((building) => {
    const light = new THREE.PointLight("#f2aa55", 0, 6, 2);
    light.position.set(
      (building.origin.x + VOXEL_PARCEL.width / 2) * VOXEL_SIZE,
      VOXEL_SIZE * 10,
      VOXEL_SIZE * (VOXEL_PARCEL.depth / 2 + 4)
    );
    root.add(light);
    return light;
  });
}

function isFrontOpening(localX, y, floors) {
  const floor = Math.floor(y / VOXEL_PARCEL.floorHeight);
  const localY = y % VOXEL_PARCEL.floorHeight;
  if (floor >= floors) return false;
  if (floor === 0) return localX >= 2 && localX <= 29 && localY >= 2 && localY <= 18;
  if (localY < 4 || localY > 16) return false;
  return UPPER_WINDOW_CENTERS.some((center) => localX >= center - 4 && localX <= center + 3);
}

function roofParametersForType(type, depth) {
  if (type === "mansard") {
    return {
      overhang: 1,
      thickness: 1,
      ridgeRatio: 0.5,
      ridgeHeight: Math.max(6, Math.round(depth * 0.31)),
      backExponent: 2.2,
      frontExponent: 2.2
    };
  }
  if (type === "magic_asymmetric") {
    return {
      overhang: 1,
      thickness: 1,
      ridgeRatio: 0.58,
      ridgeHeight: Math.max(7, Math.round(depth * 0.4)),
      backExponent: 1.25,
      frontExponent: 1.8
    };
  }
  return {
    overhang: 1,
    thickness: 1,
    ridgeRatio: 0.5,
    ridgeHeight: Math.max(6, Math.round(depth * 0.34)),
    backExponent: 1,
    frontExponent: 1
  };
}

function hashNumber(...values) {
  let hash = 2166136261;
  const text = values.join(":");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function voxelKey(x, y, z) {
  return `${x},${y},${z}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}
