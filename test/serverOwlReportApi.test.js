import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";
import { createTurnScheduler } from "../apps/server/turn-scheduler.js";
import { buildReportContext, factsDigest, validateOwlReport } from "../src/gameplay/owl-report.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-owl-report-test",
  assetProvider: "codex-manual",
  workerPollMs: 5,
  gameplaySeed: 7
};

const TURN_COOLDOWN_SECONDS = 60;

const VESPER = { id: "officer-vesper", name: "Vesper", archetype: "investigation", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"], status: "available", hiredAtTurn: 0 };

function openIncident(overrides = {}) {
  return {
    id: "incident-1",
    buildingId: "building-1",
    type: "investigation",
    attribute: "investigation",
    difficulty: 3,
    severity: 3,
    exposureAtCreation: 70,
    summary: "Unresolved magical anomaly reported near Lantern Tower; origin requires investigation.",
    status: "open",
    createdAtTurn: 0,
    ...overrides
  };
}

async function openCity(repository, app) {
  const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Owl Owner" } }, 201);
  const city = await json(app, auth(player, {
    method: "POST",
    url: "/api/v1/cities",
    payload: { name: "Owl City", map_seed: "owl-report-test" }
  }), 201);
  const link = await json(app, auth(player, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
  const connected = await json(app, { method: "POST", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
  const agent = { access_token: connected.access_token };
  const owner = await repository.authenticate(player.access_token);
  return { player, city, agent, owner };
}

async function seedState(repository, owner, cityId, expectedVersion, { officers = { [VESPER.id]: VESPER }, incidents = { "incident-1": openIncident() }, turnStatus = "strategy" } = {}) {
  await repository.transactCity({
    principal: owner,
    cityId,
    endpoint: "test/seed-owl",
    idempotencyKey: "seed-owl-1",
    requestBody: {},
    expectedVersion
  }, async ({ state }) => {
    const cell = Object.values(state.cells).find((entry) => entry.buildable && entry.strictBuildable && !entry.node);
    state.cells[cell.id].occupancy = "building-1";
    state.buildings["building-1"] = {
      id: "building-1",
      footprintCells: [cell.id],
      site: { lotId: cell.id, footprint: "1x1" },
      program: { name: "Lantern Tower", purpose: "residential", intent: { magicLevel: 0.9, prominence: "important" } },
      status: "completed",
      exposure: 70
    };
    state.gameplay.arcaneOfficers = structuredClone(officers);
    state.gameplay.incidents = structuredClone(incidents);
    state.gameplay.turnStatus = turnStatus;
    // The seeded turn represents an already-scheduled, already-unlocked turn:
    // its cooldown gate elapsed long ago, so the resolve flow may settle it.
    state.gameplay.turnOpenedAt = "2000-01-01T00:00:00.000Z";
    state.gameplay.nextTurnUnlockAt = "2000-01-01T00:00:00.000Z";
    state.gameplay.turnDeadlineAt = null;
    return { nextState: state, response: { seeded: true } };
  });
}

async function dispatchAndResolve(app, agent, cityId, before, rationale = "matched investigation specialty") {
  const assigned = await json(app, auth(agent, {
    method: "POST",
    url: `/api/v1/cities/${cityId}/strategy/assignments`,
    headers: { "idempotency-key": "owl-dispatch" },
    payload: {
      expected_city_version: before.city_version,
      assignments: [{ incident_id: "incident-1", arcane_officer_id: "officer-vesper", rationale }]
    }
  }), 200);
  return json(app, auth(agent, {
    method: "POST",
    url: `/api/v1/cities/${cityId}/strategy/resolve`,
    headers: { "idempotency-key": "owl-resolve" },
    payload: { expected_city_version: assigned.city_version_after }
  }), 200);
}

function sampleReport(context, overrides = {}) {
  const rollRef = context.rolls[0]?.factRef;
  const outcomeRef = context.outcomes[0]?.factRef;
  const incidentRef = context.incidents.find((entry) => entry.id === context.rolls[0]?.incidentId)?.factRef ?? context.incidents[0]?.factRef;
  const report = {
    masthead: { title: "The Hooting Herald", subtitle: "An Independent Daily of the Wizarding City" },
    edition: `Day ${context.turn} Edition`,
    headline: "City Continues to Grow Beneath the Veil",
    subheadline: "A quiet day of expansion and vigilance",
    lead: "The city woke to another day of measured growth.",
    articles: [
      {
        id: "article-growth",
        headline: "North Quarter Welcomes New Homes",
        body: "The northern quarter added new homes, and families are settling in.",
        category: "development",
        importance: "front_page",
        relatedFactRefs: [incidentRef, rollRef].filter(Boolean)
      }
    ],
    briefs: [
      { id: "brief-population", text: "Population shifted upward with the new homes.", category: "population", relatedFactRefs: [context.populationDelta.factRef] }
    ],
    actionBox: incidentRef ? [{ id: "action-vesper", incidentRef, factRefs: [rollRef, outcomeRef].filter(Boolean), reason: "matched investigation specialty" }] : undefined,
    tomorrowWatch: [{ id: "tomorrow-risk", text: "Watch the exposed buildings closely.", factRefs: context.nextRisks.map((entry) => entry.factRef) }]
  };
  return { ...report, ...overrides };
}

test("a resolved turn yields a complete immutable ReportContext derived from frozen TurnFacts", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await dispatchAndResolve(app, agent, city.id, before);

    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    assert.equal(context.turn, 1);
    assert.equal(context.worldDay, 1);
    assert.equal(context.cityId, city.id);
    assert.equal(context.factsDigest, factsDigest(settled.facts), "digest derives from the frozen facts");
    assert.equal(context.settlement.settledBy, "agent");
    assert.deepEqual(context.resourceDelta.coins, settled.facts.resourceDelta.coins);
    assert.deepEqual(context.resources.before, settled.facts.resourceBefore);
    assert.deepEqual(context.resources.after, settled.facts.resourceAfter);
    assert.deepEqual(context.populationDelta.wizards.current, settled.facts.populationDelta.wizards.current);
    assert.deepEqual(context.population.before, settled.facts.populationBefore);
    assert.deepEqual(context.population.after, settled.facts.populationAfter);
    const dispatchedIncident = context.incidents.find((entry) => entry.id === "incident-1");
    assert.ok(dispatchedIncident, "the dispatched incident is part of the context");
    assert.equal(dispatchedIncident.factRef, "fact-incident-incident-1");
    assert.equal(dispatchedIncident.buildingName, "Lantern Tower", "read-only building metadata is projected");
    assert.equal(context.rolls.length, 1);
    assert.equal(context.rolls[0].factRef, "fact-roll-incident-1");
    assert.equal(context.rolls[0].arcaneOfficerName, "Vesper", "read-only officer metadata is projected");
    assert.equal(context.outcomes[0].factRef, "fact-outcome-incident-1");
    assert.ok(context.factRefs.includes("fact-incident-incident-1"));
    assert.ok(context.factRefs.includes("fact-resource-delta"));
    assert.ok(context.factRefs.includes("fact-population-delta"));
    assert.ok(context.factRefs.includes("fact-population-state"));

    const replay = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    assert.equal(replay.factsDigest, context.factsDigest, "the same resolved turn always projects the same context");
    assert.deepEqual(replay.resourceDelta, context.resourceDelta, "immutable facts are projected identically on every read");
  } finally {
    await app.close();
  }
});

test("assignment rationale, roll, outcome, and exposure changes are faithfully projected", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const settled = await dispatchAndResolve(app, agent, city.id, before, "Vesper trained on investigating magical anomalies");
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);

    assert.equal(context.assignments.length, 1);
    assert.equal(context.assignments[0].factRef, "fact-assignment-incident-1");
    assert.equal(context.assignments[0].rationale, "Vesper trained on investigating magical anomalies", "the frozen rationale is preserved");
    assert.equal(context.assignments[0].arcaneOfficerId, "officer-vesper");

    const roll = context.rolls[0];
    const factRoll = settled.facts.rolls[0];
    assert.equal(roll.rawRoll, factRoll.rawRoll);
    assert.equal(roll.attributeValue, factRoll.attributeValue);
    assert.equal(roll.specialtyBonus, factRoll.specialtyBonus);
    assert.equal(roll.otherModifiers, factRoll.otherModifiers);
    assert.equal(roll.dc, factRoll.dc);
    assert.equal(roll.outcome, factRoll.outcome);

    const outcome = context.outcomes[0];
    assert.equal(outcome.outcome, settled.facts.outcomes[0].outcome);
    assert.equal(outcome.exposureDelta, settled.facts.outcomes[0].exposureDelta);
    assert.equal(outcome.incidentStatus, settled.facts.outcomes[0].incidentStatus);
    assert.equal(outcome.arcaneOfficerStatus, settled.facts.outcomes[0].arcaneOfficerStatus);

    const change = context.exposureChanges["building-1"];
    assert.ok(change, "the exposed building has an exposure change");
    assert.equal(change.from, settled.facts.exposureChanges["building-1"].from);
    assert.equal(change.to, settled.facts.exposureChanges["building-1"].to);
  } finally {
    await app.close();
  }
});

