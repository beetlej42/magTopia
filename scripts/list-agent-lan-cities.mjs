import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const storagePath = path.resolve(process.env.MAGICTOWN_STATE_PATH ?? ".magictown/agent-lan-state.json");
const infoPath = path.resolve(process.env.MAGICTOWN_INFO_PATH ?? ".magictown/agent-lan-info.json");
if (!existsSync(storagePath)) throw new Error(`Agent LAN state not found: ${storagePath}`);
const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : {};
const publicBaseUrl = process.env.MAGICTOWN_PUBLIC_BASE_URL ?? info.public_base_url ?? "http://127.0.0.1:4183";
const repository = createMemoryRepository({ publicBaseUrl }, { storagePath });
const cities = repository.listLocalCityAccess().map((city) => ({
  ...city,
  viewer_url: city.access_token
    ? `${publicBaseUrl}/cities/${encodeURIComponent(city.id)}?view=1#token=${encodeURIComponent(city.access_token)}`
    : null
}));

console.log(JSON.stringify({ count: cities.length, latest: cities.at(-1) ?? null, cities }, null, 2));
