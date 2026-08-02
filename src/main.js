import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
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
  CORNER_FACADE_MODE_IDS,
  VOXEL_BUILDING_PRESETS,
  createVoxelBuildingLab,
  createVoxelMassingLab,
  getVoxelBuildingContract,
  normalizeVoxelBuildingConfig,
  voxelDaylightStyle
} from "./generators/voxelBuildingLab.js";
import {
  BUILDING_ARCHETYPES,
  BUILDING_SPEC_VERSION,
  FLOOR_BALCONY_IDS,
  FLOOR_USE_IDS,
  ROOF_FORM_IDS,
  VOXEL_STYLE_KITS,
  createBuildingSpec
} from "./generators/voxelBuildingGrammar.js";
import {
  VOXEL_MASSING_PRESETS,
  createUrbanMassingSpec,
  getUrbanMassingCatalog,
  normalizeVoxelMassingConfig
} from "./generators/voxelMassingGrammar.js";
import {
  createExplorerRandomMassingConfig,
  createVoxelMassingExplorer
} from "./generators/voxelMassingExplorer.js";
import {
  adaptBuildingIntentToMassingConfig,
  adaptBuildingIntentToStreetConfig,
  getBuildingIntentCatalog,
  normalizeBuildingIntent
} from "./generators/buildingIntent.js";
import {
  VOXEL_INTENT_DISTRICT_PRESETS,
  createRandomVoxelIntentDistrictConfig,
  createVoxelIntentDistrict,
  getVoxelSphereFrame,
  normalizeVoxelIntentDistrictConfig
} from "./generators/voxelIntentDistrict.js";
import { createCityState } from "./city/state.js";
import { createCityWorkbench } from "./city/workbench.js";
import { createStarterCityWorkbench } from "./city/scenarios.js";
import { findAssetCandidates, getAssetRegistry, resolveAsset } from "./city/assets.js";
import { getModelOrientationPreviewUrls } from "./generators/modelOrientation.js";
import { createAgentAcceptanceCity } from "./generators/agentAcceptanceCity.js";

const app = document.querySelector("#app");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#fff3f8");

const startupParams = new URLSearchParams(window.location.search);
const startupMode = startupParams.get("mode");
if (startupParams.get("view") === "1") document.documentElement.dataset.magicTownPresentation = "true";
let currentMode = ["map", "district", "agentcity"].includes(startupMode) ? startupMode : "map";
let camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 2200);
camera.position.set(7.8, 5.5, 9.5);

const mobilePerformanceProfile = window.matchMedia("(pointer: coarse)").matches
  || Math.min(window.innerWidth, window.innerHeight) <= 820;
