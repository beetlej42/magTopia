import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { createBlankVoxelWorldContract } from "../src/city/voxel-world.js";
import * as THREE from "three";
import { updateVoxelLods } from "../src/generators/magicLondonStarterDistrict.js";
import { projectDistrictOntoSphere } from "../src/generators/voxelIntentDistrict.js";
import { createRailwayGatewayLayer, createRailwayStationSpec, createVoxelSteamTrain, createVoxelRailTrack, createLongitudinalTrainShed } from "../src/generators/railwayAssets.js";

test("a 50x50 city starts from a through-station gateway with protected station and forecourt land", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-layout", terrainSubdivisions: 4 }));
  const gateway = state.nodes.old_town_entry;
  const railway = gateway.railway;

  assert.equal(gateway.type, "railway_station_gateway");
  assert.equal(gateway.urbanDirection, "north");
  assert.equal(railway.orientation, "east_west");
  assert.equal(railway.train.movement, "through_service");
  assert.equal(railway.station.footprint, "6x3");
  assert.equal(railway.station.cellIds.length, 18);
  assert.equal(railway.forecourt.cellIds.length, 18);
  assert.equal(state.cells[gateway.cellId].infrastructure, "station_plaza");
  assert.equal(Object.values(state.cells).filter((cell) => cell.infrastructure === "road").length, 0);
  assert.ok(railway.station.cellIds.every((id) => state.cells[id].infrastructure === "railway_station"));
  assert.ok(railway.forecourt.cellIds.filter((id) => id !== gateway.cellId).every((id) => state.cells[id].infrastructure === "station_plaza"));
  assert.ok(railway.trackCellIds.every((id) => state.cells[id].infrastructure === "railway"));
  assert.ok(railway.trackRow >= 40 && railway.trackRow <= 45, "the corridor stays on the far side of the default camera");
});

test("all station upgrades keep a 6x3 footprint while gaining railway landmarks", () => {
  const specs = [1, 2, 3].map((level) => createRailwayStationSpec(level));
  assert.ok(specs.every((spec) => spec.widthCells === 6 && spec.depthCells === 3));
  assert.equal(specs[0].masses.some((mass) => mass.id === "clock-tower"), false);
  assert.equal(specs[1].masses.some((mass) => mass.id === "clock-tower"), true);
  assert.equal(specs[2].masses.some((mass) => mass.id === "grand-train-shed" && mass.type === "framed"), true);
  assert.deepEqual(specs.map((spec) => spec.metadata.stationLevel), [1, 2, 3]);
});

test("station upgrades charge deterministic costs and stop at level three", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-upgrades", terrainSubdivisions: 4 }), { resources: { coins: 2000 } });
  const context = createEngineContext({ now: () => "2026-09-06T00:00:00.000Z" });
  const level2 = executeCityCommand(state, { type: "upgrade_gateway", nodeId: "old_town_entry", actor: "agent:test" }, context);
  assert.equal(level2.accepted, true);
  assert.equal(level2.gateway.stationLevel, 2);
  assert.equal(level2.cost.coins, 480);
  assert.deepEqual(level2.gateway.railway.station.cellIds, state.nodes.old_town_entry.railway.station.cellIds);
  const level3 = executeCityCommand(level2.state, { type: "upgrade_gateway", nodeId: "old_town_entry", actor: "agent:test" }, context);
  assert.equal(level3.accepted, true);
  assert.equal(level3.gateway.stationLevel, 3);
  assert.equal(level3.cost.coins, 960);
  assert.equal(executeCityCommand(level3.state, { type: "upgrade_gateway", nodeId: "old_town_entry" }, context).code, "GATEWAY_MAX_LEVEL");
});

test("voxel track and steam train compile into bounded greedy geometry", () => {
  const track = createVoxelRailTrack({ lengthWorld: 80, platformLengthWorld: 28, seed: "track-test" }).userData.contract;
  const train = createVoxelSteamTrain({ seed: "train-test" }).userData.contract;
  assert.equal(track.asset, "victorian-through-railway-v1");
  assert.equal(track.gaugeVoxels, 12);
  assert.ok(track.renderStats.renderedTriangles > 0);
  assert.equal(train.asset, "victorian-voxel-steam-train-v1");
  assert.equal(train.coachCount, 2);
  assert.equal(train.wheelCount, 30);
  assert.ok(train.materialCounts.iron > 0);
  assert.ok(train.renderStats.renderedTriangles < 10000);
});

