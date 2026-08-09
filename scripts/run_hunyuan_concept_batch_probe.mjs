#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MAGIC_LONDON_WORLD_PROMPT_VERSION,
  composeHunyuanDayOffPrompt
} from "./hunyuan_asset_prompt.mjs";
import { execPythonFile, resolvePythonExecutable } from "./python-runtime.mjs";

const execFileAsync = promisify(execFile);
const workspace = process.cwd();
const model = "hy-image-v3.0";
const submitUrl = "https://tokenhub.tencentmaas.com/v1/api/image/submit";
const queryUrl = "https://tokenhub.tencentmaas.com/v1/api/image/query";
const pollIntervalMs = 5_000;
const timeoutMs = 10 * 60_000;
const pythonPath = await resolvePythonExecutable({ workspace });
const guideScript = path.resolve("scripts/generate_parcel_guide.py");
const shadowRemovalScript = path.resolve("scripts/remove_asset_shadow.swift");
const lightmapScript = path.resolve("scripts/derive_paired_day_lightmap.py");
const conceptPath = path.resolve(
  process.argv[2]
    ?? "docs/reference-images/isometric-magic-london-city.jpg"
);
const experimentId = `hunyuan-concept-batch-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDir = path.resolve(
  process.argv[3] ?? `public/generated/hunyuan-experiments/${experimentId}`
);
const briefConfigPath = process.argv[4] ? path.resolve(process.argv[4]) : null;

const defaultBuildings = [
  {
    id: "starter-tea-shop-1x1x1",
    cells: "1x1x1",
    dimensions: "4x4x4",
    seed: 104729,
    agentBrief: "一栋刚开局即可建造的单层小茶铺：紧凑、实用，有一扇正门、两扇小窗与一个无文字的简化茶壶形悬挂招牌。"
  },
  {
    id: "starter-apothecary-1x2x2",
    cells: "1x2x2",
    dimensions: "4x8x8",
    seed: 130363,
    agentBrief: "一栋狭长的两层社区药剂铺：有一扇正门、上下层尺度一致的少量窗户与一个无文字的简化药瓶形悬挂招牌。"
  },
  {
    id: "starter-neighborhood-inn-2x2x3",
    cells: "2x2x3",
    dimensions: "8x8x12",
    seed: 155921,
    agentBrief: "一栋朴素的三层街区旅店：有一扇清楚的正门、规则但不过密的窗户与一个无文字的简化月牙形悬挂招牌。"
  }
];
const buildings = briefConfigPath
  ? JSON.parse(await fs.readFile(briefConfigPath, "utf8"))
  : defaultBuildings;

const apiKey = await loadApiKey();
const conceptBytes = await fs.readFile(conceptPath);
await fs.mkdir(outputDir, { recursive: true });

const prepared = [];
for (const building of buildings) {
  const buildingDir = path.join(outputDir, building.id);
  const guidePath = path.join(buildingDir, `guide-${building.cells}.png`);
  await fs.mkdir(buildingDir, { recursive: true });
  await execPythonFile(pythonPath, guideScript, [
    "--dimensions", building.dimensions,
    "--out", guidePath,
    "--entrance", "south",
    "--grid-unit", "4",
    "--size", "1024"
  ], { cwd: workspace });
  const guideManifest = JSON.parse(await fs.readFile(guidePath.replace(/\.png$/, ".json"), "utf8"));
  if (!guideManifest.facadeContract?.referenceDoorIsOnCameraFacingFront
      || !guideManifest.facadeContract?.productionEntranceMustMatchReferenceDoor) {
    throw new Error(`${building.id}: guide reference door is not the declared camera-facing front entrance`);
  }
  prepared.push({
    ...building,
    buildingDir,
    guidePath,
    guideManifest,
    guideBytes: await fs.readFile(guidePath)
  });
}

console.log(`Prepared ${prepared.length} front-door guideplates in ${outputDir}`);
const dayOffResults = [];
for (const building of prepared) dayOffResults.push(await generateDayOff(building));
console.log("All daylight-off variants completed; starting paired light edits.");
const results = [];
for (const building of dayOffResults) results.push(await generateDayOnAndLightmap(building));

const manifest = {
  experimentId,
  createdAt: new Date().toISOString(),
  provider: "tencent-tokenhub",
  model,
  conceptReference: {
    path: conceptPath,
    role: "style_only_reference",
    sha256: crypto.createHash("sha256").update(conceptBytes).digest("hex")
  },
  workflow: {
    promptComposition: ["WORLD_CONTEXT", "AGENT_BRIEF", "RENDER_CONTRACT"],
    worldPromptVersion: MAGIC_LONDON_WORLD_PROMPT_VERSION,
    dayOffInputs: ["geometry_scale_camera_and_front_door_edit_target", "style_only_reference"],
    dayOnInputs: ["immutable_day_off_edit_target"],
    frontFacade: "camera-facing south face",
    lightOutput: "aligned additive RGB light contribution, including lit glass and nearby frames/sills/wall bounce",
    backgroundPostprocess: "Apple Vision foreground mask to exact #FF00FF"
  },
  results
};
await fs.writeFile(path.join(outputDir, "experiment.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ experimentId, outputDir, results }, null, 2));

async function generateDayOff(building) {
  const prompt = buildDayOffPrompt(building);
  console.log(`[${building.cells}] submitting day-off ${building.id}`);
  const submission = await submitAndWait({
    prompt,
    images: [building.guideBytes.toString("base64"), conceptBytes.toString("base64")],
    seed: building.seed
  });
  const files = await downloadAndCorrect(submission, building.buildingDir, "day-off");
  const record = {
    ...building,
    guideBytes: undefined,
    prompt,
    dayOff: {
      ...files,
      seed: building.seed,
      jobId: submission.jobId,
      requestId: submission.requestId,
      revisedPromptMatchesInput: submission.revisedPrompt === prompt
    }
  };
  await fs.writeFile(path.join(building.buildingDir, "day-off.json"), `${JSON.stringify(record.dayOff, null, 2)}\n`);
  console.log(`[${building.cells}] day-off completed`);
  return record;
}

async function generateDayOnAndLightmap(building) {
  const prompt = buildDayOnPrompt(building);
  const dayOffCorrected = path.join(building.buildingDir, building.dayOff.correctedFile);
  const inputBytes = await fs.readFile(dayOffCorrected);
  console.log(`[${building.cells}] submitting paired day-on edit`);
  const submission = await submitAndWait({
    prompt,
    images: [inputBytes.toString("base64")],
    seed: building.seed
  });
  const files = await downloadAndCorrect(submission, building.buildingDir, "day-on");
  const lightContributionFile = "light-contribution.png";
  const lightSupportFile = "light-support.png";
  const stableDayOnFile = "day-on-stable-composite.png";
  const lightReportFile = "light-report.json";
  await execPythonFile(pythonPath, lightmapScript, [
    "--off", dayOffCorrected,
    "--on", path.join(building.buildingDir, files.correctedFile),
    "--out", path.join(building.buildingDir, lightContributionFile),
    "--support-out", path.join(building.buildingDir, lightSupportFile),
    "--composite-out", path.join(building.buildingDir, stableDayOnFile),
    "--report", path.join(building.buildingDir, lightReportFile),
    "--seed-delta", "0.14",
    "--support-delta", "0.018",
    "--growth", "18",
    "--tint", "#F0BF67"
  ], { cwd: workspace });
  const lightReport = JSON.parse(await fs.readFile(path.join(building.buildingDir, lightReportFile), "utf8"));
  const result = {
    id: building.id,
    cells: building.cells,
    dimensions: building.dimensions,
    agentBrief: building.agentBrief,
    guide: path.relative(outputDir, building.guidePath),
    facadeContract: building.guideManifest.facadeContract,
    dayOff: building.dayOff,
    dayOn: {
      ...files,
      seed: building.seed,
      prompt,
      jobId: submission.jobId,
      requestId: submission.requestId,
      revisedPromptMatchesInput: submission.revisedPrompt === prompt
    },
    lightContributionFile,
    lightSupportFile,
    stableDayOnFile,
    lightReportFile,
    lightReport
  };
  await fs.writeFile(path.join(building.buildingDir, "pair.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[${building.cells}] paired edit completed; mask IoU ${lightReport.subjectMaskIoUAfterAlignment.toFixed(4)}`);
  return result;
}

