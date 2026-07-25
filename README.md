# MagicTown

MagicTown is a shared city-building simulation: a player establishes direction
and an Agent develops the city over time. The current playable foundation is
`magic-london-terrain-001`, a clean SimCity-like terrain foundation: 50 × 50
logical parcels projected onto a continuous, subdivided isometric riverfront.

The visual target is **soft isometric low-poly urban diorama**: warm magical
London street life, readable roofs and sidewalls, faceted water and greenery,
and a city that looks like a coherent miniature model rather than a cinematic
render or pixel-art sprite sheet.

- Product and system direction: [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)
- Agent network service architecture: [docs/AGENT_CITY_SERVICE.md](docs/AGENT_CITY_SERVICE.md)
- Visual north star: [docs/VISUAL_TARGET.md](docs/VISUAL_TARGET.md)
- Art, camera, palette, and asset contract: [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md)
- Experimental procedural voxel vertical slice: [docs/VOXEL_BUILDING_SPIKE.md](docs/VOXEL_BUILDING_SPIKE.md)
- Voxel `BuildingSpec v0.1`: [docs/VOXEL_BUILDING_SPEC_V0.1.md](docs/VOXEL_BUILDING_SPEC_V0.1.md)

## Run

```bash
pnpm install
pnpm run dev
```

If the local shell cannot find Node, use the bundled runtime:

```bash
PATH=/Users/jialinrui/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm run dev
```

## Agent city service

The Phase 0–3 network service is implemented as a Fastify modular monolith backed by PostgreSQL. It exposes private per-player city saves, one-time Agent connection links, bounded spatial/building queries, idempotent construction and road commands, output-based budget recovery, and asynchronous asset orders.

```bash
cp .env.example .env
createdb magictown
pnpm run db:migrate
pnpm run server
```

Open `http://127.0.0.1:4183/` for the Agent discovery page, or `/dashboard` for the city/order status panel. Machine-readable entry points are:

- `/.well-known/magictown-agent.json`
- `/agent/playbook.md`
- `/openapi.json`

Asset production chooses one of two providers:

- `qwen-image`: calls Alibaba Cloud Model Studio's native DashScope multimodal-generation endpoint with `qwen-image-2.0`, immediately downloads the temporary result, then derives RGB, mask, depth, and normal maps before publishing the asset;
- `codex-manual`: publishes the constrained prompt on the asset job and waits for a Codex/ChatGPT-generated PNG through the artifact endpoint.

Set `DASHSCOPE_API_KEY` to enable automatic generation. `DASHSCOPE_BASE_URL` defaults to `https://dashscope.aliyuncs.com/api/v1` and can be replaced with the workspace-specific Beijing or Singapore endpoint assigned by Alibaba Cloud. The manual provider remains the automatic fallback when no DashScope key is configured.

Run PostgreSQL integration coverage with an isolated test database:

```bash
MAGICTOWN_TEST_DATABASE_URL=postgres://localhost:5432/magictown_test pnpm test
```

## Magic London Development Terrain

Every valid grid cell can later hold a road, building, or district reservation.
Each logical parcel is subdivided into 4 × 4 terrain cells for smooth curvature
and waterbanks. The current starter scene keeps only a paved civic node and
pocket parks as pre-existing civic land. Roads are intentionally not pre-seeded:
the starter buildings are placed first, then explicit house-to-house
`connectRoad` events ask the city solver to generate the visible internal roads
and bridges from CityState on each map seed. Everything
conforms to the same continuous height field rather than replacing the terrain.

```js
MagicTown.generateDevelopmentMap({
  developmentColumns: 50,
  developmentRows: 50,
  mapCurvature: 0.075,
  showGrid: 1,
  trainSpeed: 0.3
});

MagicTown.getWorldContract();
MagicTown.setGridVisible(true); // show the 50 × 50 build grid
MagicTown.generateDevelopmentMap({ perspective: 0.35 }); // 0 = orthographic, 1 = strongest perspective
MagicTown.setCameraMode("play"); // edge-pan isometric gameplay camera
MagicTown.setCameraMode("free"); // rotate/zoom debug camera
MagicTown.generateDevelopmentMap({ nightLighting: 1, sunTime: 0 }); // inspect functional dusk lighting
MagicTown.getBaseTileContract(); // ports, families, and lighting rules for infrastructure tiles
```

The base-tile kit uses road lamps, flush plaza lights, and river-edge lights.
They emit warm gold only for navigation and civic activity; their visible glow
and point-light strength rise at dusk or with `nightLighting`, while magic
colours remain reserved for later interactive places.

## Procedural voxel building spike

The optional `Procedural Voxel Street` mode validates a high-resolution voxel
building grammar alongside the existing low-poly and depth-relief paths. One
four-unit parcel is 32 voxels wide (`0.125` world unit per voxel). The demo
supports one to three automatically joined terrace buildings, two to five base
floors, vertical expansion, three roof families, material schemes, decoration
density, and functional day/night emissive lighting.

