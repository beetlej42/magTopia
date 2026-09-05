import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { ARCANE_OFFICER_CONFIG, arcaneOfficerCapacity, currentOfficerCandidates, generateArcaneOfficerIdentity, hireArcaneOfficerCandidate, maintenanceForRoster, recruitmentConfigSummary } from "../src/gameplay/arcane-officers.js";

function state({ coins = 99999, wizards = 20 } = {}) {
  const cells = Array.from({ length: 144 }, (_, i) => ({ id: `cell-${i}`, column: i % 12, row: Math.floor(i / 12), buildable: true }));
  const result = createCityState({ mapId: "officer-test", grid: { columns: 12, rows: 12, cells } }, { cityId: "officer-test", resources: { coins } });
  result.gameplay.population.wizards.current = wizards;
  result.buildings.ministry = { id: "ministry", status: "completed", program: { canonicalProgram: "ministry_of_magic" } };
  return result;
}

test("capacity and config validation are bounded", () => {
  assert.equal(arcaneOfficerCapacity(state({ wizards: 0 })), 1, "governance supplies the first officer slot");
  assert.equal(arcaneOfficerCapacity(state({ wizards: 25 }), { capacityDivisor: 5 }), 6);
  assert.throws(() => recruitmentConfigSummary({ candidateCount: 99 }), /config/);
  assert.throws(() => recruitmentConfigSummary({ hireCostCoins: 119 }), /config/);
  assert.throws(() => recruitmentConfigSummary({ growthChance: 0.3, criticalGrowthChance: 0.2 }), /config/);
});

test("candidate recruitment rejects forged fields and protects an authoritative ledger", () => {
  const source = state({ coins: 500 });
  const pool = currentOfficerCandidates(source, source.cityId);
  const poolSnapshot = structuredClone(pool.state);
  for (const forged of [{ name: "forged" }, { archetype: "veteran" }, { investigation: 5 }, { specialty: "production" }, { costCoins: 0 }, { candidate_id: pool.candidates[0].candidateId, stats: {} }, { candidate_id: pool.candidates[0].candidateId, candidateId: "other" }]) {
    const result = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId, ...forged }, { cityId: source.cityId });
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, "ARCANE_OFFICER_FORGERY");
    assert.deepEqual(pool.state, poolSnapshot);
  }
  const invalid = structuredClone(pool.state);
  invalid.resources.coins = -1;
  const rejected = hireArcaneOfficerCandidate(invalid, { candidate_id: pool.candidates[0].candidateId }, { cityId: source.cityId });
  assert.equal(rejected.error.code, "INVALID_COINS_LEDGER");
  const mismatch = structuredClone(pool.state);
  mismatch.gameplay.resources.coins = 1;
  const hired = hireArcaneOfficerCandidate(mismatch, { candidate_id: pool.candidates[0].candidateId }, { cityId: source.cityId });
  assert.equal(hired.accepted, true);
  assert.equal(hired.cost, ARCANE_OFFICER_CONFIG.hireCostCoins);
  assert.equal(hired.nextState.resources.coins, 350);
  assert.equal(hired.nextState.gameplay.resources.coins, 350);
});

test("insufficient, duplicate, expired, and non-current candidates do not charge", () => {
  const poor = state({ coins: 149 });
  const pool = currentOfficerCandidates(poor, poor.cityId);
  const insufficient = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId }, { cityId: poor.cityId });
  assert.equal(insufficient.error.code, "INSUFFICIENT_COINS");
  const hired = hireArcaneOfficerCandidate(state({ coins: 500 }), { candidate_id: pool.candidates[0].candidateId }, { cityId: poor.cityId });
  assert.equal(hired.accepted, true);
  assert.equal(hireArcaneOfficerCandidate(hired.nextState, { candidate_id: pool.candidates[0].candidateId }, { cityId: poor.cityId }).error.code, "ARCANE_OFFICER_CANDIDATE_INVALID");
  const expired = hireArcaneOfficerCandidate({ ...hired.nextState, turn: 3 }, { candidate_id: pool.candidates[0].candidateId }, { cityId: poor.cityId });
  assert.equal(expired.error.code, "ARCANE_OFFICER_CANDIDATE_INVALID");
});

test("trusted card-style identity generation is free and has the new identity contract", () => {
  const officer = generateArcaneOfficerIdentity({ seed: "card", id: "card-officer" });
  assert.equal(officer.archetype, "purpose_specialist");
  assert.equal(officer.specialties[0], officer.specialty);
  assert.ok(officer.investigation + officer.suppression + officer.coverUp >= 7);
});

test("maintenance config is centralized", () => {
  const source = state();
  source.gameplay.arcaneOfficers.one = generateArcaneOfficerIdentity({ seed: "maintenance", id: "one" });
  assert.deepEqual(maintenanceForRoster(source, { maintenanceCoinsPerTurn: 12 }), { count: 1, rate: 12, total: 12 });
});

test("candidate price is frozen by the validated window configuration", () => {
  const source = state({ coins: 500 });
  const options = { hireCostCoins: 180 };
  const pool = currentOfficerCandidates(source, source.cityId, options);
  assert.equal(pool.candidates[0].costCoins, 180);
  const result = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId }, { cityId: source.cityId, options });
  assert.equal(result.accepted, true);
  assert.equal(result.cost, 180);
  assert.equal(result.nextState.resources.coins, 320);
  const tampered = structuredClone(pool.state);
  tampered.gameplay.arcaneOfficerRecruitment.candidates[pool.candidates[0].candidateId].costCoins = 120;
  const repaired = currentOfficerCandidates(tampered, source.cityId, options);
  assert.equal(repaired.candidates[0].costCoins, 180);
});
