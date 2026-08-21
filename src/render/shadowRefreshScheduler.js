const DEFAULT_VOXEL_SIZE = 0.125;
const DEFAULT_SHADOW_FOOTPRINT_RADIUS = 16;
const DEFAULT_DIRECTION_THRESHOLD_DEGREES = 0.05;

export function calculateShadowViewExtent({
  perspective = true,
  fovDegrees = 40,
  cameraDistance = 58,
  aspect = 1,
  orthographicWidth = 0,
  orthographicHeight = 0,
  padding = 8,
  minimumExtent = 18,
  maximumExtent = 180
} = {}) {
  const resolvedAspect = positiveNumber(aspect, 1);
  const visibleHeight = perspective
    ? 2 * positiveNumber(cameraDistance, 58) * Math.tan(degreesToRadians(clamp(positiveNumber(fovDegrees, 40), 1, 179)) * 0.5)
    : positiveNumber(orthographicHeight, 1);
  const visibleWidth = perspective
    ? visibleHeight * resolvedAspect
    : positiveNumber(orthographicWidth, visibleHeight * resolvedAspect);
  const extent = clamp(
    Math.max(visibleWidth, visibleHeight) * 0.5 + Math.max(0, Number(padding) || 0),
    positiveNumber(minimumExtent, 18),
    positiveNumber(maximumExtent, 180)
  );
  return { extent, visibleWidth, visibleHeight };
}

export function calculateSurfaceShadowRefreshThreshold({
  viewportHeight,
  renderScale,
  fovDegrees,
  cameraDistance,
  cameraScale = 1,
  voxelSize = DEFAULT_VOXEL_SIZE,
  shadowFootprintRadius = DEFAULT_SHADOW_FOOTPRINT_RADIUS
} = {}) {
  const height = positiveNumber(viewportHeight, 1);
  const scale = positiveNumber(renderScale, 1);
  const fov = clamp(positiveNumber(fovDegrees, 40), 1, 179);
  const distance = positiveNumber(cameraDistance, 58) * positiveNumber(cameraScale, 1);
  const voxel = positiveNumber(voxelSize, DEFAULT_VOXEL_SIZE);
  const footprintRadius = positiveNumber(shadowFootprintRadius, DEFAULT_SHADOW_FOOTPRINT_RADIUS);

  // One rendered pixel is stricter in the near view, while one quarter voxel
  // caps the far-view tolerance. The footprint radius is deliberately larger
  // than the shadow camera's half-width so the angular approximation remains
  // conservative at the corners of the light-space projection.
  const renderPixelWorldSize = 2 * distance * Math.tan(degreesToRadians(fov) * 0.5) / (height * scale);
  const voxelDisplacementLimit = voxel * 0.25;
  const allowedWorldDisplacement = Math.min(renderPixelWorldSize, voxelDisplacementLimit);
  const chordRatio = clamp(allowedWorldDisplacement / (2 * footprintRadius), 0, 1);
  const thresholdRadians = 2 * Math.asin(chordRatio);
  const thresholdDegrees = thresholdRadians * 180 / Math.PI;

  return {
    thresholdDegrees,
    thresholdCosine: Math.cos(thresholdRadians),
    allowedWorldDisplacement,
    renderPixelWorldSize,
    voxelDisplacementLimit,
    shadowFootprintRadius: footprintRadius
  };
}

export function defaultShadowRefreshThreshold() {
  const thresholdRadians = degreesToRadians(DEFAULT_DIRECTION_THRESHOLD_DEGREES);
  return {
    thresholdDegrees: DEFAULT_DIRECTION_THRESHOLD_DEGREES,
    thresholdCosine: Math.cos(thresholdRadians),
    allowedWorldDisplacement: null,
    renderPixelWorldSize: null,
    voxelDisplacementLimit: null,
    shadowFootprintRadius: null
  };
}

export function shadowDirectionExceedsThreshold(dotProduct, thresholdCosine) {
  if (!Number.isFinite(dotProduct) || !Number.isFinite(thresholdCosine)) return true;
  return clamp(dotProduct, -1, 1) < thresholdCosine;
}

export function shouldCommitShadowRefresh({
  pending = false,
  urgent = false,
  surfaceWorld = false,
  cameraInMotion = false,
  nowMs = 0,
  lastCommittedAtMs = Number.NEGATIVE_INFINITY,
  minIntervalMs = 0
} = {}) {
  if (!pending) return false;
  if (urgent) return true;
  if (surfaceWorld && cameraInMotion) return false;
  return Number(nowMs) - Number(lastCommittedAtMs) >= Math.max(0, Number(minIntervalMs) || 0);
}

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
