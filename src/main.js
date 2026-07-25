import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  ISOMETRIC_ASSET_PRESETS,
  ISOMETRIC_DEVELOPMENT_PRESETS,
  createIsometricAssetRelief,
  createIsometricDevelopmentWorld,
  createRandomIsometricAssetConfig,
  getDaylightStyle,
  getIsometricDevelopmentContract,
  normalizeIsometricDevelopmentConfig,
  normalizeIsometricAssetConfig
} from "./generators/isometricAssetRelief.js";
import {
  PARCEL_BLUEPRINT_PRESETS,
  buildParcelPrompt,
  createParcelBlueprint,
  getParcelContract,
  normalizeParcelBlueprintConfig
} from "./generators/parcelBlueprint.js";
import {
  VANISHING_POINT_PRESETS,
  createVanishingPointWarpLab,
  getVanishingPointWarpContract,
  normalizeVanishingPointConfig
} from "./generators/vanishingPointWarp.js";
import {
  ASSET_COMPARISON_PRESETS,
  createAssetComparisonLab,
  getAssetComparisonContract,
  normalizeAssetComparisonConfig
} from "./generators/assetComparisonLab.js";
import {
  VOXEL_BUILDING_PRESETS,
  createVoxelBuildingLab,
  getVoxelBuildingContract,
  normalizeVoxelBuildingConfig,
  voxelDaylightStyle
} from "./generators/voxelBuildingLab.js";
import {
  BUILDING_ARCHETYPES,
  BUILDING_SPEC_VERSION,
  VOXEL_STYLE_KITS,
  createBuildingSpec
} from "./generators/voxelBuildingGrammar.js";
import { createCityState } from "./city/state.js";
import { createCityWorkbench } from "./city/workbench.js";
import { createStarterCityWorkbench } from "./city/scenarios.js";
import { findAssetCandidates, getAssetRegistry, resolveAsset } from "./city/assets.js";
import { getModelOrientationPreviewUrls } from "./generators/modelOrientation.js";

const app = document.querySelector("#app");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#fff3f8");

let currentMode = "map";
let camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 2200);
camera.position.set(7.8, 5.5, 9.5);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const edgePanPointer = { x: 0, y: 0, active: false };

let controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0.1, 0);
controls.minDistance = 18;
controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.5;

const worldLights = addLights(scene);

