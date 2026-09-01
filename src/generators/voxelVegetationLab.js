import * as THREE from "three";
import {
  TREE_FAMILY_TEMPLATE_IDS,
  TREE_LOD_FACTORS,
  createVoxelTreeMaterial,
  getVoxelTreeTemplateDiagnostics,
  getVoxelTreeTemplateLod
} from "./agentVoxelTrees.js";

export const VOXEL_VEGETATION_PRESETS = Object.freeze({
  familyCatalog: Object.freeze({
    seed: "vegetation-family-catalog",
    studyMode: "catalog",
    previewLod: 0,
    treeScale: 1,
    spacing: 6.2,
    sunTime: 0.56,
    nightLighting: 0
  }),
  lodComparison: Object.freeze({
    seed: "vegetation-lod-comparison",
    studyMode: "lod",
    previewLod: 0,
    treeScale: 1,
    spacing: 6.2,
    sunTime: 0.56,
    nightLighting: 0
  })
});

export function normalizeVoxelVegetationConfig(config = {}) {
  return {
    ...VOXEL_VEGETATION_PRESETS.familyCatalog,
    ...config,
    studyMode: config.studyMode === "lod" ? "lod" : "catalog",
    previewLod: clamp(Math.round(Number(config.previewLod) || 0), 0, TREE_LOD_FACTORS.length - 1),
    treeScale: clamp(Number(config.treeScale) || 1, 0.65, 1.35),
    spacing: clamp(Number(config.spacing) || 6.2, 4.5, 8.5),
    sunTime: clamp(Number(config.sunTime) || 0, 0, 1),
    nightLighting: clamp(Number(config.nightLighting) || 0, 0, 1)
  };
}

export function createVoxelVegetationLab(input = {}) {
  const config = normalizeVoxelVegetationConfig(input);
  const group = new THREE.Group();
  group.name = "VoxelVegetationLab";
  const material = createVoxelTreeMaterial();
  const displayed = [];

  if (config.studyMode === "lod") addLodComparison(group, material, config, displayed);
  else addFamilyCatalog(group, material, config, displayed);

  addStudyGround(group, config);
  const templateDiagnostics = getVoxelTreeTemplateDiagnostics();
  const diagnostics = {
    renderer: "voxel-vegetation-lab-v1",
    studyMode: config.studyMode,
    previewLod: config.previewLod,
    previewFactor: TREE_LOD_FACTORS[config.previewLod],
    displayedTrees: displayed.length,
    displayedTriangles: displayed.reduce((sum, item) => sum + item.triangles, 0),
    displayed,
    templates: templateDiagnostics,
    acceptance: {
      families: Object.keys(TREE_FAMILY_TEMPLATE_IDS),
      variantsPerFamily: Object.fromEntries(Object.entries(TREE_FAMILY_TEMPLATE_IDS).map(([family, ids]) => [family, ids.length])),
      connectedTemplates: templateDiagnostics.every((template) => template.connectedComponents === 1),
      descendingLodTriangles: templateDiagnostics.every((template) => template.lods.every((lod, index) => index === 0 || lod.triangles < template.lods[index - 1].triangles))
    }
  };
  group.userData = {
    diagnostics,
    contract: { mode: "vegetation", config, diagnostics },
    getVoxelDiagnostics: () => structuredClone(diagnostics),
    getVoxelContract: () => structuredClone(group.userData.contract),
    updateDaylight: () => {}
  };
  return group;
}

function addFamilyCatalog(group, material, config, displayed) {
  const families = Object.keys(TREE_FAMILY_TEMPLATE_IDS);
  families.forEach((family, familyIndex) => {
    TREE_FAMILY_TEMPLATE_IDS[family].forEach((templateId, variantIndex) => {
      addTree(group, material, templateId, config.previewLod, {
        x: (familyIndex - (families.length - 1) / 2) * config.spacing,
        z: (variantIndex - 0.5) * config.spacing * 0.72,
        scale: config.treeScale,
        yaw: variantIndex * Math.PI / 2
      }, displayed);
    });
  });
}

function addLodComparison(group, material, config, displayed) {
  const templates = ["broad-0", "round-0", "tall-0", "birch-0", "pine-0"];
  templates.forEach((templateId, row) => {
    TREE_LOD_FACTORS.forEach((factor, level) => {
      addTree(group, material, templateId, level, {
        x: (level - 1) * config.spacing,
        z: (row - (templates.length - 1) / 2) * config.spacing * 0.84,
        scale: config.treeScale,
        yaw: 0
      }, displayed, factor);
    });
  });
}

function addTree(group, material, templateId, level, transform, displayed, expectedFactor = null) {
  const lod = getVoxelTreeTemplateLod(templateId, level);
  const mesh = new THREE.Mesh(lod.geometry, material);
  mesh.name = `VegetationStudy-${templateId}-LOD${level}`;
  mesh.position.set(transform.x, 0.02, transform.z);
  mesh.rotation.y = transform.yaw;
  mesh.scale.setScalar(transform.scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { templateId, level, factor: lod.factor, triangles: lod.triangles };
  group.add(mesh);
  displayed.push({ templateId, level, factor: expectedFactor ?? lod.factor, triangles: lod.triangles });
}

function addStudyGround(group, config) {
  const width = config.spacing * (config.studyMode === "lod" ? 3.55 : 5.45);
  const depth = config.spacing * (config.studyMode === "lod" ? 5.15 : 1.9);
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.12, depth),
    new THREE.MeshStandardMaterial({ color: "#9bb178", roughness: 1, metalness: 0 })
  );
  ground.name = "VegetationStudyGround";
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  group.add(ground);

  const grid = new THREE.GridHelper(Math.max(width, depth), Math.round(Math.max(width, depth) * 2), "#d7d6b7", "#889771");
  grid.name = "VegetationStudyGrid";
  grid.position.y = 0.001;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  group.add(grid);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
