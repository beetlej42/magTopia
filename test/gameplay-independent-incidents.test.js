import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { generateIncidents, gradeRoll, resolveTurn } from "../src/gameplay/simulation.js";
import { inspectBuildingRisk } from "../src/gameplay/exposure.js";
import { normalizeArcaneOfficer, normalizeExposureIncident, normalizeTurnFacts } from "../src/gameplay/schema.js";

function stateWithBuildings(ids = ["a"]) {
  const cells = ids.map((id, index) => ({ id: `cell-${index}-0`, column: index, row: 0, buildable: true, strictBuildable: true }));
  const state = createCityState({ mapId: "independent-incidents", grid: { columns: ids.length, rows: 1, cells } }, { resources: { coins: 99999 } });
  for (const [index, id] of ids.entries()) {
    state.cells[`cell-${index}-0`].occupancy = id;
    state.buildings[id] = {
      id,
      footprintCells: [`cell-${index}-0`],
      site: { lotId: `cell-${index}-0`, footprint: "1x1" },
      status: "completed",
      gameplay: { canonical: true, units: [{ purpose: "greenhouse", area: 1, magicRatio: 1 }] }
    };
  }
  return state;
}

function metadataFor(state) {
  return Object.fromEntries(Object.entries(state.buildings).map(([id, building]) => [id, building.gameplay]));
}

function roller(values) {
  let index = 0;
  return { next: () => values[index++] ?? 1 };
}

test("every eligible building rolls independently without a city cap", () => {
  const state = stateWithBuildings(["a", "b", "c", "d"]);
  let id = 0;
  const incidents = generateIncidents(state, metadataFor(state), roller([0, 0, 0, 0, ...Array(12).fill(0)]), { createId: () => `incident-${id++}` });
  assert.equal(incidents.length, 4);
  assert.deepEqual(incidents.map((entry) => entry.buildingId), ["a", "b", "c", "d"]);
});

test("all threshold rolls are consumed before any type roll", () => {
  const state = stateWithBuildings(["a", "b"]);
  const audit = [];
  generateIncidents(state, metadataFor(state), roller([0.01, 0.5, 0, 0, 0]), { incidentRolls: audit });
  assert.deepEqual(audit.map((entry) => entry.thresholdRoll), [0.01, 0.5]);
  assert.equal(audit[1].hit, false);
});

test("fixed seed reproduces every incident and historical fact across multiple turns", () => {
  const run = () => {
    let state = stateWithBuildings(["a", "b"]);
    const facts = [];
    for (let turn = 0; turn < 3; turn += 1) {
      const result = resolveTurn(state, { force: true }, { seed: "multi-turn-seed", now: () => "2026-01-01T00:00:00.000Z" });
      assert.equal(result.error, null);
      facts.push(result.facts);
      state = result.nextState;
    }
    return facts;
  };
  assert.deepEqual(run(), run());
});

test("all types and all DC tiers remain reachable under weighted rolls", () => {
  const state = stateWithBuildings(["a"]);
  const types = new Set();
  const dcs = new Set();
  for (let index = 0; index < 100; index += 1) {
    const sequence = [0, (index % 100) / 100, ((index * 37) % 100) / 100];
    const incident = generateIncidents(state, metadataFor(state), roller(sequence), { createId: () => `incident-${index}` })[0];
    types.add(incident.type);
    dcs.add(incident.dc);
  }
  assert.deepEqual([...types].sort(), ["cover_up", "investigation", "suppression"]);
  assert.deepEqual([...dcs].sort((a, b) => a - b), [10, 14, 18]);
});

test("ordinary cover deterministically lowers final chance", () => {
  const bare = stateWithBuildings(["a"]);
  const covered = stateWithBuildings(["a", "b"]);
  covered.buildings.b.gameplay = { canonical: true, units: [{ purpose: "residential", area: 12, magicRatio: 0 }] };
  const bareRisk = inspectBuildingRisk(bare, "a", { metadataOf: (building) => building.gameplay });
  const coveredRisk = inspectBuildingRisk(covered, "a", { metadataOf: (building) => building.gameplay });
  assert.ok(coveredRisk.finalIncidentChance < bareRisk.finalIncidentChance);
});

test("mixed-use type weights aggregate all units, independent of unit insertion order", () => {
  const state = stateWithBuildings(["a"]);
  const first = { canonical: true, units: [
    { purpose: "residential", area: 1, magicRatio: 1 },
    { purpose: "production", area: 5, magicRatio: 1 }
  ] };
  const second = { canonical: true, units: [...first.units].reverse() };
  const a = generateIncidents(state, { a: first }, roller([0, 0.4, 0.1]), { createId: () => "a" })[0];
  const b = generateIncidents(state, { a: second }, roller([0, 0.4, 0.1]), { createId: () => "a" })[0];
  assert.deepEqual(a.purposeWeights, b.purposeWeights);
  assert.deepEqual(a.typeWeights, b.typeWeights);
  assert.equal(a.sourcePurpose, "production");
});

