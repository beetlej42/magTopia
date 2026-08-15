import * as THREE from "three";
import { createRng, pick, randRange } from "../utils/random.js";

export const PEDESTRIAN_HAIR_STYLES = ["swept", "bob", "curls", "flat-cap", "top-hat", "bare"];
export const PEDESTRIAN_OUTFITS = ["overcoat", "cardigan", "waistcoat", "skirt-coat"];
export const PEDESTRIAN_ACCESSORIES = ["none", "satchel", "scarf", "wand"];
export const VEHICLE_TYPES = ["hatchback", "saloon", "bus"];

const SKIN_TONES = ["#f1c7a0", "#d89c72", "#a96542", "#70412f", "#e8b98d"];
const HAIR_TONES = ["#241b19", "#4a2c20", "#70452c", "#ad774c", "#d6c4aa", "#ded8cf"];
const CLOTHING_PALETTES = [
  { primary: "#6e2634", secondary: "#c29a55", dark: "#29232a", accent: "#e8d7b6" },
  { primary: "#304f3b", secondary: "#8e7748", dark: "#282c2b", accent: "#c9b887" },
  { primary: "#293f5b", secondary: "#855d35", dark: "#272a31", accent: "#d7c7a6" },
  { primary: "#8f6a1f", secondary: "#315246", dark: "#302a26", accent: "#e7d5af" },
  { primary: "#5d3f68", secondary: "#b07c35", dark: "#29252e", accent: "#d8c2a7" }
];
const VEHICLE_COLORS = ["#7d2530", "#164e53", "#c09a38", "#315579", "#d8c9a3", "#4a5638"];

const boxGeometryCache = new Map();
const cylinderGeometryCache = new Map();

export function normalizePedestrianConfig(config = {}) {
  const seed = String(config.seed ?? "street-person-001");
  const rng = createRng(seed);
  const role = ["muggle", "wizard"].includes(config.role)
    ? config.role
    : rng() < clamp(Number(config.magicRatio ?? 0.34), 0, 1) ? "wizard" : "muggle";
  const accessoryPool = role === "wizard" ? PEDESTRIAN_ACCESSORIES : PEDESTRIAN_ACCESSORIES.filter((value) => value !== "wand");
  return {
    seed,
    role,
    hair: PEDESTRIAN_HAIR_STYLES.includes(config.hair) ? config.hair : pick(rng, PEDESTRIAN_HAIR_STYLES),
    outfit: PEDESTRIAN_OUTFITS.includes(config.outfit) ? config.outfit : pick(rng, PEDESTRIAN_OUTFITS),
    accessory: accessoryPool.includes(config.accessory) ? config.accessory : pick(rng, accessoryPool),
    cape: role === "wizard" && (config.cape ?? rng() < clamp(Number(config.capeRatio ?? 0.58), 0, 1)),
    height: clamp(Number(config.height ?? randRange(rng, 0.91, 1.08)), 0.82, 1.16),
    skin: config.skin ?? pick(rng, SKIN_TONES),
    hairColor: config.hairColor ?? pick(rng, HAIR_TONES),
    palette: config.palette ?? pick(rng, CLOTHING_PALETTES),
    phase: Number(config.phase ?? rng() * Math.PI * 2)
  };
}

export function createPedestrianAsset(config = {}) {
  const params = normalizePedestrianConfig(config);
  const root = new THREE.Group();
  root.name = `StreetPedestrian-${params.seed}`;
  root.scale.setScalar(params.height);

  const materials = createMaterials({
    skin: params.skin,
    hair: params.hairColor,
    primary: params.palette.primary,
    secondary: params.palette.secondary,
    dark: params.palette.dark,
    accent: params.palette.accent,
    white: "#f5ead7",
    eye: "#322629",
    brass: "#c89c4b",
    wand: "#4b2e24"
  });
  const rig = createPedestrianRig(root, materials, params);
  addHair(root, materials, params);
  addOutfitDetails(root, materials, params);
  if (params.cape) addCape(root, materials, params);
  addAccessory(root, materials, params, rig);
  configureShadows(root);

  root.userData = {
    assetKind: "pedestrian",
    variant: serializablePedestrianVariant(params),
    rig,
    animatedShadowCaster: true,
    updateWalk(elapsed, intensity = 1) {
      const swing = Math.sin(elapsed * 7 + params.phase) * 0.55 * intensity;
      rig.leftLeg.rotation.x = swing;
      rig.rightLeg.rotation.x = -swing;
      rig.leftArm.rotation.x = -swing * 0.72;
      rig.rightArm.rotation.x = swing * 0.72;
      rig.body.position.y = Math.abs(Math.sin(elapsed * 7 + params.phase)) * 0.025 * intensity;
    }
  };
  return root;
}

