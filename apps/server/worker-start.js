import { loadConfig } from "./config.js";
import { createDatabase, migrateDatabase } from "./database.js";
import { createRepository } from "./repository.js";
import { createWorker } from "./worker.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
if (config.autoMigrate) await migrateDatabase(database);
const repository = createRepository(database, config);
await createWorker({ repository, config }).run();
