export const DISTRICT_ROTATION_STEP_DEGREES = 90;

export function normalizeYawDegrees(value) {
  const normalized = Number(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function unwrapAngleDegrees(previousValue, nextValue) {
  if (!Number.isFinite(previousValue)) return Number(nextValue);
  const delta = ((Number(nextValue) - previousValue + 540) % 360) - 180;
  return previousValue + delta;
}

export function nextClockwiseDistrictRotation({ quarterTurn = 0, targetYawDegrees = 45 } = {}) {
  return {
    quarterTurn: (Math.trunc(quarterTurn) + 1) % 4,
    // Moving the camera counter-clockwise makes the world turn clockwise on screen.
    targetYawDegrees: Number(targetYawDegrees) - DISTRICT_ROTATION_STEP_DEGREES
  };
}

export function approachDistrictYaw(currentYawDegrees, targetYawDegrees, delta, options = {}) {
  const current = Number(currentYawDegrees);
  const target = Number(targetYawDegrees);
  if (options.reducedMotion) return target;

  const alpha = 1 - Math.exp(-Math.max(0, Number(delta) || 0) * (options.rate ?? 7));
  const next = current + (target - current) * alpha;
  return Math.abs(next - target) < (options.snapThreshold ?? 0.01) ? target : next;
}
