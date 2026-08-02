import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  adaptBuildingIntentToMassingConfig,
  adaptBuildingIntentToStreetConfig,
  getBuildingIntentCatalog,
  normalizeBuildingIntent
} from "../src/generators/buildingIntent.js";
import { planVoxelStreet } from "../src/generators/voxelBuildingLab.js";
import { createUrbanMassingSpec } from "../src/generators/voxelMassingGrammar.js";
import {
  VOXEL_INTENT_DISTRICT_PRESETS,
  classifyVoxelRoadTopology,
  createRandomVoxelIntentDistrictConfig,
  createVoxelDistrictLayout,
  createVoxelDistrictMacroSurface,
  createVoxelDistrictRoadPlan,
  createVoxelIntentDistrict,
  createVoxelPrefabDistricts,
  getVoxelSphereFrame,
  normalizeVoxelIntentDistrictConfig
} from "../src/generators/voxelIntentDistrict.js";

test("BuildingIntent keeps arbitrary purpose text while bounding geometric controls", () => {
  const intent = normalizeBuildingIntent({
    name: "The Lost Tuesday Office",
    purpose: "returns weekdays misplaced by chronomancy",
    composition: "invented-shape",
    frontage: "display",
    access: "public",
    style: "victorian_gothic",
    prominence: "landmark",
    magicLevel: 4
  });

  assert.equal(intent.purpose, "returns weekdays misplaced by chronomancy");
  assert.equal(intent.composition, "street");
  assert.equal(intent.frontage, "display");
  assert.equal(intent.magicLevel, 1);
  const catalog = getBuildingIntentCatalog();
  assert.deepEqual(catalog.semanticFields, ["name", "purpose", "description", "signText"]);
  assert.equal(catalog.site.maximumSpanCells, 6);
  assert.deepEqual(catalog.site.prominenceDefaults.landmark, { widthCells: 5, depthCells: 3 });
});

test("street adapter turns affordances into the existing facade grammar and preserves semantics", () => {
  const config = adaptBuildingIntentToStreetConfig({
    name: "Needle & Moon",
    purpose: "enchanted clothing shop",
    composition: "street",
    frontage: "display",
    access: "public",
    style: "victorian_gothic",
    prominence: "important",
    magicLevel: 0.7
  }, { buildingCount: 2, seed: "intent-street-test" });
  const plan = planVoxelStreet(config);

  assert.equal(config.floorPrograms[0].purpose, "shop");
  assert.equal(config.cornerFacades, "both");
  assert.equal(plan.buildings.length, 2);
  assert.ok(plan.buildings.every((building) => building.intent.purpose === "enchanted clothing shop"));
  assert.ok(plan.buildings.every((building) => building.metadata.name === "Needle & Moon"));
});

test("massing adapter chooses a composition without requiring a purpose enum", () => {
  const config = adaptBuildingIntentToMassingConfig({
    name: "Practical Mooncraft School",
    purpose: "school teaching safe household moon magic",
    composition: "tower",
    frontage: "institutional",
    access: "ceremonial",
    style: "civic_classical",
    prominence: "landmark",
    magicLevel: 0.72
  }, { seed: "intent-massing-test" });
  const spec = createUrbanMassingSpec(config);

  assert.equal(spec.intent.purpose, "school teaching safe household moon magic");
  assert.equal(spec.metadata.name, "Practical Mooncraft School");
  assert.equal(spec.footprint.widthCells, 5);
  assert.equal(spec.footprint.depthCells, 3);
  assert.ok(spec.masses.some((mass) => mass.id === "teaching-tower"));
  assert.ok(spec.relations.some((relation) => relation.type === "stacked"));
  const hall = spec.masses.find((mass) => mass.id === "central-hall");
  const tower = spec.masses.find((mass) => mass.id === "teaching-tower");
  assert.equal(hall.heightVoxels, 60);
  assert.equal(tower.baseYVoxels, 60);
  assert.ok(tower.baseYVoxels + tower.heightVoxels + tower.cap.heightVoxels >= 125);
});

