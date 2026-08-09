# MAGTOPIA（麦托邦）

MAGTOPIA is an AI Agent-driven magic city: a player sets direction through
natural language, and an Agent with its own identity, personality, memory, and
architectural taste develops a living city over time. The current playable foundation is
`magic-london-terrain-001`, a clean SimCity-like terrain foundation: 50 × 50
logical parcels projected onto a continuous, subdivided isometric riverfront.

The visual target is **soft isometric low-poly urban diorama**: warm magical
London street life, readable roofs and sidewalls, faceted water and greenery,
and a city that looks like a coherent miniature model rather than a cinematic
render or pixel-art sprite sheet.

- Product and system direction: [docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)
- Core gameplay design: [docs/CORE_GAMEPLAY_DESIGN.md](docs/CORE_GAMEPLAY_DESIGN.md)
- Agent network service architecture: [docs/AGENT_CITY_SERVICE.md](docs/AGENT_CITY_SERVICE.md)
- Visual north star: [docs/VISUAL_TARGET.md](docs/VISUAL_TARGET.md)
- Art, camera, palette, and asset contract: [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md)
- Player UI visual and interaction framework: [docs/UI_DIRECTION.md](docs/UI_DIRECTION.md)
- Experimental procedural voxel vertical slice: [docs/VOXEL_BUILDING_SPIKE.md](docs/VOXEL_BUILDING_SPIKE.md)
- Voxel `BuildingSpec v0.2`: [docs/VOXEL_BUILDING_SPEC_V0.2.md](docs/VOXEL_BUILDING_SPEC_V0.2.md)
- General voxel `UrbanMassingSpec v0.1`: [docs/VOXEL_MASSING_SPEC_V0.1.md](docs/VOXEL_MASSING_SPEC_V0.1.md)
- Unified two-stage Agent building design and upgrade API: [docs/BUILDING_DESIGN_API_V1.md](docs/BUILDING_DESIGN_API_V1.md)

## Run

```bash
pnpm install
pnpm run dev
```

If the local shell cannot find Node, add your Node.js installation to `PATH`
before running the commands above.

## Agent city service

The Phase 0–3 network service is implemented as a Fastify modular monolith backed by PostgreSQL. It exposes private per-player city saves, one-time Agent connection links, bounded spatial/building queries, idempotent construction and road commands, output-based budget recovery, and asynchronous asset orders.

```bash
cp .env.example .env
createdb magictown
pnpm run db:migrate
pnpm run server
```

Open `http://127.0.0.1:4183/` for the Agent discovery page, or `/dashboard` for the city/order status panel. Machine-readable entry points are:

- `/.well-known/magtopia-agent.json`
- `/agent/playbook.md`
- `/openapi.json`

Asset production chooses one of three providers:

- `hunyuan-image` (production default): submits a geometry guide plus the Magic London style concept to `hy-image-v3.0`, generates a daylight lights-off base, performs a second structure-locked lights-on edit, then derives an aligned additive emissive map before publishing RGB, mask, depth, normal, and night-light assets;
- `qwen-image`: retained as a legacy/fallback DashScope provider;
- `codex-manual`: publishes the constrained prompt on the asset job and waits for a Codex/ChatGPT-generated PNG through the artifact endpoint.

Set `HUNYUAN_IMAGE_API_KEY` (or `TENCENT_TOKENHUB_API_KEY`) and `MAGICTOWN_ASSET_PROVIDER=hunyuan-image` to enable production generation. The Hunyuan path is portable across macOS and Linux: it does not use Apple Vision or `xcrun`; paired-light extraction uses Python, NumPy, Pillow, and SciPy from `requirements-assets.txt`. Set `HUNYUAN_PYTHON_PATH` when the server's virtual environment is not `.venv`. Qwen remains available when `DASHSCOPE_API_KEY` is configured, and `codex-manual` remains the no-key fallback.

Run PostgreSQL integration coverage with an isolated test database:

```bash
MAGICTOWN_TEST_DATABASE_URL=postgres://localhost:5432/magictown_test pnpm test
```

For a LAN-accessible Agent construction sandbox, first build the viewer and
then start the persistent acceptance service. It listens on all local
interfaces, advertises the detected LAN IPv4 address, seeds each resource at
JavaScript's maximum safe integer, and prints both a one-time Agent connection
URL and a spherical voxel viewer URL with Bokeh depth of field and no UI:

```bash
pnpm run build
pnpm run agent:lan
```

The LAN sandbox persists all players, credentials, cities, designs, orders,
idempotency receipts, and city state in `.magictown/agent-lan-state.json` using
atomic file replacement. Restarting `agent:lan` reopens the same bootstrap city
and writes the current connection metadata to `.magictown/agent-lan-info.json`.

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
MAGTOPIA.generateDevelopmentMap({
  developmentColumns: 50,
  developmentRows: 50,
  mapCurvature: 0.075,
  showGrid: 1,
  trainSpeed: 0.3
});

