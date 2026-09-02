import * as THREE from "three";
import { createVoxelMaterialForArtifact } from "../generators/voxelBuildingLab.js";

export const BAKED_BUILDING_ARTIFACT_MAGIC = "MTBA";
export const BAKED_BUILDING_ARTIFACT_VERSION = 1;
export const BAKED_BUILDING_ARTIFACT_KIND = "baked-building-mesh-lod";
export const BAKED_BUILDING_MANIFEST_SCHEMA = "baked-building-artifact-manifest-v1";

const HEADER_BYTES = 12;
const MESH_RECORD_BYTES = 16;
const ATTR_NORMAL = 1;
const ATTR_AO = 2;
const ATTR_SURFACE_KIND = 4;

/**
 * Compact binary contract for a baked building:
 *
 *   header: magic[4], formatVersion u16, flags u16, metadataBytes u32
 *   metadata: UTF-8 JSON containing identity and mesh descriptors only
 *   payload: per mesh descriptor, materialIndex u16, attributes u8, reserved
 *            u8, vertexCount u32, indexCount u32, then typed arrays
 *
 * Geometry never lives in the metadata JSON. Positions/normals/AO/surface kind
 * are binary arrays and indices are always little-endian u32 for a stable
 * cross-platform decoder. HTTP compression is deliberately outside this
 * codec so the same bytes can be cached, hashed, or used as a local fixture.
 */
export function encodeBakedBuildingArtifact(input = {}) {
  const metadata = normalizeArtifactMetadata(input);
  const descriptors = [];
  const encodedMeshes = [];
  let payloadBytes = 0;
  for (const level of metadata.levels) {
    for (const mesh of level.meshes) {
      const geometry = normalizeGeometry(mesh.geometry);
      const attributes = ATTR_NORMAL
        | (geometry.ao ? ATTR_AO : 0)
        | (geometry.surfaceKind ? ATTR_SURFACE_KIND : 0);
      const positions = toFloat32Array(geometry.positions);
      const normals = geometry.normals ? toFloat32Array(geometry.normals) : new Float32Array(positions.length);
      const ao = geometry.ao ? toFloat32Array(geometry.ao) : null;
      const surfaceKind = geometry.surfaceKind ? toFloat32Array(geometry.surfaceKind) : null;
      const indices = toUint32Array(geometry.indices);
      if (positions.length % 3 || normals.length !== positions.length) throw new Error("Artifact positions and normals must contain 3 values per vertex");
      if (indices.length % 3) throw new Error("Artifact indices must contain triangles");
      if (ao && ao.length !== positions.length / 3) throw new Error("Artifact AO must contain one value per vertex");
      if (surfaceKind && surfaceKind.length !== positions.length / 3) throw new Error("Artifact surfaceKind must contain one value per vertex");
      const descriptor = {
        lod: level.lod,
        material: mesh.materialId ?? "timber",
        vertexCount: positions.length / 3,
        indexCount: indices.length,
        attributes
      };
      descriptors.push(descriptor);
      const arrays = [positions, normals, ...(ao ? [ao] : []), ...(surfaceKind ? [surfaceKind] : []), indices];
      const part = concatTypedArrays(arrays);
      encodedMeshes.push({ descriptor, arrays, part });
      payloadBytes += MESH_RECORD_BYTES + part.byteLength;
    }
  }

  const metadataBytes = new TextEncoder().encode(JSON.stringify({
    kind: BAKED_BUILDING_ARTIFACT_KIND,
    formatVersion: BAKED_BUILDING_ARTIFACT_VERSION,
    buildingId: metadata.buildingId,
    designRevision: metadata.designRevision,
    sourceHash: metadata.sourceHash ?? null,
    voxelSize: metadata.voxelSize ?? null,
    materials: [...new Set(descriptors.map((descriptor) => descriptor.material))],
    levels: metadata.levels.map((level) => ({ lod: level.lod, meshCount: level.meshes.length })),
    meshes: descriptors
  }));
  const output = new Uint8Array(HEADER_BYTES + metadataBytes.byteLength + payloadBytes);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode(BAKED_BUILDING_ARTIFACT_MAGIC), 0);
  view.setUint16(4, BAKED_BUILDING_ARTIFACT_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, metadataBytes.byteLength, true);
  output.set(metadataBytes, HEADER_BYTES);
  let offset = HEADER_BYTES + metadataBytes.byteLength;
  for (const { descriptor, arrays, part } of encodedMeshes) {
    view.setUint16(offset, metadata.materialsIndex?.[descriptor.material] ?? 0, true);
    view.setUint8(offset + 2, descriptor.attributes);
    view.setUint8(offset + 3, 0);
    view.setUint32(offset + 4, descriptor.vertexCount, true);
    view.setUint32(offset + 8, descriptor.indexCount, true);
    view.setUint32(offset + 12, 0, true);
    offset += MESH_RECORD_BYTES;
    for (const array of arrays) {
      output.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
      offset += array.byteLength;
    }
    if (part.byteLength === 0) throw new Error("Artifact mesh payload cannot be empty");
  }
  return output;
}

