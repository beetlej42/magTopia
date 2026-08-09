import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { calculateDailyIncome, createEngineContext, executeCityCommand } from "../../src/city/engine.js";
import { normalizeConstructionProposal } from "../../src/city/contracts.js";
import { districtBlockProgress } from "../../src/city/district-layout.js";
import { districtBuildings, districtCompositionReview, districtSpatialObservations, districtSuggestions } from "../../src/city/district-guidance.js";
import { AGENT_VOXEL_ROAD_RENDER_CONTRACT } from "../../src/city/road-topology.js";
import { findCandidateParcels, previewConnectionBetween, previewConstruction } from "../../src/city/solver.js";
import { createId, hashRequest } from "./ids.js";
import { ServiceError, errorEnvelope } from "./errors.js";
import { createOpenApiDocument } from "./openapi.js";
import { finalizeAssetJob, normalizeAssetVolume, prepareAssetMaps } from "./asset-production.js";
import {
  buildingDesignToConstructionBody,
  confirmBuildingDesign,
  createBuildingDesignDraft,
  createBuildingUpgradeDraft,
  reviseBuildingDesign
} from "../../src/city/building-design.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_PATH = path.resolve(SERVER_DIR, "../../docs/agent-playbook.md");
const BUILDING_DESIGN_API_PATH = path.resolve(SERVER_DIR, "../../docs/BUILDING_DESIGN_API_V1.md");
const DASHBOARD_PATH = path.join(SERVER_DIR, "dashboard.html");
const GENERATED_ROOT = path.resolve(SERVER_DIR, "../../public/generated");
const DIST_ROOT = path.resolve(SERVER_DIR, "../../dist");
const DIST_ASSETS_ROOT = path.join(DIST_ROOT, "assets");

