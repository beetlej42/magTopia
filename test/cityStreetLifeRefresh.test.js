import assert from "node:assert/strict";
import test from "node:test";
import { createAgentAcceptanceCity } from "../src/generators/agentAcceptanceCity.js";
import { createCityState } from "../src/city/state.js";
import { createServiceWorldContract } from "../apps/server/world.js";

test("street population refresh preserves static city layers and disposes the replaced pedestrians", () => {
  const state = createCityState(createServiceWorldContract({ columns: 10, rows: 10, terrainSubdivisions: 4 }), { mapSeed: "population-refresh" });
  const dryCells = Array.from({ length: 10 }, (_, row) => Object.values(state.cells).filter(cell => cell.row === row && cell.strictBuildable && !cell.node))
    .sort((a, b) => b.length - a.length)[0];
  for (const cell of dryCells) cell.infrastructure = "road";
  state.gameplay.population.muggles.current = 100;
  const city = createAgentAcceptanceCity({ cityState: state, seed: "population-refresh", worldColumns: 10, worldRows: 10 });
  const retained = [...city.children].filter(layer => layer.name !== "AgentAcceptanceStreetLife");
  const oldStreet = city.getObjectByName("AgentAcceptanceStreetLife");
  let disposed = 0;
  oldStreet.traverse(object => { object.geometry?.addEventListener("dispose", () => { disposed += 1; }); });
  const next = structuredClone(state);
  next.gameplay.population.muggles.current = 0;
  assert.equal(city.userData.refreshStreetLife(next), true);
  const newStreet = city.getObjectByName("AgentAcceptanceStreetLife");
  assert.notEqual(newStreet, oldStreet);
  assert.equal(oldStreet.parent, null);
  assert.ok(disposed > 0);
  assert.equal(city.userData.getStreetLifeDiagnostics().pedestrianCount, 0);
  assert.equal(city.userData.getStreetLifeDiagnostics().vehicleCount, 0);
  assert.ok(retained.every(layer => layer.parent === city));
  city.userData.update(10);
  assert.equal(city.userData.refreshStreetLife(next), false);
  assert.equal(city.getObjectByName("AgentAcceptanceStreetLife"), newStreet);
});
