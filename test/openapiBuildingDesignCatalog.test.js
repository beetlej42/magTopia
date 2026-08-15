import assert from "node:assert/strict";
import test from "node:test";
import { createOpenApiDocument } from "../apps/server/openapi.js";

test("OpenAPI exposes an agent-readable building design catalog", () => {
  const document = createOpenApiDocument("https://example.test");
  const intent = document.components.schemas.BuildingIntent;
  const catalog = intent["x-agent-catalog"];

  assert.ok(catalog);
  assert.deepEqual(catalog.decisionOrder.slice(0, 6), [
    "purpose",
    "composition",
    "frontage",
    "access",
    "style",
    "prominence"
  ]);

  assert.equal(catalog.composition.court.effects.includes("Selects urban_massing in auto mode."), true);
  assert.equal(catalog.frontage.display.groundProgram, "shop");
  assert.equal(catalog.frontage.display.approximateGroundWindowRatio, 0.86);
  assert.equal(catalog.frontage.workshop.approximateGroundWindowRatio, 0.58);
  assert.deepEqual(catalog.prominence.landmark.defaultSiteCells, [5, 3]);
  assert.equal(catalog.prominence.landmark.floorStackDefaultFloors, 4);
  assert.equal(catalog.magicLevel.effects.nightLighting, "default = magic_level * 0.18");
  assert.match(catalog.style.industrial_iron.meaning, /industrial/i);
  assert.match(catalog.residentialGuidance, /district_context/);
  assert.match(catalog.publicBuildingReview, /actualArchitecture/);
});

test("OpenAPI decoration catalog matches the runtime semantic grid sign support", () => {
  const document = createOpenApiDocument("https://example.test");
  const decorationTypes = document.components.schemas.Decoration.properties.type.enum;

  assert.ok(decorationTypes.includes("semantic_grid_sign"));
  assert.match(
    document.components.schemas.BuildingDesignCreateRequest.properties.generation_mode.description,
    /Prefer auto/
  );
});
