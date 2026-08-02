import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateAssetImage } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const experimentId = `qwen-asset-stability-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDir = path.join(workspace, "public/generated/qwen-experiments", experimentId);
const guidePath = path.join(workspace, "public/generated/asset-guides/guide-1x1x1.png");
const shadowRemovalScript = path.join(workspace, "scripts/remove_asset_shadow.swift");
const config = {
  ...loadConfig(),
  dashscopeImageModel: "qwen-image-2.0",
  dashscopeStyleReferenceEnabled: false
};
const spec = {
  archetype: "starter_watchmaker",
  footprint: "1x1",
  district_style: "willow_magic",
  patterns: ["warm_window_rhythm", "restrained_magic"],
  guide_volume: "1x1x1",
  creative_brief: "A tiny one-storey magical London watchmaker repair shop."
};
const subject = "one cute, tiny, one-storey magical London watchmaker repair shop: compact warm ochre plaster and dark timber body, one simple blue-grey gable roof, one human-scale front door, two warm amber windows, one small copper clock sign without numbers, one short chimney, and one tiny teal timekeeping charm";

function rgbPrompt({ albedo = false } = {}) {
  return [
    "Use case: stylized-concept.",
    "Asset type: an isolated 2D building asset for a soft-isometric city game.",
    "Input image: Image 1 is the edit target and immutable production frame.",
    `Primary request: Edit Image 1. Replace only the translucent blue-grey guide volume with ${subject}.`,
    "Style/medium: clean cute soft-isometric low-poly game illustration, broad simple matte color planes, gently faceted shapes, charming and readable at small size. Use simplified grouped material colors only; no individual bricks, roof tiles, mortar lines, weathering, scratches, photographic texture, glossy material, or heavy ambient occlusion.",
    "Composition/framing: preserve Image 1 exactly as the camera and scale template. Keep its square canvas, orthographic three-quarter view, parcel diamond, three visible parcel corners, base position, footprint, height, and one-storey human scale. The building must fill the guide volume naturally. Remove all guide edges, bands, arrows, ghost door, and labels.",
    albedo
      ? "Rendering pass: output a neutral RGB base-color/albedo render. Use uniform local material colors with soft edge separation only. No directional lighting, no contact shadow, no cast shadow, no ambient shadow, no glow spill, and no shaded floor plane."
      : "Lighting/mood: warm gentle afternoon light from upper left and soft cool shadow planes on the building only. No contact shadow or cast shadow on the parcel or chroma background.",
    "Constraints: outside the building and its small parcel base must be a perfectly flat, uniform #FF00FF chroma-key background, pixel-clean with no texture, gradient, glow, spill, floor, street, scenery, shadow, characters, vehicles, text, watermark, or logo. Keep the full parcel and building inside an 8% clean margin. No second storey, dormer, or extra facade window row."
  ].join("\n\n");
}

function emissivePrompt() {
  return [
    "Use case: precise-object-edit.",
    "Asset type: an emissive semantic map aligned pixel-for-pixel to a game asset RGB image.",
    "Input image: Image 1 is the immutable RGB alignment reference.",
    "Primary request: do not redraw, resize, rotate, move, crop, or reinterpret the building. Output a map on the exact same 1024x1024 canvas. Paint only the existing visible window glass panes and the tiny existing teal magical timekeeping charm. Existing warm window panes must be solid warm amber #F0BF67. The existing teal magical charm must be solid teal #6DBCB2.",
    "Everything else must be pure black #000000, including walls, roof, trim, door, clock sign, chimney, parcel base, background, shadows, and empty space.",
    "No glow, bloom, halo, gradients, reflections, antialiased enlargement, new windows, new symbols, new lights, text, watermark, or geometry changes. This is a flat semantic mask, not a night illustration. Exact pixel alignment is more important than aesthetics."
  ].join("\n\n");
}

await fs.mkdir(outputDir, { recursive: true });
const rgbRuns = [];
for (let index = 1; index <= 3; index += 1) {
  const bytes = await generateAssetImage({ provider: "qwen-image", spec, prompt: rgbPrompt() }, config);
  const rawPath = path.join(outputDir, `rgb-run-${index}-raw.png`);
  const correctedPath = path.join(outputDir, `rgb-run-${index}-vision-chroma.png`);
  const maskPath = path.join(outputDir, `rgb-run-${index}-vision-mask.png`);
  await fs.writeFile(rawPath, bytes);
  const { stdout } = await execFileAsync("xcrun", ["swift", shadowRemovalScript, rawPath, correctedPath, maskPath], {
    cwd: workspace,
    env: {
      ...process.env,
      SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
      CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
    }
  });
  rgbRuns.push({ raw: path.basename(rawPath), chromaCorrected: path.basename(correctedPath), matte: path.basename(maskPath), postprocess: stdout.trim() });
}

const albedoBytes = await generateAssetImage({ provider: "qwen-image", spec, prompt: rgbPrompt({ albedo: true }) }, config);
const albedoRawPath = path.join(outputDir, "rgb-albedo-raw.png");
const albedoCorrectedPath = path.join(outputDir, "rgb-albedo-vision-chroma.png");
const albedoMaskPath = path.join(outputDir, "rgb-albedo-vision-mask.png");
await fs.writeFile(albedoRawPath, albedoBytes);
await execFileAsync("xcrun", ["swift", shadowRemovalScript, albedoRawPath, albedoCorrectedPath, albedoMaskPath], {
  cwd: workspace,
  env: {
    ...process.env,
    SWIFT_MODULECACHE_PATH: "/tmp/magictown-swift-module-cache",
    CLANG_MODULE_CACHE_PATH: "/tmp/magictown-clang-module-cache"
  }
});

const selectedRgbPath = path.join(outputDir, "rgb-run-1-vision-chroma.png");
const selectedRgb = await fs.readFile(selectedRgbPath);
const emissiveRuns = [];
for (let index = 1; index <= 3; index += 1) {
  const bytes = await generateAssetImage({
    provider: "qwen-image",
    spec,
    prompt: emissivePrompt(),
    negativePrompt: "night scene, rendered building, changed geometry, moved windows, glow, bloom, gradients, grey background, magenta background, white background, text, watermark",
    inputImages: [{ bytes: selectedRgb, mimeType: "image/png" }]
  }, config);
  const outputPath = path.join(outputDir, `emissive-run-${index}.png`);
  await fs.writeFile(outputPath, bytes);
  emissiveRuns.push(path.basename(outputPath));
}

await fs.writeFile(path.join(outputDir, "experiment.json"), `${JSON.stringify({
  experimentId,
  provider: "qwen-image",
  model: config.dashscopeImageModel,
  size: config.dashscopeImageSize,
  spec,
  prompts: { rgb: rgbPrompt(), albedo: rgbPrompt({ albedo: true }), emissive: emissivePrompt() },
  guide: path.relative(outputDir, guidePath),
  rgbRuns,
  albedo: { raw: path.basename(albedoRawPath), chromaCorrected: path.basename(albedoCorrectedPath) },
  emissiveInput: path.basename(selectedRgbPath),
  emissiveRuns
}, null, 2)}\n`);

console.log(JSON.stringify({ experimentId, outputDir, rgbRuns, albedo: path.basename(albedoCorrectedPath), emissiveRuns }));
