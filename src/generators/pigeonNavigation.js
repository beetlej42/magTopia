import * as THREE from "three";
import { createRng } from "../utils/random.js";

export const PIGEON_COUNT = 5;
export const PIGEON_CLEARANCE = 0.38;
const STEP = 0.5;
const key = (x, z) => `${x}:${z}`;
const offsets = [[0.03, -0.04], [-0.57, 0.12], [0.54, 0.22], [0.12, -0.55], [0.12, 0.64]];
const smooth = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// Saved cities may predate the derived composition summary. Prefer actual
// geometry metadata, then explicit legacy intent; never infer from a name.
export function isCompletedPigeonPlaza(building) {
  if (building.status === "construction") return false;
  const design = building.voxelDesign;
  const spec = design?.generation?.sourceSpec;
  const composition = design?.actualSiteComposition ?? spec?.metadata?.publicSite;
  if (composition) return composition.openSpaceType === "plaza"
    && ["open_space", "mixed"].includes(composition.resolvedLayout);
  const intent = design?.intent ?? spec?.intent ?? building.program?.intent;
  const type = intent?.openSpaceType ?? intent?.open_space_type ?? intent?.purpose ?? building.program?.purpose;
  const layout = intent?.siteLayout ?? intent?.site_layout;
  return type === "plaza" && layout !== "building"
    && !(spec?.masses ?? []).some(m => m.type !== "ground");
}

