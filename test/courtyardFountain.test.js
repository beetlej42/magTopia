import assert from "node:assert/strict";
import test from "node:test";
import { createUrbanMassingSpec } from "../src/generators/voxelMassingGrammar.js";
import { createVoxelMassingLab } from "../src/generators/voxelBuildingLab.js";
import { createBuildingDesignDraft } from "../src/city/building-design.js";
import { getBuildingSourceHash, generateBakedBuildingArtifact } from "../apps/server/render-artifact-service.js";

function courtyard(size, pattern = "courtyard") {
  return createUrbanMassingSpec({
    id: "legacy-court", seed: "legacy-court", widthCells: size, depthCells: size,
    masses: [{ id: "court", type: "ground", cells: Array.from({ length: size * size }, (_, i) => [i % size, Math.floor(i / size)]), heightVoxels: 2,
      groundTreatment: { pattern, planterCount: 4, pathWidthVoxels: 7 } }]
  });
}

for (const size of [1, 2]) {
  test(`${size}x${size} persisted courtyard gains a central fountain without changing its spec`, () => {
    const saved = JSON.parse(JSON.stringify(courtyard(size)));
    const before = JSON.stringify(saved);
    const diagnostics = createVoxelMassingLab({ spec: saved }).userData.getVoxelDiagnostics();
    const details = diagnostics.groundDetails[0];
    assert.equal(details.fountain.radius, size === 1 ? 6 : 12);
    assert.equal(Math.abs(details.fountain.centerX), 0);
    assert.equal(Math.abs(details.fountain.centerZ), 0);
    assert.equal(details.planterCount, 4);
    assert.ok(diagnostics.materialCounts.water > 0);
    assert.ok(diagnostics.materialCounts.waterLight > 0);
    assert.equal(JSON.stringify(saved), before);
    assert.deepEqual(createVoxelMassingLab({ spec: saved }).userData.getVoxelDiagnostics().groundDetails, diagnostics.groundDetails);
  });

  test(`${size}x${size} courtyard works through the Agent design API and baked pipeline`, async () => {
    const design = createBuildingDesignDraft({ id: `court-${size}`, seed: "court", site: { anchor_cell_id: "cell-10-10", footprint: `${size}x${size}` }, intent: { purpose: "courtyard", site_layout: "open_space", open_space_type: "courtyard" } });
    assert.equal(design.generation.mode, "urban_massing");
    const diagnostics = createVoxelMassingLab({ spec: design.generation.sourceSpec }).userData.getVoxelDiagnostics();
    assert.ok(diagnostics.groundDetails[0].fountain);
    const building = { id: "saved-building", voxelDesign: design };
    assert.notEqual(getBuildingSourceHash(building), getBuildingSourceHash(building, 3));
    const baked = await generateBakedBuildingArtifact(building);
    assert.equal(baked.sourceHash, getBuildingSourceHash(building));
    assert.ok(baked.byteLength > 0);
  });
}

test("other ground treatments do not acquire a fountain", () => {
  for (const pattern of ["plain", "bordered", "garden"]) {
    const details = createVoxelMassingLab(courtyard(1, pattern)).userData.getVoxelDiagnostics().groundDetails[0];
    assert.equal(details.fountain, undefined);
  }
});

test("courtyard fountains skip occupied centres and concave footprints", () => {
  const occupied = courtyard(1);
  occupied.masses.push({ id: "hall", type: "solid", cells: [[0, 0]], dimensionsVoxels: { width: 8, depth: 8 }, heightVoxels: 20 });
  assert.equal(createVoxelMassingLab(occupied).userData.getVoxelDiagnostics().groundDetails[0].fountain, undefined);
  const concave = courtyard(2);
  concave.masses[0].cells = [[0, 0], [1, 0], [0, 1]];
  assert.equal(createVoxelMassingLab(concave).userData.getVoxelDiagnostics().groundDetails[0].fountain, undefined);
});
