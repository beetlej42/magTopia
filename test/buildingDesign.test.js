import assert from "node:assert/strict";
import test from "node:test";
import {
  buildingDesignToConstructionBody,
  BUILDING_DECORATION_TYPES,
  confirmBuildingDesign,
  createBuildingDesignDraft,
  createBuildingUpgradeDraft,
  recommendGenerationMode,
  reviseBuildingDesign
} from "../src/city/building-design.js";
import { createVoxelBuildingFromSpec } from "../src/generators/voxelBuildingLab.js";
import { createMagicLondonStarterDistrict } from "../src/generators/magicLondonStarterDistrict.js";

const context = {
  id: "design-test",
  seed: "design-seed",
  actor: "agent:test",
  now: () => "2026-08-02T00:00:00.000Z"
};

test("building design recommends floor-stack and exposes a shared editable envelope", () => {
  const design = createBuildingDesignDraft({
    site: { anchor_cell_id: "cell-10-10", entrance: "south" },
    intent: { name: "Moon & Needle", purpose: "enchanted clothing shop", frontage: "display", magic_level: 0.6 },
    requirements: { preferred_floors: 2 }
  }, context);
  assert.equal(design.generation.mode, "floor_stack");
  assert.equal(design.generation.sourceSpec.floors, 2);
  assert.equal(design.site.footprint, "1x1");
  assert.equal(design.site.lotId, "cell-10-10");
  assert.ok(design.availableOperations.common.includes("add_decoration"));
  assert.ok(BUILDING_DECORATION_TYPES.includes("semantic_grid_sign"));
  assert.deepEqual(design.availableOperations.semanticGridSign.materials.emissive, ["tealMagic", "violetMagic", "warmWindow"]);
  assert.ok(design.availableOperations.anchorPatterns.includes("main/floor-{index}/facade-{direction}/entrance"));
  assert.ok(design.availableOperations.modeSpecific.includes("set_floor_program"));
  assert.equal(design.agentGuidance[0].code, "custom_shop_sign_recommended");
  assert.equal(design.agentGuidance[0].blocking, false);
  assert.match(design.specHash, /^fnv1a:/);
});

test("institutional and multi-cell designs use the urban massing strategy", () => {
  assert.equal(recommendGenerationMode({ composition: "hall" }), "urban_massing");
  const design = createBuildingDesignDraft({
    site: { lot_id: "cell-5-5", footprint: "3x2", entrance: "south" },
    intent: { name: "Moon School", purpose: "public school", frontage: "institutional", access: "public", prominence: "important" }
  }, { ...context, id: "design-massing" });
  assert.equal(design.generation.mode, "urban_massing");
  assert.deepEqual([design.generation.sourceSpec.footprint.widthCells, design.generation.sourceSpec.footprint.depthCells], [3, 2]);
  assert.ok(design.availableOperations.modeSpecific.includes("add_mass"));
});

test("public designs choose seed-stable functional variants and expose an architecture review", () => {
  const input = {
    site: { lot_id: "cell-5-5", footprint: "3x2", entrance: "south" },
    intent: { name: "North Archive", purpose: "public library and reading rooms", frontage: "institutional", access: "public", prominence: "important" }
  };
  const variants = ["a", "b", "c", "d"].map((seed) => createBuildingDesignDraft({ ...input, seed }, { ...context, id: `design-${seed}` }));
  assert.ok(new Set(variants.map((design) => design.generation.sourceSpec.metadata.variantId)).size > 1);
  assert.ok(variants.every((design) => design.actualArchitecture?.features?.publicEntrance));
  assert.ok(variants.every((design) => design.architectureReview?.program === "library"));
  assert.ok(variants.every((design) => design.agentGuidance.some((guidance) => guidance.code === "public_architecture_review_required")));
});