test("railway station, track, and forecourt use the shared construction datum", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-datum", terrainSubdivisions: 4 }));
  const grid = {
    ...state.world.grid,
    cells: Object.values(state.cells)
  };
  const layer = createRailwayGatewayLayer({ state, grid, seed: "railway-datum", animateTrain: false });

  assert.deepEqual(layer.userData.contract.constructionDatum, {
    buildingOriginWorldY: 0,
    roadSurfaceVoxelY: -1
  });
  assert.equal(layer.getObjectByName("VoxelRailTrack").position.y, 0);
  const track = layer.getObjectByName("VoxelRailTrack");
  const train = layer.getObjectByName("ThroughSteamTrain");
  assert.equal(train.scale.x, 0.65);
  assert.equal(track.scale.x, 1, "the railway still spans the whole map");
  assert.equal(track.scale.z, train.scale.z, "gauge and wheels share the same scale");
  assert.equal(train.position.y, track.userData.contract.railTopWorldY);
  const coachFloor = train.position.y + 10.5 * 0.125 * train.scale.y;
  assert.ok(Math.abs(track.userData.contract.platformTopWorldY - coachFloor) < 0.05);
  const wheels = train.getObjectByName("SpokedWheels");
  train.updateMatrixWorld(true);
  const wheelBounds = new THREE.Box3().setFromObject(wheels);
  assert.ok(Math.abs(wheelBounds.min.y - track.userData.contract.railTopWorldY) < 1e-6,
    "wheel bottoms touch the actual railhead rather than hovering above it");
  layer.userData.enableSphericalTrain(180);
  const scaleBefore = train.scale.clone();
  layer.userData.update(20);
  assert.deepEqual(train.scale.toArray(), scaleBefore.toArray());

  assert.equal(layer.getObjectByName("RailwayStation-Level-1").position.y, 0);
  const forecourtBounds = new THREE.Box3().setFromObject(layer.getObjectByName("RailwayStationForecourts"));
  assert.equal(forecourtBounds.max.y, 0);
});


test("the far-side forecourt and rendered facade face back toward the map centre", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-facing", terrainSubdivisions: 4 }));
  const railway = state.nodes.old_town_entry.railway;
  const rows = (ids) => ids.map((id) => state.cells[id].row);
  assert.ok(Math.max(...rows(railway.forecourt.cellIds)) < Math.min(...rows(railway.station.cellIds)));
  assert.ok(Math.max(...rows(railway.station.cellIds)) < railway.trackRow);
  const layer = createRailwayGatewayLayer({ state, grid: { ...state.world.grid, cells: Object.values(state.cells) }, animateTrain: false });
  const station = layer.getObjectByName("RailwayStation-Level-1");
  const facade = new THREE.Vector3(0, 0, -1).applyQuaternion(station.quaternion);
  assert.ok(facade.z > 0.99);
  assert.ok(station.position.z < 0);
});

test("train finishes stay attached, coaches honour the request, and steam remains bounded", () => {
  const train = createVoxelSteamTrain({ coachCount: 1 });
  assert.equal(train.userData.contract.coachCount, 1);
  assert.equal(train.userData.contract.wheelCount, 22);
  const body = [];
  train.traverse((child) => { if (child.isMesh && child.userData.materialId) body.push(child); });
  assert.ok(body.some((mesh) => mesh.userData.materialId === "brickRed"));
  for (const mesh of body) {
    assert.equal(mesh.material.userData.textureSpace, "local");
    assert.equal(mesh.material.userData.voxelCurvedWorldTwinkle, undefined);
    assert.notEqual(mesh.userData.materialId, "opaquePalette");
  }
  const wheels = train.getObjectByName("SpokedWheels");
  const before = wheels.instanceMatrix.array.slice();
  train.userData.updateSteam(4, 2);
  assert.notDeepEqual(wheels.instanceMatrix.array, before);
  const afterMove = wheels.instanceMatrix.array.slice();
  train.userData.updateSteam(5, 0);
  assert.deepEqual(wheels.instanceMatrix.array, afterMove, "wheels stop while steam continues");
  const clouds = train.getObjectByName("LayeredSteamClouds");
  assert.deepEqual(clouds.position.toArray(), train.userData.contract.chimneyLocal);
  assert.equal(clouds.children.reduce((sum, mesh) => sum + mesh.count, 0), 84);
  for (const elapsed of [0, 10, 42, 100000]) {
    train.userData.updateSteam(elapsed);
    assert.ok(clouds.children.every((mesh) => mesh.instanceMatrix.array.every(Number.isFinite)));
  }
});


test("the longitudinal shed leaves the train envelope clear and follows the actual rail position", () => {
  for (const level of [1, 2, 3]) {
    const shed = createLongitudinalTrainShed(level);
    const { trackCenterLocalZ } = shed.userData.contract;
    const bounds = new THREE.Box3().setFromObject(shed);
    assert.ok(bounds.max.x - bounds.min.x > (bounds.max.z - bounds.min.z) * 4);
    shed.updateMatrixWorld(true);
    shed.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(p.z - trackCenterLocalZ) < 1.4) {
          assert.ok(p.y >= 5.875, "columns and arch ribs stay out of the locomotive envelope");
        }
      }
    });
  }
  const state = createCityState(createBlankVoxelWorldContract({ seed: "shed-alignment", terrainSubdivisions: 4 }));
  const layer = createRailwayGatewayLayer({ state, grid: { ...state.world.grid, cells: Object.values(state.cells) }, animateTrain: false });
  const shed = layer.getObjectByName("LongitudinalTrainShed");
  layer.updateMatrixWorld(true);
  const center = shed.localToWorld(new THREE.Vector3(0, 0, shed.userData.contract.trackCenterLocalZ));
  assert.ok(Math.abs(center.z - layer.getObjectByName("ThroughSteamTrain").position.z) < 0.001);
});

