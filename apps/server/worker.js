import { buildAssetPrompt, failAssetJob, finalizeAssetJob, generateAssetImage, prepareAssetMaps } from "./asset-production.js";

export function createWorker({ repository, config, logger = console }) {
  const db = repository.database;
  let stopped = false;

  async function processNext() {
    const outbox = await claimNext(db);
    if (!outbox) return false;
    try {
      if (outbox.job_type !== "asset_generation_requested") throw new Error(`Unsupported outbox job type ${outbox.job_type}`);
      const jobResult = await db.query("SELECT * FROM asset_jobs WHERE id = $1", [outbox.payload_jsonb.asset_job_id]);
      if (!jobResult.rowCount) throw new Error(`Missing asset job ${outbox.payload_jsonb.asset_job_id}`);
      const row = jobResult.rows[0];
      const job = normalizeJob(row);
      if (job.provider === "codex-manual") {
        await db.query(
          "UPDATE asset_jobs SET status = 'awaiting_codex', attempts = attempts + 1, output_jsonb = $1, updated_at = now() WHERE id = $2",
          [JSON.stringify({ prompt: buildAssetPrompt(job.spec), artifact_endpoint: `/api/v1/asset-jobs/${job.id}/artifacts` }), job.id]
        );
        await completeOutbox(db, outbox.id);
        return true;
      }
      await db.query("UPDATE asset_jobs SET status = 'generating', attempts = attempts + 1, updated_at = now() WHERE id = $1", [job.id]);
      const source = await generateAssetImage(job, config);
      const manifest = await prepareAssetMaps(job.id, source, { assetOutputRoot: config.assetOutputRoot });
      const principal = { kind: "agent", id: "system-asset-worker", cityId: job.city_id, scopes: ["city:build", "asset:request"] };
      await finalizeAssetJob({ repository, principal, job, manifest, idempotencyKey: `worker-complete-${job.id}` });
      await completeOutbox(db, outbox.id);
      return true;
    } catch (error) {
      logger.error?.("Asset outbox job failed", { outboxId: outbox.id, error: error.message });
      const attempts = Number(outbox.attempts);
      const terminal = !error.retryable || attempts >= 3;
      const jobResult = await db.query("SELECT * FROM asset_jobs WHERE id = $1", [outbox.payload_jsonb.asset_job_id]);
      if (jobResult.rowCount) await failAssetJob({ repository, job: normalizeJob(jobResult.rows[0]), message: error.message, terminal });
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
}

async function claimNext(db) {
  return db.transaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM outbox_jobs WHERE status = 'pending' AND available_at <= now()
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`
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
