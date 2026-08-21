import * as THREE from "three";

const DEFAULT_MARGIN = 0.52;
const DEFAULT_OPACITY = 0.24;
const DEFAULT_SURFACE_OFFSET = 0.14;

export function createBuildingContactAmbientOcclusion({
  buildings = [],
  cells = [],
  cellWorldSize = 4,
  sampleGroundHeight = () => 0,
  margin = DEFAULT_MARGIN,
  opacity = DEFAULT_OPACITY,
  surfaceOffset = DEFAULT_SURFACE_OFFSET
} = {}) {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const positions = [];
  const colors = [];
  const indices = [];
  let patchCount = 0;

  buildings.forEach((building) => {
    const footprint = (building.footprintCells ?? [building.site?.lotId])
      .map((cellId) => cellsById.get(cellId))
      .filter(Boolean);
    if (!footprint.length) return;

    const halfCell = cellWorldSize * 0.5;
    const minX = Math.min(...footprint.map((cell) => cell.center.x - halfCell));
    const maxX = Math.max(...footprint.map((cell) => cell.center.x + halfCell));
    const minZ = Math.min(...footprint.map((cell) => cell.center.z - halfCell));
    const maxZ = Math.max(...footprint.map((cell) => cell.center.z + halfCell));
    appendContactPatch({
      minX,
      maxX,
      minZ,
      maxZ,
      margin,
      opacity,
      surfaceOffset,
      sampleGroundHeight,
      positions,
      colors,
      indices
    });
    patchCount += 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    color: "#273024",
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "BuildingContactAmbientOcclusion";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = -2;
  mesh.userData.flatVoxelGeometry = true;
  mesh.userData.contactAmbientOcclusion = true;
  mesh.userData.patchCount = patchCount;
  mesh.userData.triangleCount = indices.length / 3;
  return mesh;
}

function appendContactPatch({
  minX,
  maxX,
  minZ,
  maxZ,
  margin,
  opacity,
  surfaceOffset,
  sampleGroundHeight,
  positions,
  colors,
  indices
}) {
  const resolvedMargin = Math.max(0.05, Number(margin) || DEFAULT_MARGIN);
  const resolvedOpacity = THREE.MathUtils.clamp(Number(opacity) || DEFAULT_OPACITY, 0, 1);
  const xs = [minX - resolvedMargin, minX, maxX, maxX + resolvedMargin];
  const zs = [minZ - resolvedMargin, minZ, maxZ, maxZ + resolvedMargin];
  const base = positions.length / 3;

  zs.forEach((z, row) => {
    xs.forEach((x, column) => {
      positions.push(x, sampleGroundHeight(x, z) + surfaceOffset, z);
      const alpha = row === 0 || row === 3 || column === 0 || column === 3 ? 0 : resolvedOpacity;
      colors.push(1, 1, 1, alpha);
    });
  });

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const topLeft = base + row * 4 + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + 4;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, bottomRight, topLeft, bottomRight, topRight);
    }
  }
}
