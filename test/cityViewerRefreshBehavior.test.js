import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { getCityViewerSceneKey, reuseCityBakedArtifacts } from "../src/render/cityViewerSnapshot.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf(`function ${nextName}(`, start)).replace(/async\s*$/, "");
}

function viewerHarness(state, payload) {
  const counters = { builds: 0, packs: 0, hud: 0 };
  const context = createContext({
    structuredClone,
    getCityViewerSceneKey, reuseCityBakedArtifacts,
    cityViewerContext: { cityId: "city", token: "session" },
    cityViewerLoading: false, cityViewerLoadedVersion: 7,
    cityViewerSceneKey: getCityViewerSceneKey(state),
    cityViewerArtifactManifest: [], cityViewerArtifactManifestKey: "",
    cityViewerBakedArtifacts: {}, cityViewerRuntimeState: state, cityViewerAssets: [],
    cityViewerStatus: {}, cityWorkbench: null, citySeed: "seed",
    activeObject: { userData: { cityState: state } },
    configsByMode: { agentcity: { seed: "seed" } },
    startupParams: new URLSearchParams(),
    VOXEL_INTENT_DISTRICT_PRESETS: { agentQuarterDay: {} },
    skyClock: { time: 0.5 }, currentMode: "agentcity", modeControl: {},
    createCityWorkbench: value => ({ state: value }),
    getCityViewerArtifactManifestKey: () => "",
    normalizeVoxelIntentDistrictConfig: value => value,
    rebuildPresetOptions() {}, buildSliderUi() {}, syncCityPlacementLayer() {},
    loadCityBakedArtifacts: async () => { counters.packs += 1; return {}; },
    rebuildActive: async () => { counters.builds += 1; },
    fetch: async () => ({ ok: true, json: async () => payload }),
    renderCityViewerSummary: () => { counters.hud += 1; },
    showCityViewerAuth: message => { assert.fail(message); },
    document: { documentElement: { dataset: {} } }
  });
  runInContext(`async ${functionSource("loadCityViewerState", "setCityViewerLoadingProgress")}`, context);
  return { context, counters, refresh: () => runInContext("loadCityViewerState({ force: true })", context) };
}

test("forced post-action reads update authoritative state and HUD without rebuilding the scene", async () => {
  const before = { world: { grid: {} }, buildings: {}, cells: {}, resources: { coins: 100 } };
  const after = { ...before, version: 8, resources: { coins: 300 }, gameplay: { cardState: { choice: { status: "selected" } } } };
  const harness = viewerHarness(before, { state: after, city_version: 8 });
  await harness.refresh();
  await harness.refresh();
  assert.equal(harness.counters.builds, 0);
  assert.equal(harness.counters.packs, 0);
  assert.equal(harness.counters.hud, 2);
  assert.equal(harness.context.cityViewerRuntimeState, after);
  assert.equal(harness.context.cityViewerLoadedVersion, 8);
  assert.equal(harness.context.activeObject.userData.cityState.resources.coins, 300);
});

test("resident arrivals update street life without rebuilding buildings, terrain or model packs", async () => {
  const before = { world: { grid: {} }, buildings: {}, cells: {}, gameplay: { population: { muggles: { current: 0 } } } };
  const after = structuredClone(before);
  after.gameplay.population.muggles.current = 100;
  const harness = viewerHarness(before, { state: after, city_version: 8 });
  let updates = 0;
  harness.context.activeObject.userData.refreshStreetLife = state => { assert.equal(state, after); updates += 1; return true; };
  harness.context.activeViewCache = { valid: true };
  harness.context.districtDepthOfField = { invalidateDepth() {} };
  await harness.refresh();
  assert.equal(updates, 1);
  assert.equal(harness.counters.builds, 0);
  assert.equal(harness.counters.packs, 0);
  assert.equal(harness.context.activeViewCache.valid, false);
});

test("a real map change rebuilds once and preserves decoded meshes when the manifest is unchanged", async () => {
  const before = { world: { grid: {} }, buildings: {}, cells: { a: { infrastructure: null } } };
  const after = structuredClone(before);
  after.cells.a.infrastructure = "road";
  const harness = viewerHarness(before, { state: after, city_version: 8 });
  const mesh = { positions: [1, 2, 3] };
  harness.context.cityViewerBakedArtifacts = { house: mesh };
  await harness.refresh();
  await harness.refresh();
  assert.equal(harness.counters.builds, 1);
  assert.equal(harness.counters.packs, 0);
  assert.equal(harness.context.cityViewerBakedArtifacts.house, mesh);
});

test("a command that finishes during a refresh queues a new render read without another presentation sync", async () => {
  let finishRead;
  const firstRead = new Promise(resolve => { finishRead = resolve; });
  let renders = 0, days = 0;
  const context = createContext({
    cityViewerContext: { token: "session" }, cityViewerRefreshInFlight: null,
    cityViewerRefreshPending: false, cityViewerRefreshPendingDay: false,
    loadCityViewerState: async () => { if (++renders === 1) await firstRead; },
    loadCityDayState: async () => { days += 1; }
  });
  runInContext(functionSource("refreshCityViewer", "initializeCityDayExperience"), context);
  const background = runInContext("refreshCityViewer()", context);
  const afterCommand = runInContext("refreshCityViewer({ force: true, syncDay: false })", context);
  finishRead();
  await Promise.all([background, afterCommand]);
  assert.equal(renders, 2);
  assert.equal(days, 1);
});

test("failed mesh downloads keep the fallback scene and later recover without requiring a map edit", async () => {
  const state = { world: { grid: {} }, buildings: {}, cells: {} };
  const manifest = [{ buildingId: "house", sha256: "hash", artifactVersion: 2 }];
  const harness = viewerHarness(state, { state, city_version: 7, artifact_manifest: manifest, artifact_pack: { url: "/pack" } });
  harness.context.cityViewerArtifactManifest = manifest;
  let meshReady = false;
  harness.context.loadCityBakedArtifacts = async () => {
    harness.counters.packs += 1;
    return meshReady ? { house: { positions: [1, 2, 3] } } : {};
  };
  await harness.refresh();
  assert.equal(harness.counters.builds, 0);
  meshReady = true;
  await harness.refresh();
  assert.equal(harness.counters.builds, 1);
  await harness.refresh();
  assert.equal(harness.counters.builds, 1);
  assert.equal(harness.counters.packs, 2);
});