const MODES = {
  map: {
    label: "Magic London Terrain",
    presets: ISOMETRIC_DEVELOPMENT_PRESETS,
    defaultPreset: "magicLondonRiverfront",
    normalize: normalizeIsometricDevelopmentConfig,
    randomize: (seed) => normalizeIsometricDevelopmentConfig({ ...ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront, seed }),
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 },
      { key: "mapCurvature", label: "World Curve", min: 0, max: 0.16, step: 0.01 },
      { key: "perspective", label: "Perspective", min: 0, max: 1, step: 0.01 },
      { key: "buildingParallaxStrength", label: "Building Relief", min: 0, max: 0.24, step: 0.01 },
      { key: "showGrid", label: "Grid Lines", min: 0, max: 1, step: 1 },
      { key: "showBaseTiles", label: "Base Tiles", min: 0, max: 1, step: 1 },
      { key: "useHunyuanModels", label: "3D Buildings", min: 0, max: 1, step: 1 }
    ]
  },
  asset: {
    label: "Isometric Asset",
    presets: ISOMETRIC_ASSET_PRESETS,
    defaultPreset: "londonShopDepthAnything",
    normalize: normalizeIsometricAssetConfig,
    randomize: createRandomIsometricAssetConfig,
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "parallaxStrength", label: "Parallax", min: 0, max: 0.42, step: 0.01 },
      { key: "parallaxViewX", label: "View X", min: -1, max: 1, step: 0.01 },
      { key: "parallaxViewY", label: "View Y", min: -1, max: 1, step: 0.01 },
      { key: "parallaxEdgeErode", label: "Edge Erode", min: 0, max: 8, step: 1 },
      { key: "mapCurvature", label: "World Curve", min: 0, max: 0.34, step: 0.01 },
      { key: "assetHeightOffset", label: "Height", min: -8, max: 8, step: 0.1 },
      { key: "shopScale", label: "Scale", min: 0.68, max: 1.28, step: 0.01 },
      { key: "spriteRotationZ", label: "Plane Roll", min: -45, max: 45, step: 1 },
      { key: "debugFlatSprite", label: "Debug Flat", min: 0, max: 1, step: 1 },
      { key: "viewYaw", label: "Yaw", min: -45, max: 45, step: 1 }
    ]
  },
  vanishing: {
    label: "Vanishing Point Lab",
    presets: VANISHING_POINT_PRESETS,
    defaultPreset: "twoPointCuboid",
    normalize: normalizeVanishingPointConfig,
    randomize: (seed) => normalizeVanishingPointConfig({
      ...VANISHING_POINT_PRESETS.twoPointCuboid,
      seed,
      leftVanishingDistance: 10 + Math.random() * 55,
      rightVanishingDistance: 10 + Math.random() * 55,
      footprintWidth: 2 + Math.random() * 5,
      footprintDepth: 2 + Math.random() * 5
    }),
    sliders: [
      { key: "leftVanishingDistance", label: "Left VP Distance", min: 8, max: 120, step: 1 },
      { key: "rightVanishingDistance", label: "Right VP Distance", min: 8, max: 120, step: 1 },
      { key: "footprintWidth", label: "Plot Width", min: 1.5, max: 9, step: 0.25 },
      { key: "footprintDepth", label: "Plot Depth", min: 1.5, max: 9, step: 0.25 },
      { key: "buildingHeight", label: "Building Height", min: 2, max: 12, step: 0.25 },
      { key: "assetWarpStrength", label: "Asset Warp", min: 0, max: 1, step: 0.01 },
      { key: "showGuides", label: "Vanishing Guides", min: 0, max: 1, step: 1 }
    ]
  },
  comparison: {
    label: "3D Asset Comparison",
    presets: ASSET_COMPARISON_PRESETS,
    defaultPreset: "cottageMetricIndoorSmallVsHunyuan",
    normalize: normalizeAssetComparisonConfig,
    randomize: (seed) => normalizeAssetComparisonConfig({
      ...ASSET_COMPARISON_PRESETS.cottageMetricIndoorSmallVsHunyuan,
      seed,
      comparisonYaw: -45 + Math.random() * 90
    }),
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "depthStrength", label: "Depth Strength", min: 0, max: 2, step: 0.01, live: true },
      { key: "comparisonYaw", label: "Synchronized Yaw", min: -180, max: 180, step: 1, live: true },
      { key: "showBounds", label: "4 × 4 × 4 Bounds", min: 0, max: 1, step: 1, live: true },
      { key: "depthWireframe", label: "Depth Wireframe", min: 0, max: 1, step: 1, live: true }
    ]
  },
  voxel: {
    label: "Procedural Voxel Street",
    presets: VOXEL_BUILDING_PRESETS,
    defaultPreset: "connectedTerraceDay",
    normalize: normalizeVoxelBuildingConfig,
    randomize: (seed) => {
      const archetypeVariant = Math.floor(Math.random() * 3);
      const styleVariant = Math.floor(Math.random() * 3);
      const roofVariant = Math.floor(Math.random() * 3);
      return normalizeVoxelBuildingConfig({
        ...VOXEL_BUILDING_PRESETS.connectedTerraceDay,
        seed,
        floors: 2 + Math.floor(Math.random() * 3),
        roofVariant,
        roofType: ["gable", "mansard", "magic_asymmetric"][roofVariant],
        archetypeVariant,
        archetype: ["townhouse", "magic_shop", "workshop"][archetypeVariant],
        styleVariant,
        style: ["london_brick", "violet_alchemist", "forest_craft"][styleVariant],
        materialScheme: styleVariant,
        variation: 0.35 + Math.random() * 0.65,
        parcelWidth: 24 + Math.floor(Math.random() * 5) * 4,
        parcelDepth: 28 + Math.floor(Math.random() * 5) * 4
      });
    },
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 },
      { key: "buildingCount", label: "Connected Buildings", min: 1, max: 3, step: 1 },
      { key: "floors", label: "Base Floors", min: 2, max: 5, step: 1 },
      { key: "expansionFloors", label: "Add Floors", min: 0, max: 2, step: 1 },
      {
        key: "archetypeVariant",
        label: "Archetype",
        control: "select",
        aliasKey: "archetype",
        options: [
          { value: 0, label: "Townhouse", configValue: "townhouse" },
          { value: 1, label: "Magic Shop", configValue: "magic_shop" },
          { value: 2, label: "Workshop", configValue: "workshop" }
        ]
      },
      {
        key: "styleVariant",
        label: "Style Kit",
        control: "select",
        aliasKey: "style",
        options: [
          { value: 0, label: "London Brick", configValue: "london_brick" },
          { value: 1, label: "Violet Alchemist", configValue: "violet_alchemist" },
          { value: 2, label: "Forest Craft", configValue: "forest_craft" }
        ]
      },
      {
        key: "roofVariant",
        label: "Roof Family",
        control: "select",
        aliasKey: "roofType",
        options: [
          { value: 0, label: "Gable", configValue: "gable" },
          { value: 1, label: "Mansard", configValue: "mansard" },
          { value: 2, label: "Magic Asymmetric", configValue: "magic_asymmetric" }
        ]
      },
      { key: "parcelWidth", label: "Parcel Width", min: 24, max: 40, step: 4 },
      { key: "parcelDepth", label: "Parcel Depth", min: 28, max: 44, step: 4 },
      { key: "variation", label: "Grammar Variation", min: 0, max: 1, step: 0.01 },
      { key: "detailDensity", label: "Decoration", min: 0, max: 1, step: 0.01 }
    ]
  },
  parcel: {
    label: "Parcel Blueprint",
    presets: PARCEL_BLUEPRINT_PRESETS,
    defaultPreset: "shop",
    normalize: normalizeParcelBlueprintConfig,
    randomize: (seed) => normalizeParcelBlueprintConfig({ ...PARCEL_BLUEPRINT_PRESETS.shop, seed }),
    sliders: [
      { key: "floors", label: "Storeys", min: 1, max: 4, step: 1 },
      { key: "maxHeight", label: "Max height", min: 0.5, max: 12, step: 0.1 }
    ]
  }
};

const presetLabels = {
  magicLondonRiverfront: "Magic London Riverfront",
  londonShopDepthAnything: "Depth Anything Asset",
  starterCottageNight: "Starter Cottage (Night)",
  starterWorkshopNight: "Starter Workshop (Night)",
  starterHerbalistNight: "Starter Herbalist (Night)",
  twoPointCuboid: "Two-Point Cuboid",
  cottageAssetWarp: "Cottage Asset Warp",
  workshopAssetWarp: "Workshop Asset Warp",
  herbalistAssetWarp: "Herbalist Asset Warp",
  cottageDepthVsHunyuan: "Cottage · Depth vs 3D",
  cottageWallsGroundVsHunyuan: "Cottage · Walls + Ground vs 3D",
  cottageMetricIndoorSmallVsHunyuan: "Cottage · Metric Indoor Small vs 3D",
  workshopMetricIndoorSmallVsHunyuan: "Workshop · Metric Indoor Small vs 3D",
  herbalistMetricIndoorSmallVsHunyuan: "Herbalist · Metric Indoor Small vs 3D",
  workshopDepthVsHunyuan: "Workshop · Depth vs 3D",
  herbalistDepthVsHunyuan: "Herbalist · Depth vs 3D",
  connectedTerraceDay: "Voxel Terrace · Day",
  connectedTerraceNight: "Voxel Terrace · Night",
  addFloorStudy: "Voxel Terrace · Add Floor",
  grammarTownhouses: "Grammar · Townhouses",
  grammarMagicShops: "Grammar · Magic Shops",
  grammarWorkshops: "Grammar · Workshops",
  cottage: "1 × 1 Cottage",
  shop: "1 × 2 Shop",
  tower: "1 × 3 Tower",
  house: "2 × 2 House",
  park: "4 × 1 Park",
  hall: "4 × 2 Hall"
};