MAGTOPIA.getWorldContract();
MAGTOPIA.setGridVisible(true); // show the 50 × 50 build grid
MAGTOPIA.generateDevelopmentMap({ perspective: 0.35 }); // 0 = orthographic, 1 = strongest perspective
MAGTOPIA.setCameraMode("play"); // edge-pan isometric gameplay camera
MAGTOPIA.setCameraMode("free"); // rotate/zoom debug camera
MAGTOPIA.generateDevelopmentMap({ nightLighting: 1, sunTime: 0 }); // inspect functional dusk lighting
MAGTOPIA.getBaseTileContract(); // ports, families, and lighting rules for infrastructure tiles
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
floors, vertical expansion, three roof forms, material schemes, decoration
density, and functional day/night emissive lighting.

The `Grammar · Semantic Shop Signs` preset adds three Agent-authored 4×4
street emblems for potion, broom, and wand shops. The logical grid renders as
micro-voxels fixed at half the building voxel size, and signs project sideways
from lintel-safe entrance-side anchors by default. Existing frame, board, and
emissive material IDs are reused; no purpose-specific prop model is required.

```js
MAGTOPIA.generateVoxelStreet({
  buildingCount: 3,
  floors: 2,
  floorPrograms: [
    { purpose: "shop", windowRatio: 0.86 },
    { purpose: "home", windowRatio: 0.32, setbackVoxels: 4, balcony: "full" }
  ],
  style: "violet_alchemist",
  parcelWidth: 36,
  parcelDepth: 40,
  cornerFacades: "both",
  roofForm: "hip",
  ridgePosition: 0.35,
  variation: 0.82,
  nightLighting: 0.3
});

MAGTOPIA.getVoxelBuildingContract();
MAGTOPIA.getVoxelGrammarCatalog();
MAGTOPIA.createVoxelBuildingSpec({
  id: "agent-shop-1",
  seed: "agent-shop-seed",
  style: "violet_alchemist",
  widthVoxels: 36,
  depthVoxels: 40,
  baseFloors: 2,
  floorPrograms: [
    { purpose: "shop", windowRatio: 0.86 },
    { purpose: "home", windowRatio: 0.32, setbackVoxels: 4, balcony: "full" }
  ],
  sideFacadeSides: ["right"],
  roofForm: "gable_cross",
  ridgePosition: 0.35
});
```

The deterministic `BuildingSpec v0.2 + seed` remains the source of truth.
Atomic floor programs independently select shop, home, workshop, or storage
uses plus window share, front setbacks, and balcony forms. Three style kits
compile the stack into stable front and optional corner-side facade bays,
scale-aware openings, a continuous pitched roof,
chimneys, flower boxes, and window-bound magic effects. Roofs use one shared
two-dimensional height-field solver and can form a street-aligned gable,
cross-aligned gable, or four-slope hip. Components write into
one mutually-exclusive sparse voxel field;
semantic write phases protect later details while equal-priority conflicts use
last-write-wins. Hidden interior voxels are culled and visible cells are batched
by material. Party-wall exposure is derived from both neighbouring roof
envelopes. The production target remains a chunked greedy surface mesh rather
than one draw call per voxel.

## General voxel massing grammar

`UrbanMassingSpec v0.1` adds the type-independent construction layer under the
existing house grammar. A composition uses an edge-connected cell mask inside
a 3 × 3 site and combines solid, framed, open, and ground masses. Each mass
independently selects its plan shape, vertical profile, standard voids, cap,
materials, and facade intent.

Relations are typed as `separate`, `adjoin`, `portal`, or `stacked`; the source
data never reduces future connection behavior to one boolean. `BuildingSpec
v0.2` automatically exposes one derived solid mass, so the existing procedural
street remains compatible.

```js
MAGTOPIA.generateVoxelMassing({
  widthCells: 2,
  depthCells: 2,
  masses: [
    {
      id: "main-hall",
      type: "solid",
      cells: [[0, 0]],
      heightVoxels: 32,
      cap: { type: "mansard", heightVoxels: 8 }
    },
    {
      id: "slender-tower",
      type: "solid",
      cells: [[0, 0]],
      placement: {
        setbacksVoxels: { north: 6, east: 6, south: 6, west: 6 }
      },
      heightVoxels: 42,
      planShape: "octagonal",
      cap: { type: "spire", heightVoxels: 22 }
    },
    {
      id: "glass-hall",
      type: "framed",
      cells: [[1, 0]],
      heightVoxels: 22,
      cap: { type: "glass_ridge", heightVoxels: 8 }
    }
  ],
  relations: [
    { type: "portal", from: "main-hall", to: "glass-hall" },
    { type: "stacked", from: "main-hall", to: "slender-tower" }
  ]
});

MAGTOPIA.getVoxelGrammarCatalog().massing;
```