test("public architecture review reports an intentional library greenhouse conflict", () => {
  const design = createBuildingDesignDraft({
    site: { lot_id: "cell-5-5", footprint: "3x2", entrance: "south" },
    intent: { name: "Botanical Archive", purpose: "library", frontage: "institutional", access: "public", prominence: "important", style: "alchemical_glass" },
    seed: "library-glass-review"
  }, { ...context, id: "library-glass-review" });
  assert.equal(design.actualArchitecture.features.greenhouse, true);
  assert.ok(design.architectureReview.conflicts.some((conflict) => conflict.code === "unexpected_greenhouse"));
});

test("greenhouse programs receive a framed glass volume under the default public style", () => {
  const design = createBuildingDesignDraft({
    site: { lot_id: "cell-5-6", footprint: "3x2", entrance: "south" },
    intent: { name: "Moon Conservatory", purpose: "public greenhouse", frontage: "institutional", access: "public", prominence: "important" },
    seed: "default-greenhouse"
  }, { ...context, id: "default-greenhouse" });
  assert.equal(design.actualArchitecture.features.greenhouse, true);
  assert.equal(design.architectureReview.conflicts.length, 0);
});

test("residential designs receive district alignment guidance and can regenerate from revised intent", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-6-6", entrance: "south" },
    district_context: {
      id: "district-lantern",
      style: "riverside_victorian",
      preserve: ["brick_material", "two_floor_height"],
      vary: ["corner_condition"]
    },
    intent: { name: "Lantern Corner House", purpose: "residential", frontage: "residential", variation_intent: "narrow_corner_house" }
  }, { ...context, id: "residential-guidance" });
  assert.equal(draft.districtContext.style, "riverside_victorian");
  assert.equal(draft.agentGuidance[0].code, "district_architecture_alignment");
  const revised = reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{
      op: "regenerate_from_intent",
      intent: { purpose: "public library", frontage: "institutional", access: "public", prominence: "important" }
    }]
  }, context);
  assert.equal(revised.generation.mode, "urban_massing");
  assert.equal(revised.architectureReview.program, "library");
  assert.deepEqual(revised.decorations.items, []);
});

test("parcel-fitted recommendations compile formerly invalid 2x2 halls and rotated 3x2 sites", () => {
  const compactHall = createBuildingDesignDraft({
    site: { lot_id: "cell-8-8", footprint: "2x2", entrance: "south" },
    intent: { name: "Glass Guild", purpose: "guild hall", composition: "hall", frontage: "large_bay", prominence: "ordinary" }
  }, { ...context, id: "compact-hall" });
  const compactConfirmed = confirmBuildingDesign(compactHall, { expected_revision: 1 }, context);
  assert.equal(compactConfirmed.compileDiagnostics.status, "compiled");
  assert.ok(compactConfirmed.compileDiagnostics.occupiedVoxels > 0);

  const rotated = createBuildingDesignDraft({
    site: { lot_id: "cell-12-12", footprint: "3x2", entrance: "east" },
    intent: { name: "East Market", purpose: "market hall", composition: "hall", frontage: "large_bay", prominence: "important" }
  }, { ...context, id: "rotated-hall" });
  const rotatedConfirmed = confirmBuildingDesign(rotated, { expected_revision: 1 }, context);
  assert.deepEqual(
    [rotatedConfirmed.generation.sourceSpec.footprint.widthCells, rotatedConfirmed.generation.sourceSpec.footprint.depthCells],
    [2, 3]
  );
  assert.equal(rotatedConfirmed.compileDiagnostics.coordinateTransform.sourceDimensionsSwapped, true);
  assert.equal(rotatedConfirmed.compileDiagnostics.primaryEntrancePort.face, "east");
  assert.equal(rotatedConfirmed.compileDiagnostics.primaryEntrancePort.frontageCellId, "cell-15-12");
});

