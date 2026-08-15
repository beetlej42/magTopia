import assert from "node:assert/strict";
import test from "node:test";

import {
  createPedestrianAsset,
  createVehicleAsset,
  getStreetAssetCatalog,
  normalizePedestrianConfig,
  normalizeVehicleConfig
} from "../src/generators/streetLifeAssets.js";
import {
  STREET_LIFE_PRESETS,
  createStreetLifeAssetLab,
  getStreetLifeContract,
  normalizeStreetLifeConfig
} from "../src/generators/streetLifeAssetLab.js";

test("pedestrian variants are deterministic and keep wands exclusive to wizards", () => {
  const first = normalizePedestrianConfig({ seed: "person-a", magicRatio: 0.5 });
  const second = normalizePedestrianConfig({ seed: "person-a", magicRatio: 0.5 });
  assert.deepEqual(first, second);
  const muggle = normalizePedestrianConfig({ seed: "person-b", role: "muggle", accessory: "wand" });
  assert.notEqual(muggle.accessory, "wand");
});

test("pedestrian asset exposes a shared animated walk rig", () => {
  const person = createPedestrianAsset({ seed: "walker", role: "wizard", cape: true, accessory: "wand" });
  assert.equal(person.userData.assetKind, "pedestrian");
  assert.equal(person.userData.variant.role, "wizard");
  assert.equal(typeof person.userData.updateWalk, "function");
  assert.ok(person.getObjectByName("Cape"));
  person.userData.updateWalk(0.25, 1);
  assert.notEqual(person.userData.rig.leftLeg.rotation.x, 0);
});

test("every non-bare hairstyle covers the back of the head", () => {
  for (const hair of ["swept", "bob", "curls", "flat-cap", "top-hat"]) {
    const person = createPedestrianAsset({ seed: hair, hair });
    const rearHair = person.getObjectByName("RearHair");
    assert.ok(rearHair, `${hair} should include the shared rear hair module`);
    assert.ok(rearHair.position.z < 0, `${hair} rear hair should sit behind the head`);
  }
  assert.equal(createPedestrianAsset({ seed: "bare", hair: "bare" }).getObjectByName("RearHair"), undefined);
});

test("vehicle family retains the three required silhouettes and round wheels", () => {
  for (const type of ["hatchback", "saloon", "bus"]) {
    const vehicle = createVehicleAsset({ seed: type, type, flying: false });
    assert.equal(vehicle.userData.variant.type, type);
    assert.equal(vehicle.userData.wheels.length, 4);
    assert.ok(vehicle.userData.wheels.every((wheel) => wheel.geometry.type === "CylinderGeometry"));
  }
});

test("bus is materially longer and wider than the saloon", () => {
  const saloon = createVehicleAsset({ seed: "saloon-scale", type: "saloon", flying: false });
  const bus = createVehicleAsset({ seed: "bus-scale", type: "bus", flying: false });
  const saloonSize = saloon.userData.body.children[0].geometry.parameters;
  const busSize = bus.userData.body.children[0].geometry.parameters;
  assert.ok(busSize.width > saloonSize.width * 1.5);
  assert.ok(busSize.depth > saloonSize.depth * 1.2);
});

test("bus cannot become a flying vehicle while cars can", () => {
  assert.equal(normalizeVehicleConfig({ seed: "bus", type: "bus", flying: true }).flying, false);
  const flyingCar = createVehicleAsset({ seed: "car", type: "saloon", flying: true });
  assert.equal(flyingCar.userData.variant.flying, true);
  assert.ok(flyingCar.userData.magicGlow);
  flyingCar.userData.updateMotion(1, 1);
  assert.ok(flyingCar.userData.body.position.y > 0);
});

test("road vehicle motion does not spend frame time rotating miniature wheels", () => {
  const vehicle = createVehicleAsset({ seed: "static-wheels", type: "hatchback", flying: false });
  const rotations = vehicle.userData.wheels.map((wheel) => wheel.rotation.toArray());
  vehicle.userData.updateMotion(12, 1.5);
  assert.deepEqual(vehicle.userData.wheels.map((wheel) => wheel.rotation.toArray()), rotations);
});

test("street-life lab clamps controls and stays standalone", () => {
  const normalized = normalizeStreetLifeConfig({
    pedestrianCount: 40,
    vehicleCount: 1,
    magicRatio: 2,
    flyingCarChance: -1,
    animationSpeed: 8
  });
  assert.equal(normalized.pedestrianCount, 16);
  assert.equal(normalized.vehicleCount, 3);
  assert.equal(normalized.magicRatio, 1);
  assert.equal(normalized.flyingCarChance, 0);
  assert.equal(normalized.animationSpeed, 2);
  const contract = getStreetLifeContract(normalized);
  assert.equal(contract.integrationStatus, "standalone-lab-only");
  assert.deepEqual(contract.catalog.vehicles.types, ["hatchback", "saloon", "bus"]);
});

test("street-life lab builds requested counts and core vehicle coverage", () => {
  const config = normalizeStreetLifeConfig({
    ...STREET_LIFE_PRESETS.mixedLondonStreet,
    pedestrianCount: 6,
    vehicleCount: 4,
    flyingCarChance: 0
  });
  const lab = createStreetLifeAssetLab(config);
  const diagnostics = lab.userData.getStreetLifeDiagnostics();
  assert.equal(diagnostics.pedestrianCount, 6);
  assert.equal(diagnostics.vehicleCount, 4);
  assert.ok(diagnostics.vehicleTypes.hatchback >= 1);
  assert.ok(diagnostics.vehicleTypes.saloon >= 1);
  assert.ok(diagnostics.vehicleTypes.bus >= 1);
  assert.deepEqual(getStreetAssetCatalog().pedestrians.roles, ["muggle", "wizard"]);
});
