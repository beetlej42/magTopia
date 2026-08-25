import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createRoller } from "../src/gameplay/random.js";
import { resolveIncidentRoll, settleAssignments, resolveTurn, settleResources } from "../src/gameplay/simulation.js";
import { ARCANE_OFFICER_PURPOSES, ARCANE_OFFICER_CONFIG, arcaneOfficerCapacity, arcaneOfficerRecruitmentUnlocked, currentOfficerCandidates, generateArcaneOfficerIdentity, hireArcaneOfficerCandidate, isGovernanceFacility, maintenanceForRoster } from "../src/gameplay/arcane-officers.js";
import { normalizeArcaneOfficer } from "../src/gameplay/schema.js";

function state({ turn = 0, coins = 500, wizards = 30, governance = true } = {}) {
  const cells = Array.from({ length: 100 }, (_, i) => ({ id: `cell-${i}`, column: i % 10, row: Math.floor(i / 10), buildable: true }));
  const result = createCityState({ mapId: "officer-progression", grid: { columns: 10, rows: 10, cells } }, { cityId: "progression-city", resources: { coins } });
  result.turn = turn;
  result.gameplay.population.wizards.current = wizards;
  if (governance) result.buildings.ministry = { id: "ministry", status: "completed", program: { canonicalProgram: "ministry_of_magic", name: "Ministry of Magic" } };
  return result;
}

test("candidate pool is deterministic, bounded, identity-complete, and refreshes exactly at the window boundary", () => {
  const a = currentOfficerCandidates(state(), "same-city");
  const b = currentOfficerCandidates(state(), "same-city");
  assert.deepEqual(a.candidates, b.candidates);
  assert.ok(a.candidates.length >= 2 && a.candidates.length <= 3);
  assert.equal(new Set(a.candidates.map((candidate) => candidate.candidateId)).size, a.candidates.length);
  assert.equal(new Set(a.candidates.map((candidate) => candidate.identity.name)).size, a.candidates.length);
  for (const candidate of a.candidates) {
    const identity = candidate.identity;
    assert.ok(identity.id && identity.name && identity.appearanceSeed);
    assert.ok(ARCANE_OFFICER_PURPOSES.includes(identity.specialty));
    assert.deepEqual(identity.specialties, [identity.specialty]);
    const total = identity.investigation + identity.suppression + identity.coverUp;
    assert.ok(total >= 7 && total <= 9);
  }
  const beforeBoundary = currentOfficerCandidates(state({ turn: ARCANE_OFFICER_CONFIG.refreshIntervalTurns - 1 }), "same-city");
  const atBoundary = currentOfficerCandidates(state({ turn: ARCANE_OFFICER_CONFIG.refreshIntervalTurns }), "same-city");
  assert.notDeepEqual(beforeBoundary.candidates.map((entry) => entry.candidateId), atBoundary.candidates.map((entry) => entry.candidateId));
});

test("governance unlock is exact and locked state has no candidates", () => {
  assert.equal(isGovernanceFacility({ status: "completed", program: { purpose: "public_service", name: "Hospital" } }), false);
  assert.equal(isGovernanceFacility({ status: "completed", program: { canonicalProgram: "ministry_of_magic" } }), true);
  assert.equal(isGovernanceFacility({ status: "active", specialStructure: { cardId: "ministry-of-magic" } }), true);
  assert.equal(isGovernanceFacility({ status: "sealed", program: { canonicalProgram: "ministry_of_magic" } }), false);
  const locked = currentOfficerCandidates(state({ governance: false }), "locked-city");
  assert.equal(arcaneOfficerRecruitmentUnlocked(state({ governance: false })), false);
  assert.equal(locked.candidates.length, 3, "domain pool remains deterministic; API hides it while locked");
});