// A conservative, flat-space height field. Rasterize triangle bounds rather
// than mesh bounds: merged plaza paving must not turn its lamps into a roof.
// Only navigable cells are allocated; overhead geometry blocks the entire column.
export function createPigeonNavigation({ state, grid, collisionRoot, sampleGroundHeight = () => 0 }) {
  const size = grid?.cellWorldSize ?? 4;
  const cells = grid?.cells ?? [];
  const plazas = [];
  const plazaIds = new Set();
  for (const building of Object.values(state?.buildings ?? {})) {
    if (!isCompletedPigeonPlaza(building)) continue;
    const ids = building.footprintCells?.length ? building.footprintCells : [building.site?.lotId];
    for (const id of ids) {
      const cell = cells.find(c => c.id === id);
      if (!cell) continue;
      plazaIds.add(id);
      plazas.push({ id: `${building.id}:${id}`, buildingId: building.id, x: cell.center.x, z: cell.center.z,
        parcelX: cell.center.x, parcelZ: cell.center.z });
    }
  }
  const field = new Map();
  for (const cell of cells) {
    if (!plazaIds.has(cell.id) && state?.cells?.[cell.id]?.infrastructure !== "road") continue;
    const half = size / 2;
    for (let ix = Math.ceil((cell.center.x - half) / STEP); ix < (cell.center.x + half) / STEP; ix++) {
      for (let iz = Math.ceil((cell.center.z - half) / STEP); iz < (cell.center.z + half) / STEP; iz++) {
        const x = (ix + 0.5) * STEP, z = (iz + 0.5) * STEP;
        field.set(key(ix, iz), { ix, iz, x, z, top: sampleGroundHeight(x, z) });
      }
    }
  }
  if (!plazas.length) return { field, stops: [], ceiling: () => Infinity, sampleGroundHeight, step: STEP,
    plazaBuildings: 0, blockedPlazas: [] };
  const nodes = [...field.values()];
  const minIX = Math.min(...nodes.map(n => n.ix)), maxIX = Math.max(...nodes.map(n => n.ix));
  const minIZ = Math.min(...nodes.map(n => n.iz)), maxIZ = Math.max(...nodes.map(n => n.iz));
  const bounds = new THREE.Box3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  function stamp(box) {
    for (let ix = Math.max(minIX, Math.floor(box.min.x / STEP)); ix <= Math.min(maxIX, Math.floor(box.max.x / STEP)); ix++) {
      for (let iz = Math.max(minIZ, Math.floor(box.min.z / STEP)); iz <= Math.min(maxIZ, Math.floor(box.max.z / STEP)); iz++) {
        const node = field.get(key(ix, iz));
        if (node) node.top = Math.max(node.top, box.max.y);
      }
    }
  }
  const roots = Array.isArray(collisionRoot) ? collisionRoot : [collisionRoot];
  roots.forEach(root => root?.updateMatrixWorld(true));
  roots.forEach(root => root?.traverse(object => {
    if (!object.isMesh || !object.geometry) return;
    // Shadow proxies and lower detail levels need not enlarge the collision field.
    if (object.material?.colorWrite === false) return;
    for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
    const geometry = object.geometry;
    if (object.isInstancedMesh) {
      geometry.computeBoundingBox();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, instance); world.multiplyMatrices(object.matrixWorld, instance);
        stamp(bounds.copy(geometry.boundingBox).applyMatrix4(world));
      }
    } else {
      const position = geometry.attributes.position, indices = geometry.index;
      if (!position) return;
      const count = indices?.count ?? position.count;
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(position, indices ? indices.getX(i) : i).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(object.matrixWorld);
        bounds.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c); stamp(bounds);
      }
    }
  }));
  function ceiling(x, z, radius = PIGEON_CLEARANCE) {
    let top = -Infinity;
    for (let ix = Math.floor((x - radius) / STEP); ix <= Math.floor((x + radius) / STEP); ix++) {
      for (let iz = Math.floor((z - radius) / STEP); iz <= Math.floor((z + radius) / STEP); iz++) {
        const node = field.get(key(ix, iz));
        if (!node) return Infinity;
        top = Math.max(top, node.top);
      }
    }
    return top;
  }
  const stops = plazas.flatMap(plaza => {
    const rng = createRng(`pigeon-perches:${plaza.id}`);
    const perches = offsets.map(([x, z]) => [x + (rng() - 0.5) * 0.1, z + (rng() - 0.5) * 0.1]);
    const headings = perches.map(() => rng() * Math.PI * 2 - Math.PI);
    // Search the whole parcel, keeping the familiar central positions first.
    // Fountains and mixed-site buildings often occupy all five old candidates.
    const candidates = [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]];
    for (let dx = -size / 2 + STEP / 2; dx < size / 2; dx += STEP)
      for (let dz = -size / 2 + STEP / 2; dz < size / 2; dz += STEP) candidates.push([dx, dz]);
    for (const [dx, dz] of candidates) {
      const x = (Math.floor((plaza.x + dx) / STEP) + 0.5) * STEP;
      const z = (Math.floor((plaza.z + dz) / STEP) + 0.5) * STEP;
      if (perches.some(([ox, oz]) => Math.abs(x + ox - plaza.x) + 0.45 > size / 2
        || Math.abs(z + oz - plaza.z) + 0.45 > size / 2)) continue;
      const heights = perches.map(([ox, oz]) => ceiling(x + ox, z + oz, 0.45));
      const top = Math.max(...heights);
      const base = sampleGroundHeight(x, z);
      if (!Number.isFinite(top) || top > base + 0.65) continue;
      const floor = field.get(key(Math.floor(x / STEP), Math.floor(z / STEP)))?.top;
      if (top - floor > 0.08 || top - Math.min(...heights) > 0.08) continue;
      return [{ ...plaza, x, z, y: top + 0.025, perches, headings }];
    }
    // A decorated plaza can have room for five birds without room for the
    // original clustered formation. Use separate safe patches at one height.
    const available = [];
    for (const [dx, dz] of candidates) {
      const x = (Math.floor((plaza.x + dx) / STEP) + 0.5) * STEP;
      const z = (Math.floor((plaza.z + dz) / STEP) + 0.5) * STEP;
      if (Math.abs(x - plaza.x) + 0.45 > size / 2 || Math.abs(z - plaza.z) + 0.45 > size / 2) continue;
      const top = ceiling(x, z, 0.45), floor = field.get(key(Math.floor(x / STEP), Math.floor(z / STEP)))?.top;
      if (!Number.isFinite(top) || top > sampleGroundHeight(x, z) + 0.65 || top - floor > 0.08) continue;
      if (available.some(p => Math.hypot(p.x - x, p.z - z) < 0.5)) continue;
      available.push({ x, z, top });
    }
    for (const origin of available) {
      const patches = available.filter(p => Math.abs(p.top - origin.top) < 0.08).slice(0, PIGEON_COUNT);
      if (patches.length < PIGEON_COUNT) continue;
      return [{ ...plaza, x: origin.x, z: origin.z, y: Math.max(...patches.map(p => p.top)) + 0.025,
        perches: patches.map(p => [p.x - origin.x, p.z - origin.z]), headings }];
    }
    return [];
  });
  return { field, stops, ceiling, sampleGroundHeight, step: STEP,
    plazaBuildings: new Set(plazas.map(p => p.buildingId)).size,
    blockedPlazas: plazas.filter(p => !stops.some(s => s.id === p.id)).map(p => p.id) };
}

