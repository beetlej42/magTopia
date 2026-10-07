import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createPigeonNavigation, planPigeonFlight, pigeonPerch } from "../src/generators/pigeonNavigation.js";
import { createPigeonCityLayer } from "../src/generators/pigeonCityLayer.js";
import { createBuildingDesignDraft } from "../src/city/building-design.js";
import { createBuildingDesignObject } from "../src/generators/buildingDesignObject.js";

function fixture(turn = false) {
  const cells = [];
  for (let x = 0; x < 5; x++) cells.push({ id: `c${x}`, column: x, row: 0, center: { x: x * 4, z: 0 } });
  if (turn) for (let z = 1; z < 4; z++) cells.push({ id: `z${z}`, column: 4, row: z, center: { x: 16, z: z * 4 } });
  const makeBuilding = (id, cell) => ({ id, footprintCells: [cell.id], voxelDesign: {
    actualSiteComposition: { resolvedLayout: "open_space", openSpaceType: "plaza" },
    generation: { sourceSpec: { masses: [{ type: "ground" }] } }
  } });
  const state = { cells: Object.fromEntries(cells.map(c => [c.id, { ...c, infrastructure: "road" }])),
    buildings: { a: makeBuilding("a", cells[0]), b: makeBuilding("b", cells.at(-1)) } };
  const grid = { cells, cellWorldSize: 4 };
  const collisionRoot = new THREE.Group();
  return { state, grid, collisionRoot };
}

test("one flock of five moves between safe plazas, with no vertical takeoff", () => {
  const nav = createPigeonNavigation(fixture());
  assert.equal(nav.stops.length, 2);
  const route = planPigeonFlight(nav, ...nav.stops);
  assert.ok(route);
  for (const track of route.tracks) {
    assert.ok(track[1].y > track[0].y);
    assert.ok(Math.hypot(track[1].x - track[0].x, track[1].z - track[0].z) > 0);
    for (const p of track) assert.ok(nav.ceiling(p.x, p.z, 0.43) <= p.y - 0.005);
  }
  const layer = createPigeonCityLayer({ navigation: nav });
  const parent = new THREE.Group(); parent.add(layer); parent.updateMatrixWorld(true);
  parent.matrixAutoUpdate = parent.matrixWorldAutoUpdate = false;
  layer.userData.update(0);
  const before = layer.children[0].matrixWorld.clone();
  layer.traverse(o => { o.matrixAutoUpdate = o.matrixWorldAutoUpdate = false; });
  layer.userData.update(1);
  assert.ok(layer.children[0].matrixAutoUpdate);
  assert.notDeepEqual(layer.children[0].matrixWorld.elements, before.elements, "world transforms advance under a frozen city ancestor");
  let flew = false;
  for (let t = 2; t <= 130; t += 0.1) { layer.userData.update(t); flew ||= layer.userData.getDiagnostics().state === "flying"; }
  assert.ok(flew);
  assert.equal(layer.userData.getDiagnostics().birdCount, 5);
  assert.equal(layer.children.length, 5);
});

test("rounded road corner stays within the corridor", () => {
  const nav = createPigeonNavigation(fixture(true));
  const route = planPigeonFlight(nav, ...nav.stops);
  assert.ok(route, "ordinary right-angle street needs a flyable curved route");
});

test("overhanging building blocks a road even though the road graph is connected", () => {
  const input = fixture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 5), new THREE.MeshBasicMaterial());
  mesh.position.set(8, 4, 0); input.collisionRoot.add(mesh);
  const nav = createPigeonNavigation(input);
  assert.equal(planPigeonFlight(nav, ...nav.stops), null);
});

test("disconnected roads, construction plazas and obstructed landing patches are excluded", () => {
  const input = fixture();
  input.state.cells.c2.infrastructure = null;
  let nav = createPigeonNavigation(input);
  assert.equal(planPigeonFlight(nav, ...nav.stops), null);
  input.state.buildings.a.status = "construction";
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2, 3.5), new THREE.MeshBasicMaterial());
  mesh.position.set(16, 1, 0); input.collisionRoot.add(mesh);
  nav = createPigeonNavigation(input);
  assert.equal(nav.stops.length, 0);
  assert.equal(createPigeonCityLayer({ navigation: nav }).children.length, 0);
});

test("a single plaza retains a single resting flock without inventing a destination", () => {
  const input = fixture(); delete input.state.buildings.b;
  const layer = createPigeonCityLayer({ navigation: createPigeonNavigation(input) });
  layer.userData.update(0); layer.userData.update(90);
  assert.equal(layer.userData.getDiagnostics().state, "resting");
  assert.equal(layer.userData.getDiagnostics().destination, null);
});

test("actual generated plaza paving and lamps leave usable perches and an exit", () => {
  const input = fixture();
  for (const building of Object.values(input.state.buildings)) {
    const cell = input.grid.cells.find(c => c.id === building.footprintCells[0]);
    const design = createBuildingDesignDraft({ id: building.id, seed: "pigeon-plaza",
      site: { anchor_cell_id: cell.id, footprint: "1x1" },
      intent: { purpose: "plaza", site_layout: "open_space", open_space_type: "plaza" } });
    building.voxelDesign = design;
    const object = createBuildingDesignObject(design);
    object.position.set(cell.center.x, 0.04, cell.center.z); input.collisionRoot.add(object);
  }
  const nav = createPigeonNavigation(input);
  assert.equal(nav.stops.length, 2);
  assert.ok(planPigeonFlight(nav, ...nav.stops), JSON.stringify({stops:nav.stops,reason:nav.lastRejection}));
  assert.ok(nav.stops.every(s => Math.abs(s.y - 0.315) < 1e-5));
});

test("flight tracks have lateral and height spread with irregular departure spacing", () => {
  const nav = createPigeonNavigation(fixture());
  const route = planPigeonFlight(nav, ...nav.stops);
  const middle = route.tracks.map(track => track[Math.floor(track.length / 2)]);
  assert.ok(Math.max(...middle.map(p => p.z)) - Math.min(...middle.map(p => p.z)) > 0.3);
  assert.ok(Math.max(...middle.map(p => p.y)) - Math.min(...middle.map(p => p.y)) > 0.15);
  const gaps = route.delays.slice(1).map((d, i) => d - route.delays[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 0.02);
  for (let i = 0; i < 5; i++) {
    assert.ok(route.tracks[i][0].distanceTo(pigeonPerch(route.from, i)) < 1e-6);
    assert.ok(route.tracks[i].at(-1).distanceTo(pigeonPerch(route.to, i)) < 1e-6);
  }
  assert.notDeepEqual(nav.stops[0].perches, nav.stops[1].perches);
});

test("landing settles into individual headings without a position jump", () => {
  const nav = createPigeonNavigation(fixture());
  const layer = createPigeonCityLayer({ navigation: nav, planetRadius: 1e7 });
  let flew = false, touchdown = null, previous;
  for (let t = 0; t < 85; t += 0.02) {
    previous = layer.children.map(b => b.position.clone());
    layer.userData.update(t);
    const state = layer.userData.getDiagnostics().state;
    if (state === "flying") flew = true;
    if (flew && state === "resting") {
      touchdown ??= t;
      layer.children.forEach((b, i) => assert.ok(b.position.distanceTo(previous[i]) < 0.02));
      if (t - touchdown > 2) break;
    }
  }
  assert.ok(touchdown);
  const yaws = layer.children.map(b => new THREE.Euler().setFromQuaternion(b.quaternion, "YXZ").y);
  assert.ok(Math.max(...yaws) - Math.min(...yaws) > 0.5);
});
