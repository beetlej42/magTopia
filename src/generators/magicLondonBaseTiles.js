import * as THREE from "three";
import {
  CARDINAL_ROAD_DIRECTIONS as ROAD_DIRECTIONS,
  CARDINAL_ROAD_OFFSETS as ROAD_OFFSETS,
  deriveCardinalRoadPorts
} from "../city/road-topology.js";

const COLORS = {
  road: "#8d8b87",
  roadMarking: "#e6ded0",
  sidewalk: "#b8b1a7",
  curb: "#d9d2c4",
  stone: "#c9b89c",
  stoneDark: "#867e73",
  park: "#78965b",
  parkDark: "#466e4f",
  lampMetal: "#343b49",
  lampGlow: "#f0bf67"
};

const TILE_SURFACE_ELEVATION = 0.085;
const SIDEWALK_SURFACE_ELEVATION = 0.18;
const ROAD_SURFACE_ELEVATION = 0.105;
const STONE_SLAB_MATERIALS = [
  new THREE.MeshStandardMaterial({ color: "#c7c0b5", roughness: 0.99, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#bcb6ad", roughness: 1, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#cec7bc", roughness: 0.98, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#c2bbb1", roughness: 1, flatShading: true })
];
const ROAD_WEAR_MATERIALS = [
  new THREE.MeshStandardMaterial({ color: "#817f7c", roughness: 1, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#999590", roughness: 1, flatShading: true })
];
const ROAD_WORLD_OFFSETS = {
  north: [0, 1],
  east: [1, 0],
  south: [0, -1],
  west: [-1, 0]
};
const OPPOSITE_ROAD_DIRECTION = {
  north: "south",
  east: "west",
  south: "north",
  west: "east"
};

/**
 * A geometry-first kit that sits on top of the continuous height field.  The
 * small demonstration district intentionally uses the same logical parcels
 * that will later be claimed by the city solver.
 */
export function createMagicLondonBaseTileKit({ params, grid, terrain, sampleGroundHeight, plan = createStarterDistrictPlan(grid), roadPlan = [] }) {
  const root = new THREE.Group();
  root.name = "MagicLondonBaseTileKit";
  root.visible = Boolean(params.showBaseTiles);
  const tileSize = grid.cellWorldSize;
  const cells = new Map(grid.cells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const origin = closestCell(grid.cells, 0, 0);
  const lampMaterials = [];
  const pointLights = [];
  const roadTopologies = { end: 0, straight: 0, corner: 0, tee: 0, cross: 0 };

  if (!origin) return root;
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = "BaseTileSurfaces";
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = "BaseTileLightingAndFurniture";
  root.add(surfaceGroup, furnitureGroup);

  [...plan, ...roadPlan].forEach(({ cell, kind, ports, bridge }) => {
    const center = cell.center;
    if (kind === "road") {
      roadTopologies[classifyRoadTopology(ports)] += 1;
      const roadHeight = bridge
        ? (x, z) => Math.max(sampleGroundHeight(x, z), 0.3)
        : sampleGroundHeight;
      addRoadTile(surfaceGroup, center, tileSize, ports, roadHeight, params.cellTerrainTiles);
      if ((cell.column + cell.row) % 5 === 0) {
        addStreetLamp(furnitureGroup, center, tileSize, sampleGroundHeight, lampMaterials, pointLights, 0.3, -0.3);
      }
    } else if (kind === "plaza") {
      addPlazaTile(surfaceGroup, center, tileSize, sampleGroundHeight);
      addGroundLight(furnitureGroup, center, tileSize, sampleGroundHeight, lampMaterials, pointLights);
    } else if (kind === "park") {
      addParkTile(surfaceGroup, center, tileSize, sampleGroundHeight, ports, cell);
      if ((cell.column + cell.row) % 2 === 0) addStreetLamp(furnitureGroup, center, tileSize, sampleGroundHeight, lampMaterials, pointLights, -0.28, 0.28);
    }
  });

  root.userData.contract = getMagicLondonBaseTileContract(params);
  root.userData.contract.renderedRoadTopologies = roadTopologies;
  root.userData.updateDaylight = (style, manualNightLighting = 0) => {
    // The sunlight is strongest near the middle of the day. Fixtures retain a
    // faint warm filament in daylight and become real navigation lights at dusk.
    const daylight = THREE.MathUtils.clamp((style.sunIntensity - 1.15) / 2.1, 0, 1);
    const night = THREE.MathUtils.clamp(manualNightLighting + (1 - daylight) * 0.75, 0, 1);
    lampMaterials.forEach((material) => { material.emissiveIntensity = 0.2 + night * 2.2; });
    pointLights.forEach((light) => { light.intensity = night * light.userData.nightIntensity; });
  };
  return root;
}

export function createRoadRenderPlan(cityState, grid) {
  const roadIds = new Set(Object.values(cityState?.cells ?? {}).filter((cell) => cell.infrastructure === "road").map((cell) => cell.id));
  const bridgeIds = new Set(Object.entries(cityState?.infrastructure ?? {}).filter(([, item]) => item.type === "bridge").map(([id]) => id));
  const allRoadIds = new Set([...roadIds, ...bridgeIds]);
  const gridCells = new Map((grid?.cells ?? []).map((cell) => [cell.id, cell]));
  return [...roadIds].map((id) => {
    const cell = gridCells.get(id) ?? cityState.cells[id] ?? approximateCell(id, grid);
    if (!cell) return null;
    const topology = getRoadTileTopology(cell, allRoadIds, getIsolatedRoadFallbackPorts(cell, cityState));
    return { cell, kind: "road", ...topology, bridge: bridgeIds.has(id) };
  }).concat([...bridgeIds].map((id) => {
    const cell = approximateCell(id, grid);
    if (!cell) return null;
    return { cell, kind: "road", ...getRoadTileTopology(cell, allRoadIds), bridge: true };
  })).filter(Boolean);
}

export function getRoadTileTopology(cell, allRoadIds, fallbackPorts = ["north", "south"]) {
  const roadIds = allRoadIds instanceof Set ? allRoadIds : new Set(allRoadIds ?? []);
  const ports = deriveCardinalRoadPorts(cell, roadIds, fallbackPorts);
  return { ports, topology: classifyRoadTopology(ports) };
}

function getIsolatedRoadFallbackPorts(cell, cityState) {
  const entranceSides = ROAD_DIRECTIONS.filter((direction) => {
    const [dx, dy] = ROAD_OFFSETS[direction];
    const neighbor = cityState?.cells?.[`cell-${cell.column + dx}-${cell.row + dy}`];
    const building = neighbor?.occupancy ? cityState?.buildings?.[neighbor.occupancy] : null;
    return building?.site?.entrance === OPPOSITE_ROAD_DIRECTION[direction];
  });
  const verticalEntrances = entranceSides.filter((direction) => direction === "north" || direction === "south").length;
  const horizontalEntrances = entranceSides.length - verticalEntrances;
  if (verticalEntrances > horizontalEntrances) return ["east", "west"];
  return ["north", "south"];
}

export function classifyRoadTopology(ports = []) {
  if (ports.length >= 4) return "cross";
  if (ports.length === 3) return "tee";
  if (ports.length <= 1) return "end";
  const vertical = ports.includes("north") && ports.includes("south");
  const horizontal = ports.includes("east") && ports.includes("west");
  return vertical || horizontal ? "straight" : "corner";
}

function approximateCell(id, grid) {
  const match = /^cell-(\d+)-(\d+)$/.exec(id ?? "");
  if (!match || !grid?.cells?.length) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  const nearest = [...grid.cells].sort((a, b) => Math.abs(a.column - column) + Math.abs(a.row - row) - (Math.abs(b.column - column) + Math.abs(b.row - row)))[0];
  if (!nearest) return null;
  return { id, column, row, center: { x: nearest.center.x + (column - nearest.column) * grid.cellWorldSize, z: nearest.center.z + (row - nearest.row) * grid.cellWorldSize } };
}

export function getMagicLondonBaseTileContract(params = {}) {
  return {
    id: "magic-london-base-tiles-001",
    layer: "infrastructure_overlay",
    parcelRule: "Each tile is bounded by one logical parcel and conforms to the shared continuous terrain height field.",
    tileFamilies: {
      road: ["end", "straight", "corner", "tee", "cross"],
      civic: ["paved_plaza", "park_path"]
    },
    ports: ["north", "east", "south", "west"],
    lighting: {
      fixtureTypes: ["street_lamp", "flush_ground_light"],
      color: COLORS.lampGlow,
      rule: "Warm light is functional wayfinding: roads, civic nodes and water edges only; magic colours are not used as general illumination."
    },
    enabled: Boolean(params.showBaseTiles)
  };
}

export function createStarterDistrictPlan(grid, cityState = null) {
  const cells = new Map(grid.cells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const origin = closestCell(grid.cells, 0, 0);
  if (!origin) return [];
  const entries = new Map();
  const put = (dx, dy, kind, ports = []) => {
    const cell = cells.get(`${origin.column + dx}:${origin.row + dy}`);
    if (cell) entries.set(cell.id, { cell, kind, ports });
  };
  for (let offset = -8; offset <= 8; offset += 1) {
    put(0, offset, "road", ["north", "south"]);
    put(offset, 0, "road", ["east", "west"]);
  }
  put(0, 0, "road", ["north", "east", "south", "west"]);
  put(5, 4, "plaza");
  put(5, 3, "road", ["north", "south"]);
  put(5, 2, "road", ["north", "south"]);
  put(5, 1, "road", ["north", "south"]);
  put(5, 0, "road", ["north", "south", "west"]);
  put(-6, -5, "road", ["north", "east"]);
  const firstBuildingCellId = Object.values(cityState?.buildings ?? {})[0]?.footprintCells?.[0];
  const firstBuildingCell = grid.cells.find((cell) => cell.id === firstBuildingCellId);
  const gardenOrigin = firstBuildingCell ?? cells.get(`${origin.column - 3}:${origin.row - 3}`) ?? origin;
  const putGarden = (dx, dy, ports) => {
    const cell = cells.get(`${gardenOrigin.column + dx}:${gardenOrigin.row + dy}`);
    if (cell) entries.set(cell.id, { cell, kind: "park", ports });
  };
  putGarden(-2, -2, ["east", "south"]);
  putGarden(-1, -2, ["west", "south"]);
  putGarden(-2, -1, ["north", "east"]);
  putGarden(-1, -1, ["north", "west", "east"]);
  return [...entries.values()];
}

function addRoadTile(target, center, size, ports, sampleHeight, surfaceSegments) {
  const width = size * 0.55;
  const ns = ports.includes("north") || ports.includes("south");
  const ew = ports.includes("east") || ports.includes("west");
  const roadMaterial = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.94, flatShading: false });
  addSidewalkSurfaces(target, center, size, width, ports, ns, ew, sampleHeight, surfaceSegments, roadMaterial);
  addRoadSurface(target, center, size, width, ports, sampleHeight, roadMaterial, surfaceSegments);
  addCurbFaces(target, center, size, width, ports, sampleHeight, surfaceSegments);
  addRoadMarkings(target, center, size, width, ports, sampleHeight);
  addRoadWear(target, center, size, width, ports, sampleHeight);
  if (ports.length >= 3) addJunctionCrosswalks(target, center, size, width, ports, sampleHeight);
}

function addRoadSurface(target, center, size, width, ports, sampleHeight, material, segments) {
  const armLength = (size - width) / 2;
  const armOffset = (size + width) / 4;
  addConformingPatch(target, center, width, width, sampleHeight, material, "RoadJunctionCore", ROAD_SURFACE_ELEVATION, segments);
  if (ports.includes("north")) addConformingPatch(target, { x: center.x, z: center.z + armOffset }, width, armLength, sampleHeight, material, "RoadArmNorth", ROAD_SURFACE_ELEVATION, segments);
  if (ports.includes("south")) addConformingPatch(target, { x: center.x, z: center.z - armOffset }, width, armLength, sampleHeight, material, "RoadArmSouth", ROAD_SURFACE_ELEVATION, segments);
  if (ports.includes("east")) addConformingPatch(target, { x: center.x + armOffset, z: center.z }, armLength, width, sampleHeight, material, "RoadArmEast", ROAD_SURFACE_ELEVATION, segments);
  if (ports.includes("west")) addConformingPatch(target, { x: center.x - armOffset, z: center.z }, armLength, width, sampleHeight, material, "RoadArmWest", ROAD_SURFACE_ELEVATION, segments);
}

function addSidewalkSurfaces(target, center, size, roadWidth, ports, ns, ew, sampleHeight, segments, roadMaterial) {
  const sidewalkWidth = (size - roadWidth) / 2;
  const material = new THREE.MeshStandardMaterial({ color: COLORS.sidewalk, roughness: 0.97, flatShading: false });
  const addSlab = (x, z, width, depth, name = "ClosedRaisedSidewalk") => {
    const points = rectanglePolygon({ x, z }, width, depth);
    addClosedConformingPolygon(target, points, sampleHeight, material, name, TILE_SURFACE_ELEVATION, SIDEWALK_SURFACE_ELEVATION);
    addPaverTiles(target, points, sampleHeight);
  };
  if (ns && ew) {
    [-1, 1].forEach((xSign) => [-1, 1].forEach((zSign) => {
      const horizontalPort = xSign < 0 ? "west" : "east";
      const verticalPort = zSign < 0 ? "south" : "north";
      if (ports.includes(horizontalPort) && ports.includes(verticalPort)) addChamferedCornerSidewalk(target, center, size, roadWidth, sidewalkWidth, xSign, zSign, sampleHeight, segments, material, roadMaterial);
      else addSlab(center.x + xSign * (roadWidth + sidewalkWidth) / 2, center.z + zSign * (roadWidth + sidewalkWidth) / 2, sidewalkWidth, sidewalkWidth);
    }));
  } else if (ns) {
    [-1, 1].forEach((sign) => addSlab(center.x + sign * (roadWidth + sidewalkWidth) / 2, center.z, sidewalkWidth, size));
  } else if (ew) {
    [-1, 1].forEach((sign) => addSlab(center.x, center.z + sign * (roadWidth + sidewalkWidth) / 2, size, sidewalkWidth));
  }

  const endCapDirections = ns && ew
    ? ROAD_DIRECTIONS
    : ns
      ? ["north", "south"]
      : ["east", "west"];
  const armOffset = (size + roadWidth) / 4;
  endCapDirections.filter((direction) => !ports.includes(direction)).forEach((direction) => {
    const [dx, dz] = ROAD_WORLD_OFFSETS[direction];
    addSlab(
      center.x + dx * armOffset,
      center.z + dz * armOffset,
      dx === 0 ? roadWidth : sidewalkWidth,
      dz === 0 ? roadWidth : sidewalkWidth,
      "ClosedRoadEndSidewalkCap"
    );
  });
}

function addChamferedCornerSidewalk(target, center, size, roadWidth, sidewalkWidth, xSign, zSign, sampleHeight, segments, material, roadMaterial) {
  const outer = size / 2;
  const roadHalf = roadWidth / 2;
  const cut = sidewalkWidth * 0.42;
  const points = [
    { x: center.x + xSign * outer, z: center.z + zSign * outer },
    { x: center.x + xSign * roadHalf, z: center.z + zSign * outer },
    { x: center.x + xSign * roadHalf, z: center.z + zSign * (roadHalf + cut) },
    { x: center.x + xSign * (roadHalf + cut), z: center.z + zSign * roadHalf },
    { x: center.x + xSign * outer, z: center.z + zSign * roadHalf }
  ];
  addClosedConformingPolygon(target, points, sampleHeight, material, "ClosedChamferedIntersectionSidewalk", TILE_SURFACE_ELEVATION, SIDEWALK_SURFACE_ELEVATION);
  addPaverTiles(target, points, sampleHeight);
  addConformingPolygon(target, [
    { x: center.x + xSign * roadHalf, z: center.z + zSign * roadHalf },
    points[2],
    points[3]
  ], sampleHeight, roadMaterial, "ChamferedIntersectionRoadFill", ROAD_SURFACE_ELEVATION);
  const diagonalLength = Math.hypot(xSign, zSign);
  addBevelledCurb(target, points[2], points[3], { x: xSign / diagonalLength, z: zSign / diagonalLength }, sampleHeight, new THREE.MeshStandardMaterial({ color: COLORS.curb, roughness: 0.98, side: THREE.DoubleSide }), segments);
}

function addPaverTiles(target, sidewalkPolygon, sampleHeight) {
  const bounds = polygonBounds(sidewalkPolygon);
  const slabSpacing = 0.62;
  const margin = slabSpacing * 1.6;
  const firstColumn = Math.floor((bounds.minX - margin) / slabSpacing);
  const lastColumn = Math.ceil((bounds.maxX + margin) / slabSpacing);
  const firstRow = Math.floor((bounds.minZ - margin) / slabSpacing);
  const lastRow = Math.ceil((bounds.maxZ + margin) / slabSpacing);
  const seeds = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const key = row * 71.7 + column * 37.3;
      seeds.push({
        x: (column + 0.5) * slabSpacing + (hash01(key + 2.1) - 0.5) * slabSpacing * 0.36,
        z: (row + 0.5) * slabSpacing + (hash01(key + 5.7) - 0.5) * slabSpacing * 0.36,
        key
      });
    }
  }

  seeds.forEach((seed) => {
    let slab = [...sidewalkPolygon];
    seeds.forEach((other) => {
      if (other === seed || !slab.length) return;
      if ((other.x - seed.x) ** 2 + (other.z - seed.z) ** 2 > (slabSpacing * 2.25) ** 2) return;
      slab = clipPolygonToVoronoiHalfPlane(slab, seed, other);
    });
    if (slab.length < 3 || Math.abs(signedPolygonArea(slab)) < 0.018) return;
    const inset = 0.022 + hash01(seed.key + 8.4) * 0.008;
    slab = insetPolygonTowardsCentroid(slab, inset);
    if (slab.length < 3 || Math.abs(signedPolygonArea(slab)) < 0.012) return;
    const elevation = SIDEWALK_SURFACE_ELEVATION + 0.005 + (hash01(seed.key + 9.3) - 0.5) * 0.004;
    const materialIndex = Math.floor(hash01(seed.key + 10.6) * STONE_SLAB_MATERIALS.length);
    addConformingPolygon(target, slab, sampleHeight, STONE_SLAB_MATERIALS[materialIndex], "PolygonStoneSidewalkSlab", elevation);
  });
}

function addPlazaTile(target, center, size, sampleHeight) {
  const material = new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.96, flatShading: true });
  addConformingPatch(target, center, size * 0.82, size * 0.82, sampleHeight, material, "PavedPocketPlaza");
  const border = new THREE.Mesh(new THREE.RingGeometry(size * 0.29, size * 0.34, 6), new THREE.MeshStandardMaterial({ color: COLORS.stoneDark, roughness: 1, flatShading: true }));
  border.rotation.x = -Math.PI / 2;
  border.position.set(center.x, sampleHeight(center.x, center.z) + 0.055, center.z);
  target.add(border);
}

