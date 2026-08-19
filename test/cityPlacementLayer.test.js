import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { footprintWorldSizeForCandidate, createCityPlacementLayer } from "../src/ui/cityPlacementLayer.js";
import { getVoxelSphereFrame, getVoxelSphereOrientation } from "../src/generators/voxelIntentDistrict.js";
import { createSpecialStructurePreviewSpec, previewFootprintScale } from "../src/ui/specialStructurePreview.js";

test("a 1x1 lot previews a single-cell footprint", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-2-3", footprintCells: ["cell-2-3"] },
    4
  );
  assert.deepEqual(size, { width: 4, depth: 4 });
});

test("a 2x2 lot previews a two-by-two footprint", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-2-3", footprintCells: ["cell-2-3", "cell-3-3", "cell-2-4", "cell-3-4"] },
    4
  );
  assert.deepEqual(size, { width: 8, depth: 8 });
});

test("an explicit footprint hint overrides the derived cell count", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-1-1", footprintCells: ["cell-1-1"], footprintColumns: 3, footprintRows: 2 },
    4
  );
  assert.deepEqual(size, { width: 12, depth: 8 });
});

test("a lot without footprint cells falls back to a single cell", () => {
  assert.deepEqual(footprintWorldSizeForCandidate({ lotId: "cell-0-0" }, 4), { width: 4, depth: 4 });
  assert.deepEqual(footprintWorldSizeForCandidate(null, 4), { width: 4, depth: 4 });
});

// ---- Ghost sphere orientation ----------------------------------------------
//
// PR #52 round 2 blocker: the ghost's height axis must follow the surface
// normal (local +Y -> frame.normal) using the same basis the city uses
// (`getVoxelSphereOrientation` / `placeObjectOnVoxelSphere`), not a
// `setFromUnitVectors(Z, normal)` which would leave the box lying on its side
// away from the sphere centre.

const GHOST_RADIUS = 220;
const GHOST_CELL_SIZE = 4;

function ghostTarget(column, row) {
  const columns = 50;
  const rows = 50;
  const centerX = -columns * GHOST_CELL_SIZE / 2 + (column + 0.5) * GHOST_CELL_SIZE;
  const centerZ = rows * GHOST_CELL_SIZE / 2 - (row + 0.5) * GHOST_CELL_SIZE;
  return {
    hasTarget: true,
    isLegal: true,
    lotId: `cell-${column}-${row}`,
    footprintColumns: 1,
    footprintRows: 1,
    entrance: "south",
    cells: [{ id: `cell-${column}-${row}`, column, row, centerX, centerZ }],
    centerCell: { id: `cell-${column}-${row}`, column, row, x: centerX, z: centerZ }
  };
}

function ghostBodyFor(target) {
  const root = new THREE.Group();
  root.userData.surfaceNavigation = { radius: GHOST_RADIUS };
  const layer = createCityPlacementLayer();
  layer.setSceneRoot(root);
  layer.configure({ radius: GHOST_RADIUS, cellWorldSize: GHOST_CELL_SIZE });
  layer.showGhost(target);
  const ghost = layer.object.getObjectByName("CityPlacementGhost");
  assert.ok(ghost, "the ghost group is rendered");
  return ghost.children[0];
}

test("ghost uses the building-shaped voxel preview when a previewSource is present", () => {
  const spec = createSpecialStructurePreviewSpec({ card_id: "owl-tower", structure: { footprint: "1x1" } }, 4);
  const target = { ...ghostTarget(5, 5), previewSource: { kind: "voxel-spec", cardId: "owl-tower", spec } };
  const root = new THREE.Group();
  root.userData.surfaceNavigation = { radius: GHOST_RADIUS };
  const layer = createCityPlacementLayer();
  layer.setSceneRoot(root);
  layer.configure({ radius: GHOST_RADIUS, cellWorldSize: GHOST_CELL_SIZE });
  layer.showGhost(target);
  const ghost = layer.object.getObjectByName("CityPlacementGhost");
  assert.equal(ghost.userData.ghostMode, "voxel-building-preview", "a real building-shaped preview is used");
  assert.ok(ghost.children.some((child) => child.userData?.previewCached), "the voxel preview geometry is cached");
});

test("preview footprint scale maps the built footprint onto the logical footprint", () => {
  const spec = createSpecialStructurePreviewSpec({ card_id: "owl-tower", structure: { footprint: "1x1" } }, 4);
  const scale = previewFootprintScale(spec, 1, 1, 4);
  assert.ok(Math.abs(scale.x - 1) < 0.01, `1x1 preview keeps its natural scale (${scale.x.toFixed(3)})`);
  assert.ok(Math.abs(scale.z - 1) < 0.01);
  const wide = createSpecialStructurePreviewSpec({ card_id: "diagon-alley-entrance", structure: { footprint: "2x2" } }, 4);
  const wideScale = previewFootprintScale(wide, 2, 2, 4);
  assert.ok(Math.abs(wideScale.x * wide.footprint.worldWidth - 8) < 0.01, "2x2 preview is scaled to 8 world units");
  assert.ok(Math.abs(wideScale.z * wide.footprint.worldDepth - 8) < 0.01);
});

test("ghost body height axis aligns local +Y with the surface normal at a non-central cell", () => {
  const column = 40;
  const row = 9;
  const target = ghostTarget(column, row);
  const body = ghostBodyFor(target);
  const cell = target.cells[0];
  const frame = getVoxelSphereFrame(cell.centerX, cell.centerZ, GHOST_RADIUS);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion).normalize();
  assert.ok(up.dot(frame.normal) > 0.9999, `ghost +Y (${up.toArray().map((v) => v.toFixed(4)).join(",")}) aligns with the surface normal`);
});

test("getVoxelSphereOrientation matches the city placeObjectOnVoxelSphere basis", () => {
  const x = 62;
  const z = 62;
  const frame = getVoxelSphereFrame(x, z, GHOST_RADIUS);
  const quaternion = getVoxelSphereOrientation(x, z, GHOST_RADIUS);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize();
  assert.ok(up.dot(frame.normal) > 0.9999, "+Y maps to the surface normal");
  assert.ok(right.dot(frame.tangentX) > 0.9999, "+X maps to the east tangent");
});
