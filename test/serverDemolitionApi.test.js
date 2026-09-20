import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

test("Agent demolition API exposes ids, previews refunds, commits atomically, and replays idempotently", async () => {
  const config = { publicBaseUrl: "http://127.0.0.1:4183", assetProvider: "codex-manual", workerPollMs: 5 };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Demolition Inspector" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Avenue Test" } }), 201);
    const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const agent = await json(app, { method: "POST", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
    const principal = await repository.authenticate(agent.access_token);
    const { state } = await repository.getCity(principal, city.id);

    const ordinaryCell = Object.values(state.cells).find((cell) => !cell.node && cell.infrastructure == null && cell.strictBuildable !== false);
    const roadCell = Object.values(state.cells).find((cell) => cell.id !== ordinaryCell.id && !cell.node && cell.infrastructure == null);
    const bridgeCell = Object.values(state.cells).find((cell) => ![ordinaryCell.id, roadCell.id].includes(cell.id) && !cell.node && cell.infrastructure == null);
    state.cells[ordinaryCell.id].occupancy = "building-crooked";
    state.buildings["building-crooked"] = {
      id: "building-crooked",
      status: "completed",
      footprintCells: [ordinaryCell.id],
      constructionCost: { coins: 50 },
      program: { name: "Crooked Cottage", archetype: "starter_residence", purpose: "residential" }
    };
    state.cells[roadCell.id].infrastructure = "road";
    state.infrastructure[bridgeCell.id] = { type: "bridge", cellId: bridgeCell.id };

    const snapshot = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/snapshot` }), 200);
    assert.equal(snapshot.available_actions.demolish, true);
    assert.match(snapshot.links.demolition_previews, /demolition-previews$/);
    assert.match(snapshot.links.demolitions, /demolitions$/);

    const buildings = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/buildings?query=Crooked` }), 200);
    assert.equal(buildings.data[0].id, "building-crooked");

    const bounds = [roadCell, bridgeCell].reduce((value, cell) => ({
      min_col: Math.min(value.min_col, cell.column),
      min_row: Math.min(value.min_row, cell.row),
      max_col: Math.max(value.max_col, cell.column),
      max_row: Math.max(value.max_row, cell.row)
    }), { min_col: roadCell.column, min_row: roadCell.row, max_col: roadCell.column, max_row: roadCell.row });
    const query = new URLSearchParams(bounds).toString();
    const spatial = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/spatial?${query}` }), 200);
    const roadResult = spatial.data.find((cell) => cell.id === roadCell.id);
    const bridgeResult = spatial.data.find((cell) => cell.id === bridgeCell.id);
    assert.equal(roadResult.infrastructure_type, "road");
    assert.equal(roadResult.demolishable, true);
    assert.equal(bridgeResult.infrastructure_type, "bridge");
    assert.equal(bridgeResult.demolishable, true);

    const buildingPreview = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/demolition-previews`,
      payload: { target: { kind: "building", building_id: "building-crooked" } }
    }), 200);
    assert.equal(buildingPreview.feasible, true);
    assert.equal(buildingPreview.refund.coins, 25);

    const demolishedBuilding = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/demolitions`,
      headers: { "idempotency-key": "demolish-building-1" },
      payload: { expected_city_version: buildingPreview.city_version, target: { kind: "building", building_id: "building-crooked" }, actor_note: "clear the avenue" }
    }), 200);
    assert.equal(demolishedBuilding.resource.refund.coins, 25);
    const replay = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/demolitions`,
      headers: { "idempotency-key": "demolish-building-1" },
      payload: { expected_city_version: buildingPreview.city_version, target: { kind: "building", building_id: "building-crooked" }, actor_note: "clear the avenue" }
    }), 200);
    assert.equal(replay.idempotent_replay, true);

    const roadPreview = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/demolition-previews`,
      payload: { target: { kind: "road_cells", cell_ids: [roadCell.id, bridgeCell.id] } }
    }), 200);
    assert.equal(roadPreview.refund.coins, 8);
    const demolishedRoad = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/demolitions`,
      headers: { "idempotency-key": "demolish-road-1" },
      payload: { expected_city_version: demolishedBuilding.city_version_after, target: { kind: "road_cells", cell_ids: [roadCell.id, bridgeCell.id] } }
    }), 200);
    assert.equal(demolishedRoad.resource.affected.roadCellIds[0], roadCell.id);
    assert.equal(demolishedRoad.resource.affected.bridgeCellIds[0], bridgeCell.id);

    const rendered = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/render-state` }), 200);
    assert.equal(rendered.state.buildings["building-crooked"], undefined);
    assert.equal(rendered.state.cells[roadCell.id].infrastructure, null);
    assert.equal(rendered.state.infrastructure[bridgeCell.id], undefined);
    assert.equal(rendered.resources.coins, 633);
  } finally {
    await app.close();
  }
});

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
