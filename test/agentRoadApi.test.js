import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import {
  CARDINAL_ROAD_OFFSETS,
  deriveCardinalRoadPorts,
  roadNeighborId
} from "../src/city/road-topology.js";
import { createAgentAcceptanceCity } from "../src/generators/agentAcceptanceCity.js";
import { createAgentVoxelRoadLayer } from "../src/generators/agentVoxelInfrastructure.js";

test("Agent API roads render with shared voxel assets and derive reciprocal directions automatically", async () => {
  const config = {
    publicBaseUrl: "http://127.0.0.1:4183",
    assetOutputRoot: "/tmp/magictown-agent-road-api-test",
    assetProvider: "codex-manual",
    workerPollMs: 5
  };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Road Inspector" } }, 201);
    const city = await json(app, auth(player, {
      method: "POST",
      url: "/api/v1/cities",
      payload: { name: "Voxel Road API City", map_seed: "agent-road-api-test" }
    }), 201);
    const link = await json(app, auth(player, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/agent-links`,
      payload: {}
    }), 201);
    const capability = link.connect_url.split("/").at(-1);
    const agent = await json(app, { method: "POST", url: `/connect/${capability}` }, 200);
    const initial = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/render-state` }), 200);

    assert.equal(initial.render_contract.mode, "agentcity");
    assert.equal(initial.render_contract.roadAsset, "shared-victorian-voxel-road-tile-v1");
    assert.equal(initial.render_contract.agentSuppliesVisualDirections, false);
    assert.equal(initial.state.world.coordinateSystem.north, "row - 1");
    assert.equal(initial.state.world.coordinateSystem.worldAxes.north, "+z");

    const gateway = initial.state.cells[initial.state.nodes.old_town_entry.cellId];
    const target = Object.values(initial.state.cells)
      .filter((cell) => cell.id !== gateway.id && cell.strictBuildable !== false)
      .filter((cell) => Math.abs(cell.column - gateway.column) + Math.abs(cell.row - gateway.row) >= 5)
      .sort((a, b) => (
        Math.abs(a.row - gateway.row) - Math.abs(b.row - gateway.row)
        || b.column - a.column
      ))[0];
    assert.ok(target);

    const district = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/districts`,
      headers: { "idempotency-key": "voxel-road-district-1" },
      payload: {
        expected_city_version: initial.city_version,
        name: "Lantern Row",
        purpose: "compact residential and shopping street",
        bounds: {
          minColumn: Math.max(0, Math.min(gateway.column, target.column) - 2),
          minRow: Math.max(0, Math.min(gateway.row, target.row) - 2),
          maxColumn: Math.min(initial.state.world.grid.columns - 1, Math.max(gateway.column, target.column) + 2),
          maxRow: Math.min(initial.state.world.grid.rows - 1, Math.max(gateway.row, target.row) + 2)
        }
      }
    }), 201);
    assert.equal(district.resource.district.suggested_next_focus, "connect_to_city");
    assert.equal(district.resource.district.composition_review.status, "not_started");

    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/connections`,
      headers: { "idempotency-key": "voxel-road-connection-1" },
      payload: {
        expected_city_version: district.city_version_after,
        from: { kind: "node", id: "old_town_entry" },
        to: { kind: "cell", id: target.id },
        mode: "road"
      }
    }), 201);

    const rendered = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/render-state` }), 200);
    const roadIds = new Set(Object.values(rendered.state.cells).filter((cell) => cell.infrastructure === "road").map((cell) => cell.id));
    Object.entries(rendered.state.infrastructure).forEach(([cellId, item]) => { if (item.type === "bridge") roadIds.add(cellId); });
    assert.ok(roadIds.size > 0);

    const sites = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/site-searches`,
      payload: { district_id: district.resource.id, footprint: "1x1", limit: 100 }
    }), 200);
    assert.equal(sites.district.observations.connected_to_city, true);
    assert.ok(["continue_composition", "consider_shared_boundary"].includes(sites.district.suggested_next_focus));
    assert.ok(Array.isArray(sites.district.suggestions));
    assert.ok(sites.data.some((candidate) => candidate.context.adjacentRoad));
    assert.ok(sites.data.every((candidate) => candidate.context.blockId));
    assert.ok(sites.data.some((candidate) => candidate.context.blockRole === "interior"));
    assert.ok(sites.data.every((candidate) => !("score" in candidate) && !("score_explanation" in candidate)));

    const opposite = { north: "south", east: "west", south: "north", west: "east" };
    for (const cellId of roadIds) {
      const cell = rendered.state.cells[cellId];
      const ports = deriveCardinalRoadPorts(cell, roadIds);
      for (const port of ports) {
        const neighborId = roadNeighborId(cell, port);
        assert.ok(roadIds.has(neighborId), `${cellId} ${port} must point to a network neighbor`);
        const neighbor = rendered.state.cells[neighborId];
        assert.ok(deriveCardinalRoadPorts(neighbor, roadIds).includes(opposite[port]), `${neighborId} must reciprocate ${port}`);
        const [dc, dr] = CARDINAL_ROAD_OFFSETS[port];
        assert.equal(neighbor.column, cell.column + dc);
        assert.equal(neighbor.row, cell.row + dr);
      }
    }

    const grid = {
      columns: rendered.state.world.grid.columns,
      rows: rendered.state.world.grid.rows,
      cellWorldSize: rendered.state.world.grid.cellWorldSize,
      cells: Object.values(rendered.state.cells)
    };
    const layer = createAgentVoxelRoadLayer({ state: rendered.state, grid, seed: rendered.state.mapSeed });
    assert.equal(layer.userData.contract.roadAsset, rendered.render_contract.roadAsset);
    assert.equal(layer.userData.contract.agentSuppliesVisualDirections, false);
    assert.equal(layer.userData.contract.northIsPositiveWorldZ, true);
    assert.equal(layer.userData.contract.roadCellCount, roadIds.size);
    assert.ok(layer.userData.contract.renderStats.renderedTriangles > 0);

    const cityObject = createAgentAcceptanceCity({
      seed: rendered.state.mapSeed,
      worldColumns: grid.columns,
      worldRows: grid.rows,
      cityState: rendered.state,
      assetRegistry: []
    });
    assert.equal(cityObject.userData.diagnostics.renderer, "agent-api-city-v1-all-voxel");
    assert.equal(cityObject.userData.diagnostics.source, "agent-api-render-state");
    assert.equal(cityObject.userData.diagnostics.roadRenderer.roadAsset, rendered.render_contract.roadAsset);
    assert.equal(cityObject.userData.diagnostics.roadRenderer.roadCellCount, roadIds.size);

    const cancelled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/districts/${district.resource.id}/cancel`,
      headers: { "idempotency-key": "voxel-road-district-cancel-1" },
      payload: { expected_city_version: rendered.state.version, reason: "start the next growth area elsewhere" }
    }), 200);
    assert.equal(cancelled.resource.status, "cancelled");
    assert.equal(cancelled.resource.district.status, "cancelled");
    assert.ok(cancelled.resource.preserved.roads > 0);

    const cancelledSnapshot = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/snapshot` }), 200);
    assert.equal(cancelledSnapshot.counts.active_districts, 0);
    assert.equal(cancelledSnapshot.counts.cancelled_districts, 1);
    const cancelledSites = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/site-searches`,
      payload: { district_id: district.resource.id, footprint: "1x1", limit: 10 }
    }), 409);
    assert.equal(cancelledSites.code, "DISTRICT_CANCELLED");
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