test("institutional intent can explicitly occupy the full 6x6 framework limit", () => {
  const spec = createUrbanMassingSpec(adaptBuildingIntentToMassingConfig({
    purpose: "metropolitan magical university",
    composition: "court",
    frontage: "institutional",
    access: "ceremonial",
    prominence: "landmark"
  }, { widthCells: 6, depthCells: 6 }));

  assert.equal(spec.footprint.widthCells, 6);
  assert.equal(spec.footprint.depthCells, 6);
  assert.ok(spec.masses.find((mass) => mass.id === "ceremonial-court").cells.length > 20);
});

test("intent district combines street and public-building adapters into one deterministic mode", () => {
  const config = normalizeVoxelIntentDistrictConfig(VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay);
  const district = createVoxelIntentDistrict(config);
  const diagnostics = district.userData.getVoxelDiagnostics();

  assert.equal(diagnostics.plotCount, 3);
  assert.equal(diagnostics.streetBuildingCount, 4);
  assert.ok(diagnostics.publicMassCount >= 3);
  assert.equal(diagnostics.intents.length, 3);
  assert.ok(diagnostics.intents.some((intent) => intent.purpose.includes("school")));
  assert.equal(diagnostics.renderer, "voxel-intent-district-v0.3");
  assert.equal(diagnostics.environment.renderer, "voxel-environment-v0.2");
  assert.ok(diagnostics.environment.terrainColumns > 30000);
  assert.ok(diagnostics.environment.waterColumns > 0);
  assert.ok(diagnostics.environment.roadColumns > 0);
  assert.equal(diagnostics.environment.roadWidthVoxels, 18);
  assert.equal(diagnostics.environment.roadTopologies.tee, 1);
  assert.ok(diagnostics.environment.closedRoadPorts > 0);
  assert.ok(diagnostics.environment.curbVoxels > 0);
  assert.ok(diagnostics.environment.markingVoxels > 0);
  assert.equal(diagnostics.environment.terraceFrontLampCount, 3);
  assert.equal(diagnostics.environment.streetLampHeightVoxels, 21);
  assert.deepEqual(diagnostics.environment.streetLampFootprintVoxels, [5, 5]);
  assert.equal(diagnostics.environment.streetLampSidewalkOffsetVoxels, 5);
  assert.equal(diagnostics.environment.streetFixturesOwnedByRoad, true);
  assert.equal(diagnostics.environment.roadSurfaceVoxelY, -1);
  assert.equal(diagnostics.environment.buildingBaseVoxelY, 0);
  assert.equal(diagnostics.environment.finishedConstructionHeight, -0.0625);
  assert.ok(diagnostics.environment.treeCount > 0);
  assert.ok(diagnostics.environment.shrubCount > 0);
  assert.ok(diagnostics.instanceCount > diagnostics.environment.instanceCount);
  assert.equal(diagnostics.renderStrategy, "greedy-spatial-chunks");
  assert.ok(diagnostics.renderedTriangles < diagnostics.instanceCount * 2 + diagnostics.world.surfaceVoxelCount);
  assert.ok(diagnostics.environment.renderStats.chunkCount > 1);
  assert.ok(diagnostics.environment.renderStats.mergedQuadCount < diagnostics.environment.renderStats.sourceFaceCount);
  assert.equal(diagnostics.grid.cellVoxels, 32);
  assert.equal(diagnostics.grid.cellWorldSize, 4);
  assert.ok(Object.values(diagnostics.grid.placements).every((placement) => placement.gridAligned));
  assert.deepEqual(diagnostics.grid.placements.retail.centerVoxels, [-80, -48]);
  assert.deepEqual(diagnostics.grid.placements.workshops.centerVoxels, [112, 16]);
  assert.equal(diagnostics.grid.placements.institution.widthCells, 5);
  assert.equal(diagnostics.grid.placements.institution.depthCells, 3);
  assert.equal(diagnostics.projection.type, "spherical-local-frame");
  assert.equal(diagnostics.projection.radius, 220);
  assert.ok(diagnostics.projection.projectedInstances > 100000);
  assert.ok(diagnostics.projection.maximumSurfaceTiltDegrees > 15);
  assert.deepEqual(diagnostics.world.gridSize, [50, 50]);
  assert.equal(diagnostics.world.logicalCellCount, 2500);
  assert.deepEqual(diagnostics.world.terrainVoxelGridSize, [1600, 1600]);
  assert.equal(diagnostics.world.chunkCount, 49);
  assert.ok(diagnostics.world.triangleCount >= 1000000 && diagnostics.world.triangleCount < 2000000);
  assert.equal(diagnostics.world.construction.siteCount, 8);
  assert.ok(diagnostics.world.construction.rejectedWaterCellCount > 0);
  assert.equal(diagnostics.world.construction.flattenedLogicalCellCount, 160);
  assert.ok(diagnostics.world.construction.roadSurfaceVoxels > 0);
  assert.ok(diagnostics.world.construction.parcelSurfaceVoxels > 0);
  assert.equal(diagnostics.world.prefabDistricts.count, 8);
  assert.equal(diagnostics.world.prefabDistricts.selection, "camera frustum plus projected base-voxel screen size");
  assert.deepEqual(diagnostics.world.prefabDistricts.projectedVoxelThresholdsPx, { near: 2, medium: 1 });
  assert.equal(district.userData.contract.mode, "intent-district");
  assert.equal(district.userData.contract.camera.navigation, "fixed-radius surface pan");
  assert.equal(district.userData.contract.camera.depthOfField, "bokeh retained");
  assert.deepEqual(district.userData.contract.environment.layers, [
    "terrain",
    "water",
    "embankment",
    "voxel-road-network",
    "pavement",
    "street-lighting",
    "vegetation"
  ]);
  assert.deepEqual(
    createRandomVoxelIntentDistrictConfig("district-seed", config),
    createRandomVoxelIntentDistrictConfig("district-seed", config)
  );
});

