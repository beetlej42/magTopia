import * as THREE from "three";
import { createRng, randInt, randRange } from "../utils/random.js";

const CROWN_COLORS = ["#78965b", "#5f8052", "#466e4f"];

const CLUSTER_SIZE = 3;
const CLUSTER_RADIUS_FRACTION = 0.62;
const CLUSTER_FALLOFF = 1.4;
const SPARSE_POCKET_FRACTION = 0.22;
const SPARSE_POCKET_DENSITY = 0.3;

const SPECIES = {
  oak: {
    label: "oak",
    trunkScaleY: 1,
    trunkLift: 0.46,
    geometry: "dodecahedron",
    lobes: [
      [-0.28, 1.18, 0.02, 0.82, 0.68, 0.78],
      [0.26, 1.22, -0.05, 0.78, 0.72, 0.82],
      [0, 1.52, 0.03, 0.94, 0.78, 0.9],
      [0.04, 0.92, -0.04, 0.66, 0.54, 0.64]
    ]
  },
  lime: {
    label: "lime",
    trunkScaleY: 1,
    trunkLift: 0.46,
    geometry: "icosahedron",
    lobes: [
      [0, 1.2, 0, 0.72, 0.86, 0.7],
      [-0.05, 1.62, 0.03, 0.62, 0.76, 0.6],
      [0.02, 1.86, -0.02, 0.48, 0.6, 0.5]
    ]
  },
  elm: {
    label: "elm",
    trunkScaleY: 1.12,
    trunkLift: 0.52,
    geometry: "dodecahedron",
    lobes: [
      [0, 1.34, 0, 0.86, 0.7, 0.86],
      [-0.24, 1.5, 0.02, 0.5, 0.56, 0.5],
      [0.24, 1.52, -0.02, 0.5, 0.56, 0.5],
      [0, 1.86, 0, 0.44, 0.52, 0.46]
    ]
  },
  poplar: {
    label: "poplar",
    trunkScaleY: 1.5,
    trunkLift: 0.7,
    geometry: "icosahedron",
    lobes: [
      [0, 1.9, 0, 0.34, 0.7, 0.36],
      [0, 2.36, 0, 0.28, 0.6, 0.3],
      [0, 2.78, 0, 0.2, 0.5, 0.22]
    ]
  }
};

const SPECIES_IDS = ["oak", "lime", "elm", "poplar"];

