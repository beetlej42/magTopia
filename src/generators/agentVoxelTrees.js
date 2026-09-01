import * as THREE from "three";
import { VOXEL_SIZE } from "./voxelBuildingLab.js";
import { getVoxelLodThresholds, selectScreenSpaceVoxelLod } from "../render/voxelLodQuality.js";

export const TREE_DETAIL_SCALE = 1;
export const TREE_DETAIL_VOXEL_SIZE = VOXEL_SIZE / TREE_DETAIL_SCALE;
export const TREE_LOD_FACTORS = Object.freeze([1, 3, 8]);
export const TREE_TEMPLATE_IDS = Object.freeze([
  "broad-0", "broad-1", "round-0", "round-1", "tall-0", "tall-1", "birch-0", "pine-0"
]);
export const TREE_FAMILY_TEMPLATE_IDS = Object.freeze({
  broad: Object.freeze(["broad-0", "broad-1"]),
  round: Object.freeze(["round-0", "round-1"]),
  tall: Object.freeze(["tall-0", "tall-1"]),
  birch: Object.freeze(["birch-0"]),
  pine: Object.freeze(["pine-0"])
});

const FOLIAGE_PALETTES = Object.freeze({
  foliage: ["#244832", "#365d39", "#527842", "#779650"].map((value) => new THREE.Color(value)),
  birchFoliage: ["#31543a", "#4c7042", "#72904e", "#9cac62"].map((value) => new THREE.Color(value)),
  pineFoliage: ["#193b31", "#28503c", "#386348", "#53795a"].map((value) => new THREE.Color(value)),
  yewFoliage: ["#112f28", "#1d4533", "#2d5c3d", "#47734c"].map((value) => new THREE.Color(value))
});
const TIMBER_PALETTES = Object.freeze({
  timber: ["#493224", "#62442b", "#795735"].map((value) => new THREE.Color(value)),
  birchTimber: ["#62635b", "#989687", "#cac6ad"].map((value) => new THREE.Color(value)),
  pineTimber: ["#59321f", "#824a28", "#aa6733"].map((value) => new THREE.Color(value))
});
const TREE_GEOMETRY_CACHE = new Map();