test("an Agent-settled turn exposes settledBy=agent and its unaddressed incidents", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0, { incidents: { "incident-1": openIncident() }, turnStatus: "strategy" });
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    // An empty dispatch plan leaves the open incident unaddressed; the system
    // records it conservatively rather than resolving it for free.
    const settled = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-unaddressed" },
      payload: { expected_city_version: before.city_version }
    }), 200);
    assert.equal(settled.status, "resolved");
    assert.equal(settled.facts.wallClock.settledBy, "agent");
    assert.ok(settled.facts.unaddressedIncidents.length >= 1, "the unhandled incident is recorded as unaddressed");

    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    assert.equal(context.settlement.settledBy, "agent");
    const unaddressed = context.unaddressedIncidents.find((entry) => entry.incidentId === "incident-1");
    assert.ok(unaddressed, "the unhandled incident is visible to the editor");
    assert.equal(unaddressed.factRef, "fact-unaddressed-incident-1");
    assert.equal(unaddressed.status, "failed", "an unaddressed incident takes the authoritative failure path");
    assert.equal(unaddressed.outcome, "failure");
    assert.ok(context.factRefs.includes("fact-unaddressed-incident-1"));
    assert.ok(context.unaddressedIncidents.length >= 1, "every incident the settlement left unhandled is exposed");
  } finally {
    await app.close();
  }
});