export function normalizeVehicleConfig(config = {}) {
  const seed = String(config.seed ?? "street-vehicle-001");
  const rng = createRng(seed);
  const type = VEHICLE_TYPES.includes(config.type) ? config.type : pick(rng, VEHICLE_TYPES);
  const flyingChance = clamp(Number(config.flyingChance ?? 0.06), 0, 1);
  return {
    seed,
    type,
    flying: type !== "bus" && Boolean(config.flying ?? rng() < flyingChance),
    color: config.color ?? pick(rng, VEHICLE_COLORS),
    trim: config.trim ?? (rng() < 0.5 ? "#d8c9a3" : "#b8b2a8"),
    phase: Number(config.phase ?? rng() * Math.PI * 2),
    roofRack: type !== "bus" && Boolean(config.roofRack ?? rng() < 0.22)
  };
}

export function createVehicleAsset(config = {}) {
  const params = normalizeVehicleConfig(config);
  const root = new THREE.Group();
  root.name = `StreetVehicle-${params.type}-${params.seed}`;
  const materials = createMaterials({
    body: params.color,
    trim: params.trim,
    dark: "#25282b",
    tire: "#18191b",
    hub: "#b8b0a0",
    window: "#8fb2b9",
    windowDark: "#46646e",
    lamp: "#fff1bb",
    brake: "#a6292b",
    amber: "#d88224",
    magic: "#8f72ff"
  });
  const spec = vehicleSpec(params.type);
  const body = new THREE.Group();
  body.name = "VehicleBody";
  root.add(body);
  addVehicleBody(body, materials, params, spec);
  const wheels = addWheels(body, materials, spec);
  if (params.roofRack) addRoofRack(body, materials, spec);
  const magicGlow = params.flying ? addFlyingMagic(root, body, materials, spec, params) : null;
  configureShadows(root);

  root.userData = {
    assetKind: "vehicle",
    variant: { ...params },
    wheels,
    body,
    magicGlow,
    animatedShadowCaster: true,
    updateMotion(elapsed) {
      if (params.flying) {
        body.position.y = 0.58 + Math.sin(elapsed * 1.8 + params.phase) * 0.11;
        body.rotation.z = Math.sin(elapsed * 1.15 + params.phase) * 0.025;
        magicGlow.material.opacity = 0.26 + Math.sin(elapsed * 2.4 + params.phase) * 0.08;
      }
    }
  };
  return root;
}

export function getStreetAssetCatalog() {
  return {
    pedestrians: {
      sharedRig: "block-person-v1",
      roles: ["muggle", "wizard"],
      hair: [...PEDESTRIAN_HAIR_STYLES],
      outfits: [...PEDESTRIAN_OUTFITS],
      accessories: [...PEDESTRIAN_ACCESSORIES],
      optionalModules: ["cape", "scarf", "satchel", "wand"]
    },
    vehicles: {
      sharedRig: "voxel-road-vehicle-v1",
      types: [...VEHICLE_TYPES],
      smoothForms: ["wheel", "lamp", "magic-glow"],
      optionalModules: ["roof-rack", "flying-magic"]
    }
  };
}

function createPedestrianRig(root, materials, params) {
  const body = new THREE.Group();
  body.name = "BodyBounce";
  root.add(body);

  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.13, 0.58, 0);
  rightLeg.position.set(0.13, 0.58, 0);
  leftLeg.add(box(0.22, 0.6, 0.28, materials.dark, 0, -0.3, 0));
  rightLeg.add(box(0.22, 0.6, 0.28, materials.dark, 0, -0.3, 0));
  leftLeg.add(box(0.25, 0.13, 0.38, materials.hair, 0, -0.57, 0.05));
  rightLeg.add(box(0.25, 0.13, 0.38, materials.hair, 0, -0.57, 0.05));
  body.add(leftLeg, rightLeg);

  const torsoMaterial = params.outfit === "waistcoat" ? materials.secondary : materials.primary;
  const torso = box(0.68, 0.72, 0.38, torsoMaterial, 0, 0.94, 0);
  torso.geometry = getBoxGeometry(0.68, 0.72, 0.38);
  body.add(torso);
  body.add(box(0.52, 0.12, 0.4, materials.dark, 0, 0.57, 0));
  body.add(box(0.24, 0.2, 0.09, materials.white, 0, 1.18, 0.2));
  body.add(box(0.07, 0.28, 0.07, materials.secondary, 0, 1.07, 0.23));

  const leftArm = limbArm(-0.43, materials, params.palette.primary);
  const rightArm = limbArm(0.43, materials, params.palette.primary);
  body.add(leftArm, rightArm);

  const neck = cylinder(0.12, 0.12, 0.12, 12, materials.skin, 0, 1.36, 0);
  const head = cylinder(0.31, 0.31, 0.48, 16, materials.skin, 0, 1.65, 0);
  body.add(neck, head);
  addFace(body, materials);
  return { body, torso, head, leftLeg, rightLeg, leftArm, rightArm };
}