Select `Voxel Massing Grammar` in Studio to open the Massing Explorer. It provides
four deterministic study modes—`Layout`, `Form`, `Detail`, and `Everything`—plus
an editable 3x3 site grid, mass-node tabs, relation controls, JSON round-tripping,
and live validation diagnostics. The regular `Random` button now generates a full
composition, while the focused Explorer buttons keep unrelated design decisions
stable for controlled comparison.

`Massing · Civic Dome` is the first concept-quality baseline. Its coordinated
classical facade order derives a continuous base course, floor strings, cornices,
corner piers, entrance pediment, roofline chimneys, dome drum, and lantern from
the same massing spec. Complete random studies also share one palette and facade
order across their solid masses so generated buildings read as one composition.

The same workflow is available from the console:

```js
MAGTOPIA.randomizeVoxelMassing("layout", "site-study-01");
MAGTOPIA.randomizeVoxelMassing("form", "silhouette-study-01");
MAGTOPIA.randomizeVoxelMassing("detail", "facade-study-01");
MAGTOPIA.randomizeVoxelMassing("all", "option-01");
```

Framed masses default to white limestone members with a light translucent
`lightGlass` panel. `framing` independently controls bay spacing, frame width,
floor-beam spacing, and projected frame relief; the same rhythm continues over
the glass ridge. Solid masses derive door and window bays only from long,
flat principal facades; openings keep clear of chamfered and octagonal corners
and receive layered stone surrounds, deep sills, contrasting inner sashes,
mullions, transoms, fanlights, entrance steps, canopies, and emphasized paired
columns. A one-cell mass can use
`dimensionsVoxels` to stay logically 1 × 1 while occupying a slimmer physical
plan inside that cell. `placement.setbacksVoxels` supplies independent
north/east/south/west setbacks and `placement.offsetVoxels` supports
asymmetric placement.

`portal` relations derive aligned stone jambs, lintels, and thresholds on both
sides of the cut. `stacked` relations derive a child base course and a host-roof
apron so towers and drums meet their support cleanly. Ground masses expose
`plain`, `bordered`, `courtyard`, and `garden` treatments with deterministic
curbs, paving axes, and planters.

Open masses expose `enclosure.sides` independently on all four facades. Each
side accepts `auto`, `columns`, `open`, or `wall`, while column spacing, column
width, beam height, and plinth height remain numeric controls. `auto` removes
the side structure when its actual facade touches another non-ground mass.

`cornerFacades` accepts `none`, `left`, `right`, or `both`. Only exposed ends
of a terrace receive the additional facade; shared party walls remain closed.
The side facade inherits every floor's use, so a ground-floor shop continues
around the corner with shop windows while upper home floors receive residential
windows and their own stable decoration slots.

## City workbench API

The city core is stateful but renderer-independent: an Agent can inspect valid
parcels, author a complete building proposal, ask the solver for road/bridge
costs, then submit an atomic construction event. The Agent owns the creative
brief; the runtime appends the non-negotiable parcel, camera, and output
contract to the asset prompt.

```js
const lots = MAGTOPIA.findCandidateParcels({
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

MAGTOPIA.previewConstruction(proposal); // footprint, route, bridge, cost, resources-after
MAGTOPIA.submitConstruction(proposal);  // accepted result or rejected preflight
MAGTOPIA.connectRoad({ fromBuildingId: "building-1", toBuildingId: "building-2" });
MAGTOPIA.getCityState();
MAGTOPIA.resetCity({ resources: { coins: 800, timber: 180, stone: 160 } });
```

`old_town_entry` is the initial protected external gateway. It cannot be built
over and gives the first road connection a deterministic destination.

## Isometric Asset Relief

Buildings are produced as constrained, soft low-poly isometric renders, then
processed into color, mask, Depth Anything depth, and normal maps. Three.js
uses those maps for limited-angle relief/parallax and lighting; it does not
pretend that a generated image is a free-orbit 3D model.

```js
MAGTOPIA.generateIsometricAsset({
  parallaxStrength: 0.16,
  parallaxViewX: 0,
  parallaxViewY: 0,
  viewYaw: 0
});
```

`MAGTOPIA.previewParcel()` exposes the footprint, camera, safe margin, and
prompt contract that every future asset must obey.

## Parcel guideplates

Use a program-generated guideplate as the image model's control image. The
dimension contract is explicit world-unit `length × width × height`; grid
footprint remains a separate placement contract.

```bash
node scripts/python-runtime.mjs scripts/generate_parcel_guide.py \
  --dimensions 4x8x8.2 \
  --entrance south \
  --out public/generated/guides/shop-4x8x8.2.png
```

The guideplate keeps the base, grid, safe margin, entrance, and max-height
envelope stable. The image model should replace only its translucent blue
envelope. Its JSON also records the three visible base-corner UV anchors. The
asset slicer copies those anchors into each new `asset.json`, so Isometric Play
can fit the base to curved or perspective-projected ground without inspecting
the image every frame. `MAGTOPIA.getParcelGuideSpec()` returns the same
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