test("an Agent can publish a canonical Owl Daily report bound to a resolved turn and read it back", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    const versionBeforeReport = (await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200)).city_version;

    const published = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "report-1" },
      payload: { turn: context.turn, facts_digest: context.factsDigest, report: sampleReport(context) }
    }), 201);
    assert.equal(published.status, "published");
    assert.equal(published.turn, 1);
    assert.equal(published.facts_digest, context.factsDigest);
    assert.equal(published.edition, `Day ${context.turn} Edition`);
    assert.equal(published.report.articles.length, 1);
    assert.equal(published.report.actionBox.length, 1);
    assert.equal(published.report.actionBox[0].incidentRef, "fact-incident-incident-1");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.city_version, versionBeforeReport, "publishing a report never changes city state or advances the version");
    assert.equal(after.turn_status, "resolved", "the turn stays resolved; reports do not open or block anything");

    const history = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports` }), 200);
    assert.equal(history.data.length, 1);
    assert.equal(history.data[0].report_id, published.report_id);
    assert.equal(history.data[0].headline, "City Continues to Grow Beneath the Veil");

    const full = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports/${published.report_id}` }), 200);
    assert.equal(full.report.lead, "The city woke to another day of measured growth.");
  } finally {
    await app.close();
  }
});

test("an Agent cannot author or override system facts in any layer", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);

    const topLevelForgeries = [
      { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context), roll: 20 },
      { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context), outcome: "critical_success" },
      { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context), resourceDelta: { coins: 9999, magic: 9999 } },
      { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context), settled_by: "agent" },
      { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context), last_turn_facts: {} }
    ];
    for (const payload of topLevelForgeries) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/reports`,
        headers: { "idempotency-key": `forge-top-${Math.random()}` },
        payload
      }));
      assert.equal(response.statusCode, 400, JSON.stringify(Object.keys(payload)));
      assert.equal(response.json().code, "UNKNOWN_REPORT_REQUEST_FIELD");
    }

    const reportWithFacts = {
      ...sampleReport(context),
      roll: 20,
      outcome: "success",
      raw_roll: 1,
      modifier: 50,
      resourceDelta: { coins: 1, magic: 1 }
    };
    const nested = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "forge-nested" },
      payload: { turn: 1, facts_digest: context.factsDigest, report: reportWithFacts }
    }));
    assert.equal(nested.statusCode, 422);
    assert.equal(nested.json().code, "INVALID_OWL_REPORT");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    assert.equal(after.factsDigest, context.factsDigest, "forged submissions changed no facts");
    assert.deepEqual(after.resourceDelta, context.resourceDelta);
  } finally {
    await app.close();
  }
});

test("relatedFactRefs that are not part of the turn's ReportContext are rejected", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);

    const cases = [
      { key: "unknown-ref", mutate: (report) => ({ ...report, articles: [{ id: "a1", headline: "H", body: "B", relatedFactRefs: ["fact-incident-does-not-exist"] }] }) },
      { key: "foreign-turn-ref", mutate: (report) => ({ ...report, articles: [{ id: "a1", headline: "H", body: "B", relatedFactRefs: ["fact-incident-other-999"] }] }) },
      { key: "actionbox-unknown-incident", mutate: (report) => ({ ...report, actionBox: [{ id: "ab1", incidentRef: "fact-incident-ghost", factRefs: [] }] }) },
      { key: "tomorrow-unknown", mutate: (report) => ({ ...report, tomorrowWatch: [{ id: "t1", text: "watch", factRefs: ["fact-risk-ghost"] }] }) }
    ];
    for (const { key, mutate } of cases) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/reports`,
        headers: { "idempotency-key": `bad-ref-${key}` },
        payload: { turn: 1, facts_digest: context.factsDigest, report: mutate(sampleReport(context)) }
      }));
      assert.equal(response.statusCode, 422, key);
      assert.equal(response.json().code, "INVALID_OWL_REPORT", key);
      const codes = (response.json().details?.errors ?? []).map((entry) => entry.code);
      assert.ok(codes.some((code) => ["UNKNOWN_FACT_REF", "UNKNOWN_INCIDENT_REF"].includes(code)), `${key} surfaced the ref rejection: ${codes.join(",")}`);
    }

    const history = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports` }), 200);
    assert.equal(history.data.length, 0, "no rejected report was stored");
  } finally {
    await app.close();
  }
});

test("a stale turn, a stale digest, and a wrong turn are all rejected", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);

    const unresolved = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "stale-turn" },
      payload: { turn: 42, facts_digest: context.factsDigest, report: sampleReport(context) }
    }));
    assert.equal(unresolved.statusCode, 422);
    assert.equal(unresolved.json().code, "TURN_NOT_RESOLVED", "a turn without resolved facts cannot be reported");

    const staleDigest = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "stale-digest" },
      payload: { turn: 1, facts_digest: "0".repeat(64), report: sampleReport(context) }
    }));
    assert.equal(staleDigest.statusCode, 422);
    assert.equal(staleDigest.json().code, "FACTS_DIGEST_MISMATCH", "a digest from a different turn cannot be reused");

    const noContextYet = await app.inject(auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=99` }));
    assert.equal(noContextYet.statusCode, 404);
    assert.equal(noContextYet.json().code, "REPORT_CONTEXT_NOT_FOUND");
  } finally {
    await app.close();
  }
});

