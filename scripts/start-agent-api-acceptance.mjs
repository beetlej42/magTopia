import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const host = process.env.MAGICTOWN_HOST ?? "0.0.0.0";
const port = Number(process.env.MAGICTOWN_PORT ?? 4183);
const advertisedHost = process.env.MAGICTOWN_PUBLIC_HOST ?? findLanAddress() ?? "127.0.0.1";
const publicBaseUrl = process.env.MAGICTOWN_PUBLIC_BASE_URL ?? `http://${advertisedHost}:${port}`;
const storagePath = path.resolve(process.env.MAGICTOWN_STATE_PATH ?? ".magictown/agent-lan-state.json");
const infoPath = path.resolve(process.env.MAGICTOWN_INFO_PATH ?? ".magictown/agent-lan-info.json");
const unlimited = Number.MAX_SAFE_INTEGER;
const config = {
  publicBaseUrl,
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  assetProvider: "codex-manual"
};
const repository = createMemoryRepository(config, { storagePath });
const bootstrap = await repository.ensureSandbox({
  displayName: "External Agent Test Owner",
  cityInput: {
    name: "External Agent Blank Voxel City",
    map_seed: process.env.MAGICTOWN_SEED ?? "external-agent-black-box-v1",
    resources: { coins: unlimited, timber: unlimited, stone: unlimited }
  },
  scopes: ["city:read", "city:build", "city:connect", "asset:request"]
});
const app = await createApp({ repository, config, logger: false });
await app.listen({ host, port });
const viewerUrl = `${publicBaseUrl}/cities/${encodeURIComponent(bootstrap.city.id)}?view=1#token=${encodeURIComponent(bootstrap.player.access_token)}`;
const readyInfo = {
  ready: true,
  public_base_url: publicBaseUrl,
  connect_url: bootstrap.link.connect_url,
  viewer_url: viewerUrl,
  city_id: bootstrap.city.id,
  resource_mode: "unlimited-safe-integer",
  initial_resources: bootstrap.city.resources,
  render_profile: "spherical-voxel-bokeh-no-ui",
  persistence: { enabled: true, state_path: storagePath }
};
mkdirSync(path.dirname(infoPath), { recursive: true });
writeFileSync(infoPath, `${JSON.stringify(readyInfo, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(readyInfo));

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
