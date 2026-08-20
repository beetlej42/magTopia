import assert from "node:assert/strict";
import test from "node:test";
import { createOpenApiDocument } from "../apps/server/openapi.js";
import { createApp } from "../apps/server/app.js";

const BASE = "https://example.test";
const document = createOpenApiDocument(BASE);

function operation(path, method) {
  const item = document.paths[path]?.[method];
  assert.ok(item, `expected ${method.toUpperCase()} ${path} in the generated OpenAPI document`);
  return item;
}

function queryParameters(path, method = "get") {
  return operation(path, method).parameters?.filter((parameter) => parameter.in === "query") ?? [];
}

function queryNames(path, method = "get") {
  return queryParameters(path, method).map((parameter) => parameter.name);
}

test("OpenAPI exposes bounded-grid query parameters on /spatial", () => {
  assert.deepEqual(queryNames("/cities/{city_id}/spatial"), ["min_col", "min_row", "max_col", "max_row"]);
  for (const name of ["min_col", "min_row", "max_col", "max_row"]) {
    const parameter = queryParameters("/cities/{city_id}/spatial").find((entry) => entry.name === name);
    assert.equal(parameter.schema.type, "integer", `${name} must be an integer`);
  }
  const minCol = queryParameters("/cities/{city_id}/spatial").find((entry) => entry.name === "min_col");
  assert.equal(minCol.schema.default, 0);
  assert.match(minCol.description, /inclusive/i);
  assert.match(minCol.description, /400/);
  assert.match(minCol.description, /example/i);
});

test("OpenAPI exposes incremental /events query parameters", () => {
  assert.deepEqual(queryNames("/cities/{city_id}/events"), ["after_version", "limit"]);
  const afterVersion = queryParameters("/cities/{city_id}/events").find((entry) => entry.name === "after_version");
  assert.equal(afterVersion.schema.type, "integer");
  assert.equal(afterVersion.schema.default, 0);
  const limit = queryParameters("/cities/{city_id}/events").find((entry) => entry.name === "limit");
  assert.equal(limit.schema.default, 100);
});

test("OpenAPI exposes /buildings search, filter, and bounds query parameters", () => {
  const names = queryNames("/cities/{city_id}/buildings");
  for (const name of ["query", "archetype", "purpose", "limit", "min_col", "min_row", "max_col", "max_row"]) {
    assert.ok(names.includes(name), `expected /buildings to expose query parameter ${name}`);
  }
  const limit = queryParameters("/cities/{city_id}/buildings").find((entry) => entry.name === "limit");
  assert.equal(limit.schema.default, 20);
  assert.equal(limit.schema.maximum, 100);
  const minCol = queryParameters("/cities/{city_id}/buildings").find((entry) => entry.name === "min_col");
  assert.match(minCol.description, /footprint cell/i);
});

test("OpenAPI exposes /assets search query parameters", () => {
  const names = queryNames("/assets");
  for (const name of ["archetype", "footprint", "district_style", "limit"]) {
    assert.ok(names.includes(name), `expected /assets to expose query parameter ${name}`);
  }
  const limit = queryParameters("/assets").find((entry) => entry.name === "limit");
  assert.equal(limit.schema.default, 20);
  assert.equal(limit.schema.maximum, 50);
});

test("OpenAPI exposes /report-context turn query parameter", () => {
  assert.deepEqual(queryNames("/cities/{city_id}/report-context"), ["turn"]);
  const turn = queryParameters("/cities/{city_id}/report-context").find((entry) => entry.name === "turn");
  assert.equal(turn.schema.type, "integer");
  assert.equal(turn.schema.minimum, 1);
  assert.match(turn.description, /latest resolved turn/i);
});

test("OpenAPI exposes GET routes for cells, buildings, and construction-orders", () => {
  assert.ok(document.paths["/cities/{city_id}/cells/{cell_id}"]?.get, "expected GET /cities/{city_id}/cells/{cell_id}");
  assert.ok(document.paths["/cities/{city_id}/buildings/{building_id}"]?.get, "expected GET /cities/{city_id}/buildings/{building_id}");
  assert.ok(document.paths["/cities/{city_id}/construction-orders"]?.get, "expected GET /cities/{city_id}/construction-orders");
  const cellOperation = document.paths["/cities/{city_id}/cells/{cell_id}"].get;
  assert.deepEqual(
    cellOperation.parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name),
    ["city_id", "cell_id"]
  );
  assert.ok(document.paths["/cities/{city_id}/construction-orders"].post, "POST /construction-orders must stay exposed");
  assert.ok(document.paths["/cities/{city_id}/construction-orders"].get.parameters.some((p) => p.in === "path" && p.name === "city_id"));
});

