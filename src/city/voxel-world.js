const DEFAULT_COLUMNS = 50;
const DEFAULT_ROWS = 50;
const CELL_VOXELS = 32;
const VOXEL_SIZE = 0.125;
const DEFAULT_SUBDIVISIONS = CELL_VOXELS;

/**
 * Pure-data counterpart of the Agent Intent District macro terrain. It keeps
 * the same river, lake, shore and elevation equations, but samples each
 * logical cell instead of allocating render geometry. All logical cells are
 * retained so agents can distinguish water from an out-of-bounds coordinate.
 */
export function createBlankVoxelWorldContract(options = {}) {
  const columns = clampInteger(options.columns ?? DEFAULT_COLUMNS, 10, 80);
  const rows = clampInteger(options.rows ?? DEFAULT_ROWS, 10, 80);
  const subdivisions = clampInteger(options.terrainSubdivisions ?? DEFAULT_SUBDIVISIONS, 4, CELL_VOXELS);
  const cellWorldSize = CELL_VOXELS * VOXEL_SIZE;
  const worldWidth = columns * cellWorldSize;
  const worldDepth = rows * cellWorldSize;
  const seed = String(options.seed ?? "agent-quarter-day-001");
  const terrainSeed = hashTerrainSeed(seed);
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const surface = sampleLogicalSurface({
        column,
        row,
        subdivisions,
        cellWorldSize,
        worldWidth,
        worldDepth,
        terrainSeed
      });
      const buildable = surface.waterVoxels === 0;
      const strictBuildable = buildable && surface.shoreVoxels === 0;
      cells.push({
        id: `cell-${column}-${row}`,
        column,
        row,
        center: {
          x: -worldWidth / 2 + (column + 0.5) * cellWorldSize,
          // Agent city coordinates define north as row - 1 / world +Z.
          z: worldDepth / 2 - (row + 0.5) * cellWorldSize
        },
        buildable,
        strictBuildable,
        bridgeRequired: !buildable,
        ground: surface.kind,
        surface: {
          kind: surface.kind,
          biome: surface.biome,
          fineVoxelCount: surface.sampleCount,
          waterVoxels: surface.waterVoxels,
          shoreVoxels: surface.shoreVoxels,
          waterCoverage: roundRatio(surface.waterVoxels, surface.sampleCount),
          shoreCoverage: roundRatio(surface.shoreVoxels, surface.sampleCount),
          minElevationVoxels: surface.minimumStep,
          maxElevationVoxels: surface.maximumStep,
          heightRangeVoxels: surface.maximumStep - surface.minimumStep
        },
        fields: {
          scenic: surface.kind === "shore" ? 3 : distanceToWaterHint(column, worldWidth / cellWorldSize),
          accessibility: column > columns * 0.7 ? 3 : 1,
          magicRisk: surface.kind === "water" ? 2 : 0
        }
      });
    }
  }

  const buildableCellCount = cells.filter((cell) => cell.buildable).length;
  const strictBuildableCellCount = cells.filter((cell) => cell.strictBuildable).length;
  return {
    mapId: options.mapId ?? "agent-intent-blank-001",
    mapRecipeVersion: "agent-intent-blank@1",
    seed,
    blank: true,
    coordinateSystem: {
      cellId: "cell-{column}-{row}",
      north: "row - 1",
      east: "column + 1",
      worldAxes: { east: "+x", north: "+z", up: "+y" }
    },
    constructionDatum: {
      voxelSize: VOXEL_SIZE,
      logicalCellVoxels: CELL_VOXELS,
      cellWorldSize,
      naturalElevationRangeVoxels: [0, 4],
      waterElevationVoxels: -3,
      roadSurfaceVoxelY: -1,
      buildingBaseVoxelY: 0,
      finishedConstructionHeightWorld: -0.0625,
      buildingOriginWorldY: 0,
      rule: "Buildings require buildable cells; preferred sites also require strictBuildable cells. Water cells require bridges for roads."
    },
    grid: { columns, rows, cellWorldSize, cells },
    anchors: [{ id: "riverfront", type: "sunken_water_system" }],
    diagnostics: {
      logicalCellCount: cells.length,
      buildableCellCount,
      strictBuildableCellCount,
      waterRejectedCellCount: cells.length - buildableCellCount,
      shoreRestrictedCellCount: buildableCellCount - strictBuildableCellCount,
      terrainSamplesPerCell: subdivisions ** 2,
      emptyBuildingCount: 0,
      emptyRoadCount: 0
    }
  };
}

