import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNonVisualAgentBuildScenario } from "../src/city/agent-district-simulation.js";
import { createAgentVoxelVegetationLayer } from "../src/generators/agentVoxelInfrastructure.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(root, "artifacts", "vegetation-benchmark");
await mkdir(artifactsDir, { recursive: true });

const seed = process.env.VEG_BENCH_SEED || "voxel-infrastructure-test";
const scenario = runNonVisualAgentBuildScenario({ seed });
const startedAt = Date.now();
const layer = createAgentVoxelVegetationLayer({ state: scenario.state, grid: scenario.world.grid, seed });
const wallMs = Date.now() - startedAt;
const c = layer.userData.contract;

// #84 baseline (greedy voxel pipeline on the same fixture), measured from main
// after #84 merged: source voxels, rendered triangles, and greedy chunk meshes.
const BASELINE = {
  postShort81: "84-baseline-greedy-voxel-pipeline",
  sourceVoxelCount: 228373,
  renderedTriangles: 102578,
  meshCount: 167
};

const trees = c.renderStats.trees;
const shrubs = c.renderStats.shrubs;
const shrubDrawCalls = shrubs?.meshCount ?? shrubs?.chunkCount ?? 0;
const totalTriangles = trees.renderedTriangles + (shrubs?.renderedTriangles ?? 0);
const totalDrawCalls = trees.drawCalls + shrubDrawCalls;
const report = {
  seed,
  fixture: "runNonVisualAgentBuildScenario (same state/seed fixture as createAgentAcceptanceCity)",
  baseline: BASELINE,
  wallMs,
  perf: c.perf,
  vegetation: {
    trees: c.trees,
    shrubs: c.shrubs,
    instancedTrees: c.instancedTrees,
    treeMeshCount: c.treeMeshCount,
    shrubVoxelCount: c.voxelCount
  },
  render: {
    trees,
    shrubs,
    totalTriangles,
    totalDrawCalls
  },
  comparison: {
    renderedTriangles: {
      now: totalTriangles,
      baseline: BASELINE.renderedTriangles,
      multiplier: Number((totalTriangles / BASELINE.renderedTriangles).toFixed(2))
    },
    meshDrawCalls: {
      now: totalDrawCalls,
      baseline: BASELINE.meshCount,
      multiplier: Number((totalDrawCalls / BASELINE.meshCount).toFixed(2))
    },
    voxelCount: {
      now: c.voxelCount,
      baseline: BASELINE.sourceVoxelCount,
      multiplier: Number((c.voxelCount / BASELINE.sourceVoxelCount).toFixed(2))
    }
  }
};

const reportPath = path.join(artifactsDir, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
