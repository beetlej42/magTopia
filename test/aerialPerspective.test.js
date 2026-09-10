import assert from "node:assert/strict";
import test from "node:test";
import { aerialDepthBehindFocus } from "../src/render/aerialPerspective.js";

test("foreground and inspected point remain haze-free when dollying back", () => {
  const focus = { x: 0, y: 3, z: -5 };
  // Both navigation views look along this same axis at the same focus.
  for (const distance of [34, 64.6, 110]) {
    const camera = { x: 0, y: 3, z: focus.z + distance };
    const direction = { x: 0, y: 0, z: (focus.z - camera.z) / distance };
    assert.equal(aerialDepthBehindFocus(focus, focus, direction), 0);
    assert.equal(aerialDepthBehindFocus({ x: 2, y: 0, z: 10 }, focus, direction), 0);
    assert.equal(aerialDepthBehindFocus({ x: 2, y: 0, z: -45 }, focus, direction), 40);
  }
});

test("aerial depth follows the viewed street when rotating or panning", () => {
  const focus = { x: 30, y: 0, z: 20 };
  assert.equal(aerialDepthBehindFocus({ x: 70, y: 0, z: 20 }, focus, { x: 1, y: 0, z: 0 }), 40);
  assert.equal(aerialDepthBehindFocus({ x: -10, y: 0, z: 20 }, focus, { x: 1, y: 0, z: 0 }), 0);
});