export function createMagicLondonVegetationPlan({ params, grid, cityState, reservedCellIds = [] }) {
  const reserved = reservedCellIds instanceof Set ? reservedCellIds : new Set(reservedCellIds);
  const cellSize = grid.cellWorldSize;
  const plan = {
    cells: [],
    trees: [],
    shrubs: [],
    grassTufts: [],
    flowers: [],
    forestFloors: [],
    clusters: [],
    zoneCounts: { meadow: 0, grove: 0, woodland: 0 },
    skippedOccupied: 0
  };

  const clusterRecords = new Map();
  const neighborhood = new Map();
  grid.cells.forEach((gridCell) => {
    neighborhood.set(`${gridCell.column}:${gridCell.row}`, gridCell);
  });
  const getRecord = (clusterColumn, clusterRow) => {
    const key = `${clusterColumn}:${clusterRow}`;
    let record = clusterRecords.get(key);
    if (!record) {
      record = buildClusterRecord(key, clusterColumn, clusterRow, params.seed, cellSize);
      clusterRecords.set(key, record);
    }
    return record;
  };
  const densityFor = (cell) => {
    const cellClusterColumn = Math.floor(cell.column / CLUSTER_SIZE);
    const cellClusterRow = Math.floor(cell.row / CLUSTER_SIZE);
    let best = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const neighbor = getRecord(cellClusterColumn + columnOffset, cellClusterRow + rowOffset);
        const anchor = worldAnchorForCell(cell, neighbor, cellSize);
        const distance = Math.hypot(cell.center.x - anchor.x, cell.center.z - anchor.z);
        let factor = 1 - distance / neighbor.radius;
        if (factor < 0) factor = 0;
        factor = Math.pow(factor, neighbor.falloff);
        if (neighbor.sparse) factor *= SPARSE_POCKET_DENSITY;
        if (factor > best) best = factor;
      }
    }
    return best;
  };

  grid.cells.forEach((cell) => {
    const stateCell = cityState?.cells?.[cell.id];
    const occupied = Boolean(stateCell?.occupancy || stateCell?.infrastructure || stateCell?.node || reserved.has(cell.id));
    if (occupied) {
      plan.skippedOccupied += 1;
      return;
    }
    const zone = cell.ground?.vegetation ?? cell.groundCover ?? "meadow";
    if (!(zone in plan.zoneCounts)) return;
    plan.zoneCounts[zone] += 1;
    plan.cells.push({ cellId: cell.id, zone });

    const record = getRecord(Math.floor(cell.column / CLUSTER_SIZE), Math.floor(cell.row / CLUSTER_SIZE));
    const density = densityFor(cell);
    record.openCells.push({ cellId: cell.id, cell, zone, density });
    const rng = createRng(`${params.seed}:development-vegetation:${cell.id}`);

    if (zone === "meadow") {
      const edge = hasDenseVegetationNeighbor(cell, neighborhood);
      const effectiveDensity = Math.min(1, density + (edge ? 0.18 : 0));
      addGrassTufts(plan, cell, cellSize, rng, Math.round(lerp(3, 8, effectiveDensity)) + randInt(rng, 0, 1), zone);
      if (effectiveDensity > 0.12 && rng() < 0.5 + 0.4 * effectiveDensity) addFlowerCluster(plan, cell, cellSize, rng, rng() > 0.55 ? "buttercup" : "foxglove");
      if (effectiveDensity > 0.45 && rng() < 0.3) addShrubs(plan, cell, cellSize, rng, 1, zone);
      if (edge && rng() < 0.35) addEdgeTree(plan, cell, cellSize, rng, zone);
      return;
    }

    if (zone === "grove") {
      addShrubs(plan, cell, cellSize, rng, Math.max(1, Math.round(lerp(1, 3, density))) + randInt(rng, 0, 1), zone);
      addGrassTufts(plan, cell, cellSize, rng, Math.max(1, Math.round(lerp(1, 3, density))) + randInt(rng, 0, 1), zone);
      return;
    }

    plan.forestFloors.push({
      cellId: cell.id,
      x: cell.center.x,
      z: cell.center.z,
      radius: cellSize * randRange(rng, 0.4, 0.46),
      rotation: rng() * Math.PI,
      variant: rng() > 0.48 ? 1 : 0
    });
    addShrubs(plan, cell, cellSize, rng, Math.max(2, Math.round(lerp(3, 6, density))), zone);
    addGrassTufts(plan, cell, cellSize, rng, Math.max(1, Math.round(lerp(1, 3, density))) + randInt(rng, 0, 1), zone);
  });

  clusterRecords.forEach((record) => {
    if (!record.openCells.length) return;
    generateZoneTreeGroups(plan, record, cellSize, params.seed);
  });

  return plan;
}

