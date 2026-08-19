import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { ARCANE_OFFICER_HIRE_COST_COINS, arcaneOfficerCapacity, hireArcaneOfficer, setArcaneOfficerStatus } from "../src/gameplay/arcane-officers.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "arcane-officers-test", grid: { columns, rows, cells } };
}

function stateWithWizardPopulation(wizards) {
  const state = createCityState(world(), { resources: { coins: 99999 } });
  state.gameplay.population.wizards.current = wizards;
  return state;
}

function context() {
  let id = 0;
  return { createId: (prefix) => `${prefix}-${++id}` };
}

test("arcane officer roster capacity scales with wizard population by ten", () => {
  assert.equal(arcaneOfficerCapacity(stateWithWizardPopulation(0)), 0);
  assert.equal(arcaneOfficerCapacity(stateWithWizardPopulation(9)), 0);
  assert.equal(arcaneOfficerCapacity(stateWithWizardPopulation(10)), 1);
  assert.equal(arcaneOfficerCapacity(stateWithWizardPopulation(25)), 2);
});

test("hiring an arcane officer deducts the system price and adds an available officer", () => {
  const state = stateWithWizardPopulation(20);
  const result = hireArcaneOfficer(state, { id: "officer-1", name: "Vesper", archetype: "investigation" }, context());
  assert.equal(result.accepted, true);
  assert.equal(result.cost, ARCANE_OFFICER_HIRE_COST_COINS);
  assert.equal(result.nextState.gameplay.resources.coins, 99999 - ARCANE_OFFICER_HIRE_COST_COINS);
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].status, "available");
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].investigation, 3);
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].archetype, "investigation");
  assert.deepEqual(result.nextState.gameplay.arcaneOfficers["officer-1"].specialties, ["investigation"]);
  assert.equal(state.gameplay.resources.coins, 99999, "source state stays untouched");
});

test("a caller cannot hire the veteran archetype directly", () => {
  const state = stateWithWizardPopulation(20);
  const blocked = hireArcaneOfficer(state, { id: "officer-veteran", archetype: "veteran" }, context());
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.error.code, "ARCANE_OFFICER_ARCHETYPE_NOT_ALLOWED");
  assert.equal(state.gameplay.resources.coins, 99999, "no coins are deducted for a rejected hire");
});

test("a veteran profile is only reachable through a trusted context profile", () => {
  const state = stateWithWizardPopulation(20);
  const ctx = { ...context(), profile: { archetype: "veteran", label: "Veteran", investigation: 3, containment: 3, concealment: 3, specialties: ["investigation", "containment", "concealment"] } };
  const result = hireArcaneOfficer(state, { id: "officer-1", name: "Cassian" }, ctx);
  assert.equal(result.accepted, true);
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].archetype, "veteran");
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].investigation, 3);
  assert.deepEqual(result.nextState.gameplay.arcaneOfficers["officer-1"].specialties, ["investigation", "containment", "concealment"]);
});

test("a caller cannot raise officer attributes through the hire input", () => {
  const state = stateWithWizardPopulation(20);
  const result = hireArcaneOfficer(state, {
    id: "officer-1",
    name: "Would-Be Elite",
    investigation: 5,
    containment: 5,
    concealment: 5,
    specialties: ["investigation", "containment", "concealment"]
  }, context());
  assert.equal(result.accepted, true);
  const officer = result.nextState.gameplay.arcaneOfficers["officer-1"];
  assert.equal(officer.investigation, 1, "trainee default, not the injected 5");
  assert.equal(officer.containment, 1);
  assert.equal(officer.concealment, 1);
  assert.deepEqual(officer.specialties, []);
});

test("a trusted context profile can define a system-approved officer", () => {
  const state = stateWithWizardPopulation(20);
  const ctx = { ...context(), profile: { label: "Field Marshal", investigation: 4, containment: 4, concealment: 4, specialties: ["investigation"] } };
  const result = hireArcaneOfficer(state, { id: "officer-1", name: "Mira" }, ctx);
  assert.equal(result.accepted, true);
  assert.equal(result.nextState.gameplay.arcaneOfficers["officer-1"].investigation, 4);
  assert.deepEqual(result.nextState.gameplay.arcaneOfficers["officer-1"].specialties, ["investigation"]);
});

test("a caller cannot bypass the system price", () => {
  const state = stateWithWizardPopulation(20);
  const free = hireArcaneOfficer(state, { id: "officer-free", cost: 0 }, context());
  const negative = hireArcaneOfficer(state, { id: "officer-negative", cost: -999 }, context());
  assert.equal(free.accepted, true);
  assert.equal(free.cost, ARCANE_OFFICER_HIRE_COST_COINS);
  assert.equal(free.nextState.gameplay.resources.coins, 99999 - ARCANE_OFFICER_HIRE_COST_COINS);
  assert.equal(negative.accepted, true);
  assert.equal(negative.cost, ARCANE_OFFICER_HIRE_COST_COINS);
  assert.equal(negative.nextState.gameplay.resources.coins, 99999 - ARCANE_OFFICER_HIRE_COST_COINS);
});

test("hiring is rejected when the roster is at capacity", () => {
  const state = stateWithWizardPopulation(10);
  const first = hireArcaneOfficer(state, { id: "officer-1" }, context());
  const second = hireArcaneOfficer(first.nextState, { id: "officer-2" }, context());
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.error.code, "ARCANE_OFFICER_CAPACITY_REACHED");
});

test("hiring is rejected without enough coins", () => {
  const state = stateWithWizardPopulation(10);
  state.gameplay.resources.coins = 10;
  const result = hireArcaneOfficer(state, { id: "officer-1" }, context());
  assert.equal(result.accepted, false);
  assert.equal(result.error.code, "INSUFFICIENT_COINS");
});

test("arcane officer status transitions through the helper", () => {
  const state = stateWithWizardPopulation(10);
  const hired = hireArcaneOfficer(state, { id: "officer-1" }, context());
  const assigned = setArcaneOfficerStatus(hired.nextState, "officer-1", "unavailable");
  assert.equal(assigned.ok, true);
  assert.equal(assigned.nextState.gameplay.arcaneOfficers["officer-1"].status, "unavailable");
  const missing = setArcaneOfficerStatus(hired.nextState, "officer-nope", "assigned");
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "ARCANE_OFFICER_NOT_FOUND");
});
