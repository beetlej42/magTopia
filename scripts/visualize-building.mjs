import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBuildingVisualizationService } from "../apps/server/building-visualization.js";

const [input, output, view = "front", size = "512", ...extra] = process.argv.slice(2);
if (!input || !output || extra.length || !["front", "back", "top"].includes(view) || !["512", "1024"].includes(size)) {
  console.error("Usage: pnpm visualize:building <design-or-spec.json> <output.png> [front|back|top] [512|1024]");
  process.exitCode = 1;
} else {
  const service = createBuildingVisualizationService();
  try {
    const design = JSON.parse(await readFile(input, "utf8"));
    const { png, metadata } = await service.render(design, { view, size: Number(size) });
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, png);
    console.log(JSON.stringify({ output, ...metadata }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await service.close();
  }
}
