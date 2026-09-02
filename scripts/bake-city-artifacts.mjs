import { loadConfig } from "../apps/server/config.js";
import { createDatabase, migrateDatabase } from "../apps/server/database.js";
import { createRepository } from "../apps/server/repository.js";
import { enqueueCityRenderArtifactBackfill } from "../apps/server/render-artifact-service.js";
import { createWorker } from "../apps/server/worker.js";

const args = process.argv.slice(2);
const enqueueOnly = args.includes("--enqueue-only");
const positional = args.filter((arg) => arg !== "--enqueue-only");
const cityId = positional[0];
if (positional.length !== 1 || args.some((arg) => arg.startsWith("-") && arg !== "--enqueue-only")) {
  console.error("Usage: node scripts/bake-city-artifacts.mjs [--enqueue-only] <city-id>");
  console.error("Default: enqueue and process this city's bake jobs in this process.");
  console.error("--enqueue-only: leave jobs for the常驻 render worker; do not process any outbox job.");
  process.exitCode = 2;
} else {
  const config = loadConfig();
  if (!config.bakedArtifactRoot) {
    console.error("MAGICTOWN_BAKED_ARTIFACT_ROOT is required");
    process.exitCode = 2;
  } else {
    const database = createDatabase(config.databaseUrl);
    try {
      await migrateDatabase(database);
      const repository = createRepository(database, config);
      const summary = await enqueueCityRenderArtifactBackfill({ repository, cityId });
      if (!enqueueOnly && summary.artifactIds.length) {
        const worker = createWorker({
          repository,
          config,
          onlyRenderArtifactIds: summary.artifactIds
        });
        summary.processed = 0;
        while (await worker.processNext()) summary.processed += 1;
      }
      delete summary.artifactIds;
      summary.mode = enqueueOnly ? "enqueue-only" : "inline-worker";
      console.log(JSON.stringify(summary));
    } finally {
      await database.close();
    }
  }
}
