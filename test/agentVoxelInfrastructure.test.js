import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createAgentAcceptanceCity } from "../src/generators/agentAcceptanceCity.js";
import { createAgentVoxelRoadLayer, createAgentVoxelVegetationPlan, selectVictorianBridgeStyle } from "../src/generators/agentVoxelInfrastructure.js";
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
  assert.equal(diagnostics.vegetation.renderer, "state-aware-voxel-vegetation-v2-composition");
  assert.equal(diagnostics.vegetation.clearsRoadsAndEntrances, true);
  assert.ok(diagnostics.vegetation.trees > 0);
  assert.ok(diagnostics.vegetation.clusters > 0, "runtime vegetation should resolve cross-cell clusters");
  assert.ok(diagnostics.vegetation.clusterGroups > 0);
  assert.ok(diagnostics.vegetation.vegetatedCells > 0);
  assert.ok(diagnostics.vegetation.biomeCounts.woodland > 0);
  assert.ok(diagnostics.vegetation.tierCounts.dominant > 0 && diagnostics.vegetation.tierCounts.small > 0, "tree scale tiers must be represented");
  assert.ok(Object.keys(diagnostics.vegetation.archetypeCounts).length >= 3, "multiple tree silhouettes must be reachable");
  assert.ok(diagnostics.vegetation.archetypeCounts.vase >= 0);
  assert.ok(diagnostics.vegetation.renderStats.renderedTriangles > 0);
  assert.equal(diagnostics.projection.type, "spherical-local-frame");
  assert.equal(diagnostics.projection.radius, 220);
  assert.ok(diagnostics.projection.projectedObjects > 0);
  assert.equal(diagnostics.projection.correctedReflectedGeometries, 49);
  assert.equal(city.userData.contract.renderSurface, "spherical voxel world; flat Agent API coordinates remain authoritative");
  assert.equal(city.userData.contract.camera.depthOfField, "bokeh retained");
  assert.equal(city.userData.surfaceNavigation.radius, 220);

  const lodDiagnostics = city.userData.getPrefabLodDiagnostics();
  assert.equal(lodDiagnostics.shadowPolicy, "low-lod-colorless-proxy");
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
  assert.equal(layerContract.viewCameraExcluded, false);
  assert.equal(layerContract.colorPassVisibility, "color-write-disabled");
  assert.equal(layerContract.configuredShadowCameras.length, 1);
  assert.ok(shadowLight.shadow.camera.layers.isEnabled(0));
  assert.ok(shadowLight.shadow.camera.layers.isEnabled(VOXEL_SHADOW_ONLY_LAYER));
  assert.ok(shadowProxyMeshes.every((mesh) => viewCamera.layers.test(mesh.layers)));
  assert.ok(shadowProxyMeshes.every((mesh) => shadowLight.shadow.camera.layers.test(mesh.layers)));
  assert.ok(shadowProxyMeshes.every((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.every((material) => material.colorWrite === false && material.depthWrite === false);
  }));

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

function agentCell(id, column, row, options = {}) {
  const strict = options.strict !== false;
  return {
    id,
    column,
    row,
    center: { x: column * 4, z: row * 4 },
    buildable: strict,
    strictBuildable: strict,
    bridgeRequired: !strict,
    surface: {
      kind: strict ? "terrain" : "water",
      biome: options.biome ?? "meadow",
      maxElevationVoxels: 2,
      minElevationVoxels: 2,
      waterVoxels: strict ? 0 : 16,
      shoreVoxels: 0
    },
    occupancy: options.occupancy ? "building" : undefined,
    infrastructure: options.infrastructure ? "road" : undefined,
    reservation: options.reservation ? "reserved" : undefined
  };
}

function agentWorld(columns, rows, options = {}) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      classifyAgentCell(cells, column, row, columns, rows, options);
    }
  }
  const state = {
    cells: Object.fromEntries(cells.map((cell) => [cell.id, cell])),
    infrastructure: {},
    world: { grid: { columns, rows, cellWorldSize: 4 } }
  };
  return { state, grid: { columns, rows, cellWorldSize: 4, cells } };
}

function classifyAgentCell(cells, column, row, columns, rows, options) {
  const isWoodland = options.woodland && options.woodland.some(([c, r]) => c === column && r === row);
  const isHeath = options.heath && options.heath.some(([c, r]) => c === column && r === row);
  const isBuilding = options.building && options.building.some(([c, r]) => c === column && r === row);
  const isRoad = options.road && options.road.some(([c, r]) => c === column && r === row);
  const isWater = options.water && options.water.some(([c, r]) => c === column && r === row);
  const isReserved = options.reservation && options.reservation.some(([c, r]) => c === column && r === row);
  cells.push(agentCell(`cell-${column}-${row}`, column, row, {
    strict: !isWater,
    biome: isWoodland ? "woodland" : isHeath ? "heath" : "meadow",
    occupancy: isBuilding,
    infrastructure: isRoad,
    reservation: isReserved
  }));
}