test("distant prefab districts use four real LOD levels", () => {
  const prefabs = createVoxelPrefabDistricts();

  assert.equal(prefabs.diagnostics.count, 8);
  assert.equal(prefabs.diagnostics.renderer, "generated-voxel-mip-lod-v3");
  assert.ok(prefabs.diagnostics.placements.every((district) => district.generator.includes("voxel building generator")));
  assert.ok(prefabs.diagnostics.placements.every((district) => district.styleKits.length > 0));
  assert.ok(prefabs.diagnostics.placements.every((district) => district.roofForms.length > 0));
  assert.ok(prefabs.diagnostics.placements.every((district) => district.terrainValidated));
  assert.ok(prefabs.diagnostics.placements.every((district) => district.logicalCellIds.length === 20));
  assert.ok(prefabs.diagnostics.placements.every((district) => district.foundationClearance > 0));
  assert.equal(prefabs.diagnostics.selection, "camera frustum plus projected base-voxel screen size");
  assert.deepEqual(prefabs.diagnostics.projectedVoxelThresholdsPx, { near: 2, medium: 1 });
  assert.ok(prefabs.group.children.every((district) => district.isLOD));
  assert.ok(prefabs.group.children.every((district) => district.levels.length === 4));
  assert.ok(prefabs.diagnostics.placements.every((district) => (
    new Set(district.levels.slice(0, 3).map((level) => level.buildingCount)).size === 1
  )));
  assert.ok(prefabs.diagnostics.placements.every((district) => (
    district.levels.slice(0, 3).map((level) => level.factor).join(",") === "1,2,3"
  )));
  assert.ok(prefabs.diagnostics.placements.every((district) => (
    district.levels.slice(0, 3).map((level) => level.aggregation).join(",") === "1,8,27"
  )));
  assert.ok(prefabs.diagnostics.placements.every((district) => (
    district.levels[0].occupiedVoxels > district.levels[1].occupiedVoxels
      && district.levels[1].occupiedVoxels > district.levels[2].occupiedVoxels
  )));
});

