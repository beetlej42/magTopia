import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { hireWarden, setWardenStatus, wardenCapacity } from "../src/gameplay/wardens.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "wardens-test", grid: { columns, rows, cells } };
}

function stateWithWizardPopulation(wizards) {
  const state = createCityState(world(), { resources: { coins: 99999, timber: 99999, stone: 99999 } });
  state.gameplay.population.wizards.current = wizards;
  return state;
}

function context() {
  let id = 0;
  return { createId: (prefix) => `${prefix}-${++id}` };
}

test("warden roster capacity scales with wizard population by ten", () => {
  assert.equal(wardenCapacity(stateWithWizardPopulation(0)), 0);
  assert.equal(wardenCapacity(stateWithWizardPopulation(9)), 0);
  assert.equal(wardenCapacity(stateWithWizardPopulation(10)), 1);
  assert.equal(wardenCapacity(stateWithWizardPopulation(25)), 2);
});

test("hiring a warden deducts coins and adds an available warden", () => {
  const state = stateWithWizardPopulation(20);
  const result = hireWarden(state, { id: "warden-1", name: "Vesper", investigation: 4, specialties: ["investigation"] }, context());
  assert.equal(result.accepted, true);
  assert.equal(result.nextState.gameplay.resources.coins, 99999 - 50);
  assert.equal(result.nextState.gameplay.wardens["warden-1"].status, "available");
  assert.equal(result.nextState.gameplay.wardens["warden-1"].investigation, 4);
  assert.deepEqual(result.nextState.gameplay.wardens["warden-1"].specialties, ["investigation"]);
  assert.equal(state.gameplay.resources.coins, 99999, "source state stays untouched");
});

test("hiring is rejected when the roster is at capacity", () => {
  const state = stateWithWizardPopulation(10);
  const first = hireWarden(state, { id: "warden-1" }, context());
  const second = hireWarden(first.nextState, { id: "warden-2" }, context());
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.error.code, "WARDEN_CAPACITY_REACHED");
});

test("hiring is rejected without enough coins", () => {
  const state = stateWithWizardPopulation(10);
  state.gameplay.resources.coins = 10;
  const result = hireWarden(state, { id: "warden-1" }, context());
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "INSUFFICIENT_COINS");
});

test("warden status transitions through the helper", () => {
  const state = stateWithWizardPopulation(10);
  const hired = hireWarden(state, { id: "warden-1" }, context());
  const assigned = setWardenStatus(hired.nextState, "warden-1", "unavailable");
  assert.equal(assigned.ok, true);
  assert.equal(assigned.nextState.gameplay.wardens["warden-1"].status, "unavailable");
  const missing = setWardenStatus(hired.nextState, "warden-nope", "assigned");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "WARDEN_NOT_FOUND");
});
