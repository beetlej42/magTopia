import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  STORYBOOK_SURFACE_KINDS,
  applyStorybookSurfaceMaterial,
  storybookSurfaceKindForMaterial
} from "../src/render/storybookSurfaceMaterial.js";

test("storybook surface categories distinguish brick, slate, plaster, and felt", () => {
  assert.equal(storybookSurfaceKindForMaterial("brickRed"), STORYBOOK_SURFACE_KINDS.brick);
  assert.equal(storybookSurfaceKindForMaterial("slate"), STORYBOOK_SURFACE_KINDS.slate);
  assert.equal(storybookSurfaceKindForMaterial("limestone"), STORYBOOK_SURFACE_KINDS.plaster);
  assert.equal(storybookSurfaceKindForMaterial("grass"), STORYBOOK_SURFACE_KINDS.felt);
  assert.equal(storybookSurfaceKindForMaterial("warmWindow"), STORYBOOK_SURFACE_KINDS.none);
});

test("storybook surface shader wraps existing material compilation", () => {
  const material = new THREE.MeshStandardMaterial();
  let previousCompileCalled = false;
  material.onBeforeCompile = () => { previousCompileCalled = true; };
  applyStorybookSurfaceMaterial(material, {
    surfaceKind: STORYBOOK_SURFACE_KINDS.brick,
    useSurfaceKindAttribute: true
  });
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>"
  };
  material.onBeforeCompile(shader, null);
  assert.equal(previousCompileCalled, true);
  assert.match(shader.vertexShader, /attribute float voxelSurfaceKind/);
  assert.match(shader.fragmentShader, /storybookSurfaceModulation/);
  assert.equal(material.userData.storybookSurface.version, "procedural-microtexture-v1");
});
