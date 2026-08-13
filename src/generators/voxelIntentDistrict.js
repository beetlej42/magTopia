import * as THREE from "three";
import { getVoxelLodThresholds, selectScreenSpaceVoxelLod } from "../render/voxelLodQuality.js";
import { createRng } from "../utils/random.js";
import {
  adaptBuildingIntentToMassingConfig,
  adaptBuildingIntentToStreetConfig,
  getBuildingIntentCatalog,
  normalizeBuildingIntent
} from "./buildingIntent.js";
import {
  VOXEL_SIZE,
  VOXEL_WRITE_PRIORITIES,
  VoxelInstanceBuffer,
  createVoxelBuildingLab,
  createVoxelBuildingLodLevels,
  createVoxelMassingLab,
  voxelDaylightStyle
} from "./voxelBuildingLab.js";

const DISTRICT_CELL_VOXELS = 32;
const DISTRICT_COLUMNS = 10;
const DISTRICT_ROWS = 8;
const DISTRICT_WIDTH_VOXELS = DISTRICT_COLUMNS * DISTRICT_CELL_VOXELS;
const DISTRICT_DEPTH_VOXELS = DISTRICT_ROWS * DISTRICT_CELL_VOXELS;
const DISTRICT_BASE_Y = -1;
const GLOBAL_CONSTRUCTION_HEIGHT = (DISTRICT_BASE_Y + 0.5) * VOXEL_SIZE;
const MACRO_TERRAIN_SUBDIVISIONS = DISTRICT_CELL_VOXELS;
const MACRO_TERRAIN_MAX_MERGE_SPAN = 16;
const MACRO_TERRAIN_KIND = Object.freeze({
  terrain: 0,
  water: 1,
  shore: 2,
  reserved: 3,
  constructionRoad: 4,
  constructionParcel: 5
});
const MACRO_TERRAIN_KIND_NAMES = Object.freeze(Object.keys(MACRO_TERRAIN_KIND));
const MACRO_TERRAIN_BIOME = Object.freeze({
  meadow: 0,
  meadowLight: 1,
  woodland: 2,
  heath: 3,
  water: 4,
  shore: 5,
  reserved: 6,
  road: 7,
  parcel: 8
});
const MACRO_TERRAIN_BIOME_NAMES = Object.freeze(Object.keys(MACRO_TERRAIN_BIOME));
const MACRO_TERRAIN_COLOR = Object.freeze({
  grass: 0,
  grassLight: 1,
  grassDark: 2,
  water: 3,
  waterLight: 4,
  shore: 5,
  road: 6,
  parcel: 7
});
const MACRO_TERRAIN_COLOR_NAMES = Object.freeze(Object.keys(MACRO_TERRAIN_COLOR));
const VOXEL_ROAD_WIDTH = 18;
const VOXEL_ROAD_INSET = Math.floor((DISTRICT_CELL_VOXELS - VOXEL_ROAD_WIDTH) / 2);
const VOXEL_ROAD_LAMP_HEIGHT = 21;
const VOXEL_ROAD_LAMP_FOOTPRINT = 5;
const VOXEL_ROAD_LAMP_SIDEWALK_OFFSET = VOXEL_ROAD_INSET - 2;
const ROAD_DIRECTIONS = Object.freeze(["north", "east", "south", "west"]);
const ROAD_OFFSETS = Object.freeze({
  north: Object.freeze([0, -1]),
  east: Object.freeze([1, 0]),
  south: Object.freeze([0, 1]),
  west: Object.freeze([-1, 0])
});
const OPPOSITE_ROAD_DIRECTION = Object.freeze({
  north: "south",
  east: "west",
  south: "north",
  west: "east"
});

export const VOXEL_INTENT_DISTRICT_PRESETS = Object.freeze({
  agentQuarterDay: Object.freeze({
    id: "agent-quarter-day",
    seed: "agent-quarter-day-001",
    sunTime: 0.58,
    nightLighting: 0.1,
    magicBias: 0.12,
    worldColumns: 50,
    worldRows: 50,
    planetRadius: 220,
    bokehStrength: 1.6,
    bokehBlur: 1.8,
    vegetationDensity: 0.72,
    institutionFootprint: { widthCells: 5, depthCells: 3 },
    viewFraming: { zoom: 1.08, horizontalOffset: 0 },
    intents: {
      retail: {
        name: "Mercury Row",
        purpose: "tailors, wand makers, and small shops with homes above",
        description: "A lively mixed retail terrace serving the surrounding neighbourhood.",
        signText: "MERCURY ROW",
        composition: "street",
        frontage: "display",
        access: "public",
        style: "victorian_gothic",
        prominence: "important",
        magicLevel: 0.62
      },
      workshops: {
        name: "Cinder Lane Works",
        purpose: "repair workshops and magical service trades",
        description: "Small productive premises with broad work windows and service access.",
        signText: "CINDER LANE",
        composition: "yard",
        frontage: "workshop",
        access: "service",
        style: "industrial_iron",
        prominence: "ordinary",
        magicLevel: 0.4
      },
      institution: {
        name: "Starlight Academy",
        purpose: "neighbourhood school for practical magic",
        description: "A public academy organised around a formal entrance court and teaching tower.",
        signText: "STARLIGHT ACADEMY",
        composition: "tower",
        frontage: "institutional",
        access: "ceremonial",
        style: "civic_classical",
        prominence: "landmark",
        magicLevel: 0.72
      }
    }
  }),
  agentQuarterEvening: Object.freeze({
    id: "agent-quarter-evening",
    seed: "agent-quarter-evening-001",
    sunTime: 0.07,
    nightLighting: 0.9,
    magicBias: 0.2,
    worldColumns: 50,
    worldRows: 50,
    planetRadius: 220,
    bokehStrength: 1.8,
    bokehBlur: 2,
    vegetationDensity: 0.64,
    institutionFootprint: { widthCells: 5, depthCells: 3 },
    viewFraming: { zoom: 1.08, horizontalOffset: 0 },
    intents: {
      retail: {
        name: "Moon Market Row",
        purpose: "late-night magical shops and boarding rooms",
        signText: "MOON MARKET",
        composition: "street",
        frontage: "display",
        access: "public",
        style: "victorian_gothic",
        prominence: "important",
        magicLevel: 0.88
      },
      workshops: {
        name: "Lantern Repair Court",
        purpose: "night workshops maintaining enchanted street lamps",
        signText: "LANTERN WORKS",
        composition: "yard",
        frontage: "large_bay",
        access: "service",
        style: "industrial_iron",
        prominence: "ordinary",
        magicLevel: 0.68
      },
      institution: {
        name: "Nocturne Infirmary",
        purpose: "night hospital for magical accidents",
        signText: "NOCTURNE INFIRMARY",
        composition: "court",
        frontage: "institutional",
        access: "public",
        style: "civic_classical",
        prominence: "landmark",
        magicLevel: 0.76
      }
    }
  })
});

export function normalizeVoxelIntentDistrictConfig(config = {}) {
  const base = { ...VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay, ...config };
  const sourceIntents = {
    ...VOXEL_INTENT_DISTRICT_PRESETS.agentQuarterDay.intents,
    ...(base.intents ?? {})
  };
  return {
    id: String(base.id || "agent-intent-district"),
    seed: String(base.seed || "agent-intent-district-001"),
    sunTime: clamp(base.sunTime ?? 0.58, 0, 1),
    nightLighting: clamp(base.nightLighting ?? 0.1, 0, 1),
    magicBias: clamp(base.magicBias ?? 0, -0.35, 0.35),
    worldColumns: clampInteger(base.worldColumns ?? 50, DISTRICT_COLUMNS, 80),
    worldRows: clampInteger(base.worldRows ?? 50, DISTRICT_ROWS, 80),
    planetRadius: clamp(base.planetRadius ?? 220, 30, 480),
    bokehStrength: clamp(base.bokehStrength ?? 1, 0, 4),
    bokehBlur: clamp(base.bokehBlur ?? 1, 0, 6),
    vegetationDensity: clamp(base.vegetationDensity ?? 0.72, 0, 1),
    institutionFootprint: {
      widthCells: clampInteger(base.institutionFootprint?.widthCells ?? 5, 2, 6),
      depthCells: clampInteger(base.institutionFootprint?.depthCells ?? 3, 2, 6)
    },
    viewFraming: {
      zoom: clamp(base.viewFraming?.zoom ?? 1.08, 0.92, 1.3),
      horizontalOffset: clamp(base.viewFraming?.horizontalOffset ?? 0, -6, 6)
    },
    intents: {
      retail: normalizeBuildingIntent(sourceIntents.retail),
      workshops: normalizeBuildingIntent(sourceIntents.workshops),
      institution: normalizeBuildingIntent(sourceIntents.institution)
    }
  };
}

export function createRandomVoxelIntentDistrictConfig(seed = Date.now(), base = {}) {
  const stableSeed = String(seed);
  const rng = createRng(stableSeed);
  const source = normalizeVoxelIntentDistrictConfig(base);
  const stylePairs = [
    ["victorian_gothic", "industrial_iron"],
    ["victorian_domestic", "industrial_iron"],
    ["victorian_gothic", "victorian_domestic"]
  ];
  const [retailStyle, workshopStyle] = stylePairs[Math.floor(rng() * stylePairs.length)];
  return normalizeVoxelIntentDistrictConfig({
    ...source,
    id: `agent-quarter-${stableSeed}`,
    seed: stableSeed,
    sunTime: Number((0.42 + rng() * 0.27).toFixed(3)),
    magicBias: Number((-0.04 + rng() * 0.22).toFixed(3)),
    intents: {
      ...source.intents,
      retail: { ...source.intents.retail, style: retailStyle },
      workshops: { ...source.intents.workshops, style: workshopStyle },
      institution: {
        ...source.intents.institution,
        composition: rng() < 0.5 ? "tower" : "court",
        style: rng() < 0.5 ? "civic_classical" : "victorian_gothic"
      }
    }
  });
}

export function createVoxelIntentDistrict(config = {}) {
  const params = normalizeVoxelIntentDistrictConfig(config);
  const root = new THREE.Group();
  root.name = `VoxelIntentDistrict-${params.id}`;
  const layout = createVoxelDistrictLayout(params);

  const retail = createVoxelBuildingLab(adaptBuildingIntentToStreetConfig(
    withMagicBias(params.intents.retail, params.magicBias),
    {
      seed: `${params.seed}:retail`,
      sunTime: params.sunTime,
      nightLighting: params.nightLighting,
      buildingCount: 3,
      parcelWidth: DISTRICT_CELL_VOXELS,
      parcelDepth: 32,
      includeStreetBase: false,
      includeStreetLamps: false,
      renderStrategy: "greedy",
      voxelChunkSize: 128,
      maxMergeSpanVoxels: 8
    }
  ));
  retail.name = "IntentPlot-RetailTerrace";
  placeDistrictObject(retail, layout.placements.retail, { widthCells: 3, depthCells: 1 });

  const workshops = createVoxelBuildingLab(adaptBuildingIntentToStreetConfig(
    withMagicBias(params.intents.workshops, params.magicBias),
    {
      seed: `${params.seed}:workshops`,
      sunTime: params.sunTime,
      nightLighting: params.nightLighting,
      buildingCount: 1,
      parcelWidth: DISTRICT_CELL_VOXELS,
      parcelDepth: DISTRICT_CELL_VOXELS,
      includeStreetBase: false,
      includeStreetLamps: false,
      renderStrategy: "greedy",
      voxelChunkSize: 128,
      maxMergeSpanVoxels: 8
    }
  ));
  workshops.name = "IntentPlot-ServiceLane";
  placeDistrictObject(workshops, layout.placements.workshops, { widthCells: 1, depthCells: 1 });
  workshops.rotation.y = -Math.PI / 2;

  const institution = createVoxelMassingLab(adaptBuildingIntentToMassingConfig(
    withMagicBias(params.intents.institution, params.magicBias),
    {
      id: `${params.id}-institution`,
      seed: `${params.seed}:institution`,
      sunTime: params.sunTime,
      nightLighting: params.nightLighting,
      widthCells: params.institutionFootprint.widthCells,
      depthCells: params.institutionFootprint.depthCells,
      viewFraming: params.viewFraming,
      renderStrategy: "greedy",
      voxelChunkSize: 128,
      maxMergeSpanVoxels: 8
    }
  ));
  institution.name = "IntentPlot-PublicInstitution";
  placeDistrictObject(institution, layout.placements.institution, {
    widthCells: institution.userData.spec.footprint.widthCells,
    depthCells: institution.userData.spec.footprint.depthCells
  });

  const environment = createVoxelDistrictEnvironment(params, layout);
  const macroSurface = createVoxelDistrictMacroSurface(params);
  root.add(macroSurface.group, environment.group, retail, workshops, institution);
  const sphericalProjection = projectDistrictOntoSphere(root, params.planetRadius);
  const prefabDistricts = createVoxelPrefabDistricts(params, macroSurface.constructionPlan);
  root.add(prefabDistricts.group);

  const childDiagnostics = [retail, workshops, institution].map((child) => (
    child.userData.getVoxelDiagnostics?.() ?? {}
  ));
  const intents = Object.values(params.intents).map((intent) => ({
    name: intent.name,
    purpose: intent.purpose,
    composition: intent.composition,
    frontage: intent.frontage,
    access: intent.access,
    style: intent.style,
    magicLevel: clamp(intent.magicLevel + params.magicBias, 0, 1)
  }));
  const diagnostics = {
    renderer: "voxel-intent-district-v0.3",
    plotCount: 3,
    streetBuildingCount: childDiagnostics.slice(0, 2).reduce((total, entry) => total + (entry.buildingCount ?? 0), 0),
    publicMassCount: childDiagnostics[2].massCount ?? 0,
    instanceCount: environment.diagnostics.instanceCount
      + childDiagnostics.reduce((total, entry) => total + (entry.instanceCount ?? 0), 0),
    drawCalls: macroSurface.diagnostics.chunkCount + environment.diagnostics.drawCalls
      + childDiagnostics.reduce((total, entry) => total + (entry.drawCalls ?? 0), 0),
    renderedTriangles: macroSurface.diagnostics.triangleCount + environment.diagnostics.renderStats?.renderedTriangles
      + childDiagnostics.reduce((total, entry) => total + (entry.renderStats?.renderedTriangles ?? 0), 0),
    mergedQuadCount: environment.diagnostics.renderStats?.mergedQuadCount
      + childDiagnostics.reduce((total, entry) => total + (entry.renderStats?.mergedQuadCount ?? 0), 0),
    renderStrategy: "greedy-spatial-chunks",
    world: {
      ...macroSurface.diagnostics,
      prefabDistricts: prefabDistricts.diagnostics
    },
    environment: environment.diagnostics,
    grid: createDistrictGridDiagnostics(layout, { retail, workshops, institution }),
    projection: sphericalProjection,
    intents
  };

  root.userData.config = params;
  root.userData.layout = structuredClone(layout);
  root.userData.surfaceNavigation = {
    radius: params.planetRadius,
    center: [0, -params.planetRadius, 0],
    bounds: {
      minX: -params.worldColumns * DISTRICT_CELL_VOXELS * VOXEL_SIZE * 0.46,
      maxX: params.worldColumns * DISTRICT_CELL_VOXELS * VOXEL_SIZE * 0.46,
      minZ: -params.worldRows * DISTRICT_CELL_VOXELS * VOXEL_SIZE * 0.46,
      maxZ: params.worldRows * DISTRICT_CELL_VOXELS * VOXEL_SIZE * 0.46
    },
    yawDegrees: 45,
    elevationDegrees: 35.264,
    cameraDistance: 58,
    targetHeight: 4.8
  };
  root.userData.intents = structuredClone(params.intents);
  root.userData.diagnostics = diagnostics;
  root.userData.contract = {
    mode: "intent-district",
    renderer: diagnostics.renderer,
    intentCatalog: getBuildingIntentCatalog(),
    sourceOfTruth: "BuildingIntent v0.1 adapted into street and massing specs",
    environment: {
      sourceOfTruth: "district seed + deterministic voxel environment recipe",
      voxelSize: VOXEL_SIZE,
      cellVoxels: DISTRICT_CELL_VOXELS,
      gridSize: [DISTRICT_COLUMNS, DISTRICT_ROWS],
      worldGridSize: [params.worldColumns, params.worldRows],
      worldDimensions: [
        params.worldColumns * DISTRICT_CELL_VOXELS * VOXEL_SIZE,
        params.worldRows * DISTRICT_CELL_VOXELS * VOXEL_SIZE
      ],
      dimensionsVoxels: [DISTRICT_WIDTH_VOXELS, DISTRICT_DEPTH_VOXELS],
      dimensionsWorld: [DISTRICT_WIDTH_VOXELS * VOXEL_SIZE, DISTRICT_DEPTH_VOXELS * VOXEL_SIZE],
      layers: ["terrain", "water", "embankment", "voxel-road-network", "pavement", "street-lighting", "vegetation"],
      artDirection: "Stepped landform voxels, coherent biome colour fields, and the same base-voxel tree, shrub, flower, mushroom, and reed grammar across the full 50x50 world.",
      renderSurface: "spherical voxel world; flat logical coordinates remain authoritative",
      projection: "each voxel is positioned and oriented by its local sphere normal and tangent basis",
      renderStrategy: "bounded greedy surface quads grouped into spatial chunks; logical voxels remain authoritative",
      construction: {
        buildableRule: "A 50x50 logical cell is rejected when any fine terrain voxel inside it contains water.",
        siteRule: "Authored districts require a contiguous 5x4 set of dry non-shore cells with no overlap.",
        gradingRule: "Every selected site is flattened to the same world construction datum before road and parcel surfaces are written; surrounding grass eases into that datum over two logical cells.",
        clearanceRule: "Building roots sit above the finished parcel height so terrain can never cover the parcel or facade base."
      },
      roadNetwork: {
        topology: ["end", "straight", "corner", "tee", "cross"],
        connectionRule: "cardinal ports are derived from adjacent logical road cells",
        closureRule: "every unconnected continuation is filled with raised voxel pavement and a limestone curb",
        fixtureRule: "terrace-front street lamps are owned and rendered by the road network"
      }
    },
    camera: {
      navigation: "fixed-radius surface pan",
      rotation: "locked local isometric",
      yawDegrees: 45,
      elevationDegrees: 35.264,
      depthOfField: "bokeh retained"
    },
    plots: intents
  };
  root.userData.getVoxelDiagnostics = () => structuredClone(diagnostics);
  root.userData.getPrefabLodDiagnostics = () => structuredClone(prefabDistricts.diagnostics);
  root.userData.getVoxelContract = () => structuredClone(root.userData.contract);
  root.userData.updateDaylight = (style) => {
    retail.userData.updateDaylight?.(style);
    workshops.userData.updateDaylight?.(style);
    institution.userData.updateDaylight?.(style);
    environment.updateDaylight(style);
    prefabDistricts.updateDaylight(style);
  };
  root.userData.updateView = (camera, maxDynamicLights = 4, viewport = {}) => {
    macroSurface.group.userData.updateView?.(camera);
    environment.updateView(camera, maxDynamicLights);
    prefabDistricts.updateView(camera, viewport);
  };
  root.userData.updateDaylight(voxelDaylightStyle(params.sunTime));
  return root;
}

