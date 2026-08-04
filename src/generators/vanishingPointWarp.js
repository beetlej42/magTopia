import * as THREE from "three";
import { resolveAsset } from "../city/assets.js";

const FACE_SUBDIVISIONS = 18;
const ASSET_WARP_SUBDIVISIONS = 160;

export const VANISHING_POINT_PRESETS = {
  twoPointCuboid: {
    seed: "two-point-cuboid-001",
    leftVanishingDistance: 18,
    rightVanishingDistance: 28,
    footprintWidth: 4,
    footprintDepth: 5,
    buildingHeight: 6,
    projectionScale: 0.72,
    assetWarpStrength: 1,
    showGuides: 1,
    sunTime: 0.62
  },
  cottageAssetWarp: {
    seed: "vanishing-cottage-001",
    assetId: "starter-cottage-001",
    leftVanishingDistance: 18,
    rightVanishingDistance: 28,
    footprintWidth: 4,
    footprintDepth: 4,
    buildingHeight: 4,
    projectionScale: 0.72,
    assetWarpStrength: 0.68,
    showGuides: 1,
    sunTime: 0.62
  },
  workshopAssetWarp: {
    seed: "vanishing-workshop-001",
    assetId: "starter-workshop-001",
    leftVanishingDistance: 18,
    rightVanishingDistance: 28,
    footprintWidth: 4,
    footprintDepth: 4,
    buildingHeight: 4,
    projectionScale: 0.72,
    assetWarpStrength: 0.68,
    showGuides: 1,
    sunTime: 0.62
  },
  herbalistAssetWarp: {
    seed: "vanishing-herbalist-001",
    assetId: "starter-herbalist-001",
    leftVanishingDistance: 18,
    rightVanishingDistance: 28,
    footprintWidth: 4,
    footprintDepth: 4,
    buildingHeight: 4,
    projectionScale: 0.72,
    assetWarpStrength: 0.68,
    showGuides: 1,
    sunTime: 0.62
  }
};

export function normalizeVanishingPointConfig(config = {}) {
  const base = { ...VANISHING_POINT_PRESETS.twoPointCuboid, ...config };
  return {
    ...base,
    leftVanishingDistance: clamp(base.leftVanishingDistance, 8, 120),
    rightVanishingDistance: clamp(base.rightVanishingDistance, 8, 120),
    footprintWidth: clamp(base.footprintWidth, 1.5, 9),
    footprintDepth: clamp(base.footprintDepth, 1.5, 9),
    buildingHeight: clamp(base.buildingHeight, 2, 12),
    projectionScale: clamp(base.projectionScale ?? 0.72, 0.35, 0.9),
    assetWarpStrength: clamp(base.assetWarpStrength ?? 1, 0, 1),
    showGuides: Math.round(clamp(base.showGuides ?? 1, 0, 1)),
    sunTime: clamp(base.sunTime ?? 0.62, 0, 1)
  };
}

export function createTwoPointProjector(config = {}) {
  const leftDistance = Math.max(Number(config.leftVanishingDistance ?? 18), 1e-6);
  const rightDistance = Math.max(Number(config.rightVanishingDistance ?? 28), 1e-6);
  const projectionScale = Math.max(Number(config.projectionScale ?? 0.72), 1e-6);
  const cameraHeight = Number(config.cameraHeight ?? 9);
  const horizonY = Number(config.horizonY ?? 0);
  const focalLength = Math.sqrt(leftDistance * rightDistance);
  const yaw = Math.atan(Math.sqrt(leftDistance / rightDistance));
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const cameraDistance = focalLength / projectionScale;

  return {
    leftDistance,
    rightDistance,
    focalLength,
    yaw,
    cameraDistance,
    cameraHeight,
    horizonY,
    vanishingPoints: {
      left: [-leftDistance, horizonY],
      right: [rightDistance, horizonY],
      vertical: "infinity"
    },
    project(point) {
      const depth = cameraDistance + sinYaw * point.x + cosYaw * point.z;
      if (depth <= 1e-6) throw new Error("Cuboid point crossed the two-point projection camera plane");
      return [
        (focalLength * (cosYaw * point.x - sinYaw * point.z)) / depth,
        horizonY + (focalLength * (point.y - cameraHeight)) / depth,
        depth
      ];
    }
  };
}

