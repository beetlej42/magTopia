import * as THREE from "three";
import { createMagicLondonBaseTileKit, createRoadRenderPlan, createStarterDistrictPlan, getMagicLondonBaseTileContract } from "./magicLondonBaseTiles.js";
import { createMagicLondonStarterDistrict } from "./magicLondonStarterDistrict.js";
import { createMagicLondonVegetationLayer } from "./magicLondonVegetation.js";

const ASSET_BASE = "/generated/magic-london-wand-shop-001";
const STARTER_ASSET_BASE = "/generated/magic-london-starter-001";

export const ISOMETRIC_ASSET_PRESETS = {
  londonShopDepthAnything: {
    seed: "asset-wand-shop-001",
    colorPath: `${ASSET_BASE}/rgb.png`,
    depthPath: `${ASSET_BASE}/depth-anything.png`,
    normalPath: `${ASSET_BASE}/normal-depth-anything.png`,
    maskPath: `${ASSET_BASE}/mask.png`,
    emissivePath: null,
    emissiveStrength: 1.45,
    meshResolution: 256,
    imageSmoothing: true,
    reliefStrength: 0,
    edgeRiskDistance: 8,
    edgeGradientThreshold: 0.13,
    stableSampleDistance: 36,
    stableGradientThreshold: 0.16,
    stableSearchRadius: 56,
    normalStrength: 12,
    edgeFlattenDistance: 1,
    edgeFlattenStrength: 1,
    renderStyle: "parallax",
    parallaxStrength: 0.16,
    parallaxViewX: 0,
    parallaxViewY: 0,
    parallaxEdgeErode: 1,
    parallaxMaskDilation: 4,
    debugFlatSprite: 0,
    sunTime: 0.52,
    mapTileSize: 5.9,
    mapSize: 590,
    mapTiles: 100,
    mapCurvature: 0,
    shopScale: 1,
    spriteRotationZ: 0,
    spriteTiltX: -29,
    spriteTiltY: 45,
    groundSnapRows: 3,
    assetHeightOffset: 0,
    flatReferenceOpacity: 0.55,
    viewYaw: 0
  },
  starterCottageNight: {
    seed: "starter-cottage-001",
    colorPath: `${STARTER_ASSET_BASE}/starter-cottage-001/rgb.png`,
    depthPath: `${STARTER_ASSET_BASE}/starter-cottage-001/depth-anything.png`,
    normalPath: `${STARTER_ASSET_BASE}/starter-cottage-001/normal-depth-anything.png`,
    maskPath: `${STARTER_ASSET_BASE}/starter-cottage-001/mask.png`,
    emissivePath: `${STARTER_ASSET_BASE}/starter-cottage-001/emissive.png`,
    emissiveStrength: 1.35,
    sunTime: 0.02
  },
  starterWorkshopNight: {
    seed: "starter-workshop-001",
    colorPath: `${STARTER_ASSET_BASE}/starter-workshop-001/rgb.png`,
    depthPath: `${STARTER_ASSET_BASE}/starter-workshop-001/depth-anything.png`,
    normalPath: `${STARTER_ASSET_BASE}/starter-workshop-001/normal-depth-anything.png`,
    maskPath: `${STARTER_ASSET_BASE}/starter-workshop-001/mask.png`,
    emissivePath: `${STARTER_ASSET_BASE}/starter-workshop-001/emissive.png`,
    emissiveStrength: 1.55,
    sunTime: 0.02
  },
  starterHerbalistNight: {
    seed: "starter-herbalist-001",
    colorPath: `${STARTER_ASSET_BASE}/starter-herbalist-001/rgb.png`,
    depthPath: `${STARTER_ASSET_BASE}/starter-herbalist-001/depth-anything.png`,
    normalPath: `${STARTER_ASSET_BASE}/starter-herbalist-001/normal-depth-anything.png`,
    maskPath: `${STARTER_ASSET_BASE}/starter-herbalist-001/mask.png`,
    emissivePath: `${STARTER_ASSET_BASE}/starter-herbalist-001/emissive.png`,
    emissiveStrength: 1.42,
    sunTime: 0.02
  }
};

export const ISOMETRIC_DEVELOPMENT_PRESETS = {
  magicLondonRiverfront: {
    seed: "map-82994",
    mapId: "magic-london-terrain-001",
    mapTiles: 200,
    mapTileSize: 0.72,
    mapCurvature: 0,
    perspective: 0,
    cameraMode: "play",
    developmentColumns: 50,
    developmentRows: 50,
    cellTerrainTiles: 4,
    showGrid: 0,
    showBaseTiles: 1,
    useHunyuanModels: 0,
    buildingParallaxStrength: 0.12,
    nightLighting: 0.35,
    sunTime: 0.62,
    trainSpeed: 0
  }
};

export function createRandomIsometricAssetConfig(seed = Date.now()) {
  return normalizeIsometricAssetConfig({
    ...ISOMETRIC_ASSET_PRESETS.londonShopDepthAnything,
    seed,
    viewYaw: -12 + Math.random() * 24,
    parallaxStrength: 0.11 + Math.random() * 0.12,
    parallaxViewX: -0.18 + Math.random() * 0.36,
    parallaxViewY: -0.12 + Math.random() * 0.24
  });
}

export function getDaylightStyle(sunTime = 0.52) {
  const time = clamp(sunTime, 0, 1);
  const noon = Math.sin(time * Math.PI);
  const edgeColor = new THREE.Color(time < 0.5 ? "#ffd4a1" : "#e9a7b3");
  const noonColor = new THREE.Color("#fff4dc");
  const sunColor = edgeColor.clone().lerp(noonColor, noon);
  const skyColor = edgeColor.clone().lerp(new THREE.Color("#c9ecff"), noon * 0.84);
  const rgbTint = edgeColor.clone().lerp(new THREE.Color("#fffaf0"), noon);
  const sunHeight = 1.6 + noon * 9.2;

  return {
    sunColor,
    skyColor,
    rgbTint,
    rgbStrength: 0.76 + noon * 0.31,
    ambientSky: edgeColor.clone().lerp(new THREE.Color("#e9f8ff"), noon),
    ambientGround: new THREE.Color("#779176").lerp(new THREE.Color("#b8e8c7"), noon),
    ambientIntensity: 1.3 + noon * 1.4,
    sunIntensity: 1.15 + noon * 2.1,
    rimIntensity: 0.42 + noon * 0.68,
    nightFactor: 1 - noon,
    sunPosition: new THREE.Vector3(-10 + time * 20, sunHeight, 5.5)
  };
}

export function normalizeIsometricAssetConfig(config = {}) {
  const base = { ...ISOMETRIC_ASSET_PRESETS.londonShopDepthAnything, ...config };
  return {
    ...base,
    meshResolution: Math.round(clamp(base.meshResolution, 96, 256)),
    imageSmoothing: Boolean(base.imageSmoothing),
    reliefStrength: clamp(base.reliefStrength, 0, 0.8),
    edgeRiskDistance: Math.round(clamp(base.edgeRiskDistance, 0, 28)),
    edgeGradientThreshold: clamp(base.edgeGradientThreshold, 0.01, 0.4),
    stableSampleDistance: Math.round(clamp(base.stableSampleDistance, 1, 96)),
    stableGradientThreshold: clamp(base.stableGradientThreshold, 0.01, 0.4),
    stableSearchRadius: Math.round(clamp(base.stableSearchRadius, 4, 128)),
    normalStrength: clamp(base.normalStrength, 0.5, 14),
    edgeFlattenDistance: Math.round(clamp(base.edgeFlattenDistance, 0, 6)),
    edgeFlattenStrength: clamp(base.edgeFlattenStrength, 0, 1),
    renderStyle: base.renderStyle === "mesh" ? "mesh" : "parallax",
    parallaxStrength: clamp(base.parallaxStrength, 0, 0.42),
    parallaxViewX: clamp(base.parallaxViewX, -1, 1),
    parallaxViewY: clamp(base.parallaxViewY, -1, 1),
    parallaxEdgeErode: Math.round(clamp(base.parallaxEdgeErode, 0, 8)),
    parallaxMaskDilation: Math.round(clamp(base.parallaxMaskDilation, 0, 16)),
    debugFlatSprite: clamp(base.debugFlatSprite, 0, 1),
    sunTime: clamp(base.sunTime, 0, 1),
    emissiveStrength: clamp(base.emissiveStrength ?? 0, 0, 4),
    mapTiles: Math.round(clamp(base.mapTiles, 48, 160)),
    mapCurvature: clamp(base.mapCurvature, 0, 0.34),
    shopScale: clamp(base.shopScale, 0.68, 1.28),
    mapTileSize: clamp(base.mapTileSize, 2.8, 9),
    mapSize: Math.round(clamp(base.mapTiles, 48, 160)) * clamp(base.mapTileSize, 2.8, 9),
    spriteRotationZ: clamp(base.spriteRotationZ, -180, 180),
    spriteTiltX: clamp(base.spriteTiltX, -70, 70),
    spriteTiltY: clamp(base.spriteTiltY, -70, 70),
    groundSnapRows: Math.round(clamp(base.groundSnapRows, 0, 12)),
    assetHeightOffset: clamp(base.assetHeightOffset, -8, 8),
    flatReferenceOpacity: clamp(base.flatReferenceOpacity, 0, 1),
    viewYaw: clamp(base.viewYaw, -45, 45)
  };
}

export function normalizeIsometricDevelopmentConfig(config = {}) {
  const base = { ...ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront, ...config };
  const developmentColumns = Math.round(clamp(base.developmentColumns, 24, 80));
  const developmentRows = Math.round(clamp(base.developmentRows, 24, 80));
  const cellTerrainTiles = Math.round(clamp(base.cellTerrainTiles, 3, 5));
  const minimumTiles = Math.max(developmentColumns, developmentRows) * cellTerrainTiles;
  const mapTiles = Math.round(clamp(base.mapTiles, minimumTiles, 600));
  const mapTileSize = clamp(base.mapTileSize, 0.42, 1.2);
  return {
    ...base,
    mapId: "magic-london-terrain-001",
    developmentColumns,
    developmentRows,
    cellTerrainTiles,
    mapTiles,
    mapTileSize,
    mapSize: mapTiles * mapTileSize,
    mapCurvature: clamp(base.mapCurvature, 0, 0.11),
    perspective: clamp(base.perspective ?? 0, 0, 1),
    cameraMode: base.cameraMode === "free" ? "free" : "play",
    showGrid: Math.round(clamp(base.showGrid, 0, 1)),
    showBaseTiles: Math.round(clamp(base.showBaseTiles ?? 1, 0, 1)),
    useHunyuanModels: Math.round(clamp(base.useHunyuanModels ?? 0, 0, 1)),
    buildingParallaxStrength: clamp(base.buildingParallaxStrength ?? 0.12, 0, 0.24),
    nightLighting: clamp(base.nightLighting ?? 0.35, 0, 1),
    sunTime: clamp(base.sunTime, 0, 1),
    trainSpeed: clamp(base.trainSpeed, 0, 1.5)
  };
}

