import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConstructionProposal } from "../src/city/contracts.js";
import { calculateBuildingConstructionCost } from "../src/gameplay/construction-cost.js";

function proposal(overrides = {}) {
  return {
    site: { lotId: "cell-10-10", footprint: "1x1", entrance: "south" },
    program: { archetype: "voxel_floor_stack", purpose: "residential", name: "Test House", attributes: {} },
    design: { prompt: "test building" },
    voxelDesign: {
      intent: { purpose: "residential", magicLevel: 0 },
      generation: {
        mode: "floor_stack",
        sourceSpec: {
          floors: 2,
          floorSpecs: [
            { purpose: "home" },
            { purpose: "home" }
          ]
        }
      },
      ports: []
    },
    ...overrides
  };
}

test("voxel construction ignores Agent-supplied functional area and prices from confirmed design floors", () => {
  const normalized = normalizeConstructionProposal(proposal({
    gameplayBuilding: {
      units: [{ purpose: "residential", area: 48, magicRatio: 0 }]
    }
  }));

  assert.deepEqual(normalized.gameplayBuilding, {
    floors: [
      { purpose: "residential", magicRatio: 0 },
      { purpose: "residential", magicRatio: 0 }
    ]
  });
  assert.equal(Object.hasOwn(normalized.gameplayBuilding.floors[0], "area"), false);

  const cost = calculateBuildingConstructionCost(normalized);
  assert.equal(cost.heightFloors, 2);
  assert.equal(cost.coins, 105);
});

test("mixed-use floor purposes derive one full footprint of gameplay area per floor", () => {
  const normalized = normalizeConstructionProposal(proposal({
    voxelDesign: {
      intent: { purpose: "residential", magicLevel: 0 },
      generation: {
        mode: "floor_stack",
        sourceSpec: {
          floors: 2,
          floorSpecs: [
            { purpose: "shop" },
            { purpose: "home" }
          ]
        }
      },
      ports: []
    }
  }));

  assert.deepEqual(normalized.gameplayBuilding.floors.map((floor) => floor.purpose), ["commercial", "residential"]);
  const cost = calculateBuildingConstructionCost(normalized);
  assert.equal(cost.heightPricingApplied, false);
  assert.equal(cost.coins, 110);
  assert.deepEqual(cost.functionalAreas, {
    residential: 1,
    commercial: 1,
    public_service: 0,
    production: 0,
    greenhouse: 0
  });
});

test("urban massing derives floor count and area from voxel geometry rather than submitted area", () => {
  const normalized = normalizeConstructionProposal(proposal({
    site: { lotId: "cell-10-10", footprint: "2x2", entrance: "south" },
    program: { archetype: "voxel_urban_massing", purpose: "library", name: "Library", attributes: {} },
    gameplayBuilding: {
      units: [{ purpose: "public_service", area: 99, magicRatio: 0 }]
    },
    voxelDesign: {
      intent: { purpose: "library", magicLevel: 0 },
      generation: {
        mode: "urban_massing",
        sourceSpec: {
          masses: [
            { id: "primary", type: "solid", baseYVoxels: 0, heightVoxels: 40 }
          ]
        }
      },
      ports: []
    }
  }));

  assert.equal(normalized.gameplayBuilding.floors.length, 2);
  assert.ok(normalized.gameplayBuilding.floors.every((floor) => floor.purpose === "public_service"));
  const cost = calculateBuildingConstructionCost(normalized);
  assert.equal(cost.coins, 560);
  assert.equal(cost.functionalAreas.public_service, 8);
});
