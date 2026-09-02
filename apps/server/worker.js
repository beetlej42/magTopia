import { ASSET_PROMPT_VERSION, buildAssetPrompt, failAssetJob, finalizeAssetJob, generateAssetBundle, prepareAssetMaps, resolveAssetGuideplate, resolveStyleReferences } from "./asset-production.js";
import { generateBakedBuildingArtifact, getBuildingSourceHash, writeBakedBuildingArtifact } from "./render-artifact-service.js";

export function createWorker({ repository, config, logger = console, onlyRenderArtifactIds = null }) {
  const db = repository.database;
  let stopped = false;

  async function processNext() {
    const outbox = await claimNext(db, onlyRenderArtifactIds);
    if (!outbox) return false;
    try {
      if (outbox.job_type === "render_artifact_bake_requested") {
        await processRenderArtifactOutbox(outbox);
        return true;
      }
      if (outbox.job_type !== "asset_generation_requested") throw new Error(`Unsupported outbox job type ${outbox.job_type}`);
      const jobResult = await db.query("SELECT * FROM asset_jobs WHERE id = $1", [outbox.payload_jsonb.asset_job_id]);
      if (!jobResult.rowCount) throw new Error(`Missing asset job ${outbox.payload_jsonb.asset_job_id}`);
      const row = jobResult.rows[0];
      const job = normalizeJob(row);
      if (job.provider === "codex-manual") {
        const [guideplate, stylePack] = await Promise.all([
          resolveAssetGuideplate(job.spec, config),
          resolveStyleReferences(config)
        ]);
        await db.query(
          "UPDATE asset_jobs SET status = 'awaiting_codex', attempts = attempts + 1, output_jsonb = $1, updated_at = now() WHERE id = $2",
          [JSON.stringify({
            prompt: buildAssetPrompt(job.spec, { usesStyleReference: true }),
            prompt_version: ASSET_PROMPT_VERSION,
            guide_volume: guideplate.volume.id,
            guide_image_url: guideplate.publicPath,
            style_reference_id: stylePack.id,
            style_references: stylePack.references.map((reference) => ({ role: reference.role, url: reference.publicPath })),
            artifact_endpoint: `/api/v1/asset-jobs/${job.id}/artifacts`
          }), job.id]
        );
        await completeOutbox(db, outbox.id);
        return true;
      }
      await db.query("UPDATE asset_jobs SET status = 'generating', attempts = attempts + 1, updated_at = now() WHERE id = $1", [job.id]);
      const productionBundle = await generateAssetBundle(job, config);
      const manifest = await prepareAssetMaps(job.id, productionBundle.sourceBytes, {
        assetOutputRoot: config.assetOutputRoot,
        spec: job.spec,
        config,
        productionBundle
      });
      const principal = { kind: "agent", id: "system-asset-worker", cityId: job.city_id, scopes: ["city:build", "asset:request"] };
      await finalizeAssetJob({ repository, principal, job, manifest, idempotencyKey: `worker-complete-${job.id}` });
      await completeOutbox(db, outbox.id);
      return true;
    } catch (error) {
      logger.error?.("Asset outbox job failed", { outboxId: outbox.id, error: error.message, code: error.code, details: error.details });
      const attempts = Number(outbox.attempts);
      const terminal = !error.retryable || attempts >= 3;
      if (outbox.job_type === "render_artifact_bake_requested") {
        await db.query(
          "UPDATE render_artifacts SET status = $1, error_jsonb = $2, updated_at = now() WHERE id = $3",
          [terminal ? "failed" : "queued", JSON.stringify({ message: error.message, code: error.code ?? "BAKE_FAILED" }), outbox.payload_jsonb.render_artifact_id]
        );
        if (terminal) await failOutbox(db, outbox.id, error.message);
        else await retryOutbox(db, outbox.id, error.message, attempts);
        return true;
      }
      const jobResult = await db.query("SELECT * FROM asset_jobs WHERE id = $1", [outbox.payload_jsonb.asset_job_id]);
      if (jobResult.rowCount) await failAssetJob({
        repository,
        job: normalizeJob(jobResult.rows[0]),
        message: error.message,
        code: error.code,
        details: error.details,
        terminal
      });
      if (terminal) await failOutbox(db, outbox.id, error.message);
      else await retryOutbox(db, outbox.id, error.message, attempts);
      return true;
    }
  }

  async function run() {
    while (!stopped) {
      const processed = await processNext();
      if (!processed) await delay(config.workerPollMs);
    }
  }

  return { processNext, run, stop: () => { stopped = true; } };

  async function processRenderArtifactOutbox(outbox) {
    const artifactId = outbox.payload_jsonb.render_artifact_id;
    const result = await db.query("SELECT * FROM render_artifacts WHERE id = $1", [artifactId]);
    if (!result.rowCount) throw new Error(`Missing render artifact job ${artifactId}`);
    const job = result.rows[0];
    if (job.status === "ready") {
      await completeOutbox(db, outbox.id);
      return;
    }
    const cityResult = await db.query("SELECT state_jsonb FROM cities WHERE id = $1", [job.city_id]);
    const building = cityResult.rows[0]?.state_jsonb?.buildings?.[job.building_id];
    if (!building?.voxelDesign?.generation?.sourceSpec) {
      await db.query("UPDATE render_artifacts SET status = 'waiting_for_building', updated_at = now() WHERE id = $1", [artifactId]);
      await completeOutbox(db, outbox.id);
      return;
    }
    if (Number(building.voxelDesign.revision) !== Number(job.design_revision) || getBuildingSourceHash(building)?.toLowerCase() !== String(job.source_hash).toLowerCase()) {
      await db.query("UPDATE render_artifacts SET status = 'failed', error_jsonb = $1, updated_at = now() WHERE id = $2", [JSON.stringify({ message: "The queued artifact is stale; backfill or requeue the current design" }), artifactId]);
      await completeOutbox(db, outbox.id);
      return;
    }
    await db.query("UPDATE render_artifacts SET status = 'processing', attempts = $1, updated_at = now() WHERE id = $2", [Number(outbox.attempts), artifactId]);
    const artifact = await generateBakedBuildingArtifact(building);
    const written = await writeBakedBuildingArtifact(config.bakedArtifactRoot, job.city_id, building, artifact);
    await db.query(
      `UPDATE render_artifacts
       SET status = 'ready', format_version = $1, sha256 = $2, byte_length = $3,
           relative_path = $4, error_jsonb = NULL, updated_at = now()
       WHERE id = $5`,
      [artifact.formatVersion, artifact.sha256, artifact.byteLength, written.relativePath, artifactId]
    );
    await completeOutbox(db, outbox.id);
  }
}