const modeControl = document.querySelector("#mode-control");
const presetControl = document.querySelector("#preset-control");
const cameraModeControl = document.querySelector("#camera-mode-control");
const cameraModeField = document.querySelector("#camera-mode-field");
const seedControl = document.querySelector("#seed-control");
const sliderRoot = document.querySelector("#slider-controls");
const copyButton = document.querySelector("#copy-config-button");
const randomizeButton = document.querySelector("#randomize-button");
const copyStatus = document.querySelector("#copy-status");
const apiPill = document.querySelector("#api-pill code");
const mapPanel = document.querySelector("#map-panel");
const mapPreviewRoot = document.querySelector("#map-previews");
const pipelineNote = document.querySelector("#pipeline-note");
const panelTitle = document.querySelector("#panel-title");
const cityViewerPanel = document.querySelector("#city-viewer-panel");
const cityViewerStatus = document.querySelector("#city-viewer-status");
const cityViewerAuth = document.querySelector("#city-viewer-auth");
const cityViewerToken = document.querySelector("#city-viewer-token");
const cityViewerConnect = document.querySelector("#city-viewer-connect");
const cityViewerSummary = document.querySelector("#city-viewer-summary");
const cityViewerVersion = document.querySelector("#city-viewer-version");
const cityViewerBuildings = document.querySelector("#city-viewer-buildings");
const cityViewerRoads = document.querySelector("#city-viewer-roads");
const cityViewerResources = document.querySelector("#city-viewer-resources");
const cityViewerRefresh = document.querySelector("#city-viewer-refresh");
const sliderInputs = new Map();
const sliderValues = new Map();
const cityViewerContext = resolveCityViewerContext();
if (cityViewerContext) document.documentElement.dataset.magicTownViewer = "loading";

let activeObject = null;
let activePipeline = null;
const configsByMode = {
  map: normalizeIsometricDevelopmentConfig(ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront),
  asset: normalizeIsometricAssetConfig(ISOMETRIC_ASSET_PRESETS.londonShopDepthAnything),
  vanishing: normalizeVanishingPointConfig(VANISHING_POINT_PRESETS.twoPointCuboid),
  comparison: normalizeAssetComparisonConfig(ASSET_COMPARISON_PRESETS.cottageMetricIndoorSmallVsHunyuan),
  voxel: normalizeVoxelBuildingConfig(VOXEL_BUILDING_PRESETS.connectedTerraceDay),
  parcel: normalizeParcelBlueprintConfig(PARCEL_BLUEPRINT_PRESETS.shop)
};
let currentConfig = configsByMode[currentMode];
const initialCityScenario = createStarterCityWorkbench(getIsometricDevelopmentContract(configsByMode.map), { mapSeed: configsByMode.map.seed });
let cityWorkbench = initialCityScenario.workbench;
let citySeed = configsByMode.map.seed;
let rebuildVersion = 0;
let cityViewerLoadedVersion = null;
let cityViewerLoading = false;
let cityViewerRefreshTimer = null;
const clock = new THREE.Clock();

initializeUi();
bindUi();
rebuildActive(currentConfig);
exposeAgentApi();
animate();
if (cityViewerContext) initializeCityViewer();

function initializeUi() {
  Object.entries(MODES).forEach(([mode, definition]) => {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = definition.label;
    modeControl.append(option);
  });
  modeControl.value = currentMode;
  rebuildPresetOptions();
  buildSliderUi();
}

async function rebuildActive(config) {
  const version = ++rebuildVersion;
  const definition = MODES[currentMode];
  currentConfig = definition.normalize(config);
  configsByMode[currentMode] = currentConfig;
  if (currentMode === "map" && currentConfig.seed !== citySeed) {
    cityWorkbench = createStarterCityWorkbench(getIsometricDevelopmentContract(currentConfig), { mapSeed: currentConfig.seed }).workbench;
    citySeed = currentConfig.seed;
  }
  configureCameraForViewport();

  if (activeObject) {
    scene.remove(activeObject);
    disposeObject(activeObject);
  }

  activePipeline = null;
  if (currentMode === "map") {
    activeObject = createIsometricDevelopmentWorld({ ...currentConfig, cityState: cityWorkbench.getState() });
  } else if (currentMode === "asset") {
    activePipeline = await createIsometricAssetRelief(currentConfig);
    if (version !== rebuildVersion) {
      disposeObject(activePipeline.object);
      return;
    }
    activeObject = activePipeline.object;
  } else if (currentMode === "vanishing") {
    const vanishingObject = await createVanishingPointWarpLab(currentConfig);
    if (version !== rebuildVersion) {
      disposeObject(vanishingObject);
      return;
    }
    activeObject = vanishingObject;
  } else if (currentMode === "comparison") {
    activeObject = createAssetComparisonLab(currentConfig);
  } else if (currentMode === "voxel") {
    activeObject = createVoxelBuildingLab(currentConfig);
  } else {
    activeObject = createParcelBlueprint(currentConfig);
  }

  scene.add(activeObject);
  applyWorldLighting(currentConfig.sunTime);
  configureCameraForViewport();
  document.documentElement.dataset.magicTownMode = currentMode;
  document.documentElement.dataset.magicTownConfig = JSON.stringify(currentConfig);
  document.documentElement.dataset.magicTownCityBuildings = currentMode === "map" ? String(Object.keys(cityWorkbench.getState().buildings).length) : "0";
  document.documentElement.dataset.magicTownCityRoads = currentMode === "map" ? String(Object.values(cityWorkbench.getState().cells).filter((cell) => cell.infrastructure === "road").length) : "0";
  document.documentElement.dataset.magicTownRenderedAssets = currentMode === "map" ? String(activeObject.userData.starterDistrictContract?.placements?.length ?? 0) : "0";
  document.documentElement.dataset.magicTownStarterDebug = currentMode === "map" ? JSON.stringify(activeObject.userData.starterDistrictContract ?? {}) : "{}";
  document.documentElement.dataset.magicTownHunyuanModels = currentMode === "map" ? JSON.stringify(activeObject.userData.getModelDiagnostics?.() ?? []) : "[]";
  document.documentElement.dataset.magicTownComparison = currentMode === "comparison"
    ? JSON.stringify(activeObject.userData.getComparisonDiagnostics?.() ?? {})
    : "{}";
  document.documentElement.dataset.magicTownVoxel = currentMode === "voxel"
    ? JSON.stringify(activeObject.userData.getVoxelDiagnostics?.() ?? {})
    : "{}";
  document.documentElement.dataset.magicTownVanishingError = currentMode === "vanishing"
    ? Math.max(activeObject.userData.diagnostics?.leftError ?? 0, activeObject.userData.diagnostics?.rightError ?? 0).toExponential(3)
    : "0";
  document.documentElement.dataset.magicTownVanishingVerticalDrift = currentMode === "vanishing"
    ? String(activeObject.userData.diagnostics?.verticalDrift ?? 0)
    : "0";
  document.documentElement.dataset.magicTownVanishingAssetAnchorError = currentMode === "vanishing"
    ? String(activeObject.userData.diagnostics?.anchorReconstructionError ?? 0)
    : "0";
  syncUi();
  syncMapPreview();
  syncApiPill();
}

