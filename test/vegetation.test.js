import assert from "node:assert/strict";
import test from "node:test";
import { ISOMETRIC_DEVELOPMENT_PRESETS, getIsometricDevelopmentContract } from "../src/generators/isometricAssetRelief.js";
import { createMagicLondonVegetationLayer, createMagicLondonVegetationPlan } from "../src/generators/magicLondonVegetation.js";

const SUPPORTED_SPECIES = ["oak", "lime", "elm", "poplar"];

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

function makeGrid(cells) {
  return { cellWorldSize: 4, cells };
}

function stateFor(cells) {
  return { cells: Object.fromEntries(cells.map((entry) => [entry.id, { ...entry }])) };
}

function findZoneGroup(plan, zone) {
  for (const cluster of plan.clusters) {
    const match = cluster.zoneGroups.find((group) => group.zone === zone);
    if (match) return match;
  }
  return undefined;
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
  const cityState = stateFor(cells);
  cityState.cells.building.occupancy = "building-1";
  cityState.cells.road.infrastructure = "road";
  cityState.cells.node.node = "old-town-entry";
  const input = {
    params: { seed: "vegetation-test" },
    grid: makeGrid(cells),
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
  assert.equal(first.trees.every((tree) => SUPPORTED_SPECIES.includes(tree.species)), true, "the art direction requires broadleaf trees rather than conifer forest");
  const occupiedIds = new Set(["building", "road", "node", "reserved-park"]);
  const placedIds = [...first.trees, ...first.shrubs, ...first.grassTufts, ...first.flowers, ...first.forestFloors].map((entry) => entry.cellId);
  assert.equal(placedIds.some((id) => occupiedIds.has(id)), false, "procedural vegetation must not enter occupied or authored cells");

  const layer = createMagicLondonVegetationLayer({ ...input, sampleGroundHeight: () => 0 });
  assert.equal(layer.userData.contract.zoneCounts.woodland, 2);
  assert.equal(layer.userData.contract.skippedOccupied, 4);
  assert.ok(layer.children.some((child) => child.isInstancedMesh), "vegetation should use batched low-poly geometry");
});

test("adjacent open cells form shared cross-cell clusters with deterministic metadata", () => {
  const clusterCells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      clusterCells.push(cell(`grove-${column}-${row}`, column, row, "grove"));
    }
  }
  const input = {
    params: { seed: "cluster-test" },
    grid: makeGrid(clusterCells),
    cityState: stateFor(clusterCells),
    reservedCellIds: new Set()
  };
  const plan = createMagicLondonVegetationPlan(input);

  assert.equal(plan.clusters.length, 1, "the nine cells belong to one shared cluster");
  const cluster = plan.clusters[0];
  assert.equal(cluster.cellIds.length, 9, "every open cluster cell should participate in the shared group");
  assert.ok(Number.isFinite(cluster.coreX) && Number.isFinite(cluster.coreZ), "cluster exposes its deterministic core");
  assert.ok(cluster.radius > 0, "cluster exposes its influence radius");
  assert.equal(cluster.zoneGroups.length, 1, "a single-zone bucket resolves one zone group");
  assert.equal(cluster.zoneGroups[0].zone, "grove");
  assert.equal(cluster.zoneGroups[0].cellIds.length, 9);
  assert.ok(cluster.zoneGroups[0].density > 0, "zone group exposes deterministic core density");

  const placedCellIds = new Set(plan.trees.map((tree) => tree.cellId));
  assert.ok([...placedCellIds].every((id) => cluster.cellIds.includes(id)), "cluster trees stay within the shared cluster cells");
  assert.ok(plan.trees.length <= plan.grassTufts.length || plan.trees.length === 0, "cluster area keeps negative space over uniform tree fill");
});

