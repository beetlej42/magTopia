import "./voxelVirtualBevelGlint.js";

const DEFAULT_STRENGTH = 0.32;

export function voxelVertexAmbientOcclusion(sideA, sideB, corner, strength = DEFAULT_STRENGTH) {
  const occlusionLevel = sideA && sideB
    ? 3
    : Number(Boolean(sideA)) + Number(Boolean(sideB)) + Number(Boolean(corner));
  const normalizedStrength = clamp(Number(strength) || 0, 0, 1);
  return 1 - normalizedStrength * (occlusionLevel / 3);
}

export function sampleVoxelVertexAmbientOcclusion({
  face,
  plane,
  u,
  v,
  width,
  height,
  cornerU,
  cornerV,
  hasVoxel,
  strength = DEFAULT_STRENGTH
}) {
  const normalDirection = face.normal[face.axis];
  const uDirection = cornerU === u ? -1 : 1;
  const vDirection = cornerV === v ? -1 : 1;
  const inside = [0, 0, 0];
  inside[face.axis] = plane - (normalDirection > 0 ? 1 : 0);
  inside[face.uAxis] = cornerU === u ? u : u + width - 1;
  inside[face.vAxis] = cornerV === v ? v : v + height - 1;

  const outside = [...inside];
  outside[face.axis] += normalDirection;
  const sideA = [...outside];
  sideA[face.uAxis] += uDirection;
  const sideB = [...outside];
  sideB[face.vAxis] += vDirection;
  const diagonal = [...sideA];
  diagonal[face.vAxis] += vDirection;

  return voxelVertexAmbientOcclusion(
    hasVoxel(...sideA),
    hasVoxel(...sideB),
    hasVoxel(...diagonal),
    strength
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
