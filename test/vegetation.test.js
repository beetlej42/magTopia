import assert from "node:assert/strict";
import test from "node:test";
import { ISOMETRIC_DEVELOPMENT_PRESETS, getIsometricDevelopmentContract } from "../src/generators/isometricAssetRelief.js";
import { createMagicLondonVegetationLayer, createMagicLondonVegetationPlan } from "../src/generators/magicLondonVegetation.js";

function cell(id, column, row, vegetation) {
  return {
    id,
    column,
    row,
    center: { x: column * 4, z: row * 4 },
    groundCover: vegetation,
    ground: { surface: vegetation === "woodland" ? "grassDark" : vegetation === "meadow" ? "grassLight" : "grass", vegetation }
  };
}

test("development ground exposes distinct meadow, grove, and woodland attributes", () => {
  const contract = getIsometricDevelopmentContract(ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront);
  const counts = contract.grid.cells.reduce((result, gridCell) => {
    assert.ok(gridCell.ground?.surface, `${gridCell.id} should expose its ground surface`);
    assert.ok(gridCell.ground?.vegetation, `${gridCell.id} should expose its vegetation zone`);
    result[gridCell.ground.vegetation] = (result[gridCell.ground.vegetation] ?? 0) + 1;
    return result;
  }, {});
  assert.ok(counts.meadow > 0, "terrain should include open meadow");
  assert.ok(counts.grove > 0, "terrain should include sparse groves");
  assert.ok(counts.woodland > 0, "terrain should include dense woodland patches");
});

test("vegetation planning is deterministic and yields to every occupied city cell", () => {
  const cells = [
    cell("meadow-a", 0, 0, "meadow"),
    cell("meadow-b", 1, 0, "meadow"),
    cell("grove-a", 2, 0, "grove"),
    cell("grove-b", 3, 0, "grove"),
    cell("woodland-a", 4, 0, "woodland"),
    cell("woodland-b", 5, 0, "woodland"),
    cell("building", 6, 0, "woodland"),
    cell("road", 7, 0, "woodland"),
    cell("node", 8, 0, "grove"),
    cell("reserved-park", 9, 0, "grove")
  ];
  const cityState = { cells: Object.fromEntries(cells.map((entry) => [entry.id, { ...entry }])) };
  cityState.cells.building.occupancy = "building-1";
  cityState.cells.road.infrastructure = "road";
  cityState.cells.node.node = "old-town-entry";
  const input = {
    params: { seed: "vegetation-test" },
    grid: { cellWorldSize: 4, cells },
    cityState,
    reservedCellIds: new Set(["reserved-park"])
  };
  const first = createMagicLondonVegetationPlan(input);
  const second = createMagicLondonVegetationPlan(input);

  assert.deepEqual(first, second, "the same map seed must reproduce the same vegetation");
  assert.deepEqual(first.zoneCounts, { meadow: 2, grove: 2, woodland: 2 });
  assert.equal(first.skippedOccupied, 4);
  assert.equal(first.forestFloors.length, 2, "every open woodland cell should receive a forest-floor layer");
  assert.ok(first.grassTufts.length >= 6, "meadow and understorey should include modeled grass clumps");
  assert.equal(first.trees.every((tree) => tree.species === "oak" || tree.species === "lime"), true, "the art direction requires broadleaf trees rather than conifer forest");
  const occupiedIds = new Set(["building", "road", "node", "reserved-park"]);
  const placedIds = [...first.trees, ...first.shrubs, ...first.grassTufts, ...first.flowers, ...first.forestFloors].map((entry) => entry.cellId);
  assert.equal(placedIds.some((id) => occupiedIds.has(id)), false, "procedural vegetation must not enter occupied or authored cells");

  const layer = createMagicLondonVegetationLayer({ ...input, sampleGroundHeight: () => 0 });
  assert.equal(layer.userData.contract.zoneCounts.woodland, 2);
  assert.equal(layer.userData.contract.skippedOccupied, 4);
  assert.ok(layer.children.some((child) => child.isInstancedMesh), "vegetation should use batched low-poly geometry");
});