export function pigeonPerch(stop, index) {
  const offset = (stop.perches ?? offsets)[index];
  return new THREE.Vector3(stop.x + offset[0], stop.y, stop.z + offset[1]);
}

// Search only connected, clear road/open-space samples. The search is bounded
// by the allocated corridor grid, never by the entire world or an unbounded retry.
export function planPigeonFlight(nav, from, to) {
  if (!from || !to || from.id === to.id) return null;
  const { field, ceiling, sampleGroundHeight } = nav;
  const start = key(Math.floor(from.x / STEP), Math.floor(from.z / STEP));
  const goal = key(Math.floor(to.x / STEP), Math.floor(to.z / STEP));
  const previous = new Map([[start, null]]), queue = [start];
  const altitude = (x, z) => sampleGroundHeight(x, z) + 3.2;
  for (let head = 0; head < queue.length && !previous.has(goal); head++) {
    const current = field.get(queue[head]);
    if (!current) continue;
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const id = key(current.ix + dx, current.iz + dz), node = field.get(id);
      if (!node || previous.has(id) || ceiling(node.x, node.z, 0.48) + 0.15 > altitude(node.x, node.z)) continue;
      previous.set(id, queue[head]); queue.push(id);
    }
  }
  if (!previous.has(goal)) return null;
  const path = [];
  for (let id = goal; id !== null; id = previous.get(id)) {
    const node = field.get(id); if (!node) return null;
    path.push(new THREE.Vector3(node.x, 0, node.z));
  }
  path.reverse(); path[0].set(from.x, 0, from.z); path.at(-1).set(to.x, 0, to.z);
  // Remove collinear samples, then round corners with tangent-continuous arcs.
  const corners = path.filter((point, i) => i === 0 || i === path.length - 1 ||
    Math.abs((point.x - path[i - 1].x) * (path[i + 1].z - point.z) -
      (point.z - path[i - 1].z) * (path[i + 1].x - point.x)) > 1e-6);
  if (corners.length < 2) return null;
  const curve = new THREE.CurvePath();
  let cursor = corners[0];
  for (let i = 1; i < corners.length - 1; i++) {
    const corner = corners[i], before = corners[i - 1], after = corners[i + 1];
    const cut = Math.min(1.25, corner.distanceTo(before) * 0.4, corner.distanceTo(after) * 0.4);
    const entry = corner.clone().lerp(before, cut / corner.distanceTo(before));
    const exit = corner.clone().lerp(after, cut / corner.distanceTo(after));
    curve.add(new THREE.LineCurve3(cursor, entry));
    curve.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    cursor = exit;
  }
  curve.add(new THREE.LineCurve3(cursor, corners.at(-1)));
  curve.arcLengthDivisions = Math.max(200, path.length * 8);
  const length = curve.getLength();
  if (length < 4 || length > 160) return null;
  const points = [], distances = [0];
  const count = Math.ceil(length / 0.08);
  for (let i = 0; i <= count; i++) {
    const p = curve.getPointAt(i / count), d = length * i / count;
    // Forward travel throughout takeoff/descent; no vertical segment or hover.
    const rise = Math.min(1, d / 4), descend = Math.min(1, (length - d) / 4);
    const cruise = altitude(p.x, p.z);
    p.y = Math.min(from.y + (cruise - from.y) * Math.sin(rise * Math.PI / 2),
      to.y + (cruise - to.y) * Math.sin(descend * Math.PI / 2));
    points.push(p);
    if (i) distances.push(distances.at(-1) + p.distanceTo(points[i - 1]));
  }
  const rng = createRng(`pigeon-flight:${from.id}:${to.id}`);
  const departure = points[1].clone().sub(points[0]); departure.y = 0; departure.normalize();
  const side = new THREE.Vector3(departure.z, 0, -departure.x);
  const lateral = [-0.42, 0.48, -0.12, 0.62, 0.16];
  const heights = [0.04, 0.32, -0.19, -0.03, 0.2];
  const flightOffsets = lateral.map((value, i) => side.clone().multiplyScalar(value + (rng() - 0.5) * 0.08)
    .addScaledVector(departure, (rng() - 0.5) * 0.22).setY(heights[i]));
  const delays = [0, 0.12, 0.31, 0.49, 0.67].map((d, i) => d + (i ? rng() * 0.055 : 0));
  // All variation is baked into validated tracks, never added as unchecked
  // per-frame noise. Tight streets can use a smaller, still staggered formation.
  for (const formationScale of [1, 0.65, 0.35]) {
  const tracks = flightOffsets.map((offset, bird) => points.map((p, i) => {
    const startBlend = 1 - smooth(i / count * length / 3);
    const endBlend = 1 - smooth((1 - i / count) * length / 3);
    const flightBlend = (1 - startBlend) * (1 - endBlend);
    const startOffset = (from.perches ?? offsets)[bird], endOffset = (to.perches ?? offsets)[bird];
    return p.clone().addScaledVector(offset, flightBlend * formationScale)
      .add(new THREE.Vector3(startOffset[0] * startBlend + endOffset[0] * endBlend, 0,
        startOffset[1] * startBlend + endOffset[1] * endBlend));
  }));
  // Check every bird's complete wing envelope AFTER smoothing and endpoint
  // spreading. Reject tight corners instead of falling back to sharp turns.
  let valid = true;
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (ceiling(p.x, p.z, PIGEON_CLEARANCE + 0.05) > p.y - 0.005) { nav.lastRejection = { type: "clearance", point: p.toArray(), top: ceiling(p.x,p.z,0.43) }; valid = false; break; }
      if (i > 0 && i < track.length - 1) {
        const u = track[i].clone().sub(track[i - 1]), v = track[i + 1].clone().sub(track[i]);
        // Radius >= 0.55 world units; an unsafe tight turn means another plaza.
        if (u.angleTo(v) / Math.max(0.001, (u.length() + v.length()) / 2) > 1 / 0.55) { nav.lastRejection = { type: "turn", point: p.toArray() }; valid = false; break; }
      }
    }
  }
  if (valid) return { tracks, distances, length: distances.at(-1), from, to, delays, formationScale };
  }
  return null;
}

export function samplePigeonTrack(route, index, distance, position, direction) {
  const ds = route.trackDistances?.[index] ?? route.distances, points = route.tracks[index];
  const trackLength = ds.at(-1);
  const d = Math.max(0, Math.min(route.length, distance)) * trackLength / route.length;
  let low = 0, high = ds.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (ds[mid] <= d) low = mid; else high = mid; }
  position.copy(points[low]).lerp(points[high], (d - ds[low]) / Math.max(1e-6, ds[high] - ds[low]));
  direction.subVectors(points[high], points[low]).normalize();
}