function addParkTile(target, center, size, sampleHeight, ports = [], cell = { column: 0, row: 0 }) {
  const lawn = new THREE.MeshStandardMaterial({ color: COLORS.park, roughness: 1, flatShading: true });
  const bed = new THREE.MeshStandardMaterial({ color: "#725a43", roughness: 1, flatShading: true });
  const stone = new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 1, flatShading: true });
  const variant = Math.abs((cell.column % 2) + (cell.row % 2) * 2);
  addConformingPatch(target, center, size * 0.9, size * 0.9, sampleHeight, lawn, "PocketParkLawn", TILE_SURFACE_ELEVATION, 3);
  addGardenPath(target, center, size, ports, sampleHeight, stone);

  const bedCenter = { x: center.x + (variant % 2 ? -1 : 1) * size * 0.28, z: center.z + (variant < 2 ? 1 : -1) * size * 0.27 };
  addConformingPatch(target, bedCenter, size * 0.27, size * 0.18, sampleHeight, bed, "RaisedFlowerBed", TILE_SURFACE_ELEVATION + 0.045, 2);
  addFlowerCluster(target, bedCenter, size, sampleHeight, cell.column * 7 + cell.row);
  if (variant === 0 || variant === 3) addParkTree(target, { x: center.x - size * 0.28, z: center.z + (variant === 0 ? -1 : 1) * size * 0.25 }, size, sampleHeight);
  if (variant === 1 || variant === 2) addGardenBench(target, { x: center.x - size * 0.22, z: center.z + (variant === 1 ? 1 : -1) * size * 0.24 }, size, sampleHeight);
  addShrubCluster(target, { x: center.x + size * 0.3, z: center.z + (variant % 2 ? 1 : -1) * size * 0.28 }, size, sampleHeight);
}

