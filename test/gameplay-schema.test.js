import assert from "node:assert/strict";
import test from "node:test";
import {
  GAMEPLAY_GRAMMAR_FIELDS,
  GAMEPLAY_PURPOSES,
  MAGIC_RATIOS,
  normalizeFunctionalUnit,
  normalizeGameplayBuilding,
  normalizeGameplayPurpose,
  normalizeMagicRatio,
  validateGameplayBuilding
} from "../src/gameplay/schema.js";
import { deriveGameplayBuilding } from "../src/gameplay/building-metadata.js";

test("v0.3 exposes exactly five gameplay purposes and five discrete magic ratios", () => {
  assert.deepEqual([...GAMEPLAY_PURPOSES], ["residential", "commercial", "public_service", "production", "greenhouse"]);
  assert.deepEqual([...MAGIC_RATIOS], [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(normalizeGameplayPurpose("PUBLIC_SERVICE"), "public_service");
  assert.equal(normalizeMagicRatio("0.5"), 0.5);
  assert.throws(() => normalizeGameplayPurpose("workshop"), /Unsupported gameplay purpose/);
  assert.throws(() => normalizeMagicRatio(0.63), /magicRatio/);
  assert.throws(() => normalizeMagicRatio(Infinity), /magicRatio/);
});

test("ordinary two-cell three-floor residence includes every vertical functional cell", () => {
  const normalized = normalizeGameplayBuilding({
    id: "cottage-2x3",
    footprintCells: ["a", "b"],
    floorSpecs: [
      { purpose: "residential", magicRatio: 0 },
      { purpose: "residential", magicRatio: 0.25 },
      { purpose: "residential", magicRatio: 0.5 }
    ]
  });
  assert.deepEqual(normalized.units, [
    { purpose: "residential", area: 2, magicRatio: 0 },
    { purpose: "residential", area: 2, magicRatio: 0.25 },
    { purpose: "residential", area: 2, magicRatio: 0.5 }
  ]);
  assert.deepEqual(normalized.functionalAreas, {
    residential: 6,
    commercial: 0,
    public_service: 0,
    production: 0,
    greenhouse: 0
  });
});

test("mixed-use floors normalize to one shared unit representation", () => {
  const normalized = normalizeGameplayBuilding({
    site: { footprint: "2x1" },
    floorPrograms: [
      { purpose: "commercial", magicRatio: 0.25 },
      { purpose: "residential", magicRatio: 0.5 },
      { purpose: "residential", magicRatio: 0.75 }
    ]
  });
  assert.deepEqual(normalized.units, [
    { purpose: "commercial", area: 2, magicRatio: 0.25 },
    { purpose: "residential", area: 2, magicRatio: 0.5 },
    { purpose: "residential", area: 2, magicRatio: 0.75 }
  ]);
  assert.equal(normalized.functionalAreas.commercial, 2);
  assert.equal(normalized.functionalAreas.residential, 4);
});

test("compound public building accepts cell/mass grammar including a greenhouse wing", () => {
  const normalized = normalizeGameplayBuilding({
    purpose: "public_service",
    masses: [
      { id: "archive", purpose: "public_service", cells: [[0, 0], [0, 1]], magicRatio: 0.25 },
      { id: "conservatory", purpose: "greenhouse", cells: [[1, 0]], magicRatio: 1 },
      { id: "courtyard", purpose: "public_service", area: 1, magicRatio: 0 }
    ]
  });
  assert.deepEqual(normalized.units, [
    { purpose: "public_service", area: 2, magicRatio: 0.25 },
    { purpose: "greenhouse", area: 1, magicRatio: 1 },
    { purpose: "public_service", area: 1, magicRatio: 0 }
  ]);
  assert.equal(normalized.functionalAreas.public_service, 3);
  assert.equal(normalized.functionalAreas.greenhouse, 1);
});

test("invalid units are rejected and old category normalization remains separate", () => {
  assert.throws(() => normalizeFunctionalUnit({ purpose: "production", area: 0 }), /positive integer/);
  assert.throws(() => normalizeGameplayBuilding({ purpose: "workshop", area: 1 }), /Unsupported gameplay purpose/);
  assert.throws(() => normalizeGameplayBuilding({ units: [] }), /must not be empty/);
  assert.throws(() => normalizeGameplayBuilding({ functionalUnits: [] }), /must not be empty/);
  assert.throws(() => normalizeGameplayBuilding({ floors: [] }), /must not be empty/);
  assert.throws(() => normalizeGameplayBuilding({ masses: [] }), /must not be empty/);
  assert.equal(normalizeGameplayBuilding({ category: "workshop", magicLevel: 0.63 }).category, "workshop");
  assert.equal(validateGameplayBuilding({ purpose: "production", area: 1, magicRatio: 0.75 }).valid, true);
  assert.equal(validateGameplayBuilding({ purpose: "production", area: 1, magicRatio: 0.7 }).valid, false);
});

test("all grammar fields are detected symmetrically in top-level, grammar, and massing containers", () => {
  for (const container of ["top-level", "grammar", "massing"]) {
    for (const field of GAMEPLAY_GRAMMAR_FIELDS) {
      const value = container === "top-level" ? { [field]: [] } : { [container]: { [field]: [] } };
      assert.throws(
        () => normalizeGameplayBuilding(value),
        /must not be empty/,
        `${container}.${field} should enter canonical validation`
      );
    }
  }
  const grammarFloor = normalizeGameplayBuilding({ grammar: { floorSpecs: [{ purpose: "residential", area: 1 }] } });
  const massingMass = normalizeGameplayBuilding({ massing: { massSpecs: [{ purpose: "greenhouse", area: 1 }] } });
  assert.equal(grammarFloor.units[0].purpose, "residential");
  assert.equal(massingMass.units[0].purpose, "greenhouse");
});

test("nested massing defaults are inherited by units and reflected in the building output", () => {
  const normalized = normalizeGameplayBuilding({
    massing: {
      defaultMagicRatio: 0.5,
      masses: [{ purpose: "greenhouse", area: 1 }]
    }
  });
  assert.equal(normalized.units[0].magicRatio, 0.5);
  assert.equal(normalized.defaultMagicRatio, 0.5);
});

test("metadata adapter exposes canonical units without enabling later economy rules", () => {
  const metadata = deriveGameplayBuilding({
    id: "mixed-house",
    footprintCells: ["a", "b"],
    program: { purpose: "residential" },
    floorSpecs: [
      { purpose: "commercial", magicRatio: 0.25 },
      { purpose: "residential", magicRatio: 0.5 }
    ]
  });
  assert.equal(metadata.canonical, true);
  assert.equal(metadata.functionalAreas.commercial, 2);
  assert.equal(metadata.functionalAreas.residential, 2);
  assert.equal("coinOutput" in metadata, false);
  assert.equal("jobs" in metadata, false);
});

test("metadata detects per-unit canonical floor grammar without a root purpose", () => {
  const metadata = deriveGameplayBuilding({
    floorSpecs: [{ purpose: "commercial", area: 1, magicRatio: 0.25 }]
  });
  assert.equal(metadata.canonical, true);
  assert.deepEqual(metadata.units, [{ purpose: "commercial", area: 1, magicRatio: 0.25 }]);
});

test("top-level canonical grammar takes precedence over unannotated voxel visuals", () => {
  const metadata = deriveGameplayBuilding({
    program: { purpose: "home" },
    floorSpecs: [{ purpose: "commercial", area: 2, magicRatio: 0.25 }],
    voxelDesign: { floorSpecs: [{ purpose: "home", area: 99 }] }
  });
  assert.equal(metadata.canonical, true);
  assert.deepEqual(metadata.units, [{ purpose: "commercial", area: 2, magicRatio: 0.25 }]);
});

test("self-describing canonical units ignore an old program purpose, while missing purpose fails", () => {
  const metadata = deriveGameplayBuilding({
    program: { purpose: "home" },
    floorSpecs: [{ purpose: "residential", area: 1, magicRatio: 0.5 }]
  });
  assert.equal(metadata.canonical, true);
  assert.equal(metadata.units[0].purpose, "residential");
  assert.throws(() => deriveGameplayBuilding({
    program: { purpose: "home" },
    units: [{ area: 1, magicRatio: 0.5 }]
  }), /Unsupported gameplay purpose|requires a purpose/);
});

test("explicit gameplay grammar rejects invalid purposes instead of falling back to legacy metadata", () => {
  assert.throws(() => deriveGameplayBuilding({
    floorSpecs: [{ purpose: "workshop", area: 1, magicRatio: 0.25 }]
  }), /Unsupported gameplay purpose/);
  assert.throws(() => deriveGameplayBuilding({
    gameplay: { units: [{ purpose: "workshop", area: 1 }] }
  }), /Unsupported gameplay purpose/);
  assert.throws(() => deriveGameplayBuilding({
    gameplay: { purpose: "workshop", units: [{ purpose: "residential", area: 1 }] }
  }), /Unsupported gameplay purpose/);
  const visual = deriveGameplayBuilding({
    program: { purpose: "residential" },
    voxelDesign: { floorSpecs: [{ purpose: "home" }] }
  });
  assert.equal(visual.canonical, undefined);
  assert.equal(visual.category, "residential");
});

test("canonical normalization is deterministic for identical input", () => {
  const input = {
    grammar: {
      defaultMagicRatio: 0.25,
      floorSpecs: [
        { purpose: "commercial", area: 2 },
        { purpose: "residential", area: 2, magicRatio: 0.5 }
      ]
    }
  };
  assert.deepEqual(normalizeGameplayBuilding(input), normalizeGameplayBuilding(input));
});

test("metadata rejects empty explicit functional grammar in every supported container", () => {
  for (const container of ["top-level", "grammar", "massing"]) {
    for (const field of ["units", "functionalUnits"]) {
      const value = container === "top-level" ? { [field]: [] } : { [container]: { [field]: [] } };
      assert.throws(() => deriveGameplayBuilding(value), /must not be empty/, `${container}.${field}`);
    }
  }
  assert.throws(() => deriveGameplayBuilding({ voxelDesign: { functionalUnits: [] } }), /must not be empty/);
  for (const container of ["grammar", "massing"]) {
    for (const field of ["floors", "floorSpecs", "floorPrograms", "masses", "massSpecs"]) {
      const value = { [container]: { [field]: [] } };
      assert.throws(() => deriveGameplayBuilding(value), /must not be empty/, `${container}.${field}`);
    }
  }
});
