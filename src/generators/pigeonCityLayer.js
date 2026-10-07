import * as THREE from "three";
import { createRng } from "../utils/random.js";
import { getVoxelSphereFrame } from "./voxelIntentDistrict.js";
import { createPigeonAsset, posePigeon } from "./pigeonAsset.js";
import { PIGEON_COUNT, pigeonPerch, planPigeonFlight, samplePigeonTrack } from "./pigeonNavigation.js";

const smooth = x => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

export function createPigeonCityLayer({ navigation, planetRadius = 220, seed = "city-pigeons", debug = false }) {
  const group = new THREE.Group();
  group.name = "CityPigeonFlock";
  group.userData.dynamicSubtree = true;
  const rng = createRng(seed), stops = navigation.stops;
  const birds = stops.length ? Array.from({ length: PIGEON_COUNT }, (_, i) => createPigeonAsset(i)) : [];
  birds.forEach((b, i) => { b.restHeading = [-0.3, 0.9, -1.5, 0.3, -0.8][i]; group.add(b.root); b.root.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = false; }); });
  const position = new THREE.Vector3(), direction = new THREE.Vector3(), ahead = new THREE.Vector3(), nextDirection = new THREE.Vector3();
  const frame = { normal: new THREE.Vector3(), tangentX: new THREE.Vector3(), tangentZ: new THREE.Vector3(), surface: new THREE.Vector3() };
  const basis = new THREE.Matrix4(), rotation = new THREE.Quaternion(), localRotation = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, "YXZ");
  let current = stops.length ? stops[Math.floor(rng() * stops.length)] : null;
  let route = null, launchedAt = 0, nextFlight = 30 + rng() * 30, restAt = 0, lastTime = null;
  let debugLine = null, detailed = true;
  const diagnostics = { flockCount: birds.length ? 1 : 0, birdCount: birds.length, eligiblePlazas: stops.length,
    plazaBuildings: navigation.plazaBuildings ?? 0, blockedPlazas: navigation.blockedPlazas ?? [],
    state: birds.length ? "resting" : "inactive", source: current?.id ?? null, destination: null, rejectedRoutes: 0 };
  function place(bird, point, yaw, pitch = 0, bank = 0) {
    getVoxelSphereFrame(point.x, point.z, planetRadius, frame);
    basis.makeBasis(frame.tangentX, frame.normal, frame.tangentZ);
    rotation.setFromRotationMatrix(basis); euler.set(pitch, yaw, bank, "YXZ");
    bird.root.position.copy(frame.surface).addScaledVector(frame.normal, point.y);
    bird.root.quaternion.copy(rotation).multiply(localRotation.setFromEuler(euler));
  }
  function showRoute() {
    if (debugLine) { group.remove(debugLine); debugLine.geometry.dispose(); debugLine.material.dispose(); debugLine = null; }
    if (!debug || !route) return;
    const points = route.tracks[0].map(p => {
      getVoxelSphereFrame(p.x, p.z, planetRadius, frame);
      return frame.surface.clone().addScaledVector(frame.normal, p.y);
    });
    debugLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffc857 }));
    group.add(debugLine);
  }
  function chooseRoute(elapsed) {
    const candidates = stops.filter(stop => stop.buildingId !== current.buildingId);
    // At most four attempts per rest cycle; one successful route is retained.
    for (let tries = 0; candidates.length && tries < 4; tries++) {
      const [target] = candidates.splice(Math.floor(rng() * candidates.length), 1);
      const planned = planPigeonFlight(navigation, current, target);
      if (!planned) { diagnostics.rejectedRoutes++; continue; }
      route = planned; launchedAt = elapsed + 0.6;
      diagnostics.destination = target.id; diagnostics.state = "preparing"; showRoute(); return;
    }
    nextFlight = elapsed + 30 + rng() * 30;
  }
  group.userData.update = elapsed => {
    if (!Number.isFinite(elapsed) || !current) return;
    // Static-city optimization may freeze matrices after layer creation.
    if (group.matrixAutoUpdate === false || birds[0].root.matrixAutoUpdate === false) group.traverse(o => {
      o.matrixAutoUpdate = o.matrixWorldAutoUpdate = true;
    });
    if (lastTime === null) { nextFlight += elapsed; restAt = elapsed; }
    if (lastTime !== null && elapsed < lastTime) { route = null; restAt = elapsed; nextFlight = elapsed + 30; showRoute(); }
    lastTime = elapsed;
    if (!route && elapsed >= nextFlight) chooseRoute(elapsed);
    const duration = route ? route.length / 2.6 : 0;
    birds.forEach((bird, i) => {
      const delay = route?.delays[i] ?? 0;
      const flightTime = elapsed - launchedAt - delay;
      if (route && flightTime >= 0 && flightTime < duration) {
        const u = flightTime / duration;
        // Ease speed at either end, keeping forward motion even while climbing.
        const progress = u - Math.sin(2 * Math.PI * u) * 0.55 / (2 * Math.PI);
        const distance = progress * route.length;
        samplePigeonTrack(route, i, distance, position, direction);
        samplePigeonTrack(route, i, Math.min(route.length, distance + 0.3), ahead, nextDirection);
        const yaw = Math.atan2(direction.x, direction.z);
        const turn = Math.atan2(direction.z * nextDirection.x - direction.x * nextDirection.z, direction.dot(nextDirection));
        place(bird, position, yaw, -Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) * 0.5,
          THREE.MathUtils.clamp(-turn * 2, -0.35, 0.35));
        posePigeon(bird, elapsed, i, { spread: Math.min(smooth(flightTime / 0.2), 1 - 0.85 * smooth((flightTime - duration + 0.3) / 0.3)), land: smooth((u - 0.85) / 0.15) });
      } else {
        const landed = route && flightTime >= duration;
        const stop = landed ? route.to : current;
        position.copy(pigeonPerch(stop, i));
        const t = Math.max(0, elapsed - (landed ? launchedAt + delay + duration : restAt));
        // Short out-and-back steps, with planted-foot motion and long pauses.
        const turnTime = bird.landingHeading !== undefined ? 0.7 + i * 0.16 : 0;
        const cycle = Math.min(9, Math.max(0, t - turnTime - i * 0.3));
        const walking = !route && t >= turnTime + i * 0.3 && (cycle < 0.8 || cycle >= 4.5 && cycle < 5.3);
        const travel = cycle < 0.8 ? cycle * 0.15 : cycle < 4.5 ? 0.12 : cycle < 5.3 ? 0.12 - (cycle - 4.5) * 0.15 : 0;
        const yaw = cycle < 3.8 ? 0 : cycle < 4.5 ? Math.PI * smooth((cycle - 3.8) / 0.7) : cycle < 8.3 ? Math.PI : Math.PI * (1 - smooth((cycle - 8.3) / 0.7));
        if (!route) { position.x += Math.sin(bird.restHeading) * travel; position.z += Math.cos(bird.restHeading) * travel; }
        let heading = bird.restHeading + yaw;
        if (route) {
          samplePigeonTrack(route, i, landed ? route.length : 0, ahead, direction);
          const flightHeading = Math.atan2(direction.x, direction.z);
          if (landed) { heading = flightHeading; bird.restHeading = heading; }
          else {
            const delta = Math.atan2(Math.sin(flightHeading - bird.restHeading), Math.cos(flightHeading - bird.restHeading));
            heading = bird.restHeading + delta * smooth((flightTime + 0.6) / 0.6);
          }
        }
        // Touch down along the flight tangent, then turn on the ground at an
        // individual pace. Never snap to an unrelated yaw while still flying.
        if (!route && bird.landingHeading !== undefined) {
          const delta = Math.atan2(Math.sin(bird.restHeading - bird.landingHeading), Math.cos(bird.restHeading - bird.landingHeading));
          heading = bird.landingHeading + delta * smooth(t / (0.7 + i * 0.16)) + yaw;
        }
        place(bird, position, heading);
        posePigeon(bird, elapsed, i, { walk: walking ? (cycle < 0.8 ? cycle : cycle - 4.5) / 0.5 : 0,
          peck: !route && !walking && detailed ? Math.pow(Math.max(0, Math.sin(t * 2.6 + i)), 5) : 0,
          spread: route && !landed ? 0.35 * smooth((flightTime + 0.2) / 0.2) : 0 });
      }
    });
    if (route) {
      diagnostics.state = elapsed < launchedAt ? "preparing" : "flying";
      if (elapsed >= launchedAt + duration + Math.max(...route.delays)) {
        birds.forEach((bird, i) => {
          samplePigeonTrack(route, i, route.length, ahead, direction);
          bird.landingHeading = Math.atan2(direction.x, direction.z);
          bird.restHeading = route.to.headings[i];
        });
        current = route.to; route = null; restAt = elapsed; nextFlight = elapsed + 30 + rng() * 30;
        diagnostics.source = current.id; diagnostics.destination = null; diagnostics.state = "resting"; showRoute();
      }
    }
    // The static city ancestor may have matrixWorldAutoUpdate disabled, so the
    // renderer will not traverse down to us. Commit this dynamic subtree here.
    group.updateMatrixWorld(true);
  };
  group.userData.updateView = (_camera, viewport = {}) => { detailed = viewport.viewMode !== "far"; };
  group.userData.getDiagnostics = () => ({ ...diagnostics });
  group.userData.setDebug = enabled => { debug = Boolean(enabled); showRoute(); };
  birds.forEach((bird, i) => { place(bird, pigeonPerch(current, i), bird.restHeading); posePigeon(bird, 0, i); });
  return group;
}