export async function createApp({ repository, config, logger = false }) {
  const app = Fastify({ logger, bodyLimit: 12 * 1024 * 1024 });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      const serviceError = new ServiceError(400, "INVALID_REQUEST", error.message, { validation: error.validation });
      return reply.code(400).send(errorEnvelope(serviceError, request.id));
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log?.error(error);
    return reply.code(status).send(errorEnvelope(error, request.id));
  });

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(homePage(config.publicBaseUrl)));
  app.get("/healthz", async () => {
    await repository.database.query("SELECT 1");
    return { status: "ok", service: "MAGTOPIA", chinese_name: "麦托邦", voxel_only: config.voxelOnly };
  });
  app.get("/agent/playbook.md", async (_request, reply) => reply.type("text/markdown; charset=utf-8").send(await fs.readFile(PLAYBOOK_PATH, "utf8")));
  app.get("/agent/building-design-api-v1.md", async (_request, reply) => reply.type("text/markdown; charset=utf-8").send(await fs.readFile(BUILDING_DESIGN_API_PATH, "utf8")));
  app.get("/style-reference/isometric-magic-london-city.jpg", async (_request, reply) =>
    reply.type("image/jpeg").header("Cache-Control", "public, max-age=86400").send(
      await fs.readFile(path.resolve(SERVER_DIR, "../../docs/reference-images/isometric-magic-london-city.jpg"))
    )
  );
  app.get("/dashboard", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await fs.readFile(DASHBOARD_PATH, "utf8")));
  app.get("/cities/:cityId", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.type("text/html; charset=utf-8").send(await readBuiltFile(path.join(DIST_ROOT, "index.html")));
  });
  app.get("/assets/*", async (request, reply) => {
    const target = resolvePublicFile(DIST_ASSETS_ROOT, request.params["*"]);
    return reply.type(mimeType(target)).header("Cache-Control", "public, max-age=31536000, immutable").send(await readBuiltFile(target));
  });
  app.get("/generated/*", async (request, reply) => {
    const target = resolvePublicFile(GENERATED_ROOT, request.params["*"]);
    return reply.type(mimeType(target)).header("Cache-Control", "public, max-age=31536000, immutable").send(await readBuiltFile(target));
  });
  const agentDiscovery = () => ({
    service: "MAGTOPIA Agent City Service",
    chinese_name: "麦托邦",
    product_positioning: "AI Agent-driven magic city",
    version: "v1",
    authentication: "one-time capability URL exchanged for Bearer token",
    api_base_url: `${config.publicBaseUrl}/api/v1`,
    playbook_url: `${config.publicBaseUrl}/agent/playbook.md`,
    openapi_url: `${config.publicBaseUrl}/openapi.json`
  });
  app.get("/.well-known/magtopia-agent.json", async () => agentDiscovery());
  // Keep the pre-rebrand discovery URL readable for existing Agents.
  app.get("/.well-known/magictown-agent.json", async () => agentDiscovery());
  app.get("/openapi.json", async () => createOpenApiDocument(config.publicBaseUrl));

  app.get("/connect/:capability", { logLevel: "silent" }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return repository.exchangeCapability(request.params.capability);
  });

  app.post("/api/v1/players", async (request, reply) => {
    const name = String(request.body?.display_name ?? "MAGTOPIA Player").trim();
    if (!name || name.length > 80) throw new ServiceError(400, "INVALID_DISPLAY_NAME", "display_name must contain 1–80 characters");
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send(await repository.createPlayer(name));
  });

  app.get("/api/v1/cities", async (request) => repository.listCities(await authenticate(repository, request)));
  app.post("/api/v1/cities", async (request, reply) => {
    const principal = await authenticate(repository, request);
    return reply.code(201).send(await repository.createCity(principal, request.body ?? {}));
  });

  app.get("/api/v1/cities/:cityId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row } = await repository.getCity(principal, request.params.cityId);
    return summarizeCity(row, config);
  });

  app.get("/api/v1/cities/:cityId/snapshot", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const events = await repository.getEvents(principal, request.params.cityId, Math.max(0, state.version - 5), 20);
    const orders = await repository.listOrders(principal, request.params.cityId);
    return agentSnapshot(row, state, events, orders, config);
  });

  app.get("/api/v1/cities/:cityId/render-state", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const assetIds = Object.values(state.buildings ?? {}).map((building) => building.assetId ?? building.program?.assetId).filter(Boolean);
    const assets = await repository.getAssetsForCity(principal, request.params.cityId, assetIds);
    return {
      city_id: row.id,
      name: row.name,
      city_version: Number(row.city_version),
      state,
      assets,
      render_contract: {
        mode: "agentcity",
        terrain: "base-voxel-heightfield",
        buildings: "city-state-voxel-designs-with-runtime-asset-fallback",
        ...AGENT_VOXEL_ROAD_RENDER_CONTRACT
      }
    };
  });

  app.get("/api/v1/cities/:cityId/events", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return {
      data: await repository.getEvents(principal, request.params.cityId, Number(request.query.after_version ?? 0), Number(request.query.limit ?? 100))
    };
  });

  app.get("/api/v1/cities/:cityId/spatial", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    return spatialQuery(state, request.query);
  });

  app.get("/api/v1/cities/:cityId/cells/:cellId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    const cell = state.cells[request.params.cellId];
    if (!cell) throw new ServiceError(404, "CELL_NOT_FOUND", "Cell not found");
    return expandCell(state, cell);
  });

  app.get("/api/v1/cities/:cityId/buildings", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    return { data: searchBuildings(state, request.query) };
  });

  app.get("/api/v1/cities/:cityId/districts", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    return { city_version: state.version, data: Object.values(state.districts ?? {}).map((district) => districtResponse(state, district)) };
  });

  app.post("/api/v1/cities/:cityId/districts/:districtId/cancel", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: `districts/${request.params.districtId}/cancel`,
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "cancel_district",
      reason: body.reason ?? body.actor_note ?? "cancelled_by_actor"
    }, async ({ state }) => {
      const result = executeCityCommand(state, {
        type: "cancel_district",
        districtId: request.params.districtId,
        reason: body.reason ?? body.actor_note,
        actor: actorId(principal)
      }, engineContext());
      if (!result.accepted) return rejectedCommand(result);
      const commandId = createId("command");
      return {
        nextState: result.state,
        response: commandEnvelope(commandId, result, {
          kind: "district",
          id: result.district.id,
          status: "cancelled",
          district: districtResponse(result.state, result.district),
          preserved: result.preserved
        })
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/districts", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "districts",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "define_district",
      reason: body.actor_note
    }, async ({ state }) => {
      const result = executeCityCommand(state, {
        type: "define_district",
        name: body.name,
        purpose: body.purpose,
        bounds: body.bounds,
        actor: actorId(principal)
      }, engineContext());
      if (!result.accepted) return rejectedCommand(result);
      return {
        nextState: result.state,
        response: commandEnvelope(result.district.id, result, {
          kind: "district",
          id: result.district.id,
          status: "completed",
          district: districtResponse(result.state, result.district)
        })
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 201).send(response);
  });

  app.get("/api/v1/cities/:cityId/buildings/:buildingId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    const building = state.buildings[request.params.buildingId];
    if (!building) throw new ServiceError(404, "BUILDING_NOT_FOUND", "Building not found");
    return buildingResponse(state, building);
  });

  app.get("/api/v1/cities/:cityId/building-designs", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return { data: await repository.listBuildingDesigns(principal, request.params.cityId) };
  });

  app.post("/api/v1/cities/:cityId/building-designs", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const input = request.body ?? {};
    const draft = designDomainCall(() => createBuildingDesignDraft(input, buildingDesignContext(principal, createId("design"))));
    return reply.code(201).send(await repository.createBuildingDesign(principal, request.params.cityId, draft));
  });

  app.get("/api/v1/cities/:cityId/building-designs/:designId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return repository.getBuildingDesign(principal, request.params.cityId, request.params.designId);
  });

  app.post("/api/v1/cities/:cityId/building-designs/:designId/revisions", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const current = await repository.getBuildingDesign(principal, request.params.cityId, request.params.designId);
    const expectedRevision = request.body?.expected_revision ?? request.body?.expectedRevision;
    const revised = designDomainCall(() => reviseBuildingDesign(current, request.body ?? {}, buildingDesignContext(principal)));
    return reply.code(201).send(await repository.appendBuildingDesignRevision(principal, request.params.cityId, revised, expectedRevision));
  });

  app.post("/api/v1/cities/:cityId/building-designs/:designId/confirm", async (request) => {
    const principal = await authenticate(repository, request, "city:build");
    const current = await repository.getBuildingDesign(principal, request.params.cityId, request.params.designId);
    const expectedRevision = request.body?.expected_revision ?? request.body?.expectedRevision;
    const confirmed = designDomainCall(() => confirmBuildingDesign(current, request.body ?? {}, buildingDesignContext(principal)));
    return repository.confirmBuildingDesign(principal, request.params.cityId, confirmed, expectedRevision);
  });

  app.post("/api/v1/cities/:cityId/buildings/:buildingId/upgrade-designs", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const { state } = await repository.getCity(principal, request.params.cityId, { write: true });
    const building = state.buildings[request.params.buildingId];
    if (!building) throw new ServiceError(404, "BUILDING_NOT_FOUND", "Building not found");
    const draft = designDomainCall(() => createBuildingUpgradeDraft(
      building,
      request.body ?? {},
      buildingDesignContext(principal, createId("design"))
    ));
    return reply.code(201).send(await repository.createBuildingDesign(principal, request.params.cityId, draft));
  });

  app.post("/api/v1/cities/:cityId/site-searches", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    const input = request.body ?? {};
    const districtId = input.district_id ?? input.districtId ?? null;
    const district = districtId ? state.districts?.[districtId] : null;
    if (districtId && !district) throw new ServiceError(404, "DISTRICT_NOT_FOUND", `District ${districtId} was not found`);
    if (district?.status === "cancelled") throw new ServiceError(409, "DISTRICT_CANCELLED", `District ${districtId} is cancelled; choose a new district or omit district_id`);
    const candidates = findCandidateParcels(state, {
      footprint: input.footprint,
      districtId,
      bounds: district?.bounds ?? input.bounds ?? null,
      layout: district?.layout ?? null,
      blockProgress: district ? districtBlockProgress(state, district) : null,
      limit: Math.min(Number(input.limit ?? 12), 100)
    });
    return {
      city_version: state.version,
      district: district ? districtResponse(state, district) : null,
      data: candidates
    };
  });

  app.get("/api/v1/assets", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return { data: await repository.searchAssets(principal, request.query) };
  });

  app.post("/api/v1/cities/:cityId/construction-previews", async (request) => {
    const principal = await authenticate(repository, request, "city:build");
    const { state } = await repository.getCity(principal, request.params.cityId, { write: true });
    const { body, linkedDesign } = await resolveConstructionBody(repository, principal, request.params.cityId, request.body ?? {});
    const asset = await validateAssetChoice(repository, principal, body, config);
    if (asset.mode === "voxel" && !linkedDesign) throw new ServiceError(400, "BUILDING_DESIGN_REQUIRED", "Voxel construction must reference a confirmed building design");
    if (linkedDesign?.source?.kind === "upgrade") {
      const building = state.buildings[linkedDesign.source.buildingId];
      if (!building) throw new ServiceError(404, "BUILDING_NOT_FOUND", "Upgrade target building not found");
      const baseMatches = building.voxelDesign?.id === linkedDesign.source.baseDesignId
        && building.voxelDesign?.revision === linkedDesign.source.baseDesignRevision;
      return {
        city_version: state.version,
        preview_token: hashRequest({ cityId: request.params.cityId, cityVersion: state.version, body }),
        asset,
        feasible: baseMatches,
        operation: "upgrade_building",
        building_id: building.id,
        design_id: linkedDesign.id,
        design_revision: linkedDesign.revision,
        errors: baseMatches ? [] : ["Building changed after this upgrade design was created"],
        cost: { coins: 0, timber: 0, stone: 0 },
        resources_after: state.resources
      };
    }
    const proposal = proposalFromBody(body, principal, asset);
    const preview = previewConstruction(state, proposal);
    return {
      city_version: state.version,
      preview_token: hashRequest({ cityId: request.params.cityId, cityVersion: state.version, body }),
      asset,
      ...preview
    };
  });

  app.post("/api/v1/cities/:cityId/construction-orders", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const { body, linkedDesign } = await resolveConstructionBody(repository, principal, request.params.cityId, request.body ?? {});
    if (config.voxelOnly && body.asset?.mode === "produce") throw new ServiceError(409, "VOXEL_ONLY_MODE", "Image asset production is disabled; use asset.mode=voxel");
    if (body.asset?.mode === "produce") requireScope(principal, "asset:request");
    const expectedVersion = expectedCityVersion(request, body);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "construction-orders",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion,
      action: "construction_order",
      reason: body.actor_note
    }, async ({ client, state, city }) => {
      const assetChoice = body.asset;
      if (!assetChoice || !["reuse", "produce", "voxel"].includes(assetChoice.mode)) throw new ServiceError(400, "ASSET_CHOICE_REQUIRED", "asset.mode must be reuse, produce, or voxel");
      let asset = null;
      if (assetChoice.mode === "reuse") {
        const result = await client.query(
          `SELECT * FROM asset_definitions WHERE id = $1 AND status = 'validated'
           AND (owner_player_id IS NULL OR owner_player_id = $2)`,
          [assetChoice.asset_id, city.owner_player_id]
        );
        if (!result.rowCount) throw new ServiceError(422, "ASSET_NOT_FOUND", "Reusable asset was not found or is not available to this player");
        asset = result.rows[0];
        assertAssetCompatibility(asset, body);
      }
      const resolvedAsset = assetChoice.mode === "voxel"
        ? { mode: "voxel" }
        : asset ? { mode: "reuse", asset_id: asset.id } : { mode: "produce", spec: normalizeAssetSpec(body) };
      const proposal = proposalFromBody(body, principal, resolvedAsset);
      const context = engineContext();
      const orderId = createId("order");
      if (assetChoice.mode === "voxel") {
        if (!linkedDesign) throw new ServiceError(400, "BUILDING_DESIGN_REQUIRED", "Voxel construction must reference a confirmed building design");
        const locked = await client.query(
          "SELECT status, current_revision, confirmed_revision FROM building_designs WHERE id = $1 AND city_id = $2 FOR UPDATE",
          [linkedDesign.id, city.id]
        );
        if (!locked.rowCount || locked.rows[0].status !== "confirmed" || Number(locked.rows[0].confirmed_revision) !== linkedDesign.revision) {
          throw new ServiceError(409, "BUILDING_DESIGN_NOT_CONFIRMED", "Building design changed or is no longer confirmed");
        }
        const sourceBuildingId = linkedDesign.source?.kind === "upgrade" ? linkedDesign.source.buildingId : null;
        const engineResult = sourceBuildingId
          ? executeCityCommand(state, { type: "upgrade_building", buildingId: sourceBuildingId, voxelDesign: body.voxel_design, actor: actorId(principal) }, context)
          : executeCityCommand(state, { type: "construct_building", proposal, assetId: null }, context);
        if (!engineResult.accepted) return rejectedCommand(engineResult);
        const buildingId = engineResult.building.id;
        await client.query(
          `INSERT INTO construction_orders(id, city_id, status, asset_mode, request_jsonb)
           VALUES ($1, $2, 'completed', 'voxel', $3)`,
          [orderId, city.id, JSON.stringify(body)]
        );
        await client.query("UPDATE building_designs SET status = 'built', building_id = $1, updated_at = now() WHERE id = $2", [buildingId, linkedDesign.id]);
        return {
          nextState: engineResult.state,
          response: commandEnvelope(orderId, engineResult, { kind: sourceBuildingId ? "upgrade_order" : "construction_order", id: orderId, status: "completed", building_id: buildingId, design_id: linkedDesign.id, design_revision: linkedDesign.revision })
        };
      }
      if (assetChoice.mode === "reuse") {
        const engineResult = executeCityCommand(state, { type: "construct_building", proposal, assetId: asset.id }, context);
        if (!engineResult.accepted) return rejectedCommand(engineResult);
        await client.query(
          `INSERT INTO construction_orders(id, city_id, status, asset_mode, asset_id, request_jsonb)
           VALUES ($1, $2, 'completed', 'reuse', $3, $4)`,
          [orderId, city.id, asset.id, JSON.stringify(body)]
        );
        return {
          nextState: engineResult.state,
          response: commandEnvelope(orderId, engineResult, { kind: "construction_order", id: orderId, status: "completed", building_id: engineResult.building.id })
        };
      }
      await enforceAssetJobLimit(principal, client);
      const reservationId = createId("reservation");
      const engineResult = executeCityCommand(state, { type: "reserve_construction", proposal, reservationId }, context);
      if (!engineResult.accepted) return rejectedCommand(engineResult);
      const jobId = createId("assetjob");
      const spec = normalizeAssetSpec(body);
      await client.query(
        `INSERT INTO asset_jobs(id, city_id, owner_player_id, status, provider, spec_jsonb, requested_by_principal_kind, requested_by_principal_id)
         VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7)`,
        [jobId, city.id, city.owner_player_id, config.assetProvider, JSON.stringify(spec), principal.kind, principal.id]
      );
      await client.query(
        `INSERT INTO construction_orders(id, city_id, status, reservation_id, asset_mode, asset_job_id, request_jsonb)
         VALUES ($1, $2, 'awaiting_asset', $3, 'produce', $4, $5)`,
        [orderId, city.id, reservationId, jobId, JSON.stringify(body)]
      );
      await client.query(
        `INSERT INTO outbox_jobs(id, job_type, payload_jsonb) VALUES ($1, 'asset_generation_requested', $2)`,
        [createId("outbox"), JSON.stringify({ asset_job_id: jobId, construction_order_id: orderId, city_id: city.id })]
      );
      return {
        nextState: engineResult.state,
        response: commandEnvelope(orderId, engineResult, { kind: "construction_order", id: orderId, status: "awaiting_asset", asset_job_id: jobId, reservation_id: reservationId })
      };
    });
    return reply.code(response.status === "rejected" ? 422 : response.status === "completed" ? 201 : 202).send(response);
  });

  app.get("/api/v1/cities/:cityId/construction-orders", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return { data: await repository.listOrders(principal, request.params.cityId) };
  });

  app.get("/api/v1/cities/:cityId/construction-orders/:orderId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return repository.getOrder(principal, request.params.cityId, request.params.orderId);
  });

  app.post("/api/v1/cities/:cityId/construction-orders/:orderId/cancel", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: `construction-orders/${request.params.orderId}/cancel`,
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "cancel_construction_order",
      reason: body.reason ?? "cancelled_by_actor"
    }, async ({ client, state }) => {
      const found = await client.query("SELECT * FROM construction_orders WHERE id = $1 AND city_id = $2 FOR UPDATE", [request.params.orderId, request.params.cityId]);
      if (!found.rowCount) throw new ServiceError(404, "ORDER_NOT_FOUND", "Construction order not found");
      const order = found.rows[0];
      if (!["awaiting_asset", "asset_validating", "ready_to_build"].includes(order.status)) throw new ServiceError(409, "ORDER_NOT_CANCELLABLE", `Construction order is ${order.status}`);
      const result = executeCityCommand(state, { type: "cancel_construction_reservation", reservationId: order.reservation_id, reason: body.reason ?? "cancelled_by_actor" }, engineContext());
      if (!result.accepted) return rejectedCommand(result);
      await client.query("UPDATE construction_orders SET status = 'cancelled', updated_at = now() WHERE id = $1", [order.id]);
      if (order.asset_job_id) {
        await client.query("UPDATE asset_jobs SET status = 'cancelled', updated_at = now() WHERE id = $1", [order.asset_job_id]);
        await client.query("UPDATE outbox_jobs SET status = 'cancelled', updated_at = now() WHERE payload_jsonb->>'asset_job_id' = $1 AND status IN ('pending', 'processing')", [order.asset_job_id]);
      }
      return { nextState: result.state, response: commandEnvelope(createId("command"), result, { kind: "construction_order", id: order.id, status: "cancelled", refunded: result.refunded }) };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/connection-previews", async (request) => {
    const principal = await authenticate(repository, request, "city:connect");
    const { state } = await repository.getCity(principal, request.params.cityId, { write: true });
    const body = request.body ?? {};
    validateConnectionRequest(body);
    const plan = previewConnectionBetween(state, body.from, body.to);
    const resourcesAfter = plan.feasible ? subtract(state.resources, plan.cost) : null;
    return { city_version: state.version, feasible: Boolean(plan.feasible && !negativeKeys(resourcesAfter).length), plan, resources_after: resourcesAfter };
  });

  app.post("/api/v1/cities/:cityId/connections", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:connect");
    const body = request.body ?? {};
    validateConnectionRequest(body);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "connections",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "connect",
      reason: body.actor_note
    }, async ({ state }) => {
      const result = executeCityCommand(state, { type: "connect", from: body.from, to: body.to, mode: body.mode ?? "road", priority: body.priority, actor: actorId(principal) }, engineContext());
      if (!result.accepted) return rejectedCommand(result);
      const commandId = createId("command");
      return { nextState: result.state, response: commandEnvelope(commandId, result, { kind: "connection", id: commandId, status: "completed" }) };
    });
    return reply.code(response.status === "rejected" ? 422 : 201).send(response);
  });

  app.post("/api/v1/cities/:cityId/time-advances", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "time-advances",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "advance_time",
      reason: body.actor_note
    }, async ({ state }) => {
      const result = executeCityCommand(state, { type: "advance_time", hours: body.hours ?? 24, actor: actorId(principal) }, engineContext());
      if (!result.accepted) return rejectedCommand(result);
      const commandId = createId("command");
      return { nextState: result.state, response: commandEnvelope(commandId, result, { kind: "time_advance", id: commandId, status: "completed", income: result.income }) };
    });
    return reply.code(response.status === "rejected" ? 422 : 201).send(response);
  });

  app.post("/api/v1/cities/:cityId/agent-links", async (request, reply) => {
    const principal = await authenticate(repository, request);
    return reply.code(201).send(await repository.createCapability(principal, request.params.cityId, request.body ?? {}));
  });

  app.get("/api/v1/cities/:cityId/agent-credentials", async (request) => repository.listCredentials(await authenticate(repository, request), request.params.cityId));
  app.delete("/api/v1/cities/:cityId/agent-credentials/:credentialId", async (request) => repository.revokeCredential(await authenticate(repository, request), request.params.cityId, request.params.credentialId));

  app.get("/api/v1/asset-jobs/:jobId", async (request) => repository.getAssetJob(await authenticate(repository, request, "city:read"), request.params.jobId));

  app.post("/api/v1/asset-jobs/:jobId/artifacts", async (request, reply) => {
    if (config.voxelOnly) throw new ServiceError(409, "VOXEL_ONLY_MODE", "Image asset production is disabled in voxel-only mode");
    const principal = await authenticate(repository, request, "asset:request");
    const job = await repository.getAssetJob(principal, request.params.jobId);
    const body = request.body ?? {};
    const response = await completeManualAsset(repository, config, principal, job, body, request.headers["idempotency-key"]);
    return reply.code(response.status === "rejected" ? 422 : 201).send(response);
  });

  return app;
}

