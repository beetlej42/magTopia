import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_ORIENTATION_CANDIDATES,
  rankOrientationScores,
  scoreOrientationCandidate
} from "../src/generators/modelOrientation.js";

test("four-way RGB scoring recovers an asymmetric reference orientation", () => {
  const reference = createAsymmetricImage(32);
  const scores = MODEL_ORIENTATION_CANDIDATES.map((rotationY, turns) => ({
    rotationY,
    ...scoreOrientationCandidate(reference, rotateImage(reference, turns), 32)
  }));
  const ranking = rankOrientationScores(scores);
  assert.equal(ranking.best.rotationY, 0);
  assert.ok(ranking.best.score < ranking.runnerUp.score);
  assert.ok(ranking.confidence > 0.1);
});

test("orientation ranking is deterministic when scores tie", () => {
  const ranking = rankOrientationScores([
    { rotationY: 270, score: 1 },
    { rotationY: 90, score: 1 },
    { rotationY: 180, score: 2 },
    { rotationY: 0, score: 2 }
  ]);
  assert.equal(ranking.best.rotationY, 90);
  assert.equal(ranking.runnerUp.rotationY, 270);
});

function createAsymmetricImage(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      data[index] = x < size * 0.35 ? 220 : 55;
      data[index + 1] = y < size * 0.55 ? 45 : 190;
      data[index + 2] = x + y < size * 0.8 ? 235 : 35;
      data[index + 3] = x > 2 && y > 1 && x < size - 4 && y < size - 6 ? 255 : 0;
    }
  }
  return { data, width: size, height: size };
}

function rotateImage(image, turns) {
  let current = image;
  for (let turn = 0; turn < turns; turn += 1) {
    const data = new Uint8ClampedArray(current.data.length);
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const sourceIndex = (y * current.width + x) * 4;
        const targetX = current.height - 1 - y;
        const targetY = x;
        const targetIndex = (targetY * current.height + targetX) * 4;
        data.set(current.data.subarray(sourceIndex, sourceIndex + 4), targetIndex);
      }
    }
    current = { data, width: current.height, height: current.width };
  }
  return current;
}
