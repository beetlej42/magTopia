const PACK_ROOT = "/generated/magic-london-starter-001";

// The starter assets were all produced from this immutable guideplate. The
// three visible base corners are a production contract: runtime placement maps
// these UVs directly onto the three corresponding parcel corners.
const STARTER_GUIDEPLATE = Object.freeze({
  path: `${PACK_ROOT}/guide-4x4x4.png`,
  dimensions: { length: 4, width: 4, height: 4, unit: "world" },
  gridUnit: 4,
  safeMargin: 0.32,
  baseProjectionWidth: 0.5466666666666667,
  baseAnchorsUv: {
    left: [0.22666666666666663, 0.35632478632478637],
    near: [0.5, 0.2301709401709402],
    right: [0.7733333333333334, 0.35632478632478637]
  },
  baseAnchorContract: "guideplate-visible-triangle-v1",
  camera: { yaw: 45, elevation: 55, roll: 0, projection: "orthographic" }
});

// These first three image-model outputs predate strict guideplate validation
// and moved a few base pixels. They are calibrated once here; newly generated
// assets should omit this override and inherit the canonical guideplate UVs.
const LEGACY_BASE_ANCHORS_UV = Object.freeze({
  "starter-cottage-001": {
    left: [0.22966507177033493, 0.35167464114832536],
    near: [0.5279106858054227, 0.18580542264752786],
    right: [0.7950558213716108, 0.354066985645933]
  },
  "starter-workshop-001": {
    left: [0.22807017543859648, 0.35566188197767146],
    near: [0.5087719298245614, 0.21690590111642738],
    right: [0.7767145135566188, 0.35725677830940994]
  },
  "starter-herbalist-001": {
    left: [0.22807017543859648, 0.35566188197767146],
    near: [0.5, 0.22886762360446567],
    right: [0.7719298245614035, 0.35566188197767146]
  }
});

const HUNYUAN_MODELS = Object.freeze({
  "starter-cottage-001": {
    glb: "/generated/hunyuan3d/starter-cottage-lowpoly-3.0/glb-2-1024-webp.glb",
    source: "hunyuan3d-3.0-lowpoly",
    maxTextureSize: 1024,
    textureFormat: "webp",
    footprintFill: 0.9,
    orientationMode: "auto-rgb-four-way",
    rotationY: 0
  },
  "starter-workshop-001": {
    glb: "/generated/hunyuan3d/starter-workshop-lowpoly-3.0/glb-2-1024-webp.glb",
    source: "hunyuan3d-3.0-lowpoly",
    maxTextureSize: 1024,
    textureFormat: "webp",
    footprintFill: 0.9,
    orientationMode: "auto-rgb-four-way",
    rotationY: 90
  },
  "starter-herbalist-001": {
    glb: "/generated/hunyuan3d/starter-herbalist-lowpoly-3.0/glb-2-1024-webp.glb",
    source: "hunyuan3d-3.0-lowpoly",
    maxTextureSize: 1024,
    textureFormat: "webp",
    footprintFill: 0.9,
    orientationMode: "auto-rgb-four-way",
    rotationY: 90
  }
});

// depth-anything-linear.png stores fitted view-space depth in an 8-bit range.
// Keeping that compact decode contract beside the runtime registry lets the
// city renderer build a rigid local depth mesh without fetching calibration
// metadata or fitting anything per frame.
const DEPTH_ENCODINGS = Object.freeze({
  "starter-cottage-001": { minimumViewDepth: -2.753691722946145, maximumViewDepth: 5.2708627466158315 },
  "starter-workshop-001": { minimumViewDepth: -3.318490954004776, maximumViewDepth: 5.155377823631672 },
  "starter-herbalist-001": { minimumViewDepth: -3.5885533165216272, maximumViewDepth: 5.45126169003588 }
});

const WALLS_GROUND_DEPTH_ENCODINGS = Object.freeze({
  "starter-cottage-001": { minimumViewDepth: -1.4697715153934356, maximumViewDepth: 4.703402394502448 },
  "starter-workshop-001": { minimumViewDepth: -2.723857275291377, maximumViewDepth: 4.4535401745677925 },
  "starter-herbalist-001": { minimumViewDepth: -1.8258715129378587, maximumViewDepth: 4.511480286732524 }
});

const METRIC_INDOOR_SMALL_DEPTH_ENCODINGS = Object.freeze({
  "starter-cottage-001": { minimumViewDepth: -1.7410850524902344, maximumViewDepth: 3.2062697410583496 },
  "starter-workshop-001": { minimumViewDepth: -2.9797163009643555, maximumViewDepth: 3.668644905090332 },
  "starter-herbalist-001": { minimumViewDepth: -3.115739345550537, maximumViewDepth: 2.6028542518615723 }
});