function validateConnectionRequest(body) {
  for (const field of ["from", "to"]) {
    const endpoint = body?.[field];
    if (!endpoint || typeof endpoint !== "object") throw new ServiceError(400, "INVALID_CONNECTION_ENDPOINT", `${field} endpoint is required`);
    if (!['building', 'cell', 'node'].includes(endpoint.kind) || typeof endpoint.id !== "string" || !endpoint.id.trim()) {
      throw new ServiceError(400, "INVALID_CONNECTION_ENDPOINT", `${field} must contain kind=building|cell|node and a non-empty id`);
    }
  }
}

async function authenticate(repository, request, scope = null) {
  const authorization = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const principal = await repository.authenticate(match?.[1]);
  if (scope) requireScope(principal, scope);
  return principal;
}

function requireScope(principal, scope) {
  if (principal.kind === "player" || principal.scopes.includes("*") || principal.scopes.includes(scope)) return;
  throw new ServiceError(403, "SCOPE_REQUIRED", `Credential requires ${scope} scope`, { required_scope: scope });
}

function expectedCityVersion(request, body) {
  const direct = body.expected_city_version;
  const header = /^"?(?:city-version-)?(\d+)"?$/.exec(String(request.headers["if-match"] ?? ""))?.[1];
  const value = direct ?? header;
  if (value === undefined) throw new ServiceError(428, "CITY_VERSION_REQUIRED", "expected_city_version or If-Match is required");
  return Number(value);
}

