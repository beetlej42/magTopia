import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeConstructionHeightSampler,
  deriveRuntimeConstructionGrade,
  resolveConstructionDatum
} from "../src/city/construction-grading.js";

function cell(id, infrastructure = null, kind = "terrain") {
  return {
    id,
    infrastructure,
    buildable: kind !== "water",
    surface: { kind, waterVoxels: kind === "water" ? 16 : 0 }
  };
}

test("runtime construction grading unifies buildings and dry infrastructure while preserving water", () => {
  const state = {
    world: {
      constructionDatum: {
        roadSurfaceVoxelY: -1,
        buildingBaseVoxelY: 0,
        finishedConstructionHeightWorld: -0.0625
      }
    },
    cells: {
      building: cell("building"),
      road: cell("road", "road"),
      station: cell("station", "railway_station"),
      plaza: cell("plaza", "station_plaza"),
      rail: cell("rail", "railway"),
      waterRail: cell("waterRail", "railway", "water"),
      bridge: cell("bridge")
    },
    buildings: {
      house: { footprintCells: ["building"] }
    },
    infrastructure: {
      bridge: { type: "bridge", cellId: "bridge" }
    }
  };

  const grade = deriveRuntimeConstructionGrade(state);
  assert.deepEqual([...grade.cellIds].sort(), ["building", "plaza", "rail", "road", "station"]);
  assert.deepEqual([...grade.excludedWaterCellIds].sort(), ["bridge", "waterRail"]);
  assert.equal(grade.categories.buildings.has("building"), true);
  assert.equal(grade.categories.roads.has("road"), true);
  assert.equal(grade.categories.railways.has("rail"), true);
  assert.equal(grade.categories.stations.has("station"), true);
  assert.equal(grade.categories.plazas.has("plaza"), true);
  assert.deepEqual(grade.datum, resolveConstructionDatum(state));
});

test("construction datum defaults remain the shared renderer contract", () => {
  assert.deepEqual(resolveConstructionDatum({}), {
    roadSurfaceVoxelY: -1,
    buildingBaseVoxelY: 0,
    finishedConstructionHeightWorld: -0.0625
  });
});

test("building footprints with different natural elevations share one rendered base height", () => {
  const cells = [
    { ...cell("low"), column: 0, row: 0, center: { x: -4, z: 0 }, surface: { kind: "terrain", waterVoxels: 0, maxElevationVoxels: 1 } },
    { ...cell("high"), column: 1, row: 0, center: { x: 0, z: 0 }, surface: { kind: "terrain", waterVoxels: 0, maxElevationVoxels: 4 } },
    { ...cell("natural"), column: 2, row: 0, center: { x: 4, z: 0 }, surface: { kind: "terrain", waterVoxels: 0, maxElevationVoxels: 3 } }
  ];
  const state = {
    world: { constructionDatum: resolveConstructionDatum({}) },
    cells: Object.fromEntries(cells.map((item) => [item.id, item])),
    buildings: {
      lowHouse: { footprintCells: ["low"] },
      highHouse: { footprintCells: ["high"] }
    },
    infrastructure: {}
  };
  const grid = { columns: 3, rows: 1, cellWorldSize: 4, cells };
  const sampleHeight = createRuntimeConstructionHeightSampler(state, grid);

  assert.equal(sampleHeight(-4, 0), -0.0625);
  assert.equal(sampleHeight(0, 0), -0.0625);
  assert.equal(sampleHeight(4, 0), -0.0625 + 3 * 0.125);
});