export function createAxonometricProjector(config = {}) {
  const projectionScale = Math.max(Number(config.projectionScale ?? 0.72), 1e-6);
  const groundAngle = THREE.MathUtils.degToRad(Number(config.groundAngleDegrees ?? 30));
  const horizontal = Math.cos(groundAngle);
  const vertical = Math.sin(groundAngle);
  return {
    vanishingPoints: { left: "infinity", right: "infinity", vertical: "infinity" },
    project(point) {
      return [
        projectionScale * horizontal * (point.x - point.z),
        projectionScale * (point.y + vertical * (point.x + point.z)),
        1
      ];
    }
  };
}

export function projectCuboidCorners(config = {}, projectorOverride = null) {
  const params = normalizeVanishingPointConfig(config);
  const projector = projectorOverride ?? createTwoPointProjector({
    ...params,
    cameraHeight: params.buildingHeight + 4
  });
  const halfWidth = params.footprintWidth / 2;
  const halfDepth = params.footprintDepth / 2;
  const points = {
    nearLeftBase: { x: -halfWidth, y: 0, z: -halfDepth },
    nearRightBase: { x: halfWidth, y: 0, z: -halfDepth },
    farLeftBase: { x: -halfWidth, y: 0, z: halfDepth },
    farRightBase: { x: halfWidth, y: 0, z: halfDepth },
    nearLeftTop: { x: -halfWidth, y: params.buildingHeight, z: -halfDepth },
    nearRightTop: { x: halfWidth, y: params.buildingHeight, z: -halfDepth },
    farLeftTop: { x: -halfWidth, y: params.buildingHeight, z: halfDepth },
    farRightTop: { x: halfWidth, y: params.buildingHeight, z: halfDepth }
  };
  return Object.fromEntries(Object.entries(points).map(([key, point]) => [key, projector.project(point)]));
}

export function getTwoPointConvergenceDiagnostics(config = {}) {
  const params = normalizeVanishingPointConfig(config);
  const projector = createTwoPointProjector({ ...params, cameraHeight: params.buildingHeight + 4 });
  const corners = projectCuboidCorners(params, projector);
  const rightIntersection = intersectLines(
    corners.nearLeftBase,
    corners.nearRightBase,
    corners.farLeftTop,
    corners.farRightTop
  );
  const leftIntersection = intersectLines(
    corners.nearLeftBase,
    corners.farLeftBase,
    corners.nearRightTop,
    corners.farRightTop
  );
  const verticalDrift = Math.max(
    Math.abs(corners.nearLeftBase[0] - corners.nearLeftTop[0]),
    Math.abs(corners.nearRightBase[0] - corners.nearRightTop[0]),
    Math.abs(corners.farLeftBase[0] - corners.farLeftTop[0]),
    Math.abs(corners.farRightBase[0] - corners.farRightTop[0])
  );
  return {
    leftVanishingPoint: projector.vanishingPoints.left,
    rightVanishingPoint: projector.vanishingPoints.right,
    leftIntersection,
    rightIntersection,
    leftError: distance2(leftIntersection, projector.vanishingPoints.left),
    rightError: distance2(rightIntersection, projector.vanishingPoints.right),
    verticalDrift,
    verticalVanishingPoint: "infinity",
    focalLength: projector.focalLength,
    yawDegrees: THREE.MathUtils.radToDeg(projector.yaw)
  };
}

export async function createVanishingPointWarpLab(config = {}) {
  const params = normalizeVanishingPointConfig(config);
  if (params.assetId) return createAssetVanishingPointWarpLab(params);
  const root = new THREE.Group();
  root.name = "TwoPointVanishingWarpLab";

  const sourceProjector = createAxonometricProjector(params);
  const targetProjector = createTwoPointProjector({
    ...params,
    cameraHeight: params.buildingHeight + 4
  });

  root.add(createCuboidPanel({
    params,
    projector: sourceProjector,
    center: [-7.25, -0.35],
    label: "Source · orthographic",
    detail: "LVP ∞   RVP ∞",
    showGuides: false
  }));
  root.add(createCuboidPanel({
    params,
    projector: targetProjector,
    center: [-2.15, -0.35],
    label: "Warped · two-point",
    detail: `LVP ${formatDistance(params.leftVanishingDistance)}   RVP ${formatDistance(params.rightVanishingDistance)}`,
    showGuides: Boolean(params.showGuides)
  }));

  const diagnostics = getTwoPointConvergenceDiagnostics(params);
  root.userData.config = params;
  root.userData.diagnostics = diagnostics;
  root.userData.contract = getVanishingPointWarpContract(params);
  return root;
}