function proposalFromBody(body, principal, asset) {
  const target = body.connection?.target;
  const connectionRequest = target ? {
    ...(target.kind === "building" ? { toBuildingId: target.id } : target.kind === "cell" ? { toCellId: target.id } : { to: target.id }),
    mode: body.connection.mode ?? "road"
  } : null;
  try {
    return normalizeConstructionProposal({
      id: body.proposal_id,
      actor: actorId(principal),
      districtId: body.district_id,
      site: {
        lotId: body.site?.lot_id,
        footprint: body.site?.footprint,
        entrance: body.site?.entrance,
        entranceCellId: body.site?.entrance_cell_id
      },
      program: {
        archetype: body.program?.archetype,
        assetId: asset?.asset_id ?? null,
        purpose: body.program?.purpose,
        name: body.program?.name,
        description: body.program?.description,
        attributes: body.program?.attributes
      },
      design: {
        districtStyle: body.design?.district_style,
        patterns: body.design?.patterns,
        prompt: body.design?.creative_brief ?? body.program?.description ?? `${body.program?.name ?? body.program?.archetype} for MAGTOPIA`
      },
      connectionRequest,
      voxelDesign: body.voxel_design
    }, engineContext());
  } catch (error) {
    throw new ServiceError(400, "INVALID_CONSTRUCTION_PROPOSAL", error.message);
  }
}

