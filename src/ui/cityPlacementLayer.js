// PR #52 — In-world placement ghost inside the existing city viewer.
//
// Replaces the old marker-list placement layer with a single translucent
// preview driven by the camera FOV center. The layer never selects candidates
// or moves the camera; main.js resolves the current target each frame through
// the same flat-coordinate pipeline the viewer already uses and asks this
// layer to draw (or hide) the ghost.
//
// Ghost rendering (PR #52 round 2): the primary preview is a real, building-
// shaped voxel model generated deterministically per special-structure card
// (`target.previewSpec`, rendered by src/ui/specialStructurePreview.js through
// the same grammar the city uses for voxel buildings), with all materials
// replaced by a uniform translucent placement material. Because a pending
// placement has no server-authored `voxelDesign` yet, this is a card-shaped
// preview rather than a clone of the final building; the per-cell box massing
// (`ghost.userData.ghostMode === "massing-voxel-fallback"`) remains only as a
// fallback when no preview spec is available. `ghost.userData.ghostMode` names
// the active mode so acceptance tooling can distinguish them.
//
// Valid targets render in a muted cyan-green; invalid targets render red and
// the caller disables confirm. Depth testing stays on so the preview remains
// spatially readable among surrounding buildings. All ghost parts are oriented
// with `getVoxelSphereOrientation` — the same basis the city's own sphere
// placement uses (local +Y follows the surface normal).

import * as THREE from "three";
import { getVoxelSphereFrame, getVoxelSphereOrientation } from "../generators/voxelIntentDistrict.js";
import {
  createSpecialStructurePreview,
  ENTRANCE_YAW_DEGREES,
  previewFootprintScale
} from "./specialStructurePreview.js";

const VALID_COLOR = "#52d3b8";
const INVALID_COLOR = "#ff6b6b";
const OUTLINE_COLOR = "#d8fff4";
const ENTRANCE_COLOR = "#ffd166";
const DEFAULT_CELL_WORLD_SIZE = 4;
const GHOST_OPACITY = 0.42;
const OUTLINE_OPACITY = 0.9;
const GHOST_HEIGHT_MIN = 3.2;
const GHOST_HEIGHT_PER_CELL = 1.6;
const GHOST_HEIGHT_MAX = 10;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

const frameScratch = createFrameScratch();

function createFrameScratch() {
  return {
    normal: new THREE.Vector3(),
    tangentX: new THREE.Vector3(),
    tangentZ: new THREE.Vector3(),
    surface: new THREE.Vector3()
  };
}

function ghostHeightForFootprint(columns, rows) {
  const area = Math.max(1, Number(columns) * Number(rows));
  return Math.min(GHOST_HEIGHT_MAX, GHOST_HEIGHT_MIN + (area - 1) * GHOST_HEIGHT_PER_CELL);
}

