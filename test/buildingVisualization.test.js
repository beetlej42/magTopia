import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PNG } from "pngjs";
import { createBuildingDesignDraft, reviseBuildingDesign } from "../src/city/building-design.js";
import { renderBuildingVisualization, rasterizeBuildingObject } from "../src/render/buildingVisualization.js";
import { createBuildingVisualizationService } from "../apps/server/building-visualization.js";

function draft(intent = {}, footprint = "1x1", entrance = "south") {
  return createBuildingDesignDraft({ seed: "visualizer-test", site: { anchor_cell_id: "cell-10-10", footprint, entrance }, intent: { name: "Preview", purpose: "shop", frontage: "display", ...intent } }, { id: "preview-test" });
}

test("real street geometry produces a deterministic PNG without mutating the design; signs are visible", () => {
  const design = draft();
  const original = structuredClone(design);
  const first = renderBuildingVisualization(design);
  assert.deepEqual(design, original);
  assert.deepEqual(first.png, renderBuildingVisualization(design).png);
  const image = PNG.sync.read(first.png);
  assert.equal(image.width, 512);
  assert.equal(image.height, 512);
  assert.equal(first.metadata.specHash, design.specHash);
  assert.ok(first.triangleCount > 100);
  assert.notDeepEqual(first.png, renderBuildingVisualization(design, { view: "back" }).png);
  const signed = reviseBuildingDesign(design, { expected_revision: 1, operations: [{ op: "add_decoration", decoration: {
    id: "preview-sign", type: "semantic_grid_sign", anchor: "main/floor-0/facade-south/entrance",
    parameters: { grid: [".##.", ".##.", "#..#", "####"], frameMaterial: "patinaMetal", boardMaterial: "slate", emissiveMaterial: "tealMagic", mount: "projecting" }
  } }] });
  const second = renderBuildingVisualization(signed);
  assert.notDeepEqual(first.png, second.png);
  assert.ok(second.triangleCount > first.triangleCount);
  assert.equal(second.metadata.revision, 2);
});

test("garden-only sites and east/west rectangular sites render in all views; raw specs work", () => {
  const garden = draft({ purpose: "public garden", site_layout: "open_space", open_space_type: "garden" });
  for (const view of ["front", "back", "top"]) {
    assert.ok(renderBuildingVisualization(garden, { view }).png.length > 2000);
  }
  assert.ok(renderBuildingVisualization(garden.generation.sourceSpec).png.length > 2000);
  assert.ok(renderBuildingVisualization(draft().generation.sourceSpec).png.length > 2000);
  for (const entrance of ["east", "west"]) {
    const design = draft({ purpose: "library", frontage: "institutional" }, "2x1", entrance);
    const image = PNG.sync.read(renderBuildingVisualization(design, { view: "top" }).png);
    let minX = 512, maxX = 0, minY = 512, maxY = 0;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const i = (y * 512 + x) * 4;
      if (image.data[i] === 239 && image.data[i + 1] === 236 && image.data[i + 2] === 229) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    assert.ok(maxX - minX > (maxY - minY) * 1.5, "2x1 world footprint must stay wide after east/west rotation");
    assert.ok(minX > 0 && maxX < 511 && minY > 0 && maxY < 511, "geometry must not be cropped");
  }
});

test("depth occlusion is independent of mesh order and transparent surfaces respect opaque depth", () => {
  const group = new THREE.Group();
  const plane = (color, z, opacity = 1) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
    mesh.position.z = z; return mesh;
  };
  const red = plane("#ff0000", 1), blue = plane("#0000ff", 0), hiddenGlass = plane("#00ff00", -1, 0.5);
  group.add(red, blue, hiddenGlass);
  const options = { direction: new THREE.Vector3(0, 0, 1) };
  const first = rasterizeBuildingObject(group, options).png;
  group.clear(); group.add(hiddenGlass, blue, red);
  assert.deepEqual(first, rasterizeBuildingObject(group, options).png);
  const centre = (256 * 512 + 256) * 4;
  const pixel = PNG.sync.read(first).data.subarray(centre, centre + 3);
  assert.ok(pixel[0] > 200 && pixel[1] === 0 && pixel[2] === 0);
  const glass = plane("#00ff00", 2, 0.5); group.add(glass);
  const blended = PNG.sync.read(rasterizeBuildingObject(group, options).png).data.subarray(centre, centre + 3);
  assert.ok(blended[0] > 80 && blended[1] > 80 && blended[2] === 0);
  group.traverse((mesh) => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
});

test("top view keeps world north (+Z) up and east (+X) right without culling upward faces", () => {
  const group = new THREE.Group();
  for (const [color, x, z] of [["#ff0000", 0, 1], ["#0000ff", 0, -1], ["#00ff00", 1, 0]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, 0, z); group.add(mesh);
  }
  const image = PNG.sync.read(rasterizeBuildingObject(group, { direction: new THREE.Vector3(0, 1, 0) }).png);
  const centres = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4;
    for (let c = 0; c < 3; c++) if (image.data[i + c] > 150 && image.data[i + (c + 1) % 3] === 0 && image.data[i + (c + 2) % 3] === 0) {
      centres[c][0] += x; centres[c][1] += y; centres[c][2]++;
    }
  }
  assert.ok(centres.every((c) => c[2] > 100));
  const [red, green, blue] = centres.map(([x, y, n]) => [x / n, y / n]);
  assert.ok(red[1] < blue[1]);
  assert.ok(green[0] > red[0]);
  group.traverse((mesh) => { mesh.geometry?.dispose(); mesh.material?.dispose(); });
});

test("worker bounds concurrency, releases failed jobs, and enforces timeout", async () => {
  const service = createBuildingVisualizationService();
  try {
    const pending = service.render(draft(), { view: "front", size: 512 });
    await assert.rejects(service.render(draft(), {}), { code: "BUILDING_VISUALIZATION_BUSY" });
    assert.ok((await pending).png.length > 2000);
    await assert.rejects(service.render({}, {}), { code: "BUILDING_VISUALIZATION_FAILED" });
    assert.ok((await service.render(draft(), { size: 1024 })).png.length > 2000);
  } finally { await service.close(); }
  const timed = createBuildingVisualizationService({ timeoutMs: 1 });
  try { await assert.rejects(timed.render(draft(), {}), { code: "BUILDING_VISUALIZATION_TIMEOUT" }); }
  finally { await timed.close(); }
});
