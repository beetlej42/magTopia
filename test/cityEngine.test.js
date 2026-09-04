import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { calculateDailyIncome, createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { confirmBuildingDesign, createBuildingDesignDraft, createBuildingUpgradeDraft } from "../src/city/building-design.js";
import { blockPerimeterCellIds, districtBlockProgress } from "../src/city/district-layout.js";
import { districtBuildings, districtSpatialObservations, districtSuggestions } from "../src/city/district-guidance.js";
import { findCandidateParcels, previewConnectionBetween, previewConstruction } from "../src/city/solver.js";

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
    gameplayBuilding: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
    design: { districtStyle: "willow_magic", patterns: [], prompt: "A compact magical cottage." }
  };
}

test("city engine is deterministic with injected ids and time", () => {
  const state = createCityState(world(), { resources: { coins: 999 } });
  const a = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  const b = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  assert.deepEqual(a, b);
  assert.equal(a.state.events[0].at, "2026-07-22T12:00:00.000Z");
  assert.equal(a.cityVersionAfter, 1);
});

test("named districts persist simple intent while site search returns facts without scores", () => {
  const initial = createCityState(world(), { resources: { coins: 9999 } });
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
  assert.equal(candidates[0].context.adjacentRoad, true, "road-frontage candidates are returned first");
  assert.equal(candidates[0].anchor_cell_id, candidates[0].lotId);
  assert.equal(candidates[0].site_candidate_id, candidates[0].lotId);
  assert.ok(candidates[0].recommendedEntrance);
  assert.ok(candidates.every((candidate) => candidate.context.districtId === "district-lantern"));
  assert.ok(candidates.every((candidate) => !("score" in candidate) && !("scoreExplanation" in candidate)));
});

test("districts expose soft block-scale guidance without rejecting unusual shapes", () => {
  const state = createCityState(world(), { resources: { coins: 9999 } });
  const oneBlock = executeCityCommand(state, {
    type: "define_district",
    id: "district-small",
    name: "Small Block",
    purpose: "compact residential street",
    bounds: { minColumn: 2, maxColumn: 5, minRow: 2, maxRow: 9 },
    actor: "agent:test"
  }, context());
  assert.equal(oneBlock.accepted, true);
  assert.equal(oneBlock.district.layout.blockCount, 1);
  assert.deepEqual(oneBlock.district.layout.blockSize, { columns: 4, rows: 8 });
  assert.equal(oneBlock.district.layout.withinContract, true);
  assert.ok(oneBlock.district.layout.softWarnings.some((warning) => warning.code === "DISTRICT_NARROW_SHAPE"));

  const ringState = structuredClone(oneBlock.state);
  const block = oneBlock.district.layout.blocks[0];
  blockPerimeterCellIds(block, ringState).forEach((cellId) => {
    const cell = ringState.cells[cellId];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const outside = ringState.cells[`cell-${cell.column + dx}-${cell.row + dy}`];
      if (!outside || outside.column < block.minColumn || outside.column > block.maxColumn || outside.row < block.minRow || outside.row > block.maxRow) {
        if (outside) outside.infrastructure = "road";
      }
    }
  });
  const progress = districtBlockProgress(ringState, oneBlock.district);
  assert.equal(progress.blocks[0].perimeter.closed, true);
  assert.equal(progress.blocks[0].status, "ready_to_fill");
  const interiorCandidates = findCandidateParcels(ringState, {
    footprint: "1x1",
    bounds: oneBlock.district.bounds,
    districtId: oneBlock.district.id,
    layout: oneBlock.district.layout,
    blockProgress: progress,
    limit: 100
  });
  assert.ok(interiorCandidates.length > 0);
  const interior = interiorCandidates.filter((candidate) => candidate.context.blockRole === "interior");
  assert.ok(interior.length > 0);
  assert.ok(interior.every((candidate) => candidate.context.recommendedForBlockFill));

  const tooLarge = executeCityCommand(state, {
    type: "define_district",
    id: "district-large",
    name: "Too Large",
    purpose: "whole neighborhood",
    bounds: { minColumn: 1, maxColumn: 11, minRow: 1, maxRow: 9 },
    actor: "agent:test"
  }, context());
  assert.equal(tooLarge.accepted, true);
  assert.equal(tooLarge.district.layout.withinContract, true);
  assert.equal(tooLarge.district.layout.withinRecommendation, false);
  assert.ok(tooLarge.district.layout.softWarnings.some((warning) => warning.code === "DISTRICT_LARGE_SCALE"));
});