function normalizeConstructionBody(input = {}) {
  const site = input.site ?? {};
  const design = input.design ?? {};
  const asset = input.asset ?? {};
  const spec = asset.spec ?? {};
  return {
    ...input,
    expected_city_version: input.expected_city_version ?? input.expectedCityVersion,
    district_id: input.district_id ?? input.districtId,
    proposal_id: input.proposal_id ?? input.proposalId,
    actor_note: input.actor_note ?? input.actorNote,
    site: {
      ...site,
      lot_id: site.lot_id ?? site.lotId ?? site.cell_id ?? site.cellId ?? input.lot_id ?? input.lotId,
      entrance_cell_id: site.entrance_cell_id ?? site.entranceCellId
    },
    design: {
      ...design,
      district_style: design.district_style ?? design.districtStyle,
      creative_brief: design.creative_brief ?? design.creativeBrief ?? design.prompt
    },
    asset: {
      ...asset,
      asset_id: asset.asset_id ?? asset.assetId,
      spec: {
        ...spec,
        district_style: spec.district_style ?? spec.districtStyle,
        creative_brief: spec.creative_brief ?? spec.creativeBrief ?? spec.prompt,
        guide_volume: spec.guide_volume ?? spec.guideVolume ?? spec.volume
      }
    },
    voxel_design: input.voxel_design ?? input.voxelDesign
  };
}