export function createMagicLondonVegetationLayer({ params, grid, cityState, reservedCellIds, sampleGroundHeight }) {
  const plan = createMagicLondonVegetationPlan({ params, grid, cityState, reservedCellIds });
  const group = new THREE.Group();
  group.name = "MagicLondonGroundVegetation";
  const trunkTransforms = [];
  const crownTransforms = {};
  SPECIES_IDS.forEach((id) => {
    crownTransforms[id] = [[], [], []];
  });
  const shrubTransforms = [[], []];
  const grassTransforms = [];
  const flowerTransforms = [[], []];

  const floorMaterials = [
    new THREE.MeshStandardMaterial({ color: "#657b4f", roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: "#596f4b", roughness: 1, flatShading: true })
  ];
  plan.forestFloors.forEach((entry) => group.add(createForestFloorPatch(entry, sampleGroundHeight, floorMaterials[entry.variant])));

  const speciesCounts = {};
  plan.trees.forEach((tree) => {
    const species = SPECIES[tree.species] || SPECIES.oak;
    const ground = sampleGroundHeight(tree.x, tree.z);
    trunkTransforms.push(transform(tree.x, ground + tree.scale * species.trunkLift, tree.z, tree.rotation, tree.scale, tree.scale * species.trunkScaleY, tree.scale));
    species.lobes.forEach((lobe, index) => {
      const palette = (tree.palette + index) % crownTransforms[tree.species].length;
      addCrownTransform(crownTransforms[tree.species][palette], tree, ground, lobe[0], lobe[1], lobe[2], lobe[3], lobe[4], lobe[5]);
    });
    speciesCounts[tree.species] = (speciesCounts[tree.species] ?? 0) + 1;
  });

  plan.shrubs.forEach((shrub) => {
    const ground = sampleGroundHeight(shrub.x, shrub.z);
    shrubTransforms[shrub.variant].push(transform(shrub.x, ground + shrub.scale * 0.18, shrub.z, shrub.rotation, shrub.scale, shrub.scale * 0.72, shrub.scale));
  });
  plan.grassTufts.forEach((tuft) => {
    const ground = sampleGroundHeight(tuft.x, tuft.z);
    grassTransforms.push(transform(tuft.x, ground + tuft.scale * 0.15, tuft.z, tuft.rotation, tuft.scale, tuft.scale, tuft.scale));
  });
  plan.flowers.forEach((flower) => {
    const ground = sampleGroundHeight(flower.x, flower.z);
    flowerTransforms[flower.variant].push(transform(flower.x, ground + flower.scale * 0.2, flower.z, flower.rotation, flower.scale, flower.scale, flower.scale));
  });

  addInstances(group, "BroadleafTreeTrunks", new THREE.CylinderGeometry(0.12, 0.2, 0.92, 6), material("#70503b"), trunkTransforms);
  SPECIES_IDS.forEach((id) => {
    const geometry = SPECIES[id].geometry === "icosahedron"
      ? new THREE.IcosahedronGeometry(0.58, 0)
      : new THREE.DodecahedronGeometry(0.58, 0);
    const canopyName = `${SPECIES[id].label.charAt(0).toUpperCase()}${SPECIES[id].label.slice(1)}Canopy`;
    CROWN_COLORS.forEach((color, index) => {
      addInstances(group, `${canopyName}-${index}`, geometry, material(color), crownTransforms[id][index]);
    });
  });
  addInstances(group, "WoodlandShrubsDark", new THREE.DodecahedronGeometry(0.23, 0), material("#3f6549"), shrubTransforms[0]);
  addInstances(group, "WoodlandShrubsLight", new THREE.DodecahedronGeometry(0.23, 0), material("#668454"), shrubTransforms[1]);
  addInstances(group, "MeadowGrassTufts", new THREE.ConeGeometry(0.085, 0.3, 4), material("#6f8c52"), grassTransforms, false);
  addInstances(group, "ButtercupFlowerHeads", new THREE.OctahedronGeometry(0.065, 0), material("#d7bd69"), flowerTransforms[0], false);
  addInstances(group, "FoxgloveFlowerHeads", new THREE.OctahedronGeometry(0.065, 0), material("#b98d9f"), flowerTransforms[1], false);

  group.userData.contract = {
    id: "magic-london-ground-vegetation-002",
    zoneCounts: plan.zoneCounts,
    rendered: {
      trees: plan.trees.length,
      shrubs: plan.shrubs.length,
      grassTufts: plan.grassTufts.length,
      flowers: plan.flowers.length,
      forestFloors: plan.forestFloors.length
    },
    clusters: plan.clusters.map((cluster) => ({
      id: cluster.id,
      cells: cluster.cellIds,
      zoneGroups: cluster.zoneGroups.map((group) => ({
        zone: group.zone,
        cells: group.cellIds,
        treeCount: group.treeCount,
        denseTrees: group.ranked.reduce((count, entry) => count + (entry.sizeClass === "dominant" ? 1 : 0), 0)
      }))
    })),
    species: speciesCounts,
    skippedOccupied: plan.skippedOccupied,
    groundRule: "grassLight maps to meadow, grass maps to meadow or grove, and grassDark maps to woodland.",
    exclusionRule: "Buildings, roads, nodes, plazas, and authored parks suppress procedural vegetation for their full logical cell.",
    artRule: "Broadleaf low-poly canopies (oak, lime, elm, poplar), restrained park greens, layered understorey, and no conifer forest envelope."
  };
  return group;
}

function buildClusterRecord(key, clusterColumn, clusterRow, seed, cellSize) {
  const rng = createRng(`${seed}:vegetation-cluster:${key}`);
  const coreColumn = clusterColumn * CLUSTER_SIZE + (0.15 + rng() * 0.7);
  const coreRow = clusterRow * CLUSTER_SIZE + (0.15 + rng() * 0.7);
  return {
    id: key,
    clusterColumn,
    clusterRow,
    coreAnchored: { column: coreColumn, row: coreRow },
    sparse: rng() < SPARSE_POCKET_FRACTION,
    radius: CLUSTER_SIZE * cellSize * CLUSTER_RADIUS_FRACTION,
    falloff: CLUSTER_FALLOFF,
    openCells: []
  };
}

function worldAnchorForCell(cell, cluster, cellSize) {
  const coreColumn = cluster.coreAnchored.column;
  const coreRow = cluster.coreAnchored.row;
  return {
    x: cell.center.x + (coreColumn - cell.column) * cellSize,
    z: cell.center.z + (coreRow - cell.row) * cellSize
  };
}