test("one resolved turn accepts exactly one canonical report; replays are idempotent", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    const payload = { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context) };

    const first = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "canonical-1" },
      payload
    }), 201);
    assert.equal(first.report_id, first.report_id);

    const replay = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "canonical-1" },
      payload
    }), 200);
    assert.equal(replay.idempotent_replay, true, "identical idempotency replay returns the original report");
    assert.equal(replay.report_id, first.report_id);

    const secondAttempt = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "canonical-2" },
      payload: { ...payload, report: { ...payload.report, headline: "A different headline" } }
    }));
    assert.equal(secondAttempt.statusCode, 409);
    assert.equal(secondAttempt.json().code, "REPORT_ALREADY_EXISTS", "a different report for the same turn is rejected");

    const history = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports` }), 200);
    assert.equal(history.data.length, 1, "only one canonical report exists for the turn");
  } finally {
    await app.close();
  }
});

test("a failed report submission changes no gameplay state", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    const snapshotBefore = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);

    const bad = await app.inject(auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "bad-report" },
      payload: { turn: 1, facts_digest: context.factsDigest, report: { ...sampleReport(context), articles: [{ id: "a", headline: "H", body: "" }] } }
    }));
    assert.equal(bad.statusCode, 422);

    const snapshotAfter = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.deepEqual(snapshotAfter.last_turn_facts, snapshotBefore.last_turn_facts, "frozen facts are unchanged by a failed report");
    assert.equal(snapshotAfter.city_version, snapshotBefore.city_version, "no city version moved on a failed report");
    assert.equal(snapshotAfter.turn, snapshotBefore.turn, "no turn advanced on a failed report");
    assert.equal(snapshotAfter.turn_status, "resolved");
  } finally {
    await app.close();
  }
});

test("publishing a report never blocks the turn scheduler from opening the next turn", async () => {
  const clock = fakeClock();
  const schedulerConfig = { ...config, turnCooldownSeconds: TURN_COOLDOWN_SECONDS };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config: schedulerConfig, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config: schedulerConfig, now: clock.now, logger: { error() {} } });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0, { incidents: { "incident-1": openIncident() } });
    await scheduler.pollOnce();
    clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1000);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "report-no-block" },
      payload: { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context) }
    }), 201);

    clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1000);
    const results = await scheduler.pollOnce();
    assert.ok(results.some((entry) => entry.status === "opened"), "the next turn opened despite the published report");

    const after = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(after.turn_status, "open", "turn scheduler is independent of reporting");
    assert.equal(after.turn, 1, "the turn number advanced once at resolve, not by reporting");

    const history = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports` }), 200);
    assert.equal(history.data.length, 1, "the canonical report survived the next turn opening");
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test("an Agent can backfill a report for an earlier resolved turn after the city moved on", async () => {
  const clock = fakeClock();
  const schedulerConfig = { ...config, turnCooldownSeconds: TURN_COOLDOWN_SECONDS };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config: schedulerConfig, now: clock.now, logger: false });
  const scheduler = createTurnScheduler({ repository, config: schedulerConfig, now: clock.now, logger: { error() {} } });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    await scheduler.pollOnce();
    clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1000);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);

    // The next turn opens and settles too, each past its own cooldown gate.
    clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1000);
    const opened = await scheduler.pollOnce();
    assert.equal(opened.filter((entry) => entry.status === "opened").length, 1);
    const turnTwo = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(turnTwo.turn, 1);
    assert.equal(turnTwo.turn_status, "open");
    clock.advance(TURN_COOLDOWN_SECONDS * 1000 + 1000);
    await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/strategy/resolve`,
      headers: { "idempotency-key": "resolve-two" },
      payload: { expected_city_version: turnTwo.city_version }
    }), 200);

    const turnOneContext = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    assert.equal(turnOneContext.turn, 1, "turn 1 facts are still available after turn 2 settled");

    const published = await json(app, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "backfill-1" },
      payload: { turn: 1, facts_digest: turnOneContext.factsDigest, report: sampleReport(turnOneContext) }
    }), 201);
    assert.equal(published.turn, 1);
  } finally {
    scheduler.stop();
    await app.close();
  }
});

test("report and facts binding survive a repository restart", async () => {
  const storageDir = mkdtempSync(path.join(os.tmpdir(), "magictown-owl-"));
  const storagePath = path.join(storageDir, "state.json");

  const first = createMemoryRepository(config, { storagePath });
  const app1 = await createApp({ repository: first, config });
  try {
    const { city, agent, owner } = await openCity(first, app1);
    await seedState(first, owner, city.id, 0);
    const before = await json(app1, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app1, agent, city.id, before);
    const context = await json(app1, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    await json(app1, auth(agent, {
      method: "POST",
      url: `/api/v1/cities/${city.id}/reports`,
      headers: { "idempotency-key": "restart-report" },
      payload: { turn: 1, facts_digest: context.factsDigest, report: sampleReport(context) }
    }), 201);
  } finally {
    await app1.close();
  }

  const second = createMemoryRepository(config, { storagePath });
  const app2 = await createApp({ repository: second, config });
  try {
    const [row] = await second.listLocalCityAccess();
    const agent = { access_token: row.access_token };
    const history = await json(app2, auth(agent, { method: "GET", url: `/api/v1/cities/${row.id}/reports` }), 200);
    assert.equal(history.data.length, 1, "the report survived the restart");

    const context = await json(app2, auth(agent, { method: "GET", url: `/api/v1/cities/${row.id}/report-context` }), 200);
    assert.equal(history.data[0].facts_digest, context.factsDigest, "the stored report still binds to the same turn facts");

    const full = await json(app2, auth(agent, { method: "GET", url: `/api/v1/cities/${row.id}/reports/${history.data[0].report_id}` }), 200);
    assert.equal(full.report.articles.length, 1, "full report content is intact after restart");
  } finally {
    await app2.close();
  }
});

test("OpenAPI and the playbook describe the newspaper composition", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const openapi = await json(app, { method: "GET", url: "/openapi.json" }, 200);
    for (const route of ["/cities/{city_id}/report-context", "/cities/{city_id}/reports", "/cities/{city_id}/reports/{report_id}"]) {
      assert.ok(openapi.paths[route], `missing ${route}`);
    }
    for (const schema of ["ReportContext", "OwlReport", "OwlReportArticle", "OwlReportBrief", "OwlReportActionBoxEntry", "OwlReportTomorrowWatchEntry", "OwlReportSubmitRequest", "OwlReportResponse", "OwlReportSummary"]) {
      assert.ok(openapi.components.schemas[schema], `missing schema ${schema}`);
    }
    const reportSchema = openapi.components.schemas.OwlReport.properties;
    for (const field of ["masthead", "edition", "headline", "subheadline", "lead", "articles", "briefs", "actionBox", "tomorrowWatch"]) {
      assert.ok(field in reportSchema, `OwlReport is missing ${field}`);
    }
    const playbook = await (await app.inject({ method: "GET", url: "/agent/playbook.md" })).body;
    assert.ok(playbook.includes("/report-context"), "playbook documents the report context endpoint");
    assert.ok(playbook.includes("/reports"), "playbook documents the reports endpoints");
    assert.ok(/Owl Report|report-context|OwlReport/.test(playbook), "playbook documents the report workflow");
  } finally {
    await app.close();
  }
});

test("validateOwlReport is a pure function and normalization fills defaults deterministically", async () => {
  const context = buildReportContext({
    cityId: "city-1",
    state: {
      buildings: { "building-1": { program: { name: "Lantern Tower" } } },
      gameplay: { arcaneOfficers: { "officer-vesper": { name: "Vesper" } } }
    },
    facts: {
      turn: 3,
      wallClock: { settledBy: "agent", openedAt: "2026-01-01T00:00:00.000Z", resolvedAt: "2026-01-01T00:05:00.000Z" },
      resourceDelta: { coins: 30, magic: 8 },
      populationDelta: { muggles: { current: 2, capacity: 4 }, wizards: { current: 1, capacity: 3 } },
      buildingsStarted: [],
      buildingsCompleted: [],
      exposureChanges: { "building-1": { from: 10, to: 8, delta: -2, pressure: 1, concealment: 2, sealed: false } },
      incidents: [openIncident()],
      unaddressedIncidents: [],
      assignments: [{ incidentId: "incident-1", arcaneOfficerId: "officer-vesper", rationale: "specialist" }],
      rolls: [{ incidentId: "incident-1", arcaneOfficerId: "officer-vesper", attribute: "investigation", rawRoll: 16, attributeValue: 3, specialtyBonus: 2, modifier: 0, difficulty: 3, outcome: "success" }],
      outcomes: [{ incidentId: "incident-1", buildingId: "building-1", arcaneOfficerId: "officer-vesper", outcome: "success", exposureDelta: -2, incidentStatus: "resolved", arcaneOfficerStatus: "available" }],
      sealedBuildings: [],
      nextRisks: [{ buildingId: "building-1", exposure: 8, pressure: 1, concealment: 2 }]
    }
  });
  assert.ok(context.factRefs.includes("fact-risk-building-1"));
  assert.ok(Object.isFrozen(context), "the domain ReportContext is deep-frozen");
  assert.ok(Object.isFrozen(context.incidents[0]), "nested context entries are deep-frozen");
  assert.throws(() => { context.resourceDelta.coins = 9999; }, TypeError, "an Agent cannot mutate the frozen ReportContext");

  const valid = sampleReport(context);
  assert.equal(validateOwlReport(valid, context).ok, true);

  const missing = validateOwlReport({ ...valid, articles: [{ id: "a", headline: "H", body: "B", relatedFactRefs: ["fact-roll-ghost"] }] }, context);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((entry) => entry.code === "UNKNOWN_FACT_REF"));

  const importance = validateOwlReport({ ...valid, articles: [{ id: "a", headline: "H", body: "B", importance: "splash" }] }, context);
  assert.equal(importance.ok, false);
  assert.ok(importance.errors.some((entry) => entry.code === "UNSUPPORTED_IMPORTANCE"));
});

test("a later change to an incident never rewrites an earlier turn's ReportContext", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);

    const turnOne = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    const frozenIncident = turnOne.incidents.find((entry) => entry.id === "incident-1");
    assert.ok(frozenIncident, "the dispatched incident is snapshotted into the frozen facts");
    assert.ok(["resolved", "failed"].includes(frozenIncident.status), "the frozen snapshot records the settlement-time status");
    assert.equal(frozenIncident.dc, 10);
    assert.equal(frozenIncident.summary, "Unresolved magical anomaly reported near Lantern Tower; origin requires investigation.");
    const frozenDigest = turnOne.factsDigest;

    // The live city keeps evolving: the same incident escalates, changes
    // difficulty, and gains a different summary after turn 1.
    const current = await repository.getCity(owner, city.id);
    await repository.transactCity({
      principal: owner,
      cityId: city.id,
      endpoint: "test/drift-incident",
      idempotencyKey: "drift-1",
      requestBody: {},
      expectedVersion: current.state.version
    }, async ({ state }) => {
      state.gameplay.incidents["incident-1"] = {
        ...state.gameplay.incidents["incident-1"],
        status: "escalated",
        difficulty: 9,
        summary: "A completely different, escalated story."
      };
      return { nextState: state, response: { drifted: true } };
    });

    const reread = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context?turn=1` }), 200);
    assert.equal(reread.factsDigest, frozenDigest, "the facts digest is unchanged after the live incident drifted");
    const rereadIncident = reread.incidents.find((entry) => entry.id === "incident-1");
    assert.deepEqual(rereadIncident, frozenIncident, "turn 1's incident content is byte-identical after the city moved on");
  } finally {
    await app.close();
  }
});

