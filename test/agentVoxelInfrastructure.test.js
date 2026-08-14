import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAgentAcceptanceCity } from "../src/generators/agentAcceptanceCity.js";
import { createAgentVoxelRoadLayer, selectVictorianBridgeStyle } from "../src/generators/agentVoxelInfrastructure.js";
import {
  VOXEL_SHADOW_ONLY_LAYER,
  configureVoxelShadowOnlyLayer
} from "../src/generators/magicLondonStarterDistrict.js";

test("Agent acceptance city renders roads and vegetation entirely as voxel geometry", () => {
  const city = createAgentAcceptanceCity({ acceptanceSeed: "voxel-infrastructure-test" });
  const diagnostics = city.userData.diagnostics;
  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.renderer, "agent-acceptance-city-v2-all-voxel");
  assert.equal(diagnostics.roadRenderer.renderer, "state-driven-voxel-road-v2-victorian-bridges");
  assert.equal(diagnostics.roadRenderer.roadCellCount, diagnostics.roads + diagnostics.bridges);
  assert.equal(diagnostics.roadRenderer.bridgeCellCount, diagnostics.bridges);
  assert.equal(diagnostics.roadRenderer.roadAsset, "shared-victorian-voxel-road-tile-v1");
  assert.ok(diagnostics.roadRenderer.curbVoxels > 0);
  assert.ok(diagnostics.roadRenderer.markingVoxels > 0);
  assert.ok(diagnostics.roadRenderer.lampCount > 0);
  assert.ok(diagnostics.roadRenderer.bridgeSpanCount > 0);
  assert.equal(diagnostics.roadRenderer.adaptiveSpanRules, true);
  assert.ok(diagnostics.roadRenderer.bridgeSpans.every((span) => span.railings && span.abutments));
  assert.ok(diagnostics.roadRenderer.bridgeSpans.every((span) => span.spanWorldUnits === span.cellCount * 4));
  assert.ok(diagnostics.roadRenderer.renderStats.renderedTriangles > 0);
  assert.equal(diagnostics.vegetation.renderer, "state-aware-voxel-vegetation-v1");
  assert.equal(diagnostics.vegetation.clearsRoadsAndEntrances, true);
  assert.ok(diagnostics.vegetation.trees > 0);
  assert.ok(diagnostics.vegetation.renderStats.renderedTriangles > 0);
  assert.equal(diagnostics.projection.type, "spherical-local-frame");
  assert.equal(diagnostics.projection.radius, 220);
  assert.ok(diagnostics.projection.projectedObjects > 0);
  assert.equal(diagnostics.projection.correctedReflectedGeometries, 49);
  assert.equal(city.userData.contract.renderSurface, "spherical voxel world; flat Agent API coordinates remain authoritative");
  assert.equal(city.userData.contract.camera.depthOfField, "bokeh retained");
  assert.equal(city.userData.surfaceNavigation.radius, 220);

  const lodDiagnostics = city.userData.getPrefabLodDiagnostics();
  assert.equal(lodDiagnostics.shadowPolicy, "low-lod-proxy");
  assert.ok(lodDiagnostics.currentLevels.length > 0);
  assert.ok(lodDiagnostics.currentLevels.every((entry) => entry.nearShadowCasterCount === 0));
  assert.ok(lodDiagnostics.currentLevels.every((entry) => entry.nearShadowCastersDisabled > 0));
  assert.ok(lodDiagnostics.currentLevels.every((entry) => entry.shadowProxyMeshCount > 0));

  const lodSummary = city.getObjectByName("AgentAcceptanceBuildings").userData.getVoxelLodSummaryDiagnostics();
  assert.equal(lodSummary.count, lodDiagnostics.currentLevels.length);
  assert.equal(lodSummary.shadowOnlyLayer, VOXEL_SHADOW_ONLY_LAYER);
  assert.ok(lodSummary.shadowProxyMeshCount > 0);
  assert.equal("currentLevels" in lodSummary, false);

  const shadowProxyMeshes = [];
  const lods = [];
  city.traverse((object) => {
    if (object.isLOD) lods.push(object);
    if (object.isMesh && object.userData.shadowProxy) shadowProxyMeshes.push(object);
  });
  assert.ok(shadowProxyMeshes.length > 0);
  assert.ok(shadowProxyMeshes.every((mesh) => mesh.layers.isEnabled(VOXEL_SHADOW_ONLY_LAYER)));

  const viewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  viewCamera.position.set(20, 30, 20);
  viewCamera.lookAt(0, 0, 0);
  viewCamera.updateProjectionMatrix();
  viewCamera.updateMatrixWorld(true);
  const shadowLight = new THREE.DirectionalLight();
  const layerContract = configureVoxelShadowOnlyLayer({ viewCamera, shadowLights: [shadowLight] });
  assert.equal(layerContract.viewCameraExcluded, true);
  assert.equal(layerContract.configuredShadowCameras.length, 1);
  assert.ok(shadowLight.shadow.camera.layers.isEnabled(0));
  assert.ok(shadowLight.shadow.camera.layers.isEnabled(VOXEL_SHADOW_ONLY_LAYER));
  assert.ok(shadowProxyMeshes.every((mesh) => !viewCamera.layers.test(mesh.layers)));
  assert.ok(shadowProxyMeshes.every((mesh) => shadowLight.shadow.camera.layers.test(mesh.layers)));

  city.userData.updateView(viewCamera, 4, { height: 720, renderScale: 1 });
  const firstMetrics = lods.map((lod) => lod.userData.currentMetrics);
  city.userData.updateView(viewCamera, 4, { height: 720, renderScale: 1 });
  assert.ok(lods.every((lod, index) => lod.userData.currentMetrics === firstMetrics[index]));

  const buildingLayer = city.getObjectByName("AgentAcceptanceBuildings");
  const pointLights = [];
  city.traverse((object) => {
    if (object.isPointLight) pointLights.push(object);
  });
  const lightTarget = pointLights[0].getWorldPosition(new THREE.Vector3());
  const surfaceNormal = lightTarget.clone().sub(new THREE.Vector3(0, -220, 0)).normalize();
  const lightCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  lightCamera.position.copy(lightTarget).addScaledVector(surfaceNormal, 58);
  lightCamera.up.set(0, 0, -1);
  lightCamera.lookAt(lightTarget);
  lightCamera.updateProjectionMatrix();
  lightCamera.updateMatrixWorld(true);
  city.userData.updateView(lightCamera, 1, { height: 720, renderScale: 1 });
  const dynamicLightDiagnostics = buildingLayer.userData.getDynamicLightDiagnostics();
  assert.ok(dynamicLightDiagnostics.count > 1);
  assert.equal(dynamicLightDiagnostics.limit, 1);
  assert.equal(dynamicLightDiagnostics.visible, 1);
  assert.equal(pointLights.filter((light) => light.visible).length, 1);

  const roads = city.getObjectByName("AgentAcceptanceRoads");
  const vegetation = city.getObjectByName("AgentAcceptanceVegetation");
  assert.ok(roads.children.every((child) => child.userData.voxelRenderStrategy === "greedy-chunk"));
  assert.ok(vegetation.children.every((child) => child.userData.voxelRenderStrategy === "greedy-chunk"));
  assert.equal(city.getObjectByName("MagicLondonVegetation"), undefined);
  assert.equal(city.getObjectByName("MagicLondonBaseTiles"), undefined);
});

