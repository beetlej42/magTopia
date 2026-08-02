import assert from "node:assert/strict";
import test from "node:test";
import {
  MASSING_EXPLORER_RANDOM_SCOPES,
  createExplorerRandomMassingConfig
} from "../src/generators/voxelMassingExplorer.js";
import { VOXEL_MASSING_PRESETS } from "../src/generators/voxelMassingGrammar.js";

test("massing explorer exposes the four focused randomization scopes", () => {
  assert.deepEqual(MASSING_EXPLORER_RANDOM_SCOPES, ["layout", "form", "detail", "all"]);
});

test("complete explorer randomization is seed-stable and produces valid diverse compositions", () => {
  const first = createExplorerRandomMassingConfig("explorer-stable", {}, "all");
  const replay = createExplorerRandomMassingConfig("explorer-stable", {}, "all");
  const second = createExplorerRandomMassingConfig("explorer-different", {}, "all");

  assert.deepEqual(replay, first);
  assert.notDeepEqual(second, first);
  assert.ok(first.footprint.widthCells <= 3);
  assert.ok(first.footprint.depthCells <= 3);
  assert.ok(first.masses.length >= 3);
  assert.ok(first.masses.some((mass) => mass.type === "ground"));
  assert.ok(first.relations.every((relation) => (
    first.masses.some((mass) => mass.id === relation.from)
    && first.masses.some((mass) => mass.id === relation.to)
  )));
});

test("complete explorer randomization stays valid across a seed sweep", () => {
  for (let index = 0; index < 40; index += 1) {
    const result = createExplorerRandomMassingConfig(
      `explorer-sweep-${index}`,
      VOXEL_MASSING_PRESETS.civicDome,
      "all"
    );

    assert.ok(result.masses.length >= 3, `seed ${index} should create several masses`);
    assert.ok(
      result.masses.some((mass) => mass.type === "ground"),
      `seed ${index} should retain a connected ground mass`
    );
  }
});

test("complete random studies satisfy the composition quality gate across many seeds", () => {
  for (let index = 0; index < 80; index += 1) {
    const result = createExplorerRandomMassingConfig(`quality-sweep-${index}`, {}, "all");
    const ground = result.masses.find((mass) => mass.type === "ground");
    const solids = result.masses.filter((mass) => mass.type === "solid");
    const openMasses = result.masses.filter((mass) => mass.type === "open");
    const framedMasses = result.masses.filter((mass) => mass.type === "framed");
    const stackedIds = new Set(result.relations
      .filter((relation) => relation.type === "stacked")
      .map((relation) => relation.to));
    const prominentEntrances = solids.filter((mass) => mass.facade.entranceEmphasis === 1);

    assert.ok(ground, `seed ${index} should have visible foreground`);
    assert.equal(
      new Set(ground.cells.filter((cell) => cell.z === result.footprint.depthCells - 1).map((cell) => cell.x)).size,
      result.footprint.widthCells,
      `seed ${index} should span the front edge with ground`
    );
    assert.equal(prominentEntrances.length, 1, `seed ${index} should have one visual entrance`);
    assert.equal(prominentEntrances[0].facade.entranceFace, "south");
    assert.ok(solids.every((mass) => ["brickRed", "brickBrown"].includes(mass.materials.wall)));
    assert.ok(solids.every((mass) => mass.facade.order === "classical"));
    assert.ok(solids.every((mass) => mass.facade.openness <= 0.46));

    assert.ok(ground.groundTreatment.planterCount >= 4);
    assert.ok(ground.groundTreatment.lampCount >= 4);
    assert.ok(ground.groundTreatment.stepWidthVoxels >= 14);
    assert.ok(ground.groundTreatment.stepDepthVoxels >= 4);

    assert.ok(openMasses.every((mass) => mass.dimensionsVoxels.depth <= 14));
    assert.ok(openMasses.every((mass) => mass.enclosure.archRiseVoxels >= 5));
    assert.ok(openMasses.every((mass) => mass.enclosure.capitalHeightVoxels >= 2));
    assert.ok(framedMasses.every((mass) => mass.heightVoxels <= 14));
    assert.ok(framedMasses.every((mass) => mass.cap.type === "glass_barrel"));
    assert.ok(framedMasses.every((mass) => mass.materials.panel === "lightGlass"));

    for (const hero of solids.filter((mass) => stackedIds.has(mass.id))) {
      assert.ok(hero.heightVoxels >= 34);
      assert.ok(["chamfered", "octagonal"].includes(hero.planShape));
      assert.ok(["spire", "dome"].includes(hero.cap.type));
      assert.ok(hero.cap.ribCount >= 8);
      assert.ok(hero.cap.finialHeightVoxels >= 3);
      assert.equal(hero.facade.accentWindow.type, "oculus");
      assert.equal(hero.facade.entranceEmphasis, 0);
    }
  }
});

test("complete studies use one coherent facade palette and order", () => {
  const result = createExplorerRandomMassingConfig(
    "coherent-classical-study",
    VOXEL_MASSING_PRESETS.civicDome,
    "all"
  );
  const solids = result.masses.filter((mass) => mass.type === "solid");
  const facadeOrders = new Set(solids.map((mass) => mass.facade.order));
  const wallMaterials = new Set(solids.map((mass) => mass.materials.wall));
  const trimMaterials = new Set(solids.map((mass) => mass.materials.trim));

  assert.equal(facadeOrders.size, 1);
  assert.equal(wallMaterials.size, 1);
  assert.equal(trimMaterials.size, 1);
});

test("form and detail studies preserve the current site and relation graph", () => {
  const base = createExplorerRandomMassingConfig(
    "explorer-base",
    VOXEL_MASSING_PRESETS.towerCourtyard,
    "layout"
  );
  const form = createExplorerRandomMassingConfig("explorer-form", base, "form");
  const detail = createExplorerRandomMassingConfig("explorer-detail", base, "detail");
  const relationShape = (spec) => spec.relations.map(({ type, from, to }) => ({ type, from, to }));

  assert.deepEqual(form.footprint, base.footprint);
  assert.deepEqual(detail.footprint, base.footprint);
  assert.deepEqual(relationShape(form), relationShape(base));
  assert.deepEqual(relationShape(detail), relationShape(base));
  assert.notDeepEqual(
    form.masses.map((mass) => [mass.id, mass.heightVoxels, mass.planShape, mass.cap.type]),
    base.masses.map((mass) => [mass.id, mass.heightVoxels, mass.planShape, mass.cap.type])
  );
  assert.notDeepEqual(
    detail.masses.map((mass) => [mass.id, mass.facade, mass.framing, mass.groundTreatment]),
    base.masses.map((mass) => [mass.id, mass.facade, mass.framing, mass.groundTreatment])
  );
});

test("layout studies preserve lighting while generating a new connected site", () => {
  const layout = createExplorerRandomMassingConfig(
    "layout-lighting",
    { ...VOXEL_MASSING_PRESETS.civicDome, sunTime: 0.23, nightLighting: 0.77 },
    "layout"
  );

  assert.equal(layout.sunTime, 0.23);
  assert.equal(layout.nightLighting, 0.77);
  assert.ok(layout.footprint.cellCount >= 4);
  assert.ok(layout.footprint.cellCount <= 7);
  assert.ok(layout.masses.every((mass) => mass.cells.length >= 1));
});