test("district observations surface linear frontage and shared-road opportunities as optional guidance", () => {
  const state = createCityState(world(), { resources: { coins: 9999 } });
  const defined = executeCityCommand(state, {
    type: "define_district",
    id: "district-linear",
    name: "Linear Row",
    purpose: "deliberate shopping street",
    bounds: { minColumn: 2, maxColumn: 7, minRow: 2, maxRow: 7 },
    actor: "agent:test"
  }, context());
  const district = defined.state.districts["district-linear"];
  for (let column = 2; column <= 7; column += 1) state.cells[`cell-${column}-1`].infrastructure = "road";
  for (let column = 2; column <= 4; column += 1) {
    const id = `building-${column}`;
    const cellId = `cell-${column}-2`;
    state.cells[cellId].occupancy = id;
    state.buildings[id] = { id, districtId: district.id, footprintCells: [cellId] };
  }
  const progress = districtBlockProgress(state, district);
  const observations = districtSpatialObservations(state, district, progress);
  const suggestions = districtSuggestions(state, district, observations);
  assert.equal(observations.linear_road_risk, true);
  assert.equal(observations.dominant_frontage_ratio, 1);
  assert.ok(observations.shared_boundary_opportunities.length > 0);
  assert.ok(suggestions.some((suggestion) => suggestion.code === "LINEAR_ROAD_RISK"));
  assert.ok(suggestions.every((suggestion) => suggestion.priority && suggestion.message));
});

test("district building membership includes existing footprints inside new bounds", () => {
  const state = createCityState(world(), { resources: { coins: 9999 } });
  state.cells["cell-4-4"].occupancy = "building-in-range";
  state.buildings["building-in-range"] = {
    id: "building-in-range",
    footprintCells: ["cell-4-4"],
    program: { name: "Existing Cottage", purpose: "residential" }
  };
  state.cells["cell-9-9"].occupancy = "building-outside";
  state.buildings["building-outside"] = {
    id: "building-outside",
    districtId: "district-other",
    footprintCells: ["cell-9-9"],
    program: { name: "Explicitly Assigned Building", purpose: "public" }
  };

  const buildings = districtBuildings(state, {
    id: "district-new",
    bounds: { minColumn: 2, maxColumn: 6, minRow: 2, maxRow: 6 }
  });
  assert.deepEqual(buildings.map((building) => building.id), ["building-in-range"]);
});

test("cancelling a district releases planning context without deleting city work", () => {
  const initial = createCityState(world(), { resources: { coins: 9999 } });
  const defined = executeCityCommand(initial, {
    type: "define_district",
    id: "district-cancelled",
    name: "Old Lantern Plan",
    purpose: "temporary residential cluster",
    bounds: { minColumn: 2, maxColumn: 7, minRow: 2, maxRow: 7 },
    actor: "agent:test"
  }, context());
  const stateWithWork = defined.state;
  stateWithWork.cells["cell-3-2"].infrastructure = "road";
  stateWithWork.cells["cell-3-3"].occupancy = "building-kept";
  stateWithWork.buildings["building-kept"] = {
    id: "building-kept",
    districtId: "district-cancelled",
    footprintCells: ["cell-3-3"],
    program: { name: "Kept Cottage", purpose: "residential" }
  };

  const cancelled = executeCityCommand(stateWithWork, {
    type: "cancel_district",
    districtId: "district-cancelled",
    reason: "move the next growth step elsewhere",
    actor: "agent:test"
  }, context());
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.state.districts["district-cancelled"].status, "cancelled");
  assert.equal(cancelled.state.districts["district-cancelled"].cancellationReason, "move the next growth step elsewhere");
  assert.equal(cancelled.preserved.buildings, 1);
  assert.equal(cancelled.preserved.roads, 1);
  assert.equal(cancelled.state.cells["cell-3-2"].infrastructure, "road");
  assert.equal(cancelled.state.cells["cell-3-3"].occupancy, "building-kept");
  assert.equal(cancelled.state.buildings["building-kept"].districtId, "district-cancelled");
  assert.equal(cancelled.state.events.at(-1).type, "district_cancelled");

  const preview = previewConstruction(cancelled.state, { ...proposal("cell-4-4"), districtId: "district-cancelled" });
  assert.equal(preview.feasible, false);
  assert.match(preview.errors[0], /is cancelled/);

  const repeated = executeCityCommand(cancelled.state, { type: "cancel_district", districtId: "district-cancelled" }, context());
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.code, "DISTRICT_ALREADY_CANCELLED");
});

test("production reservation freezes and failure refunds the exact cost", () => {
  const state = createCityState(world(), { resources: { coins: 999 } });
  const reserved = executeCityCommand(state, { type: "reserve_construction", proposal: proposal(), reservationId: "reservation-1" }, context());
  assert.equal(reserved.accepted, true);
  assert.equal(reserved.state.cells["cell-3-3"].reservation, "reservation-1");
  assert.deepEqual(reserved.state.resources, reserved.preview.resourcesAfter);

  const cancelled = executeCityCommand(reserved.state, { type: "cancel_construction_reservation", reservationId: "reservation-1", reason: "generation_failed" }, context());
  assert.equal(cancelled.accepted, true);
  assert.deepEqual(cancelled.state.resources, state.resources);
  assert.equal(cancelled.state.cells["cell-3-3"].reservation, null);
});

