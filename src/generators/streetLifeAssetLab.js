import * as THREE from "three";
import { createRng, pick, randRange } from "../utils/random.js";
import {
  VEHICLE_TYPES,
  createPedestrianAsset,
  createVehicleAsset,
  getStreetAssetCatalog
} from "./streetLifeAssets.js";

export const STREET_LIFE_PRESETS = {
  mixedLondonStreet: {
    seed: "street-life-mixed-001",
    sunTime: 0.6,
    pedestrianCount: 10,
    vehicleCount: 5,
    magicRatio: 0.34,
    capeRatio: 0.58,
    flyingCarChance: 0.08,
    animationSpeed: 1,
    showMotion: 1
  },
  mostlyMuggles: {
    seed: "street-life-muggles-001",
    sunTime: 0.56,
    pedestrianCount: 12,
    vehicleCount: 6,
    magicRatio: 0.12,
    capeRatio: 0.35,
    flyingCarChance: 0.025,
    animationSpeed: 0.9,
    showMotion: 1
  },
  magicalRushHour: {
    seed: "street-life-magic-001",
    sunTime: 0.67,
    pedestrianCount: 12,
    vehicleCount: 6,
    magicRatio: 0.62,
    capeRatio: 0.75,
    flyingCarChance: 0.2,
    animationSpeed: 1.15,
    showMotion: 1
  }
};

export function normalizeStreetLifeConfig(config = {}) {
  const base = { ...STREET_LIFE_PRESETS.mixedLondonStreet, ...config };
  return {
    ...base,
    seed: String(base.seed ?? STREET_LIFE_PRESETS.mixedLondonStreet.seed),
    sunTime: clamp(base.sunTime, 0, 1),
    pedestrianCount: Math.round(clamp(base.pedestrianCount, 4, 16)),
    vehicleCount: Math.round(clamp(base.vehicleCount, 3, 8)),
    magicRatio: clamp(base.magicRatio, 0, 1),
    capeRatio: clamp(base.capeRatio, 0, 1),
    flyingCarChance: clamp(base.flyingCarChance, 0, 0.4),
    animationSpeed: clamp(base.animationSpeed, 0, 2),
    showMotion: Math.round(clamp(base.showMotion, 0, 1))
  };
}

export function createRandomStreetLifeConfig(seed = Date.now(), base = {}) {
  const rng = createRng(String(seed));
  return normalizeStreetLifeConfig({
    ...STREET_LIFE_PRESETS.mixedLondonStreet,
    ...base,
    seed: String(seed),
    pedestrianCount: 8 + Math.floor(rng() * 7),
    vehicleCount: 4 + Math.floor(rng() * 4),
    magicRatio: randRange(rng, 0.12, 0.62),
    capeRatio: randRange(rng, 0.35, 0.82),
    flyingCarChance: randRange(rng, 0.03, 0.2)
  });
}

export function getStreetLifeContract(config = {}) {
  const params = normalizeStreetLifeConfig(config);
  return {
    mode: "streetlife",
    phase: "visual-prototype",
    integrationStatus: "standalone-lab-only",
    movementIntent: {
      pedestrians: "sidewalk routes, crossings, random building-to-building trips",
      vehicles: "road graph lanes",
      flyingVehicles: "rare magical override of road vehicle route"
    },
    counts: { pedestrians: params.pedestrianCount, vehicles: params.vehicleCount },
    probabilities: {
      wizard: params.magicRatio,
      capeAmongWizards: params.capeRatio,
      flyingCar: params.flyingCarChance
    },
    catalog: getStreetAssetCatalog()
  };
}

