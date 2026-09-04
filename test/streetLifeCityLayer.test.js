import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  createStreetLifeCityLayer,
  createStreetLifeCityPlan,
  findShortestRoadPath
} from "../src/generators/streetLifeCityLayer.js";

function createLinearStreet(length = 10) {
  const cells = Array.from({ length }, (_, column) => ({
    id: `cell-${column}-0`,
    column,
    row: 0,
    center: { x: (column - (length - 1) / 2) * 4, z: 0 },
    surface: { maxElevationVoxels: 0 }
  }));
  const state = {
    gameplay: { population: { muggles: { current: 24 }, wizards: { current: 4 } } },
    cells: Object.fromEntries(cells.map((cell) => [cell.id, { ...cell, infrastructure: "road" }])),
    infrastructure: {},
    buildings: {
      west: { id: "west", site: { entranceCellId: cells[1].id } },
      east: { id: "east", site: { entranceCellId: cells.at(-2).id } }
    }
  };
  return { state, grid: { columns: length, rows: 1, cellWorldSize: 4, cells } };
}

test("street-life entities never exceed the authoritative population", () => {
  const empty = createLinearStreet();
  empty.state.gameplay.population = { muggles: { current: 0 }, wizards: { current: 0 } };
  const emptyPlan = createStreetLifeCityPlan(empty);
  assert.equal(emptyPlan.pedestrianCount, 0);
  assert.equal(emptyPlan.vehicleCount, 0);

  const small = createLinearStreet();
  small.state.gameplay.population = { muggles: { current: 3 }, wizards: { current: 1 } };
  const smallPlan = createStreetLifeCityPlan(small);
  assert.ok(smallPlan.pedestrianCount + smallPlan.vehicleCount <= 4);
});

test("shortest road routes follow connected cardinal cells", () => {
  const adjacency = new Map([
    ["a", ["b"]],
    ["b", ["a", "c"]],
    ["c", ["b", "d"]],
    ["d", ["c"]]
  ]);
  assert.deepEqual(findShortestRoadPath("a", "d", adjacency), ["a", "b", "c", "d"]);
  assert.deepEqual(findShortestRoadPath("a", "missing", adjacency), []);
});

test("city street-life planning is deterministic and uses only the road graph", () => {
  const input = { ...createLinearStreet(), seed: "street-plan" };
  const first = createStreetLifeCityPlan(input);
  const second = createStreetLifeCityPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.buildingEntranceCount, 2);
  assert.ok(first.pedestrianCount >= 6);
  assert.ok(first.vehicleCount >= 2);
  const validRoadIds = new Set(input.grid.cells.map((cell) => cell.id));
  [...first.pedestrians, ...first.vehicles].forEach((entity) => {
    assert.ok(entity.routeCellIds.length >= 2);
    assert.ok(entity.routeCellIds.every((id) => validRoadIds.has(id)));
  });
});

test("street-life layer keeps pedestrians full-detail while vehicles retain LOD without dynamic shadows", () => {
  const input = createLinearStreet();
  const layer = createStreetLifeCityLayer({
    ...input,
    seed: "street-layer",
    planetRadius: 220,
    sampleGroundHeight: () => 0
  });
  assert.equal(layer.userData.dynamicSubtree, true);
  assert.ok(layer.children.length > 0);
  layer.traverse((object) => {
    if (object.isMesh) assert.equal(object.castShadow, false);
  });

  const pedestrianRoots = layer.children.filter((child) => child.name.startsWith("StreetLife-pedestrian-"));
  const vehicleRoots = layer.children.filter((child) => child.name.startsWith("StreetLife-vehicle-"));
  assert.equal(pedestrianRoots.length, layer.userData.plan.pedestrianCount);
  assert.equal(vehicleRoots.length, layer.userData.plan.vehicleCount);
  pedestrianRoots.forEach((root) => {
    assert.equal(root.getObjectByName("PedestrianMediumLod"), undefined);
    assert.equal(root.children.length, 1);
  });
  assert.ok(vehicleRoots.some((root) => root.getObjectByName("VehicleMediumLod")));

  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 2000);
  camera.position.set(0, 8, 16);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  layer.userData.updateView(camera, { width: 1280, height: 720, renderScale: 1, viewMode: "near", qualityScale: 1 });
  const firstPedestrian = pedestrianRoots[0].children[0];
  const leftLeg = firstPedestrian.userData.rig.leftLeg;

  layer.traverse((object) => {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  });
  assert.equal(leftLeg.matrixAutoUpdate, false);
  layer.userData.update(1);
  assert.equal(leftLeg.matrixAutoUpdate, true);
  assert.equal(leftLeg.matrixWorldAutoUpdate, true);
  assert.equal(layer.userData.getDiagnostics().animationPolicy.pedestrianWalkIntensity, 0.68);

  const firstNearPose = leftLeg.rotation.x;
  layer.userData.update(1.15);
  assert.notEqual(leftLeg.rotation.x, firstNearPose);
  const nearCounts = layer.userData.getDiagnostics().currentLodCounts;
  assert.ok(nearCounts.near + nearCounts.medium > 0);

  layer.userData.updateView(camera, { width: 1280, height: 720, renderScale: 1, viewMode: "far", qualityScale: 1 });
  const frozenPose = leftLeg.rotation.x;
  layer.userData.update(1.3);
  assert.equal(leftLeg.rotation.x, frozenPose);

  camera.position.set(0, 800, 1200);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  layer.userData.updateView(camera, { width: 1280, height: 720, renderScale: 1, viewMode: "far", qualityScale: 1 });
  pedestrianRoots.forEach((root) => {
    assert.equal(root.visible, true);
    assert.equal(root.children[0].visible, true);
  });
  const farCounts = layer.userData.getDiagnostics().currentLodCounts;
  assert.equal(farCounts.near, pedestrianRoots.length);
  assert.equal(farCounts.culled, vehicleRoots.length);
});

test("city vehicles remain narrower than one side of the two-lane road", () => {
  const input = createLinearStreet();
  const layer = createStreetLifeCityLayer({ ...input, seed: "street-scale", planetRadius: 220 });
  const scale = layer.userData.getDiagnostics().cityScale;
  assert.equal(scale.roadWidth, 2);
  assert.equal(scale.laneWidth, 1);
  assert.ok(scale.hatchback.width < scale.laneWidth);
  assert.ok(scale.saloon.width < scale.laneWidth);
  assert.ok(scale.bus.width < scale.laneWidth);
  assert.ok(scale.pedestrian < 0.7);
});
