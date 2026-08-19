import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { resolveTurn } from "../src/gameplay/simulation.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "simulation-test", grid: { columns, rows, cells } };
}

function cityWithBuildings(specs, options = {}) {
  const state = createCityState(world(), { resources: { coins: 99999 }, ...options });
  for (const spec of specs) {
    state.cells[spec.cellId].occupancy = spec.id;
    state.buildings[spec.id] = {
      id: spec.id,
      footprintCells: [spec.cellId],
      site: { lotId: spec.cellId, footprint: "1x1" },
      program: { name: spec.name, purpose: spec.purpose, intent: { magicLevel: spec.magicLevel, prominence: spec.prominence ?? "ordinary" } },
      status: "completed",
      ...(spec.exposure != null ? { exposure: spec.exposure } : {})
    };
  }
  return state;
}

function context() {
  let id = 0;
  return {
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => "2026-07-22T12:00:00.000Z",
    seed: "simulation-fixed-seed"
  };
}

test("legacy city state migrates coins into gameplay without losing balance on first resolve", () => {
  const legacy = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  delete legacy.gameplay;
  legacy.resources = { coins: 123, timber: 12, stone: 12 };
  const { nextState, facts, error } = resolveTurn(legacy, {}, context());
  assert.equal(error, null);
  assert.equal(nextState.gameplay.schemaVersion, 1);
  assert.equal(nextState.gameplay.resources.coins, 123 + 30);
  assert.equal(nextState.resources.coins, 123 + 30, "legacy coins follow the gameplay balance");
  assert.equal(legacy.resources.coins, 123, "source state stays untouched");
});

test("an already resolved turn cannot be resolved twice", () => {
  const state = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  const first = resolveTurn(state, {}, context());
  const second = resolveTurn(first.nextState, {}, context());
  assert.equal(first.facts.turn, 1);
  assert.equal(second.error.code, "TURN_ALREADY_RESOLVED");
  assert.equal(second.nextState, first.nextState, "resolving again changes nothing");
  assert.equal(second.facts, null);
  assert.equal(second.nextState.gameplay.resources.coins, 99999 + 30, "income was not granted twice");
});

test("resolving against a mismatched expectedTurn is rejected", () => {
  const state = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  const mismatched = resolveTurn(state, { expectedTurn: 5 }, context());
  assert.equal(mismatched.error.code, "TURN_MISMATCH");
  assert.equal(mismatched.facts, null);
  assert.equal(mismatched.nextState, state);
  const matched = resolveTurn(state, { expectedTurn: 0 }, context());
  assert.equal(matched.error, null);
  assert.equal(matched.facts.turn, 1);
});

test("a persisted state with schemaVersion and a legacy wardens placeholder migrates its roster", () => {
  const state = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  state.gameplay.schemaVersion = 1;
  delete state.gameplay.arcaneOfficers;
  state.gameplay.wardens = { "warden-1": { id: "warden-1", name: "Vesper", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 } };
  const { nextState } = resolveTurn(state, {}, context());
  assert.ok(nextState.gameplay.arcaneOfficers["warden-1"], "legacy warden roster survives into arcaneOfficers");
  assert.equal(nextState.gameplay.arcaneOfficers["warden-1"].investigation, 3);
  assert.ok(!("wardens" in nextState.gameplay), "legacy wardens field is removed after migration");
  assert.equal(nextState.gameplay.arcaneOfficers["warden-1"].status, "available");
});

test("one resolveTurn() settles income exactly once", () => {
  const state = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  const { nextState, facts } = resolveTurn(state, {}, context());
  assert.equal(facts.resourceDelta.coins, 24 + 6);
  assert.equal(facts.resourceDelta.magic, 1);
  assert.equal(nextState.gameplay.resources.coins, 99999 + 30);
  assert.equal(state.gameplay.resources.coins, 99999, "source state stays untouched");
  assert.equal(facts.turn, 1);
  assert.equal(nextState.turn, 1);
});