function limbArm(x, materials, coatColor) {
  const arm = new THREE.Group();
  arm.position.set(x, 1.25, 0);
  const side = Math.sign(x);
  arm.rotation.z = side * -0.08;
  arm.add(box(0.22, 0.6, 0.24, materials.primary, 0, -0.3, 0));
  arm.add(cylinder(0.12, 0.12, 0.16, 10, materials.skin, 0, -0.64, 0));
  return arm;
}

function addFace(body, materials) {
  body.add(box(0.045, 0.08, 0.035, materials.eye, -0.1, 1.7, 0.305));
  body.add(box(0.045, 0.08, 0.035, materials.eye, 0.1, 1.7, 0.305));
  body.add(box(0.12, 0.025, 0.035, materials.secondary, 0, 1.56, 0.307));
}

function addHair(root, materials, params) {
  const hair = new THREE.Group();
  hair.name = `Hair-${params.hair}`;
  if (params.hair !== "bare") {
    const rearHair = box(0.54, 0.34, 0.12, materials.hair, 0, 1.74, -0.275);
    rearHair.name = "RearHair";
    hair.add(rearHair);
  }
  if (params.hair === "swept") {
    hair.add(box(0.58, 0.16, 0.5, materials.hair, 0, 1.93, -0.01));
    hair.add(box(0.25, 0.18, 0.12, materials.hair, 0.17, 1.85, 0.24));
  } else if (params.hair === "bob") {
    hair.add(box(0.64, 0.18, 0.5, materials.hair, 0, 1.93, -0.01));
    hair.add(box(0.12, 0.43, 0.42, materials.hair, -0.31, 1.72, -0.01));
    hair.add(box(0.12, 0.43, 0.42, materials.hair, 0.31, 1.72, -0.01));
  } else if (params.hair === "curls") {
    [[-0.21, 1.92], [0, 1.98], [0.21, 1.92], [-0.3, 1.76], [0.3, 1.76]].forEach(([x, y]) => {
      hair.add(cylinder(0.16, 0.16, 0.18, 8, materials.hair, x, y, 0));
    });
  } else if (params.hair === "flat-cap") {
    hair.add(box(0.62, 0.16, 0.52, materials.dark, 0, 1.96, 0));
    hair.add(box(0.42, 0.08, 0.24, materials.dark, 0, 1.91, 0.27));
  } else if (params.hair === "top-hat") {
    hair.add(cylinder(0.34, 0.34, 0.1, 16, materials.dark, 0, 1.95, 0));
    hair.add(cylinder(0.24, 0.27, 0.48, 12, materials.dark, 0, 2.18, 0));
    hair.add(cylinder(0.275, 0.275, 0.08, 12, materials.primary, 0, 2.02, 0));
  }
  root.add(hair);
}

function addOutfitDetails(root, materials, params) {
  if (params.outfit === "overcoat") {
    root.add(box(0.72, 0.14, 0.41, materials.primary, 0, 0.59, 0));
    [-0.17, 0.17].forEach((x) => root.add(cylinder(0.035, 0.035, 0.035, 8, materials.brass, x, 0.96, 0.215, Math.PI / 2)));
  } else if (params.outfit === "cardigan") {
    root.add(box(0.06, 0.58, 0.035, materials.accent, 0, 0.96, 0.215));
  } else if (params.outfit === "waistcoat") {
    root.add(box(0.42, 0.48, 0.035, materials.secondary, 0, 0.96, 0.215));
    root.add(box(0.06, 0.48, 0.04, materials.white, 0, 0.98, 0.235));
  } else if (params.outfit === "skirt-coat") {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 0.64, 4), materials.primary);
    skirt.position.set(0, 0.42, 0);
    skirt.rotation.y = Math.PI / 4;
    root.add(skirt);
  }
}

function addCape(root, materials, params) {
  const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.52, 1.05, 8, 1, true, 0.45, Math.PI * 1.72), materials.primary);
  cape.name = "Cape";
  cape.position.set(0, 0.95, -0.2);
  cape.rotation.y = Math.PI;
  root.add(cape);
  root.add(cylinder(0.36, 0.36, 0.12, 12, materials.secondary, 0, 1.34, 0));
}

