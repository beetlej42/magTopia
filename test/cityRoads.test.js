import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createCityWorkbench } from "../src/city/workbench.js";
import { createStarterCityWorkbench } from "../src/city/scenarios.js";
import { createRoadRenderPlan, getMagicLondonBaseTileContract } from "../src/generators/magicLondonBaseTiles.js";

function createTestWorld(columns = 45, rows = 45) {
  const cellWorldSize = 4;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        id: `cell-${column}-${row}`,
        column,
        row,
        center: {
          x: (column - columns / 2) * cellWorldSize,
          z: (rows / 2 - row) * cellWorldSize
        },
        buildable: true
      });
    }
  }
  return {
    mapId: "road-test-world",
    grid: { columns, rows, cells, cellWorldSize }
  };
}

function createWorkbenchWithBuildings(world, definitions) {
  const state = createCityState(world, { resources: { coins: 9999, timber: 9999, stone: 9999 } });
  definitions.forEach(({ id, column, row, entrance }) => {
    const cellId = `cell-${column}-${row}`;
    state.cells[cellId].occupancy = id;
    state.buildings[id] = {
      id,
      footprintCells: [cellId],
      site: { lotId: cellId, footprint: "1x1", entrance },
      program: { name: id }
    };
  });
  return createCityWorkbench(state);
}

test("starter district connects every visible entrance and generates a T-junction", () => {
  const world = createTestWorld();
  const { workbench, constructionResults, connectionResults } = createStarterCityWorkbench(world);
  const state = workbench.getState();

  assert.equal(constructionResults.filter((result) => result.accepted).length, 3);
  assert.equal(connectionResults.filter((result) => result.accepted).length, 2);

  const frontageIds = Object.values(state.buildings).map((building) => {
    assert.equal(building.site.entrance, "north");
    const cell = state.cells[building.footprintCells[0]];
    return `cell-${cell.column}-${cell.row - 1}`;
  });
  frontageIds.forEach((cellId) => assert.equal(state.cells[cellId].infrastructure, "road", `${cellId} should connect to its building door`));

  const occupied = new Set(Object.values(state.buildings).flatMap((building) => building.footprintCells));
  connectionResults.forEach((result) => result.plan.route.forEach((cellId) => assert.equal(occupied.has(cellId), false, `road route crossed occupied ${cellId}`)));

  const renderPlan = createRoadRenderPlan(state, world.grid);
  const tee = renderPlan.find((entry) => entry.topology === "tee");
  assert.ok(tee, "expected the reused main street to produce a T-junction");
  assert.deepEqual(tee.ports, ["east", "south", "west"]);
});

test("public road connections generate corners and crossroads", () => {
  const world = createTestWorld(11, 11);
  const workbench = createWorkbenchWithBuildings(world, [
    { id: "west", column: 1, row: 5, entrance: "east" },
    { id: "east", column: 9, row: 5, entrance: "west" },
    { id: "north", column: 5, row: 1, entrance: "south" },
    { id: "south", column: 5, row: 9, entrance: "north" }
  ]);

  assert.equal(workbench.connectRoad({ fromBuildingId: "west", toBuildingId: "east" }).accepted, true);
  assert.equal(workbench.connectRoad({ fromBuildingId: "north", toBuildingId: "south" }).accepted, true);

  const renderPlan = createRoadRenderPlan(workbench.getState(), world.grid);
  const cross = renderPlan.find((entry) => entry.topology === "cross");
  assert.deepEqual(cross?.ports, ["north", "east", "south", "west"]);

  const cornerWorkbench = createWorkbenchWithBuildings(world, [
    { id: "corner-start", column: 1, row: 1, entrance: "east" },
    { id: "corner-end", column: 5, row: 5, entrance: "west" }
  ]);
  assert.equal(cornerWorkbench.connectRoad({ fromBuildingId: "corner-start", toBuildingId: "corner-end" }).accepted, true);
  assert.ok(createRoadRenderPlan(cornerWorkbench.getState(), world.grid).some((entry) => entry.topology === "corner"));
});

test("road connections reject self-links and route around existing infrastructure", () => {
  const world = createTestWorld(9, 9);
  const workbench = createWorkbenchWithBuildings(world, [
    { id: "left", column: 1, row: 4, entrance: "east" },
    { id: "right", column: 7, row: 4, entrance: "west" }
  ]);

  const selfLink = workbench.connectRoad({ fromBuildingId: "left", toBuildingId: "left" });
  assert.equal(selfLink.accepted, false);
  assert.match(selfLink.errors[0], /different buildings/);

  const state = workbench.getState();
  state.cells["cell-4-4"].infrastructure = "park";
  const protectedWorkbench = createCityWorkbench(state);
  const connection = protectedWorkbench.connectRoad({ fromBuildingId: "left", toBuildingId: "right" });
  assert.equal(connection.accepted, true);
  assert.equal(connection.plan.route.includes("cell-4-4"), false);
  assert.equal(protectedWorkbench.getState().cells["cell-4-4"].infrastructure, "park");
});

test("an isolated road uses the house-facing sides as sidewalks", () => {
  const world = createTestWorld(7, 7);
  const workbench = createWorkbenchWithBuildings(world, [
    { id: "north-house", column: 3, row: 1, entrance: "south" },
    { id: "south-house", column: 3, row: 3, entrance: "north" }
  ]);
  const connection = workbench.connectRoad({ fromBuildingId: "north-house", toBuildingId: "south-house" });
  assert.deepEqual(connection.plan.route, ["cell-3-2"]);

  const [road] = createRoadRenderPlan(workbench.getState(), world.grid);
  assert.deepEqual(road.ports, ["east", "west"]);
  assert.equal(road.topology, "straight");
});

test("base tile contract advertises road ends", () => {
  assert.ok(getMagicLondonBaseTileContract().tileFamilies.road.includes("end"));
});