async function validateAssetChoice(repository, principal, body, config) {
  const choice = body.asset;
  if (!choice || !["reuse", "produce", "voxel"].includes(choice.mode)) throw new ServiceError(400, "ASSET_CHOICE_REQUIRED", "asset.mode must be reuse, produce, or voxel");
  if (choice.mode === "voxel") return { mode: "voxel", design_id: body.design_id, design_revision: body.design_revision, design_hash: body.design_hash };
  if (choice.mode === "produce") {
    if (config.voxelOnly) throw new ServiceError(409, "VOXEL_ONLY_MODE", "Image asset production is disabled; use asset.mode=voxel");
    requireScope(principal, "asset:request");
    return { mode: "produce", spec: normalizeAssetSpec(body), provider: "asynchronous" };
  }
  const asset = await repository.getAsset(principal, choice.asset_id);
  if (!asset) throw new ServiceError(422, "ASSET_NOT_FOUND", "Reusable asset was not found");
  assertAssetCompatibility({ id: asset.id, archetype: asset.archetype, footprint: asset.footprint }, body);
  return { mode: "reuse", asset_id: asset.id, compatibility: "exact" };
}

function assertAssetCompatibility(asset, body) {
  if (asset.footprint !== body.site?.footprint) throw new ServiceError(422, "ASSET_NOT_COMPATIBLE", "Asset footprint does not match the construction site", { asset_footprint: asset.footprint, requested_footprint: body.site?.footprint });
  if (asset.archetype !== body.program?.archetype) throw new ServiceError(422, "ASSET_NOT_COMPATIBLE", "Asset archetype does not match the building program", { asset_archetype: asset.archetype, requested_archetype: body.program?.archetype });
}

function normalizeAssetSpec(body) {
  const source = body.asset?.spec ?? {};
  const volume = normalizeAssetVolume(
    source.guide_volume ?? source.volume ?? source.dimensions ?? body.program?.attributes?.guideVolume,
    source.footprint ?? body.site?.footprint
  );
  const spec = {
    archetype: source.archetype ?? body.program?.archetype,
    footprint: source.footprint ?? body.site?.footprint,
    district_style: source.district_style ?? body.design?.district_style ?? "london_common",
    patterns: source.patterns ?? body.design?.patterns ?? [],
    creative_brief: source.creative_brief ?? body.design?.creative_brief ?? body.program?.description ?? body.program?.name,
    guide_volume: volume.id,
    dimensions: volume.dimensions,
    camera: { yaw: 45, elevation: 55, roll: 0, projection: "orthographic" },
    style: "soft_isometric_lowpoly_urban_diorama"
  };
  for (const field of ["archetype", "footprint", "creative_brief"]) {
    if (!String(spec[field] ?? "").trim()) throw new ServiceError(400, "INVALID_ASSET_SPEC", `asset.spec.${field} is required for production`);
  }
  return spec;
}

async function enforceAssetJobLimit(principal, client) {
  if (principal.kind !== "agent") return;
  const configured = Number(principal.limits?.asset_jobs_per_day ?? 3);
  if (configured <= 0) throw new ServiceError(429, "ASSET_JOB_LIMIT_REACHED", "Asset production is disabled for this credential");
  const result = await client.query(
    `SELECT count(*)::integer AS count FROM asset_jobs
     WHERE requested_by_principal_kind = $1 AND requested_by_principal_id = $2 AND created_at >= date_trunc('day', now())`,
    [principal.kind, principal.id]
  );
  if (Number(result.rows[0].count) >= configured) throw new ServiceError(429, "ASSET_JOB_LIMIT_REACHED", "Daily asset production limit reached", { limit: configured, resets_at: "next server-local day" });
}

async function resolveConstructionBody(repository, principal, cityId, input) {
  const designId = input.design_id ?? input.designId;
  if (!designId) return { body: normalizeConstructionBody(input), linkedDesign: null };
  const linkedDesign = await repository.getBuildingDesign(principal, cityId, String(designId));
  const requestedRevision = input.design_revision ?? input.designRevision;
  if (requestedRevision != null && Number(requestedRevision) !== linkedDesign.revision) {
    throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "Requested building design revision is not current", { requested: Number(requestedRevision), actual: linkedDesign.revision });
  }
  const requestedHash = input.design_hash ?? input.designHash;
  if (requestedHash && requestedHash !== linkedDesign.specHash) {
    throw new ServiceError(409, "BUILDING_DESIGN_HASH_MISMATCH", "Requested building design hash does not match the confirmed design");
  }
  let resolved;
  try {
    resolved = buildingDesignToConstructionBody(linkedDesign, input);
  } catch (error) {
    throw new ServiceError(409, "BUILDING_DESIGN_NOT_READY", error.message);
  }
  return { body: normalizeConstructionBody(resolved), linkedDesign };
}