export function createCityPlacementLayer() {
  const layer = new THREE.Group();
  layer.name = "CityPlacementLayer";
  layer.visible = false;

  const ghostMaterial = new THREE.MeshLambertMaterial({
    color: VALID_COLOR,
    transparent: true,
    opacity: GHOST_OPACITY,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: OUTLINE_COLOR,
    transparent: true,
    opacity: OUTLINE_OPACITY,
    depthTest: true,
    depthWrite: false
  });
  const entranceMaterial = new THREE.MeshLambertMaterial({
    color: ENTRANCE_COLOR,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });

  let mountedRoot = null;
  let radius = 220;
  let cellWorldSize = DEFAULT_CELL_WORLD_SIZE;
  let ghostKey = null;
  // Cached per-card voxel preview so panning across cells never rebuilds the
  // building geometry; only position/orientation/colour update per target.
  let cachedPreviewSpec = null;
  let cachedPreviewObject = null;

  function setSceneRoot(root = null) {
    if (mountedRoot) mountedRoot.remove(layer);
    mountedRoot = root;
    clearGhost();
    if (mountedRoot) mountedRoot.add(layer);
    radius = Number(mountedRoot?.userData?.surfaceNavigation?.radius ?? 220);
  }

  function configure(options = {}) {
    if (Number.isFinite(Number(options.radius))) radius = Number(options.radius);
    if (Number.isFinite(Number(options.cellWorldSize))) cellWorldSize = Number(options.cellWorldSize);
  }

  function clearGhost() {
    const ghost = layer.getObjectByName("CityPlacementGhost");
    if (ghost) {
      layer.remove(ghost);
      ghost.traverse((object) => {
        if (object.userData?.previewCached) return;
        object.geometry?.dispose?.();
      });
    }
    ghostKey = null;
    layer.visible = false;
  }

  function clearAll() {
    clearGhost();
  }

  function frameFor(centerX, centerZ) {
    return getVoxelSphereFrame(Number(centerX), Number(centerZ), radius, frameScratch);
  }

  // Builds (once per card) and caches the voxel building preview with its
  // materials replaced by the shared translucent ghost material.
  function getCachedPreview(spec) {
    if (cachedPreviewObject && cachedPreviewSpec?.id === spec?.id) return cachedPreviewObject;
    if (cachedPreviewObject) {
      cachedPreviewObject.traverse((object) => object.geometry?.dispose?.());
    }
    cachedPreviewSpec = spec;
    try {
      cachedPreviewObject = createSpecialStructurePreview(spec);
      const bounds = new THREE.Box3().setFromObject(cachedPreviewObject);
      const center = bounds.getCenter(new THREE.Vector3());
      cachedPreviewObject.position.sub(center);
      cachedPreviewObject.traverse((object) => {
        object.userData.previewCached = true;
        if (!object.isMesh) return;
        object.material = ghostMaterial;
        object.castShadow = false;
      });
    } catch {
      cachedPreviewObject = null;
      cachedPreviewSpec = null;
    }
    return cachedPreviewObject;
  }

  // Target shape: { hasTarget, isLegal, footprintCells, cells, entrance,
  // footprintColumns, footprintRows, previewSource? }. Only renders while
  // hasTarget is true. `previewSource` is the normalized preview produced by
  // resolveSpecialStructurePreview — currently a `voxel-spec` built from the
  // building grammar; a future `cardId -> prefab` source renders identically
  // through this same branch without touching placement state/target logic.
  function showGhost(target = {}) {
    if (!target?.hasTarget || !target?.cells?.length) {
      clearGhost();
      return false;
    }
    const isLegal = Boolean(target.isLegal);
    const color = isLegal ? VALID_COLOR : INVALID_COLOR;
    const source = target.previewSource ?? null;
    const spec = source?.kind === "voxel-spec" ? source.spec : null;
    const sourceKey = source?.kind === "voxel-spec" ? `voxel:${source.spec?.id ?? ""}` : (source?.kind ?? "massing");
    const key = [
      target.lotId ?? "",
      target.footprintColumns ?? 0,
      target.footprintRows ?? 0,
      target.entrance ?? "",
      isLegal ? "legal" : "invalid",
      sourceKey,
      radius.toFixed(3),
      cellWorldSize.toFixed(3)
    ].join("|");
    if (ghostKey === key) {
      layer.visible = true;
      return true;
    }
    clearGhost();
    ghostKey = key;

    const ghost = new THREE.Group();
    ghost.name = "CityPlacementGhost";
    ghostMaterial.color.set(color);

    const preview = spec ? getCachedPreview(spec) : null;
    if (preview) {
      ghost.userData.ghostMode = "voxel-building-preview";
      placeVoxelPreview(ghost, preview, spec, target);
    } else {
      ghost.userData.ghostMode = "massing-voxel-fallback";
      buildMassing(ghost, target);
    }

    addEntranceMarker(ghost, target);
    if (target.cells.length > 1) {
      const corners = buildOutlineCorners(target.cells, cellWorldSize);
      if (corners.length >= 4) {
        const geometry = new THREE.BufferGeometry().setFromPoints(corners);
        const outline = new THREE.Line(geometry, outlineMaterial);
        outline.renderOrder = 4;
        ghost.add(outline);
      }
    }

    layer.add(ghost);
    layer.visible = true;
    return true;
  }

  function placeVoxelPreview(ghost, preview, spec, target) {
    let cx = 0;
    let cz = 0;
    for (const cell of target.cells) {
      cx += Number(cell.centerX) / target.cells.length;
      cz += Number(cell.centerZ) / target.cells.length;
    }
    const scale = previewFootprintScale(spec, target.footprintColumns, target.footprintRows, cellWorldSize);
    preview.scale.set(scale.x, 1, scale.z);
    // Entrance yaw (matching the city renderer) is a local +Y rotation composed
    // after the sphere orientation, so the door faces the requested entrance
    // while the building stays upright on the surface.
    const yawDegrees = ENTRANCE_YAW_DEGREES[target.entrance] ?? ENTRANCE_YAW_DEGREES.south;
    const quaternion = getVoxelSphereOrientation(cx, cz, radius)
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(yawDegrees)));
    const frame = frameFor(cx, cz);
    preview.quaternion.copy(quaternion);
    preview.position.copy(frame.surface).addScaledVector(frame.normal, 0.04);
    preview.visible = true;
    ghost.add(preview);
  }

  function buildMassing(ghost, target) {
    const size = cellWorldSize;
    const height = ghostHeightForFootprint(target.footprintColumns, target.footprintRows);
    for (const cell of target.cells) {
      const frame = frameFor(cell.centerX, cell.centerZ);
      // Align local +Y with the surface normal (the same basis the city uses
      // via getVoxelSphereOrientation / placeObjectOnVoxelSphere), so the
      // ghost body's height axis follows the terrain normal at any position.
      const quaternion = getVoxelSphereOrientation(cell.centerX, cell.centerZ, radius);
      const body = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), ghostMaterial);
      body.position.copy(frame.surface).addScaledVector(frame.normal, height / 2);
      body.quaternion.copy(quaternion);
      body.renderOrder = 3;
      body.castShadow = false;
      ghost.add(body);

      // Roof cap gives the fallback massing a building silhouette instead of a
      // plain cube so the player can judge height/roof form at a glance.
      const roof = new THREE.Mesh(new THREE.BoxGeometry(size * 0.86, height * 0.2, size * 0.86), ghostMaterial);
      roof.position.copy(frame.surface).addScaledVector(frame.normal, height * 1.02);
      roof.quaternion.copy(quaternion);
      roof.renderOrder = 3;
      roof.castShadow = false;
      ghost.add(roof);
    }
  }

  function addEntranceMarker(ghost, target) {
    const entranceSide = target.entrance;
    const size = cellWorldSize;
    if (!entranceSide || !target.cells.length) return;
    // The door slab sits on the frontage cell just outside the footprint,
    // centered on the facade edge of the anchor (north-west) cell. Flat world
    // offsets: east = +X, west = -X, north (row - 1) = +Z, south (row + 1) = -Z.
    const anchorCell = target.cells[0];
    const offsets = {
      north: [0, size],
      east: [size, 0],
      south: [0, -size],
      west: [-size, 0]
    };
    const [dx, dz] = offsets[entranceSide] ?? [0, -size];
    const doorCenterX = Number(anchorCell.centerX) + dx;
    const doorCenterZ = Number(anchorCell.centerZ) + dz;
    const frame = frameFor(doorCenterX, doorCenterZ);
    const height = ghostHeightForFootprint(target.footprintColumns, target.footprintRows);
    const door = new THREE.Mesh(new THREE.BoxGeometry(size * 0.32, height * 0.45, size * 0.14), entranceMaterial);
    door.position.copy(frame.surface).addScaledVector(frame.normal, height * 0.22);
    door.quaternion.copy(getVoxelSphereOrientation(doorCenterX, doorCenterZ, radius));
    door.renderOrder = 4;
    ghost.add(door);
  }

  // Footprint perimeter outline on the surface, spanning the bounding box of
  // the occupied cells so a multi-cell footprint reads at a glance.
  function buildOutlineCorners(cells, size) {
    const minColumn = Math.min(...cells.map((cell) => Number(cell.column)));
    const maxColumn = Math.max(...cells.map((cell) => Number(cell.column)));
    const minRow = Math.min(...cells.map((cell) => Number(cell.row)));
    const maxRow = Math.max(...cells.map((cell) => Number(cell.row)));
    const width = (maxColumn - minColumn + 1) * size;
    const depth = (maxRow - minRow + 1) * size;
    const first = cells[0];
    const originFrame = frameFor(first.centerX, first.centerZ);
    const tangentX = originFrame.tangentX.clone().normalize();
    const tangentZ = originFrame.tangentZ.clone().normalize();
    const origin = originFrame.surface.clone().addScaledVector(originFrame.normal, 0.06);
    const corner = (dx, dz) => origin.clone()
      .addScaledVector(tangentX, dx)
      .addScaledVector(tangentZ, dz);
    return [
      corner(0, 0),
      corner(width, 0),
      corner(width, depth),
      corner(0, depth),
      corner(0, 0)
    ];
  }

  function hideGhost() {
    if (ghostKey !== null) {
      clearGhost();
    }
  }

  function dispose() {
    if (mountedRoot) mountedRoot.remove(layer);
    clearAll();
    if (cachedPreviewObject) {
      cachedPreviewObject.traverse((object) => object.geometry?.dispose?.());
      cachedPreviewObject = null;
      cachedPreviewSpec = null;
    }
    ghostMaterial.dispose();
    outlineMaterial.dispose();
    entranceMaterial.dispose();
  }

  return {
    setSceneRoot,
    configure,
    showGhost,
    hideGhost,
    clear: clearAll,
    dispose,
    get radius() { return radius; },
    get cellWorldSize() { return cellWorldSize; },
    object: layer
  };
}

// Kept for backward-compatible imports: world footprint size of a candidate's
// footprint cells used by tests and pre-existing callers.
export function footprintWorldSizeForCandidate(candidate, cellWorldSize = 4) {
  const cells = candidate?.footprintCells ?? [];
  if (!cells.length) return { width: cellWorldSize, depth: cellWorldSize };
  const columns = new Set(cells.map((id) => {
    const match = /^cell-(\d+)-/.exec(String(id ?? ""));
    return match ? Number(match[1]) : 0;
  })).size;
  const rows = new Set(cells.map((id) => {
    const match = /-(\d+)$/.exec(String(id ?? ""));
    return match ? Number(match[1]) : 0;
  })).size;
  const columnsCount = Number(candidate.footprintColumns ?? columns) || 1;
  const rowsCount = Number(candidate.footprintRows ?? rows) || 1;
  return { width: columnsCount * cellWorldSize, depth: rowsCount * cellWorldSize };
}
