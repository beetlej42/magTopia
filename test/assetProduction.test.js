import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ASSET_PROMPT_VERSION, buildAssetPrompt, generateAssetBundle, generateAssetImage, normalizeAssetVolume, prepareAssetMaps, resolveAssetGuideplate, resolveStyleReferences } from "../apps/server/asset-production.js";
import { loadConfig } from "../apps/server/config.js";

const job = {
  provider: "qwen-image",
  spec: {
    creative_brief: "A compact moonflower cottage.",
    footprint: "1x1",
    guide_volume: "1x1x2"
  }
};

test("guide volume uses city-cell units and produces immutable world dimensions", () => {
  assert.deepEqual(normalizeAssetVolume("1x1x2", "1x1"), {
    id: "1x1x2",
    gridDimensions: { length: 1, width: 1, height: 2, unit: "city_cell" },
    dimensions: { length: 4, width: 4, height: 8, unit: "world" }
  });
  assert.match(buildAssetPrompt(job.spec), /exactly 1x1x2 city-grid units \(4×4×8 world units\)/);
  assert.match(buildAssetPrompt(job.spec), /exactly two above-ground storeys/);
  assert.match(buildAssetPrompt(job.spec), /camera-facing south\/front facade/);
  assert.match(buildAssetPrompt(job.spec), /real opaque main entrance at that front reference-door position/);
  assert.match(buildAssetPrompt({ ...job.spec, guide_volume: "1x1x1" }), /create one small, one-storey detached building/);
  assert.match(buildAssetPrompt({ ...job.spec, guide_volume: "1x1x1" }), /Do not add a second row of facade windows/);
  assert.throws(() => normalizeAssetVolume("4x1x1", "4x1"), /base length and width must be from 1 to 3/);
  assert.throws(() => normalizeAssetVolume("2x1x1", "1x1"), /must match site footprint/);
  assert.throws(() => normalizeAssetVolume("1x1x1.5", "1x1"), /must be integer/);
});

test("generated guideplate carries storey and standard-door scale references", async () => {
  const guideplate = await resolveAssetGuideplate({ footprint: "1x1", guide_volume: "1x1x1" });
  assert.equal(guideplate.manifest.guideVersion, "absolute-scale-v4");
  assert.ok(guideplate.manifest.envelopeBoundsUv.top > guideplate.manifest.baseAnchorsUv.near[1]);
  assert.equal(guideplate.manifest.scaleContract.heightUnitMeaning, "one normal above-ground storey");
  assert.deepEqual(guideplate.manifest.scaleContract.referenceDoor, { width: 0.9, height: 2.2, unit: "world" });
  assert.deepEqual(guideplate.manifest.facadeContract, {
    cameraFacingFront: "south",
    referenceDoorFace: "south",
    referenceDoorIsOnCameraFacingFront: true,
    productionEntranceMustMatchReferenceDoor: true
  });
});

test("production style reference resolves to the visual north star", async () => {
  const stylePack = await resolveStyleReferences();
  assert.equal(stylePack.id, "starter-cottage-asset-style-v1");
  assert.deepEqual(stylePack.references.map((reference) => reference.role), ["asset_rendering_standard"]);
  assert.deepEqual(stylePack.references.map((reference) => reference.mimeType), ["image/png"]);
  assert.ok(stylePack.references.every((reference) => reference.bytes.length > 10_000));
  assert.equal(ASSET_PROMPT_VERSION, "magic-london-absolute-scale-art-v6");
});

test("DashScope key selects the qwen-image provider by default", () => {
  const config = loadConfig({ DASHSCOPE_API_KEY: "sk-test" });
  assert.equal(config.assetProvider, "qwen-image");
  assert.equal(config.dashscopeImageModel, "qwen-image-2.0");
  assert.equal(config.dashscopeBaseUrl, "https://dashscope.aliyuncs.com/api/v1");
  assert.equal(config.dashscopeStyleReferenceEnabled, false);
});

