export function createServiceWorldContract(options = {}) {
  const columns = Number(options.columns ?? 50);
  const rows = Number(options.rows ?? 50);
  const cellWorldSize = 4;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const riverDistance = Math.abs(column - (8 + Math.round(Math.sin(row / 7) * 2)));
      if (riverDistance <= 1) continue;
      cells.push({
        id: `cell-${column}-${row}`,
        column,
        row,
        center: { x: (column - columns / 2) * cellWorldSize, z: (rows / 2 - row) * cellWorldSize },
        buildable: true,
        ground: column < 14 ? "riverfront" : column > 38 ? "urban_edge" : "development_land",
        fields: { scenic: column < 14 ? 3 : 1, accessibility: column > 38 ? 3 : 1, magicRisk: column < 6 ? 2 : 0 }
      });
    }
  }
  return {
    mapId: options.mapId ?? "magic-london-riverfront-service-001",
    mapRecipeVersion: "riverfront-grid@1",
    grid: { columns, rows, cellWorldSize, cells },
    anchors: [{ id: "riverfront", type: "sunken_water_system" }]
  };
}
