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

// #85 baseline (instanced-tree architecture on the same fixture), measured on
// main after #85 merged: ~40.6k rendered triangles, ~58 mesh/draw-call proxy,
// ~1.3s vegetation build. #86 must stay close to this (it is the intended
// architecture + performance level), not the older #84 greedy envelope.
const BASELINE = {
  label: "85-baseline-instanced-architecture",
  renderedTriangles: 40640,
  meshCount: 58,
  buildMs: 1300
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
    buildMs: {
      now: c.perf.buildMs,
      baseline: BASELINE.buildMs,
      multiplier: Number((c.perf.buildMs / BASELINE.buildMs).toFixed(2))
    }
  }
};

const reportPath = path.join(artifactsDir, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, ...report }, null, 2));
