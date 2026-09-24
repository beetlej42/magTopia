// Node-only static renderer: Three is used for geometry/math, never WebGL or a browser.
import * as THREE from "three";
import { PNG } from "pngjs";
import { buildingEntranceRotation, createBuildingDesignObject, disposeBuildingObject } from "../generators/buildingDesignObject.js";
import { VOXEL_SIZE } from "../generators/voxelBuildingLab.js";

export const BUILDING_VISUALIZATION_VERSION = "1";
export const BUILDING_VISUALIZATION_VIEWS = Object.freeze(["front", "back", "top"]);
const MAX_TRIANGLES = 250_000;
const MAX_VERTICES = 1_000_000;
const BACKGROUND = [239, 236, 229];
const SRGB = Uint8Array.from({ length: 4097 }, (_, i) => {
  const value = i / 4096;
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
});

export function visualizationOptions({ view = "front", size = 512 } = {}) {
  if (!BUILDING_VISUALIZATION_VIEWS.includes(view)) throw new Error("view must be front, back or top");
  if (![512, 1024].includes(Number(size))) throw new Error("size must be 512 or 1024");
  return { view, size: Number(size) };
}

// CLI also accepts either raw source spec, or { sourceSpec, decorations, site }.
// Do not regenerate an existing design from its intent: its exact spec is authoritative.
export function visualizationDesign(input) {
  if (input?.generation?.sourceSpec) return input;
  const spec = input?.sourceSpec ?? input;
  const mode = Array.isArray(spec?.floorSpecs) ? "floor_stack" : Array.isArray(spec?.masses) ? "urban_massing" : null;
  if (!mode) throw new Error("Expected a BuildingDesign, BuildingSpec or UrbanMassingSpec");
  return { generation: { mode, sourceSpec: spec }, decorations: input.decorations, site: input.site ?? { entrance: "south" } };
}

export function renderBuildingVisualization(input, options = {}) {
  const { view, size } = visualizationOptions(options);
  const design = visualizationDesign(input);
  const start = performance.now();
  let object;
  try {
    object = createBuildingDesignObject(design);
    const compileMs = performance.now() - start;
    // Massing already includes its exact site mask. Street specs need a parcel base.
    if (design.generation.mode === "floor_stack") {
      const spec = design.generation.sourceSpec;
      const width = spec.footprint.widthVoxels * VOXEL_SIZE;
      const depth = spec.footprint.depthVoxels * VOXEL_SIZE;
      const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), new THREE.MeshBasicMaterial({ color: "#c9c2ad" }));
      base.position.set((spec.origin.x + spec.footprint.widthVoxels / 2) * VOXEL_SIZE, -0.04, (spec.origin.z + spec.footprint.depthVoxels / 2) * VOXEL_SIZE);
      object.add(base);
    }
    const rotation = buildingEntranceRotation(design.site?.entrance);
    object.rotation.y = rotation;
    const direction = view === "top" ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(view === "back" ? -1 : 1, 0.9, view === "back" ? -1 : 1)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation).normalize();
    const result = rasterizeBuildingObject(object, { size, direction });
    return {
      ...result,
      metadata: {
        rendererVersion: BUILDING_VISUALIZATION_VERSION, view, size,
        designId: design.id ?? null, revision: design.revision ?? null, specHash: design.specHash ?? null,
        entrance: design.site?.entrance ?? "south", generationMode: design.generation.mode,
        compileMs: Math.round(compileMs), totalMs: Math.round(performance.now() - start),
        triangleCount: result.triangleCount,
        lighting: "simplified-daylight", transparency: "nearest-visible-layer"
      }
    };
  } finally {
    disposeBuildingObject(object);
  }
}