// Dimensions are expressed in the existing building-voxel unit. The source
// field is authored in the same world-space voxel unit as the buildings, while
// overlapping crown lobes create much more silhouette detail than the former
// stack of large boxes. Placement and accepted tree-height bands stay fixed.
export const TREE_TEMPLATE_SPECS = Object.freeze({
  "broad-0": treeSpec("broad", 15, 6,
    [
      branch([-1, 11, 0], [-8, 19, 2], 3.4),
      branch([1, 12, 0], [9, 20, -2], 3.2),
      branch([0, 13, 1], [2, 22, 8], 2.8)
    ],
    [
      lobe([-8, 24, 2], [9, 8, 8]),
      lobe([8, 25, -2], [10, 8, 9]),
      lobe([0, 24, 7], [8, 7, 7]),
      lobe([-3, 33, 0], [9, 8, 9]),
      lobe([6, 34, 5], [7, 7, 7]),
      lobe([-7, 36, -5], [7, 7, 7])
    ]),
  "broad-1": treeSpec("broad", 14, 5.5,
    [
      branch([0, 10, 0], [-9, 18, -2], 3.2),
      branch([1, 11, 0], [8, 19, 4], 3),
      branch([-1, 12, 0], [-2, 22, 7], 2.7)
    ],
    [
      lobe([-9, 23, -2], [9, 8, 8]),
      lobe([8, 25, 4], [10, 8, 9]),
      lobe([-1, 24, 7], [8, 7, 7]),
      lobe([2, 34, -2], [9, 9, 9]),
      lobe([-7, 34, 5], [7, 7, 7]),
      lobe([7, 34, -6], [7, 7, 7])
    ]),
  "round-0": treeSpec("round", 18, 4.5,
    [
      branch([0, 14, 0], [-5, 22, 2], 2.7),
      branch([0, 14, 0], [5, 22, -1], 2.7)
    ],
    [
      lobe([-5, 25, 0], [8, 8, 8]),
      lobe([5, 26, -2], [8, 8, 8]),
      lobe([0, 27, 6], [8, 8, 7]),
      lobe([-4, 34, -3], [8, 8, 8]),
      lobe([5, 35, 3], [7, 8, 7]),
      lobe([0, 39, 0], [6, 5, 6])
    ]),
  "round-1": treeSpec("round", 17, 4.5,
    [
      branch([0, 13, 0], [-4, 21, -3], 2.6),
      branch([0, 14, 0], [6, 22, 2], 2.7)
    ],
    [
      lobe([-6, 25, -3], [8, 8, 8]),
      lobe([5, 26, 3], [8, 8, 8]),
      lobe([0, 27, -6], [8, 8, 7]),
      lobe([4, 34, -2], [8, 8, 8]),
      lobe([-5, 35, 4], [7, 8, 7]),
      lobe([0, 39, 0], [6, 5, 6])
    ]),
  "tall-0": treeSpec("tall", 46, 3.5,
    [
      branch([0, 18, 0], [3, 27, 1], 2.1),
      branch([0, 30, 0], [-3, 39, -1], 1.8)
    ],
    [
      lobe([0, 13, 0], [8, 8, 7.5]),
      lobe([-0.5, 24, 0.5], [7.5, 11, 7]),
      lobe([0.5, 35, -0.5], [6.5, 10, 6]),
      lobe([-0.5, 44, 0.3], [5, 8, 4.7]),
      lobe([0, 50, 0], [3, 5, 3])
    ],
    { foliageKind: "yewFoliage" }),
  "tall-1": treeSpec("tall", 46, 3.5,
    [
      branch([0, 17, 0], [-3, 26, -1], 2.1),
      branch([0, 29, 0], [3, 38, 1], 1.8)
    ],
    [
      lobe([0, 12, 0], [7.5, 7, 7]),
      lobe([0.5, 23, -0.5], [8, 11, 7]),
      lobe([-0.5, 34, 0.5], [6.3, 10, 6]),
      lobe([0.3, 43, -0.3], [4.8, 8, 4.5]),
      lobe([-0.2, 50, 0], [2.7, 5, 2.7])
    ],
    { foliageKind: "yewFoliage" }),
  "birch-0": treeSpec("birch", 39, 3,
    [
      branch([0, 20, 0], [-6, 28, 0], 2),
      branch([0, 22, 0], [6, 31, 2], 1.9),
      branch([0, 28, 0], [-4, 37, -3], 1.7),
      branch([0, 31, 0], [4, 42, 2], 1.6)
    ],
    [
      lobe([-6, 29, 0], [4.5, 5, 4.5]),
      lobe([6, 32, 2], [4.5, 5, 4.5]),
      lobe([-4, 37, -3], [4.5, 6, 4.5]),
      lobe([4, 41, 2], [4.5, 6, 4.5]),
      lobe([-1, 46, 0], [4.5, 5, 4.5]),
      lobe([2, 50, 0], [3.5, 4, 3.5])
    ],
    { timberKind: "birchTimber", foliageKind: "birchFoliage" }),
  "pine-0": treeSpec("pine", 43, 4,
    [
      branch([0, 24, 0], [-8, 28, 0], 2.3),
      branch([0, 28, 0], [8, 33, -2], 2.2),
      branch([0, 33, 0], [-6, 38, 4], 2),
      branch([0, 38, 0], [5, 44, -2], 1.8)
    ],
    [
      lobe([-7, 29, 0], [8, 3.5, 5.5]),
      lobe([7, 34, -2], [8, 3.5, 6]),
      lobe([-5, 39, 4], [7, 3.5, 6]),
      lobe([4, 44, -2], [8, 4, 6]),
      lobe([-2, 49, 1], [7, 4, 6]),
      lobe([1, 52, 0], [4, 3, 4])
    ],
    { timberKind: "pineTimber", foliageKind: "pineFoliage" })
});

