import test from "node:test";
import assert from "node:assert/strict";
import { getVoxelSkyState } from "../src/city/voxel-sky.js";
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

test("city daylight keeps structures readable while making midnight darker", () => {
  const noon = voxelDaylightStyle(0.5);
  const midnight = voxelDaylightStyle(0);

  assert.ok(noon.ambientIntensity > midnight.ambientIntensity);
  assert.ok(noon.sunIntensity > midnight.sunIntensity);
  assert.ok(midnight.ambientIntensity >= 0.5);
  assert.equal(noon.nightFactor, 0);
  assert.equal(midnight.nightFactor, 1);
});