test("candidate recruitment is candidate-only, atomic, authoritative, and capped", () => {
  const original = state();
  const pool = currentOfficerCandidates(original, original.cityId);
  const forged = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId, name: "forged", investigation: 5 }, { cityId: original.cityId });
  assert.equal(forged.accepted, false);
  assert.equal(forged.error.code, "ARCANE_OFFICER_FORGERY");
  const result = hireArcaneOfficerCandidate(pool.state, { candidate_id: pool.candidates[0].candidateId }, { cityId: original.cityId });
  assert.equal(result.accepted, true);
  assert.equal(result.cost, ARCANE_OFFICER_CONFIG.hireCostCoins);
  assert.equal(result.nextState.resources.coins, 350);
  assert.equal(result.nextState.gameplay.resources.coins, 350);
  assert.equal(result.nextState.gameplay.arcaneOfficers[result.arcaneOfficer.id].name, pool.candidates[0].identity.name);
  const duplicate = hireArcaneOfficerCandidate(result.nextState, { candidate_id: pool.candidates[0].candidateId }, { cityId: original.cityId });
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.error.code, "ARCANE_OFFICER_CANDIDATE_INVALID");
  const locked = hireArcaneOfficerCandidate(state({ governance: false }), { candidate_id: pool.candidates[0].candidateId }, { cityId: original.cityId });
  assert.equal(locked.error.code, "ARCANE_OFFICER_RECRUITMENT_LOCKED");
  const capped = state({ wizards: 10 });
  capped.gameplay.arcaneOfficers.existing = generateArcaneOfficerIdentity({ seed: "existing", id: "existing" });
  assert.equal(hireArcaneOfficerCandidate(capped, { candidate_id: "anything" }, { cityId: capped.cityId }).error.code, "ARCANE_OFFICER_CAPACITY_REACHED");
});

test("new identity generator is replayable and rejects invalid internal profiles", () => {
  assert.deepEqual(generateArcaneOfficerIdentity({ seed: "fixed" }), generateArcaneOfficerIdentity({ seed: "fixed" }));
  assert.throws(() => generateArcaneOfficerIdentity({ seed: "bad", profile: { investigation: 9, suppression: 1, coverUp: 1, specialty: "investigation" } }), /profile/);
  assert.throws(() => normalizeArcaneOfficer({ id: "bad", archetype: "purpose_specialist", specialty: "investigation", specialties: ["investigation"], investigation: 3, suppression: 2, coverUp: 2 }), /purpose specialty/);
  assert.throws(() => normalizeArcaneOfficer({ id: "bad", archetype: "purpose_specialist", specialty: "residential", specialties: ["commercial"], investigation: 3, suppression: 2, coverUp: 2 }), /exactly one/);
  assert.throws(() => normalizeArcaneOfficer({ id: "bad", archetype: "purpose_specialist", investigation: 3, suppression: 2, coverUp: 2 }), /purpose specialty/);
  const history = normalizeArcaneOfficer({ id: "old", history: Array.from({ length: 60 }, (_, turn) => ({ turn })) });
  assert.equal(history.history.length, 50);
});

test("purpose specialty is authoritative and legacy incident type specialty receives no bonus", () => {
  const roller = createRoller({ roller: () => 0.2 });
  const incident = { type: "investigation", sourcePurpose: "residential", dc: 10 };
  const purpose = { investigation: 1, specialty: "residential", specialties: ["residential"] };
  const legacy = { investigation: 1, specialties: ["investigation"] };
  assert.equal(resolveIncidentRoll({ incident, officer: purpose, roller }).specialtyBonus, 2);
  assert.equal(resolveIncidentRoll({ incident, officer: legacy, roller }).specialtyBonus, 0);
  assert.equal(resolveIncidentRoll({ incident: { type: "investigation", dc: 10 }, officer: legacy, roller }).specialtyBonus, 0);
});

