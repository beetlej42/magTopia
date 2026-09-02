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
          required: ["expected_city_version", "design_id", "design_revision", "design_hash", "gameplay_building"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            district_id: { type: "string", description: "Named development district this building contributes to" },
            design_id: { type: "string" },
            design_revision: { type: "integer", minimum: 1 },
            design_hash: { type: "string", description: "Exact hash returned when the design revision was confirmed" },
            actor_note: { type: "string" },
            gameplay_building: { $ref: "#/components/schemas/GameplayGrammarContainer", description: "Canonical v0.3 functional-unit grammar remains explicit even when site/program/design are resolved from a confirmed visual design." }
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
        BuildingDesignUpgradeRequest: {
          type: "object",
          description: "Accepted inputs for creating an editable upgrade design from a built voxel design. The design id and actor are server-owned and always assigned by the runtime; clients only provide the upgrade goal.",
          properties: {
            goal: {
              type: "object",
              required: ["type"],
              properties: {
                type: { enum: ["add_floor", "add_floors"], description: "add_floor is the canonical operation; add_floors is accepted as an alias." },
                count: { type: "integer", minimum: 1, default: 1, description: "Number of storeys to add to the existing building." }
              }
            }
          }
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
        GameplayFunctionalUnit: {
          type: "object",
          required: ["purpose"],
          additionalProperties: false,
          properties: {
            purpose: { enum: ["residential", "commercial", "public_service", "production", "greenhouse"] },
            area: { type: "integer", minimum: 1 },
            functionalArea: { type: "integer", minimum: 1 },
            cells: { type: "array", minItems: 1 },
            magicRatio: { enum: [0, 0.25, 0.5, 0.75, 1] },
            type: { type: "string" },
            name: { type: "string" }
          }
        },
        GameplayGrammarContainer: {
          type: "object",
          additionalProperties: false,
          properties: {
            purpose: { enum: ["residential", "commercial", "public_service", "production", "greenhouse"] },
            magicRatio: { enum: [0, 0.25, 0.5, 0.75, 1] },
            defaultMagicRatio: { enum: [0, 0.25, 0.5, 0.75, 1] },
            units: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            functionalUnits: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            floors: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            floorSpecs: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            floorPrograms: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            masses: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
            massSpecs: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } }
          },
          oneOf: [
            { required: ["units"] }, { required: ["functionalUnits"] },
            { required: ["floors"] }, { required: ["floorSpecs"] },
            { required: ["floorPrograms"] }, { required: ["masses"] },
            { required: ["massSpecs"] }
          ]
        },
        ConstructionRequest: {
          type: "object",
          required: ["expected_city_version", "site", "program", "gameplay_building", "design", "asset"],
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
            gameplay_building: {
              type: "object",
              description: "Canonical v0.3 functional-unit grammar. Costs use only these units; renderer or mesh fields are not gameplay authority. canonical and pricingFacts are server-owned and must not be submitted.",
              additionalProperties: false,
              properties: {
                purpose: { enum: ["residential", "commercial", "public_service", "production", "greenhouse"] },
                magicRatio: { enum: [0, 0.25, 0.5, 0.75, 1] },
                defaultMagicRatio: { enum: [0, 0.25, 0.5, 0.75, 1] },
                units: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                functionalUnits: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                floors: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                floorSpecs: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                floorPrograms: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                masses: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                massSpecs: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/GameplayFunctionalUnit" } },
                grammar: { $ref: "#/components/schemas/GameplayGrammarContainer" },
                massing: { $ref: "#/components/schemas/GameplayGrammarContainer" }
              },
              oneOf: [
                { required: ["units"] }, { required: ["functionalUnits"] },
                { required: ["floors"] }, { required: ["floorSpecs"] },
                { required: ["floorPrograms"] }, { required: ["masses"] },
                { required: ["massSpecs"] }, { required: ["grammar"] },
                { required: ["massing"] }
              ]
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
        },
        StrategyIncident: {
          type: "object",
          required: ["id", "building_id", "type", "attribute", "dc", "severity", "summary", "status"],
          properties: {
            id: { type: "string" },
            building_id: { type: "string" },
            building_name: { type: ["string", "null"] },
            type: { enum: ["investigation", "suppression", "cover_up"] },
            attribute: { enum: ["investigation", "suppression", "coverUp"] },
            dc: { type: "integer", enum: [10, 14, 18] },
            difficulty_tier: { enum: ["normal", "hard", "severe"] },
            severity: { type: "integer", minimum: 1, maximum: 5 },
            exposure_at_creation: { type: "number" },
            historical_risk_at_creation: { type: "integer", minimum: 0, maximum: 4 },
            historical_risk: { type: "integer", minimum: 0, maximum: 4 },
            source_risk: { type: ["object", "null"], additionalProperties: true },
            summary: { type: "string" },
            status: { enum: ["open", "assigned", "resolved", "failed", "escalated"] },
            created_at_turn: { type: "integer" }
          }
        },
        CardDefinition: {
          type: "object",
          required: ["card_id", "type", "title", "description", "decision_mode", "duration", "choice_kind", "family", "unique", "free_placement", "placement_required"],
          properties: {
            card_id: { type: "string" },
            type: { enum: ["special_structure", "resource", "personnel", "policy", "building", "people"] },
            title: { type: "string" },
            description: { type: "string" },
            decision_mode: { enum: ["immediate", "player_place", "delegate_to_agent"], description: "player_place and delegate_to_agent are two resolution choices of the same special structure card, never two separate cards." },
            choice_kind: { enum: ["ordinary", "special", null] },
            family: { type: ["string", "null"] },
            unique: { type: "boolean" },
            free_placement: { type: "boolean", description: "System-owned entitlement; special structures are free to place." },
            placement_required: { type: "boolean" },
            duration: { oneOf: [{ type: "string", const: "instant" }, { type: "object", properties: { type: { type: "string" }, turns: { type: "integer" } } }] },
            structure: { type: "object", nullable: true, description: "System-owned placement spec for special structure cards." },
            effect: json
          }
        },
        CardOffer: {
          type: "object",
          required: ["offer_id", "turn", "choice_kind", "eligibility_audit", "cards"],
          properties: {
            offer_id: { type: "string" },
            turn: { type: "integer" },
            choice_kind: { enum: ["ordinary", "special"] },
            eligibility_audit: { type: "array", items: { type: "object", additionalProperties: true } },
            cards: { type: "array", minItems: 3, maxItems: 3, items: { $ref: "#/components/schemas/CardDefinition" } }
          }
        },
        CardChoice: {
          type: "object",
          required: ["status"],
          properties: {
            offer_id: { type: ["string", "null"] },
            status: { enum: ["pending", "selected", "skipped", "resolved", "not_applicable"], description: "not_applicable is authoritative for the turn-0 bootstrap no-card state." },
            choice_kind: { enum: ["ordinary", "special", null] },
            selected_card_id: { type: ["string", "null"] },
            decision_mode: { type: ["string", "null"] },
            choice_resolved_at: { type: ["string", "null"] },
            card_effects: json
          }
        },
        CardSelectRequest: {
          type: "object",
          required: ["expected_city_version", "offer_id", "selected_card_id"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            offer_id: { type: "string", description: "offer_id returned by GET /cards/current" },
            selected_card_id: { type: "string", description: "one of the offered card ids; the player may select exactly one card per turn" },
            decision_mode: { enum: ["player_place", "delegate_to_agent"], description: "required for special structure cards; must never carry effect values or balance parameters" },
            actor_note: { type: "string" }
          }
        },
        CardSelectResponse: {
          type: "object",
          required: ["command_id", "status", "city_version_before", "city_version_after", "turn", "selected_card_id"],
          properties: {
            command_id: { type: "string" },
            status: { const: "selected" },
            city_version_before: { type: "integer" },
            city_version_after: { type: "integer" },
            turn: { type: "integer" },
            selected_card_id: { type: "string" },
            card_effects: json,
            choice: { $ref: "#/components/schemas/CardChoice" }
          }
        },
        CardPlaceRequest: {
          type: "object",
          required: ["expected_city_version", "card_id"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            card_id: { type: "string", description: "the selected special structure card with a pending placement" },
            placement_id: { type: "string", description: "stable placement id from the strategy context. Required when the city holds several pending delegated placements so an older mandate is never shadowed." },
            lot_id: { type: "string", description: "legal lot id for the structure footprint; validated through the authoritative cell system" },
            footprint: { type: "string", description: "defaults to the system-owned structure footprint" },
            entrance: { enum: ["north", "east", "south", "west"], description: "defaults to south" },
            actor_note: { type: "string" }
          }
        },
        CardPlaceResponse: {
          type: "object",
          required: ["command_id", "status", "city_version_before", "city_version_after", "turn", "building_id"],
          properties: {
            command_id: { type: "string" },
            status: { const: "placed" },
            city_version_before: { type: "integer" },
            city_version_after: { type: "integer" },
            turn: { type: "integer" },
            building_id: { type: "string" },
            placement: json,
            choice: { $ref: "#/components/schemas/CardChoice" }
          }
        },
        CardCancelRequest: {
          type: "object",
          required: ["expected_city_version", "placement_id"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            placement_id: { type: "string" },
            actor_note: { type: "string" }
          }
        },
        ActivePolicy: {
          type: "object",
          required: ["policy_id", "source_card_id", "duration_type", "duration_turns", "remaining_turns"],
          properties: {
            policy_id: { type: "string" },
            source_card_id: { type: "string" },
            started_at_turn: { type: "integer" },
            duration_type: { enum: ["instant", "turns", "until_replaced"] },
            duration_turns: { type: "integer" },
            remaining_turns: { type: "integer" },
            effects: { type: "array", items: json }
          }
        },
        PendingPlacement: {
          type: "object",
          required: ["placement_id", "card_id", "mode", "status"],
          properties: {
            placement_id: { type: "string" },
            card_id: { type: "string" },
            mode: { enum: ["player_place", "delegate_to_agent"] },
            status: { enum: ["pending", "deferred", "completed", "cancelled"] },
            delegated_at_turn: { type: "integer" },
            card: json
          }
        },
        StrategyCards: {
          type: "object",
          required: ["offer", "choice", "active_policies", "pending_placements"],
          properties: {
            offer: { $ref: "#/components/schemas/CardOffer" },
            choice: { $ref: "#/components/schemas/CardChoice" },
            active_policies: { type: "array", items: { $ref: "#/components/schemas/ActivePolicy" } },
            pending_placements: { type: "array", items: { $ref: "#/components/schemas/PendingPlacement" } }
          }
        },
        ArcaneOfficer: {
          type: "object",
            required: ["id", "name", "archetype", "appearance_seed", "visual_ref", "investigation", "suppression", "cover_up", "specialty", "specialties", "status", "hired_at_turn", "history"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            appearance_seed: { type: ["string", "null"] },
            visual_ref: { type: ["string", "null"] },
            archetype: { type: "string" },
            investigation: { type: "integer", minimum: 0, maximum: 5 },
            suppression: { type: "integer", minimum: 0, maximum: 5 },
            cover_up: { type: "integer", minimum: 0, maximum: 5 },
            specialty: { enum: ["residential", "commercial", "public_service", "production", "greenhouse", null] },
            specialties: { type: "array", items: { type: "string" } },
            status: { enum: ["available", "assigned", "unavailable"] },
            hired_at_turn: { type: "integer" },
            history: { type: "array", maxItems: 50, items: { $ref: "#/components/schemas/ArcaneOfficerHistoryEntry" } }
          }
        },
        ArcaneOfficerHistoryEntry: {
          type: "object", additionalProperties: false,
          required: ["turn", "incident_id", "building_id", "source_purpose", "attribute", "outcome", "growth_roll", "growth_chance", "before", "after", "gained"],
          properties: { turn: { type: "integer" }, incident_id: { type: "string" }, building_id: { type: "string" }, source_purpose: { type: ["string", "null"] }, attribute: { type: "string" }, outcome: { type: "string" }, growth_roll: { type: "number", minimum: 0, maximum: 1 }, growth_chance: { type: "number", minimum: 0, maximum: 1 }, before: { type: "integer", minimum: 0, maximum: 5 }, after: { type: "integer", minimum: 0, maximum: 5 }, gained: { type: "integer", minimum: 0, maximum: 1 } }
        },
        ArcaneOfficerCandidate: {
          type: "object", additionalProperties: false, required: ["candidate_id", "identity", "cost_coins", "window"],
          properties: { candidate_id: { type: "string" }, identity: { $ref: "#/components/schemas/ArcaneOfficer" }, cost_coins: { type: "integer", minimum: 120, maximum: 180 }, window: { type: "integer", minimum: 0 } }
        },
        ArcaneOfficerRecruitment: {
          type: "object", additionalProperties: false, required: ["unlocked", "status", "capacity", "roster_size", "config", "pool_window", "candidates"],
          properties: { unlocked: { type: "boolean" }, status: { enum: ["available", "locked"] }, capacity: { type: "integer", minimum: 0 }, roster_size: { type: "integer", minimum: 0 }, config: { type: "object", additionalProperties: false, required: ["refresh_interval_turns", "candidate_count", "hire_cost_coins", "maintenance_coins_per_turn", "capacity_divisor", "growth_chance", "critical_growth_chance", "attribute_cap"], properties: { refresh_interval_turns: { type: "integer" }, candidate_count: { type: "integer", minimum: 2, maximum: 3 }, hire_cost_coins: { type: "integer", minimum: 120, maximum: 180 }, maintenance_coins_per_turn: { type: "integer", minimum: 8, maximum: 12 }, capacity_divisor: { type: "integer" }, growth_chance: { type: "number" }, critical_growth_chance: { type: "number" }, attribute_cap: { type: "integer", maximum: 5 } } }, pool_window: { type: ["integer", "null"] }, candidates: { type: "array", items: { $ref: "#/components/schemas/ArcaneOfficerCandidate" } } }
        },
        OfficerRecruitmentRequest: {
          type: "object", additionalProperties: false, required: ["candidate_id", "expected_city_version"],
          properties: { candidate_id: { type: "string", minLength: 1 }, expected_city_version: { type: "integer", minimum: 0 }, actor_note: { type: "string" } }
        },
        OfficerRecruitmentResponse: { type: "object", additionalProperties: true, required: ["command_id", "status", "city_version_before", "city_version_after", "officer", "cost_coins", "strategy"], properties: { command_id: { type: "string" }, status: { const: "accepted" }, city_version_before: { type: "integer" }, city_version_after: { type: "integer" }, officer: { $ref: "#/components/schemas/ArcaneOfficer" }, cost_coins: { type: "integer" }, strategy: { $ref: "#/components/schemas/StrategyPayload" }, idempotent_replay: { type: "boolean" } } },
        StrategyAssignment: {
          type: "object",
          description: "A dispatch instruction. Only these fields are accepted; the system owns every numeric balance parameter.",
          required: ["incident_id", "arcane_officer_id"],
          properties: {
            incident_id: { type: "string" },
            arcane_officer_id: { type: "string" },
            rationale: { type: "string", description: "Optional advisory dispatch reason. Never affects the roll, outcome, or balance." }
          }
        },
        StrategyAssignmentsRequest: {
          type: "object",
          required: ["expected_city_version", "assignments"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            assignments: { type: "array", maxItems: 20, items: { $ref: "#/components/schemas/StrategyAssignment" } },
            actor_note: { type: "string" }
          }
        },
        StrategyResolveRequest: {
          type: "object",
          required: ["expected_city_version"],
          properties: {
            expected_city_version: { type: "integer", minimum: 0 },
            actor_note: { type: "string" }
          }
        },
        TurnFacts: {
          type: "object",
          description: "Immutable system-generated settlement record. Agents read rolls, outcomes, and state changes here; they never author them.",
          required: ["turn", "turnKind", "bootstrapProgress", "resourceDelta", "netResourceDelta", "officerMaintenance", "populationDelta", "publicService", "buildingsStarted", "buildingsCompleted", "buildingFactRefs", "constructionRefs", "exposureChanges", "incidents", "incidentRolls", "unaddressedIncidents", "historicalRiskChanges", "assignments", "rolls", "outcomes", "sealedBuildings", "nextRisks", "choiceKind", "offerChoiceKind", "specialCadence", "eligibilityAudit"],
          properties: {
            turn: { type: "integer" },
            turnKind: { enum: ["bootstrap", "normal"] },
            choiceKind: { enum: ["ordinary", "special", null] },
            offerChoiceKind: { enum: ["ordinary", "special", null] },
            specialCadence: { type: "boolean" },
            eligibilityAudit: { type: "array", items: { type: "object", additionalProperties: true } },
            bootstrapProgress: { oneOf: [{ $ref: "#/components/schemas/BootstrapProgress" }, { type: "null" }] },
            wallClock: { type: "object", nullable: true, additionalProperties: true },
            resourceDelta: { type: "object", properties: { coins: { type: "integer", minimum: 0 }, arcaneEnergy: { type: "number", minimum: 0 } }, required: ["coins", "arcaneEnergy"], additionalProperties: false },
            netResourceDelta: { type: "object", properties: { coins: { type: "integer" }, arcaneEnergy: { type: "number" } }, required: ["coins", "arcaneEnergy"], additionalProperties: false },
            officerMaintenance: { type: "object", additionalProperties: false, required: ["count", "rate", "total", "charged", "unpaid"], properties: { count: { type: "integer" }, rate: { type: "integer" }, total: { type: "integer" }, charged: { type: "integer" }, unpaid: { type: "integer" } } },
            populationDelta: { type: "object", additionalProperties: true },
            publicService: {
              type: "object",
              description: "System-derived spatial public-service coverage and supported population target for this settlement.",
              properties: {
                radius: { type: "number", minimum: 0 },
                residentialFunctionalArea: { type: "number", minimum: 0 },
                residentialCapacity: { type: "number", minimum: 0 },
                serviceCapacity: { type: "number", minimum: 0 },
                serviceCoverage: { type: "number", minimum: 0, maximum: 1 },
                supportedOccupancy: { type: "number", minimum: 0, maximum: 1 },
                supportedTarget: { type: "object", additionalProperties: true },
                migrationRate: { type: "object", additionalProperties: true },
                outboundMigrationRate: {
                  type: "object",
                  properties: {
                    muggles: { type: "number", minimum: 0, maximum: 1 },
                    wizards: { type: "number", minimum: 0, maximum: 1 }
                  },
                  required: ["muggles", "wizards"],
                  additionalProperties: false
                },
                details: { type: "array", items: { type: "object", additionalProperties: true } }
              },
              required: ["radius", "serviceCoverage", "supportedTarget", "migrationRate", "outboundMigrationRate"]
            },
            exposureChanges: { type: "object", additionalProperties: true },
            incidents: { type: "array", items: { $ref: "#/components/schemas/StrategyIncident" } },
            incidentRolls: { type: "array", description: "System-owned independent threshold roll for every eligible canonical MagicLoad building.", items: { type: "object", required: ["buildingId", "finalIncidentChance", "thresholdRoll", "hit", "sourcePurpose", "purposeWeights"], properties: { buildingId: { type: "string" }, finalIncidentChance: { type: "number" }, thresholdRoll: { type: "number" }, hit: { type: "boolean" }, magicLoad: { type: "number" }, baseRisk: { type: "number" }, spatialModifier: { type: "number" }, historicalRisk: { type: "integer" }, sourcePurpose: { type: ["string", "null"] }, purposeWeights: { type: "object", additionalProperties: { type: "number" } } } } },
            historicalRiskChanges: { type: "object", additionalProperties: { type: "object", properties: { buildingId: { type: "string" }, before: { type: "integer" }, after: { type: "integer" }, delta: { type: "integer" }, incidentIds: { type: "array", items: { type: "string" } }, sealed: { type: "boolean" } } } },
            unaddressedIncidents: { type: "array", items: { type: "object", properties: { incidentId: { type: "string" }, buildingId: { type: "string" }, type: { type: "string" }, severity: { type: "number" }, status: { const: "failed" }, outcome: { const: "failure" }, resolution: { const: "unaddressed" }, historicalRiskBefore: { type: "integer" }, historicalRiskAfter: { type: "integer" }, historicalRiskDelta: { type: "integer" }, sealed: { type: "boolean" }, createdAtTurn: { type: "number" } } }, description: "Incidents left unassigned are settled once through the conservative failure path and recorded as failed." },
            assignments: { type: "array", items: { type: "object", properties: { incidentId: { type: "string" }, arcaneOfficerId: { type: "string" } } } },
            rolls: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  incidentId: { type: "string" },
                  arcaneOfficerId: { type: "string" },
                  attribute: { type: "string" },
                  rawRoll: { type: "integer", minimum: 1, maximum: 20 },
                  attributeValue: { type: "integer" },
                  specialtyBonus: { type: "integer" },
                  otherModifiers: { type: "integer" },
                  total: { type: "integer" },
                  dc: { type: "integer", enum: [10, 14, 18] },
                  margin: { type: "integer" },
                  outcome: { enum: ["critical_success", "success", "failure", "critical_failure"] },
                  historicalRiskBefore: { type: "integer" },
                  historicalRiskAfter: { type: "integer" },
                  historicalRiskDelta: { type: "integer" },
                  sealed: { type: "boolean" }
                }
              }
            },
            outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  incidentId: { type: "string" },
                  buildingId: { type: "string" },
                  arcaneOfficerId: { type: "string" },
                  outcome: { enum: ["critical_success", "success", "failure", "critical_failure"] },
                  exposureDelta: { type: "number" },
                  historicalRiskBefore: { type: "integer" },
                  historicalRiskAfter: { type: "integer" },
                  historicalRiskDelta: { type: "integer" },
                  sealed: { type: "boolean" },
                  resolution: { enum: ["assigned", "unaddressed"] },
                  incidentStatus: { type: "string" },
                  arcaneOfficerStatus: { type: "string" },
                  growth: { type: "object", additionalProperties: false, required: ["attribute", "roll", "chance", "before", "after", "gained"], properties: { attribute: { type: "string" }, roll: { type: "number" }, chance: { type: "number" }, before: { type: "integer" }, after: { type: "integer" }, gained: { type: "integer" } } }
                }
              }
            },
            sealedBuildings: { type: "array", items: { type: "string" } },
            buildingsStarted: { type: "array", items: { type: "string" }, description: "System-derived ids of authoritative buildings first represented by accepted construction events in this turn." },
            buildingsCompleted: { type: "array", items: { type: "string" }, description: "System-derived ids of authoritative buildings completed by accepted construction events in this turn." },
            buildingFactRefs: { type: "array", items: { type: "string" } },
            constructionRefs: { type: "array", items: { type: "object", additionalProperties: false, required: ["factRef", "kind", "reservationId", "proposalId", "buildingId", "eventType"], properties: { factRef: { type: "string" }, kind: { enum: ["reservation", "completion"] }, reservationId: { type: ["string", "null"] }, proposalId: { type: ["string", "null"] }, buildingId: { type: ["string", "null"] }, eventType: { type: "string" } } } },
            nextRisks: { type: "array", items: { type: "object", additionalProperties: true } }
          }
        },
        BootstrapProgress: {
          type: "object",
          additionalProperties: false,
          required: ["gatewayConnected", "gatewayNodeId", "roadsConnected", "roadsConnectedCount", "buildingsStarted", "buildingsCompleted", "residentialBuildings", "commercialBuildings", "publicServiceBuildings", "totalBuildings", "milestones"],
          properties: {
            gatewayConnected: { type: "boolean" }, gatewayNodeId: { type: ["string", "null"] },
            roadsConnected: { type: "array", items: { type: "string" } }, roadsConnectedCount: { type: "integer", minimum: 0 },
            buildingsStarted: { type: "array", items: { type: "string" } }, buildingsCompleted: { type: "array", items: { type: "string" } },
            residentialBuildings: { type: "array", items: { type: "string" } }, commercialBuildings: { type: "array", items: { type: "string" } }, publicServiceBuildings: { type: "array", items: { type: "string" } }, totalBuildings: { type: "integer", minimum: 0 },
            milestones: { type: "object", additionalProperties: false, required: ["gateway", "road", "housing", "income", "publicService"], properties: { gateway: { type: "boolean" }, road: { type: "boolean" }, housing: { type: "boolean" }, income: { type: "boolean" }, publicService: { type: "boolean" } } }
          }
        },
        BootstrapState: {
          type: "object", additionalProperties: false, required: ["progress", "guidance"],
          properties: { progress: { $ref: "#/components/schemas/BootstrapProgress" }, guidance: { type: "string" } }
        },
        StrategyPayload: {
          type: "object",
          required: ["turn_kind", "bootstrap", "incidents", "arcane_officers", "arcane_officer_recruitment", "pending_assignments", "cards"],
          properties: {
            turn_kind: { enum: ["bootstrap", "normal"] },
            bootstrap: { oneOf: [{ $ref: "#/components/schemas/BootstrapState" }, { type: "null" }] },
            incidents: { type: "array", items: { $ref: "#/components/schemas/StrategyIncident" } },
            arcane_officers: { type: "array", items: { $ref: "#/components/schemas/ArcaneOfficer" } },
            arcane_officer_recruitment: { $ref: "#/components/schemas/ArcaneOfficerRecruitment" },
            pending_assignments: { type: "array", items: { type: "object" } },
            cards: { $ref: "#/components/schemas/StrategyCards" }
          }
        },
        StrategyContext: {
          type: "object",
          required: ["city_id", "city_version", "turn", "turn_kind", "turn_status", "bootstrap", "strategy"],
          properties: {
            city_id: { type: "string" },
            city_version: { type: "integer" },
            turn: { type: "integer" },
            turn_kind: { enum: ["bootstrap", "normal"] },
            turn_status: { type: "string" },
            bootstrap: { oneOf: [{ $ref: "#/components/schemas/BootstrapState" }, { type: "null" }] },
            turn_opened_at: { type: ["string", "null"] },
            turn_deadline_at: { type: ["string", "null"], description: "Deprecated legacy field, always null. Turns no longer have a deadline that auto-settles; it is kept only for API compatibility and never drives settlement." },
            next_turn_unlock_at: { type: ["string", "null"], description: "Server-owned cooldown gate. While the current turn is active it is the earliest wall-clock time the Agent may resolve the turn (POST /strategy/resolve is rejected with TURN_NOT_UNLOCKED before it); once the turn is settled it is the earliest time the next turn may open. Agents cannot change it." },
            settled_by: { type: ["string", "null"], description: "Which authority settled the last turn: agent, or deadline (historical only; deadline settlement no longer exists)." },
            gameplay_guidance: { type: "array", items: { type: "string" }, description: "Short progressive-disclosure hints (1-3) for the current context, derived from card/placement/incident/turn-lock state. Advisory only; the authoritative contract is the playbook." },
            playbook_url: { type: "string", description: "Stable URL of the authoritative MAGTOPIA Agent Playbook." },
            strategy: { $ref: "#/components/schemas/StrategyPayload", properties: { incidents: { type: "array" }, arcane_officers: { type: "array" }, arcane_officer_recruitment: { $ref: "#/components/schemas/ArcaneOfficerRecruitment" }, pending_assignments: { type: "array" }, cards: { $ref: "#/components/schemas/StrategyCards" } } },
            last_turn_facts: { oneOf: [{ $ref: "#/components/schemas/TurnFacts" }, { type: "null" }] }
          }
        },
        StrategyResolveResponse: {
          type: "object",
          required: ["command_id", "status", "city_version_before", "city_version_after", "turn", "facts", "strategy"],
          properties: {
            command_id: { type: "string" },
            status: { const: "resolved" },
            city_version_before: { type: "integer" },
            city_version_after: { type: "integer" },
            turn: { type: "integer" },
            facts: { $ref: "#/components/schemas/TurnFacts" },
            strategy: { $ref: "#/components/schemas/StrategyPayload", properties: { cards: { $ref: "#/components/schemas/StrategyCards" } } }
          }
        },
        ReportContext: {
          type: "object",
          description: "SYSTEM-owned immutable newspaper source for one resolved turn. A deterministic projection of the frozen TurnFacts plus read-only city metadata. Never contains prose and never recomputes gameplay. The Agent edits an OwlReport from it and references facts through factRefs.",
          required: ["schemaVersion", "cityId", "turn", "turnKind", "choiceKind", "offerChoiceKind", "specialCadence", "eligibilityAudit", "bootstrapProgress", "worldDay", "factsDigest", "settlement", "resourceDelta", "populationDelta", "publicService", "buildingsStarted", "buildingsCompleted", "buildingFactRefs", "constructionRefs", "incidents", "incidentRolls", "historicalRiskChanges", "factRefs"],
          properties: {
            schemaVersion: { type: "integer" },
            cityId: { type: "string" },
            turn: { type: "integer" },
            turnKind: { enum: ["bootstrap", "normal"] },
            choiceKind: { enum: ["ordinary", "special", null] },
            offerChoiceKind: { enum: ["ordinary", "special", null] },
            specialCadence: { type: "boolean" },
            eligibilityAudit: { type: "array", items: { type: "object", additionalProperties: true } },
            bootstrapProgress: { oneOf: [{ $ref: "#/components/schemas/BootstrapProgress" }, { type: "null" }] },
            worldDay: { type: "integer", description: "One resolved turn is one city day; worldDay equals turn." },
            factsDigest: { type: "string", description: "Stable digest of the frozen TurnFacts; an OwlReport must bind to it." },
            settlement: {
              type: "object",
              properties: {
                settledBy: { enum: ["agent", "deadline", null] },
                openedAt: { type: ["string", "null"] },
                resolvedAt: { type: ["string", "null"] },
                turnDeadlineAt: { type: ["string", "null"] },
                nextTurnUnlockAt: { type: ["string", "null"] }
              }
            },
            resourceDelta: { type: "object", properties: { factRef: { type: "string" }, coins: { type: "integer", minimum: 0 }, arcaneEnergy: { type: "number", minimum: 0 } }, required: ["coins", "arcaneEnergy"] },
            populationDelta: { type: "object", additionalProperties: true },
            publicService: { type: "object", additionalProperties: true },
            buildingsStarted: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, buildingId: { type: "string" }, name: { type: "string" }, archetype: { type: ["string", "null"] }, purpose: { type: ["string", "null"] } } } },
            buildingsCompleted: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, buildingId: { type: "string" }, name: { type: "string" }, archetype: { type: ["string", "null"] }, purpose: { type: ["string", "null"] } } } },
            buildingFactRefs: { type: "array", items: { type: "string" } },
            constructionRefs: { type: "array", items: { type: "object", additionalProperties: false, required: ["factRef", "kind", "reservationId", "proposalId", "buildingId", "eventType"], properties: { factRef: { type: "string" }, kind: { enum: ["reservation", "completion"] }, reservationId: { type: ["string", "null"] }, proposalId: { type: ["string", "null"] }, buildingId: { type: ["string", "null"] }, eventType: { type: "string" } } } },
            exposureChanges: { type: "object", additionalProperties: { type: "object", properties: { factRef: { type: "string" }, buildingId: { type: "string" }, name: { type: "string" }, from: { type: "number" }, to: { type: "number" }, delta: { type: "number" }, pressure: { type: "number" }, concealment: { type: "number" }, sealed: { type: "boolean" } } } },
            incidents: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, id: { type: "string" }, buildingId: { type: "string" }, buildingName: { type: "string" }, type: { type: "string" }, dc: { type: "number", enum: [10, 14, 18] }, severity: { type: "number" }, summary: { type: "string" }, status: { type: "string" }, createdAtTurn: { type: "number" } } } },
            incidentRolls: { type: "array", items: { type: "object", properties: { buildingId: { type: "string" }, finalIncidentChance: { type: "number" }, thresholdRoll: { type: "number" }, hit: { type: "boolean" }, sourcePurpose: { type: ["string", "null"] }, purposeWeights: { type: "object", additionalProperties: { type: "number" } } } } },
            historicalRiskChanges: { type: "object", additionalProperties: { type: "object", properties: { buildingId: { type: "string" }, before: { type: "integer" }, after: { type: "integer" }, delta: { type: "integer" }, incidentIds: { type: "array", items: { type: "string" } }, sealed: { type: "boolean" } } } },
            unresolvedIncidents: { type: "array", items: { type: "object" } },
            unaddressedIncidents: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, incidentId: { type: "string" }, buildingId: { type: "string" }, buildingName: { type: "string" }, type: { type: "string" }, severity: { type: "number" }, status: { const: "failed" }, outcome: { const: "failure" }, historicalRiskBefore: { type: "integer" }, historicalRiskAfter: { type: "integer" }, historicalRiskDelta: { type: "integer" }, sealed: { type: "boolean" }, createdAtTurn: { type: "number" } } } },
            assignments: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, incidentId: { type: "string" }, arcaneOfficerId: { type: "string" }, arcaneOfficerName: { type: "string" }, rationale: { type: ["string", "null"] } } } },
            rolls: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, incidentId: { type: "string" }, arcaneOfficerId: { type: "string" }, arcaneOfficerName: { type: "string" }, attribute: { type: "string" }, rawRoll: { type: "integer", minimum: 1, maximum: 20 }, attributeValue: { type: "integer" }, specialtyBonus: { type: "integer" }, otherModifiers: { type: "integer" }, total: { type: "integer" }, dc: { type: "integer", enum: [10, 14, 18] }, margin: { type: "integer" }, outcome: { type: "string" }, historicalRiskBefore: { type: "integer" }, historicalRiskAfter: { type: "integer" }, historicalRiskDelta: { type: "integer" }, sealed: { type: "boolean" } } } },
            outcomes: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, incidentId: { type: "string" }, buildingId: { type: "string" }, arcaneOfficerId: { type: "string" }, arcaneOfficerName: { type: "string" }, outcome: { type: "string" }, exposureDelta: { type: "number" }, historicalRiskBefore: { type: "integer" }, historicalRiskAfter: { type: "integer" }, historicalRiskDelta: { type: "integer" }, sealed: { type: "boolean" }, resolution: { enum: ["assigned", "unaddressed"] }, incidentStatus: { type: "string" }, arcaneOfficerStatus: { type: "string" } } } },
            sealedBuildings: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, buildingId: { type: "string" }, name: { type: "string" } } } },
            nextRisks: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, buildingId: { type: "string" }, name: { type: "string" }, exposure: { type: "number" }, pressure: { type: "number" }, concealment: { type: "number" } } } },
            card: {
              type: "object",
              description: "Card and policy facts projected strictly from the frozen TurnFacts of this turn.",
              required: ["offerId", "turn", "choiceKind", "offerChoiceKind", "specialCadence", "eligibilityAudit", "offeredCards", "choice", "policy", "placement"],
              properties: {
                factRef: { type: "string" },
                offerId: { type: ["string", "null"] },
                turn: { type: "integer" },
                choiceKind: { enum: ["ordinary", "special", null] },
                offerChoiceKind: { enum: ["ordinary", "special", null] },
                specialCadence: { type: "boolean" },
                eligibilityAudit: { type: "array", items: { type: "object", additionalProperties: true } },
                offeredCards: { type: "array", items: { type: "object", properties: { cardId: { type: "string" }, type: { type: ["string", "null"] }, title: { type: "string" }, description: { type: ["string", "null"] }, decisionMode: { type: ["string", "null"] } } } },
                choice: { type: "object", properties: { factRef: { type: "string" }, status: { type: "string" }, selectedCardId: { type: ["string", "null"] }, selectedCardTitle: { type: ["string", "null"] }, choiceResolvedAt: { type: ["string", "null"] }, cardEffects: { type: "object" } } },
                policy: { type: "object", properties: { factRef: { type: "string" }, started: { type: "array", items: { type: "string" } }, refreshed: { type: "array", items: { type: "string" } }, expired: { type: "array", items: { type: "string" } }, active: { type: "array", items: { type: "object", properties: { factRef: { type: "string" }, policyId: { type: "string" }, event: { type: "string" } } } } } },
                placement: { type: "object", properties: { factRef: { type: "string" }, mandate: { type: ["object", "null"], properties: { cardId: { type: "string" }, mode: { type: "string" }, status: { type: "string" }, placementId: { type: "string" } } }, completed: { type: "array", items: { type: "object", properties: { placementId: { type: "string" }, cardId: { type: "string" }, buildingId: { type: "string" }, mode: { type: "string" }, cardTitle: { type: ["string", "null"] } } }, description: "Attributed completions: each entry ties a completed mandate to its placement, card, and building so the Owl Daily never misattributes an older delegated completion to the current selection." } } }
              }
            },
            factRefs: { type: "array", items: { type: "string" }, description: "Every stable fact ref valid for this turn's ReportContext." }
          }
        },
        OwlReportMasthead: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 },
            subtitle: { type: "string", maxLength: 200 }
          }
        },
        OwlReportArticle: {
          type: "object",
          required: ["id", "headline", "body"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80, description: "Stable author-chosen id, unique within the edition." },
            headline: { type: "string", minLength: 1, maxLength: 240 },
            dek: { type: "string", maxLength: 400 },
            body: { type: "string", minLength: 1, maxLength: 12000 },
            category: { type: "string", maxLength: 60, description: "Suggested: development, exposure, arcane_officer, population, economy, community, other. Any short label is accepted." },
            importance: { enum: ["front_page", "secondary", "brief"] },
            relatedFactRefs: { type: "array", maxItems: 40, items: { type: "string" }, description: "Stable fact refs from this turn's ReportContext that this article is based on. Unknown refs are rejected." }
          }
        },
        OwlReportBrief: {
          type: "object",
          required: ["id", "text"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            text: { type: "string", minLength: 1, maxLength: 2000 },
            category: { type: "string", maxLength: 60 },
            relatedFactRefs: { type: "array", maxItems: 40, items: { type: "string" } }
          }
        },
        OwlReportActionBoxEntry: {
          type: "object",
          description: "A featured Arcane Officer action. The Agent selects which incident to highlight and writes the reason; roll/outcome/consequence are rendered from the referenced system fact refs, never authored.",
          required: ["id", "incidentRef"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            incidentRef: { type: "string", description: "A fact-incident-* ref from this turn's ReportContext." },
            factRefs: { type: "array", maxItems: 40, items: { type: "string" }, description: "System facts surfaced by the box, for example fact-roll-* and fact-outcome-* refs." },
            reason: { type: "string", maxLength: 2000, description: "Authored dispatch explanation. The frozen assignment rationale stays authoritative in the ReportContext." }
          }
        },
        OwlReportTomorrowWatchEntry: {
          type: "object",
          required: ["id", "text"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            text: { type: "string", minLength: 1, maxLength: 4000 },
            factRefs: { type: "array", maxItems: 40, items: { type: "string" }, description: "Unresolved or risky facts this plan responds to, e.g. fact-unaddressed-* or fact-risk-* refs." }
          }
        },
        OwlReport: {
          type: "object",
          description: "AGENT-owned newspaper composition edited from a ReportContext. The Agent owns news value and narration; every gameplay value it mentions must be referenced through a fact ref rather than re-authored.",
          required: ["masthead", "edition", "headline", "lead", "articles", "briefs"],
          properties: {
            schemaVersion: { type: "integer" },
            masthead: { $ref: "#/components/schemas/OwlReportMasthead" },
            edition: { type: "string", minLength: 1, maxLength: 120 },
            headline: { type: "string", minLength: 1, maxLength: 240 },
            subheadline: { type: "string", maxLength: 320 },
            lead: { type: "string", minLength: 1, maxLength: 4000 },
            articles: { type: "array", maxItems: 20, items: { $ref: "#/components/schemas/OwlReportArticle" } },
            briefs: { type: "array", maxItems: 40, items: { $ref: "#/components/schemas/OwlReportBrief" } },
            actionBox: { type: "array", maxItems: 10, items: { $ref: "#/components/schemas/OwlReportActionBoxEntry" } },
            tomorrowWatch: { type: "array", maxItems: 10, items: { $ref: "#/components/schemas/OwlReportTomorrowWatchEntry" } }
          }
        },
        OwlReportSubmitRequest: {
          type: "object",
          required: ["turn", "facts_digest", "report"],
          properties: {
            turn: { type: "integer", minimum: 1, description: "The resolved turn this edition reports on." },
            facts_digest: { type: "string", description: "factsDigest returned by GET /report-context for this turn. A stale digest is rejected." },
            report: { $ref: "#/components/schemas/OwlReport" }
          }
        },
        OwlReportResponse: {
          type: "object",
          required: ["report_id", "city_id", "turn", "facts_digest", "status", "edition", "report"],
          properties: {
            report_id: { type: "string" },
            city_id: { type: "string" },
            turn: { type: "integer" },
            facts_digest: { type: "string" },
            status: { const: "published" },
            edition: { type: "string" },
            report: { $ref: "#/components/schemas/OwlReport" },
            created_at: { type: "string" },
            updated_at: { type: "string" },
            idempotent_replay: { type: "boolean", description: "true when an identical Idempotency-Key submission replays the original published report." }
          }
        },
        OwlReportSummary: {
          type: "object",
          required: ["report_id", "city_id", "turn", "facts_digest", "status", "edition", "headline"],
          properties: {
            report_id: { type: "string" },
            city_id: { type: "string" },
            turn: { type: "integer" },
            facts_digest: { type: "string" },
            status: { const: "published" },
            edition: { type: "string" },
            masthead_title: { type: ["string", "null"] },
            headline: { type: "string" },
            created_at: { type: "string" },
            updated_at: { type: "string" }
          }
        },
        CityDayPresentation: {
          type: "object",
          description: "Pure presentation projection of the authoritative turn/workflow state. Visual time-of-day is an output of workflow, never a second simulation clock or realtime economy.",
          required: ["city_id", "city_version", "phase", "turn", "turnKind", "turnStatus", "settled", "bootstrap", "report", "card", "agent", "incident"],
          properties: {
            city_id: { type: "string" },
            city_version: { type: "integer" },
            phase: { enum: ["dawn", "early_morning", "morning", "day", "night"] },
            turn: { type: "integer" },
            turnKind: { enum: ["bootstrap", "normal"] },
            turnStatus: { type: "string" },
            settled: { type: "boolean" },
            bootstrap: { oneOf: [{ type: "object", required: ["progress"], properties: { progress: { $ref: "#/components/schemas/BootstrapProgress" } } }, { type: "null" }] },
            report: {
              type: "object",
              properties: {
                turn: { type: ["integer", "null"] },
                ready: { type: "boolean" },
                dismissed: { type: "boolean" },
                report_id: { type: ["string", "null"] },
                edition: { type: ["string", "null"] },
                masthead_title: { type: ["string", "null"] },
                headline: { type: ["string", "null"] }
              }
            },
            card: {
              type: "object",
              properties: {
                choiceStatus: { type: "string" },
                choicePending: { type: "boolean" },
                choiceKind: { type: ["string", "null"] },
                offerChoiceKind: { type: ["string", "null"] },
                specialCadence: { type: "boolean" },
                eligibilityAudit: { type: "array", items: { type: "object", additionalProperties: true } },
                selectedCardId: { type: ["string", "null"] },
                decisionMode: { type: ["string", "null"] },
                playerPlacementPending: { type: "boolean" },
                pendingPlacements: { type: "array", items: { $ref: "#/components/schemas/PendingPlacement" } }
              }
            },
            agent: { type: "object", properties: { workStarted: { type: "boolean" } } },
            incident: { type: "object", properties: { phaseActive: { type: "boolean" } } },
            nextTurnUnlockAt: { type: ["string", "null"] },
            turnDeadlineAt: { type: ["string", "null"], description: "Deprecated legacy field, always null. Never drives settlement." }
          }
        },
        ReportDismissRequest: {
          type: "object",
          required: ["report_turn"],
          properties: {
            report_turn: { type: "integer", minimum: 1, description: "The completed day's report turn, matching the latest city-day presentation report.turn." }
          }
        },
        ReportDismissResponse: {
          type: "object",
          required: ["city_id", "city_version", "report_turn", "dismissed"],
          properties: {
            city_id: { type: "string" },
            city_version: { type: "integer" },
            report_turn: { type: "integer" },
            dismissed: { const: true }
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
      "/cities/{city_id}/render-artifacts/manifest": { get: operation("Read optional versioned baked voxel building artifact metadata", "queries") },
      "/cities/{city_id}/render-artifacts/{building_id}": {
        get: operation("Read one immutable baked voxel building mesh artifact", "queries", null, json, true, [
          queryParameter("revision", { type: "integer", minimum: 0 }, "Required design revision; the server rejects stale artifact requests.")
        ])
      },
      "/cities/{city_id}/events": {
        get: operation("Read incremental city events", "queries", null, json, true, [
          queryParameter("after_version", { type: "integer", default: 0 }, "Read events after this city version. Use the last seen city_version to incrementally sync what happened."),
          queryParameter("limit", { type: "integer", default: 100 }, "Maximum number of events to return (runtime clamps to 200).")
        ])
      },
      "/cities/{city_id}/spatial": {
        get: operation("Query cells and occupants in a bounded grid rectangle", "queries", null, json, true, gridBoundsQueryParameters())
      },
      "/cities/{city_id}/cells/{cell_id}": { get: operation("Read one expanded logical cell after it was discovered through /spatial or another response", "queries") },
      "/cities/{city_id}/buildings": {
        get: operation("Find buildings by name, archetype, purpose, or bounding box", "queries", null, json, true, [
          queryParameter("query", { type: "string" }, "Free-text search over building name, archetype, purpose, and description."),
          queryParameter("archetype", { type: "string" }, "Exact archetype filter."),
          queryParameter("purpose", { type: "string" }, "Exact purpose filter."),
          queryParameter("limit", { type: "integer", default: 20, maximum: 100 }, "Maximum number of buildings to return."),
          ...gridBoundsQueryParameters("The bounding-box filter matches buildings with at least one footprint cell inside the requested rectangle.")
        ])
      },
      "/cities/{city_id}/buildings/{building_id}": { get: operation("Read one full building after it was discovered through /buildings, /spatial, district data, events, or strategy/report facts", "queries") },
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
      "/cities/{city_id}/buildings/{building_id}/upgrade-designs": { post: operation("Create an editable upgrade design from a built voxel design", "building-designs", { $ref: "#/components/schemas/BuildingDesignUpgradeRequest" }) },
      "/cities/{city_id}/site-searches": { post: operation("List legal construction sites and objective road-frontage facts inside a named district", "construction", { $ref: "#/components/schemas/SiteSearchRequest" }) },
      "/assets": {
        get: operation("Search validated reusable assets", "assets", null, json, true, [
          queryParameter("archetype", { type: "string" }, "Exact asset archetype filter."),
          queryParameter("footprint", { type: "string" }, "Exact footprint filter, e.g. 2x3."),
          queryParameter("district_style", { type: "string" }, "Exact district style filter."),
          queryParameter("limit", { type: "integer", default: 20, maximum: 50 }, "Maximum number of assets to return.")
        ])
      },
      "/cities/{city_id}/construction-previews": { post: operation("Preview a legacy asset request or confirmed voxel design", "construction", { oneOf: [{ $ref: "#/components/schemas/ConstructionRequest" }, { $ref: "#/components/schemas/BuildingDesignConstructionRequest" }] }) },
      "/cities/{city_id}/construction-orders": {
        get: operation("List construction orders", "construction"),
        post: commandOperation("Submit an idempotent asset or confirmed voxel-design construction order", "construction", { oneOf: [{ $ref: "#/components/schemas/ConstructionRequest" }, { $ref: "#/components/schemas/BuildingDesignConstructionRequest" }] })
      },
      "/cities/{city_id}/construction-orders/{order_id}": { get: operation("Read a construction order", "construction") },
      "/cities/{city_id}/construction-orders/{order_id}/cancel": { post: commandOperation("Cancel an asset-waiting construction order and release its site and frozen resources", "construction") },
      "/cities/{city_id}/connection-previews": { post: operation("Preview a building/cell/node road connection", "roads", { $ref: "#/components/schemas/ConnectionRequest" }) },
      "/cities/{city_id}/connections": { post: commandOperation("Submit an idempotent road connection", "roads", { $ref: "#/components/schemas/ConnectionRequest" }) },
      "/cities/{city_id}/time-advances": { post: commandOperation("Manual time advance is disabled: income and turn progression flow through the cooldown-gated strategy resolve instead", "simulation") },
      "/cities/{city_id}/strategy": { get: operation("Read the strategy context: open incidents, Arcane Officers, player card state, and the last frozen settlement facts", "strategy", null, { $ref: "#/components/schemas/StrategyContext" }) },
      "/cities/{city_id}/strategy/assignments": { post: commandOperation("Submit the Arcane Officer dispatch plan for the strategy phase", "strategy", { $ref: "#/components/schemas/StrategyAssignmentsRequest" }) },
      "/cities/{city_id}/strategy/resolve": { post: commandOperation("Request the single authoritative system settlement of the strategy phase", "strategy", { $ref: "#/components/schemas/StrategyResolveRequest" }) },
      "/cities/{city_id}/strategy/recruit-officer": { post: commandOperation("Recruit one current system-generated Arcane Officer candidate", "strategy", { $ref: "#/components/schemas/OfficerRecruitmentRequest" }, { $ref: "#/components/schemas/OfficerRecruitmentResponse" }) },
      "/cards": { get: operation("Read the system-owned daily card catalog", "cards", null, { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/CardDefinition" } } } }) },
      "/cities/{city_id}/cards/current": { get: operation("Read the canonical three-card offer and all pending placement mandates for the current turn", "cards", null, { type: "object", properties: { city_id: { type: "string" }, city_version: { type: "integer" }, turn: { type: "integer" }, turn_status: { type: "string" }, offer: { $ref: "#/components/schemas/CardOffer" }, choice: { $ref: "#/components/schemas/CardChoice" }, pending_placements: { type: "array", items: { $ref: "#/components/schemas/PendingPlacement" } } } }) },
      "/cities/{city_id}/cards/select": { post: commandOperation("The player selects exactly one offered card for this turn", "cards", { $ref: "#/components/schemas/CardSelectRequest" }, { $ref: "#/components/schemas/CardSelectResponse" }) },
      "/cities/{city_id}/cards/place": { post: commandOperation("Place a pending special structure at a legal location (player placement or delegated Agent placement)", "cards", { $ref: "#/components/schemas/CardPlaceRequest" }, { $ref: "#/components/schemas/CardPlaceResponse" }) },
      "/cities/{city_id}/cards/cancel": { post: commandOperation("Cancel an unplaced special structure entitlement; cancelled unique cards may reappear on a later Special Choice", "cards", { $ref: "#/components/schemas/CardCancelRequest" }, json) },
      "/cities/{city_id}/report-context": {
        get: operation("Read the immutable SYSTEM newspaper source facts for a resolved turn", "reports", null, { $ref: "#/components/schemas/ReportContext" }, true, [
          queryParameter("turn", { type: "integer", minimum: 1 }, "The resolved turn to read. Omit to select the latest resolved turn that has frozen facts.")
        ])
      },
      "/cities/{city_id}/reports": {
        get: operation("Read the Owl Daily report history for this city", "reports", null, { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/OwlReportSummary" } } } }),
        post: commandOperation("Publish the canonical Owl Daily newspaper for a resolved turn", "reports", { $ref: "#/components/schemas/OwlReportSubmitRequest" })
      },
      "/cities/{city_id}/reports/{report_id}": { get: operation("Read one published Owl Daily report", "reports", null, { $ref: "#/components/schemas/OwlReportResponse" }) },
      "/cities/{city_id}/city-day": { get: operation("Read the player-facing city-day presentation projection for the current turn", "city-day", null, { $ref: "#/components/schemas/CityDayPresentation" }) },
      "/cities/{city_id}/city-day/report-dismissed": { post: operation("Record that the player dismissed the completed day's Owl Daily so it is never replayed", "city-day", { $ref: "#/components/schemas/ReportDismissRequest" }, { $ref: "#/components/schemas/ReportDismissResponse" }) },
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

function queryParameter(name, schema, description) {
  return { in: "query", name, schema, description };
}

// Shared bounded-grid query contract used by /spatial and /buildings so the
// window semantics (inclusive bounds, 400-cell limit, 10×10 default) stay
// consistent across every consumer instead of drifting in ad hoc duplicates.
function gridBoundsQueryParameters(extraNote = "") {
  const note = extraNote ? ` ${extraNote}` : "";
  return [
    queryParameter(
      "min_col",
      { type: "integer", default: 0 },
      `Inclusive left/start column. Bounds are inclusive; reversed bounds are invalid; the maximum requested area is 400 logical cells; omitting all bounds returns the default 10×10 window. Example: ?min_col=20&min_row=10&max_col=29&max_row=19.${note}`
    ),
    queryParameter("min_row", { type: "integer", default: 0 }, "Inclusive start row. Bounds are inclusive; reversed bounds are invalid; the maximum requested area is 400 logical cells."),
    queryParameter("max_col", { type: "integer" }, "Inclusive right/end column; defaults to min_col + 9. Changing these four values is how an Agent inspects another area of the city."),
    queryParameter("max_row", { type: "integer" }, "Inclusive end row; defaults to min_row + 9. Changing these four values is how an Agent inspects another area of the city.")
  ];
}

function operation(summary, tag, requestBody = null, responseSchema = json, secured = true, queryParameters = []) {
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
  if (queryParameters.length) value.parameters = [...queryParameters];
  if (!secured) value.security = [];
  return value;
}

function commandOperation(summary, tag, requestBody = json, responseSchema = json) {
  const value = operation(summary, tag, requestBody, responseSchema);
  value.parameters = [
    { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string" } },
    { in: "header", name: "If-Match", required: false, schema: { type: "string" } }
  ];
  return value;
}