async function createAssetVanishingPointWarpLab(params) {
  let asset = resolveAsset(params.assetId);
  if (!asset) throw new Error(`Unknown vanishing-warp asset: ${params.assetId}`);
  asset = await hydrateAssetManifest(asset);
  const [colorImage, maskImage, depthImage] = await Promise.all([
    loadImage(asset.maps.rgb),
    loadImage(asset.maps.mask),
    loadImage(asset.maps.depth)
  ]);
  const raster = createAssetRasterData(colorImage, maskImage, depthImage);
  const anchorDepthSamples = Object.fromEntries(Object.entries(asset.baseAnchorsUv).map(([key, uv]) => [key, sampleSupportedDepth(raster, uv, 2)]));
  const reconstructor = createOrthographicDepthReconstructor({
    baseAnchorsUv: asset.baseAnchorsUv,
    dimensions: asset.dimensions,
    camera: asset.guideplate?.camera ?? { yaw: 45, elevation: 55 },
    depthEncoding: asset.depthCalibration,
    anchorDepthSamples
  });
  const targetProjector = createTwoPointProjector({
    ...params,
    cameraHeight: params.buildingHeight + 4
  });
  const target = createWarpedAssetMesh({ asset, params, raster, reconstructor, targetProjector });
  const anchorReconstructionError = measureAnchorReconstructionError(reconstructor, asset.baseAnchorsUv, raster);

  const root = new THREE.Group();
  root.name = `TwoPointAssetWarpLab-${asset.assetId}`;
  root.add(createAssetSourcePanel(raster.colorCanvas, raster.visibleUvBounds, [-7.25, -0.35], asset.assetId));
  root.add(target.group);
  root.userData.config = params;
  root.userData.diagnostics = {
    ...getTwoPointConvergenceDiagnostics(params),
    assetId: asset.assetId,
    anchorReconstructionError,
    localBounds: target.localBounds,
    depthEncoding: reconstructor.depthEncoding
  };
  root.userData.contract = {
    ...getVanishingPointWarpContract(params),
    assetId: asset.assetId,
    sourceMaps: asset.maps,
    reconstruction: "guideplate screen mapping plus directly decoded view-space depth"
  };
  return root;
}

export function createOrthographicDepthReconstructor({ baseAnchorsUv, dimensions, camera, depthEncoding }) {
  const basis = createOrthographicCameraBasis(camera);
  const width = Number(dimensions.length ?? dimensions.width ?? 4);
  const depth = Number(dimensions.width ?? dimensions.length ?? 4);
  const localAnchors = {
    left: { x: -width / 2, y: 0, z: depth / 2 },
    near: { x: width / 2, y: 0, z: depth / 2 },
    right: { x: width / 2, y: 0, z: -depth / 2 }
  };
  const screenAnchors = Object.fromEntries(Object.entries(localAnchors).map(([key, point]) => [key, [dot3(point, basis.right), dot3(point, basis.up)]]));
  const sampleKeys = ["left", "near", "right"];
  if (depthEncoding?.kind !== "global-linear-quantile-fit-v1") {
    throw new Error("Asset warp requires globally fitted view-depth encoding");
  }
  const minimumViewDepth = Number(depthEncoding.encoding?.minimumViewDepth);
  const maximumViewDepth = Number(depthEncoding.encoding?.maximumViewDepth);
  if (!Number.isFinite(minimumViewDepth) || !Number.isFinite(maximumViewDepth) || maximumViewDepth <= minimumViewDepth) {
    throw new Error("Asset warp view-depth encoding range is invalid");
  }
  const viewDepthRange = maximumViewDepth - minimumViewDepth;
  const sourceTriangle = sampleKeys.map((key) => baseAnchorsUv[key]);

  return {
    basis,
    localAnchors,
    screenAnchors,
    depthEncoding: {
      mode: "encoded-view-depth",
      minimumViewDepth,
      maximumViewDepth,
      spatialCorrection: "none",
      sourceFit: depthEncoding
    },
    decodeViewDepth(encodedDepth) {
      return minimumViewDepth + clamp(encodedDepth, 0, 1) * viewDepthRange;
    },
    reconstruct(uv, encodedDepth) {
      const screen = mapTrianglePoint(uv, sourceTriangle, sampleKeys.map((key) => screenAnchors[key]));
      const viewDepth = minimumViewDepth + clamp(encodedDepth, 0, 1) * viewDepthRange;
      return add3(
        scale3(basis.right, screen[0]),
        add3(scale3(basis.up, screen[1]), scale3(basis.view, viewDepth))
      );
    }
  };
}