test("design revisions preserve stable lower floors and add semantic decorations", () => {
  const initial = createBuildingDesignDraft({
    site: { lot_id: "cell-10-10" },
    intent: { name: "Moon Shop", purpose: "shop", frontage: "display" },
    requirements: { preferred_floors: 1 }
  }, context);
  const lower = structuredClone(initial.generation.sourceSpec.floorSpecs[0]);
  const revised = reviseBuildingDesign(initial, {
    expected_revision: 1,
    operations: [
      { op: "add_floor", count: 1 },
      { op: "add_decoration", decoration: { id: "shop-sign", type: "hanging_sign", anchor: "main/floor-0/facade-south/bay-1", parameters: { glow: 0.2 } } }
    ]
  }, context);
  assert.equal(revised.revision, 2);
  assert.equal(revised.generation.sourceSpec.floors, 2);
  assert.deepEqual(revised.generation.sourceSpec.floorSpecs[0], lower);
  assert.equal(revised.decorations.items[0].id, "shop-sign");
  assert.notEqual(revised.specHash, initial.specHash);
});

test("confirmed designs produce an exact voxel construction envelope", () => {
  const initial = createBuildingDesignDraft({
    site: { lot_id: "cell-10-10", entrance: "east" },
    intent: { name: "Clock House", purpose: "clock repair workshop", frontage: "workshop" }
  }, context);
  const confirmed = confirmBuildingDesign(initial, { expected_revision: 1 }, context);
  assert.equal(confirmed.specHash, initial.specHash);
  const body = buildingDesignToConstructionBody(confirmed, { expected_city_version: 7 });
  assert.equal(body.asset.mode, "voxel");
  assert.equal(body.design_id, confirmed.id);
  assert.equal(body.design_hash, confirmed.specHash);
  assert.equal(body.site.entrance, "east");
  assert.equal(body.voxel_design.generation.mode, "floor_stack");
});

test("an explicit gameplay profile creates system-owned wizard housing semantics", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-11-10", entrance: "east" },
    intent: { name: "Veiled Wizard Row", purpose: "residential", frontage: "residential", magic_level: 0.2 },
    gameplay_profile: { purpose: "residential", magic_ratio: 0.5 },
    requirements: { preferred_floors: 2 }
  }, { ...context, id: "wizard-housing-design" });
  assert.deepEqual(draft.gameplayProfile, { purpose: "residential", magicRatio: 0.5 });
  const confirmed = confirmBuildingDesign(draft, { expected_revision: 1 }, context);
  const body = buildingDesignToConstructionBody(confirmed, { expected_city_version: 11 });
  assert.deepEqual(body.gameplay_building, {
    floors: [
      { purpose: "residential", magicRatio: 0.5 },
      { purpose: "residential", magicRatio: 0.5 }
    ]
  });
});

test("gameplay profiles reject ambiguous purpose and non-discrete magic ratios", () => {
  const base = {
    site: { lot_id: "cell-11-11" },
    intent: { name: "Test House", purpose: "residential" }
  };
  assert.throws(() => createBuildingDesignDraft({
    ...base,
    gameplay_profile: { purpose: "wizard_house", magic_ratio: 0.5 }
  }, context), /gameplay_profile\.purpose/);
  assert.throws(() => createBuildingDesignDraft({
    ...base,
    gameplay_profile: { purpose: "residential", magic_ratio: 0.63 }
  }, context), /gameplay_profile\.magic_ratio/);
});

test("upgrade drafts reuse the same framework and translate add-floor by mode", () => {
  const initial = createBuildingDesignDraft({
    site: { lot_id: "cell-10-10" },
    intent: { name: "Tea House", purpose: "tea shop", frontage: "display" },
    requirements: { preferred_floors: 1 }
  }, context);
  const confirmed = confirmBuildingDesign(initial, { expected_revision: 1 }, context);
  const upgrade = createBuildingUpgradeDraft({ id: "building-1", voxelDesign: confirmed }, {
    goal: { type: "add_floors", count: 1 }
  }, { ...context, id: "upgrade-1" });
  assert.equal(upgrade.source.kind, "upgrade");
  assert.equal(upgrade.source.buildingId, "building-1");
  assert.equal(upgrade.revision, 1);
  assert.equal(upgrade.generation.sourceSpec.floors, 2);
});

