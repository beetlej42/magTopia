import assert from "node:assert/strict";
import test from "node:test";
import { createOpenApiDocument } from "../apps/server/openapi.js";

test("OpenAPI fully describes Arcane Officer recruitment request, response, candidates, history, growth, and maintenance", () => {
  const document = createOpenApiDocument("http://localhost");
  const schemas = document.components.schemas;
  assert.ok(document.paths["/cities/{city_id}/strategy/recruit-officer"]?.post);
  assert.deepEqual(schemas.OfficerRecruitmentRequest.required.sort(), ["candidate_id", "expected_city_version"]);
  assert.equal(schemas.OfficerRecruitmentRequest.additionalProperties, false);
  assert.equal(schemas.OfficerRecruitmentResponse.properties.officer.$ref, "#/components/schemas/ArcaneOfficer");
  assert.equal(schemas.ArcaneOfficerRecruitment.properties.candidates.items.$ref, "#/components/schemas/ArcaneOfficerCandidate");
  assert.ok(schemas.ArcaneOfficer.properties.history.items.$ref);
  assert.ok(schemas.ArcaneOfficerHistoryEntry.required.includes("growth_chance"));
  assert.ok(schemas.TurnFacts.required.includes("officerMaintenance"));
  assert.ok(schemas.TurnFacts.properties.netResourceDelta);
  assert.ok(schemas.TurnFacts.properties.outcomes.items.properties.growth);
  assert.equal(schemas.StrategyContext.properties.strategy.properties.arcane_officer_recruitment.$ref, "#/components/schemas/ArcaneOfficerRecruitment");
});
