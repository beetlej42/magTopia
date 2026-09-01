import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { VOXEL_SIZE } from "../src/generators/voxelBuildingLab.js";
import {
  TREE_DETAIL_VOXEL_SIZE,
  TREE_LOD_FACTORS,
  TREE_TEMPLATE_IDS,
  createVoxelTreeLodRenderer,
  getVoxelTreeTemplateDiagnostics
} from "../src/generators/agentVoxelTrees.js";
import {
  VOXEL_VEGETATION_PRESETS,
  createVoxelVegetationLab
} from "../src/generators/voxelVegetationLab.js";

test("tree templates preserve connected sculpted silhouettes across cheaper LODs", () => {
  const diagnostics = getVoxelTreeTemplateDiagnostics();
  assert.deepEqual(TREE_LOD_FACTORS, [1, 3, 8]);
  assert.equal(TREE_DETAIL_VOXEL_SIZE, VOXEL_SIZE, "tree and building LOD0 use the same world voxel size");
  assert.equal(diagnostics.length, TREE_TEMPLATE_IDS.length);
  diagnostics.forEach((template) => {
    assert.equal(template.connectedComponents, 1);
    assert.equal(template.sourceVoxelSize, TREE_DETAIL_VOXEL_SIZE);
    assert.ok(template.lobeCount >= 4);
    assert.deepEqual(template.lods.map((lod) => lod.factor), TREE_LOD_FACTORS);
    assert.ok(template.lods[0].triangles > template.lods[1].triangles);
    assert.ok(template.lods[1].triangles > template.lods[2].triangles);
    assert.ok(template.lods[2].triangles <= 150, `${template.id} far LOD stays cheap`);
  });
});

test("tree renderer switches instance buckets by screen size and culls behind camera", () => {
  const trees = TREE_TEMPLATE_IDS.map((template, index) => ({
    template,
    x: (index - 3) * 12,
    y: 0,
    z: 0,
    rotation: 0,
    scale: 1,
    shade: index
  }));
  const renderer = createVoxelTreeLodRenderer(trees);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 8, 22);
  camera.lookAt(0, 3, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const near = renderer.userData.updateView(camera, { width: 900, height: 900, qualityScale: 1 });
  assert.ok(near.visibleInstances > 0);
  assert.ok(near.levelCounts.near + near.levelCounts.medium > 0);
  assert.ok(near.renderedTriangles > 0);

  camera.position.set(0, 8, -22);
  camera.lookAt(0, 3, -50);
  camera.updateMatrixWorld(true);
  const hidden = renderer.userData.updateView(camera, { width: 900, height: 900, qualityScale: 1 });
  assert.equal(hidden.visibleInstances, 0);
  assert.equal(hidden.levelCounts.culled, trees.length);
});

test("vegetation Studio module exposes family and LOD visual acceptance layouts", () => {
  const catalog = createVoxelVegetationLab(VOXEL_VEGETATION_PRESETS.familyCatalog);
  const familyDiagnostics = catalog.userData.getVoxelDiagnostics();
  assert.equal(familyDiagnostics.studyMode, "catalog");
  assert.equal(familyDiagnostics.displayedTrees, 8);
  assert.deepEqual(familyDiagnostics.acceptance.families, ["broad", "round", "tall", "birch", "pine"]);
  assert.equal(familyDiagnostics.acceptance.connectedTemplates, true);
  assert.equal(familyDiagnostics.acceptance.descendingLodTriangles, true);

  const lod = createVoxelVegetationLab(VOXEL_VEGETATION_PRESETS.lodComparison);
  const lodDiagnostics = lod.userData.getVoxelDiagnostics();
  assert.equal(lodDiagnostics.studyMode, "lod");
  assert.equal(lodDiagnostics.displayedTrees, 15);
  assert.deepEqual([...new Set(lodDiagnostics.displayed.map((item) => item.level))], [0, 1, 2]);
});