test("meadow stays open at ground level while gaining richer low vegetation", () => {
  const meadowCells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      meadowCells.push(cell(`meadow-${column}-${row}`, column, row, "meadow"));
    }
  }
  const input = {
    params: { seed: "meadow-open-test" },
    grid: makeGrid(meadowCells),
    cityState: stateFor(meadowCells),
    reservedCellIds: new Set()
  };
  const plan = createMagicLondonVegetationPlan(input);
  const cluster = plan.clusters[0];
  const meadowGroup = cluster.zoneGroups.find((group) => group.zone === "meadow");

  assert.equal(cluster.cellIds.length, 9);
  assert.ok(plan.grassTufts.length >= meadowCells.length, "meadow is richer with grass at ground level");
  assert.ok(plan.flowers.length > 0, "meadow includes sparse flower scatter");
  assert.ok(meadowGroup.treeCount <= 1, "meadow edge trees stay rare so the meadow reads open");
});

test("woodland supports a dominant-to-small tree hierarchy within a group", () => {
  const woodlandCells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      woodlandCells.push(cell(`woodland-${column}-${row}`, column, row, "woodland"));
    }
  }
  const input = {
    params: { seed: "hierarchy-test" },
    grid: makeGrid(woodlandCells),
    cityState: stateFor(woodlandCells),
    reservedCellIds: new Set()
  };
  const plan = createMagicLondonVegetationPlan(input);
  const cluster = plan.clusters[0];
  const woodlandGroup = cluster.zoneGroups.find((group) => group.zone === "woodland");

  assert.equal(woodlandGroup.zone, "woodland");
  assert.ok(woodlandGroup.treeCount >= 2, "woodland groups should compose multiple trees");
  const scales = woodlandGroup.ranked.map((tree) => tree.scale);
  assert.ok(woodlandGroup.ranked.some((tree) => tree.sizeClass === "dominant"), "woodland group includes a dominant tree");
  assert.ok(woodlandGroup.ranked.some((tree) => tree.sizeClass === "small"), "woodland group includes supporting small trees");
  assert.ok((Math.max(...scales) / Math.min(...scales)) > 1.25, "tree scale hierarchy is clearly composed, not uniform");
});

test("woodland reads denser than grove on equivalent cluster density", () => {
  const groveCells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      groveCells.push(cell(`grove-${column}-${row}`, column, row, "grove"));
    }
  }
  const woodlandCells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      woodlandCells.push(cell(`woodland-${column}-${row}`, column + 12, row, "woodland"));
    }
  }
  const input = {
    params: { seed: "density-gradient-test" },
    grid: makeGrid([...groveCells, ...woodlandCells]),
    cityState: stateFor([...groveCells, ...woodlandCells]),
    reservedCellIds: new Set()
  };
  const plan = createMagicLondonVegetationPlan(input);
  const grove = findZoneGroup(plan, "grove");
  const woodland = findZoneGroup(plan, "woodland");

  assert.ok(grove && woodland, "both zones should resolve compact clusters");
  assert.ok(woodland.treeCount > grove.treeCount, "woodland should out-densify grove given comparable spacing");
});

