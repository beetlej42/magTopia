import * as THREE from "three";
import { PIGEON_COUNT, PIGEON_CLEARANCE, pigeonPerch } from "./pigeonNavigation.js";

const TAU = Math.PI * 2;
const mod = a => (a % TAU + TAU) % TAU;
const routeCaches = new WeakMap();

// Bounded local excursions, including return flights. Every individual bird
// connects its own perch to the orbit; no shared low-altitude centerline can
// pull a dispersed bird through a fountain. Only road/plaza columns are used.
export function planPigeonLocalFlight(nav, from, to = from) {
  if (!from || !to) return null;
  let cache = routeCaches.get(nav);
  if (!cache) { cache = new Map(); routeCaches.set(nav, cache); }
  const key = `${from.id}:${to.id}`;
  if (cache.has(key)) return cache.get(key);
  const route = buildLocalFlight(nav, from, to);
  if (cache.size >= 16) cache.delete(cache.keys().next().value);
  cache.set(key, route);
  return route;
}

function buildLocalFlight(nav, from, to) {
  if (!from || !to) return null;
  const a = { x: from.parcelX ?? from.x, z: from.parcelZ ?? from.z };
  const b = { x: to.parcelX ?? to.x, z: to.parcelZ ?? to.z };
  const separation = Math.hypot(b.x - a.x, b.z - a.z);
  if (separation > 8) return null;
  const axis = separation > 0.1 ? Math.atan2(b.z - a.z, b.x - a.x) : 0;
  const cos = Math.cos(axis), sin = Math.sin(axis);
  const height = Math.max(from.y, to.y, nav.sampleGroundHeight(a.x, a.z), nav.sampleGroundHeight(b.x, b.z)) + 3.2;
  // Try the plaza footprint first, then nearby road airspace. Work is bounded
  // and happens once per rest cycle, never per frame.
  for (const shift of [0, -0.5, 0.5, -1, 1]) {
    const cx = (a.x + b.x) / 2 - sin * shift, cz = (a.z + b.z) / 2 + cos * shift;
    for (const width of [1.4, 1.2, 1.0]) {
      const rx = separation / 2 + width, rz = width;
      for (const sign of [1, -1]) {
        const point = (angle, y = height) => new THREE.Vector3(
          cx + cos * rx * Math.cos(angle) - sin * rz * Math.sin(angle), y,
          cz + sin * rx * Math.cos(angle) + cos * rz * Math.sin(angle));
        // Reject unusable orbits before constructing five connector tracks.
        let clear = true;
        for (let j = 0; j < 160; j++) {
          const p = point(TAU * j / 160);
          if (nav.ceiling(p.x, p.z, PIGEON_CLEARANCE + 0.05) > p.y - 0.15) { nav.lastLocalRejection = { type: "orbit-clearance", point: p.toArray() }; clear = false; break; }
        }
        if (!clear) continue;
        const tracks = [], trackDistances = [];
        for (let bird = 0; bird < PIGEON_COUNT; bird++) {
          const start = pigeonPerch(from, bird), end = pigeonPerch(to, bird);
          const angleOf = p => Math.atan2((-sin * (p.x - cx) + cos * (p.z - cz)) / rz,
            (cos * (p.x - cx) + sin * (p.z - cz)) / rx);
          const startAngle = angleOf(start), endAngle = angleOf(end);
          const startRadius = Math.hypot((cos * (start.x - cx) + sin * (start.z - cz)) / rx,
            (-sin * (start.x - cx) + cos * (start.z - cz)) / rz);
          const endRadius = Math.hypot((cos * (end.x - cx) + sin * (end.z - cz)) / rx,
            (-sin * (end.x - cx) + cos * (end.z - cz)) / rz);
          const birdHeight = height + [0, 0.32, -0.25, 0.6, -0.55][bird];
          const climbAngle = Math.PI;
          const points = [];
          const spiralPoint = (angle, radius, y) => new THREE.Vector3(
            cx + radius * (cos * rx * Math.cos(angle) - sin * rz * Math.sin(angle)), y,
            cz + radius * (sin * rx * Math.cos(angle) + cos * rz * Math.sin(angle)));
          // Forward spiral ascent/descent, tangent-continuous at cruise. A
          // quarter-turn connector was too tight for the tall climb in v1.
          const connectorSteps = Math.ceil((Math.PI * Math.max(rx, rz) * Math.max(1, startRadius, endRadius) + height) / 0.04);
          for (let j = 0; j <= connectorSteps; j++) {
            const u = j / connectorSteps, blend = 1 - Math.pow(1 - u, 12);
            points.push(spiralPoint(startAngle + sign * climbAngle * u,
              startRadius + (1 - startRadius) * blend,
              start.y + (birdHeight - start.y) * Math.sin(u * Math.PI / 2)));
          }
          const cruiseStart = startAngle + sign * climbAngle;
          const cruiseEnd = endAngle - sign * climbAngle;
          const cruiseSpan = TAU + mod(sign * (cruiseEnd - cruiseStart));
          const steps = Math.ceil(cruiseSpan * Math.max(rx, rz) / 0.05);
          for (let j = 1; j <= steps; j++) points.push(point(cruiseStart + sign * cruiseSpan * j / steps, birdHeight));
          for (let j = 1; j <= connectorSteps; j++) {
            const u = j / connectorSteps, blend = Math.pow(u, 12);
            points.push(spiralPoint(cruiseStart + sign * cruiseSpan + sign * climbAngle * u,
              1 + (endRadius - 1) * blend,
              end.y + (birdHeight - end.y) * Math.cos(u * Math.PI / 2)));
          }
          points[0].copy(start); points.at(-1).copy(end);
          // Densify steep connector portions as well as the cruise orbit.
          const samples = [points[0]];
          for (let j = 1; j < points.length; j++) {
            const steps = Math.ceil(points[j].distanceTo(points[j - 1]) / 0.04);
            for (let k = 1; k <= steps; k++) samples.push(points[j - 1].clone().lerp(points[j], k / steps));
          }
          const ds = [0];
          for (let j = 0; j < samples.length; j++) {
            const p = samples[j];
            if (nav.ceiling(p.x, p.z, PIGEON_CLEARANCE + 0.05) > p.y - 0.005) { nav.lastLocalRejection = { type: "connector-clearance", bird, point: p.toArray() }; clear = false; break; }
            if (j) ds.push(ds.at(-1) + p.distanceTo(samples[j - 1]));
          }
          // Cruise has a speed-independent minimum horizontal turn radius;
          // the smooth ascent/descent spirals run at eased departure speed.
          for (let j = connectorSteps + 1; clear && j < points.length - connectorSteps - 1; j++) {
              const p = points[j];
              const u = p.clone().sub(points[j - 1]).setY(0), v = points[j + 1].clone().sub(p).setY(0);
              if (u.angleTo(v) / Math.max(0.001, (u.length() + v.length()) / 2) > 1 / 0.55) { nav.lastLocalRejection = { type: "turn", bird, point: p.toArray(), curvature: u.angleTo(v) / ((u.length()+v.length())/2) }; clear = false; break; }
          }
          if (!clear) break;
          tracks.push(samples); trackDistances.push(ds);
        }
        if (clear) return { tracks, trackDistances, distances: trackDistances[0],
          length: Math.max(...trackDistances.map(ds => ds.at(-1))), from, to,
          delays: [0, 0.18, 0.43, 0.71, 0.98], formationScale: 1,
          kind: from.id === to.id ? "local-return" : "local-transfer" };
      }
    }
  }
  return null;
}
