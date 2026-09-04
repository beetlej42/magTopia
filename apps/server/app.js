import { createHash, randomInt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
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
import { resolveTurn, validateAssignments } from "../../src/gameplay/simulation.js";
import { buildReportContext, factsDigest, normalizeOwlReport, validateOwlReport } from "../../src/gameplay/owl-report.js";
import {
  activeConstructionDiscountRate,
  activePolicies,
  collectPolicyEffects,
  currentChoice,
  currentOffer,
  cancelSpecialStructurePlacement,
  ensureCardOffer,
  listCards,
  pendingPlacements,
  placeSpecialStructure,
  selectCard
} from "../../src/gameplay/cards.js";
import { getCard } from "../../src/gameplay/card-catalog.js";
import { completedReportTurn, deriveCityDayPresentation } from "../../src/gameplay/city-day.js";
import { playbookGuidance } from "../../src/gameplay/guidance.js";
import { isTurnResolveLocked, initializeTurnSchedule, normalizeTurnSchedule } from "../../src/gameplay/turn.js";
import { arcaneOfficerCapacity, arcaneOfficerRecruitmentUnlocked, currentOfficerCandidates, hireArcaneOfficerCandidate, recruitmentConfigSummary } from "../../src/gameplay/arcane-officers.js";
import { bootstrapGuidance, deriveBootstrapProgress, isBootstrapTurn } from "../../src/gameplay/bootstrap.js";
import { constructionPriceGuide } from "../../src/gameplay/construction-cost.js";
import {
  buildCityArtifactPack,
  cityArtifactPackManifest,
  getBuildingSourceHash
} from "./render-artifact-service.js";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLAYBOOK_PATH = path.resolve(SERVER_DIR, "../../docs/agent-playbook.md");
const BUILDING_DESIGN_API_PATH = path.resolve(SERVER_DIR, "../../docs/BUILDING_DESIGN_API_V1.md");
const DASHBOARD_PATH = path.join(SERVER_DIR, "dashboard.html");
const GENERATED_ROOT = path.resolve(SERVER_DIR, "../../public/generated");
const DIST_ROOT = path.resolve(SERVER_DIR, "../../dist");
const DIST_ASSETS_ROOT = path.join(DIST_ROOT, "assets");

export async function createApp({ repository, config, logger = false, now = () => new Date() }) {
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
  app.get("/agent", async (_request, reply) => reply.type("text/html; charset=utf-8").send(agentStartPage(config.publicBaseUrl)));
  app.get("/agent/openapi", async (_request, reply) => reply.type("text/html; charset=utf-8").send(agentOpenApiPage(createOpenApiDocument(config.publicBaseUrl))));
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
    authentication: "preview the one-time capability URL with GET, then explicitly exchange it with POST for a Bearer token",
    capability_exchange_method: "POST",
    api_base_url: `${config.publicBaseUrl}/api/v1`,
    playbook_url: `${config.publicBaseUrl}/agent/playbook.md`,
    openapi_url: `${config.publicBaseUrl}/openapi.json`,
    browser_start_url: `${config.publicBaseUrl}/agent`,
    browser_openapi_url: `${config.publicBaseUrl}/agent/openapi`
  });
  app.get("/.well-known/magtopia-agent.json", async () => agentDiscovery());
  // Keep the pre-rebrand discovery URL readable for existing Agents.
  app.get("/.well-known/magictown-agent.json", async () => agentDiscovery());
  app.get("/openapi.json", async () => createOpenApiDocument(config.publicBaseUrl));

  app.get("/connect/:capability", { logLevel: "silent", exposeHeadRoute: false }, async (request, reply) => {
    setCapabilityResponseHeaders(reply);
    const exchangeUrl = `${config.publicBaseUrl}/connect/${encodeURIComponent(request.params.capability)}`;
    if (!acceptsHtml(request)) {
      return {
        status: "confirmation_required",
        message: "This one-time link has not been used. POST this exact URL to exchange it for an Agent credential.",
        exchange_method: "POST",
        exchange_url: exchangeUrl
      };
    }
    return reply.type("text/html; charset=utf-8").send(connectionConfirmationPage(request.params.capability));
  });

  app.head("/connect/:capability", { logLevel: "silent" }, async (_request, reply) => {
    setCapabilityResponseHeaders(reply);
    return reply.type("text/html; charset=utf-8").code(200).send();
  });

  app.post("/connect/:capability", { logLevel: "silent" }, async (request, reply) => {
    setCapabilityResponseHeaders(reply);
    const connection = await repository.exchangeCapability(request.params.capability);
    if (acceptsHtml(request)) {
      return reply.type("text/html; charset=utf-8").send(connectionSuccessPage(connection));
    }
    return connection;
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
    const artifactManifest = await readArtifactManifest(repository, principal, {
      cityId: request.params.cityId,
      cityVersion: Number(row.city_version),
      state,
      config
    });
    const artifactPack = artifactManifest.length
      ? cityArtifactPackManifest({ cityId: row.id, cityVersion: Number(row.city_version), manifest: artifactManifest })
      : null;
    return {
      city_id: row.id,
      name: row.name,
      city_version: Number(row.city_version),
      state,
      assets,
      artifact_manifest: artifactManifest,
      artifact_pack: artifactPack,
      render_contract: {
        mode: "agentcity",
        terrain: "base-voxel-heightfield",
        buildings: "city-state-voxel-designs-with-runtime-asset-fallback",
        bakedArtifacts: "versioned-binary-mesh-lod-v1",
        artifactManifest: "render-state.artifact_manifest or /render-artifacts/manifest",
        ...AGENT_VOXEL_ROAD_RENDER_CONTRACT
      }
    };
  });

  app.get("/api/v1/cities/:cityId/render-artifacts/manifest", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    return {
      city_id: row.id,
      city_version: Number(row.city_version),
      data: await readArtifactManifest(repository, principal, { cityId: row.id, cityVersion: Number(row.city_version), state, config })
    };
  });

  app.get("/api/v1/cities/:cityId/render-artifacts/pack", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const cityVersion = Number(row.city_version);
    const artifactManifest = await readArtifactManifest(repository, principal, {
      cityId: request.params.cityId,
      cityVersion,
      state,
      config
    });
    const descriptor = cityArtifactPackManifest({ cityId: row.id, cityVersion, manifest: artifactManifest });
    if (request.query.version !== undefined && Number(request.query.version) !== cityVersion) {
      throw new ServiceError(409, "CITY_ARTIFACT_PACK_VERSION_MISMATCH", "City artifact pack version does not match the current city");
    }
    if (request.query.manifest !== undefined && String(request.query.manifest).toLowerCase() !== descriptor.manifestSha256) {
      throw new ServiceError(409, "CITY_ARTIFACT_PACK_MANIFEST_MISMATCH", "City artifact pack manifest does not match the current city");
    }
    const pack = await buildCityArtifactPack({
      config,
      cityId: row.id,
      cityVersion,
      state,
      manifest: artifactManifest,
      readArtifact: async (entry, building) => {
        if (!building) return null;
        const source = resolveBakedArtifactSource(config, row.id, building, entry);
        return readBakedArtifactBytes(source, { decoded: true });
      }
    });
    if (!pack) throw new ServiceError(404, "RENDER_ARTIFACT_PACK_NOT_FOUND", "No baked render artifacts are available for this city");
    reply
      .type("application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Encoding", "br")
      .header("Content-Length", pack.compressedByteLength);
    return reply.send(pack.compressedBytes);
  });

  app.get("/api/v1/cities/:cityId/render-artifacts/:buildingId", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:read");
    const { state } = await repository.getCity(principal, request.params.cityId);
    const building = state.buildings?.[request.params.buildingId];
    const expectedRevision = Number(request.query.revision ?? building?.voxelDesign?.revision);
    if (!building?.voxelDesign?.generation?.sourceSpec) throw new ServiceError(404, "RENDER_ARTIFACT_NOT_FOUND", "Baked render artifact is not available for this building");
    if (!Number.isInteger(expectedRevision)) throw new ServiceError(400, "INVALID_RENDER_ARTIFACT_REVISION", "Artifact revision must be an integer");
    if (Number(building.voxelDesign.revision) !== expectedRevision) throw new ServiceError(409, "RENDER_ARTIFACT_REVISION_MISMATCH", "Baked render artifact revision does not match the current design");
    const persistedCandidate = await repository.getRenderArtifactManifest?.(principal, request.params.cityId, request.params.buildingId, expectedRevision);
    const persisted = persistedCandidate && persistedCandidate.sourceHash === getBuildingSourceHash(building)
      ? persistedCandidate
      : null;
    const source = resolveBakedArtifactSource(config, request.params.cityId, building, persisted);
    const bytes = source ? await readBakedArtifactBytes(source) : null;
    if (!bytes) throw new ServiceError(404, "RENDER_ARTIFACT_NOT_FOUND", "Baked render artifact is not available for this building");
    reply
      .type("application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Length", bytes.byteLength);
    if (source.contentEncoding) reply.header("Content-Encoding", source.contentEncoding);
    return reply.send(bytes);
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
    const response = await repository.createBuildingDesign(principal, request.params.cityId, draft);
    return reply.code(201).send({
      ...response,
      agent_handoff: designConfirmationHandoff(response, request.params.cityId, config)
    });
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
    const response = await repository.appendBuildingDesignRevision(principal, request.params.cityId, revised, expectedRevision);
    return reply.code(201).send({
      ...response,
      agent_handoff: designConfirmationHandoff(response, request.params.cityId, config)
    });
  });

  app.post("/api/v1/cities/:cityId/building-designs/:designId/confirm", async (request) => {
    const principal = await authenticate(repository, request, "city:build");
    const current = await repository.getBuildingDesign(principal, request.params.cityId, request.params.designId);
    const expectedRevision = request.body?.expected_revision ?? request.body?.expectedRevision;
    const confirmed = designDomainCall(() => confirmBuildingDesign(current, request.body ?? {}, buildingDesignContext(principal)));
    const response = await repository.confirmBuildingDesign(principal, request.params.cityId, confirmed, expectedRevision);
    await enqueueConfirmedRenderArtifact(repository, request.params.cityId, confirmed);
    const { row } = await repository.getCity(principal, request.params.cityId);
    return {
      ...response,
      agent_handoff: confirmedDesignConstructionHandoff(response, request.params.cityId, Number(row.city_version), config)
    };
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
      planning: {
        recommended_candidate_id: candidates[0]?.site_candidate_id ?? null,
        selection_rule: "Candidates are ordered by existing road frontage, shortest road distance, then gateway proximity.",
        price_guide: constructionPriceGuide()
      },
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
        cost: { coins: 0 },
        resources_after: state.resources
      };
    }
    const proposal = proposalFromBody(body, principal, asset);
    const preview = previewConstruction(state, proposal, { constructionDiscountRate: activeConstructionDiscountRate(state) });
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
      const context = engineContext({ constructionDiscountRate: activeConstructionDiscountRate(state) });
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
    if (body.asset?.mode === "voxel" && response.status === "completed") {
      await enqueueRenderArtifactForBuilding(repository, request.params.cityId, response.resource?.building_id ?? response.resource?.buildingId);
    }
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

  app.get("/api/v1/cities/:cityId/strategy", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const gameplay = state.gameplay ?? {};
    const candidateState = currentOfficerCandidates(state, row.id);
    const strategyState = candidateState.state;
    const nowValue = now();
    const turnPlan = agentTurnPlan(row, strategyState, config, nowValue);
    return {
      city_id: row.id,
      city_version: Number(row.city_version),
      turn: state.turn,
      turn_kind: isBootstrapTurn(state) ? "bootstrap" : "normal",
      turn_status: gameplay.turnStatus ?? "open",
      turn_opened_at: gameplay.turnOpenedAt ?? null,
      // Deprecated legacy field, always null: turns no longer carry a deadline
      // that auto-settles. Kept only for API compatibility.
      turn_deadline_at: null,
      next_turn_unlock_at: gameplay.nextTurnUnlockAt ?? null,
      settled_by: gameplay.scheduler?.settledBy ?? null,
      bootstrap: isBootstrapTurn(state) ? {
        progress: deriveBootstrapProgress(state),
        guidance: bootstrapGuidance(deriveBootstrapProgress(state))
      } : null,
      strategy: strategyPayload(strategyState),
      last_turn_facts: gameplay.lastTurnFacts ?? null,
      // Progressive playbook disclosure: a short context hint plus a pointer to
      // the authoritative playbook. Never the full document.
      gameplay_guidance: playbookGuidance(state, { turnLocked: isTurnResolveLocked(state, nowValue) ? gameplay.nextTurnUnlockAt : null }),
      playbook_url: `${config.publicBaseUrl}/agent/playbook.md`,
      agent_turn_plan: turnPlan
    };
  });

  app.post("/api/v1/cities/:cityId/strategy/recruit-officer", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    assertOfficerRecruitmentFields(body);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "strategy/recruit-officer",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "recruit_arcane_officer",
      reason: body.actor_note ?? "recruit_arcane_officer"
    }, async ({ state }) => {
      const result = hireArcaneOfficerCandidate(state, { candidate_id: body.candidate_id }, { cityId: request.params.cityId });
      if (!result.accepted) return { nextState: null, response: rejectedStrategyResponse(result.error.code, result.error.message) };
      return { nextState: { ...result.nextState, version: (state.version ?? 0) + 1 }, response: { command_id: createId("command"), status: "accepted", city_version_before: state.version, city_version_after: (state.version ?? 0) + 1, officer: strategyOfficerResponse(result.arcaneOfficer), cost_coins: result.cost, strategy: strategyPayload({ ...result.nextState, version: (state.version ?? 0) + 1 }) } };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/strategy/assignments", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    assertStrategyTopLevelFields(body, STRATEGY_ASSIGNMENTS_TOP_FIELDS, "Strategy assignments request");
    const assignments = normalizeStrategyAssignments(body.assignments);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "strategy/assignments",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "strategy_assignments",
      reason: body.actor_note ?? "agent_dispatch_plan"
    }, async ({ state }) => {
      const gameplay = state.gameplay ?? {};
      if (CLOSED_TURN_STATUSES.has(gameplay.turnStatus)) {
        return { nextState: null, response: rejectedStrategyResponse("TURN_ALREADY_RESOLVED", `Turn ${state.turn} is already resolved; the strategy phase is closed`) };
      }
      const validation = validateAssignments(state, [], assignments, { responseCapacityBonus: collectPolicyEffects(state).incidentResponseBonus });
      if (!validation.ok) {
        return { nextState: null, response: rejectedStrategyResponse("INVALID_ASSIGNMENT", validation.errors.map((entry) => entry.message).join("; "), validation.errors) };
      }
      const nextState = { ...state, version: (state.version ?? 0) + 1, gameplay: { ...gameplay, turnStatus: "strategy", pendingAssignments: assignments } };
      return {
        nextState,
        response: {
          command_id: createId("command"),
          status: "accepted",
          city_version_before: state.version,
          city_version_after: (state.version ?? 0) + 1,
          turn: state.turn,
          strategy: strategyPayload(nextState)
        }
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/strategy/resolve", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    assertStrategyTopLevelFields(body, STRATEGY_RESOLVE_TOP_FIELDS, "Strategy resolve request");
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "strategy/resolve",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "strategy_resolve",
      reason: body.actor_note ?? "request_system_settlement"
    }, async ({ state }) => {
      const gameplay = state.gameplay ?? {};
      // An active turn must always carry its cooldown gate before it can be
      // resolved. A fresh / pre-scheduler city has none (turnOpenedAt and
      // nextTurnUnlockAt are still null), so write the gate lazily right here
      // instead of letting the resolve fail-open: the client re-reads and
      // retries once the gate elapses. This is the same schedule the scheduler
      // would lazily seed, so whichever runs first wins and the other no-ops.
      if (!CLOSED_TURN_STATUSES.has(gameplay.turnStatus) && gameplay.nextTurnUnlockAt == null) {
        const nowValue = now();
        const initialized = initializeTurnSchedule(state, nowValue, config);
        if (initialized) {
          const gate = initialized.gameplay.nextTurnUnlockAt;
          const wait = turnCooldownHandoff(request.params.cityId, initialized, gate, config, nowValue);
          return {
            nextState: initialized,
            response: {
              command_id: createId("command"),
              status: "rejected",
              code: "TURN_NOT_UNLOCKED",
              message: "The turn was not scheduled yet, so its cooldown gate was written now. Wait until next_turn_unlock_at and resolve again.",
              next_turn_unlock_at: gate,
              city_version_after: initialized.version,
              retryable: true,
              retry_after_seconds: wait.retry_after_seconds,
              agent_turn_plan: wait.agent_turn_plan,
              errors: [{ code: "TURN_NOT_UNLOCKED", message: `Turn ${state.turn} just received its cooldown gate; resolution unlocks at ${gate}` }]
            }
          };
        }
      }
      const nowValue = now();
      if (isTurnResolveLocked(state, nowValue)) {
        const nextTurnUnlockAt = state.gameplay?.nextTurnUnlockAt ?? null;
        const wait = turnCooldownHandoff(request.params.cityId, state, nextTurnUnlockAt, config, nowValue);
        return {
          nextState: null,
          response: {
            command_id: createId("command"),
            status: "rejected",
            code: "TURN_NOT_UNLOCKED",
            message: "The turn cannot be resolved before its cooldown gate elapses; wait until next_turn_unlock_at and resolve again.",
            next_turn_unlock_at: nextTurnUnlockAt,
            city_version_after: state.version,
            retryable: true,
            retry_after_seconds: wait.retry_after_seconds,
            agent_turn_plan: wait.agent_turn_plan,
            errors: [{ code: "TURN_NOT_UNLOCKED", message: `Turn ${state.turn} is still cooling down; resolution unlocks at ${nextTurnUnlockAt ?? "a server-assigned time"}` }]
          }
        };
      }
      const result = resolveTurn(state, { assignments: state.gameplay?.pendingAssignments ?? [], expectedTurn: state.turn }, strategyContext(config, now));
      if (result.error) {
        return { nextState: null, response: rejectedStrategyResponse(result.error.code, result.error.message, result.error.assignmentErrors ?? null) };
      }
      const nextState = { ...result.nextState, gameplay: { ...result.nextState.gameplay, pendingAssignments: [] } };
      return {
        nextState,
        response: {
          command_id: createId("command"),
          status: "resolved",
          city_version_before: state.version,
          city_version_after: nextState.version,
          turn: nextState.turn,
          facts: result.facts,
          strategy: strategyPayload(nextState),
          agent_turn_plan: agentTurnPlan({ id: request.params.cityId, city_version: nextState.version }, nextState, config, now())
        }
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.get("/api/v1/cities/:cityId/cards/current", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    // Bootstrap cards are an explicit no-card state. This GET is a pure read
    // and must not lazily initialize a schedule or write an offer.
    const withCards = isBootstrapTurn(state) ? state : ensureCardOffer(state, row.id);
    if (withCards !== state) {
      await persistCardState(repository, principal, request.params.cityId, withCards);
    }
    return {
      city_id: row.id,
      city_version: Number(withCards.version),
      turn: withCards.turn,
      turn_status: withCards.gameplay?.turnStatus ?? "open",
      offer: currentOffer(withCards),
      choice: currentChoice(withCards),
      pending_placements: pendingPlacements(withCards)
    };
  });

  app.post("/api/v1/cities/:cityId/cards/select", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:read");
    requirePlayer(principal);
    const body = request.body ?? {};
    assertCardSelectTopLevelFields(body);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "cards/select",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "card_select",
      reason: "player_daily_card_selection"
    }, async ({ state }) => {
      const withCards = isBootstrapTurn(state) ? state : ensureCardOffer(state, request.params.cityId);
      const result = selectCard(withCards, request.params.cityId, {
        offerId: body.offer_id,
        selectedCardId: body.selected_card_id,
        decisionMode: body.decision_mode
      }, { now: () => new Date().toISOString(), createId });
      if (!result.accepted) {
        return { nextState: null, response: { command_id: createId("command"), status: "rejected", code: result.code, message: result.message, errors: [{ code: result.code, message: result.message }] } };
      }
      return {
        nextState: result.nextState,
        response: {
          command_id: createId("command"),
          status: "selected",
          city_version_before: state.version,
          city_version_after: result.nextState.version,
          turn: result.nextState.turn,
          selected_card_id: result.cardId,
          card_effects: result.cardEffects,
          choice: currentChoice(result.nextState)
        }
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/cards/place", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    assertCardPlaceTopLevelFields(body);
    const response = await repository.transactCity({
      principal,
      cityId: request.params.cityId,
      endpoint: "cards/place",
      idempotencyKey: request.headers["idempotency-key"],
      requestBody: body,
      expectedVersion: expectedCityVersion(request, body),
      action: "card_place",
      reason: "special_structure_placement"
    }, async ({ state }) => {
      const cardState = state.gameplay?.cardState ?? {};
      const placementId = body.placement_id ?? cardState.pendingPlacement?.placementId ?? null;
      const placement = placementId ? cardState.placements?.[placementId] ?? null : null;
      if (!placement) {
        return { nextState: null, response: rejectedCardPlacement("PLACEMENT_NOT_FOUND", "No pending placement matches the request; pass placement_id from the strategy context") };
      }
      if (placement.mode === "player_place" && principal.kind !== "player") {
        return { nextState: null, response: rejectedCardPlacement("PLACEMENT_ACTOR_NOT_ALLOWED", "A player-owned placement must be resolved by the city owner") };
      }
      if (placement.mode === "delegate_to_agent" && principal.kind === "player") {
        return { nextState: null, response: rejectedCardPlacement("PLACEMENT_ACTOR_NOT_ALLOWED", "A delegated placement must be resolved by the city Agent") };
      }
      const result = placeSpecialStructure(state, request.params.cityId, {
        cardId: body.card_id,
        placementId,
        lotId: body.lot_id,
        footprint: body.footprint,
        entrance: body.entrance
      }, { now: () => new Date().toISOString(), createId });
      if (!result.accepted) {
        return { nextState: null, response: rejectedCardPlacement(result.code, result.message) };
      }
      return {
        nextState: result.nextState,
        response: {
          command_id: createId("command"),
          status: "placed",
          city_version_before: state.version,
          city_version_after: result.nextState.version,
          turn: result.nextState.turn,
          building_id: result.buildingId,
          placement: { ...result.placement, card_title: getCard(result.placement.cardId)?.title ?? null },
          choice: currentChoice(result.nextState)
        }
      };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.post("/api/v1/cities/:cityId/cards/cancel", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    const placementId = body.placement_id ?? body.placementId;
    if (!placementId || Object.keys(body).some((key) => !["placement_id", "placementId", "expected_city_version", "expectedCityVersion", "actor_note"].includes(key))) {
      throw new ServiceError(400, "INVALID_CARD_CANCELLATION", "Cancellation requires placement_id and expected_city_version only");
    }
    const response = await repository.transactCity({
      principal, cityId: request.params.cityId, endpoint: "cards/cancel", idempotencyKey: request.headers["idempotency-key"],
      requestBody: body, expectedVersion: expectedCityVersion(request, body), action: "card_cancel", reason: "special_structure_cancellation"
    }, async ({ state }) => {
      const placement = state.gameplay?.cardState?.placements?.[placementId];
      if (!placement) return { nextState: null, response: rejectedCardPlacement("PLACEMENT_NOT_FOUND", "No pending placement matches the request") };
      if (placement.mode === "player_place" && principal.kind !== "player") return { nextState: null, response: rejectedCardPlacement("PLACEMENT_ACTOR_NOT_ALLOWED", "A player-owned placement must be cancelled by the city owner") };
      if (placement.mode === "delegate_to_agent" && principal.kind === "player") return { nextState: null, response: rejectedCardPlacement("PLACEMENT_ACTOR_NOT_ALLOWED", "A delegated placement must be cancelled by the city Agent") };
      const result = cancelSpecialStructurePlacement(state, { placementId });
      if (!result.accepted) return { nextState: null, response: rejectedCardPlacement(result.code, result.message) };
      return { nextState: result.nextState, response: { command_id: createId("command"), status: "cancelled", city_version_before: state.version, city_version_after: result.nextState.version, turn: state.turn, placement: result.placement, choice: currentChoice(result.nextState) } };
    });
    return reply.code(response.status === "rejected" ? 422 : 200).send(response);
  });

  app.get("/api/v1/cards", async () => ({ data: listCards() }));

  app.get("/api/v1/cities/:cityId/report-context", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const requestedTurn = request.query.turn == null ? null : Number(request.query.turn);
    if (requestedTurn != null && (!Number.isInteger(requestedTurn) || requestedTurn < 1)) {
      throw new ServiceError(400, "INVALID_TURN", "turn must be a positive integer");
    }
    const turn = requestedTurn ?? state.gameplay?.lastTurnFacts?.turn ?? null;
    const facts = turn == null ? null : state.gameplay?.turnFacts?.[turn] ?? null;
    if (!facts) {
      throw new ServiceError(
        404,
        "REPORT_CONTEXT_NOT_FOUND",
        turn == null ? "No resolved turn has produced a ReportContext yet" : `No resolved turn facts exist for turn ${turn}`
      );
    }
    return buildReportContext({ cityId: row.id, state, facts });
  });

  app.post("/api/v1/cities/:cityId/reports", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:build");
    const body = request.body ?? {};
    assertReportTopLevelFields(body);
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const turn = Number(body.turn);
    if (!Number.isInteger(turn) || turn < 1) throw new ServiceError(400, "INVALID_TURN", "turn must be a positive integer");
    const facts = state.gameplay?.turnFacts?.[turn] ?? null;
    if (!facts) throw new ServiceError(422, "TURN_NOT_RESOLVED", `Turn ${turn} has no resolved facts; a report requires a resolved turn`);
    const digest = factsDigest(facts);
    if (String(body.facts_digest ?? "") !== digest) {
      throw new ServiceError(422, "FACTS_DIGEST_MISMATCH", "facts_digest does not match the resolved turn facts; re-read the report-context for this turn");
    }
    const context = buildReportContext({ cityId: row.id, state, facts });
    const validation = validateOwlReport(body.report, context);
    if (!validation.ok) {
      throw new ServiceError(422, "INVALID_OWL_REPORT", validation.errors.map((entry) => entry.message).join("; "), { errors: validation.errors });
    }
    const created = await repository.createOwlReport(
      principal,
      request.params.cityId,
      { turn, factsDigest: digest, report: normalizeOwlReport(body.report) },
      request.headers["idempotency-key"]
    );
    return reply.code(created.idempotent_replay ? 200 : 201).send(created);
  });

  app.get("/api/v1/cities/:cityId/reports", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return { data: await repository.listOwlReports(principal, request.params.cityId) };
  });

  app.get("/api/v1/cities/:cityId/reports/:reportId", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    return repository.getOwlReport(principal, request.params.cityId, request.params.reportId);
  });

  // PR G — player-facing city-day presentation read model. Pure projection of
  // authoritative turn/workflow state; never a second simulation clock.
  app.get("/api/v1/cities/:cityId/city-day", async (request) => {
    const principal = await authenticate(repository, request, "city:read");
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const reportTurn = completedReportTurn(state);
    const reports = reportTurn == null ? [] : await repository.listOwlReports(principal, request.params.cityId);
    const report = reports.find((entry) => Number(entry.turn) === Number(reportTurn)) ?? null;
    const reportReady = report != null;
    const dismissed = reportTurn == null
      ? false
      : Object.hasOwn(await repository.listReportDismissals(principal, request.params.cityId), String(reportTurn));
    const presentation = deriveCityDayPresentation(state, {
      reportReady,
      reportDismissed: dismissed,
      turnOpenedAt: state.gameplay?.turnOpenedAt ?? null
    });
    return {
      city_id: row.id,
      city_version: Number(row.city_version),
      ...presentation,
      report: {
        ...presentation.report,
        report_id: report?.report_id ?? null,
        edition: report?.edition ?? null,
        masthead_title: report?.masthead_title ?? null,
        headline: report?.headline ?? null
      }
    };
  });

  // Records that the player has seen and dismissed a completed day's Owl Daily,
  // so the dawn presentation never replays the same report across reloads/devices.
  app.post("/api/v1/cities/:cityId/city-day/report-dismissed", async (request, reply) => {
    const principal = await authenticate(repository, request, "city:read");
    requirePlayer(principal);
    const body = request.body ?? {};
    const reportTurn = body.report_turn ?? body.reportTurn ?? null;
    if (reportTurn == null || !Number.isInteger(Number(reportTurn)) || Number(reportTurn) < 1) {
      throw new ServiceError(400, "INVALID_REPORT_TURN", "report_turn must be a positive integer");
    }
    const { row, state } = await repository.getCity(principal, request.params.cityId);
    const completedTurn = completedReportTurn(state);
    if (Number(reportTurn) !== Number(completedTurn)) {
      throw new ServiceError(422, "REPORT_TURN_MISMATCH", `The completed day's report is turn ${completedTurn ?? "none"}; cannot dismiss turn ${reportTurn}`);
    }
    await repository.acknowledgeReportDismissal(principal, request.params.cityId, reportTurn);
    reply.header("Cache-Control", "no-store");
    return { city_id: row.id, city_version: Number(row.city_version), report_turn: Number(reportTurn), dismissed: true };
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

function requirePlayer(principal) {
  if (principal?.kind !== "player") {
    throw new ServiceError(403, "PLAYER_CREDENTIAL_REQUIRED", "This action requires a player credential");
  }
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
      gameplayBuilding: body.gameplay_building ?? body.gameplayBuilding ?? body.gameplay ?? body.program?.gameplay,
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
    voxel_design: input.voxel_design ?? input.voxelDesign,
    gameplay_building: input.gameplay_building ?? input.gameplayBuilding ?? input.gameplay
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

const CLOSED_TURN_STATUSES = new Set(["resolved", "reported", "closed"]);

const REPORT_TOP_LEVEL_FIELDS = new Set(["turn", "facts_digest", "report"]);

function assertReportTopLevelFields(body) {
  const unknown = Object.keys(body ?? {}).filter((key) => !REPORT_TOP_LEVEL_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new ServiceError(400, "UNKNOWN_REPORT_REQUEST_FIELD", `Report request contains unsupported field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}; only turn, facts_digest, and report are accepted`);
  }
  if (!body?.report || typeof body.report !== "object" || Array.isArray(body.report)) {
    throw new ServiceError(400, "REPORT_REQUIRED", "report must be an object");
  }
}

const STRATEGY_ASSIGNMENT_FORBIDDEN_FIELDS = new Set([
  "roll", "raw_roll", "rawRoll", "outcome", "total", "modifier", "specialty_bonus", "specialtyBonus",
  "attribute", "attribute_value", "attributeValue", "investigation", "suppression", "coverUp", "cover_up", "containment", "concealment",
  "specialties", "difficulty", "dc", "difficulty_tier", "historical_risk", "source_risk", "success_probability", "successProbability", "expected_outcome",
  "cost", "price", "profile", "options"
]);

const STRATEGY_ASSIGNMENT_ALLOWED_FIELDS = new Set(["incident_id", "incidentId", "arcane_officer_id", "arcaneOfficerId", "rationale"]);

const STRATEGY_ASSIGNMENTS_TOP_FIELDS = new Set(["assignments", "expected_city_version", "actor_note"]);
const STRATEGY_RESOLVE_TOP_FIELDS = new Set(["expected_city_version", "actor_note"]);
const OFFICER_RECRUITMENT_TOP_FIELDS = new Set(["candidate_id", "expected_city_version", "actor_note"]);

function assertStrategyTopLevelFields(body, allowed, label) {
  const unknown = Object.keys(body ?? {}).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ServiceError(400, "UNKNOWN_STRATEGY_REQUEST_FIELD", `${label} contains unsupported field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}; only ${[...allowed].sort().join(", ")} are accepted`);
  }
}

function assertOfficerRecruitmentFields(body) {
  const unknown = Object.keys(body ?? {}).filter((key) => !OFFICER_RECRUITMENT_TOP_FIELDS.has(key));
  if (unknown.length) throw new ServiceError(400, "UNKNOWN_OFFICER_RECRUITMENT_FIELD", `Officer recruitment contains unsupported field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
  if (typeof body?.candidate_id !== "string" || !body.candidate_id.trim()) throw new ServiceError(400, "CANDIDATE_ID_REQUIRED", "candidate_id is required");
}

function normalizeStrategyAssignments(input) {
  const entries = input == null ? [] : Array.isArray(input) ? input : [input];
  if (entries.length > 20) throw new ServiceError(400, "INVALID_ASSIGNMENT", "A strategy phase accepts at most 20 assignments");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ServiceError(400, "INVALID_ASSIGNMENT", `assignments[${index}] must be an object`);
    }
    for (const key of Object.keys(entry)) {
      if (STRATEGY_ASSIGNMENT_FORBIDDEN_FIELDS.has(key)) {
        throw new ServiceError(400, "ASSIGNMENT_CARRIES_SYSTEM_PARAMETER", `Assignment must not carry ${key}; dice, modifiers, outcomes, officer profiles, and balance parameters are system-controlled`);
      }
      if (!STRATEGY_ASSIGNMENT_ALLOWED_FIELDS.has(key)) {
        throw new ServiceError(400, "INVALID_ASSIGNMENT", `assignments[${index}] contains unsupported field "${key}"; only incident_id, arcane_officer_id, and rationale are accepted`);
      }
    }
    const incidentId = String(entry.incident_id ?? entry.incidentId ?? "");
    const arcaneOfficerId = String(entry.arcane_officer_id ?? entry.arcaneOfficerId ?? "");
    if (!incidentId || !arcaneOfficerId) {
      throw new ServiceError(400, "INVALID_ASSIGNMENT", `assignments[${index}] requires incident_id and arcane_officer_id`);
    }
    const rationale = entry.rationale != null ? String(entry.rationale).slice(0, 200) : null;
    return { incidentId, arcaneOfficerId, rationale };
  });
}

function strategyContext(config, now) {
  const seed = config?.gameplaySeed != null ? Number(config.gameplaySeed) : randomInt(0, 0xffffffff);
  return {
    seed,
    now: () => now().toISOString(),
    options: {
      ...normalizeTurnSchedule(config),
      settlementSource: "agent"
    }
  };
}

function rejectedStrategyResponse(code, message, assignmentErrors = null) {
  return {
    command_id: createId("command"),
    status: "rejected",
    code,
    message,
    errors: assignmentErrors ?? [{ code, message }]
  };
}

const CARD_SELECT_TOP_FIELDS = new Set(["offer_id", "selected_card_id", "decision_mode", "expected_city_version", "expectedCityVersion", "actor_note"]);

function assertCardSelectTopLevelFields(body) {
  if (body.effect != null || body.coins != null || body.duration != null || body.policy != null || body.stats != null
    || body.concealment != null || body.population != null || body.specialties != null || body.offer_contents != null) {
    throw new ServiceError(400, "CARD_FORGERY_REJECTED", "Card selection must not carry effect values, durations, coins, population amounts, policy modifiers, or officer stats; the system owns every effect parameter");
  }
  const unknown = Object.keys(body ?? {}).filter((key) => !CARD_SELECT_TOP_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new ServiceError(400, "UNKNOWN_CARD_SELECT_FIELD", `Card selection contains unsupported field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}; only offer_id, selected_card_id, decision_mode, and expected_city_version are accepted`);
  }
}

const CARD_PLACE_TOP_FIELDS = new Set(["card_id", "placement_id", "placementId", "lot_id", "lotId", "footprint", "entrance", "expected_city_version", "expectedCityVersion", "actor_note"]);

function assertCardPlaceTopLevelFields(body) {
  const unknown = Object.keys(body ?? {}).filter((key) => !CARD_PLACE_TOP_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new ServiceError(400, "UNKNOWN_CARD_PLACE_FIELD", `Card placement contains unsupported field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}; only card_id, placement_id, lot_id, footprint, entrance, and expected_city_version are accepted`);
  }
  for (const key of ["concealment", "concealment_bonus", "bonus", "coin_output", "magic_output", "exposure", "policy", "duration"]) {
    if (body[key] != null) {
      throw new ServiceError(400, "CARD_FORGERY_REJECTED", `Card placement must not carry ${key}; the system owns every special structure effect`);
    }
  }
}

function rejectedCardPlacement(code, message) {
  return { command_id: createId("command"), status: "rejected", code, message, errors: [{ code, message }] };
}

async function persistCardState(repository, principal, cityId, nextState) {
  return repository.transactCity({
    principal,
    cityId,
    endpoint: "cards/ensure-offer",
    idempotencyKey: `cards-offer-v${nextState.turn}`,
    requestBody: {},
    expectedVersion: nextState.version,
    action: "card_offer_ensured",
    reason: "lazy card offer creation for the current turn"
  }, async ({ state }) => ({ nextState, response: { command_id: createId("command"), status: "ok", city_version_after: nextState.version } }));
}

function strategyPayload(state) {
  const gameplay = state.gameplay ?? {};
  const incidents = Object.values(gameplay.incidents ?? {})
    .filter((incident) => incident.status === "open" || incident.status === "assigned")
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((incident) => strategyIncidentResponse(state, incident));
  const arcaneOfficers = Object.values(gameplay.arcaneOfficers ?? {})
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((officer) => strategyOfficerResponse(officer));
  return {
    turn_kind: isBootstrapTurn(state) ? "bootstrap" : "normal",
    bootstrap: isBootstrapTurn(state) ? { progress: deriveBootstrapProgress(state), guidance: bootstrapGuidance(deriveBootstrapProgress(state)) } : null,
    incidents,
    arcane_officers: arcaneOfficers,
    arcane_officer_recruitment: officerRecruitmentPayload(state),
    pending_assignments: (gameplay.pendingAssignments ?? []).map((entry) => ({
      incident_id: entry.incidentId,
      arcane_officer_id: entry.arcaneOfficerId,
      rationale: entry.rationale ?? null
    })),
    // PR F — read-only player card state. The Agent can observe the offer, the
    // player's choice, resolved effects, active policies, and delegated
    // placement mandates, but can never author them or choose on the player's
    // behalf.
    cards: {
      offer: currentOffer(state),
      choice: currentChoice(state),
      active_policies: activePolicies(state),
      pending_placements: pendingPlacements(state)
    }
  };
}

function officerRecruitmentPayload(state) {
  const gameplay = state.gameplay ?? {};
  const recruitment = gameplay.arcaneOfficerRecruitment ?? { candidates: {} };
  const unlocked = arcaneOfficerRecruitmentUnlocked(state);
  const config = recruitmentConfigSummary();
  const candidates = unlocked ? Object.values(recruitment.candidates ?? {}).filter((candidate) => candidate.status === "available").map((candidate) => ({ candidate_id: candidate.candidateId, identity: strategyOfficerResponse(candidate.identity), cost_coins: candidate.costCoins, window: candidate.window })) : [];
  return { unlocked, status: unlocked ? "available" : "locked", capacity: arcaneOfficerCapacity(state), roster_size: Object.keys(gameplay.arcaneOfficers ?? {}).length, config, pool_window: unlocked ? recruitment.window : null, candidates };
}

function strategyIncidentResponse(state, incident) {
  const building = state.buildings?.[incident.buildingId];
  return {
    id: incident.id,
    building_id: incident.buildingId,
    building_name: building?.program?.name ?? null,
    type: incident.type,
    attribute: incident.attribute,
    dc: incident.dc,
    difficulty_tier: incident.difficultyTier,
    severity: incident.severity,
    exposure_at_creation: incident.exposureAtCreation,
    historical_risk_at_creation: incident.historicalRiskAtCreation,
    historical_risk: Number(building?.historicalRisk ?? 0),
    source_risk: incident.sourceRisk,
    summary: incident.summary,
    status: incident.status,
    created_at_turn: incident.createdAtTurn
  };
}

function strategyOfficerResponse(officer) {
  return {
    id: officer.id,
    name: officer.name,
    appearance_seed: officer.appearanceSeed ?? null,
    visual_ref: officer.visualRef ?? null,
    archetype: officer.archetype,
    investigation: officer.investigation,
    suppression: officer.suppression,
    cover_up: officer.coverUp,
    specialty: officer.specialty ?? null,
    specialties: [...(officer.specialties ?? [])],
    status: officer.status,
    hired_at_turn: officer.hiredAtTurn,
    history: [...(officer.history ?? [])].map((entry) => ({ turn: entry.turn, incident_id: entry.incidentId, building_id: entry.buildingId, source_purpose: entry.sourcePurpose ?? null, attribute: entry.attribute, outcome: entry.outcome, growth_roll: entry.growthRoll, growth_chance: entry.growthChance, before: entry.before, after: entry.after, gained: entry.gained }))
  };
}

function engineContext(options = {}) {
  return createEngineContext({ createId, now: () => new Date().toISOString(), ...options });
}

function actorId(principal) { return `${principal.kind}:${principal.id}`; }

function spatialQuery(state, query) {
  const columns = Number(state.world?.grid?.columns ?? Math.max(...Object.values(state.cells).map((cell) => cell.column)) + 1);
  const rows = Number(state.world?.grid?.rows ?? Math.max(...Object.values(state.cells).map((cell) => cell.row)) + 1);
  const minCol = spatialIntegerParam(query, "min_col", 0);
  const minRow = spatialIntegerParam(query, "min_row", 0);
  const maxCol = spatialIntegerParam(query, "max_col", Math.min(columns - 1, minCol + 9));
  const maxRow = spatialIntegerParam(query, "max_row", Math.min(rows - 1, minRow + 9));
  const invalidFields = [
    ["min_col", minCol, 0, columns - 1],
    ["max_col", maxCol, 0, columns - 1],
    ["min_row", minRow, 0, rows - 1],
    ["max_row", maxRow, 0, rows - 1]
  ].filter(([, value, minimum, maximum]) => value < minimum || value > maximum)
    .map(([field, value, minimum, maximum]) => ({ field, value, minimum, maximum }));
  if (invalidFields.length) {
    throw new ServiceError(400, "SPATIAL_BOUNDS_OUT_OF_RANGE", "Spatial bounds must stay inside the city grid", {
      invalid_fields: invalidFields,
      grid: { columns, rows },
      recovery: "Use the returned grid limits or query the gateway-centered bounds from the city snapshot."
    });
  }
  if (maxCol < minCol || maxRow < minRow) {
    throw new ServiceError(400, "INVALID_BOUNDS", "Spatial bounds are reversed", {
      received: { min_col: minCol, min_row: minRow, max_col: maxCol, max_row: maxRow },
      recovery: "Ensure max_col >= min_col and max_row >= min_row."
    });
  }
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
function spatialIntegerParam(query, name, fallback) {
  const value = query[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ServiceError(400, "INVALID_SPATIAL_PARAMETER", `${name} must be an integer`, {
      field: name,
      received: value,
      recovery: "Send integer min_col, min_row, max_col, and max_row query parameters."
    });
  }
  return parsed;
}
function subtract(a, b) { return { coins: a.coins - b.coins }; }
function negativeKeys(value) { return value ? Object.entries(value).filter(([, amount]) => amount < 0).map(([key]) => key) : []; }

async function enqueueConfirmedRenderArtifact(repository, cityId, design) {
  if (!repository.enqueueRenderArtifactBake || !design?.generation?.sourceSpec) return null;
  try {
    return await repository.enqueueRenderArtifactBake({
      cityId,
      buildingId: design.source?.kind === "upgrade" ? design.source.buildingId : null,
      designId: design.id,
      designRevision: design.revision,
      sourceHash: design.specHash
    });
  } catch {
    // Queueing is deliberately best-effort. The design confirmation is the
    // authoritative write and must not fail because rendering infrastructure
    // is unavailable; backfill can enqueue it later.
    return null;
  }
}

async function enqueueRenderArtifactForBuilding(repository, cityId, buildingId) {
  if (!buildingId || !repository.enqueueRenderArtifactBakeForBuilding) return null;
  try {
    return await repository.enqueueRenderArtifactBakeForBuilding({ cityId, buildingId });
  } catch {
    return null;
  }
}

async function readArtifactManifest(repository, principal, { cityId, cityVersion, state, config }) {
  if (repository.listRenderArtifactManifest) {
    try {
      const persisted = await repository.listRenderArtifactManifest(principal, cityId);
      const currentBuildings = new Map(Object.values(state.buildings ?? {}).map((building) => [building.id, building]));
      const currentReady = persisted.filter((entry) => {
        const building = currentBuildings.get(entry.buildingId);
        return building
          && Number(building.voxelDesign?.revision) === Number(entry.designRevision)
          && entry.sourceHash === getBuildingSourceHash(building);
      });
      if (currentReady.length) return currentReady.map((entry) => artifactManifestEntry(entry, cityId, cityVersion));
    } catch {
      // A deployment running before the migration keeps the old directory
      // scan/empty-manifest behavior below.
    }
  }
  return createBakedArtifactManifest({ cityId, cityVersion, state, config });
}

function artifactManifestEntry(entry, cityId, cityVersion) {
  return {
    schema: "baked-building-artifact-manifest-v1",
    artifactVersion: Number(entry.artifactVersion),
    cityId,
    cityVersion: Number(cityVersion),
    buildingId: entry.buildingId,
    designRevision: Number(entry.designRevision),
    sourceHash: entry.sourceHash ?? null,
    sha256: entry.sha256,
    byteLength: entry.byteLength == null ? null : Number(entry.byteLength),
    relativePath: entry.relativePath,
    contentEncoding: String(entry.relativePath ?? "").endsWith(".br") ? "br" : null,
    url: `/api/v1/cities/${encodeURIComponent(cityId)}/render-artifacts/${encodeURIComponent(entry.buildingId)}?revision=${encodeURIComponent(String(entry.designRevision))}`
  };
}

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
    turn_kind: isBootstrapTurn(state) ? "bootstrap" : "normal",
    bootstrap: isBootstrapTurn(state) ? { progress: deriveBootstrapProgress(state), guidance: bootstrapGuidance(deriveBootstrapProgress(state)) } : null,
    elapsed_hours: state.elapsedHours,
    resources: state.resources,
    construction_price_guide: constructionPriceGuide(),
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
    available_actions: { define_district: true, cancel_district: true, construct_confirmed_design: true, connect: true, spend_full_current_budget: true },
    links: {
      playbook: `${config.publicBaseUrl}/agent/playbook.md`,
      strategy: `${config.publicBaseUrl}/api/v1/cities/${row.id}/strategy`,
      cards_current: `${config.publicBaseUrl}/api/v1/cities/${row.id}/cards/current`,
      districts: `${config.publicBaseUrl}/api/v1/cities/${row.id}/districts`,
      site_searches: `${config.publicBaseUrl}/api/v1/cities/${row.id}/site-searches`,
      building_designs: `${config.publicBaseUrl}/api/v1/cities/${row.id}/building-designs`,
      construction_previews: `${config.publicBaseUrl}/api/v1/cities/${row.id}/construction-previews`,
      construction_orders: `${config.publicBaseUrl}/api/v1/cities/${row.id}/construction-orders`,
      connection_previews: `${config.publicBaseUrl}/api/v1/cities/${row.id}/connection-previews`,
      connections: `${config.publicBaseUrl}/api/v1/cities/${row.id}/connections`,
      spatial_query: `${config.publicBaseUrl}/api/v1/cities/${row.id}/spatial`,
      buildings: `${config.publicBaseUrl}/api/v1/cities/${row.id}/buildings`,
      events: `${config.publicBaseUrl}/api/v1/cities/${row.id}/events?after_version=${row.city_version}`
    },
    // Progressive playbook disclosure: a short context-appropriate hint, never
    // the full playbook. The authoritative contract lives at links.playbook.
    gameplay_guidance: playbookGuidance(state),
    agent_turn_plan: agentTurnPlan(row, state, config, new Date())
  };
}

function agentTurnPlan(row, state, config, nowValue) {
  const cityVersion = Number(state.version ?? row.city_version);
  const cityBase = `${config.publicBaseUrl}/api/v1/cities/${row.id}`;
  const versionRule = "After every mutation, use city_version_after for the next mutation. If another actor changed the city, reread /strategy and rebuild the request once.";
  if (isBootstrapTurn(state)) {
    const progress = deriveBootstrapProgress(state);
    const activeDistrict = Object.values(state.districts ?? {}).find((district) => district.status !== "cancelled") ?? null;
    const gateway = progress.gatewayLocation;
    const nextAction = !activeDistrict
      ? {
          method: "POST",
          url: `${cityBase}/districts`,
          headers: { "Idempotency-Key": `bootstrap-district-v${cityVersion}` },
          body: { expected_city_version: cityVersion, name: "Gateway Quarter", purpose: "starter housing and local commerce", bounds: starterDistrictBounds(state, gateway) },
          success: "Continue with the returned city_version_after and district.id."
        }
      : !progress.gatewayConnected
        ? {
            method: "POST",
            url: `${cityBase}/connections`,
            headers: { "Idempotency-Key": `bootstrap-gateway-road-v${cityVersion}` },
            body: { expected_city_version: cityVersion, from: { kind: "node", id: "old_town_entry" }, to: { kind: "cell", id: starterRoadTarget(state, gateway, activeDistrict) }, mode: "road", actor_note: "connect the starter quarter to the city gateway" },
            success: "Use city_version_after, then search a 1x1 site in the active district."
          }
        : {
            method: "POST",
            url: `${cityBase}/site-searches`,
            body: { district_id: activeDistrict.id, footprint: "1x1", limit: 3 },
            success: "Use data[0].anchor_cell_id and recommendedEntrance in a BuildingDesign; build housing first, then commerce."
          };
    return {
      objective: "Before the first resolve, connect the gateway and complete at least one residential and one commercial BuildingDesign.",
      ready_to_resolve: progress.readyForMeaningfulFirstResolve,
      missing_milestones: progress.missingRecommendedMilestones,
      gateway: { node_id: progress.gatewayNodeId, ...gateway },
      version_rule: versionRule,
      next_action: nextAction,
      starter_builds: [
        { candidate_index: 0, intent: { name: "Gateway Row House", purpose: "residential", composition: "street", frontage: "residential", access: "private", prominence: "ordinary", magic_level: 0.15 }, requirements: { preferred_floors: 1 } },
        { candidate_index: 1, intent: { name: "Gateway Corner Shop", purpose: "commercial shop", composition: "street", frontage: "display", access: "public", prominence: "ordinary", magic_level: 0.2 }, requirements: { preferred_floors: 1 } }
      ],
      construction_sequence: ["site-searches", "building-designs", "building-designs/{design_id}/confirm", "construction-previews", "construction-orders"],
      resolve_when_ready: progress.readyForMeaningfulFirstResolve
        ? { method: "POST", url: `${cityBase}/strategy/resolve`, headers: { "Idempotency-Key": `resolve-turn-${state.turn}-v${cityVersion}` }, body: { expected_city_version: cityVersion, assignments: [] } }
        : { method: "POST", url: `${cityBase}/strategy/resolve`, instruction: "After both starter builds succeed, use the latest city_version_after as expected_city_version and use a new Idempotency-Key containing that version." }
    };
  }
  const gameplay = state.gameplay ?? {};
  const offer = currentOffer(state);
  const choice = currentChoice(state);
  const placements = pendingPlacements(state);
  let nextAction;
  if (offer && choice?.status === "pending") {
    nextAction = { actor: "player", method: "POST", url: `${cityBase}/cards/select`, instruction: "Wait for the player to choose one offered card; the Agent must not choose it." };
  } else if (placements.length) {
    nextAction = { method: "POST", url: `${cityBase}/cards/place`, instruction: "Complete the delegated special-structure placement described in strategy.cards.pending_placements." };
  } else if (isTurnResolveLocked(state, nowValue)) {
    nextAction = { method: "WAIT", until: gameplay.nextTurnUnlockAt, instruction: "The turn is complete but cooldown-locked; wait instead of adding low-value work." };
  } else {
    nextAction = { method: "POST", url: `${cityBase}/strategy/resolve`, headers: { "Idempotency-Key": `resolve-turn-${state.turn}-v${cityVersion}` }, body: { expected_city_version: cityVersion, assignments: [] } };
  }
  return { objective: "Apply the player card, handle incidents or delegated placements, make one useful development step, then resolve.", version_rule: versionRule, next_action: nextAction };
}

function designConfirmationHandoff(design, cityId, config) {
  return {
    instruction: "Send this exact request next; do not retype the design id or revision.",
    next_action: {
      method: "POST",
      url: `${config.publicBaseUrl}/api/v1/cities/${cityId}/building-designs/${design.id}/confirm`,
      body: { expected_revision: design.revision }
    }
  };
}

function confirmedDesignConstructionHandoff(design, cityId, cityVersion, config) {
  const cityBase = `${config.publicBaseUrl}/api/v1/cities/${cityId}`;
  const body = {
    expected_city_version: cityVersion,
    design_id: design.id,
    design_revision: design.revision,
    design_hash: design.specHash
  };
  return {
    instruction: "Copy this body unchanged: preview it once, then submit the same body as the construction order.",
    preview: { method: "POST", url: `${cityBase}/construction-previews`, body },
    order: {
      method: "POST",
      url: `${cityBase}/construction-orders`,
      headers: { "Idempotency-Key": `build-${design.id}-r${design.revision}-v${cityVersion}` },
      body
    }
  };
}

function turnCooldownHandoff(cityId, state, unlockAt, config, nowValue) {
  const cityVersion = Number(state.version ?? 0);
  const retryAfterSeconds = unlockAt
    ? Math.max(1, Math.ceil((new Date(unlockAt).getTime() - new Date(nowValue).getTime()) / 1000))
    : 1;
  return {
    retry_after_seconds: retryAfterSeconds,
    agent_turn_plan: {
      objective: "Wait for the authoritative cooldown. Do not retry before the stated time.",
      next_action: {
        method: "WAIT",
        until: unlockAt,
        duration_seconds: retryAfterSeconds,
        then: {
          method: "POST",
          url: `${config.publicBaseUrl}/api/v1/cities/${cityId}/strategy/resolve`,
          headers: { "Idempotency-Key": `resolve-turn-${state.turn}-v${cityVersion}` },
          body: { expected_city_version: cityVersion, assignments: [] }
        }
      }
    }
  };
}

function starterDistrictBounds(state, gateway) {
  const columns = Number(state.world?.grid?.columns ?? 50);
  const rows = Number(state.world?.grid?.rows ?? 50);
  const gatewayColumn = Number(gateway?.column ?? columns - 1);
  const gatewayRow = Number(gateway?.row ?? Math.floor(rows / 2));
  const maxColumn = Math.max(4, Math.min(columns - 1, gatewayColumn - 1));
  const minColumn = Math.max(0, maxColumn - 4);
  const minRow = Math.max(0, Math.min(rows - 6, gatewayRow - 2));
  return { minColumn, minRow, maxColumn, maxRow: minRow + 5 };
}

function starterRoadTarget(state, gateway, district) {
  const gatewayColumn = Number(gateway?.column ?? state.world?.grid?.columns ?? 1) - 1;
  const gatewayRow = Number(gateway?.row ?? 0);
  const preferred = `cell-${Math.max(Number(district?.bounds?.minColumn ?? 0), gatewayColumn)}-${Math.min(Number(district?.bounds?.maxRow ?? gatewayRow), Math.max(Number(district?.bounds?.minRow ?? 0), gatewayRow))}`;
  if (state.cells?.[preferred]?.buildable !== false && state.cells?.[preferred]?.strictBuildable !== false) return preferred;
  const candidate = Object.values(state.cells ?? {}).filter((cell) => cell.buildable !== false && cell.strictBuildable !== false && !cell.node
      && Number(cell.column) >= Number(district?.bounds?.minColumn ?? 0)
      && Number(cell.column) <= Number(district?.bounds?.maxColumn ?? state.world?.grid?.columns ?? 50)
      && Number(cell.row) >= Number(district?.bounds?.minRow ?? 0)
      && Number(cell.row) <= Number(district?.bounds?.maxRow ?? state.world?.grid?.rows ?? 50))
    .sort((left, right) => Math.abs(Number(left.column) - gatewayColumn) + Math.abs(Number(left.row) - gatewayRow) - (Math.abs(Number(right.column) - gatewayColumn) + Math.abs(Number(right.row) - gatewayRow)))[0];
  return candidate?.id ?? preferred;
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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MAGTOPIA · 麦托邦 · Agent Service</title><style>${agentPageStyles()}</style></head><body><h1>MAGTOPIA Agent City Service</h1><p>麦托邦是一座由 AI Agent 驱动的魔法城市。每位玩家拥有一座默认私有的城市，市政 Agent 通过专属的一次性链接接入，并以受限 API 读取、建设和解释城市。</p><div class="card"><h2>Agent 从这里开始</h2><p><a href="/agent">浏览器友好的 Agent 起点</a> · <a href="/agent/playbook.md">Playbook</a> · <a href="/agent/openapi">OpenAPI</a></p><p>API base：<code>${baseUrl}/api/v1</code></p></div><div class="card"><h2>城市运营</h2><p><a href="/dashboard">打开城市与资产状态面板</a></p><p>创建玩家与私有城市 → 创建 Agent link → Agent 兑换凭证 → 查询城市 → 按 snapshot 的 <code>agent_turn_plan.next_action</code> 建设并推进回合。</p></div></body></html>`;
}

function agentStartPage(baseUrl) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Agent Start · MAGTOPIA</title><style>${agentPageStyles()}</style></head><body><h1>MAGTOPIA Agent quick start</h1><div class="card"><h2>Shortest reliable path</h2><ol><li>Register with <code>POST ${baseUrl}/api/v1/players</code> and store the returned player bearer token.</li><li>Create a city with <code>POST /api/v1/cities</code>.</li><li>Create an Agent link with <code>POST /api/v1/cities/{city_id}/agent-links</code>, then open its URL.</li><li>Exchange the one-time link once. The browser button performs the required POST without leaving the page.</li><li>Use the Agent token to <code>GET /api/v1/cities/{city_id}/snapshot</code>. Follow <code>agent_turn_plan.next_action</code> and carry forward every <code>city_version_after</code>.</li></ol></div><div class="card"><h2>Contracts</h2><p><a href="/agent/playbook.md">Playbook</a> · <a href="/agent/openapi">Browser OpenAPI</a> · <a href="/openapi.json">Raw OpenAPI JSON</a> · <a href="/.well-known/magtopia-agent.json">Discovery</a></p><p>Construction has one supported path: site search → BuildingDesign → confirm → preview → order. Do not search legacy assets or submit gameplay area/cost fields.</p></div></body></html>`;
}

function agentOpenApiPage(document) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Agent OpenAPI · MAGTOPIA</title><style>${agentPageStyles()}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}</style></head><body><h1>MAGTOPIA Agent OpenAPI</h1><p><a href="/agent">Quick start</a> · <a href="/agent/playbook.md">Playbook</a> · <a href="/openapi.json">Raw JSON</a></p><pre>${escapeHtml(JSON.stringify(document, null, 2))}</pre></body></html>`;
}

function agentPageStyles() {
  return "body{max-width:900px;margin:64px auto;padding:0 24px;background:#14201c;color:#edf2df;font:17px/1.6 system-ui}a{color:#b9e39f}code,pre{background:#24332c;padding:.15em .35em;border-radius:4px}.card{border:1px solid #496153;border-radius:14px;padding:20px;margin:20px 0}";
}

function acceptsHtml(request) {
  return String(request.headers.accept ?? "").toLowerCase().includes("text/html");
}

function setCapabilityResponseHeaders(reply) {
  reply
    .header("Cache-Control", "no-store")
    .header("Pragma", "no-cache")
    .header("Referrer-Policy", "no-referrer")
    .header("X-Robots-Tag", "noindex, nofollow")
    .header("Vary", "Accept");
}

function connectionConfirmationPage(capability) {
  const action = `/connect/${encodeURIComponent(capability)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Connect Agent · MAGTOPIA</title><style>${connectionPageStyles()}</style></head><body><main><p class="eyebrow">MAGTOPIA · Agent connection</p><h1>Confirm one-time connection</h1><p>This link has <strong>not</strong> been used yet. Continue only when you are ready to store the returned bearer token.</p><div class="notice">Opening, previewing, or checking this page never consumes the link. The link is consumed only after the exchange below succeeds.</div><form id="exchange-form" method="post" action="${escapeHtml(action)}"><button id="exchange-button" type="submit">Exchange link and show credential</button><p id="exchange-status" class="hint" role="status" aria-live="polite"></p></form><section id="credential-result" hidden><h2>Agent connected</h2><p>The one-time link has now been consumed. Store this credential before leaving the page.</p><dl><dt>City ID</dt><dd><code id="city-id"></code></dd><dt>Bearer token</dt><dd><textarea id="access-token" readonly rows="4"></textarea></dd><dt>Scopes</dt><dd><code id="scopes"></code></dd><dt>Expires</dt><dd id="expires-at"></dd><dt>API base</dt><dd><code id="api-base"></code></dd></dl><p><a id="playbook-link">Read the Agent Playbook</a> · <a id="openapi-link">OpenAPI</a></p><p class="hint">Send <code>Authorization: Bearer &lt;token&gt;</code> on API requests. Refreshing this page cannot issue the credential again.</p></section><p class="hint">API agents: send <code>POST ${escapeHtml(action)}</code> with <code>Accept: application/json</code>.</p></main><script>${connectionExchangeScript()}</script></body></html>`;
}

function connectionSuccessPage(connection) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Agent connected · MAGTOPIA</title><style>${connectionPageStyles()}</style></head><body><main><p class="eyebrow">MAGTOPIA · Agent connection</p><h1>Agent connected</h1><p>The one-time link has now been consumed. Store this credential before leaving the page.</p><dl><dt>City ID</dt><dd><code>${escapeHtml(connection.city_id)}</code></dd><dt>Bearer token</dt><dd><textarea readonly rows="4">${escapeHtml(connection.access_token)}</textarea></dd><dt>Scopes</dt><dd><code>${escapeHtml(connection.scopes.join(" "))}</code></dd><dt>Expires</dt><dd>${escapeHtml(connection.expires_at)}</dd></dl><p><a href="${escapeHtml(connection.playbook_url)}">Read the Agent Playbook</a> · <a href="${escapeHtml(connection.browser_openapi_url ?? connection.openapi_url)}">OpenAPI</a></p><p class="hint">Send <code>Authorization: Bearer &lt;token&gt;</code> to <code>${escapeHtml(connection.api_base_url)}</code>. Refreshing this page cannot issue the credential again.</p></main></body></html>`;
}

function connectionPageStyles() {
  return "body{max-width:760px;margin:64px auto;padding:0 24px;background:#14201c;color:#edf2df;font:17px/1.6 system-ui}main{border:1px solid #496153;border-radius:16px;padding:28px;background:#192821}h1{line-height:1.15}a{color:#b9e39f}code,textarea{box-sizing:border-box;background:#24332c;color:#edf2df;border:1px solid #496153;border-radius:6px;padding:.25em .45em}textarea{display:block;width:100%;margin-top:6px;resize:vertical}button{border:0;border-radius:8px;padding:12px 18px;background:#b9e39f;color:#14201c;font:700 16px system-ui;cursor:pointer}.eyebrow{color:#b9e39f;text-transform:uppercase;letter-spacing:.08em;font-size:13px}.notice{border-left:4px solid #b9e39f;padding:12px 16px;margin:24px 0;background:#24332c}.hint{color:#bdc8bc;font-size:14px}dt{margin-top:14px;color:#b9e39f;font-weight:700}dd{margin:4px 0}";
}

function connectionExchangeScript() {
  return `const form=document.querySelector("#exchange-form");const button=document.querySelector("#exchange-button");const status=document.querySelector("#exchange-status");const result=document.querySelector("#credential-result");form.addEventListener("submit",async(event)=>{if(typeof fetch!=="function")return;event.preventDefault();button.disabled=true;status.textContent="Exchanging securely…";try{const response=await fetch(form.action,{method:"POST",headers:{Accept:"application/json"},credentials:"same-origin",cache:"no-store"});const payload=await response.json();if(!response.ok)throw new Error(payload.message||("Exchange failed (HTTP "+response.status+")"));document.querySelector("#city-id").textContent=payload.city_id;document.querySelector("#access-token").value=payload.access_token;document.querySelector("#scopes").textContent=Array.isArray(payload.scopes)?payload.scopes.join(" "):"";document.querySelector("#expires-at").textContent=payload.expires_at;document.querySelector("#api-base").textContent=payload.api_base_url;const playbook=document.querySelector("#playbook-link");playbook.href=payload.playbook_url;const openapi=document.querySelector("#openapi-link");openapi.href=payload.browser_openapi_url||payload.openapi_url;form.hidden=true;result.hidden=false;}catch(error){status.textContent="Exchange failed: "+error.message+". Do not retry blindly; the link is consumed only if the server returned a credential.";button.disabled=false;}});`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
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

const BAKED_ARTIFACT_MANIFEST_SCHEMA = "baked-building-artifact-manifest-v1";
const BAKED_ARTIFACT_VERSION = 1;
const BAKED_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const SAFE_ARTIFACT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Build an identity/hash-only manifest; geometry stays in binary artifacts. */
export async function createBakedArtifactManifest({ cityId, cityVersion, state, config = {} }) {
  if (!config.bakedArtifactRoot && !config.bakedArtifacts) return [];
  const entries = [];
  for (const building of Object.values(state?.buildings ?? {})) {
    if (!building?.voxelDesign?.generation?.sourceSpec) continue;
    const revision = Number(building.voxelDesign.revision);
    if (!Number.isInteger(revision)) continue;
    const source = resolveBakedArtifactSource(config, cityId, building);
    if (!source) continue;
    try {
      const bytes = await readBakedArtifactBytes(source, { decoded: true });
      if (!bytes) continue;
      entries.push({
        schema: BAKED_ARTIFACT_MANIFEST_SCHEMA,
        artifactVersion: BAKED_ARTIFACT_VERSION,
        cityId,
        cityVersion: Number(cityVersion),
        buildingId: building.id,
        designRevision: revision,
        sourceHash: building.voxelDesign.generation.sourceHash ?? building.voxelDesign.generation.hash ?? null,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        contentEncoding: source.contentEncoding ?? null,
        url: `/api/v1/cities/${encodeURIComponent(cityId)}/render-artifacts/${encodeURIComponent(building.id)}?revision=${encodeURIComponent(String(revision))}`
      });
    } catch {
      // Stale/corrupt artifacts are optional and must not make city state fail.
    }
  }
  return entries;
}

/** Resolve only safe, deterministic artifact paths; existence is checked on read. */
export function resolveBakedArtifactSource(config = {}, cityId, building, manifest = null) {
  const buildingId = building?.id;
  const revision = Number(building?.voxelDesign?.revision);
  if (!isSafeArtifactSegment(cityId) || !isSafeArtifactSegment(buildingId) || !Number.isInteger(revision) || revision < 0) return null;
  const fixture = resolveBakedArtifactFixture(config.bakedArtifacts, `${cityId}/${buildingId}/${revision}`, buildingId);
  if (fixture !== undefined) return { kind: "fixture", bytes: fixture };
  if (!config.bakedArtifactRoot) return null;
  const root = path.resolve(config.bakedArtifactRoot);
  if (manifest?.relativePath) {
    const relativePath = String(manifest.relativePath);
    const absolutePath = path.resolve(root, relativePath);
    if (!isWithinPath(root, absolutePath) || path.isAbsolute(relativePath)) return null;
    return { kind: "file", root, paths: [absolutePath] };
  }
  const directory = path.resolve(root, cityId, buildingId);
  if (!isWithinPath(root, directory)) return null;
  return {
    kind: "file",
    root,
    directory,
    revision,
    paths: [path.join(directory, `${revision}.mtba.br`), path.join(directory, `${revision}.mtba`)]
  };
}

/** Read a stored artifact; decoded=true inflates optional Brotli transport. */
export async function readBakedArtifactBytes(source, { decoded = false } = {}) {
  if (!source) return null;
  if (source.kind === "fixture") return toBuffer(source.bytes);
  for (const candidate of source.paths ?? []) {
    if (!isWithinPath(source.root, candidate)) continue;
    try {
      const realRoot = await fs.realpath(source.root);
      const realPath = await fs.realpath(candidate);
      if (!isWithinPath(realRoot, realPath)) throw new ServiceError(404, "RENDER_ARTIFACT_NOT_FOUND", "Artifact path is outside the configured root");
      const stored = await fs.readFile(realPath);
      if (stored.byteLength > BAKED_ARTIFACT_MAX_BYTES) throw new ServiceError(413, "RENDER_ARTIFACT_TOO_LARGE", "Baked render artifact is too large");
      source.path = realPath;
      source.contentEncoding = realPath.endsWith(".br") ? "br" : null;
      if (!decoded || !source.contentEncoding) return stored;
      const inflated = brotliDecompressSync(stored);
      if (inflated.byteLength > BAKED_ARTIFACT_MAX_BYTES) throw new ServiceError(413, "RENDER_ARTIFACT_TOO_LARGE", "Baked render artifact is too large");
      return inflated;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  if (source.directory && Number.isInteger(source.revision)) {
    let names = [];
    try {
      names = await fs.readdir(source.directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const revisionPrefix = `${source.revision}-`;
    const hashedNames = names
      .filter((name) => name.startsWith(revisionPrefix) && (/^\d+-[a-f0-9]{64}\.mtba\.br$/i.test(name) || /^\d+-[a-f0-9]{64}\.mtba$/i.test(name)))
      .sort();
    for (const name of hashedNames) {
      const candidate = path.join(source.directory, name);
      if (!isWithinPath(source.root, candidate)) continue;
      try {
        const realRoot = await fs.realpath(source.root);
        const realPath = await fs.realpath(candidate);
        if (!isWithinPath(realRoot, realPath)) continue;
        const stored = await fs.readFile(realPath);
        if (stored.byteLength > BAKED_ARTIFACT_MAX_BYTES) throw new ServiceError(413, "RENDER_ARTIFACT_TOO_LARGE", "Baked render artifact is too large");
        source.path = realPath;
        source.contentEncoding = realPath.endsWith(".br") ? "br" : null;
        if (!decoded || !source.contentEncoding) return stored;
        return brotliDecompressSync(stored);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
    }
  }
  return null;
}

function resolveBakedArtifactFixture(fixtures, key, buildingId) {
  if (!fixtures) return undefined;
  const value = fixtures instanceof Map ? (fixtures.has(key) ? fixtures.get(key) : fixtures.get(buildingId)) : fixtures[key] ?? fixtures[buildingId];
  if (value === undefined) return undefined;
  return value?.bytes ?? value;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  return Buffer.from(value ?? []);
}

function isSafeArtifactSegment(value) {
  return typeof value === "string" && SAFE_ARTIFACT_SEGMENT.test(value) && value !== "." && value !== "..";
}

function isWithinPath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
