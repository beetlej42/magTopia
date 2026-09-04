import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const config = { publicBaseUrl: "http://127.0.0.1:4183", assetOutputRoot: "/tmp/magictown-officer-api", assetProvider: "codex-manual", workerPollMs: 5, gameplaySeed: 3 };
const auth = (token, request) => ({ ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${token}` } });
async function json(app, request, status) { const response = await app.inject(request); assert.equal(response.statusCode, status, response.body); return response.json(); }

test("strategy officer recruitment is read-only on GET and candidate-only/idempotent on POST", async () => {
  const repository = createMemoryRepository(config); const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Officer API" } }, 201);
    const city = await json(app, auth(player.access_token, { method: "POST", url: "/api/v1/cities", payload: { name: "Officer City", resources: { coins: 500 } } }), 201);
    const link = await json(app, auth(player.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const agent = await json(app, { method: "POST", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
    const owner = await repository.authenticate(player.access_token);
    await repository.transactCity({ principal: owner, cityId: city.id, endpoint: "test/officer-seed", idempotencyKey: "seed", requestBody: {}, expectedVersion: 0 }, async ({ state }) => {
      state.gameplay.population.wizards.current = 30;
      state.buildings.ministry = { id: "ministry", status: "completed", program: { canonicalProgram: "ministry_of_magic", name: "Ministry of Magic" } };
      return { nextState: state, response: { seeded: true } };
    });
    const before = await json(app, auth(agent.access_token, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    const storedBeforeRead = (await repository.getCity(owner, city.id)).state;
    assert.deepEqual(storedBeforeRead.gameplay.arcaneOfficerRecruitment, { schemaVersion: 1, window: null, candidates: {} });
    const readAgain = await json(app, auth(agent.access_token, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(readAgain.city_version, before.city_version);
    assert.deepEqual(readAgain.strategy.arcane_officer_recruitment.candidates, before.strategy.arcane_officer_recruitment.candidates);
    const candidateId = before.strategy.arcane_officer_recruitment.candidates[0].candidate_id;
    const forged = await app.inject(auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "forged" }, payload: { expected_city_version: before.city_version, candidate_id: candidateId, name: "forged" } }));
    assert.equal(forged.statusCode, 400);
    const recruited = await json(app, auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "recruit-1" }, payload: { expected_city_version: before.city_version, candidate_id: candidateId, actor_note: "staffing" } }), 200);
    assert.equal(recruited.cost_coins, 150);
    assert.equal(recruited.strategy.arcane_officer_recruitment.candidates.length, 2);
    assert.equal(recruited.strategy.arcane_officer_recruitment.roster_size, 1);
    assert.equal(recruited.officer.name, before.strategy.arcane_officer_recruitment.candidates[0].identity.name);
    const replay = await json(app, auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "recruit-1" }, payload: { expected_city_version: before.city_version, candidate_id: candidateId, actor_note: "staffing" } }), 200);
    assert.equal(replay.idempotent_replay, true);
    assert.equal((await repository.getCity(owner, city.id)).state.resources.coins, 350);
    const duplicate = await app.inject(auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "recruit-duplicate" }, payload: { expected_city_version: recruited.city_version_after, candidate_id: candidateId } }));
    assert.equal(duplicate.statusCode, 422);
    assert.equal(duplicate.json().code, "ARCANE_OFFICER_CANDIDATE_INVALID");
    const current = await repository.getCity(owner, city.id);
    await repository.transactCity({ principal: owner, cityId: city.id, endpoint: "test/officer-insufficient", idempotencyKey: "insufficient", requestBody: {}, expectedVersion: current.row.city_version }, async ({ state }) => ({ nextState: { ...state, resources: { ...state.resources, coins: 149 }, gameplay: { ...state.gameplay, resources: { ...state.gameplay.resources, coins: 149 } } }, response: {} }));
    const afterInsufficientSeed = await repository.getCity(owner, city.id);
    const insufficient = await app.inject(auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "insufficient-hire" }, payload: { expected_city_version: afterInsufficientSeed.row.city_version, candidate_id: before.strategy.arcane_officer_recruitment.candidates[1].candidate_id } }));
    assert.equal(insufficient.statusCode, 422);
    assert.equal(insufficient.json().code, "INSUFFICIENT_COINS");
    const stale = await app.inject(auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "recruit-stale" }, payload: { expected_city_version: before.city_version, candidate_id: before.strategy.arcane_officer_recruitment.candidates[1].candidate_id } }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, "CITY_VERSION_CONFLICT");
  } finally { await app.close(); }
});

test("locked strategy context does not expose immediately recruitable candidates", async () => {
  const repository = createMemoryRepository(config); const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Locked API" } }, 201);
    const city = await json(app, auth(player.access_token, { method: "POST", url: "/api/v1/cities", payload: { name: "Locked City" } }), 201);
    const link = await json(app, auth(player.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/agent-links`, payload: {} }), 201);
    const agent = await json(app, { method: "POST", url: `/connect/${link.connect_url.split("/").at(-1)}` }, 200);
    const strategy = await json(app, auth(agent.access_token, { method: "GET", url: `/api/v1/cities/${city.id}/strategy` }), 200);
    assert.equal(strategy.strategy.arcane_officer_recruitment.unlocked, false);
    assert.deepEqual(strategy.strategy.arcane_officer_recruitment.candidates, []);
    const lockedPost = await app.inject(auth(agent.access_token, { method: "POST", url: `/api/v1/cities/${city.id}/strategy/recruit-officer`, headers: { "idempotency-key": "locked-hire" }, payload: { expected_city_version: strategy.city_version, candidate_id: "not-current" } }));
    assert.equal(lockedPost.statusCode, 422);
    assert.equal(lockedPost.json().code, "ARCANE_OFFICER_RECRUITMENT_LOCKED");
  } finally { await app.close(); }
});
