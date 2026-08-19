import assert from "node:assert/strict";
import test from "node:test";
import {
  cellAtFlatPoint,
  createPlacementCandidateIndex,
  footprintCellsFor,
  footprintDimsForQuarterTurns,
  rotateEntrance,
  resolvePlacementTarget
} from "../src/ui/placementTargetResolver.js";

// Builds a small grid state with the same shape render-state returns. Occupied
// cells get an occupancy id, water cells are non-buildable, and `roads` mark
// road infrastructure cells.
function createTestState({ columns = 5, rows = 5, occupied = [], water = [], roads = [] } = {}) {
  const cells = {};
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const id = `cell-${column}-${row}`;
      const waterCell = water.includes(id);
      cells[id] = {
        id,
        column,
        row,
        center: {
          x: -columns * 4 / 2 + (column + 0.5) * 4,
          z: rows * 4 / 2 - (row + 0.5) * 4
        },
        buildable: !waterCell,
        strictBuildable: !waterCell,
        occupancy: null,
        infrastructure: roads.includes(id) ? "road" : null,
        reservation: null,
        node: null
      };
    }
  }
  occupied.forEach((id) => {
    if (cells[id]) cells[id].occupancy = "building-1";
  });
  return { cells, world: { grid: { columns, rows, cellWorldSize: 4 } }, infrastructure: {} };
}

function flatCenter(state, column, row) {
  const cell = state.cells[`cell-${column}-${row}`];
  return { flatX: cell.center.x, flatZ: cell.center.z };
}

test("cellAtFlatPoint maps the flat focus to the correct grid cell", () => {
  const state = createTestState();
  const center = cellAtFlatPoint(state, flatCenter(state, 2, 3).flatX, flatCenter(state, 2, 3).flatZ);
  assert.equal(center.cell.id, "cell-2-3");
  assert.equal(center.cell.column, 2);
  assert.equal(center.cell.row, 3);
});

test("cellAtFlatPoint returns null outside the grid bounds", () => {
  const state = createTestState({ columns: 4, rows: 4 });
  assert.equal(cellAtFlatPoint(state, 999, 999), null);
});

test("a road-facing empty lot resolves to a legal target with the road entrance", () => {
  const state = createTestState({ roads: ["cell-1-2"] });
  const target = resolvePlacementTarget(state, { ...flatCenter(state, 1, 1), footprint: "1x1", quarterTurns: 0 });
  assert.equal(target.hasTarget, true);
  assert.equal(target.isLegal, true);
  assert.equal(target.lotId, "cell-1-1");
  assert.equal(target.entrance, "south");
  assert.equal(target.reason, null);
});

test("an occupied lot is invalid with a contextual reason", () => {
  const state = createTestState({ occupied: ["cell-2-2"] });
  const target = resolvePlacementTarget(state, { ...flatCenter(state, 2, 2), footprint: "1x1" });
  assert.equal(target.isLegal, false);
  assert.ok(target.reason.includes("占用") || target.reason.includes("预留"), `reason: ${target.reason}`);
});

test("a water lot is invalid", () => {
  const state = createTestState({ water: ["cell-3-1"] });
  const target = resolvePlacementTarget(state, { ...flatCenter(state, 3, 1), footprint: "1x1" });
  assert.equal(target.isLegal, false);
  assert.ok(target.reason.includes("水域"), `reason: ${target.reason}`);
});

test("rotating a 1x2 footprint swaps to 2x1 around the anchor", () => {
  const state = createTestState();
  const flat = flatCenter(state, 1, 1);
  const before = resolvePlacementTarget(state, { ...flat, footprint: "1x2", quarterTurns: 0 });
  assert.deepEqual(before.footprintCells, ["cell-1-1", "cell-1-2"]);
  assert.deepEqual([before.footprintColumns, before.footprintRows], [1, 2]);
  const after = resolvePlacementTarget(state, { ...flat, footprint: "1x2", quarterTurns: 1 });
  assert.deepEqual(after.footprintCells, ["cell-1-1", "cell-2-1"]);
  assert.deepEqual([after.footprintColumns, after.footprintRows], [2, 1]);
  assert.equal(after.lotId, "cell-1-1", "the anchor lot stays at the FOV center");
});

test("entrance direction rotates clockwise with the building", () => {
  assert.equal(rotateEntrance("south", 0), "south");
  assert.equal(rotateEntrance("south", 1), "west");
  assert.equal(rotateEntrance("south", 2), "north");
  assert.equal(rotateEntrance("south", 3), "east");
  assert.equal(rotateEntrance("south", 4), "south");
  assert.equal(rotateEntrance("east", 1), "south");
});

test("candidate entrance hints drive the base entrance at default rotation", () => {
  const state = createTestState();
  const index = createPlacementCandidateIndex([
    { lotId: "cell-1-1", entranceDirections: ["north", "south"], roadFrontageDirections: ["north"] }
  ]);
  const target = resolvePlacementTarget(state, {
    ...flatCenter(state, 1, 1),
    footprint: "1x1",
    quarterTurns: 0,
    candidateIndex: index
  });
  assert.equal(target.entrance, "north", "the authoritative road-facing hint wins");
  assert.equal(target.candidate.lotId, "cell-1-1");
});

test("candidateHint marks whether the target lot was in the authoritative hint set", () => {
  const state = createTestState({ roads: ["cell-1-2", "cell-3-4"] });
  const index = createPlacementCandidateIndex([
    { lotId: "cell-1-1", entranceDirections: ["south"], roadFrontageDirections: ["south"] }
  ]);
  const hinted = resolvePlacementTarget(state, { ...flatCenter(state, 1, 1), footprint: "1x1", candidateIndex: index });
  assert.equal(hinted.candidateHint, true, "a lot in the hint set is flagged");
  assert.equal(hinted.isLegal, true);
  const notHinted = resolvePlacementTarget(state, { ...flatCenter(state, 3, 3), footprint: "1x1", candidateIndex: index });
  assert.equal(notHinted.candidateHint, false, "a locally legal lot outside the hint set stays placeable");
  assert.equal(notHinted.isLegal, true, "the local mirror is the eligibility check, not the limited hint list");
});

test("footprint dims helpers swap correctly for quarter turns", () => {
  assert.deepEqual(footprintDimsForQuarterTurns("1x2", 0), { columns: 1, rows: 2 });
  assert.deepEqual(footprintDimsForQuarterTurns("1x2", 1), { columns: 2, rows: 1 });
  assert.deepEqual(footprintDimsForQuarterTurns("1x2", 2), { columns: 1, rows: 2 });
  assert.deepEqual(footprintDimsForQuarterTurns("2x2", 1), { columns: 2, rows: 2 });
});

test("footprintCellsFor extends east (columns) and south (rows) from the anchor", () => {
  assert.deepEqual(footprintCellsFor(2, 2, 3, 4), ["cell-3-4", "cell-4-4", "cell-3-5", "cell-4-5"]);
});

test("resolving with no state returns no target", () => {
  const target = resolvePlacementTarget(null, { footprint: "1x1" });
  assert.equal(target.hasTarget, false);
  assert.equal(target.isLegal, false);
});