test("the landscaped forecourt keeps the central arrival path unobstructed", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "plaza-clearance", terrainSubdivisions: 4 }));
  state.nodes.old_town_entry.stationLevel = 3;
  const layer = createRailwayGatewayLayer({ state, grid: { ...state.world.grid, cells: Object.values(state.cells) }, animateTrain: false });
  const gardens = layer.getObjectByName("RailwayForecourtGardens");
  const stationX = layer.getObjectByName("RailwayStation-Level-3").position.x;
  const axisX = stationX + 1;
  layer.updateMatrixWorld(true);
  gardens.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).x - axisX) >= 3, "furnishings do not obstruct the six-world-unit arrival axis");
    }
  });
  layer.userData.updateDaylight({ nightFactor: 1 });
  gardens.traverse((mesh) => {
    if (mesh.userData.materialId === "warmWindow") assert.ok(mesh.material.emissiveIntensity > 1);
  });
});


test("the glass barrel is watertight at all three voxel mip levels", () => {
  const shed = createLongitudinalTrainShed(3);
  shed.updateMatrixWorld(true);
  const lod = shed.children.find((child) => child.isLOD);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (let level = 0; level < 3; level++) {
    for (const x of [-10.13, -2.13, 5.13, 11.13]) {
      for (let dz = -1.95; dz < 2; dz += 0.12) {
        ray.ray.origin.set(x, 30, shed.userData.contract.trackCenterLocalZ + dz);
        const hits = ray.intersectObject(lod.levels[level].object, true);
        assert.ok(hits.length, `continuous canopy at LOD ${level}, x=${x}, z=${dz}`);
      }
    }
  }
});

test("railway LOD uses the building selector and preserves projected callbacks", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-lod", terrainSubdivisions: 4 }));
  const layer = createRailwayGatewayLayer({ state, grid: { ...state.world.grid, cells: Object.values(state.cells) }, animateTrain: false });
  const lods = [];
  layer.traverse((object) => { if (object.isLOD) lods.push(object); });
  assert.ok(lods.length > 10, "long rails have independently selected segments");
  for (const lod of lods) {
    assert.deepEqual(lod.userData.lodFactors, [1, 2, 3]);
    assert.equal(lod.autoUpdate, false);
    assert.equal(lod.userData.shadowPolicy, "low-lod-colorless-proxy");
    assert.equal(lod.levels.filter((level) => level.object.visible).length, 1);
  }
  const world = new THREE.Group(); world.add(layer);
  projectDistrictOntoSphere(world, 220);
  layer.userData.enableSphericalTrain(220);
  const camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 20000);
  camera.position.set(0, 30, 160); camera.lookAt(-35, 0, -65); camera.updateMatrixWorld(true);
  layer.userData.updateView(camera, 4, { height: 900 });
  assert.ok(layer.userData.getRailwayLodDiagnostics().every((entry) => entry.level != null));
  assert.equal(world.getObjectByName("RailwayForecourtTrees").userData.getDiagnostics().instances, 4);
  layer.userData.update(2); layer.userData.updateDaylight({ nightFactor: 1 });
  assert.ok(lods.every((lod) => lod.children.find((child) => child.userData.shadowProxy)?.visible));
});

test("train LOD switches geometry and effects without moving its body or losing wheels", () => {
  const train = createVoxelSteamTrain();
  const body = train.children.find((child) => child.isLOD);
  const camera = new THREE.PerspectiveCamera(40, 1.4, 0.1, 20000);
  const levels = [];
  for (const distance of [50, 600, 4000]) {
    camera.position.set(0, 8, distance); camera.lookAt(0, 2, 0); camera.updateMatrixWorld(true);
    train.updateMatrixWorld(true);
    train.userData.updateView(camera, 4, { height: 720 });
    levels.push(body.userData.currentLevel);
    train.userData.updateSteam(5, 0.3);
    assert.equal(train.getObjectByName("SteamTrainWheelShadowProxy").visible, true);
    assert.equal(body.levels.filter((level) => level.object.visible).length, 1);
  }
  assert.deepEqual(levels, [0, 1, 2]);
  assert.equal(train.getObjectByName("LayeredSteamClouds").children[1].count, 20);
});
