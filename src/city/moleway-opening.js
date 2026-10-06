// The same authored stairwell bounds drive the asset and terrain subtraction.
// Coordinates are voxel edges in a 32 x 32 parcel, entrance facing +Z.
export const MOLEWAY_CARD_ID = "floo-fireplace-station";
export const MOLEWAY_OPENING = Object.freeze({ minX: -8, maxX: 8, minZ: -12, maxZ: 12 });

export function molewayOpeningContains(x, z, entrance = "north") {
  const angle = ({ north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 })[entrance] ?? 0;
  const localX = x * Math.cos(angle) - z * Math.sin(angle);
  const localZ = x * Math.sin(angle) + z * Math.cos(angle);
  const b = MOLEWAY_OPENING;
  return localX > b.minX && localX < b.maxX && localZ > b.minZ && localZ < b.maxZ;
}

export function markMolewayTerrainOpenings(terrainGrid, state, subdivisions = 32) {
  const openings = new Uint8Array(terrainGrid.width * terrainGrid.height);
  for (const building of Object.values(state?.buildings ?? {})) {
    if (building.specialStructure?.cardId !== MOLEWAY_CARD_ID || building.status === "construction"
      || building.status === "cancelled" || building.site?.footprint !== "1x1") continue;
    const cell = state.cells?.[building.site.lotId];
    if (!cell || !Number.isInteger(cell.column) || !Number.isInteger(cell.row)) continue;
    for (let r = 0; r < subdivisions; r++) for (let c = 0; c < subdivisions; c++) {
      const column = cell.column * subdivisions + c, row = cell.row * subdivisions + r;
      if (column < 0 || row < 0 || column >= terrainGrid.width || row >= terrainGrid.height) continue;
      if (molewayOpeningContains((c + .5) * 32 / subdivisions - 16,
        (r + .5) * 32 / subdivisions - 16, building.site.entrance)) openings[terrainGrid.index(column, row)] = 1;
    }
  }
  terrainGrid.openings = openings;
  return openings;
}