function addAccessory(root, materials, params, rig) {
  if (params.accessory === "satchel") {
    const strap = box(0.06, 1.15, 0.05, materials.secondary, 0, 1.02, 0.22);
    strap.rotation.z = -0.48;
    root.add(strap, box(0.38, 0.34, 0.16, materials.secondary, 0.36, 0.72, 0.26));
  } else if (params.accessory === "scarf") {
    root.add(cylinder(0.34, 0.34, 0.18, 12, materials.secondary, 0, 1.36, 0));
    root.add(box(0.16, 0.55, 0.08, materials.secondary, 0.22, 1.1, 0.25));
  } else if (params.accessory === "wand") {
    const wand = cylinder(0.025, 0.035, 0.68, 8, materials.wand, 0, -0.73, 0);
    wand.rotation.z = -0.18;
    rig.rightArm.add(wand);
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), materials.brass);
    spark.position.set(0.12, -1.06, 0);
    rig.rightArm.add(spark);
  }
}

function addVehicleBody(body, materials, params, spec) {
  body.add(box(spec.length, spec.baseHeight, spec.width, materials.body, 0, spec.wheelRadius + spec.baseHeight * 0.45, 0));
  body.add(box(spec.length + 0.12, 0.12, spec.width + 0.08, materials.dark, 0, spec.wheelRadius + 0.08, 0));
  if (params.type === "hatchback") addHatchbackCabin(body, materials, spec);
  if (params.type === "saloon") addSaloonCabin(body, materials, spec);
  if (params.type === "bus") addBusCabin(body, materials, spec);
  addVehicleFace(body, materials, spec, params.type);
}

function addHatchbackCabin(body, materials, spec) {
  body.add(box(1.7, 0.66, spec.width * 0.88, materials.body, 0.18, 1.12, 0));
  body.add(box(0.7, 0.48, spec.width * 0.91, materials.window, -0.33, 1.18, 0));
  body.add(box(0.5, 0.48, spec.width * 0.91, materials.windowDark, 0.43, 1.18, 0));
  body.add(box(1.82, 0.1, spec.width * 0.92, materials.trim, 0.16, 1.5, 0));
}

function addSaloonCabin(body, materials, spec) {
  body.add(box(1.62, 0.62, spec.width * 0.86, materials.body, -0.05, 1.1, 0));
  body.add(box(0.63, 0.45, spec.width * 0.9, materials.window, -0.43, 1.17, 0));
  body.add(box(0.63, 0.45, spec.width * 0.9, materials.windowDark, 0.36, 1.17, 0));
  body.add(box(1.76, 0.1, spec.width * 0.9, materials.trim, -0.04, 1.46, 0));
  body.add(box(0.68, 0.23, spec.width * 0.88, materials.body, 1.13, 0.94, 0));
}

function addBusCabin(body, materials, spec) {
  body.add(box(spec.length * 0.94, 1.9, spec.width * 0.92, materials.body, -0.03, 1.72, 0));
  body.add(box(spec.length * 0.88, 0.54, spec.width * 0.94, materials.window, -0.03, 2.2, 0));
  body.add(box(spec.length * 0.88, 0.52, spec.width * 0.94, materials.windowDark, -0.03, 1.36, 0));
  [-1.18, -0.4, 0.38, 1.16].forEach((x) => {
    body.add(box(0.08, 1.52, spec.width * 0.97, materials.trim, x, 1.78, 0));
  });
  body.add(box(spec.length * 0.98, 0.13, spec.width * 0.95, materials.trim, -0.03, 2.7, 0));
}

function addVehicleFace(body, materials, spec, type) {
  const frontX = spec.length / 2 + 0.045;
  const lampY = spec.wheelRadius + (type === "bus" ? 0.58 : 0.48);
  [-spec.width * 0.31, spec.width * 0.31].forEach((z) => {
    const lamp = cylinder(type === "bus" ? 0.13 : 0.11, type === "bus" ? 0.13 : 0.11, 0.08, 12, materials.lamp, frontX, lampY, z);
    lamp.rotation.z = Math.PI / 2;
    body.add(lamp);
  });
  body.add(box(0.08, type === "bus" ? 0.36 : 0.24, spec.width * 0.45, materials.dark, frontX, lampY, 0));
  body.add(box(0.1, 0.09, spec.width * 0.92, materials.trim, frontX + 0.03, spec.wheelRadius + 0.19, 0));
  body.add(box(0.08, 0.12, spec.width * 0.18, materials.amber, frontX + 0.03, lampY - 0.2, -spec.width * 0.34));
  body.add(box(0.08, 0.12, spec.width * 0.18, materials.amber, frontX + 0.03, lampY - 0.2, spec.width * 0.34));
}