test("floor-stack rejects multi-cell sites instead of silently overflowing its parcel", () => {
  assert.throws(() => createBuildingDesignDraft({
    generation_mode: "floor_stack",
    site: { lot_id: "cell-1-1", footprint: "2x1" },
    intent: { purpose: "wide shop" }
  }, context), /requires a 1x1/);
});

test("a confirmed floor-stack spec and its common decorations compile into runtime geometry", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-2-2" },
    intent: { name: "Sign Shop", purpose: "sign shop", frontage: "display" },
    requirements: { preferred_floors: 1 }
  }, context);
  const revised = reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{ op: "add_decoration", decoration: { id: "sign", type: "hanging_sign", anchor: "main/floor-0/facade-south/bay-1" } }]
  }, context);
  const object = createVoxelBuildingFromSpec(revised.generation.sourceSpec, { decorations: revised.decorations, renderStrategy: "greedy" });
  assert.equal(object.userData.contract.mode, "floor_stack");
  assert.equal(object.userData.diagnostics.decorationCount, 1);
  assert.ok(object.getObjectByName("DesignDecoration-sign"));
  assert.ok(object.userData.diagnostics.occupiedVoxels > 0);
});

test("agents can author a validated 4x4 semantic grid shop sign from existing materials", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-3-3" },
    intent: { name: "Moon Tonic", purpose: "potion shop", frontage: "display" },
    requirements: { preferred_floors: 1 }
  }, { ...context, id: "semantic-sign-design" });
  const revised = reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{
      op: "add_decoration",
      decoration: {
        id: "potion-sign",
        type: "semantic_grid_sign",
        anchor: "main/floor-0/facade-south/entrance",
        parameters: {
          grid: [".##.", ".##.", "#..#", "####"],
          frame_material: "patinaMetal",
          board_material: "slate",
          emissive_material: "tealMagic",
          frame_style: "crowned",
          micro_voxel_size: 0.05
        }
      }
    }]
  }, context);
  const sign = revised.decorations.items[0];
  assert.deepEqual(revised.agentGuidance, []);
  assert.deepEqual(sign.parameters.grid, ["0110", "0110", "1001", "1111"]);
  assert.equal(sign.parameters.frameMaterial, "patinaMetal");
  assert.equal(sign.parameters.emissiveMaterial, "tealMagic");
  assert.equal(sign.parameters.mount, "projecting");
  assert.equal(sign.parameters.microVoxelSize, 0.0625);
  assert.equal(sign.parameters.scale, 1);
  const object = createVoxelBuildingFromSpec(revised.generation.sourceSpec, { decorations: revised.decorations, renderStrategy: "greedy", nightLighting: 0.8 });
  const rendered = object.getObjectByName("DesignDecoration-potion-sign");
  assert.ok(rendered);
  assert.equal(rendered.userData.semanticGridSign.label, "");
  assert.equal(rendered.userData.semanticGridSign.frameStyle, "crowned");
  assert.equal(rendered.userData.semanticGridSign.buildingVoxelRatio, 0.5);
  assert.equal(rendered.userData.semanticGridSign.placement, "entrance-side-lintel-clear");
  assert.equal(rendered.userData.semanticGridSign.lintelClearanceVoxels, 1);
  assert.ok(object.getObjectByName("SemanticGridSign-potion-sign"));
  assert.throws(() => reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{
      op: "add_decoration",
      decoration: {
        id: "bad-grid",
        type: "semantic_grid_sign",
        anchor: "main/floor-0/facade-south/entrance",
        parameters: { grid: ["1111"], emissiveMaterial: "tealMagic" }
      }
    }]
  }, context), /four 4-cell rows/);
});

