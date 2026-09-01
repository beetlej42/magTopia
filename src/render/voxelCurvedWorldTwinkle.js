const VOXEL_FACET_HIGHLIGHT_QUERY_PARAM = "facetHighlight";
const VOXEL_GLINT_QUERY_PARAM = "voxelGlint";
const VOXEL_FACET_STRENGTH_QUERY_PARAM = "facetStrength";
const VOXEL_GLINT_STRENGTH_QUERY_PARAM = "glintStrength";
const VOXEL_CELL_SIZE = 0.125;
const VOXEL_FACET_HIGHLIGHT_MODES = new Set(["facet", "glint", "combined"]);
const DEFAULT_FACET_STRENGTH = 1.15;
const DEFAULT_GLINT_STRENGTH = 1.0;
export const VOXEL_FACET_DECLARATIONS_MARKER = "/* voxel-facet-declarations-end */";

function queryScalar(name, fallback, minimum = 0, maximum = 2) {
  if (typeof globalThis.location?.search !== "string") return fallback;
  const raw = new URLSearchParams(globalThis.location.search).get(name);
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function queryFacetHighlightMode() {
  if (typeof globalThis.location?.search === "string") {
    const params = new URLSearchParams(globalThis.location.search);
    const requested = params.get(VOXEL_FACET_HIGHLIGHT_QUERY_PARAM);
    if (VOXEL_FACET_HIGHLIGHT_MODES.has(requested)) return requested;
    const legacyGlint = params.get(VOXEL_GLINT_QUERY_PARAM);
    if (legacyGlint === "0" || legacyGlint === "false" || legacyGlint === "off") return "facet";
    if (legacyGlint === "1" || legacyGlint === "true" || legacyGlint === "on") return "glint";
  }
  return "combined";
}

export function getVoxelFacetHighlightMode() {
  return queryFacetHighlightMode();
}

export function isVoxelFacetHighlightMode(value) {
  return VOXEL_FACET_HIGHLIGHT_MODES.has(String(value));
}

export function applyVoxelCurvedWorldTwinkle(material, {
  surfaceKind = 0,
  useSurfaceKindAttribute = false
} = {}) {
  if (!material || material.userData?.voxelFacetHighlight) return material;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  const resolvedKind = Number(surfaceKind) || 0;
  const usesKindAttribute = Boolean(useSurfaceKindAttribute);
  const mode = queryFacetHighlightMode();
  const facetStrength = queryScalar(VOXEL_FACET_STRENGTH_QUERY_PARAM, DEFAULT_FACET_STRENGTH);
  const glintStrength = queryScalar(VOXEL_GLINT_STRENGTH_QUERY_PARAM, DEFAULT_GLINT_STRENGTH);

  material.userData.voxelCurvedWorldTwinkle = {
    version: "curved-world-twinkle-v5.1",
    surfaceKind: resolvedKind,
    useSurfaceKindAttribute: usesKindAttribute,
    mode,
    facetStrength,
    glintStrength,
    note: "virtual voxel height field for hard surfaces; continuous facet normal and sparse static highlights for water/glass"
  };
  material.userData.voxelFacetHighlight = {
    version: "voxel-facet-highlight-v2",
    surfaceKind: resolvedKind,
    mode,
    voxelCellSize: VOXEL_CELL_SIZE,
    facetStrength,
    glintStrength
  };

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.uniforms.voxelFacetSurfaceKind = { value: resolvedKind };
    shader.uniforms.voxelFacetCellSize = { value: VOXEL_CELL_SIZE };
    shader.uniforms.voxelFacetStrength = { value: facetStrength };
    shader.uniforms.voxelGlintStrength = { value: glintStrength };

    const kindSource = usesKindAttribute
      ? "attribute float voxelSurfaceKind;"
      : "uniform float voxelFacetSurfaceKind;";
    const kindAssignment = usesKindAttribute ? "voxelSurfaceKind" : "voxelFacetSurfaceKind";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${kindSource}\nvarying float vVoxelSurfaceKind;\nvarying vec3 vVoxelWorldPosition;\nvarying vec3 vVoxelWorldNormal;\nvarying vec3 vVoxelViewNormal;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\nvVoxelSurfaceKind = ${kindAssignment};\nvVoxelWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvVoxelWorldNormal = normalize(mat3(modelMatrix) * objectNormal);\nvVoxelViewNormal = normalize(normalMatrix * objectNormal);`
      );

    const facetInjection = `#include <normal_fragment_maps>
  // Water/glass retain a deterministic continuous facet normal per world-space cell.
  // Hard surfaces use the virtual height field below; neither path adds geometry.
  vec3 voxelFacetBaseNormal = normalize(vVoxelViewNormal);
  vec3 voxelFacetAxis = abs(normalize(vVoxelWorldNormal));
  // Water keeps a continuous resin-like surface: use a low-frequency grid while
  // glass/water retain their existing continuous facet path below.
  float voxelFacetCoordinateScale = (vVoxelSurfaceKind > 6.5 && vVoxelSurfaceKind < 7.5) ? 0.30 : 1.0;
  // Rebuild a stable voxel id/local coordinate from world position. This remains
  // valid for greedy faces because it is evaluated per fragment, not per vertex.
  vec3 voxelWorldGrid = vVoxelWorldPosition / max(voxelFacetCellSize, 0.0001);
  vec3 voxelCoord = floor(voxelWorldGrid);
  vec3 voxelLocal3 = fract(voxelWorldGrid);
  vec2 voxelFacetVoxelCoord;
  vec2 voxelFacetVoxelLocal;
  if (voxelFacetAxis.y > voxelFacetAxis.x && voxelFacetAxis.y > voxelFacetAxis.z) {
    voxelFacetVoxelCoord = voxelCoord.xz;
    voxelFacetVoxelLocal = voxelLocal3.xz;
  } else if (voxelFacetAxis.x > voxelFacetAxis.z) {
    voxelFacetVoxelCoord = voxelCoord.zy;
    voxelFacetVoxelLocal = voxelLocal3.zy;
  } else {
    voxelFacetVoxelCoord = voxelCoord.xy;
    voxelFacetVoxelLocal = voxelLocal3.xy;
  }
  vec2 voxelFacetGrid = (voxelFacetVoxelCoord + voxelFacetVoxelLocal) * voxelFacetCoordinateScale;
  vec2 voxelFacetCell = floor(voxelFacetGrid);
  vec2 voxelFacetLocal = fract(voxelFacetGrid);
  float voxelFacetSeed = voxelFacetHash(voxelFacetCell);
  float voxelFacetSeedB = voxelFacetHash(voxelFacetCell + vec2(19.37, 41.83));
  float voxelFacetSeedC = voxelFacetHash(voxelFacetCell + vec2(7.13, 23.71));
  float voxelFacetDistance = length(fwidth(voxelFacetGrid));
  float voxelFacetVisibility = 1.0 - smoothstep(0.85, 2.6, voxelFacetDistance);
  float voxelFacetTriangle = step(1.0, voxelFacetLocal.x + voxelFacetLocal.y);
  float voxelFacetSign = mix(-1.0, 1.0, step(0.5, voxelFacetSeedB));
  float voxelFacetTriangleSign = mix(1.0, -1.0, voxelFacetTriangle);
  // Keep the change below a bevel-like silhouette break while making same-plane
  // voxels readable in the 1280px building close-up (roughly 2-7 degrees).
  float voxelFacetAngle = mix(0.034, 0.118, voxelFacetSeed) * mix(0.90, 1.0, voxelFacetTriangle);
  float voxelFacetEdge = 0.72 + 0.28 * smoothstep(0.02, 0.22, min(min(voxelFacetLocal.x, voxelFacetLocal.y), min(1.0 - voxelFacetLocal.x, 1.0 - voxelFacetLocal.y)));
  vec3 voxelFacetReference = abs(voxelFacetBaseNormal.y) < 0.88 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 voxelFacetTangent = normalize(cross(voxelFacetReference, voxelFacetBaseNormal));
  vec3 voxelFacetBitangent = normalize(cross(voxelFacetBaseNormal, voxelFacetTangent));
  vec3 voxelFacetNormal = normalize(
    voxelFacetBaseNormal
      + voxelFacetTangent * (sin(voxelFacetSeedC * 6.2831853) * voxelFacetAngle * voxelFacetSign * voxelFacetTriangleSign * voxelFacetEdge)
      + voxelFacetBitangent * (cos(voxelFacetSeedB * 6.2831853) * voxelFacetAngle * 0.68 * voxelFacetTriangleSign * voxelFacetEdge)
  );
  // Water and glass keep the pre-v2 continuous facet response exactly; felt and
  // organic surfaces are explicitly excluded from both paths.
  float voxelContinuousFacetResponse = 0.0;
  if (vVoxelSurfaceKind > 6.5 && vVoxelSurfaceKind < 7.5) voxelContinuousFacetResponse = 0.48;
  if (vVoxelSurfaceKind > 7.5 && vVoxelSurfaceKind < 8.5) voxelContinuousFacetResponse = 0.48;
  if (voxelFacetMode > 0.5 && voxelFacetMode < 1.5) voxelContinuousFacetResponse = 0.0;
  normal = normalize(mix(normal, voxelFacetNormal, voxelFacetVisibility * voxelContinuousFacetResponse * voxelFacetStrength));

  // Hard-surface relief is a virtual height field. It changes only the normal;
  // no vertex positions or greedy mesh topology are touched.
  float voxelHeightResponse = 0.0;
  if (vVoxelSurfaceKind > 0.5 && vVoxelSurfaceKind < 1.5) voxelHeightResponse = 0.28;
  if (vVoxelSurfaceKind > 1.5 && vVoxelSurfaceKind < 2.5) voxelHeightResponse = 0.68;
  if (vVoxelSurfaceKind > 2.5 && vVoxelSurfaceKind < 3.5) voxelHeightResponse = 1.0;
  if (vVoxelSurfaceKind > 3.5 && vVoxelSurfaceKind < 4.5) voxelHeightResponse = 0.30;
  if (vVoxelSurfaceKind > 5.5 && vVoxelSurfaceKind < 6.5) voxelHeightResponse = 0.62;
  if (voxelFacetMode > 0.5 && voxelFacetMode < 1.5) voxelHeightResponse = 0.0;
  float voxelHeightCenter = 0.0;
  float voxelHeightLeft = 0.0;
  float voxelHeightRight = 0.0;
  float voxelHeightDown = 0.0;
  float voxelHeightUp = 0.0;
  float voxelHeightNeighbourAverage = 0.0;
  vec2 voxelHeightGradient = vec2(0.0);
  if (voxelHeightResponse > 0.0) {
    voxelHeightCenter = voxelHeightField(voxelFacetCell);
    voxelHeightLeft = voxelHeightField(voxelFacetCell + vec2(-1.0, 0.0));
    voxelHeightRight = voxelHeightField(voxelFacetCell + vec2(1.0, 0.0));
    voxelHeightDown = voxelHeightField(voxelFacetCell + vec2(0.0, -1.0));
    voxelHeightUp = voxelHeightField(voxelFacetCell + vec2(0.0, 1.0));
    voxelHeightNeighbourAverage = (voxelHeightLeft + voxelHeightRight + voxelHeightDown + voxelHeightUp) * 0.25;
    voxelHeightGradient = vec2(
      (voxelHeightRight - voxelHeightLeft) * 0.5,
      (voxelHeightUp - voxelHeightDown) * 0.5
    );
    vec3 voxelHeightNormal = normalize(
      voxelFacetBaseNormal
        - voxelFacetTangent * voxelHeightGradient.x
        - voxelFacetBitangent * voxelHeightGradient.y
    );
    // Keep the smooth slope as a quiet support; edge relief below is the readable cue.
    normal = normalize(mix(normal, voxelHeightNormal, voxelFacetVisibility * voxelHeightResponse * voxelFacetStrength * 0.18));
  }`;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float voxelFacetSurfaceKind;\nuniform float voxelFacetCellSize;\nuniform float voxelFacetStrength;\nuniform float voxelGlintStrength;\nvarying float vVoxelSurfaceKind;\nvarying vec3 vVoxelWorldPosition;\nvarying vec3 vVoxelWorldNormal;\nvarying vec3 vVoxelViewNormal;\nfloat voxelFacetMode = ${mode === "facet" ? "0.0" : mode === "glint" ? "1.0" : "2.0"};\n\nfloat voxelFacetHash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\nvec2 voxelFacetPlanarUv(vec3 position, vec3 normal) {\n  vec3 axis = abs(normalize(normal));\n  if (axis.y > axis.x && axis.y > axis.z) return position.xz;\n  if (axis.x > axis.z) return position.zy;\n  return position.xy;\n}\n\n// Quantized, clustered height field: most cells share the cluster baseline while\n// a small deterministic minority is raised or recessed. Values are voxel fractions.\nfloat voxelHeightField(vec2 cell) {\n  vec2 cluster = floor(cell / 3.0);\n  float clusterBaseline = (voxelFacetHash(cluster + vec2(53.1, 17.7)) - 0.5) * 0.022;\n  float minority = step(0.76, voxelFacetHash(cell + vec2(11.7, 29.3)));\n  float direction = mix(-1.0, 1.0, step(0.52, voxelFacetHash(cell + vec2(37.1, 5.9))));\n  return clusterBaseline + minority * direction * 0.085;\n}\n\nfloat voxelHeightCavity(vec2 cell) {\n  float center = voxelHeightField(cell);\n  float neighbours = voxelHeightField(cell + vec2(-1.0, 0.0))\n    + voxelHeightField(cell + vec2(1.0, 0.0))\n    + voxelHeightField(cell + vec2(0.0, -1.0))\n    + voxelHeightField(cell + vec2(0.0, 1.0));\n  return clamp((neighbours * 0.25 - center) * 5.5, -1.0, 1.0);\n}\n${VOXEL_FACET_DECLARATIONS_MARKER}`
      )
      .replace("#include <normal_fragment_maps>", facetInjection)
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  // A broad, screen-aware edge band makes the virtual relief readable even when
  // the slope itself is too shallow to survive a 1280px view. It is a lighting
  // cue only: no shadow-map or depth claim, and no geometry is displaced.
  if (voxelHeightResponse > 0.0) {
    float voxelReliefAa = max(length(fwidth(voxelFacetLocal)), 0.012);
    // Each boundary is independent: a raised cell gets an exposed side only
    // where its height differs from that particular neighbor.
    float voxelReliefLeftBand = 1.0 - smoothstep(0.055 + voxelReliefAa, 0.27 + voxelReliefAa * 1.6, voxelFacetLocal.x);
    float voxelReliefRightBand = 1.0 - smoothstep(0.055 + voxelReliefAa, 0.27 + voxelReliefAa * 1.6, 1.0 - voxelFacetLocal.x);
    float voxelReliefDownBand = 1.0 - smoothstep(0.055 + voxelReliefAa, 0.27 + voxelReliefAa * 1.6, voxelFacetLocal.y);
    float voxelReliefUpBand = 1.0 - smoothstep(0.055 + voxelReliefAa, 0.27 + voxelReliefAa * 1.6, 1.0 - voxelFacetLocal.y);
    float voxelReliefLeftDelta = voxelHeightCenter - voxelHeightLeft;
    float voxelReliefRightDelta = voxelHeightCenter - voxelHeightRight;
    float voxelReliefDownDelta = voxelHeightCenter - voxelHeightDown;
    float voxelReliefUpDelta = voxelHeightCenter - voxelHeightUp;
    float voxelReliefLeftStrength = smoothstep(0.018, 0.105, abs(voxelReliefLeftDelta));
    float voxelReliefRightStrength = smoothstep(0.018, 0.105, abs(voxelReliefRightDelta));
    float voxelReliefDownStrength = smoothstep(0.018, 0.105, abs(voxelReliefDownDelta));
    float voxelReliefUpStrength = smoothstep(0.018, 0.105, abs(voxelReliefUpDelta));
    vec2 voxelReliefLight = vec2(
      dot(voxelFacetTangent, directionalLights[0].direction),
      dot(voxelFacetBitangent, directionalLights[0].direction)
    );
    voxelReliefLight = normalize(voxelReliefLight + vec2(0.0001, 0.0001));
    float voxelReliefLeftSun = dot(vec2(-1.0, 0.0), voxelReliefLight);
    float voxelReliefRightSun = dot(vec2(1.0, 0.0), voxelReliefLight);
    float voxelReliefDownSun = dot(vec2(0.0, -1.0), voxelReliefLight);
    float voxelReliefUpSun = dot(vec2(0.0, 1.0), voxelReliefLight);
    float voxelReliefLeftLight = max(voxelReliefLeftDelta, 0.0) * (0.20 + 0.34 * max(voxelReliefLeftSun, 0.0)) - max(-voxelReliefLeftDelta, 0.0) * (0.12 + 0.22 * max(-voxelReliefLeftSun, 0.0));
    float voxelReliefRightLight = max(voxelReliefRightDelta, 0.0) * (0.20 + 0.34 * max(voxelReliefRightSun, 0.0)) - max(-voxelReliefRightDelta, 0.0) * (0.12 + 0.22 * max(-voxelReliefRightSun, 0.0));
    float voxelReliefDownLight = max(voxelReliefDownDelta, 0.0) * (0.20 + 0.34 * max(voxelReliefDownSun, 0.0)) - max(-voxelReliefDownDelta, 0.0) * (0.12 + 0.22 * max(-voxelReliefDownSun, 0.0));
    float voxelReliefUpLight = max(voxelReliefUpDelta, 0.0) * (0.20 + 0.34 * max(voxelReliefUpSun, 0.0)) - max(-voxelReliefUpDelta, 0.0) * (0.12 + 0.22 * max(-voxelReliefUpSun, 0.0));
    float voxelReliefEdgeLight = voxelReliefLeftBand * voxelReliefLeftStrength * voxelReliefLeftLight
      + voxelReliefRightBand * voxelReliefRightStrength * voxelReliefRightLight
      + voxelReliefDownBand * voxelReliefDownStrength * voxelReliefDownLight
      + voxelReliefUpBand * voxelReliefUpStrength * voxelReliefUpLight;
    float voxelReliefCavity = max(voxelHeightCenter - voxelHeightNeighbourAverage, 0.0) * 0.08;
    float voxelReliefDiffuse = clamp(
      1.0 + voxelReliefEdgeLight * 5.0 * voxelHeightResponse * voxelFacetStrength
        - voxelReliefCavity * voxelHeightResponse * voxelFacetStrength,
      0.80,
      1.22
    );
    reflectedLight.directDiffuse *= voxelReliefDiffuse;
  }

  // Grass/felt stays matte; water and glass use this same static, world-locked glint path.
  float voxelGlintHardSurface = 1.0 - step(4.5, vVoxelSurfaceKind) * step(vVoxelSurfaceKind, 5.5);
  float voxelGlintMaterialResponse = 0.0;
  if (vVoxelSurfaceKind > 0.5 && vVoxelSurfaceKind < 1.5) voxelGlintMaterialResponse = 0.04;
  if (vVoxelSurfaceKind > 1.5 && vVoxelSurfaceKind < 2.5) voxelGlintMaterialResponse = 0.06;
  if (vVoxelSurfaceKind > 2.5 && vVoxelSurfaceKind < 3.5) voxelGlintMaterialResponse = 0.30;
  if (vVoxelSurfaceKind > 3.5 && vVoxelSurfaceKind < 4.5) voxelGlintMaterialResponse = 0.12;
  if (vVoxelSurfaceKind > 5.5 && vVoxelSurfaceKind < 6.5) voxelGlintMaterialResponse = 0.06;
  if (vVoxelSurfaceKind > 6.5 && vVoxelSurfaceKind < 7.5) voxelGlintMaterialResponse = 0.68;
  if (vVoxelSurfaceKind > 7.5 && vVoxelSurfaceKind < 8.5) voxelGlintMaterialResponse = 0.42;
  if (vVoxelSurfaceKind > 4.5 && vVoxelSurfaceKind < 5.5) voxelGlintMaterialResponse = 0.0;
  if (voxelFacetMode < 0.5) voxelGlintMaterialResponse = 0.0;

  vec2 voxelGlintUv = voxelFacetPlanarUv(vVoxelWorldPosition, vVoxelWorldNormal) / max(voxelFacetCellSize, 0.0001) * 0.36;
  vec2 voxelGlintCell = floor(voxelGlintUv);
  vec2 voxelGlintLocal = fract(voxelGlintUv);
  float voxelGlintSeed = voxelFacetHash(voxelGlintCell);
  float voxelGlintSeedB = voxelFacetHash(voxelGlintCell + vec2(19.37, 41.83));
  float voxelGlintSeedC = voxelFacetHash(voxelGlintCell + vec2(7.13, 23.71));
  vec2 voxelGlintAnchor = vec2(
    mix(0.18, 0.82, voxelFacetHash(voxelGlintCell + vec2(3.17, 7.91))),
    mix(0.18, 0.82, voxelFacetHash(voxelGlintCell + vec2(11.53, 5.29)))
  );
  float voxelGlintAnchorDistance = length(voxelGlintLocal - voxelGlintAnchor);
  float voxelGlintAa = max(fwidth(voxelGlintAnchorDistance) * 1.2, 0.012);
  float voxelGlintCore = 1.0 - smoothstep(0.060, 0.060 + voxelGlintAa, voxelGlintAnchorDistance);
  float voxelGlintShoulder = 1.0 - smoothstep(0.086, 0.16 + voxelGlintAa * 1.35, voxelGlintAnchorDistance);
  // About one cell in four is eligible; the surface relief carries most of the
  // material variation, so glints remain sparse rather than glittery.
  float voxelGlintCandidate = smoothstep(0.68, 0.90, voxelGlintSeed);
  vec3 voxelGlintLightDir = directionalLights[0].direction;
  // Use the exact normal produced by the facet/height path above. This keeps
  // relief and glint coherent instead of layering a sticker-like old normal.
  float voxelGlintSunFacing = saturate(dot(normal, voxelGlintLightDir));
  vec3 voxelGlintHalfDir = normalize(voxelGlintLightDir + geometryViewDir);
  float voxelGlintReflectRaw = saturate(dot(normal, voxelGlintHalfDir));
  float voxelGlintViewFacing = abs(dot(normal, geometryViewDir));
  float voxelGlintGrazingGate = mix(0.56, 1.0, smoothstep(0.08, 0.62, 1.0 - voxelGlintViewFacing));
  float voxelGlintPreferredReflect = mix(0.54, 0.82, voxelGlintSeedB);
  float voxelGlintPeakDistance = abs(voxelGlintReflectRaw - voxelGlintPreferredReflect);
  float voxelGlintPeakHalfWidth = mix(0.026, 0.046, voxelGlintSeedC);
  float voxelGlintReflectionPeak = 1.0 - smoothstep(voxelGlintPeakHalfWidth * 0.55, voxelGlintPeakHalfWidth * 1.45, voxelGlintPeakDistance);
  float voxelGlintReflectionBroad = smoothstep(0.28, 0.86, voxelGlintReflectRaw);
  float voxelGlintReflection = mix(0.22, 0.78, voxelGlintReflectionPeak) * (0.42 + 0.58 * voxelGlintReflectionBroad);
  float voxelGlintSunGate = smoothstep(0.02, 0.32, voxelGlintSunFacing);
  float voxelGlintFootprint = clamp(length(fwidth(vVoxelWorldPosition)) * 1.8, 0.0, 1.0);
  float voxelGlintFarEnergy = mix(1.0, 1.38, voxelGlintFootprint);
  float voxelGlint = voxelGlintHardSurface
    * voxelGlintMaterialResponse
    * voxelGlintCandidate
    * voxelGlintGrazingGate
    * voxelGlintSunGate
    * voxelGlintReflection
    * voxelGlintStrength;
  reflectedLight.directSpecular += directionalLights[0].color
    * vec3(1.0, 0.975, 0.91)
    * voxelGlint
    * voxelGlintCore
    * 1.05
    * voxelGlintFarEnergy;
  reflectedLight.directSpecular += directionalLights[0].color
    * vec3(1.0, 0.86, 0.68)
    * voxelGlint
    * voxelGlintShoulder
    * 0.045
    * voxelGlintFarEnergy;
#endif`
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|voxel-facet-highlight-v2:${usesKindAttribute ? "attribute" : resolvedKind}:${mode}:${facetStrength}:${glintStrength}`;
  material.needsUpdate = true;
  return material;
}
