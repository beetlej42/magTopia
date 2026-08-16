import assert from "node:assert/strict";
import test from "node:test";
import { deriveGameplayBuilding, getBuildingCategory, getMagicLevel } from "../src/gameplay/building-metadata.js";

function building(overrides = {}) {
  return {
    id: "building-1",
    footprintCells: ["cell-3-3"],
    site: { lotId: "cell-3-3", footprint: "1x1" },
    program: {
      name: "Cottage",
      purpose: "residential",
      intent: { magicLevel: 0.2, prominence: "ordinary" }
    },
    status: "completed",
    ...overrides
  };
}

test("ordinary residential building raises muggle capacity", () => {
  const metadata = deriveGameplayBuilding(building());
  assert.equal(metadata.category, "residential");
  assert.ok(metadata.muggleCapacity > 0);
  assert.ok(metadata.jobs > 0);
});

test("high-magic residential building raises wizard capacity above ordinary magic", () => {
  const ordinary = deriveGameplayBuilding(building());
  const enchanted = deriveGameplayBuilding(building({ id: "building-2", program: { name: "Enchanted Villa", purpose: "residential", intent: { magicLevel: 0.85, prominence: "landmark" } } }));
  assert.ok(enchanted.wizardCapacity > ordinary.wizardCapacity);
  assert.ok(enchanted.magicOutput > ordinary.magicOutput);
  assert.ok(enchanted.magicLevel > ordinary.magicLevel);
});

test("magic level is read from program intent, design intent, or attributes deterministically", () => {
  assert.equal(getMagicLevel(building()), 0.2);
  assert.equal(getMagicLevel(building({ program: { purpose: "residential" }, voxelDesign: { intent: { magicLevel: 0.77 } } })), 0.77);
  assert.equal(getMagicLevel(building({ program: { attributes: { magicLevel: 0.91 } } })), 0.91);
  assert.equal(getMagicLevel(building(), 0.5), 0.2);
  assert.equal(getMagicLevel({ id: "bare" }, 0.42), 0.42);
});

test("category falls back from purpose to frontage to mixed", () => {
  assert.equal(getBuildingCategory(building()), "residential");
  assert.equal(getBuildingCategory(building({ program: { purpose: "market" } })), "commercial");
  assert.equal(getBuildingCategory(building({ program: { intent: { frontage: "institutional" } } })), "civic");
  assert.equal(getBuildingCategory({ id: "unknown", program: { purpose: "wizard den" } }), "mixed");
});

test("footprint area scales capacities and outputs", () => {
  const single = deriveGameplayBuilding(building());
  const twin = deriveGameplayBuilding(building({ footprintCells: ["cell-3-3", "cell-4-3"], site: { lotId: "cell-3-3", footprint: "2x1" } }));
  assert.ok(twin.muggleCapacity >= single.muggleCapacity);
  assert.ok(twin.coinOutput >= single.coinOutput);
});

test("same building spec always produces the same metadata", () => {
  const a = deriveGameplayBuilding(building());
  const b = deriveGameplayBuilding(building());
  assert.deepEqual(a, b);
});