function buildingDesignContext(principal, id = undefined) {
  return {
    ...(id ? { id, seed: id } : {}),
    actor: actorId(principal),
    now: () => new Date().toISOString(),
    hash: hashRequest
  };
}

function designDomainCall(callback) {
  try {
    return callback();
  } catch (error) {
    if (/revision conflict/i.test(error.message)) throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", error.message);
    if (/cannot be revised|cannot be confirmed|already built/i.test(error.message)) throw new ServiceError(409, "BUILDING_DESIGN_LOCKED", error.message);
    throw new ServiceError(400, "INVALID_BUILDING_DESIGN", error.message);
  }
}

function commandEnvelope(commandId, result, resource) {
  return {
    command_id: commandId,
    status: resource.status,
    city_version_before: result.cityVersionBefore,
    city_version_after: result.cityVersionAfter,
    events: result.state.events.filter((event) => event.cityVersion === result.cityVersionAfter).map((event) => event.id),
    resource
  };
}

function rejectedCommand(result) {
  return { nextState: null, response: { command_id: createId("command"), status: "rejected", code: result.code, errors: result.errors, details: { preview: result.preview, plan: result.plan } } };
}

function engineContext() {
  return createEngineContext({ createId, now: () => new Date().toISOString() });
}

function actorId(principal) { return `${principal.kind}:${principal.id}`; }

function spatialQuery(state, query) {
  const minCol = numberParam(query.min_col, 0);
  const minRow = numberParam(query.min_row, 0);
  const maxCol = numberParam(query.max_col, minCol + 9);
  const maxRow = numberParam(query.max_row, minRow + 9);
  if (maxCol < minCol || maxRow < minRow) throw new ServiceError(400, "INVALID_BOUNDS", "Spatial bounds are reversed");
  const area = (maxCol - minCol + 1) * (maxRow - minRow + 1);
  if (area > 400) throw new ServiceError(400, "SPATIAL_QUERY_TOO_LARGE", "Spatial query is limited to 400 logical cells", { area, maximum: 400 });
  const cells = Object.values(state.cells).filter((cell) => cell.column >= minCol && cell.column <= maxCol && cell.row >= minRow && cell.row <= maxRow);
  return { city_version: state.version, bounds: { min_col: minCol, min_row: minRow, max_col: maxCol, max_row: maxRow }, data: cells.map((cell) => expandCell(state, cell)) };
}

function expandCell(state, cell) {
  return {
    ...cell,
    building: cell.occupancy ? compactBuilding(state.buildings[cell.occupancy]) : null,
    node: cell.node ? state.nodes[cell.node] : null
  };
}

function searchBuildings(state, query) {
  const text = String(query.query ?? "").toLocaleLowerCase();
  const limit = Math.min(Number(query.limit ?? 20), 100);
  return Object.values(state.buildings).filter((building) => {
    if (query.archetype && building.program.archetype !== query.archetype) return false;
    if (query.purpose && building.program.purpose !== query.purpose) return false;
    if (text && ![building.program.name, building.program.archetype, building.program.purpose, building.program.description].some((value) => String(value ?? "").toLocaleLowerCase().includes(text))) return false;
    if (query.min_col !== undefined && !buildingInBounds(state, building, query)) return false;
    return true;
  }).slice(0, limit).map((building) => buildingResponse(state, building));
}

function buildingInBounds(state, building, query) {
  return building.footprintCells.some((id) => {
    const cell = state.cells[id];
    return cell.column >= Number(query.min_col) && cell.column <= Number(query.max_col) && cell.row >= Number(query.min_row) && cell.row <= Number(query.max_row);
  });
}

function buildingResponse(state, building) {
  return { ...building, footprint: building.footprintCells.map((id) => ({ cell_id: id, column: state.cells[id]?.column, row: state.cells[id]?.row })) };
}

function compactBuilding(building) { return building ? { id: building.id, name: building.program?.name, archetype: building.program?.archetype, status: building.status ?? "completed" } : null; }