test("Hunyuan image key takes precedence for automatic production", () => {
  const config = loadConfig({ HUNYUAN_IMAGE_API_KEY: "sk-hunyuan", DASHSCOPE_API_KEY: "sk-dashscope" });
  assert.equal(config.assetProvider, "hunyuan-image");
  assert.equal(config.hunyuanImageModel, "hy-image-v3.0");
  assert.equal(config.hunyuanImageResolution, "1024:1024");
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
  assert.equal(request.input.messages[0].content.length, 2);
  assert.match(request.input.messages[0].content[0].image, /^data:image\/png;base64,/);
  assert.match(request.input.messages[0].content[1].text, /只输入了一张图。请编辑图1/);
  assert.match(request.input.messages[0].content[1].text, /London brick red #A95E4A/);
  assert.match(request.input.messages[0].content[1].text, /strict composition and absolute-scale template/);
  assert.match(request.input.messages[0].content[1].text, /emissive night-light mask/);
  assert.match(request.input.messages[0].content[1].text, /1x1x2 city-grid units/);
  assert.deepEqual(request.parameters, {
    negative_prompt: "photorealistic architecture, miniature photography, toy model, glossy PBR render, dense individual bricks, individual roof shingles, photographic microtexture, surface noise, heavy ambient occlusion, dramatic studio lighting, hard black cast shadow, cinematic rim light, magenta light spill, background gradient, low resolution, blurry, distorted architecture, malformed roof, inconsistent human scale, miniature doors, miniature windows, extra storeys, compressed floors, neighbouring buildings, people, vehicles, letters, words, labels, numbers, percentages, symbols, coordinate marks, guide lines, storey bands, ghost reference door, arrows, annotations, logo, watermark, black outlines, cropped building, non-magenta background",
    prompt_extend: false,
    watermark: false,
    size: "1024*1024",
    n: 1
  });
  assert.equal(calls[1].url, "https://dashscope-result.example/generated.png");
});

test("wan-image provider omits unsupported Qwen-only parameters", async () => {
  const fixture = await readFile("public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        request_id: "request-wan-test",
        output: {
          choices: [{
            message: {
              content: [{ image: "https://dashscope-result.example/wan.png" }]
            }
          }]
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(fixture, { status: 200, headers: { "content-type": "image/png", "content-length": String(fixture.length) } });
  };

  const result = await generateAssetImage({
    ...job,
    provider: "wan-image",
    model: "wan2.7-image",
    prompt: "Edit Image 1.",
    parameters: { seed: 42, bbox_list: [[[0, 0, 1023, 1023]]] }
  }, {
    dashscopeApiKey: "sk-test",
    dashscopeBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    dashscopeImageSize: "1024*1024",
    fetch: fakeFetch
  });

  assert.deepEqual(result, fixture);
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "wan2.7-image");
  assert.equal(request.input.messages[0].content.at(-1).text, "Edit Image 1.");
  assert.deepEqual(request.parameters, {
    size: "1024*1024",
    n: 1,
    watermark: false,
    seed: 42,
    bbox_list: [[[0, 0, 1023, 1023]]]
  });
  assert.equal("negative_prompt" in request.parameters, false);
  assert.equal("prompt_extend" in request.parameters, false);
});

test("hunyuan-image production generates an aligned day pair and deterministic light map", async () => {
  const fixture = await readFile("public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
  const calls = [];
  let submission = 0;
  const fakeFetch = async (url, options = {}) => {
    const request = { url: String(url), options };
    calls.push(request);
    if (request.url.endsWith("/submit")) {
      submission += 1;
      return new Response(JSON.stringify({ id: `job-${submission}`, request_id: `request-${submission}` }), { status: 200 });
    }
    if (request.url.endsWith("/query")) {
      const body = JSON.parse(options.body);
      const index = body.id === "job-1" ? 1 : 2;
      return new Response(JSON.stringify({
        status: "completed",
        data: [{ url: `https://hunyuan-result.example/day-${index}.png`, revised_prompt: index === 1 ? "day-off-revised" : "day-on-revised" }]
      }), { status: 200 });
    }
    return new Response(fixture, { status: 200, headers: { "content-type": "image/png" } });
  };
  const bundle = await generateAssetBundle({
    id: "job-hunyuan-test",
    attempts: 0,
    provider: "hunyuan-image",
    spec: { ...job.spec, guide_volume: "1x1x1", footprint: "1x1" }
  }, {
    hunyuanImageApiKey: "sk-test",
    hunyuanSubmitUrl: "https://tokenhub.example/submit",
    hunyuanQueryUrl: "https://tokenhub.example/query",
    hunyuanPollMs: 0,
    fetch: fakeFetch,
    sleep: async () => {},
    hunyuanDerivePairedLight: async () => ({
      emissiveBytes: fixture,
      supportBytes: fixture,
      compositeBytes: fixture,
      report: { subjectMaskIoUAfterAlignment: 0.991, supportPixels: 1200 }
    })
  });

  assert.deepEqual(bundle.sourceBytes, fixture);
  assert.deepEqual(bundle.emissiveBytes, fixture);
  assert.equal(bundle.production.provider, "hunyuan-image");
  assert.equal(bundle.production.model, "hy-image-v3.0");
  assert.equal(bundle.production.promptVersion, "magic-london-victorian-lowpoly-v1");
  assert.deepEqual(bundle.production.inputImageRoles, ["geometry_scale_camera_and_front_door_edit_target", "style_only_reference"]);
  const submits = calls.filter((call) => call.url.endsWith("/submit")).map((call) => JSON.parse(call.options.body));
  assert.equal(submits.length, 2);
  assert.equal(submits[0].images.length, 2);
  assert.match(submits[0].prompt, /\[WORLD_CONTEXT:magic-london-victorian-lowpoly-v1\]/);
  assert.match(submits[0].prompt, /\[AGENT_BRIEF\]/);
  assert.match(submits[0].prompt, /south\/front 正面/);
  assert.equal(submits[0].logo_add, 0);
  assert.equal(submits[0].revise, 0);
  assert.equal(submits[1].images.length, 1);
  assert.match(submits[1].prompt, /白天开灯配对编辑/);
});

test("Hunyuan paired emissive replaces the heuristic map and is recorded in the manifest", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "magictown-hunyuan-manifest-"));
  try {
    const source = await readFile("public/generated/magic-london-starter-001/starter-cottage-001/source-magenta.png");
    const emissive = await readFile("public/generated/magic-london-starter-001/starter-cottage-001/emissive.png");
    const manifest = await prepareAssetMaps("job-hunyuan-manifest", source, {
      assetOutputRoot: outputRoot,
      spec: { footprint: "1x1", guide_volume: "1x1x1" },
      config: {},
      productionBundle: {
        emissiveBytes: emissive,
        artifacts: { "day-on-raw.png": source },
        production: {
          provider: "hunyuan-image",
          model: "hy-image-v3.0",
          seed: 42,
          promptVersion: "magic-london-victorian-lowpoly-v1",
          lightPipelineVersion: "hunyuan-paired-daylight-v1",
          inputImageRoles: ["geometry_scale_camera_and_front_door_edit_target", "style_only_reference"],
          styleReferenceId: "magic-london-city-concept-v1",
          styleReferencePath: "/style-reference/isometric-magic-london-city.jpg",
          lightReport: { subjectMaskIoUAfterAlignment: 0.99, supportPixels: 1000 }
        }
      }
    });
    const normalizedEmissive = await readFile(path.join(outputRoot, "job-hunyuan-manifest", "emissive.png"));
    assert.ok(normalizedEmissive.length > 100);
    assert.notDeepEqual(normalizedEmissive, emissive);
    assert.equal(manifest.pipeline, "hunyuan-paired-daylight+portable-light-diff+derive_isometric_asset_maps@1");
    assert.equal(manifest.nightProfile, "paired-daylight-light-contribution");
    assert.equal(manifest.generationContract.provider, "hunyuan-image");
    assert.equal(manifest.generationContract.lightPipelineVersion, "hunyuan-paired-daylight-v1");
    assert.equal(manifest.generationContract.anchorNormalization.kind, "uniform-parcel-anchor-normalization-v1");
    assert.equal(manifest.generationContract.anchorNormalization.preservesAspectRatio, true);
    assert.match(manifest.productionArtifacts["day-on-raw.png"], /day-on-raw\.png$/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
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
