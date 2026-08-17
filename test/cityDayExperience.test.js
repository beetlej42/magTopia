import assert from "node:assert/strict";
import test from "node:test";
import { chooseCardOrientation, phaseLightTarget, PHASE_LABELS } from "../src/ui/cityDayExperience.js";

test("portrait and narrow screens stack the three cards vertically", () => {
  assert.equal(chooseCardOrientation({ width: 360, height: 720 }), "portrait");
  assert.equal(chooseCardOrientation({ width: 640, height: 900 }), "portrait");
  assert.equal(chooseCardOrientation({ width: 0, height: 0 }), "portrait");
});

test("landscape and wide screens lay the three cards horizontally", () => {
  assert.equal(chooseCardOrientation({ width: 1280, height: 720 }), "landscape");
  assert.equal(chooseCardOrientation({ width: 1024, height: 600 }), "landscape");
});

test("phase light targets stay within the sun axis and are deterministic", () => {
  for (const phase of ["dawn", "early_morning", "morning", "day", "night"]) {
    const target = phaseLightTarget(phase);
    assert.ok(target >= 0 && target <= 1, `${phase} target ${target} is on the 0..1 sun axis`);
  }
  assert.ok(phaseLightTarget("night") > phaseLightTarget("day"));
  assert.ok(phaseLightTarget("day") > phaseLightTarget("morning"));
  assert.ok(phaseLightTarget("morning") > phaseLightTarget("dawn"));
});

test("unknown phases fall back to the stable morning light", () => {
  assert.equal(phaseLightTarget("sunset-unknown"), phaseLightTarget("morning"));
  assert.equal(phaseLightTarget(null), phaseLightTarget("morning"));
});

test("every presentation phase has a Chinese player-facing label", () => {
  for (const phase of ["dawn", "early_morning", "morning", "day", "night"]) {
    assert.ok(PHASE_LABELS[phase]?.length > 0, `${phase} has a label`);
  }
});
