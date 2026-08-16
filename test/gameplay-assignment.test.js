import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createRoller } from "../src/gameplay/random.js";
import { gradeRoll, resolveIncidentRoll, resolveTurn, settleAssignments, validateAssignments } from "../src/gameplay/simulation.js";

function world(columns = 12, rows = 12) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: row * 4 }, buildable: true });
  return { mapId: "assignment-test", grid: { columns, rows, cells } };
}

function cityWithIncidentAndWardens(overrides = {}) {
  const state = createCityState(world(), { resources: { coins: 99999, timber: 99999, stone: 99999 } });
  state.cells["cell-5-5"].occupancy = "b1";
  state.buildings.b1 = {
    id: "b1",
    footprintCells: ["cell-5-5"],
    site: { lotId: "cell-5-5", footprint: "1x1" },
    program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.6, prominence: "important" } },
    status: "completed",
    exposure: overrides.exposure ?? 70
  };
  state.gameplay.incidents["incident-1"] = {
    id: "incident-1",
    buildingId: "b1",
    type: overrides.type ?? "investigation",
    attribute: overrides.type ?? "investigation",
    difficulty: overrides.difficulty ?? 8,
    severity: 3,
    exposureAtCreation: 70,
    summary: "Investigate the Lantern Tower anomaly.",
    status: "open",
    createdAtTurn: 0
  };
  state.gameplay.wardens["warden-weak"] = { id: "warden-weak", name: "Weak", investigation: 1, containment: 1, concealment: 1, specialties: [], status: "available", hiredAtTurn: 0 };
  state.gameplay.wardens["warden-strong"] = { id: "warden-strong", name: "Strong", investigation: 4, containment: 2, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 };
  return state;
}

function context(seed = "assignment-fixed-seed") {
  let id = 0;
  return { createId: (prefix) => `${prefix}-${++id}`, now: () => "2026-07-22T12:00:00.000Z", seed };
}test("same roll with different wardens produces different totals and outcomes", () => {
  const incident = { id: "incident-1", buildingId: "b1", type: "investigation", difficulty: 8 };
  const weak = { investigation: 1, specialties: [] };
  const strong = { investigation: 4, specialties: ["investigation"] };
  const roller = createRoller({ roller: () => 0.2 });
  const weakResult = resolveIncidentRoll({ incident, warden: weak, roller });
  const strongResult = resolveIncidentRoll({ incident, warden: strong, roller });
  assert.equal(weakResult.roll, 5);
  assert.equal(weakResult.total, 6);
  assert.equal(strongResult.total, 5 + 4 + 2);
  assert.equal(weakResult.outcome, "failure");
  assert.equal(strongResult.outcome, "success");
});

test("gradeRoll maps d20 results into the four outcome bands", () => {
  assert.equal(gradeRoll(20, 0, 8), "critical_success");
  assert.equal(gradeRoll(1, 30, 8), "critical_failure");
  assert.equal(gradeRoll(10, 14, 8), "critical_success");
  assert.equal(gradeRoll(10, 9, 8), "success");
  assert.equal(gradeRoll(10, 3, 8), "critical_failure");
  assert.equal(gradeRoll(10, 6, 8), "failure");
});

test("assignment validation rejects unavailable wardens, duplicate wardens, and carried outcomes", () => {
  const state = cityWithIncidentAndWardens();
  const busy = structuredClone(state);
  busy.gameplay.wardens["warden-weak"].status = "assigned";
  const invalid = validateAssignments(busy, [], [
    { incidentId: "incident-1", wardenId: "warden-weak" }
  ]);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((entry) => entry.code === "WARDEN_UNAVAILABLE"));

  const withTwo = structuredClone(state);
  withTwo.gameplay.incidents["incident-other"] = { ...state.gameplay.incidents["incident-1"], id: "incident-other", buildingId: "b1" };
  const duplicate = validateAssignments(withTwo, [], [
    { incidentId: "incident-1", wardenId: "warden-strong" },
    { incidentId: "incident-other", wardenId: "warden-strong" }
  ]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((entry) => entry.code === "WARDEN_ALREADY_ASSIGNED"));

  const carried = validateAssignments(state, [], [{ incidentId: "incident-1", wardenId: "warden-strong", outcome: "success" }]);
  assert.equal(carried.ok, false);
  assert.ok(carried.errors.some((entry) => entry.code === "ASSIGNMENT_CARRIES_OUTCOME"));
});

