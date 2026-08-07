import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createEngineContext, executeCityCommand } from "../../src/city/engine.js";
import { createId, hashRequest } from "./ids.js";
import { ServiceError } from "./errors.js";
import { generateHunyuanAssetBundle } from "./hunyuan-production.js";

const execFileAsync = promisify(execFile);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(SERVER_DIR, "../..");
const GUIDEPLATE_ROOT = path.join(WORKSPACE, "public/generated/asset-guides");
const GUIDEPLATE_SCRIPT = path.join(WORKSPACE, "scripts/generate_parcel_guide.py");
const NORMALIZE_ASSET_SCRIPT = path.join(WORKSPACE, "scripts/normalize_isometric_asset.py");
const GUIDEPLATE_PYTHON = path.join(WORKSPACE, ".venv/bin/python");
const STYLE_REFERENCE_PATH = path.join(WORKSPACE, "public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
const HUNYUAN_STYLE_REFERENCE_PATH = path.join(WORKSPACE, "docs/reference-images/isometric-magic-london-city.jpg");
const WORLD_UNITS_PER_CELL = 4;
export const ASSET_PROMPT_VERSION = "magic-london-absolute-scale-art-v6";
export const STYLE_REFERENCE_ID = "starter-cottage-asset-style-v1";

export function buildAssetPrompt(spec, options = {}) {
  const volume = normalizeAssetVolume(spec.guide_volume ?? spec.dimensions, spec.footprint);
  const { length, width, height } = volume.dimensions;
  const { length: cellsWide, width: cellsDeep, height: storeys } = volume.gridDimensions;
  const usesStyleReference = options.usesStyleReference === true;
  const imageRoleContract = usesStyleReference
    ? "最重要的图片角色约束：请编辑图2。图2是必须严格遵守的几何与输出底图，保留它的画布、正交镜头、地块角点、体量、层高、人物尺度以及地块外纯色 #FF00FF 背景；只把蓝灰色体块替换为建筑，并删除所有辅助线、参考门和箭头。图1仅用于参考 MAGTOPIA 单体建筑的柔和低多边形画风、简化程度、配色、哑光材质和暖光冷影；不要复制图1的具体房屋设计。"
    : "最重要的图片角色约束：只输入了一张图。请编辑图1。图1是必须严格遵守的几何、尺度、镜头和输出底图；保留它的正方形画布、正交镜头、地块菱形、三个可见地块角点、蓝灰色体量的占地与高度、标准门所表达的人物尺度，以及地块外逐像素一致的纯色 #FF00FF 背景。只把蓝灰色体块替换为建筑，并删除所有辅助线、层高分隔线、参考门和箭头。没有其他风格参考图；美术风格只能按照以下文字规范生成，不得自行添加街景或写实环境。";
  const backgroundReference = usesStyleReference ? "图2" : "图1";
  return [
    spec.creative_brief,
    imageRoleContract,
    "ART DIRECTION — VISUAL NORTH STAR: a warm, dense, historical Victorian–Edwardian London quietly altered by magic. It is a polished soft-isometric low-poly city game asset, not a realistic architectural visualization, miniature photography, toy model, medieval fantasy village, or glossy PBR render.",
    "ART DIRECTION — GEOMETRY AND MATERIALS: use a clean game-asset rendering with a clear readable silhouette, broad roof and wall planes, gentle faceted geometry, crisp but non-black material boundaries, substantial eaves, and only one to three identifying details. Express brick and slate through simplified grouped shapes and restrained color variation. Do not render dense individual bricks, roof tiles, mortar lines, chips, wear, or microtexture. Avoid photographic texture, heavy beveling, surface noise, glossy reflections, metallic walls, and strong ambient occlusion.",
    "ART DIRECTION — ARCHITECTURAL LANGUAGE: Victorian–Edwardian London brick and slate. Prefer terracotta or deep-brown brick, dark slate roofs, warm sandstone or aged-limestone trim, aged timber, orderly human-scale window rhythms, chimneys, and a clearly readable entrance. Magic is embedded in ordinary urban architecture rather than replacing it.",
    "ART DIRECTION — PALETTE: London brick red #A95E4A, deep brick brown #70483D, slate blue-grey #586172, deep roof grey #343B49, warm sandstone #C9B89C, aged limestone #D9D2C4, aged timber, and warm window gold #F0BF67. Use at most three dominant material colors on one building. Magic violet #8068B7 or teal #6DBCB2 may appear only as a small narrative accent; never wash the building in neon color.",
    "ART DIRECTION — LIGHTING: warm, slightly hazy London afternoon key light from upper-left; soft cool blue-grey shadows; matte high-roughness surfaces; low specular response; moderate contrast; no dramatic studio spotlight, hard black cast shadow, cinematic rim light, or magenta light spill from the chroma background.",
    `The supplied guide volume is exactly ${volume.id} city-grid units (${length}×${width}×${height} world units). Fill that translucent volume naturally: do not make the requested building look like a smaller building merely enlarged on canvas, and do not exceed the envelope.`,
    `ABSOLUTE SCALE CONTRACT: one horizontal grid unit is one city parcel cell; one vertical grid unit is exactly one normal above-ground storey. This asset is ${cellsWide} cell${cellsWide === 1 ? "" : "s"} wide, ${cellsDeep} cell${cellsDeep === 1 ? "" : "s"} deep, and exactly ${storeyWord(storeys)} above-ground ${storeys === 1 ? "storey" : "storeys"}. Keep doors, windows, eaves, and floor-to-floor spacing at consistent human scale across every asset.`,
    volume.id === "1x1x1"
      ? "MANDATORY 1x1x1 SCALE: create one small, one-storey detached building. It has exactly one occupied facade level. Do not add a second row of facade windows, a habitable upper floor, dormers, a mezzanine, or miniature doors and windows."
      : `MANDATORY ${volume.id} SCALE: show exactly ${storeyWord(storeys)} clearly separated occupied facade ${storeys === 1 ? "level" : "levels"}; never compress extra storeys into the envelope by shrinking doors or windows.`,
    `Exact ${spec.footprint} city parcel. High three-quarter orthographic camera, yaw 45 degrees, elevation 55 degrees, roll 0. Keep the whole building and threshold within a clean 8% margin.`,
    "Use the supplied guide image as a strict composition and absolute-scale template. Its translucent horizontal bands each mark one normal storey, and its amber ghost door is a standard 0.9×2.2 world-unit human-scale reference on the camera-facing south/front facade. Put the real opaque main entrance at that front reference-door position. Replace the blue-grey volume and dark parcel with the requested building and parcel while preserving the exact camera, outer parcel diamond, and three visible parcel corners.",
    "Remove every guide edge, storey band, ghost door, line, arrow, and annotation from the final image. Do not render any letters, words, labels, numbers, percentages, symbols, or coordinate marks.",
    "Include a few clearly warm amber window panes so a restrained emissive night-light mask can be derived.",
    `OUTPUT BACKGROUND IS A HARD PIXEL-COLOR CONTRACT: preserve ${backgroundReference}'s perfectly flat solid #FF00FF outside the parcel. Do not replace it with white, grey, blue, a studio sweep, sky, gradient, texture, glow, reflected magenta light, or cast shadow outside the parcel. No neighbouring buildings, characters, vehicles, road beyond the parcel, text, watermark, pixel art, black outlines, or photorealism.`
  ].join("\n\n");
}

export async function generateAssetImage(job, config) {
  if (job.provider === "hunyuan-image") return (await generateAssetBundle(job, config)).sourceBytes;
  if (job.provider === "qwen-image" || job.provider === "wan-image") return generateWithDashScopeImage(job, config);
  if (job.provider === "fixture") {
    const fixture = path.join(WORKSPACE, "public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
    return fs.readFile(fixture);
  }
  throw new ServiceError(409, "ASSET_PROVIDER_REQUIRES_MANUAL_INPUT", `Provider ${job.provider} requires an artifact upload`);
}

export async function generateAssetBundle(job, config) {
  if (job.provider !== "hunyuan-image") {
    return {
      sourceBytes: await generateAssetImage(job, config),
      production: {
        provider: job.provider,
        model: job.model ?? (job.provider === "qwen-image" || job.provider === "wan-image" ? config.dashscopeImageModel : null),
        promptVersion: ASSET_PROMPT_VERSION
      }
    };
  }
  const [guideplate, styleReference] = await Promise.all([
    resolveAssetGuideplate(job.spec, config),
    resolveHunyuanStyleReference(config)
  ]);
  return generateHunyuanAssetBundle({ job, config, guideplate, styleReference, workspace: WORKSPACE });
}

async function generateWithDashScopeImage(job, config) {
  if (!config.dashscopeApiKey) throw new ServiceError(503, "DASHSCOPE_API_KEY_REQUIRED", "DASHSCOPE_API_KEY is not configured", {}, true);
  const fetchImpl = config.fetch ?? fetch;
  const baseUrl = String(config.dashscopeBaseUrl ?? "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "");
  const suppliedInputs = Array.isArray(job.inputImages) ? job.inputImages : null;
  const guideplate = suppliedInputs ? null : await resolveAssetGuideplate(job.spec, config);
  const usesStyleReference = config.dashscopeStyleReferenceEnabled === true;
  const stylePack = suppliedInputs
    ? { references: suppliedInputs.map(normalizeDashScopeInputImage) }
    : usesStyleReference ? await resolveStyleReferences(config) : { references: [] };
  const prompt = typeof job.prompt === "string" && job.prompt.trim()
    ? job.prompt.trim()
    : buildAssetPrompt(job.spec, { usesStyleReference });
  const model = job.model ?? config.dashscopeImageModel ?? "qwen-image-2.0";
  const isWan27 = /^wan2\.7-image(?:-pro)?$/.test(model);
  const parameters = isWan27
    ? {
        size: job.size ?? config.dashscopeImageSize ?? "1024*1024",
        n: 1,
        watermark: false,
        ...(job.parameters ?? {})
      }
    : {
        negative_prompt: typeof job.negativePrompt === "string"
          ? job.negativePrompt
          : "photorealistic architecture, miniature photography, toy model, glossy PBR render, dense individual bricks, individual roof shingles, photographic microtexture, surface noise, heavy ambient occlusion, dramatic studio lighting, hard black cast shadow, cinematic rim light, magenta light spill, background gradient, low resolution, blurry, distorted architecture, malformed roof, inconsistent human scale, miniature doors, miniature windows, extra storeys, compressed floors, neighbouring buildings, people, vehicles, letters, words, labels, numbers, percentages, symbols, coordinate marks, guide lines, storey bands, ghost reference door, arrows, annotations, logo, watermark, black outlines, cropped building, non-magenta background",
        prompt_extend: false,
        watermark: false,
        size: job.size ?? config.dashscopeImageSize ?? "1024*1024",
        n: 1,
        ...(job.parameters ?? {})
      };
  const response = await fetchImpl(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.dashscopeApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: {
        messages: [{
          role: "user",
          content: [
            ...stylePack.references.map((reference) => ({ image: `data:${reference.mimeType};base64,${reference.bytes.toString("base64")}` })),
            ...(guideplate ? [{ image: `data:image/png;base64,${guideplate.bytes.toString("base64")}` }] : []),
            { text: prompt }
          ]
        }]
      },
      parameters
    })
  });
  const payload = await readJsonResponse(response, "DASHSCOPE_IMAGE_RESPONSE_INVALID");
  if (!response.ok) {
    throw new ServiceError(
      response.status,
      "DASHSCOPE_IMAGE_GENERATION_FAILED",
      payload.message ?? payload.error?.message ?? "DashScope image generation failed",
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

function normalizeDashScopeInputImage(input) {
  if (Buffer.isBuffer(input)) return { bytes: input, mimeType: "image/png" };
  if (!Buffer.isBuffer(input?.bytes)) throw new ServiceError(400, "INVALID_DASHSCOPE_INPUT_IMAGE", "DashScope input images must contain Buffer bytes");
  return { bytes: input.bytes, mimeType: input.mimeType ?? "image/png" };
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
  let manifest = JSON.parse(await fs.readFile(path.join(publicDir, "asset.json"), "utf8"));
  const productionArtifacts = {};
  for (const [filename, bytes] of Object.entries(options.productionBundle?.artifacts ?? {})) {
    if (!/^[a-z0-9][a-z0-9.-]*\.png$/i.test(filename) || !Buffer.isBuffer(bytes)) continue;
    assertPng(bytes);
    await fs.writeFile(path.join(publicDir, filename), bytes);
    productionArtifacts[filename] = `/${relativeDir}/${filename}`;
  }
  const guideplate = await resolveAssetGuideplate(options.spec ?? {}, options.config ?? {});
  let anchorNormalization = null;
  if (options.productionBundle?.production?.provider === "hunyuan-image" && !options.config?.hunyuanSkipAnchorNormalization) {
    const transparentSourcePath = path.join(publicDir, manifest.maps.rgb);
    const reportPath = path.join(publicDir, "anchor-normalization.json");
    await normalizeAssetToGuide({
      inputPath: transparentSourcePath,
      outputPath: sourcePath,
      sourceAnchors: manifest.baseAnchorsUv,
      targetAnchors: guideplate.manifest.baseAnchorsUv,
      background: "magenta",
      reportPath,
      config: options.config ?? {}
    });
    anchorNormalization = JSON.parse(await fs.readFile(reportPath, "utf8"));
    await execFileAsync(process.execPath, [path.join(WORKSPACE, "scripts/derive_isometric_asset_maps.mjs"), sourcePath, publicDir], { cwd: WORKSPACE, maxBuffer: 2 * 1024 * 1024 });
    manifest = JSON.parse(await fs.readFile(path.join(publicDir, "asset.json"), "utf8"));
  }
  if (Buffer.isBuffer(options.productionBundle?.emissiveBytes)) {
    assertPng(options.productionBundle.emissiveBytes);
    const emissivePath = path.join(publicDir, manifest.maps.emissive);
    if (anchorNormalization) {
      const rawEmissivePath = path.join(publicDir, "emissive-raw.png");
      await fs.writeFile(rawEmissivePath, options.productionBundle.emissiveBytes);
      await normalizeAssetToGuide({
        inputPath: rawEmissivePath,
        outputPath: emissivePath,
        sourceAnchors: anchorNormalization.sourceAnchorsUv,
        targetAnchors: anchorNormalization.targetAnchorsUv,
        background: "transparent",
        config: options.config ?? {}
      });
      await fs.rm(rawEmissivePath, { force: true });
    } else {
      await fs.writeFile(emissivePath, options.productionBundle.emissiveBytes);
    }
  }
  if (options.productionBundle?.production?.provider === "hunyuan-image" && !options.config?.hunyuanSkipGeometryValidation) {
    validateGeneratedGeometry(manifest, guideplate.manifest, options.config ?? {});
  }
  const usesStyleReference = options.config?.dashscopeStyleReferenceEnabled === true;
  const stylePack = usesStyleReference ? await resolveStyleReferences(options.config ?? {}) : { references: [] };
  const maps = Object.fromEntries(Object.entries(manifest.maps).map(([name, file]) => [name, `/${relativeDir}/${file}`]));
  const production = options.productionBundle?.production;
  const finalManifest = {
    ...manifest,
    dimensions: guideplate.manifest.dimensions,
    guideplate: {
      ...guideplate.manifest,
      path: guideplate.publicPath
    },
    generationContract: production
      ? {
          promptVersion: production.promptVersion,
          lightPipelineVersion: production.lightPipelineVersion ?? null,
          provider: production.provider,
          model: production.model,
          seed: production.seed ?? null,
          inputImageRoles: production.inputImageRoles ?? ["geometry_guideplate"],
          styleReferenceId: production.styleReferenceId ?? null,
          styleReferencePaths: production.styleReferencePath ? [production.styleReferencePath] : [],
          dayOff: production.dayOff ?? null,
          dayOn: production.dayOn ?? null,
          lightReport: production.lightReport ?? null,
          anchorNormalization
        }
      : {
          promptVersion: ASSET_PROMPT_VERSION,
          inputImageRoles: usesStyleReference ? ["asset_rendering_standard", "geometry_guideplate"] : ["geometry_guideplate"],
          styleReferenceId: usesStyleReference ? STYLE_REFERENCE_ID : null,
          styleReferencePaths: stylePack.references.map((reference) => reference.publicPath)
        },
    maps,
    productionArtifacts,
    sourceImage: `/${relativeDir}/source-magenta.png`,
    pipeline: production?.provider === "hunyuan-image"
      ? "hunyuan-paired-daylight+portable-light-diff+derive_isometric_asset_maps@1"
      : "derive_isometric_asset_maps@1",
    nightProfile: production?.provider === "hunyuan-image" ? "paired-daylight-light-contribution" : manifest.nightProfile
  };
  await fs.writeFile(path.join(publicDir, "asset.json"), `${JSON.stringify(finalManifest, null, 2)}\n`);
  return finalManifest;
}

async function normalizeAssetToGuide({ inputPath, outputPath, sourceAnchors, targetAnchors, background, reportPath, config }) {
  const args = [
    config.hunyuanNormalizeAssetScript ?? NORMALIZE_ASSET_SCRIPT,
    "--input", inputPath,
    "--output", outputPath,
    "--source-anchors", JSON.stringify(sourceAnchors),
    "--target-anchors", JSON.stringify(targetAnchors),
    "--background", background
  ];
  if (reportPath) args.push("--report", reportPath);
  try {
    await execFileAsync(config.hunyuanPythonPath ?? GUIDEPLATE_PYTHON, args, { cwd: WORKSPACE, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw new ServiceError(500, "HUNYUAN_ANCHOR_NORMALIZATION_FAILED", error.message, {}, false);
  }
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
    const finalManifest = {
      ...manifest,
      assetId,
      archetype: job.spec.archetype,
      footprint: job.spec.footprint,
      districtStyle: job.spec.district_style,
      source: job.provider
    };
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

export async function failAssetJob({ repository, job, message, code = null, details = null, terminal = true }) {
  const db = repository.database;
  const errorPayload = { message, ...(code ? { code } : {}), ...(details ? { details } : {}) };
  const orderResult = await db.query("SELECT * FROM construction_orders WHERE asset_job_id = $1", [job.id]);
  if (!orderResult.rowCount) return;
  const order = orderResult.rows[0];
  if (!terminal) {
    await db.query("UPDATE asset_jobs SET status = 'queued', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify(errorPayload), job.id]);
    return;
  }
  const principal = { kind: "agent", id: "system-asset-worker", cityId: job.city_id, scopes: ["city:build", "asset:request"] };
  await repository.transactCity({
    principal,
    cityId: job.city_id,
    endpoint: `worker/asset-jobs/${job.id}/failure`,
    idempotencyKey: `terminal-failure-${job.id}`,
    requestBody: { job_id: job.id, ...errorPayload },
    expectedVersion: undefined,
    action: "fail_asset_job",
    reason: message
  }, async ({ client, state }) => {
    const result = executeCityCommand(state, { type: "cancel_construction_reservation", reservationId: order.reservation_id, reason: "asset_generation_failed" }, engineContext());
    if (!result.accepted) return rejectedCommand(result);
    await client.query("UPDATE asset_jobs SET status = 'failed', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify(errorPayload), job.id]);
    await client.query("UPDATE construction_orders SET status = 'failed', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify(errorPayload), order.id]);
    return { nextState: result.state, response: commandEnvelope(createId("command"), result, { kind: "asset_job", id: job.id, status: "failed", refunded: result.refunded }) };
  });
}

function assertPng(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new ServiceError(400, "IMAGE_MUST_BE_PNG", "Asset production currently accepts PNG source images only");
}

export function normalizeAssetVolume(value, footprint = "1x1") {
  const fallback = defaultVolumeForFootprint(footprint);
  let gridDimensions;
  if (typeof value === "string" && value.trim()) {
    gridDimensions = value.trim().toLowerCase().replaceAll("×", "x").split("x").map(Number);
  } else if (value && typeof value === "object") {
    gridDimensions = [Number(value.length ?? value.x), Number(value.width ?? value.z ?? value.depth), Number(value.height ?? value.y)];
  } else {
    gridDimensions = fallback;
  }
  if (
    gridDimensions.length !== 3
    || gridDimensions.some((number) => !Number.isFinite(number) || number <= 0)
    || !Number.isInteger(gridDimensions[0])
    || !Number.isInteger(gridDimensions[1])
    || gridDimensions[0] > 3
    || gridDimensions[1] > 3
    || !Number.isInteger(gridDimensions[2])
    || gridDimensions[2] > 32
  ) {
    throw new ServiceError(400, "INVALID_ASSET_GUIDE_VOLUME", "asset.spec.guide_volume must be integer lengthxwidthxheight in city-grid units; base length and width must be from 1 to 3, and height is the exact occupied storey count");
  }
  const normalized = gridDimensions.map((number) => Math.round(number * 100) / 100);
  const footprintMatch = /^(\d+)x(\d+)$/.exec(String(footprint ?? ""));
  if (footprintMatch && (normalized[0] !== Number(footprintMatch[1]) || normalized[1] !== Number(footprintMatch[2]))) {
    throw new ServiceError(400, "ASSET_GUIDE_VOLUME_FOOTPRINT_MISMATCH", `guide_volume base ${normalized[0]}x${normalized[1]} must match site footprint ${footprint}`);
  }
  return {
    id: normalized.map(formatDimension).join("x"),
    gridDimensions: { length: normalized[0], width: normalized[1], height: normalized[2], unit: "city_cell" },
    dimensions: {
      length: normalized[0] * WORLD_UNITS_PER_CELL,
      width: normalized[1] * WORLD_UNITS_PER_CELL,
      height: normalized[2] * WORLD_UNITS_PER_CELL,
      unit: "world"
    }
  };
}

export async function resolveAssetGuideplate(spec = {}, config = {}) {
  const volume = normalizeAssetVolume(spec.guide_volume ?? spec.dimensions, spec.footprint);
  const customPath = config.assetGuideplatePath;
  const pngPath = customPath ?? path.join(config.assetGuideplateRoot ?? GUIDEPLATE_ROOT, `guide-${volume.id}.png`);
  const jsonPath = pngPath.replace(/\.png$/i, ".json");
  if (!customPath) {
    let needsGeneration = true;
    try {
      await fs.access(pngPath);
      const cached = JSON.parse(await fs.readFile(jsonPath, "utf8"));
      needsGeneration = cached.guideVersion !== "absolute-scale-v4";
    } catch {}
    if (needsGeneration) {
      await fs.mkdir(path.dirname(pngPath), { recursive: true });
      await execFileAsync(config.assetGuideplatePython ?? GUIDEPLATE_PYTHON, [
        GUIDEPLATE_SCRIPT,
        "--dimensions", [volume.dimensions.length, volume.dimensions.width, volume.dimensions.height].join("x"),
        "--entrance", "south",
        "--out", pngPath
      ], { cwd: WORKSPACE, maxBuffer: 2 * 1024 * 1024 });
    }
  }
  const [bytes, rawManifest] = await Promise.all([fs.readFile(pngPath), fs.readFile(jsonPath, "utf8")]);
  const manifest = {
    ...JSON.parse(rawManifest),
    guideVolume: volume.id,
    gridDimensions: volume.gridDimensions
  };
  const publicRoot = path.join(WORKSPACE, "public");
  const publicPath = pngPath.startsWith(`${publicRoot}${path.sep}`)
    ? `/${path.relative(publicRoot, pngPath).split(path.sep).join("/")}`
    : null;
  return { bytes, manifest, path: pngPath, publicPath, volume };
}

export async function resolveStyleReferences(config = {}) {
  const cityImagePath = config.assetStyleReferencePath ?? STYLE_REFERENCE_PATH;
  return {
    id: STYLE_REFERENCE_ID,
    references: [
      {
        role: "asset_rendering_standard",
        bytes: await fs.readFile(cityImagePath),
        path: cityImagePath,
        publicPath: "/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png",
        mimeType: "image/png"
      }
    ]
  };
}

export async function resolveHunyuanStyleReference(config = {}) {
  const imagePath = config.hunyuanStyleReferencePath ?? HUNYUAN_STYLE_REFERENCE_PATH;
  const publicRoot = path.join(WORKSPACE, "public");
  const publicPath = imagePath.startsWith(`${publicRoot}${path.sep}`)
    ? `/${path.relative(publicRoot, imagePath).split(path.sep).join("/")}`
    : "/style-reference/isometric-magic-london-city.jpg";
  return {
    id: "magic-london-city-concept-v1",
    role: "style_only_reference",
    bytes: await fs.readFile(imagePath),
    path: imagePath,
    publicPath,
    mimeType: "image/jpeg"
  };
}

function validateGeneratedGeometry(manifest, guideManifest, config) {
  const actualAnchors = manifest.baseAnchorsUv;
  const expectedAnchors = guideManifest.baseAnchorsUv;
  const maximumAnchorError = config.hunyuanMaximumAnchorError ?? 0.045;
  const anchorErrors = Object.fromEntries(["left", "near", "right"].map((name) => [
    name,
    Math.max(
      Math.abs(actualAnchors?.[name]?.[0] - expectedAnchors?.[name]?.[0]),
      Math.abs(actualAnchors?.[name]?.[1] - expectedAnchors?.[name]?.[1])
    )
  ]));
  if (Object.values(anchorErrors).some((error) => !Number.isFinite(error) || error > maximumAnchorError)) {
    throw new ServiceError(422, "HUNYUAN_GUIDE_ANCHOR_MISMATCH", "Generated building base does not match the guideplate parcel", {
      anchor_errors: anchorErrors,
      maximum_anchor_error: maximumAnchorError
    });
  }

  // Roof ridges, chimney pots, and small signs may rise above the occupied
  // storey envelope. The 0.12 UV allowance still rejects grossly oversized
  // silhouettes while keeping normal one-storey Victorian roof furniture.
  const maximumOverflow = config.hunyuanMaximumEnvelopeOverflow ?? 0.12;
  const actualTop = manifest.subjectBoundsUv?.top;
  const expectedTop = guideManifest.envelopeBoundsUv?.top;
  if (!Number.isFinite(actualTop) || !Number.isFinite(expectedTop) || actualTop > expectedTop + maximumOverflow) {
    throw new ServiceError(422, "HUNYUAN_GUIDE_HEIGHT_MISMATCH", "Generated building exceeds the guideplate height envelope", {
      actual_top_uv: actualTop,
      expected_top_uv: expectedTop,
      maximum_overflow: maximumOverflow
    });
  }
}

function defaultVolumeForFootprint(footprint) {
  const match = /^(\d+)x(\d+)$/.exec(String(footprint ?? "1x1"));
  const columns = Number(match?.[1] ?? 1);
  const rows = Number(match?.[2] ?? 1);
  return [columns, rows, 1];
}

function formatDimension(number) {
  return Number.isInteger(number) ? String(number) : String(number).replace(/0+$/, "").replace(/\.$/, "");
}

function storeyWord(storeys) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][storeys] ?? String(storeys);
}

function engineContext() { return createEngineContext({ createId, now: () => new Date().toISOString() }); }
function commandEnvelope(commandId, result, resource) { return { command_id: commandId, status: resource.status, city_version_before: result.cityVersionBefore, city_version_after: result.cityVersionAfter, events: result.state.events.filter((event) => event.cityVersion === result.cityVersionAfter).map((event) => event.id), resource }; }
function rejectedCommand(result) { return { nextState: null, response: { command_id: createId("command"), status: "rejected", code: result.code, errors: result.errors } }; }