function treeSpec(family, trunkHeight, trunkWidth, branches, lobes, appearance = {}) {
  return Object.freeze({
    family,
    trunkHeight,
    trunkWidth,
    branches: Object.freeze(branches),
    lobes: Object.freeze(lobes),
    timberKind: appearance.timberKind ?? "timber",
    foliageKind: appearance.foliageKind ?? "foliage"
  });
}

function branch(start, end, thickness) {
  return Object.freeze({ start: Object.freeze(start), end: Object.freeze(end), thickness });
}

function lobe(center, radii) {
  return Object.freeze({ center: Object.freeze(center), radii: Object.freeze(radii) });
}

export function getVoxelTreeMetrics(templateId, scale = 1) {
  const spec = TREE_TEMPLATE_SPECS[templateId] ?? TREE_TEMPLATE_SPECS["round-0"];
  const minX = Math.min(...spec.lobes.map(({ center, radii }) => center[0] - radii[0]));
  const maxX = Math.max(...spec.lobes.map(({ center, radii }) => center[0] + radii[0]));
  const minZ = Math.min(...spec.lobes.map(({ center, radii }) => center[2] - radii[2]));
  const maxZ = Math.max(...spec.lobes.map(({ center, radii }) => center[2] + radii[2]));
  const height = Math.max(spec.trunkHeight, ...spec.lobes.map(({ center, radii }) => center[1] + radii[1]));
  return {
    height: Math.round(height * scale),
    crownWidth: Math.round(Math.max(maxX - minX, maxZ - minZ) * scale),
    trunkWidth: Math.max(2, Math.round(spec.trunkWidth * scale))
  };
}

export function getVoxelTreeTemplateLods(templateId) {
  const cached = getCachedTemplate(templateId);
  return cached.lods.map((lod) => ({
    ...lod,
    geometry: lod.geometry.clone()
  }));
}

export function getVoxelTreeTemplateLod(templateId, level = 0) {
  const cached = getCachedTemplate(templateId);
  const resolvedLevel = Math.max(0, Math.min(cached.lods.length - 1, Math.round(level)));
  const lod = cached.lods[resolvedLevel];
  return { ...lod, geometry: lod.geometry.clone() };
}

export function getVoxelTreeTemplateDiagnostics() {
  return TREE_TEMPLATE_IDS.map((templateId) => {
    const cached = getCachedTemplate(templateId);
    return {
      id: templateId,
      family: cached.spec.family,
      sourceVoxelSize: TREE_DETAIL_VOXEL_SIZE,
      sourceVoxels: cached.sourceVoxels,
      connectedComponents: cached.connectedComponents,
      lobeCount: cached.spec.lobes.length,
      branches: cached.spec.branches.length,
      heightVoxels: getVoxelTreeMetrics(templateId).height,
      crownWidthVoxels: getVoxelTreeMetrics(templateId).crownWidth,
      lods: cached.lods.map(({ factor, triangles, voxelSize, surfaceQuads, occupiedVoxels }) => ({
        factor,
        triangles,
        voxelSize,
        surfaceQuads,
        occupiedVoxels
      }))
    };
  });
}

export function createVoxelTreeMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
}

