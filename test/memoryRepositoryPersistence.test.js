import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const config = {
  publicBaseUrl: "http://127.0.0.1:4183",
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90
};

test("Agent LAN repository persists identities, cities, credentials, mutations, and receipts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "magictown-agent-lan-"));
  const storagePath = path.join(directory, "state.json");
  try {
    const first = createMemoryRepository(config, { storagePath });
    const player = await first.createPlayer("Persistent Owner");
    const owner = await first.authenticate(player.access_token);
    const city = await first.createCity(owner, {
      name: "Persistent City",
      resources: { coins: 9000, timber: 8000, stone: 7000 }
    });
    const link = await first.createCapability(owner, city.id, { scopes: ["city:read", "city:build"] });
    const secret = link.connect_url.split("/").at(-1);
    const credential = await first.exchangeCapability(secret);
    const agent = await first.authenticate(credential.access_token);
    const mutation = await first.transactCity({
      principal: agent,
      cityId: city.id,
      endpoint: "persistence-test",
      idempotencyKey: "persist-1",
      requestBody: { operation: "set-resource" },
      expectedVersion: 0
    }, async ({ state }) => {
      const nextState = structuredClone(state);
      nextState.version = 1;
      nextState.resources.coins = 8123;
      return { nextState, response: { accepted: true, city_version: 1 } };
    });
    assert.deepEqual(mutation, { accepted: true, city_version: 1 });

    const restored = createMemoryRepository(config, { storagePath });
    assert.equal((await restored.authenticate(player.access_token)).id, owner.id);
    assert.equal((await restored.authenticate(credential.access_token)).cityId, city.id);
    const restoredCity = await restored.getCity(agent, city.id);
    assert.equal(restoredCity.state.version, 1);
    assert.equal(restoredCity.state.resources.coins, 8123);
    await assert.rejects(() => restored.exchangeCapability(secret), (error) => error.code === "CAPABILITY_CONSUMED");

    const replay = await restored.transactCity({
      principal: agent,
      cityId: city.id,
      endpoint: "persistence-test",
      idempotencyKey: "persist-1",
      requestBody: { operation: "set-resource" },
      expectedVersion: 0
    }, async () => { throw new Error("persisted receipt was not replayed"); });
    assert.equal(replay.idempotent_replay, true);

    const bootstrap = await restored.ensureSandbox({
      displayName: "Persistent Owner",
      cityInput: { name: "Persistent City" },
      scopes: ["city:read", "city:build"]
    });
    assert.equal(bootstrap.player.access_token, player.access_token);
    assert.equal(bootstrap.city.id, city.id);
    assert.equal(restored.listLocalCityAccess().at(-1).access_token, credential.access_token);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