function setMode(mode, nextConfig = null) {
  if (!MODES[mode]) return currentConfig;
  currentMode = mode;
  modeControl.value = mode;
  rebuildPresetOptions();
  buildSliderUi();
  rebuildActive(nextConfig ?? configsByMode[mode]);
  return currentConfig;
}

function addLights(targetScene) {
  const ambient = new THREE.HemisphereLight("#fff7f9", "#b8e8c7", 2.7);
  targetScene.add(ambient);

  const key = new THREE.DirectionalLight("#fff3c7", 3.1);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  targetScene.add(key);

  const rim = new THREE.DirectionalLight("#d4b4ff", 1.5);
  rim.position.set(-6, 4, -4);
  targetScene.add(rim);
  return { ambient, key, rim };
}

function applyWorldLighting(sunTime = 0.52) {
  const style = currentMode === "voxel" ? voxelDaylightStyle(sunTime) : getDaylightStyle(sunTime);
  scene.background.copy(style.skyColor);
  worldLights.ambient.color.copy(style.ambientSky);
  worldLights.ambient.groundColor.copy(style.ambientGround);
  worldLights.ambient.intensity = style.ambientIntensity;
  worldLights.key.color.copy(style.sunColor);
  worldLights.key.intensity = style.sunIntensity;
  worldLights.key.position.copy(style.sunPosition);
  worldLights.rim.color.copy(style.rgbTint);
  worldLights.rim.intensity = style.rimIntensity;
  activeObject?.userData.updateDaylight?.(style);
}

function rebuildPresetOptions() {
  presetControl.replaceChildren();
  const presets = MODES[currentMode].presets;
  Object.keys(presets).forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = presetLabels[name] ?? titleCase(name);
    presetControl.append(option);
  });
  presetControl.value = findPresetName(currentConfig) ?? MODES[currentMode].defaultPreset;
}

function buildSliderUi() {
  sliderRoot.replaceChildren();
  sliderInputs.clear();
  sliderValues.clear();

  MODES[currentMode].sliders.forEach((definition) => {
    const isSelect = definition.control === "select";
    const label = document.createElement("label");
    label.className = isSelect ? "field" : "slider-field";
    label.htmlFor = `${definition.key}-control`;

    const top = document.createElement("span");
    if (!isSelect) top.className = "slider-label";

    const labelText = document.createElement("span");
    labelText.textContent = definition.label;
    const valueText = document.createElement("strong");
    top.append(labelText);
    if (!isSelect) top.append(valueText);

    const input = document.createElement(isSelect ? "select" : "input");
    input.id = `${definition.key}-control`;
    if (isSelect) {
      definition.options.forEach(({ value, label: optionLabel }) => {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = optionLabel;
        input.append(option);
      });
    } else {
      input.type = "range";
      input.min = definition.min;
      input.max = definition.max;
      input.step = definition.step;
    }
    input.addEventListener(isSelect ? "change" : "input", () => {
      if (definition.key === "sunTime") {
        currentConfig = { ...currentConfig, sunTime: Number(input.value) };
        configsByMode[currentMode] = currentConfig;
        if (activeObject?.userData.config) activeObject.userData.config.sunTime = currentConfig.sunTime;
        document.documentElement.dataset.magicTownConfig = JSON.stringify(currentConfig);
        applyWorldLighting(currentConfig.sunTime);
        syncUi();
        syncApiPill();
        return;
      }
      if (definition.live && activeObject?.userData?.updateComparisonConfig) {
        currentConfig = activeObject.userData.updateComparisonConfig({ [definition.key]: Number(input.value) });
        configsByMode[currentMode] = currentConfig;
        document.documentElement.dataset.magicTownConfig = JSON.stringify(currentConfig);
        document.documentElement.dataset.magicTownComparison = JSON.stringify(activeObject.userData.getComparisonDiagnostics?.() ?? {});
        syncUi();
        syncApiPill();
        return;
      }
      const value = Number(input.value);
      const selectedOption = definition.options?.find((option) => Number(option.value) === value);
      const patch = definition.aliasKey
        ? {
          [definition.key]: value,
          [definition.aliasKey]: selectedOption?.configValue
        }
        : { [definition.key]: value };
      rebuildActive({ ...currentConfig, ...patch });
    });

    if (!isSelect) sliderValues.set(definition.key, valueText);
    sliderInputs.set(definition.key, input);
    label.append(top, input);
    sliderRoot.append(label);
  });
}

function bindUi() {
  modeControl.addEventListener("change", () => {
    setMode(modeControl.value);
  });

  presetControl.addEventListener("change", () => {
    const preset = MODES[currentMode].presets[presetControl.value] ?? MODES[currentMode].presets[MODES[currentMode].defaultPreset];
    rebuildActive({ ...preset, seed: preset.seed });
  });

  cameraModeControl.addEventListener("change", () => {
    if (currentMode !== "map") return;
    rebuildActive({ ...currentConfig, cameraMode: cameraModeControl.value });
  });

  seedControl.addEventListener("change", () => {
    rebuildActive({ ...currentConfig, seed: seedControl.value || `${currentMode}-wand-001` });
  });

  randomizeButton.addEventListener("click", () => {
    const seed = `${currentMode}-${Math.floor(Math.random() * 99999).toString().padStart(5, "0")}`;
    rebuildActive(MODES[currentMode].randomize(seed));
  });

  copyButton.addEventListener("click", async () => {
    const payload = JSON.stringify(createCopyPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      copyStatus.textContent = "Copied";
    } catch {
      copyStatus.textContent = payload;
    }
    window.setTimeout(() => {
      copyStatus.textContent = "";
    }, 1800);
  });

  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    edgePanPointer.x = (event.clientX - rect.left) / rect.width;
    edgePanPointer.y = (event.clientY - rect.top) / rect.height;
    edgePanPointer.active = true;
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    edgePanPointer.active = false;
  });
}

