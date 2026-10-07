import * as THREE from "three";
import { VoxelInstanceBuffer } from "./voxelBuildingLab.js";

export const MOLEWAY_ASSET_ID = "moleway-001";
// Keep the persisted card identity: existing cities and unplaced cards upgrade too.
export { MOLEWAY_CARD_ID } from "../city/moleway-opening.js";

export function molewaySpec() {
  return { assetId: MOLEWAY_ASSET_ID, assetRevision: 1,
    footprint: { worldWidth: 4, worldDepth: 4 }, entrance: "north" };
}

export function addMolewayDetails(buffer) {
  const b = (m, x, y, z, w, h, d) => buffer.addBox(m, x, y, z, w, h, d);
  // Full residential-sized parcel. The central stairwell remains genuinely empty.
  for (let x = -16; x < 16; x++) for (let z = -16; z < 16; z++) {
    if (x >= -8 && x < 8 && z >= -12 && z < 12) continue;
    b((Math.floor((x + 16) / 4) + Math.floor((z + 16) / 4)) % 3 ? "pavement" : "sandstone", x, -1, z, 1, 1, 1);
  }
  // Ten treads descend away from the street (+Z), ending in a landing.
  for (let i = 0; i < 10; i++) b(i % 2 ? "pavement" : "sandstone", -8, -2 - i, 10 - i * 2, 16, 1, 2);
  b("stoneShadow", -8, -12, -12, 16, 1, 4);
  // Retaining walls enclose the excavation; both sides leave four voxels of paving.
  for (const x of [-11, 8]) {
    b("brickRed", x, -13, -13, 3, 18, 25);
    b("sandstone", x - 1, 5, -14, 5, 1, 26);
    for (let y = -10; y < 5; y += 3) for (let z = -12; z < 11; z += 5)
      b("brickBrown", x, y, z + (y % 2 ? 1 : 0), 3, 1, 2);
    // Open rails rather than a tall solid parapet.
    for (let z = -12; z <= 6; z += 3) b("patinaMetal", x + 1, 6, z, 1, 5, 1);
    b("patinaMetal", x + 1, 11, -12, 1, 1, 20);
  }
  // Rear tunnel arch, solid above; the dark recess conceals the imagined turn.
  for (let x = -8; x < 8; x++) {
    const arch = -2 - Math.max(0, Math.abs(x + .5) - 3);
    b("brickRed", x, Math.ceil(arch), -13, 1, 6 - Math.ceil(arch), 2);
    b("sandstone", x, Math.ceil(arch) - 1, -11, 1, 1, 1);
  }
  b("sandstone", -12, 5, -14, 24, 1, 3);
  b("stoneShadow", -8, -12, -14, 16, 11, 1);
  // Tall front piers, amber lanterns and iron gateway.
  for (const x of [-11, 8]) {
    b("brickRed", x, 0, 8, 3, 9, 4);
    b("sandstone", x - 1, 9, 7, 5, 1, 6);
    b("patinaMetal", x, 10, 8, 3, 1, 3);
    b("warmWindow", x, 11, 8, 3, 3, 3);
    b("patinaMetal", x - 1, 14, 7, 5, 1, 5);
    b("gildedMetal", x + 1, 15, 9, 1, 1, 1);
    b("patinaMetal", x + 1, 6, 5, 1, 13, 1);
  }
  for (let x = -10; x < 10; x++) {
    const y = 19 + Math.min(4, Math.floor((10 - Math.abs(x + .5)) / 2));
    b("patinaMetal", x, y, 5, 1, 1, 2);
  }
  b("gildedMetal", -8, 17, 6, 16, 5, 1);
  b("patinaMetal", -7, 18, 7, 14, 3, 1);
  // A little bronze mole sprawled over the station sign, paws dangling in front.
  b("timber", -3, 23, 4, 6, 3, 4);
  b("timber", -2, 26, 5, 4, 1, 2);
  b("gildedMetal", -2, 23, 8, 4, 2, 1);
  b("blossomPink", -1, 24, 9, 2, 1, 1);
  b("iron", -2, 25, 8, 1, 1, 1); b("iron", 1, 25, 8, 1, 1, 1);
  for (const x of [-4, 2]) {
    b("gildedMetal", x, 22, 7, 2, 2, 2);
    b("sandstone", x, 22, 9, 2, 1, 1);
  }
  // The polished secret nose on the left pier, distinct from the large mascot.
  b("gildedMetal", -11, 5, 12, 3, 2, 1);
  b("sandstone", -10, 5, 13, 1, 1, 1);
  // Quiet planting at the back, leaving both side strips walkable.
  for (const x of [-15, 12]) {
    b("sandstone", x, 0, -14, 3, 2, 6);
    b("soil", x, 2, -14, 3, 1, 6);
    b("foliage", x, 3, -13, 3, 2, 4);
  }
}

export function createMoleway({ cellWorldSize = 4, nightLighting = 0 } = {}) {
  const root = new THREE.Group(); root.name = "Moleway";
  const buffer = new VoxelInstanceBuffer(MOLEWAY_ASSET_ID);
  addMolewayDetails(buffer);
  buffer.createMeshes({ strategy: "greedy" }).forEach(mesh => { mesh.castShadow = true; root.add(mesh); });
  // Tiny voxel lettering, readable close up without a canvas/font dependency.
  const letters = { M: ["101","111","111","101","101"], O: ["111","101","101","101","111"],
    L: ["100","100","100","100","111"], E: ["111","100","110","100","111"],
    W: ["101","101","111","111","101"], A: ["010","101","111","101","101"],
    Y: ["101","101","010","010","010"] };
  const text = new VoxelInstanceBuffer("moleway-sign");
  [..."MOLEWAY"].forEach((letter, i) => letters[letter].forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === "1") text.addVoxel("gildedMetal", i * 4 + x, 4 - y, 0);
  })));
  const label = new THREE.Group(); label.name = "MolewaySign";
  text.createMeshes({ strategy: "greedy" }).forEach(mesh => label.add(mesh));
  label.scale.setScalar(.5); label.position.set(-6.75 * .125, 18.25 * .125, 8 * .125);
  root.add(label);
  root.scale.setScalar(cellWorldSize / 4);
  Object.assign(root.userData, { assetId: MOLEWAY_ASSET_ID, assetRevision: 1,
    representation: "special-landmark-voxel", sphereProjectionRoot: true,
    footprint: "1x1", entrance: "north", authoredParcelSize: 4, voxelSize: .125 });
  root.userData.updateDaylight = ({ nightFactor = 0 } = {}) => root.traverse(mesh => {
    if (mesh.userData.materialId === "warmWindow") mesh.material.emissiveIntensity = .15 + nightFactor * .8;
  });
  root.userData.updateDaylight({ nightFactor: nightLighting });
  return root;
}
