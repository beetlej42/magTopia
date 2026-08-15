const json = { type: "object", additionalProperties: true };
const error = {
  type: "object",
  required: ["code", "message", "retryable"],
  properties: { code: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" }, details: json }
};

export function createOpenApiDocument(baseUrl) {
  const document = {
    openapi: "3.1.0",
    info: { title: "MAGTOPIA（麦托邦）Agent API", version: "1.0.0", description: "Private multi-city construction API for municipal Agents building living magic cities." },
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
                    footprint: { enum: ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] },
                    district_style: { type: "string" },
                    patterns: { type: "array", items: { type: "string" } },
                    guide_volume: { type: "string", pattern: "^[1-9][0-9]*x[1-9][0-9]*x[1-9][0-9]*$", description: "Exact integer width×depth×storeys scale contract. Base must match footprint and be at most 3×3. 1x1x1 always means a small one-storey detached building; 1x1x2 means the same parcel with exactly two occupied storeys." },
                    creative_brief: { type: "string", minLength: 1 }
                  }
                }
              }
            },
            {
              type: "object",
              required: ["mode"],
              properties: {
                mode: { const: "voxel", description: "Resolved by the service from a confirmed BuildingDesign; clients do not submit this mode directly." }
              }
            }
          ]
        },
        BuildingDesignConstructionRequest: {
          type: "object",
          required: ["expected_city_version", "design_id", "design_revision", "design_hash"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            district_id: { type: "string", description: "Named development district this building contributes to" },
            design_id: { type: "string" },
            design_revision: { type: "integer", minimum: 1 },
            design_hash: { type: "string", description: "Exact hash returned when the design revision was confirmed" },
            actor_note: { type: "string" }
          }
        },
        Site: {
          type: "object",
          required: ["lot_id", "footprint", "entrance"],
          properties: {
            lot_id: { type: "string", description: "lotId returned by POST /site-searches" },
            footprint: { enum: ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] },
            entrance: { enum: ["north", "east", "south", "west"] }
          }
        },
        BuildingIntent: {
          type: "object",
          description: "Semantic building brief. Choose purpose first, then composition/frontage/access/style/prominence. The x-agent-catalog below explains how each option changes the generated architecture; use it as the design vocabulary rather than guessing from enum names.",
          required: ["name", "purpose"],
          properties: {
            name: { type: "string", minLength: 1, description: "Human-readable building name." },
            purpose: { type: "string", minLength: 1, description: "What the building is for. Free text is also used to infer public program families such as residential, library, academy, greenhouse, workshop, civic, or generic_public." },
            description: { type: "string", description: "Optional concrete architectural or functional brief. Prefer observable requirements over generic adjectives." },
            sign_text: { type: "string", description: "Optional semantic sign wording. Decorative sign geometry is controlled separately through decorations." },
            composition: { enum: ["street", "court", "hall", "tower", "yard"], description: "Overall spatial organization. court/hall/tower/yard automatically favor urban_massing; street is the normal compact street-building composition." },
            frontage: { enum: ["residential", "display", "workshop", "institutional", "large_bay"], description: "Street-facing functional character. This changes ground-floor program, glazing/opening ratio, entrance treatment, and generation-mode recommendations." },
            access: { enum: ["private", "public", "service", "ceremonial"], description: "How the primary entrance should read. Public and ceremonial access strengthen entrance emphasis and can make an urban-massing building count as public architecture." },
            style: { enum: ["victorian_domestic", "victorian_gothic", "civic_classical", "industrial_iron", "alchemical_glass"], description: "Architectural language. For public buildings this changes massing, roof families, facade rhythm, and constrained materials, not only color." },
            prominence: { enum: ["ordinary", "important", "landmark"], description: "Urban hierarchy. Higher prominence increases default scale and height; landmark always favors urban_massing." },
            magic_level: { type: "number", minimum: 0, maximum: 1, description: "Continuous magical intensity. Higher values increase generated variation/detail and night-light contribution; keep ordinary background fabric restrained and reserve high values for intentional magical emphasis." },
            district_style: { type: "string", description: "Optional district-level style cue to preserve. For housing, use this with district_context so nearby buildings share a family." },
            variation_intent: { type: "string", description: "Optional high-level structural variation cue such as narrow_corner_house, stepped_frontage, hip_roof, or corner. Use one or two cues to vary a house without destroying district coherence." }
          },
          "x-agent-catalog": {
            version: "1.0",
            decisionOrder: ["purpose", "composition", "frontage", "access", "style", "prominence", "magic_level", "district_style", "variation_intent"],
            generationModeRules: {
              floor_stack: "Recommended for a 1x1 ordinary street building such as a house, shop, or small workshop.",
              urban_massing: "Recommended for multi-cell sites, institutional frontage, landmarks, and court/hall/tower/yard compositions.",
              auto: "Prefer auto unless the Agent has a specific reason to force a mode. Multi-cell footprint, institutional frontage, landmark prominence, or court/hall/tower/yard composition selects urban_massing."
            },
            composition: {
              street: { meaning: "Compact building organized primarily around the street frontage.", bestFor: ["residential", "shop", "small_workshop", "mixed_use"], effects: ["Normally compatible with floor_stack on 1x1 sites.", "Uses a street-oriented roof unless another cue overrides it."] },
              court: { meaning: "Multiple masses or wings organized around an internal court.", bestFor: ["academy", "inn", "archive", "institutional_compound"], effects: ["Selects urban_massing in auto mode.", "Useful when the interior open space is part of the identity."] },
              hall: { meaning: "A dominant broad public or productive hall.", bestFor: ["civic_hall", "market", "library_reading_hall", "workshop"], effects: ["Selects urban_massing in auto mode.", "In street adaptation it favors a cross-gable roof; in massing it favors hall-like presets/components."] },
              tower: { meaning: "Vertical silhouette organized around a tower or crown.", bestFor: ["landmark", "academy_tower", "clocktower", "magical_observatory"], effects: ["Selects urban_massing in auto mode.", "Encourages a strong crown/spire and taller silhouette."] },
              yard: { meaning: "Building masses arranged with a working or communal open yard.", bestFor: ["workshop", "industrial", "service_compound", "greenhouse_complex"], effects: ["Selects urban_massing in auto mode.", "Best when an external work/open area is intentional rather than leftover space."] }
            },
            frontage: {
              residential: { meaning: "Domestic street face with moderate openings and private-scale rhythm.", groundProgram: "home", approximateGroundWindowRatio: 0.38, bestFor: ["house", "residential_mixed_use"], effects: ["Ordinary/default frontage.", "Residential guidance asks the Agent to preserve district grammar and vary only one or two structural cues."] },
              display: { meaning: "Retail/display frontage with large ground-floor glazing.", groundProgram: "shop", approximateGroundWindowRatio: 0.86, bestFor: ["shop", "cafe", "potion_store", "wand_shop"], effects: ["Second floor may receive a selective balcony.", "A custom semantic_grid_sign is recommended before construction."] },
              workshop: { meaning: "Craft or production frontage with visibly productive openings.", groundProgram: "workshop", approximateGroundWindowRatio: 0.58, bestFor: ["artisan_workshop", "small_factory", "repair_shop"], effects: ["Upper floors default toward storage rather than home in floor_stack."] },
              institutional: { meaning: "Formal public/institutional frontage with controlled large openings and clear entrance hierarchy.", groundProgram: "home in floor_stack adapter; public program is expressed primarily through urban_massing", approximateGroundWindowRatio: 0.5, bestFor: ["library", "academy", "civic", "museum"], effects: ["Selects urban_massing in auto mode.", "Defaults style to civic_classical when style is omitted."] },
              large_bay: { meaning: "Wide-span productive frontage for large doors/windows or loading-like openings.", groundProgram: "workshop", approximateGroundWindowRatio: 0.7, bestFor: ["industrial_hall", "large_workshop", "depot"], effects: ["Favors a cross-gable roof in street adaptation.", "Upper floors default toward storage in floor_stack."] }
            },
            access: {
              private: { meaning: "Resident/staff-oriented entrance with restrained emphasis.", effects: ["Urban-massing entrance emphasis may be reduced.", "Street adaptation can keep a less exposed corner-facade treatment unless variation_intent requests a corner condition."] },
              public: { meaning: "Clearly readable everyday public entrance.", effects: ["Strengthens entrance emphasis.", "Can classify a non-residential urban-massing design for public architecture review."] },
              service: { meaning: "Operational/service access rather than ceremonial frontage.", effects: ["Use for workshops, yards, and back-of-house functions when the entrance should read utilitarian."] },
              ceremonial: { meaning: "Formal civic or landmark arrival.", effects: ["Strengthens entrance emphasis.", "Can classify a non-residential urban-massing design for public architecture review."] }
            },
            style: {
              victorian_domestic: { meaning: "Dense London domestic fabric: narrow plots, brick, varied gables/mansards and chimney rhythm.", bestFor: ["housing", "shops", "background_street_fabric"], effects: ["Street palette maps to london_brick.", "Public massing uses narrow-unit/stepped domestic grammar rather than a simple recolor."] },
              victorian_gothic: { meaning: "Vertical Gothic Victorian language with narrow tall openings, pointed details, steep roofs, buttress/spire cues.", bestFor: ["academy", "library", "occult_shop", "important_residence"], effects: ["Street palette maps to violet_alchemist.", "Public massing uses gothic facade/roof grammar."] },
              civic_classical: { meaning: "Formal civic language with broad symmetry, stone hierarchy, colonnade/pediment and restrained dome/crown accents.", bestFor: ["civic", "library", "museum", "institution"], effects: ["Default for institutional frontage or landmark when style is omitted.", "Public buildings use full civic massing grammar."] },
              industrial_iron: { meaning: "Victorian industrial language with dark brick/iron, asymmetry, sawtooth or utilitarian roofs, large windows, canopies and chimney stacks.", bestFor: ["factory", "workshop", "depot", "infrastructure"], effects: ["Street ridge position shifts off-center.", "Public massing uses industrial form/material grammar."] },
              alchemical_glass: { meaning: "Magical research/greenhouse language using patinated metal, teal glass, glass halls, arched greenhouse roofs and distillation-tower cues.", bestFor: ["greenhouse", "alchemical_lab", "research_building"], effects: ["Framed masses prefer tealGlass panels.", "Public massing uses glass-and-patina architectural grammar."] }
            },
            prominence: {
              ordinary: { meaning: "Background fabric; should not compete with anchors.", defaultSiteCells: [2, 2], floorStackDefaultFloors: 2, effects: ["Smallest default urban hierarchy."] },
              important: { meaning: "Block/district anchor that deserves extra height or presence without becoming a city landmark.", defaultSiteCells: [3, 2], floorStackDefaultFloors: 3, effects: ["Floor-stack upper levels can receive a small setback.", "Non-residential urban_massing is reviewed as public architecture when applicable."] },
              landmark: { meaning: "City/district landmark with a deliberately dominant silhouette.", defaultSiteCells: [5, 3], floorStackDefaultFloors: 4, effects: ["Always selects urban_massing in auto mode.", "Defaults style to civic_classical when style is omitted."] }
            },
            magicLevel: {
              range: [0, 1],
              bands: [
                { range: [0, 0.3], meaning: "restrained/background magical character" },
                { range: [0.3, 0.7], meaning: "normal MAGTOPIA magical London character" },
                { range: [0.7, 1], meaning: "strong magical emphasis; use intentionally for special buildings" }
              ],
              effects: {
                nightLighting: "default = magic_level * 0.18",
                floorStackVariation: "default = clamp(0.48 + magic_level * 0.35, 0, 1)",
                floorStackDetailDensity: "default = clamp(0.70 + magic_level * 0.25, 0, 1)",
                urbanMassingDetailDensity: "solid masses default = clamp(0.72 + magic_level * 0.25, 0, 1)"
              }
            },
            districtStyle: { meaning: "Named/shared district architecture cue. Preserve it across nearby housing instead of making every house globally unique." },
            variationIntent: { meaning: "One or two high-level structural changes relative to the district family.", examples: ["narrow_corner_house", "stepped_frontage", "hip_roof", "corner"], effects: ["Words containing hip or corner favor a hip roof in floor_stack.", "corner also requests a more explicit corner-facade condition."] },
            publicBuildingReview: "For public urban_massing, inspect actualArchitecture and architectureReview after generation. Correct one or two components with update_mass; regenerate_from_intent when the overall scheme is wrong.",
            residentialGuidance: "For residential floor_stack, read nearby buildings and district purpose, pass district_context, preserve two or three shared cues, and vary one or two structural cues."
          }
        },
        Decoration: {
          type: "object",
          required: ["id", "type", "anchor"],
          properties: {
            id: { type: "string" },
            type: { enum: ["hanging_sign", "semantic_grid_sign", "facade_lamp", "magic_lamp", "roof_finial"] },
            anchor: { type: "string", description: "Use an anchor pattern returned in availableOperations" },
            parameters: json
          }
        },
        BuildingDesignCreateRequest: {
          type: "object",
          required: ["generation_mode", "site", "intent"],
          properties: {
            generation_mode: { enum: ["auto", "floor_stack", "urban_massing"], description: "Prefer auto. See BuildingIntent.x-agent-catalog.generationModeRules for the exact recommendation rules." },
            site: { $ref: "#/components/schemas/Site" },
            intent: { $ref: "#/components/schemas/BuildingIntent" },
            requirements: { type: "object", properties: { preferred_floors: { type: "integer", minimum: 1, maximum: 8, description: "Optional initial floor count for floor_stack; defaults are derived from prominence." }, variant_id: { type: "string", description: "Optional public-building variant from the generated catalog returned by the design response." } } },
            district_context: {
              type: "object",
              description: "Optional district context used to keep residential buildings coherent while varying one or two structural cues",
              additionalProperties: true,
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                purpose: { type: "string" },
                style: { type: "string" },
                district_style: { type: "string" },
                character: { type: "string" },
                preserve: { type: "array", items: { type: "string" } },
                vary: { type: "array", items: { type: "string" } },
                change: { type: "array", items: { type: "string" } },
                existing_features: { type: "array", items: { type: "string" } },
                notes: { type: "string" }
              }
            },
            decorations: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Decoration" } } } },
            locks: { type: "array", items: { type: "string" } }
          }
        },
        BuildingDesignRevisionRequest: {
          type: "object",
          required: ["expected_revision", "operations"],
          properties: {
            expected_revision: { type: "integer", minimum: 1 },
            operations: { type: "array", minItems: 1, items: { type: "object", required: ["op"], properties: { op: { enum: ["set_intent", "regenerate_from_intent", "set_roof", "set_material", "add_decoration", "update_decoration", "remove_decoration", "add_floor", "set_floor_program", "add_mass", "update_mass", "remove_mass"] }, decoration: { $ref: "#/components/schemas/Decoration" } }, additionalProperties: true } }
          }
        },
        BuildingDesignConfirmRequest: {
          type: "object",
          required: ["expected_revision"],
          properties: { expected_revision: { type: "integer", minimum: 1 } }
        },
        DistrictCreateRequest: {
          type: "object",
          required: ["expected_city_version", "name", "purpose", "bounds"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            name: { type: "string", minLength: 1, maxLength: 80 },
            purpose: { type: "string", minLength: 1, maxLength: 160 },
            actor_note: { type: "string" },
            bounds: {
              description: "Spatial work package. The response contains a soft 24–48-cell scale reference and derived block observations; unusual or larger shapes remain legal.",
              type: "object",
              required: ["minColumn", "minRow", "maxColumn", "maxRow"],
              properties: {
                minColumn: { type: "integer" },
                minRow: { type: "integer" },
                maxColumn: { type: "integer" },
                maxRow: { type: "integer" }
              }
            }
          }
        },
        DistrictCancelRequest: {
          type: "object",
          required: ["expected_city_version"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            reason: { type: "string", maxLength: 160, description: "Why this planning context is being released; existing roads and buildings are preserved." },
            actor_note: { type: "string", maxLength: 160 }
          }
        },
        SiteSearchRequest: {
          type: "object",
          required: ["footprint"],
          properties: {
            footprint: { enum: ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] },
            district_id: { type: "string", description: "Use the persisted spatial layout and advisory observations of this named development district" },
            limit: { type: "integer", minimum: 1, maximum: 100 }
          }
        },
        ConnectionRequest: {
          type: "object",
          required: ["from", "to"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            from: { $ref: "#/components/schemas/Endpoint" },
            to: { $ref: "#/components/schemas/Endpoint" },
            mode: { const: "road" },
            actor_note: { type: "string" }
          }
        },
        ConstructionRequest: {
          type: "object",
          required: ["expected_city_version", "site", "program", "design", "asset"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0, description: "Version from the latest snapshot or preview" },
            district_id: { type: "string", description: "Named development district this building contributes to" },
            actor_note: { type: "string", description: "Short factual reason for this construction" },
            site: {
              type: "object",
              required: ["lot_id", "footprint", "entrance"],
              properties: {
                lot_id: { type: "string", description: "lotId returned by POST /site-searches; site.lotId is also accepted" },
                footprint: { enum: ["1x1", "1x2", "1x3", "2x1", "2x2", "2x3", "3x1", "3x2", "3x3"] },
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
      "/cities/{city_id}/districts": {
        get: operation("List named development districts with block, road, and spatially computed building progress", "districts"),
        post: commandOperation("Name and designate a spatial development district with advisory block guidance", "districts", { $ref: "#/components/schemas/DistrictCreateRequest" })
      },
      "/cities/{city_id}/districts/{district_id}/cancel": {
        post: commandOperation("Release a district's planning context while preserving existing roads and buildings", "districts", { $ref: "#/components/schemas/DistrictCancelRequest" })
      },
      "/cities/{city_id}/building-designs": {
        get: operation("List versioned building designs", "building-designs"),
        post: operation("Create a recommended editable design using floor-stack or urban-massing generation", "building-designs", { $ref: "#/components/schemas/BuildingDesignCreateRequest" })
      },
      "/cities/{city_id}/building-designs/{design_id}": { get: operation("Read the current building design revision", "building-designs") },
      "/cities/{city_id}/building-designs/{design_id}/revisions": { post: operation("Apply structured operations and create an immutable design revision", "building-designs", { $ref: "#/components/schemas/BuildingDesignRevisionRequest" }) },
      "/cities/{city_id}/building-designs/{design_id}/confirm": { post: operation("Lock the current design revision for construction", "building-designs", { $ref: "#/components/schemas/BuildingDesignConfirmRequest" }) },
      "/cities/{city_id}/buildings/{building_id}/upgrade-designs": { post: operation("Create an editable upgrade design from a built voxel design", "building-designs", json) },
      "/cities/{city_id}/site-searches": { post: operation("List legal construction sites and objective road-frontage facts inside a named district", "construction", { $ref: "#/components/schemas/SiteSearchRequest" }) },
      "/assets": { get: operation("Search validated reusable assets", "assets") },
      "/cities/{city_id}/construction-previews": { post: operation("Preview a legacy asset request or confirmed voxel design", "construction", { oneOf: [{ $ref: "#/components/schemas/ConstructionRequest" }, { $ref: "#/components/schemas/BuildingDesignConstructionRequest" }] }) },
      "/cities/{city_id}/construction-orders": { post: commandOperation("Submit an idempotent asset or confirmed voxel-design construction order", "construction", { oneOf: [{ $ref: "#/components/schemas/ConstructionRequest" }, { $ref: "#/components/schemas/BuildingDesignConstructionRequest" }] }) },
      "/cities/{city_id}/construction-orders/{order_id}": { get: operation("Read a construction order", "construction") },
      "/cities/{city_id}/construction-orders/{order_id}/cancel": { post: commandOperation("Cancel an asset-waiting construction order and release its site and frozen resources", "construction") },
      "/cities/{city_id}/connection-previews": { post: operation("Preview a building/cell/node road connection", "roads", { $ref: "#/components/schemas/ConnectionRequest" }) },
      "/cities/{city_id}/connections": { post: commandOperation("Submit an idempotent road connection", "roads", { $ref: "#/components/schemas/ConnectionRequest" }) },
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