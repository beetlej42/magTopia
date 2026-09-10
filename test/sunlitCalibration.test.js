import test from "node:test";
import assert from "node:assert/strict";
import { createSunlitCalibrationScene } from "../src/generators/sunlitCalibrationScene.js";

test("Studio calibration keeps twelve real buildings and projected shadow casters", () => {
  const scene = createSunlitCalibrationScene({ sunTime: 0.38 });
  let buildings = 0;
  for (let row = 0; row < 4; row++) {
    buildings += scene.getObjectByName(`CalibrationTerrace-${row}`).userData.plan.buildings.length;
    let casters = 0;
    scene.traverse((mesh) => {
      if (mesh.isMesh && mesh.userData.calibrationRow === row && mesh.castShadow) casters++;
    });
    assert.ok(casters > 0, `row ${row} casts shadows after sphere projection`);
  }
  assert.equal(buildings, 12);
  assert.doesNotThrow(() => scene.userData.updateDaylight({ nightFactor: 1 }));
});