function resolveCityViewerContext() {
  const match = /^\/cities\/([^/]+)\/?$/.exec(window.location.pathname);
  if (!match) return null;
  const cityId = decodeURIComponent(match[1]);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = hash.get("token") || sessionStorage.getItem("mtToken") || "";
  if (hash.has("token")) {
    sessionStorage.setItem("mtToken", token);
    history.replaceState(null, "", window.location.pathname);
  }
  sessionStorage.setItem("mtCity", cityId);
  return { cityId, token };
}

function initializeCityViewer() {
  cityViewerPanel.hidden = false;
  cityViewerToken.value = cityViewerContext.token;
  cityViewerConnect.addEventListener("click", () => {
    const token = cityViewerToken.value.trim();
    if (!token) return;
    cityViewerContext.token = token;
    sessionStorage.setItem("mtToken", token);
    loadCityViewerState({ force: true });
  });
  cityViewerRefresh.addEventListener("click", () => loadCityViewerState({ force: true }));
  window.addEventListener("focus", () => loadCityViewerState());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadCityViewerState();
  });
  if (cityViewerContext.token) loadCityViewerState({ force: true });
  else showCityViewerAuth("请输入玩家或只读访问凭证。");
  cityViewerRefreshTimer = window.setInterval(() => {
    if (!document.hidden) loadCityViewerState();
  }, 5000);
}

