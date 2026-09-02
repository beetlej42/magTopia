import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("city viewer refreshes on demand instead of polling render-state", () => {
  assert.doesNotMatch(mainSource, /cityViewerRefreshTimer|setInterval\s*\(/);
  assert.match(mainSource, /function refreshCityViewer\(\{ force = false \} = \{\}\)/);
  assert.match(mainSource, /cityViewerRefreshInFlight/);
  assert.match(mainSource, /artifactManifestChanged/);
  assert.match(mainSource, /cityViewerBakedArtifacts = await loadCityBakedArtifacts\(cityViewerArtifactManifest, payload\.artifact_pack\);\s*await rebuildActive\(viewerConfig\);/s);
  assert.match(mainSource, /decodeCityArtifactPack/);
  assert.doesNotMatch(mainSource, /Math\.min\(4, entries\.length\)/);
  assert.doesNotMatch(mainSource, /void hydrateCityBakedArtifacts/);
  assert.match(mainSource, /window\.addEventListener\("focus", \(\) => \{\s*void refreshCityViewer\(\);/s);
  assert.match(mainSource, /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.hidden\) return;\s*void refreshCityViewer\(\);/s);
  assert.match(mainSource, /onPlayerTurnComplete: \(\) => \{\s*void refreshCityViewer\(\{ force: true \}\);/s);
  assert.doesNotMatch(mainSource, /loadCityViewerState\(\);\s*loadCityDayState\(\);/s);
});