function addWheels(body, materials, spec) {
  const wheels = [];
  for (const x of spec.axles) {
    for (const side of [-1, 1]) {
      const wheel = cylinder(spec.wheelRadius, spec.wheelRadius, 0.2, 16, materials.tire, x, spec.wheelRadius, side * (spec.width / 2 + 0.04));
      wheel.rotation.x = Math.PI / 2;
      wheel.add(cylinder(spec.wheelRadius * 0.48, spec.wheelRadius * 0.48, 0.215, 12, materials.hub, 0, 0, 0, 0));
      body.add(wheel);
      wheels.push(wheel);
    }
  }
  return wheels;
}

function addRoofRack(body, materials, spec) {
  const y = spec.type === "bus" ? 2.85 : 1.63;
  const rack = new THREE.Group();
  rack.name = "RoofRack";
  [-0.42, 0.42].forEach((z) => rack.add(box(1.45, 0.045, 0.045, materials.trim, 0, y, z)));
  [-0.62, 0.62].forEach((x) => rack.add(box(0.045, 0.045, 0.88, materials.trim, x, y, 0)));
  body.add(rack);
}

function addFlyingMagic(root, body, materials, spec, params) {
  const glowMaterial = materials.magic.clone();
  glowMaterial.transparent = true;
  glowMaterial.opacity = 0.3;
  glowMaterial.depthWrite = false;
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(spec.length * 0.35, spec.length * 0.48, 0.05, 20), glowMaterial);
  glow.position.y = 0.08;
  root.add(glow);
  for (let index = 0; index < 5; index += 1) {
    const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.045 + index * 0.008, 0), materials.magic);
    const angle = (index / 5) * Math.PI * 2 + params.phase;
    spark.position.set(Math.cos(angle) * 1.25, 0.2 + (index % 2) * 0.18, Math.sin(angle) * 0.75);
    spark.userData.float = 0.5;
    spark.userData.floatOriginY = spark.position.y;
    spark.userData.floatPhase = params.phase + index;
    root.add(spark);
  }
  body.position.y = 0.58;
  return glow;
}

function vehicleSpec(type) {
  if (type === "bus") return { type, length: 4.4, width: 1.48, baseHeight: 0.76, wheelRadius: 0.38, axles: [-1.48, 1.48] };
  if (type === "saloon") return { type, length: 2.75, width: 1.15, baseHeight: 0.58, wheelRadius: 0.3, axles: [-0.87, 0.91] };
  return { type, length: 2.35, width: 1.12, baseHeight: 0.56, wheelRadius: 0.29, axles: [-0.72, 0.72] };
}

function serializablePedestrianVariant(params) {
  return {
    seed: params.seed,
    role: params.role,
    hair: params.hair,
    outfit: params.outfit,
    accessory: params.accessory,
    cape: params.cape,
    height: params.height,
    skin: params.skin,
    hairColor: params.hairColor,
    palette: { ...params.palette },
    phase: params.phase
  };
}

function createMaterials(colors) {
  return Object.fromEntries(Object.entries(colors).map(([name, color]) => [name, new THREE.MeshStandardMaterial({
    name: `StreetAsset-${name}`,
    color,
    roughness: name === "window" || name === "windowDark" ? 0.28 : 0.76,
    metalness: ["trim", "hub", "brass"].includes(name) ? 0.32 : 0,
    emissive: name === "lamp" || name === "magic" ? color : "#000000",
    emissiveIntensity: name === "lamp" ? 0.32 : name === "magic" ? 0.62 : 0
  })]));
}

function box(width, height, depth, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(getBoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function cylinder(radiusTop, radiusBottom, height, segments, material, x = 0, y = 0, z = 0, rotationZ = 0) {
  const key = `${radiusTop}:${radiusBottom}:${height}:${segments}`;
  if (!cylinderGeometryCache.has(key)) cylinderGeometryCache.set(key, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments));
  const mesh = new THREE.Mesh(cylinderGeometryCache.get(key), material);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rotationZ;
  return mesh;
}

function getBoxGeometry(width, height, depth) {
  const key = `${width}:${height}:${depth}`;
  if (!boxGeometryCache.has(key)) boxGeometryCache.set(key, new THREE.BoxGeometry(width, height, depth));
  return boxGeometryCache.get(key);
}

function configureShadows(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);
}