function addGardenPath(target, center, size, ports, sampleHeight, material) {
  const width = size * 0.16;
  const armLength = (size - width) / 2;
  const armOffset = (size + width) / 4;
  addConformingPatch(target, center, width, width, sampleHeight, material, "PocketParkPathNode", TILE_SURFACE_ELEVATION + 0.035, 2);
  ports.forEach((direction) => {
    const [dx, dz] = ROAD_WORLD_OFFSETS[direction];
    addConformingPatch(
      target,
      { x: center.x + dx * armOffset, z: center.z + dz * armOffset },
      dx === 0 ? width : armLength,
      dz === 0 ? width : armLength,
      sampleHeight,
      material,
      "PocketParkConnectingPath",
      TILE_SURFACE_ELEVATION + 0.035,
      2
    );
  });
}

function addParkTree(target, position, size, sampleHeight) {
  const ground = sampleHeight(position.x, position.z) + TILE_SURFACE_ELEVATION;
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#70503b", roughness: 1, flatShading: true });
  const leafMaterials = [
    new THREE.MeshStandardMaterial({ color: COLORS.parkDark, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: "#5f8554", roughness: 1, flatShading: true })
  ];
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.035, size * 0.05, size * 0.34, 6), trunkMaterial);
  trunk.position.set(position.x, ground + size * 0.17, position.z);
  trunk.name = "PocketParkTreeTrunk";
  target.add(trunk);
  [[0, 0, 0], [-0.08, 0.05, 1], [0.08, 0.04, 0]].forEach(([dx, dz, materialIndex], index) => {
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(size * (0.14 - index * 0.012), 0), leafMaterials[materialIndex]);
    crown.position.set(position.x + dx * size, ground + size * (0.38 + index * 0.07), position.z + dz * size);
    crown.name = "PocketParkTreeCrown";
    crown.castShadow = true;
    target.add(crown);
  });
}

