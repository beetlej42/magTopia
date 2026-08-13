export function getVoxelLodThresholds({ viewMode = "near", qualityScale = 1 } = {}) {
  const scale = Math.max(0.8, Math.min(1.5, Number(qualityScale) || 1));
  const farView = viewMode === "far";
  return {
    nearVoxelPx: (farView ? 1.25 : 1.5) * scale,
    mediumVoxelPx: (farView ? 0.42 : 0.55) * scale,
    nearDiameterPx: 84 * scale,
    mediumDiameterPx: 30 * scale
  };
}

export function selectScreenSpaceVoxelLod(currentLevel, metrics, {
  hysteresis = 0.08,
  thresholds = getVoxelLodThresholds()
} = {}) {
  if (!metrics.visibleInFrustum) return 3;
  const projectedVoxelPx = metrics.projectedVoxelPx;
  const projectedDiameterPx = metrics.projectedDiameterPx;
  const forceNear = projectedDiameterPx >= thresholds.nearDiameterPx;
  const preserveMedium = projectedDiameterPx >= thresholds.mediumDiameterPx;

  if (forceNear) return 0;
  if (currentLevel == null || currentLevel === 3) {
    if (projectedVoxelPx >= thresholds.nearVoxelPx) return 0;
    if (preserveMedium || projectedVoxelPx >= thresholds.mediumVoxelPx) return 1;
    return 2;
  }
  if (currentLevel === 0) {
    if (projectedVoxelPx >= thresholds.nearVoxelPx * (1 - hysteresis)) return 0;
    return preserveMedium || projectedVoxelPx >= thresholds.mediumVoxelPx ? 1 : 2;
  }
  if (currentLevel === 1) {
    if (projectedVoxelPx > thresholds.nearVoxelPx * (1 + hysteresis)) return 0;
    if (preserveMedium || projectedVoxelPx >= thresholds.mediumVoxelPx * (1 - hysteresis)) return 1;
    return 2;
  }
  if (projectedVoxelPx > thresholds.nearVoxelPx * (1 + hysteresis)) return 0;
  if (preserveMedium || projectedVoxelPx > thresholds.mediumVoxelPx * (1 + hysteresis)) return 1;
  return 2;
}