```js
MagicTown.generateVoxelStreet({
  buildingCount: 3,
  floors: 3,
  expansionFloors: 1,
  archetype: "magic_shop",
  style: "violet_alchemist",
  parcelWidth: 36,
  parcelDepth: 40,
  roofType: "magic_asymmetric",
  variation: 0.82,
  nightLighting: 0.3
});

MagicTown.getVoxelBuildingContract();
MagicTown.getVoxelGrammarCatalog();
MagicTown.createVoxelBuildingSpec({
  id: "agent-shop-1",
  seed: "agent-shop-seed",
  archetype: "magic_shop",
  style: "violet_alchemist",
  widthVoxels: 36,
  depthVoxels: 40,
  baseFloors: 3
});
```

The deterministic `BuildingSpec v0.1 + seed` remains the source of truth. Three
archetypes and three style kits compile into stable facade bays, openings,
adaptive roofs, chimneys, balconies, flower boxes, and window-bound magic
effects. Components write into one mutually-exclusive sparse voxel field;
semantic write phases protect later details while equal-priority conflicts use
last-write-wins. Hidden interior voxels are culled and visible cells are batched
by material. Party-wall exposure is derived from both neighbouring roof
envelopes. The production target remains a chunked greedy surface mesh rather
than one draw call per voxel.

## City workbench API

The city core is stateful but renderer-independent: an Agent can inspect valid
parcels, author a complete building proposal, ask the solver for road/bridge
costs, then submit an atomic construction event. The Agent owns the creative
brief; the runtime appends the non-negotiable parcel, camera, and output
contract to the asset prompt.

```js
const lots = MagicTown.findCandidateParcels({
  footprint: "1x2",
  near: ["riverfront"],
  limit: 12
});

const proposal = {
  actor: "agent:willow",
  site: { lotId: lots[0].lotId, footprint: "1x2", entrance: "south" },
  program: {
    archetype: "wand_shop",
    purpose: "visitor_service",
    name: "暮影魔杖铺",
    description: "一间在河岸晚灯中营业的魔杖店。",
    attributes: { visitorAppeal: 4, nightActivity: 3 }
  },
  design: {
    districtStyle: "willow_magic",
    patterns: ["crooked_shop_roof", "warm_lantern_rhythm"],
    prompt: "A narrow magical London wand shop with a crooked slate roof and warm violet window light."
  },
  connectionRequest: { to: "old_town_entry", mode: "road" }
};

MagicTown.previewConstruction(proposal); // footprint, route, bridge, cost, resources-after
MagicTown.submitConstruction(proposal);  // accepted result or rejected preflight
MagicTown.connectRoad({ fromBuildingId: "building-1", toBuildingId: "building-2" });
MagicTown.getCityState();
MagicTown.resetCity({ resources: { coins: 800, timber: 180, stone: 160 } });
```

`old_town_entry` is the initial protected external gateway. It cannot be built
over and gives the first road connection a deterministic destination.

## Isometric Asset Relief

Buildings are produced as constrained, soft low-poly isometric renders, then
processed into color, mask, Depth Anything depth, and normal maps. Three.js
uses those maps for limited-angle relief/parallax and lighting; it does not
pretend that a generated image is a free-orbit 3D model.

```js
MagicTown.generateIsometricAsset({
  parallaxStrength: 0.16,
  parallaxViewX: 0,
  parallaxViewY: 0,
  viewYaw: 0
});
```

`MagicTown.previewParcel()` exposes the footprint, camera, safe margin, and
prompt contract that every future asset must obey.

## Parcel guideplates

Use a program-generated guideplate as the image model's control image. The
dimension contract is explicit world-unit `length × width × height`; grid
footprint remains a separate placement contract.

```bash
.venv/bin/python scripts/generate_parcel_guide.py \
  --dimensions 4x8x8.2 \
  --entrance south \
  --out public/generated/guides/shop-4x8x8.2.png
```

The guideplate keeps the base, grid, safe margin, entrance, and max-height
envelope stable. The image model should replace only its translucent blue
envelope. Its JSON also records the three visible base-corner UV anchors. The
asset slicer copies those anchors into each new `asset.json`, so Isometric Play
can fit the base to curved or perspective-projected ground without inspecting
the image every frame. `MagicTown.getParcelGuideSpec()` returns the same
contract and a ready-to-run command for the active parcel configuration.

## Hunyuan3D LowPoly assets

Put a Hunyuan3D API key in `.env`, either as the only non-empty line or as
`HUNYUAN3D_API_KEY=<key>`. Submit a local PNG/JPEG/WebP to Hunyuan3D 3.0 in
LowPoly triangle mode, wait for completion, and download every returned model:

```bash
pnpm hunyuan3d generate <image> --out public/generated/hunyuan3d/<asset-name>
```

The output directory contains `submission.json`, `result.json`, model archives,
and service-generated preview images. Each downloaded GLB also gets a
`-1024-webp.glb` runtime copy whose embedded textures are resized to 1024 px and
encoded as required `EXT_texture_webp` textures. The script never stores the API
key or the Base64 input image in its metadata.
