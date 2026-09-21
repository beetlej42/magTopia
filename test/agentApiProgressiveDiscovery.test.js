import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createAgentApiCatalog, createAgentOperationDetail, createOpenApiDocument } from "../apps/server/openapi.js";

const BASE = "https://example.test";
const config = {
  publicBaseUrl: BASE,
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  turnCooldownSeconds: 60
};

test("OpenAPI operations have stable ids and support compact progressive discovery", () => {
  const document = createOpenApiDocument(BASE);
  const catalog = createAgentApiCatalog(document, BASE);

  assert.equal(catalog.operation_count, 53);
  assert.equal(catalog.operations.length, 53);
  assert.equal(new Set(catalog.operations.map((entry) => entry.operation_id)).size, 53);

  const preview = catalog.operations.find((entry) => entry.path.endsWith("/demolition-previews"));
  assert.deepEqual(preview, {
    operation_id: "post_cities_by_city_id_demolition_previews",
    method: "POST",
    path: "/api/v1/cities/{city_id}/demolition-previews",
    summary: "Preview one ordinary-building or road-cell demolition and its 50% refund",
    tags: ["demolition"],
    detail_url: `${BASE}/agent/api/operations/post_cities_by_city_id_demolition_previews`
  });

  const detail = createAgentOperationDetail(document, preview.operation_id);
  assert.equal(detail.selected_operation.method, "POST");
  assert.equal(detail.selected_operation.path, preview.path);
  assert.ok(detail.paths["/cities/{city_id}/demolition-previews"].post.requestBody);
  assert.ok(detail.components.schemas.DemolitionRequest);
  assert.equal(detail.components.schemas.BuildingIntent, undefined, "unrelated schemas must not inflate operation details");
  assert.equal(createAgentOperationDetail(document, "not_an_operation"), null);
});

test("catalog is advertised at discovery, connection, and every Agent JSON response", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config, logger: false });
  try {
    const catalogResponse = await app.inject({ method: "GET", url: "/agent/api/operations" });
    assert.equal(catalogResponse.statusCode, 200);
    const catalog = catalogResponse.json();
    assert.equal(catalog.operations.length, 53);

    const detailResponse = await app.inject({ method: "GET", url: `/agent/api/operations/${catalog.operations[0].operation_id}` });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().selected_operation.operation_id, catalog.operations[0].operation_id);

    const missing = await app.inject({ method: "GET", url: "/agent/api/operations/not_an_operation" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().details.api_catalog_url, `${BASE}/agent/api/operations`);

    const discovery = (await app.inject({ method: "GET", url: "/.well-known/magtopia-agent.json" })).json();
    assert.equal(discovery.api_catalog_url, `${BASE}/agent/api/operations`);
    assert.equal(discovery.api_operation_url_template, `${BASE}/agent/api/operations/{operation_id}`);

    const player = (await app.inject({ method: "POST", url: "/api/v1/players", payload: { display_name: "Catalog Owner" } })).json();
    const city = (await app.inject({
      method: "POST",
      url: "/api/v1/cities",
      headers: { authorization: `Bearer ${player.access_token}` },
      payload: { name: "Catalog City" }
    })).json();
    assert.equal(city.agent_help, undefined, "player responses must remain unchanged");

    const connection = (await app.inject({ method: "POST", url: new URL(city.agent_connect_url).pathname })).json();
    assert.equal(connection.api_catalog_url, `${BASE}/agent/api/operations`);
    assert.match(connection.agent_start.instruction, /api_catalog_url/);

    const snapshotResponse = await app.inject({
      method: "GET",
      url: `/api/v1/cities/${city.id}/snapshot`,
      headers: { authorization: `Bearer ${connection.access_token}` }
    });
    assert.equal(snapshotResponse.statusCode, 200);
    assert.equal(snapshotResponse.headers.link, `<${BASE}/agent/api/operations>; rel="help"`);
    const snapshot = snapshotResponse.json();
    assert.equal(snapshot.agent_help.api_catalog_url, `${BASE}/agent/api/operations`);
    assert.equal(snapshot.agent_help.current_operation_id, "get_cities_by_city_id_snapshot");
    assert.equal(snapshot.agent_help.operation_detail_url, `${BASE}/agent/api/operations/get_cities_by_city_id_snapshot`);
  } finally {
    await app.close();
  }
});
