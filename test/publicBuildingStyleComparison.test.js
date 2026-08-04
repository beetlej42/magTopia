import assert from "node:assert/strict";
import test from "node:test";
import { adaptBuildingIntentToMassingConfig, getBuildingIntentCatalog } from "../src/generators/buildingIntent.js";
import {
  PUBLIC_BUILDING_STYLE_IDS,
  createPublicBuildingStyleComparison,
  createPublicBuildingStylePreset
} from "../src/generators/publicBuildingStyleComparison.js";
import { createUrbanMassingSpec } from "../src/generators/voxelMassingGrammar.js";

test("five public-building style grammars expose distinct silhouette, facade, and material signatures", () => {
  const specs = Object.fromEntries(PUBLIC_BUILDING_STYLE_IDS.map((style) => [
    style,
    createUrbanMassingSpec(createPublicBuildingStylePreset(style))
  ]));

  assert.ok(specs.civic_classical.masses.some((mass) => mass.cap.type === "dome" && mass.materials.roof === "gildedMetal"));
  assert.ok(specs.civic_classical.masses.some((mass) => mass.type === "open" && mass.enclosure.sides.south === "columns"));

  assert.ok(specs.industrial_iron.masses.some((mass) => mass.cap.type === "sawtooth"));
  assert.ok(specs.industrial_iron.masses.filter((mass) => mass.id.includes("stack")).length >= 2);
  assert.ok(specs.industrial_iron.masses.some((mass) => mass.facade.order === "industrial" && mass.materials.trim === "iron"));

  assert.ok(specs.victorian_gothic.masses.some((mass) => mass.cap.type === "spire"));
  assert.ok(specs.victorian_gothic.masses.some((mass) => mass.facade.order === "gothic" && mass.materials.window === "violetMagic"));

  assert.ok(specs.alchemical_glass.masses.some((mass) => mass.type === "framed" && mass.materials.panel === "tealGlass"));
  assert.ok(specs.alchemical_glass.masses.some((mass) => mass.cap.type === "glass_barrel"));

  assert.ok(specs.victorian_domestic.masses.filter((mass) => mass.type === "solid").length >= 3);
  assert.ok(specs.victorian_domestic.masses.every((mass) => !["dome", "spire", "sawtooth"].includes(mass.cap.type)));

  const signatures = Object.values(specs).map((spec) => JSON.stringify({
    caps: [...new Set(spec.masses.map((mass) => mass.cap.type))].sort(),
    orders: [...new Set(spec.masses.map((mass) => mass.facade.order))].sort(),
    materials: [...new Set(spec.masses.flatMap((mass) => Object.values(mass.materials)))].sort()
  }));
  assert.equal(new Set(signatures).size, PUBLIC_BUILDING_STYLE_IDS.length);
});

test("style comparison compiles all five studies into one deterministic row", () => {
  const comparison = createPublicBuildingStyleComparison({ showLabels: 0, seed: "style-test" });
  const diagnostics = comparison.userData.getVoxelDiagnostics();
  assert.equal(diagnostics.entries.length, 5);
  assert.deepEqual(diagnostics.entries.map((entry) => entry.style), PUBLIC_BUILDING_STYLE_IDS);
  assert.ok(diagnostics.entries.every((entry) => entry.massCount >= 4));
  assert.equal(new Set(diagnostics.entries.map((entry) => entry.positionX)).size, 5);
  assert.ok(diagnostics.entries.find((entry) => entry.style === "industrial_iron").materialCounts.iron > 1_000);
  assert.ok(diagnostics.entries.find((entry) => entry.style === "alchemical_glass").materialCounts.tealGlass > 1_000);
});

test("agent massing adapter routes style intent into the matching grammar instead of one classical campus", () => {
  const industrial = createUrbanMassingSpec(adaptBuildingIntentToMassingConfig({
    name: "Cinder Works",
    purpose: "magical machinery factory",
    composition: "yard",
    frontage: "large_bay",
    access: "service",
    style: "industrial_iron",
    prominence: "important"
  }, { widthCells: 3, depthCells: 2 }));
  const alchemical = createUrbanMassingSpec(adaptBuildingIntentToMassingConfig({
    name: "Verdigris Institute",
    purpose: "potion research institute",
    composition: "hall",
    frontage: "institutional",
    access: "public",
    style: "alchemical_glass",
    prominence: "important"
  }, { widthCells: 3, depthCells: 2 }));

  assert.ok(industrial.masses.some((mass) => mass.cap.type === "sawtooth"));
  assert.ok(industrial.masses.some((mass) => mass.id === "main-stack"));
  assert.ok(alchemical.masses.some((mass) => mass.id === "great-glasshouse"));
  assert.ok(getBuildingIntentCatalog().style.includes("alchemical_glass"));
});
