#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const inputPath = path.resolve(process.argv[2] ?? "");
const outputPath = path.resolve(process.argv[3] ?? "");
const blackTargetPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;

if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    "Usage: node scripts/run_hunyuan_emissive_probe.mjs <rgb-reference.png> <emissive-output.png>"
  );
}

const prompt = [
  "任务类型：游戏贴图语义标注。请直接输出 emissive 发光区域图；这不是夜景转换、不是建筑重绘、不是轮廓图。",
  blackTargetPath
    ? "输入图角色：图1是不可修改的 RGB 位置参考；图2是必须编辑的纯黑输出画布。只编辑图2，禁止重绘图1中的建筑。输出必须保持图2的纯黑画布，并让标注位置与图1的窗户逐像素对齐。"
    : "输入图角色：唯一输入图是不可移动的 RGB 位置参考。输出必须保持与输入图完全相同的 1024×1024 画布、镜头、建筑位置、窗户形状和像素坐标。",
  "只标注输入图右侧墙面上现有的两扇暖黄色玻璃窗。把这两扇窗内部现有的四块黄色玻璃区域填充为统一纯色 #F0BF67。",
  "输入图中的所有其他区域必须变成纯黑 #000000，包括木门及门框、铜靴招牌、招牌链条、全部墙面、全部砖块、屋顶、瓦片、烟囱、窗框、建筑底座、背景和阴影。",
  "木门绝对不发光；铜靴招牌和链条绝对不发光。不要标注高光、金属反光、边缘、轮廓或建筑结构。",
  "最终输出必须看起来像纯黑画布上仅有两扇窗的四块平面暖黄色区域。除 #000000 与 #F0BF67 外不得出现其他颜色。禁止渐变、阴影、纹理、光晕、泛光、反射、描边、抗锯齿扩张、新增窗口、文字、数字、符号、Logo 和水印。"
].join("\n\n");

const apiKey = await loadApiKey();
const inputBytes = await fs.readFile(inputPath);
const inputImages = [inputBytes.toString("base64")];
if (blackTargetPath) {
  inputImages.push((await fs.readFile(blackTargetPath)).toString("base64"));
}
const submission = await postJson(submitUrl, {
  model,
  prompt,
  images: inputImages,
  resolution: "1024:1024",
  seed: 314159,
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
const imageResponse = await fetch(imageUrl);
if (!imageResponse.ok) {
  throw new Error(`Hunyuan image download failed with HTTP ${imageResponse.status}`);
}
const outputBytes = Buffer.from(await imageResponse.arrayBuffer());
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, outputBytes);
await fs.writeFile(`${outputPath}.json`, `${JSON.stringify({
  provider: "tencent-tokenhub",
  model,
  input: inputPath,
  blackTarget: blackTargetPath,
  output: outputPath,
  inputRole: blackTargetPath
    ? ["immutable_rgb_alignment_reference", "black_edit_target"]
    : ["immutable_rgb_alignment_reference"],
  prompt,
  parameters: {
    resolution: "1024:1024",
    seed: 314159,
    logoAdd: 0,
    revise: 0,
    inputEncoding: "base64"
  },
  jobId: submission.id,
  requestId: submission.request_id,
  revisedPromptMatchesInput: result.data?.[0]?.revised_prompt === prompt
}, null, 2)}\n`);

console.log(JSON.stringify({
  inputPath,
  outputPath,
  model,
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
