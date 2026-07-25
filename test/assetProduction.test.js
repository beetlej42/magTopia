import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateAssetImage } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";

const job = {
  provider: "qwen-image",
  spec: {
    creative_brief: "A compact moonflower cottage.",
    footprint: "1x1"
  }
};

test("DashScope key selects the qwen-image provider by default", () => {
  const config = loadConfig({ DASHSCOPE_API_KEY: "sk-test" });
  assert.equal(config.assetProvider, "qwen-image");
  assert.equal(config.dashscopeImageModel, "qwen-image-2.0");
  assert.equal(config.dashscopeBaseUrl, "https://dashscope.aliyuncs.com/api/v1");
});

test("missing DashScope key retains the codex-manual fallback", () => {
  const config = loadConfig({});
  assert.equal(config.assetProvider, "codex-manual");
});

test("qwen-image provider calls the native multimodal endpoint and downloads its PNG", async () => {
  const fixture = await readFile("public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        request_id: "request-test",
        output: {
          choices: [{
            message: {
              content: [{ image: "https://dashscope-result.example/generated.png" }]
            }
          }]
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(fixture, { status: 200, headers: { "content-type": "image/png", "content-length": String(fixture.length) } });
  };

  const result = await generateAssetImage(job, {
    dashscopeApiKey: "sk-test",
    dashscopeBaseUrl: "https://dashscope.aliyuncs.com/api/v1/",
    dashscopeImageModel: "qwen-image-2.0",
    dashscopeImageSize: "1024*1024",
    fetch: fakeFetch
  });

  assert.deepEqual(result, fixture);
  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-test");
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "qwen-image-2.0");
  assert.equal(request.input.messages[0].role, "user");
  assert.match(request.input.messages[0].content[0].text, /#FF00FF/);
  assert.deepEqual(request.parameters, {
    negative_prompt: "low resolution, blurry, distorted architecture, malformed roof, neighbouring buildings, people, vehicles, text, logo, watermark, photorealism, black outlines, cropped building, non-magenta background",
    prompt_extend: false,
    watermark: false,
    size: "1024*1024",
    n: 1
  });
  assert.equal(calls[1].url, "https://dashscope-result.example/generated.png");
});

test("qwen-image provider surfaces malformed DashScope responses", async () => {
  await assert.rejects(
    generateAssetImage(job, {
      dashscopeApiKey: "sk-test",
      dashscopeBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
      fetch: async () => new Response(JSON.stringify({ request_id: "bad-result", output: {} }), { status: 200 })
    }),
    (error) => error.code === "DASHSCOPE_IMAGE_RESPONSE_INVALID" && error.retryable === true
  );
});
