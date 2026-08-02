import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_PROMPT_VERSION, buildAssetPrompt, generateAssetImage } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const probeId = `qwen-style-probe-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const outputDir = path.join(workspace, "public/generated/style-probes", probeId);
const promptMode = process.env.MAGICTOWN_PROMPT_MODE ?? "service";
const spec = {
  archetype: "riverside_bakery",
  footprint: "1x1",
  district_style: "willow_magic",
  patterns: ["warm_window_rhythm", "restrained_magic"],
  guide_volume: "1x1x1",
  creative_brief: "A small one-storey detached magical London riverside bakery, with a compact red-brick body, simple dark slate gable roof, one clear human-scale front door, two warm windows, a modest sandstone threshold, one chimney, and one tiny teal bread-warming rune no larger than the door handle."
};

const config = {
  ...loadConfig(),
  dashscopeStyleReferenceEnabled: false
};
const gptImagePrompt = [
  "Use case: stylized-concept.",
  "Asset type: an isolated 2D building asset for a soft-isometric city game.",
  "Input image: Image 1 is the edit target and immutable production frame.",
  "Primary request: Edit Image 1. Replace only the translucent blue-grey guide volume with one cute, small, one-storey magical London bakery: compact brick body, one simple dark slate gable roof, one front door, two warm amber windows, a modest sandstone threshold, one chimney, and one tiny teal magical bread mark.",
  "Style/medium: clean soft-isometric low-poly game illustration, broad simple matte color planes, gently faceted shapes, charming and readable at small size. Use simplified brick and roof color blocks only; no individual bricks, roof tiles, mortar lines, weathering, scratches, realistic texture, glossy material, or dramatic shadows.",
  "Composition/framing: preserve Image 1 exactly as the camera and scale template. Keep its square canvas, orthographic three-quarter view, parcel diamond, three visible parcel corners, base position, footprint, height, and one-storey human scale. The building must fill the guide volume naturally, not be smaller or taller. Remove all guide edges, bands, arrows, ghost door, and labels.",
  "Lighting/mood: warm gentle afternoon light from upper left, soft cool shadow planes, no cast shadow outside the parcel.",
  "Constraints: outside the parcel must remain a perfectly flat, uniform #FF00FF chroma-key background, pixel-clean with no texture, gradient, glow, spill, floor, street, scenery, characters, vehicles, text, watermark, or logo. Keep the full parcel and building inside an 8% clean margin. No second storey, dormer, or extra facade window row."
].join("\n\n");
const prompt = promptMode === "gpt-image" ? gptImagePrompt : null;
const bytes = await generateAssetImage({ provider: "qwen-image", spec, prompt }, config);
await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "source-magenta.png"), bytes),
  fs.writeFile(path.join(outputDir, "request.json"), `${JSON.stringify({
    provider: "qwen-image",
    model: config.dashscopeImageModel,
    size: config.dashscopeImageSize,
    promptVersion: ASSET_PROMPT_VERSION,
    inputImages: ["guideplate-1x1x1"],
    spec,
    promptMode,
    prompt: prompt ?? buildAssetPrompt(spec, { usesStyleReference: false })
  }, null, 2)}\n`)
]);
console.log(JSON.stringify({ probeId, outputDir, imagePath: path.join(outputDir, "source-magenta.png") }));
