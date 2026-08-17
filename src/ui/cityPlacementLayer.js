// PR G — Placement highlight layer inside the existing city viewer.
//
// A world-space overlay that marks every legal lot returned by the
// authoritative /site-searches endpoint and lets the player tap a marker to
// preview the footprint. It preserves the existing near/far camera system: the
// overlay only renders markers and answers pick queries; it never moves the
// camera or changes the gameplay world.
//
// Marker positions are derived from the same spherical projection the viewer
// uses (getVoxelSphereFrame over the flat Agent API coordinates), so markers
// sit exactly on the rendered city surface.

import * as THREE from "three";
import { getVoxelSphereFrame } from "../generators/voxelIntentDistrict.js";

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PICK_RADIUS_PX = 34;

// World-space footprint of a candidate lot for preview rendering.
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

export function createCityPlacementLayer() {
  const layer = new THREE.Group();
  layer.name = "CityPlacementLayer";
  layer.visible = false;

  const markerMaterial = new THREE.MeshBasicMaterial({
    color: "#6fe3a1",
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  const selectedMaterial = new THREE.MeshBasicMaterial({
    color: "#ffd166",
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  const previewMaterial = new THREE.LineBasicMaterial({
    color: "#ffd166",
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false
  });

  const markers = [];
  const markerObjects = [];
  let mountedRoot = null;
  let selection = null;
  let radius = 220;
  let cellWorldSize = 4;

  function setSceneRoot(root = null) {
    if (mountedRoot) mountedRoot.remove(layer);
    mountedRoot = root;
    clearAll();
    if (mountedRoot) mountedRoot.add(layer);
    radius = Number(mountedRoot?.userData?.surfaceNavigation?.radius ?? 220);
  }

  function configure(options = {}) {
    if (Number.isFinite(Number(options.radius))) radius = Number(options.radius);
    if (Number.isFinite(Number(options.cellWorldSize))) cellWorldSize = Number(options.cellWorldSize);
  }

  function clearMarkers() {
    for (const object of markerObjects) {
      layer.remove(object);
      object.geometry?.dispose?.();
    }
    markerObjects.length = 0;
    markers.length = 0;
  }

  function clearPreview() {
    const preview = layer.getObjectByName("CityPlacementPreview");
    if (preview) {
      layer.remove(preview);
      preview.geometry?.dispose?.();
    }
  }

  function clearAll() {
    clearMarkers();
    clearPreview();
    selection = null;
    layer.visible = false;
  }

  // candidates: array of { lotId, center:{x,z}, footprintCells, entranceDirections }
  function setCandidates(candidates = [], options = {}) {
    clearMarkers();
    if (Number.isFinite(Number(options.radius))) radius = Number(options.radius);
    if (Number.isFinite(Number(options.cellWorldSize))) cellWorldSize = Number(options.cellWorldSize);
    candidates.forEach((candidate, index) => {
      const center = candidate.center ?? { x: 0, z: 0 };
      const frame = getVoxelSphereFrame(Number(center.x), Number(center.z), radius);
      const marker = new THREE.Mesh(new THREE.CircleGeometry(0.6, 18), markerMaterial);
      marker.name = `CityPlacementMarker-${index}`;
      marker.position.copy(frame.surface);
      marker.quaternion.setFromUnitVectors(Z_AXIS, frame.normal);
      marker.renderOrder = 3;
      layer.add(marker);
      markerObjects.push(marker);
      const footprint = footprintWorldSize(candidate, cellWorldSize);
      markers.push({ candidate, world: frame.surface.clone(), normal: frame.normal.clone(), frame, footprint });
    });
    layer.visible = markers.length > 0;
    return markers.length;
  }

  function footprintWorldSize(candidate, cellSize) {
    return footprintWorldSizeForCandidate(candidate, cellSize);
  }

  function worldForCell(cell, radius) {
    return getVoxelSphereFrame(Number(cell?.center?.x ?? 0), Number(cell?.center?.z ?? 0), radius);
  }

  // Selects a candidate and shows a footprint preview ring on the surface.
  function select(candidate) {
    const entry = markers.find((marker) => marker.candidate.lotId === candidate?.lotId) ?? null;
    if (!entry) return false;
    selection = entry;
    for (let index = 0; index < markers.length; index += 1) {
      markerObjects[index].material = markers[index] === entry ? selectedMaterial : markerMaterial;
    }
    showPreview(entry);
    return true;
  }

  function showPreview(entry) {
    clearPreview();
    const preview = new THREE.Group();
    preview.name = "CityPlacementPreview";
    const width = entry.footprint?.width ?? cellWorldSize;
    const depth = entry.footprint?.depth ?? cellWorldSize;
    const halfW = width / 2;
    const halfD = depth / 2;
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
      [-halfW, -halfD]
    ].map(([dx, dz]) => new THREE.Vector3(dx, 0.22, dz));
    const geometry = new THREE.BufferGeometry().setFromPoints(corners);
    const line = new THREE.Line(geometry, previewMaterial);
    const { frame } = entry;
    preview.position.copy(frame.surface).addScaledVector(frame.normal, 0.12);
    preview.quaternion.setFromUnitVectors(Z_AXIS, frame.normal);
    preview.add(line);
    layer.add(preview);
  }

  // Returns the candidate whose screen projection is nearest the given point
  // within PICK_RADIUS_PX, or null.
  function pick(clientX, clientY, camera, viewport = {}) {
    if (!camera || markers.length === 0) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const entry of markers) {
      const point = entry.world.clone();
      point.applyMatrix4(camera.matrixWorldInverse);
      if (point.z >= 0) continue;
      const projected = point.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = (projected.x * 0.5 + 0.5) * (viewport.width || window.innerWidth);
      const sy = (-projected.y * 0.5 + 0.5) * (viewport.height || window.innerHeight);
      const dx = clientX - sx;
      const dy = clientY - sy;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    if (!best || bestDistance > PICK_RADIUS_PX) return null;
    return best.candidate;
  }

  function clearSelection() {
    selection = null;
    for (const object of markerObjects) object.material = markerMaterial;
    clearPreview();
  }

  function hide() {
    layer.visible = false;
  }

  function show() {
    layer.visible = markers.length > 0;
  }

  function dispose() {
    if (mountedRoot) mountedRoot.remove(layer);
    clearAll();
    markerMaterial.dispose();
    selectedMaterial.dispose();
    previewMaterial.dispose();
  }

  return {
    setSceneRoot,
    configure,
    setCandidates,
    select,
    pick,
    clearSelection,
    clear: clearAll,
    hide,
    show,
    dispose,
    worldForCell,
    get radius() { return radius; },
    get cellWorldSize() { return cellWorldSize; },
    object: layer
  };
}
