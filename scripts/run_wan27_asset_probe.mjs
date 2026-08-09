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
const experimentId = `wan27-asset-probe-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDir = path.join(workspace, "public/generated/wan-experiments", experimentId);
const shadowRemovalScript = path.join(workspace, "scripts/remove_asset_shadow.swift");
const flatCanvasScript = path.join(workspace, "scripts/create_flat_canvas.py");
const pythonPath = await resolvePythonExecutable({ workspace });
const config = { ...loadConfig(), dashscopeStyleReferenceEnabled: false };
const model = "wan2.7-image";
const spec = {
  archetype: "starter_watchmaker",
  footprint: "1x1",
  district_style: "willow_magic",
  patterns: ["warm_window_rhythm", "restrained_magic"],
  guide_volume: "1x1x1",
  creative_brief: "A tiny one-storey magical London watchmaker repair shop."
};

const rgbPrompt = [
  "Use case: stylized-concept.",
  "Asset type: an isolated 2D building asset for a soft-isometric city game.",
  "Input image: Image 1 is the edit target and immutable production frame.",
  "Primary request: Edit Image 1. Replace only the translucent blue-grey guide volume with one cute, tiny, one-storey magical London watchmaker repair shop: compact warm ochre plaster and dark timber body, one simple blue-grey gable roof, one human-scale front door, two warm amber windows, one small copper clock sign without numbers, one short chimney, and one tiny teal timekeeping charm.",
  "Style/medium: clean cute soft-isometric low-poly game illustration, broad simple matte color planes, gently faceted shapes, charming and readable at small size. Use simplified grouped material colors only; no individual bricks, roof tiles, mortar lines, weathering, scratches, photographic texture, glossy material, or heavy ambient occlusion.",
  "Composition/framing: preserve Image 1 exactly as the camera and scale template. Keep its square canvas, orthographic three-quarter view, parcel diamond, three visible parcel corners, base position, footprint, height, and one-storey human scale. The building must fill the guide volume naturally. Remove all guide edges, bands, arrows, ghost door, and labels.",
  "Lighting/mood: warm gentle afternoon light from upper left and soft cool shadow planes on the building only. No contact shadow or cast shadow on the parcel or chroma background.",
  "Constraints: outside the building and its small parcel base must be a perfectly flat, uniform #FF00FF chroma-key background, pixel-clean with no texture, gradient, glow, spill, floor, street, scenery, shadow, characters, vehicles, text, watermark, or logo. Keep the full parcel and building inside an 8% clean margin. No second storey, dormer, or extra facade window row."
].join("\n\n");

const emissivePrompt = [
  "这是游戏贴图的数据标注任务，不是夜景转换，也不是建筑重绘。",
  "图1是不可修改的RGB建筑位置参考。图2是必须编辑的纯黑输出底图。只编辑图2，禁止重绘图1中的建筑。输出尺寸、镜头和所有标注位置必须与图1逐像素对齐。",
  "在图2上，只把图1中现有的黄色窗户玻璃区域填充为纯色 #F0BF67；只把图1中现有的青绿色怀表魔法装饰区域填充为纯色 #6DBCB2。",
  "图2的所有其他像素必须保持纯黑 #000000。禁止建筑轮廓、墙面、屋顶、门、底座、阴影、光晕、渐变、反射、新窗口、新符号、文字和水印。最终图像必须看起来像纯黑底上的少量平面彩色语义标注。"
].join("\n\n");

await fs.mkdir(outputDir, { recursive: true });
const rgbRuns = [];
for (const [index, seed] of [[1, 314159], [2, 271828]]) {
  const bytes = await generateAssetImage({ provider: "wan-image", model, spec, prompt: rgbPrompt, parameters: { seed } }, config);
  const rawPath = path.join(outputDir, `rgb-run-${index}-raw.png`);
  const correctedPath = path.join(outputDir, `rgb-run-${index}-vision-chroma.png`);
  const mattePath = path.join(outputDir, `rgb-run-${index}-vision-mask.png`);
  await fs.writeFile(rawPath, bytes);
  await execFileAsync("xcrun", ["swift", shadowRemovalScript, rawPath, correctedPath, mattePath], {
    cwd: workspace,
    env: {
      ...process.env,
      SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
      CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
    }
  });
  rgbRuns.push({ seed, raw: path.basename(rawPath), corrected: path.basename(correctedPath), matte: path.basename(mattePath) });
}

const blackTargetPath = path.join(outputDir, "emissive-target-black.png");
await execPythonFile(pythonPath, flatCanvasScript, ["--out", blackTargetPath, "--size", "1024x1024", "--color", "#000000"], { cwd: workspace });
const [rgbReference, blackTarget] = await Promise.all([
  fs.readFile(path.join(outputDir, "rgb-run-1-vision-chroma.png")),
  fs.readFile(blackTargetPath)
]);
const emissiveBytes = await generateAssetImage({
  provider: "wan-image",
  model,
  spec,
  prompt: emissivePrompt,
  inputImages: [
    { bytes: rgbReference, mimeType: "image/png" },
    { bytes: blackTarget, mimeType: "image/png" }
  ],
  parameters: {
    seed: 161803,
    bbox_list: [[], [[0, 0, 1023, 1023]]]
  }
}, config);
const emissivePath = path.join(outputDir, "emissive-two-image.png");
await fs.writeFile(emissivePath, emissiveBytes);

await fs.writeFile(path.join(outputDir, "experiment.json"), `${JSON.stringify({
  experimentId,
  provider: "wan-image",
  model,
  size: config.dashscopeImageSize,
  spec,
  prompts: { rgb: rgbPrompt, emissive: emissivePrompt },
  rgbRuns,
  emissive: {
    inputs: ["rgb-run-1-vision-chroma.png", path.basename(blackTargetPath)],
    bboxList: [[], [[0, 0, 1023, 1023]]],
    output: path.basename(emissivePath)
  }
}, null, 2)}\n`);

console.log(JSON.stringify({ experimentId, outputDir, model, rgbRuns, emissive: path.basename(emissivePath) }));
