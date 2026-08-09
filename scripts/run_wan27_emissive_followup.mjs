import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { generateAssetImage } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";
import { execPythonFile, resolvePythonExecutable } from "./python-runtime.mjs";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = path.resolve(process.argv[2] ?? "");
const outputPath = path.resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node scripts/run_wan27_emissive_followup.mjs <rgb.png> <emissive.png>");
}

const rgbReference = await fs.readFile(inputPath);
if (!rgbReference.subarray(1, 4).equals(Buffer.from("PNG"))) {
  throw new Error("Wan emissive follow-up currently requires a PNG input.");
}
const width = rgbReference.readUInt32BE(16);
const height = rgbReference.readUInt32BE(20);
const prompt = [
  "这是图像到语义分割标签图的转换任务。请编辑唯一输入图，输出一张与输入图尺寸、镜头、位置逐像素对齐的发光区域标签图。",
  "把输入图中现有的所有暖黄色窗户玻璃和发光门玻璃区域替换为纯色 #F0BF67。",
  "把输入图中现有的青绿色怀表魔法装饰区域替换为纯色 #6DBCB2。",
  "把输入图的所有其他像素（包括背景、建筑墙面、屋顶、木框、烟囱、门框、底座和阴影）替换为纯黑 #000000。",
  "最终输出必须是纯黑底上的少量平面彩色区域，不是建筑图、夜景、轮廓图或抠图。禁止白色背景、建筑轮廓、纹理、阴影、渐变、光晕、反射、文字、符号和水印。"
].join("\n\n");

const bytes = await generateAssetImage({
  provider: "wan-image",
  model: "wan2.7-image",
  spec: {
    archetype: "starter_watchmaker",
    footprint: "1x1",
    district_style: "willow_magic",
    guide_volume: "1x1x1",
    creative_brief: "Emissive semantic map extraction."
  },
  prompt,
  inputImages: [{ bytes: rgbReference, mimeType: "image/png" }],
  parameters: {
    seed: 141421,
    bbox_list: [[[0, 0, width - 1, height - 1]]]
  }
}, { ...loadConfig(), dashscopeStyleReferenceEnabled: false });

await fs.writeFile(outputPath, bytes);
const extension = path.extname(outputPath);
const quantizedPath = `${outputPath.slice(0, -extension.length)}-quantized${extension}`;
const pythonPath = await resolvePythonExecutable({ workspace });
await execPythonFile(pythonPath, path.join(workspace, "scripts/quantize_generated_emissive.py"), [
  "--input", outputPath,
  "--out", quantizedPath,
  "--minimum-component", "40"
], { cwd: workspace });

console.log(JSON.stringify({
  inputPath,
  proposedOutputPath: outputPath,
  quantizedOutputPath: quantizedPath,
  model: "wan2.7-image"
}));
