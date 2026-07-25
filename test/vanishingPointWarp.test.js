import assert from "node:assert/strict";
import test from "node:test";

import {
  createAxonometricProjector,
  createOrthographicDepthReconstructor,
  createTwoPointProjector,
  getTwoPointConvergenceDiagnostics,
  normalizeVanishingPointConfig,
  projectCuboidCorners
} from "../src/generators/vanishingPointWarp.js";

const assetAnchors = {
  left: [0.23, 0.35],
  near: [0.52, 0.19],
  right: [0.795, 0.354]
};

test("guideplate reconstruction preserves globally decoded view depth at every anchor", () => {
  const reconstructor = createOrthographicDepthReconstructor({
    baseAnchorsUv: assetAnchors,
    dimensions: { length: 4, width: 6, height: 5 },
    camera: { yaw: 45, elevation: 55 },
    depthEncoding: {
      kind: "global-linear-quantile-fit-v1",
      encoding: { minimumViewDepth: -4, maximumViewDepth: 6 }
    },
    anchorDepthSamples: { left: 0.38, near: 0.81, right: 0.42 }
  });

  for (const key of ["left", "near", "right"]) {
    const encoded = { left: 0.38, near: 0.81, right: 0.42 }[key];
    const reconstructed = reconstructor.reconstruct(assetAnchors[key], encoded);
    const decoded = reconstructor.decodeViewDepth(encoded);
    const projectedDepth = reconstructed.x * reconstructor.basis.view.x
      + reconstructed.y * reconstructor.basis.view.y
      + reconstructed.z * reconstructor.basis.view.z;
    assert.ok(Math.abs(projectedDepth - decoded) < 1e-10);
  }
});

test("encoded guide-fit depth decodes directly with no spatial correction", () => {
  const reconstructor = createOrthographicDepthReconstructor({
    baseAnchorsUv: assetAnchors,
    dimensions: { length: 4, width: 4, height: 4 },
    camera: { yaw: 45, elevation: 55 },
    depthEncoding: {
      kind: "global-linear-quantile-fit-v1",
      encoding: { minimumViewDepth: -0.25, maximumViewDepth: 4.75 }
    },
    anchorDepthSamples: { left: 0.2, near: 0.7, right: 0.3 }
  });

  assert.equal(reconstructor.depthEncoding.mode, "encoded-view-depth");
  assert.equal(reconstructor.depthEncoding.spatialCorrection, "none");
  assert.equal(reconstructor.decodeViewDepth(0.2), 0.75);
  assert.equal(reconstructor.decodeViewDepth(0.7), 3.25);
  const first = reconstructor.reconstruct([0.4, 0.5], 0.2);
  const second = reconstructor.reconstruct([0.4, 0.5], 0.7);
  assert.ok(Math.abs(Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z) - 2.5) < 1e-10);
});

test("source axonometric projection keeps three direction families parallel without collapsing depth", () => {
  const projector = createAxonometricProjector({ projectionScale: 0.72 });
  const origin = projector.project({ x: 0, y: 0, z: 0 });
  const xDirection = projector.project({ x: 2, y: 0, z: 0 });
  const zDirection = projector.project({ x: 0, y: 0, z: 2 });
  const verticalDirection = projector.project({ x: 0, y: 2, z: 0 });

  assert.notEqual(xDirection[1], origin[1]);
  assert.notEqual(zDirection[1], origin[1]);
  assert.equal(verticalDirection[0], origin[0]);
  assert.equal(projector.vanishingPoints.left, "infinity");
  assert.equal(projector.vanishingPoints.right, "infinity");
  assert.equal(projector.vanishingPoints.vertical, "infinity");
});

test("two horizontal cuboid axes converge to independently configured vanishing points", () => {
  const diagnostics = getTwoPointConvergenceDiagnostics({
    leftVanishingDistance: 14,
    rightVanishingDistance: 37,
    footprintWidth: 4,
    footprintDepth: 7,
    buildingHeight: 6
  });

  assert.ok(diagnostics.leftError < 1e-10, `left error was ${diagnostics.leftError}`);
  assert.ok(diagnostics.rightError < 1e-10, `right error was ${diagnostics.rightError}`);
  assert.deepEqual(diagnostics.leftVanishingPoint, [-14, 0]);
  assert.deepEqual(diagnostics.rightVanishingPoint, [37, 0]);
});

test("vertical cuboid edges stay parallel while horizontal vanishing distances change", () => {
  const close = getTwoPointConvergenceDiagnostics({ leftVanishingDistance: 9, rightVanishingDistance: 13 });
  const far = getTwoPointConvergenceDiagnostics({ leftVanishingDistance: 90, rightVanishingDistance: 110 });

  assert.ok(close.verticalDrift < 1e-12);
  assert.ok(far.verticalDrift < 1e-12);
  assert.equal(close.verticalVanishingPoint, "infinity");
  assert.equal(far.verticalVanishingPoint, "infinity");
});

test("the same projector accepts independent plot width, depth, and building height", () => {
  const config = normalizeVanishingPointConfig({
    leftVanishingDistance: 16,
    rightVanishingDistance: 31,
    footprintWidth: 8.5,
    footprintDepth: 2.25,
    buildingHeight: 11.5
  });
  const projector = createTwoPointProjector({ ...config, cameraHeight: config.buildingHeight + 4 });
  const corners = projectCuboidCorners(config, projector);

  Object.values(corners).forEach((point) => assert.ok(point.every(Number.isFinite)));
  assert.equal(config.footprintWidth, 8.5);
  assert.equal(config.footprintDepth, 2.25);
  assert.equal(config.buildingHeight, 11.5);
});

test("moving one vanishing point changes yaw without changing the configured apparent scale", () => {
  const balanced = createTwoPointProjector({ leftVanishingDistance: 20, rightVanishingDistance: 20, projectionScale: 0.72 });
  const asymmetric = createTwoPointProjector({ leftVanishingDistance: 12, rightVanishingDistance: 40, projectionScale: 0.72 });

  assert.ok(Math.abs(balanced.focalLength / balanced.cameraDistance - 0.72) < 1e-12);
  assert.ok(Math.abs(asymmetric.focalLength / asymmetric.cameraDistance - 0.72) < 1e-12);
  assert.notEqual(balanced.yaw, asymmetric.yaw);
});