export function createIsometricDevelopmentWorld(config = {}) {
  const params = normalizeIsometricDevelopmentConfig(config);
  const root = new THREE.Group();
  root.name = "IsometricMagicLondonDevelopmentWorld";
  root.userData.config = params;

  const terrain = createDevelopmentTerrainMap(params);
  terrain.mesh.position.y = -1.76;
  terrain.mesh.receiveShadow = true;
  root.add(terrain.mesh);
  const gridOverlay = createDevelopmentGridOverlay(terrain.grid, terrain.terrain, params);
  gridOverlay.position.y = -1.76;
  root.add(gridOverlay);
  const starterPlan = createStarterDistrictPlan(terrain.grid, params.cityState).filter((entry) => entry.kind !== "road");
  const roadPlan = createRoadRenderPlan(params.cityState, terrain.grid);
  const sampleGroundHeight = (x, z) => sampleTerrainSurfaceHeight(terrain.terrain, params, x, z) - 1.76;
  const baseTiles = createMagicLondonBaseTileKit({
    params,
    grid: terrain.grid,
    terrain: terrain.terrain,
    sampleGroundHeight,
    plan: starterPlan,
    roadPlan
  });
  root.add(baseTiles);
  const vegetation = createMagicLondonVegetationLayer({
    params,
    grid: terrain.grid,
    cityState: params.cityState,
    reservedCellIds: new Set(starterPlan.map((entry) => entry.cell.id)),
    sampleGroundHeight
  });
  root.add(vegetation);
  const starterDistrict = createMagicLondonStarterDistrict({
    grid: terrain.grid,
    sampleGroundHeight,
    cityState: params.cityState,
    assetRegistry: params.assetRegistry,
    parallaxStrength: params.buildingParallaxStrength,
    useHunyuanModels: params.useHunyuanModels,
    nightLighting: params.nightLighting
  });
  root.add(starterDistrict);

  root.userData.contract = getIsometricDevelopmentContract(params, terrain.grid);
  root.userData.terrainRecipe = terrain.recipe;
  root.userData.sampleGroundHeight = sampleGroundHeight;
  root.userData.baseTileContract = getMagicLondonBaseTileContract(params);
  root.userData.vegetationContract = vegetation.userData.contract;
  root.userData.starterDistrictContract = starterDistrict.userData.contract;
  root.userData.updateBaseFit = (camera, enabled, viewport) => starterDistrict.userData.updateBaseFit?.(camera, enabled, viewport);
  root.userData.getBaseFitDiagnostics = () => starterDistrict.userData.baseFitDiagnostics ?? null;
  root.userData.getModelDiagnostics = () => starterDistrict.userData.getModelDiagnostics?.() ?? [];
  root.userData.updateDaylight = (style) => {
    baseTiles.userData.updateDaylight?.(style, params.nightLighting);
    starterDistrict.userData.updateDaylight?.(style);
  };
  root.userData.updateDaylight(getDaylightStyle(params.sunTime));
  root.userData.maps = { previews: [["Development terrain", terrain.canvas]] };
  return root;
}

export function getIsometricDevelopmentContract(config = {}, gridOverride = null) {
  const params = normalizeIsometricDevelopmentConfig(config);
  const grid = gridOverride ?? createDevelopmentGrid(params);
  if (!gridOverride) {
    const { terrain } = createDevelopmentTerrainTypes(params);
    refreshDevelopmentGridValidity(grid, terrain, params);
    assignDevelopmentGroundAttributes(grid, terrain, params);
  }
  return {
    mapId: params.mapId,
    camera: {
      yaw: 45,
      elevation: 55,
      projection: params.perspective > 0.001 ? "perspective" : "orthographic",
      perspective: params.perspective
    },
    worldSpace: `${params.developmentColumns} by ${params.developmentRows} logical city parcels projected onto a continuous, subdivided low-poly isometric terrain`,
    grid: {
      columns: params.developmentColumns,
      rows: params.developmentRows,
      tileSize: grid.cellWorldSize,
      validCellCount: grid.cells.length,
      boundary: "organic terrain edge and water mask; a cell is valid only when its full four-by-four terrain area remains dry and inside the world",
      cells: grid.cells
    },
    anchors: [{ id: "riverfront", type: "sunken_water_system", placement: "non-buildable terrain" }],
    actions: ["build_road(cell)", "place_building(cells)", "reserve_district(cells)"],
    renderLayers: {
      primary: "continuous isometric low-poly terrain and sunken waterbanks",
      infrastructure: "terrain-conforming base tiles: streets, civic paving, pocket parks, and functional dusk lights",
      vegetation: "ground-aware meadow, grove, and woodland layers that yield to constructed city cells",
      support: "Depth Anything building assets will later snap to valid city cells"
    }
  };
}

export async function createIsometricAssetRelief(config = {}) {
  const params = normalizeIsometricAssetConfig(config);
  const sourceMaps = await loadAssetMaps(params);
  const maps = resizeMaps(sourceMaps, params);
  const root = new THREE.Group();
  root.name = "IsometricAssetRelief";
  root.userData.config = params;
  root.userData.pipeline = {
    kind: "isometric-asset-parallax",
    depthProvider: "depth-anything-v2-small",
    notes: "RGB is a soft-edged low-poly building render; a shader offsets color/mask lookups with the local Depth Anything depth map for limited-angle parallax."
  };
  root.userData.maps = maps;

  const terrain = createTerrainMap(params);
  terrain.mesh.position.set(0, -1.76, 0);
  terrain.mesh.receiveShadow = true;
  root.add(terrain.mesh);
  maps.previews.push(["Terrain", terrain.canvas]);

  const assetHeight = 5.9 * params.shopScale;
  const assetWidth = assetHeight * (maps.asset.color.width / maps.asset.color.height);

  const assetPivot = new THREE.Group();
  assetPivot.name = "IsometricLondonBuildingGroundPivot";
  assetPivot.position.set(0, -1.76 + params.assetHeightOffset, 0);
  if (params.renderStyle === "mesh") {
    const mesh = createReliefMesh(maps.asset, {
      name: "IsometricLondonBuildingDepthRelief",
      width: assetWidth,
      height: assetHeight,
      displacement: params.reliefStrength,
      normalScale: 0.36,
      edgeFlattenDistance: params.edgeFlattenDistance,
      edgeFlattenStrength: params.edgeFlattenStrength
    });
    mesh.position.set(0, assetHeight / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const flatReference = createFlatAssetPlane(maps.asset, {
      name: "FlatRgbAlignmentReference",
      width: assetWidth,
      height: assetHeight,
      opacity: params.flatReferenceOpacity
    });
    flatReference.position.set(0, assetHeight / 2, 0.02);

    assetPivot.rotation.set(
      THREE.MathUtils.degToRad(params.spriteTiltX),
      THREE.MathUtils.degToRad(params.spriteTiltY),
      THREE.MathUtils.degToRad(params.spriteRotationZ)
    );
    assetPivot.add(flatReference);
    assetPivot.add(mesh);
  } else {
    const daylight = getDaylightStyle(params.sunTime);
    const sprite = createParallaxAssetSprite(maps.asset, {
      name: "IsometricLondonBuildingParallaxSprite",
      width: assetWidth,
      height: assetHeight,
      parallaxStrength: params.parallaxStrength,
      parallaxViewX: params.parallaxViewX,
      parallaxViewY: params.parallaxViewY,
      debugFlatSprite: params.debugFlatSprite,
      lightColor: daylight.rgbTint,
      lightStrength: daylight.rgbStrength,
      emissiveStrength: params.emissiveStrength,
      rollDegrees: params.spriteRotationZ,
      smoothColor: params.imageSmoothing
    });
    assetPivot.add(sprite);
    root.userData.updateParallax = (camera) => updateParallaxSprite(sprite, camera, params);
    root.userData.updateDaylight = (style) => updateParallaxDaylight(sprite, style);
  }
  root.add(assetPivot);

  if (params.renderStyle === "mesh") {
    const base = createShadowBase(params.shopScale);
    base.position.set(0, -1.72, -0.04);
    root.add(base);
  }

  root.rotation.y = THREE.MathUtils.degToRad(params.viewYaw);
  return { object: root, maps, config: params };
}

async function loadAssetMaps(params) {
  const [color, depth, normal, mask] = await Promise.all([
    loadCanvas(params.colorPath),
    loadCanvas(params.depthPath),
    loadCanvas(params.normalPath),
    loadCanvas(params.maskPath)
  ]);
  const emissive = params.emissivePath ? await loadCanvas(params.emissivePath) : createTransparentCanvas(color.width, color.height);

  return { color, depth, normal, mask, emissive };
}

function resizeMaps(sourceMaps, params) {
  const cleanedMask = createCleanDepthMask(sourceMaps.mask);
  const resolution = params.meshResolution;
  const sourceAspect = sourceMaps.color.width / sourceMaps.color.height;
  const outputWidth = sourceAspect >= 1 ? resolution : Math.max(1, Math.round(resolution * sourceAspect));
  const outputHeight = sourceAspect >= 1 ? Math.max(1, Math.round(resolution / sourceAspect)) : resolution;
  const color = resizeCanvas(sourceMaps.color, outputWidth, outputHeight, params.imageSmoothing);
  const pooledMask = createPooledMaskCanvas(cleanedMask, outputWidth, outputHeight);
  const mask = params.renderStyle === "parallax" ? erodeMaskCanvas(pooledMask, params.parallaxEdgeErode) : pooledMask;
  const parallaxSupportMask = dilateMaskCanvas(
    mask,
    params.parallaxMaskDilation
  );
  const parallaxColor = createParallaxColorCanvas(color, parallaxSupportMask);
  const depth = createNearPooledDepthCanvas(sourceMaps.depth, cleanedMask, outputWidth, outputHeight);
  snapGroundEdgeDepth(depth, mask, params.groundSnapRows);
  const normal = createNormalCanvas(depth, mask, params.normalStrength);
  const emissive = resizeCanvas(sourceMaps.emissive, outputWidth, outputHeight, params.imageSmoothing);

  applyMaskAlpha(normal, mask);
  applyMaskAlpha(depth, mask);
  applyMaskAlpha(emissive, mask);

  return {
    asset: { color, parallaxColor, parallaxSupportMask, depth, normal, mask, emissive },
    previews: [
      ["Building RGB", color],
      ["Near Depth", depth],
      ["Normal", normal],
      ["Night Emission", emissive],
      ["Clean Mask", mask]
    ]
  };
}

function createPooledMaskCanvas(maskCanvas, outputWidth, outputHeight) {
  const sourceWidth = maskCanvas.width;
  const sourceHeight = maskCanvas.height;
  const sourceData = maskCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sourceWidth, sourceHeight).data;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const bounds = sourceCellBounds(x, y, outputWidth, outputHeight, sourceWidth, sourceHeight);
      let visible = 0;
      let total = 0;
      for (let sy = bounds.y0; sy < bounds.y1; sy += 1) {
        for (let sx = bounds.x0; sx < bounds.x1; sx += 1) {
          total += 1;
          if (sourceData[(sy * sourceWidth + sx) * 4] > 24) visible += 1;
        }
      }
      const value = visible / Math.max(1, total) > 0.08 ? 255 : 0;
      const index = (y * outputWidth + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function erodeMaskCanvas(maskCanvas, radius) {
  if (radius <= 0) return maskCanvas;
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const sourceData = maskCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const sourceAlpha = new Uint8Array(width * height);

  for (let i = 0; i < sourceAlpha.length; i += 1) {
    sourceAlpha[i] = sourceData[i * 4] > 24 ? 1 : 0;
  }

  let current = sourceAlpha;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        next[index] =
          current[index] &&
          current[index - 1] &&
          current[index + 1] &&
          current[index - width] &&
          current[index + width]
            ? 1
            : 0;
      }
    }
    current = next;
  }

  return maskFromAlpha(current, width, height);
}

