import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { createMagicLondonVegetationPlan } from "../src/generators/magicLondonVegetation.js";
import { createRng, randInt, randRange } from "../src/utils/random.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(root, "artifacts", "vegetation-plan");
await mkdir(artifactsDir, { recursive: true });

const COLUMNS = 24;
const ROWS = 20;
const CELL_SIZE = 4;
const PX_PER_UNIT = 6;
const seed = process.env.VEG_SEED || "magnificent-forest";

const grid = buildGrid();
const cityState = buildCityState(grid);

const plan = createMagicLondonVegetationPlan({
  params: { seed },
  grid,
  cityState,
  reservedCellIds: []
});

const baseline = buildBaselinePlan(grid);

const newImage = createCanvas(COLUMNS, ROWS, CELL_SIZE);
renderPlan(newImage, grid, plan);
await writeFile(path.join(artifactsDir, "new.png"), PNG.sync.write(newImage.png));

const baselineImage = createCanvas(COLUMNS, ROWS, CELL_SIZE);
renderPlan(baselineImage, grid, baseline);
await writeFile(path.join(artifactsDir, "baseline.png"), PNG.sync.write(baselineImage.png));

console.log(JSON.stringify({
  seed,
  artifact: path.join(artifactsDir, "new.png"),
  zones: plan.zoneCounts,
  newRendered: {
    trees: plan.trees.length,
    shrubs: plan.shrubs.length,
    grassTufts: plan.grassTufts.length,
    flowers: plan.flowers.length,
    forestFloors: plan.forestFloors.length
  },
  baselineRendered: {
    trees: baseline.trees.length,
    shrubs: baseline.shrubs.length,
    grassTufts: baseline.grassTufts.length,
    flowers: baseline.flowers.length,
    forestFloors: baseline.forestFloors.length
  },
  clusters: plan.clusters.length,
  clusterCells: plan.clusters.map((cluster) => ({ id: cluster.id, cells: cluster.cellIds.length, treeCount: cluster.treeCount, zone: cluster.zone })),
  species: plan.trees.reduce((count, tree) => {
    count[tree.species] = (count[tree.species] ?? 0) + 1;
    return count;
  }, {}),
  sizeClasses: plan.trees.reduce((count, tree) => {
    count[tree.sizeClass] = (count[tree.sizeClass] ?? 0) + 1;
    return count;
  }, {}),
  skippedOccupied: plan.skippedOccupied
}, null, 2));

function buildBaselinePlan(grid) {
  const plan = { trees: [], shrubs: [], grassTufts: [], flowers: [], forestFloors: [] };
  const anchors = [
    [-0.24, -0.2],
    [0.22, 0.18],
    [-0.18, 0.25],
    [0.24, -0.23]
  ];
  grid.cells.forEach((cell) => {
    if (!cell.buildable || cityState.cells[cell.id]) return;
    const zone = cell.ground.vegetation;
    const rng = createRng(`${seed}:development-vegetation:${cell.id}`);
    if (zone === "meadow") {
      for (let index = 0; index < randInt(rng, 2, 4); index += 1) {
        plan.grassTufts.push({ x: freeX(cell, rng, 0.42), z: freeZ(cell, rng, 0.42), scale: CELL_SIZE * randRange(rng, 0.32, 0.48), zone });
      }
      if (rng() > 0.48) {
        const cx = freeX(cell, rng, 0.34);
        const cz = freeZ(cell, rng, 0.34);
        const count = randInt(rng, 3, 5);
        for (let index = 0; index < count; index += 1) {
          const angle = (index / count) * Math.PI * 2 + rng() * 0.5;
          const radius = CELL_SIZE * randRange(rng, 0.025, 0.09);
          plan.flowers.push({ x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius, zone });
        }
      }
      if (rng() > 0.975) addBaselineTrees(plan, cell, rng, 1, zone, anchors);
      return;
    }
    if (zone === "grove") {
      if (rng() > 0.34) addBaselineTrees(plan, cell, rng, rng() > 0.58 ? 2 : 1, zone, anchors);
      for (let index = 0; index < randInt(rng, 1, 3); index += 1) plan.shrubs.push({ x: freeX(cell, rng, 0.38), z: freeZ(cell, rng, 0.38), scale: CELL_SIZE * randRange(rng, 0.28, 0.4), zone });
      for (let index = 0; index < randInt(rng, 1, 2); index += 1) plan.grassTufts.push({ x: freeX(cell, rng, 0.42), z: freeZ(cell, rng, 0.42), scale: CELL_SIZE * randRange(rng, 0.32, 0.48), zone });
      return;
    }
    plan.forestFloors.push({ x: cell.center.x, z: cell.center.z, radius: CELL_SIZE * randRange(rng, 0.4, 0.46), zone });
    if (rng() > 0.18) addBaselineTrees(plan, cell, rng, rng() > 0.48 ? 3 : 2, zone, anchors);
    for (let index = 0; index < randInt(rng, 3, 5); index += 1) plan.shrubs.push({ x: freeX(cell, rng, 0.38), z: freeZ(cell, rng, 0.38), scale: CELL_SIZE * randRange(rng, 0.28, 0.4), zone });
    for (let index = 0; index < randInt(rng, 1, 2); index += 1) plan.grassTufts.push({ x: freeX(cell, rng, 0.42), z: freeZ(cell, rng, 0.42), scale: CELL_SIZE * randRange(rng, 0.32, 0.48), zone });
  });
  return plan;
}

