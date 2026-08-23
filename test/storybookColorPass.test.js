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
  const sky = gradeStorybookColor([92 / 255, 127 / 255, 162 / 255], 0);
  const grass = gradeStorybookColor([123 / 255, 141 / 255, 89 / 255], 0);
  const brick = gradeStorybookColor([132 / 255, 102 / 255, 76 / 255], 0);
  const cream = gradeStorybookColor([171 / 255, 162 / 255, 134 / 255], 0);
  const roofInput = [56 / 255, 64 / 255, 73 / 255];
  const roof = gradeStorybookColor(roofInput, 0);

  assert.ok(sky[0] > sky[1] && sky[1] > sky[2], "blue sky should resolve to warm paper light");
  assert.ok(grass[0] > grass[1] && grass[1] > grass[2], "grass should rotate toward olive");
  assert.ok(brick[0] - brick[1] > 0.2, "brick should gain a clear terracotta red lead");
  assert.ok(cream[0] > 0.9 && cream[0] > cream[1] && cream[1] > cream[2], "plaster should become bright cream");
  roof.forEach((value, index) => assert.ok(Math.abs(value - roofInput[index]) < 0.015));
});

test("night palette lifts occupied shadows without washing out true black", () => {
  const black = gradeStorybookColor([0, 0, 0], 1);
  const shadow = gradeStorybookColor([0.04, 0.05, 0.055], 1);
  assert.ok(Math.max(...black) < 0.01);
  assert.ok(shadow[2] > shadow[0]);
  assert.ok(shadow[2] > 0.055);
});