async function loadCityViewerState({ force = false } = {}) {
  if (cityViewerLoading || !cityViewerContext?.token) return;
  cityViewerLoading = true;
  cityViewerStatus.textContent = cityViewerLoadedVersion === null ? "正在连接城市存档…" : "正在检查城市变化…";
  try {
    const response = await fetch(`/api/v1/cities/${encodeURIComponent(cityViewerContext.cityId)}/render-state`, {
      headers: { Authorization: `Bearer ${cityViewerContext.token}` },
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${payload.code ?? response.status}: ${payload.message ?? "无法读取城市"}`);
    if (force || payload.city_version !== cityViewerLoadedVersion) {
      cityWorkbench = createCityWorkbench(payload.state);
      citySeed = payload.state.mapSeed ?? configsByMode.map.seed;
      const viewerConfig = normalizeIsometricDevelopmentConfig({
        ...ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront,
        seed: citySeed,
        mapCurvature: 0,
        perspective: 0,
        useHunyuanModels: 0,
        buildingParallaxStrength: 0.12,
        cameraMode: "play"
      });
      configsByMode.map = viewerConfig;
      currentMode = "map";
      await rebuildActive(viewerConfig);
      cityViewerLoadedVersion = payload.city_version;
    }
    renderCityViewerSummary(payload);
    document.documentElement.dataset.magicTownViewer = "ready";
  } catch (error) {
    showCityViewerAuth(error.message);
  } finally {
    cityViewerLoading = false;
  }
}

function renderCityViewerSummary(payload) {
  const state = payload.state;
  const buildingCount = Object.keys(state.buildings ?? {}).length;
  const roadCount = Object.values(state.cells ?? {}).filter((cell) => cell.infrastructure === "road").length;
  panelTitle.textContent = payload.name;
  cityViewerVersion.textContent = String(payload.city_version);
  cityViewerBuildings.textContent = String(buildingCount);
  cityViewerRoads.textContent = String(roadCount);
  cityViewerResources.replaceChildren(...Object.entries(state.resources ?? {}).map(([name, value]) => {
    const item = document.createElement("span");
    item.textContent = `${name} ${value}`;
    return item;
  }));
  cityViewerSummary.hidden = false;
  cityViewerAuth.hidden = true;
  cityViewerStatus.textContent = `已同步 · 城市时间 ${state.elapsedHours ?? 0} 小时 · 每 5 秒自动检查`;
}

function showCityViewerAuth(message) {
  document.documentElement.dataset.magicTownViewer = "auth";
  cityViewerStatus.textContent = message;
  cityViewerAuth.hidden = false;
  cityViewerSummary.hidden = true;
  cityViewerToken.value = cityViewerContext?.token ?? "";
}

function syncUi() {
  modeControl.value = currentMode;
  seedControl.value = currentConfig.seed;
  mapPanel.hidden = !activePipeline;
  pipelineNote.hidden = !activePipeline;
  cameraModeField.hidden = currentMode !== "map";
  cameraModeControl.value = currentConfig.cameraMode ?? "play";

  MODES[currentMode].sliders.forEach((definition) => {
    const { key } = definition;
    const input = sliderInputs.get(key);
    const value = currentConfig[key];
    input.value = value;
    if (definition.control !== "select") {
      sliderValues.get(key).textContent = formatSliderValue(value, input.step);
    }
  });
}

function syncMapPreview() {
  mapPreviewRoot.replaceChildren();
  if (!activePipeline) return;

  const previews =
    activePipeline.maps.previews ??
    [
      ["Color", activePipeline.maps.facade.color],
      ["Depth", activePipeline.maps.facade.depth],
      ["Normal", activePipeline.maps.facade.normal],
      ["Ground", activePipeline.maps.ground.color]
    ];

  previews.forEach(([label, canvas]) => {
    const item = document.createElement("figure");
    item.className = "map-preview";
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = canvas.width;
    previewCanvas.height = canvas.height;
    previewCanvas.getContext("2d").drawImage(canvas, 0, 0);
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    item.append(previewCanvas, caption);
    mapPreviewRoot.append(item);
  });
}

function syncApiPill() {
  if (currentMode === "map") {
    apiPill.textContent = "MagicTown.generateDevelopmentMap({ developmentColumns, developmentRows, mapCurvature, perspective, showGrid })";
  } else if (currentMode === "asset") {
    apiPill.textContent = "MagicTown.generateIsometricAsset({ parallaxStrength, parallaxViewX, parallaxViewY, viewYaw })";
  } else if (currentMode === "vanishing") {
    apiPill.textContent = "MagicTown.previewVanishingWarp({ leftVanishingDistance, rightVanishingDistance, footprintWidth, footprintDepth })";
  } else if (currentMode === "comparison") {
    apiPill.textContent = "MagicTown.compareAssetRepresentations({ depthStrength, comparisonYaw, showBounds, depthWireframe })";
  } else if (currentMode === "voxel") {
    apiPill.textContent = "MagicTown.generateVoxelStreet({ archetype: 'magic_shop', style: 'violet_alchemist', parcelWidth, parcelDepth, floors, roofType, variation, seed })";
  } else {
    apiPill.textContent = `MagicTown.previewParcel({ footprint: '${currentConfig.footprint}', floors: ${currentConfig.floors}, maxHeight: ${currentConfig.maxHeight} })`;
  }
}

function exposeAgentApi() {
  const api = {
    modes: Object.keys(MODES),
    presets: {
      map: ISOMETRIC_DEVELOPMENT_PRESETS,
      asset: ISOMETRIC_ASSET_PRESETS,
      vanishing: VANISHING_POINT_PRESETS,
      comparison: ASSET_COMPARISON_PRESETS,
      voxel: VOXEL_BUILDING_PRESETS,
      parcel: PARCEL_BLUEPRINT_PRESETS
    },
    setMode(mode) {
      return setMode(mode);
    },
    generate(config = {}) {
      const inferredMode = inferMode(config);
      setMode(inferredMode, { ...configsByMode[inferredMode], ...config, mode: undefined });
      return this.getParams();
    },
    generateDevelopmentMap(config = {}) {
      setMode("map", { ...configsByMode.map, ...config });
      return this.getParams();
    },
    setGridVisible(visible = true) {
      setMode("map", { ...configsByMode.map, showGrid: visible ? 1 : 0 });
      return this.getParams();
    },
    setCameraMode(cameraMode = "play") {
      setMode("map", { ...configsByMode.map, cameraMode });
      return this.getParams();
    },
    generateIsometricAsset(config = {}) {
      setMode("asset", { ...configsByMode.asset, ...config });
      return this.getParams();
    },
    previewVanishingWarp(config = {}) {
      setMode("vanishing", { ...configsByMode.vanishing, ...config });
      return this.getParams();
    },
    compareAssetRepresentations(config = {}) {
      setMode("comparison", { ...configsByMode.comparison, ...config });
      return this.getParams();
    },
    generateVoxelStreet(config = {}) {
      setMode("voxel", { ...configsByMode.voxel, ...config });
      return this.getParams();
    },
    previewParcel(config = {}) {
      setMode("parcel", { ...configsByMode.parcel, ...config });
      return this.getParams();
    },
    setParams(config = {}) {
      return this.generate(config);
    },
    setPreset(name = MODES[currentMode].defaultPreset, overrides = {}) {
      const mode = MODES.asset.presets[name]
        ? "asset"
        : MODES.vanishing.presets[name]
          ? "vanishing"
          : MODES.comparison.presets[name]
            ? "comparison"
            : MODES.voxel.presets[name]
              ? "voxel"
              : MODES.parcel.presets[name]
                ? "parcel"
                : currentMode;
      const preset = MODES[mode].presets[name] ?? MODES[mode].presets[MODES[mode].defaultPreset];
      setMode(mode, { ...preset, ...overrides });
      return this.getParams();
    },
    randomize(seed = Date.now(), mode = currentMode) {
      const nextMode = MODES[mode] ? mode : currentMode;
      setMode(nextMode, MODES[nextMode].randomize(seed));
      return this.getParams();
    },
    getParams() {
      return {
        mode: currentMode,
        config: JSON.parse(JSON.stringify(currentConfig))
      };
    },
    getObject() {
      return activeObject;
    },
    getPipelineMaps() {
      return activePipeline?.maps ?? null;
    },
    getParcelContract(config = configsByMode.parcel) {
      return getParcelContract(config);
    },
    getParcelGuideSpec(config = configsByMode.parcel) {
      const contract = getParcelContract(config);
      const { length, width, height } = contract.dimensions;
      return {
        contract,
        command: `python scripts/generate_parcel_guide.py --dimensions ${length}x${width}x${height} --entrance south --out public/generated/guides/${length}x${width}x${height}.png`
      };
    },
    getParcelPrompt(config = configsByMode.parcel) {
      return buildParcelPrompt(config);
    },
    getVanishingPointContract(config = configsByMode.vanishing) {
      return getVanishingPointWarpContract(config);
    },
    getAssetComparisonContract(config = configsByMode.comparison) {
      return getAssetComparisonContract(config);
    },
    getVoxelBuildingContract(config = configsByMode.voxel) {
      return getVoxelBuildingContract(config);
    },
    createVoxelBuildingSpec(options = {}) {
      return createBuildingSpec(options);
    },
    getVoxelGrammarCatalog() {
      return {
        specVersion: BUILDING_SPEC_VERSION,
        archetypes: structuredClone(BUILDING_ARCHETYPES),
        styleKits: structuredClone(VOXEL_STYLE_KITS)
      };
    },
    getWorldContract(config = configsByMode.map) {
      return getIsometricDevelopmentContract(config);
    },
    getBaseTileContract() {
      return activeObject?.userData?.baseTileContract ?? null;
    },
    getStarterDistrictContract() {
      return activeObject?.userData?.starterDistrictContract ?? null;
    },
    getBaseFitDiagnostics() {
      return activeObject?.userData?.getBaseFitDiagnostics?.() ?? null;
    },
    resetCity(options = {}) {
      cityWorkbench = createCityWorkbench(createCityState(getIsometricDevelopmentContract(configsByMode.map), { ...options, mapSeed: configsByMode.map.seed }));
      if (currentMode === "map") rebuildActive(currentConfig);
      return cityWorkbench.getState();
    },
    getCityState() {
      return cityWorkbench.getState();
    },
    getAssetRegistry() {
      return getAssetRegistry();
    },
    findAssetCandidates(criteria = {}) {
      return findAssetCandidates(criteria);
    },
    resolveAsset(assetId) {
      return resolveAsset(assetId);
    },
    getModelOrientationPreviews(assetId) {
      return getModelOrientationPreviewUrls(assetId);
    },
    findCandidateParcels(criteria = {}) {
      return cityWorkbench.findCandidateParcels(criteria);
    },
    previewConstruction(proposal) {
      return cityWorkbench.previewConstruction(proposal);
    },
    submitConstruction(proposal) {
      const result = cityWorkbench.submitConstruction(proposal);
      if (result.accepted && currentMode === "map") rebuildActive(currentConfig);
      return result;
    },
    connectRoad(connection) {
      const result = cityWorkbench.connectRoad(connection);
      if (result.accepted && currentMode === "map") rebuildActive(currentConfig);
      return result;
    }
  };

  Object.defineProperty(window, "MagicTown", {
    value: api,
    writable: true,
    configurable: true
  });
  document.documentElement.dataset.magicTownApi = "ready";
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  updatePlayCamera(delta);

  if (activeObject) {
    activeObject.userData?.update?.(elapsed);
    if (activeObject.userData?.updateParallax) {
      activeObject.userData.updateParallax(camera);
    }
    activeObject.traverse((object) => {
      if (!object.userData) return;
      if (object.userData.spin) {
        object.rotation.y += object.userData.spin * 0.01;
      }
      if (object.userData.float) {
        const origin = object.userData.floatOriginY ?? object.position.y;
        const phase = object.userData.floatPhase ?? 0;
        object.position.y = origin + Math.sin(elapsed * 1.7 + phase) * object.userData.float * 0.12;
      }
      if (object.userData.waterWave) {
        const wave = object.userData.waterWave;
        const pulse = Math.sin(elapsed * wave.speed + wave.phase);
        object.position.y = wave.baseY + pulse * 0.025;
        if (object.material) object.material.opacity = wave.opacity * (0.72 + pulse * 0.18);
      }
    });
  }

  if (currentMode === "map") {
    document.documentElement.dataset.magicTownHunyuanModels = JSON.stringify(activeObject?.userData?.getModelDiagnostics?.() ?? []);
  } else if (currentMode === "comparison") {
    document.documentElement.dataset.magicTownComparison = JSON.stringify(activeObject?.userData?.getComparisonDiagnostics?.() ?? {});
  }

  controls.update();
  conformPlayCameraToTerrain();
  camera.updateMatrixWorld();
  const baseFitDiagnostics = activeObject?.userData?.updateBaseFit?.(
    camera,
    currentMode === "map" && currentConfig?.cameraMode === "play",
    {
      width: renderer.domElement.clientWidth,
      height: renderer.domElement.clientHeight,
      focusWorld: controls.target.toArray()
    }
  );
  if (baseFitDiagnostics) {
    document.documentElement.dataset.magicTownBaseFitEnabled = String(baseFitDiagnostics.enabled);
    document.documentElement.dataset.magicTownBaseFitErrorPx = baseFitDiagnostics.maxAnchorErrorPx.toFixed(6);
    document.documentElement.dataset.magicTownBaseFitSprites = String(baseFitDiagnostics.spriteCount);
    document.documentElement.dataset.magicTownUprightErrorDeg = baseFitDiagnostics.maxUprightDeviationDegrees.toFixed(6);
    document.documentElement.dataset.magicTownDepthParallax = String(baseFitDiagnostics.depthParallaxEnabled);
    document.documentElement.dataset.magicTownParallaxViewOffset = baseFitDiagnostics.maxParallaxViewOffset.toFixed(6);
    document.documentElement.dataset.magicTownParallaxUvShift = baseFitDiagnostics.maxParallaxUvShift.toFixed(6);
    document.documentElement.dataset.magicTownUprightScaleRange = baseFitDiagnostics.uprightScaleRatioRange.map((value) => value.toFixed(4)).join(",");
  } else {
    delete document.documentElement.dataset.magicTownBaseFitEnabled;
    delete document.documentElement.dataset.magicTownBaseFitErrorPx;
    delete document.documentElement.dataset.magicTownBaseFitSprites;
    delete document.documentElement.dataset.magicTownUprightErrorDeg;
    delete document.documentElement.dataset.magicTownDepthParallax;
    delete document.documentElement.dataset.magicTownParallaxViewOffset;
    delete document.documentElement.dataset.magicTownParallaxUvShift;
    delete document.documentElement.dataset.magicTownUprightScaleRange;
  }
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  configureCameraForViewport();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function configureCameraForViewport() {
  const isMap = currentMode === "map";
  const isParcel = currentMode === "parcel";
  const isVanishing = currentMode === "vanishing";
  const isVoxel = currentMode === "voxel";
  const perspective = isMap ? currentConfig?.perspective ?? 0 : 0;
  if (isParcel || isVanishing || isVoxel || (isMap && perspective <= 0.001)) {
    const aspect = window.innerWidth / window.innerHeight;
    const span = isMap
      ? Math.max(150, (currentConfig?.mapSize ?? 180) * 1.12)
      : isVanishing
        ? 10
        : isVoxel
          ? Math.max(15, (currentConfig?.buildingCount ?? 3) * 4 + 8)
          : Math.max(currentConfig?.columns ?? 1, currentConfig?.rows ?? 2) * 4 + 8;
    if (!camera.isOrthographicCamera) {
      controls.dispose();
      camera = new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, 0.1, 2200);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
    }
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    const groundY = isMap ? getMapGroundHeight(0, -1) : (currentConfig?.maxHeight ?? 8) * 0.32;
    if (isVanishing) {
      camera.position.set(-3, 0, 30);
      controls.target.set(-3, 0, 0);
    } else if (isVoxel) {
      camera.position.set(18, 14.5, 22);
      controls.target.set(0, 5.4, 0.4);
    } else {
      camera.position.set(isMap ? 124 : 11, isMap ? groundY + 152 : 22.2, isMap ? 124 : 11);
      controls.target.set(0, groundY, isMap ? -1 : 0);
    }
    controls.maxDistance = 900;
    syncCameraInteraction();
    camera.updateProjectionMatrix();
    return;
  }

  if (isMap) {
    if (camera.isOrthographicCamera) {
      controls.dispose();
      camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 30000);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
    }
    const span = Math.max(150, (currentConfig?.mapSize ?? 180) * 1.12);
    const fov = THREE.MathUtils.lerp(0.8, 46, perspective);
    const distance = (span / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2))) * 1.08;
    const target = new THREE.Vector3(0, getMapGroundHeight(0, -1), -1);
    const direction = new THREE.Vector3(0.62, 0.76, 0.62).normalize();
    camera.fov = fov;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.near = 0.1;
    camera.far = Math.max(30000, distance * 4);
    camera.position.copy(target).addScaledVector(direction, distance);
    controls.target.copy(target);
    controls.minDistance = 18;
    controls.maxDistance = distance * 2;
    syncCameraInteraction();
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.isOrthographicCamera) {
    controls.dispose();
    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 2200);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
  }
  const narrow = window.innerWidth <= 720;
  const assetPreview = currentMode === "asset";
  const comparisonPreview = currentMode === "comparison";
  camera.fov = comparisonPreview ? (narrow ? 52 : 42) : narrow ? 48 : 38;
  camera.position.set(
    comparisonPreview ? (narrow ? 10.5 : 11.5) : narrow ? (assetPreview ? 19 : 48) : assetPreview ? 24 : 55,
    comparisonPreview ? (narrow ? 8.5 : 8.2) : narrow ? (assetPreview ? 15 : 38) : assetPreview ? 19 : 42,
    comparisonPreview ? (narrow ? 18 : 14.5) : narrow ? (assetPreview ? 22 : 54) : assetPreview ? 27 : 60
  );
  controls.target.set(0, comparisonPreview ? 2 : assetPreview ? 1.4 : 0.2, comparisonPreview ? 0 : 0.2);
  controls.minDistance = comparisonPreview ? 8 : 0;
  controls.maxDistance = comparisonPreview ? 40 : 900;
  syncCameraInteraction();
  camera.updateProjectionMatrix();
}

function syncCameraInteraction() {
  const playMode = currentMode === "map" && currentConfig?.cameraMode === "play";
  const flatProjectionLab = currentMode === "vanishing";
  controls.enableRotate = !playMode && !flatProjectionLab;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableDamping = !playMode;
  controls.mouseButtons.LEFT = playMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

function getMapGroundHeight(x, z) {
  return activeObject?.userData?.sampleGroundHeight?.(x, z) ?? 0;
}

function updatePlayCamera(delta) {
  if (currentMode !== "map" || currentConfig?.cameraMode !== "play" || !edgePanPointer.active) return;
  const edge = 0.075;
  const horizontal = edgePanPointer.x < edge
    ? -(edge - edgePanPointer.x) / edge
    : edgePanPointer.x > 1 - edge
      ? (edgePanPointer.x - (1 - edge)) / edge
      : 0;
  const vertical = edgePanPointer.y < edge
    ? (edge - edgePanPointer.y) / edge
    : edgePanPointer.y > 1 - edge
      ? -(edgePanPointer.y - (1 - edge)) / edge
      : 0;
  if (horizontal === 0 && vertical === 0) return;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const speed = (currentConfig.mapSize ?? 144) * 0.18;
  const previousTarget = controls.target.clone();
  const nextTarget = previousTarget.clone()
    .addScaledVector(right, horizontal * speed * delta)
    .addScaledVector(forward, vertical * speed * delta);
  const limit = (currentConfig.mapSize ?? 144) * 0.43;
  nextTarget.x = THREE.MathUtils.clamp(nextTarget.x, -limit, limit);
  nextTarget.z = THREE.MathUtils.clamp(nextTarget.z, -limit, limit);
  nextTarget.y = getMapGroundHeight(nextTarget.x, nextTarget.z);
  camera.position.add(nextTarget.clone().sub(previousTarget));
  controls.target.copy(nextTarget);
}

function conformPlayCameraToTerrain() {
  if (currentMode !== "map" || currentConfig?.cameraMode !== "play") return;
  const target = controls.target;
  const groundY = getMapGroundHeight(target.x, target.z);
  const deltaY = groundY - target.y;
  if (Math.abs(deltaY) < 0.0001) return;
  target.y = groundY;
  camera.position.y += deltaY;
}

function createCopyPayload() {
  if (currentMode === "map") {
    return getIsometricDevelopmentContract(currentConfig);
  }
  if (currentMode === "parcel") {
    return getParcelContract(currentConfig);
  }
  if (currentMode === "asset") {
    return {
      mode: currentMode,
      config: currentConfig,
      depthProvider: activeObject?.userData?.pipeline ?? null,
      maps: currentConfig
    };
  }
  if (currentMode === "vanishing") return getVanishingPointWarpContract(currentConfig);
  if (currentMode === "comparison") return getAssetComparisonContract(currentConfig);
  if (currentMode === "voxel") return getVoxelBuildingContract(currentConfig);
  return {
    mode: currentMode,
    config: currentConfig
  };
}

function inferMode(config) {
  if (config.mode && MODES[config.mode]) return config.mode;
  if ("mapId" in config || "developmentColumns" in config || "developmentRows" in config || "cameraMode" in config || "perspective" in config || "showGrid" in config || "trainSpeed" in config) return "map";
  if ("leftVanishingDistance" in config || "rightVanishingDistance" in config || "footprintWidth" in config || "footprintDepth" in config) return "vanishing";
  if ("comparisonYaw" in config || "depthStrength" in config || "depthWireframe" in config || "showBounds" in config) return "comparison";
  if (
    "buildingCount" in config
    || "expansionFloors" in config
    || "roofVariant" in config
    || "materialScheme" in config
    || "archetype" in config
    || "archetypeVariant" in config
    || "style" in config
    || "styleVariant" in config
    || "roofType" in config
    || "parcelWidth" in config
    || "parcelDepth" in config
    || "variation" in config
    || "detailDensity" in config
  ) return "voxel";
  if ("footprint" in config || "maxHeight" in config) return "parcel";
  if ("parallaxStrength" in config || "reliefStrength" in config || "meshResolution" in config || "colorPath" in config || "depthPath" in config) return "asset";
  return currentMode;
}

function findPresetName(config) {
  const presets = MODES[currentMode].presets;
  return Object.entries(presets).find(([, preset]) => preset.seed === config.seed)?.[0] ?? null;
}

function formatSliderValue(value, step) {
  return Number(value).toFixed(String(step).includes(".") ? 2 : 0);
}

function titleCase(value) {
  return value.replace(/(^|-)(\w)/g, (_, separator, char) => `${separator ? " " : ""}${char.toUpperCase()}`);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (child.userData?.textures) {
          child.userData.textures.forEach((texture) => texture.dispose());
        }
        Object.values(material).forEach((value) => {
          if (value && typeof value.dispose === "function") value.dispose();
        });
        material.dispose();
      });
    }
  });
}