function addBaselineTrees(plan, cell, rng, count, zone, anchors) {
  for (let index = 0; index < count; index += 1) {
    const anchor = anchors[index % anchors.length];
    plan.trees.push({
      x: cell.center.x + (anchor[0] + randRange(rng, -0.07, 0.07)) * CELL_SIZE,
      z: cell.center.z + (anchor[1] + randRange(rng, -0.07, 0.07)) * CELL_SIZE,
      scale: CELL_SIZE * randRange(rng, zone === "woodland" ? 0.47 : 0.43, zone === "woodland" ? 0.58 : 0.54),
      species: rng() > 0.42 ? "oak" : "lime",
      zone
    });
  }
}

function freeX(cell, rng, radius) {
  return cell.center.x + randRange(rng, -radius, radius) * CELL_SIZE;
}

function freeZ(cell, rng, radius) {
  return cell.center.z + randRange(rng, -radius, radius) * CELL_SIZE;
}

function buildGrid() {
  const cells = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const insideWorld = ellipseMask(column, row);
      const zone = zoneFor(column, row, insideWorld);
      const surface = zone === "woodland" ? "grassDark" : zone === "meadow" ? "grassLight" : "grass";
      cells.push({
        id: `cell-${column}-${row}`,
        column,
        row,
        center: { x: column * CELL_SIZE, z: row * CELL_SIZE },
        buildable: insideWorld,
        ground: { surface, vegetation: zone },
        groundCover: zone
      });
    }
  }
  return { cellWorldSize: CELL_SIZE, cells };
}

function ellipseMask(column, row) {
  const dx = (column - (COLUMNS - 1) / 2) / (COLUMNS / 2 + 1);
  const dy = (row - (ROWS - 1) / 2) / (ROWS / 2 + 1);
  return dx ** 3 + dy ** 3 <= 1;
}

function zoneFor(column, row, insideWorld) {
  if (!insideWorld) return null;
  const patch = valueNoise(column * 0.16 + 0.4, row * 0.16 + 0.9, 61284691);
  const grain = hashScale(column, row, 51);
  if (patch > 0.72) return "woodland";
  if (patch > 0.52 && patch < 0.6 && grain > 0.4) return "grove";
  return "meadow";
}

function buildCityState(grid) {
  const state = { cells: {} };
  grid.cells.forEach((cell) => {
    if (!cell.buildable) return;
    const { column, row } = cell;
    const isRoad = row === Math.floor(ROWS / 2) - 2;
    const isRoadB = column === Math.floor(COLUMNS / 2) - 1;
    const inBlockA = column >= 4 && column <= 8 && row >= 4 && row <= 5;
    const inBlockB = column >= 15 && column <= 18 && row >= 13 && row <= 14;
    const isNode = column === Math.floor(COLUMNS / 2) - 1 && row === Math.floor(ROWS / 2) - 2;
    if (inBlockA) {
      state.cells[cell.id] = { ...cell, occupancy: `building-a-${column}` };
    } else if (inBlockB) {
      state.cells[cell.id] = { ...cell, occupancy: `building-b-${column}` };
    } else if (isRoad || isRoadB) {
      state.cells[cell.id] = { ...cell, infrastructure: "road" };
    } else if (isNode) {
      state.cells[cell.id] = { ...cell, node: "junction" };
    }
  });
  return state;
}

