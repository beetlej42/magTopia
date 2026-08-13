import * as THREE from "three";

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PLANET_CENTER = new THREE.Vector3(0, -1, 0);
/**
 * World-space portion of the city glance UI.
 *
 * A selected block is represented by a four-edge 3D frame following its
 * logical bounds. It lives in the Three.js scene so terrain and buildings can
 * occlude it naturally.
 */
export function createCityInfoWorldLayer() {
  const layer = new THREE.Group();
  layer.name = "CityInfoWorldLayer";
  layer.visible = false;

  const frame = new THREE.Group();
  frame.name = "CityInfoBlockFrame";

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
  layer.add(frame, target, targetDot);

  let mountedRoot = null;
  let geometryKey = null;

  function setSceneRoot(root = null) {
    if (mountedRoot) mountedRoot.remove(layer);
    mountedRoot = root;
    geometryKey = null;
    clearFrame();
    layer.visible = false;
    if (mountedRoot) mountedRoot.add(layer);
  }

  function update({
    geometryKey: nextGeometryKey = null,
    boundaryEdges = [],
    targetWorld = null,
    targetNormal = null,
    planetCenter = PLANET_CENTER,
    opacity = 0,
    frameVisible = false,
    targetVisible = false,
    targetOpacity = opacity
  } = {}) {
    const hasFrame = frameVisible && boundaryEdges.length > 0;
    const hasTarget = targetVisible && targetWorld;
    layer.visible = Boolean(hasFrame || hasTarget);

    if (hasFrame && nextGeometryKey !== geometryKey) {
      replaceFrame(boundaryEdges);
      geometryKey = nextGeometryKey;
    }

    frame.visible = Boolean(hasFrame);
    target.visible = Boolean(hasTarget);
    targetDot.visible = Boolean(hasTarget);
    frameMaterial.opacity = hasFrame ? opacity : 0;
    targetMaterial.opacity = hasTarget ? targetOpacity * 0.68 : 0;
    targetDotMaterial.opacity = hasTarget ? targetOpacity : 0;

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

  function dispose() {
    if (mountedRoot) mountedRoot.remove(layer);
    clearFrame();
    target.geometry.dispose();
    targetDot.geometry.dispose();
    frameMaterial.dispose();
    targetMaterial.dispose();
    targetDotMaterial.dispose();
  }

  return {
    setSceneRoot,
    update,
    dispose,
    object: layer
  };
}
