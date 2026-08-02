import os from "node:os";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const host = process.env.MAGICTOWN_HOST ?? "0.0.0.0";
const port = Number(process.env.MAGICTOWN_PORT ?? 4183);
const advertisedHost = process.env.MAGICTOWN_PUBLIC_HOST ?? findLanAddress() ?? "127.0.0.1";
const publicBaseUrl = process.env.MAGICTOWN_PUBLIC_BASE_URL ?? `http://${advertisedHost}:${port}`;
const unlimited = Number.MAX_SAFE_INTEGER;
const config = {
  publicBaseUrl,
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  assetProvider: "codex-manual"
};
const repository = createMemoryRepository(config);
const player = await repository.createPlayer("External Agent Test Owner");
const principal = await repository.authenticate(player.access_token);
const city = await repository.createCity(principal, {
  name: "External Agent Blank Voxel City",
  map_seed: process.env.MAGICTOWN_SEED ?? "external-agent-black-box-v1",
  resources: { coins: unlimited, timber: unlimited, stone: unlimited }
});
const link = await repository.createCapability(principal, city.id, {
  scopes: ["city:read", "city:build", "city:connect", "asset:request"]
});
const app = await createApp({ repository, config, logger: false });
await app.listen({ host, port });
const viewerUrl = `${publicBaseUrl}/cities/${encodeURIComponent(city.id)}?view=1#token=${encodeURIComponent(player.access_token)}`;
console.log(JSON.stringify({
  ready: true,
  public_base_url: publicBaseUrl,
  connect_url: link.connect_url,
  viewer_url: viewerUrl,
  city_id: city.id,
  resource_mode: "unlimited-safe-integer",
  initial_resources: city.resources,
  render_profile: "spherical-voxel-bokeh-no-ui"
}));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

function findLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254.")) return entry.address;
    }
  }
  return null;
}