export function createStreetLifeAssetLab(config = {}) {
  const params = normalizeStreetLifeConfig(config);
  const root = new THREE.Group();
  root.name = "StreetLifeAssetLab";
  const rng = createRng(`${params.seed}:layout`);
  const pedestrians = [];
  const vehicles = [];

  root.add(createStudyGround());
  const personDeck = createDeck({ x: -4.6, z: -0.2, width: 7.6, depth: 8.4, color: "#ead9e7" });
  const vehicleDeck = createDeck({ x: 4.4, z: -0.2, width: 8.4, depth: 8.4, color: "#d9e3e2" });
  root.add(personDeck, vehicleDeck);
  addSectionMarker(root, -4.6, 0.16, -4.05, "#a45a91", 3);
  addSectionMarker(root, 4.4, 0.16, -4.05, "#397b78", 3.4);

  for (let index = 0; index < params.pedestrianCount; index += 1) {
    const person = createPedestrianAsset({
      seed: `${params.seed}:person:${index}`,
      magicRatio: params.magicRatio,
      capeRatio: params.capeRatio,
      phase: rng() * Math.PI * 2
    });
    const column = index % 4;
    const row = Math.floor(index / 4);
    person.position.set(-7.2 + column * 1.7, 0.18, -2.65 + row * 2.1);
    person.rotation.y = row % 2 === 0 ? -0.16 : Math.PI + 0.12;
    person.userData.basePosition = person.position.clone();
    person.userData.motionPhase = rng() * Math.PI * 2;
    person.userData.motionDirection = row % 2 === 0 ? 1 : -1;
    pedestrians.push(person);
    root.add(person);
  }

  const forcedTypes = [...VEHICLE_TYPES];
  for (let index = 0; index < params.vehicleCount; index += 1) {
    const type = forcedTypes[index] ?? pick(rng, VEHICLE_TYPES.filter((vehicleType) => vehicleType !== "bus"));
    const vehicle = createVehicleAsset({
      seed: `${params.seed}:vehicle:${index}`,
      type,
      flyingChance: index < forcedTypes.length ? 0 : params.flyingCarChance,
      flying: index === params.vehicleCount - 1 && params.flyingCarChance >= 0.12 ? true : undefined,
      phase: rng() * Math.PI * 2
    });
    const row = index % 3;
    const column = Math.floor(index / 3);
    vehicle.position.set(2.6 + column * 3.65, 0.18, -2.4 + row * 2.55);
    vehicle.rotation.y = row % 2 === 0 ? 0 : Math.PI;
    vehicle.userData.basePosition = vehicle.position.clone();
    vehicle.userData.motionPhase = rng() * Math.PI * 2;
    vehicle.userData.motionDirection = row % 2 === 0 ? 1 : -1;
    vehicles.push(vehicle);
    root.add(vehicle);
  }

  root.userData = {
    config: params,
    contract: getStreetLifeContract(params),
    pedestrians,
    vehicles,
    update(elapsed) {
      const motion = params.showMotion ? params.animationSpeed : 0;
      pedestrians.forEach((person, index) => {
        person.userData.updateWalk(elapsed * params.animationSpeed, motion > 0 ? 0.55 : 0);
        if (!motion) return;
        const base = person.userData.basePosition;
        const travel = Math.sin(elapsed * 0.52 * motion + person.userData.motionPhase);
        person.position.z = base.z + travel * 0.42;
        person.rotation.y = travel * person.userData.motionDirection >= 0 ? 0 : Math.PI;
      });
      vehicles.forEach((vehicle) => {
        vehicle.userData.updateMotion(elapsed);
        if (!motion) return;
        const base = vehicle.userData.basePosition;
        const travel = Math.sin(elapsed * 0.35 * motion + vehicle.userData.motionPhase);
        vehicle.position.x = base.x + travel * 0.46;
      });
    },
    getStreetLifeDiagnostics() {
      const wizardCount = pedestrians.filter((person) => person.userData.variant.role === "wizard").length;
      const flyingVehicleCount = vehicles.filter((vehicle) => vehicle.userData.variant.flying).length;
      return {
        pedestrianCount: pedestrians.length,
        wizardCount,
        muggleCount: pedestrians.length - wizardCount,
        vehicleCount: vehicles.length,
        flyingVehicleCount,
        vehicleTypes: vehicles.reduce((counts, vehicle) => {
          const type = vehicle.userData.variant.type;
          counts[type] = (counts[type] ?? 0) + 1;
          return counts;
        }, {})
      };
    }
  };
  return root;
}

function createStudyGround() {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.14, 10),
    new THREE.MeshStandardMaterial({ color: "#f2e9ed", roughness: 0.96 })
  );
  ground.receiveShadow = true;
  group.add(ground);
  const divider = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.05, 8.5),
    new THREE.MeshStandardMaterial({ color: "#c5a7bb", roughness: 0.8 })
  );
  divider.position.set(0, 0.1, -0.1);
  group.add(divider);
  return group;
}

function createDeck({ x, z, width, depth, color }) {
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.1, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 })
  );
  deck.position.set(x, 0.1, z);
  deck.receiveShadow = true;
  return deck;
}

function addSectionMarker(root, x, y, z, color, width) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.68 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.12), material);
  bar.position.set(x, y, z);
  root.add(bar);
  for (const side of [-1, 1]) {
    const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), material);
    pip.position.set(x + side * (width / 2 + 0.18), y, z);
    root.add(pip);
  }
}

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  return Math.min(Math.max(Number.isFinite(numeric) ? numeric : minimum, minimum), maximum);
}
