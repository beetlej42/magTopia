import fs from "node:fs/promises";
import path from "node:path";
import { generateAssetImage } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";

const experimentDir = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/retry_qwen_emissive_probe.mjs <experiment-dir>");

const inputPath = path.join(experimentDir, "rgb-run-1-raw.png");
const inputBytes = await fs.readFile(inputPath);
const prompt = [
  "这是游戏贴图的数据标注任务，不是夜景转换，也不是建筑重绘。",
  "输入图1是一张1024×1024建筑RGB参考图。输出必须是同尺寸、逐像素对齐的发光区域语义分割图。禁止输出建筑、屋顶、墙面、地面、阴影或场景。",
  "新建一张纯黑色 #000000 画布。只在输入图中现有的四块黄色窗户玻璃的原始位置填充纯色 #F0BF67；只在现有青绿色怀表装饰的原始位置填充纯色 #6DBCB2。所有其他像素必须保持纯黑。",
  "颜色块必须严格贴合原图相应物体的边界和位置。禁止移动、缩放、旋转、裁切、补画、发光光晕、渐变、反射、文字、水印和任何可见建筑轮廓。最终结果应当看起来像纯黑底上的少量平面彩色标注区域。"
].join("\n\n");
const config = { ...loadConfig(), dashscopeImageModel: "qwen-image-2.0", dashscopeStyleReferenceEnabled: false };
const bytes = await generateAssetImage({
  provider: "qwen-image",
  spec: { footprint: "1x1", guide_volume: "1x1x1" },
  prompt,
  negativePrompt: "夜景，建筑渲染，墙面，屋顶，门，地面，阴影，光晕，渐变，紫色背景，品红背景，白色背景，灰色背景，文字，水印",
  inputImages: [{ bytes: inputBytes, mimeType: "image/png" }]
}, config);
const outputPath = path.join(experimentDir, "emissive-run-4-cn-mask.png");
await fs.writeFile(outputPath, bytes);
await fs.writeFile(path.join(experimentDir, "emissive-run-4-cn-mask.prompt.txt"), `${prompt}\n`);
console.log(JSON.stringify({ outputPath }));
