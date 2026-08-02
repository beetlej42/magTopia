import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ServiceError } from "./errors.js";
import {
  HUNYUAN_PAIRED_LIGHT_VERSION,
  MAGIC_LONDON_WORLD_PROMPT_VERSION,
  composeHunyuanDayOffPrompt,
  composeHunyuanDayOnPrompt
} from "./hunyuan-prompts.js";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function generateHunyuanAssetBundle({ job, config, guideplate, styleReference, workspace }) {
  if (!config.hunyuanImageApiKey) {
    throw new ServiceError(503, "HUNYUAN_IMAGE_API_KEY_REQUIRED", "HUNYUAN_IMAGE_API_KEY or TENCENT_TOKENHUB_API_KEY is not configured", {}, true);
  }
  const volume = guideplate.volume;
  const cells = volume.id;
  const dimensions = [volume.dimensions.length, volume.dimensions.width, volume.dimensions.height].join("x");
  const agentBrief = job.spec.creative_brief;
  const dayOffPrompt = composeHunyuanDayOffPrompt({ cells, dimensions, agentBrief });
  const dayOnPrompt = composeHunyuanDayOnPrompt({ cells, agentBrief });
  const seed = stableSeed(job, config.hunyuanSeed);
  const workDir = await fs.mkdtemp(path.join(config.hunyuanTempRoot ?? os.tmpdir(), "magictown-hunyuan-"));

  try {
    const dayOff = await submitWaitAndDownload({
      config,
      prompt: dayOffPrompt,
      images: [guideplate.bytes, styleReference.bytes],
      seed
    });
    const dayOn = await submitWaitAndDownload({
      config,
      prompt: dayOnPrompt,
      images: [dayOff.bytes],
      seed
    });
    const pairedLight = await derivePairedLight({
      config,
      workspace,
      workDir,
      dayOffBytes: dayOff.bytes,
      dayOnBytes: dayOn.bytes
    });
    validatePairedLight(pairedLight.report, config);

    return {
      sourceBytes: dayOff.bytes,
      emissiveBytes: pairedLight.emissiveBytes,
      artifacts: {
        "day-off-raw.png": dayOff.bytes,
        "day-on-raw.png": dayOn.bytes,
        "light-support.png": pairedLight.supportBytes,
        "day-on-stable-composite.png": pairedLight.compositeBytes
      },
      production: {
        provider: "hunyuan-image",
        model: config.hunyuanImageModel ?? "hy-image-v3.0",
        seed,
        promptVersion: MAGIC_LONDON_WORLD_PROMPT_VERSION,
        lightPipelineVersion: HUNYUAN_PAIRED_LIGHT_VERSION,
        inputImageRoles: ["geometry_scale_camera_and_front_door_edit_target", "style_only_reference"],
        styleReferenceId: styleReference.id,
        styleReferencePath: styleReference.publicPath,
        dayOff: requestMetadata(dayOff, dayOffPrompt),
        dayOn: requestMetadata(dayOn, dayOnPrompt),
        lightReport: portableLightReport(pairedLight.report)
      }
    };
  } finally {
    if (!config.hunyuanPreserveTemp) await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function submitWaitAndDownload({ config, prompt, images, seed }) {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.hunyuanImageModel ?? "hy-image-v3.0";
  const submitUrl = config.hunyuanSubmitUrl ?? "https://tokenhub.tencentmaas.com/v1/api/image/submit";
  const queryUrl = config.hunyuanQueryUrl ?? "https://tokenhub.tencentmaas.com/v1/api/image/query";
  const submission = await postJson(fetchImpl, submitUrl, config.hunyuanImageApiKey, {
    model,
    prompt,
    images: images.map((bytes) => bytes.toString("base64")),
    resolution: config.hunyuanImageResolution ?? "1024:1024",
    seed,
    logo_add: 0,
    revise: 0
  });
  if (!submission.id) {
    const busy = submission.error?.code === "RequestLimitExceeded.JobNumExceed";
    throw new ServiceError(
      busy ? 429 : 502,
      busy ? "HUNYUAN_IMAGE_BUSY" : "HUNYUAN_IMAGE_SUBMISSION_INVALID",
      submission.error?.message ?? submission.message ?? "Hunyuan submission did not include a job id",
      { provider_code: submission.error?.code, request_id: submission.request_id },
      busy
    );
  }

  const startedAt = Date.now();
  const timeoutMs = config.hunyuanTimeoutMs ?? 10 * 60_000;
  const pollMs = config.hunyuanPollMs ?? 5_000;
  const sleep = config.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let result;
  while (Date.now() - startedAt < timeoutMs) {
    result = await postJson(fetchImpl, queryUrl, config.hunyuanImageApiKey, { model, id: submission.id });
    if (result.status === "completed") break;
    if (result.status === "failed" || result.status === "cancelled") {
      throw new ServiceError(502, "HUNYUAN_IMAGE_JOB_FAILED", `Hunyuan job ${result.status}`, { job_id: submission.id }, true);
    }
    await sleep(pollMs);
  }
  if (result?.status !== "completed") {
    throw new ServiceError(504, "HUNYUAN_IMAGE_TIMEOUT", "Timed out waiting for Hunyuan image generation", { job_id: submission.id }, true);
  }
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    throw new ServiceError(502, "HUNYUAN_IMAGE_RESPONSE_INVALID", "Hunyuan completed without an image URL", { job_id: submission.id }, true);
  }
  const bytes = await downloadImage(fetchImpl, imageUrl);
  return {
    bytes,
    jobId: submission.id,
    requestId: submission.request_id,
    revisedPrompt: result.data?.[0]?.revised_prompt
  };
}

async function derivePairedLight({ config, workspace, workDir, dayOffBytes, dayOnBytes }) {
  if (config.hunyuanDerivePairedLight) return config.hunyuanDerivePairedLight({ dayOffBytes, dayOnBytes });
  const offPath = path.join(workDir, "paired-day-off.png");
  const onPath = path.join(workDir, "paired-day-on.png");
  const emissivePath = path.join(workDir, "light-contribution.png");
  const supportPath = path.join(workDir, "light-support.png");
  const compositePath = path.join(workDir, "day-on-stable-composite.png");
  const reportPath = path.join(workDir, "light-report.json");
  await Promise.all([fs.writeFile(offPath, dayOffBytes), fs.writeFile(onPath, dayOnBytes)]);
  try {
    await execFileAsync(config.hunyuanPythonPath ?? path.join(workspace, ".venv/bin/python"), [
      config.hunyuanLightmapScript ?? path.join(workspace, "scripts/derive_paired_day_lightmap.py"),
      "--off", offPath,
      "--on", onPath,
      "--out", emissivePath,
      "--support-out", supportPath,
      "--composite-out", compositePath,
      "--report", reportPath,
      "--seed-delta", "0.14",
      "--support-delta", "0.018",
      "--growth", "18",
      "--tint", "#F0BF67"
    ], { cwd: workspace, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw new ServiceError(500, "HUNYUAN_LIGHTMAP_POSTPROCESS_FAILED", error.message, {}, false);
  }
  const [emissiveBytes, supportBytes, compositeBytes, reportText] = await Promise.all([
    fs.readFile(emissivePath),
    fs.readFile(supportPath),
    fs.readFile(compositePath),
    fs.readFile(reportPath, "utf8")
  ]);
  return { emissiveBytes, supportBytes, compositeBytes, report: JSON.parse(reportText) };
}

function validatePairedLight(report, config) {
  const minimumIou = config.hunyuanMinimumPairIou ?? 0.97;
  const minimumSupportPixels = config.hunyuanMinimumLightPixels ?? 40;
  if (!Number.isFinite(report?.subjectMaskIoUAfterAlignment) || report.subjectMaskIoUAfterAlignment < minimumIou) {
    throw new ServiceError(422, "HUNYUAN_PAIR_ALIGNMENT_REJECTED", "Hunyuan day pair changed the building silhouette too much", { report, minimum_iou: minimumIou }, false);
  }
  if (!Number.isFinite(report?.supportPixels) || report.supportPixels < minimumSupportPixels) {
    throw new ServiceError(422, "HUNYUAN_LIGHTMAP_EMPTY", "Hunyuan day pair did not yield a usable light contribution", { report, minimum_support_pixels: minimumSupportPixels }, false);
  }
}

async function postJson(fetchImpl, url, apiKey, payload) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let body;
  try { body = JSON.parse(await response.text()); }
  catch { throw new ServiceError(502, "HUNYUAN_IMAGE_RESPONSE_INVALID", "Hunyuan returned a non-JSON response", {}, true); }
  if (!response.ok) {
    throw new ServiceError(
      response.status,
      "HUNYUAN_IMAGE_REQUEST_FAILED",
      body.error?.message ?? body.message ?? "Hunyuan request failed",
      { provider_code: body.error?.code, request_id: body.request_id },
      response.status >= 500 || response.status === 429
    );
  }
  return body;
}

async function downloadImage(fetchImpl, imageUrl) {
  let parsed;
  try { parsed = new URL(imageUrl); }
  catch { throw new ServiceError(502, "HUNYUAN_IMAGE_URL_INVALID", "Hunyuan returned an invalid image URL", {}, true); }
  if (parsed.protocol !== "https:") throw new ServiceError(502, "HUNYUAN_IMAGE_URL_INVALID", "Hunyuan image URL must use HTTPS", {}, true);
  const response = await fetchImpl(parsed, { redirect: "follow" });
  if (!response.ok) throw new ServiceError(response.status, "HUNYUAN_IMAGE_DOWNLOAD_FAILED", "Failed to download the generated Hunyuan image", {}, response.status >= 500 || response.status === 429);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new ServiceError(502, "HUNYUAN_IMAGE_TOO_LARGE", "Generated Hunyuan image exceeds the 20 MB limit");
  return bytes;
}

function stableSeed(job, configuredSeed) {
  if (Number.isInteger(configuredSeed)) return configuredSeed;
  const digest = crypto.createHash("sha256").update(`${job.id ?? "asset"}:${job.attempts ?? 0}`).digest();
  return digest.readUInt32BE(0) % 2_147_483_647;
}

function requestMetadata(result, prompt) {
  return {
    jobId: result.jobId,
    requestId: result.requestId,
    revisedPromptMatchesInput: result.revisedPrompt === prompt
  };
}

function portableLightReport(report) {
  return {
    subjectMaskIoUAfterAlignment: report.subjectMaskIoUAfterAlignment,
    affineColorFit: report.affineColorFit,
    registration: report.registration,
    seedPixels: report.seedPixels,
    supportPixels: report.supportPixels,
    parameters: report.parameters
  };
}
