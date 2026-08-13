import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { getVoxelSphereFrame } from "../src/generators/voxelIntentDistrict.js";
import { selectCityInfoBlock } from "../src/ui/cityInfoOverlay.js";
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
