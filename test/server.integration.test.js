import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { createApp } from "../apps/server/app.js";
import { createDatabase, migrateDatabase } from "../apps/server/database.js";
import { createRepository } from "../apps/server/repository.js";
import { createWorker } from "../apps/server/worker.js";

const databaseUrl = process.env.MAGICTOWN_TEST_DATABASE_URL;

test("Phase 1–3 HTTP service works end to end", { skip: !databaseUrl, timeout: 120_000 }, async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "magictown-assets-"));
  const config = {
    publicBaseUrl: "http://127.0.0.1:4183",
    capabilityTtlMinutes: 30,
    credentialTtlDays: 90,
    assetProvider: "fixture",
    assetOutputRoot: outputRoot,
    workerPollMs: 5,
    dashscopeApiKey: null,
    dashscopeBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    dashscopeImageModel: "qwen-image-2.0",
    dashscopeImageSize: "1024*1024"
  };
  const database = createDatabase(databaseUrl);
  await migrateDatabase(database);
  await database.query("TRUNCATE agent_action_log, outbox_jobs, construction_orders, asset_jobs, command_receipts, city_events, agent_credentials, agent_capabilities, city_memberships, cities, asset_definitions, players CASCADE");
  const repository = createRepository(database, config);
  await repository.seedBuiltinAssets();
  const app = await createApp({ repository, config });
  const worker = createWorker({ repository, config, logger: { error() {} } });

  try {
    assert.equal((await app.inject({ method: "GET", url: "/" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/dashboard" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/agent/playbook.md" })).statusCode, 200);
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    assert.equal(openapi.openapi, "3.1.0");

    const playerA = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Alice" } }, 201);
    const playerB = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Bob" } }, 201);
    const cityA = await json(app, auth(playerA, { method: "POST", url: "/api/v1/cities", payload: { name: "月柳城" } }), 201);
    const cityB = await json(app, auth(playerB, { method: "POST", url: "/api/v1/cities", payload: { name: "星港城" } }), 201);
    assert.equal(cityA.visibility, "private");

    const link = await json(app, auth(playerA, { method: "POST", url: `/api/v1/cities/${cityA.id}/agent-links`, payload: {} }), 201);
    const capability = link.connect_url.split("/").at(-1);
    const connected = await json(app, { method: "GET", url: `/connect/${capability}` }, 200);
    assert.equal((await app.inject({ method: "GET", url: `/connect/${capability}` })).statusCode, 410);
    const agent = { access_token: connected.access_token };

    const linkB = await json(app, auth(playerB, { method: "POST", url: `/api/v1/cities/${cityB.id}/agent-links`, payload: {} }), 201);
    const connectedB = await json(app, { method: "GET", url: `/connect/${linkB.connect_url.split("/").at(-1)}` }, 200);
    const agentB = { access_token: connectedB.access_token };

    assert.equal((await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }))).statusCode, 200);
    const renderState = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/render-state` }), 200);
    assert.equal(renderState.city_id, cityA.id);
    assert.equal(renderState.city_version, 0);
    assert.ok(Object.keys(renderState.state.cells).length > 0);
    assert.equal(renderState.render_contract.mode, "agentcity");
    assert.equal(renderState.render_contract.infrastructureRenderer, "state-driven-voxel-road-v2-victorian-bridges");
    assert.equal(renderState.render_contract.roadAsset, "shared-victorian-voxel-road-tile-v1");
    assert.equal(renderState.render_contract.agentSuppliesVisualDirections, false);
    assert.equal((await app.inject(auth(agentB, { method: "GET", url: `/api/v1/cities/${cityB.id}/snapshot` }))).statusCode, 200);
    assert.equal((await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${cityB.id}/render-state` }))).statusCode, 403);
    assert.equal((await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${cityB.id}/snapshot` }))).statusCode, 403);
    assert.equal((await app.inject(auth(playerB, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }))).statusCode, 404);

    const cityBRender = await json(app, auth(agentB, { method: "GET", url: `/api/v1/cities/${cityB.id}/render-state` }), 200);
    const cityBGateway = cityBRender.state.cells[cityBRender.state.nodes.old_town_entry.cellId];
    const roadTarget = Object.values(cityBRender.state.cells)
      .filter((cell) => cell.id !== cityBGateway.id && cell.buildable !== false && cell.strictBuildable !== false)
      .filter((cell) => Math.abs(cell.column - cityBGateway.column) + Math.abs(cell.row - cityBGateway.row) >= 5)
      .sort((left, right) => Math.abs(left.row - cityBGateway.row) - Math.abs(right.row - cityBGateway.row) || right.column - left.column)[0];
    const district = await json(app, auth(agentB, {
      method: "POST",
      url: `/api/v1/cities/${cityB.id}/districts`,
      headers: { "idempotency-key": "district-1" },
      payload: {
        expected_city_version: 0,
        name: "月灯坊",
        purpose: "商业住宅混合区",
        bounds: {
          minColumn: Math.max(0, Math.min(cityBGateway.column, roadTarget.column) - 2),
          minRow: Math.max(0, Math.min(cityBGateway.row, roadTarget.row) - 2),
          maxColumn: Math.min(cityBRender.state.world.grid.columns - 1, Math.max(cityBGateway.column, roadTarget.column) + 2),
          maxRow: Math.min(cityBRender.state.world.grid.rows - 1, Math.max(cityBGateway.row, roadTarget.row) + 2)
        }
      }
    }), 201);
    assert.equal(district.resource.district.recommended_next_action, "build_district_roads");
    const districtRoad = await json(app, auth(agentB, {
      method: "POST",
      url: `/api/v1/cities/${cityB.id}/connections`,
      headers: { "idempotency-key": "district-road-1" },
      payload: {
        expected_city_version: district.city_version_after,
        from: { kind: "node", id: "old_town_entry" },
        to: { kind: "cell", id: roadTarget.id },
        mode: "road"
      }
    }), 201);
    const districtSites = await json(app, auth(agentB, {
      method: "POST",
      url: `/api/v1/cities/${cityB.id}/site-searches`,
      payload: { district_id: district.resource.id, footprint: "1x1", limit: 100 }
    }), 200);
    assert.equal(districtSites.district.counts.roads > 0, true);
    assert.equal(districtSites.district.recommended_next_action, "build_along_district_roads");
    assert.ok(districtSites.data.some((candidate) => candidate.context.adjacentRoad));
    assert.ok(districtSites.data.every((candidate) => !("score" in candidate) && !("score_explanation" in candidate)));
    assert.equal(districtRoad.city_version_after, 2);

    const candidates = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/site-searches`, payload: { footprint: "1x1", limit: 8 } }), 200);
    const site1 = candidates.data[0];
    const build1 = buildRequest(cityA.city_version, site1.lotId, "Rose Cottage");
    const camelCasePreview = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-previews`,
      payload: {
        ...build1,
        expected_city_version: undefined,
        expectedCityVersion: cityA.city_version,
        actor_note: undefined,
        actorNote: build1.actor_note,
        site: { lotId: site1.lotId, footprint: "1x1", entrance: "south" },
        design: { districtStyle: "london_common", patterns: ["quiet_front_garden"], creativeBrief: "A compact warm brick cottage." },
        asset: { mode: "reuse", assetId: "starter-cottage-001" }
      }
    }), 200);
    assert.equal(camelCasePreview.feasible, true);
    const missingLot = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-previews`,
      payload: { ...build1, site: { footprint: "1x1", entrance: "south" } }
    }));
    assert.equal(missingLot.statusCode, 400);
    assert.equal(missingLot.json().code, "INVALID_CONSTRUCTION_PROPOSAL");
    const preview1 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-previews`, payload: build1 }), 200);
    assert.equal(preview1.feasible, true);
    const order1 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "build-1" }, payload: build1 }), 201);
    assert.equal(order1.status, "completed");
    const replay = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "build-1" }, payload: build1 }), 201);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.city_version_after, order1.city_version_after);

    const afterFirst = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    const coinsBeforeTime = afterFirst.resources.coins;
    const time = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/time-advances`, headers: { "idempotency-key": "time-1" }, payload: { expected_city_version: afterFirst.city_version, hours: 24 } }), 201);
    assert.ok(time.resource.income.coins > 0);
    const afterTime = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    assert.ok(afterTime.resources.coins > coinsBeforeTime);

    const candidates2 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/site-searches`, payload: { footprint: "1x1", limit: 20 } }), 200);
    const site2 = candidates2.data.find((entry) => entry.lotId !== site1.lotId);
    const build2 = buildRequest(afterTime.city_version, site2.lotId, "Ivy Cottage");
    const order2 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "build-2" }, payload: build2 }), 201);
    const roadPreview = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/connection-previews`, payload: { from: { kind: "building", id: order1.resource.building_id }, to: { kind: "building", id: order2.resource.building_id } } }), 200);
    assert.equal(roadPreview.plan.feasible, true);
    const road = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/connections`, headers: { "idempotency-key": "road-1" }, payload: { expected_city_version: order2.city_version_after, from: { kind: "building", id: order1.resource.building_id }, to: { kind: "building", id: order2.resource.building_id }, mode: "road" } }), 201);
    assert.equal(road.status, "completed");

    const beforeProduction = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    const sites3 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/site-searches`, payload: { footprint: "1x1", limit: 30 } }), 200);
    const site3 = sites3.data.find((entry) => ![site1.lotId, site2.lotId].includes(entry.lotId));
    const produce = produceRequest(beforeProduction.city_version, site3.lotId, "Moonflower House");
    const pending = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "produce-1" }, payload: produce }), 202);
    assert.equal(pending.status, "awaiting_asset");
    const frozen = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    assert.ok(frozen.resources.coins < beforeProduction.resources.coins);
    assert.equal(frozen.counts.pending_orders, 1);
    assert.equal(await worker.processNext(), true);
    const completedOrder = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/construction-orders/${pending.resource.id}` }), 200);
    assert.equal(completedOrder.status, "completed");
    const producedJob = await json(app, auth(agent, { method: "GET", url: `/api/v1/asset-jobs/${pending.resource.asset_job_id}` }), 200);
    assert.equal(producedJob.status, "completed");
    assert.ok(producedJob.output.manifest.maps.depth);
    assert.ok(producedJob.output.manifest.maps.normal);
    assert.ok(producedJob.output.manifest.maps.mask);
    assert.ok(producedJob.output.manifest.maps.emissive);
    assert.equal(producedJob.output.manifest.baseAnchorContract, "guideplate-visible-triangle-v1");
    assert.equal(producedJob.output.manifest.baseAnchorSource, "derived-visible-matte-extrema-v1");
    assert.equal(producedJob.output.manifest.guideplate.guideVolume, "1x1x2");
    assert.equal(producedJob.output.manifest.guideplate.guideVersion, "absolute-scale-v4");
    assert.equal(producedJob.output.manifest.guideplate.scaleContract.heightUnitMeaning, "one normal above-ground storey");
    assert.equal(producedJob.output.manifest.generationContract.promptVersion, "magic-london-absolute-scale-art-v6");
    assert.deepEqual(producedJob.output.manifest.generationContract.inputImageRoles, ["geometry_guideplate"]);
    assert.equal(producedJob.output.manifest.generationContract.styleReferenceId, null);
    assert.deepEqual(producedJob.output.manifest.dimensions, { length: 4, width: 4, height: 8, unit: "world" });
    const producedAnchors = producedJob.output.manifest.baseAnchorsUv;
    assert.ok(producedAnchors.left[0] < producedAnchors.near[0]);
    assert.ok(producedAnchors.near[0] < producedAnchors.right[0]);
    assert.ok(producedAnchors.left[1] > producedAnchors.near[1]);
    assert.ok(producedAnchors.right[1] > producedAnchors.near[1]);
    const producedRenderState = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/render-state` }), 200);
    const producedAsset = producedRenderState.assets.find((asset) => asset.id === producedJob.output.asset_id);
    assert.ok(producedAsset);
    assert.equal(producedAsset.manifest.maps.rgb, producedJob.output.manifest.maps.rgb);
    assert.equal(producedAsset.manifest.maps.emissive, producedJob.output.manifest.maps.emissive);
    assert.ok(Object.values(producedRenderState.state.buildings).some((building) => building.assetId === producedJob.output.asset_id));

    const beforeFailure = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    const sites4 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/site-searches`, payload: { footprint: "1x1", limit: 40 } }), 200);
    const site4 = sites4.data.find((entry) => ![site1.lotId, site2.lotId, site3.lotId].includes(entry.lotId));
    const failureRequest = produceRequest(beforeFailure.city_version, site4.lotId, "Failed House");
    const pendingFailure = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "produce-fail" }, payload: failureRequest }), 202);
    await database.query("UPDATE asset_jobs SET provider = 'unsupported' WHERE id = $1", [pendingFailure.resource.asset_job_id]);
    assert.equal(await worker.processNext(), true);
    const failedOrder = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/construction-orders/${pendingFailure.resource.id}` }), 200);
    assert.equal(failedOrder.status, "failed");
    const afterFailure = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    assert.deepEqual(afterFailure.resources, beforeFailure.resources);
    const failedCell = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/cells/${site4.lotId}` }), 200);
    assert.equal(failedCell.reservation, null);

    config.assetProvider = "codex-manual";
    const beforeManual = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    const sites5 = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/site-searches`, payload: { footprint: "1x1", limit: 50 } }), 200);
    const site5 = sites5.data.find((entry) => ![site1.lotId, site2.lotId, site3.lotId, site4.lotId].includes(entry.lotId));
    const manualRequest = produceRequest(beforeManual.city_version, site5.lotId, "Codex House");
    manualRequest.site.entrance = site5.entranceDirections[0];
    const manualPending = await json(app, auth(agent, { method: "POST", url: `/api/v1/cities/${cityA.id}/construction-orders`, headers: { "idempotency-key": "produce-codex" }, payload: manualRequest }), 202);
    assert.equal(await worker.processNext(), true);
    const awaitingCodex = await json(app, auth(agent, { method: "GET", url: `/api/v1/asset-jobs/${manualPending.resource.asset_job_id}` }), 200);
    assert.equal(awaitingCodex.status, "awaiting_codex");
    assert.match(awaitingCodex.output.prompt, /#FF00FF/);
    const source = await readFile(path.resolve("public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png"));
    const manualCompleted = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/asset-jobs/${manualPending.resource.asset_job_id}/artifacts`,
      headers: { "idempotency-key": "codex-artifact-1" },
      payload: { image_data_base64: source.toString("base64") }
    }), 201);
    assert.equal(manualCompleted.status, "completed");

    const fourthProduction = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders`,
      headers: { "idempotency-key": "produce-over-limit" },
      payload: produceRequest(manualCompleted.city_version_after, site4.lotId, "Quota House")
    }));
    assert.equal(fourthProduction.statusCode, 429);
    assert.equal(fourthProduction.json().code, "ASSET_JOB_LIMIT_REACHED");

    const beforeCancel = await json(app, auth(playerA, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    const playerPending = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders`,
      headers: { "idempotency-key": "player-produce-cancel" },
      payload: produceRequest(beforeCancel.city_version, site4.lotId, "Cancelled House")
    }), 202);
    const cancelled = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders/${playerPending.resource.id}/cancel`,
      headers: { "idempotency-key": "cancel-player-order" },
      payload: { expected_city_version: playerPending.city_version_after, reason: "changed_city_plan" }
    }), 200);
    assert.equal(cancelled.status, "cancelled");
    const afterCancel = await json(app, auth(playerA, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }), 200);
    assert.deepEqual(afterCancel.resources, beforeCancel.resources);

    const voxelDraft = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/building-designs`,
      payload: {
        site: { lot_id: site4.lotId, footprint: "1x1", entrance: site4.entranceDirections[0] },
        intent: { name: "Voxel Tea House", purpose: "tea shop", frontage: "display", style: "victorian_domestic" },
        requirements: { preferred_floors: 1 }
      }
    }), 201);
    assert.equal(voxelDraft.generation.mode, "floor_stack");
    const voxelRevision = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/building-designs/${voxelDraft.id}/revisions`,
      payload: {
        expected_revision: voxelDraft.revision,
        operations: [{ op: "add_decoration", decoration: { id: "tea-sign", type: "hanging_sign", anchor: "main/floor-0/facade-south/bay-1" } }]
      }
    }), 201);
    const voxelConfirmed = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/building-designs/${voxelDraft.id}/confirm`,
      payload: { expected_revision: voxelRevision.revision }
    }), 200);
    assert.equal(voxelConfirmed.status, "confirmed");
    const voxelOrder = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders`,
      headers: { "idempotency-key": "voxel-build-1" },
      payload: {
        expected_city_version: afterCancel.city_version,
        design_id: voxelConfirmed.id,
        design_revision: voxelConfirmed.revision,
        design_hash: voxelConfirmed.specHash
      }
    }), 201);
    assert.equal(voxelOrder.status, "completed");
    const voxelReplay = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders`,
      headers: { "idempotency-key": "voxel-build-1" },
      payload: {
        expected_city_version: afterCancel.city_version,
        design_id: voxelConfirmed.id,
        design_revision: voxelConfirmed.revision,
        design_hash: voxelConfirmed.specHash
      }
    }), 201);
    assert.equal(voxelReplay.idempotent_replay, true);

    const upgradeDraft = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/buildings/${voxelOrder.resource.building_id}/upgrade-designs`,
      payload: { goal: { type: "add_floor", count: 1 } }
    }), 201);
    assert.equal(upgradeDraft.generation.sourceSpec.floors, 2);
    const upgradeConfirmed = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/building-designs/${upgradeDraft.id}/confirm`,
      payload: { expected_revision: upgradeDraft.revision }
    }), 200);
    const upgradePreview = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-previews`,
      payload: {
        expected_city_version: voxelOrder.city_version_after,
        design_id: upgradeConfirmed.id,
        design_revision: upgradeConfirmed.revision,
        design_hash: upgradeConfirmed.specHash
      }
    }), 200);
    assert.equal(upgradePreview.feasible, true);
    const upgradeOrder = await json(app, auth(playerA, {
      method: "POST",
      url: `/api/v1/cities/${cityA.id}/construction-orders`,
      headers: { "idempotency-key": "voxel-upgrade-1" },
      payload: {
        expected_city_version: voxelOrder.city_version_after,
        design_id: upgradeConfirmed.id,
        design_revision: upgradeConfirmed.revision,
        design_hash: upgradeConfirmed.specHash
      }
    }), 201);
    assert.equal(upgradeOrder.resource.kind, "upgrade_order");
    assert.equal(upgradeOrder.resource.building_id, voxelOrder.resource.building_id);

    const credentials = await json(app, auth(playerA, { method: "GET", url: `/api/v1/cities/${cityA.id}/agent-credentials` }), 200);
    await json(app, auth(playerA, { method: "DELETE", url: `/api/v1/cities/${cityA.id}/agent-credentials/${credentials[0].id}` }), 200);
    assert.equal((await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${cityA.id}/snapshot` }))).statusCode, 401);
  } finally {
    await app.close();
    await database.close();
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

function buildRequest(version, lotId, name) {
  return {
    expected_city_version: version,
    actor_note: "增加可达的居民住房",
    site: { lot_id: lotId, footprint: "1x1", entrance: "south" },
    program: { archetype: "starter_residence", purpose: "residential", name, attributes: {} },
    design: { district_style: "london_common", patterns: ["quiet_front_garden"], creative_brief: "A compact warm brick cottage." },
    asset: { mode: "reuse", asset_id: "starter-cottage-001" }
  };
}

function produceRequest(version, lotId, name) {
  return {
    expected_city_version: version,
    actor_note: "现有资产无法表达月光花住宅",
    site: { lot_id: lotId, footprint: "1x1", entrance: "south" },
    program: { archetype: "moon_residence", purpose: "residential", name, attributes: { coinOutput: 7 } },
    design: { district_style: "willow_magic", patterns: ["quiet_front_garden"], creative_brief: "A narrow magical London brick home surrounded by restrained moonflowers." },
    asset: { mode: "produce", spec: { archetype: "moon_residence", footprint: "1x1", district_style: "willow_magic", guide_volume: "1x1x2", creative_brief: "A moonflower residence." } }
  };
}