function addShrubCluster(target, position, size, sampleHeight) {
  const materials = ["#3f6b49", "#5d8a50", "#729a5d"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  [[0, 0], [-0.09, 0.035], [0.08, 0.055], [-0.02, 0.1]].forEach(([dx, dz], index) => {
    const x = position.x + dx * size;
    const z = position.z + dz * size;
    const shrub = new THREE.Mesh(new THREE.DodecahedronGeometry(size * (0.055 + (index % 2) * 0.012), 0), materials[index % materials.length]);
    shrub.scale.y = 0.78;
    shrub.position.set(x, sampleHeight(x, z) + TILE_SURFACE_ELEVATION + size * 0.055, z);
    shrub.name = "PocketParkShrub";
    target.add(shrub);
  });
}

function addFlowerCluster(target, position, size, sampleHeight, seed) {
  const stemMaterial = new THREE.MeshStandardMaterial({ color: "#416847", roughness: 1 });
  const bloomMaterials = ["#f1b0c8", "#e8cf68", "#bca4ea"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  for (let index = 0; index < 5; index += 1) {
    const dx = (hash01(seed * 19 + index * 7.1) - 0.5) * size * 0.2;
    const dz = (hash01(seed * 31 + index * 4.7) - 0.5) * size * 0.12;
    const x = position.x + dx;
    const z = position.z + dz;
    const ground = sampleHeight(x, z) + TILE_SURFACE_ELEVATION + 0.045;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.006, size * 0.008, size * 0.1, 5), stemMaterial);
    stem.position.set(x, ground + size * 0.05, z);
    const bloom = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.026, 0), bloomMaterials[index % bloomMaterials.length]);
    bloom.position.set(x, ground + size * 0.105, z);
    stem.name = "PocketParkFlowerStem";
    bloom.name = "PocketParkFlowerBloom";
    target.add(stem, bloom);
  }
}

