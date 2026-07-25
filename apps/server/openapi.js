const json = { type: "object", additionalProperties: true };
const error = {
  type: "object",
  required: ["code", "message", "retryable"],
  properties: { code: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" }, details: json }
};

export function createOpenApiDocument(baseUrl) {
  const document = {
    openapi: "3.1.0",
    info: { title: "MagicTown Agent API", version: "1.0.0", description: "Private multi-city construction API for municipal Agents." },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        Error: error,
        Endpoint: {
          oneOf: [
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "building" }, id: { type: "string" }, entrance: { type: "string" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "cell" }, id: { type: "string" } } },
            { type: "object", required: ["kind", "id"], properties: { kind: { const: "node" }, id: { type: "string" } } }
          ]
        },
        AssetChoice: {
          oneOf: [
            {
              type: "object",
              required: ["mode", "asset_id"],
              properties: {
                mode: { const: "reuse" },
                asset_id: { type: "string", description: "Exact id returned by GET /assets" }
              }
            },
            {
              type: "object",
              required: ["mode", "spec"],
              properties: {
                mode: { const: "produce" },
                spec: {
                  type: "object",
                  required: ["archetype", "footprint", "district_style", "creative_brief"],
                  properties: {
                    archetype: { type: "string" },
                    footprint: { enum: ["1x1", "1x2", "1x3", "2x2", "4x1", "4x2"] },
                    district_style: { type: "string" },
                    patterns: { type: "array", items: { type: "string" } },
                    creative_brief: { type: "string", minLength: 1 }
                  }
                }
              }
            }
          ]
        },
        ConstructionRequest: {
          type: "object",
          required: ["expected_city_version", "site", "program", "design", "asset"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0, description: "Version from the latest snapshot or preview" },
            actor_note: { type: "string", description: "Short factual reason for this construction" },
            site: {
              type: "object",
              required: ["lot_id", "footprint", "entrance"],
              properties: {
                lot_id: { type: "string", description: "lotId returned by POST /site-searches; site.lotId is also accepted" },
                footprint: { enum: ["1x1", "1x2", "1x3", "2x2", "4x1", "4x2"] },
                entrance: { enum: ["north", "east", "south", "west"] }
              }
            },
            program: {
              type: "object",
              required: ["archetype", "name"],
              properties: {
                archetype: { type: "string", description: "For reuse this must exactly match the selected asset archetype" },
                purpose: { type: "string" },
                name: { type: "string", minLength: 1 },
                description: { type: "string" },
                attributes: json
              }
            },
            design: {
              type: "object",
              required: ["district_style", "creative_brief"],
              properties: {
                district_style: { type: "string" },
                patterns: { type: "array", items: { type: "string" } },
                creative_brief: { type: "string", minLength: 1 }
              }
            },
            asset: { $ref: "#/components/schemas/AssetChoice" },
            connection: {
              type: "object",
              properties: {
                target: { $ref: "#/components/schemas/Endpoint" },
                mode: { const: "road" }
              }
            }
          }
        }
      }
    },
    paths: {
      "/players": { post: operation("Create a development player account", "public", json, json, false) },
      "/cities": {
        get: operation("List the authenticated player's cities", "cities"),
        post: operation("Create a private city", "cities", json)
      },
      "/cities/{city_id}": { get: operation("Read a city summary", "cities") },
      "/cities/{city_id}/snapshot": { get: operation("Read the Agent decision snapshot", "queries") },
      "/cities/{city_id}/render-state": { get: operation("Read the authenticated city state for the visual viewer", "queries") },
      "/cities/{city_id}/events": { get: operation("Read incremental city events", "queries") },
      "/cities/{city_id}/spatial": { get: operation("Query cells and occupants in a bounded grid rectangle", "queries") },
      "/cities/{city_id}/buildings": { get: operation("Find buildings by name, archetype, purpose, or bounding box", "queries") },
      "/cities/{city_id}/site-searches": { post: operation("Rank legal construction sites with score explanations", "construction", json) },
      "/assets": { get: operation("Search validated reusable assets", "assets") },
      "/cities/{city_id}/construction-previews": { post: operation("Preview cost, footprint, route, and asset compatibility", "construction", { $ref: "#/components/schemas/ConstructionRequest" }) },
      "/cities/{city_id}/construction-orders": { post: commandOperation("Submit an idempotent reuse or production construction order", "construction", { $ref: "#/components/schemas/ConstructionRequest" }) },
      "/cities/{city_id}/construction-orders/{order_id}": { get: operation("Read a construction order", "construction") },
      "/cities/{city_id}/construction-orders/{order_id}/cancel": { post: commandOperation("Cancel an asset-waiting construction order and release its site and frozen resources", "construction") },
      "/cities/{city_id}/connection-previews": { post: operation("Preview a building/cell/node road connection", "roads", json) },
      "/cities/{city_id}/connections": { post: commandOperation("Submit an idempotent road connection", "roads") },
      "/cities/{city_id}/time-advances": { post: commandOperation("Advance city time and recover output-based resources", "simulation") },
      "/cities/{city_id}/agent-links": { post: operation("Create a one-time Agent connection link", "credentials", json) },
      "/cities/{city_id}/agent-credentials": { get: operation("List Agent credentials", "credentials") },
      "/cities/{city_id}/agent-credentials/{credential_id}": { delete: operation("Revoke an Agent credential", "credentials") },
      "/asset-jobs/{job_id}": { get: operation("Read asset production status", "assets") },
      "/asset-jobs/{job_id}/artifacts": { post: commandOperation("Supply an image generated through the Codex/manual bridge", "assets") }
    }
  };
  for (const [route, pathItem] of Object.entries(document.paths)) {
    const names = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    for (const operation of Object.values(pathItem)) {
      operation.parameters ??= [];
      for (const name of names) operation.parameters.push({ in: "path", name, required: true, schema: { type: "string" } });
    }
  }
  return document;
}

function operation(summary, tag, requestBody = null, responseSchema = json, secured = true) {
  const value = {
    summary,
    tags: [tag],
    responses: {
      200: { description: "Success", content: { "application/json": { schema: responseSchema } } },
      400: { description: "Invalid request", content: { "application/json": { schema: error } } },
      401: { description: "Authentication failed", content: { "application/json": { schema: error } } },
      409: { description: "Version or idempotency conflict", content: { "application/json": { schema: error } } },
      422: { description: "Request is valid but incompatible with city or asset state", content: { "application/json": { schema: error } } },
      428: { description: "City version precondition is required", content: { "application/json": { schema: error } } }
    }
  };
  if (requestBody) value.requestBody = { required: true, content: { "application/json": { schema: requestBody } } };
  if (!secured) value.security = [];
  return value;
}

function commandOperation(summary, tag, requestBody = json) {
  const value = operation(summary, tag, requestBody);
  value.parameters = [
    { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } },
    { in: "header", name: "If-Match", required: false, schema: { type: "string" } }
  ];
  return value;
}
