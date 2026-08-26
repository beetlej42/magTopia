const VOXEL_GLINT_QUERY_PARAM = "voxelGlint";

function queryFlagEnabled(name) {
  if (typeof globalThis.location?.search !== "string") return false;
  const value = new URLSearchParams(globalThis.location.search).get(name);
  return value === "1" || value === "true" || value === "on";
}

export function applyVoxelCurvedWorldTwinkle(material, {
  surfaceKind = 0,
  useSurfaceKindAttribute = false
} = {}) {
  if (!material || material.userData?.voxelShader !== "diffuse" || material.userData?.voxelCurvedWorldTwinkle) {
    return material;
  }
  if (!queryFlagEnabled(VOXEL_GLINT_QUERY_PARAM)) return material;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  const resolvedKind = Number(surfaceKind) || 0;
  const usesKindAttribute = Boolean(useSurfaceKindAttribute);

  material.userData.voxelCurvedWorldTwinkle = {
    version: "curved-world-twinkle-v4.1",
    surfaceKind: resolvedKind,
    useSurfaceKindAttribute: usesKindAttribute,
    note: "sparser fixed anchors; grazing-surface preference; narrow pan-sensitive reflection peaks"
  };

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.uniforms.voxelTwinkleSurfaceKind = { value: resolvedKind };

    const kindSource = usesKindAttribute
      ? "attribute float voxelSurfaceKind;"
      : "uniform float voxelTwinkleSurfaceKind;";
    const kindAssignment = usesKindAttribute ? "voxelSurfaceKind" : "voxelTwinkleSurfaceKind";

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${kindSource}\nvarying float vVoxelTwinkleSurfaceKind;\nvarying vec3 vVoxelTwinkleWorldPosition;\nvarying vec3 vVoxelTwinkleWorldNormal;`
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\nvVoxelTwinkleSurfaceKind = ${kindAssignment};\nvVoxelTwinkleWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvVoxelTwinkleWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying float vVoxelTwinkleSurfaceKind;\nvarying vec3 vVoxelTwinkleWorldPosition;\nvarying vec3 vVoxelTwinkleWorldNormal;\n\nfloat voxelTwinkleHash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\nvec2 voxelTwinklePlanarUv(vec3 position, vec3 normal) {\n  vec3 axis = abs(normalize(normal));\n  if (axis.y > axis.x && axis.y > axis.z) return position.xz;\n  if (axis.x > axis.z) return position.zy;\n  return position.xy;\n}`
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n  // Felt is grass / soil / foliage in the current palette. Keep it completely matte here.\n  // Transparent water does not use this diffuse voxel shader and keeps its existing reflection.\n  float voxelHardSurface = 1.0 - step(4.5, vVoxelTwinkleSurfaceKind) * step(vVoxelTwinkleSurfaceKind, 5.5);\n\n  // Keep anchors fixed in world space but much sparser than v4.\n  // Larger cells + a strict candidate gate prevent roofs and facades from reading as glitter-covered planes.\n  vec2 voxelUv = voxelTwinklePlanarUv(vVoxelTwinkleWorldPosition, vVoxelTwinkleWorldNormal) * 0.92;\n  vec2 voxelCell = floor(voxelUv);\n  vec2 voxelLocal = fract(voxelUv);\n  float voxelSeed = voxelTwinkleHash(voxelCell);\n  float voxelSeedB = voxelTwinkleHash(voxelCell + vec2(19.37, 41.83));\n  float voxelSeedC = voxelTwinkleHash(voxelCell + vec2(7.13, 23.71));\n  vec2 voxelAnchor = vec2(\n    mix(0.18, 0.82, voxelTwinkleHash(voxelCell + vec2(3.17, 7.91))),\n    mix(0.18, 0.82, voxelTwinkleHash(voxelCell + vec2(11.53, 5.29)))\n  );\n  float voxelAnchorDistance = length(voxelLocal - voxelAnchor);\n  float voxelAnchorAa = max(fwidth(voxelAnchorDistance) * 1.20, 0.010);\n  float voxelCore = 1.0 - smoothstep(0.042, 0.042 + voxelAnchorAa, voxelAnchorDistance);\n  float voxelShoulder = 1.0 - smoothstep(0.060, 0.125 + voxelAnchorAa * 1.35, voxelAnchorDistance);\n\n  // Roughly the top ~10% of cells become potential anchors instead of most cells.\n  float voxelCandidate = smoothstep(0.88, 0.96, voxelSeed);\n\n  vec3 voxelLightDir = directionalLights[0].direction;\n  float voxelSunFacing = saturate(dot(geometryNormal, voxelLightDir));\n  vec3 voxelHalfDir = normalize(voxelLightDir + geometryViewDir);\n  float voxelReflectRaw = saturate(dot(geometryNormal, voxelHalfDir));\n\n  // Prefer grazing surfaces so broad front-facing planes do not fill with isolated white dots.\n  // This is not a hard silhouette test: roofs and bevel-like orientations still have room to sparkle.\n  float voxelViewFacing = abs(dot(normalize(vVoxelTwinkleWorldNormal), geometryViewDir));\n  float voxelGrazingGate = smoothstep(0.20, 0.58, 1.0 - voxelViewFacing);\n\n  // Give every anchor a narrow preferred reflection value. A small change in N/V/L while panning\n  // now causes a large brightness change, and different anchors peak at different camera positions.\n  float voxelPreferredReflect = mix(0.54, 0.82, voxelSeedB);\n  float voxelPeakDistance = abs(voxelReflectRaw - voxelPreferredReflect);\n  float voxelPeakHalfWidth = mix(0.028, 0.050, voxelSeedC);\n  float voxelReflection = 1.0 - smoothstep(voxelPeakHalfWidth * 0.45, voxelPeakHalfWidth, voxelPeakDistance);\n  voxelReflection *= voxelReflection;\n  float voxelSunGate = smoothstep(0.10, 0.52, voxelSunFacing);\n\n  float voxelFootprint = saturate(length(fwidth(vVoxelTwinkleWorldPosition)) * 1.8);\n  float voxelFarEnergy = mix(1.0, 1.55, voxelFootprint);\n  float voxelTwinkle = voxelHardSurface\n    * voxelCandidate\n    * voxelGrazingGate\n    * voxelSunGate\n    * voxelReflection;\n\n  // Compact warm core with a tiny local shoulder; no extra geometry, time animation or post-process pass.\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.965, 0.88)\n    * voxelTwinkle\n    * voxelCore\n    * 1.22\n    * voxelFarEnergy;\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.86, 0.68)\n    * voxelTwinkle\n    * voxelShoulder\n    * 0.060\n    * voxelFarEnergy;\n#endif`
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|voxel-curved-world-twinkle-v4.1:${usesKindAttribute ? "attribute" : resolvedKind}`;
  material.needsUpdate = true;
  return material;
}
