import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  STORYBOOK_SURFACE_KINDS,
  applyStorybookSurfaceMaterial,
  storybookSurfaceKindForMaterial
} from "../src/render/storybookSurfaceMaterial.js";
import { getVoxelFacetHighlightMode } from "../src/render/voxelCurvedWorldTwinkle.js";

test("storybook surface categories distinguish brick, slate, plaster, and felt", () => {
  assert.equal(storybookSurfaceKindForMaterial("brickRed"), STORYBOOK_SURFACE_KINDS.brick);
  assert.equal(storybookSurfaceKindForMaterial("slate"), STORYBOOK_SURFACE_KINDS.slate);
  assert.equal(storybookSurfaceKindForMaterial("limestone"), STORYBOOK_SURFACE_KINDS.plaster);
  assert.equal(storybookSurfaceKindForMaterial("grass"), STORYBOOK_SURFACE_KINDS.felt);
  assert.equal(storybookSurfaceKindForMaterial("water"), STORYBOOK_SURFACE_KINDS.water);
  assert.equal(storybookSurfaceKindForMaterial("tealGlass"), STORYBOOK_SURFACE_KINDS.glass);
  assert.equal(storybookSurfaceKindForMaterial("warmWindow"), STORYBOOK_SURFACE_KINDS.glass);
});

test("voxel facet highlight defaults to the combined comparison mode", () => {
  assert.equal(getVoxelFacetHighlightMode(), "combined");
  const material = new THREE.MeshStandardMaterial();
  applyStorybookSurfaceMaterial(material, { surfaceKind: STORYBOOK_SURFACE_KINDS.slate });
  assert.equal(material.userData.voxelFacetHighlight.facetStrength, 1.15);
  assert.equal(material.userData.voxelFacetHighlight.glintStrength, 1.0);
});

test("voxel facet highlight exposes the three screenshot comparison modes", () => {
  const previousLocation = globalThis.location;
  try {
    for (const mode of ["facet", "glint", "combined"]) {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { search: `?facetHighlight=${mode}&facetStrength=9&glintStrength=-1` }
      });
      const material = new THREE.MeshStandardMaterial();
      applyStorybookSurfaceMaterial(material, { surfaceKind: STORYBOOK_SURFACE_KINDS.glass });
      assert.equal(material.userData.voxelFacetHighlight.mode, mode);
      assert.equal(material.userData.voxelFacetHighlight.facetStrength, 2);
      assert.equal(material.userData.voxelFacetHighlight.glintStrength, 0);
    }
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
  }
});

test("voxel facet highlight keeps explicit zero strengths instead of treating them as missing", () => {
  const previousLocation = globalThis.location;
  try {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { search: "?facetHighlight=combined&facetStrength=0&glintStrength=0" }
    });
    const material = new THREE.MeshStandardMaterial();
    applyStorybookSurfaceMaterial(material, { surfaceKind: STORYBOOK_SURFACE_KINDS.glass });
    assert.equal(material.userData.voxelFacetHighlight.facetStrength, 0);
    assert.equal(material.userData.voxelFacetHighlight.glintStrength, 0);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <project_vertex>",
      fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>"
    };
    material.onBeforeCompile(shader, null);
    assert.equal(shader.uniforms.voxelFacetStrength.value, 0);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
  }
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
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_end>"
  };
  material.onBeforeCompile(shader, null);
  assert.equal(previousCompileCalled, true);
  assert.match(shader.vertexShader, /attribute float voxelSurfaceKind/);
  assert.match(shader.fragmentShader, /storybookHandcraftedVoxelRoughness/);
  assert.match(shader.fragmentShader, /float facetDetailStrength = clamp\(voxelFacetStrength \* storybookSurfaceStrength, 0\.0, 1\.0\)/);
  assert.match(shader.fragmentShader, /heightSignal = clamp\(voxelHeightField\(cell\) \* 8\.0/);
  assert.match(shader.fragmentShader, /kind > 5\.5 && kind < 6\.5[\s\S]*variation = 1\.0 \+ blockSignal \* 0\.09/);
  assert.match(shader.fragmentShader, /voxelHeightField/);
  assert.match(shader.fragmentShader, /voxelHeightCavity/);
  assert.match(shader.fragmentShader, /vec3 voxelCoord = floor\(voxelWorldGrid\)/);
  assert.match(shader.fragmentShader, /vec3 voxelLocal3 = fract\(voxelWorldGrid\)/);
  assert.match(shader.fragmentShader, /voxelHeightResponse = 0\.0/);
  assert.match(shader.fragmentShader, /vVoxelSurfaceKind > 4\.5 && vVoxelSurfaceKind < 5\.5/);
  assert.match(shader.fragmentShader, /vVoxelSurfaceKind > 6\.5 && vVoxelSurfaceKind < 7\.5/);
  assert.match(shader.fragmentShader, /vVoxelSurfaceKind > 7\.5 && vVoxelSurfaceKind < 8\.5/);
  assert.match(shader.fragmentShader, /kind > 4\.5 && kind < 5\.5\) return baseRoughness/);
  assert.match(shader.fragmentShader, /vVoxelSurfaceKind > 7\.5 && vVoxelSurfaceKind < 8\.5\) voxelGlintMaterialResponse = 0\.42/);
  assert.match(shader.fragmentShader, /reflectedLight\.directDiffuse \*= voxelReliefDiffuse/);
  for (const edge of ["Left", "Right", "Down", "Up"]) {
    assert.match(shader.fragmentShader, new RegExp(`voxelRelief${edge}Band`));
    assert.match(shader.fragmentShader, new RegExp(`voxelRelief${edge}Delta`));
    assert.match(shader.fragmentShader, new RegExp(`voxelHeight${edge}`));
  }
  assert.doesNotMatch(shader.fragmentShader, /voxelReliefEdgeDistance|voxelReliefEdgeX|voxelReliefEdgeY/);
  assert.match(shader.fragmentShader, /voxelFacetNormal/);
  assert.match(shader.fragmentShader, /voxelGlintCandidate/);
  assert.match(shader.fragmentShader, /vVoxelWorldNormal/);
  assert.match(shader.fragmentShader, /dot\(normal, voxelGlintLightDir\)/);
  assert.match(shader.fragmentShader, /dot\(normal, voxelGlintHalfDir\)/);
  assert.doesNotMatch(shader.fragmentShader, /storybookSurfaceModulation|storybookLine|slateBand|paper fine|felt =/);
  const helperIndex = shader.fragmentShader.indexOf("float voxelFacetHash");
  const helperCallIndex = shader.fragmentShader.indexOf("voxelFacetHash(", helperIndex + 1);
  const declarationsMarkerIndex = shader.fragmentShader.indexOf("/* voxel-facet-declarations-end */");
  const storybookBodyIndex = shader.fragmentShader.indexOf("float storybookHandcraftedVoxelColor");
  assert.ok(helperIndex >= 0);
  assert.ok(helperCallIndex > helperIndex);
  assert.ok(declarationsMarkerIndex >= 0);
  assert.ok(storybookBodyIndex > declarationsMarkerIndex);
  assert.equal(material.userData.storybookSurface.version, "handcrafted-voxel-surface-v2");
  assert.equal(material.userData.voxelCurvedWorldTwinkle.version, "curved-world-twinkle-v5.1");
  assert.equal(material.userData.voxelFacetHighlight.version, "voxel-facet-highlight-v2");
  assert.equal(material.userData.voxelFacetHighlight.mode, "combined");
  assert.equal(material.userData.voxelFacetHighlight.surfaceKind, STORYBOOK_SURFACE_KINDS.brick);
});
