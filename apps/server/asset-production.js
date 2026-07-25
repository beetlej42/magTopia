import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createEngineContext, executeCityCommand } from "../../src/city/engine.js";
import { createId, hashRequest } from "./ids.js";
import { ServiceError } from "./errors.js";

const execFileAsync = promisify(execFile);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(SERVER_DIR, "../..");

export function buildAssetPrompt(spec) {
  return [
    spec.creative_brief,
    "Soft isometric low-poly magical London urban diorama; Victorian-Edwardian brick and slate; warm afternoon key light and cool blue-grey shadows.",
    `Exact ${spec.footprint} parcel. High three-quarter orthographic camera, yaw 45 degrees, elevation 55 degrees, roll 0. Keep the whole building and threshold within a clean 8% margin.`,
    "Isolated solid #FF00FF chroma-key background. No neighbouring buildings, characters, vehicles, road beyond the parcel, text, watermark, pixel art, black outlines, or photorealism."
  ].join("\n\n");
}

export async function generateAssetImage(job, config) {
  if (job.provider === "qwen-image") return generateWithQwenImage(job, config);
  if (job.provider === "fixture") {
    const fixture = path.join(WORKSPACE, "public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
    return fs.readFile(fixture);
  }
  throw new ServiceError(409, "ASSET_PROVIDER_REQUIRES_MANUAL_INPUT", `Provider ${job.provider} requires an artifact upload`);
}

async function generateWithQwenImage(job, config) {
  if (!config.dashscopeApiKey) throw new ServiceError(503, "DASHSCOPE_API_KEY_REQUIRED", "DASHSCOPE_API_KEY is not configured", {}, true);
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = String(config.dashscopeBaseUrl ?? "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "");
  const response = await fetchImpl(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.dashscopeApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.dashscopeImageModel ?? "qwen-image-2.0",
      input: {
        messages: [{
          role: "user",
          content: [{ text: buildAssetPrompt(job.spec) }]
        }]
      },
      parameters: {
        negative_prompt: "low resolution, blurry, distorted architecture, malformed roof, neighbouring buildings, people, vehicles, text, logo, watermark, photorealism, black outlines, cropped building, non-magenta background",
        prompt_extend: false,
        watermark: false,
        size: config.dashscopeImageSize ?? "1024*1024",
        n: 1
      }
    })
  });
  const payload = await readJsonResponse(response, "DASHSCOPE_IMAGE_RESPONSE_INVALID");
  if (!response.ok) {
    throw new ServiceError(
      response.status,
      "DASHSCOPE_IMAGE_GENERATION_FAILED",
      payload.message ?? payload.error?.message ?? "DashScope Qwen-Image generation failed",
      { provider_code: payload.code ?? payload.error?.code, request_id: payload.request_id },
      response.status >= 500 || response.status === 429
    );
  }
  const imageUrl = payload.output?.choices?.[0]?.message?.content?.find((item) => item?.image)?.image;
  if (!imageUrl) {
    throw new ServiceError(
      502,
      "DASHSCOPE_IMAGE_RESPONSE_INVALID",
      "DashScope response did not contain output.choices[0].message.content[].image",
      { request_id: payload.request_id },
      true
    );
  }
  return downloadGeneratedPng(fetchImpl, imageUrl);
}

async function downloadGeneratedPng(fetchImpl, imageUrl) {
  let parsed;
  try { parsed = new URL(imageUrl); }
  catch { throw new ServiceError(502, "DASHSCOPE_IMAGE_URL_INVALID", "DashScope returned an invalid image URL", {}, true); }
  if (parsed.protocol !== "https:") throw new ServiceError(502, "DASHSCOPE_IMAGE_URL_INVALID", "DashScope image URL must use HTTPS", {}, true);
  const response = await fetchImpl(parsed, { redirect: "follow" });
  if (!response.ok) throw new ServiceError(response.status, "DASHSCOPE_IMAGE_DOWNLOAD_FAILED", "Failed to download the generated Qwen image", {}, response.status >= 500 || response.status === 429);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 20 * 1024 * 1024) throw new ServiceError(502, "DASHSCOPE_IMAGE_TOO_LARGE", "Generated Qwen image exceeds the 20 MB limit");
  return readLimitedBody(response, 20 * 1024 * 1024);
}

async function readJsonResponse(response, code) {
  try { return await response.json(); }
  catch { throw new ServiceError(502, code, "DashScope returned a non-JSON response", {}, true); }
}

async function readLimitedBody(response, limit) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new ServiceError(502, "DASHSCOPE_IMAGE_TOO_LARGE", "Generated Qwen image exceeds the 20 MB limit");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ServiceError(502, "DASHSCOPE_IMAGE_TOO_LARGE", "Generated Qwen image exceeds the 20 MB limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function prepareAssetMaps(jobId, sourceBytes, options = {}) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length < 100 || sourceBytes.length > 20 * 1024 * 1024) throw new ServiceError(400, "INVALID_IMAGE_ARTIFACT", "Image artifact size is invalid");
  assertPng(sourceBytes);
  const relativeDir = `generated/agent-assets/${jobId}`;
  const publicDir = options.assetOutputRoot ? path.join(options.assetOutputRoot, jobId) : path.join(WORKSPACE, "public", relativeDir);
  await fs.mkdir(publicDir, { recursive: true });
  const sourcePath = path.join(publicDir, "source-magenta.png");
  await fs.writeFile(sourcePath, sourceBytes);
  await execFileAsync(process.execPath, [path.join(WORKSPACE, "scripts/derive_isometric_asset_maps.mjs"), sourcePath, publicDir], { cwd: WORKSPACE, maxBuffer: 2 * 1024 * 1024 });
  const manifest = JSON.parse(await fs.readFile(path.join(publicDir, "asset.json"), "utf8"));
  const maps = Object.fromEntries(Object.entries(manifest.maps).map(([name, file]) => [name, `/${relativeDir}/${file}`]));
  return { ...manifest, maps, sourceImage: `/${relativeDir}/source-magenta.png`, pipeline: "derive_isometric_asset_maps@1" };
}