function measureAnchorReconstructionError(reconstructor, baseAnchorsUv, raster) {
  return Math.max(...Object.keys(reconstructor.localAnchors).map((key) => {
    const encodedDepth = sampleSupportedDepth(raster, baseAnchorsUv[key], 2);
    return distance3(reconstructor.reconstruct(baseAnchorsUv[key], encodedDepth), reconstructor.localAnchors[key]);
  }));
}

async function hydrateAssetManifest(asset) {
  if (!asset.manifestPath || typeof fetch !== "function") return asset;
  try {
    const response = await fetch(asset.manifestPath);
    if (!response.ok) return asset;
    const manifest = await response.json();
    const separator = asset.manifestPath.lastIndexOf("/");
    const root = separator >= 0 ? asset.manifestPath.slice(0, separator + 1) : "";
    const maps = { ...asset.maps };
    for (const [key, value] of Object.entries(manifest.maps ?? {})) {
      if (typeof value === "string" && ["rgb", "mask", "depth", "normal"].includes(key)) maps[key] = `${root}${value}`;
    }
    return {
      ...asset,
      dimensions: manifest.dimensions ?? asset.dimensions,
      baseAnchorsUv: manifest.baseAnchorsUv ?? asset.baseAnchorsUv,
      depthCalibration: manifest.depthCalibration ?? null,
      maps
    };
  } catch {
    return asset;
  }
}

function createOrthographicCameraBasis(camera = {}) {
  const yaw = THREE.MathUtils.degToRad(Number(camera.yaw ?? 45));
  const elevation = THREE.MathUtils.degToRad(Number(camera.elevation ?? 55));
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);
  return {
    right: { x: cosYaw, y: 0, z: -sinYaw },
    up: { x: -sinElevation * sinYaw, y: cosElevation, z: -sinElevation * cosYaw },
    view: { x: cosElevation * sinYaw, y: sinElevation, z: cosElevation * cosYaw }
  };
}