const renderQuality = {
  mobile: mobilePerformanceProfile,
  minPixelRatio: 1,
  maxPixelRatio: mobilePerformanceProfile ? 1.75 : 2,
  pixelRatio: Math.min(window.devicePixelRatio, mobilePerformanceProfile ? 1.5 : 1.75),
  averageFrameMs: 16.67,
  stableFrames: 0,
  lastAdjustmentMs: 0
};
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
renderer.setPixelRatio(renderQuality.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = mobilePerformanceProfile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const districtBokehDefaults = {
  aperture: mobilePerformanceProfile ? 0.0002 : 0.00028,
  maxblur: mobilePerformanceProfile ? 0.004 : 0.006
};
const districtDepthOfField = new BokehPass(scene, camera, {
  focus: 60,
  aperture: districtBokehDefaults.aperture,
  maxblur: districtBokehDefaults.maxblur
});
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(districtDepthOfField);
composer.addPass(outputPass);
composer.setPixelRatio(renderQuality.pixelRatio);

const edgePanPointer = { x: 0, y: 0, active: false };
const districtSurfacePointer = { id: null, x: 0, y: 0, startX: 0, startY: 0, moved: false, pointerType: "" };
const districtViewGesture = { lastTapTime: 0, lastTapX: 0, lastTapY: 0, lastTouchToggleAt: 0 };
const districtSurfaceNavigation = {
  initialized: false,
  flatX: 2.5,
  flatZ: -5,
  radius: null,
  radialDistance: null,
  cameraScale: 1,
  nearScale: 1,
  farScale: 1.9,
  targetCameraScale: 1,
  viewMode: "near"
};

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
      const styleVariant = Math.floor(Math.random() * 3);
      const roofForm = ROOF_FORM_IDS[Math.floor(Math.random() * ROOF_FORM_IDS.length)];
      const cornerFacades = CORNER_FACADE_MODE_IDS[Math.floor(Math.random() * CORNER_FACADE_MODE_IDS.length)];
      const floors = 1 + Math.floor(Math.random() * 5);
      const groundPurpose = ["shop", "home", "workshop"][Math.floor(Math.random() * 3)];
      const floorPrograms = Array.from({ length: floors }, (_, index) => {
        const purpose = index === 0
          ? groundPurpose
          : ["home", "home", "workshop", "storage"][Math.floor(Math.random() * 4)];
        const windowRange = {
          shop: [0.68, 0.9],
          home: [0.22, 0.52],
          workshop: [0.42, 0.72],
          storage: [0.15, 0.34]
        }[purpose];
        return {
          purpose,
          setbackVoxels: index === 0 ? 0 : [0, 0, 2, 4][Math.floor(Math.random() * 4)],
          balcony: index === 0 ? "none" : ["none", "none", "selective", "full"][Math.floor(Math.random() * 4)],
          windowRatio: windowRange[0] + Math.random() * (windowRange[1] - windowRange[0])
        };
      });
      return normalizeVoxelBuildingConfig({
        ...VOXEL_BUILDING_PRESETS.connectedTerraceDay,
        seed,
        floors,
        floorPrograms,
        styleVariant,
        style: ["london_brick", "violet_alchemist", "forest_craft"][styleVariant],
        materialScheme: styleVariant,
        roofForm,
        cornerFacades,
        ridgePosition: Math.random(),
        windowRatio: 0.2 + Math.random() * 0.65,
        variation: 0.35 + Math.random() * 0.65,
        parcelWidth: 24 + Math.floor(Math.random() * 5) * 4,
        parcelDepth: 28 + Math.floor(Math.random() * 5) * 4
      });
    },
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 },
      { key: "buildingCount", label: "Connected Buildings", min: 1, max: 3, step: 1 },
      { key: "floors", label: "Base Floors", min: 1, max: 5, step: 1 },
      { key: "expansionFloors", label: "Add Floors", min: 0, max: 2, step: 1 },
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
        key: "roofForm",
        label: "Roof Form",
        control: "select",
        valueType: "string",
        options: [
          { value: "gable_street", label: "Gable · Street Ridge" },
          { value: "gable_cross", label: "Gable · Cross Ridge" },
          { value: "hip", label: "Hip · Four Slopes" }
        ]
      },
      {
        key: "ridgePosition",
        label: "Ridge Position",
        min: 0,
        max: 1,
        step: 0.01,
        format: "percent",
        visible: (config) => config.roofForm !== "hip"
      },
      {
        key: "cornerFacades",
        label: "Corner Facades",
        control: "select",
        valueType: "string",
        options: [
          { value: "none", label: "None · Blank Sides" },
          { value: "left", label: "Left Corner" },
          { value: "right", label: "Right Corner" },
          { value: "both", label: "Both Corners" }
        ]
      },
      { key: "parcelWidth", label: "Parcel Width", min: 24, max: 40, step: 4 },
      { key: "parcelDepth", label: "Parcel Depth", min: 28, max: 44, step: 4 },
      { key: "variation", label: "Grammar Variation", min: 0, max: 1, step: 0.01 },
      { key: "detailDensity", label: "Decoration", min: 0, max: 1, step: 0.01 },
      ...createVoxelFloorControlDefinitions()
    ]
  },
  massing: {
    label: "Voxel Massing Grammar",
    presets: VOXEL_MASSING_PRESETS,
    defaultPreset: "minimumCapabilityStudy",
    normalize: normalizeVoxelMassingConfig,
    randomize: (seed) => createExplorerRandomMassingConfig(seed, {}, "all"),
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 }
    ]
  },
  district: {
    label: "Agent Intent District",
    presets: VOXEL_INTENT_DISTRICT_PRESETS,
    defaultPreset: "agentQuarterDay",
    normalize: normalizeVoxelIntentDistrictConfig,
    randomize: (seed) => createRandomVoxelIntentDistrictConfig(seed, configsByMode.district),
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 },
      { key: "bokehStrength", label: "Focus Falloff", min: 0, max: 4, step: 0.01, live: true },
      { key: "bokehBlur", label: "Miniature Blur", min: 0, max: 6, step: 0.01, live: true },
      { key: "magicBias", label: "District Magic", min: -0.35, max: 0.35, step: 0.01 },
      { key: "planetRadius", label: "Voxel Planet Radius", min: 30, max: 480, step: 1 },
      { key: "vegetationDensity", label: "Voxel Vegetation", min: 0, max: 1, step: 0.01 }
    ]
  },
  agentcity: {
    label: "Agent City Visual Acceptance",
    presets: VOXEL_INTENT_DISTRICT_PRESETS,
    defaultPreset: "agentQuarterDay",
    normalize: normalizeVoxelIntentDistrictConfig,
    randomize: (seed) => normalizeVoxelIntentDistrictConfig({ ...configsByMode.agentcity, seed, acceptanceSeed: seed }),
    sliders: [
      { key: "sunTime", label: "Sun Time", min: 0, max: 1, step: 0.01 },
      { key: "nightLighting", label: "Night Lights", min: 0, max: 1, step: 0.01 },
      { key: "bokehStrength", label: "Focus Falloff", min: 0, max: 4, step: 0.01, live: true },
      { key: "bokehBlur", label: "Miniature Blur", min: 0, max: 6, step: 0.01, live: true }
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
  semanticShopSigns: "Grammar · Semantic Shop Signs",
  connectedTerraceDay: "Voxel Terrace · Day",
  connectedTerraceNight: "Voxel Terrace · Night",
  addFloorStudy: "Voxel Terrace · Add Floor",
  grammarTownhouses: "Grammar · Townhouses",
  grammarMagicShops: "Grammar · Magic Shops",
  grammarWorkshops: "Grammar · Workshops",
  minimumCapabilityStudy: "Massing · Minimum Capability Study",
  towerCourtyard: "Massing · Tower Courtyard",
  greenhouseArcade: "Massing · White Greenhouse",
  civicDome: "Massing · Civic Dome",
  agentQuarterDay: "Intent District · Day",
  agentQuarterEvening: "Intent District · Evening",
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
const massingExplorerRoot = document.querySelector("#massing-explorer");
const intentDistrictSummary = document.querySelector("#intent-district-summary");
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
const sliderFields = new Map();
const cityViewerContext = resolveCityViewerContext();
if (cityViewerContext) document.documentElement.dataset.magicTownViewer = "loading";

let activeObject = null;
let activePipeline = null;
let activeAnimationObjects = [];
const configsByMode = {
  map: normalizeIsometricDevelopmentConfig(ISOMETRIC_DEVELOPMENT_PRESETS.magicLondonRiverfront),
  asset: normalizeIsometricAssetConfig(ISOMETRIC_ASSET_PRESETS.londonShopDepthAnything),
  vanishing: normalizeVanishingPointConfig(VANISHING_POINT_PRESETS.twoPointCuboid),
  comparison: normalizeAssetComparisonConfig(ASSET_COMPARISON_PRESETS.cottageMetricIndoorSmallVsHunyuan),
  voxel: normalizeVoxelBuildingConfig(VOXEL_BUILDING_PRESETS.connectedTerraceDay),
  massing: normalizeVoxelMassingConfig(VOXEL_MASSING_PRESETS.civicDome),
  district: normalizeVoxelIntentDistrictConfig(VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay),
  agentcity: normalizeVoxelIntentDistrictConfig({
    ...(startupParams.get("time") === "evening"
      ? VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterEvening
      : VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay),
    seed: startupParams.get("seed") ?? "agent-district-test"
  }),
  parcel: normalizeParcelBlueprintConfig(PARCEL_BLUEPRINT_PRESETS.shop)
};
let currentConfig = configsByMode[currentMode];
const massingExplorer = createVoxelMassingExplorer({
  root: massingExplorerRoot,
  onApply: (config) => rebuildActive(config),
  onRandomize: (scope) => {
    const seed = `massing-${scope}-${Math.floor(Math.random() * 99999).toString().padStart(5, "0")}`;
    rebuildActive(createExplorerRandomMassingConfig(seed, currentConfig, scope));
  }
});
const initialCityScenario = createStarterCityWorkbench(getIsometricDevelopmentContract(configsByMode.map), { mapSeed: configsByMode.map.seed });
let cityWorkbench = initialCityScenario.workbench;
let cityViewerAssets = [];
let citySeed = configsByMode.map.seed;
let rebuildVersion = 0;
let cityViewerLoadedVersion = null;
let cityViewerLoading = false;
let cityViewerRefreshTimer = null;
let cityViewerRuntimeState = null;
const clock = new THREE.Clock();
let lastRuntimeDiagnosticsAt = 0;

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
    activeObject = createIsometricDevelopmentWorld({
      ...currentConfig,
      cityState: cityWorkbench.getState(),
      assetRegistry: cityViewerAssets
    });
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
  } else if (currentMode === "massing") {
    activeObject = createVoxelMassingLab(currentConfig);
  } else if (currentMode === "district") {
    activeObject = createVoxelIntentDistrict(currentConfig);
  } else if (currentMode === "agentcity") {
    activeObject = createAgentAcceptanceCity({
      ...currentConfig,
      acceptanceSeed: currentConfig.seed,
      cityState: cityViewerRuntimeState,
      assetRegistry: cityViewerAssets,
      useHunyuanModels: 0
    });
  } else {
    activeObject = createParcelBlueprint(currentConfig);
  }

  scene.add(activeObject);
  activeAnimationObjects = collectAnimationObjects(activeObject);
  applyWorldLighting(currentConfig.sunTime);
  applyDistrictBokeh(currentConfig.bokehStrength ?? 1, currentConfig.bokehBlur ?? 1);
  configureCameraForViewport();
  document.documentElement.dataset.magicTownMode = currentMode;
  document.documentElement.dataset.magicTownConfig = JSON.stringify(currentConfig);
  document.documentElement.dataset.magicTownCityBuildings = currentMode === "map"
    ? String(Object.keys(cityWorkbench.getState().buildings).length)
    : currentMode === "agentcity" ? String(activeObject.userData.diagnostics?.buildings ?? 0) : "0";
  document.documentElement.dataset.magicTownCityRoads = currentMode === "map"
    ? String(Object.values(cityWorkbench.getState().cells).filter((cell) => cell.infrastructure === "road").length)
    : currentMode === "agentcity" ? String(activeObject.userData.diagnostics?.roads ?? 0) : "0";
  document.documentElement.dataset.magicTownRenderedAssets = currentMode === "map" ? String(activeObject.userData.starterDistrictContract?.placements?.length ?? 0) : "0";
  document.documentElement.dataset.magicTownStarterDebug = currentMode === "map" ? JSON.stringify(activeObject.userData.starterDistrictContract ?? {}) : "{}";
  document.documentElement.dataset.magicTownHunyuanModels = currentMode === "map" ? JSON.stringify(activeObject.userData.getModelDiagnostics?.() ?? []) : "[]";
  document.documentElement.dataset.magicTownComparison = currentMode === "comparison"
    ? JSON.stringify(activeObject.userData.getComparisonDiagnostics?.() ?? {})
    : "{}";
  document.documentElement.dataset.magicTownVoxel = currentMode === "voxel" || currentMode === "massing" || currentMode === "district" || currentMode === "agentcity"
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
  const shadowSize = mobilePerformanceProfile ? 1024 : 2048;
  key.shadow.mapSize.set(shadowSize, shadowSize);
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
  const style = currentMode === "voxel" || currentMode === "massing" || currentMode === "district" || currentMode === "agentcity"
    ? voxelDaylightStyle(sunTime)
    : getDaylightStyle(sunTime);
  scene.background.copy(style.skyColor);
  worldLights.ambient.color.copy(style.ambientSky);
  worldLights.ambient.groundColor.copy(style.ambientGround);
  const massingContrast = currentMode === "massing";
  worldLights.ambient.intensity = style.ambientIntensity * (massingContrast ? 0.72 : 1);
  worldLights.key.color.copy(style.sunColor);
  worldLights.key.intensity = style.sunIntensity * (massingContrast ? 1.2 : 1);
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
  sliderFields.clear();

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
      if (["bokehStrength", "bokehBlur"].includes(definition.key) && isSurfaceVoxelWorld()) {
        currentConfig = { ...currentConfig, [definition.key]: Number(input.value) };
        configsByMode[currentMode] = currentConfig;
        if (activeObject?.userData?.config) activeObject.userData.config[definition.key] = currentConfig[definition.key];
        document.documentElement.dataset.magicTownConfig = JSON.stringify(currentConfig);
        applyDistrictBokeh(currentConfig.bokehStrength, currentConfig.bokehBlur);
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
      const value = definition.valueType === "string" ? input.value : Number(input.value);
      const selectedOption = definition.options?.find((option) => String(option.value) === String(value));
      let patch = definition.aliasKey
        ? {
          [definition.key]: value,
          [definition.aliasKey]: selectedOption?.configValue
        }
        : { [definition.key]: value };
      if (definition.arrayKey) {
        const nextArray = structuredClone(currentConfig[definition.arrayKey] ?? []);
        nextArray[definition.floorIndex] = {
          ...(nextArray[definition.floorIndex] ?? {}),
          [definition.property]: value
        };
        patch = { [definition.arrayKey]: nextArray };
      }
      rebuildActive({ ...currentConfig, ...patch });
    });

    if (!isSelect) sliderValues.set(definition.key, valueText);
    sliderInputs.set(definition.key, input);
    sliderFields.set(definition.key, label);
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
    updateDistrictSurfacePointer(event, rect);
  });
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!isSurfaceVoxelWorld() || districtSurfacePointer.id != null) return;
    districtSurfacePointer.id = event.pointerId;
    districtSurfacePointer.x = event.clientX;
    districtSurfacePointer.y = event.clientY;
    districtSurfacePointer.startX = event.clientX;
    districtSurfacePointer.startY = event.clientY;
    districtSurfacePointer.moved = false;
    districtSurfacePointer.pointerType = event.pointerType;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });
  const releaseDistrictPointer = (event) => {
    if (districtSurfacePointer.id !== event.pointerId) return;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    if (event.type === "pointerup" && districtSurfacePointer.pointerType === "touch" && !districtSurfacePointer.moved) {
      const now = performance.now();
      const closeInTime = now - districtViewGesture.lastTapTime <= 360;
      const closeOnScreen = Math.hypot(
        event.clientX - districtViewGesture.lastTapX,
        event.clientY - districtViewGesture.lastTapY
      ) <= 28;
      if (closeInTime && closeOnScreen) {
        event.preventDefault();
        toggleDistrictViewDistance();
        districtViewGesture.lastTouchToggleAt = now;
        districtViewGesture.lastTapTime = 0;
      } else {
        districtViewGesture.lastTapTime = now;
        districtViewGesture.lastTapX = event.clientX;
        districtViewGesture.lastTapY = event.clientY;
      }
    }
    districtSurfacePointer.id = null;
  };
  renderer.domElement.addEventListener("pointerup", releaseDistrictPointer);
  renderer.domElement.addEventListener("pointercancel", releaseDistrictPointer);
  renderer.domElement.addEventListener("dblclick", (event) => {
    if (!isSurfaceVoxelWorld() || performance.now() - districtViewGesture.lastTouchToggleAt < 500) return;
    event.preventDefault();
    toggleDistrictViewDistance();
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
      cityViewerAssets = Array.isArray(payload.assets) ? payload.assets : [];
      cityWorkbench = createCityWorkbench(payload.state);
      cityViewerRuntimeState = payload.state;
      citySeed = payload.state.mapSeed ?? configsByMode.agentcity.seed;
      const viewerConfig = normalizeVoxelIntentDistrictConfig({
        ...VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay,
        seed: citySeed,
        worldColumns: payload.state.world?.grid?.columns ?? 50,
        worldRows: payload.state.world?.grid?.rows ?? 50,
        bokehStrength: VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay.bokehStrength,
        bokehBlur: VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay.bokehBlur
      });
      configsByMode.agentcity = viewerConfig;
      currentMode = "agentcity";
      modeControl.value = currentMode;
      rebuildPresetOptions();
      buildSliderUi();
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
    const value = definition.arrayKey
      ? currentConfig[definition.arrayKey]?.[definition.floorIndex]?.[definition.property]
      : currentConfig[key];
    input.value = value;
    const hiddenByFloor = definition.floorIndex != null && definition.floorIndex >= currentConfig.floors;
    const hiddenByCondition = definition.visible && !definition.visible(currentConfig);
    sliderFields.get(key).hidden = hiddenByFloor || hiddenByCondition;
    if (definition.control !== "select") {
      sliderValues.get(key).textContent = definition.format === "percent"
        ? `${Math.round(Number(value) * 100)}%`
        : formatSliderValue(value, input.step);
    }
  });
  const massingMode = currentMode === "massing";
  massingExplorer.setVisible(massingMode);
  if (massingMode) {
    massingExplorer.sync(
      currentConfig,
      activeObject?.userData?.getVoxelDiagnostics?.() ?? null
    );
  }
  syncIntentDistrictSummary();
}

