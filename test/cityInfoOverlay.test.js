import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { getVoxelSphereFrame } from "../src/generators/voxelIntentDistrict.js";
import {
  createCityInfoContext,
  createCityInfoOverlay,
  selectCityInfoBlock,
  selectCityInfoBuilding
} from "../src/ui/cityInfoOverlay.js";
import { createCityInfoWorldLayer } from "../src/ui/cityInfoWorldLayer.js";

const GRID = { columns: 50, rows: 50, cellWorldSize: 4 };
const DISTRICTS = [
  {
    id: "lantern-row",
    bounds: { minColumn: 42, maxColumn: 47, minRow: 18, maxRow: 25 }
  },
  {
    id: "market-court",
    bounds: { minColumn: 27, maxColumn: 38, minRow: 23, maxRow: 31 }
  },
  {
    id: "west-bank",
    bounds: { minColumn: 1, maxColumn: 5, minRow: 20, maxRow: 30 }
  }
];

test("far city info falls back to the nearest visible district", () => {
  const camera = createSurfaceCamera({ flatX: 2.5, flatZ: -5, scale: 1.9 });
  const selected = selectCityInfoBlock(
    { grid: GRID, districts: DISTRICTS, radius: 220 },
    { column: 25, row: 26 },
    camera,
    { flatX: 2.5, flatZ: -5 }
  );

  assert.equal(selected?.id, "market-court");
});

test("far city info keeps a district that contains the camera focus", () => {
  const camera = createSurfaceCamera({ flatX: -86, flatZ: -2, scale: 1.9 });
  const selected = selectCityInfoBlock(
    { grid: GRID, districts: DISTRICTS, radius: 220 },
    { column: 3, row: 25 },
    camera,
    { flatX: -86, flatZ: -2 }
  );

  assert.equal(selected?.id, "west-bank");
});

test("cancelled districts are not selectable in the city view", () => {
  const selected = selectCityInfoBlock(
    {
      grid: GRID,
      districts: [{
        id: "old-plan",
        status: "cancelled",
        bounds: { minColumn: 27, maxColumn: 38, minRow: 23, maxRow: 31 }
      }],
      radius: 220
    },
    { column: 32, row: 27 },
    createSurfaceCamera({ flatX: 30, flatZ: -8, scale: 1.9 }),
    { flatX: 30, flatZ: -8 }
  );

  assert.equal(selected, null);
});

test("city info selection does not add terrain uplift or move buildings", () => {
  const root = new THREE.Group();
  const building = new THREE.Group();
  building.position.set(0, 0, 0);
  root.add(building);
  const worldLayer = createCityInfoWorldLayer();
  worldLayer.setSceneRoot(root);

  worldLayer.update({
    geometryKey: "block:test",
    opacity: 1
  });
  assert.deepEqual(building.position.toArray(), [0, 0, 0]);
  assert.equal(root.getObjectByName("CityInfoBlockUplift"), undefined);
  worldLayer.dispose();
});

test("near city info caches building bounds and only queries nearby footprint cells", () => {
  const { root, cellsByCoord, updateCounts } = createBuildingScene([
    { id: "center", column: 5, row: 5 },
    { id: "neighbor", column: 6, row: 5 },
    { id: "far-away", column: 14, row: 14 }
  ]);
  const context = createCityInfoContext(root);
  const updatesAfterContextCreation = new Map(updateCounts);
  const centralCell = { cell: cellsByCoord.get("5:5") };
  const camera = createSurfaceCamera({ flatX: -18, flatZ: 18, scale: 1 });

  selectCityInfoBuilding(context, centralCell, camera);
  selectCityInfoBuilding(context, centralCell, camera);

  assert.ok(updatesAfterContextCreation.get("center") > 0, "context creation measures the building once");
  assert.deepEqual(updateCounts, updatesAfterContextCreation, "selection reuses cached world bounds");
  assert.deepEqual(
    context.buildingCandidates.map((entry) => entry.placement.buildingId).sort(),
    ["center", "neighbor"],
    "the per-frame query excludes buildings outside the local cell neighborhood"
  );
  assert.equal(context.buildings.every((entry) => entry.anchorWorld instanceof THREE.Vector3), true);
  assert.equal(context.buildings.every((entry) => entry.boundsWorld instanceof THREE.Box3), true);
});

test("near city info keeps center-footprint selection priority", () => {
  const { root, cellsByCoord } = createBuildingScene([
    { id: "center", column: 5, row: 5, offsetX: 3.5 },
    { id: "visually-closer", column: 6, row: 5 }
  ]);
  const context = createCityInfoContext(root);
  const selected = selectCityInfoBuilding(
    context,
    { cell: cellsByCoord.get("5:5") },
    createSurfaceCamera({ flatX: -18, flatZ: 18, scale: 1 })
  );

  assert.equal(selected?.placement.buildingId, "center");
});

