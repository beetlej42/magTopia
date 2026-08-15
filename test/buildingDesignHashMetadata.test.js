import assert from "node:assert/strict";
import test from "node:test";
import { confirmBuildingDesign, createBuildingDesignDraft } from "../src/city/building-design.js";

test("building design spec hash ignores repository lifecycle metadata", () => {
  const draft = createBuildingDesignDraft({
    site: { lot_id: "cell-4-4", footprint: "1x1", entrance: "south" },
    intent: {
      name: "Hash Stable Cottage",
      purpose: "residential",
      frontage: "residential",
      style: "victorian_domestic"
    },
    requirements: { preferred_floors: 1 }
  }, {
    id: "design_hash_stable",
    seed: "hash-stable-seed",
    actor: "player:test"
  });

  const repositoryResponse = {
    ...structuredClone(draft),
    cityId: "city_1",
    buildingId: null,
    confirmedRevision: null,
    createdAt: new Date("2026-08-15T12:00:00.000Z"),
    updatedAt: new Date("2026-08-15T12:01:00.000Z")
  };

  const confirmed = confirmBuildingDesign(repositoryResponse, {
    expected_revision: draft.revision
  }, {
    now: () => "2026-08-15T12:02:00.000Z"
  });

  assert.equal(confirmed.specHash, draft.specHash);
});
