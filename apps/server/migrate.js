import { loadConfig } from "./config.js";
import { createDatabase, migrateDatabase } from "./database.js";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
try {
  await migrateDatabase(database);
  console.log("MagicTown database migrations complete.");
} finally {
  await database.close();
}