export function createVoxelDistrictLayout(config = {}) {
  const institutionFootprint = {
    widthCells: clampInteger(config.institutionFootprint?.widthCells ?? 5, 2, 6),
    depthCells: clampInteger(config.institutionFootprint?.depthCells ?? 3, 2, 6)
  };
  const institutionPlacement = { column: 4, row: 0 };
  const roadRow = Math.min(DISTRICT_ROWS - 2, institutionFootprint.depthCells);
  const retailPlacement = { column: 1, row: Math.max(0, roadRow - 1) };
  const workshopPlacement = { column: 8, row: Math.min(DISTRICT_ROWS - 1, roadRow + 1) };
  const cells = Array.from({ length: DISTRICT_ROWS }, (_, row) => (
    Array.from({ length: DISTRICT_COLUMNS }, (_, column) => ({
      id: `district-cell-${column}-${row}`,
      column,
      row,
      surface: "terrain",
      occupant: null
    }))
  )).flat();
  const byCoordinate = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const mark = (column, row, surface, occupant = null) => {
    const cell = byCoordinate.get(`${column},${row}`);
    if (!cell) return;
    cell.surface = surface;
    cell.occupant = occupant;
  };

  for (let row = 0; row < DISTRICT_ROWS; row += 1) mark(0, row, "water");
  for (let row = institutionPlacement.row; row < institutionPlacement.row + institutionFootprint.depthCells; row += 1) {
    for (let column = institutionPlacement.column; column < institutionPlacement.column + institutionFootprint.widthCells; column += 1) {
      mark(column, row, "pavement", "institution");
    }
  }
  for (let column = retailPlacement.column; column < retailPlacement.column + 3; column += 1) {
    mark(column, retailPlacement.row, "pavement", "retail");
  }
  for (let column = 1; column < DISTRICT_COLUMNS; column += 1) mark(column, roadRow, "road");
  for (let row = roadRow; row < DISTRICT_ROWS; row += 1) mark(7, row, "road");
  mark(workshopPlacement.column, workshopPlacement.row, "pavement", "workshops");

  return {
    columns: DISTRICT_COLUMNS,
    rows: DISTRICT_ROWS,
    cellVoxels: DISTRICT_CELL_VOXELS,
    widthVoxels: DISTRICT_WIDTH_VOXELS,
    depthVoxels: DISTRICT_DEPTH_VOXELS,
    cells,
    placements: {
      institution: institutionPlacement,
      retail: retailPlacement,
      workshops: workshopPlacement
    },
    institutionFootprint,
    roadRow
  };
}

export function createVoxelDistrictRoadPlan(layout = createVoxelDistrictLayout()) {
  const roadCells = new Map(layout.cells
    .filter((cell) => cell.surface === "road")
    .map((cell) => [`${cell.column},${cell.row}`, cell]));
  return [...roadCells.values()].map((cell) => {
    const ports = ROAD_DIRECTIONS.filter((direction) => {
      const [columnOffset, rowOffset] = ROAD_OFFSETS[direction];
      return roadCells.has(`${cell.column + columnOffset},${cell.row + rowOffset}`);
    });
    const topology = classifyVoxelRoadTopology(ports);
    return {
      cell,
      ports,
      topology,
      closedPorts: getClosedVoxelRoadPorts(ports, topology),
      adjacentPlots: ROAD_DIRECTIONS.map((direction) => {
        const [columnOffset, rowOffset] = ROAD_OFFSETS[direction];
        const neighbor = layout.cells.find((candidate) => (
          candidate.column === cell.column + columnOffset
          && candidate.row === cell.row + rowOffset
        ));
        return neighbor?.occupant ? { direction, occupant: neighbor.occupant } : null;
      }).filter(Boolean)
    };
  });
}

export function classifyVoxelRoadTopology(ports = []) {
  if (ports.length >= 4) return "cross";
  if (ports.length === 3) return "tee";
  if (ports.length <= 1) return "end";
  const vertical = ports.includes("north") && ports.includes("south");
  const horizontal = ports.includes("east") && ports.includes("west");
  return vertical || horizontal ? "straight" : "corner";
}

/**
 * Writes the reusable 32-voxel Victorian street tile used by authored voxel
 * districts. Consumers supply their own world-space tile origin and elevation,
 * while this shared asset keeps road silhouettes, kerbs, markings, wear and
 * street furniture visually consistent across city modes.
 */
export function addSharedVoxelRoadTile(buffer, {
  minX,
  minZ,
  surfaceY,
  ports = [],
  tileIndex = 0,
  owner = "shared-voxel-road",
  northIsPositiveZ = false
}) {
  const structureWrite = { priority: VOXEL_WRITE_PRIORITIES.structure, owner };
  const detailWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: `${owner}:detail` };
  const effectWrite = { priority: VOXEL_WRITE_PRIORITIES.effect, owner: `${owner}:lamp-glow` };
  const roadAt = (localX, localZ) => isSharedVoxelRoadLocalAt(ports, localX, localZ, northIsPositiveZ);
  let curbVoxels = 0;
  let markingVoxels = 0;
  let wearVoxels = 0;

  for (let localZ = 0; localZ < DISTRICT_CELL_VOXELS; localZ += 1) {
    for (let localX = 0; localX < DISTRICT_CELL_VOXELS; localX += 1) {
      const x = minX + localX;
      const z = minZ + localZ;
      const road = roadAt(localX, localZ);
      buffer.addVoxel(road ? "road" : "pavement", x, surfaceY, z, tileIndex + localX * 3 + localZ, structureWrite);
      if (!road) {
        if (positiveModulo(x * 5 + z * 3 + tileIndex, 23) === 0) {
          buffer.addVoxel("sandstone", x, surfaceY, z, x + z, detailWrite);
        }
        continue;
      }
      const touchesPavement = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
        const neighborX = localX + dx;
        const neighborZ = localZ + dz;
        if (neighborX < 0 || neighborX >= DISTRICT_CELL_VOXELS || neighborZ < 0 || neighborZ >= DISTRICT_CELL_VOXELS) return false;
        return !roadAt(neighborX, neighborZ);
      });
      if (touchesPavement) {
        buffer.addVoxel("limestone", x, surfaceY, z, x * 13 + z, detailWrite);
        curbVoxels += 1;
      }
    }
  }

  const center = VOXEL_ROAD_INSET + Math.floor(VOXEL_ROAD_WIDTH / 2);
  const addMarking = (localX, localZ, shade = 0) => {
    if (!roadAt(localX, localZ)) return;
    buffer.addVoxel("limestone", minX + localX, surfaceY, minZ + localZ, tileIndex + shade, detailWrite);
    markingVoxels += 1;
  };
  const topology = classifyVoxelRoadTopology(ports);
  if (topology === "straight") {
    const horizontal = ports.includes("east") && ports.includes("west");
    for (let distance = 2; distance < DISTRICT_CELL_VOXELS - 2; distance += 1) {
      if (positiveModulo(distance + tileIndex, 8) >= 3) continue;
      addMarking(horizontal ? distance : center, horizontal ? center : distance, distance);
    }
  } else {
    ports.forEach((direction) => {
      for (let distance = 2; distance < VOXEL_ROAD_INSET; distance += 1) {
        if (positiveModulo(distance + tileIndex, 7) >= 3) continue;
        if (direction === "north") addMarking(center, northIsPositiveZ ? DISTRICT_CELL_VOXELS - 1 - distance : distance, distance);
        if (direction === "south") addMarking(center, northIsPositiveZ ? distance : DISTRICT_CELL_VOXELS - 1 - distance, distance);
        if (direction === "west") addMarking(distance, center, distance);
        if (direction === "east") addMarking(DISTRICT_CELL_VOXELS - 1 - distance, center, distance);
      }
    });
  }

  if (ports.length >= 3) {
    ports.forEach((direction, directionIndex) => {
      for (let stripe = VOXEL_ROAD_INSET + 3; stripe < VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH - 3; stripe += 4) {
        for (let thickness = 0; thickness < 2; thickness += 1) {
          if (direction === "north") addMarking(stripe, northIsPositiveZ ? VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH + 1 - thickness : VOXEL_ROAD_INSET - 3 + thickness, 30 + directionIndex);
          if (direction === "south") addMarking(stripe, northIsPositiveZ ? VOXEL_ROAD_INSET - 3 + thickness : VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH + 1 - thickness, 30 + directionIndex);
          if (direction === "west") addMarking(VOXEL_ROAD_INSET - 3 + thickness, stripe, 30 + directionIndex);
          if (direction === "east") addMarking(VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH + 1 - thickness, stripe, 30 + directionIndex);
        }
      }
    });
  }

  for (let patch = 0; patch < 3; patch += 1) {
    const localX = positiveModulo(tileIndex * 11 + patch * 9, DISTRICT_CELL_VOXELS);
    const localZ = positiveModulo(tileIndex * 13 + patch * 7, DISTRICT_CELL_VOXELS);
    for (let dz = 0; dz < 2; dz += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const x = Math.min(DISTRICT_CELL_VOXELS - 1, localX + dx);
        const z = Math.min(DISTRICT_CELL_VOXELS - 1, localZ + dz);
        if (!roadAt(x, z)) continue;
        buffer.addVoxel("stoneShadow", minX + x, surfaceY, minZ + z, tileIndex * 17 + patch, detailWrite);
        wearVoxels += 1;
      }
    }
  }

  let lampCount = 0;
  if (positiveModulo(tileIndex, 5) === 0) {
    const offset = VOXEL_ROAD_LAMP_SIDEWALK_OFFSET;
    const candidates = [
      [offset, offset],
      [DISTRICT_CELL_VOXELS - offset - 1, offset],
      [DISTRICT_CELL_VOXELS - offset - 1, DISTRICT_CELL_VOXELS - offset - 1],
      [offset, DISTRICT_CELL_VOXELS - offset - 1]
    ];
    const lamp = candidates.find(([x, z]) => !roadAt(x, z));
    if (lamp) {
      const [localX, localZ] = lamp;
      const x = minX + localX;
      const z = minZ + localZ;
      buffer.addBox("iron", x - 1, surfaceY + 1, z - 1, 3, 1, 3, tileIndex, detailWrite);
      buffer.addBox("iron", x, surfaceY + 2, z, 1, 11, 1, tileIndex + 1, detailWrite);
      buffer.addBox("iron", x - 1, surfaceY + 13, z - 1, 3, 1, 3, tileIndex + 2, detailWrite);
      buffer.addBox("warmWindow", x - 1, surfaceY + 14, z - 1, 3, 3, 3, tileIndex + 3, effectWrite);
      buffer.addBox("iron", x - 2, surfaceY + 17, z - 2, 5, 1, 5, tileIndex + 4, detailWrite);
      buffer.addVoxel("iron", x, surfaceY + 18, z, tileIndex + 5, detailWrite);
      lampCount = 1;
    }
  }

  return { topology, curbVoxels, markingVoxels, wearVoxels, lampCount };
}

function isSharedVoxelRoadLocalAt(ports, localX, localZ, northIsPositiveZ) {
  const maximumInset = VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH;
  const insideX = localX >= VOXEL_ROAD_INSET && localX < maximumInset;
  const insideZ = localZ >= VOXEL_ROAD_INSET && localZ < maximumInset;
  if (insideX && insideZ) return true;
  if (ports.includes("north") && insideX && (northIsPositiveZ ? localZ >= maximumInset : localZ < VOXEL_ROAD_INSET)) return true;
  if (ports.includes("south") && insideX && (northIsPositiveZ ? localZ < VOXEL_ROAD_INSET : localZ >= maximumInset)) return true;
  if (ports.includes("west") && insideZ && localX < VOXEL_ROAD_INSET) return true;
  if (ports.includes("east") && insideZ && localX >= maximumInset) return true;
  return false;
}

