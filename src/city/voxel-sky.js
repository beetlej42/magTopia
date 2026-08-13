import * as THREE from "three";
import { createRng } from "../utils/random.js";

const TAU = Math.PI * 2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const SKY_RADIUS = 190;

const SKY_STOPS = Object.freeze([
  [0, "#091126", "#182543"],
  [0.16, "#111d3b", "#6d5573"],
  [0.23, "#31527a", "#e68a78"],
  [0.3, "#75a8cc", "#f1c6a7"],
  [0.5, "#80bad9", "#d8edf2"],
  [0.7, "#69a0c3", "#f4b789"],
  [0.77, "#3a4d79", "#d47d7e"],
  [0.84, "#151f42", "#594967"],
  [1, "#091126", "#182543"]
]);

export function getVoxelSkyState(inputTime = 0.5) {
  const time = wrap01(inputTime);
  const solarAngle = (time - 0.25) * TAU;
  const solarHeight = Math.sin(solarAngle);
  const daylight = smoothstep(-0.08, 0.18, solarHeight);
  const night = 1 - smoothstep(-0.18, 0.08, solarHeight);
  const twilight = (1 - Math.abs(2 * daylight - 1)) * (1 - night * 0.35);
  const [topColor, horizonColor] = sampleSkyStops(time);
  return {
    time,
    solarAngle,
    solarHeight,
    daylight,
    night,
    twilight,
    topColor,
    horizonColor,
    cloudColor: new THREE.Color("#7e87a5").lerp(new THREE.Color("#fff7e7"), daylight),
    cloudShadowColor: new THREE.Color("#39405f").lerp(new THREE.Color("#b9cbd3"), daylight),
    starOpacity: smoothstep(0.05, 0.65, night),
    sunOpacity: smoothstep(-0.08, 0.08, solarHeight),
    moonOpacity: smoothstep(-0.08, 0.1, -solarHeight)
  };
}