test("projected Agent buildings retain live day and night emissive updates", () => {
  const city = createAgentAcceptanceCity({ acceptanceSeed: "voxel-daylight-projection-test" });
  const emissiveMaterials = [];
  city.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (material?.emissive && material.emissive.getHex() !== 0) emissiveMaterials.push(material);
    });
  });
  assert.ok(emissiveMaterials.length > 0);

  city.userData.updateDaylight({ nightFactor: 0 });
  const dayIntensity = Math.max(...emissiveMaterials.map((material) => material.emissiveIntensity));
  city.userData.updateDaylight({ nightFactor: 1 });
  const nightIntensity = Math.max(...emissiveMaterials.map((material) => material.emissiveIntensity));
  assert.ok(nightIntensity > dayIntensity);
});

test("Victorian bridge selection is deterministic, span-aware, and visually varied", () => {
  assert.equal(selectVictorianBridgeStyle("same-seed", 3), selectVictorianBridgeStyle("same-seed", 3));
  const shortStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`short-${index}`, 1)));
  const mediumStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`medium-${index}`, 3)));
  const longStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`long-${index}`, 7)));
  assert.deepEqual([...shortStyles].sort(), ["iron_truss", "masonry_arch"]);
  assert.ok(mediumStyles.has("masonry_arch"));
  assert.ok(mediumStyles.has("iron_truss"));
  assert.ok(mediumStyles.has("suspension_bridge"));
  assert.ok(longStyles.has("suspension_bridge"));
});

test("bridge geometry grades and scales as a single span across different river widths", () => {
  for (const cellCount of [1, 3, 6]) {
    const cells = Array.from({ length: cellCount + 2 }, (_, column) => ({
      id: `cell-${column}-0`,
      column,
      row: 0,
      center: { x: column * 4, z: 0 },
      surface: column === 0 || column === cellCount + 1
        ? { kind: "terrain", minElevationVoxels: 2, maxElevationVoxels: 2 }
        : { kind: "water", minElevationVoxels: -3, maxElevationVoxels: -3 }
    }));
    const state = {
      cells: Object.fromEntries(cells.map((cell) => [cell.id, {
        ...cell,
        infrastructure: cell.column === 0 || cell.column === cellCount + 1 ? "road" : null
      }])),
      infrastructure: Object.fromEntries(cells.slice(1, -1).map((cell) => [cell.id, { type: "bridge", cellId: cell.id }]))
    };
    const layer = createAgentVoxelRoadLayer({ state, grid: { cells }, seed: `width-${cellCount}` });
    const [span] = layer.userData.contract.bridgeSpans;
    assert.equal(layer.userData.contract.bridgeSpanCount, 1);
    assert.equal(span.cellCount, cellCount);
    assert.equal(span.spanVoxels, cellCount * 32);
    assert.equal(span.spanWorldUnits, cellCount * 4);
    assert.equal(span.deckVoxelY, 3);
    assert.ok(layer.userData.contract.renderStats.renderedTriangles > 0);
  }
});