test("disabled city info update immediately hides without reading camera state", () => {
  const previousDocument = globalThis.document;
  globalThis.document = createFakeDocument();
  try {
    const overlay = createCityInfoOverlay();
    const root = new THREE.Group();
    overlay.setSceneRoot(root);
    const camera = {};
    Object.defineProperty(camera, "userData", {
      get() {
        throw new Error("disabled city info must not resolve a selection");
      }
    });

    overlay.update({ camera, viewport: { width: 1280, height: 720 }, enabled: false });

    assert.equal(overlay.element.classList.has("is-visible"), false);
    assert.equal(overlay.element.style.getPropertyValue("--city-info-opacity"), "0");
    assert.equal(root.getObjectByName("CityInfoWorldLayer")?.visible, false);
  } finally {
    globalThis.document = previousDocument;
  }
});

function createSurfaceCamera({ flatX, flatZ, scale }) {
  const radius = 220;
  const frame = getVoxelSphereFrame(flatX, flatZ, radius);
  const yaw = THREE.MathUtils.degToRad(45);
  const elevation = THREE.MathUtils.degToRad(35.264);
  const horizontal = frame.tangentX.clone().multiplyScalar(Math.cos(yaw))
    .addScaledVector(frame.tangentZ, Math.sin(yaw))
    .normalize();
  const focus = frame.surface.clone().addScaledVector(frame.normal, 4.8);
  const camera = new THREE.PerspectiveCamera(34, 1280 / 720, 0.1, 320);
  camera.position.copy(focus)
    .addScaledVector(horizontal, 58 * scale * Math.cos(elevation))
    .addScaledVector(frame.normal, 58 * scale * Math.sin(elevation));
  camera.up.copy(frame.normal);
  camera.lookAt(focus);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function createBuildingScene(definitions) {
  const grid = { columns: 20, rows: 20, cellWorldSize: 4 };
  const cells = [];
  const cellsByCoord = new Map();
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const cell = {
        id: `cell-${column}-${row}`,
        column,
        row,
        center: {
          x: (column + 0.5 - grid.columns / 2) * grid.cellWorldSize,
          z: (grid.rows / 2 - row - 0.5) * grid.cellWorldSize
        }
      };
      cells.push(cell);
      cellsByCoord.set(`${column}:${row}`, cell);
    }
  }

  const root = new THREE.Group();
  root.userData.surfaceNavigation = { radius: 220 };
  root.userData.cityState = {
    world: { grid },
    cells: Object.fromEntries(cells.map((cell) => [cell.id, cell])),
    buildings: Object.fromEntries(definitions.map(({ id, column, row }) => [id, {
      id,
      status: "completed",
      footprintCells: [`cell-${column}-${row}`]
    }]))
  };
  root.userData.worldContract = { grid: { ...grid, cells } };
  const buildingsRoot = new THREE.Group();
  buildingsRoot.name = "AgentAcceptanceBuildings";
  buildingsRoot.userData.contract = {
    placements: definitions.map(({ id, column, row }) => ({
      buildingId: id,
      footprintCells: [`cell-${column}-${row}`]
    }))
  };
  root.add(buildingsRoot);

  const updateCounts = new Map();
  for (const { id, column, row, offsetX = 0 } of definitions) {
    const cell = cellsByCoord.get(`${column}:${row}`);
    const frame = getVoxelSphereFrame(cell.center.x, cell.center.z, 220);
    const building = new THREE.Group();
    building.userData.buildingId = id;
    building.position.copy(frame.surface).addScaledVector(frame.tangentX, offsetX);
    building.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 1.5)));
    const originalUpdateWorldMatrix = building.updateWorldMatrix;
    updateCounts.set(id, 0);
    building.updateWorldMatrix = function updateWorldMatrix(...args) {
      updateCounts.set(id, updateCounts.get(id) + 1);
      return originalUpdateWorldMatrix.apply(this, args);
    };
    buildingsRoot.add(building);
  }
  root.updateMatrixWorld(true);
  for (const id of updateCounts.keys()) updateCounts.set(id, 0);
  return { root, cellsByCoord, updateCounts };
}

function createFakeDocument() {
  class FakeElement {
    constructor() {
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => classes.add(name)),
        toggle: (name, force) => {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        has: (name) => classes.has(name)
      };
      const styles = new Map();
      this.style = {
        setProperty: (name, value) => styles.set(name, value),
        getPropertyValue: (name) => styles.get(name) ?? ""
      };
    }

    setAttribute() {}
    addEventListener() {}
    append() {}
    querySelector() { return new FakeElement(); }
  }

  return {
    createElement: () => new FakeElement(),
    createElementNS: () => new FakeElement(),
    body: new FakeElement()
  };
}
