import assert from "node:assert/strict";
import test from "node:test";
import { getCityViewerSceneKey, reuseCityBakedArtifacts } from "../src/render/cityViewerSnapshot.js";

function snapshot() {
  return {
    version: 7, turn: 2, resources: { coins: 100 },
    world: { grid: { columns: 50, rows: 50 }, constructionDatum: { height: 2 } },
    cells: { a: { occupancy: "house", infrastructure: null } },
    buildings: { house: { status: "construction", construction: { readyAtTurn: 3 } } },
    infrastructure: {}, nodes: { gateway: { stationLevel: 1 } },
    districts: {}, reservations: {},
    gameplay: { population: { muggles: { current: 10, capacity: 20 } }, cardState: { choice: { status: "pending" } } }
  };
}

test("economy, workflow and turn-only updates preserve the city scene", () => {
  const before = snapshot();
  const after = structuredClone(before);
  after.version += 1;
  after.turn += 1;
  after.resources.coins += 200;
  after.gameplay.cardState.choice.status = "selected";
  after.gameplay.population.muggles.capacity = 30;
  after.events = [{ type: "card_selected" }];
  after.economy = { lastIncome: { coins: 100 } };
  assert.equal(getCityViewerSceneKey(after), getCityViewerSceneKey(before));
});

test("map changes and construction completion invalidate the scene", () => {
  for (const change of [
    state => { state.buildings.house.status = "completed"; },
    state => { state.cells.a.infrastructure = "road"; },
    state => { state.nodes.gateway.stationLevel = 2; },
    state => { state.world.constructionDatum.height = 3; },
    state => { state.reservations.site = { lotId: "a" }; }
  ]) {
    const before = snapshot(), after = structuredClone(before);
    change(after);
    assert.notEqual(getCityViewerSceneKey(after), getCityViewerSceneKey(before));
  }
  assert.notEqual(getCityViewerSceneKey(snapshot(), [{ id: "asset", revision: 1 }]), getCityViewerSceneKey(snapshot(), [{ id: "asset", revision: 2 }]));
});

test("resident arrival cards preserve terrain and buildings for a separate street-life update", () => {
  const before = snapshot(), after = structuredClone(before);
  after.gameplay.population.muggles.current = 100;
  assert.equal(getCityViewerSceneKey(before), getCityViewerSceneKey(after));
});

test("JSON object ordering does not cause an unnecessary scene rebuild", () => {
  assert.equal(getCityViewerSceneKey({ cells: { b: { x: 1, z: 2 }, a: {} } }), getCityViewerSceneKey({ cells: { a: {}, b: { z: 2, x: 1 } } }));
});

test("unchanged meshes are reused while changed, removed or incompatible artifacts are invalidated", () => {
  const entry = id => ({ cityId: "city", buildingId: id, designRevision: 1, artifactVersion: 2, sha256: id });
  const oldManifest = ["same", "changed", "removed", "compiler"].map(entry);
  const oldArtifacts = Object.fromEntries(oldManifest.map(item => [item.buildingId, { mesh: item.buildingId }]));
  const newManifest = [entry("same"), { ...entry("changed"), sha256: "new" }, { ...entry("compiler"), artifactVersion: 3 }, entry("new")];
  const reused = reuseCityBakedArtifacts(newManifest, oldManifest, oldArtifacts);
  assert.deepEqual(Object.keys(reused), ["same"]);
  assert.equal(reused.same, oldArtifacts.same);
});