export function createVoxelSky(options = {}) {
  const root = new THREE.Group();
  root.name = "VoxelSky";
  root.frustumCulled = false;

  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      topColor: { value: new THREE.Color("#80bad9") },
      horizonColor: { value: new THREE.Color("#d8edf2") },
      bottomColor: { value: new THREE.Color("#adc8d2") }
    },
    vertexShader: `
      varying float vScreenHeight;
      void main() {
        vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vScreenHeight = clipPosition.y / clipPosition.w;
        gl_Position = clipPosition;
      }
    `,
    fragmentShader: `
      varying float vScreenHeight;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      void main() {
        float upper = smoothstep(0.62, 0.98, vScreenHeight);
        float lower = smoothstep(0.28, 0.64, vScreenHeight);
        vec3 lowSky = mix(bottomColor, horizonColor, lower);
        vec3 sky = mix(lowSky, topColor, upper);
        gl_FragColor = vec4(sky, 1.0);
      }
    `
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 18), domeMaterial);
  dome.name = "VoxelSkyDome";
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  root.add(dome);

  const stars = createStars(options.mobile ? 72 : 128, options.seed ?? "magtopia-sky-001");
  root.add(stars);

  const sun = createPixelCelestial("sun");
  const moon = createPixelCelestial("moon");
  root.add(sun, moon);

  const clouds = createCloudField(options.mobile ? 5 : 7, options.seed ?? "magtopia-sky-001");
  root.add(clouds.group);

  const skyUp = new THREE.Vector3();
  const inverseSkyRotation = new THREE.Quaternion();
  const cameraWorldQuaternion = new THREE.Quaternion();
  const celestialBillboardQuaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const forwardLocal = new THREE.Vector3();
  const horizontalForward = new THREE.Vector3();
  const screenRight = new THREE.Vector3();
  const screenUp = new THREE.Vector3();
  const celestialPosition = new THREE.Vector3();
  const bottomColor = new THREE.Color();
  const moonColor = new THREE.Color();
  const starBasis = new THREE.Matrix4();
  const starForwardAxis = new THREE.Vector3();
  let lastState = getVoxelSkyState(options.time ?? 0.5);

  function update({ time = lastState.time, elapsed = 0, camera }) {
    if (!camera) return lastState;
    lastState = getVoxelSkyState(time);

    root.position.copy(camera.position);
    skyUp.copy(camera.up).normalize();
    root.quaternion.setFromUnitVectors(WORLD_UP, skyUp);
    inverseSkyRotation.copy(root.quaternion).invert();
    camera.getWorldQuaternion(cameraWorldQuaternion);
    celestialBillboardQuaternion.copy(inverseSkyRotation).multiply(cameraWorldQuaternion);
    camera.getWorldDirection(forward);
    forwardLocal.copy(forward).applyQuaternion(inverseSkyRotation);
    horizontalForward.set(forwardLocal.x, 0, forwardLocal.z);
    if (horizontalForward.lengthSq() < 0.0001) horizontalForward.set(0, 0, -1);
    horizontalForward.normalize();
    screenRight.crossVectors(horizontalForward, WORLD_UP).normalize();
    screenUp.crossVectors(screenRight, forwardLocal).normalize();
    starForwardAxis.copy(forwardLocal).multiplyScalar(-1);
    starBasis.makeBasis(screenRight, screenUp, starForwardAxis);
    stars.quaternion.setFromRotationMatrix(starBasis);

    domeMaterial.uniforms.topColor.value.copy(lastState.topColor);
    domeMaterial.uniforms.horizonColor.value.copy(lastState.horizonColor);
    bottomColor.copy(lastState.horizonColor).multiplyScalar(0.68 + lastState.daylight * 0.2);
    domeMaterial.uniforms.bottomColor.value.copy(bottomColor);

    stars.material.opacity = lastState.starOpacity * (0.78 + Math.sin(elapsed * 1.6) * 0.1);
    stars.visible = stars.material.opacity > 0.01;

    positionCelestial(sun, lastState.solarAngle, lastState.sunOpacity, 178);
    positionCelestial(moon, lastState.solarAngle + Math.PI, lastState.moonOpacity, 176);
    moonColor.set("#dfe8ff").lerp(new THREE.Color("#fff0c7"), lastState.twilight * 0.3);
    moon.userData.material.opacity = lastState.moonOpacity;
    moon.userData.material.color.copy(moonColor);
    sun.userData.material.opacity = lastState.sunOpacity;
    if (sun.userData.haloMaterial) {
      sun.userData.haloMaterial.opacity = lastState.sunOpacity * (0.14 + lastState.twilight * 0.24);
    }

    clouds.materials.light.color.copy(lastState.cloudColor);
    clouds.materials.shadow.color.copy(lastState.cloudShadowColor);
    clouds.materials.light.opacity = 0.35 + lastState.daylight * 0.48;
    clouds.materials.shadow.opacity = 0.24 + lastState.daylight * 0.3;
    updateClouds(clouds.entries, elapsed, forwardLocal, screenRight, screenUp);
    return lastState;
  }

  function positionCelestial(object, angle, opacity, radius) {
    const elevation = Math.sin(angle);
    const horizontal = Math.cos(angle);
    celestialPosition.copy(forwardLocal).multiplyScalar(radius)
      .addScaledVector(screenRight, horizontal * radius * 0.42)
      .addScaledVector(screenUp, 10 + Math.max(0, elevation) * 40);
    object.position.copy(celestialPosition);
    object.quaternion.copy(celestialBillboardQuaternion);
    object.visible = opacity > 0.01 && elevation > -0.16;
  }

  function dispose() {
    root.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
      else object.material?.dispose?.();
    });
  }

  root.userData.update = update;
  root.userData.dispose = dispose;
  root.userData.getState = () => ({
    time: lastState.time,
    daylight: lastState.daylight,
    night: lastState.night,
    starOpacity: lastState.starOpacity,
    cloudCount: clouds.entries.length
  });
  return root;
}

