#!/usr/bin/env node

import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { extname, basename, resolve, relative, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const API_BASE = "https://api.ai3d.cloud.tencent.com/v1/ai3d";
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const execFileAsync = promisify(execFile);

function usage() {
  console.log(`Usage:
  node scripts/hunyuan3d.mjs generate <image> [--out <directory>]
  node scripts/hunyuan3d.mjs submit   <image> [--out <directory>]
  node scripts/hunyuan3d.mjs query    <job-id> [--out <directory>]

The API key may be the only non-empty line in .env, or use HUNYUAN3D_API_KEY=<key>.
generate submits a Hunyuan3D 3.0 LowPoly job, polls it, and downloads the results.`);
}

function parseArgs(argv) {
  const command = argv[0];
  const target = argv[1];
  let outDir;

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argv[i]}`);
  }

  if (!["generate", "submit", "query"].includes(command) || !target) {
    usage();
    process.exit(1);
  }

  return { command, target, outDir };
}

async function loadApiKey() {
  if (process.env.HUNYUAN3D_API_KEY?.trim()) {
    return process.env.HUNYUAN3D_API_KEY.trim();
  }

  const envText = await readFile(resolve(".env"), "utf8");
  const lines = envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const named = lines.find((line) => line.startsWith("HUNYUAN3D_API_KEY="));
  const key = named ? named.slice(named.indexOf("=") + 1).trim() : lines[0];
  if (!key) throw new Error("No Hunyuan3D API key found in .env");
  return key.replace(/^['"]|['"]$/g, "");
}

function mimeTypeFor(imagePath) {
  switch (extname(imagePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
      return "image/png";
    default:
      throw new Error("Input image must be PNG, JPEG, or WebP");
  }
}

async function apiPost(apiKey, endpoint, payload) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Hunyuan3D returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok) {
    const message = body?.Response?.Error?.Message ?? body?.error?.message ?? raw;
    throw new Error(`Hunyuan3D returned HTTP ${response.status}: ${message}`);
  }
  if (body?.Response?.Error) {
    throw new Error(`${body.Response.Error.Code}: ${body.Response.Error.Message}`);
  }
  return body.Response ?? body;
}

async function saveJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function resultExtension(url, fallback) {
  try {
    return extname(new URL(url).pathname) || fallback;
  } catch {
    return fallback;
  }
}

async function download(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
  return bytes.length;
}

async function optimizeGlb(inputPath) {
  const pythonCandidates = [resolve(".venv/bin/python"), "python3"];
  const outputPath = inputPath.replace(/\.glb$/i, "-1024-webp.glb");
  let lastError;

  for (const python of pythonCandidates) {
    if (python.includes("/") && await access(python).then(() => false, () => true)) continue;
    try {
      const { stdout } = await execFileAsync(python, [
        resolve("scripts/optimize_glb_texture.py"),
        inputPath,
        "--out", outputPath,
        "--max-size", "1024",
        "--quality", "80",
      ], { maxBuffer: 1024 * 1024 });
      const summary = JSON.parse(stdout.trim());
      console.log(`Optimized ${basename(outputPath)} (${summary.optimizedBytes} bytes)`);
      return { outputPath, summary };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Python with Pillow is required to optimize the GLB texture");
}

async function submit(apiKey, imagePath, outDir) {
  const absoluteImagePath = resolve(imagePath);
  const imageBytes = await readFile(absoluteImagePath);
  if (imageBytes.length > 6 * 1024 * 1024) {
    throw new Error("Input image exceeds the 6 MiB Base64 upload limit");
  }

  mimeTypeFor(absoluteImagePath);
  const parameters = {
    Model: "3.0",
    ImageBase64: imageBytes.toString("base64"),
    GenerateType: "LowPoly",
    PolygonType: "triangle",
    EnablePBR: false,
  };

  console.log(`Submitting ${relative(process.cwd(), absoluteImagePath)} as Hunyuan3D 3.0 LowPoly...`);
  const response = await apiPost(apiKey, "submit", parameters);
  const jobId = response.JobId ?? response.job_id ?? response.id;
  if (!jobId) throw new Error(`Submit response did not contain a JobId: ${JSON.stringify(response)}`);

  await mkdir(outDir, { recursive: true });
  await saveJson(join(outDir, "submission.json"), {
    jobId,
    sourceImage: relative(process.cwd(), absoluteImagePath),
    submittedAt: new Date().toISOString(),
    parameters: {
      Model: parameters.Model,
      GenerateType: parameters.GenerateType,
      PolygonType: parameters.PolygonType,
      EnablePBR: parameters.EnablePBR,
    },
    requestId: response.RequestId,
  });
  console.log(`Submitted job ${jobId}`);
  return jobId;
}

async function query(apiKey, jobId) {
  return apiPost(apiKey, "query", { JobId: jobId });
}

async function downloadResults(response, outDir, jobId) {
  const results = response.ResultFile3Ds ?? response.result_file_3ds ?? [];
  const files = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const type = String(result.Type ?? `model-${index + 1}`).toLowerCase();
    const modelUrl = result.Url;
    const previewUrl = result.PreviewImageUrl;
    const record = { type };

    if (modelUrl) {
      const modelName = `${type}-${index + 1}${resultExtension(modelUrl, ".bin")}`;
      record.modelFile = modelName;
      record.modelUrl = safeUrl(modelUrl);
      const modelPath = join(outDir, modelName);
      record.modelBytes = await download(modelUrl, modelPath);
      console.log(`Downloaded ${modelName} (${record.modelBytes} bytes)`);
      if (extname(modelName).toLowerCase() === ".glb") {
        const optimized = await optimizeGlb(modelPath);
        record.optimizedModelFile = basename(optimized.outputPath);
        record.optimizedModelBytes = optimized.summary.optimizedBytes;
        record.textureOptimization = {
          maxTextureSize: optimized.summary.maxTextureSize,
          webpQuality: optimized.summary.webpQuality,
          images: optimized.summary.images,
        };
      }
    }
    if (previewUrl) {
      const previewName = `${type}-${index + 1}-preview${resultExtension(previewUrl, ".png")}`;
      record.previewFile = previewName;
      record.previewUrl = safeUrl(previewUrl);
      record.previewBytes = await download(previewUrl, join(outDir, previewName));
      console.log(`Downloaded ${previewName} (${record.previewBytes} bytes)`);
    }
    files.push(record);
  }

  const manifest = {
    jobId,
    status: response.Status,
    completedAt: new Date().toISOString(),
    errorCode: response.ErrorCode || undefined,
    errorMessage: response.ErrorMessage || undefined,
    creditConsumed: response.ResultCreditConsumed,
    creditDetails: response.ResultCreditDetails,
    files,
    requestId: response.RequestId,
  };
  await saveJson(join(outDir, "result.json"), manifest);
  return manifest;
}

async function pollUntilComplete(apiKey, jobId, outDir) {
  const started = Date.now();
  let previousStatus;

  while (Date.now() - started < DEFAULT_TIMEOUT_MS) {
    const response = await query(apiKey, jobId);
    const status = String(response.Status ?? "UNKNOWN").toUpperCase();
    if (status !== previousStatus) {
      console.log(`Job ${jobId}: ${status}`);
      previousStatus = status;
    } else {
      console.log(`Job ${jobId}: ${status} (${Math.round((Date.now() - started) / 1000)}s)`);
    }

    if (status === "DONE") return downloadResults(response, outDir, jobId);
    if (status === "FAIL") {
      await saveJson(join(outDir, "result.json"), response);
      throw new Error(`${response.ErrorCode || "GenerationFailed"}: ${response.ErrorMessage || "Hunyuan3D job failed"}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function main() {
  const { command, target, outDir: requestedOutDir } = parseArgs(process.argv.slice(2));
  const apiKey = await loadApiKey();
  const defaultName = command === "query" ? target : basename(target, extname(target));
  const outDir = resolve(requestedOutDir ?? `public/generated/hunyuan3d/${defaultName}-lowpoly-3.0`);

  if (command === "submit") {
    await submit(apiKey, target, outDir);
    return;
  }
  if (command === "query") {
    await mkdir(outDir, { recursive: true });
    const response = await query(apiKey, target);
    console.log(`Job ${target}: ${response.Status ?? "UNKNOWN"}`);
    if (String(response.Status).toUpperCase() === "DONE") {
      await downloadResults(response, outDir, target);
    } else {
      await saveJson(join(outDir, "query.json"), response);
    }
    return;
  }

  const jobId = await submit(apiKey, target, outDir);
  await pollUntilComplete(apiKey, jobId, outDir);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