test("construction keeps a non-blocking custom shop sign reminder until the agent adds one", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-4-4", entrance: "south" },
    intent: { name: "Star Brooms", purpose: "flying broom shop", frontage: "display", access: "public" },
    requirements: { preferred_floors: 1 }
  }, { ...context, id: "shop-sign-guidance" });
  const confirmedWithoutSign = confirmBuildingDesign(draft, { expected_revision: 1 }, context);
  const constructionBody = buildingDesignToConstructionBody(confirmedWithoutSign);
  assert.equal(constructionBody.agent_guidance[0].code, "custom_shop_sign_recommended");
  assert.equal(constructionBody.agent_guidance[0].phase, "design_before_construction");
  assert.equal(constructionBody.agent_guidance[0].suggestedAction.decorationType, "semantic_grid_sign");

  const revised = reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{
      op: "add_decoration",
      decoration: {
        id: "broom-sign",
        type: "semantic_grid_sign",
        anchor: "main/floor-0/facade-south/entrance",
        parameters: {
          grid: ["1000", "0111", "0110", "0100"],
          frameMaterial: "iron",
          boardMaterial: "timber",
          emissiveMaterial: "warmWindow",
          frameStyle: "riveted"
        }
      }
    }]
  }, context);
  assert.deepEqual(revised.agentGuidance, []);
  const confirmedWithSign = confirmBuildingDesign(revised, { expected_revision: 2 }, context);
  assert.deepEqual(buildingDesignToConstructionBody(confirmedWithSign).agent_guidance, []);
});

test("decoration anchors and design locks are enforced before a revision is saved", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-2-2" },
    intent: { purpose: "locked cottage" },
    locks: ["roof"]
  }, context);
  assert.throws(() => reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{ op: "set_roof", roof: { form: "hip" } }]
  }, context), /roof design lock/);
  assert.throws(() => reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{ op: "add_decoration", decoration: { id: "bad", type: "facade_lamp", anchor: "main/floor-99/facade-south/bay-0" } }]
  }, context), /invalid floor anchor/);
  assert.throws(() => reviseBuildingDesign(draft, {
    expected_revision: 1,
    operations: [{ op: "add_decoration", decoration: { id: "unknown", type: "flying_dragon", anchor: "main/roof" } }]
  }, context), /Unsupported decoration type/);
});

test("building design rejects unsupported intent enums instead of silently changing Agent input", () => {
  assert.throws(() => createBuildingDesignDraft({
    site: { lot_id: "cell-2-2" },
    intent: { purpose: "apothecary", style: "willow_magic" }
  }, context), /Unsupported building intent style/);
});

test("the city viewer renders built voxel designs without requiring a raster asset", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-0-0", entrance: "south" },
    intent: { name: "Voxel House", purpose: "home" },
    requirements: { preferred_floors: 1 }
  }, context);
  const confirmed = confirmBuildingDesign(draft, { expected_revision: 1 }, context);
  const cityState = {
    cells: { "cell-0-0": { id: "cell-0-0", column: 0, row: 0, infrastructure: null } },
    buildings: {
      "building-1": {
        id: "building-1",
        site: { lotId: "cell-0-0", footprint: "1x1", entrance: "south" },
        program: { name: "Voxel House" },
        footprintCells: ["cell-0-0"],
        voxelDesign: confirmed
      }
    }
  };
  const district = createMagicLondonStarterDistrict({
    grid: { cellWorldSize: 4, cells: [{ id: "cell-0-0", column: 0, row: 0, center: { x: 0, z: 0 } }] },
    sampleGroundHeight: () => 0,
    cityState
  });
  assert.equal(district.userData.contract.skipped.length, 0);
  assert.equal(district.userData.contract.placements[0].representation, "voxel-floor_stack");
  assert.ok(district.getObjectByName("RuntimeVoxelBuilding-building-1"));
});
