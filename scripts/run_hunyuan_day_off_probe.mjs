#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const experimentPath = path.resolve(process.argv[2] ?? "");
const outputDir = path.resolve(process.argv[3] ?? "");
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;
const seed = 314159;

if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    "Usage: node scripts/run_hunyuan_day_off_probe.mjs <day-on-experiment.json> <output-directory>"
  );
}

const originalExperiment = JSON.parse(await fs.readFile(experimentPath, "utf8"));
const guidePath = path.resolve(originalExperiment.guide);
const dayOnPrompt = originalExperiment.prompt;
const prompt = [
  dayOnPrompt,
  "配对变体的唯一修改：关闭两扇窗内的灯。把两扇窗现有的四块玻璃改为熄灭的深灰褐色玻璃，不发光、不泛光。除窗玻璃的颜色和亮度外，建筑设计、几何、镜头、位置、材质、日间主光、阴影、背景以及所有其他像素级视觉属性必须与开灯版本保持一致。"
].join("\n\n");

const apiKey = await loadApiKey();
const guideBytes = await fs.readFile(guidePath);
await fs.mkdir(outputDir, { recursive: true });
const submission = await postJson(submitUrl, {
  model,
  prompt,
  images: [guideBytes.toString("base64")],
  resolution: "1024:1024",
  seed,
  logo_add: 0,
  revise: 0
});
if (!submission.id) {
  throw new Error(`Hunyuan submit response did not include id: ${JSON.stringify(submission)}`);
}

const result = await pollJob(submission.id);
const imageUrl = result.data?.[0]?.url;
if (!imageUrl) {
  throw new Error(`Hunyuan completed without an image URL: ${JSON.stringify(result)}`);
}
const response = await fetch(imageUrl);
if (!response.ok) {
  throw new Error(`Hunyuan image download failed with HTTP ${response.status}`);
}

const rawPath = path.join(outputDir, "day-off-raw.png");
const correctedPath = path.join(outputDir, "day-off-vision-chroma.png");
const mattePath = path.join(outputDir, "day-off-vision-mask.png");
await fs.writeFile(rawPath, Buffer.from(await response.arrayBuffer()));
await execFileAsync("xcrun", [
  "swift",
  path.resolve("scripts/remove_asset_shadow.swift"),
  rawPath,
  correctedPath,
  mattePath
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
    CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
  }
});

await fs.writeFile(path.join(outputDir, "day-off.json"), `${JSON.stringify({
  provider: "tencent-tokenhub",
  model,
  guide: guidePath,
  pairedDayOnExperiment: experimentPath,
  prompt,
  seed,
  raw: rawPath,
  corrected: correctedPath,
  matte: mattePath,
  jobId: submission.id,
  requestId: submission.request_id,
  revisedPromptMatchesInput: result.data?.[0]?.revised_prompt === prompt
}, null, 2)}\n`);

console.log(JSON.stringify({
  outputDir,
  rawPath,
  correctedPath,
  mattePath,
  model,
  seed,
  jobId: submission.id,
  requestId: submission.request_id,
  revisedPromptMatchesInput: result.data?.[0]?.revised_prompt === prompt
}));

async function loadApiKey() {
  for (const name of ["HUNYUAN_IMAGE_API_KEY", "TENCENT_TOKENHUB_API_KEY"]) {
    if (process.env[name]?.trim()) return process.env[name].trim();
  }
  throw new Error("Missing HUNYUAN_IMAGE_API_KEY or TENCENT_TOKENHUB_API_KEY.");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`Hunyuan returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok) {
    const message = body.error?.message ?? body.message ?? raw;
    throw new Error(`Hunyuan returned HTTP ${response.status}: ${message}`);
  }
  return body;
}

async function pollJob(jobId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await postJson(queryUrl, { model, id: jobId });
    if (result.status === "completed") return result;
    if (result.status === "failed" || result.status === "cancelled") {
      throw new Error(`Hunyuan job ${jobId} ${result.status}: ${JSON.stringify(result)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for Hunyuan job ${jobId}`);
}