test("changing wall clock without resolveTurn() changes no resources", () => {
  const state = cityWithBuildings([
    { id: "b1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 }
  ]);
  const before = { ...state.gameplay.resources };
  state.turn = 999;
  assert.deepEqual(state.gameplay.resources, before);
  assert.equal(state.gameplay.population.muggles.current, 0);
});

test("same seed and same state produce identical TurnFacts", () => {
  const specs = [
    { id: "magic-a", cellId: "cell-5-5", name: "Lantern Tower", purpose: "residential", magicLevel: 0.6, prominence: "important", exposure: 80 },
    { id: "magic-b", cellId: "cell-9-5", name: "Alchemy Hall", purpose: "workshop", magicLevel: 0.5, prominence: "important", exposure: 78 }
  ];
  const stateA = cityWithBuildings(specs);
  const stateB = cityWithBuildings(specs);
  const a = resolveTurn(stateA, {}, context());
  const b = resolveTurn(stateB, {}, context());
  assert.deepEqual(a.facts, b.facts);
  assert.deepEqual(a.nextState.gameplay.incidents, b.nextState.gameplay.incidents);
  assert.ok(Array.isArray(a.facts.rolls));
});

test("exposure reaching the sealed threshold seals the building", () => {
  const state = cityWithBuildings([
    { id: "tower", cellId: "cell-5-5", name: "Loud Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark", exposure: 99 }
  ]);
  const { nextState, facts } = resolveTurn(state, {}, context());
  assert.equal(nextState.buildings.tower.status, "sealed");
  assert.ok(facts.sealedBuildings.includes("tower"));
  assert.ok(facts.exposureChanges.tower.sealed);
  assert.equal(nextState.buildings.tower.exposure, 100);
});

test("TurnFacts fully describe the state change", () => {
  const state = cityWithBuildings([
    { id: "n1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 },
    { id: "n2", cellId: "cell-4-3", name: "Shop", purpose: "market", magicLevel: 0.2 }
  ]);
  const { nextState, facts } = resolveTurn(state, {}, context());
  for (const key of ["turn", "wallClock", "resourceDelta", "populationDelta", "exposureChanges", "incidents", "assignments", "rolls", "outcomes", "sealedBuildings", "nextRisks"]) {
    assert.ok(key in facts, `facts.${key} is present`);
  }
  assert.ok(Object.isFrozen(facts));
  assert.ok(Object.isFrozen(facts.exposureChanges));
  assert.ok(facts.populationDelta.muggles.capacity > 0);
  assert.ok(facts.populationDelta.wizards.capacity > 0);
  assert.equal(nextState.gameplay.lastTurnFacts, facts);
  assert.deepEqual(facts.sealedBuildings, []);
});

test("full scenario: ordinary cover plus two high-magic towers resolves into facts", () => {
  const specs = [
    { id: "n1", cellId: "cell-3-3", name: "House", purpose: "residential", magicLevel: 0.2 },
    { id: "n2", cellId: "cell-4-3", name: "House", purpose: "residential", magicLevel: 0.2 },
    { id: "n3", cellId: "cell-3-4", name: "House", purpose: "residential", magicLevel: 0.2 },
    { id: "n4", cellId: "cell-4-4", name: "Shop", purpose: "market", magicLevel: 0.1 },
    { id: "n5", cellId: "cell-3-5", name: "Garden", purpose: "park", magicLevel: 0.1 },
    { id: "magic-1", cellId: "cell-9-9", name: "Lantern Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark", exposure: 60 },
    { id: "magic-2", cellId: "cell-9-7", name: "Alchemy Hall", purpose: "workshop", magicLevel: 0.85, prominence: "important", exposure: 55 }
  ];
  const state = cityWithBuildings(specs);
  const { nextState, facts } = resolveTurn(state, {}, context());
  assert.ok(facts.resourceDelta.coins > 24);
  assert.ok(facts.resourceDelta.magic > 0);
  assert.ok(facts.populationDelta.muggles.capacity > 0);
  assert.ok(facts.populationDelta.wizards.capacity > 0);
  assert.ok(facts.exposureChanges["magic-1"].to > facts.exposureChanges["magic-1"].from);
  assert.ok(facts.exposureChanges["magic-2"].to > facts.exposureChanges["magic-2"].from);
  assert.ok(Array.isArray(facts.incidents));
  assert.ok(facts.nextRisks.length > 0);
  assert.ok(Object.keys(nextState.gameplay.incidents).length === facts.incidents.length);
});