function dilateMaskCanvas(maskCanvas, radius) {
  if (radius <= 0) return maskCanvas;
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const sourceData = maskCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  let current = new Uint8Array(width * height);
  for (let i = 0; i < current.length; i += 1) current[i] = sourceData[i * 4] > 24 ? 1 : 0;

  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (current[index] || current[index - 1] || current[index + 1] || current[index - width] || current[index + width]) {
          next[index] = 1;
        }
      }
    }
    current = next;
  }
  return maskFromAlpha(current, width, height);
}

function createNearPooledDepthCanvas(depthCanvas, maskCanvas, outputWidth, outputHeight) {
  const sourceWidth = depthCanvas.width;
  const sourceHeight = depthCanvas.height;
  const depthData = depthCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sourceWidth, sourceHeight).data;
  const maskData = maskCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sourceWidth, sourceHeight).data;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const bounds = sourceCellBounds(x, y, outputWidth, outputHeight, sourceWidth, sourceHeight);
      let nearDepth = 0;
      let hasDepth = false;

      for (let sy = bounds.y0; sy < bounds.y1; sy += 1) {
        for (let sx = bounds.x0; sx < bounds.x1; sx += 1) {
          const sourceIndex = (sy * sourceWidth + sx) * 4;
          if (maskData[sourceIndex] <= 24) continue;
          nearDepth = Math.max(nearDepth, depthData[sourceIndex]);
          hasDepth = true;
        }
      }

      const index = (y * outputWidth + x) * 4;
      // The generated Depth Anything map is already normalized for this mesh:
      // brighter pixels are closer and should extrude more.
      const value = hasDepth ? nearDepth : 0;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = hasDepth ? 255 : 0;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function snapGroundEdgeDepth(depthCanvas, maskCanvas, rows) {
  if (rows <= 0) return;
  const width = depthCanvas.width;
  const height = depthCanvas.height;
  const depthCtx = depthCanvas.getContext("2d", { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const depthImage = depthCtx.getImageData(0, 0, width, height);
  const maskData = maskCtx.getImageData(0, 0, width, height).data;

  for (let x = 0; x < width; x += 1) {
    let bottom = -1;
    for (let y = height - 1; y >= 0; y -= 1) {
      if (maskData[(y * width + x) * 4] > 24) {
        bottom = y;
        break;
      }
    }
    if (bottom < 0) continue;
    for (let y = Math.max(0, bottom - rows + 1); y <= bottom; y += 1) {
      const index = (y * width + x) * 4;
      if (maskData[index] <= 24) continue;
      depthImage.data[index] = 0;
      depthImage.data[index + 1] = 0;
      depthImage.data[index + 2] = 0;
      depthImage.data[index + 3] = 255;
    }
  }

  depthCtx.putImageData(depthImage, 0, 0);
}

function sourceCellBounds(x, y, outputWidth, outputHeight, sourceWidth, sourceHeight) {
  return {
    x0: Math.floor((x / outputWidth) * sourceWidth),
    y0: Math.floor((y / outputHeight) * sourceHeight),
    x1: Math.max(Math.floor((x / outputWidth) * sourceWidth) + 1, Math.ceil(((x + 1) / outputWidth) * sourceWidth)),
    y1: Math.max(Math.floor((y / outputHeight) * sourceHeight) + 1, Math.ceil(((y + 1) / outputHeight) * sourceHeight))
  };
}

function createCleanDepthMask(maskCanvas) {
  const width = maskCanvas.width;
  const height = maskCanvas.height;
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const maskData = maskCtx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);

  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = maskData[i * 4] > 24 ? 1 : 0;
  }

  const main = keepLargestComponent(alpha, width, height);
  return maskFromAlpha(main, width, height);
}

function keepLargestComponent(alpha, width, height) {
  const labels = new Int32Array(alpha.length);
  const stack = [];
  let bestLabel = 0;
  let bestSize = 0;
  let label = 0;

  for (let i = 0; i < alpha.length; i += 1) {
    if (!alpha[i] || labels[i]) continue;
    label += 1;
    let size = 0;
    labels[i] = label;
    stack.push(i);

    while (stack.length) {
      const current = stack.pop();
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      visitAlphaNeighbor(current - 1, x > 0, alpha, labels, label, stack);
      visitAlphaNeighbor(current + 1, x < width - 1, alpha, labels, label, stack);
      visitAlphaNeighbor(current - width, y > 0, alpha, labels, label, stack);
      visitAlphaNeighbor(current + width, y < height - 1, alpha, labels, label, stack);
    }

    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }

  const output = new Uint8Array(alpha.length);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = labels[i] === bestLabel ? 1 : 0;
  }
  return output;
}

function visitAlphaNeighbor(index, inBounds, alpha, labels, label, stack) {
  if (!inBounds || !alpha[index] || labels[index]) return;
  labels[index] = label;
  stack.push(index);
}

function stabilizeDepthEdges(depthCanvas, maskCanvas, params) {
  const width = depthCanvas.width;
  const height = depthCanvas.height;
  const depthCtx = depthCanvas.getContext("2d", { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const depthImage = depthCtx.getImageData(0, 0, width, height);
  const depthData = depthImage.data;
  const maskData = maskCtx.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);

  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = maskData[i * 4] > 24 ? 1 : 0;
  }

  const maxDistance = Math.max(params.edgeRiskDistance, params.stableSampleDistance, params.stableSearchRadius);
  const distance = distanceFromTransparent(alpha, width, height, maxDistance);
  const output = new Uint8ClampedArray(depthData);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const dataIndex = index * 4;
      if (!alpha[index]) {
        output[dataIndex] = 0;
        output[dataIndex + 1] = 0;
        output[dataIndex + 2] = 0;
        output[dataIndex + 3] = 0;
        continue;
      }

      const gradient = depthGradient(depthData, width, height, x, y);
      const isEdgeRisk = distance[index] <= params.edgeRiskDistance || gradient > params.edgeGradientThreshold;
      if (!isEdgeRisk) {
        output[dataIndex + 3] = 255;
        continue;
      }

      const stableDepth = findStableNearbyDepth(depthData, distance, alpha, width, height, x, y, params);
      const value = Math.round(stableDepth * 255);
      output[dataIndex] = value;
      output[dataIndex + 1] = value;
      output[dataIndex + 2] = value;
      output[dataIndex + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.putImageData(new ImageData(output, width, height), 0, 0);
  return canvas;
}

function findStableNearbyDepth(depthData, distance, alpha, width, height, x, y, params) {
  let sum = 0;
  let weightSum = 0;

  for (let radius = 6; radius <= params.stableSearchRadius; radius += 4) {
    sum = 0;
    weightSum = 0;
    for (let oy = -radius; oy <= radius; oy += 2) {
      for (let ox = -radius; ox <= radius; ox += 2) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const sampleIndex = sy * width + sx;
        if (!alpha[sampleIndex] || distance[sampleIndex] < params.stableSampleDistance) continue;
        const gradient = depthGradient(depthData, width, height, sx, sy);
        if (gradient > params.stableGradientThreshold) continue;
        const spatial = Math.hypot(ox, oy);
        const weight = 1 / Math.max(1, spatial);
        sum += sampleDepth(depthData, width, height, sx, sy) * weight;
        weightSum += weight;
      }
    }
    if (weightSum > 0) return sum / weightSum;
  }

  return sampleDepth(depthData, width, height, x, y);
}