function createWarpedAssetMesh({ asset, params, raster, reconstructor, targetProjector }) {
  const vertices = [];
  const visibleProjected = [];
  const visibleSourceUv = [];
  const localVisible = [];
  const segments = ASSET_WARP_SUBDIVISIONS;
  const nativeWidth = Number(asset.dimensions.length ?? 4);
  const nativeDepth = Number(asset.dimensions.width ?? 4);
  const nativeHeight = Number(asset.dimensions.height ?? 4);
  const scale = {
    x: params.footprintWidth / nativeWidth,
    y: params.buildingHeight / nativeHeight,
    z: params.footprintDepth / nativeDepth
  };
  for (let row = 0; row <= segments; row += 1) {
    for (let column = 0; column <= segments; column += 1) {
      const uv = [column / segments, row / segments];
      const encodedDepth = sampleSupportedDepth(raster, uv, 8);
      const mask = sampleRaster(raster.mask, raster.width, raster.height, uv);
      const support = sampleMaskSupport(raster, uv, 8);
      const reconstructed = reconstructor.reconstruct(uv, encodedDepth);
      const clamped = {
        x: clamp(reconstructed.x, -nativeWidth * 0.7, nativeWidth * 0.7),
        y: clamp(reconstructed.y, -nativeHeight * 0.08, nativeHeight * 1.32),
        z: clamp(reconstructed.z, -nativeDepth * 0.7, nativeDepth * 0.7)
      };
      const local = { x: clamped.x * scale.x, y: clamped.y * scale.y, z: clamped.z * scale.z };
      const projected = targetProjector.project(local);
      const vertex = { uv, mask, support, encodedDepth, local, projected };
      vertices.push(vertex);
      if (mask > 0.08) {
        visibleProjected.push(projected);
        visibleSourceUv.push(uv);
        localVisible.push([local.x, local.y, local.z]);
      }
    }
  }
  const transform = createPanelTransformFromPoints(visibleProjected, [-2.15, -0.35], 4.65, 5.55);
  const sourceTransform = createPanelTransformFromPoints(visibleSourceUv, [-2.15, -0.35], 4.65, 5.55);
  const positions = [];
  const uvs = [];
  const displayedVisible = [];
  vertices.forEach(({ uv, mask, projected }) => {
    const projectedDisplay = applyPanelTransform(projected, transform);
    const sourceDisplay = applyPanelTransform(uv, sourceTransform);
    const display = lerp2(sourceDisplay, projectedDisplay, params.assetWarpStrength);
    positions.push(display[0], display[1], 0.08 - projected[2] * 0.001);
    uvs.push(...uv);
    if (mask > 0.08) displayedVisible.push(display);
  });
  const indices = [];
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const northwest = row * (segments + 1) + column;
      const northeast = northwest + 1;
      const southwest = northwest + segments + 1;
      const southeast = southwest + 1;
      const quad = [vertices[northwest], vertices[northeast], vertices[southwest], vertices[southeast]];
      if (!isContinuousAssetQuad(quad)) continue;
      indices.push(northwest, northeast, southeast, northwest, southeast, southwest);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const texture = createCanvasTexture(raster.colorCanvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.06,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${asset.assetId}-DepthReprojectedMesh`;
  mesh.renderOrder = 4;

  const group = new THREE.Group();
  group.add(mesh);
  if (params.showGuides) group.add(createVanishingGuides(createCuboidWorldCorners(params), targetProjector, transform));
  const bounds = getBounds(displayedVisible);
  group.add(createTextSprite("Warped · production asset", [-2.15, bounds.maxY + 0.72], 4.4, 0.58, "#5f3279", 37));
  group.add(createTextSprite(`${asset.assetId}   LVP ${formatDistance(params.leftVanishingDistance)}   RVP ${formatDistance(params.rightVanishingDistance)}`, [-2.15, bounds.minY - 0.56], 5.2, 0.48, "#8b5ca3", 27));
  return { group, localBounds: getBounds3(localVisible), transform, sourceTransform };
}

function isContinuousAssetQuad(vertices) {
  if (vertices.some((vertex) => vertex.support <= 0.02)) return false;
  const localEdges = [
    [vertices[0].local, vertices[1].local],
    [vertices[0].local, vertices[2].local],
    [vertices[1].local, vertices[3].local],
    [vertices[2].local, vertices[3].local]
  ];
  return localEdges.every(([from, to]) => distance3(from, to) < 0.78);
}

function createAssetSourcePanel(colorCanvas, uvBounds, center, assetId) {
  const texture = createCanvasTexture(colorCanvas);
  const cropAspect = ((uvBounds.uMax - uvBounds.uMin) * colorCanvas.width) / Math.max((uvBounds.vMax - uvBounds.vMin) * colorCanvas.height, 1e-6);
  let width = 4.65;
  let height = width / Math.max(cropAspect, 1e-6);
  if (height > 5.55) {
    height = 5.55;
    width = height * cropAspect;
  }
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const positions = [
    center[0] - halfWidth, center[1] - halfHeight, 0.08,
    center[0] + halfWidth, center[1] - halfHeight, 0.08,
    center[0] + halfWidth, center[1] + halfHeight, 0.08,
    center[0] - halfWidth, center[1] + halfHeight, 0.08
  ];
  const uvs = [uvBounds.uMin, uvBounds.vMin, uvBounds.uMax, uvBounds.vMin, uvBounds.uMax, uvBounds.vMax, uvBounds.uMin, uvBounds.vMax];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.06, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3;
  const group = new THREE.Group();
  group.add(mesh);
  group.add(createTextSprite("Source · orthographic asset", [center[0], center[1] + halfHeight + 0.72], 4.4, 0.58, "#5f3279", 37));
  group.add(createTextSprite(`${assetId}   LVP ∞   RVP ∞`, [center[0], center[1] - halfHeight - 0.56], 4.8, 0.48, "#8b5ca3", 27));
  return group;
}

function createAssetRasterData(colorImage, maskImage, depthImage) {
  const width = colorImage.naturalWidth || colorImage.width;
  const height = colorImage.naturalHeight || colorImage.height;
  if (maskImage.width !== width || maskImage.height !== height || depthImage.width !== width || depthImage.height !== height) {
    throw new Error("Asset color, mask, and depth maps must share one resolution");
  }
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
  colorContext.drawImage(colorImage, 0, 0, width, height);
  const colorData = colorContext.getImageData(0, 0, width, height);
  const maskData = readImagePixels(maskImage, width, height);
  const depthData = readImagePixels(depthImage, width, height);
  const mask = new Float32Array(width * height);
  const depth = new Float32Array(width * height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const maskValue = ((maskData[offset] + maskData[offset + 1] + maskData[offset + 2]) / (3 * 255)) * (maskData[offset + 3] / 255);
    const depthValue = (depthData[offset] + depthData[offset + 1] + depthData[offset + 2]) / (3 * 255);
    mask[index] = maskValue;
    depth[index] = depthValue;
    colorData.data[offset + 3] = Math.round(colorData.data[offset + 3] * maskValue);
    if (maskValue > 0.08) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  colorContext.putImageData(colorData, 0, 0);
  const visibleUvBounds = maxX >= minX
    ? { uMin: minX / width, uMax: (maxX + 1) / width, vMin: 1 - (maxY + 1) / height, vMax: 1 - minY / height }
    : { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };
  return { width, height, colorCanvas, mask, depth, visibleUvBounds };
}

function readImagePixels(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function sampleRaster(data, width, height, uv) {
  const x = clamp(Math.round(uv[0] * (width - 1)), 0, width - 1);
  const y = clamp(Math.round((1 - uv[1]) * (height - 1)), 0, height - 1);
  return data[y * width + x];
}

function sampleSupportedDepth(raster, uv, radius) {
  const centerX = clamp(Math.round(uv[0] * (raster.width - 1)), 0, raster.width - 1);
  const centerY = clamp(Math.round((1 - uv[1]) * (raster.height - 1)), 0, raster.height - 1);
  let weightedDepth = 0;
  let totalWeight = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = clamp(centerX + offsetX, 0, raster.width - 1);
      const y = clamp(centerY + offsetY, 0, raster.height - 1);
      const index = y * raster.width + x;
      const distanceWeight = 1 / (1 + Math.hypot(offsetX, offsetY));
      const weight = raster.mask[index] * distanceWeight;
      weightedDepth += raster.depth[index] * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 1e-8 ? weightedDepth / totalWeight : raster.depth[centerY * raster.width + centerX];
}

function sampleMaskSupport(raster, uv, radius) {
  const centerX = clamp(Math.round(uv[0] * (raster.width - 1)), 0, raster.width - 1);
  const centerY = clamp(Math.round((1 - uv[1]) * (raster.height - 1)), 0, raster.height - 1);
  let support = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const x = clamp(centerX + offsetX, 0, raster.width - 1);
      const y = clamp(centerY + offsetY, 0, raster.height - 1);
      support = Math.max(support, raster.mask[y * raster.width + x]);
    }
  }
  return support;
}

function createCanvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load asset map: ${path}`));
    image.src = path;
  });
}