test("only the three DCs and four margin bands are authoritative", () => {
  assert.deepEqual([10, 14, 18].map((dc) => normalizeExposureIncident({ type: "investigation", dc }).dc), [10, 14, 18]);
  assert.deepEqual([
    gradeRoll(20, 15, 10), gradeRoll(1, 1, 10), gradeRoll(8, 15, 10), gradeRoll(8, 9, 10), gradeRoll(8, 5, 10)
  ], ["critical_success", "critical_failure", "critical_success", "failure", "critical_failure"]);
  assert.throws(() => normalizeExposureIncident({ type: "investigation", dc: 10, difficultyTier: "bogus" }));
});

test("legacy incident and officer archives migrate to current vocabulary", () => {
  assert.equal(normalizeExposureIncident({ type: "containment", difficulty: 3 }).type, "suppression");
  assert.equal(normalizeExposureIncident({ type: "concealment", difficulty: 3 }).type, "cover_up");
  const officer = normalizeArcaneOfficer({ containment: 2, concealment: 3, specialties: ["containment", "concealment"] });
  assert.deepEqual(officer.specialties, ["suppression", "cover_up"]);
  assert.equal(officer.suppression, 2);
  assert.equal(officer.coverUp, 3);
});

test("turn facts audit unaddressed failure exactly once and seal at risk four", () => {
  const state = stateWithBuildings(["a"]);
  state.buildings.a.historicalRisk = 3;
  state.gameplay.incidents.existing = { id: "existing", buildingId: "a", type: "investigation", dc: 10, status: "open" };
  const first = resolveTurn(state, {}, { roller: () => 1, now: () => "2026-01-01T00:00:00.000Z" });
  assert.equal(first.error, null);
  assert.equal(first.nextState.buildings.a.historicalRisk, 4);
  assert.equal(first.nextState.buildings.a.status, "sealed");
  assert.equal(first.facts.unaddressedIncidents[0].status, "failed");
  assert.equal(first.facts.unaddressedIncidents[0].outcome, "failure");
  assert.equal(first.facts.unaddressedIncidents[0].historicalRiskDelta, 1);
  const second = resolveTurn(first.nextState, { force: true }, { roller: () => 0, now: () => "2026-01-01T00:00:00.000Z" });
  assert.equal(second.error, null);
  assert.equal(second.facts.incidentRolls.some((entry) => entry.buildingId === "a"), false);
  assert.equal(second.nextState.buildings.a.historicalRisk, 4);
});

test("assigned failure and critical failure add one and two risk, including multiple incidents in one building", () => {
  const state = stateWithBuildings(["a"]);
  state.gameplay.arcaneOfficers = {
    one: { id: "one", name: "One", investigation: 0, suppression: 0, coverUp: 0, specialties: [], status: "available" },
    two: { id: "two", name: "Two", investigation: 0, suppression: 0, coverUp: 0, specialties: [], status: "available" }
  };
  state.gameplay.incidents = {
    failure: { id: "failure", buildingId: "a", type: "investigation", dc: 14, status: "open" },
    critical: { id: "critical", buildingId: "a", type: "investigation", dc: 14, status: "open" }
  };
  const result = resolveTurn(state, { assignments: [
    { incidentId: "failure", arcaneOfficerId: "one" },
    { incidentId: "critical", arcaneOfficerId: "two" }
  ] }, { roller: (() => { const rolls = [1, 0.6, 0]; return () => rolls.shift() ?? 0; })(), now: () => "2026-01-01T00:00:00.000Z" });
  assert.equal(result.error, null);
  assert.deepEqual(result.facts.rolls.map((roll) => roll.outcome), ["failure", "critical_failure"]);
  assert.equal(result.nextState.buildings.a.historicalRisk, 3);
  assert.equal(result.facts.historicalRiskChanges.a.delta, 3);
  assert.deepEqual(result.facts.historicalRiskChanges.a.incidentIds, ["failure", "critical"]);
});

test("facts nested audit records are independent and immutable", () => {
  const source = { sourceRisk: { purposeWeights: { production: 1 } }, incidentRolls: [{ buildingId: "a", nested: { x: 1 } }], historicalRiskChanges: { a: { incidentIds: ["i"] } } };
  const facts = normalizeTurnFacts(source);
  assert.notEqual(facts.incidentRolls[0], source.incidentRolls[0]);
  assert.notEqual(facts.incidentRolls[0].nested, source.incidentRolls[0].nested);
  facts.incidentRolls[0].nested.x = 2;
  assert.equal(source.incidentRolls[0].nested.x, 1);
});