export function createVoxelTreeLodRenderer(trees, { initialLod = 2 } = {}) {
  const group = new THREE.Group();
  group.name = "VoxelTreeLodRenderer";
  const material = createVoxelTreeMaterial();
  const shadowMaterial = new THREE.MeshStandardMaterial({ color: "#253b2c", roughness: 1, metalness: 0 });
  shadowMaterial.colorWrite = false;
  shadowMaterial.depthWrite = false;
  const treeDummy = new THREE.Object3D();
  const entries = [];
  const records = new Map();
  const meshes = [];
  const shadowMeshes = [];
  const initialLevel = Math.max(0, Math.min(TREE_LOD_FACTORS.length - 1, Math.round(initialLod)));

  TREE_TEMPLATE_IDS.forEach((templateId) => {
    const templateTrees = trees.filter((tree) => tree.template === templateId);
    if (!templateTrees.length) return;
    const lods = getVoxelTreeTemplateLods(templateId);
    const lodMeshes = lods.map((lod, level) => {
      const mesh = new THREE.InstancedMesh(lod.geometry, material, templateTrees.length);
      mesh.name = `TreeInstances-${templateId}-LOD${level}`;
      mesh.count = level === initialLevel ? templateTrees.length : 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData = { treeLod: true, templateId, level, factor: lod.factor, triangles: lod.triangles };
      meshes.push(mesh);
      group.add(mesh);
      return mesh;
    });
    const shadow = new THREE.InstancedMesh(lods.at(-1).geometry.clone(), shadowMaterial, templateTrees.length);
    shadow.name = `TreeShadowProxy-${templateId}`;
    shadow.castShadow = true;
    shadow.receiveShadow = false;
    shadow.frustumCulled = false;
    shadow.userData = { treeShadowProxy: true, templateId, level: TREE_LOD_FACTORS.length - 1 };
    shadowMeshes.push(shadow);
    group.add(shadow);

    const templateEntries = templateTrees.map((tree, sourceIndex) => {
      treeDummy.position.set(tree.x * VOXEL_SIZE, tree.y * VOXEL_SIZE, tree.z * VOXEL_SIZE);
      treeDummy.rotation.set(0, tree.rotation, 0);
      treeDummy.scale.setScalar(tree.scale);
      treeDummy.updateMatrix();
      const matrix = treeDummy.matrix.clone();
      const color = treeTint(tree);
      lodMeshes[initialLevel].setMatrixAt(sourceIndex, matrix);
      lodMeshes[initialLevel].setColorAt(sourceIndex, color);
      shadow.setMatrixAt(sourceIndex, matrix);
      const entry = { tree, templateId, sourceIndex, matrix: matrix.clone(), color, level: initialLevel };
      entries.push(entry);
      return entry;
    });
    lodMeshes[initialLevel].instanceMatrix.needsUpdate = true;
    if (lodMeshes[initialLevel].instanceColor) lodMeshes[initialLevel].instanceColor.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
    records.set(templateId, { templateId, entries: templateEntries, lods, meshes: lodMeshes, shadow, projected: false });
  });

  const diagnostics = {
    renderer: "instanced-voxel-tree-screen-lod-v1",
    sourceVoxelSize: TREE_DETAIL_VOXEL_SIZE,
    instances: trees.length,
    drawCalls: meshes.length,
    shadowDrawCalls: shadowMeshes.length,
    levelCounts: {
      near: initialLevel === 0 ? trees.length : 0,
      medium: initialLevel === 1 ? trees.length : 0,
      far: initialLevel === 2 ? trees.length : 0,
      culled: 0
    },
    visibleInstances: trees.length,
    renderedTriangles: renderedTreeTriangles(records),
    maximumTriangles: maximumTreeTriangles(records),
    lodUpdates: 0
  };

  const captureProjectedMatrices = () => {
    records.forEach((record) => {
      if (record.projected) return;
      record.entries.forEach((entry) => record.shadow.getMatrixAt(entry.sourceIndex, entry.matrix));
      record.projected = true;
    });
  };

  const updateView = (camera, viewport = {}) => {
    if (!camera || !entries.length) return diagnostics;
    captureProjectedMatrices();
    const viewportHeight = Math.max(1, Number(viewport.height) || 720) * Math.max(1, Number(viewport.renderScale) || 1);
    const scale = Math.max(0.8, Math.min(1.5, Number(viewport.qualityScale) || 1));
    const buildingThresholds = getVoxelLodThresholds(viewport);
    const thresholds = {
      nearVoxelPx: 1.2 * scale,
      mediumVoxelPx: 0.35 * scale,
      nearDiameterPx: buildingThresholds.nearDiameterPx * 1.05,
      mediumDiameterPx: buildingThresholds.mediumDiameterPx * 0.9
    };
    const projectionView = scratch.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = scratch.frustum.setFromProjectionMatrix(projectionView);
    const levelCounts = [0, 0, 0, 0];

    records.forEach((record) => {
      const buckets = [[], [], []];
      const baseSphere = record.lods[0].geometry.boundingSphere;
      record.entries.forEach((entry) => {
        const worldScale = matrixMaximumScale(entry.matrix);
        const center = scratch.center.copy(baseSphere.center).applyMatrix4(entry.matrix);
        const radius = Math.max(TREE_DETAIL_VOXEL_SIZE * 2, baseSphere.radius * worldScale);
        const visibleInFrustum = frustum.intersectsSphere(scratch.sphere.set(center, radius));
        const viewPosition = scratch.viewPosition.copy(center).applyMatrix4(camera.matrixWorldInverse);
        const viewDepth = Math.max(0.001, -viewPosition.z);
        const pixelsPerWorldUnit = camera.isPerspectiveCamera
          ? viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDepth)
          : viewportHeight / Math.max(0.001, (camera.top - camera.bottom) / camera.zoom);
        const metrics = {
          visibleInFrustum: visibleInFrustum && viewPosition.z < 0,
          projectedVoxelPx: TREE_DETAIL_VOXEL_SIZE * worldScale * pixelsPerWorldUnit,
          projectedDiameterPx: radius * 2 * pixelsPerWorldUnit
        };
        const nextLevel = selectScreenSpaceVoxelLod(entry.level, metrics, { hysteresis: 0.1, thresholds });
        entry.level = nextLevel;
        levelCounts[nextLevel] += 1;
        if (nextLevel < 3) buckets[nextLevel].push(entry);
      });
      record.meshes.forEach((mesh, level) => {
        const bucket = buckets[level];
        bucket.forEach((entry, index) => {
          mesh.setMatrixAt(index, entry.matrix);
          mesh.setColorAt(index, entry.color);
        });
        mesh.count = bucket.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    });

    diagnostics.levelCounts = { near: levelCounts[0], medium: levelCounts[1], far: levelCounts[2], culled: levelCounts[3] };
    diagnostics.visibleInstances = levelCounts[0] + levelCounts[1] + levelCounts[2];
    diagnostics.renderedTriangles = renderedTreeTriangles(records);
    diagnostics.lodUpdates += 1;
    return diagnostics;
  };

  group.userData = {
    treeMeshes: meshes,
    shadowMeshes,
    updateView,
    getDiagnostics: () => structuredClone(diagnostics),
    captureProjectedMatrices
  };
  return group;
}

function getCachedTemplate(templateId) {
  const resolvedId = TREE_TEMPLATE_SPECS[templateId] ? templateId : "round-0";
  if (TREE_GEOMETRY_CACHE.has(resolvedId)) return TREE_GEOMETRY_CACHE.get(resolvedId);
  const spec = TREE_TEMPLATE_SPECS[resolvedId];
  const source = buildTreeField(spec);
  const connectedComponents = countConnectedComponents(source);
  const lods = TREE_LOD_FACTORS.map((factor) => {
    const field = factor === 1 ? source : source.downsample(factor);
    const geometry = greedyTreeGeometry(field);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return {
      factor,
      geometry,
      triangles: geometry.index.count / 3,
      surfaceQuads: geometry.index.count / 6,
      voxelSize: field.voxelSize,
      occupiedVoxels: field.size
    };
  });
  const cached = { spec, sourceVoxels: source.size, connectedComponents, lods };
  TREE_GEOMETRY_CACHE.set(resolvedId, cached);
  return cached;
}

function buildTreeField(spec) {
  const field = new TreeVoxelField(TREE_DETAIL_VOXEL_SIZE);
  addTaperedTrunk(field, spec.trunkHeight, spec.trunkWidth, spec.timberKind);
  spec.branches.forEach((value) => addVoxelBranch(field, value, spec.timberKind));
  spec.lobes.forEach((value, index) => addVoxelLobe(field, value, index, spec.foliageKind));
  return field;
}

function addTaperedTrunk(field, height, width, timberKind) {
  const top = Math.round(height * TREE_DETAIL_SCALE);
  for (let y = 0; y < top; y += 1) {
    const t = y / Math.max(1, top - 1);
    const radius = (width * TREE_DETAIL_SCALE * (0.58 - t * 0.12)) / 2;
    const rootFlare = y < TREE_DETAIL_SCALE * 3 ? (1 - y / (TREE_DETAIL_SCALE * 3)) * TREE_DETAIL_SCALE : 0;
    fillDisc(field, 0, y, 0, radius + rootFlare, timberKind);
  }
  const rootLength = Math.round(width * TREE_DETAIL_SCALE * 0.9);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => {
    for (let step = 0; step < rootLength; step += 1) {
      const radius = Math.max(1, (rootLength - step) * 0.28);
      fillSphere(field, dx * step, Math.floor(step * 0.08), dz * step, radius, timberKind);
    }
  });
}

