import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";
import {
  BAKED_BUILDING_ARTIFACT_VERSION,
  createBakedMeshLod,
  decodeBakedBuildingArtifact,
  encodeBakedBuildingArtifact,
  loadBakedBuildingArtifact,
  validateBakedArtifactManifest
} from "../src/render/bakedBuildingArtifact.js";
import { createApp } from "../apps/server/app.js";
import { createMemoryRepository } from "../apps/server/memory-repository.js";

const configBase = {
  publicBaseUrl: "http://127.0.0.1:4183",
  assetOutputRoot: "/tmp/magictown-baked-artifact-test",
  assetProvider: "fixture",
  workerPollMs: 5,
  gameplaySeed: 11
};

function geometry(materialOffset = 0) {
  // Deliberately use views with non-zero byte offsets to exercise portable
  // ArrayBuffer decoding.
  const positionBacking = new Float32Array([99, 0, 0, 0, 1 + materialOffset, 0, 0, 0, 1, 0]);
  const normalBacking = new Float32Array([99, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  const indexBacking = new Uint32Array([99, 0, 1, 2]);
  return {
    positions: positionBacking.subarray(1, 10),
    normals: normalBacking.subarray(1, 10),
    ao: new Float32Array([0.2, 0.4, 0.8]),
    surfaceKind: new Float32Array([1, 2, 3]),
    indices: indexBacking.subarray(1),
  };
}

function fixtureArtifact(buildingId = "building-1", designRevision = 3) {
  return encodeBakedBuildingArtifact({
    buildingId,
    designRevision,
    levels: [
      { lod: 2, meshes: [{ materialId: "stone", geometry: geometry(2) }] },
      { lod: 0, meshes: [{ materialId: "timber", geometry: geometry(0) }] }
    ]
  });
}

function manifestFor(bytes, overrides = {}) {
  return {
    schema: "baked-building-artifact-manifest-v1",
    artifactVersion: BAKED_BUILDING_ARTIFACT_VERSION,
    cityId: "city-1",
    buildingId: "building-1",
    designRevision: 3,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    ...overrides
  };
}

test("baked artifact codec preserves LOD order, descriptor order, materials and offset views", () => {
  const bytes = fixtureArtifact();
  const wrapped = new Uint8Array(bytes.byteLength + 7);
  wrapped.set(bytes, 7);
  const decoded = decodeBakedBuildingArtifact(wrapped.subarray(7));
  assert.deepEqual(decoded.levels.map((level) => level.lod), [0, 2]);
  assert.equal(decoded.levels[0].meshes[0].materialId, "timber");
  assert.equal(decoded.levels[1].meshes[0].materialId, "stone");
  assert.deepEqual([...decoded.levels[0].meshes[0].geometry.indices], [0, 1, 2]);
  assert.equal(decoded.levels[0].meshes[0].geometry.positions[3], 1);
  const lod = createBakedMeshLod(decoded);
  assert.equal(lod.userData.levelObjects.length, 2);
  assert.equal(lod.userData.levelObjects[0].children[0].geometry.index.count, 3);
});

test("baked artifact encoder accepts Three.js BufferGeometry", () => {
  const source = geometry();
  const threeGeometry = new THREE.BufferGeometry();
  threeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(source.positions, 3));
  threeGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(source.normals, 3));
  threeGeometry.setAttribute("voxelAo", new THREE.Float32BufferAttribute(source.ao, 1));
  threeGeometry.setAttribute("voxelSurfaceKind", new THREE.Float32BufferAttribute(source.surfaceKind, 1));
  threeGeometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
  const bytes = encodeBakedBuildingArtifact({
    buildingId: "building-geometry",
    designRevision: 1,
    levels: [{ lod: 0, meshes: [{ materialId: "stone", geometry: threeGeometry }] }]
  });
  const decoded = decodeBakedBuildingArtifact(bytes);
  assert.deepEqual([...decoded.levels[0].meshes[0].geometry.indices], [0, 1, 2]);
  threeGeometry.dispose();
});