const ASSETS = [
  ["starter-cottage-001", "starter_residence", "1x1", ["starter", "residential"]],
  ["starter-workshop-001", "starter_workshop", "1x1", ["starter", "service"]],
  ["starter-herbalist-001", "starter_herbalist", "1x1", ["starter", "residential", "magic"]]
].map(([assetId, archetype, footprint, tags]) => ({
  assetId,
  archetype,
  footprint,
  tags,
  guideplate: STARTER_GUIDEPLATE,
  baseAnchorsUv: LEGACY_BASE_ANCHORS_UV[assetId] ?? STARTER_GUIDEPLATE.baseAnchorsUv,
  baseAnchorSource: LEGACY_BASE_ANCHORS_UV[assetId] ? "legacy-offline-calibration" : "guideplate",
  dimensions: STARTER_GUIDEPLATE.dimensions,
  depthEncoding: {
    kind: "global-linear-quantile-fit-v1",
    bits: 8,
    ...DEPTH_ENCODINGS[assetId]
  },
  depthVariants: {
    all: {
      fitSurfaces: "all",
      depth: `${PACK_ROOT}/${assetId}/depth-anything-linear.png`,
      normal: `${PACK_ROOT}/${assetId}/normal-depth-anything-linear.png`,
      depthEncoding: { kind: "global-linear-quantile-fit-v1", bits: 8, ...DEPTH_ENCODINGS[assetId] }
    },
    "walls-ground": {
      fitSurfaces: "walls-ground",
      depth: `${PACK_ROOT}/${assetId}/depth-anything-linear-walls-ground.png`,
      normal: `${PACK_ROOT}/${assetId}/normal-depth-anything-linear-walls-ground.png`,
      depthEncoding: { kind: "global-linear-quantile-fit-v1", bits: 8, ...WALLS_GROUND_DEPTH_ENCODINGS[assetId] }
    },
    "metric-indoor-small": {
      fitSurfaces: "metric-indoor-small",
      depth: `${PACK_ROOT}/${assetId}/depth-metric-indoor-small.png`,
      normal: `${PACK_ROOT}/${assetId}/normal-metric-indoor-small.png`,
      depthEncoding: { kind: "metric-depth-view-translation-v1", bits: 8, ...METRIC_INDOOR_SMALL_DEPTH_ENCODINGS[assetId] }
    }
  },
  manifestPath: `${PACK_ROOT}/${assetId}/asset.json`,
  maps: {
    rgb: `${PACK_ROOT}/${assetId}/rgb.png`,
    mask: `${PACK_ROOT}/${assetId}/mask.png`,
    emissive: `${PACK_ROOT}/${assetId}/emissive.png`,
    depth: `${PACK_ROOT}/${assetId}/depth-anything-linear.png`,
    normal: `${PACK_ROOT}/${assetId}/normal-depth-anything-linear.png`
  },
  model: HUNYUAN_MODELS[assetId] ?? null
}));

export function getAssetRegistry() {
  return structuredClone(ASSETS);
}

export function mergeAssetRegistry(runtimeDefinitions = []) {
  const assets = new Map(ASSETS.map((asset) => [asset.assetId, asset]));
  for (const definition of Array.isArray(runtimeDefinitions) ? runtimeDefinitions : []) {
    const manifest = definition?.manifest ?? definition;
    const assetId = definition?.id ?? definition?.assetId ?? manifest?.assetId;
    if (!assetId || !manifest?.maps?.rgb || !manifest?.maps?.depth || !manifest?.maps?.normal) continue;
    assets.set(assetId, {
      ...manifest,
      assetId,
      archetype: definition?.archetype ?? manifest.archetype,
      footprint: definition?.footprint ?? manifest.footprint,
      tags: definition?.tags ?? manifest.tags ?? [],
      source: definition?.source ?? manifest.source,
      ownerPlayerId: definition?.owner_player_id ?? manifest.ownerPlayerId ?? null
    });
  }
  return structuredClone([...assets.values()]);
}

export function findAssetCandidates(criteria = {}) {
  const requiredTags = new Set(criteria.tags ?? []);
  return ASSETS.filter((asset) => {
    if (criteria.footprint && asset.footprint !== criteria.footprint) return false;
    if (criteria.archetype && asset.archetype !== criteria.archetype) return false;
    return [...requiredTags].every((tag) => asset.tags.includes(tag));
  }).map((asset) => structuredClone(asset));
}

export function resolveAsset(assetId) {
  const asset = ASSETS.find((entry) => entry.assetId === assetId);
  return asset ? structuredClone(asset) : null;
}
