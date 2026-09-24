import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "pngjs";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

test("Agent discovers optional PNG, authenticates, checks revision and leaves city state unchanged", async () => {
  const config = { publicBaseUrl: "http://127.0.0.1:4183", assetProvider: "codex-manual", workerPollMs: 5 };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  const call = async (method, url, payload, token, status = 200) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    assert.equal(response.statusCode, status, response.body);
    return response;
  };
  try {
    const player = (await call("POST", "/api/v1/players", { display_name: "Visualizer" }, null, 201)).json();
    const city = (await call("POST", "/api/v1/cities", { name: "Visualizer City" }, player.access_token, 201)).json();
    const link = (await call("POST", `/api/v1/cities/${city.id}/agent-links`, {}, player.access_token, 201)).json();
    const agent = (await call("POST", `/connect/${link.connect_url.split("/").at(-1)}`, undefined)).json();
    const token = agent.access_token, base = `/api/v1/cities/${city.id}`;
    const design = (await call("POST", `${base}/building-designs`, {
      site: { anchor_cell_id: "cell-10-10", footprint: "1x1", entrance: "south" },
      intent: { name: "Test Shop", purpose: "shop", frontage: "display" }
    }, token, 201)).json();
    const imageUrl = design.visualization.url.replace(config.publicBaseUrl, "");
    assert.equal(design.visualization.optional, true);
    const before = (await call("GET", `${base}/snapshot`, undefined, token)).json();
    await call("GET", imageUrl, undefined, null, 401);
    const image = await call("GET", imageUrl, undefined, token);
    assert.match(image.headers["content-type"], /^image\/png/);
    assert.equal(image.headers["cache-control"], "no-store");
    assert.equal(image.headers["x-design-hash"], design.specHash);
    assert.equal(image.headers["x-design-revision"], "1");
    assert.equal(PNG.sync.read(image.rawPayload).width, 512);
    const after = (await call("GET", `${base}/snapshot`, undefined, token)).json();
    assert.equal(before.city_version, after.city_version);
    assert.deepEqual(before.resources, after.resources);
    assert.equal((await call("GET", `${base}/building-designs/${design.id}`, undefined, token)).json().status, "editable");
    for (const query of ["view=invalid", "size=999999", "revision=0", "revision=abc", "view=front&view=back"]) {
      await call("GET", `${base}/building-designs/${design.id}/visualization?${query}`, undefined, token, 400);
    }
    const otherCity = (await call("POST", "/api/v1/cities", { name: "Other City" }, player.access_token, 201)).json();
    const denied = await app.inject({ method: "GET", url: imageUrl.replace(city.id, otherCity.id), headers: { authorization: `Bearer ${token}` } });
    assert.ok([403, 404].includes(denied.statusCode));
    const changed = (await call("POST", `${base}/building-designs/${design.id}/revisions`, { expected_revision: 1, operations: [{ op: "add_floor", count: 1 }] }, token, 201)).json();
    const stale = (await call("GET", imageUrl, undefined, token, 409)).json();
    assert.equal(stale.code, "BUILDING_DESIGN_REVISION_CONFLICT");
    const revisedUrl = changed.visualization.url.replace(config.publicBaseUrl, "");
    const revisedImage = await call("GET", revisedUrl, undefined, token);
    assert.equal(revisedImage.headers["x-design-revision"], "2");
    assert.notDeepEqual(revisedImage.rawPayload, image.rawPayload);
    const catalog = (await call("GET", "/agent/api/operations")).json();
    const operation = catalog.operations.find((entry) => entry.path.endsWith("/visualization"));
    assert.ok(operation);
    const detail = (await call("GET", `/agent/api/operations/${operation.operation_id}`)).json();
    const contract = Object.values(detail.paths)[0].get;
    assert.ok(contract.responses[200].content["image/png"]);
  } finally { await app.close(); }
});