function addVoxelBranch(field, value, timberKind) {
  const start = value.start.map((entry) => entry * TREE_DETAIL_SCALE);
  const end = value.end.map((entry) => entry * TREE_DETAIL_SCALE);
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const steps = Math.max(1, Math.ceil(length * 1.35));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const radius = value.thickness * TREE_DETAIL_SCALE * (0.5 - t * 0.13);
    fillSphere(field,
      Math.round(lerp(start[0], end[0], t)),
      Math.round(lerp(start[1], end[1], t)),
      Math.round(lerp(start[2], end[2], t)),
      Math.max(1.2, radius),
      timberKind);
  }
}

function addVoxelLobe(field, value, lobeIndex, foliageKind) {
  const center = value.center.map((entry) => Math.round(entry * TREE_DETAIL_SCALE));
  const radii = value.radii.map((entry) => Math.max(1, entry * TREE_DETAIL_SCALE));
  const [rx, ry, rz] = radii;
  for (let y = Math.floor(center[1] - ry); y <= Math.ceil(center[1] + ry); y += 1) {
    for (let z = Math.floor(center[2] - rz); z <= Math.ceil(center[2] + rz); z += 1) {
      for (let x = Math.floor(center[0] - rx); x <= Math.ceil(center[0] + rx); x += 1) {
        const dx = (x + 0.5 - center[0]) / rx;
        const dy = (y + 0.5 - center[1]) / ry;
        const dz = (z + 0.5 - center[2]) / rz;
        // Overlapping lobes create the irregular silhouette. Keeping each
        // lobe coherent lets the greedy mesher collapse long voxel runs.
        const boundaryBias = (hash01(x >> 3, y >> 3, z >> 3, lobeIndex) - 0.5) * 0.025;
        if (dx * dx + dy * dy + dz * dz <= 1 + boundaryBias) field.set(x, y, z, foliageKind);
      }
    }
  }
}

