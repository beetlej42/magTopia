import assert from "node:assert/strict";
import test from "node:test";
import { runNonVisualAgentBuildScenario } from "../src/city/agent-district-simulation.js";
import { createBlankVoxelWorldContract } from "../src/city/voxel-world.js";
import { createCityState, canOccupyFootprint } from "../src/city/state.js";
import { solveConnection } from "../src/city/solver.js";

test("blank Agent Intent voxel world is explicit, deterministic and initially empty", () => {
  const first = createBlankVoxelWorldContract({ seed: "world-test" });
  const second = createBlankVoxelWorldContract({ seed: "world-test" });
  assert.deepEqual(first, second);
  assert.equal(first.grid.cells.length, 2500);
  assert.equal(first.grid.cellWorldSize, 4);
  assert.deepEqual(first.grid.cells[0].center, { x: -98, z: 98 });
  assert.deepEqual(first.grid.cells.at(-1).center, { x: 98, z: -98 });
  assert.ok(first.grid.cells.some((cell) => cell.bridgeRequired));
  assert.ok(first.grid.cells.some((cell) => cell.strictBuildable));
  assert.equal(first.diagnostics.emptyBuildingCount, 0);
  assert.equal(first.diagnostics.emptyRoadCount, 0);
});

test("water cannot host buildings and explicit water cells become reusable bridges", () => {
  const world = {
    mapId: "bridge-test",
    grid: {
      columns: 5,
      rows: 1,
      cellWorldSize: 4,
      cells: Array.from({ length: 5 }, (_, index) => {
        const column = index % 5;
        const row = 0;
        const water = column === 2 || column === 3;
        return { id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: -row * 4 }, buildable: !water, strictBuildable: !water, bridgeRequired: water, surface: { kind: water ? "water" : "terrain" } };
      })
    }
  };
  const state = createCityState(world, { resources: { coins: 9999, timber: 9999, stone: 9999 } });
  assert.equal(canOccupyFootprint(state, "cell-2-0", "1x1").ok, false);
  const first = solveConnection(state, ["cell-1-0"], { toCellId: "cell-4-0" }, "east", "cell-2-0");
  assert.equal(first.feasible, true);
  assert.deepEqual(first.bridgeCells, ["cell-2-0", "cell-3-0"]);
  first.bridgeCells.forEach((cellId) => { state.infrastructure[cellId] = { type: "bridge", cellId }; });
  first.roadCells.forEach((cellId) => { state.cells[cellId].infrastructure = "road"; });
  const reused = solveConnection(state, ["cell-1-0"], { toCellId: "cell-4-0" }, "east", "cell-2-0");
  assert.deepEqual(reused.bridgeCells, []);
  assert.deepEqual(reused.cost, { coins: 0, timber: 0, stone: 0 });
});

test("headless subagent scenario builds three diverse connected districts without vision", { timeout: 30_000 }, () => {
  const result = runNonVisualAgentBuildScenario({ seed: "agent-district-test" });
  assert.equal(result.report.usedMultimodalVision, false);
  assert.deepEqual(result.report.failures, []);
  assert.equal(result.report.success, true);
  assert.equal(result.report.diagnostics.buildingCount, 8);
  assert.equal(result.report.diagnostics.districtCount, 3);
  assert.ok(result.report.diagnostics.bridgeCellCount > 0);
  assert.ok(result.report.diagnostics.generationModes.includes("floor_stack"));
  assert.ok(result.report.diagnostics.generationModes.includes("urban_massing"));
  assert.ok(Object.values(result.report.diagnostics.checks).every(Boolean));
});