export async function finalizeAssetJob({ repository, principal, job, manifest, idempotencyKey, endpoint = null }) {
  const db = repository.database;
  const orderResult = await db.query("SELECT * FROM construction_orders WHERE asset_job_id = $1", [job.id]);
  if (!orderResult.rowCount) throw new ServiceError(409, "ORDER_NOT_FOUND", "Asset job has no construction order");
  const order = orderResult.rows[0];
  const assetId = createId("asset");
  return repository.transactCity({
    principal,
    cityId: job.city_id,
    endpoint: endpoint ?? `worker/asset-jobs/${job.id}`,
    idempotencyKey,
    requestBody: { job_id: job.id, manifest_hash: hashRequest(manifest) },
    expectedVersion: undefined,
    action: "complete_asset_job",
    reason: `Validated ${job.provider} asset production`
  }, async ({ client, state, city }) => {
    const current = await client.query("SELECT status FROM asset_jobs WHERE id = $1 FOR UPDATE", [job.id]);
    if (current.rows[0]?.status === "completed") throw new ServiceError(409, "ASSET_JOB_ALREADY_COMPLETED", "Asset job is already completed");
    const result = executeCityCommand(state, { type: "complete_reserved_construction", reservationId: order.reservation_id, assetId }, engineContext());
    if (!result.accepted) return rejectedCommand(result);
    const finalManifest = { ...manifest, assetId, archetype: job.spec.archetype, footprint: job.spec.footprint, districtStyle: job.spec.district_style, source: job.provider };
    await client.query(
      `INSERT INTO asset_definitions(id, owner_player_id, archetype, footprint, district_style, tags, status, source, manifest_jsonb)
       VALUES ($1, $2, $3, $4, $5, $6, 'validated', $7, $8)`,
      [assetId, city.owner_player_id, job.spec.archetype, job.spec.footprint, job.spec.district_style, job.spec.patterns ?? [], job.provider, JSON.stringify(finalManifest)]
    );
    await client.query("UPDATE asset_jobs SET status = 'completed', output_jsonb = $1, error_jsonb = NULL, updated_at = now() WHERE id = $2", [JSON.stringify({ asset_id: assetId, manifest: finalManifest }), job.id]);
    await client.query("UPDATE construction_orders SET status = 'completed', asset_id = $1, updated_at = now() WHERE id = $2", [assetId, order.id]);
    return { nextState: result.state, response: commandEnvelope(createId("command"), result, { kind: "asset_job", id: job.id, status: "completed", asset_id: assetId, building_id: result.building.id }) };
  });
}

export async function failAssetJob({ repository, job, message, terminal = true }) {
  const db = repository.database;
  const orderResult = await db.query("SELECT * FROM construction_orders WHERE asset_job_id = $1", [job.id]);
  if (!orderResult.rowCount) return;
  const order = orderResult.rows[0];
  if (!terminal) {
    await db.query("UPDATE asset_jobs SET status = 'queued', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify({ message }), job.id]);
    return;
  }
  const principal = { kind: "agent", id: "system-asset-worker", cityId: job.city_id, scopes: ["city:build", "asset:request"] };
  await repository.transactCity({
    principal,
    cityId: job.city_id,
    endpoint: `worker/asset-jobs/${job.id}/failure`,
    idempotencyKey: `terminal-failure-${job.id}`,
    requestBody: { job_id: job.id, message },
    expectedVersion: undefined,
    action: "fail_asset_job",
    reason: message
  }, async ({ client, state }) => {
    const result = executeCityCommand(state, { type: "cancel_construction_reservation", reservationId: order.reservation_id, reason: "asset_generation_failed" }, engineContext());
    if (!result.accepted) return rejectedCommand(result);
    await client.query("UPDATE asset_jobs SET status = 'failed', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify({ message }), job.id]);
    await client.query("UPDATE construction_orders SET status = 'failed', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify({ message }), order.id]);
    return { nextState: result.state, response: commandEnvelope(createId("command"), result, { kind: "asset_job", id: job.id, status: "failed", refunded: result.refunded }) };
  });
}

function assertPng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new ServiceError(400, "IMAGE_MUST_BE_PNG", "Asset production currently accepts PNG source images only");
}

function engineContext() { return createEngineContext({ createId, now: () => new Date().toISOString() }); }
function commandEnvelope(commandId, result, resource) { return { command_id: commandId, status: resource.status, city_version_before: result.cityVersionBefore, city_version_after: result.cityVersionAfter, events: result.state.events.filter((event) => event.cityVersion === result.cityVersionAfter).map((event) => event.id), resource }; }
function rejectedCommand(result) { return { nextState: null, response: { command_id: createId("command"), status: "rejected", code: result.code, errors: result.errors } }; }