test("growth is deterministic, outcome-gated, capped, and audited", () => {
  const incident = { id: "incident", buildingId: "building", type: "investigation", sourcePurpose: "residential", dc: 10, status: "open" };
  const base = { turn: 4, buildings: { building: { historicalRisk: 0 } }, gameplay: { incidents: { incident }, arcaneOfficers: { officer: { id: "officer", investigation: 1, suppression: 1, coverUp: 1, specialty: "residential", specialties: ["residential"], status: "available", history: [] } } } };
  const success = settleAssignments(base, [incident], [{ incidentId: "incident", arcaneOfficerId: "officer" }], createRoller({ roller: () => 0.5 }), { growthChance: 1 });
  assert.equal(success.outcomes[0].growth.gained, 1);
  assert.equal(base.gameplay.arcaneOfficers.officer.history[0].incidentId, "incident");
  const failedState = structuredClone(base); failedState.gameplay.incidents.incident = { ...incident, dc: 20 };
  const failed = settleAssignments(failedState, [failedState.gameplay.incidents.incident], [{ incidentId: "incident", arcaneOfficerId: "officer" }], createRoller({ roller: () => 0 }), { growthChance: 1 });
  assert.equal(failed.outcomes[0].growth.chance, 0);
  assert.equal(failed.outcomes[0].growth.gained, 0);
  const capped = structuredClone(base); capped.gameplay.arcaneOfficers.officer.investigation = 5;
  const capResult = settleAssignments(capped, [incident], [{ incidentId: "incident", arcaneOfficerId: "officer" }], createRoller({ roller: () => 0.5 }), { growthChance: 1 });
  assert.equal(capResult.outcomes[0].growth.chance, 0);
});

test("maintenance charges from opening plus gross income and never Arcane Energy", () => {
  const s = state({ coins: 0, wizards: 0 });
  s.gameplay.arcaneOfficers.one = generateArcaneOfficerIdentity({ seed: "maintenance", id: "one" });
  assert.deepEqual(maintenanceForRoster(s, { maintenanceCoinsPerTurn: 10 }), { count: 1, rate: 10, total: 10 });
  const result = resolveTurn(s, {}, { seed: "maintenance", options: { baseCoins: 100, baseArcaneEnergy: 4 } });
  assert.equal(result.error, null);
  assert.equal(result.nextState.resources.coins, 90);
  assert.equal(result.nextState.gameplay.resources.coins, 90);
  assert.equal(result.nextState.gameplay.resources.arcaneEnergy, 4);
  assert.equal(result.facts.officerMaintenance.charged, 10);
  assert.equal(result.facts.netResourceDelta.coins, 90);
});

test("maintenance charges available opening plus gross income and audits unpaid", () => {
  const s = state({ coins: 0, wizards: 0 });
  s.gameplay.arcaneOfficers.one = generateArcaneOfficerIdentity({ seed: "short-maintenance", id: "one" });
  const short = settleResources(s, {}, { baseCoins: 5, chargeOfficerMaintenance: true });
  assert.equal(short.maintenance.charged, 5);
  assert.equal(short.maintenance.unpaid, 5);
  assert.equal(short.after.coins, 0);
  const openingOnly = structuredClone(s);
  openingOnly.resources.coins = 3;
  const second = settleResources(openingOnly, {}, { chargeOfficerMaintenance: true });
  assert.equal(second.maintenance.charged, 3);
  assert.equal(second.maintenance.unpaid, 7);
  assert.equal(second.after.coins, 0);
  assert.equal(second.after.arcaneEnergy, 0);
});

test("growth uses an independent roller so two assignment d20 results replay unchanged", () => {
  const incidents = [
    { id: "one", buildingId: "building", type: "investigation", sourcePurpose: "residential", dc: 10, status: "open" },
    { id: "two", buildingId: "building", type: "investigation", sourcePurpose: "residential", dc: 10, status: "open" }
  ];
  const base = { turn: 2, buildings: { building: { historicalRisk: 0 } }, gameplay: { incidents: Object.fromEntries(incidents.map((incident) => [incident.id, incident])), arcaneOfficers: { officer: { id: "officer", investigation: 1, suppression: 1, coverUp: 1, specialty: "residential", specialties: ["residential"], status: "available", history: [] } } } };
  const assignments = incidents.map((incident) => ({ incidentId: incident.id, arcaneOfficerId: "officer" }));
  const run = (growthChance) => settleAssignments(structuredClone(base), incidents, assignments, { next: () => 0.5 }, { growthChance, growthRoller: { next: () => 0 } });
  const noGrowth = run(0);
  const growth = run(1);
  assert.deepEqual(growth.rolls.map((roll) => roll.roll), noGrowth.rolls.map((roll) => roll.roll));
  assert.deepEqual(growth.rolls.map((roll) => roll.roll), noGrowth.rolls.map((roll) => roll.roll));
  assert.equal(growth.outcomes[0].growth.gained, 1);
  assert.equal(growth.outcomes[1].growth.gained, 1);
});
