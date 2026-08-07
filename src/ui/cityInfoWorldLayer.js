import * as THREE from "three";

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PLANET_CENTER = new THREE.Vector3(0, -1, 0);

/**
 * World-space portion of the city glance UI.
 *
 * A selected block is represented by a batched shallow uplift plus a four-edge
 * 3D frame following its logical bounds. Both live in the Three.js scene so
 * terrain and buildings can occlude them naturally without one draw call per
 * parcel.
 */
export function createCityInfoWorldLayer() {
  const layer = new THREE.Group();
  layer.name = "CityInfoWorldLayer";
  layer.visible = false;

  const frame = new THREE.Group();
  frame.name = "CityInfoBlockFrame";

  const uplift = new THREE.Mesh();
  uplift.name = "CityInfoBlockUplift";

  const frameMaterial = new THREE.LineDashedMaterial({
    color: "#be9a57",
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    dashSize: 0.5,
    gapSize: 0.28,
    scale: 1
  });
  const upliftTopMaterial = new THREE.MeshStandardMaterial({
    color: "#b79a63",
    roughness: 0.98,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  const upliftSideMaterial = new THREE.MeshStandardMaterial({
    color: "#806843",
    roughness: 1,
    metalness: 0,
    flatShading: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  uplift.geometry = new THREE.BufferGeometry();
  uplift.material = [upliftTopMaterial, upliftSideMaterial];
  uplift.renderOrder = 1;
  const targetMaterial = new THREE.MeshBasicMaterial({
    color: "#8068b7",
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });
  const targetDotMaterial = new THREE.MeshBasicMaterial({
    color: "#8068b7",
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false
  });

  const target = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.48, 24), targetMaterial);
  const targetDot = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), targetDotMaterial);
  target.name = "CityInfoTargetRing";
  targetDot.name = "CityInfoTargetDot";
  layer.add(uplift, frame, target, targetDot);

  let mountedRoot = null;
  let geometryKey = null;
  const liftedBuildings = new Map();

  function setSceneRoot(root = null) {
    resetBuildingLift();
    if (mountedRoot) mountedRoot.remove(layer);
    mountedRoot = root;
    geometryKey = null;
    clearFrame();
    clearUplift();
    layer.visible = false;
    if (mountedRoot) mountedRoot.add(layer);
  }

  function update({
    geometryKey: nextGeometryKey = null,
    boundaryEdges = [],
    cellTiles = [],
    targetWorld = null,
    targetNormal = null,
    planetCenter = PLANET_CENTER,
    opacity = 0,
    frameVisible = false,
    upliftVisible = false,
    targetVisible = false,
    buildingObjects = [],
    buildingLift = 0.08,
    targetOpacity = opacity
  } = {}) {
    const hasFrame = frameVisible && boundaryEdges.length > 0;
    const hasUplift = upliftVisible && cellTiles.length > 0;
    const hasTarget = targetVisible && targetWorld;
    layer.visible = Boolean(hasFrame || hasUplift || hasTarget);

    if ((hasFrame || hasUplift) && nextGeometryKey !== geometryKey) {
      replaceFrame(boundaryEdges);
      replaceUplift(cellTiles);
      geometryKey = nextGeometryKey;
    }

    frame.visible = Boolean(hasFrame);
    uplift.visible = Boolean(hasUplift);
    target.visible = Boolean(hasTarget);
    targetDot.visible = Boolean(hasTarget);
    frameMaterial.opacity = hasFrame ? opacity : 0;
    upliftTopMaterial.opacity = hasUplift ? opacity * 0.22 : 0;
    upliftSideMaterial.opacity = hasUplift ? opacity * 0.38 : 0;
    targetMaterial.opacity = hasTarget ? targetOpacity * 0.68 : 0;
    targetDotMaterial.opacity = hasTarget ? targetOpacity : 0;
    updateBuildingLift(buildingObjects, hasUplift ? opacity : 0, buildingLift, planetCenter);

    if (hasTarget) {
      const normal = (targetNormal?.clone() ?? targetWorld.clone().sub(planetCenter).normalize()).normalize();
      target.position.copy(targetWorld);
      targetDot.position.copy(targetWorld);
      target.quaternion.setFromUnitVectors(Z_AXIS, normal);
      targetDot.quaternion.copy(target.quaternion);
    }
  }

  function replaceFrame(boundaryEdges) {
    clearFrame();
    boundaryEdges.forEach((edge, index) => {
      if (!Array.isArray(edge) || edge.length < 2) return;
      const geometry = new THREE.BufferGeometry().setFromPoints(edge);
      const line = new THREE.Line(geometry, frameMaterial);
      line.name = `CityInfoBlockFrameEdge-${index}`;
      line.computeLineDistances();
      line.renderOrder = 2;
      frame.add(line);
    });
  }

  function clearFrame() {
    while (frame.children.length) {
      const child = frame.children[0];
      frame.remove(child);
      child.geometry?.dispose?.();
    }
  }

  function replaceUplift(cellTiles) {
    uplift.geometry.dispose();
    uplift.geometry = createBatchedParcelTileGeometry(cellTiles);
  }

  function clearUplift() {
    uplift.geometry.dispose();
    uplift.geometry = new THREE.BufferGeometry();
  }

  function dispose() {
    if (mountedRoot) mountedRoot.remove(layer);
    resetBuildingLift();
    clearFrame();
    uplift.geometry.dispose();
    target.geometry.dispose();
    targetDot.geometry.dispose();
    frameMaterial.dispose();
    upliftTopMaterial.dispose();
    upliftSideMaterial.dispose();
    targetMaterial.dispose();
    targetDotMaterial.dispose();
  }

  function updateBuildingLift(objects, amount, lift, planetCenter) {
    const activeObjects = amount > 0.001
      ? new Set((objects ?? []).filter(Boolean))
      : new Set();

    liftedBuildings.forEach((record, object) => {
      if (activeObjects.has(object)) return;
      object.position.copy(record.basePosition);
      liftedBuildings.delete(object);
    });

    activeObjects.forEach((object) => {
      let record = liftedBuildings.get(object);
      if (!record) {
        record = {
          basePosition: object.position.clone(),
          normal: object.position.clone().sub(planetCenter).normalize(),
          amount: Number.NaN
        };
        liftedBuildings.set(object, record);
      }
      if (Math.abs(record.amount - amount) <= 0.0001) return;
      object.position.copy(record.basePosition).addScaledVector(record.normal, lift * amount);
      record.amount = amount;
    });
  }

  function resetBuildingLift() {
    liftedBuildings.forEach((record, object) => object.position.copy(record.basePosition));
    liftedBuildings.clear();
  }

  return {
    setSceneRoot,
    update,
    dispose,
    object: layer
  };
}

