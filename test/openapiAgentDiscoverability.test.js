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

test("OpenAPI exposes only the confirmed BuildingDesign construction contract", () => {
  assert.equal(document.paths["/assets"], undefined);
  for (const path of ["/cities/{city_id}/construction-previews", "/cities/{city_id}/construction-orders"]) {
    const schema = operation(path, "post").requestBody.content["application/json"].schema;
    assert.equal(schema.$ref, "#/components/schemas/BuildingDesignConstructionRequest");
    assert.equal(schema.oneOf, undefined);
  }
  const request = document.components.schemas.BuildingDesignConstructionRequest;
  assert.deepEqual(request.required, ["expected_city_version", "design_id", "design_revision", "design_hash"]);
  assert.equal(request.additionalProperties, false);
  assert.equal(request.properties.gameplay_building, undefined);
  assert.equal(document.components.schemas.ConstructionRequest, undefined);
  assert.equal(document.components.schemas.AssetChoice, undefined);
  assert.equal(document.components.schemas.GameplayGrammarContainer, undefined);
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

test("OpenAPI upgrade-designs request exposes only client-controllable fields", () => {
  const upgradeOperation = operation("/cities/{city_id}/buildings/{building_id}/upgrade-designs", "post");
  const schemaRef = upgradeOperation.requestBody.content["application/json"].schema.$ref;
  assert.ok(schemaRef, "expected a concrete upgrade-designs request schema");
  const schema = document.components.schemas.BuildingDesignUpgradeRequest;
  assert.ok(schema, "expected BuildingDesignUpgradeRequest schema");
  assert.ok(schema.properties.goal.properties.type.enum.includes("add_floor"));
  assert.equal(schema.properties.goal.properties.count.default, 1);
  assert.equal(schema.properties.goal.properties.count.minimum, 1);
  const clientFields = Object.keys(schema.properties);
  assert.deepEqual(clientFields, ["goal"], "id/actor are server-owned and must not be advertised as client inputs");
});

// Normalize a runtime fastify path into the same shape as an OpenAPI path key:
// drop the /api/v1 prefix and treat every dynamic segment ({name} or :name or *)
// as an anonymous placeholder so path structure can be compared exactly.
function normalizePath(path) {
  return path.replace(/^\/api\/v1/, "").split("/").map((segment) => {
    if (!segment) return segment;
    if (segment === "*" || segment.startsWith(":") || (segment.startsWith("{") && segment.endsWith("}"))) return "{p}";
    return segment;
  }).join("/");
}

// Derive the actual runtime surface from the fastify route registry so a new
// Agent route cannot silently escape the OpenAPI contract. fastify's
// printRoutes() emits a radix tree whose lines carry the node depth.
function parseRuntimeRoutes(app) {
  const output = app.printRoutes({ commonPrefix: false });
  const routes = [];
  const stack = [];
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    const marker = line.search(/[├└]/);
    if (marker < 0) continue;
    const depth = Math.floor(marker / 4);
    const content = line.slice(line.indexOf("── ") + 3).trim();
    const suffix = content.match(/ \(([^)]+)\)$/);
    const segment = suffix ? content.slice(0, -suffix[0].length) : content;
    const methods = suffix ? suffix[1].split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry !== "head") : [];
    while (stack.length > depth) stack.pop();
    stack[depth] = segment;
    routes.push({ path: stack.slice(0, depth + 1).join(""), methods });
  }
  return routes;
}

// Runtime routes that are intentionally not part of the Agent API contract:
// HTML pages, static assets, health/discovery endpoints, and the one-time
// capability exchange. Anything not listed here must appear in OpenAPI.
const DENY_LIST = new Set([
  "get /",
  "get /play",
  "get /healthz",
  "get /agent/playbook.md",
  "get /agent",
  "get /agent/openapi",
  "get /agent/building-design-api-v1.md",
  "get /{p}",
  "get /style-reference/isometric-magic-london-city.jpg",
  "get /dashboard",
  "get /cities/{p}",
  "get /connect/{p}",
  "post /connect/{p}",
  "get /.well-known/magtopia-agent.json",
  "get /.well-known/magictown-agent.json",
  "get /openapi.json",
  "get /assets",
  "post /cities/{p}/construction-orders/{p}/cancel",
  "get /asset-jobs/{p}",
  "post /asset-jobs/{p}/artifacts"
]);

test("every eligible Agent-facing runtime route is present in OpenAPI", async () => {
  const config = { publicBaseUrl: BASE, voxelOnly: false };
  const app = await createApp({ repository: { database: {} }, config });

  const runtimeByKey = new Map();
  for (const route of parseRuntimeRoutes(app)) {
    for (const method of route.methods) {
      const key = `${method} ${normalizePath(route.path)}`;
      if (DENY_LIST.has(key)) continue;
      runtimeByKey.set(key, route);
    }
  }
  assert.ok(runtimeByKey.size > 0, "expected to derive Agent-facing runtime routes from the fastify registry");

  const openApiByKey = new Map();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item)) openApiByKey.set(`${method} ${normalizePath(path)}`, path);
  }

  const missing = [...runtimeByKey.keys()].filter((key) => !openApiByKey.has(key));
  assert.deepEqual(missing, [], "eligible Agent-facing runtime routes disappeared from the generated OpenAPI document");
});

test("every OpenAPI Agent path is backed by a registered runtime route", async () => {
  const config = { publicBaseUrl: BASE, voxelOnly: false };
  const app = await createApp({ repository: { database: {} }, config });

  const runtimeKeys = new Set();
  for (const route of parseRuntimeRoutes(app)) {
    for (const method of route.methods) runtimeKeys.add(`${method} ${normalizePath(route.path)}`);
  }

  const orphaned = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item)) {
      if (!runtimeKeys.has(`${method} ${normalizePath(path)}`)) orphaned.push(`${method.toUpperCase()} ${path}`);
    }
  }
  assert.deepEqual(orphaned, [], "OpenAPI documents an Agent path/method that is not registered on the runtime");
});

// Documented runtime-supported query names per query-driven endpoint, coupled
// to the OpenAPI parameter names so a runtime query cannot become
// undiscoverable. fastify reads these ad hoc from request.query (there is no
// runtime query registry to introspect), so this list mirrors apps/server/app.js
// and repository.js and is the single place to extend when a runtime query is
// added. Names here MUST keep appearing as OpenAPI query parameters.
const QUERY_CONTRACTS = {
  "/cities/{city_id}/spatial": ["min_col", "min_row", "max_col", "max_row"],
  "/cities/{city_id}/events": ["after_version", "limit"],
  "/cities/{city_id}/buildings": ["query", "archetype", "purpose", "limit", "min_col", "min_row", "max_col", "max_row"],
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
