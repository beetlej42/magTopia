import * as THREE from "three";

const QUERY_PARAM = "voxelGlint";
const PATCH_FLAG = "__magtopiaVoxelTopologyGlintPatched";
const HARD_SURFACE_KINDS = new Set([1, 2, 3, 4]);
const GEOMETRY_EDGE_DOT_THRESHOLD = 0.985;
const MATERIAL_COLOR_DELTA = 0.065;

function queryEnabled() {
  if (typeof globalThis.location?.search !== "string") return false;
  const value = new URLSearchParams(globalThis.location.search).get(QUERY_PARAM);
  return value === "1" || value === "true" || value === "on";
}

function quantizedPositionKey(vector) {
  return `${Math.round(vector.x * 10000)},${Math.round(vector.y * 10000)},${Math.round(vector.z * 10000)}`;
}

function edgeKey(a, b) {
  const aKey = quantizedPositionKey(a);
  const bKey = quantizedPositionKey(b);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function triangleNormal(position, a, b, c) {
  const va = new THREE.Vector3().fromBufferAttribute(position, a);
  const vb = new THREE.Vector3().fromBufferAttribute(position, b);
  const vc = new THREE.Vector3().fromBufferAttribute(position, c);
  return vb.sub(va).cross(vc.sub(va.clone())).normalize();
}

function triangleColor(color, a, b, c) {
  if (!color) return new THREE.Color(1, 1, 1);
  return new THREE.Color(
    (color.getX(a) + color.getX(b) + color.getX(c)) / 3,
    (color.getY(a) + color.getY(b) + color.getY(c)) / 3,
    (color.getZ(a) + color.getZ(b) + color.getZ(c)) / 3
  );
}

function triangleSurfaceKind(surfaceKind, a, b, c) {
  if (!surfaceKind) return 0;
  return Math.round((surfaceKind.getX(a) + surfaceKind.getX(b) + surfaceKind.getX(c)) / 3);
}

function isHardSurface(kind) {
  return HARD_SURFACE_KINDS.has(Math.round(kind));
}

function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function pushEdge(output, first, second, type) {
  const midpoint = first.a.clone().add(first.b).multiplyScalar(0.5);
  const selection = type === "seam" ? 0.075 : 0.13;
  const seed = hash01(`${type}:${quantizedPositionKey(midpoint)}`);
  if (seed > selection) return;

  const normal = second
    ? first.normal.clone().add(second.normal).normalize()
    : first.normal.clone();
  const length = first.a.distanceTo(first.b);
  if (length < 1e-5) return;

  const strength = type === "seam" ? 0.62 : type === "boundary" ? 0.82 : 1;
  output.positions.push(
    first.a.x, first.a.y, first.a.z,
    first.b.x, first.b.y, first.b.z
  );
  output.normals.push(
    normal.x, normal.y, normal.z,
    normal.x, normal.y, normal.z
  );
  output.along.push(0, 1);
  output.seeds.push(seed, seed);
  output.strengths.push(strength, strength);
  output.lengths.push(length, length);
}

export function extractVoxelTopologyGlintGeometry(sourceGeometry) {
  const position = sourceGeometry?.getAttribute?.("position");
  const index = sourceGeometry?.getIndex?.();
  const surfaceKind = sourceGeometry?.getAttribute?.("voxelSurfaceKind");
  const color = sourceGeometry?.getAttribute?.("color");
  if (!position || !index || !surfaceKind) return null;

  const pending = new Map();
  const output = {
    positions: [],
    normals: [],
    along: [],
    seeds: [],
    strengths: [],
    lengths: []
  };

  const indices = index.array;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    const normal = triangleNormal(position, a, b, c);
    const triangleInfo = {
      normal,
      color: triangleColor(color, a, b, c),
      kind: triangleSurfaceKind(surfaceKind, a, b, c)
    };

    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const startPosition = new THREE.Vector3().fromBufferAttribute(position, start);
      const endPosition = new THREE.Vector3().fromBufferAttribute(position, end);
      const key = edgeKey(startPosition, endPosition);
      const current = {
        a: startPosition,
        b: endPosition,
        normal: triangleInfo.normal,
        color: triangleInfo.color,
        kind: triangleInfo.kind
      };
      const previous = pending.get(key);
      if (!previous) {
        pending.set(key, current);
        continue;
      }

      pending.delete(key);
      const geometryTurn = previous.normal.dot(current.normal) < GEOMETRY_EDGE_DOT_THRESHOLD;
      const materialSeam = !geometryTurn
        && isHardSurface(previous.kind)
        && isHardSurface(current.kind)
        && colorDistance(previous.color, current.color) > MATERIAL_COLOR_DELTA;

      if (geometryTurn && (isHardSurface(previous.kind) || isHardSurface(current.kind))) {
        pushEdge(output, previous, current, "geometry");
      } else if (materialSeam) {
        pushEdge(output, previous, current, "seam");
      }
    }
  }

  for (const edge of pending.values()) {
    if (isHardSurface(edge.kind)) pushEdge(output, edge, null, "boundary");
  }

  if (!output.positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(output.positions, 3));
  geometry.setAttribute("glintNormal", new THREE.Float32BufferAttribute(output.normals, 3));
  geometry.setAttribute("glintAlong", new THREE.Float32BufferAttribute(output.along, 1));
  geometry.setAttribute("glintSeed", new THREE.Float32BufferAttribute(output.seeds, 1));
  geometry.setAttribute("glintStrength", new THREE.Float32BufferAttribute(output.strengths, 1));
  geometry.setAttribute("glintLength", new THREE.Float32BufferAttribute(output.lengths, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function findDirectionalSun(scene) {
  if (scene.userData.__voxelTopologyGlintSun?.isDirectionalLight) {
    return scene.userData.__voxelTopologyGlintSun;
  }
  let result = null;
  scene.traverse((object) => {
    if (!result && object.isDirectionalLight) result = object;
  });
  scene.userData.__voxelTopologyGlintSun = result;
  return result;
}

function createGlintMaterial() {
  const uniforms = {
    uSunDirection: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() },
    uSunColor: { value: new THREE.Color("#fff4dc") },
    uCameraPosition: { value: new THREE.Vector3() }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
    vertexShader: `
      attribute vec3 glintNormal;
      attribute float glintAlong;
      attribute float glintSeed;
      attribute float glintStrength;
      attribute float glintLength;
      varying vec3 vGlintWorldPosition;
      varying vec3 vGlintWorldNormal;
      varying float vGlintAlong;
      varying float vGlintSeed;
      varying float vGlintStrength;
      varying float vGlintLength;
      varying float vGlintViewDepth;
      void main() {
        vec3 worldNormal = normalize(mat3(modelMatrix) * glintNormal);
        vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz + worldNormal * 0.0025;
        vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
        vGlintWorldPosition = worldPosition;
        vGlintWorldNormal = worldNormal;
        vGlintAlong = glintAlong;
        vGlintSeed = glintSeed;
        vGlintStrength = glintStrength;
        vGlintLength = glintLength;
        vGlintViewDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform vec3 uCameraPosition;
      varying vec3 vGlintWorldPosition;
      varying vec3 vGlintWorldNormal;
      varying float vGlintAlong;
      varying float vGlintSeed;
      varying float vGlintStrength;
      varying float vGlintLength;
      varying float vGlintViewDepth;
      void main() {
        vec3 viewDir = normalize(uCameraPosition - vGlintWorldPosition);
        vec3 halfDir = normalize(uSunDirection + viewDir);
        float sunFacing = max(dot(vGlintWorldNormal, uSunDirection), 0.0);
        float reflection = pow(max(dot(vGlintWorldNormal, halfDir), 0.0), 18.0);
        float sunGate = smoothstep(0.12, 0.62, sunFacing);

        float viewFlow = dot(viewDir, vec3(0.41, 0.23, 0.77)) * 1.8;
        float phase = fract(vGlintAlong + viewFlow + vGlintSeed * 6.0);
        float pulseDistance = min(phase, 1.0 - phase);
        float pulseWidth = mix(0.055, 0.14, smoothstep(0.15, 1.8, vGlintLength));
        float flowPulse = 1.0 - smoothstep(pulseWidth * 0.35, pulseWidth, pulseDistance);
        flowPulse *= flowPulse;

        float farFactor = smoothstep(12.0, 42.0, vGlintViewDepth);
        float farEnergy = mix(0.62, 1.75, farFactor);
        float visibility = reflection * sunGate * flowPulse * vGlintStrength * farEnergy;
        if (visibility < 0.015) discard;

        vec3 color = uSunColor * mix(vec3(0.96, 0.92, 0.82), vec3(1.0), farFactor * 0.45);
        gl_FragColor = vec4(color * visibility, clamp(visibility * 1.45, 0.0, 0.9));
      }
    `
  });
  material.name = "VoxelTopologyGlintMaterial";
  material.userData.voxelTopologyGlint = true;
  return material;
}