export function createVoxelDistrictMacroSurface(config = {}) {
  const params = normalizeVoxelIntentDistrictConfig(config);
  const blankConstruction = Boolean(config.blankConstruction);
  const group = new THREE.Group();
  group.name = "IntentDistrictMacroWorld";
  const chunkCells = 8;
  const cellWorldSize = DISTRICT_CELL_VOXELS * VOXEL_SIZE;
  const terrainVoxelWorldSize = cellWorldSize / MACRO_TERRAIN_SUBDIVISIONS;
  const terrainColumns = params.worldColumns * MACRO_TERRAIN_SUBDIVISIONS;
  const terrainRows = params.worldRows * MACRO_TERRAIN_SUBDIVISIONS;
  const worldWidth = params.worldColumns * cellWorldSize;
  const worldDepth = params.worldRows * cellWorldSize;
  const palette = {
    grass: new THREE.Color("#76925a"),
    grassLight: new THREE.Color("#91a967"),
    grassDark: new THREE.Color("#4f7047"),
    water: new THREE.Color("#4389a8"),
    waterLight: new THREE.Color("#579bb5"),
    shore: new THREE.Color("#b99f78"),
    road: new THREE.Color("#696c70"),
    pavement: new THREE.Color("#a8a198"),
    parcel: new THREE.Color("#8d9e69"),
    soil: new THREE.Color("#765a45"),
    stone: new THREE.Color("#77766d")
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    flatShading: true
  });
  const terrainGrid = createMacroTerrainGrid(params, {
    terrainColumns,
    terrainRows,
    terrainVoxelWorldSize,
    worldWidth,
    worldDepth
  });
  const constructionPlan = createMacroConstructionPlan(params, terrainGrid, {
    cellWorldSize,
    terrainVoxelWorldSize,
    worldWidth,
    worldDepth,
    blankConstruction
  });
  let triangleCount = 0;
  let waterCellCount = 0;
  let chunkCount = 0;
  const terrainMeshes = [];

  for (let chunkRow = 0; chunkRow < params.worldRows; chunkRow += chunkCells) {
    for (let chunkColumn = 0; chunkColumn < params.worldColumns; chunkColumn += chunkCells) {
      const startTerrainRow = chunkRow * MACRO_TERRAIN_SUBDIVISIONS;
      const startTerrainColumn = chunkColumn * MACRO_TERRAIN_SUBDIVISIONS;
      const endRow = Math.min(terrainRows, (chunkRow + chunkCells) * MACRO_TERRAIN_SUBDIVISIONS);
      const endColumn = Math.min(terrainColumns, (chunkColumn + chunkCells) * MACRO_TERRAIN_SUBDIVISIONS);
      const chunkGeometry = createMacroTerrainChunkGeometry(terrainGrid, palette, {
        startTerrainRow,
        startTerrainColumn,
        endRow,
        endColumn,
        terrainVoxelWorldSize,
        worldWidth,
        worldDepth
      });
      const { geometry } = chunkGeometry;
      triangleCount += chunkGeometry.triangleCount;
      waterCellCount += chunkGeometry.waterCellCount;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `IntentDistrictMacroChunk-${chunkColumn}-${chunkRow}`;
      mesh.userData.materialId = "macroTerrain";
      mesh.userData.flatVoxelGeometry = true;
      mesh.userData.sourceVoxelCount = 0;
      mesh.userData.chunk = [chunkColumn / chunkCells, 0, chunkRow / chunkCells];
      mesh.receiveShadow = true;
      mesh.renderOrder = -10;
      group.add(mesh);
      terrainMeshes.push(mesh);
      chunkCount += 1;
    }
  }
  const macroVegetation = createMacroVoxelVegetation(params, terrainGrid, {
    cellWorldSize,
    terrainVoxelWorldSize,
    worldWidth,
    worldDepth
  });
  group.add(macroVegetation.group);
  const diagnostics = {
    representation: "macro-terrain-chunks",
    gridSize: [params.worldColumns, params.worldRows],
    dimensionsWorld: [worldWidth, worldDepth],
    logicalCellCount: params.worldColumns * params.worldRows,
    terrainVoxelGridSize: [terrainColumns, terrainRows],
    terrainVoxelsPerCell: MACRO_TERRAIN_SUBDIVISIONS ** 2,
    surfaceVoxelCount: terrainColumns * terrainRows,
    terrainVoxelWorldSize,
    terrainVoxelBaseSpan: terrainVoxelWorldSize / VOXEL_SIZE,
    waterCellCount,
    chunkCells,
    chunkCount,
    triangleCount,
    elevationSteps: 4,
    terrainStyle: "base-voxel heightfield with seeded multi-scale organic contours and gentle 0-4 voxel rises outside the shared construction datum",
    paletteRule: "organic, non-repeating grass patches reuse the central grass, grassLight, and grassDark material colours across the full map",
    meshStrategy: `sphere-safe ${MACRO_TERRAIN_MAX_MERGE_SPAN}x${MACRO_TERRAIN_MAX_MERGE_SPAN} maximum coplanar merging with exact one-voxel contour boundaries`,
    construction: constructionPlan.diagnostics,
    vegetation: macroVegetation.diagnostics
  };
  group.userData.diagnostics = diagnostics;
  group.userData.constructionPlan = constructionPlan;
  group.userData.updateView = createSphericalTerrainChunkUpdater(
    terrainMeshes,
    params.planetRadius,
    diagnostics
  );
  return { group, diagnostics, constructionPlan };
}

function createSphericalTerrainChunkUpdater(meshes, radius, diagnostics) {
  const sphereCenter = new THREE.Vector3(0, -radius, 0);
  const cameraDirection = new THREE.Vector3();
  const chunkDirection = new THREE.Vector3();
  return (camera) => {
    if (!camera) return;
    cameraDirection.subVectors(camera.position, sphereCenter);
    const cameraRadius = cameraDirection.length();
    if (cameraRadius <= radius + 0.001) {
      meshes.forEach((mesh) => { mesh.visible = true; });
      diagnostics.horizonVisibleChunks = meshes.length;
      diagnostics.horizonCulledChunks = 0;
      return;
    }
    cameraDirection.multiplyScalar(1 / cameraRadius);
    const horizonAngle = Math.acos(THREE.MathUtils.clamp(radius / cameraRadius, -1, 1));
    let visibleChunks = 0;
    meshes.forEach((mesh) => {
      const bounds = mesh.geometry.boundingSphere;
      if (!bounds) {
        mesh.visible = true;
        visibleChunks += 1;
        return;
      }
      chunkDirection.subVectors(bounds.center, sphereCenter);
      const chunkRadiusFromCenter = Math.max(radius, chunkDirection.length());
      chunkDirection.normalize();
      const angularRadius = Math.asin(THREE.MathUtils.clamp(bounds.radius / chunkRadiusFromCenter, 0, 1));
      mesh.visible = chunkDirection.dot(cameraDirection) >= Math.cos(Math.min(Math.PI, horizonAngle + angularRadius));
      if (mesh.visible) visibleChunks += 1;
    });
    diagnostics.horizonVisibleChunks = visibleChunks;
    diagnostics.horizonCulledChunks = meshes.length - visibleChunks;
  };
}

function createMacroConstructionPlan(params, terrainGrid, {
  cellWorldSize,
  terrainVoxelWorldSize,
  worldWidth,
  worldDepth,
  blankConstruction = false
}) {
  const logicalCells = [];
  for (let row = 0; row < params.worldRows; row += 1) {
    for (let column = 0; column < params.worldColumns; column += 1) {
      const surfaceStats = terrainGrid.getLogicalCellStats(column, row);
      const { waterVoxels, shoreVoxels, minimumStep, maximumStep } = surfaceStats;
      logicalCells.push({
        id: `world-cell-${column}-${row}`,
        column,
        row,
        buildable: waterVoxels === 0,
        strictBuildable: waterVoxels === 0 && shoreVoxels === 0,
        waterVoxels,
        shoreVoxels,
        heightRangeVoxels: maximumStep - minimumStep,
        centerX: -worldWidth / 2 + (column + 0.5) * cellWorldSize,
        centerZ: -worldDepth / 2 + (row + 0.5) * cellWorldSize
      });
    }
  }
  if (blankConstruction) {
    const buildableCells = logicalCells.filter((cell) => cell.buildable);
    return {
      logicalCells,
      sites: [],
      centralProtection: null,
      diagnostics: {
        rule: "A logical cell is buildable only when none of its fine terrain voxels contains water.",
        strictSiteRule: "Building sites require contiguous dry, non-shore logical cells.",
        blankConstruction: true,
        logicalCellCount: logicalCells.length,
        buildableCellCount: buildableCells.length,
        rejectedWaterCellCount: logicalCells.length - buildableCells.length,
        strictBuildableCellCount: logicalCells.filter((cell) => cell.strictBuildable).length,
        siteCount: 0,
        flattenedLogicalCellCount: 0,
        roadSurfaceVoxels: 0,
        parcelSurfaceVoxels: 0,
        maximumFlattenDeltaVoxels: 0,
        gradedTransitionVoxels: 0,
        globalConstructionHeight: GLOBAL_CONSTRUCTION_HEIGHT
      }
    };
  }
  const byCoordinate = new Map(logicalCells.map((cell) => [`${cell.column}:${cell.row}`, cell]));
  const centralBounds = {
    minColumn: Math.floor((params.worldColumns - DISTRICT_COLUMNS) / 2),
    minRow: Math.floor((params.worldRows - DISTRICT_ROWS) / 2),
    widthCells: DISTRICT_COLUMNS,
    depthCells: DISTRICT_ROWS
  };
  const reservedBounds = [{ ...centralBounds, id: "central-detailed-district", marginCells: 1 }];
  const sites = [];
  PREFAB_DISTRICT_ANCHORS.forEach((anchor) => {
    const widthCells = 5;
    const depthCells = 4;
    const preferredColumn = Math.round((anchor.x + worldWidth / 2) / cellWorldSize - widthCells / 2);
    const preferredRow = Math.round((anchor.z + worldDepth / 2) / cellWorldSize - depthCells / 2);
    const candidates = [];
    for (let row = 1; row <= params.worldRows - depthCells - 1; row += 1) {
      for (let column = 1; column <= params.worldColumns - widthCells - 1; column += 1) {
        const bounds = { minColumn: column, minRow: row, widthCells, depthCells };
        if ([...reservedBounds, ...sites].some((blocked) => macroBoundsOverlap(bounds, blocked, 1))) continue;
        const cells = getMacroCellsInBounds(byCoordinate, bounds);
        if (cells.length !== widthCells * depthCells || cells.some((cell) => !cell.strictBuildable)) continue;
        const distance = Math.hypot(column - preferredColumn, row - preferredRow);
        const roughness = cells.reduce((total, cell) => total + cell.heightRangeVoxels, 0) / cells.length;
        candidates.push({ bounds, cells, score: distance * 8 + roughness });
      }
    }
    candidates.sort((left, right) => left.score - right.score);
    const selected = candidates[0];
    if (!selected) return;
    const sourceHeightRangeVoxels = terrainGrid.getLogicalBoundsHeightRange(selected.bounds);
    const targetHeight = GLOBAL_CONSTRUCTION_HEIGHT;
    const centerX = -worldWidth / 2 + (selected.bounds.minColumn + widthCells / 2) * cellWorldSize;
    const centerZ = -worldDepth / 2 + (selected.bounds.minRow + depthCells / 2) * cellWorldSize;
    sites.push({
      id: anchor.id,
      intent: anchor.intent,
      preferredAnchor: [anchor.x, anchor.z],
      centerX,
      centerZ,
      targetHeight,
      minColumn: selected.bounds.minColumn,
      minRow: selected.bounds.minRow,
      widthCells,
      depthCells,
      logicalCellIds: selected.cells.map((cell) => cell.id),
      sourceHeightRangeVoxels
    });
  });

  const protectedHeight = GLOBAL_CONSTRUCTION_HEIGHT;
  terrainGrid.forEachInLogicalBounds(centralBounds, (index) => {
    terrainGrid.elevationSteps[index] = 0;
    terrainGrid.kinds[index] = MACRO_TERRAIN_KIND.reserved;
    terrainGrid.biomes[index] = MACRO_TERRAIN_BIOME.reserved;
    terrainGrid.colors[index] = MACRO_TERRAIN_COLOR.parcel;
  });

  let roadSurfaceVoxels = 0;
  let parcelSurfaceVoxels = 0;
  let maximumFlattenDeltaVoxels = 0;
  sites.forEach((site) => {
    terrainGrid.forEachInLogicalBounds(site, (index, column, row) => {
      maximumFlattenDeltaVoxels = Math.max(maximumFlattenDeltaVoxels, Math.abs(terrainGrid.elevationSteps[index]));
      const localX = terrainGrid.centerX(column) - site.centerX;
      const localZ = terrainGrid.centerZ(row) - site.centerZ;
      const road = Math.abs(localX) <= 1.6 || Math.abs(localZ) <= 1.6;
      terrainGrid.elevationSteps[index] = 0;
      terrainGrid.kinds[index] = road ? MACRO_TERRAIN_KIND.constructionRoad : MACRO_TERRAIN_KIND.constructionParcel;
      terrainGrid.biomes[index] = road ? MACRO_TERRAIN_BIOME.road : MACRO_TERRAIN_BIOME.parcel;
      terrainGrid.colors[index] = road ? MACRO_TERRAIN_COLOR.road : MACRO_TERRAIN_COLOR.parcel;
      if (road) roadSurfaceVoxels += 1;
      else parcelSurfaceVoxels += 1;
    });
  });

  const constructionBounds = [centralBounds, ...sites].map((bounds) => ({
    minX: -worldWidth / 2 + bounds.minColumn * cellWorldSize,
    maxX: -worldWidth / 2 + (bounds.minColumn + bounds.widthCells) * cellWorldSize,
    minZ: -worldDepth / 2 + bounds.minRow * cellWorldSize,
    maxZ: -worldDepth / 2 + (bounds.minRow + bounds.depthCells) * cellWorldSize
  }));
  let gradedTransitionVoxels = 0;
  for (let row = 0; row < terrainGrid.height; row += 1) {
    const centerZ = terrainGrid.centerZ(row);
    for (let column = 0; column < terrainGrid.width; column += 1) {
      const index = terrainGrid.index(column, row);
      if (terrainGrid.kinds[index] !== MACRO_TERRAIN_KIND.terrain) continue;
      const centerX = terrainGrid.centerX(column);
      let distance = Infinity;
      constructionBounds.forEach((bounds) => {
        distance = Math.min(distance, distanceToWorldBounds(centerX, centerZ, bounds));
      });
      if (distance > cellWorldSize * 2) continue;
      const allowedRiseVoxels = clampInteger(Math.ceil(distance / (terrainVoxelWorldSize * 2)), 0, 4);
      if (terrainGrid.elevationSteps[index] <= allowedRiseVoxels) continue;
      terrainGrid.elevationSteps[index] = allowedRiseVoxels;
      gradedTransitionVoxels += 1;
    }
  }

  const buildableCells = logicalCells.filter((cell) => cell.buildable);
  return {
    logicalCells,
    sites,
    centralProtection: { ...centralBounds, targetHeight: protectedHeight },
    diagnostics: {
      rule: "A logical cell is buildable only when none of its fine terrain voxels contains water.",
      strictSiteRule: "Building sites require contiguous dry, non-shore logical cells and may not overlap another site.",
      logicalCellCount: logicalCells.length,
      buildableCellCount: buildableCells.length,
      rejectedWaterCellCount: logicalCells.length - buildableCells.length,
      strictBuildableCellCount: logicalCells.filter((cell) => cell.strictBuildable).length,
      siteCount: sites.length,
      siteFootprintCells: [5, 4],
      globalConstructionHeight: GLOBAL_CONSTRUCTION_HEIGHT,
      flattenedLogicalCellCount: sites.reduce((total, site) => total + site.logicalCellIds.length, 0),
      roadSurfaceVoxels,
      parcelSurfaceVoxels,
      maximumFlattenDeltaVoxels,
      gradedTransitionVoxels,
      centralProtection: { columns: DISTRICT_COLUMNS, rows: DISTRICT_ROWS },
      sites: sites.map((site) => ({
        id: site.id,
        preferredAnchor: site.preferredAnchor,
        resolvedAnchor: [site.centerX, site.centerZ],
        targetHeight: site.targetHeight,
        logicalCellIds: site.logicalCellIds,
        sourceHeightRangeVoxels: site.sourceHeightRangeVoxels
      }))
    }
  };
}

