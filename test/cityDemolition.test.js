import assert from "node:assert/strict";
import test from "node:test";
import { previewDemolition } from "../src/city/demolition.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { createCityState } from "../src/city/state.js";
import { resolvePublicServiceBaselineTurn } from "../src/gameplay/simulation.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
    }
  }
  return { mapId: "demolition-test", grid: { columns, rows, cells } };
}

function context() {
  let id = 0;
  return createEngineContext({
    createId: (prefix) => `${prefix}-demolition-${++id}`,
    now: () => "2026-09-20T08:00:00.000Z"
  });
}

function proposal() {
  return {
    actor: "agent:test",
    site: { lotId: "cell-3-3", footprint: "1x1", entrance: "south" },
    program: { archetype: "starter_residence", purpose: "residential", name: "Crooked Cottage" },
    gameplayBuilding: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
    design: { districtStyle: "london_common", patterns: [], prompt: "A compact cottage." }
  };
}

test("ordinary building demolition releases occupancy, preserves roads, and refunds half its base cost", () => {
  const initial = createCityState(world(), { resources: { coins: 600 } });
  const built = executeCityCommand(initial, { type: "construct_building", proposal: proposal() }, context());
  assert.equal(built.accepted, true);
  const buildingId = built.building.id;
  built.state.cells["cell-3-2"].infrastructure = "road";

  const preview = previewDemolition(built.state, { target: { kind: "building", building_id: buildingId } });
  assert.equal(preview.feasible, true);
  assert.deepEqual(preview.baseCost, { coins: 50 });
  assert.deepEqual(preview.refund, { coins: 25 });

  const result = executeCityCommand(built.state, {
    type: "demolish",
    target: { kind: "building", building_id: buildingId },
    reason: "clear the station avenue",
    actor: "agent:test"
  }, context());
  assert.equal(result.accepted, true);
  assert.equal(result.state.buildings[buildingId], undefined);
  assert.equal(result.state.cells["cell-3-3"].occupancy, null);
  assert.equal(result.state.cells["cell-3-2"].infrastructure, "road", "connected roads are preserved");
  assert.equal(result.state.resources.coins, built.state.resources.coins + 25);
  assert.equal(result.state.events.at(-1).type, "building_demolished");
  assert.equal(result.state.events.at(-1).reason, "clear the station avenue");

  const settled = resolvePublicServiceBaselineTurn(result.state, {}, { now: () => "2026-09-20T09:00:00.000Z" });
  assert.equal(settled.error, null);
  assert.equal(settled.facts.demolitions.length, 1);
  assert.equal(settled.facts.demolitions[0].buildingId, buildingId);
  assert.equal(settled.facts.demolitions[0].refund.coins, 25);
});

test("active incidents and special structures protect a building from demolition", () => {
  const initial = createCityState(world(), { resources: { coins: 600 } });
  const built = executeCityCommand(initial, { type: "construct_building", proposal: proposal() }, context());
  const buildingId = built.building.id;
  built.state.gameplay.incidents["incident-1"] = { id: "incident-1", buildingId, status: "open" };
  assert.equal(previewDemolition(built.state, { target: { kind: "building", building_id: buildingId } }).code, "BUILDING_HAS_ACTIVE_INCIDENTS");

  delete built.state.gameplay.incidents["incident-1"];
  built.state.buildings[buildingId].specialStructure = { cardId: "ministry-of-magic" };
  assert.equal(previewDemolition(built.state, { target: { kind: "building", building_id: buildingId } }).code, "SPECIAL_BUILDING_PROTECTED");
});

test("road-cell demolition removes roads and bridges atomically and refunds the aggregate cost", () => {
  const state = createCityState(world(), { resources: { coins: 600 } });
  state.cells["cell-2-2"].infrastructure = "road";
  state.infrastructure["cell-2-3"] = { type: "bridge", cellId: "cell-2-3" };

  const result = executeCityCommand(state, {
    type: "demolish",
    target: { kind: "road_cells", cell_ids: ["cell-2-2", "cell-2-3"] },
    actor: "agent:test"
  }, context());
  assert.equal(result.accepted, true);
  assert.equal(result.state.cells["cell-2-2"].infrastructure, null);
  assert.equal(result.state.infrastructure["cell-2-3"], undefined);
  assert.equal(result.refund.coins, 8, "(2 + 15) * 50% is rounded down once");
  assert.equal(result.state.resources.coins, 608);
  assert.equal(result.state.events.at(-1).type, "road_demolished");
});

test("railway, node, reservation, and non-road cells cannot be demolished as roads", () => {
  const state = createCityState(world(), { resources: { coins: 600 } });
  const gatewayCellId = state.nodes.old_town_entry.cellId;
  assert.equal(previewDemolition(state, { target: { kind: "road_cells", cell_ids: [gatewayCellId] } }).code, "ROAD_CELL_PROTECTED");
  assert.equal(previewDemolition(state, { target: { kind: "road_cells", cell_ids: ["cell-2-2"] } }).code, "ROAD_CELL_NOT_DEMOLISHABLE");
  state.cells["cell-2-2"].infrastructure = "road";
  state.cells["cell-2-2"].reservation = "reservation-1";
  assert.equal(previewDemolition(state, { target: { kind: "road_cells", cell_ids: ["cell-2-2"] } }).code, "ROAD_CELL_PROTECTED");
});