function addGardenBench(target, position, size, sampleHeight) {
  const timber = new THREE.MeshStandardMaterial({ color: "#7d5c43", roughness: 0.94, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: "#414752", roughness: 0.82, metalness: 0.08, flatShading: true });
  const ground = sampleHeight(position.x, position.z) + TILE_SURFACE_ELEVATION;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(size * 0.32, size * 0.035, size * 0.1), timber);
  seat.position.set(position.x, ground + size * 0.11, position.z);
  const back = new THREE.Mesh(new THREE.BoxGeometry(size * 0.32, size * 0.13, size * 0.025), timber);
  back.position.set(position.x, ground + size * 0.18, position.z + size * 0.045);
  [-0.12, 0.12].forEach((offset) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(size * 0.025, size * 0.1, size * 0.07), metal);
    leg.position.set(position.x + offset * size, ground + size * 0.05, position.z);
    leg.name = "PocketParkBenchLeg";
    target.add(leg);
  });
  seat.name = "PocketParkBenchSeat";
  back.name = "PocketParkBenchBack";
  target.add(seat, back);
}

function addCurbFaces(target, center, size, roadWidth, ports, sampleHeight, segments) {
  const material = new THREE.MeshStandardMaterial({ color: COLORS.curb, roughness: 0.98, side: THREE.DoubleSide });
  const half = size / 2;
  const gap = roadWidth / 2;
  const chamferCut = ((size - roadWidth) / 2) * 0.42;
  const has = (direction) => ports.includes(direction);
  if (has("north")) [-gap, gap].forEach((x) => addBevelledCurb(target, { x: center.x + x, z: center.z + gap + (has(x < 0 ? "west" : "east") ? chamferCut : 0) }, { x: center.x + x, z: center.z + half }, { x: Math.sign(x), z: 0 }, sampleHeight, material, segments));
  else addBevelledCurb(target, { x: center.x + gap, z: center.z + gap }, { x: center.x - gap, z: center.z + gap }, { x: 0, z: 1 }, sampleHeight, material, segments);
  if (has("south")) [-gap, gap].forEach((x) => addBevelledCurb(target, { x: center.x + x, z: center.z - half }, { x: center.x + x, z: center.z - gap - (has(x < 0 ? "west" : "east") ? chamferCut : 0) }, { x: Math.sign(x), z: 0 }, sampleHeight, material, segments));
  else addBevelledCurb(target, { x: center.x - gap, z: center.z - gap }, { x: center.x + gap, z: center.z - gap }, { x: 0, z: -1 }, sampleHeight, material, segments);
  if (has("east")) [-gap, gap].forEach((z) => addBevelledCurb(target, { x: center.x + gap + (has(z < 0 ? "south" : "north") ? chamferCut : 0), z: center.z + z }, { x: center.x + half, z: center.z + z }, { x: 0, z: Math.sign(z) }, sampleHeight, material, segments));
  else addBevelledCurb(target, { x: center.x + gap, z: center.z - gap }, { x: center.x + gap, z: center.z + gap }, { x: 1, z: 0 }, sampleHeight, material, segments);
  if (has("west")) [-gap, gap].forEach((z) => addBevelledCurb(target, { x: center.x - half, z: center.z + z }, { x: center.x - gap - (has(z < 0 ? "south" : "north") ? chamferCut : 0), z: center.z + z }, { x: 0, z: Math.sign(z) }, sampleHeight, material, segments));
  else addBevelledCurb(target, { x: center.x - gap, z: center.z + gap }, { x: center.x - gap, z: center.z - gap }, { x: -1, z: 0 }, sampleHeight, material, segments);
}