function getMacroCellsInBounds(byCoordinate, bounds) {
  const cells = [];
  for (let row = bounds.minRow; row < bounds.minRow + bounds.depthCells; row += 1) {
    for (let column = bounds.minColumn; column < bounds.minColumn + bounds.widthCells; column += 1) {
      const cell = byCoordinate.get(`${column}:${row}`);
      if (cell) cells.push(cell);
    }
  }
  return cells;
}


function macroBoundsOverlap(left, right, margin = 0) {
  return left.minColumn < right.minColumn + right.widthCells + margin
    && left.minColumn + left.widthCells + margin > right.minColumn
    && left.minRow < right.minRow + right.depthCells + margin
    && left.minRow + left.depthCells + margin > right.minRow;
}

function distanceToWorldBounds(x, z, bounds) {
  const distanceX = Math.max(bounds.minX - x, 0, x - bounds.maxX);
  const distanceZ = Math.max(bounds.minZ - z, 0, z - bounds.maxZ);
  return Math.hypot(distanceX, distanceZ);
}

function createMacroTerrainGrid(params, {
  terrainColumns,
  terrainRows,
  terrainVoxelWorldSize,
  worldWidth,
  worldDepth
}) {
  const cellCount = terrainColumns * terrainRows;
  const elevationSteps = new Int8Array(cellCount);
  const kinds = new Uint8Array(cellCount);
  const biomes = new Uint8Array(cellCount);
  const colors = new Uint8Array(cellCount);
  const terrainSeed = hashTerrainSeed(params.seed);
  const index = (column, row) => row * terrainColumns + column;
  const centerX = (column) => -worldWidth / 2 + (column + 0.5) * terrainVoxelWorldSize;
  const centerZ = (row) => -worldDepth / 2 + (row + 0.5) * terrainVoxelWorldSize;

  for (let row = 0; row < terrainRows; row += 1) {
    const worldZ = centerZ(row);
    const voxelZ = worldZ / VOXEL_SIZE;
    const riverDrift = terrainValueNoise(terrainSeed, voxelZ, 0, 380, 7) * worldWidth * 0.074
      + terrainValueNoise(terrainSeed, voxelZ, 0, 137, 8) * worldWidth * 0.018;
    const riverCenter = -worldWidth * 0.31 + riverDrift;
    const riverRadius = worldWidth * (0.0205 + terrainValueNoise(terrainSeed, voxelZ, 0, 91, 9) * 0.0024);
    for (let column = 0; column < terrainColumns; column += 1) {
      const cellIndex = index(column, row);
      const worldX = centerX(column);
      const voxelX = worldX / VOXEL_SIZE;
      const riverDistance = Math.abs(worldX - riverCenter);
      const lakeX = (worldX - worldWidth * 0.23) / (worldWidth * 0.052);
      const lakeZ = (worldZ + worldDepth * 0.24) / (worldDepth * 0.041);
      const lakeEdge = 1 + terrainValueNoise(terrainSeed, voxelX, voxelZ, 74, 10) * 0.13;
      const lakeDistance = Math.hypot(lakeX, lakeZ) / lakeEdge;
      const water = riverDistance < riverRadius || lakeDistance < 1;
      const shore = !water && (
        riverDistance < riverRadius + VOXEL_SIZE * 5
        || lakeDistance < 1.1
      );
      const elevationNoise = terrainFbm(terrainSeed, voxelX, voxelZ, 0);
      const elevationStep = water
        ? -3
        : shore
          ? 0
          : clampInteger(Math.round(1.65 + elevationNoise * 2.35), 0, 4);
      const moisture = terrainFbm(terrainSeed, voxelX + 173, voxelZ - 91, 3);
      const grassPatch = terrainFbm(terrainSeed, voxelX - 311, voxelZ + 227, 5);
      const kind = water ? MACRO_TERRAIN_KIND.water : shore ? MACRO_TERRAIN_KIND.shore : MACRO_TERRAIN_KIND.terrain;
      const biome = water
        ? MACRO_TERRAIN_BIOME.water
        : shore
          ? MACRO_TERRAIN_BIOME.shore
          : moisture > 0.25
            ? MACRO_TERRAIN_BIOME.woodland
            : moisture < -0.3
              ? MACRO_TERRAIN_BIOME.heath
              : moisture > 0.02 ? MACRO_TERRAIN_BIOME.meadowLight : MACRO_TERRAIN_BIOME.meadow;
      const color = water
        ? (terrainLatticeValue(terrainSeed, column, row, 12) > 0.56 ? MACRO_TERRAIN_COLOR.waterLight : MACRO_TERRAIN_COLOR.water)
        : shore
          ? MACRO_TERRAIN_COLOR.shore
          : grassPatch > 0.24
            ? MACRO_TERRAIN_COLOR.grassLight
            : grassPatch < -0.28 ? MACRO_TERRAIN_COLOR.grassDark : MACRO_TERRAIN_COLOR.grass;
      elevationSteps[cellIndex] = elevationStep;
      kinds[cellIndex] = kind;
      biomes[cellIndex] = biome;
      colors[cellIndex] = color;
    }
  }

  const grid = {
    width: terrainColumns,
    height: terrainRows,
    terrainVoxelWorldSize,
    worldWidth,
    worldDepth,
    elevationSteps,
    kinds,
    biomes,
    colors,
    index,
    centerX,
    centerZ,
    getCell(column, row) {
      if (column < 0 || row < 0 || column >= terrainColumns || row >= terrainRows) return null;
      const cellIndex = index(column, row);
      return {
        column,
        row,
        centerX: centerX(column),
        centerZ: centerZ(row),
        height: GLOBAL_CONSTRUCTION_HEIGHT + elevationSteps[cellIndex] * VOXEL_SIZE,
        kind: MACRO_TERRAIN_KIND_NAMES[kinds[cellIndex]],
        biome: MACRO_TERRAIN_BIOME_NAMES[biomes[cellIndex]]
      };
    },
    getLogicalCellStats(logicalColumn, logicalRow) {
      const startColumn = logicalColumn * MACRO_TERRAIN_SUBDIVISIONS;
      const startRow = logicalRow * MACRO_TERRAIN_SUBDIVISIONS;
      let waterVoxels = 0;
      let shoreVoxels = 0;
      let minimumStep = Infinity;
      let maximumStep = -Infinity;
      for (let localRow = 0; localRow < MACRO_TERRAIN_SUBDIVISIONS; localRow += 1) {
        for (let localColumn = 0; localColumn < MACRO_TERRAIN_SUBDIVISIONS; localColumn += 1) {
          const cellIndex = index(startColumn + localColumn, startRow + localRow);
          if (kinds[cellIndex] === MACRO_TERRAIN_KIND.water) waterVoxels += 1;
          if (kinds[cellIndex] === MACRO_TERRAIN_KIND.shore) shoreVoxels += 1;
          minimumStep = Math.min(minimumStep, elevationSteps[cellIndex]);
          maximumStep = Math.max(maximumStep, elevationSteps[cellIndex]);
        }
      }
      return { waterVoxels, shoreVoxels, minimumStep, maximumStep };
    },
    getLogicalBoundsHeightRange(bounds) {
      let minimumStep = Infinity;
      let maximumStep = -Infinity;
      this.forEachInLogicalBounds(bounds, (cellIndex) => {
        minimumStep = Math.min(minimumStep, elevationSteps[cellIndex]);
        maximumStep = Math.max(maximumStep, elevationSteps[cellIndex]);
      });
      return maximumStep - minimumStep;
    },
    forEachInLogicalBounds(bounds, callback) {
      const startColumn = bounds.minColumn * MACRO_TERRAIN_SUBDIVISIONS;
      const startRow = bounds.minRow * MACRO_TERRAIN_SUBDIVISIONS;
      const endColumn = (bounds.minColumn + bounds.widthCells) * MACRO_TERRAIN_SUBDIVISIONS;
      const endRow = (bounds.minRow + bounds.depthCells) * MACRO_TERRAIN_SUBDIVISIONS;
      for (let row = startRow; row < endRow; row += 1) {
        for (let column = startColumn; column < endColumn; column += 1) {
          callback(index(column, row), column, row);
        }
      }
    }
  };
  return grid;
}