test("OpenAPI upgrade-designs request has a concrete schema instead of a generic object", () => {
  const upgradeOperation = operation("/cities/{city_id}/buildings/{building_id}/upgrade-designs", "post");
  const schemaRef = upgradeOperation.requestBody.content["application/json"].schema.$ref;
  assert.ok(schemaRef, "expected a concrete upgrade-designs request schema");
  const schema = document.components.schemas.BuildingDesignUpgradeRequest;
  assert.ok(schema, "expected BuildingDesignUpgradeRequest schema");
  assert.ok(schema.properties.goal.properties.type.enum.includes("add_floor"));
  assert.equal(schema.properties.goal.properties.count.default, 1);
  assert.equal(schema.properties.goal.properties.count.minimum, 1);
});

// Canonical Agent-facing runtime surface. Each entry maps a fastify route path
// template and HTTP methods to the OpenAPI path key. The runtime side is
// verified against the actual registered app so this list cannot silently drift
// from the implementation; the OpenAPI side guards against an eligible runtime
// route disappearing from the generated contract.
const AGENT_ROUTES = [
  { runtime: "/api/v1/players", methods: ["post"], openapi: "/players" },
  { runtime: "/api/v1/cities", methods: ["get", "post"], openapi: "/cities" },
  { runtime: "/api/v1/cities/:cityId", methods: ["get"], openapi: "/cities/{city_id}" },
  { runtime: "/api/v1/cities/:cityId/snapshot", methods: ["get"], openapi: "/cities/{city_id}/snapshot" },
  { runtime: "/api/v1/cities/:cityId/render-state", methods: ["get"], openapi: "/cities/{city_id}/render-state" },
  { runtime: "/api/v1/cities/:cityId/events", methods: ["get"], openapi: "/cities/{city_id}/events" },
  { runtime: "/api/v1/cities/:cityId/spatial", methods: ["get"], openapi: "/cities/{city_id}/spatial" },
  { runtime: "/api/v1/cities/:cityId/cells/:cellId", methods: ["get"], openapi: "/cities/{city_id}/cells/{cell_id}" },
  { runtime: "/api/v1/cities/:cityId/buildings", methods: ["get"], openapi: "/cities/{city_id}/buildings" },
  { runtime: "/api/v1/cities/:cityId/buildings/:buildingId", methods: ["get"], openapi: "/cities/{city_id}/buildings/{building_id}" },
  { runtime: "/api/v1/cities/:cityId/districts", methods: ["get", "post"], openapi: "/cities/{city_id}/districts" },
  { runtime: "/api/v1/cities/:cityId/districts/:districtId/cancel", methods: ["post"], openapi: "/cities/{city_id}/districts/{district_id}/cancel" },
  { runtime: "/api/v1/cities/:cityId/building-designs", methods: ["get", "post"], openapi: "/cities/{city_id}/building-designs" },
  { runtime: "/api/v1/cities/:cityId/building-designs/:designId", methods: ["get"], openapi: "/cities/{city_id}/building-designs/{design_id}" },
  { runtime: "/api/v1/cities/:cityId/building-designs/:designId/revisions", methods: ["post"], openapi: "/cities/{city_id}/building-designs/{design_id}/revisions" },
  { runtime: "/api/v1/cities/:cityId/building-designs/:designId/confirm", methods: ["post"], openapi: "/cities/{city_id}/building-designs/{design_id}/confirm" },
  { runtime: "/api/v1/cities/:cityId/buildings/:buildingId/upgrade-designs", methods: ["post"], openapi: "/cities/{city_id}/buildings/{building_id}/upgrade-designs" },
  { runtime: "/api/v1/cities/:cityId/site-searches", methods: ["post"], openapi: "/cities/{city_id}/site-searches" },
  { runtime: "/api/v1/assets", methods: ["get"], openapi: "/assets" },
  { runtime: "/api/v1/cities/:cityId/construction-previews", methods: ["post"], openapi: "/cities/{city_id}/construction-previews" },
  { runtime: "/api/v1/cities/:cityId/construction-orders", methods: ["get", "post"], openapi: "/cities/{city_id}/construction-orders" },
  { runtime: "/api/v1/cities/:cityId/construction-orders/:orderId", methods: ["get"], openapi: "/cities/{city_id}/construction-orders/{order_id}" },
  { runtime: "/api/v1/cities/:cityId/construction-orders/:orderId/cancel", methods: ["post"], openapi: "/cities/{city_id}/construction-orders/{order_id}/cancel" },
  { runtime: "/api/v1/cities/:cityId/connection-previews", methods: ["post"], openapi: "/cities/{city_id}/connection-previews" },
  { runtime: "/api/v1/cities/:cityId/connections", methods: ["post"], openapi: "/cities/{city_id}/connections" },
  { runtime: "/api/v1/cities/:cityId/time-advances", methods: ["post"], openapi: "/cities/{city_id}/time-advances" },
  { runtime: "/api/v1/cities/:cityId/strategy", methods: ["get"], openapi: "/cities/{city_id}/strategy" },
  { runtime: "/api/v1/cities/:cityId/strategy/assignments", methods: ["post"], openapi: "/cities/{city_id}/strategy/assignments" },
  { runtime: "/api/v1/cities/:cityId/strategy/resolve", methods: ["post"], openapi: "/cities/{city_id}/strategy/resolve" },
  { runtime: "/api/v1/cards", methods: ["get"], openapi: "/cards" },
  { runtime: "/api/v1/cities/:cityId/cards/current", methods: ["get"], openapi: "/cities/{city_id}/cards/current" },
  { runtime: "/api/v1/cities/:cityId/cards/select", methods: ["post"], openapi: "/cities/{city_id}/cards/select" },
  { runtime: "/api/v1/cities/:cityId/cards/place", methods: ["post"], openapi: "/cities/{city_id}/cards/place" },
  { runtime: "/api/v1/cities/:cityId/report-context", methods: ["get"], openapi: "/cities/{city_id}/report-context" },
  { runtime: "/api/v1/cities/:cityId/reports", methods: ["get", "post"], openapi: "/cities/{city_id}/reports" },
  { runtime: "/api/v1/cities/:cityId/reports/:reportId", methods: ["get"], openapi: "/cities/{city_id}/reports/{report_id}" },
  { runtime: "/api/v1/cities/:cityId/city-day", methods: ["get"], openapi: "/cities/{city_id}/city-day" },
  { runtime: "/api/v1/cities/:cityId/city-day/report-dismissed", methods: ["post"], openapi: "/cities/{city_id}/city-day/report-dismissed" },
  { runtime: "/api/v1/cities/:cityId/agent-links", methods: ["post"], openapi: "/cities/{city_id}/agent-links" },
  { runtime: "/api/v1/cities/:cityId/agent-credentials", methods: ["get"], openapi: "/cities/{city_id}/agent-credentials" },
  { runtime: "/api/v1/cities/:cityId/agent-credentials/:credentialId", methods: ["delete"], openapi: "/cities/{city_id}/agent-credentials/{credential_id}" },
  { runtime: "/api/v1/asset-jobs/:jobId", methods: ["get"], openapi: "/asset-jobs/{job_id}" },
  { runtime: "/api/v1/asset-jobs/:jobId/artifacts", methods: ["post"], openapi: "/asset-jobs/{job_id}/artifacts" }
];

