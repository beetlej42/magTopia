#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const inputPath = path.resolve(process.argv[2] ?? "");
const outputDir = path.resolve(process.argv[3] ?? "");
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;
const seed = 314159;

if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    "Usage: node scripts/run_hunyuan_day_on_edit_probe.mjs <day-off.png> <output-directory>"
  );
}

const prompt = [
  "任务类型：配对白天灯光编辑。请精确编辑唯一输入图。",
  "输入图角色：唯一输入图是正式的白天关灯 RGB 基底，也是不可移动的编辑目标。必须保留完全相同的 1024×1024 画布、正交镜头、建筑位置、轮廓、屋顶、每片屋瓦、每块砖、门、窗、窗框、招牌、烟囱、底座、日间光照、阴影和背景。禁止重新设计、移动、缩放、旋转、增删或重绘任何结构。",
  "唯一修改：打开右侧墙面现有的两扇窗灯。让这两扇窗现有的四块玻璃呈现暖黄色室内灯光；允许紧邻玻璃的窗框、窗台和少量相邻砖墙受到自然、克制的暖光照亮。",
  "光照效果需要包含光源和受光表面，但范围必须局限在窗户附近，不得改变整栋建筑的日间曝光、材质或色调。",
  "木门、门把、铜靴招牌、链条、屋顶和烟囱保持原样，不得发光。除两扇窗及其局部暖光外，输入图中的每个像素级视觉属性都应保持不变。",
  "不得增加文字、数字、Logo、水印、新窗口、灯具、人物、道路或场景。"
].join("\n\n");

const apiKey = await loadApiKey();
const inputBytes = await fs.readFile(inputPath);
await fs.mkdir(outputDir, { recursive: true });
const submission = await postJson(submitUrl, {
  model,
  prompt,
  images: [inputBytes.toString("base64")],
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

const rawPath = path.join(outputDir, "day-on-raw.png");
const correctedPath = path.join(outputDir, "day-on-vision-chroma.png");
const mattePath = path.join(outputDir, "day-on-vision-mask.png");
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

await fs.writeFile(path.join(outputDir, "day-on.json"), `${JSON.stringify({
  provider: "tencent-tokenhub",
  model,
  input: inputPath,
  inputRole: "immutable_day_off_edit_target",
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