test("system-looking extra fields inside every newspaper section are rejected", async () => {
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const { city, agent, owner } = await openCity(repository, app);
    await seedState(repository, owner, city.id, 0);
    const before = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    await dispatchAndResolve(app, agent, city.id, before);
    const context = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/report-context` }), 200);
    const base = sampleReport(context);

    const cases = [
      { key: "masthead", mutate: (r) => ({ ...r, masthead: { title: "Herald", roll: 20, outcome: "success" } }) },
      { key: "article", mutate: (r) => ({ ...r, articles: [{ id: "a1", headline: "H", body: "B", roll: 20, outcome: "critical_success", resourceDelta: { coins: 9 } }] }) },
      { key: "brief", mutate: (r) => ({ ...r, briefs: [{ id: "b1", text: "T", exposure_delta: -5, modifier: 3 }] }) },
      { key: "actionbox", mutate: (r) => ({ ...r, actionBox: [{ id: "ab1", incidentRef: "fact-incident-incident-1", factRefs: [], modifier: 99, difficulty: 3, settled_by: "deadline" }] }) },
      { key: "tomorrow", mutate: (r) => ({ ...r, tomorrowWatch: [{ id: "t1", text: "watch", settled_by: "agent", raw_roll: 16 }] }) }
    ];
    for (const { key, mutate } of cases) {
      const response = await app.inject(auth(agent, {
        method: "POST",
        url: `/api/v1/cities/${city.id}/reports`,
        headers: { "idempotency-key": `nested-forge-${key}` },
        payload: { turn: 1, facts_digest: context.factsDigest, report: mutate(structuredClone(base)) }
      }));
      assert.equal(response.statusCode, 422, key);
      assert.equal(response.json().code, "INVALID_OWL_REPORT", key);
      const codes = (response.json().details?.errors ?? []).map((entry) => entry.code);
      assert.ok(codes.includes("UNKNOWN_REPORT_FIELD"), `${key} surfaced unknown-field rejection: ${codes.join(",")}`);
    }

    const history = await json(app, auth(agent, { method: "GET", url: `/api/v1/cities/${city.id}/reports` }), 200);
    assert.equal(history.data.length, 0, "no forged report was stored");
  } finally {
    await app.close();
  }
});

function fakeClock(start = "2026-08-01T00:00:00.000Z") {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms),
    advance: (amount) => { ms += amount; },
    iso: () => new Date(ms).toISOString()
  };
}

function auth(account, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${account.access_token}` } };
}

async function json(app, request, statusCode) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, statusCode, response.body);
  return response.json();
}