function fillDisc(field, cx, y, cz, radius, kind) {
  const r = Math.max(1, radius);
  for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      if ((x - cx) ** 2 + (z - cz) ** 2 <= r ** 2) field.set(x, y, z, kind);
    }
  }
}

function fillSphere(field, cx, cy, cz, radius, kind) {
  const r = Math.max(1, radius);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r ** 2) field.set(x, y, z, kind);
      }
    }
  }
}

class TreeVoxelField {
  constructor(voxelSize) {
    this.voxelSize = voxelSize;
    this.voxels = new Map();
  }

  get size() {
    return this.voxels.size;
  }

  set(x, y, z, kind) {
    this.voxels.set(voxelKey(x, y, z), { x, y, z, kind });
  }

  get(x, y, z) {
    return this.voxels.get(voxelKey(x, y, z)) ?? null;
  }

  bounds() {
    const values = [...this.voxels.values()];
    return {
      min: [Math.min(...values.map((v) => v.x)), Math.min(...values.map((v) => v.y)), Math.min(...values.map((v) => v.z))],
      max: [Math.max(...values.map((v) => v.x)) + 1, Math.max(...values.map((v) => v.y)) + 1, Math.max(...values.map((v) => v.z)) + 1]
    };
  }

  downsample(factor) {
    const blocks = new Map();
    this.voxels.forEach((voxel) => {
      const x = Math.floor(voxel.x / factor);
      const y = Math.floor(voxel.y / factor);
      const z = Math.floor(voxel.z / factor);
      const key = voxelKey(x, y, z);
      if (!blocks.has(key)) blocks.set(key, { x, y, z, total: 0, kinds: new Map() });
      const block = blocks.get(key);
      block.total += 1;
      block.kinds.set(voxel.kind, (block.kinds.get(voxel.kind) ?? 0) + 1);
    });
    const result = new TreeVoxelField(this.voxelSize * factor);
    const minimum = factor === 2 ? 2 : Math.max(3, Math.ceil((factor * factor) / 3));
    blocks.forEach((block) => {
      if (block.total < minimum) return;
      const kind = [...block.kinds.entries()].sort((a, b) => b[1] - a[1] || (isTimberKind(a[0]) ? -1 : 1))[0][0];
      result.set(block.x, block.y, block.z, kind);
    });
    return result;
  }
}

