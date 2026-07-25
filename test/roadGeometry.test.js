import assert from "node:assert/strict";
import test from "node:test";
import { createMagicLondonBaseTileKit } from "../src/generators/magicLondonBaseTiles.js";

function countUndirectedEdges(geometry) {
  const index = geometry.getIndex();
  assert.ok(index, "closed road geometry should be indexed");
  const counts = new Map();
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

test("crossroad sidewalks are closed solids with clipped polygon stone paving", () => {
  const cell = { id: "cell-1-1", column: 1, row: 1, center: { x: 0, z: 0 } };
  const grid = { cellWorldSize: 4, cells: [cell] };
  const kit = createMagicLondonBaseTileKit({
    params: { showBaseTiles: 1, cellTerrainTiles: 3 },
    grid,
    terrain: {},
    sampleGroundHeight: (x, z) => x * 0.015 + z * 0.01,
    plan: [{ cell, kind: "road", ports: ["north", "east", "south", "west"] }]
  });
  const sidewalks = [];
  const pavers = [];
  const roadFills = [];
  kit.traverse((object) => {
    if (object.name === "ClosedChamferedIntersectionSidewalk") sidewalks.push(object);
    if (object.name === "PolygonStoneSidewalkSlab") pavers.push(object);
    if (object.name === "ChamferedIntersectionRoadFill") roadFills.push(object);
  });

  assert.equal(sidewalks.length, 4, "a crossroad should close all four sidewalk corners");
  assert.equal(roadFills.length, 4, "a crossroad should fill every chamfer beside the road core");
  assert.ok(pavers.length >= 8, "large stone paving should continue across the clipped intersection corners");
  assert.ok(pavers.some((paver) => paver.geometry.getAttribute("position").count >= 5), "the paving should contain true multi-sided stone slabs");
  sidewalks.forEach((sidewalk) => {
    const edgeCounts = countUndirectedEdges(sidewalk.geometry);
    assert.equal([...edgeCounts.values()].every((count) => count === 2), true, `${sidewalk.name} must be manifold without boundary edges`);
  });
});

test("road ends and every unconnected junction exit are capped with stone sidewalk", () => {
  const cases = [
    { label: "north-facing road end", ports: ["north"], expectedCaps: 1 },
    { label: "T-junction", ports: ["north", "east", "west"], expectedCaps: 1 },
    { label: "corner", ports: ["north", "east"], expectedCaps: 2 },
    { label: "straight road", ports: ["north", "south"], expectedCaps: 0 },
    { label: "crossroad", ports: ["north", "east", "south", "west"], expectedCaps: 0 }
  ];

  cases.forEach(({ label, ports, expectedCaps }) => {
    const cell = { id: "cell-1-1", column: 1, row: 1, center: { x: 0, z: 0 } };
    const kit = createMagicLondonBaseTileKit({
      params: { showBaseTiles: 1, cellTerrainTiles: 3 },
      grid: { cellWorldSize: 4, cells: [cell] },
      terrain: {},
      sampleGroundHeight: (x, z) => x * 0.015 + z * 0.01,
      plan: [{ cell, kind: "road", ports }]
    });
    const caps = [];
    kit.traverse((object) => {
      if (object.name === "ClosedRoadEndSidewalkCap") caps.push(object);
    });

    assert.equal(caps.length, expectedCaps, `${label} should cap every exposed road arm`);
    caps.forEach((cap) => {
      const edgeCounts = countUndirectedEdges(cap.geometry);
      assert.equal([...edgeCounts.values()].every((count) => count === 2), true, `${label} cap must be manifold without boundary edges`);
    });
  });
});