test("resolveTurn settles an assignment and records rolls and outcomes in facts", () => {
  const state = cityWithIncidentAndWardens();
  const { nextState, facts, error } = resolveTurn(state, {
    assignments: [{ incidentId: "incident-1", wardenId: "warden-strong" }]
  }, context());
  assert.equal(error, null);
  assert.equal(facts.assignments.length, 1);
  assert.equal(facts.rolls.length, 1);
  assert.equal(facts.outcomes.length, 1);
  assert.equal(facts.rolls[0].incidentId, "incident-1");
  assert.equal(facts.rolls[0].wardenId, "warden-strong");
  assert.equal(facts.rolls[0].outcome, facts.outcomes[0].outcome);
  assert.ok(facts.rolls[0].rawRoll >= 1 && facts.rolls[0].rawRoll <= 20);
  assert.ok(["critical_success", "success", "failure", "critical_failure"].includes(facts.outcomes[0].outcome));
  assert.equal(nextState.gameplay.incidents["incident-1"].status, facts.outcomes[0].incidentStatus);
  assert.equal(nextState.gameplay.wardens["warden-strong"].status, facts.outcomes[0].wardenStatus);
});

test("same state + assignment + seed produce identical rolls and outcomes", () => {
  const specs = { assignments: [{ incidentId: "incident-1", wardenId: "warden-strong" }] };
  const a = resolveTurn(cityWithIncidentAndWardens(), specs, context("fixed"));
  const b = resolveTurn(cityWithIncidentAndWardens(), specs, context("fixed"));
  assert.deepEqual(a.facts.rolls, b.facts.rolls);
  assert.deepEqual(a.facts.outcomes, b.facts.outcomes);
  assert.deepEqual(a.nextState.gameplay.incidents, b.nextState.gameplay.incidents);
  assert.deepEqual(a.nextState.gameplay.wardens, b.nextState.gameplay.wardens);
});

test("a resolved incident is not eligible for a second assignment", () => {
  const state = cityWithIncidentAndWardens();
  state.gameplay.incidents["incident-1"].status = "resolved";
  const second = resolveTurn(state, { assignments: [{ incidentId: "incident-1", wardenId: "warden-weak" }] }, context());
  assert.equal(second.error.code, "INVALID_ASSIGNMENT");
  assert.ok(second.error.assignmentErrors.some((entry) => entry.code === "INCIDENT_NOT_OPEN"));
});

test("settleAssignments applies exposure deltas per outcome", () => {
  const incident = { id: "incident-1", buildingId: "b1", type: "investigation", difficulty: 8 };
  const warden = { investigation: 4, specialties: ["investigation"] };
  const critical = resolveIncidentRoll({ incident, warden, roller: createRoller({ roller: () => 0.999 }) });
  const failed = resolveIncidentRoll({ incident, warden, roller: createRoller({ roller: () => 0.0 }) });
  assert.equal(critical.outcome, "critical_success");
  assert.equal(failed.outcome, "critical_failure");
});

test("a critical failure escalates the incident and grounds the warden in the turn state", () => {
  const state = cityWithIncidentAndWardens({ difficulty: 12 });
  const ctx = { ...context("critical-failure-seed"), roller: () => 0.0 };
  const { nextState, facts, error } = resolveTurn(state, {
    assignments: [{ incidentId: "incident-1", wardenId: "warden-weak" }],
    options: { baseCoins: 0 }
  }, ctx);
  assert.equal(error, null);
  assert.equal(facts.outcomes[0].outcome, "critical_failure");
  assert.equal(facts.outcomes[0].exposureDelta, 3);
  assert.equal(facts.outcomes[0].incidentStatus, "escalated");
  assert.equal(facts.outcomes[0].wardenStatus, "unavailable");
  assert.equal(nextState.gameplay.incidents["incident-1"].status, "escalated");
  assert.equal(nextState.gameplay.wardens["warden-weak"].status, "unavailable");
  assert.ok(nextState.buildings.b1.exposure > 70, "exposure grows on a critical failure");
  assert.equal(nextState.buildings.b1.exposure, facts.exposureChanges.b1.to);
});