function renderPlan(image, grid, plan) {
  grid.cells.forEach((cell) => {
    if (!cell.buildable) return;
    const occupied = Boolean(cityState.cells[cell.id]);
    const zoneColor = occupied
      ? "#b8b0a6"
      : cell.ground.vegetation === "woodland" ? "#5c7443" : cell.ground.vegetation === "grove" ? "#7f9456" : "#a8bd87";
    image.fillCell(cell, zoneColor);
  });

  plan.forestFloors.forEach((entry) => {
    image.fillEllipse(entry.x, entry.z, entry.radius, entry.radius, "#43562b");
  });

  plan.trees.forEach((tree) => {
    const radius = tree.scale * 0.62 * PX_PER_UNIT / CELL_SIZE * 2;
    const color = tree.sizeClass === "dominant" ? "#264f2e" : tree.sizeClass === "small" ? "#6f9457" : "#3f6e43";
    image.fillEllipse(tree.x, tree.z, radius, radius, color);
  });

  plan.clusters?.forEach((cluster) => {
    image.drawCross(cluster.coreX, cluster.coreZ, 5, "#c94f6d");
  });

  plan.shrubs.forEach((shrub) => {
    image.fillEllipse(shrub.x, shrub.z, 2.2, 2.2, "#345c3d");
  });
  plan.flowers.forEach((flower) => {
    image.fillEllipse(flower.x, flower.z, 1.4, 1.4, flower.variant === 1 ? "#c08f9f" : "#e2c46a");
  });
  plan.grassTufts.forEach((tuft) => {
    image.fillEllipse(tuft.x, tuft.z, 1, 1, "#7f9c5c");
  });
}

function createCanvas(columns, rows, cellSize) {
  const width = Math.round(columns * cellSize * PX_PER_UNIT);
  const height = Math.round(rows * cellSize * PX_PER_UNIT);
  const png = new PNG({ width, height });
  png.data.fill(255);
  const px = (x, z) => [Math.round(x * PX_PER_UNIT), Math.round(z * PX_PER_UNIT)];
  return {
    png,
    fillCell(cell, color) {
      const [x0, z0] = px(cell.center.x - cellSize * 0.5, cell.center.z - cellSize * 0.5);
      const [x1, z1] = px(cell.center.x + cellSize * 0.5, cell.center.z + cellSize * 0.5);
      const [r, g, b] = hex(color);
      for (let z = z0; z <= z1; z += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (x < 0 || x >= width || z < 0 || z >= height) continue;
          setPixel(png, x, z, r, g, b);
        }
      }
    },
    fillEllipse(cx, cz, radius, radiusY, color) {
      const [cxPx, czPx] = px(cx, cz);
      const radiusPx = radius * PX_PER_UNIT;
      const radiusYPx = radiusY * PX_PER_UNIT;
      const [r, g, b] = hex(color);
      const x0 = Math.max(0, Math.round(cxPx - radiusPx));
      const x1 = Math.min(width - 1, Math.round(cxPx + radiusPx));
      const y0 = Math.max(0, Math.round(czPx - radiusYPx));
      const y1 = Math.min(height - 1, Math.round(czPx + radiusYPx));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const nx = (x - cxPx) / radiusPx;
          const ny = (y - czPx) / radiusYPx;
          if (nx * nx + ny * ny <= 1) setPixel(png, x, y, r, g, b);
        }
      }
    },
    drawCross(cx, cz, size, color) {
      const [cxPx, czPx] = px(cx, cz);
      const [r, g, b] = hex(color);
      for (let dx = -size; dx <= size; dx += 1) {
        for (let dy = -size; dy <= size; dy += 1) {
          if (Math.abs(dx) === size || Math.abs(dy) === size || Math.abs(dx) === Math.abs(dy)) {
            const x = cxPx + dx;
            const y = czPx + dy;
            if (x >= 0 && x < width && y >= 0 && y < height) setPixel(png, x, y, r, g, b);
          }
        }
      }
    }
  };
}

function hex(color) {
  const value = color.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function setPixel(png, x, y, r, g, b) {
  const index = (y * png.width + x) * 4;
  png.data[index] = r;
  png.data[index + 1] = g;
  png.data[index + 2] = b;
  png.data[index + 3] = 255;
}

function hashScale(a, b, salt) {
  let h = 2166136261 ^ salt;
  const add = (value) => {
    h ^= value;
    h = Math.imul(h, 16777619);
  };
  add(Math.round(a * 100));
  add(Math.round(b * 100));
  return ((h >>> 0) % 1000) / 1000;
}

function valueNoise(a, b, seed) {
  const ax = Math.floor(a);
  const bx = Math.floor(b);
  const x = a - ax;
  const y = b - bx;
  const n = (ix, iy) => hashScale(ax + ix, bx + iy, seed);
  const sx = smooth(x);
  const sy = smooth(y);
  const v00 = n(0, 0);
  const v10 = n(1, 0);
  const v01 = n(0, 1);
  const v11 = n(1, 1);
  const top = v00 + (v10 - v00) * sx;
  const bottom = v01 + (v11 - v01) * sx;
  return top + (bottom - top) * sy;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}
