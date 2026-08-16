import assert from "node:assert/strict";
import test from "node:test";
import { deriveGameplayBuilding } from "../src/gameplay/building-metadata.js";
import { exposureDelta, exposurePressure, neighborhoodConcealment } from "../src/gameplay/exposure.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "exposure-test", grid: { columns, rows, cells } };
}

function cityState() {
  const cells = Object.fromEntries(world().grid.cells.map((cell) => [cell.id, { ...cell, occupancy: null, infrastructure: null, reservation: null }]));
  return { cells, buildings: {} };
}

function place(state, id, cellId, program) {
  state.cells[cellId].occupancy = id;
  state.buildings[id] = {
    id,
    footprintCells: [cellId],
    site: { lotId: cellId, footprint: "1x1" },
    program: { name: program.name, purpose: program.purpose, intent: { magicLevel: program.magicLevel, prominence: program.prominence ?? "ordinary" } },
    status: "completed"
  };
  return deriveGameplayBuilding(state.buildings[id]);
}

test("ordinary buildings raise neighborhood concealment", () => {
  const state = cityState();
  const highMagic = place(state, "magic", "cell-5-5", { name: "Lantern Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark" });
  const without = neighborhoodConcealment(state, state.buildings.magic, { metadataOf: (neighbor) => deriveGameplayBuilding(neighbor) });
  assert.equal(without, 0);

  place(state, "market", "cell-6-5", { name: "Market", purpose: "market", magicLevel: 0.1 });
  const withMarket = neighborhoodConcealment(state, state.buildings.magic, { metadataOf: (neighbor) => deriveGameplayBuilding(neighbor) });
  assert.ok(withMarket > without);
  assert.equal(highMagic.exposure, 0);
});

test("high magicLevel without concealment raises exposure pressure", () => {
  const metadata = deriveGameplayBuilding({
    id: "tower",
    program: { purpose: "residential", intent: { magicLevel: 0.8, prominence: "landmark" } },
    footprintCells: ["cell-5-5"]
  });
  const pressure = exposurePressure(metadata, 0, { visibility: 1.2 });
  assert.ok(pressure > 0);
  assert.ok(exposureDelta(pressure) > 0);
});

test("adding an ordinary market lowers exposure pressure of a high-magic neighbor", () => {
  const state = cityState();
  place(state, "magic", "cell-5-5", { name: "Lantern Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark" });
  place(state, "market", "cell-6-5", { name: "Market", purpose: "market", magicLevel: 0.1 });
  const metadata = deriveGameplayBuilding(state.buildings.magic);
  const concealment = neighborhoodConcealment(state, state.buildings.magic, { metadataOf: (neighbor) => deriveGameplayBuilding(neighbor) });
  const alone = exposurePressure(metadata, 0, { visibility: 1.2 });
  const withMarket = exposurePressure(metadata, concealment, { visibility: 1.2 });
  assert.ok(withMarket < alone);
  assert.ok(exposureDelta(withMarket) <= 0);
});

test("sealed buildings no longer contribute concealment", () => {
  const state = cityState();
  place(state, "magic", "cell-5-5", { name: "Lantern Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark" });
  const marketMeta = place(state, "market", "cell-6-5", { name: "Market", purpose: "market", magicLevel: 0.1 });
  marketMeta.status = "sealed";
  state.buildings.market.status = "sealed";
  const concealment = neighborhoodConcealment(state, state.buildings.magic, { metadataOf: (neighbor) => (neighbor.id === "market" ? marketMeta : deriveGameplayBuilding(neighbor)) });
  assert.equal(concealment, 0);
});

test("distance falloff weakens concealment from further buildings", () => {
  const state = cityState();
  place(state, "magic", "cell-5-5", { name: "Tower", purpose: "residential", magicLevel: 0.9, prominence: "landmark" });
  place(state, "market-far", "cell-7-5", { name: "Far Market", purpose: "market", magicLevel: 0.1 });
  const concealment = neighborhoodConcealment(state, state.buildings.magic, { metadataOf: (neighbor) => deriveGameplayBuilding(neighbor) });
  assert.ok(concealment > 0);
  assert.ok(concealment < 2);
});
