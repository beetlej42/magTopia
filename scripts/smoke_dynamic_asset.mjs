const baseUrl = String(process.env.MAGICTOWN_SMOKE_BASE_URL ?? "http://127.0.0.1:4183").replace(/\/+$/, "");
const deadlineMs = Number(process.env.MAGICTOWN_SMOKE_TIMEOUT_MS ?? 360_000);
const startedAt = Date.now();

async function request(path, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function assertBeforeDeadline() {
  if (Date.now() - startedAt > deadlineMs) throw new Error(`Dynamic asset smoke test exceeded ${deadlineMs}ms`);
}

async function exchange(link) {
  return request(new URL(link.connect_url).pathname);
}

const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const player = await request("/api/v1/players", {
  method: "POST",
  body: { display_name: `Dynamic Asset QA ${suffix}` }
});
const city = await request("/api/v1/cities", {
  token: player.access_token,
  method: "POST",
  body: { name: `月光资产验收城 ${suffix}`, map_seed: `dynamic-asset-${suffix}` }
});
const builderLink = await request(`/api/v1/cities/${city.id}/agent-links`, {
  token: player.access_token,
  method: "POST",
  body: { scopes: ["city:read", "city:build", "city:connect", "asset:request"] }
});
const builder = await exchange(builderLink);
const snapshot = await request(`/api/v1/cities/${city.id}/snapshot`, { token: builder.access_token });
const sites = await request(`/api/v1/cities/${city.id}/site-searches`, {
  token: builder.access_token,
  method: "POST",
  body: { footprint: "1x1", limit: 12 }
});
const site = sites.data[0];
if (!site) throw new Error("Site search returned no buildable 1x1 parcel");

const construction = {
  expected_city_version: snapshot.city_version,
  actor_note: "端到端验证 Agent 可生产并显示一个严格 1x1x1 的 Hunyuan 建筑资产",
  site: {
    lot_id: site.lotId,
    footprint: "1x1",
    entrance: site.entranceDirections?.[0] ?? "south"
  },
  program: {
    archetype: "gaslamp_repair_shop",
    purpose: "commercial",
    name: "夜巡煤气灯维修铺",
    attributes: { coinOutput: 7 }
  },
  design: {
    district_style: "willow_magic",
    patterns: ["victorian_shopfront", "restrained_magic"],
    creative_brief: "一栋严格只有一层、位于维多利亚伦敦后巷的小型煤气灯维修铺；一扇正门、两扇工坊窗、一根短烟囱和一个无文字的简化黄铜提灯形悬挂标志。不得有二层、阁楼、老虎窗或塔楼。"
  },
  asset: {
    mode: "produce",
    spec: {
      archetype: "gaslamp_repair_shop",
      footprint: "1x1",
      district_style: "willow_magic",
      patterns: ["victorian_shopfront", "restrained_magic"],
      guide_volume: "1x1x1",
      creative_brief: "一栋严格只有一层、位于维多利亚伦敦后巷的小型煤气灯维修铺；一扇正门、两扇工坊窗、一根短烟囱和一个无文字的简化黄铜提灯形悬挂标志。不得有二层、阁楼、老虎窗或塔楼。"
    }
  }
};

const preview = await request(`/api/v1/cities/${city.id}/construction-previews`, {
  token: builder.access_token,
  method: "POST",
  body: construction
});
if (!preview.feasible) throw new Error(`Construction preview was not feasible: ${JSON.stringify(preview)}`);

const order = await request(`/api/v1/cities/${city.id}/construction-orders`, {
  token: builder.access_token,
  method: "POST",
  headers: { "idempotency-key": `dynamic-asset-smoke-${suffix}` },
  body: construction
});
if (!order.resource?.asset_job_id) throw new Error(`Production order did not return an asset job: ${JSON.stringify(order)}`);

let job;
do {
  assertBeforeDeadline();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  job = await request(`/api/v1/asset-jobs/${order.resource.asset_job_id}`, { token: builder.access_token });
  if (job.status === "failed") throw new Error(`Asset production failed: ${JSON.stringify(job.error)}`);
} while (job.status !== "completed");

const renderState = await request(`/api/v1/cities/${city.id}/render-state`, { token: builder.access_token });
const assetId = job.output?.asset_id;
const asset = renderState.assets?.find((entry) => entry.id === assetId);
const building = Object.values(renderState.state.buildings ?? {}).find((entry) => entry.assetId === assetId);
if (!asset || !building) throw new Error("Completed asset or its building was missing from render-state");
for (const mapName of ["rgb", "depth", "normal", "mask", "emissive"]) {
  if (!asset.manifest?.maps?.[mapName]) throw new Error(`Dynamic asset manifest is missing ${mapName}`);
  const mapResponse = await fetch(`${baseUrl}${asset.manifest.maps[mapName]}`);
  if (!mapResponse.ok) throw new Error(`Dynamic asset ${mapName} returned ${mapResponse.status}`);
}

const viewerLink = await request(`/api/v1/cities/${city.id}/agent-links`, {
  token: player.access_token,
  method: "POST",
  body: { scopes: ["city:read"] }
});
const viewer = await exchange(viewerLink);

console.log(JSON.stringify({
  status: "completed",
  city_id: city.id,
  order_id: order.resource.id,
  asset_job_id: job.id,
  asset_id: assetId,
  building_id: building.id,
  asset_maps: Object.keys(asset.manifest.maps),
  viewer_url: `${baseUrl}/cities/${city.id}#token=${viewer.access_token}`
}, null, 2));