export function getVanishingPointWarpContract(config = {}) {
  const params = normalizeVanishingPointConfig(config);
  const diagnostics = getTwoPointConvergenceDiagnostics(params);
  return {
    id: "two-point-vanishing-warp-v1",
    sourceProjection: {
      xAxisVanishingPoint: "infinity",
      zAxisVanishingPoint: "infinity",
      verticalVanishingPoint: "infinity"
    },
    targetProjection: {
      leftVanishingDistance: params.leftVanishingDistance,
      rightVanishingDistance: params.rightVanishingDistance,
      verticalVanishingPoint: "infinity",
      focalLength: diagnostics.focalLength,
      yawDegrees: diagnostics.yawDegrees
    },
    dimensions: {
      width: params.footprintWidth,
      depth: params.footprintDepth,
      height: params.buildingHeight
    },
    assetMapping: "Reconstruct local width-depth-height coordinates from the procedural guideplate and depth map, then reproject those coordinates through the same two-point camera.",
    guarantees: [
      "Both horizontal direction families converge exactly to their configured vanishing points.",
      "Vertical asset lines stay parallel and upright.",
      "Footprint width and depth are independent local-space dimensions rather than screen-space stretch factors."
    ]
  };
}

function createCuboidPanel({ params, projector, center, label, detail, showGuides }) {
  const panel = new THREE.Group();
  panel.name = label;
  const corners = createCuboidWorldCorners(params);
  const projected = Object.fromEntries(Object.entries(corners).map(([key, point]) => [key, projector.project(point)]));
  const transform = createPanelTransform(projected, center, 4.65, 5.55);
  const textures = createCuboidTextures();

  panel.add(createWarpedFace({
    origin: corners.nearLeftBase,
    axisU: subtract3(corners.nearRightBase, corners.nearLeftBase),
    axisV: subtract3(corners.nearLeftTop, corners.nearLeftBase),
    projector,
    transform,
    texture: textures.front,
    renderOrder: 2
  }));
  panel.add(createWarpedFace({
    origin: corners.nearLeftBase,
    axisU: subtract3(corners.farLeftBase, corners.nearLeftBase),
    axisV: subtract3(corners.nearLeftTop, corners.nearLeftBase),
    projector,
    transform,
    texture: textures.side,
    renderOrder: 1
  }));
  panel.add(createWarpedFace({
    origin: corners.nearLeftTop,
    axisU: subtract3(corners.nearRightTop, corners.nearLeftTop),
    axisV: subtract3(corners.farLeftTop, corners.nearLeftTop),
    projector,
    transform,
    texture: textures.roof,
    renderOrder: 3
  }));
  panel.add(createCuboidOutline(corners, projector, transform));
  if (showGuides) panel.add(createVanishingGuides(corners, projector, transform));

  const bounds = getTransformedBounds(projected, transform);
  panel.add(createTextSprite(label, [center[0], bounds.maxY + 0.72], 3.5, 0.58, "#5f3279", 39));
  panel.add(createTextSprite(detail, [center[0], bounds.minY - 0.56], 3.9, 0.48, "#8b5ca3", 31));
  return panel;
}

