import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createVoxelSky, getVoxelSkyState } from "../src/city/voxel-sky.js";
import { voxelDaylightStyle } from "../src/generators/voxelBuildingLab.js";

test("voxel sky exposes distinct noon, sunset, and midnight states", () => {
  const noon = getVoxelSkyState(0.5);
  const sunset = getVoxelSkyState(0.75);
  const midnight = getVoxelSkyState(0);

  assert.equal(noon.daylight, 1);
  assert.equal(noon.night, 0);
  assert.equal(noon.starOpacity, 0);
  assert.ok(sunset.twilight > 0.35);
  assert.ok(sunset.daylight > 0 && sunset.daylight < 0.3);
  assert.equal(midnight.daylight, 0);
  assert.equal(midnight.night, 1);
  assert.equal(midnight.starOpacity, 1);
});

test("voxel sky wraps continuously at the end of the day", () => {
  const start = getVoxelSkyState(0);
  const wrapped = getVoxelSkyState(1);

  assert.equal(wrapped.time, start.time);
  assert.equal(wrapped.daylight, start.daylight);
  assert.equal(wrapped.night, start.night);
  assert.equal(wrapped.topColor.getHexString(), start.topColor.getHexString());
  assert.equal(wrapped.horizonColor.getHexString(), start.horizonColor.getHexString());
});

test("voxel sky can reuse state and color objects across updates", () => {
  const state = getVoxelSkyState(0.5);
  const colors = {
    top: state.topColor,
    horizon: state.horizonColor,
    cloud: state.cloudColor,
    cloudShadow: state.cloudShadowColor
  };

  const reused = getVoxelSkyState(0.75, state);

  assert.equal(reused, state);
  assert.equal(reused.topColor, colors.top);
  assert.equal(reused.horizonColor, colors.horizon);
  assert.equal(reused.cloudColor, colors.cloud);
  assert.equal(reused.cloudShadowColor, colors.cloudShadow);
  assert.notEqual(reused.topColor.getHexString(), getVoxelSkyState(0.5).topColor.getHexString());
});

test("city daylight keeps structures readable while making midnight darker", () => {
  const noon = voxelDaylightStyle(0.5);
  const midnight = voxelDaylightStyle(0);

  assert.ok(noon.ambientIntensity > midnight.ambientIntensity);
  assert.ok(noon.sunIntensity > midnight.sunIntensity);
  assert.ok(midnight.ambientIntensity >= 0.5);
  assert.equal(noon.nightFactor, 0);
  assert.equal(midnight.nightFactor, 1);
});

test("sun and moon remain camera-facing while the surface camera moves", () => {
  const sky = createVoxelSky({ seed: "billboard-test" });
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  const target = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const celestialQuaternion = new THREE.Quaternion();
  const views = [
    { position: [32, 24, 48], up: [0, 1, 0] },
    { position: [-44, 36, 18], up: [0.18, 0.97, -0.12] },
    { position: [12, 52, -38], up: [-0.22, 0.94, 0.25] }
  ];

  for (const view of views) {
    camera.position.set(...view.position);
    camera.up.set(...view.up).normalize();
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    sky.userData.update({ time: 0.5, elapsed: 0, camera });
    sky.updateMatrixWorld(true);

    camera.getWorldQuaternion(cameraQuaternion);
    for (const name of ["VoxelSun", "VoxelMoon"]) {
      sky.getObjectByName(name).getWorldQuaternion(celestialQuaternion);
      assert.ok(
        Math.abs(cameraQuaternion.dot(celestialQuaternion)) > 1 - 1e-6,
        `${name} should retain the camera's screen-space orientation`
      );
    }
  }

  sky.userData.dispose();
});

test("cloud instance matrices update only for perceptible animation or view changes", () => {
  const sky = createVoxelSky({ seed: "cloud-throttle-test" });
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  const target = new THREE.Vector3();
  camera.position.set(0, 18, 42);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  sky.userData.update({ time: 0.5, elapsed: 0, camera });

  const cloudField = sky.getObjectByName("VoxelCloudField");
  const cloudMeshes = cloudField.children.filter((object) => object.isInstancedMesh);
  let matrixWrites = 0;
  for (const mesh of cloudMeshes) {
    const setMatrixAt = mesh.setMatrixAt.bind(mesh);
    mesh.setMatrixAt = (...args) => {
      matrixWrites += 1;
      return setMatrixAt(...args);
    };
  }

  sky.userData.update({ time: 0.75, elapsed: 0, camera });
  sky.userData.update({ time: 0.75, elapsed: 1 / 120, camera });
  assert.equal(matrixWrites, 0, "time-only and sub-frame elapsed changes should reuse cloud matrices");

  sky.userData.update({ time: 0.75, elapsed: 1 / 24, camera });
  assert.ok(matrixWrites > 0, "visible cloud motion should refresh instance matrices");

  matrixWrites = 0;
  camera.lookAt(target.set(0.01, 0, 0));
  camera.updateMatrixWorld(true);
  sky.userData.update({ time: 0.75, elapsed: 1 / 24, camera });
  assert.equal(matrixWrites, 0, "sub-pixel camera rotation should reuse cloud matrices");

  camera.lookAt(target.set(2, 0, 0));
  camera.updateMatrixWorld(true);
  sky.userData.update({ time: 0.75, elapsed: 1 / 24, camera });
  assert.ok(matrixWrites > 0, "meaningful camera rotation should refresh cloud matrices");

  sky.userData.dispose();
});