function buildDayOffPrompt(building) {
  return composeHunyuanDayOffPrompt(building);
}

function buildDayOnPrompt(building) {
  return [
    "任务类型：白天开灯配对编辑。唯一输入图是不可移动、不可重设计的白天关灯 RGB 基底。",
    `目标资产：${building.cells} 的 ${building.id}。必须保留完全相同的画布、正交镜头、位置、轮廓、总高度、屋顶、烟囱、墙面大色块、门、窗、窗框、招牌、底座、日间主光和 #FF00FF 背景。禁止增删、移动、缩放、旋转或重绘任何建筑结构。`,
    "唯一修改：打开正面和可见侧面现有窗户中的室内灯。将现有窗玻璃变为克制的暖金黄色；允许紧邻玻璃的窗框、窗台、窗楣以及很小范围的相邻墙面受到自然暖光照亮。这些受光面属于所需的 RGB light contribution，不要把效果局限成只有玻璃发光。",
    "灯光必须局部、清晰、可差分：保持整栋建筑的白天曝光、材质色彩和背景不变。主门及门上任何区域必须完全不透明且不发光；门框、门把、招牌、墙体远处、屋顶、烟囱和底座不得自行发光。不得新增窗户、灯具、文字、人物或场景。"
  ].join("\n\n");
}