// Intentionally non-Agent / internal routes must be listed here explicitly
// instead of silently dropping the OpenAPI coverage check. Keep it minimal.
const DENY_LIST = new Set([]);

test("every eligible Agent-facing runtime route is present in OpenAPI", async () => {
  const config = { publicBaseUrl: BASE, voxelOnly: false };
  const app = await createApp({ repository: { database: {} }, config });

  const missing = [];
  for (const { runtime, methods, openapi } of AGENT_ROUTES) {
    for (const method of methods) {
      assert.ok(
        app.hasRoute({ method: method.toUpperCase(), url: runtime }),
        `AGENT_ROUTES claims runtime route ${method.toUpperCase()} ${runtime}, but it is not registered on the app`
      );
      const key = `${method.toUpperCase()} ${openapi}`;
      if (DENY_LIST.has(key)) continue;
      if (!document.paths[openapi]?.[method]) missing.push(key);
    }
  }
  assert.deepEqual(missing, [], "eligible Agent-facing runtime routes disappeared from the generated OpenAPI document");
});

// Runtime-supported query names per query-driven endpoint, coupled to the
// OpenAPI parameter names so a future runtime query cannot become
// undiscoverable. Names mirror apps/server/app.js and repository.js.
const QUERY_CONTRACTS = {
  "/cities/{city_id}/spatial": ["min_col", "min_row", "max_col", "max_row"],
  "/cities/{city_id}/events": ["after_version", "limit"],
  "/cities/{city_id}/buildings": ["query", "archetype", "purpose", "limit", "min_col", "min_row", "max_col", "max_row"],
  "/assets": ["archetype", "footprint", "district_style", "limit"],
  "/cities/{city_id}/report-context": ["turn"]
};

test("runtime-supported query names stay discoverable in OpenAPI", () => {
  for (const [path, runtimeNames] of Object.entries(QUERY_CONTRACTS)) {
    const exposed = new Set(queryNames(path, "get"));
    for (const name of runtimeNames) {
      assert.ok(exposed.has(name), `runtime query ${path}?${name}= is not exposed as an OpenAPI query parameter`);
    }
  }
});
