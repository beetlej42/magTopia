import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { previewConstruction } from "../src/city/solver.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column, z: row }, buildable: true });
    }
  }
  return { mapId: "canonical-cost-test", grid: { columns, rows, cells } };
}

function context() {
  let sequence = 0;
  return createEngineContext({ createId: (prefix) => `${prefix}-canonical-${++sequence}`, now: () => "2026-08-22T12:00:00.000Z" });
}

function proposal(lotId = "cell-3-3", gameplayBuilding = { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] }) {
  return {
    actor: "agent:canonical-test",
    site: { lotId, footprint: "1x1", entrance: "south" },
    program: { archetype: "canonical-house", purpose: "residential", name: "Canonical House" },
    gameplayBuilding,
    design: { prompt: "A compact canonical house." }
  };
}

test("construct and preview use canonical cost exactly once and reject missing grammar", () => {
  const state = createCityState(world(), { resources: { coins: 600 } });
  const preview = previewConstruction(state, proposal());
  assert.equal(preview.feasible, true);
  assert.equal(preview.buildingCost.source, "canonical_functional_units");
  assert.equal(preview.cost.coins, 50);
  const built = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  assert.equal(built.accepted, true);
  assert.equal(built.state.resources.coins, 550);
  assert.equal(built.building.constructionCost.source, "canonical_functional_units");

  const missing = previewConstruction(state, proposal("cell-4-3", null));
  assert.equal(missing.feasible, false);
  assert.equal(missing.code, "GAMEPLAY_BUILDING_REQUIRED");
  assert.deepEqual(missing.resourcesAfter, state.resources);
  const rejected = executeCityCommand(state, { type: "construct_building", proposal: proposal("cell-4-3", null) }, context());
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, "GAMEPLAY_BUILDING_REQUIRED");
  assert.equal(rejected.state.version, state.version);
});

test("invalid canonical input is a deterministic preview rejection with no reservation side effect", () => {
  const state = createCityState(world(), { resources: { coins: 600 } });
  for (const [gameplayBuilding, code] of [
    [{ units: [{ purpose: "residential", area: 1, magicRatio: 0.63 }] }, "INVALID_MAGIC_RATIO"],
    [{ units: [{ purpose: "workshop", area: 1, magicRatio: 0 }] }, "INVALID_GAMEPLAY_PURPOSE"],
    [{ units: [{ purpose: "residential", area: 0, magicRatio: 0 }] }, "INVALID_GAMEPLAY_BUILDING"]
  ]) {
    const result = executeCityCommand(state, { type: "reserve_construction", proposal: proposal("cell-3-3", gameplayBuilding), reservationId: "bad-reservation" }, context());
    assert.equal(result.accepted, false);
    assert.equal(result.code, code);
    assert.deepEqual(result.state.resources, state.resources);
    assert.deepEqual(result.state.reservations, state.reservations);
    assert.equal(result.state.cells["cell-3-3"].reservation, null);
  }
});

test("discounted odd canonical cost rounds to an integer through resources and reservation refund", () => {
  const state = createCityState(world(), { resources: { coins: 600 } });
  const odd = proposal("cell-3-3", {
    floorSpecs: [{ purpose: "residential", magicRatio: 0 }, { purpose: "residential", magicRatio: 0 }]
  });
  const preview = previewConstruction(state, odd, { constructionDiscountRate: 0.5 });
  assert.equal(preview.feasible, true);
  assert.equal(preview.buildingCost.coins, 105);
  assert.equal(preview.cost.coins, 53);
  assert.equal(Number.isInteger(preview.cost.coins), true);
  assert.equal(Number.isInteger(preview.resourcesAfter.coins), true);
  const reserved = executeCityCommand(state, { type: "reserve_construction", proposal: odd, reservationId: "odd-reservation" }, context());
  assert.equal(reserved.accepted, true);
  assert.equal(reserved.reservation.frozenCost.coins, 105);
  const completed = executeCityCommand(reserved.state, { type: "complete_reserved_construction", reservationId: "odd-reservation" }, context());
  assert.equal(completed.accepted, true);
  assert.equal(completed.state.resources.coins, 495);
  const reservation = executeCityCommand(state, { type: "reserve_construction", proposal: odd, reservationId: "refund-reservation" }, context());
  const cancelled = executeCityCommand(reservation.state, { type: "cancel_construction_reservation", reservationId: "refund-reservation" }, context());
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.state.resources.coins, state.resources.coins);
});