function districtResponse(state, district) {
  const cells = Object.values(state.cells).filter((cell) => (
    cell.column >= district.bounds.minColumn && cell.column <= district.bounds.maxColumn
    && cell.row >= district.bounds.minRow && cell.row <= district.bounds.maxRow
  ));
  // District membership is spatial and intentionally computed at read time.
  // This lets a newly defined district include existing buildings without
  // mutating those buildings or creating a stale one-way assignment.
  const buildingIds = new Set(districtBuildings(state, district).map((building) => building.id));
  const roadCells = cells.filter((cell) => cell.infrastructure === "road" || state.infrastructure[cell.id]?.type === "bridge").length;
  const blocks = districtBlockProgress(state, district);
  const observations = districtSpatialObservations(state, district, blocks);
  const status = district.status ?? "active";
  const suggestions = status === "cancelled" ? [] : districtSuggestions(state, district, observations);
  const compositionReview = status === "cancelled"
    ? {
      status: "cancelled",
      reasons: ["development planning was cancelled", `${buildingIds.size} existing building(s) remain`, `${roadCells} existing road cell(s) remain`],
      suggestions: [],
      note: "Cancellation releases the planning context only. Existing buildings and roads are preserved."
    }
    : districtCompositionReview(state, district, blocks, observations, suggestions);
  const suggestedNextFocus = status === "cancelled"
    ? "none"
    : suggestions[0]?.action ?? (compositionReview.status === "ready_for_review" ? "review_composition" : "continue_composition");
  return {
    ...district,
    status,
    building_ids: [...buildingIds],
    counts: { buildings: buildingIds.size, roads: roadCells, blocks: blocks.blockCount, completed_blocks: blocks.completedBlocks },
    block_progress: blocks,
    observations,
    suggestions,
    composition_review: compositionReview,
    suggested_next_focus: suggestedNextFocus,
    // Deprecated compatibility alias. It is intentionally advisory and no
    // longer represents a server-enforced construction phase.
    recommended_next_action: suggestedNextFocus
  };
}
function numberParam(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function subtract(a, b) { return { coins: a.coins - b.coins, timber: a.timber - b.timber, stone: a.stone - b.stone }; }
function negativeKeys(value) { return value ? Object.entries(value).filter(([, amount]) => amount < 0).map(([key]) => key) : []; }

function summarizeCity(row, config) {
  const state = row.state_jsonb;
  return { ...agentSnapshot(row, state, [], [], config), recent_changes: undefined, needs: undefined };
}

function agentSnapshot(row, state, events, orders, config) {
  const dailyProduction = calculateDailyIncome(state);
  const buildings = Object.values(state.buildings);
  const residential = buildings.filter((building) => building.program?.purpose === "residential").length;
  const services = buildings.length - residential;
  const districts = Object.values(state.districts ?? {}).map((district) => districtResponse(state, district));
  const bridgeCount = Object.values(state.infrastructure ?? {}).filter((item) => item.type === "bridge").length;
  return {
    city_id: row.id,
    name: row.name,
    visibility: row.visibility,
    city_version: Number(row.city_version),
    ruleset_version: row.ruleset_version,
    turn: state.turn,
    elapsed_hours: state.elapsedHours,
    resources: state.resources,
    world: state.world ?? null,
    daily_production: dailyProduction,
    counts: {
      buildings: buildings.length,
      districts: districts.length,
      active_districts: districts.filter((district) => district.status !== "cancelled").length,
      cancelled_districts: districts.filter((district) => district.status === "cancelled").length,
      roads: Object.values(state.cells).filter((cell) => cell.infrastructure === "road").length,
      bridges: bridgeCount,
      pending_orders: orders.filter((order) => !["completed", "failed", "cancelled"].includes(order.status)).length
    },
    needs: [{ kind: "residential", pressure: Math.max(0, Math.min(1, (services - residential) / 5)), reason: "service capacity compared with nearby housing" }],
    recent_changes: events,
    districts,
    pending_orders: orders.filter((order) => !["completed", "failed", "cancelled"].includes(order.status)),
    available_actions: { define_district: true, cancel_district: true, construct: true, connect: true, request_asset: true, spend_full_current_budget: true },
    links: {
      playbook: `${config.publicBaseUrl}/agent/playbook.md`,
      spatial_query: `${config.publicBaseUrl}/api/v1/cities/${row.id}/spatial`,
      buildings: `${config.publicBaseUrl}/api/v1/cities/${row.id}/buildings`,
      events: `${config.publicBaseUrl}/api/v1/cities/${row.id}/events?after_version=${row.city_version}`
    }
  };
}

async function completeManualAsset(repository, config, principal, job, body, idempotencyKey) {
  if (!idempotencyKey) throw new ServiceError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
  if (!["awaiting_codex", "queued", "generating"].includes(job.status)) throw new ServiceError(409, "ASSET_JOB_NOT_ACCEPTING_ARTIFACT", `Asset job is ${job.status}`);
  let manifest = body.manifest;
  if (body.image_data_base64) manifest = await prepareAssetMaps(job.id, Buffer.from(body.image_data_base64, "base64"), { assetOutputRoot: config.assetOutputRoot, spec: job.spec, config });
  if (!manifest?.maps?.rgb) throw new ServiceError(400, "ASSET_ARTIFACT_REQUIRED", "Provide a generated PNG as image_data_base64 or a validated manifest with maps.rgb");
  return finalizeAssetJob({ repository, principal, job, manifest, idempotencyKey, endpoint: `asset-jobs/${job.id}/artifacts` });
}

function homePage(baseUrl) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MAGTOPIA · 麦托邦 · Agent Service</title><style>body{max-width:760px;margin:64px auto;padding:0 24px;background:#14201c;color:#edf2df;font:17px/1.6 system-ui}a{color:#b9e39f}code{background:#24332c;padding:.15em .35em;border-radius:4px}.card{border:1px solid #496153;border-radius:14px;padding:20px;margin:20px 0}</style></head><body><h1>MAGTOPIA Agent City Service</h1><p>麦托邦是一座由 AI Agent 驱动的魔法城市。每位玩家拥有一座默认私有的城市，市政 Agent 通过专属的一次性链接接入，并以受限 API 读取、建设和解释城市。</p><div class="card"><h2>Agent 从这里开始</h2><p><a href="/agent/playbook.md">Playbook</a> · <a href="/openapi.json">OpenAPI 3.1</a> · <a href="/.well-known/magtopia-agent.json">机器发现清单</a></p><p>API base：<code>${baseUrl}/api/v1</code></p></div><div class="card"><h2>城市运营</h2><p><a href="/dashboard">打开城市与资产状态面板</a></p><p>创建玩家与私有城市 → 创建 Agent link → Agent 兑换凭证 → 查询城市 → 预览并提交建设 → 读取事件和异步资产状态。</p></div></body></html>`;
}

function mimeType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

function resolvePublicFile(root, relative) {
  const target = path.resolve(root, String(relative ?? ""));
  if (!target.startsWith(`${root}${path.sep}`)) throw new ServiceError(404, "ASSET_FILE_NOT_FOUND", "Asset file not found");
  return target;
}

async function readBuiltFile(target) {
  try {
    return await fs.readFile(target);
  } catch (error) {
    if (error.code === "ENOENT") throw new ServiceError(404, "ASSET_FILE_NOT_FOUND", "Built viewer asset was not found; run the frontend build first");
    throw error;
  }
}