test("runtime vegetation composition is deterministic for the same state and seed", () => {
  const { state, grid } = agentWorld(14, 12, { woodland: [[4, 4], [5, 4], [6, 4], [4, 5], [5, 5], [6, 5]] });
  const first = createAgentVoxelVegetationPlan({ state, grid, seed: "determinism-agent" });
  const second = createAgentVoxelVegetationPlan({ state, grid, seed: "determinism-agent" });
  assert.deepEqual(first, second, "the same state + seed must reproduce the same vegetation plan");
});

test("runtime vegetation preserves biome hierarchy without leaking across biome cells", () => {
  const woodland = [[0, 1], [1, 1], [2, 1]];
  const meadow = [[0, 0], [1, 0], [2, 0]];
  const heath = [[0, 2], [1, 2], [2, 2]];
  const { state, grid } = agentWorld(4, 4, { woodland, heath });
  const plan = createAgentVoxelVegetationPlan({ state, grid, seed: "biome-hierarchy" });
  const cluster = plan.clusters[0];
  const woodlandGroup = cluster.zoneGroups.find((group) => group.biome === "woodland");
  const meadowGroup = cluster.zoneGroups.find((group) => group.biome === "meadow");
  const heathGroup = cluster.zoneGroups.find((group) => group.biome === "heath");

  assert.ok(woodlandGroup && meadowGroup && heathGroup, "the mixed biome bucket should resolve separate zone groups");
  assert.ok(woodlandGroup.treeCount >= 2, "woodland should compose a multi-tree group");
  assert.ok(woodlandGroup.treeCount > (heathGroup.treeCount ?? 0), "woodland should out-densify heath");
  assert.ok(meadowGroup.treeCount <= 1, "meadow cells must not inherit woodland/grove tree density rules");

  const woodlandCells = new Set(woodland.map(([c, r]) => `cell-${c}-${r}`));
  const heathCells = new Set(heath.map(([c, r]) => `cell-${c}-${r}`));
  const meadowCells = new Set(meadow.map(([c, r]) => `cell-${c}-${r}`));
  assert.ok(woodlandGroup.ranked.every((tree) => woodlandCells.has(tree.cellId)), "woodland trees never land on meadow/heath cells");
  assert.ok(heathGroup.ranked.every((tree) => heathCells.has(tree.cellId)), "heath trees stay on heath cells");
  assert.ok(meadowGroup.ranked.every((tree) => meadowCells.has(tree.cellId)), "meadow trees (if any) stay on meadow cells");
  const scales = woodlandGroup.ranked.map((tree) => tree.scale);
  assert.ok((Math.max(...scales) / Math.min(...scales)) > 1.1, "woodland group keeps a dominant-to-small scale hierarchy");
});

test("meadow trees are rare but reachable and cluster-aware", () => {
  const { state, grid } = agentWorld(16, 16);
  const plan = createAgentVoxelVegetationPlan({ state, grid, seed: "meadow-rare" });
  const meadowCells = grid.cells.filter((cell) => cell.strictBuildable && cell.surface.biome === "meadow").length;
  const meadowTrees = plan.trees.filter((tree) => tree.biome === "meadow").length;
  assert.equal(plan.zoneCounts.meadow, meadowCells, "the whole open-world loads as vegetated meadow");
  assert.ok(meadowTrees >= 1, "occasional isolated meadow trees remain reachable");
  assert.ok(meadowTrees <= meadowCells * 0.2, "meadow stays mostly open rather than becoming tree-filled");
  const meadowGroupCounts = plan.clusters.flatMap((cluster) => cluster.zoneGroups.filter((group) => group.biome === "meadow").map((group) => group.treeCount));
  assert.ok(meadowGroupCounts.every((count) => count <= 1), "meadow trees are cluster-aware (0-1 per group), never dense");
});

test("runtime vegetation stays out of construction, roads, reservations, and non-buildable cells", () => {
  const { state, grid } = agentWorld(18, 14, {
    building: [[8, 6]],
    road: [[6, 5], [7, 5], [8, 5], [9, 5], [10, 5]],
    water: [[12, 7], [13, 7]],
    reservation: [[4, 8]]
  });
  const plan = createAgentVoxelVegetationPlan({ state, grid, seed: "exclusion-agent" });
  const occupiedIds = new Set([`cell-8-6`, `cell-6-5`, `cell-7-5`, `cell-8-5`, `cell-9-5`, `cell-10-5`, `cell-12-7`, `cell-13-7`, `cell-4-8`]);
  const placed = [...plan.trees, ...plan.shrubs];
  assert.ok(!placed.some((entry) => occupiedIds.has(entry.cellId)), "procedural vegetation must not enter occupied, road, water, or reserved cells");
  assert.ok(!placed.some((entry) => { const match = /^cell-(\d+)-(\d+)$/.exec(entry.cellId); if (!match) return false; const [c, r] = [Number(match[1]), Number(match[2])]; return Math.abs(c - 8) <= 1 && Math.abs(r - 6) <= 1; }), "vegetation must respect the safety margin around construction");
  assert.ok(buildableCount(grid) > placed.length, "vegetation leaves negative-space breathing room");
});

function buildableCount(grid) {
  return grid.cells.filter((cell) => cell.strictBuildable && (cell.surface?.biome === "meadow" || cell.surface?.biome === "heath" || cell.surface?.biome === "woodland")).length;
}
