import assert from "node:assert/strict";
import test from "node:test";

import {
  STORYBOOK_LUT_SIZE,
  calculateStorybookGradeState,
  gradeStorybookColor
} from "../src/render/storybookColorPass.js";

test("storybook grade keeps a compact runtime LUT and adapts strength across time", () => {
  assert.equal(STORYBOOK_LUT_SIZE, 32);
  const day = calculateStorybookGradeState({ strength: 0.68, daylight: 1 });
  const twilight = calculateStorybookGradeState({ strength: 0.68, twilight: 1 });
  const night = calculateStorybookGradeState({ strength: 0.68, night: 1 });
  assert.ok(twilight.strength > day.strength);
  assert.ok(day.strength > night.strength);
  assert.equal(night.nightBlend, 1);
});

test("storybook palette warms highlights and cools dark values", () => {
  const highlight = gradeStorybookColor([0.82, 0.8, 0.72], 0);
  const shadow = gradeStorybookColor([0.1, 0.11, 0.12], 0);
  assert.ok(highlight[0] > highlight[2]);
  assert.ok(shadow[2] > shadow[0]);
  assert.ok(highlight.every((value) => value >= 0 && value <= 1));
});

test("day palette maps sampled city colors toward the calibrated storybook anchors", () => {
  const highSky = gradeStorybookColor([0.08, 0.17, 0.35], 0);
  const horizon = gradeStorybookColor([0.28, 0.32, 0.34], 0);
  const grass = gradeStorybookColor([0.2, 0.27, 0.1], 0);
  const brick = gradeStorybookColor([0.23, 0.13, 0.07], 0);
  const creamInput = [0.41, 0.36, 0.24];
  const cream = gradeStorybookColor(creamInput, 0);
  const roofInput = [56 / 255, 64 / 255, 73 / 255];
  const roof = gradeStorybookColor(roofInput, 0);

  assert.ok(highSky[2] > highSky[1] && highSky[1] > highSky[0], "upper sky should retain its blue gradient");
  assert.ok(horizon[2] - horizon[0] < 0.08, "horizon should approach a neutral paper light");
  assert.ok(grass[1] > grass[0] && grass[0] > grass[2], "grass should remain sage green");
  assert.ok(brick[0] - brick[1] > 0.08, "brick should retain a clear terracotta red lead");
  assert.ok(cream[0] > creamInput[0] && cream[0] > cream[1] && cream[1] > cream[2], "plaster should become brighter cream");
  roof.forEach((value, index) => assert.ok(Math.abs(value - roofInput[index]) < 0.015));
});

test("night palette lifts occupied shadows without washing out true black", () => {
  const black = gradeStorybookColor([0, 0, 0], 1);
  const shadow = gradeStorybookColor([0.04, 0.05, 0.055], 1);
  assert.ok(Math.max(...black) < 0.01);
  assert.ok(shadow[2] > shadow[0]);
  assert.ok(shadow[2] > 0.055);
});