async function claimNext(db, onlyRenderArtifactIds = null) {
  return db.transaction(async (client) => {
    const restricted = Array.isArray(onlyRenderArtifactIds);
    const result = await client.query(
      restricted
        ? `SELECT * FROM outbox_jobs
           WHERE status = 'pending' AND available_at <= now()
             AND job_type = 'render_artifact_bake_requested'
             AND payload_jsonb->>'render_artifact_id' = ANY($1::text[])
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`
        : `SELECT * FROM outbox_jobs WHERE status = 'pending' AND available_at <= now()
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      restricted ? [onlyRenderArtifactIds] : []
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    await client.query("UPDATE outbox_jobs SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now() WHERE id = $1", [row.id]);
    return { ...row, attempts: Number(row.attempts) + 1 };
  });
}

function completeOutbox(db, id) { return db.query("UPDATE outbox_jobs SET status = 'completed', locked_at = NULL, updated_at = now() WHERE id = $1", [id]); }
function failOutbox(db, id, error) { return db.query("UPDATE outbox_jobs SET status = 'failed', locked_at = NULL, last_error = $2, updated_at = now() WHERE id = $1", [id, error]); }
function retryOutbox(db, id, error, attempts) { return db.query("UPDATE outbox_jobs SET status = 'pending', locked_at = NULL, last_error = $2, available_at = now() + ($3 * interval '1 second'), updated_at = now() WHERE id = $1", [id, error, Math.min(60, 2 ** attempts)]); }
function normalizeJob(row) { return { id: row.id, city_id: row.city_id, owner_player_id: row.owner_player_id, status: row.status, provider: row.provider, spec: row.spec_jsonb, attempts: row.attempts, output: row.output_jsonb, error: row.error_jsonb }; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