function addBevelledCurb(target, from, to, outward, sampleHeight, material, subdivisions) {
  const segments = Math.max(1, Math.round(subdivisions));
  const bevelWidth = 0.075;
  const positions = [];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const x = THREE.MathUtils.lerp(from.x, to.x, t);
    const z = THREE.MathUtils.lerp(from.z, to.z, t);
    const outerX = x + outward.x * bevelWidth;
    const outerZ = z + outward.z * bevelWidth;
    positions.push(x, sampleHeight(x, z) + ROAD_SURFACE_ELEVATION, z, outerX, sampleHeight(outerX, outerZ) + SIDEWALK_SURFACE_ELEVATION, outerZ);
  }
  for (let index = 0; index < segments; index += 1) {
    const roadA = index * 2;
    const sidewalkA = roadA + 1;
    const roadB = roadA + 2;
    const sidewalkB = roadA + 3;
    indices.push(roadA, sidewalkB, roadB, roadA, sidewalkA, sidewalkB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BevelledRoadCurb";
  target.add(mesh);
}

function addConformingPolygon(target, points, sampleHeight, material, name, elevation) {
  const positions = [];
  const normals = [];
  points.forEach(({ x, z }) => {
    positions.push(x, sampleHeight(x, z) + elevation, z);
    const normal = sampleHeightFieldNormal(sampleHeight, x, z, 0.12);
    normals.push(normal.x, normal.y, normal.z);
  });
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0);
  const indices = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (signedArea > 0) indices.push(0, index + 1, index);
    else indices.push(0, index, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  target.add(mesh);
}

function addClosedConformingPolygon(target, points, sampleHeight, material, name, lowerElevation, upperElevation) {
  const positions = [];
  points.forEach(({ x, z }) => positions.push(x, sampleHeight(x, z) + upperElevation, z));
  points.forEach(({ x, z }) => positions.push(x, sampleHeight(x, z) + lowerElevation, z));
  const count = points.length;
  const positive = signedPolygonArea(points) > 0;
  const indices = [];
  for (let index = 1; index < count - 1; index += 1) {
    if (positive) {
      indices.push(0, index + 1, index, count, count + index, count + index + 1);
    } else {
      indices.push(0, index, index + 1, count, count + index + 1, count + index);
    }
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    if (positive) indices.push(index, next, count + next, index, count + next, count + index);
    else indices.push(index, count + next, next, index, count + index, count + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  target.add(mesh);
}

function rectanglePolygon(center, width, depth) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return [
    { x: center.x - halfWidth, z: center.z - halfDepth },
    { x: center.x + halfWidth, z: center.z - halfDepth },
    { x: center.x + halfWidth, z: center.z + halfDepth },
    { x: center.x - halfWidth, z: center.z + halfDepth }
  ];
}

function polygonBounds(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z),
    maxZ: Math.max(bounds.maxZ, point.z)
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function signedPolygonArea(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0) / 2;
}

function clipPolygonToVoronoiHalfPlane(polygon, seed, other) {
  const deltaX = other.x - seed.x;
  const deltaZ = other.z - seed.z;
  const threshold = other.x ** 2 + other.z ** 2 - seed.x ** 2 - seed.z ** 2;
  const signedDistance = (point) => 2 * (point.x * deltaX + point.z * deltaZ) - threshold;
  const output = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentDistance = signedDistance(current);
    const previousDistance = signedDistance(previous);
    const currentInside = currentDistance <= 1e-8;
    const previousInside = previousDistance <= 1e-8;
    if (currentInside !== previousInside) {
      const t = previousDistance / (previousDistance - currentDistance);
      output.push({
        x: THREE.MathUtils.lerp(previous.x, current.x, t),
        z: THREE.MathUtils.lerp(previous.z, current.z, t)
      });
    }
    if (currentInside) output.push(current);
  }
  return output;
}