function createCuboidWorldCorners(params) {
  const halfWidth = params.footprintWidth / 2;
  const halfDepth = params.footprintDepth / 2;
  const height = params.buildingHeight;
  return {
    nearLeftBase: { x: -halfWidth, y: 0, z: -halfDepth },
    nearRightBase: { x: halfWidth, y: 0, z: -halfDepth },
    farLeftBase: { x: -halfWidth, y: 0, z: halfDepth },
    farRightBase: { x: halfWidth, y: 0, z: halfDepth },
    nearLeftTop: { x: -halfWidth, y: height, z: -halfDepth },
    nearRightTop: { x: halfWidth, y: height, z: -halfDepth },
    farLeftTop: { x: -halfWidth, y: height, z: halfDepth },
    farRightTop: { x: halfWidth, y: height, z: halfDepth }
  };
}

function createWarpedFace({ origin, axisU, axisV, projector, transform, texture, renderOrder }) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const segments = FACE_SUBDIVISIONS;
  for (let row = 0; row <= segments; row += 1) {
    for (let column = 0; column <= segments; column += 1) {
      const u = column / segments;
      const v = row / segments;
      const point = add3(origin, add3(scale3(axisU, u), scale3(axisV, v)));
      const projected = applyPanelTransform(projector.project(point), transform);
      positions.push(projected[0], projected[1], renderOrder * 0.002);
      uvs.push(u, v);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const northwest = row * (segments + 1) + column;
      const northeast = northwest + 1;
      const southwest = northwest + segments + 1;
      const southeast = southwest + 1;
      indices.push(northwest, northeast, southeast, northwest, southeast, southwest);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  return mesh;
}

function createCuboidOutline(corners, projector, transform) {
  const edges = [
    ["nearLeftBase", "nearRightBase"], ["nearRightBase", "nearRightTop"], ["nearRightTop", "nearLeftTop"], ["nearLeftTop", "nearLeftBase"],
    ["nearLeftBase", "farLeftBase"], ["farLeftBase", "farLeftTop"], ["farLeftTop", "nearLeftTop"],
    ["nearRightTop", "farRightTop"], ["farRightTop", "farLeftTop"]
  ];
  const positions = [];
  edges.forEach(([fromKey, toKey]) => {
    const from = applyPanelTransform(projector.project(corners[fromKey]), transform);
    const to = applyPanelTransform(projector.project(corners[toKey]), transform);
    positions.push(from[0], from[1], 0.012, to[0], to[1], 0.012);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#422653", depthTest: false, transparent: true, opacity: 0.92 }));
  lines.renderOrder = 8;
  return lines;
}

function createVanishingGuides(corners, projector, transform) {
  const group = new THREE.Group();
  const families = [
    { color: "#f09252", vanishingPoint: projector.vanishingPoints.right, starts: ["nearLeftTop", "farLeftTop"], ends: ["nearRightTop", "farRightTop"] },
    { color: "#50a3a2", vanishingPoint: projector.vanishingPoints.left, starts: ["nearLeftTop", "nearRightTop"], ends: ["farLeftTop", "farRightTop"] }
  ];
  families.forEach(({ color, vanishingPoint, starts, ends }) => {
    starts.forEach((startKey, index) => {
      const start = applyPanelTransform(projector.project(corners[startKey]), transform);
      const edgeEnd = applyPanelTransform(projector.project(corners[ends[index]]), transform);
      const vp = applyPanelTransform(vanishingPoint, transform);
      const rayEnd = extendToward(edgeEnd, vp, 2.25);
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(start[0], start[1], 0.018),
        new THREE.Vector3(rayEnd[0], rayEnd[1], 0.018)
      ]);
      const material = new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8, depthTest: false });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 9;
      group.add(line);
    });
  });
  return group;
}