export function decodeBakedBuildingArtifact(bytes) {
  const input = toUint8Array(bytes);
  if (input.byteLength < HEADER_BYTES) throw new Error("Baked artifact is truncated");
  const magic = new TextDecoder().decode(input.slice(0, 4));
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const formatVersion = view.getUint16(4, true);
  const metadataLength = view.getUint32(8, true);
  if (magic !== BAKED_BUILDING_ARTIFACT_MAGIC) throw new Error("Baked artifact magic mismatch");
  if (formatVersion !== BAKED_BUILDING_ARTIFACT_VERSION) throw new Error(`Unsupported baked artifact version: ${formatVersion}`);
  const payloadStart = HEADER_BYTES + metadataLength;
  if (payloadStart > input.byteLength) throw new Error("Baked artifact metadata is truncated");
  let metadata;
  try {
    metadata = JSON.parse(new TextDecoder().decode(input.slice(HEADER_BYTES, payloadStart)));
  } catch {
    throw new Error("Baked artifact metadata is invalid");
  }
  if (metadata.kind !== BAKED_BUILDING_ARTIFACT_KIND || metadata.formatVersion !== BAKED_BUILDING_ARTIFACT_VERSION) {
    throw new Error("Baked artifact contract mismatch");
  }
  const materials = Array.isArray(metadata.materials) ? metadata.materials : [];
  const meshes = [];
  let offset = payloadStart;
  const descriptors = Array.isArray(metadata.meshes) ? metadata.meshes : [];
  for (const descriptor of descriptors) {
    if (offset + MESH_RECORD_BYTES > input.byteLength) throw new Error("Baked artifact mesh record is truncated");
    const materialIndex = view.getUint16(offset, true);
    const attributes = view.getUint8(offset + 2);
    const vertexCount = view.getUint32(offset + 4, true);
    const indexCount = view.getUint32(offset + 8, true);
    offset += MESH_RECORD_BYTES;
    const readFloat32 = (count) => {
      const byteLength = count * 4;
      if (offset + byteLength > input.byteLength) throw new Error("Baked artifact vertex data is truncated");
      const result = new Float32Array(input.buffer.slice(input.byteOffset + offset, input.byteOffset + offset + byteLength));
      offset += byteLength;
      return result;
    };
    const positions = readFloat32(vertexCount * 3);
    const normals = readFloat32(vertexCount * 3);
    const ao = attributes & ATTR_AO ? readFloat32(vertexCount) : null;
    const surfaceKind = attributes & ATTR_SURFACE_KIND ? readFloat32(vertexCount) : null;
    const indexBytes = indexCount * 4;
    if (offset + indexBytes > input.byteLength) throw new Error("Baked artifact index data is truncated");
    const indices = new Uint32Array(input.buffer.slice(input.byteOffset + offset, input.byteOffset + offset + indexBytes));
    offset += indexBytes;
    meshes.push({
      lod: descriptor.lod,
      materialId: materials[materialIndex] ?? descriptor.material ?? "timber",
      geometry: { positions, normals, indices, ...(ao ? { ao } : {}), ...(surfaceKind ? { surfaceKind } : {}) }
    });
  }
  if (offset !== input.byteLength) throw new Error("Baked artifact has trailing bytes");
  const levels = [...new Set(meshes.map((mesh) => mesh.lod))]
    .sort((left, right) => left - right)
    .map((lod) => ({ lod, meshes: meshes.filter((mesh) => mesh.lod === lod) }));
  return { ...metadata, levels, byteLength: input.byteLength };
}