function insetPolygonTowardsCentroid(points, distance) {
  const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, z: sum.z + point.z / points.length }), { x: 0, z: 0 });
  return points.map((point) => {
    const length = Math.hypot(centroid.x - point.x, centroid.z - point.z);
    const amount = Math.min(distance / Math.max(length, 1e-6), 0.18);
    return {
      x: THREE.MathUtils.lerp(point.x, centroid.x, amount),
      z: THREE.MathUtils.lerp(point.z, centroid.z, amount)
    };
  });
}

function addRoadMarkings(target, center, size, roadWidth, ports, sampleHeight) {
  const material = new THREE.MeshStandardMaterial({ color: COLORS.roadMarking, roughness: 0.9, flatShading: true });
  const dashLength = size * 0.16;
  const dashWidth = Math.min(size * 0.052, roadWidth * 0.1);
  const armLength = (size - roadWidth) / 2;
  const armOffset = roadWidth / 2 + armLength * 0.52;
  if (ports.includes("north")) addConformingPatch(target, { x: center.x, z: center.z + armOffset }, dashWidth, dashLength, sampleHeight, material, "RoadCenterDash", ROAD_SURFACE_ELEVATION + 0.014);
  if (ports.includes("south")) addConformingPatch(target, { x: center.x, z: center.z - armOffset }, dashWidth, dashLength, sampleHeight, material, "RoadCenterDash", ROAD_SURFACE_ELEVATION + 0.014);
  if (ports.includes("east")) addConformingPatch(target, { x: center.x + armOffset, z: center.z }, dashLength, dashWidth, sampleHeight, material, "RoadCenterDash", ROAD_SURFACE_ELEVATION + 0.014);
  if (ports.includes("west")) addConformingPatch(target, { x: center.x - armOffset, z: center.z }, dashLength, dashWidth, sampleHeight, material, "RoadCenterDash", ROAD_SURFACE_ELEVATION + 0.014);
}

function addRoadWear(target, center, size, roadWidth, ports, sampleHeight) {
  const armOffset = size * 0.31;
  ports.forEach((direction, index) => {
    const [dx, dz] = ROAD_WORLD_OFFSETS[direction];
    const acrossX = dz;
    const acrossZ = dx;
    const jitter = (hash01(center.x * 13.7 + center.z * 19.1 + index) - 0.5) * roadWidth * 0.22;
    const patchCenter = {
      x: center.x + dx * armOffset + acrossX * jitter,
      z: center.z + dz * armOffset + acrossZ * jitter
    };
    const along = size * (0.12 + hash01(index + center.x) * 0.08);
    const across = roadWidth * (0.13 + hash01(index + center.z) * 0.1);
    addConformingPatch(
      target,
      patchCenter,
      dx === 0 ? across : along,
      dz === 0 ? across : along,
      sampleHeight,
      ROAD_WEAR_MATERIALS[index % ROAD_WEAR_MATERIALS.length],
      "RoadSurfaceWear",
      ROAD_SURFACE_ELEVATION + 0.006,
      1
    );
  });
}