function sampleLogicalSurface({ column, row, subdivisions, cellWorldSize, worldWidth, worldDepth, terrainSeed }) {
  let waterVoxels = 0;
  let shoreVoxels = 0;
  let minimumStep = Infinity;
  let maximumStep = -Infinity;
  let woodland = 0;
  let heath = 0;
  for (let localRow = 0; localRow < subdivisions; localRow += 1) {
    for (let localColumn = 0; localColumn < subdivisions; localColumn += 1) {
      const worldX = -worldWidth / 2 + (column + (localColumn + 0.5) / subdivisions) * cellWorldSize;
      // Terrain equations use their authored +Z row direction. Logical cell
      // classification is invariant to the API's display-axis inversion.
      const worldZ = -worldDepth / 2 + (row + (localRow + 0.5) / subdivisions) * cellWorldSize;
      const voxelX = worldX / VOXEL_SIZE;
      const voxelZ = worldZ / VOXEL_SIZE;
      const riverDrift = terrainValueNoise(terrainSeed, voxelZ, 0, 380, 7) * worldWidth * 0.074
        + terrainValueNoise(terrainSeed, voxelZ, 0, 137, 8) * worldWidth * 0.018;
      const riverCenter = -worldWidth * 0.31 + riverDrift;
      const riverRadius = worldWidth * (0.0205 + terrainValueNoise(terrainSeed, voxelZ, 0, 91, 9) * 0.0024);
      const riverDistance = Math.abs(worldX - riverCenter);
      const lakeX = (worldX - worldWidth * 0.23) / (worldWidth * 0.052);
      const lakeZ = (worldZ + worldDepth * 0.24) / (worldDepth * 0.041);
      const lakeEdge = 1 + terrainValueNoise(terrainSeed, voxelX, voxelZ, 74, 10) * 0.13;
      const lakeDistance = Math.hypot(lakeX, lakeZ) / lakeEdge;
      const water = riverDistance < riverRadius || lakeDistance < 1;
      const shore = !water && (riverDistance < riverRadius + VOXEL_SIZE * 5 || lakeDistance < 1.1);
      const elevationNoise = terrainFbm(terrainSeed, voxelX, voxelZ, 0);
      const elevationStep = water ? -3 : shore ? 0 : clampInteger(Math.round(1.65 + elevationNoise * 2.35), 0, 4);
      const moisture = terrainFbm(terrainSeed, voxelX + 173, voxelZ - 91, 3);
      if (water) waterVoxels += 1;
      if (shore) shoreVoxels += 1;
      if (!water && !shore && moisture > 0.25) woodland += 1;
      if (!water && !shore && moisture < -0.3) heath += 1;
      minimumStep = Math.min(minimumStep, elevationStep);
      maximumStep = Math.max(maximumStep, elevationStep);
    }
  }
  const sampleCount = subdivisions ** 2;
  const kind = waterVoxels ? "water" : shoreVoxels ? "shore" : "terrain";
  const biome = waterVoxels ? "water" : shoreVoxels ? "shore" : woodland > sampleCount / 3 ? "woodland" : heath > sampleCount / 3 ? "heath" : "meadow";
  return { waterVoxels, shoreVoxels, minimumStep, maximumStep, sampleCount, kind, biome };
}

function distanceToWaterHint(column, columns) {
  const normalized = Math.abs(column / columns - 0.19);
  return normalized < 0.12 ? 2 : 1;
}

function roundRatio(value, total) {
  return Number((value / total).toFixed(4));
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
  const north = lerp(terrainLatticeValue(seed, x0, z0, channel), terrainLatticeValue(seed, x0 + 1, z0, channel), smoothX);
  const south = lerp(terrainLatticeValue(seed, x0, z0 + 1, channel), terrainLatticeValue(seed, x0 + 1, z0 + 1, channel), smoothX);
  return lerp(north, south, smoothZ);
}

function terrainFbm(seed, x, z, channel = 0) {
  return terrainValueNoise(seed, x, z, 330, channel) * 0.52
    + terrainValueNoise(seed, x * 0.87 + z * 0.19, z * 0.91 - x * 0.14, 142, channel + 17) * 0.31
    + terrainValueNoise(seed, x * 0.68 - z * 0.37, z * 0.72 + x * 0.29, 61, channel + 31) * 0.17;
}

function lerp(start, end, amount) { return start + (end - start) * amount; }
function clampInteger(value, minimum, maximum) { return Math.round(Math.min(maximum, Math.max(minimum, Number(value)))); }

export const BLANK_VOXEL_WORLD_RECIPE = Object.freeze({
  id: "agent-intent-blank@1",
  columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS,
  logicalCellVoxels: CELL_VOXELS,
  voxelSize: VOXEL_SIZE
});
