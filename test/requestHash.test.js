import assert from "node:assert/strict";
import test from "node:test";
import { hashRequest } from "../apps/server/ids.js";

test("voxel construction request hash ignores server runtime metadata", () => {
  const confirmed = {
    expected_city_version: 12,
    design_id: "design_1",
    design_revision: 3,
    design_hash: "spec_hash_1",
    voxel_design: {
      id: "design_1",
      revision: 3,
      specHash: "spec_hash_1",
      status: "confirmed",
      buildingId: null,
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:01:00.000Z",
      generation: { sourceSpec: { floors: 3, roof: "gable" } }
    }
  };
  const built = structuredClone(confirmed);
  built.voxel_design.status = "built";
  built.voxel_design.buildingId = "building_1";
  built.voxel_design.updatedAt = "2026-08-15T10:02:00.000Z";

  assert.equal(hashRequest(built), hashRequest(confirmed));
});

test("voxel construction request hash still changes for design content", () => {
  const first = {
    design_id: "design_1",
    design_revision: 3,
    design_hash: "spec_hash_1",
    voxel_design: {
      status: "confirmed",
      generation: { sourceSpec: { floors: 3, roof: "gable" } }
    }
  };
  const changed = structuredClone(first);
  changed.voxel_design.generation.sourceSpec.floors = 4;

  assert.notEqual(hashRequest(changed), hashRequest(first));
});