function syncIntentDistrictSummary() {
  const districtMode = currentMode === "district";
  intentDistrictSummary.hidden = !districtMode;
  intentDistrictSummary.replaceChildren();
  if (!districtMode) return;
  const heading = document.createElement("div");
  heading.className = "intent-district-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Agent-authored semantics";
  const title = document.createElement("h2");
  title.textContent = "Building intents";
  heading.append(eyebrow, title);
  const cards = document.createElement("div");
  cards.className = "intent-district-cards";
  Object.values(currentConfig.intents ?? {}).forEach((intent) => {
    const card = document.createElement("article");
    const name = document.createElement("strong");
    name.textContent = intent.name;
    const purpose = document.createElement("p");
    purpose.textContent = intent.purpose;
    const traits = document.createElement("small");
    traits.textContent = `${intent.frontage} · ${intent.access} · ${intent.composition}`;
    card.append(name, purpose, traits);
    cards.append(card);
  });
  intentDistrictSummary.append(heading, cards);
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
    apiPill.textContent = "MagicTown.generateVoxelStreet({ floorPrograms: [{ purpose: 'shop', windowRatio: 0.86 }, { purpose: 'home', windowRatio: 0.32 }], cornerFacades: 'both', roofForm: 'hip' })";
  } else if (currentMode === "massing") {
    apiPill.textContent = `Massing Explorer · ${currentConfig.masses.length} nodes · ${currentConfig.relations.length} relations · MagicTown.getObject().userData.getVoxelDiagnostics()`;
  } else if (currentMode === "district") {
    apiPill.textContent = "BuildingIntent → Street + Massing adapters · MagicTown.generateIntentDistrict({ intents })";
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
      massing: VOXEL_MASSING_PRESETS,
      district: VOXEL_INTENT_DISTRICT_PRESETS,
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
    generateVoxelMassing(config = {}) {
      setMode("massing", { ...VOXEL_MASSING_PRESETS.minimumCapabilityStudy, ...config });
      return this.getParams();
    },
    randomizeVoxelMassing(scope = "all", seed = Date.now()) {
      setMode("massing", createExplorerRandomMassingConfig(seed, configsByMode.massing, scope));
      return this.getParams();
    },
    generateIntentDistrict(config = {}) {
      setMode("district", { ...configsByMode.district, ...config });
      return this.getParams();
    },
    generateAgentAcceptanceCity(config = {}) {
      setMode("agentcity", { ...configsByMode.agentcity, ...config });
      return this.getParams();
    },
    getAgentAcceptanceReport() {
      return structuredClone(activeObject?.userData?.acceptanceReport ?? null);
    },
    setCameraView({ position, target, zoom } = {}) {
      if (Array.isArray(position) && position.length === 3) camera.position.set(...position.map(Number));
      if (Array.isArray(target) && target.length === 3) controls.target.set(...target.map(Number));
      if (camera.isOrthographicCamera && Number.isFinite(Number(zoom))) camera.zoom = Number(zoom);
      camera.lookAt(controls.target);
      camera.updateProjectionMatrix();
      controls.update();
      return { position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom ?? 1 };
    },
    createBuildingIntent(input = {}) {
      return normalizeBuildingIntent(input);
    },
    adaptBuildingIntentToStreet(input = {}, overrides = {}) {
      return adaptBuildingIntentToStreetConfig(input, overrides);
    },
    adaptBuildingIntentToMassing(input = {}, overrides = {}) {
      return adaptBuildingIntentToMassingConfig(input, overrides);
    },
    getBuildingIntentCatalog() {
      return getBuildingIntentCatalog();
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
              : MODES.massing.presets[name]
                ? "massing"
                : MODES.district.presets[name]
                  ? "district"
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
    createUrbanMassingSpec(options = {}) {
      return createUrbanMassingSpec(options);
    },
    createVoxelMassingObject(options = {}) {
      return createVoxelMassingLab(options);
    },
    getVoxelGrammarCatalog() {
      return {
        specVersion: BUILDING_SPEC_VERSION,
        archetypes: structuredClone(BUILDING_ARCHETYPES),
        styleKits: structuredClone(VOXEL_STYLE_KITS),
        floorPurposes: [...FLOOR_USE_IDS],
        floorBalconies: [...FLOOR_BALCONY_IDS],
        roofForms: [...ROOF_FORM_IDS],
        cornerFacadeModes: [...CORNER_FACADE_MODE_IDS],
        floorWindowRatioRange: [0.15, 0.9],
        ridgePositionRange: [0, 1],
        massing: getUrbanMassingCatalog()
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
  renderer.info.reset();
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;
  const refreshRuntimeDiagnostics = elapsed - lastRuntimeDiagnosticsAt >= 0.5;
  if (refreshRuntimeDiagnostics) lastRuntimeDiagnosticsAt = elapsed;

  updatePlayCamera(delta);

  if (activeObject) {
    activeObject.userData?.update?.(elapsed);
    if (activeObject.userData?.updateParallax) {
      activeObject.userData.updateParallax(camera);
    }
    activeAnimationObjects.forEach((object) => {
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

  if (refreshRuntimeDiagnostics && currentMode === "map") {
    document.documentElement.dataset.magicTownHunyuanModels = JSON.stringify(activeObject?.userData?.getModelDiagnostics?.() ?? []);
  } else if (refreshRuntimeDiagnostics && currentMode === "comparison") {
    document.documentElement.dataset.magicTownComparison = JSON.stringify(activeObject?.userData?.getComparisonDiagnostics?.() ?? {});
  }

  controls.update();
  conformPlayCameraToTerrain();
  if (isSurfaceVoxelWorld()) {
    updateDistrictViewTransition(delta);
    configureDistrictSurfaceCamera();
  }
  camera.updateMatrixWorld();
  activeObject?.userData?.updateView?.(camera, renderQuality.mobile ? 4 : 8, {
    width: renderer.domElement.clientWidth,
    height: renderer.domElement.clientHeight
  });
  const baseFitDiagnostics = activeObject?.userData?.updateBaseFit?.(
    camera,
    currentMode === "map" && currentConfig?.cameraMode === "play",
    {
      width: renderer.domElement.clientWidth,
      height: renderer.domElement.clientHeight,
      focusWorld: controls.target.toArray()
    }
  );
  if (baseFitDiagnostics && refreshRuntimeDiagnostics) {
    document.documentElement.dataset.magicTownBaseFitEnabled = String(baseFitDiagnostics.enabled);
    document.documentElement.dataset.magicTownBaseFitErrorPx = baseFitDiagnostics.maxAnchorErrorPx.toFixed(6);
    document.documentElement.dataset.magicTownBaseFitSprites = String(baseFitDiagnostics.spriteCount);
    document.documentElement.dataset.magicTownUprightErrorDeg = baseFitDiagnostics.maxUprightDeviationDegrees.toFixed(6);
    document.documentElement.dataset.magicTownDepthParallax = String(baseFitDiagnostics.depthParallaxEnabled);
    document.documentElement.dataset.magicTownParallaxViewOffset = baseFitDiagnostics.maxParallaxViewOffset.toFixed(6);
    document.documentElement.dataset.magicTownParallaxUvShift = baseFitDiagnostics.maxParallaxUvShift.toFixed(6);
    document.documentElement.dataset.magicTownUprightScaleRange = baseFitDiagnostics.uprightScaleRatioRange.map((value) => value.toFixed(4)).join(",");
    document.documentElement.dataset.magicTownBuildingSortRule = baseFitDiagnostics.buildingSortRule ?? "";
    document.documentElement.dataset.magicTownBuildingRenderOrders = JSON.stringify(baseFitDiagnostics.entries.map((entry) => ({ assetId: entry.assetId, renderOrder: entry.renderOrder })));
  } else if (!baseFitDiagnostics && refreshRuntimeDiagnostics) {
    delete document.documentElement.dataset.magicTownBaseFitEnabled;
    delete document.documentElement.dataset.magicTownBaseFitErrorPx;
    delete document.documentElement.dataset.magicTownBaseFitSprites;
    delete document.documentElement.dataset.magicTownUprightErrorDeg;
    delete document.documentElement.dataset.magicTownDepthParallax;
    delete document.documentElement.dataset.magicTownParallaxViewOffset;
    delete document.documentElement.dataset.magicTownParallaxUvShift;
    delete document.documentElement.dataset.magicTownUprightScaleRange;
    delete document.documentElement.dataset.magicTownBuildingSortRule;
    delete document.documentElement.dataset.magicTownBuildingRenderOrders;
  }
  if (isSurfaceVoxelWorld()) {
    renderPass.camera = camera;
    districtDepthOfField.camera = camera;
    districtDepthOfField.uniforms.focus.value = camera.position.distanceTo(controls.target);
    districtDepthOfField.enabled = (currentConfig?.bokehStrength ?? 1) * (currentConfig?.bokehBlur ?? 1) > 0.001;
    composer.render();
  } else {
    districtDepthOfField.enabled = false;
    renderer.render(scene, camera);
  }
  updateDynamicResolution(delta, elapsed);
  if (refreshRuntimeDiagnostics) publishRenderDiagnostics();
}

function applyDistrictBokeh(strength = 1, blur = 1) {
  const normalizedStrength = THREE.MathUtils.clamp(Number(strength) || 0, 0, 4);
  const normalizedBlur = THREE.MathUtils.clamp(Number(blur) || 0, 0, 6);
  districtDepthOfField.uniforms.aperture.value = districtBokehDefaults.aperture * normalizedStrength;
  districtDepthOfField.uniforms.maxblur.value = districtBokehDefaults.maxblur * normalizedBlur;
}

function collectAnimationObjects(root) {
  const objects = [];
  root?.traverse((object) => {
    if (object.userData?.spin || object.userData?.float || object.userData?.waterWave) objects.push(object);
  });
  return objects;
}

function updateDynamicResolution(delta, elapsed) {
  if (!Number.isFinite(delta) || delta <= 0 || delta > 0.25) return;
  const frameMs = delta * 1000;
  renderQuality.averageFrameMs += (frameMs - renderQuality.averageFrameMs) * 0.05;
  renderQuality.stableFrames += 1;
  if (elapsed * 1000 - renderQuality.lastAdjustmentMs < 1500) return;
  let nextPixelRatio = renderQuality.pixelRatio;
  if (renderQuality.averageFrameMs > 18.25 && renderQuality.stableFrames >= 24) {
    nextPixelRatio -= 0.1;
  } else if (renderQuality.averageFrameMs < 14.25 && renderQuality.stableFrames >= 150) {
    nextPixelRatio += 0.1;
  } else {
    return;
  }
  nextPixelRatio = THREE.MathUtils.clamp(
    Number(nextPixelRatio.toFixed(2)),
    renderQuality.minPixelRatio,
    Math.min(renderQuality.maxPixelRatio, window.devicePixelRatio)
  );
  renderQuality.stableFrames = 0;
  renderQuality.lastAdjustmentMs = elapsed * 1000;
  if (Math.abs(nextPixelRatio - renderQuality.pixelRatio) < 0.01) return;
  renderQuality.pixelRatio = nextPixelRatio;
  renderer.setPixelRatio(nextPixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  composer.setPixelRatio(nextPixelRatio);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function publishRenderDiagnostics() {
  document.documentElement.dataset.magicTownPixelRatio = renderQuality.pixelRatio.toFixed(2);
  document.documentElement.dataset.magicTownFrameMs = renderQuality.averageFrameMs.toFixed(2);
  document.documentElement.dataset.magicTownDrawCalls = String(renderer.info.render.calls);
  document.documentElement.dataset.magicTownTriangles = String(renderer.info.render.triangles);
  document.documentElement.dataset.magicTownDistrictCamera = isSurfaceVoxelWorld()
    ? JSON.stringify(camera.userData.districtSurface ?? {})
    : "{}";
  document.documentElement.dataset.magicTownPrefabLod = currentMode === "district"
    ? JSON.stringify(activeObject?.userData?.getPrefabLodDiagnostics?.() ?? {})
    : "{}";
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  configureCameraForViewport();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function configureCameraForViewport() {
  const isMap = currentMode === "map";
  const isParcel = currentMode === "parcel";
  const isVanishing = currentMode === "vanishing";
  const isMassing = currentMode === "massing";
  const isDistrict = currentMode === "district";
  const isAgentCity = currentMode === "agentcity";
  const isSurfaceWorld = isDistrict || isAgentCity;
  const isVoxel = currentMode === "voxel" || currentMode === "massing";
  const perspective = isMap ? currentConfig?.perspective ?? 0 : 0;
  if (isParcel || isVanishing || isVoxel || (isMap && perspective <= 0.001)) {
    const aspect = window.innerWidth / window.innerHeight;
    const span = isMap
      ? Math.max(150, (currentConfig?.mapSize ?? 180) * 1.12)
      : isVanishing
        ? 10
        : isVoxel
          ? Math.max(15, (currentConfig?.buildingCount ?? 3) * 4 + 8)
            * (isMassing ? currentConfig?.viewFraming?.zoom ?? 1.12 : 1)
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
      const framingOffset = isMassing
        ? new THREE.Vector3(0.774, 0, -0.633)
          .multiplyScalar(currentConfig?.viewFraming?.horizontalOffset ?? 1.75)
        : new THREE.Vector3();
      camera.position.set(18, 14.5, 22).add(framingOffset);
      controls.target.set(0, 5.4, 0.4).add(framingOffset);
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
  if (isSurfaceWorld) {
    const institutionWidth = currentConfig?.institutionFootprint?.widthCells ?? 5;
    const institutionDepth = currentConfig?.institutionFootprint?.depthCells ?? 3;
    const districtScale = 1
      + Math.max(0, institutionWidth - 5) * 0.08
      + Math.max(0, institutionDepth - 3) * 0.1;
    camera.fov = narrow ? 40 : 34;
    camera.near = 0.1;
    camera.far = 320;
    districtSurfaceNavigation.nearScale = districtScale;
    districtSurfaceNavigation.farScale = districtScale * 1.9;
    districtSurfaceNavigation.targetCameraScale = districtSurfaceNavigation.viewMode === "far"
      ? districtSurfaceNavigation.farScale
      : districtSurfaceNavigation.nearScale;
    if (!districtSurfaceNavigation.initialized) {
      districtSurfaceNavigation.cameraScale = districtSurfaceNavigation.targetCameraScale;
    }
    configureDistrictSurfaceCamera(districtSurfaceNavigation.cameraScale);
    syncCameraInteraction();
    camera.updateProjectionMatrix();
    return;
  }
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
  const surfaceDistrict = isSurfaceVoxelWorld();
  controls.enabled = !surfaceDistrict;
  controls.enableRotate = !playMode && !flatProjectionLab && !surfaceDistrict;
  controls.enablePan = !surfaceDistrict;
  controls.enableZoom = !surfaceDistrict;
  controls.enableDamping = !playMode && !surfaceDistrict;
  controls.mouseButtons.LEFT = playMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

function configureDistrictSurfaceCamera(scale = districtSurfaceNavigation.cameraScale) {
  const navigation = activeObject?.userData?.surfaceNavigation ?? {
    radius: currentConfig?.planetRadius ?? 44,
    bounds: { minX: -18, maxX: 18, minZ: -14, maxZ: 14 },
    yawDegrees: 45,
    elevationDegrees: 35.264,
    cameraDistance: 58,
    targetHeight: 4.8
  };
  if (!districtSurfaceNavigation.initialized || districtSurfaceNavigation.radius !== navigation.radius) {
    districtSurfaceNavigation.initialized = true;
    districtSurfaceNavigation.flatX = THREE.MathUtils.clamp(2.5, navigation.bounds.minX, navigation.bounds.maxX);
    districtSurfaceNavigation.flatZ = THREE.MathUtils.clamp(-5, navigation.bounds.minZ, navigation.bounds.maxZ);
    districtSurfaceNavigation.radius = navigation.radius;
  }
  districtSurfaceNavigation.cameraScale = scale;
  const frame = getVoxelSphereFrame(
    districtSurfaceNavigation.flatX,
    districtSurfaceNavigation.flatZ,
    navigation.radius
  );
  const yaw = THREE.MathUtils.degToRad(navigation.yawDegrees);
  const elevation = THREE.MathUtils.degToRad(navigation.elevationDegrees);
  const distance = navigation.cameraDistance * scale;
  const horizontal = frame.tangentX.clone().multiplyScalar(Math.cos(yaw))
    .addScaledVector(frame.tangentZ, Math.sin(yaw))
    .normalize();
  const focus = frame.surface.clone().addScaledVector(frame.normal, navigation.targetHeight);
  camera.position.copy(focus)
    .addScaledVector(horizontal, distance * Math.cos(elevation))
    .addScaledVector(frame.normal, distance * Math.sin(elevation));
  camera.up.copy(frame.normal);
  camera.lookAt(focus);
  controls.target.copy(focus);
  districtSurfaceNavigation.radialDistance = camera.position.distanceTo(new THREE.Vector3(0, -navigation.radius, 0));
  camera.userData.districtSurface = {
    flatX: districtSurfaceNavigation.flatX,
    flatZ: districtSurfaceNavigation.flatZ,
    radialDistance: districtSurfaceNavigation.radialDistance,
    yawDegrees: navigation.yawDegrees,
    elevationDegrees: navigation.elevationDegrees,
    viewMode: districtSurfaceNavigation.viewMode,
    cameraScale: districtSurfaceNavigation.cameraScale,
    targetCameraScale: districtSurfaceNavigation.targetCameraScale
  };
  document.documentElement.dataset.magicTownDistrictView = districtSurfaceNavigation.viewMode;
}

function toggleDistrictViewDistance() {
  if (!isSurfaceVoxelWorld()) return;
  districtSurfaceNavigation.viewMode = districtSurfaceNavigation.viewMode === "near" ? "far" : "near";
  districtSurfaceNavigation.targetCameraScale = districtSurfaceNavigation.viewMode === "far"
    ? districtSurfaceNavigation.farScale
    : districtSurfaceNavigation.nearScale;
  document.documentElement.dataset.magicTownDistrictView = districtSurfaceNavigation.viewMode;
}

function updateDistrictViewTransition(delta) {
  const target = districtSurfaceNavigation.targetCameraScale;
  const alpha = 1 - Math.exp(-Math.max(0, delta) * 7);
  districtSurfaceNavigation.cameraScale = THREE.MathUtils.lerp(
    districtSurfaceNavigation.cameraScale,
    target,
    alpha
  );
  if (Math.abs(districtSurfaceNavigation.cameraScale - target) < 0.0005) {
    districtSurfaceNavigation.cameraScale = target;
  }
}

function updateDistrictSurfacePointer(event, rect) {
  if (!isSurfaceVoxelWorld() || districtSurfacePointer.id !== event.pointerId) return;
  const dx = event.clientX - districtSurfacePointer.x;
  const dy = event.clientY - districtSurfacePointer.y;
  if (Math.hypot(
    event.clientX - districtSurfacePointer.startX,
    event.clientY - districtSurfacePointer.startY
  ) > 6) districtSurfacePointer.moved = true;
  districtSurfacePointer.x = event.clientX;
  districtSurfacePointer.y = event.clientY;
  if (dx === 0 && dy === 0) return;
  const navigation = activeObject?.userData?.surfaceNavigation;
  if (!navigation) return;
  const frame = getVoxelSphereFrame(
    districtSurfaceNavigation.flatX,
    districtSurfaceNavigation.flatZ,
    navigation.radius
  );
  const yaw = THREE.MathUtils.degToRad(navigation.yawDegrees);
  const elevation = THREE.MathUtils.degToRad(navigation.elevationDegrees);
  const horizontal = frame.tangentX.clone().multiplyScalar(Math.cos(yaw))
    .addScaledVector(frame.tangentZ, Math.sin(yaw))
    .normalize();
  const viewDirection = horizontal.clone().multiplyScalar(-Math.cos(elevation))
    .addScaledVector(frame.normal, -Math.sin(elevation));
  const screenRight = new THREE.Vector3().crossVectors(viewDirection, frame.normal).normalize();
  const visibleHeight = 2 * navigation.cameraDistance * districtSurfaceNavigation.cameraScale
    * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  const unitsPerPixel = visibleHeight / Math.max(1, rect.height);
  const movement = screenRight.multiplyScalar(-dx * unitsPerPixel)
    .addScaledVector(horizontal, -dy * unitsPerPixel / Math.max(0.45, Math.sin(elevation)));
  districtSurfaceNavigation.flatX = THREE.MathUtils.clamp(
    districtSurfaceNavigation.flatX + movement.dot(frame.tangentX),
    navigation.bounds.minX,
    navigation.bounds.maxX
  );
  districtSurfaceNavigation.flatZ = THREE.MathUtils.clamp(
    districtSurfaceNavigation.flatZ + movement.dot(frame.tangentZ),
    navigation.bounds.minZ,
    navigation.bounds.maxZ
  );
  configureDistrictSurfaceCamera();
}

function isSurfaceVoxelWorld() {
  return currentMode === "district" || currentMode === "agentcity";
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
  if (currentMode === "massing") return activeObject?.userData?.getVoxelContract?.() ?? currentConfig;
  if (currentMode === "district" || currentMode === "agentcity") return activeObject?.userData?.getVoxelContract?.() ?? currentConfig;
  return {
    mode: currentMode,
    config: currentConfig
  };
}

function inferMode(config) {
  if (config.mode && MODES[config.mode]) return config.mode;
  if ("intents" in config && ("magicBias" in config || config.id?.includes("quarter"))) return "district";
  if ("masses" in config || config.specVersion === getUrbanMassingCatalog().specVersion) return "massing";
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
    || "roofForm" in config
    || "cornerFacades" in config
    || "ridgePosition" in config
    || "windowRatio" in config
    || "floorPrograms" in config
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

function createVoxelFloorControlDefinitions() {
  return Array.from({ length: 5 }, (_, floorIndex) => {
    const floorNumber = floorIndex + 1;
    const controls = [
      {
        key: `floor-${floorNumber}-purpose`,
        label: `Floor ${floorNumber} · Use`,
        control: "select",
        valueType: "string",
        arrayKey: "floorPrograms",
        floorIndex,
        property: "purpose",
        options: [
          { value: "shop", label: "Shop" },
          { value: "home", label: "Home" },
          { value: "workshop", label: "Workshop" },
          { value: "storage", label: "Storage" }
        ]
      },
      {
        key: `floor-${floorNumber}-window-ratio`,
        label: `Floor ${floorNumber} · Window Share`,
        min: 0.15,
        max: 0.9,
        step: 0.01,
        format: "percent",
        arrayKey: "floorPrograms",
        floorIndex,
        property: "windowRatio"
      }
    ];
    if (floorIndex === 0) return controls;
    controls.push(
      {
        key: `floor-${floorNumber}-setback`,
        label: `Floor ${floorNumber} · Setback`,
        control: "select",
        arrayKey: "floorPrograms",
        floorIndex,
        property: "setbackVoxels",
        options: [
          { value: 0, label: "Flush" },
          { value: 2, label: "Small · 2 voxels" },
          { value: 4, label: "Deep · 4 voxels" },
          { value: 6, label: "Terrace · 6 voxels" }
        ]
      },
      {
        key: `floor-${floorNumber}-balcony`,
        label: `Floor ${floorNumber} · Balcony`,
        control: "select",
        valueType: "string",
        arrayKey: "floorPrograms",
        floorIndex,
        property: "balcony",
        options: [
          { value: "none", label: "None" },
          { value: "selective", label: "One Bay" },
          { value: "full", label: "Full Width" }
        ]
      }
    );
    return controls;
  }).flat();
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