test("manual time advance is disabled; daily income is coins-only and settled by the gameplay resolve", () => {
  const state = createCityState(world(), { resources: { coins: 999 } });
  const built = executeCityCommand(state, { type: "construct_building", proposal: proposal() }, context());
  assert.equal(built.accepted, true);
  assert.deepEqual(calculateDailyIncome(built.state), { coins: 0, arcaneEnergy: 0 }, "the preview no longer runs a legacy category/base-income economy");

  const disabled = executeCityCommand(built.state, { type: "advance_time", hours: 24 }, context());
  assert.equal(disabled.accepted, false);
  assert.equal(disabled.code, "TIME_ADVANCE_DISABLED");
  assert.equal(disabled.state.resources.coins, built.state.resources.coins, "a rejected time advance changes nothing");
});

test("engine city mutations never advance the gameplay turn; only resolveTurn does", () => {
  const initial = createCityState(world(), { resources: { coins: 9999 } });
  const startTurn = initial.turn;
  const defined = executeCityCommand(initial, {
    type: "define_district",
    id: "district-no-turn",
    name: "No Turn District",
    purpose: "residential",
    bounds: { minColumn: 2, maxColumn: 8, minRow: 2, maxRow: 8 },
    actor: "agent:test"
  }, context());
  assert.equal(defined.accepted, true);
  assert.equal(defined.state.turn, startTurn, "defining a district keeps the turn");
  assert.equal(defined.state.version, startTurn + 1, "the version still advances for concurrency");

  const built = executeCityCommand(defined.state, { type: "construct_building", proposal: proposal("cell-3-3") }, context());
  assert.equal(built.accepted, true);
  assert.equal(built.state.turn, startTurn, "constructing a building keeps the turn");
  assert.equal(built.state.buildings[built.building.id].createdAtTurn, startTurn);

  const road = executeCityCommand(built.state, {
    type: "connect",
    from: { kind: "building", id: built.building.id },
    to: { kind: "node", id: "old_town_entry" },
    mode: "road",
    actor: "agent:test"
  }, context());
  assert.equal(road.accepted, true);
  assert.equal(road.state.turn, startTurn, "connecting a road keeps the turn");

  const cancelled = executeCityCommand(road.state, { type: "cancel_district", districtId: "district-no-turn", reason: "testing" }, context());
  assert.equal(cancelled.accepted, true);
  assert.equal(cancelled.state.turn, startTurn, "cancelling a district keeps the turn");

  const upgradeProposal = { ...proposal("cell-3-3"), voxelDesign: {
    generation: { sourceSpec: { floors: 2 } },
    source: { buildingId: built.building.id },
    id: "upgrade-x", revision: 2, specHash: "h", site: { lotId: "cell-3-3", footprint: "1x1" }, intent: { name: "Taller House", purpose: "residential", description: "x" }
  } };
  const upgraded = executeCityCommand(cancelled.state, { type: "upgrade_building", buildingId: built.building.id, voxelDesign: upgradeProposal.voxelDesign }, context());
  assert.equal(upgraded.accepted, true);
  assert.equal(upgraded.state.turn, startTurn, "upgrading a building keeps the turn");
});

test("generic road endpoints support building-to-cell and node-to-building", () => {
  const initial = createCityState(world(), { resources: { coins: 9999 } });
  const built = executeCityCommand(initial, { type: "construct_building", proposal: proposal() }, context());
  const buildingId = built.building.id;
  const toCell = executeCityCommand(built.state, { type: "connect", from: { kind: "building", id: buildingId }, to: { kind: "cell", id: "cell-8-8" }, mode: "road" }, context());
  assert.equal(toCell.accepted, true);
  const toNode = executeCityCommand(toCell.state, { type: "connect", from: { kind: "node", id: "old_town_entry" }, to: { kind: "building", id: buildingId }, mode: "road" }, context());
  assert.equal(toNode.accepted, true);
});

test("building road endpoints preserve the confirmed authoritative entrance cell", () => {
  const initial = createCityState(world(), { resources: { coins: 9999 } });
  const multiCell = proposal("cell-3-3");
  multiCell.site = { lotId: "cell-3-3", footprint: "2x2", entrance: "south", entranceCellId: "cell-3-5" };
  multiCell.gameplayBuilding = { units: [{ purpose: "residential", area: 4, magicRatio: 0 }] };
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
  const initial = createCityState(world(), { resources: { coins: 999 } });
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