function greedyTreeGeometry(field) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const bounds = field.bounds();
  let surfaceQuads = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const uCount = bounds.max[u] - bounds.min[u];
    const vCount = bounds.max[v] - bounds.min[v];
    for (let plane = bounds.min[axis]; plane <= bounds.max[axis]; plane += 1) {
      const mask = new Array(uCount * vCount).fill(null);
      for (let j = 0; j < vCount; j += 1) {
        for (let i = 0; i < uCount; i += 1) {
          const before = [0, 0, 0];
          const after = [0, 0, 0];
          before[axis] = plane - 1;
          after[axis] = plane;
          before[u] = after[u] = bounds.min[u] + i;
          before[v] = after[v] = bounds.min[v] + j;
          const a = field.get(before[0], before[1], before[2]);
          const b = field.get(after[0], after[1], after[2]);
          if ((!a && !b) || (a && b)) continue;
          const sign = a ? 1 : -1;
          const solid = a ?? b;
          const normal = [0, 0, 0];
          normal[axis] = sign;
          const tone = faceTone(solid, normal, bounds, field.voxelSize);
          mask[j * uCount + i] = { key: `${solid.kind}:${tone}:${sign}`, solid, sign, tone, normal };
        }
      }
      for (let j = 0; j < vCount; j += 1) {
        for (let i = 0; i < uCount;) {
          const cell = mask[j * uCount + i];
          if (!cell) {
            i += 1;
            continue;
          }
          let width = 1;
          while (i + width < uCount && mask[j * uCount + i + width]?.key === cell.key) width += 1;
          let height = 1;
          heightLoop: while (j + height < vCount) {
            for (let offset = 0; offset < width; offset += 1) {
              if (mask[(j + height) * uCount + i + offset]?.key !== cell.key) break heightLoop;
            }
            height += 1;
          }
          emitQuad({ positions, normals, colors, indices, axis, u, v, plane, u0: bounds.min[u] + i, v0: bounds.min[v] + j, width, height, cell, voxelSize: field.voxelSize });
          surfaceQuads += 1;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) mask[(j + y) * uCount + i + x] = null;
          }
          i += width;
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.userData = { surfaceQuads, voxelSize: field.voxelSize, occupiedVoxels: field.size, flatVoxelGeometry: true };
  return geometry;
}

