import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { confirmBuildingDesign, createBuildingDesignDraft, createBuildingUpgradeDraft } from "../src/city/building-design.js";
import { findCandidateParcels, previewConnectionBetween } from "../src/city/solver.js";

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

test("named districts persist simple intent while site search returns facts without scores", () => {
  const initial = createCityState(world(), { resources: { coins: 9999, timber: 9999, stone: 9999 } });
  const defined = executeCityCommand(initial, {
    type: "define_district",
    id: "district-lantern",
    name: "Lantern Row",
    purpose: "residential and shopping street",
    bounds: { minColumn: 2, maxColumn: 8, minRow: 2, maxRow: 8 },
    actor: "agent:test"
  }, context());
  assert.equal(defined.accepted, true);
  assert.equal(defined.state.districts["district-lantern"].name, "Lantern Row");
  const road = executeCityCommand(defined.state, {
    type: "connect",
    from: { kind: "cell", id: "cell-2-5" },
    to: { kind: "cell", id: "cell-8-5" },
    mode: "road",
    actor: "agent:test"
  }, context());
  assert.equal(road.accepted, true);
  const candidates = findCandidateParcels(road.state, {
    footprint: "1x1",
    districtId: "district-lantern",
    bounds: defined.district.bounds,
    limit: 100
  });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((candidate) => candidate.context.adjacentRoad));
  assert.ok(candidates.every((candidate) => candidate.context.districtId === "district-lantern"));
  assert.ok(candidates.every((candidate) => !("score" in candidate) && !("scoreExplanation" in candidate)));
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

test("building road endpoints preserve the confirmed authoritative entrance cell", () => {
  const initial = createCityState(world(), { resources: { coins: 9999, timber: 9999, stone: 9999 } });
  const multiCell = proposal("cell-3-3");
  multiCell.site = { lotId: "cell-3-3", footprint: "2x2", entrance: "south", entranceCellId: "cell-3-5" };
  const built = executeCityCommand(initial, { type: "construct_building", proposal: multiCell }, context());
  assert.equal(built.accepted, true);
  const building = built.building;
  building.voxelDesign = { ports: [{ type: "primary_entrance", frontageCellId: "cell-3-5" }] };
  const preview = previewConnectionBetween(
    built.state,
    { kind: "building", id: building.id },
    { kind: "node", id: "old_town_entry" }
  );
  assert.equal(preview.feasible, true);
  assert.equal(preview.entranceCellId, "cell-3-5");
  assert.equal(preview.route[0], "cell-3-5");
});

test("voxel buildings upgrade through immutable design lineage without replacing their identity", () => {
  const designContext = { id: "design-1", seed: "design-1", actor: "agent:test", now: () => "2026-07-22T12:00:00.000Z" };
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-3-3" },
    intent: { name: "Test Cottage", purpose: "residential", frontage: "residential" },
    requirements: { preferred_floors: 1 }
  }, designContext);
  const confirmed = confirmBuildingDesign(draft, { expected_revision: 1 }, designContext);
  const initialProposal = { ...proposal(), voxelDesign: confirmed };
  const initial = createCityState(world(), { resources: { coins: 999, timber: 999, stone: 999 } });
  const built = executeCityCommand(initial, { type: "construct_building", proposal: initialProposal }, context());
  const upgrade = createBuildingUpgradeDraft(built.building, { goal: { type: "add_floor", count: 1 } }, { ...designContext, id: "upgrade-1" });
  const lockedUpgrade = confirmBuildingDesign(upgrade, { expected_revision: 1 }, designContext);
  const result = executeCityCommand(built.state, {
    type: "upgrade_building",
    buildingId: built.building.id,
    voxelDesign: lockedUpgrade,
    actor: "agent:test"
  }, context());
  assert.equal(result.accepted, true);
  assert.equal(result.building.id, built.building.id);
  assert.equal(result.building.voxelDesign.generation.sourceSpec.floors, 2);
  assert.equal(result.building.designHistory[0].designId, "design-1");
});