function createMacroTerrainChunkGeometry(terrainGrid, palette, {
  startTerrainRow,
  startTerrainColumn,
  endRow,
  endColumn,
  terrainVoxelWorldSize,
  worldWidth,
  worldDepth
}) {
  const positions = [];
  const colors = [];
  const indices = [];
  const chunkWidth = endColumn - startTerrainColumn;
  const chunkHeight = endRow - startTerrainRow;
  const merged = new Uint8Array(chunkWidth * chunkHeight);
  const surfaceColors = MACRO_TERRAIN_COLOR_NAMES.map((name) => palette[name]);
  let triangleCount = 0;
  let waterCellCount = 0;
  const addQuad = (points, color) => {
    const base = positions.length / 3;
    points.forEach(([x, y, z]) => positions.push(x, y, z));
    for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color.r, color.g, color.b);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    triangleCount += 2;
  };
  const localIndex = (column, row) => (row - startTerrainRow) * chunkWidth + column - startTerrainColumn;
  const surfaceKey = (column, row) => {
    const cellIndex = terrainGrid.index(column, row);
    return (terrainGrid.elevationSteps[cellIndex] + 8) * 16 + terrainGrid.colors[cellIndex];
  };

  for (let row = startTerrainRow; row < endRow; row += 1) {
    for (let column = startTerrainColumn; column < endColumn; column += 1) {
      const cellIndex = terrainGrid.index(column, row);
      if (terrainGrid.kinds[cellIndex] === MACRO_TERRAIN_KIND.water) waterCellCount += 1;
      if (merged[localIndex(column, row)]) continue;
      const key = surfaceKey(column, row);
      let rectangleWidth = 1;
      while (
        rectangleWidth < MACRO_TERRAIN_MAX_MERGE_SPAN
        &&
        column + rectangleWidth < endColumn
        && !merged[localIndex(column + rectangleWidth, row)]
        && surfaceKey(column + rectangleWidth, row) === key
      ) rectangleWidth += 1;
      let rectangleHeight = 1;
      heightLoop: while (
        rectangleHeight < MACRO_TERRAIN_MAX_MERGE_SPAN
        && row + rectangleHeight < endRow
      ) {
        for (let offset = 0; offset < rectangleWidth; offset += 1) {
          if (
            merged[localIndex(column + offset, row + rectangleHeight)]
            || surfaceKey(column + offset, row + rectangleHeight) !== key
          ) break heightLoop;
        }
        rectangleHeight += 1;
      }
      for (let offsetRow = 0; offsetRow < rectangleHeight; offsetRow += 1) {
        for (let offsetColumn = 0; offsetColumn < rectangleWidth; offsetColumn += 1) {
          merged[localIndex(column + offsetColumn, row + offsetRow)] = 1;
        }
      }
      const x0 = -worldWidth / 2 + column * terrainVoxelWorldSize;
      const x1 = x0 + rectangleWidth * terrainVoxelWorldSize;
      const z0 = -worldDepth / 2 + row * terrainVoxelWorldSize;
      const z1 = z0 + rectangleHeight * terrainVoxelWorldSize;
      const height = GLOBAL_CONSTRUCTION_HEIGHT + terrainGrid.elevationSteps[cellIndex] * VOXEL_SIZE;
      addQuad([[x0, height, z0], [x0, height, z1], [x1, height, z1], [x1, height, z0]], surfaceColors[terrainGrid.colors[cellIndex]]);
    }
  }

  for (let row = startTerrainRow; row < endRow; row += 1) {
    for (let column = startTerrainColumn; column < endColumn; column += 1) {
      const cellIndex = terrainGrid.index(column, row);
      const step = terrainGrid.elevationSteps[cellIndex];
      const height = GLOBAL_CONSTRUCTION_HEIGHT + step * VOXEL_SIZE;
      const x0 = -worldWidth / 2 + column * terrainVoxelWorldSize;
      const x1 = x0 + terrainVoxelWorldSize;
      const z0 = -worldDepth / 2 + row * terrainVoxelWorldSize;
      const z1 = z0 + terrainVoxelWorldSize;
      const neighbors = [
        { column: column - 1, row, points: [[x0, height, z1], [x0, height, z0], [x0, 0, z0], [x0, 0, z1]] },
        { column: column + 1, row, points: [[x1, height, z0], [x1, height, z1], [x1, 0, z1], [x1, 0, z0]] },
        { column, row: row - 1, points: [[x0, height, z0], [x1, height, z0], [x1, 0, z0], [x0, 0, z0]] },
        { column, row: row + 1, points: [[x1, height, z1], [x0, height, z1], [x0, 0, z1], [x1, 0, z1]] }
      ];
      neighbors.forEach((neighbor) => {
        const inBounds = neighbor.column >= 0 && neighbor.row >= 0 && neighbor.column < terrainGrid.width && neighbor.row < terrainGrid.height;
        const adjacentStep = inBounds ? terrainGrid.elevationSteps[terrainGrid.index(neighbor.column, neighbor.row)] : step - 2;
        if (step <= adjacentStep) return;
        const adjacentHeight = GLOBAL_CONSTRUCTION_HEIGHT + adjacentStep * VOXEL_SIZE;
        neighbor.points[2][1] = adjacentHeight;
        neighbor.points[3][1] = adjacentHeight;
        const heightDifference = step - adjacentStep;
        const sideColor = heightDifference > 4
          ? palette.stone
          : heightDifference >= 3
            ? palette.soil
            : terrainGrid.kinds[cellIndex] === MACRO_TERRAIN_KIND.terrain
              ? palette.grassDark
              : surfaceColors[terrainGrid.colors[cellIndex]];
        addQuad(neighbor.points, sideColor);
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, triangleCount, waterCellCount };
}

function hashTerrainSeed(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function terrainLatticeValue(seed, x, z, channel = 0) {
  let hash = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(channel + 1, 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295 * 2 - 1;
}

function terrainValueNoise(seed, x, z, scale, channel = 0) {
  const scaledX = x / scale;
  const scaledZ = z / scale;
  const x0 = Math.floor(scaledX);
  const z0 = Math.floor(scaledZ);
  const fractionX = scaledX - x0;
  const fractionZ = scaledZ - z0;
  const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
  const smoothZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
  const north = lerp(
    terrainLatticeValue(seed, x0, z0, channel),
    terrainLatticeValue(seed, x0 + 1, z0, channel),
    smoothX
  );
  const south = lerp(
    terrainLatticeValue(seed, x0, z0 + 1, channel),
    terrainLatticeValue(seed, x0 + 1, z0 + 1, channel),
    smoothX
  );
  return lerp(north, south, smoothZ);
}

function terrainFbm(seed, x, z, channel = 0) {
  return terrainValueNoise(seed, x, z, 330, channel) * 0.52
    + terrainValueNoise(seed, x * 0.87 + z * 0.19, z * 0.91 - x * 0.14, 142, channel + 17) * 0.31
    + terrainValueNoise(seed, x * 0.68 - z * 0.37, z * 0.72 + x * 0.29, 61, channel + 31) * 0.17;
}

function createMacroVoxelVegetation(params, terrainGrid, { cellWorldSize, terrainVoxelWorldSize, worldWidth, worldDepth }) {
  const group = new THREE.Group();
  group.name = "MacroVoxelPlants";
  const buffer = new VoxelInstanceBuffer(`${params.seed}:world-vegetation`);
  const vegetationWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "intent-world:detailed-vegetation" };
  const speciesCounts = { oak: 0, birch: 0, willow: 0 };
  const shrubFormCounts = { rounded: 0, fern: 0, flowering: 0 };
  const treePositions = [];
  let treeCount = 0;
  let shrubCount = 0;
  let flowerCount = 0;
  let mushroomCount = 0;
  let reedCount = 0;
  const terrainAtWorld = (x, z) => {
    const column = clampInteger(Math.floor((x + worldWidth / 2) / terrainVoxelWorldSize), 0, terrainGrid.width - 1);
    const row = clampInteger(Math.floor((z + worldDepth / 2) / terrainVoxelWorldSize), 0, terrainGrid.height - 1);
    return terrainGrid.getCell(column, row);
  };
  const centralHalfWidth = DISTRICT_WIDTH_VOXELS * VOXEL_SIZE * 0.58;
  const centralHalfDepth = DISTRICT_DEPTH_VOXELS * VOXEL_SIZE * 0.58;
  const isCentralDetailedArea = (x, z) => Math.abs(x) < centralHalfWidth && Math.abs(z) < centralHalfDepth;
  const groundVoxelY = (cell) => Math.ceil(cell.height / VOXEL_SIZE);
  const canPlantAt = (x, z) => {
    const cell = terrainAtWorld(x, z);
    return !isCentralDetailedArea(x, z) && cell.kind === "terrain" ? cell : null;
  };

  for (let logicalRow = 0; logicalRow < params.worldRows; logicalRow += 1) {
    for (let logicalColumn = 0; logicalColumn < params.worldColumns; logicalColumn += 1) {
      const logicalCenterX = -worldWidth / 2 + (logicalColumn + 0.5) * cellWorldSize;
      const logicalCenterZ = -worldDepth / 2 + (logicalRow + 0.5) * cellWorldSize;
      if (isCentralDetailedArea(logicalCenterX, logicalCenterZ)) continue;
      const centerCell = terrainAtWorld(logicalCenterX, logicalCenterZ);
      if (centerCell.kind !== "terrain") continue;
      const rng = createRng(`${params.seed}:world-plant:${logicalColumn}:${logicalRow}`);
      const densityFactor = 0.34 + params.vegetationDensity * 0.92;
      const treeChance = (centerCell.biome === "woodland" ? 0.78 : centerCell.biome === "meadowLight" ? 0.32 : centerCell.biome === "meadow" ? 0.14 : 0.07) * densityFactor;
      if (rng() < treeChance) {
        const worldX = logicalCenterX + (rng() - 0.5) * cellWorldSize * 0.66;
        const worldZ = logicalCenterZ + (rng() - 0.5) * cellWorldSize * 0.66;
        const plantedCell = canPlantAt(worldX, worldZ);
        const minimumSpacing = 1.45;
        if (plantedCell && !treePositions.some((position) => Math.hypot(position.x - worldX, position.z - worldZ) < minimumSpacing)) {
          const x = Math.round(worldX / VOXEL_SIZE);
          const z = Math.round(worldZ / VOXEL_SIZE);
          const shoreline = macroCellTouchesWater(terrainGrid, plantedCell.column, plantedCell.row, 20);
          const speciesRoll = rng();
          const species = shoreline && speciesRoll < 0.58 ? "willow" : speciesRoll < 0.28 ? "birch" : speciesRoll < 0.48 ? "willow" : "oak";
          addVoxelTree(buffer, species, x, groundVoxelY(plantedCell), z, rng, logicalRow * params.worldColumns + logicalColumn, vegetationWrite);
          treePositions.push({ x: worldX, z: worldZ });
          speciesCounts[species] += 1;
          treeCount += 1;

          if (rng() < 0.22) {
            const mushroomX = x + (rng() > 0.5 ? 4 : -4);
            const mushroomZ = z + (rng() > 0.5 ? 3 : -3);
            const mushroomCell = canPlantAt(mushroomX * VOXEL_SIZE, mushroomZ * VOXEL_SIZE);
            if (mushroomCell) {
              const mushroomGroundY = groundVoxelY(mushroomCell);
              buffer.addVoxel("limestone", mushroomX, mushroomGroundY + 1, mushroomZ, treeCount, vegetationWrite);
              buffer.addBox(rng() > 0.5 ? "blossomPink" : "blossomGold", mushroomX - 1, mushroomGroundY + 2, mushroomZ - 1, 3, 1, 3, treeCount + 1, vegetationWrite);
              mushroomCount += 1;
            }
          }
        }
      }

      const shrubChance = (centerCell.biome === "woodland" ? 0.82 : centerCell.biome === "meadowLight" ? 0.5 : 0.28) * densityFactor;
      if (rng() < shrubChance) {
        const clusterCount = centerCell.biome === "woodland" && rng() > 0.62 ? 2 : 1;
        for (let cluster = 0; cluster < clusterCount; cluster += 1) {
          const worldX = logicalCenterX + (rng() - 0.5) * cellWorldSize * 0.78;
          const worldZ = logicalCenterZ + (rng() - 0.5) * cellWorldSize * 0.78;
          const plantedCell = canPlantAt(worldX, worldZ);
          if (!plantedCell) continue;
          const formRoll = rng();
          const form = formRoll < 0.36 ? "rounded" : formRoll < 0.72 ? "fern" : "flowering";
          addVoxelShrub(
            buffer,
            form,
            Math.round(worldX / VOXEL_SIZE),
            groundVoxelY(plantedCell),
            Math.round(worldZ / VOXEL_SIZE),
            rng,
            logicalColumn * 13 + logicalRow * 29 + cluster,
            vegetationWrite
          );
          shrubFormCounts[form] += 1;
          shrubCount += 1;
        }
      }

      const flowerChance = (centerCell.biome === "meadowLight" ? 0.46 : centerCell.biome === "meadow" ? 0.2 : 0.08) * densityFactor;
      if (rng() < flowerChance) {
        const clusterSize = 2 + Math.floor(rng() * 4);
        const clusterX = logicalCenterX + (rng() - 0.5) * cellWorldSize * 0.7;
        const clusterZ = logicalCenterZ + (rng() - 0.5) * cellWorldSize * 0.7;
        for (let flower = 0; flower < clusterSize; flower += 1) {
          const worldX = clusterX + (rng() - 0.5) * 0.75;
          const worldZ = clusterZ + (rng() - 0.5) * 0.75;
          const plantedCell = canPlantAt(worldX, worldZ);
          if (!plantedCell) continue;
          const x = Math.round(worldX / VOXEL_SIZE);
          const z = Math.round(worldZ / VOXEL_SIZE);
          const y = groundVoxelY(plantedCell);
          buffer.addVoxel("foliageLight", x, y + 1, z, flowerCount, vegetationWrite);
          buffer.addVoxel(rng() > 0.46 ? "blossomGold" : "blossomPink", x, y + 2, z, flowerCount + 1, vegetationWrite);
          flowerCount += 1;
        }
      }
    }
  }

  for (let row = 8; row < terrainGrid.height - 8; row += 16) {
    for (let column = 8; column < terrainGrid.width - 8; column += 16) {
      const cell = terrainGrid.getCell(column, row);
      if (cell.kind !== "shore" || isCentralDetailedArea(cell.centerX, cell.centerZ)) continue;
      const rng = createRng(`${params.seed}:world-reed:${column}:${row}`);
      if (rng() > 0.42 || !macroCellTouchesWater(terrainGrid, column, row, 12)) continue;
      const x = Math.round(cell.centerX / VOXEL_SIZE);
      const z = Math.round(cell.centerZ / VOXEL_SIZE);
      const y = groundVoxelY(cell);
      const height = 3 + Math.floor(rng() * 4);
      buffer.addBox(rng() > 0.5 ? "foliageLight" : "grassDark", x, y + 1, z, 1, height, 1, reedCount, vegetationWrite);
      reedCount += 1;
    }
  }

  const meshes = buffer.createMeshes({
    strategy: "greedy",
    chunkSizeVoxels: DISTRICT_CELL_VOXELS * 8,
    maxMergeSpanVoxels: 8
  });
  meshes.forEach((mesh) => {
    const materialId = mesh.userData.materialId;
    mesh.name = `MacroDetailedVegetation-${materialId}`;
    mesh.castShadow = ["timber", "foliage", "foliageDark", "foliageLight"].includes(materialId);
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return {
    group,
    diagnostics: {
      renderer: "full-world-base-voxel-vegetation",
      sourceVoxelSize: VOXEL_SIZE,
      treeCount,
      shrubCount,
      flowerCount,
      mushroomCount,
      reedCount,
      speciesCounts,
      shrubFormCounts,
      occupiedVoxels: buffer.occupiedVoxelCount,
      renderedTriangles: buffer.renderStats?.renderedTriangles ?? 0,
      drawCalls: meshes.length,
      placementRule: "Central-district voxel plant grammar applied across every unbuilt dry biome cell; water, roads, parcels, and the authored center are excluded."
    }
  };
}

function macroCellTouchesWater(terrainGrid, column, row, radius) {
  for (let offsetRow = -radius; offsetRow <= radius; offsetRow += 1) {
    for (let offsetColumn = -radius; offsetColumn <= radius; offsetColumn += 1) {
      const sampleColumn = column + offsetColumn;
      const sampleRow = row + offsetRow;
      if (sampleColumn < 0 || sampleRow < 0 || sampleColumn >= terrainGrid.width || sampleRow >= terrainGrid.height) continue;
      if (terrainGrid.kinds[terrainGrid.index(sampleColumn, sampleRow)] === MACRO_TERRAIN_KIND.water) return true;
    }
  }
  return false;
}

const PREFAB_DISTRICT_ANCHORS = Object.freeze([
  Object.freeze({ id: "bramble-cross", x: -58, z: -48, intent: Object.freeze({ name: "Bramble Cross", purpose: "family houses and corner shops", composition: "street", frontage: "residential", access: "public", style: "victorian_domestic", prominence: "ordinary", magicLevel: 0.28 }) }),
  Object.freeze({ id: "moonwharf", x: 54, z: -42, intent: Object.freeze({ name: "Moonwharf", purpose: "canal warehouses and chandlers", composition: "yard", frontage: "large_bay", access: "service", style: "industrial_iron", prominence: "important", magicLevel: 0.46 }) }),
  Object.freeze({ id: "stargate-row", x: -66, z: 26, intent: Object.freeze({ name: "Stargate Row", purpose: "magical shops with rooms above", composition: "street", frontage: "display", access: "public", style: "victorian_gothic", prominence: "important", magicLevel: 0.76 }) }),
  Object.freeze({ id: "willow-court", x: 62, z: 38, intent: Object.freeze({ name: "Willow Court", purpose: "garden-facing town houses", composition: "court", frontage: "residential", access: "private", style: "victorian_domestic", prominence: "ordinary", magicLevel: 0.22 }) }),
  Object.freeze({ id: "north-archive", x: -18, z: 68, intent: Object.freeze({ name: "North Archive", purpose: "public records and reading rooms", composition: "hall", frontage: "institutional", access: "ceremonial", style: "civic_classical", prominence: "landmark", magicLevel: 0.52 }) }),
  Object.freeze({ id: "cinder-market", x: 26, z: -70, intent: Object.freeze({ name: "Cinder Market", purpose: "repair workshops and covered stalls", composition: "yard", frontage: "workshop", access: "service", style: "industrial_iron", prominence: "important", magicLevel: 0.4 }) }),
  Object.freeze({ id: "east-observatory", x: 76, z: -8, intent: Object.freeze({ name: "East Observatory", purpose: "astronomers' offices and instrument makers", composition: "tower", frontage: "institutional", access: "ceremonial", style: "victorian_gothic", prominence: "landmark", magicLevel: 0.84 }) }),
  Object.freeze({ id: "west-gardens", x: -78, z: -6, intent: Object.freeze({ name: "West Gardens", purpose: "terraced homes beside public gardens", composition: "street", frontage: "residential", access: "private", style: "victorian_domestic", prominence: "ordinary", magicLevel: 0.18 }) })
]);

export function createVoxelPrefabDistricts(config = {}, constructionPlan = null) {
  const params = normalizeVoxelIntentDistrictConfig(config);
  const group = new THREE.Group();
  group.name = "IntentDistrictPrefabLodChunks";
  const lods = [];
  const generatedDistricts = [];
  const resolvedConstructionPlan = constructionPlan ?? createVoxelDistrictMacroSurface(params).constructionPlan;
  const anchorsById = new Map(PREFAB_DISTRICT_ANCHORS.map((anchor) => [anchor.id, anchor]));
  const resolvedAnchors = resolvedConstructionPlan.sites.map((site) => ({
    ...(anchorsById.get(site.id) ?? { id: site.id, intent: site.intent }),
    x: site.centerX,
    z: site.centerZ,
    targetHeight: site.targetHeight,
    logicalCellIds: site.logicalCellIds,
    sourceHeightRangeVoxels: site.sourceHeightRangeVoxels
  }));
  const placements = resolvedAnchors.map((anchor, index) => {
    const generated = createGeneratedPrefabAssets(params, anchor, index);
    generatedDistricts.push(generated);
    const lod = new THREE.LOD();
    lod.name = `PrefabDistrictLOD-${anchor.id}`;
    lod.autoUpdate = false;
    lod.userData.prefabDistrictId = anchor.id;
    lod.userData.flatAnchor = [anchor.x, anchor.z];
    lod.userData.constructionSite = {
      logicalCellIds: [...anchor.logicalCellIds],
      targetHeight: anchor.targetHeight,
      foundationClearance: VOXEL_SIZE * 0.5
    };
    lod.userData.boundingRadius = 13;
    lod.userData.currentLevel = null;
    lod.addLevel(createPrefabDistrictLevel(anchor, generated, "near"), 0);
    lod.addLevel(createPrefabDistrictLevel(anchor, generated, "medium"), 1);
    lod.addLevel(createPrefabDistrictLevel(anchor, generated, "far"), 2);
    lod.addLevel(new THREE.Group(), 3);
    placeObjectOnVoxelSphere(lod, anchor.x, anchor.z, params.planetRadius, anchor.targetHeight + VOXEL_SIZE * 0.5);
    group.add(lod);
    lods.push(lod);
    return {
      id: anchor.id,
      flatAnchor: [anchor.x, anchor.z],
      targetHeight: anchor.targetHeight,
      foundationClearance: VOXEL_SIZE * 0.5,
      logicalCellIds: [...anchor.logicalCellIds],
      sourceHeightRangeVoxels: anchor.sourceHeightRangeVoxels,
      terrainValidated: true,
      generator: "BuildingIntent -> voxel building generator",
      intent: structuredClone(generated.intent),
      styleKits: generated.diagnostics.styleKits,
      roofForms: generated.diagnostics.roofForms,
      levels: [
        createPrefabLodDiagnostics("near", 2, 1, generated),
        createPrefabLodDiagnostics("medium", 1, 2, generated),
        createPrefabLodDiagnostics("far", 0, 3, generated),
        { id: "culled", rule: "outside camera frustum", buildingCount: 0 }
      ]
    };
  });
  const diagnostics = {
    renderer: "generated-voxel-mip-lod-v3",
    sourceOfTruth: "terrain-validated construction sites plus one BuildingIntent voxel field per district, aggregated into 1x, 2x, and 3x macrovoxels",
    placementRule: "contiguous dry logical cells are flattened first; roads and parcels are written before the building root is raised above the site surface",
    count: placements.length,
    selection: "camera frustum plus projected base-voxel screen size",
    projectedVoxelThresholdsPx: { near: 1.5, medium: 0.55 },
    projectedDiameterGuardsPx: { near: 84, medium: 30 },
    hysteresis: 0.08,
    placements,
    currentLevels: []
  };
  const updateDaylight = (style) => generatedDistricts.forEach((generated) => generated.updateDaylight?.(style));
  const updateView = (camera, viewport = {}) => {
    const viewportHeight = Math.max(1, Number(viewport.height) || 720) * Math.max(1, Number(viewport.renderScale) || 1);
    const thresholds = getVoxelLodThresholds(viewport);
    const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
    diagnostics.currentLevels = lods.map((lod) => {
      const metrics = getPrefabScreenMetrics(lod, camera, frustum, viewportHeight);
      const nextLevel = selectScreenSpaceVoxelLod(lod.userData.currentLevel, metrics, {
        hysteresis: diagnostics.hysteresis,
        thresholds
      });
      setPrefabLodLevel(lod, nextLevel);
      return {
        id: lod.userData.prefabDistrictId,
        level: ["near", "medium", "far", "culled"][nextLevel] ?? "culled",
        factor: nextLevel < 3 ? nextLevel + 1 : null,
        visibleInFrustum: metrics.visibleInFrustum,
        projectedVoxelPx: Number(metrics.projectedVoxelPx.toFixed(3)),
        projectedDiameterPx: Number(metrics.projectedDiameterPx.toFixed(1))
      };
    });
  };
  group.userData.diagnostics = diagnostics;
  return { group, diagnostics, updateView, updateDaylight };
}

function createGeneratedPrefabAssets(params, anchor, variant) {
  const intent = normalizeBuildingIntent(anchor.intent);
  const street = createVoxelBuildingLodLevels(adaptBuildingIntentToStreetConfig(intent, {
    id: `${params.id}-${anchor.id}`,
    seed: `${params.seed}:prefab:${anchor.id}`,
    sunTime: params.sunTime,
    nightLighting: params.nightLighting,
    buildingCount: 3,
    parcelWidth: 28 + (variant % 2) * 4,
    parcelDepth: 32 + (variant % 3) * 2,
    includeStreetBase: false,
    includeStreetLamps: false,
    renderStrategy: "greedy",
    voxelChunkSize: 128,
    maxMergeSpanVoxels: 8,
    detailDensity: 0.58 + intent.magicLevel * 0.32
  }), [1, 2, 3]);
  const levelsByFactor = Object.fromEntries(street.levels.map((lodLevel) => {
    lodLevel.group.updateMatrixWorld(true);
    const sourceMeshes = [];
    lodLevel.group.traverse((object) => {
      if (object.isMesh && !object.isLight) sourceMeshes.push(object);
    });
    return [lodLevel.factor, { sourceMeshes, diagnostics: lodLevel.diagnostics }];
  }));
  return {
    intent,
    plan: street.plan,
    diagnostics: {
      renderer: street.renderer,
      styleKits: [...new Set(street.plan.buildings.map((building) => building.style))],
      roofForms: street.plan.buildings.map((building) => building.roof.form)
    },
    levelsByFactor,
    updateDaylight: street.updateDaylight
  };
}

function createPrefabLodDiagnostics(id, minimumProjectedVoxelPx, factor, generated) {
  const level = generated.levelsByFactor[factor];
  return {
    id,
    minimumProjectedVoxelPx,
    factor,
    aggregation: factor ** 3,
    buildingCount: generated.plan.buildings.length * 2,
    occupiedVoxels: level.diagnostics.occupiedVoxels,
    renderedTriangles: level.diagnostics.renderStats.renderedTriangles
  };
}

function getPrefabScreenMetrics(lod, camera, frustum, viewportHeight) {
  const worldPosition = lod.getWorldPosition(new THREE.Vector3());
  const worldScale = lod.getWorldScale(new THREE.Vector3());
  const boundingRadius = lod.userData.boundingRadius * Math.max(worldScale.x, worldScale.y, worldScale.z);
  const visibleInFrustum = frustum.intersectsSphere(new THREE.Sphere(worldPosition, boundingRadius));
  const viewPosition = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
  const viewDepth = Math.max(0.001, -viewPosition.z);
  const pixelsPerWorldUnit = camera.isPerspectiveCamera
    ? viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDepth)
    : viewportHeight / Math.max(0.001, (camera.top - camera.bottom) / camera.zoom);
  return {
    visibleInFrustum: visibleInFrustum && viewPosition.z < 0,
    projectedVoxelPx: VOXEL_SIZE * pixelsPerWorldUnit,
    projectedDiameterPx: boundingRadius * 2 * pixelsPerWorldUnit
  };
}

function setPrefabLodLevel(lod, levelIndex) {
  lod.levels.forEach((level, index) => {
    level.object.visible = index === levelIndex;
  });
  lod.userData.currentLevel = levelIndex;
}

function createPrefabDistrictLevel(anchor, generated, level) {
  const group = new THREE.Group();
  group.name = `PrefabDistrict-${anchor.id}-${level}`;
  const roadMaterial = new THREE.MeshStandardMaterial({ color: "#77777a", roughness: 1, flatShading: true });
  const groundMaterial = new THREE.MeshStandardMaterial({ color: "#93a96c", roughness: 1, flatShading: true });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(18, 0.18, 14), groundMaterial);
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  group.add(ground);
  const roadTransforms = [
    composeTransform(0, 0.02, 0, 0, 18, 0.12, 3.2),
    composeTransform(0, 0.025, 0, Math.PI / 2, 14, 0.12, 3.2)
  ];
  group.add(createPrefabInstances("PrefabRoads", new THREE.BoxGeometry(1, 1, 1), roadMaterial, roadTransforms, false));
  const rowTransforms = [
    composeTransform(0, 0.08, -4.1, 0, 1, 1, 1),
    composeTransform(0, 0.08, 4.1, Math.PI, 1, 1, 1)
  ];
  const factor = level === "near" ? 1 : level === "medium" ? 2 : 3;
  group.add(createGeneratedStreetInstances(
    generated.levelsByFactor[factor].sourceMeshes,
    rowTransforms,
    level === "near"
  ));
  if (level === "near") {
    const treeMaterial = new THREE.MeshStandardMaterial({ color: "#56794d", roughness: 1, flatShading: true });
    const treeTransforms = Array.from({ length: 8 }, (_, index) => {
      const x = -10 + (index % 4) * 6.6;
      const z = index < 4 ? -2.5 : 2.5;
      return composeTransform(x, 0.7, z, index * 0.7, 1.15, 1.4, 1.15);
    });
    group.add(createPrefabInstances("PrefabTrees", new THREE.DodecahedronGeometry(0.7, 0), treeMaterial, treeTransforms, true));
  }
  return group;
}

function createGeneratedStreetInstances(sourceMeshes, transforms, castShadow) {
  const group = new THREE.Group();
  group.name = "GeneratedVoxelTerraces";
  sourceMeshes.forEach((sourceMesh) => {
    const mesh = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, transforms.length);
    mesh.name = `Generated-${sourceMesh.name || sourceMesh.userData.materialId || "Surface"}`;
    transforms.forEach((transform, index) => {
      mesh.setMatrixAt(index, transform.clone().multiply(sourceMesh.matrixWorld));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.materialId = sourceMesh.userData.materialId;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

function createPrefabInstances(name, geometry, material, transforms, castShadow) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function composeTransform(x, y, z, rotationY, scaleX, scaleY, scaleZ) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    new THREE.Vector3(scaleX, scaleY, scaleZ)
  );
}

function placeObjectOnVoxelSphere(object, x, z, radius, height = 0) {
  const frame = getVoxelSphereFrame(x, z, radius);
  const matrix = new THREE.Matrix4().makeBasis(frame.tangentX, frame.normal, frame.tangentZ);
  matrix.setPosition(frame.surface.clone().addScaledVector(frame.normal, height));
  matrix.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrix();
}

function getClosedVoxelRoadPorts(ports, topology) {
  if (topology === "cross" || topology === "straight") return [];
  if (topology === "end") {
    return ports.length ? [OPPOSITE_ROAD_DIRECTION[ports[0]]] : ["north", "south"];
  }
  return ROAD_DIRECTIONS.filter((direction) => !ports.includes(direction));
}

export function createVoxelDistrictEnvironment(config = {}, layout = createVoxelDistrictLayout(config)) {
  const params = normalizeVoxelIntentDistrictConfig(config);
  const group = new THREE.Group();
  group.name = "IntentDistrictVoxelEnvironment";
  const buffer = new VoxelInstanceBuffer(`${params.seed}:environment`);
  const roadPlan = createVoxelDistrictRoadPlan(layout);
  const roadPlanByCell = new Map(roadPlan.map((tile) => [tile.cell.id, tile]));
  const terrainWrite = { priority: VOXEL_WRITE_PRIORITIES.terrain, owner: "intent-district:environment" };
  const halfWidth = DISTRICT_WIDTH_VOXELS / 2;
  const halfDepth = DISTRICT_DEPTH_VOXELS / 2;
  let terrainColumns = 0;
  let waterColumns = 0;
  let roadColumns = 0;
  let pavementColumns = 0;
  let embankmentColumns = 0;

  for (let z = -halfDepth; z < halfDepth; z += 1) {
    for (let x = -halfWidth; x < halfWidth; x += 1) {
      if (!insideDistrictIsland(x, z, halfWidth, halfDepth)) continue;
      const surface = classifyDistrictSurface(layout, x, z, roadPlanByCell);
      const topMaterial = surface.kind === "water"
        ? (Math.sin(x * 0.31 + z * 0.17) + Math.cos(z * 0.23) > 1.32 ? "waterLight" : "water")
        : surface.material;
      const surfaceY = surface.surfaceY ?? (surface.kind === "water" ? DISTRICT_BASE_Y - 1 : DISTRICT_BASE_Y);
      const columnBaseY = DISTRICT_BASE_Y - 3;
      buffer.addBox("soil", x, columnBaseY, z, 1, Math.max(1, surfaceY - columnBaseY), 1, x * 31 + z * 17, terrainWrite);
      buffer.addVoxel(topMaterial, x, surfaceY, z, x * 19 - z * 23, terrainWrite);
      terrainColumns += 1;
      if (surface.kind === "water") waterColumns += 1;
      if (surface.kind === "road") roadColumns += 1;
      if (surface.kind === "pavement" || surface.kind === "roadPavement") pavementColumns += 1;
      if (surface.kind === "embankment") embankmentColumns += 1;
    }
  }

  const roads = addVoxelRoadNetwork(buffer, params, layout, roadPlan);
  const plants = addDistrictVegetation(buffer, params, layout, halfWidth, halfDepth);
  const meshes = buffer.createMeshes({
    strategy: "greedy",
    chunkSizeVoxels: DISTRICT_CELL_VOXELS * 4,
    maxMergeSpanVoxels: 8
  });
  meshes.forEach((mesh) => {
    const materialId = mesh.userData.materialId;
    mesh.name = `IntentDistrictEnvironment-${materialId}`;
    mesh.castShadow = ["foliage", "foliageDark", "foliageLight", "timber"].includes(materialId);
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  roads.lights.forEach((light) => group.add(light));
  const diagnostics = {
    renderer: "voxel-environment-v0.2",
    voxelSize: VOXEL_SIZE,
    cellVoxels: DISTRICT_CELL_VOXELS,
    gridSize: [layout.columns, layout.rows],
    dimensionsVoxels: [DISTRICT_WIDTH_VOXELS, DISTRICT_DEPTH_VOXELS],
    terrainColumns,
    waterColumns,
    roadColumns,
    roadTileCount: roadPlan.length,
    roadWidthVoxels: VOXEL_ROAD_WIDTH,
    roadTopologies: roads.topologies,
    roadPorts: roadPlan.reduce((total, tile) => total + tile.ports.length, 0),
    closedRoadPorts: roadPlan.reduce((total, tile) => total + tile.closedPorts.length, 0),
    curbVoxels: roads.curbVoxels,
    markingVoxels: roads.markingVoxels,
    roadWearVoxels: roads.wearVoxels,
    streetLampCount: roads.lampCount,
    terraceFrontLampCount: roads.terraceFrontLampCount,
    streetLampHeightVoxels: VOXEL_ROAD_LAMP_HEIGHT,
    streetLampFootprintVoxels: [VOXEL_ROAD_LAMP_FOOTPRINT, VOXEL_ROAD_LAMP_FOOTPRINT],
    streetLampSidewalkOffsetVoxels: VOXEL_ROAD_LAMP_SIDEWALK_OFFSET,
    streetFixturesOwnedByRoad: true,
    pavementColumns,
    embankmentColumns,
    treeCount: plants.treeCount,
    shrubCount: plants.shrubCount,
    flowerCount: plants.flowerCount,
    mushroomCount: plants.mushroomCount,
    reedCount: plants.reedCount,
    plantSpecies: plants.speciesCounts,
    shrubForms: plants.shrubFormCounts,
    instanceCount: buffer.instanceCount,
    occupiedVoxels: buffer.occupiedVoxelCount,
    culledInteriorVoxels: buffer.culledInteriorVoxelCount,
    drawCalls: meshes.length,
    renderStats: structuredClone(buffer.renderStats),
    materialCounts: buffer.materialCounts(),
    flatSourceSurfaceY: DISTRICT_BASE_Y,
    roadSurfaceVoxelY: DISTRICT_BASE_Y,
    buildingBaseVoxelY: 0,
    finishedConstructionHeight: GLOBAL_CONSTRUCTION_HEIGHT,
    constructionContactRule: "Road top faces and building bottom faces meet at the shared finished construction height.",
    planetRadius: params.planetRadius
  };
  const waterMeshes = meshes.filter((mesh) => mesh.userData.materialId === "water" || mesh.userData.materialId === "waterLight");
  const lampMeshes = meshes.filter((mesh) => mesh.userData.materialId === "warmWindow");
  const updateDaylight = (style) => {
    const night = clamp(Math.max(style.nightFactor, params.nightLighting), 0, 1);
    waterMeshes.forEach((mesh) => {
      mesh.material.opacity = 0.78 + (1 - style.nightFactor) * 0.12;
    });
    lampMeshes.forEach((mesh) => {
      mesh.material.emissiveIntensity = 0.25 + night * 2.1;
    });
    roads.lights.forEach((light) => {
      light.intensity = night * 4.5;
    });
  };
  const updateView = (camera, maxDynamicLights = 4) => {
    const limit = Math.max(0, Math.round(maxDynamicLights));
    [...roads.lights]
      .sort((left, right) => left.position.distanceToSquared(camera.position) - right.position.distanceToSquared(camera.position))
      .forEach((light, index) => { light.visible = index < limit; });
  };
  group.userData.diagnostics = diagnostics;
  group.userData.updateDaylight = updateDaylight;
  updateDaylight(voxelDaylightStyle(params.sunTime));
  return { group, diagnostics, updateDaylight, updateView };
}

function insideDistrictIsland(x, z, halfWidth, halfDepth) {
  const nx = Math.abs((x + 0.5) / halfWidth);
  const nz = Math.abs((z + 0.5) / halfDepth);
  return nx ** 8 + nz ** 8 <= 1;
}

function classifyDistrictSurface(layout, x, z, roadPlanByCell = null) {
  const cell = districtCellAtVoxel(layout, x, z);
  if (cell?.surface === "water") {
    const bounds = districtCellBounds(cell.column, cell.row);
    if (x >= bounds.maxX - 4) return { kind: "embankment", material: "sandstone" };
    return { kind: "water", material: "water" };
  }
  if (cell?.surface === "road") {
    const tile = roadPlanByCell?.get(cell.id)
      ?? createVoxelDistrictRoadPlan(layout).find((candidate) => candidate.cell.id === cell.id);
    if (tile && isVoxelRoadSurfaceAt(cell, tile.ports, x, z)) {
      return { kind: "road", material: "road", surfaceY: DISTRICT_BASE_Y };
    }
    return { kind: "roadPavement", material: "pavement", surfaceY: DISTRICT_BASE_Y };
  }
  if (cell?.surface === "pavement") return { kind: "pavement", material: "pavement" };
  const patchSignal = Math.sin((x + 19) * 0.055)
    + Math.cos((z - 7) * 0.047)
    + Math.sin((x + z) * 0.021 + 1.2) * 0.72;
  const elevation = clampInteger(Math.round(1.25 + patchSignal * 0.72), 0, 4);
  const grassVariant = patchSignal > 1.12 ? "grassLight" : patchSignal < -0.55 ? "grassDark" : "grass";
  return { kind: "terrain", material: grassVariant, surfaceY: DISTRICT_BASE_Y + elevation };
}

function isVoxelRoadSurfaceAt(cell, ports, x, z) {
  const bounds = districtCellBounds(cell.column, cell.row);
  const localX = x - bounds.minX;
  const localZ = z - bounds.minZ;
  const maximumInset = VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH;
  const insideX = localX >= VOXEL_ROAD_INSET && localX < maximumInset;
  const insideZ = localZ >= VOXEL_ROAD_INSET && localZ < maximumInset;
  if (insideX && insideZ) return true;
  if (ports.includes("north") && insideX && localZ < VOXEL_ROAD_INSET) return true;
  if (ports.includes("south") && insideX && localZ >= maximumInset) return true;
  if (ports.includes("west") && insideZ && localX < VOXEL_ROAD_INSET) return true;
  if (ports.includes("east") && insideZ && localX >= maximumInset) return true;
  return false;
}

function addVoxelRoadNetwork(buffer, params, layout, roadPlan) {
  const topologies = { end: 0, straight: 0, corner: 0, tee: 0, cross: 0 };
  const lights = [];
  const curbKeys = new Set();
  const markingKeys = new Set();
  const wearKeys = new Set();
  let lampCount = 0;
  let terraceFrontLampCount = 0;
  const detailWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "intent-district:voxel-road" };

  roadPlan.forEach((tile, tileIndex) => {
    topologies[tile.topology] += 1;
    const bounds = districtCellBounds(tile.cell.column, tile.cell.row);
    for (let z = bounds.minZ; z < bounds.maxZ; z += 1) {
      for (let x = bounds.minX; x < bounds.maxX; x += 1) {
        const road = isVoxelRoadSurfaceAt(tile.cell, tile.ports, x, z);
        if (!road) {
          if (positiveModulo(x * 5 + z * 3 + tileIndex, 23) === 0) {
            buffer.addVoxel("sandstone", x, DISTRICT_BASE_Y, z, x + z, detailWrite);
          }
          continue;
        }
        const touchesPavement = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const neighborX = x + dx;
          const neighborZ = z + dz;
          if (neighborX < bounds.minX || neighborX >= bounds.maxX || neighborZ < bounds.minZ || neighborZ >= bounds.maxZ) return false;
          return !isVoxelRoadSurfaceAt(tile.cell, tile.ports, neighborX, neighborZ);
        });
        if (touchesPavement) {
          const key = `${x},${z}`;
          curbKeys.add(key);
          buffer.addVoxel("limestone", x, DISTRICT_BASE_Y, z, x * 13 + z, detailWrite);
        }
      }
    }

    addVoxelRoadMarkings(buffer, tile, markingKeys, detailWrite);
    addVoxelRoadWear(buffer, tile, tileIndex, wearKeys, detailWrite);
    const lampPlacement = chooseVoxelRoadLampPlacement(tile, tileIndex);
    if (lampPlacement) {
      lights.push(addVoxelRoadLamp(buffer, params, lampPlacement, lampCount));
      lampCount += 1;
      if (lampPlacement.plot === "retail") terraceFrontLampCount += 1;
    }
  });

  return {
    lights,
    lampCount,
    terraceFrontLampCount,
    topologies,
    curbVoxels: curbKeys.size,
    markingVoxels: markingKeys.size,
    wearVoxels: wearKeys.size
  };
}

function addVoxelRoadMarkings(buffer, tile, markingKeys, write) {
  const bounds = districtCellBounds(tile.cell.column, tile.cell.row);
  const center = VOXEL_ROAD_INSET + Math.floor(VOXEL_ROAD_WIDTH / 2);
  const add = (localX, localZ) => {
    const x = bounds.minX + localX;
    const z = bounds.minZ + localZ;
    if (!isVoxelRoadSurfaceAt(tile.cell, tile.ports, x, z)) return;
    const key = `${x},${z}`;
    markingKeys.add(key);
    buffer.addVoxel("limestone", x, DISTRICT_BASE_Y, z, x * 7 - z * 3, write);
  };

  tile.ports.forEach((direction) => {
    for (let distance = 1; distance < VOXEL_ROAD_INSET; distance += 1) {
      if (positiveModulo(distance, 6) >= 3) continue;
      if (direction === "north") add(center, distance);
      if (direction === "south") add(center, DISTRICT_CELL_VOXELS - 1 - distance);
      if (direction === "west") add(distance, center);
      if (direction === "east") add(DISTRICT_CELL_VOXELS - 1 - distance, center);
    }
  });

  if (tile.ports.length < 3) return;
  tile.ports.forEach((direction) => {
    for (let stripe = VOXEL_ROAD_INSET + 3; stripe < VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH - 3; stripe += 4) {
      for (let thickness = 0; thickness < 2; thickness += 1) {
        if (direction === "north") add(stripe, VOXEL_ROAD_INSET - 3 + thickness);
        if (direction === "south") add(stripe, VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH + 1 - thickness);
        if (direction === "west") add(VOXEL_ROAD_INSET - 3 + thickness, stripe);
        if (direction === "east") add(VOXEL_ROAD_INSET + VOXEL_ROAD_WIDTH + 1 - thickness, stripe);
      }
    }
  });
}

function addVoxelRoadWear(buffer, tile, tileIndex, wearKeys, write) {
  const bounds = districtCellBounds(tile.cell.column, tile.cell.row);
  for (let patch = 0; patch < 3; patch += 1) {
    const localX = positiveModulo(tile.cell.column * 11 + tile.cell.row * 7 + patch * 9, DISTRICT_CELL_VOXELS);
    const localZ = positiveModulo(tile.cell.row * 13 + tile.cell.column * 5 + patch * 7, DISTRICT_CELL_VOXELS);
    for (let dz = 0; dz < 2; dz += 1) {
      for (let dx = 0; dx < 3; dx += 1) {
        const x = bounds.minX + Math.min(DISTRICT_CELL_VOXELS - 1, localX + dx);
        const z = bounds.minZ + Math.min(DISTRICT_CELL_VOXELS - 1, localZ + dz);
        if (!isVoxelRoadSurfaceAt(tile.cell, tile.ports, x, z)) continue;
        const key = `${x},${z}`;
        wearKeys.add(key);
        buffer.addVoxel("stoneShadow", x, DISTRICT_BASE_Y, z, tileIndex * 17 + patch, write);
      }
    }
  }
}

function chooseVoxelRoadLampPlacement(tile, tileIndex) {
  const frontage = tile.adjacentPlots.find((plot) => plot.occupant === "retail")
    ?? tile.adjacentPlots.find((plot) => plot.occupant === "workshops")
    ?? (positiveModulo(tile.cell.column + tile.cell.row, 2) === 0 ? tile.adjacentPlots[0] : null);
  if (!frontage && positiveModulo(tile.cell.column * 3 + tile.cell.row, 5) !== 0) return null;
  const bounds = districtCellBounds(tile.cell.column, tile.cell.row);
  const center = Math.floor((DISTRICT_CELL_VOXELS - 1) / 2);
  const sidewalkOffset = VOXEL_ROAD_LAMP_SIDEWALK_OFFSET;
  const side = frontage?.direction ?? preferredLampSide(tile, tileIndex);
  const candidates = side ? [lampCoordinateForSide(bounds, side, center)] : [];
  candidates.push(
    { x: bounds.minX + sidewalkOffset, z: bounds.minZ + sidewalkOffset },
    { x: bounds.maxX - sidewalkOffset - 1, z: bounds.minZ + sidewalkOffset },
    { x: bounds.maxX - sidewalkOffset - 1, z: bounds.maxZ - sidewalkOffset - 1 },
    { x: bounds.minX + sidewalkOffset, z: bounds.maxZ - sidewalkOffset - 1 }
  );
  const position = candidates.find(({ x, z }) => !isVoxelRoadSurfaceAt(tile.cell, tile.ports, x, z));
  return position ? { ...position, side, plot: frontage?.occupant ?? null } : null;
}

function preferredLampSide(tile, tileIndex) {
  if (tile.topology === "straight") {
    if (tile.ports.includes("east")) return tileIndex % 2 ? "north" : "south";
    return tileIndex % 2 ? "west" : "east";
  }
  return null;
}

function lampCoordinateForSide(bounds, side, center) {
  const offset = VOXEL_ROAD_LAMP_SIDEWALK_OFFSET;
  if (side === "north") return { x: bounds.minX + center, z: bounds.minZ + offset };
  if (side === "south") return { x: bounds.minX + center, z: bounds.maxZ - offset - 1 };
  if (side === "west") return { x: bounds.minX + offset, z: bounds.minZ + center };
  return { x: bounds.maxX - offset - 1, z: bounds.minZ + center };
}

function addVoxelRoadLamp(buffer, params, placement, index) {
  const structureWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "intent-district:road-lamp" };
  const glowWrite = { priority: VOXEL_WRITE_PRIORITIES.effect, owner: "intent-district:road-lamp-glow" };
  const { x, z } = placement;
  buffer.addBox("iron", x - 1, 0, z - 1, 3, 1, 3, index, structureWrite);
  buffer.addBox("iron", x, 1, z, 1, 12, 1, index + 1, structureWrite);
  buffer.addBox("iron", x - 1, 12, z - 1, 3, 1, 3, index + 2, structureWrite);
  buffer.addBox("warmWindow", x - 1, 14, z - 1, 3, 3, 3, index + 3, glowWrite);
  for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) {
    buffer.addBox("iron", x + dx, 13, z + dz, 1, 5, 1, index + dx + dz, structureWrite);
  }
  buffer.addBox("iron", x - 2, 13, z - 2, 5, 1, 5, index + 4, structureWrite);
  buffer.addBox("iron", x - 2, 18, z - 2, 5, 1, 5, index + 5, structureWrite);
  buffer.addBox("iron", x - 1, 19, z - 1, 3, 1, 3, index + 6, structureWrite);
  buffer.addVoxel("iron", x, 20, z, index + 7, structureWrite);
  const light = new THREE.PointLight("#f2aa55", 0, 4.8, 2);
  light.name = `VoxelRoadStreetLight-${index + 1}`;
  light.position.set((x + 0.5) * VOXEL_SIZE, 15.5 * VOXEL_SIZE, (z + 0.5) * VOXEL_SIZE);
  light.userData.fixtureOwner = "voxel-road-network";
  light.userData.plot = placement.plot;
  light.userData.flatVoxelPosition = [x, 15, z];
  light.userData.fixtureSizeVoxels = {
    height: VOXEL_ROAD_LAMP_HEIGHT,
    footprint: [VOXEL_ROAD_LAMP_FOOTPRINT, VOXEL_ROAD_LAMP_FOOTPRINT]
  };
  light.userData.nightIntensity = 4.5;
  light.userData.seed = params.seed;
  return light;
}

function addDistrictVegetation(buffer, params, layout, halfWidth, halfDepth) {
  const rng = createRng(`${params.seed}:district-vegetation`);
  const treeTarget = Math.round(12 + params.vegetationDensity * 22);
  const shrubTarget = Math.round(18 + params.vegetationDensity * 34);
  const flowerTarget = Math.round(10 + params.vegetationDensity * 24);
  const mushroomTarget = Math.round(5 + params.vegetationDensity * 11);
  let treeCount = 0;
  let shrubCount = 0;
  let flowerCount = 0;
  let mushroomCount = 0;
  let reedCount = 0;
  const speciesCounts = { oak: 0, birch: 0, willow: 0 };
  const shrubFormCounts = { rounded: 0, fern: 0, flowering: 0 };
  const treePositions = [];
  const vegetationWrite = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "intent-district:vegetation" };

  for (let attempt = 0; attempt < treeTarget * 12 && treeCount < treeTarget; attempt += 1) {
    const x = Math.floor(-halfWidth + 8 + rng() * (DISTRICT_WIDTH_VOXELS - 16));
    const z = Math.floor(-halfDepth + 8 + rng() * (DISTRICT_DEPTH_VOXELS - 16));
    if (!insideDistrictIsland(x, z, halfWidth, halfDepth)) continue;
    const surface = classifyDistrictSurface(layout, x, z);
    if (surface.kind !== "terrain") continue;
    if (treePositions.some((position) => Math.hypot(position.x - x, position.z - z) < 11)) continue;
    const shorelineDistance = Math.abs(x - districtCellBounds(0, 0).maxX);
    const speciesRoll = rng();
    const species = shorelineDistance < 20 && speciesRoll < 0.52
      ? "willow"
      : speciesRoll < 0.28 ? "birch" : speciesRoll < 0.48 ? "willow" : "oak";
    const groundY = surface.surfaceY ?? DISTRICT_BASE_Y;
    addVoxelTree(buffer, species, x, groundY, z, rng, attempt, vegetationWrite);
    treePositions.push({ x, z });
    speciesCounts[species] += 1;
    treeCount += 1;
  }

  for (let attempt = 0; attempt < shrubTarget * 6 && shrubCount < shrubTarget; attempt += 1) {
    const x = Math.floor(-halfWidth + 5 + rng() * (DISTRICT_WIDTH_VOXELS - 10));
    const z = Math.floor(-halfDepth + 5 + rng() * (DISTRICT_DEPTH_VOXELS - 10));
    if (!insideDistrictIsland(x, z, halfWidth, halfDepth)) continue;
    const surface = classifyDistrictSurface(layout, x, z);
    if (surface.kind !== "terrain") continue;
    const groundY = surface.surfaceY ?? DISTRICT_BASE_Y;
    const formRoll = rng();
    const form = formRoll < 0.38 ? "rounded" : formRoll < 0.72 ? "fern" : "flowering";
    addVoxelShrub(buffer, form, x, groundY, z, rng, attempt, vegetationWrite);
    shrubFormCounts[form] += 1;
    shrubCount += 1;
  }

  for (let attempt = 0; attempt < flowerTarget * 8 && flowerCount < flowerTarget; attempt += 1) {
    const x = Math.floor(-halfWidth + 4 + rng() * (DISTRICT_WIDTH_VOXELS - 8));
    const z = Math.floor(-halfDepth + 4 + rng() * (DISTRICT_DEPTH_VOXELS - 8));
    if (!insideDistrictIsland(x, z, halfWidth, halfDepth)) continue;
    const surface = classifyDistrictSurface(layout, x, z);
    if (surface.kind !== "terrain" || treePositions.some((position) => Math.hypot(position.x - x, position.z - z) < 3)) continue;
    const groundY = surface.surfaceY ?? DISTRICT_BASE_Y;
    buffer.addVoxel("foliageLight", x, groundY + 1, z, attempt, vegetationWrite);
    buffer.addVoxel(rng() > 0.46 ? "blossomGold" : "blossomPink", x, groundY + 2, z, attempt + 1, vegetationWrite);
    if (rng() > 0.65) buffer.addVoxel("foliageLight", x + (rng() > 0.5 ? 1 : -1), groundY + 1, z, attempt + 2, vegetationWrite);
    flowerCount += 1;
  }

  for (let attempt = 0; attempt < mushroomTarget * 8 && mushroomCount < mushroomTarget; attempt += 1) {
    const x = Math.floor(-halfWidth + 5 + rng() * (DISTRICT_WIDTH_VOXELS - 10));
    const z = Math.floor(-halfDepth + 5 + rng() * (DISTRICT_DEPTH_VOXELS - 10));
    if (!insideDistrictIsland(x, z, halfWidth, halfDepth)) continue;
    const surface = classifyDistrictSurface(layout, x, z);
    if (surface.kind !== "terrain" || !treePositions.some((position) => Math.hypot(position.x - x, position.z - z) < 7)) continue;
    const groundY = surface.surfaceY ?? DISTRICT_BASE_Y;
    buffer.addVoxel("limestone", x, groundY + 1, z, attempt, vegetationWrite);
    buffer.addBox(rng() > 0.5 ? "blossomPink" : "blossomGold", x - 1, groundY + 2, z - 1, 3, 1, 3, attempt + 1, vegetationWrite);
    mushroomCount += 1;
  }

  const shoreX = districtCellBounds(0, 0).maxX - 2;
  for (let z = -halfDepth + 6, index = 0; z < halfDepth - 6; z += 4, index += 1) {
    if (!insideDistrictIsland(shoreX, z, halfWidth, halfDepth)) continue;
    if (classifyDistrictSurface(layout, shoreX, z).kind !== "embankment") continue;
    const groundY = DISTRICT_BASE_Y;
    const height = 3 + positiveModulo(index * 5, 4);
    buffer.addBox(index % 2 ? "foliageLight" : "grassDark", shoreX, groundY, z, 1, height, 1, index, vegetationWrite);
    if (index % 3 === 0) buffer.addBox("foliageLight", shoreX + 1, groundY, z + 1, 1, Math.max(2, height - 2), 1, index + 1, vegetationWrite);
    reedCount += 1;
  }
  return { treeCount, shrubCount, flowerCount, mushroomCount, reedCount, speciesCounts, shrubFormCounts };
}

function addVoxelTree(buffer, species, x, groundY, z, rng, shadeKey, write) {
  const trunkHeight = species === "birch" ? 13 + Math.floor(rng() * 6) : 9 + Math.floor(rng() * 7);
  const trunkWidth = species === "birch" ? 1 : 2;
  buffer.addBox("timber", x, groundY + 1, z, trunkWidth, trunkHeight, trunkWidth, shadeKey, write);
  const crownY = groundY + trunkHeight - 1;
  if (species === "oak") {
    buffer.addBox("timber", x - 2, crownY - 2, z, 6, 2, 2, shadeKey + 1, write);
    buffer.addBox("foliageDark", x - 4, crownY - 1, z - 3, 5, 4, 6, shadeKey + 2, write);
    buffer.addBox("foliage", x, crownY, z - 4, 5, 5, 7, shadeKey + 3, write);
    buffer.addBox("foliageLight", x - 2, crownY + 4, z - 2, 6, 3, 5, shadeKey + 4, write);
    if (rng() > 0.5) buffer.addBox("foliage", x + 3, crownY + 1, z, 3, 3, 4, shadeKey + 5, write);
    return;
  }
  if (species === "birch") {
    buffer.addBox("foliageLight", x - 2, crownY - 2, z - 2, 5, 4, 5, shadeKey + 1, write);
    buffer.addBox("foliage", x - 3, crownY + 2, z - 1, 6, 4, 4, shadeKey + 2, write);
    buffer.addBox("foliageLight", x - 1, crownY + 6, z - 1, 3, 3, 3, shadeKey + 3, write);
    return;
  }
  buffer.addBox("timber", x - 3, crownY - 2, z, 7, 2, 2, shadeKey + 1, write);
  buffer.addBox("foliageDark", x - 4, crownY - 1, z - 4, 9, 4, 9, shadeKey + 2, write);
  buffer.addBox("foliage", x - 3, crownY + 3, z - 3, 7, 3, 7, shadeKey + 3, write);
  [[-4, -3], [3, -3], [-4, 3], [3, 3]].forEach(([dx, dz], index) => {
    const drop = 3 + positiveModulo(shadeKey + index, 3);
    buffer.addBox(index % 2 ? "foliage" : "foliageDark", x + dx, crownY - drop, z + dz, 2, drop + 2, 2, shadeKey + index + 4, write);
  });
}

function addVoxelShrub(buffer, form, x, groundY, z, rng, shadeKey, write) {
  if (form === "rounded") {
    buffer.addBox("foliageDark", x - 1, groundY + 1, z - 1, 4, 2, 3, shadeKey, write);
    buffer.addBox("foliage", x, groundY + 3, z, 2, 1 + Math.round(rng()), 2, shadeKey + 1, write);
    return;
  }
  if (form === "fern") {
    buffer.addVoxel("foliageDark", x, groundY + 1, z, shadeKey, write);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], index) => {
      const length = 2 + positiveModulo(shadeKey + index, 2);
      for (let step = 1; step <= length; step += 1) {
        buffer.addVoxel("foliageLight", x + dx * step, groundY + Math.max(1, 3 - step), z + dz * step, shadeKey + index + step, write);
      }
    });
    return;
  }
  buffer.addBox("foliage", x - 1, groundY + 1, z - 1, 3, 3, 3, shadeKey, write);
  const blossom = rng() > 0.48 ? "blossomPink" : "blossomGold";
  [[-1, -1], [1, -1], [0, 1]].forEach(([dx, dz], index) => buffer.addVoxel(blossom, x + dx, groundY + 4 + (index % 2), z + dz, shadeKey + index + 1, write));
}

