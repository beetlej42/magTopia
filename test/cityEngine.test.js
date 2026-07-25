import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "engine-test", grid: { columns, rows, cells } };
}

function context() {
  let id = 0;
  return createEngineContext({ createId: (prefix) => `${prefix}-test-${++id}`, now: () => "2026-07-22T12:00:00.000Z" });
}

function proposal(lotId = "cell-3-3") {
  return {
    actor: "agent:test",
    site: { lotId, footprint: "1x1", entrance: "south" },
    program: { archetype: "starter_residence", purpose: "residential", name: "Test Cottage", attributes: { coinOutput: 9 } },
    design: { districtStyle: "willow_magic", patterns: [], prompt: "A compact magical cottage." }
  };
}

test("city engine is deterministic with injected ids and time", () => {
  const state = createCityState(world(), { resources: { coins: 999, timber: 999, stone: 999 } });
  const a = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  const b = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  assert.deepEqual(a, b);
  assert.equal(a.state.events[0].at, "2026-07-22T12:00:00.000Z");
  assert.equal(a.cityVersionAfter, 1);
});

test("production reservation freezes and failure refunds the exact cost", () => {
  const state = createCityState(world(), { resources: { coins: 999, timber: 999, stone: 999 } });
  const reserved = executeCityCommand(state, { type: "reserve_construction", proposal: proposal(), reservationId: "reservation-1" }, context());
  assert.equal(reserved.accepted, true);
  assert.equal(reserved.state.cells["cell-3-3"].reservation, "reservation-1");
  assert.deepEqual(reserved.state.resources, reserved.preview.resourcesAfter);

  const cancelled = executeCityCommand(reserved.state, { type: "cancel_construction_reservation", reservationId: "reservation-1", reason: "generation_failed" }, context());
  assert.equal(cancelled.accepted, true);
  assert.deepEqual(cancelled.state.resources, state.resources);
  assert.equal(cancelled.state.cells["cell-3-3"].reservation, null);
});

test("time advances recover resources according to city output", () => {
  const state = createCityState(world(), { resources: { coins: 999, timber: 999, stone: 999 } });
  const built = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  const before = built.state.resources.coins;
  const advanced = executeCityCommand(built.state, { type: "advance_time", hours: 24 }, context());
  assert.equal(advanced.accepted, true);
  assert.equal(advanced.dailyProduction.coins, 33);
  assert.equal(advanced.state.resources.coins, before + 33);
});

test("generic road endpoints support building-to-cell and node-to-building", () => {
  const initial = createCityState(world(), { resources: { coins: 9999, timber: 9999, stone: 9999 } });
  const built = executeCityCommand(initial, { type: "construct_building", proposal: proposal() }, context());
  const buildingId = built.building.id;
  const toCell = executeCityCommand(built.state, { type: "connect", from: { kind: "building", id: buildingId }, to: { kind: "cell", id: "cell-8-8" }, mode: "road" }, context());
  assert.equal(toCell.accepted, true);
  const toNode = executeCityCommand(toCell.state, { type: "connect", from: { kind: "node", id: "old_town_entry" }, to: { kind: "building", id: buildingId }, mode: "road" }, context());
  assert.equal(toNode.accepted, true);
});
