import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompress, constants as zlibConstants } from "node:zlib";
import { promisify } from "node:util";
import {
  createVoxelBuildingLodLevelsFromSpec,
  createVoxelMassingLodLevels
} from "../../src/generators/voxelBuildingLab.js";
import {
  BAKED_BUILDING_ARTIFACT_VERSION,
  encodeBakedBuildingArtifact
} from "../../src/render/bakedBuildingArtifact.js";

const compress = promisify(brotliCompress);
export const RENDER_ARTIFACT_FORMAT_VERSION = BAKED_BUILDING_ARTIFACT_VERSION;
export const RENDER_ARTIFACT_STATUS = Object.freeze({
  queued: "queued",
  processing: "processing",
  waitingForBuilding: "waiting_for_building",
  ready: "ready",
  failed: "failed"
});

export function getBuildingSourceHash(building) {
  const design = building?.voxelDesign;
  if (!design?.generation?.sourceSpec) return null;
  if (/^[a-f0-9]{64}$/i.test(String(design.specHash ?? ""))) return String(design.specHash).toLowerCase();
  return createHash("sha256").update(JSON.stringify({
    sourceSpec: design.generation.sourceSpec,
    decorations: design.decorations ?? null
  })).digest("hex");
}

export async function generateBakedBuildingArtifact(building) {
  const design = building?.voxelDesign;
  const sourceSpec = design?.generation?.sourceSpec;
  if (!building?.id || !sourceSpec) throw new Error("A voxel building with a complete sourceSpec is required");
  const mode = design.generation.mode;
  const pipeline = mode === "urban_massing"
    ? createVoxelMassingLodLevels({ spec: sourceSpec, decorations: design.decorations, renderStrategy: "greedy", voxelChunkSize: 128, maxMergeSpanVoxels: 16 }, [1, 2, 3])
    : createVoxelBuildingLodLevelsFromSpec(sourceSpec, { decorations: design.decorations, renderStrategy: "greedy", voxelChunkSize: 128, maxMergeSpanVoxels: 16 }, [1, 2, 3]);
  const levels = pipeline.levels.map((level) => ({
    lod: level.factor - 1,
    meshes: [
      ...level.meshes.map(meshToArtifactEntry),
      ...(level.factor === 1 ? collectDecorationMeshes(pipeline.decorations) : [])
    ]
  }));
  const rawBytes = encodeBakedBuildingArtifact({
    buildingId: building.id,
    designRevision: Number(design.revision),
    sourceHash: getBuildingSourceHash(building),
    voxelSize: pipeline.levels[0]?.diagnostics?.voxelSize ?? null,
    levels
  });
  const compressedBytes = await compress(rawBytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } });
  return {
    rawBytes,
    compressedBytes,
    sha256: createHash("sha256").update(rawBytes).digest("hex"),
    byteLength: rawBytes.byteLength,
    compressedByteLength: compressedBytes.byteLength,
    formatVersion: RENDER_ARTIFACT_FORMAT_VERSION,
    sourceHash: getBuildingSourceHash(building),
    designRevision: Number(design.revision)
  };
}

export async function writeBakedBuildingArtifact(root, cityId, building, artifact) {
  const sourceHash = safeHash(artifact.sourceHash);
  const relativePath = path.join(String(cityId), String(building.id), `${artifact.designRevision}-${sourceHash}.mtba.br`);
  const absolutePath = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (!isWithin(resolvedRoot, absolutePath)) throw new Error("Baked artifact path escaped configured root");
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, artifact.compressedBytes, { flag: "wx", mode: 0o600 });
  try {
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    // A concurrent idempotent worker may have published the same immutable
    // artifact already. It is safe to retain the winner.
    if (error.code !== "EEXIST") throw error;
  }
  return { relativePath, absolutePath };
}

// The memory repository uses the same service with a small repository
// protocol, making backfill and worker behavior testable without PostgreSQL.
export function createRenderArtifactWorker({ repository, config, logger = console }) {
  async function processNext() {
    const claimed = await repository.claimNextRenderArtifactJob?.();
    if (!claimed) return false;
    const { outbox, job } = claimed;
    if (!job) {
      await repository.failRenderArtifactJob(outbox.id, outbox.renderArtifactId, new Error("Missing render artifact job"));
      return true;
    }
    try {
      const city = await repository.getCityForScheduler(job.cityId);
      const building = city?.state?.buildings?.[job.buildingId];
      if (!building?.voxelDesign?.generation?.sourceSpec) {
        await repository.completeRenderArtifactJob(outbox.id, job.id, { status: RENDER_ARTIFACT_STATUS.waitingForBuilding });
        return true;
      }
      if (Number(building.voxelDesign.revision) !== Number(job.designRevision) || getBuildingSourceHash(building)?.toLowerCase() !== String(job.sourceHash).toLowerCase()) {
        await repository.failRenderArtifactJob(outbox.id, job.id, new Error("The queued artifact is stale"));
        return true;
      }
      const artifact = await generateBakedBuildingArtifact(building);
      const written = await writeBakedBuildingArtifact(config.bakedArtifactRoot, job.cityId, building, artifact);
      await repository.completeRenderArtifactJob(outbox.id, job.id, {
        status: RENDER_ARTIFACT_STATUS.ready,
        artifactVersion: artifact.formatVersion,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        relativePath: written.relativePath,
        error: null
      });
      return true;
    } catch (error) {
      logger.error?.("Render artifact bake failed", { artifactId: job.id, error: error.message });
      await repository.failRenderArtifactJob(outbox.id, job.id, error, Number(outbox.attempts) < 3);
      return true;
    }
  }
  return { processNext };
}

export async function enqueueCityRenderArtifactBackfill({ repository, cityId }) {
  const city = await repository.getCityForScheduler(cityId);
  if (!city) throw new Error(`City not found: ${cityId}`);
  const buildings = Object.values(city.state?.buildings ?? {})
    .filter((building) => building?.voxelDesign?.generation?.sourceSpec);
  const summary = { cityId, buildings: buildings.length, queued: 0, skipped: 0, artifactIds: [] };
  for (const building of buildings) {
    const row = await repository.enqueueRenderArtifactBake({
      cityId,
      buildingId: building.id,
      designId: building.voxelDesign.id ?? null,
      designRevision: building.voxelDesign.revision,
      sourceHash: getBuildingSourceHash(building)
    });
    if (row?.status === RENDER_ARTIFACT_STATUS.ready) summary.skipped += 1;
    else if (row) {
      summary.queued += 1;
      summary.artifactIds.push(row.id);
    }
  }
  return summary;
}

function meshToArtifactEntry(mesh) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.getIndex();
  if (!position || !normal || !index) throw new Error("Voxel mesh is missing position, normal or index data");
  return {
    materialId: mesh.userData.materialId ?? "timber",
    geometry: {
      positions: position.array,
      normals: normal.array,
      indices: index.array,
      ao: geometry.getAttribute("voxelAo")?.array,
      surfaceKind: geometry.getAttribute("voxelSurfaceKind")?.array
    }
  };
}

function collectDecorationMeshes(root) {
  const meshes = [];
  root?.traverse?.((object) => {
    if (object.isMesh) meshes.push(meshToArtifactEntry(object));
  });
  return meshes;
}

function safeHash(value) {
  const hash = String(value ?? "");
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Artifact source hash must be a SHA-256 hex digest");
  return hash.toLowerCase();
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