function districtCellAtVoxel(layout, x, z) {
  const column = Math.floor((x + layout.widthVoxels / 2) / layout.cellVoxels);
  const row = Math.floor((z + layout.depthVoxels / 2) / layout.cellVoxels);
  if (column < 0 || row < 0 || column >= layout.columns || row >= layout.rows) return null;
  return layout.cells[row * layout.columns + column] ?? null;
}

function districtCellBounds(column, row) {
  const minX = -DISTRICT_WIDTH_VOXELS / 2 + column * DISTRICT_CELL_VOXELS;
  const minZ = -DISTRICT_DEPTH_VOXELS / 2 + row * DISTRICT_CELL_VOXELS;
  return {
    minX,
    maxX: minX + DISTRICT_CELL_VOXELS,
    minZ,
    maxZ: minZ + DISTRICT_CELL_VOXELS
  };
}

function placeDistrictObject(object, placement, footprint) {
  const bounds = districtCellBounds(placement.column, placement.row);
  const centerX = bounds.minX + footprint.widthCells * DISTRICT_CELL_VOXELS / 2;
  const centerZ = bounds.minZ + footprint.depthCells * DISTRICT_CELL_VOXELS / 2;
  object.position.set(centerX * VOXEL_SIZE, 0, centerZ * VOXEL_SIZE);
  object.userData.districtPlacement = {
    column: placement.column,
    row: placement.row,
    widthCells: footprint.widthCells,
    depthCells: footprint.depthCells,
    centerVoxels: [centerX, centerZ],
    centerWorld: [centerX * VOXEL_SIZE, centerZ * VOXEL_SIZE]
  };
}