export function createBatchedParcelTileGeometry(cellTiles = []) {
  const positions = [];
  const topIndices = [];
  const sideIndices = [];

  cellTiles.forEach((tile) => {
    const top = tile?.top ?? [];
    const base = tile?.base ?? [];
    if (top.length < 3 || top.length !== base.length) return;

    const topCenterIndex = appendPoint(positions, averagePoint(top));
    const topVertexIndices = top.map((point) => appendPoint(positions, point));
    const baseVertexIndices = base.map((point) => appendPoint(positions, point));
    for (let index = 0; index < top.length; index += 1) {
      const next = (index + 1) % top.length;
      topIndices.push(topCenterIndex, topVertexIndices[next], topVertexIndices[index]);
      sideIndices.push(
        topVertexIndices[index], baseVertexIndices[index], baseVertexIndices[next],
        topVertexIndices[index], baseVertexIndices[next], topVertexIndices[next]
      );
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...topIndices, ...sideIndices]);
  if (topIndices.length > 0) geometry.addGroup(0, topIndices.length, 0);
  if (sideIndices.length > 0) geometry.addGroup(topIndices.length, sideIndices.length, 1);
  if (positions.length > 0) {
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

function appendPoint(positions, point) {
  const index = positions.length / 3;
  positions.push(point.x, point.y, point.z);
  return index;
}

function averagePoint(points) {
  const center = new THREE.Vector3();
  points.forEach((point) => center.add(point));
  return center.multiplyScalar(1 / Math.max(1, points.length));
}