function distanceFromTransparent(alpha, width, height, maxDistance) {
  const distance = new Uint8Array(alpha.length);
  distance.fill(maxDistance);

  for (let i = 0; i < alpha.length; i += 1) {
    if (!alpha[i]) distance[i] = 0;
  }

  for (let pass = 0; pass < maxDistance; pass += 1) {
    let changed = false;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!alpha[index]) continue;
        const next = Math.min(
          distance[index],
          distance[index - 1] + 1,
          distance[index + 1] + 1,
          distance[index - width] + 1,
          distance[index + width] + 1
        );
        if (next < distance[index]) {
          distance[index] = next;
          changed = true;
        }
      }
    }
    for (let y = height - 2; y >= 1; y -= 1) {
      for (let x = width - 2; x >= 1; x -= 1) {
        const index = y * width + x;
        if (!alpha[index]) continue;
        const next = Math.min(
          distance[index],
          distance[index - 1] + 1,
          distance[index + 1] + 1,
          distance[index - width] + 1,
          distance[index + width] + 1
        );
        if (next < distance[index]) {
          distance[index] = next;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return distance;
}

function depthGradient(depthData, width, height, x, y) {
  const left = sampleDepth(depthData, width, height, x - 1, y);
  const right = sampleDepth(depthData, width, height, x + 1, y);
  const up = sampleDepth(depthData, width, height, x, y - 1);
  const down = sampleDepth(depthData, width, height, x, y + 1);
  return Math.hypot(right - left, down - up);
}

function sampleDepth(depthData, width, height, x, y) {
  const sx = clamp(Math.round(x), 0, width - 1);
  const sy = clamp(Math.round(y), 0, height - 1);
  return depthData[(sy * width + sx) * 4] / 255;
}

function maskFromAlpha(alpha, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const image = ctx.createImageData(width, height);

  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i] ? 255 : 0;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

function createReliefMesh(mapSet, options) {
  const colorTexture = createTexture(mapSet.color, true);
  const normalTexture = createTexture(mapSet.normal, false);
  const depthData = mapSet.depth.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mapSet.depth.width, mapSet.depth.height).data;
  const alphaData = mapSet.color.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mapSet.color.width, mapSet.color.height).data;
  const width = mapSet.depth.width;
  const height = mapSet.depth.height;
  const depthStats = getVisibleDepthStats(depthData, alphaData, width, height);
  const worldDepth = options.width * options.displacement;
  const alphaMask = createAlphaMask(alphaData, width, height);
  const edgeDistance = distanceFromTransparent(alphaMask, width, height, options.edgeFlattenDistance + 6);
  const remappedDepth = createRemappedDepth(depthData, alphaData, width, height, depthStats);
  const cutMask = createEdgeCutMask(alphaMask, edgeDistance, width, height, options.edgeFlattenDistance);
  const geometry = createPixelQuadGeometry({
    width,
    height,
    worldWidth: options.width,
    worldHeight: options.height,
    alphaData,
    alphaMask,
    cutMask,
    edgeDistance,
    remappedDepth,
    worldDepth,
    edgeFlattenDistance: options.edgeFlattenDistance,
    edgeFlattenStrength: options.edgeFlattenStrength
  });

  const material = new THREE.MeshStandardMaterial({
    map: colorTexture,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(options.normalScale, options.normalScale),
    roughness: 0.82,
    metalness: 0.01,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.userData.textures = [colorTexture, normalTexture];
  return mesh;
}

function createParallaxAssetSprite(mapSet, options) {
  const colorTexture = createTexture(mapSet.color, true, options.smoothColor);
  const parallaxColorTexture = createTexture(mapSet.parallaxColor, true, options.smoothColor);
  const depthTexture = createTexture(mapSet.depth, false);
  const normalTexture = createTexture(mapSet.normal, false);
  const emissiveTexture = createTexture(mapSet.emissive, true, options.smoothColor);
  const geometry = createIsometricFacingPlaneGeometry(options.width, options.height, options.rollDegrees);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      colorMap: { value: colorTexture },
      parallaxColorMap: { value: parallaxColorTexture },
      depthMap: { value: depthTexture },
      normalMap: { value: normalTexture },
      emissiveMap: { value: emissiveTexture },
      nightEmission: { value: 0 },
      parallaxStrength: { value: options.parallaxStrength },
      debugFlatSprite: { value: options.debugFlatSprite },
      globalLightColor: { value: options.lightColor.clone() },
      globalLightStrength: { value: options.lightStrength },
      manualViewOffset: { value: new THREE.Vector2(options.parallaxViewX, options.parallaxViewY) },
      cameraViewOffset: { value: new THREE.Vector2(0, 0) }
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colorMap;
      uniform sampler2D parallaxColorMap;
      uniform sampler2D depthMap;
      uniform sampler2D normalMap;
      uniform sampler2D emissiveMap;
      uniform float nightEmission;
      uniform float parallaxStrength;
      uniform float debugFlatSprite;
      uniform vec3 globalLightColor;
      uniform float globalLightStrength;
      uniform vec2 manualViewOffset;
      uniform vec2 cameraViewOffset;
      varying vec2 vUv;

      vec4 sampleBaseSprite(vec2 uv) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        vec4 color = texture2D(colorMap, uv);
        if (color.a < 0.08) discard;
        return color;
      }

      vec4 sampleParallaxSprite(vec2 uv) {
        // RGB is edge-filled inside the dilated support region, but alpha stays
        // tied to the original sprite so transparent margins remain transparent.
        vec2 clampedUv = clamp(uv, vec2(0.001), vec2(0.999));
        vec4 color = texture2D(parallaxColorMap, clampedUv);
        if (color.a < 0.08) discard;
        return color;
      }

      vec2 parallaxUv(vec2 uv, vec2 viewOffset) {
        const int steps = 12;
        float layerDepth = 0.0;
        float layerStep = 1.0 / float(steps);
        vec2 delta = viewOffset * parallaxStrength * layerStep;
        vec2 currentUv = uv;

        for (int i = 0; i < steps; i++) {
          vec2 depthUv = clamp(currentUv, vec2(0.001), vec2(0.999));
          float sampledDepth = texture2D(depthMap, depthUv).r;
          if (layerDepth >= sampledDepth) {
            break;
          }
          currentUv -= delta;
          layerDepth += layerStep;
        }

        return currentUv;
      }

      void main() {
        if (debugFlatSprite > 0.5) {
          vec4 color = sampleBaseSprite(vUv);
          color.rgb *= globalLightColor * globalLightStrength;
          vec4 emission = texture2D(emissiveMap, vUv);
          color.rgb += emission.rgb * emission.a * nightEmission;
          gl_FragColor = color;
          return;
        }

        sampleBaseSprite(vUv);
        vec2 viewOffset = -clamp(manualViewOffset + cameraViewOffset, vec2(-1.0), vec2(1.0));
        vec2 result = parallaxUv(vUv, viewOffset);
        vec4 color = sampleParallaxSprite(result);
        color.rgb *= globalLightColor * globalLightStrength;
        vec4 emission = texture2D(emissiveMap, result);
        color.rgb += emission.rgb * emission.a * nightEmission;
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.FrontSide,
    depthWrite: true,
    toneMapped: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.textures = [colorTexture, parallaxColorTexture, depthTexture, normalTexture, emissiveTexture];
  const basis = getIsometricSpriteBasis(options.rollDegrees);
  mesh.userData.parallax = {
    baseNormal: basis.normal,
    right: basis.right,
    up: basis.up,
    cameraStrength: 1.25,
    restOffset: null
  };
  mesh.userData.emissiveStrength = options.emissiveStrength;
  return mesh;
}

function createIsometricFacingPlaneGeometry(width, height, rollDegrees) {
  const basis = getIsometricSpriteBasis(rollDegrees);
  const positions = [];
  const uvs = [];
  const indices = [0, 2, 1, 0, 3, 2];
  const corners = [
    { x: -width / 2, y: height, u: 0, v: 1 },
    { x: width / 2, y: height, u: 1, v: 1 },
    { x: width / 2, y: 0, u: 1, v: 0 },
    { x: -width / 2, y: 0, u: 0, v: 0 }
  ];

  corners.forEach((corner) => {
    const point = basis.right.clone().multiplyScalar(corner.x).add(basis.up.clone().multiplyScalar(corner.y));
    positions.push(point.x, point.y, point.z);
    uvs.push(corner.u, corner.v);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function getIsometricSpriteBasis(rollDegrees = 0) {
  const normal = new THREE.Vector3(55, 42, 60).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const up = worldUp.clone().sub(normal.clone().multiplyScalar(worldUp.dot(normal))).normalize();
  const right = up.clone().cross(normal).normalize();
  const roll = THREE.MathUtils.degToRad(rollDegrees);

  if (Math.abs(roll) > 0.0001) {
    right.applyAxisAngle(normal, roll);
    up.applyAxisAngle(normal, roll);
  }

  return { normal, right, up };
}

function updateParallaxSprite(sprite, camera, params) {
  const state = sprite.userData.parallax;
  const uniforms = sprite.material?.uniforms;
  if (!state || !uniforms) return;

  const spriteWorldPosition = new THREE.Vector3();
  const spriteWorldQuaternion = new THREE.Quaternion();
  sprite.getWorldPosition(spriteWorldPosition);
  sprite.getWorldQuaternion(spriteWorldQuaternion);
  const cameraDirection = camera.position.clone().sub(spriteWorldPosition).normalize();
  const normal = state.baseNormal.clone().applyQuaternion(spriteWorldQuaternion).normalize();
  const right = state.right.clone().applyQuaternion(spriteWorldQuaternion).normalize();
  const up = state.up.clone().applyQuaternion(spriteWorldQuaternion).normalize();
  const tangent = cameraDirection.sub(normal.multiplyScalar(cameraDirection.dot(normal)));
  const cameraOffset = new THREE.Vector2(
    clamp(tangent.dot(right) * state.cameraStrength, -1, 1),
    clamp(tangent.dot(up) * state.cameraStrength, -1, 1)
  );

  if (!state.restOffset) {
    state.restOffset = cameraOffset.clone();
  }

  cameraOffset.sub(state.restOffset);

  uniforms.parallaxStrength.value = params.parallaxStrength;
  uniforms.debugFlatSprite.value = params.debugFlatSprite;
  uniforms.manualViewOffset.value.set(params.parallaxViewX, params.parallaxViewY);
  uniforms.cameraViewOffset.value.set(
    clamp(cameraOffset.x, -1, 1),
    clamp(cameraOffset.y, -1, 1)
  );
}

function updateParallaxDaylight(sprite, style) {
  const uniforms = sprite.material?.uniforms;
  if (!uniforms) return;
  uniforms.globalLightColor.value.copy(style.rgbTint);
  uniforms.globalLightStrength.value = style.rgbStrength;
  uniforms.nightEmission.value = (style.nightFactor ?? 0) * (sprite.userData.emissiveStrength ?? 0);
}

function createFlatAssetPlane(mapSet, options) {
  const colorTexture = createTexture(mapSet.color, true);
  const geometry = new THREE.PlaneGeometry(options.width, options.height, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: colorTexture,
    transparent: true,
    opacity: options.opacity,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.userData.textures = [colorTexture];
  return mesh;
}

function createPixelQuadGeometry(options) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const pixelWidth = options.worldWidth / options.width;
  const pixelHeight = options.worldHeight / options.height;

  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const sampleIndex = y * options.width + x;
      const dataIndex = sampleIndex * 4;
      const alpha = options.alphaData[dataIndex + 3] / 255;
      if (alpha <= 0.08) continue;

      if (options.cutMask[sampleIndex]) continue;

      const z00 = sampleQuadDepth(options, x, y, sampleIndex) * options.worldDepth;
      const z10 = sampleQuadDepth(options, x + 1, y, sampleIndex) * options.worldDepth;
      const z11 = sampleQuadDepth(options, x + 1, y + 1, sampleIndex) * options.worldDepth;
      const z01 = sampleQuadDepth(options, x, y + 1, sampleIndex) * options.worldDepth;
      const x0 = -options.worldWidth / 2 + x * pixelWidth;
      const x1 = x0 + pixelWidth;
      const y1 = options.worldHeight / 2 - y * pixelHeight;
      const y0 = y1 - pixelHeight;
      const u0 = x / options.width;
      const u1 = (x + 1) / options.width;
      const v1 = 1 - y / options.height;
      const v0 = 1 - (y + 1) / options.height;
      const vertex = positions.length / 3;

      positions.push(
        x0, y1, z00,
        x1, y1, z10,
        x1, y0, z11,
        x0, y0, z01
      );
      uvs.push(
        u0, v1,
        u1, v1,
        u1, v0,
        u0, v0
      );
      indices.push(vertex, vertex + 2, vertex + 1, vertex, vertex + 3, vertex + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createEdgeCutMask(alphaMask, edgeDistance, width, height, cutDistance) {
  const cutMask = new Uint8Array(width * height);
  if (cutDistance <= 0) return cutMask;
  for (let i = 0; i < cutMask.length; i += 1) {
    cutMask[i] = alphaMask[i] && edgeDistance[i] <= cutDistance ? 1 : 0;
  }
  return cutMask;
}

function sampleQuadDepth(options, x, y, fallbackIndex) {
  const sx = clamp(Math.round(x), 0, options.width - 1);
  const sy = clamp(Math.round(y), 0, options.height - 1);
  const index = sy * options.width + sx;
  if (!options.alphaMask[index] || options.cutMask[index]) return options.remappedDepth[fallbackIndex] ?? 0;
  return options.remappedDepth[index];
}

function createAlphaMask(alphaData, width, height) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = alphaData[i * 4 + 3] > 24 ? 1 : 0;
  }
  return mask;
}

function createRemappedDepth(depthData, alphaData, width, height, depthStats) {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i += 1) {
    if (alphaData[i * 4 + 3] <= 24) continue;
    values[i] = remapDepth(depthData[i * 4] / 255, depthStats);
  }
  return values;
}

function localInteriorMedianDepth(depth, alpha, edgeDistance, width, height, x, y, radius) {
  const values = [];
  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const index = sy * width + sx;
      if (!alpha[index] || edgeDistance[index] <= 2) continue;
      values.push(depth[index]);
    }
  }
  if (!values.length) return depth[y * width + x];
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length * 0.5)];
}