test("prefab LOD follows camera frustum and projected screen size at the same camera position", () => {
  const prefabs = createVoxelPrefabDistricts();
  prefabs.group.updateMatrixWorld(true);
  const first = prefabs.group.children[0];
  const target = first.getWorldPosition(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 1000);
  camera.position.copy(target).add(new THREE.Vector3(0, 8, 55));
  const fixedPosition = camera.position.clone();
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  prefabs.updateView(camera, { width: 650, height: 650 });
  const narrowLevel = prefabs.diagnostics.currentLevels.find((entry) => entry.id === first.userData.prefabDistrictId);

  first.userData.currentLevel = null;
  camera.fov = 100;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  prefabs.updateView(camera, { width: 650, height: 650 });
  const wideLevel = prefabs.diagnostics.currentLevels.find((entry) => entry.id === first.userData.prefabDistrictId);

  first.userData.currentLevel = null;
  camera.lookAt(camera.position.clone().multiplyScalar(2).sub(target));
  camera.updateMatrixWorld(true);
  prefabs.updateView(camera, { width: 650, height: 650 });
  const outsideLevel = prefabs.diagnostics.currentLevels.find((entry) => entry.id === first.userData.prefabDistrictId);

  assert.equal(narrowLevel.level, "near");
  assert.equal(wideLevel.level, "far");
  assert.deepEqual(camera.position.toArray(), fixedPosition.toArray());
  assert.equal(outsideLevel.level, "culled");
  assert.equal(outsideLevel.visibleInFrustum, false);
});

test("macro world reaches Magic London scale with a compact base-voxel heightfield", () => {
  const macro = createVoxelDistrictMacroSurface();

  assert.deepEqual(macro.diagnostics.gridSize, [50, 50]);
  assert.deepEqual(macro.diagnostics.dimensionsWorld, [200, 200]);
  assert.equal(macro.diagnostics.logicalCellCount, 2500);
  assert.deepEqual(macro.diagnostics.terrainVoxelGridSize, [1600, 1600]);
  assert.equal(macro.diagnostics.terrainVoxelsPerCell, 1024);
  assert.equal(macro.diagnostics.surfaceVoxelCount, 2560000);
  assert.equal(macro.diagnostics.terrainVoxelWorldSize, 0.125);
  assert.equal(macro.diagnostics.terrainVoxelBaseSpan, 1);
  assert.equal(macro.diagnostics.elevationSteps, 4);
  assert.equal(macro.diagnostics.meshStrategy, "sphere-safe 2x2 maximum coplanar merging with exact one-voxel contour boundaries");
  assert.ok(macro.diagnostics.triangleCount >= 1000000 && macro.diagnostics.triangleCount < 2000000);
  assert.equal(macro.diagnostics.construction.siteCount, 8);
  assert.equal(macro.diagnostics.construction.globalConstructionHeight, -0.0625);
  assert.ok(macro.diagnostics.construction.gradedTransitionVoxels > 0);
  assert.equal(macro.constructionPlan.sites.length, 8);
  assert.equal(new Set(macro.constructionPlan.sites.map((site) => site.targetHeight)).size, 1);
  assert.ok(macro.constructionPlan.logicalCells.filter((cell) => !cell.buildable).every((cell) => cell.waterVoxels > 0));
  const claimedCells = macro.constructionPlan.sites.flatMap((site) => site.logicalCellIds);
  assert.equal(new Set(claimedCells).size, claimedCells.length);
  assert.equal(macro.diagnostics.vegetation.renderer, "full-world-base-voxel-vegetation");
  assert.equal(macro.diagnostics.vegetation.sourceVoxelSize, 0.125);
  assert.ok(macro.diagnostics.vegetation.treeCount > 400);
  assert.ok(macro.diagnostics.vegetation.shrubCount > 700);
  assert.ok(macro.diagnostics.vegetation.flowerCount > 1000);
  assert.ok(macro.diagnostics.vegetation.renderedTriangles > 0);
  const terrainChunks = macro.group.children.filter((child) => child.name.startsWith("IntentDistrictMacroChunk-"));
  assert.equal(terrainChunks.length, 49);
  assert.ok(terrainChunks.every((mesh) => mesh.userData.flatVoxelGeometry));
  assert.ok(macro.group.getObjectByName("MacroVoxelPlants"));
});