function createStars(count, seed) {
  const rng = createRng(`${seed}:stars`);
  const geometry = new THREE.BoxGeometry(0.48, 0.48, 0.2);
  const material = new THREE.MeshBasicMaterial({
    color: "#fff5d6",
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "VoxelStars";
  mesh.renderOrder = -940;
  mesh.frustumCulled = false;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  for (let index = 0; index < count; index += 1) {
    const radius = THREE.MathUtils.lerp(176, 184, rng());
    position.set(
      THREE.MathUtils.lerp(-92, 92, rng()),
      THREE.MathUtils.lerp(-5, 45, Math.pow(rng(), 0.82)),
      -radius
    );
    const size = rng() > 0.92 ? THREE.MathUtils.lerp(1.15, 1.55, rng()) : THREE.MathUtils.lerp(0.42, 0.88, rng());
    scale.setScalar(size);
    quaternion.identity();
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function createPixelCelestial(kind) {
  const group = new THREE.Group();
  group.name = kind === "sun" ? "VoxelSun" : "VoxelMoon";
  group.renderOrder = -920;
  const material = new THREE.MeshBasicMaterial({
    color: kind === "sun" ? "#ffd76a" : "#dfe8ff",
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true
  });
  const geometry = new THREE.BoxGeometry(2.2, 2.2, 0.9);
  const blocks = [];
  const mask = kind === "sun"
    ? ["0011100", "0111110", "1111111", "1111111", "1111111", "0111110", "0011100"]
    : ["0011100", "0111000", "1110000", "1100000", "1100000", "1110000", "0111000", "0011100"];
  mask.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell !== "1") return;
      blocks.push([(columnIndex - 3) * 2.05, ((mask.length - 1) / 2 - rowIndex) * 2.05, 0]);
    });
  });
  const pixels = new THREE.InstancedMesh(geometry, material, blocks.length);
  const matrix = new THREE.Matrix4();
  blocks.forEach((position, index) => {
    matrix.makeTranslation(...position);
    pixels.setMatrixAt(index, matrix);
  });
  pixels.instanceMatrix.needsUpdate = true;
  pixels.renderOrder = -920;
  pixels.frustumCulled = false;
  group.add(pixels);
  group.scale.setScalar(kind === "sun" ? 0.52 : 0.5);
  group.userData.material = material;
  return group;
}