function getVisibleDepthStats(depthData, alphaData, width, height) {
  let min = 1;
  let max = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (alphaData[index + 3] < 24) continue;
      const depth = depthData[index] / 255;
      min = Math.min(min, depth);
      max = Math.max(max, depth);
    }
  }
  return max > min ? { min, max } : { min: 0, max: 1 };
}

function remapDepth(depth, stats) {
  const normalized = clamp((depth - stats.min) / Math.max(0.001, stats.max - stats.min), 0, 1);
  return 0.04 + Math.pow(normalized, 0.88) * 0.96;
}

function createNormalCanvas(depthCanvas, maskCanvas, strength) {
  const width = depthCanvas.width;
  const height = depthCanvas.height;
  const depthCtx = depthCanvas.getContext("2d", { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const depthData = depthCtx.getImageData(0, 0, width, height).data;
  const maskData = maskCtx.getImageData(0, 0, width, height).data;
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalCtx = normalCanvas.getContext("2d", { willReadFrequently: true });
  const normalImage = normalCtx.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const dx = (sampleDepth(depthData, width, height, x + 1, y) - sampleDepth(depthData, width, height, x - 1, y)) * strength;
      const dy = (sampleDepth(depthData, width, height, x, y + 1) - sampleDepth(depthData, width, height, x, y - 1)) * strength;
      const normal = normalizeVector(-dx, dy, 1);
      normalImage.data[index] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalImage.data[index + 3] = maskData[index] > 24 ? 255 : 0;
    }
  }

  normalCtx.putImageData(normalImage, 0, 0);
  return normalCanvas;
}

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function createSeededRng(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const seedOffset = hash / 4294967296;
  const rng = function rng() {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  rng.seedOffset = seedOffset;
  return rng;
}

function valueNoise(x, y, rng) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const top = lerp(hashNoise(xi, yi, rng), hashNoise(xi + 1, yi, rng), smooth(xf));
  const bottom = lerp(hashNoise(xi, yi + 1, rng), hashNoise(xi + 1, yi + 1, rng), smooth(xf));
  return lerp(top, bottom, smooth(yf));
}

