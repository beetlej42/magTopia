import test from "node:test";
import assert from "node:assert/strict";
import { createAgentAcceptanceCity } from "../src/generators/agentAcceptanceCity.js";
import { createAgentVoxelRoadLayer, selectVictorianBridgeStyle } from "../src/generators/agentVoxelInfrastructure.js";

test("Agent acceptance city renders roads and vegetation entirely as voxel geometry", () => {
  const city = createAgentAcceptanceCity({ acceptanceSeed: "voxel-infrastructure-test" });
  const diagnostics = city.userData.diagnostics;
  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.renderer, "agent-acceptance-city-v2-all-voxel");
  assert.equal(diagnostics.roadRenderer.renderer, "state-driven-voxel-road-v2-victorian-bridges");
  assert.equal(diagnostics.roadRenderer.roadCellCount, diagnostics.roads + diagnostics.bridges);
  assert.equal(diagnostics.roadRenderer.bridgeCellCount, diagnostics.bridges);
  assert.equal(diagnostics.roadRenderer.roadAsset, "shared-victorian-voxel-road-tile-v1");
  assert.ok(diagnostics.roadRenderer.curbVoxels > 0);
  assert.ok(diagnostics.roadRenderer.markingVoxels > 0);
  assert.ok(diagnostics.roadRenderer.lampCount > 0);
  assert.ok(diagnostics.roadRenderer.bridgeSpanCount > 0);
  assert.equal(diagnostics.roadRenderer.adaptiveSpanRules, true);
  assert.ok(diagnostics.roadRenderer.bridgeSpans.every((span) => span.railings && span.abutments));
  assert.ok(diagnostics.roadRenderer.bridgeSpans.every((span) => span.spanWorldUnits === span.cellCount * 4));
  assert.ok(diagnostics.roadRenderer.renderStats.renderedTriangles > 0);
  assert.equal(diagnostics.vegetation.renderer, "state-aware-voxel-vegetation-v1");
  assert.equal(diagnostics.vegetation.clearsRoadsAndEntrances, true);
  assert.ok(diagnostics.vegetation.trees > 0);
  assert.ok(diagnostics.vegetation.renderStats.renderedTriangles > 0);
  assert.equal(diagnostics.projection.type, "spherical-local-frame");
  assert.equal(diagnostics.projection.radius, 220);
  assert.ok(diagnostics.projection.projectedObjects > 0);
  assert.equal(city.userData.contract.renderSurface, "spherical voxel world; flat Agent API coordinates remain authoritative");
  assert.equal(city.userData.contract.camera.depthOfField, "bokeh retained");
  assert.equal(city.userData.surfaceNavigation.radius, 220);

  const roads = city.getObjectByName("AgentAcceptanceRoads");
  const vegetation = city.getObjectByName("AgentAcceptanceVegetation");
  assert.ok(roads.children.every((child) => child.userData.voxelRenderStrategy === "greedy-chunk"));
  assert.ok(vegetation.children.every((child) => child.userData.voxelRenderStrategy === "greedy-chunk"));
  assert.equal(city.getObjectByName("MagicLondonVegetation"), undefined);
  assert.equal(city.getObjectByName("MagicLondonBaseTiles"), undefined);
});

test("Victorian bridge selection is deterministic, span-aware, and visually varied", () => {
  assert.equal(selectVictorianBridgeStyle("same-seed", 3), selectVictorianBridgeStyle("same-seed", 3));
  const shortStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`short-${index}`, 1)));
  const mediumStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`medium-${index}`, 3)));
  const longStyles = new Set(Array.from({ length: 20 }, (_, index) => selectVictorianBridgeStyle(`long-${index}`, 7)));
  assert.deepEqual([...shortStyles].sort(), ["iron_truss", "masonry_arch"]);
  assert.ok(mediumStyles.has("masonry_arch"));
  assert.ok(mediumStyles.has("iron_truss"));
  assert.ok(mediumStyles.has("suspension_bridge"));
  assert.ok(longStyles.has("suspension_bridge"));
});

test("bridge geometry grades and scales as a single span across different river widths", () => {
  for (const cellCount of [1, 3, 6]) {
    const cells = Array.from({ length: cellCount + 2 }, (_, column) => ({
      id: `cell-${column}-0`,
      column,
      row: 0,
      center: { x: column * 4, z: 0 },
      surface: column === 0 || column === cellCount + 1
        ? { kind: "terrain", minElevationVoxels: 2, maxElevationVoxels: 2 }
        : { kind: "water", minElevationVoxels: -3, maxElevationVoxels: -3 }
    }));
    const state = {
      cells: Object.fromEntries(cells.map((cell) => [cell.id, {
        ...cell,
        infrastructure: cell.column === 0 || cell.column === cellCount + 1 ? "road" : null
      }])),
      infrastructure: Object.fromEntries(cells.slice(1, -1).map((cell) => [cell.id, { type: "bridge", cellId: cell.id }]))
    };
    const layer = createAgentVoxelRoadLayer({ state, grid: { cells }, seed: `width-${cellCount}` });
    const [span] = layer.userData.contract.bridgeSpans;
    assert.equal(layer.userData.contract.bridgeSpanCount, 1);
    assert.equal(span.cellCount, cellCount);
    assert.equal(span.spanVoxels, cellCount * 32);
    assert.equal(span.spanWorldUnits, cellCount * 4);
    assert.equal(span.deckVoxelY, 3);
    assert.ok(layer.userData.contract.renderStats.renderedTriangles > 0);
  }
});
