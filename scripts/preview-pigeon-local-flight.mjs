// Reproducible renderer-native preview: node scripts/preview-pigeon-local-flight.mjs [output-dir]
import * as THREE from "three";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBuildingDesignDraft } from "../src/city/building-design.js";
import { createBuildingDesignObject } from "../src/generators/buildingDesignObject.js";
import { createPigeonNavigation } from "../src/generators/pigeonNavigation.js";
import { planPigeonLocalFlight } from "../src/generators/pigeonLocalFlight.js";
import { createPigeonCityLayer } from "../src/generators/pigeonCityLayer.js";
import { rasterizeBuildingObject } from "../src/render/buildingVisualization.js";

const output = resolve(process.argv[2] ?? "artifacts/pigeon-local-flight"); mkdirSync(output, { recursive: true });
const stage = new THREE.Group(), cells = [];
for (let x = 0; x <= 1; x++) cells.push({ id: `c${x}`, column: x, row: 0, center: { x: x * 4, z: 0 } });
for (let x = 0; x <= 1; x++) cells.push({ id: `r${x}`, column: x, row: 1, center: { x: x * 4, z: -4 } });
const state = { cells: Object.fromEntries(cells.map(c => [c.id, { ...c, infrastructure: "road" }])), buildings: {} };
function box(x, y, z, w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); stage.add(m); return m;
}
for (const [i, cell] of [cells[0], cells[1]].entries()) {
  const design = createBuildingDesignDraft({ id: `plaza-${i}`, seed: "pigeon-plaza",
    site: { anchor_cell_id: cell.id, footprint: "1x1" },
    intent: { purpose: "plaza", site_layout: "open_space", open_space_type: "plaza" } });
  const object = createBuildingDesignObject(design); object.position.set(cell.center.x, 0.04, cell.center.z); stage.add(object);
  state.buildings[design.id] = { id: design.id, footprintCells: [cell.id], voxelDesign: design };
}
for (const cell of cells.slice(2)) {
  box(cell.center.x, -0.06, cell.center.z, 4, 0.12, 4, "#b1ab9c");
  box(cell.center.x, 0.015, cell.center.z, cell.row === 0 ? 4 : 2, 0.03, cell.row === 0 ? 2 : 4, "#777a77");
}
// Buildings beside the bend make corner-cutting visible. Their actual rendered
// triangles participate in navigation, just as they do in the city layer.
for (const [i, x] of [0, 4].entries()) {
  const design = createBuildingDesignDraft({ id: `house-${i}`, seed: `pigeon-house-${i}`,
    site: { anchor_cell_id: `h${i}`, footprint: "1x1" }, intent: { purpose: "residential" } });
  const object = createBuildingDesignObject(design); object.position.set(x, 0.04, 4); stage.add(object);
}
const nav = createPigeonNavigation({ state, grid: { cells, cellWorldSize: 4 }, collisionRoot: stage });
if (nav.stops.length !== 2 || !planPigeonLocalFlight(nav, ...nav.stops)) throw new Error("Preview route must be flyable with real geometry");
const flock = createPigeonCityLayer({ navigation: nav, planetRadius: 1e7, seed: "pigeon-preview" }); stage.add(flock);
flock.userData.update(0);
let launch = 0;
for (let t = 0; t < 65; t += 0.1) { flock.userData.update(t); if (flock.userData.getDiagnostics().state === "preparing") { launch = t; break; } }
const initialDiagnostics = flock.userData.getDiagnostics();
const fps = 8, frames = 160;
for (let i = 0; i < frames; i++) {
  flock.userData.update(launch + i / fps);
  const result = rasterizeBuildingObject(stage, { size: 512, direction: new THREE.Vector3(0.75, 1.2, -1.4).normalize() });
  writeFileSync(`${output}/frame-${String(i).padStart(3, "0")}.png`, result.png);
  if (i % 36 === 0) console.log(`frame ${i}/${frames}`);
}
writeFileSync(`${output}/diagnostics.json`, JSON.stringify({ fps, frames, launch, initialDiagnostics, ...flock.userData.getDiagnostics() }, null, 2));
