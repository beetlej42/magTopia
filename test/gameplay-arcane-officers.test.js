import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { ARCANE_OFFICER_CONFIG, arcaneOfficerCapacity, currentOfficerCandidates, hireArcaneOfficer, hireArcaneOfficerCandidate, setArcaneOfficerStatus } from "../src/gameplay/arcane-officers.js";

function state(wizards = 20) {
  const cells = Array.from({ length: 144 }, (_, i) => ({ id: `cell-${i}`, column: i % 12, row: Math.floor(i / 12), buildable: true }));
  const result = createCityState({ mapId: "officer-test", grid: { columns: 12, rows: 12, cells } }, { cityId: "officer-test", resources: { coins: 99999 } });
  result.gameplay.population.wizards.current = wizards;
  result.buildings.ministry = { id: "ministry", status: "completed", program: { canonicalProgram: "ministry_of_magic" } };
  return result;
}

test("arcane officer roster capacity scales with wizard population by ten", () => { assert.equal(arcaneOfficerCapacity(state(0)), 0); assert.equal(arcaneOfficerCapacity(state(9)), 0); assert.equal(arcaneOfficerCapacity(state(10)), 1); assert.equal(arcaneOfficerCapacity(state(25)), 2); assert.equal(arcaneOfficerCapacity(state(20), { capacityDivisor: 5 }), 4); });
test("candidate recruitment owns price and identity; external profile fields are ignored", () => { const source = state(); const pool = currentOfficerCandidates(source, source.cityId); const result = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId, name: "forged", investigation: 5, cost: 0 }, { cityId: source.cityId }); assert.equal(result.accepted, true); assert.equal(result.cost, ARCANE_OFFICER_CONFIG.hireCostCoins); assert.equal(result.arcaneOfficer.name, pool.candidates[0].identity.name); assert.equal(result.nextState.resources.coins, 99999 - ARCANE_OFFICER_CONFIG.hireCostCoins); assert.equal(result.nextState.gameplay.resources.coins, result.nextState.resources.coins); });
test("legacy hire entry point is no longer an external recruitment API", () => { const result = hireArcaneOfficer(state(), { name: "forged", archetype: "veteran", investigation: 5 }); assert.equal(result.accepted, false); assert.equal(result.error.code, "ARCANE_OFFICER_CANDIDATE_REQUIRED"); });
test("candidate status transition remains available for system assignment", () => { const pool = currentOfficerCandidates(state(), "officer-test"); const hired = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId }, { cityId: "officer-test" }); const unavailable = setArcaneOfficerStatus(hired.nextState, hired.arcaneOfficer.id, "unavailable"); assert.equal(unavailable.ok, true); assert.equal(unavailable.nextState.gameplay.arcaneOfficers[hired.arcaneOfficer.id].status, "unavailable"); });
