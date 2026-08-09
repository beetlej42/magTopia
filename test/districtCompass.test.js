import assert from "node:assert/strict";
import test from "node:test";
import {
  approachDistrictYaw,
  nextClockwiseDistrictRotation,
  normalizeYawDegrees,
  unwrapAngleDegrees
} from "../src/ui/districtCompass.js";

test("four clockwise turns return to the original normalized yaw", () => {
  const initialYaw = 45;
  let rotation = { quarterTurn: 0, targetYawDegrees: initialYaw };

  const turns = [];
  for (let index = 0; index < 4; index += 1) {
    rotation = nextClockwiseDistrictRotation(rotation);
    turns.push(rotation.quarterTurn);
  }

  assert.deepEqual(turns, [1, 2, 3, 0]);
  assert.equal(rotation.targetYawDegrees, initialYaw - 360);
  assert.equal(normalizeYawDegrees(rotation.targetYawDegrees), normalizeYawDegrees(initialYaw));
});

test("clockwise turn targets remain unwrapped when clicks are queued", () => {
  const first = nextClockwiseDistrictRotation({ quarterTurn: 0, targetYawDegrees: 45 });
  const second = nextClockwiseDistrictRotation(first);

  assert.deepEqual(first, { quarterTurn: 1, targetYawDegrees: -45 });
  assert.deepEqual(second, { quarterTurn: 2, targetYawDegrees: -135 });
});

test("yaw transition approaches its target without overshooting", () => {
  const next = approachDistrictYaw(45, -45, 1 / 60);

  assert.ok(next < 45);
  assert.ok(next > -45);
  assert.equal(approachDistrictYaw(-44.999, -45, 1 / 60), -45);
  assert.equal(approachDistrictYaw(45, -45, 0.001, { reducedMotion: true }), -45);
});

test("yaw normalization produces stable gameplay-facing values", () => {
  assert.equal(normalizeYawDegrees(405), 45);
  assert.equal(normalizeYawDegrees(-315), 45);
  assert.equal(normalizeYawDegrees(-45), 315);
});

test("compass needle crosses the angle boundary without reversing", () => {
  assert.equal(unwrapAngleDegrees(178, -179), 181);
  assert.equal(unwrapAngleDegrees(-178, 179), -181);
  assert.equal(unwrapAngleDegrees(null, -120), -120);
});