async function submitAndWait({ prompt, images, seed }) {
  let submission;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    submission = await postJson(submitUrl, {
      model,
      prompt,
      images,
      resolution: "1024:1024",
      seed,
      logo_add: 0,
      revise: 0
    });
    if (submission.id) break;
    if (submission.error?.code !== "RequestLimitExceeded.JobNumExceed") break;
    console.log(`Hunyuan account is busy; retrying submission in 10 seconds (${attempt}/60).`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (!submission.id) {
    throw new Error(`Hunyuan submit response did not include id: ${JSON.stringify(submission)}`);
  }
  const result = await pollJob(submission.id);
  const imageUrl = result.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error(`Hunyuan completed without an image URL: ${JSON.stringify(result)}`);
  }
  return {
    jobId: submission.id,
    requestId: submission.request_id,
    imageUrl,
    revisedPrompt: result.data?.[0]?.revised_prompt
  };
}

async function downloadAndCorrect(submission, directory, prefix) {
  const response = await fetch(submission.imageUrl);
  if (!response.ok) {
    throw new Error(`Hunyuan image download failed with HTTP ${response.status}`);
  }
  const rawFile = `${prefix}-raw.png`;
  const correctedFile = `${prefix}-vision-chroma.png`;
  const matteFile = `${prefix}-vision-mask.png`;
  await fs.writeFile(path.join(directory, rawFile), Buffer.from(await response.arrayBuffer()));
  await execFileAsync("xcrun", [
    "swift",
    shadowRemovalScript,
    path.join(directory, rawFile),
    path.join(directory, correctedFile),
    path.join(directory, matteFile)
  ], {
    cwd: workspace,
    env: {
      ...process.env,
      SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
      CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
    }
  });
  return { rawFile, correctedFile, matteFile };
}

async function loadApiKey() {
  for (const name of ["HUNYUAN_IMAGE_API_KEY", "TENCENT_TOKENHUB_API_KEY"]) {
    if (process.env[name]?.trim()) return process.env[name].trim();
  }
  try {
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
    for (const name of ["HUNYUAN_IMAGE_API_KEY", "TENCENT_TOKENHUB_API_KEY"]) {
      if (entries.get(name)?.trim()) return entries.get(name).trim();
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
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
