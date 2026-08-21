import * as THREE from "three";
import { runNonVisualAgentBuildScenario } from "../city/agent-district-simulation.js";
import { createAgentVoxelRoadLayer, createAgentVoxelVegetationLayer } from "./agentVoxelInfrastructure.js";
import { createMagicLondonStarterDistrict } from "./magicLondonStarterDistrict.js";
import { createStreetLifeCityLayer } from "./streetLifeCityLayer.js";
import { createBuildingContactAmbientOcclusion } from "../render/buildingContactAmbientOcclusion.js";
import {
  createVoxelDistrictMacroSurface,
  normalizeVoxelIntentDistrictConfig,
  projectDistrictOntoSphere
} from "./voxelIntentDistrict.js";

const VOXEL_SIZE = 0.125;
const NATURAL_DATUM = -0.0625;

export function createAgentAcceptanceCity(config = {}) {
  const params = normalizeVoxelIntentDistrictConfig(config);
  const suppliedState = config.cityState ?? null;
  const seed = String(config.acceptanceSeed ?? config.seed ?? suppliedState?.mapSeed ?? suppliedState?.world?.seed ?? "agent-district-test");
  const scenario = suppliedState ? null : runNonVisualAgentBuildScenario({ seed });
  const state = suppliedState ?? scenario.state;
  const grid = suppliedState ? gridFromCityState(state) : scenario.world.grid;
  const world = suppliedState ? { grid, stateWorld: structuredClone(state.world ?? null) } : scenario.world;
  const report = scenario?.report ?? reportLiveCityState(state);
  const root = new THREE.Group();
  root.name = "AgentAcceptanceCity";

  const macro = createVoxelDistrictMacroSurface({ ...params, seed, blankConstruction: true });
  const macroVegetation = macro.group.getObjectByName("MacroVoxelPlants");
  if (macroVegetation) {
    macro.group.remove(macroVegetation);
    disposeObject(macroVegetation);
  }
  // Macro terrain is authored with row + 1 = +Z; the Agent API contract uses
  // row - 1 = +Z, so mirror only the visual terrain layer.
  macro.group.scale.z = -1;
  root.add(macro.group);

  const constructionHeight = createHeightSampler(state, grid, true);
  const roads = createAgentVoxelRoadLayer({ state, grid, seed });
  roads.name = "AgentAcceptanceRoads";
  root.add(roads);

  const buildings = createMagicLondonStarterDistrict({
    grid,
    sampleGroundHeight: constructionHeight,
    cityState: state,
    assetRegistry: config.assetRegistry ?? [],
    useHunyuanModels: config.useHunyuanModels ?? 0,
    nightLighting: params.nightLighting,
    enableVoxelLod: true
  });
  buildings.name = "AgentAcceptanceBuildings";
  root.add(buildings);

  const contactAmbientOcclusion = createBuildingContactAmbientOcclusion({
    buildings: Object.values(state.buildings),
    cells: grid.cells,
    cellWorldSize: grid.cellWorldSize,
    sampleGroundHeight: constructionHeight
  });
  root.add(contactAmbientOcclusion);

  const vegetation = createAgentVoxelVegetationLayer({ state, grid, seed });
  vegetation.name = "AgentAcceptanceVegetation";
  root.add(vegetation);

  const sphericalProjection = projectDistrictOntoSphere(root, params.planetRadius);
  const streetLife = createStreetLifeCityLayer({
    state,
    grid,
    seed: `${seed}:street-life`,
    planetRadius: params.planetRadius,
    sampleGroundHeight: constructionHeight,
    density: config.streetLifeDensity ?? 1
  });
  root.add(streetLife);

  root.userData.config = { ...params, acceptanceSeed: seed };
  root.userData.acceptanceReport = structuredClone(report);
  root.userData.cityState = structuredClone(state);
  root.userData.worldContract = structuredClone(world);
  root.userData.diagnostics = {
    renderer: suppliedState ? "agent-api-city-v1-all-voxel" : "agent-acceptance-city-v2-all-voxel",
    source: suppliedState ? "agent-api-render-state" : "deterministic-acceptance-scenario",
    usedMultimodalVisionForConstruction: false,
    success: report.success,
    buildings: report.diagnostics.buildingCount,
    districts: report.diagnostics.districtCount,
    roads: report.diagnostics.roadCellCount,
    bridges: report.diagnostics.bridgeCellCount,
    compiledDesigns: Object.values(state.buildings).filter((building) => building.voxelDesign?.compileDiagnostics?.status === "compiled").length,
    projection: sphericalProjection,
    terrain: macro.diagnostics,
    roadTopologies: roads.userData.contract?.renderedRoadTopologies ?? {},
    roadRenderer: roads.userData.contract,
    vegetation: vegetation.userData.contract,
    streetLife: streetLife.userData.getDiagnostics(),
    contactAmbientOcclusion: {
      method: "curved-footprint-gradient-v1",
      patchCount: contactAmbientOcclusion.userData.patchCount,
      triangleCount: contactAmbientOcclusion.userData.triangleCount
    },
    buildingPlacements: buildings.userData.contract?.placements ?? [],
    skippedBuildings: buildings.userData.contract?.skipped ?? []
  };
  root.userData.surfaceNavigation = {
    radius: params.planetRadius,
    center: [0, -params.planetRadius, 0],
    bounds: {
      minX: -grid.columns * grid.cellWorldSize * 0.46,
      maxX: grid.columns * grid.cellWorldSize * 0.46,
      minZ: -grid.rows * grid.cellWorldSize * 0.46,
      maxZ: grid.rows * grid.cellWorldSize * 0.46
    },
    yawDegrees: 45,
    elevationDegrees: 35.264,
    cameraDistance: 58,
    targetHeight: 4.8
  };
  root.userData.contract = {
    mode: "agentcity",
    renderer: root.userData.diagnostics.renderer,
    renderSurface: "spherical voxel world; flat Agent API coordinates remain authoritative",
    projection: "each rendered voxel object uses the local sphere normal and tangent basis",
    streetLife: streetLife.userData.getContract(),
    camera: {
      navigation: "fixed-radius surface pan",
      rotation: "locked local isometric",
      yawDegrees: 45,
      elevationDegrees: 35.264,
      depthOfField: "bokeh retained"
    }
  };
  root.userData.getVoxelDiagnostics = () => structuredClone(root.userData.diagnostics);
  root.userData.getVoxelContract = () => structuredClone(root.userData.contract);
  root.userData.getPrefabLodDiagnostics = () => buildings.userData.getVoxelLodDiagnostics?.() ?? {};
  root.userData.getPrefabLodSummaryDiagnostics = () => buildings.userData.getVoxelLodSummaryDiagnostics?.() ?? {};
  root.userData.getStreetLifeDiagnostics = () => streetLife.userData.getDiagnostics();
  root.userData.update = (elapsed) => {
    streetLife.userData.update(elapsed);
  };
  root.userData.updateView = (camera, _maxDynamicLights = 4, viewport = {}) => {
    macro.group.userData.updateView?.(camera);
    buildings.userData.updateView?.(camera, _maxDynamicLights, viewport);
    vegetation.userData.updateView?.(camera);
    streetLife.userData.updateView(camera, viewport);
    root.userData.diagnostics.streetLife = streetLife.userData.getDiagnostics();
  };
  root.userData.updateDaylight = (style) => {
    roads.userData.updateDaylight?.(style, params.nightLighting);
    buildings.userData.updateDaylight?.(style);
    vegetation.userData.updateDaylight?.(style);
  };
  return root;
}

