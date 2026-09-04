import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const config = {
  publicBaseUrl: "https://example.test",
  capabilityTtlMinutes: 30,
  credentialTtlDays: 90,
  turnCooldownSeconds: 60
};

test("previewing a capability with GET or HEAD never consumes it", async () => {
  const { app, link } = await fixture();
  const url = new URL(link.connect_url).pathname;

  try {
    const browserPreview = await app.inject({
      method: "GET",
      url,
      headers: { accept: "text/html,application/xhtml+xml" }
    });
    assert.equal(browserPreview.statusCode, 200);
    assert.match(browserPreview.headers["content-type"], /^text\/html/);
    assert.match(browserPreview.body, /has <strong>not<\/strong> been used yet/);
    assert.match(browserPreview.body, /method="post"/);
    assert.match(browserPreview.body, /fetch\(form\.action/);
    assert.match(browserPreview.body, /credential-result/);
    const browserScript = browserPreview.body.match(/<script>([\s\S]+)<\/script>/)?.[1];
    assert.ok(browserScript);
    assert.doesNotThrow(() => new Function(browserScript));

    const machinePreview = await app.inject({
      method: "GET",
      url,
      headers: { accept: "application/json" }
    });
    assert.equal(machinePreview.statusCode, 200);
    assert.deepEqual(machinePreview.json(), {
      status: "confirmation_required",
      message: "This one-time link has not been used. POST this exact URL to exchange it for an Agent credential.",
      exchange_method: "POST",
      exchange_url: link.connect_url
    });

    const head = await app.inject({ method: "HEAD", url });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");

    const exchanged = await app.inject({
      method: "POST",
      url,
      headers: { accept: "application/json" }
    });
    assert.equal(exchanged.statusCode, 200, exchanged.body);
    assert.match(exchanged.json().access_token, /^mta_/);

    const reused = await app.inject({ method: "POST", url });
    assert.equal(reused.statusCode, 410);
    assert.equal(reused.json().code, "CAPABILITY_CONSUMED");
  } finally {
    await app.close();
  }
});

test("an explicit browser POST renders the issued credential", async () => {
  const { app, link, city } = await fixture();
  const url = new URL(link.connect_url).pathname;

  try {
    const response = await app.inject({
      method: "POST",
      url,
      headers: { accept: "text/html,application/xhtml+xml" }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers["content-type"], /^text\/html/);
    assert.match(response.body, /Agent connected/);
    assert.match(response.body, new RegExp(city.id));
    assert.match(response.body, /mta_/);
    assert.match(response.headers["cache-control"], /no-store/);
    assert.equal(response.headers["referrer-policy"], "no-referrer");
  } finally {
    await app.close();
  }
});

async function fixture() {
  const repository = createMemoryRepository(config);
  const player = await repository.createPlayer("Connection Safety Owner");
  const principal = await repository.authenticate(player.access_token);
  const city = await repository.createCity(principal, { name: "Connection Safety City" });
  const link = await repository.createCapability(principal, city.id);
  const app = await createApp({ repository, config, logger: false });
  return { app, city, link };
}