function hashNoise(x, y, rng) {
  const value = Math.sin(x * 127.1 + y * 311.7 + rng.seedOffset) * 43758.5453;
  return value - Math.floor(value);
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createShadowBase(scale) {
  const geometry = new THREE.CircleGeometry(2.65 * scale, 48);
  const material = new THREE.MeshBasicMaterial({
    color: "#d8bdd0",
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "SoftAssetGroundShadow";
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.set(1.2, 0.72, 1);
  return mesh;
}

function createTexture(canvas, srgb, smooth = false) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  texture.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  texture.generateMipmaps = smooth;
  texture.needsUpdate = true;
  return texture;
}

function createTransparentCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadCanvas(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

function createTerrainMap(params) {
  const tiles = params.mapTiles;
  const textureScale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = tiles * textureScale;
  canvas.height = tiles * textureScale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const rng = createSeededRng(`${params.seed}:terrain`);

  const colors = {
    grass: "#9fca62",
    grassDark: "#76a84f",
    grassLight: "#b9dc72",
    sand: "#dccc9a",
    dirt: "#a97955",
    path: "#d9c99f",
    water: "#36a9d8",
    waterDark: "#2587bd",
    waterLight: "#71d4ed",
    reeds: "#6e9c45",
    stone: "#b9b2aa",
    rock: "#8f8da0",
    rockDark: "#727082",
    rockLight: "#b7b4c2",
    snow: "#f4f4f8",
    snowShade: "#dadce8"
  };

  const terrain = new Array(tiles * tiles).fill("grass");
  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const index = y * tiles + x;
      const noise = valueNoise(x * 0.13, y * 0.13, rng);
      terrain[index] = noise > 0.58 ? "grassLight" : noise < 0.25 ? "grassDark" : "grass";
    }
  }

  carveSea(terrain, tiles);
  carveLake(terrain, tiles, 23, 29, 11, 8);
  carveRiver(terrain, tiles);
  carveMountains(terrain, tiles);
  carveShopClearing(terrain, tiles, Math.floor(tiles / 2), Math.floor(tiles / 2));
  drawTerrain(ctx, terrain, tiles, colors, rng, textureScale);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const geometry = createTerrainGeometry(terrain, tiles, params);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "PixelWaterwaysTerrain";
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.textures = [texture];

  const group = new THREE.Group();
  group.name = "PixelWaterwaysTerrainGroup";
  group.userData.textures = [texture];
  group.add(mesh);
  group.add(createTerrainDecorations(terrain, tiles, params, rng));
  return { mesh: group, canvas };
}

function createDevelopmentTerrainMap(params) {
  const tiles = params.mapTiles;
  const textureScale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = tiles * textureScale;
  canvas.height = tiles * textureScale;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const { terrain, recipe, rng } = createDevelopmentTerrainTypes(params);
  const colors = {
    grass: "#8faf76",
    grassDark: "#789764",
    grassLight: "#a3b981",
    sand: "#c9ad80",
    dirt: "#a97955",
    path: "#d9c99f",
    water: "#4a96bd",
    waterDark: "#2d7099",
    waterLight: "#79bfd6",
    reeds: "#6e9c45",
    stone: "#bbb2a9",
    rock: "#8f8da0",
    rockDark: "#727082",
    rockLight: "#b7b4c2",
    snow: "#f4f4f8",
    snowShade: "#dadce8"
  };
  const grid = createDevelopmentGrid(params);
  refreshDevelopmentGridValidity(grid, terrain, params);
  assignDevelopmentGroundAttributes(grid, terrain, params);
  drawTerrain(ctx, terrain, tiles, colors, rng, textureScale);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const geometry = createTerrainGeometry(terrain, tiles, params);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.94, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "IsometricMagicLondonContinuousTerrain";
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.textures = [texture];

  const group = new THREE.Group();
  group.name = "IsometricMagicLondonTerrainGroup";
  group.userData.textures = [texture];
  group.add(mesh);
  return { mesh: group, canvas, terrain, grid, recipe };
}

function createDevelopmentTerrainTypes(params) {
  const rng = createSeededRng(`${params.seed}:development-terrain`);
  const terrain = new Array(params.mapTiles * params.mapTiles).fill("grass");
  for (let y = 0; y < params.mapTiles; y += 1) {
    for (let x = 0; x < params.mapTiles; x += 1) {
      const noise = valueNoise(x * 0.032, y * 0.032, rng);
      terrain[y * params.mapTiles + x] = noise > 0.65 ? "grassLight" : noise < 0.21 ? "grassDark" : "grass";
    }
  }
  const recipe = createDevelopmentTerrainRecipe(params);
  carveDevelopmentWater(terrain, params.mapTiles, recipe);
  return { terrain, recipe, rng };
}

function assignDevelopmentGroundAttributes(grid, terrain, params) {
  const habitatRng = createSeededRng(`${params.seed}:development-habitat`);
  const span = params.cellTerrainTiles;
  grid.cells.forEach((cell) => {
    const counts = { grass: 0, grassLight: 0, grassDark: 0 };
    for (let y = cell.terrainY; y < cell.terrainY + span; y += 1) {
      for (let x = cell.terrainX; x < cell.terrainX + span; x += 1) {
        const type = terrain[y * params.mapTiles + x];
        if (type in counts) counts[type] += 1;
      }
    }
    const dominantSurface = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const darkFraction = counts.grassDark / (span * span);
    const habitatNoise = valueNoise(cell.column * 0.18, cell.row * 0.18, habitatRng);
    const vegetation = darkFraction >= 0.42
      ? "woodland"
      : dominantSurface === "grass" && habitatNoise > 0.58
        ? "grove"
        : "meadow";
    cell.groundCover = vegetation;
    cell.ground = {
      surface: dominantSurface,
      vegetation,
      grassMix: { ...counts }
    };
  });
}

function createDevelopmentGrid(params) {
  const span = params.cellTerrainTiles;
  const width = params.developmentColumns * span;
  const height = params.developmentRows * span;
  const startX = Math.floor((params.mapTiles - width) / 2);
  const startY = Math.floor((params.mapTiles - height) / 2);
  const cells = [];
  const cellWorldSize = span * params.mapTileSize;
  const fieldCenterX = startX + width / 2;
  const fieldCenterY = startY + height / 2;
  for (let row = 0; row < params.developmentRows; row += 1) {
    for (let column = 0; column < params.developmentColumns; column += 1) {
      const terrainX = startX + column * span;
      const terrainY = startY + row * span;
      const corners = [
        [terrainX, terrainY], [terrainX + span, terrainY], [terrainX, terrainY + span], [terrainX + span, terrainY + span]
      ];
      const insideWorld = corners.every(([x, y]) => {
        const dx = Math.abs((x - fieldCenterX) / (width / 2 + 1));
        const dy = Math.abs((y - fieldCenterY) / (height / 2 + 1));
        return dx ** 4 + dy ** 4 <= 1;
      });
      const center = tileCenterToWorld(terrainX + span / 2 - 0.5, terrainY + span / 2 - 0.5, params.mapTiles, params.mapSize);
      cells.push({
        id: `cell-${column}-${row}`,
        column,
        row,
        terrainX,
        terrainY,
        center: { x: center.x, z: center.z },
        buildable: insideWorld,
        actions: ["build_road", "place_building", "reserve_district"]
      });
    }
  }
  return { startX, startY, width, height, cellWorldSize, cells };
}

function createDevelopmentTerrainRecipe(params) {
  const rng = createSeededRng(`${params.seed}:terrain-recipe`);
  return {
    river: {
      baseX: tilesFraction(0.82 + rng() * 0.025, params.mapTiles),
      bendY: 0.43 + rng() * 0.16,
      bendWidth: 0.12 + rng() * 0.025,
      bendDepth: tilesFraction(0.075 + rng() * 0.025, params.mapTiles),
      waveAmplitude: tilesFraction(0.012 + rng() * 0.009, params.mapTiles),
      waveFrequency: 1.1 + rng() * 0.45,
      phase: rng() * Math.PI * 2,
      widthBase: tilesFraction(0.027 + rng() * 0.004, params.mapTiles),
      widthAmplitude: 0.18 + rng() * 0.1,
      widthPhase: rng() * Math.PI * 2,
      shoreDepth: tilesFraction(0.010, params.mapTiles)
    },
    lake: {
      cx: tilesFraction(0.34 + rng() * 0.13, params.mapTiles),
      cy: tilesFraction(0.57 + rng() * 0.16, params.mapTiles),
      rx: tilesFraction(0.048 + rng() * 0.01, params.mapTiles),
      ry: tilesFraction(0.034 + rng() * 0.01, params.mapTiles),
      rotation: -0.34 + rng() * 0.68,
      lobePhaseA: rng() * Math.PI * 2,
      lobePhaseB: rng() * Math.PI * 2,
      lobeA: 0.065 + rng() * 0.025,
      lobeB: 0.035 + rng() * 0.02
    }
  };
}

function tilesFraction(fraction, tiles) {
  return fraction * tiles;
}

function carveDevelopmentWater(terrain, tiles, recipe) {
  const { river, lake } = recipe;
  for (let y = 0; y < tiles; y += 1) {
    const t = y / Math.max(1, tiles - 1);
    const loop = Math.exp(-(((t - river.bendY) / river.bendWidth) ** 2));
    const riverCenter = river.baseX
      - loop * river.bendDepth
      + Math.sin((t * river.waveFrequency + 0.17) * Math.PI * 2 + river.phase) * river.waveAmplitude;
    const waterRadius = river.widthBase * (1 + Math.sin(t * Math.PI * 2 + river.widthPhase) * river.widthAmplitude + loop * 0.22);
    const shoreRadius = waterRadius + river.shoreDepth;
    for (let x = 0; x < tiles; x += 1) {
      const distance = Math.abs(x - riverCenter);
      const index = y * tiles + x;
      if (distance < waterRadius) terrain[index] = "water";
      else if (distance < shoreRadius) terrain[index] = "sand";
    }
  }
  carveSmoothLake(terrain, tiles, lake);
}

function carveSmoothLake(terrain, tiles, lake) {
  const cosine = Math.cos(lake.rotation);
  const sine = Math.sin(lake.rotation);
  for (let y = Math.floor(lake.cy - lake.ry * 1.5); y <= Math.ceil(lake.cy + lake.ry * 1.5); y += 1) {
    for (let x = Math.floor(lake.cx - lake.rx * 1.5); x <= Math.ceil(lake.cx + lake.rx * 1.5); x += 1) {
      if (x < 0 || y < 0 || x >= tiles || y >= tiles) continue;
      const dx = x - lake.cx;
      const dy = y - lake.cy;
      const rotatedX = dx * cosine - dy * sine;
      const rotatedY = dx * sine + dy * cosine;
      const angle = Math.atan2(rotatedY / lake.ry, rotatedX / lake.rx);
      const smoothBoundary = 1
        + lake.lobeA * Math.cos(angle * 2 + lake.lobePhaseA)
        + lake.lobeB * Math.sin(angle * 3 + lake.lobePhaseB);
      const distance = Math.hypot(rotatedX / lake.rx, rotatedY / lake.ry) / smoothBoundary;
      const index = y * tiles + x;
      if (distance < 1) terrain[index] = "water";
      else if (distance < 1.2 && terrain[index] !== "water") terrain[index] = "sand";
    }
  }
}

function refreshDevelopmentGridValidity(grid, terrain, params) {
  const span = params.cellTerrainTiles;
  grid.cells.forEach((cell) => {
    if (!cell.buildable) return;
    for (let y = cell.terrainY; y < cell.terrainY + span; y += 1) {
      for (let x = cell.terrainX; x < cell.terrainX + span; x += 1) {
        const type = terrain[y * params.mapTiles + x];
        if (type === "water" || type === "sand") cell.buildable = false;
      }
    }
  });
  grid.cells = grid.cells.filter((cell) => cell.buildable);
}

function createTerrainGeometry(terrain, tiles, params) {
  const mapSize = params.mapSize;
  const geometry = new THREE.PlaneGeometry(mapSize, mapSize, tiles, tiles);
  const positions = geometry.attributes.position;
  for (let y = 0; y <= tiles; y += 1) {
    for (let x = 0; x <= tiles; x += 1) {
      const index = y * (tiles + 1) + x;
      const localX = positions.getX(index);
      const localY = positions.getY(index);
      positions.setZ(index, terrainHeightAtVertex(terrain, tiles, x, y) + curvedWorldHeight(localX, localY, params));
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

function curvedWorldHeight(x, z, params) {
  const maxDistance = Math.SQRT2 * params.mapSize * 0.5;
  const distance = Math.hypot(x, z);
  const normalized = clamp(distance / maxDistance, 0, 1);
  return -params.mapSize * params.mapCurvature * normalized * normalized;
}

function terrainHeightAtVertex(terrain, tiles, vx, vy) {
  let sum = 0;
  let count = 0;
  for (let oy = -1; oy <= 0; oy += 1) {
    for (let ox = -1; ox <= 0; ox += 1) {
      const x = vx + ox;
      const y = vy + oy;
      if (x < 0 || y < 0 || x >= tiles || y >= tiles) continue;
      sum += terrainHeightForType(terrain[y * tiles + x]);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function sampleTerrainSurfaceHeight(terrain, params, worldX, worldZ) {
  const tileSize = params.mapSize / params.mapTiles;
  const localX = clamp((worldX + params.mapSize / 2) / tileSize, 0, params.mapTiles);
  const localY = clamp((params.mapSize / 2 - worldZ) / tileSize, 0, params.mapTiles);
  const x0 = Math.floor(localX);
  const y0 = Math.floor(localY);
  const x1 = Math.min(params.mapTiles, x0 + 1);
  const y1 = Math.min(params.mapTiles, y0 + 1);
  const tx = localX - x0;
  const ty = localY - y0;
  const top = lerp(terrainHeightAtVertex(terrain, params.mapTiles, x0, y0), terrainHeightAtVertex(terrain, params.mapTiles, x1, y0), tx);
  const bottom = lerp(terrainHeightAtVertex(terrain, params.mapTiles, x0, y1), terrainHeightAtVertex(terrain, params.mapTiles, x1, y1), tx);
  return lerp(top, bottom, ty) + curvedWorldHeight(worldX, worldZ, params);
}

function terrainHeightForType(type) {
  if (type === "snow") return 5.8;
  if (type === "rock") return 3.2;
  if (type === "rockDark") return 2.6;
  if (type === "water") return -1.9;
  if (type === "sand") return -0.48;
  if (type === "rail") return 0.34;
  if (type === "road") return 0.3;
  if (type === "buildable") return 0.3;
  if (type === "park") return 0.34;
  if (type === "path") return 0.06;
  if (type === "grassLight") return 0.38;
  if (type === "grassDark") return 0.2;
  return 0.28;
}

function createDevelopmentGridOverlay(grid, terrain, params) {
  const group = new THREE.Group();
  group.name = "BuildableCityGridOverlay";
  if (!params.showGrid) return group;
  const material = new THREE.LineBasicMaterial({ color: "#6c735d", transparent: true, opacity: params.showGrid ? 0.54 : 0 });
  const points = [];
  const cellSize = params.cellTerrainTiles * params.mapTileSize;
  const half = cellSize / 2;
  grid.cells.forEach((cell) => {
    const { x, z } = cell.center;
    const y = curvedWorldHeight(x, z, params) + terrainHeightForType("buildable") + 0.16;
    points.push(x - half, y, z - half, x + half, y, z - half);
    points.push(x + half, y, z - half, x + half, y, z + half);
    points.push(x + half, y, z + half, x - half, y, z + half);
    points.push(x - half, y, z + half, x - half, y, z - half);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = "SimCityStyleBuildableCells";
  group.add(lines);
  return group;
}

function createTerrainCliffFaces(terrain, tiles, params) {
  const positions = [];
  const colors = [];
  const indices = [];
  const mapSize = params.mapSize;
  const tileSize = mapSize / tiles;
  const minimumDrop = 0.56;

  const addFace = (ax, ay, bx, by, topType, bottomType) => {
    const topHeight = terrainHeightForType(topType);
    const bottomHeight = terrainHeightForType(bottomType);
    if (topHeight - bottomHeight < minimumDrop) return;

    const x0 = -mapSize / 2 + ax * tileSize;
    const y0 = -mapSize / 2 + ay * tileSize;
    const x1 = -mapSize / 2 + bx * tileSize;
    const y1 = -mapSize / 2 + by * tileSize;
    const top0 = topHeight + curvedWorldHeight(x0, y0, params);
    const top1 = topHeight + curvedWorldHeight(x1, y1, params);
    const bottom0 = bottomHeight + curvedWorldHeight(x0, y0, params);
    const bottom1 = bottomHeight + curvedWorldHeight(x1, y1, params);
    const start = positions.length / 3;
    const color = cliffColorForType(topType, bottomType);

    positions.push(x0, y0, top0, x1, y1, top1, x1, y1, bottom1, x0, y0, bottom0);
    for (let i = 0; i < 4; i += 1) colors.push(color.r, color.g, color.b);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };

  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const type = terrain[y * tiles + x];
      if (x + 1 < tiles) {
        const neighbor = terrain[y * tiles + x + 1];
        if (terrainHeightForType(type) >= terrainHeightForType(neighbor)) addFace(x + 1, y, x + 1, y + 1, type, neighbor);
        else addFace(x + 1, y + 1, x + 1, y, neighbor, type);
      }
      if (y + 1 < tiles) {
        const neighbor = terrain[(y + 1) * tiles + x];
        if (terrainHeightForType(type) >= terrainHeightForType(neighbor)) addFace(x + 1, y + 1, x, y + 1, type, neighbor);
        else addFace(x, y + 1, x + 1, y + 1, neighbor, type);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0, flatShading: true, side: THREE.DoubleSide })
  );
  mesh.name = "LowpolyWaterbanksAndCliffs";
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cliffColorForType(topType, bottomType) {
  if (topType === "rock" || topType === "snow") return new THREE.Color("#6d6b7d");
  if (bottomType === "water") return new THREE.Color(topType === "sand" ? "#bb9870" : "#648751");
  return new THREE.Color("#718458");
}

function createTerrainDecorations(terrain, tiles, params, rng) {
  const group = new THREE.Group();
  group.name = "CurvedWorldPixelSprites";
  const tileSize = params.mapSize / tiles;
  const grassTexture = createPixelSpriteTexture("grass");
  const flowerTexture = createPixelSpriteTexture("flower");
  const waveTexture = createPixelSpriteTexture("wave");
  const grassMaterial = new THREE.SpriteMaterial({ map: grassTexture, transparent: true, depthWrite: false, toneMapped: false });
  const flowerMaterial = new THREE.SpriteMaterial({ map: flowerTexture, transparent: true, depthWrite: false, toneMapped: false });
  const waveMaterial = new THREE.SpriteMaterial({ map: waveTexture, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false });
  group.userData.textures = [grassTexture, flowerTexture, waveTexture];

  for (let y = 1; y < tiles - 1; y += 1) {
    for (let x = 1; x < tiles - 1; x += 1) {
      const type = terrain[y * tiles + x];
      if ((type === "grass" || type === "grassLight" || type === "grassDark") && rng() > 0.88) {
        group.add(createLowpolyPine(x, y, tiles, params, tileSize, type, rng, 0.86 + rng() * 0.34));
      } else if ((type === "grass" || type === "grassLight" || type === "grassDark") && rng() > 0.94) {
        const sprite = createTerrainSprite(x, y, tiles, params, tileSize, type, rng, grassMaterial, 0.58 + rng() * 0.24);
        sprite.name = "PixelShrubSprite";
        group.add(sprite);
      }
      if ((type === "grass" || type === "grassLight") && rng() > 0.982) {
        const sprite = createTerrainSprite(x, y, tiles, params, tileSize, type, rng, flowerMaterial, 0.52);
        sprite.name = "PixelFlowerSprite";
        group.add(sprite);
      }
      if (type === "water" && rng() > 0.9) {
        group.add(createWaterWave(x, y, tiles, params, tileSize, rng, waveMaterial));
      }
      if ((type === "rock" || type === "snow" || type === "sand") && rng() > 0.9) {
        group.add(createLowpolyRock(x, y, tiles, params, tileSize, type, rng, 0.72 + rng() * 0.4));
      }
    }
  }
  return group;
}

function createLowpolyPine(x, y, tiles, params, tileSize, type, rng, scale) {
  const group = new THREE.Group();
  group.name = "LowpolyPine";
  const position = tileCenterToWorld(x, y, tiles, params.mapSize);
  position.x += (rng() - 0.5) * tileSize * 0.62;
  position.z += (rng() - 0.5) * tileSize * 0.62;
  position.y = terrainSurfaceYAtPosition(position.x, position.z, type, params);
  group.position.copy(position);
  group.rotation.y = rng() * Math.PI * 2;
  group.scale.setScalar(scale);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(tileSize * 0.055, tileSize * 0.075, tileSize * 0.34, 5),
    new THREE.MeshStandardMaterial({ color: "#684536", roughness: 1, flatShading: true })
  );
  trunk.position.y = tileSize * 0.17;
  group.add(trunk);

  const tiers = [
    [0.22, 0.74, 0.44, "#255a43"],
    [0.18, 0.58, 0.72, "#2d704e"],
    [0.13, 0.42, 0.96, "#43875a"]
  ];
  tiers.forEach(([radius, height, yOffset, color]) => {
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(tileSize * radius, tileSize * height, 5),
      new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
    );
    foliage.position.y = tileSize * yOffset;
    group.add(foliage);
  });
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return group;
}

function createLowpolyRock(x, y, tiles, params, tileSize, type, rng, scale) {
  const group = new THREE.Group();
  group.name = "LowpolyRock";
  const position = tileCenterToWorld(x, y, tiles, params.mapSize);
  position.x += (rng() - 0.5) * tileSize * 0.62;
  position.z += (rng() - 0.5) * tileSize * 0.62;
  position.y = terrainSurfaceYAtPosition(position.x, position.z, type, params);
  group.position.copy(position);
  group.rotation.set(rng() * 0.3, rng() * Math.PI, rng() * 0.24);
  group.scale.setScalar(scale);

  const rock = new THREE.Mesh(
    new THREE.IcosahedronGeometry(tileSize * 0.18, 0),
    new THREE.MeshStandardMaterial({ color: type === "sand" ? "#a99478" : "#777589", roughness: 1, flatShading: true })
  );
  rock.scale.set(1.35, 0.85, 1.05);
  rock.position.y = tileSize * 0.12;
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);
  return group;
}

function createTerrainSprite(x, y, tiles, params, tileSize, type, rng, material, scale) {
  const sprite = new THREE.Sprite(material.clone());
  const position = tileCenterToWorld(x, y, tiles, params.mapSize);
  position.x += (rng() - 0.5) * tileSize * 0.62;
  position.z += (rng() - 0.5) * tileSize * 0.62;
  position.y = terrainSurfaceYAtPosition(position.x, position.z, type, params) + tileSize * scale * 0.22;
  sprite.position.copy(position);
  sprite.scale.set(tileSize * scale, tileSize * scale, 1);
  return sprite;
}

function createWaterWave(x, y, tiles, params, tileSize, rng, material) {
  const mesh = new THREE.Sprite(material.clone());
  const position = tileCenterToWorld(x, y, tiles, params.mapSize);
  mesh.name = "PixelWaterWave";
  mesh.position.set(
    position.x + (rng() - 0.5) * tileSize * 0.45,
    terrainSurfaceYAtPosition(position.x, position.z, "water", params) + 0.18,
    position.z + (rng() - 0.5) * tileSize * 0.45
  );
  mesh.scale.set(tileSize * (0.9 + rng() * 0.7), tileSize * 0.35, 1);
  mesh.userData.waterWave = {
    baseY: mesh.position.y,
    phase: rng() * Math.PI * 2,
    speed: 0.9 + rng() * 0.7,
    opacity: 0.38 + rng() * 0.32
  };
  return mesh;
}

function createPixelSpriteTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 16, 16);
  if (kind === "wave") {
    ctx.fillStyle = "#effcff";
    ctx.fillRect(1, 6, 6, 1);
    ctx.fillRect(8, 5, 7, 1);
    ctx.fillRect(4, 9, 9, 1);
    ctx.fillStyle = "#bdf2ff";
    ctx.fillRect(7, 7, 4, 1);
  } else if (kind === "pine") {
    ctx.fillStyle = "#5b3f31";
    ctx.fillRect(7, 11, 2, 3);
    ctx.fillStyle = "#2e6f4e";
    ctx.fillRect(6, 3, 4, 3);
    ctx.fillRect(5, 6, 6, 3);
    ctx.fillRect(4, 9, 8, 3);
    ctx.fillStyle = "#4f9a59";
    ctx.fillRect(7, 3, 2, 8);
    ctx.fillStyle = "#225341";
    ctx.fillRect(4, 11, 4, 1);
  } else if (kind === "rock") {
    ctx.fillStyle = "#777485";
    ctx.fillRect(4, 8, 8, 4);
    ctx.fillRect(6, 5, 6, 3);
    ctx.fillStyle = "#aaa7b7";
    ctx.fillRect(6, 5, 4, 2);
    ctx.fillStyle = "#5e5b6c";
    ctx.fillRect(9, 9, 4, 3);
  } else if (kind === "flower") {
    ctx.fillStyle = "#469c4f";
    ctx.fillRect(7, 8, 2, 5);
    ctx.fillStyle = "#ffe17b";
    ctx.fillRect(6, 5, 4, 3);
    ctx.fillStyle = "#ffd0f2";
    ctx.fillRect(5, 6, 2, 2);
    ctx.fillRect(9, 6, 2, 2);
  } else {
    ctx.fillStyle = "#4d9e51";
    ctx.fillRect(3, 9, 2, 5);
    ctx.fillRect(7, 6, 2, 8);
    ctx.fillRect(11, 8, 2, 6);
    ctx.fillStyle = "#8fe070";
    ctx.fillRect(6, 7, 1, 5);
    ctx.fillRect(10, 9, 1, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function terrainSurfaceYAtPosition(x, z, type, params) {
  return curvedWorldHeight(x, z, params) + terrainHeightForType(type);
}

function tileCenterToWorld(x, y, tiles, mapSize) {
  const tileSize = mapSize / tiles;
  return new THREE.Vector3(
    -mapSize / 2 + (x + 0.5) * tileSize,
    0,
    mapSize / 2 - (y + 0.5) * tileSize
  );
}

function carveSea(terrain, tiles) {
  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const coast = x + y * 0.42;
      const seaLine = tiles * 1.05 + Math.sin(y * 0.21) * 4 + Math.sin(x * 0.13) * 2;
      if (coast > seaLine) terrain[y * tiles + x] = "water";
      else if (coast > seaLine - 4) terrain[y * tiles + x] = "sand";
    }
  }
}

function carveLake(terrain, tiles, cx, cy, rx, ry) {
  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const wobble = Math.sin(x * 0.55) * 0.14 + Math.cos(y * 0.41) * 0.12;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + wobble;
      if (d < 1) terrain[y * tiles + x] = "water";
      else if (d < 1.25 && terrain[y * tiles + x] !== "water") terrain[y * tiles + x] = "sand";
    }
  }
}

function carveRiver(terrain, tiles) {
  for (let y = 0; y < tiles; y += 1) {
    const center = 14 + y * 0.58 + Math.sin(y * 0.15) * 8 + Math.sin(y * 0.43) * 2;
    const width = 2.2 + Math.sin(y * 0.18) * 0.9;
    for (let x = 0; x < tiles; x += 1) {
      const dist = Math.abs(x - center);
      const index = y * tiles + x;
      if (dist < width) terrain[index] = "water";
      else if (dist < width + 1.8 && terrain[index] !== "water") terrain[index] = "sand";
    }
  }
}

function carveMountains(terrain, tiles) {
  const ranges = [
    { cx: 8, cy: 8, rx: 22, ry: 18, snow: 0.45 },
    { cx: 88, cy: 12, rx: 20, ry: 17, snow: 0.55 },
    { cx: 92, cy: 88, rx: 26, ry: 20, snow: 0.38 },
    { cx: 8, cy: 92, rx: 18, ry: 15, snow: 0.2 }
  ];

  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const index = y * tiles + x;
      if (terrain[index] === "water" || terrain[index] === "path") continue;
      for (const range of ranges) {
        const ridge = ((x - range.cx) / range.rx) ** 2 + ((y - range.cy) / range.ry) ** 2;
        const jag = Math.sin(x * 0.37 + y * 0.19) * 0.12 + Math.cos(x * 0.13 - y * 0.31) * 0.1;
        if (ridge + jag < 1) {
          terrain[index] = ridge + jag < range.snow ? "snow" : "rock";
          break;
        }
      }
    }
  }
}