// Orthographic triangle rasterizer with a real per-pixel depth buffer. Sorting
// whole faces by their centres breaks overlapping towers, roofs and courtyards.
export function rasterizeBuildingObject(object, { size = 512, direction = new THREE.Vector3(1, 0.9, 1).normalize() } = {}) {
  visualizationOptions({ size });
  object.updateMatrixWorld(true);
  const forward = direction.clone().normalize();
  const right = Math.abs(forward.y) > 0.999 ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
  // City north is +Z. The map-like top view deliberately uses north-up/east-right.
  const up = Math.abs(forward.y) > 0.999 ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3().crossVectors(forward, right).normalize();
  const winding = Math.sign(new THREE.Vector3().crossVectors(right, up).dot(forward));
  const light = forward.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(right, -0.5).normalize();
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) throw new Error("Building visualization has no geometry");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z);
    const px = point.dot(right), py = point.dot(up);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) throw new Error("Building visualization has invalid bounds");
  const scale = size * 0.86 / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = BACKGROUND[0]; pixels[i + 1] = BACKGROUND[1]; pixels[i + 2] = BACKGROUND[2]; pixels[i + 3] = 255;
  }
  const depths = new Float64Array(size * size).fill(-Infinity);
  const glassDepths = new Float64Array(size * size).fill(-Infinity);
  const glassColors = new Float32Array(size * size * 4);
  const draws = [];
  let triangleCount = 0, vertexCount = 0;
  object.traverseVisible((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry, positions = geometry.getAttribute("position");
    if (!positions) return;
    const count = mesh.isInstancedMesh ? mesh.count : 1;
    triangleCount += Math.floor((geometry.index?.count ?? positions.count) / 3) * count;
    vertexCount += positions.count * count;
    if (triangleCount > MAX_TRIANGLES || vertexCount > MAX_VERTICES) throw new Error("Building visualization geometry limit exceeded");
    for (let instance = 0; instance < count; instance++) {
      const matrix = mesh.matrixWorld.clone(), instanceColor = new THREE.Color(1, 1, 1);
      if (mesh.isInstancedMesh) {
        const local = new THREE.Matrix4(); mesh.getMatrixAt(instance, local); matrix.multiply(local);
        if (mesh.instanceColor) mesh.getColorAt(instance, instanceColor);
      }
      draws.push({ mesh, geometry, positions, matrix, instanceColor });
    }
  });
  if (!triangleCount) throw new Error("Building visualization has no triangles");
  for (const draw of draws) {
    const { mesh, geometry, positions, matrix, instanceColor } = draw;
    const normals = geometry.getAttribute("normal"), colors = geometry.getAttribute("color");
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const projected = new Float64Array(positions.count * 7);
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      if (normals) normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      else normal.set(0, 1, 0);
      const offset = i * 7;
      projected[offset] = (point.dot(right) - cx) * scale + size / 2;
      projected[offset + 1] = size / 2 - (point.dot(up) - cy) * scale;
      projected[offset + 2] = point.dot(forward);
      projected[offset + 3] = (colors?.getX(i) ?? 1) * instanceColor.r;
      projected[offset + 4] = (colors?.getY(i) ?? 1) * instanceColor.g;
      projected[offset + 5] = (colors?.getZ(i) ?? 1) * instanceColor.b;
      projected[offset + 6] = 0.7 + 0.3 * Math.max(0, normal.dot(light));
    }
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count: geometry.index?.count ?? positions.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = Array.isArray(mesh.material) ? mesh.material[group.materialIndex] : mesh.material;
      if (!material || material.visible === false || material.opacity <= 0) continue;
      const alpha = material.transparent ? material.opacity : 1;
      const tint = material.color ?? new THREE.Color(1, 1, 1);
      const tintChannels = [tint.r, tint.g, tint.b];
      const instanceChannels = [instanceColor.r, instanceColor.g, instanceColor.b];
      const end = Math.min(group.start + group.count, geometry.drawRange.start + geometry.drawRange.count);
      for (let t = Math.max(group.start, geometry.drawRange.start); t + 2 < end; t += 3) {
        const a = (geometry.index?.getX(t) ?? t) * 7;
        const b = (geometry.index?.getX(t + 1) ?? t + 1) * 7;
        const c = (geometry.index?.getX(t + 2) ?? t + 2) * 7;
        const ax = projected[a], ay = projected[a + 1], bx = projected[b], by = projected[b + 1], cx = projected[c], cy = projected[c + 1];
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(area) < 1e-8 || (material.side === THREE.FrontSide && area * winding >= 0) || (material.side === THREE.BackSide && area * winding <= 0)) continue;
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
        const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) continue;
          const z = wa * projected[a + 2] + wb * projected[b + 2] + wc * projected[c + 2];
          const index = y * size + x, offset = index * 4;
          const targetDepth = alpha < 1 ? glassDepths : depths;
          if (z <= targetDepth[index] + 1e-7) continue;
          targetDepth[index] = z;
          const shade = wa * projected[a + 6] + wb * projected[b + 6] + wc * projected[c + 6];
          for (let channel = 0; channel < 3; channel++) {
            const vertex = material.vertexColors ? wa * projected[a + 3 + channel] + wb * projected[b + 3 + channel] + wc * projected[c + 3 + channel] : instanceChannels[channel];
            const value = vertex * tintChannels[channel] * shade;
            const byte = SRGB[Math.max(0, Math.min(4096, Math.round(value * 4096)))];
            if (alpha < 1) glassColors[offset + channel] = byte;
            else pixels[offset + channel] = byte;
          }
          if (alpha < 1) glassColors[offset + 3] = alpha;
        }
      }
    }
  }
  // Only the nearest transparent surface is retained; no costly layer sorting.
  for (let i = 0; i < depths.length; i++) {
    if (glassDepths[i] <= depths[i]) continue;
    const offset = i * 4, alpha = glassColors[offset + 3];
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - alpha) + glassColors[offset + channel] * alpha);
  }
  const png = PNG.sync.write({ width: size, height: size, data: pixels }, { deflateLevel: 1, filterType: 0 });
  return { png, triangleCount };
}