function attachTopologyGlint(mesh) {
  if (!mesh?.isMesh || !mesh.userData?.flatVoxelGeometry) return;
  if (mesh.userData.voxelTopologyGlintAttached) return;
  if (mesh.material?.transparent || Number(mesh.material?.opacity ?? 1) < 1) return;

  const geometry = extractVoxelTopologyGlintGeometry(mesh.geometry);
  if (!geometry) return;
  const material = createGlintMaterial();
  const glint = new THREE.LineSegments(geometry, material);
  glint.name = `${mesh.name || "VoxelMesh"}-TopologyGlint`;
  glint.frustumCulled = mesh.frustumCulled;
  glint.renderOrder = (mesh.renderOrder ?? 0) + 1;
  glint.userData.voxelTopologyGlint = true;
  glint.onBeforeRender = (_renderer, scene, camera) => {
    material.uniforms.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    const sun = findDirectionalSun(scene);
    if (!sun) return;
    const lightPosition = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld);
    const targetPosition = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
    material.uniforms.uSunDirection.value.copy(lightPosition.sub(targetPosition).normalize());
    material.uniforms.uSunColor.value.copy(sun.color).multiplyScalar(Math.max(0.55, Math.min(1.35, sun.intensity / 2.5)));
  };
  mesh.add(glint);
  mesh.userData.voxelTopologyGlintAttached = true;
}

export function installVoxelTopologyGlint() {
  if (!queryEnabled()) return false;
  if (THREE.Object3D.prototype[PATCH_FLAG]) return true;
  const originalAdd = THREE.Object3D.prototype.add;
  Object.defineProperty(THREE.Object3D.prototype, PATCH_FLAG, {
    value: true,
    configurable: true
  });
  THREE.Object3D.prototype.add = function patchedAdd(...objects) {
    const result = originalAdd.apply(this, objects);
    objects.forEach((object) => attachTopologyGlint(object));
    return result;
  };
  return true;
}

export const voxelTopologyGlintEnabled = installVoxelTopologyGlint();