function createCloudField(count, seed) {
  const rng = createRng(`${seed}:clouds`);
  const group = new THREE.Group();
  group.name = "VoxelCloudField";
  const light = new THREE.MeshBasicMaterial({
    color: "#fff7e7",
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: true
  });
  const shadow = new THREE.MeshBasicMaterial({
    color: "#b9cbd3",
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    depthTest: true
  });
  const entries = [];
  let lightCount = 0;
  let shadowCount = 0;
  for (let index = 0; index < count; index += 1) {
    const blockCount = 5 + Math.floor(rng() * 5);
    const blocks = [];
    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
      const width = THREE.MathUtils.lerp(4.5, 8.5, rng());
      const height = THREE.MathUtils.lerp(2.2, 4.6, rng());
      const depth = THREE.MathUtils.lerp(2.8, 6.4, rng());
      const position = new THREE.Vector3(
        (blockIndex - (blockCount - 1) / 2) * 3.35 + THREE.MathUtils.lerp(-1.4, 1.4, rng()),
        THREE.MathUtils.lerp(-1, 3.2, rng()),
        THREE.MathUtils.lerp(-2.6, 2.6, rng())
      );
      const quaternion = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, (rng() - 0.5) * 0.18);
      const scale = new THREE.Vector3(width, height, depth);
      const materialKey = blockIndex % 4 === 0 ? "shadow" : "light";
      const instanceIndex = materialKey === "shadow" ? shadowCount++ : lightCount++;
      blocks.push({
        materialKey,
        instanceIndex,
        matrix: new THREE.Matrix4().compose(position, quaternion, scale)
      });
    }
    const scale = THREE.MathUtils.lerp(0.4, 0.64, rng());
    entries.push({
      blocks,
      scale,
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      baseAngle: (index / count) * TAU + rng() * 0.42,
      radius: THREE.MathUtils.lerp(164, 174, rng()),
      height: THREE.MathUtils.lerp(34, 52, rng()),
      speed: THREE.MathUtils.lerp(0.006, 0.014, rng()),
      bob: THREE.MathUtils.lerp(0.5, 1.8, rng()),
      phase: rng() * TAU
    });
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const lightMesh = new THREE.InstancedMesh(geometry, light, lightCount);
  const shadowMesh = new THREE.InstancedMesh(geometry, shadow, shadowCount);
  [lightMesh, shadowMesh].forEach((mesh) => {
    mesh.renderOrder = -900;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  entries.forEach((entry) => updateCloudEntryInstances(entry, lightMesh, shadowMesh));
  lightMesh.instanceMatrix.needsUpdate = true;
  shadowMesh.instanceMatrix.needsUpdate = true;
  return { group, entries, materials: { light, shadow }, meshes: { light: lightMesh, shadow: shadowMesh } };
}

function updateClouds(entries, elapsed, forwardLocal, screenRight, screenUp) {
  let lightMesh = null;
  let shadowMesh = null;
  entries.forEach((entry) => {
    const driftRange = 164;
    const initialOffset = ((entry.baseAngle / TAU) - 0.5) * driftRange;
    const drift = ((initialOffset + elapsed * entry.speed * 82 + driftRange * 1.5) % driftRange) - driftRange / 2;
    entry.position.copy(forwardLocal).multiplyScalar(entry.radius)
      .addScaledVector(screenRight, drift)
      .addScaledVector(screenUp, entry.height + Math.sin(elapsed * 0.13 + entry.phase) * entry.bob);
    entry.quaternion.setFromRotationMatrix(cloudLookAtMatrix.lookAt(entry.position, cloudOrigin, WORLD_UP));
    lightMesh ??= entry.blocks.find((block) => block.materialKey === "light")?.mesh ?? null;
    shadowMesh ??= entry.blocks.find((block) => block.materialKey === "shadow")?.mesh ?? null;
    updateCloudEntryInstances(entry, lightMesh, shadowMesh);
  });
  if (lightMesh) lightMesh.instanceMatrix.needsUpdate = true;
  if (shadowMesh) shadowMesh.instanceMatrix.needsUpdate = true;
}

const cloudWorldMatrix = new THREE.Matrix4();
const cloudInstanceMatrix = new THREE.Matrix4();
const cloudScaleVector = new THREE.Vector3();
const cloudLookAtMatrix = new THREE.Matrix4();
const cloudOrigin = new THREE.Vector3();

function updateCloudEntryInstances(entry, lightMesh, shadowMesh) {
  cloudScaleVector.setScalar(entry.scale);
  cloudWorldMatrix.compose(entry.position, entry.quaternion, cloudScaleVector);
  entry.blocks.forEach((block) => {
    const mesh = block.materialKey === "shadow" ? shadowMesh : lightMesh;
    if (!mesh) return;
    block.mesh = mesh;
    cloudInstanceMatrix.multiplyMatrices(cloudWorldMatrix, block.matrix);
    mesh.setMatrixAt(block.instanceIndex, cloudInstanceMatrix);
  });
}

function sampleSkyStops(time) {
  let lower = SKY_STOPS[0];
  let upper = SKY_STOPS[SKY_STOPS.length - 1];
  for (let index = 1; index < SKY_STOPS.length; index += 1) {
    if (time <= SKY_STOPS[index][0]) {
      lower = SKY_STOPS[index - 1];
      upper = SKY_STOPS[index];
      break;
    }
  }
  const amount = smoothstep(lower[0], upper[0], time);
  return [
    new THREE.Color(lower[1]).lerp(new THREE.Color(upper[1]), amount),
    new THREE.Color(lower[2]).lerp(new THREE.Color(upper[2]), amount)
  ];
}

function smoothstep(min, max, value) {
  if (max === min) return value < min ? 0 : 1;
  const normalized = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function wrap01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return ((numeric % 1) + 1) % 1;
}