function createDistrictGridDiagnostics(layout, objects) {
  const placements = Object.fromEntries(Object.entries(objects).map(([id, object]) => {
    const placement = object.userData.districtPlacement;
    const voxelPosition = [object.position.x / VOXEL_SIZE, object.position.z / VOXEL_SIZE];
    return [id, {
      ...structuredClone(placement),
      voxelPosition,
      gridAligned: voxelPosition.every((value) => Number.isInteger(value))
    }];
  }));
  return {
    columns: layout.columns,
    rows: layout.rows,
    cellVoxels: layout.cellVoxels,
    cellWorldSize: layout.cellVoxels * VOXEL_SIZE,
    surfaceCounts: layout.cells.reduce((counts, cell) => ({
      ...counts,
      [cell.surface]: (counts[cell.surface] ?? 0) + 1
    }), {}),
    placements
  };
}

export function projectDistrictOntoSphere(root, radius) {
  root.updateMatrixWorld(true);
  const leaves = [];
  const collectProjectionLeaves = (object) => {
    if (object !== root && (
      object.userData?.sphereProjectionRoot
      || object.isInstancedMesh
      || object.isMesh
      || object.isLight
    )) {
      leaves.push(object);
      return;
    }
    object.children.forEach(collectProjectionLeaves);
  };
  collectProjectionLeaves(root);

  const instanceMatrix = new THREE.Matrix4();
  const flatMatrix = new THREE.Matrix4();
  const curvedMatrix = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let projectedInstances = 0;
  let projectedVertices = 0;
  let maximumTiltRadians = 0;

  leaves.forEach((object) => {
    if (object.isInstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, instanceMatrix);
        flatMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        maximumTiltRadians = Math.max(maximumTiltRadians, curveFlatMatrixOntoSphere(flatMatrix, curvedMatrix, radius));
        object.setMatrixAt(index, curvedMatrix);
        projectedInstances += 1;
      }
      object.instanceMatrix.needsUpdate = true;
      root.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.set(1, 1, 1);
      object.updateMatrix();
      object.computeBoundingSphere();
      return;
    }

    if (object.isMesh && object.userData.flatVoxelGeometry) {
      const positions = object.geometry.attributes.position;
      const flatPosition = new THREE.Vector3();
      const curvedPosition = new THREE.Vector3();
      for (let index = 0; index < positions.count; index += 1) {
        flatPosition.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        const frame = getVoxelSphereFrame(flatPosition.x, flatPosition.z, radius);
        curvedPosition.copy(frame.surface).addScaledVector(frame.normal, flatPosition.y);
        positions.setXYZ(index, curvedPosition.x, curvedPosition.y, curvedPosition.z);
        maximumTiltRadians = Math.max(maximumTiltRadians, frame.normal.angleTo(worldUp));
      }
      positions.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      projectedVertices += positions.count;
      projectedInstances += object.userData.sourceVoxelCount ?? 0;
      root.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.set(1, 1, 1);
      object.updateMatrix();
      return;
    }

    flatMatrix.copy(object.matrixWorld);
    maximumTiltRadians = Math.max(maximumTiltRadians, curveFlatMatrixOntoSphere(flatMatrix, curvedMatrix, radius));
    root.add(object);
    curvedMatrix.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrix();
  });
  root.updateMatrixWorld(true);
  return {
    type: "spherical-local-frame",
    radius,
    projectedObjects: leaves.length,
    projectedInstances,
    projectedVertices,
    maximumSurfaceTiltDegrees: THREE.MathUtils.radToDeg(maximumTiltRadians)
  };
}