export function createBakedMeshLod(decoded, { name = "BakedVoxelBuilding", nightLighting = 0 } = {}) {
  if (!decoded?.levels?.length) throw new Error("Decoded baked artifact has no LOD levels");
  const lod = new THREE.LOD();
  lod.name = name;
  lod.autoUpdate = false;
  const levelObjects = [];
  decoded.levels.forEach((level, index) => {
    const group = new THREE.Group();
    group.name = `${name}-${level.lod}`;
    level.meshes.forEach((entry) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(entry.geometry.positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(entry.geometry.normals, 3));
      if (entry.geometry.ao) geometry.setAttribute("voxelAo", new THREE.Float32BufferAttribute(entry.geometry.ao, 1));
      if (entry.geometry.surfaceKind) geometry.setAttribute("voxelSurfaceKind", new THREE.Float32BufferAttribute(entry.geometry.surfaceKind, 1));
      geometry.setIndex(new THREE.BufferAttribute(entry.geometry.indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, createVoxelMaterialForArtifact(entry.materialId, {
        surfaceKind: entry.geometry.surfaceKind?.[0] ?? 0,
        useSurfaceKindAttribute: Boolean(entry.geometry.surfaceKind)
      }));
      mesh.name = `${name}-${entry.materialId}`;
      mesh.userData.materialId = entry.materialId;
      mesh.userData.voxelRenderStrategy = "baked-artifact";
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
    group.userData.lodFactor = level.lod;
    levelObjects.push(group);
    lod.addLevel(group, index);
  });
  lod.userData.levelObjects = levelObjects;
  lod.userData.levels = decoded.levels;
  lod.userData.updateDaylight = (style) => {
    const night = Math.max(Number(nightLighting) || 0, Number(style?.nightFactor) || 0);
    lod.traverse((object) => {
      if (!object.isMesh || !object.material?.emissive) return;
      object.material.emissiveIntensity = Math.max(0.15, object.material.emissiveIntensity) + night * 1.6;
    });
  };
  return lod;
}

export function validateBakedArtifactManifest(entry, expected = {}) {
  const errors = [];
  if (!entry || entry.schema !== BAKED_BUILDING_MANIFEST_SCHEMA) errors.push("schema");
  if (Number(entry?.artifactVersion) !== BAKED_BUILDING_ARTIFACT_VERSION) errors.push("artifactVersion");
  if (expected.cityId && entry?.cityId !== expected.cityId) errors.push("cityId");
  if (expected.buildingId && entry?.buildingId !== expected.buildingId) errors.push("buildingId");
  if (expected.designRevision !== undefined && Number(entry?.designRevision) !== Number(expected.designRevision)) errors.push("designRevision");
  if (!/^[a-f0-9]{64}$/i.test(String(entry?.sha256 ?? ""))) errors.push("sha256");
  if (!entry?.url && !entry?.fixtureKey && entry?.bytes === undefined) errors.push("source");
  return { valid: errors.length === 0, errors };
}

export async function loadBakedBuildingArtifact(entry, { expected = {}, fetchImpl = globalThis.fetch, fixture = {}, hashImpl = sha256Hex } = {}) {
  const validation = validateBakedArtifactManifest(entry, expected);
  if (!validation.valid) return { artifact: null, fallback: true, reason: `manifest:${validation.errors.join(",")}` };
  try {
    let bytes;
    if (entry.bytes !== undefined) bytes = toUint8Array(entry.bytes);
    else if (entry.fixtureKey) bytes = toUint8Array(resolveFixture(fixture, entry.fixtureKey));
    else {
      if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
      const response = await fetchImpl(entry.url, { headers: { Accept: "application/octet-stream" }, cache: "force-cache" });
      if (!response.ok) throw new Error(`artifact HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    const digest = await hashImpl(bytes);
    if (digest.toLowerCase() !== String(entry.sha256).toLowerCase()) throw new Error("artifact hash mismatch");
    const artifact = decodeBakedBuildingArtifact(bytes);
    if (artifact.buildingId !== entry.buildingId || Number(artifact.designRevision) !== Number(entry.designRevision)) throw new Error("artifact identity mismatch");
    return { artifact, fallback: false, byteLength: bytes.byteLength };
  } catch (error) {
    return { artifact: null, fallback: true, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = await subtle.digest("SHA-256", toUint8Array(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeArtifactMetadata(input) {
  const levels = (input.levels ?? []).map((level) => ({
    lod: Math.max(0, Math.round(Number(level.lod ?? level.factor ?? 0))),
    meshes: Array.isArray(level.meshes) ? level.meshes : []
  }));
  if (!input.buildingId || !levels.length) throw new Error("Baked artifact requires buildingId and at least one LOD level");
  const materials = [...new Set(levels.flatMap((level) => level.meshes.map((mesh) => mesh.materialId ?? "timber")))];
  return { ...input, levels, materials, materialsIndex: Object.fromEntries(materials.map((material, index) => [material, index])) };
}

function normalizeGeometry(geometry = {}) {
  return {
    positions: geometry.positions ?? geometry.attributes?.position?.array,
    normals: geometry.normals ?? geometry.attributes?.normal?.array,
    indices: geometry.indices ?? geometry.index?.array ?? geometry.index,
    ao: geometry.ao ?? geometry.attributes?.voxelAo?.array,
    surfaceKind: geometry.surfaceKind ?? geometry.attributes?.voxelSurfaceKind?.array
  };
}

function concatTypedArrays(arrays) {
  const bytes = arrays.reduce((total, array) => total + array.byteLength, 0);
  const output = new Uint8Array(bytes);
  let offset = 0;
  arrays.forEach((array) => {
    output.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset);
    offset += array.byteLength;
  });
  return output;
}

function toFloat32Array(value) {
  if (value === undefined || value === null) throw new Error("Artifact geometry is missing a required array");
  return value instanceof Float32Array ? value : Float32Array.from(value);
}

function toUint32Array(value) {
  if (value === undefined || value === null) throw new Error("Artifact geometry is missing indices");
  return value instanceof Uint32Array ? value : Uint32Array.from(value);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return Uint8Array.from(value ?? []);
}

function resolveFixture(fixture, key) {
  if (fixture instanceof Map) return fixture.get(key);
  return fixture?.[key];
}