function gridFromCityState(state) {
  const cells = Object.values(state.cells ?? {}).sort((a, b) => a.row - b.row || a.column - b.column);
  const columns = Number(state.world?.grid?.columns ?? Math.max(...cells.map((cell) => cell.column), -1) + 1);
  const rows = Number(state.world?.grid?.rows ?? Math.max(...cells.map((cell) => cell.row), -1) + 1);
  const cellWorldSize = Number(state.world?.grid?.cellWorldSize ?? 4);
  return { columns, rows, cellWorldSize, cells };
}

function reportLiveCityState(state) {
  const buildings = Object.values(state.buildings ?? {});
  const roads = Object.values(state.cells ?? {}).filter((cell) => cell.infrastructure === "road");
  const bridges = Object.values(state.infrastructure ?? {}).filter((item) => item.type === "bridge");
  const districtCount = new Set(buildings.map((building) => building.program?.attributes?.districtId).filter(Boolean)).size;
  return {
    method: "agent-api-render-state",
    usedMultimodalVision: false,
    seed: state.mapSeed ?? state.world?.seed ?? null,
    failures: [],
    success: true,
    diagnostics: {
      buildingCount: buildings.length,
      districtCount,
      roadCellCount: roads.length,
      bridgeCellCount: bridges.length,
      checks: { stateLoaded: true },
      allChecksPassed: true
    }
  };
}

function createHeightSampler(state, grid, gradeConstruction) {
  const byCoordinate = new Map(grid.cells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const buildingGrades = new Map();
  Object.values(state.buildings).forEach((building) => {
    const top = Math.max(...building.footprintCells.map((cellId) => NATURAL_DATUM + Number(state.cells[cellId]?.surface?.maxElevationVoxels ?? 0) * VOXEL_SIZE));
    building.footprintCells.forEach((cellId) => buildingGrades.set(cellId, top));
  });
  return (x, z) => {
    const column = Math.floor((x + grid.columns * grid.cellWorldSize / 2) / grid.cellWorldSize);
    const row = Math.floor((grid.rows * grid.cellWorldSize / 2 - z) / grid.cellWorldSize);
    const cell = byCoordinate.get(`${column}:${row}`);
    if (!cell) return NATURAL_DATUM;
    if (gradeConstruction) {
      if (buildingGrades.has(cell.id)) return buildingGrades.get(cell.id);
      if (state.cells[cell.id]?.infrastructure === "road") return NATURAL_DATUM + Number(cell.surface?.maxElevationVoxels ?? 0) * VOXEL_SIZE;
    }
    return NATURAL_DATUM + Number(cell.surface?.maxElevationVoxels ?? 0) * VOXEL_SIZE;
  };
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
    else child.material?.dispose?.();
  });
}
