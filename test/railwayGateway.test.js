import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { createBlankVoxelWorldContract } from "../src/city/voxel-world.js";
import { createRailwayStationSpec, createVoxelSteamTrain, createVoxelRailTrack } from "../src/generators/railwayAssets.js";

test("a 50x50 city starts from a through-station gateway with protected station and forecourt land", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-layout", terrainSubdivisions: 4 }));
  const gateway = state.nodes.old_town_entry;
  const railway = gateway.railway;

  assert.equal(gateway.type, "railway_station_gateway");
  assert.equal(gateway.urbanDirection, "south");
  assert.equal(railway.orientation, "east_west");
  assert.equal(railway.train.movement, "through_service");
  assert.equal(railway.station.footprint, "6x3");
  assert.equal(railway.station.cellIds.length, 18);
  assert.equal(railway.forecourt.cellIds.length, 18);
  assert.equal(state.cells[gateway.cellId].infrastructure, "station_plaza");
  assert.equal(Object.values(state.cells).filter((cell) => cell.infrastructure === "road").length, 0);
  assert.ok(railway.station.cellIds.every((id) => state.cells[id].infrastructure === "railway_station"));
  assert.ok(railway.forecourt.cellIds.filter((id) => id !== gateway.cellId).every((id) => state.cells[id].infrastructure === "station_plaza"));
  assert.ok(railway.trackCellIds.every((id) => state.cells[id].infrastructure === "railway"));
  assert.ok(railway.trackRow >= 4 && railway.trackRow <= 9, "the corridor stays near 10–15% map depth");
});

test("all station upgrades keep a 6x3 footprint while gaining railway landmarks", () => {
  const specs = [1, 2, 3].map((level) => createRailwayStationSpec(level));
  assert.ok(specs.every((spec) => spec.widthCells === 6 && spec.depthCells === 3));
  assert.equal(specs[0].masses.some((mass) => mass.id === "clock-tower"), false);
  assert.equal(specs[1].masses.some((mass) => mass.id === "clock-tower"), true);
  assert.equal(specs[2].masses.some((mass) => mass.id === "grand-train-shed" && mass.type === "framed"), true);
  assert.deepEqual(specs.map((spec) => spec.metadata.stationLevel), [1, 2, 3]);
});

test("station upgrades charge deterministic costs and stop at level three", () => {
  const state = createCityState(createBlankVoxelWorldContract({ seed: "railway-upgrades", terrainSubdivisions: 4 }), { resources: { coins: 2000 } });
  const context = createEngineContext({ now: () => "2026-09-06T00:00:00.000Z" });
  const level2 = executeCityCommand(state, { type: "upgrade_gateway", nodeId: "old_town_entry", actor: "agent:test" }, context);
  assert.equal(level2.accepted, true);
  assert.equal(level2.gateway.stationLevel, 2);
  assert.equal(level2.cost.coins, 480);
  assert.deepEqual(level2.gateway.railway.station.cellIds, state.nodes.old_town_entry.railway.station.cellIds);
  const level3 = executeCityCommand(level2.state, { type: "upgrade_gateway", nodeId: "old_town_entry", actor: "agent:test" }, context);
  assert.equal(level3.accepted, true);
  assert.equal(level3.gateway.stationLevel, 3);
  assert.equal(level3.cost.coins, 960);
  assert.equal(executeCityCommand(level3.state, { type: "upgrade_gateway", nodeId: "old_town_entry" }, context).code, "GATEWAY_MAX_LEVEL");
});

test("voxel track and steam train compile into bounded greedy geometry", () => {
  const track = createVoxelRailTrack({ lengthWorld: 80, platformLengthWorld: 28, seed: "track-test" }).userData.contract;
  const train = createVoxelSteamTrain({ seed: "train-test" }).userData.contract;
  assert.equal(track.asset, "victorian-through-railway-v1");
  assert.equal(track.gaugeVoxels, 12);
  assert.ok(track.renderStats.renderedTriangles > 0);
  assert.equal(train.asset, "victorian-voxel-steam-train-v1");
  assert.equal(train.coachCount, 2);
  assert.equal(train.wheelCount, 16);
  assert.ok(train.materialCounts.iron > 0);
  assert.ok(train.renderStats.renderedTriangles < 5000);
});
