#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const inputPath = path.resolve(process.argv[2] ?? "");
const outputDir = path.resolve(process.argv[3] ?? "");
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;
const seed = 271828;

if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    "Usage: node scripts/run_hunyuan_night_pair_probe.mjs <rgb-reference.png> <output-directory>"
  );
}

const commonPrompt = [
  "任务类型：游戏建筑资产的配对夜间灯光渲染。请精确编辑唯一输入图。",
  "输入图角色：唯一输入图是不可移动的 RGB 建筑参考。必须保持完全相同的 1024×1024 画布、正交镜头、建筑位置、轮廓、屋瓦、砖块、窗框、门、招牌、烟囱、底座以及每个像素的几何边界。禁止重新设计、移动、缩放、旋转、增删或重绘任何建筑结构。",
  "时间与环境：无月亮、无星光、无路灯、无环境光的漆黑深夜。背景保持均匀纯黑 #000000。非发光墙面、屋顶、门、招牌、烟囱和底座只保留极暗但可辨认的固有色，不得出现白天主光、天空光、轮廓光、反射、高光或投射阴影。",
  "输出约束：这是一组需要做像素差分的配对渲染。除明确指定的窗户开关状态外，所有几何、材质颜色、暗部亮度、边缘和背景都必须完全一致。禁止文字、数字、Logo 和水印。"
].join("\n\n");

const variants = [
  {
    id: "night-off",
    instruction: [
      "灯光状态：全部关闭。",
      "两扇窗的四块玻璃必须完全熄灭，呈现与周围暗部协调的深灰褐色，不得发光、不得泛光。",
      "木门、铜靴招牌和链条也全部无光。整张图中不得存在任何黄色、橙色或青色发光区域。"
    ].join("\n")
  },
  {
    id: "night-on",
    instruction: [
      "灯光状态：只开启输入图右侧墙面现有的两扇窗。",
      "只让这两扇窗内部现有的四块玻璃发出均匀暖黄色 #F0BF67；窗框保持黑暗。",
      "木门、门框、铜靴招牌、链条、墙面、屋顶、烟囱和底座必须与全部关闭版本一样黑暗。不要增加灯光照射墙面的泛光、光晕或反射。"
    ].join("\n")
  }
];

const apiKey = await loadApiKey();
const inputBytes = await fs.readFile(inputPath);
await fs.mkdir(outputDir, { recursive: true });
const runs = [];

for (const variant of variants) {
  const prompt = `${commonPrompt}\n\n${variant.instruction}`;
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
  const file = `${variant.id}.png`;
  await fs.writeFile(path.join(outputDir, file), Buffer.from(await response.arrayBuffer()));
  runs.push({
    id: variant.id,
    file,
    prompt,
    seed,
    jobId: submission.id,
    requestId: submission.request_id,
    revisedPromptMatchesInput: result.data?.[0]?.revised_prompt === prompt
  });
}

await fs.writeFile(path.join(outputDir, "experiment.json"), `${JSON.stringify({
  provider: "tencent-tokenhub",
  model,
  input: inputPath,
  inputRole: "immutable_rgb_alignment_reference",
  method: "paired_night_off_vs_night_on_difference",
  seed,
  runs
}, null, 2)}\n`);

console.log(JSON.stringify({ inputPath, outputDir, model, seed, runs }));

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
