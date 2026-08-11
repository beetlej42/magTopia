import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, migrateDatabase } from "./database.js";
import { createRepository } from "./repository.js";
import { createWorker } from "./worker.js";
import { installPlayerSessions } from "./player-session.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
if (config.autoMigrate) await migrateDatabase(database);
const repository = createRepository(database, config);
await repository.seedBuiltinAssets();
const app = await createApp({ repository, config, logger: true });
installPlayerSessions({ app, repository, config });
const worker = createWorker({ repository, config });

await app.listen({ host: config.host, port: config.port });
worker.run().catch((error) => app.log.error(error));

async function shutdown(signal) {
  app.log.info({ signal }, "Shutting down MAGTOPIA");
  worker.stop();
  await app.close();
  await database.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
