import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createServiceWorldContract } from "../apps/server/world.js";
import { createOpenApiDocument } from "../apps/server/openapi.js";
import { deriveBootstrapProgress, isBootstrapTurn } from "../src/gameplay/bootstrap.js";
import { resolveTurn } from "../src/gameplay/simulation.js";

function city() {
  return createCityState(createServiceWorldContract({ seed: "bootstrap-unit", columns: 20, rows: 20 }), {
    cityId: "bootstrap-unit",
    mapSeed: "bootstrap-unit"
  });
}

test("turn number is authoritative for bootstrap even when persisted turnKind is stale", () => {
  const state = city();
  assert.equal(isBootstrapTurn({ ...state, turn: 0, gameplay: { ...state.gameplay, turnKind: "normal" } }), true);
  assert.equal(isBootstrapTurn({ ...state, turn: 1, gameplay: { ...state.gameplay, turnKind: "bootstrap" } }), false);
});

test("bootstrap progress uses live roads and canonical active building purposes", () => {
  const state = city();
  const gateway = state.nodes.old_town_entry;
  const gatewayCell = state.cells[gateway.cellId];
  const roadCell = Object.values(state.cells).find((cell) =>
    Math.abs(Number(cell.column) - Number(gatewayCell.column)) + Math.abs(Number(cell.row) - Number(gatewayCell.row)) === 1);
  state.events.push({ type: "road_connected", turn: 0, from: { kind: "node", id: "old_town_entry" } });
  assert.equal(deriveBootstrapProgress(state).gatewayConnected, false, "a historical event cannot replace the live road graph");
  roadCell.infrastructure = "road";

  state.buildings.home = { id: "home", status: "completed", gameplay: { units: [{ purpose: "residential" }] }, program: { purpose: "commercial" } };
  state.buildings.shop = { id: "shop", status: "inactive", gameplay: { units: [{ purpose: "commercial" }] } };
  state.events.push(
    { type: "construction_reserved", turn: 0, proposalId: "proposal-only", reservationId: "reservation-only" },
    { type: "building_constructed", turn: 0, buildingId: "home" }
  );
  const progress = deriveBootstrapProgress(state);
  assert.equal(progress.gatewayConnected, true);
  assert.equal(progress.gatewayNodeId, "old_town_entry");
  assert.equal(progress.gatewayCellId, gateway.cellId);
  assert.deepEqual({ column: progress.gatewayLocation.column, row: progress.gatewayLocation.row }, { column: gatewayCell.column, row: gatewayCell.row });
  assert.equal(progress.readyForMeaningfulFirstResolve, false);
  assert.deepEqual(progress.missingRecommendedMilestones, ["income"]);
  assert.deepEqual(progress.residentialBuildings, ["home"], "canonical units take precedence over legacy text");
  assert.deepEqual(progress.commercialBuildings, [], "inactive buildings do not satisfy a milestone");
  assert.deepEqual(progress.buildingsStarted, ["home", "shop"], "an inactive building may still be an authoritative started build");
  assert.deepEqual(progress.buildingsCompleted, ["home"]);
  assert.equal(progress.buildingsStarted.includes("proposal-only"), false);
  assert.equal(progress.buildingsStarted.includes("reservation-only"), false);
});

test("construction facts ignore client claims and keep building and reservation identities separate", () => {
  const state = city();
  state.gameplay.turnOpenedAt = "2000-01-01T00:00:00.000Z";
  state.gameplay.nextTurnUnlockAt = "2000-01-01T00:00:00.000Z";
  state.buildings["building-real"] = { id: "building-real", status: "completed", program: { purpose: "residential" } };
  state.events.push(
    { type: "construction_reserved", turn: 0, reservationId: "reservation-1", proposalId: "proposal-1" },
    { type: "construction_reservation_completed", turn: 0, reservationId: "reservation-1", buildingId: "building-real" },
    { type: "construction_reservation_completed", turn: 0, reservationId: "reservation-1", buildingId: "building-real" }
  );

  const result = resolveTurn(state, {
    expectedTurn: 0,
    assignments: [],
    buildingsStarted: ["forged-start"],
    buildingsCompleted: ["forged-complete"]
  }, {
    seed: 1,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    options: { turnCooldownMs: 1, settlementSource: "agent" }
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.facts.buildingsStarted, ["building-real"]);
  assert.deepEqual(result.facts.buildingsCompleted, ["building-real"]);
  assert.deepEqual(result.facts.buildingFactRefs, ["fact-building-building-real"]);
  assert.equal(result.facts.buildingFactRefs.some((ref) => ref.includes("reservation-1") || ref.includes("proposal-1")), false);
  assert.ok(result.facts.constructionRefs.some((entry) => entry.reservationId === "reservation-1"));
  assert.equal(result.facts.constructionRefs.every((entry, index, values) => index === 0 || values[index - 1].factRef <= entry.factRef), true);
  assert.equal(result.facts.buildingsStarted.includes("forged-start"), false);
  assert.equal(result.facts.buildingsCompleted.includes("forged-complete"), false);
});

test("OpenAPI requires the bootstrap and construction audit fields it serves", () => {
  const schemas = createOpenApiDocument("http://127.0.0.1:4183").components.schemas;
  for (const field of ["turnKind", "bootstrapProgress", "buildingsStarted", "buildingsCompleted", "buildingFactRefs", "constructionRefs"]) {
    assert.ok(schemas.TurnFacts.required.includes(field));
  }
  for (const field of ["turnKind", "bootstrapProgress", "buildingFactRefs", "constructionRefs"]) {
    assert.ok(schemas.ReportContext.required.includes(field));
  }
  assert.deepEqual(schemas.TurnFacts.properties.constructionRefs.items.properties.kind.enum, ["reservation", "completion"]);
  assert.ok(schemas.StrategyContext.required.includes("bootstrap"));
  assert.ok(schemas.CityDayPresentation.required.includes("bootstrap"));
});