test("sphere frames keep surface navigation orthonormal and at a fixed radius", () => {
  const radius = 44;
  const frame = getVoxelSphereFrame(12, -9, radius);
  const center = { x: 0, y: -radius, z: 0 };
  const radialDistance = Math.hypot(
    frame.surface.x - center.x,
    frame.surface.y - center.y,
    frame.surface.z - center.z
  );

  assert.ok(Math.abs(radialDistance - radius) < 1e-9);
  assert.ok(Math.abs(frame.normal.length() - 1) < 1e-9);
  assert.ok(Math.abs(frame.tangentX.length() - 1) < 1e-9);
  assert.ok(Math.abs(frame.tangentZ.length() - 1) < 1e-9);
  assert.ok(Math.abs(frame.normal.dot(frame.tangentX)) < 1e-9);
  assert.ok(Math.abs(frame.normal.dot(frame.tangentZ)) < 1e-9);
});

test("voxel district roads derive connections, close exposed continuations, and own terrace lamps", () => {
  const layout = createVoxelDistrictLayout();
  const plan = createVoxelDistrictRoadPlan(layout);
  const tile = (column, row) => plan.find((entry) => entry.cell.column === column && entry.cell.row === row);

  assert.deepEqual(tile(7, 3).ports, ["east", "south", "west"]);
  assert.equal(tile(7, 3).topology, "tee");
  assert.deepEqual(tile(7, 3).closedPorts, ["north"]);
  assert.deepEqual(tile(1, 3).ports, ["east"]);
  assert.deepEqual(tile(1, 3).closedPorts, ["west"]);
  assert.equal(classifyVoxelRoadTopology(["north", "east"]), "corner");
  assert.equal(classifyVoxelRoadTopology(["north", "east", "south", "west"]), "cross");

  const district = createVoxelIntentDistrict();
  const streetPlots = district.children.filter((child) => child.name.startsWith("IntentPlot-") && child.userData.diagnostics?.buildingCount);
  assert.ok(streetPlots.every((plot) => plot.userData.diagnostics.streetLampCount === 0));
  const roadLights = [];
  district.traverse((object) => {
    if (object.isPointLight && object.userData.fixtureOwner === "voxel-road-network") roadLights.push(object);
  });
  assert.equal(roadLights.length, district.userData.diagnostics.environment.streetLampCount);
  const terraceLights = roadLights.filter((light) => light.userData.plot === "retail");
  assert.equal(terraceLights.length, 3);
  assert.ok(terraceLights.every((light) => light.userData.flatVoxelPosition[2] === -27));
  assert.ok(terraceLights.every((light) => light.userData.fixtureSizeVoxels.height === 21));
});

test("intent district roads, water, and plots share one 32-voxel logical grid", () => {
  const layout = createVoxelDistrictLayout();
  const cell = (column, row) => layout.cells.find((entry) => entry.column === column && entry.row === row);

  assert.equal(layout.columns, 10);
  assert.equal(layout.rows, 8);
  assert.equal(layout.cellVoxels, 32);
  assert.ok(Array.from({ length: 8 }, (_, row) => cell(0, row)).every((entry) => entry.surface === "water"));
  assert.ok(Array.from({ length: 9 }, (_, index) => cell(index + 1, 3)).every((entry) => entry.surface === "road"));
  assert.equal(cell(1, 2).occupant, "retail");
  assert.equal(cell(8, 4).occupant, "workshops");
  assert.equal(cell(4, 0).occupant, "institution");
});

test("intent district routes streets around an explicit 6x6 institution", () => {
  const layout = createVoxelDistrictLayout({ institutionFootprint: { widthCells: 6, depthCells: 6 } });
  const cell = (column, row) => layout.cells.find((entry) => entry.column === column && entry.row === row);

  assert.equal(layout.roadRow, 6);
  assert.equal(cell(9, 5).occupant, "institution");
  assert.equal(cell(9, 6).surface, "road");
  assert.equal(cell(1, 5).occupant, "retail");
  assert.equal(cell(8, 7).occupant, "workshops");
});