function distanceToAnchor(cell, cluster, cellSize) {
  const anchor = worldAnchorForCell(cell, cluster, cellSize);
  return Math.hypot(cell.center.x - anchor.x, cell.center.z - anchor.z);
}

function generateZoneTreeGroups(plan, cluster, cellSize, seed) {
  const ordered = cluster.openCells.slice().sort((a, b) => (distanceToAnchor(a.cell, cluster, cellSize) - distanceToAnchor(b.cell, cluster, cellSize)) || (a.cellId < b.cellId ? -1 : a.cellId > b.cellId ? 1 : 0));
  const anchor = worldAnchorForCell(ordered[0].cell, cluster, cellSize);
  const byZone = new Map();
  ordered.forEach((entry) => {
    if (!byZone.has(entry.zone)) byZone.set(entry.zone, []);
    byZone.get(entry.zone).push(entry);
  });
  const groups = [...byZone.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const zoneGroups = groups.map(([zone, cells]) => generateZoneTreeGroup(plan, cluster, anchor, zone, cells, cellSize, seed));
  plan.clusters.push({
    id: cluster.id,
    coreX: anchor.x,
    coreZ: anchor.z,
    radius: cluster.radius,
    sparse: cluster.sparse,
    cellIds: ordered.map((entry) => entry.cellId),
    zoneGroups
  });
}

function generateZoneTreeGroup(plan, cluster, anchor, zone, cells, cellSize, seed) {
  const density = Math.max(...cells.map((entry) => entry.density));
  const rng = createRng(`${seed}:vegetation-cluster-trees:${cluster.id}:${zone}`);
  const count = treeCountFor(zone, density, rng);
  const ranked = [];
  for (let index = 0; index < count; index += 1) {
    const host = weightedHost(cells, rng);
    const rankFactor = count <= 1 ? 1 : 1 - index / (count - 1);
    const hierarchy = lerp(0.74, 1.3, rankFactor) + randRange(rng, -0.06, 0.06);
    const sizeClass = hierarchy > 1.06 ? "dominant" : hierarchy < 0.94 ? "small" : "medium";
    const pull = 0.35 + 0.4 * host.density;
    let treeX = host.cell.center.x + (anchor.x - host.cell.center.x) * pull * 0.5;
    let treeZ = host.cell.center.z + (anchor.z - host.cell.center.z) * pull * 0.5;
    treeX += randRange(rng, -0.3, 0.3) * cellSize;
    treeZ += randRange(rng, -0.3, 0.3) * cellSize;
    const bound = 0.42 * cellSize;
    treeX = clamp(treeX, host.cell.center.x - bound, host.cell.center.x + bound);
    treeZ = clamp(treeZ, host.cell.center.z - bound, host.cell.center.z + bound);
    const tree = {
      cellId: host.cellId,
      zone,
      x: treeX,
      z: treeZ,
      rotation: rng() * Math.PI * 2,
      scale: cellSize * zoneBaseScale(zone) * hierarchy,
      species: pickSpecies(rng),
      palette: paletteForZone(zone, rng),
      hierarchy,
      sizeClass
    };
    plan.trees.push(tree);
    ranked.push(tree);
  }
  return {
    zone,
    density,
    treeCount: count,
    cellIds: cells.map((entry) => entry.cellId),
    ranked
  };
}

function treeCountFor(zone, density, rng) {
  if (zone === "meadow") {
    if (density > 0.55 && rng() < 0.5) return 1;
    return 0;
  }
  if (zone === "grove") return Math.round(lerp(1, 4, density)) + (rng() < 0.35 ? 1 : 0);
  return Math.round(lerp(2, 6, density)) + (rng() < 0.4 ? 1 : 0);
}

function weightedHost(ordered, rng) {
  const totalWeight = ordered.reduce((sum, entry) => sum + Math.max(0.05, entry.density), 0);
  let cursor = rng() * totalWeight;
  for (const entry of ordered) {
    cursor -= Math.max(0.05, entry.density);
    if (cursor <= 0) return entry;
  }
  return ordered[ordered.length - 1];
}

function zoneBaseScale(zone) {
  return zone === "woodland" ? 0.56 : 0.5;
}

function paletteForZone(zone, rng) {
  if (zone === "woodland") return rng() > 0.55 ? 2 : 1;
  return rng() > 0.68 ? 1 : 0;
}

function pickSpecies(rng) {
  return SPECIES_IDS[Math.floor(rng() * SPECIES_IDS.length) % SPECIES_IDS.length];
}

function addShrubs(plan, cell, cellSize, rng, count, zone) {
  for (let index = 0; index < count; index += 1) {
    const position = freePosition(cell, cellSize, rng, 0.38);
    plan.shrubs.push({
      cellId: cell.id,
      zone,
      ...position,
      rotation: rng() * Math.PI * 2,
      scale: cellSize * randRange(rng, 0.28, 0.4),
      variant: rng() > 0.5 ? 1 : 0
    });
  }
}

function addEdgeTree(plan, cell, cellSize, rng, zone) {
  const position = freePosition(cell, cellSize, rng, 0.3);
  plan.trees.push({
    cellId: cell.id,
    zone,
    ...position,
    rotation: rng() * Math.PI * 2,
    scale: cellSize * zoneBaseScale(zone) * 0.82,
    species: pickSpecies(rng),
    palette: paletteForZone(zone, rng),
    hierarchy: 0.82,
    sizeClass: "small"
  });
}

function hasDenseVegetationNeighbor(cell, neighborhood) {
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (columnOffset === 0 && rowOffset === 0) continue;
      const neighbor = neighborhood.get(`${cell.column + columnOffset}:${cell.row + rowOffset}`);
      if (!neighbor) continue;
      const neighborZone = neighbor.ground?.vegetation ?? neighbor.groundCover;
      if (neighborZone === "grove" || neighborZone === "woodland") return true;
    }
  }
  return false;
}