function carveShopClearing(terrain, tiles, cx, cy) {
  for (let y = cy - 13; y <= cy + 13; y += 1) {
    for (let x = cx - 15; x <= cx + 15; x += 1) {
      if (x < 0 || y < 0 || x >= tiles || y >= tiles) continue;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const index = y * tiles + x;
      if (dx <= 14 && dy <= 12 && terrain[index] !== "water") terrain[index] = "grassLight";
      if ((dx <= 14 && (dy === 0 || dy === 6 || dy === 12)) || (dy <= 12 && (dx === 0 || dx === 7 || dx === 14))) {
        terrain[index] = "path";
      }
      if (dx <= 2 && dy <= 2) terrain[index] = "path";
    }
  }
  for (let y = cy + 5; y < tiles; y += 1) {
    const x = Math.round(cx + Math.sin(y * 0.24) * 2);
    for (let ox = -1; ox <= 1; ox += 1) {
      const px = x + ox;
      if (px >= 0 && px < tiles && terrain[y * tiles + px] !== "water") terrain[y * tiles + px] = "path";
    }
  }
}

function drawTerrain(ctx, terrain, tiles, colors, rng, scale = 1) {
  for (let y = 0; y < tiles; y += 1) {
    for (let x = 0; x < tiles; x += 1) {
      const type = terrain[y * tiles + x];
      ctx.fillStyle = colors[type] ?? colors.grass;
      const px = x * scale;
      const py = y * scale;
      ctx.fillRect(px, py, scale, scale);
      if (type === "water") {
        drawLowPolyTile(ctx, px, py, scale, colors.water, colors.waterLight, colors.waterDark, x + y);
        drawWaterEdge(ctx, terrain, tiles, x, y, px, py, scale, colors);
      } else if (type === "grass" || type === "grassDark" || type === "grassLight" || type === "park" || type === "buildable") {
        drawLowPolyTile(ctx, px, py, scale, colors[type], colors.grassLight, colors.grassDark, x * 3 + y);
        if (type !== "buildable" && rng() > 0.9) {
          ctx.fillStyle = rng() > 0.5 ? colors.grassLight : colors.reeds;
          ctx.fillRect(px + Math.floor(rng() * scale), py + Math.floor(rng() * scale), 1, 1);
        }
      } else if (type === "rock" || type === "snow") {
        drawLowPolyTile(
          ctx,
          px,
          py,
          scale,
          colors[type],
          type === "snow" ? "#ffffff" : colors.rockLight,
          type === "snow" ? colors.snowShade : colors.rockDark,
          x * 7 + y * 5
        );
      } else if (type === "path" || type === "road" || type === "rail") {
        if (rng() > 0.82) {
          ctx.fillStyle = colors.stone;
          ctx.fillRect(px + Math.floor(rng() * scale), py + Math.floor(rng() * scale), 1, 1);
        }
      }
    }
  }
}