test("manifest validation rejects identity/version/hash/source mismatches", () => {
  const bytes = fixtureArtifact();
  const valid = manifestFor(bytes);
  assert.equal(validateBakedArtifactManifest(valid, { cityId: "city-1", buildingId: "building-1", designRevision: 3 }).valid, true);
  assert.equal(validateBakedArtifactManifest({ ...valid, artifactVersion: 99 }).valid, false);
  assert.equal(validateBakedArtifactManifest({ ...valid, sha256: "bad" }).valid, false);
  assert.equal(validateBakedArtifactManifest(valid, { buildingId: "other" }).valid, false);
});

test("client loader returns an explicit fallback for bad hash, bad version and unavailable Web Crypto", async () => {
  const bytes = fixtureArtifact();
  const valid = manifestFor(bytes);
  const ok = await loadBakedBuildingArtifact(valid, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }) });
  assert.equal(ok.fallback, false);
  assert.equal(ok.artifact.buildingId, "building-1");
  const hashFailure = await loadBakedBuildingArtifact({ ...valid, sha256: "0".repeat(64) }, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }) });
  assert.equal(hashFailure.fallback, true);
  const versionFailure = await loadBakedBuildingArtifact({ ...valid, artifactVersion: 99 }, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }) });
  assert.equal(versionFailure.fallback, true);
  const cryptoFailure = await loadBakedBuildingArtifact(valid, {
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }),
    hashImpl: async () => { throw new Error("Web Crypto SHA-256 is unavailable"); }
  });
  assert.equal(cryptoFailure.fallback, true);
});

test("render-state stays compatible without a baked root and serves configured binary artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "magictown-baked-root-"));
  const config = { ...configBase, bakedArtifactRoot: root };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "Artifact Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "Artifact City" } }), 201);
    const owner = await repository.authenticate(player.access_token);
    const cityRecord = await repository.getCity(owner, city.id);
    const cell = Object.values(cityRecord.state.cells)[0];
    cityRecord.state.buildings["building-1"] = {
      id: "building-1",
      footprintCells: [cell.id],
      site: { lotId: cell.id, footprint: "1x1" },
      program: { name: "Artifact House", purpose: "residential" },
      voxelDesign: { id: "design-1", revision: 3, generation: { mode: "floor_stack", sourceSpec: { floors: 1 } } }
    };
    const bytes = fixtureArtifact();
    await mkdir(path.join(root, city.id, "building-1"), { recursive: true });
    await writeFile(path.join(root, city.id, "building-1", "3.mtba"), bytes);
    const state = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/render-state` }), 200);
    assert.equal(state.artifact_manifest.length, 1);
    assert.equal(state.artifact_manifest[0].designRevision, 3);
    assert.equal(state.artifact_manifest[0].byteLength, bytes.byteLength);
    const artifact = await app.inject(auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/render-artifacts/building-1?revision=3` }));
    assert.equal(artifact.statusCode, 200);
    assert.deepEqual(Buffer.from(artifact.rawPayload), Buffer.from(bytes));
    const traversal = await app.inject(auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/render-artifacts/..%2Foutside?revision=3` }));
    assert.notEqual(traversal.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("render-state defaults to an empty manifest when baked artifacts are not configured", async () => {
  const config = { ...configBase };
  const repository = createMemoryRepository(config);
  const app = await createApp({ repository, config });
  try {
    const player = await json(app, { method: "POST", url: "/api/v1/players", payload: { display_name: "No Artifact Owner" } }, 201);
    const city = await json(app, auth(player, { method: "POST", url: "/api/v1/cities", payload: { name: "No Artifact City" } }), 201);
    const state = await json(app, auth(player, { method: "GET", url: `/api/v1/cities/${city.id}/render-state` }), 200);
    assert.deepEqual(state.artifact_manifest, []);
  } finally {
    await app.close();
  }
});

function auth(principal, request) {
  return { ...request, headers: { ...(request.headers ?? {}), authorization: `Bearer ${principal.access_token}` } };
}

async function json(app, request, status) {
  const response = await app.inject(request);
  assert.equal(response.statusCode, status, response.payload);
  return JSON.parse(response.payload);
}