function addGrassTufts(plan, cell, cellSize, rng, count, zone) {
  for (let index = 0; index < count; index += 1) {
    plan.grassTufts.push({
      cellId: cell.id,
      zone,
      ...freePosition(cell, cellSize, rng, 0.42),
      rotation: rng() * Math.PI * 2,
      scale: cellSize * randRange(rng, 0.32, 0.48)
    });
  }
}

function addFlowerCluster(plan, cell, cellSize, rng, species) {
  const center = freePosition(cell, cellSize, rng, 0.34);
  const count = randInt(rng, 3, 5);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + rng() * 0.5;
    const radius = cellSize * randRange(rng, 0.025, 0.09);
    plan.flowers.push({
      cellId: cell.id,
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
      rotation: rng() * Math.PI,
      scale: cellSize * randRange(rng, 0.28, 0.38),
      variant: species === "foxglove" ? 1 : 0
    });
  }
}

function freePosition(cell, cellSize, rng, radius) {
  return {
    x: cell.center.x + randRange(rng, -radius, radius) * cellSize,
    z: cell.center.z + randRange(rng, -radius, radius) * cellSize
  };
}

function addCrownTransform(collection, tree, ground, localX, localY, localZ, scaleX, scaleY, scaleZ) {
  const cosine = Math.cos(tree.rotation);
  const sine = Math.sin(tree.rotation);
  const x = tree.x + (localX * cosine - localZ * sine) * tree.scale;
  const z = tree.z + (localX * sine + localZ * cosine) * tree.scale;
  collection.push(transform(x, ground + localY * tree.scale, z, tree.rotation, tree.scale * scaleX, tree.scale * scaleY, tree.scale * scaleZ));
}

function createForestFloorPatch(entry, sampleGroundHeight, material) {
  const points = [];
  const vertices = 10;
  for (let index = 0; index < vertices; index += 1) {
    const angle = entry.rotation + (index / vertices) * Math.PI * 2;
    const radius = entry.radius * (0.86 + ((index * 7 + entry.variant * 3) % 5) * 0.035);
    points.push({ x: entry.x + Math.cos(angle) * radius, z: entry.z + Math.sin(angle) * radius });
  }
  const positions = [];
  points.forEach(({ x, z }) => positions.push(x, sampleGroundHeight(x, z) + 0.026, z));
  const indices = [];
  for (let index = 1; index < points.length - 1; index += 1) indices.push(0, index + 1, index);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "WoodlandForestFloorPatch";
  mesh.receiveShadow = true;
  return mesh;
}

function transform(x, y, z, rotationY, scaleX, scaleY, scaleZ) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(scaleX, scaleY, scaleZ)
  );
}

function material(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });
}

function addInstances(target, name, geometry, meshMaterial, transforms, castsShadow = true) {
  if (!transforms.length) {
    meshMaterial.dispose();
    return;
  }
  const mesh = new THREE.InstancedMesh(geometry, meshMaterial, transforms.length);
  mesh.name = name;
  transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  target.add(mesh);
}

function lerp(a, b, ratio) {
  return a + (b - a) * ratio;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
