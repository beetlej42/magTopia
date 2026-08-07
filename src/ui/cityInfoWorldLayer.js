import * as THREE from "three";

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PLANET_CENTER = new THREE.Vector3(0, -1, 0);

/**
 * World-space portion of the city glance UI.
 *
 * A selected block is represented by its logical land parcels, not by a
 * screen-space boundary or a floating fill. Each parcel becomes a shallow
 * raised voxel-like tile on the spherical surface, so the highlight follows
 * the same curvature and depth ordering as the city itself.
 */
export function createCityInfoWorldLayer() {
  const layer = new THREE.Group();
  layer.name = "CityInfoWorldLayer";
  layer.visible = false;

  const parcels = new THREE.Group();
  parcels.name = "CityInfoBlockParcels";

  const parcelTopMaterial = new THREE.MeshStandardMaterial({
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
  const parcelSideMaterial = new THREE.MeshStandardMaterial({
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
  layer.add(parcels, target, targetDot);

  let mountedRoot = null;
  let geometryKey = null;
  const liftedBuildings = new Map();

  function setSceneRoot(root = null) {
    resetBuildingLift();
    if (mountedRoot) mountedRoot.remove(layer);
    mountedRoot = root;
    geometryKey = null;
    clearParcelTiles();
    layer.visible = false;
    if (mountedRoot) mountedRoot.add(layer);
  }

  function update({
    geometryKey: nextGeometryKey = null,
    cellTiles = [],
    targetWorld = null,
    targetNormal = null,
    planetCenter = PLANET_CENTER,
    opacity = 0,
    parcelsVisible = false,
    targetVisible = false,
    buildingObjects = [],
    buildingLift = 0.08,
    targetOpacity = opacity
  } = {}) {
    const hasParcels = parcelsVisible && cellTiles.length > 0;
    const hasTarget = targetVisible && targetWorld;
    layer.visible = Boolean(hasParcels || hasTarget);

    if (hasParcels && nextGeometryKey !== geometryKey) {
      replaceParcelTiles(cellTiles);
      geometryKey = nextGeometryKey;
    }

    parcels.visible = Boolean(hasParcels);
    target.visible = Boolean(hasTarget);
    targetDot.visible = Boolean(hasTarget);
    parcelTopMaterial.opacity = hasParcels ? opacity : 0;
    parcelSideMaterial.opacity = hasParcels ? opacity : 0;
    targetMaterial.opacity = hasTarget ? targetOpacity * 0.68 : 0;
    targetDotMaterial.opacity = hasTarget ? targetOpacity : 0;
    updateBuildingLift(buildingObjects, hasParcels ? opacity : 0, buildingLift, planetCenter);

    if (hasTarget) {
      const normal = (targetNormal?.clone() ?? targetWorld.clone().sub(planetCenter).normalize()).normalize();
      target.position.copy(targetWorld);
      targetDot.position.copy(targetWorld);
      target.quaternion.setFromUnitVectors(Z_AXIS, normal);
      targetDot.quaternion.copy(target.quaternion);
    }
  }

  function replaceParcelTiles(cellTiles) {
    clearParcelTiles();
    cellTiles.forEach((tile) => {
      if (!tile?.top?.length || !tile?.base?.length) return;
      const geometry = createParcelTileGeometry(tile.top, tile.base);
      const mesh = new THREE.Mesh(geometry, [parcelTopMaterial, parcelSideMaterial]);
      mesh.name = `CityInfoBlockParcel-${tile.id}`;
      mesh.userData.cellId = tile.id;
      mesh.renderOrder = 2;
      parcels.add(mesh);
    });
  }

  function clearParcelTiles() {
    while (parcels.children.length) {
      const child = parcels.children[0];
      parcels.remove(child);
      child.geometry?.dispose?.();
    }
  }

  function dispose() {
    if (mountedRoot) mountedRoot.remove(layer);
    resetBuildingLift();
    clearParcelTiles();
    target.geometry.dispose();
    targetDot.geometry.dispose();
    parcelTopMaterial.dispose();
    parcelSideMaterial.dispose();
    targetMaterial.dispose();
    targetDotMaterial.dispose();
  }

  function updateBuildingLift(objects, amount, lift, planetCenter) {
    const activeObjects = new Set((objects ?? []).filter(Boolean));
    liftedBuildings.forEach((record, object) => {
      if (!activeObjects.has(object)) object.position.copy(record.basePosition);
    });

    activeObjects.forEach((object) => {
      let record = liftedBuildings.get(object);
      if (!record) {
        record = {
          basePosition: object.position.clone(),
          normal: object.position.clone().sub(planetCenter).normalize()
        };
        liftedBuildings.set(object, record);
      }
      object.position.copy(record.basePosition).addScaledVector(record.normal, lift * amount);
    });

    liftedBuildings.forEach((record, object) => {
      if (!activeObjects.has(object) && amount <= 0) {
        object.position.copy(record.basePosition);
        liftedBuildings.delete(object);
      }
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

function createParcelTileGeometry(top, base) {
  const positions = [];
  const indices = [];
  const centerTop = averagePoint(top);
  const centerBase = averagePoint(base);
  const topCenterIndex = appendPoint(positions, centerTop);
  const baseCenterIndex = appendPoint(positions, centerBase);
  const topIndices = top.map((point) => appendPoint(positions, point));
  const baseIndices = base.map((point) => appendPoint(positions, point));

  for (let index = 0; index < top.length; index += 1) {
    const next = (index + 1) % top.length;
    indices.push(topCenterIndex, topIndices[next], topIndices[index]);
    indices.push(baseCenterIndex, baseIndices[next], baseIndices[index]);
    indices.push(topIndices[index], baseIndices[index], baseIndices[next]);
    indices.push(topIndices[index], baseIndices[next], topIndices[next]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, top.length * 3, 0);
  geometry.addGroup(top.length * 3, indices.length - top.length * 3, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
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
