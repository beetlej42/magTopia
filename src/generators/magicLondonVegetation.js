import * as THREE from "three";
import { createRng, randInt, randRange } from "../utils/random.js";

const CROWN_COLORS = ["#78965b", "#5f8052", "#466e4f"];
const TREE_ANCHORS = [
  [-0.24, -0.2],
  [0.22, 0.18],
  [-0.18, 0.25],
  [0.24, -0.23]
];

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
    zoneCounts: { meadow: 0, grove: 0, woodland: 0 },
    skippedOccupied: 0
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
    const rng = createRng(`${params.seed}:development-vegetation:${cell.id}`);
    plan.zoneCounts[zone] += 1;
    plan.cells.push({ cellId: cell.id, zone });

    if (zone === "meadow") {
      addGrassTufts(plan, cell, cellSize, rng, randInt(rng, 2, 4), "meadow");
      if (rng() > 0.48) addFlowerCluster(plan, cell, cellSize, rng, rng() > 0.55 ? "buttercup" : "foxglove");
      if (rng() > 0.975) addTrees(plan, cell, cellSize, rng, 1, zone);
      return;
    }

    if (zone === "grove") {
      if (rng() > 0.34) addTrees(plan, cell, cellSize, rng, rng() > 0.58 ? 2 : 1, zone);
      addShrubs(plan, cell, cellSize, rng, randInt(rng, 1, 3), zone);
      addGrassTufts(plan, cell, cellSize, rng, randInt(rng, 1, 2), zone);
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
    if (rng() > 0.18) addTrees(plan, cell, cellSize, rng, rng() > 0.48 ? 3 : 2, zone);
    addShrubs(plan, cell, cellSize, rng, randInt(rng, 3, 5), zone);
    addGrassTufts(plan, cell, cellSize, rng, randInt(rng, 1, 2), zone);
  });
  return plan;
}

export function createMagicLondonVegetationLayer({ params, grid, cityState, reservedCellIds, sampleGroundHeight }) {
  const plan = createMagicLondonVegetationPlan({ params, grid, cityState, reservedCellIds });
  const group = new THREE.Group();
  group.name = "MagicLondonGroundVegetation";
  const trunkTransforms = [];
  const oakCrowns = [[], [], []];
  const limeCrowns = [[], [], []];
  const shrubTransforms = [[], []];
  const grassTransforms = [];
  const flowerTransforms = [[], []];

  const floorMaterials = [
    new THREE.MeshStandardMaterial({ color: "#657b4f", roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: "#596f4b", roughness: 1, flatShading: true })
  ];
  plan.forestFloors.forEach((entry) => group.add(createForestFloorPatch(entry, sampleGroundHeight, floorMaterials[entry.variant])));

  plan.trees.forEach((tree) => {
    const ground = sampleGroundHeight(tree.x, tree.z);
    trunkTransforms.push(transform(tree.x, ground + tree.scale * 0.46, tree.z, tree.rotation, tree.scale, tree.scale, tree.scale));
    const palette = tree.palette;
    if (tree.species === "oak") {
      addCrownTransform(oakCrowns[palette], tree, ground, -0.28, 1.18, 0.02, 0.82, 0.68, 0.78);
      addCrownTransform(oakCrowns[(palette + 1) % oakCrowns.length], tree, ground, 0.26, 1.22, -0.05, 0.78, 0.72, 0.82);
      addCrownTransform(oakCrowns[palette], tree, ground, 0, 1.52, 0.03, 0.94, 0.78, 0.9);
    } else {
      addCrownTransform(limeCrowns[palette], tree, ground, 0, 1.2, 0, 0.72, 0.86, 0.7);
      addCrownTransform(limeCrowns[(palette + 1) % limeCrowns.length], tree, ground, -0.05, 1.62, 0.03, 0.62, 0.76, 0.6);
    }
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
  const oakGeometry = new THREE.DodecahedronGeometry(0.58, 0);
  const limeGeometry = new THREE.IcosahedronGeometry(0.58, 0);
  CROWN_COLORS.forEach((color, index) => {
    addInstances(group, `OakCanopy-${index}`, oakGeometry, material(color), oakCrowns[index]);
    addInstances(group, `LimeCanopy-${index}`, limeGeometry, material(color), limeCrowns[index]);
  });
  addInstances(group, "WoodlandShrubsDark", new THREE.DodecahedronGeometry(0.23, 0), material("#3f6549"), shrubTransforms[0]);
  addInstances(group, "WoodlandShrubsLight", new THREE.DodecahedronGeometry(0.23, 0), material("#668454"), shrubTransforms[1]);
  addInstances(group, "MeadowGrassTufts", new THREE.ConeGeometry(0.085, 0.3, 4), material("#6f8c52"), grassTransforms, false);
  addInstances(group, "ButtercupFlowerHeads", new THREE.OctahedronGeometry(0.065, 0), material("#d7bd69"), flowerTransforms[0], false);
  addInstances(group, "FoxgloveFlowerHeads", new THREE.OctahedronGeometry(0.065, 0), material("#b98d9f"), flowerTransforms[1], false);

  group.userData.contract = {
    id: "magic-london-ground-vegetation-001",
    zoneCounts: plan.zoneCounts,
    rendered: {
      trees: plan.trees.length,
      shrubs: plan.shrubs.length,
      grassTufts: plan.grassTufts.length,
      flowers: plan.flowers.length,
      forestFloors: plan.forestFloors.length
    },
    skippedOccupied: plan.skippedOccupied,
    groundRule: "grassLight maps to meadow, grass maps to meadow or grove, and grassDark maps to woodland.",
    exclusionRule: "Buildings, roads, nodes, plazas, and authored parks suppress procedural vegetation for their full logical cell.",
    artRule: "Broadleaf low-poly canopies, restrained park greens, layered understorey, and no conifer forest envelope."
  };
  return group;
}

function addTrees(plan, cell, cellSize, rng, count, zone) {
  for (let index = 0; index < count; index += 1) {
    const position = anchoredPosition(cell, cellSize, rng, index);
    plan.trees.push({
      cellId: cell.id,
      zone,
      ...position,
      rotation: rng() * Math.PI * 2,
      scale: cellSize * randRange(rng, zone === "woodland" ? 0.47 : 0.43, zone === "woodland" ? 0.58 : 0.54),
      species: rng() > 0.42 ? "oak" : "lime",
      palette: zone === "woodland" ? (rng() > 0.55 ? 2 : 1) : (rng() > 0.68 ? 1 : 0)
    });
  }
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

function anchoredPosition(cell, cellSize, rng, index) {
  const anchor = TREE_ANCHORS[index % TREE_ANCHORS.length];
  return {
    x: cell.center.x + (anchor[0] + randRange(rng, -0.07, 0.07)) * cellSize,
    z: cell.center.z + (anchor[1] + randRange(rng, -0.07, 0.07)) * cellSize
  };
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