function createCuboidTextures() {
  return {
    front: createPatternTexture("front"),
    side: createPatternTexture("side"),
    roof: createPatternTexture("roof")
  };
}

function createPatternTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const palette = kind === "front"
    ? { base: "#cb684f", line: "#8f4238", accent: "#8bd4cd" }
    : kind === "side"
      ? { base: "#df8460", line: "#a65343", accent: "#f5d38b" }
      : { base: "#4c5265", line: "#313647", accent: "#737b91" };
  context.fillStyle = palette.base;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = palette.line;
  context.lineWidth = 5;
  const spacing = kind === "roof" ? 32 : 42;
  for (let x = 0; x <= 256; x += spacing) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 256);
    context.stroke();
  }
  for (let y = 0; y <= 256; y += spacing) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(256, y);
    context.stroke();
  }
  if (kind !== "roof") {
    context.fillStyle = palette.accent;
    context.strokeStyle = "#f7ead2";
    context.lineWidth = 8;
    [[42, 68], [150, 68], [42, 164], [150, 164]].forEach(([x, y]) => {
      context.fillRect(x, y, 64, 58);
      context.strokeRect(x, y, 64, 58);
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function createTextSprite(text, position, width, height, color, fontSize) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(position[0], position[1], 0.04);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function createPanelTransform(projected, center, targetWidth, targetHeight) {
  const bounds = getBounds(Object.values(projected));
  const scale = Math.min(targetWidth / Math.max(bounds.width, 1e-6), targetHeight / Math.max(bounds.height, 1e-6));
  return {
    scale,
    offsetX: center[0] - (bounds.minX + bounds.maxX) * 0.5 * scale,
    offsetY: center[1] - (bounds.minY + bounds.maxY) * 0.5 * scale
  };
}

function createPanelTransformFromPoints(points, center, targetWidth, targetHeight) {
  const bounds = getBounds(points);
  const scale = Math.min(targetWidth / Math.max(bounds.width, 1e-6), targetHeight / Math.max(bounds.height, 1e-6));
  return {
    scale,
    offsetX: center[0] - (bounds.minX + bounds.maxX) * 0.5 * scale,
    offsetY: center[1] - (bounds.minY + bounds.maxY) * 0.5 * scale
  };
}

function applyPanelTransform(point, transform) {
  return [point[0] * transform.scale + transform.offsetX, point[1] * transform.scale + transform.offsetY];
}

function getTransformedBounds(projected, transform) {
  return getBounds(Object.values(projected).map((point) => applyPanelTransform(point, transform)));
}

function getBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function getBounds3(points) {
  if (!points.length) return null;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const zs = points.map((point) => point[2]);
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)]
  };
}

function mapTrianglePoint(point, sourceTriangle, targetTriangle) {
  const weights = triangleWeights(point, sourceTriangle);
  return [0, 1].map((axis) => weights.reduce((sum, weight, index) => sum + weight * targetTriangle[index][axis], 0));
}

function mapTriangleScalar(point, sourceTriangle, targetValues) {
  const weights = triangleWeights(point, sourceTriangle);
  return weights.reduce((sum, weight, index) => sum + weight * targetValues[index], 0);
}

function triangleWeights(point, triangle) {
  const [a, b, c] = triangle;
  const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) < 1e-12) throw new Error("Asset guideplate anchors must form a non-degenerate triangle");
  const wa = ((b[1] - c[1]) * (point[0] - c[0]) + (c[0] - b[0]) * (point[1] - c[1])) / denominator;
  const wb = ((c[1] - a[1]) * (point[0] - c[0]) + (a[0] - c[0]) * (point[1] - c[1])) / denominator;
  return [wa, wb, 1 - wa - wb];
}

function intersectLines(a, b, c, d) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const cd = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross2(ab, cd);
  if (Math.abs(denominator) < 1e-12) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const ac = [c[0] - a[0], c[1] - a[1]];
  const t = cross2(ac, cd) / denominator;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}

function extendToward(from, target, maxLength) {
  const direction = [target[0] - from[0], target[1] - from[1]];
  const length = Math.hypot(...direction);
  if (length <= maxLength) return target;
  return [from[0] + direction[0] * maxLength / length, from[1] + direction[1] * maxLength / length];
}

function lerp2(from, to, amount) {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount
  ];
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function subtract3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale3(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function cross2(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function distance2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function formatDistance(value) {
  return Number(value).toFixed(0);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}