function curveFlatMatrixOntoSphere(flatMatrix, targetMatrix, radius) {
  const flatPosition = new THREE.Vector3();
  const flatQuaternion = new THREE.Quaternion();
  const flatScale = new THREE.Vector3();
  flatMatrix.decompose(flatPosition, flatQuaternion, flatScale);
  const frame = getVoxelSphereFrame(flatPosition.x, flatPosition.z, radius);
  const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(flatQuaternion);
  const axisY = new THREE.Vector3(0, 1, 0).applyQuaternion(flatQuaternion);
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(flatQuaternion);
  mapFlatDirectionToSphere(axisX, frame).normalize();
  mapFlatDirectionToSphere(axisY, frame).normalize();
  mapFlatDirectionToSphere(axisZ, frame).normalize();
  const curvedPosition = frame.surface.clone().addScaledVector(frame.normal, flatPosition.y);
  targetMatrix.makeBasis(axisX, axisY, axisZ);
  targetMatrix.scale(flatScale);
  targetMatrix.setPosition(curvedPosition);
  return frame.normal.angleTo(WORLD_UP);
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function getVoxelSphereFrame(x, z, radius) {
  const longitude = x / radius;
  const latitude = z / radius;
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const normal = new THREE.Vector3(
    sinLongitude * cosLatitude,
    cosLongitude * cosLatitude,
    sinLatitude
  );
  const tangentX = new THREE.Vector3(cosLongitude, -sinLongitude, 0);
  const tangentZ = new THREE.Vector3(
    -sinLongitude * sinLatitude,
    -cosLongitude * sinLatitude,
    cosLatitude
  );
  const surface = normal.clone().multiplyScalar(radius).add(new THREE.Vector3(0, -radius, 0));
  return { normal, tangentX, tangentZ, surface };
}

function mapFlatDirectionToSphere(direction, frame) {
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  return direction.copy(frame.tangentX).multiplyScalar(x)
    .addScaledVector(frame.normal, y)
    .addScaledVector(frame.tangentZ, z);
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function withMagicBias(intent, bias) {
  return { ...intent, magicLevel: clamp(intent.magicLevel + bias, 0, 1) };
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clamp(value, minimum, maximum));
}
