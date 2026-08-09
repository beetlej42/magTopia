#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execPythonFile, resolvePythonExecutable } from "./python-runtime.mjs";

const execFileAsync = promisify(execFile);
const workspace = process.cwd();
const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const guidePath = path.resolve(
  process.argv[2] ?? "public/generated/asset-guides/guide-1x1x1.png"
);
const experimentId = `hunyuan-image-probe-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDir = path.resolve(
  process.argv[3] ?? `public/generated/hunyuan-experiments/${experimentId}`
);
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;
const shadowRemovalScript = path.resolve("scripts/remove_asset_shadow.swift");
const emissiveScript = path.resolve("scripts/quantize_generated_emissive.py");
const pythonPath = await resolvePythonExecutable({ workspace });

const prompt = [
  "用途：MAGTOPIA 城市建造游戏中的独立建筑资产。",
  "输入图角色：唯一输入图是必须严格遵守的 1×1×1 几何与尺度基准板。请在同一正方形画布、同一正交等距视角、同一地块菱形、同一底座位置和同一体量包络内，将蓝灰色体块替换为建筑；删除所有基准线、楼层线、箭头、参考门与标注。",
  "主体：一栋低等级、单层、紧凑的魔法伦敦鞋匠修理铺。深红褐砖墙，深蓝灰色双坡石板屋顶，一扇完整不透明的深色木门，两扇小型暖黄色玻璃窗，一个不含文字或字母的简化铜靴形招牌，一个短烟囱。只能有一层，不得出现阁楼窗、老虎窗、二层窗排或缩小的人门。",
  "核心风格：真正的低多边形 3D 游戏资产渲染。建筑由清楚可见的低面数多面体、块状体积、简化斜面、轻微倒角与明确的平面法线变化组成；屋顶、烟囱、窗框、砖墙转角和招牌都必须具有立体厚度。使用大块哑光材质面和克制的多边形切面明暗。",
  "低多边形并不等于卡通插画：禁止二维平涂插画、矢量卡通、手绘描边、黑色轮廓线、黏土玩具、圆润塑料玩具、等距图标、像素画、照片级写实建筑和高精度 PBR 建筑可视化。不要把建筑画成平面的正方盒子。",
  "材质与细节：砖、石板和木材只能用低频率的几何分块和少量色块表达；禁止逐块密集砖缝、逐片瓦片、噪声纹理、污渍、裂纹、划痕、强环境光遮蔽、镜面反射或光滑塑料感。",
  "光照：柔和的伦敦午后主光来自左上方，仅用于表现各个低多边形平面的明暗关系。背景和地块外绝对不能出现接触阴影、投射阴影、光晕、反射或渐变。",
  "发光约束：只有两扇小窗的玻璃可以呈现克制的暖黄色。木门必须完全不透明、无玻璃、无亮色、绝不发光；铜靴招牌、墙体、屋顶、烟囱与底座也不得发光。",
  "输出约束：地块外背景必须是逐像素一致的纯色 #FF00FF，不得有天空、地面、街道、邻居建筑、人物、车辆、文字、字母、数字、符号、Logo 或水印。完整建筑与底座必须位于画布内并保留至少 8% 边距。"
].join("\n\n");

const apiKey = await loadApiKey();
const guideBytes = await fs.readFile(guidePath);
const imageBase64 = guideBytes.toString("base64");
await fs.mkdir(outputDir, { recursive: true });

const runs = [];
for (const [index, seed] of [[1, 314159], [2, 314159]]) {
  const submission = await postJson(submitUrl, {
    model,
    prompt,
    images: [imageBase64],
    resolution: "1024:1024",
    seed,
    logo_add: 0,
    revise: 0
  });
  const jobId = submission.id;
  if (!jobId) {
    throw new Error(`Hunyuan submit response did not include id: ${JSON.stringify(submission)}`);
  }
  const result = await pollJob(jobId);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`Hunyuan completed without an image URL: ${JSON.stringify(result)}`);
  }
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Hunyuan image download failed with HTTP ${imageResponse.status}`);
  }
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  const fileName = `rgb-run-${index}-raw.png`;
  const rawPath = path.join(outputDir, fileName);
  const correctedFileName = `rgb-run-${index}-vision-chroma.png`;
  const matteFileName = `rgb-run-${index}-vision-mask.png`;
  await fs.writeFile(rawPath, imageBytes);
  await execFileAsync("xcrun", [
    "swift",
    shadowRemovalScript,
    rawPath,
    path.join(outputDir, correctedFileName),
    path.join(outputDir, matteFileName)
  ], {
    cwd: workspace,
    env: {
      ...process.env,
      SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
      CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
    }
  });
  runs.push({
    seed,
    jobId,
    requestId: submission.request_id,
    file: fileName,
    correctedFile: correctedFileName,
    matteFile: matteFileName,
    revisedPromptMatchesInput: result.data?.[0]?.revised_prompt === prompt
  });
}

const emissiveFileName = "emissive-deterministic.png";
await execPythonFile(pythonPath, emissiveScript, [
  "--input", path.join(outputDir, runs[0].correctedFile),
  "--out", path.join(outputDir, emissiveFileName),
  "--minimum-component", "200"
], { cwd: workspace });

await fs.writeFile(path.join(outputDir, "experiment.json"), `${JSON.stringify({
  experimentId,
  provider: "tencent-tokenhub",
  model,
  guide: path.relative(workspace, guidePath),
  inputRole: "geometry_and_scale_edit_target",
  prompt,
  parameters: {
    resolution: "1024:1024",
    seed: 314159,
    logoAdd: 0,
    revise: 0,
    inputEncoding: "base64"
  },
  postprocessing: {
    background: "Apple Vision foreground instance mask to exact #FF00FF",
    emissive: "Deterministic warm-region extraction; components smaller than 200 pixels removed",
    emissiveFile: emissiveFileName
  },
  runs
}, null, 2)}\n`);

console.log(JSON.stringify({ experimentId, outputDir, model, runs, emissive: emissiveFileName }));

async function loadApiKey() {
  for (const name of [
    "HUNYUAN_IMAGE_API_KEY",
    "TENCENT_TOKENHUB_API_KEY"
  ]) {
    if (process.env[name]?.trim()) return process.env[name].trim();
  }
  const envText = await fs.readFile(path.resolve(".env"), "utf8");
  const entries = new Map(
    envText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1).replace(/^['"]|['"]$/g, "")];
      })
  );
  for (const name of [
    "HUNYUAN_IMAGE_API_KEY",
    "TENCENT_TOKENHUB_API_KEY"
  ]) {
    if (entries.get(name)?.trim()) return entries.get(name).trim();
  }
  throw new Error(
    "Missing HUNYUAN_IMAGE_API_KEY (or TENCENT_TOKENHUB_API_KEY) in the environment."
  );
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