function addJunctionCrosswalks(target, center, size, roadWidth, ports, sampleHeight) {
  const material = new THREE.MeshStandardMaterial({ color: "#ddd6ca", roughness: 0.96, flatShading: true });
  const approachOffset = size * 0.31;
  ports.forEach((direction) => {
    const [dx, dz] = ROAD_WORLD_OFFSETS[direction];
    [-0.27, -0.09, 0.09, 0.27].forEach((stripeOffset) => {
      const x = center.x + dx * approachOffset + dz * stripeOffset * roadWidth;
      const z = center.z + dz * approachOffset + dx * stripeOffset * roadWidth;
      addConformingPatch(
        target,
        { x, z },
        dx === 0 ? roadWidth * 0.13 : size * 0.07,
        dz === 0 ? roadWidth * 0.13 : size * 0.07,
        sampleHeight,
        material,
        "JunctionCrosswalkStripe",
        ROAD_SURFACE_ELEVATION + 0.016,
        1
      );
    });
  });
}

function addStreetLamp(target, center, size, sampleHeight, lampMaterials, pointLights, offsetX, offsetZ) {
  const x = center.x + offsetX * size;
  const z = center.z + offsetZ * size;
  const y = sampleHeight(x, z);
  const metal = new THREE.MeshStandardMaterial({ color: COLORS.lampMetal, roughness: 0.78, metalness: 0.08, flatShading: true });
  const glow = makeGlowMaterial(lampMaterials);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.018, size * 0.026, size * 0.48, 6), metal);
  post.position.set(x, y + SIDEWALK_SURFACE_ELEVATION + size * 0.24, z);
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.065, 0), glow);
  lantern.position.set(x, y + SIDEWALK_SURFACE_ELEVATION + size * 0.52, z);
  const light = new THREE.PointLight(COLORS.lampGlow, 0, size * 2.8, 2);
  light.position.set(x, y + SIDEWALK_SURFACE_ELEVATION + size * 0.5, z);
  light.userData.nightIntensity = 1.35;
  target.add(post, lantern, light);
  pointLights.push(light);
}

function addGroundLight(target, center, size, sampleHeight, lampMaterials, pointLights) {
  const glow = makeGlowMaterial(lampMaterials);
  const positions = [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]];
  positions.forEach(([dx, dz]) => {
    const x = center.x + dx * size;
    const z = center.z + dz * size;
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.036, size * 0.036, 0.018, 8), glow);
    disk.position.set(x, sampleHeight(x, z) + 0.07, z);
    target.add(disk);
  });
  const light = new THREE.PointLight(COLORS.lampGlow, 0, size * 2.4, 2);
  light.position.set(center.x, sampleHeight(center.x, center.z) + 0.18, center.z);
  light.userData.nightIntensity = 0.85;
  target.add(light);
  pointLights.push(light);
}

function addConformingPatch(target, center, width, depth, sampleHeight, material, name, elevation = TILE_SURFACE_ELEVATION, subdivisions = 1) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const positions = [];
  const normals = [];
  const indices = [];
  const segments = Math.max(1, Math.round(subdivisions));
  for (let row = 0; row <= segments; row += 1) {
    for (let column = 0; column <= segments; column += 1) {
      const x = center.x - halfW + (column / segments) * width;
      const z = center.z - halfD + (row / segments) * depth;
      positions.push(x, sampleHeight(x, z) + elevation, z);
      const normal = sampleHeightFieldNormal(sampleHeight, x, z, Math.min(0.18, Math.max(0.04, Math.min(width, depth) / (segments * 3))));
      normals.push(normal.x, normal.y, normal.z);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const northWest = row * (segments + 1) + column;
      const northEast = northWest + 1;
      const southWest = northWest + segments + 1;
      const southEast = southWest + 1;
      indices.push(northWest, southEast, northEast, northWest, southWest, southEast);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  target.add(mesh);
}

function sampleHeightFieldNormal(sampleHeight, x, z, step) {
  const left = sampleHeight(x - step, z);
  const right = sampleHeight(x + step, z);
  const north = sampleHeight(x, z - step);
  const south = sampleHeight(x, z + step);
  return new THREE.Vector3(-(right - left) / (step * 2), 1, -(south - north) / (step * 2)).normalize();
}

function hash01(value) {
  return (Math.sin(value * 12.9898) * 43758.5453) % 1 + ((Math.sin(value * 12.9898) * 43758.5453) % 1 < 0 ? 1 : 0);
}

function makeGlowMaterial(collection) {
  const material = new THREE.MeshStandardMaterial({ color: "#f4d38b", emissive: COLORS.lampGlow, emissiveIntensity: 0.2, roughness: 0.55, flatShading: true });
  collection.push(material);
  return material;
}

function closestCell(cells, x, z) {
  return cells.reduce((best, cell) => (!best || (cell.center.x - x) ** 2 + (cell.center.z - z) ** 2 < (best.center.x - x) ** 2 + (best.center.z - z) ** 2 ? cell : best), null);
}