test("a mixed-zone cluster applies each zone's own density rule without cross-contamination", () => {
  const cells = [
    cell("meadow-0-0", 0, 0, "meadow"),
    cell("meadow-1-0", 1, 0, "meadow"),
    cell("meadow-2-0", 2, 0, "meadow"),
    cell("woodland-0-1", 0, 1, "woodland"),
    cell("woodland-1-1", 1, 1, "woodland"),
    cell("woodland-2-1", 2, 1, "woodland"),
    cell("meadow-0-2", 0, 2, "meadow"),
    cell("meadow-1-2", 1, 2, "meadow"),
    cell("meadow-2-2", 2, 2, "meadow")
  ];
  const input = {
    params: { seed: "mixed-zone-test" },
    grid: makeGrid(cells),
    cityState: stateFor(cells),
    reservedCellIds: new Set()
  };
  const plan = createMagicLondonVegetationPlan(input);
  const cluster = plan.clusters[0];

  const meadowGroup = cluster.zoneGroups.find((group) => group.zone === "meadow");
  const woodlandGroup = cluster.zoneGroups.find((group) => group.zone === "woodland");
  assert.ok(meadowGroup && woodlandGroup, "the mixed bucket should resolve separate zone groups");
  assert.ok(cluster.cellIds.length === 9, "every open cell remains part of the shared cluster");

  assert.ok(meadowGroup.treeCount <= 1, "meadow cells must not inherit woodland/grove high-density tree rules");
  assert.ok(woodlandGroup.treeCount >= meadowGroup.treeCount, "woodland must not be diluted by meadow");
  assert.ok(woodlandGroup.treeCount >= 2, "woodland keeps a composed multi-tree group");

  const meadowTreeCells = new Set(meadowGroup.ranked.map((tree) => tree.cellId));
  const woodlandTreeCells = new Set(woodlandGroup.ranked.map((tree) => tree.cellId));
  const meadowCellIds = new Set(cells.filter((entry) => entry.ground.vegetation === "meadow").map((entry) => entry.id));
  const woodlandCellIds = new Set(cells.filter((entry) => entry.ground.vegetation === "woodland").map((entry) => entry.id));
  assert.ok([...woodlandTreeCells].every((id) => woodlandCellIds.has(id)), "woodland trees never land on meadow cells");
  assert.ok([...meadowTreeCells].every((id) => meadowCellIds.has(id)), "meadow trees never land on woodland cells");

  const scales = woodlandGroup.ranked.map((tree) => tree.scale);
  assert.ok(woodlandGroup.ranked.some((tree) => tree.sizeClass === "dominant"), "woodland hierarchy is preserved within a mixed bucket");
  assert.ok((Math.max(...scales) / Math.min(...scales)) > 1.25, "woodland scale hierarchy is not diluted by meadow");
});

test("supports the broadleaf species and forest-floor contracts without new assets", () => {
  const cells = [
    cell("meadow-a", 0, 0, "meadow"),
    cell("grove-a", 3, 0, "grove"),
    cell("woodland-a", 6, 0, "woodland")
  ];
  const input = {
    params: { seed: "species-contract-test" },
    grid: makeGrid(cells),
    cityState: stateFor(cells),
    reservedCellIds: new Set()
  };
  const layer = createMagicLondonVegetationLayer({ ...input, sampleGroundHeight: () => 0 });
  const contract = layer.userData.contract;

  for (const species of Object.keys(contract.species)) {
    assert.ok(SUPPORTED_SPECIES.includes(species), `${species} should be a supported broadleaf archetype`);
  }
  assert.ok(contract.rendered.trees >= 0);
  assert.ok(contract.rendered.forestFloors >= 0);
  assert.ok(layer.children.some((child) => child.isInstancedMesh), "bulk vegetation should use the InstancedMesh rendering path");
});

test("vegetation reacts when a previously open cell becomes occupied", () => {
  const cells = [
    cell("grove-0", 0, 0, "grove"),
    cell("grove-1", 1, 0, "grove"),
    cell("grove-2", 2, 0, "grove")
  ];
  const cityState = stateFor(cells);
  const input = {
    params: { seed: "occupancy-reaction-test" },
    grid: makeGrid(cells),
    cityState,
    reservedCellIds: new Set()
  };
  const before = createMagicLondonVegetationPlan(input);

  cityState.cells["grove-1"].occupancy = "building-new";
  const after = createMagicLondonVegetationPlan(input);

  assert.equal(after.skippedOccupied, before.skippedOccupied + 1, "newly occupied cells must be yields to");
  const placedIds = new Set([...after.trees, ...after.shrubs, ...after.grassTufts, ...after.flowers].map((entry) => entry.cellId));
  assert.equal(placedIds.has("grove-1"), false, "procedural vegetation must not appear inside a newly occupied cell");
  assert.deepEqual(after.zoneCounts, { meadow: 0, grove: 2, woodland: 0 }, "the occupied cell is no longer counted as open vegetation");
});
