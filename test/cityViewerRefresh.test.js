import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("city viewer refreshes on demand instead of polling render-state", () => {
  assert.doesNotMatch(mainSource, /cityViewerRefreshTimer|setInterval\s*\(/);
  assert.match(mainSource, /function refreshCityViewer\(\{ force = false \} = \{\}\)/);
  assert.match(mainSource, /cityViewerRefreshInFlight/);
  assert.match(mainSource, /artifactManifestChanged/);
  assert.match(mainSource, /cityViewerBakedArtifacts = await loadCityBakedArtifacts\(cityViewerArtifactManifest, payload\.artifact_pack\);/);
  assert.match(mainSource, /await rebuildActive\(viewerConfig\);/);
  assert.match(mainSource, /decodeCityArtifactPack/);
  assert.doesNotMatch(mainSource, /Math\.min\(4, entries\.length\)/);
  assert.doesNotMatch(mainSource, /void hydrateCityBakedArtifacts/);
  assert.match(mainSource, /window\.addEventListener\("focus", \(\) => \{\s*void refreshCityViewer\(\);/s);
  assert.match(mainSource, /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.hidden\) return;\s*void refreshCityViewer\(\);/s);
  assert.match(mainSource, /onPlayerTurnComplete: \(\) => \{\s*void refreshCityViewer\(\{ force: true \}\);/s);
  assert.doesNotMatch(mainSource, /loadCityViewerState\(\);\s*loadCityDayState\(\);/s);
});

test("city routes show a dedicated loader and skip the default city build", () => {
  assert.match(indexSource, /document\.documentElement\.dataset\.magicTownViewer = "loading"/);
  assert.match(indexSource, /id="city-loading-track"[\s\S]*role="progressbar"/);
  assert.match(styleSource, /html\[data-magic-town-viewer="loading"\] \.city-loading-screen/);
  assert.match(mainSource, /if \(cityViewerContext\) initializeCityViewer\(\);\s*else void rebuildActive\(currentConfig\);/s);
  assert.doesNotMatch(mainSource, /rebuildActive\(currentConfig\);[\s\S]{0,120}if \(cityViewerContext\) initializeCityViewer\(\);/);
});

test("city loader advances through artifacts, scene build, and first paint", () => {
  assert.match(mainSource, /setCityViewerLoadingProgress\(42, "正在加载建筑模型…"\);[\s\S]*loadCityBakedArtifacts/);
  assert.match(mainSource, /setCityViewerLoadingProgress\(72, "正在构建城市地形…"\);[\s\S]*await rebuildActive\(viewerConfig\);/);
  assert.match(mainSource, /setCityViewerLoadingProgress\(94, "正在绘制精细建筑与阴影…"\);\s*await waitForCityViewerFirstPaint\(\);\s*setCityViewerLoadingProgress\(100, "城市已就绪"\);\s*}\s*document\.documentElement\.dataset\.magicTownViewer = "ready";/s);
  assert.match(mainSource, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
});