function emitQuad({ positions, normals, colors, indices, axis, u, v, plane, u0, v0, width, height, cell, voxelSize }) {
  const p = [0, 0, 0];
  p[axis] = plane;
  p[u] = u0;
  p[v] = v0;
  const du = [0, 0, 0];
  const dv = [0, 0, 0];
  du[u] = width;
  dv[v] = height;
  const corners = [p, add3(p, du), add3(add3(p, du), dv), add3(p, dv)];
  const palette = isTimberKind(cell.solid.kind)
    ? TIMBER_PALETTES[cell.solid.kind] ?? TIMBER_PALETTES.timber
    : FOLIAGE_PALETTES[cell.solid.kind] ?? FOLIAGE_PALETTES.foliage;
  const color = palette[cell.tone];
  const start = positions.length / 3;
  corners.forEach((corner) => {
    positions.push(corner[0] * voxelSize, corner[1] * voxelSize, corner[2] * voxelSize);
    normals.push(cell.normal[0], cell.normal[1], cell.normal[2]);
    colors.push(color.r, color.g, color.b);
  });
  if (cell.sign > 0) indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  else indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
}

function faceTone(voxel, normal, bounds, voxelSize) {
  const height = (voxel.y - bounds.min[1]) / Math.max(1, bounds.max[1] - bounds.min[1]);
  const patchScale = Math.max(2, Math.round((VOXEL_SIZE * 5) / voxelSize));
  const patch = hash01(Math.floor(voxel.x / patchScale), Math.floor(voxel.y / patchScale), Math.floor(voxel.z / patchScale), 19);
  if (isTimberKind(voxel.kind)) {
    const score = normal[1] * 0.28 + height * 0.18 + (patch - 0.5) * 0.32;
    return score > 0.23 ? 2 : score < -0.1 ? 0 : 1;
  }
  const sideLight = normal[0] * 0.12 + normal[2] * 0.08;
  const score = normal[1] * 0.28 + height * 0.22 + sideLight + (patch - 0.5) * 0.32;
  if (score < -0.03) return 0;
  if (score < 0.2) return 1;
  if (score < 0.42) return 2;
  return 3;
}

function isTimberKind(kind) {
  return kind === "timber" || kind.endsWith("Timber");
}

function countConnectedComponents(field) {
  const unseen = new Set(field.voxels.keys());
  let count = 0;
  const neighbors = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (unseen.size) {
    count += 1;
    const first = unseen.values().next().value;
    unseen.delete(first);
    const queue = [field.voxels.get(first)];
    for (let index = 0; index < queue.length; index += 1) {
      const voxel = queue[index];
      neighbors.forEach(([dx, dy, dz]) => {
        const key = voxelKey(voxel.x + dx, voxel.y + dy, voxel.z + dz);
        if (!unseen.delete(key)) return;
        queue.push(field.voxels.get(key));
      });
    }
  }
  return count;
}

function renderedTreeTriangles(records) {
  let total = 0;
  records.forEach((record) => record.meshes.forEach((mesh, level) => {
    total += mesh.count * record.lods[level].triangles;
  }));
  return total;
}

function maximumTreeTriangles(records) {
  let total = 0;
  records.forEach((record) => { total += record.entries.length * record.lods[0].triangles; });
  return total;
}

function treeTint(tree) {
  const base = 0.88 + ((tree.shade % 24) / 24) * 0.18;
  return new THREE.Color(base, base, base);
}

function matrixMaximumScale(matrix) {
  const e = matrix.elements;
  return Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
}

function voxelKey(x, y, z) {
  return `${x}:${y}:${z}`;
}

function hash01(x, y, z, seed = 0) {
  let value = Math.imul(x ^ (seed + 0x9e3779b9), 0x85ebca6b);
  value ^= Math.imul(y ^ (value >>> 13), 0xc2b2ae35);
  value ^= Math.imul(z ^ (value >>> 16), 0x27d4eb2d);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967295;
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const scratch = {
  projectionView: new THREE.Matrix4(),
  frustum: new THREE.Frustum(),
  center: new THREE.Vector3(),
  viewPosition: new THREE.Vector3(),
  sphere: new THREE.Sphere()
};