function drawLowPolyTile(ctx, x, y, size, base, light, dark, variant) {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, size, size);
  ctx.beginPath();
  if (variant % 2 === 0) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
  } else {
    ctx.moveTo(x + size, y);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = variant % 3 === 0 ? light : dark;
  ctx.globalAlpha = 0.28;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawWaterEdge(ctx, terrain, tiles, x, y, px, py, scale, colors) {
  const neighbors = [
    { dx: -1, dy: 0, points: [[0, 0], [1, 0], [0, 1]] },
    { dx: 1, dy: 0, points: [[1, 0], [1, 1], [0, 1]] },
    { dx: 0, dy: -1, points: [[0, 0], [1, 0], [1, 1]] },
    { dx: 0, dy: 1, points: [[0, 1], [1, 1], [0, 0]] }
  ];
  neighbors.forEach((edge) => {
    const nx = x + edge.dx;
    const ny = y + edge.dy;
    if (nx < 0 || ny < 0 || nx >= tiles || ny >= tiles) return;
    const neighbor = terrain[ny * tiles + nx];
    if (neighbor === "water") return;
    ctx.beginPath();
    edge.points.forEach(([ox, oy], index) => {
      const tx = px + ox * scale;
      const ty = py + oy * scale;
      if (index === 0) ctx.moveTo(tx, ty);
      else ctx.lineTo(tx, ty);
    });
    ctx.closePath();
    ctx.fillStyle = neighbor === "rock" || neighbor === "snow" ? colors.rockLight : colors.sand;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function resizeCanvas(source, width, height, smoothing) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = smoothing;
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function createParallaxColorCanvas(colorCanvas, supportMask) {
  const width = colorCanvas.width;
  const height = colorCanvas.height;
  const source = colorCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const support = supportMask.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const output = new Uint8ClampedArray(source);
  const owner = new Int32Array(width * height);
  const queue = [];
  owner.fill(-1);

  // Only the dilated support region is flood-filled. Alpha is kept transparent
  // outside the original sprite, so displaced lookups cannot paint the margin.
  for (let i = 0; i < owner.length; i += 1) {
    if (source[i * 4 + 3] < 20 || support[i * 4] <= 24) continue;
    owner[i] = i;
    queue.push(i);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [index - 1, index + 1, index - width, index + width];
    const valid = [x > 0, x < width - 1, y > 0, y < height - 1];

    for (let n = 0; n < neighbors.length; n += 1) {
      const neighbor = neighbors[n];
      if (!valid[n] || owner[neighbor] !== -1 || support[neighbor * 4] <= 24) continue;
      owner[neighbor] = owner[index];
      queue.push(neighbor);
    }
  }

  for (let i = 0; i < owner.length; i += 1) {
    if (owner[i] < 0) continue;
    const sourceIndex = owner[i] * 4;
    const targetIndex = i * 4;
    output[targetIndex] = source[sourceIndex];
    output[targetIndex + 1] = source[sourceIndex + 1];
    output[targetIndex + 2] = source[sourceIndex + 2];
    output[targetIndex + 3] = source[targetIndex + 3];
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { willReadFrequently: true }).putImageData(new ImageData(output, width, height), 0, 0);
  return canvas;
}

function applyMaskAlpha(target, mask) {
  const targetCtx = target.getContext("2d", { willReadFrequently: true });
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  const targetData = targetCtx.getImageData(0, 0, target.width, target.height);
  const maskData = maskCtx.getImageData(0, 0, mask.width, mask.height).data;

  for (let i = 0; i < maskData.length; i += 4) {
    targetData.data[i + 3] = maskData[i];
  }

  targetCtx.putImageData(targetData, 0, 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
