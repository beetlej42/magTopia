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
    version: "curved-world-twinkle-v4",
    surfaceKind: resolvedKind,
    useSurfaceKindAttribute: usesKindAttribute,
    note: "fixed sparse anchors; brightness only changes from view/light/curved-world normals"
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
        `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n  // Felt is grass / soil / foliage in the current palette. Keep it completely matte here.\n  // Transparent water does not use this diffuse voxel shader and keeps its existing reflection.\n  float voxelHardSurface = 1.0 - step(4.5, vVoxelTwinkleSurfaceKind) * step(vVoxelTwinkleSurfaceKind, 5.5);\n\n  // Fixed world-space sparkle anchors. They never translate or animate; only their brightness changes.\n  vec2 voxelUv = voxelTwinklePlanarUv(vVoxelTwinkleWorldPosition, vVoxelTwinkleWorldNormal) * 1.55;\n  vec2 voxelCell = floor(voxelUv);\n  vec2 voxelLocal = fract(voxelUv);\n  float voxelSeed = voxelTwinkleHash(voxelCell);\n  float voxelSeedB = voxelTwinkleHash(voxelCell + vec2(19.37, 41.83));\n  vec2 voxelAnchor = vec2(\n    mix(0.22, 0.78, voxelTwinkleHash(voxelCell + vec2(3.17, 7.91))),\n    mix(0.22, 0.78, voxelTwinkleHash(voxelCell + vec2(11.53, 5.29)))\n  );\n  float voxelAnchorDistance = length(voxelLocal - voxelAnchor);\n  float voxelAnchorAa = max(fwidth(voxelAnchorDistance) * 1.25, 0.012);\n  float voxelCore = 1.0 - smoothstep(0.055, 0.055 + voxelAnchorAa, voxelAnchorDistance);\n  float voxelShoulder = 1.0 - smoothstep(0.075, 0.16 + voxelAnchorAa * 1.5, voxelAnchorDistance);\n\n  // Keep anchors broadly distributed; reflection angle, not a severe random gate, decides which ones pop.\n  float voxelCandidate = smoothstep(0.48, 0.72, voxelSeed);\n\n  vec3 voxelLightDir = directionalLights[0].direction;\n  float voxelSunFacing = saturate(dot(geometryNormal, voxelLightDir));\n  vec3 voxelHalfDir = normalize(voxelLightDir + geometryViewDir);\n  float voxelReflectRaw = saturate(dot(geometryNormal, voxelHalfDir));\n\n  // Each fixed anchor has a slightly different response window. As camera translation changes V,\n  // and curved-world placement changes N across the scene, different anchors brighten and fade.\n  float voxelThresholdBias = mix(-0.09, 0.09, voxelSeedB);\n  float voxelReflection = smoothstep(0.50 + voxelThresholdBias, 0.79 + voxelThresholdBias, voxelReflectRaw);\n  voxelReflection *= voxelReflection;\n  float voxelSunGate = smoothstep(0.12, 0.58, voxelSunFacing);\n\n  float voxelFootprint = saturate(length(fwidth(vVoxelTwinkleWorldPosition)) * 1.8);\n  float voxelFarEnergy = mix(1.0, 1.65, voxelFootprint);\n  float voxelTwinkle = voxelHardSurface * voxelCandidate * voxelSunGate * voxelReflection;\n\n  // Compact warm core with a tiny local shoulder; no extra geometry, time animation or post-process pass.\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.965, 0.88)\n    * voxelTwinkle\n    * voxelCore\n    * 1.18\n    * voxelFarEnergy;\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.86, 0.68)\n    * voxelTwinkle\n    * voxelShoulder\n    * 0.075\n    * voxelFarEnergy;\n#endif`
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|voxel-curved-world-twinkle-v4:${usesKindAttribute ? "attribute" : resolvedKind}`;
  material.needsUpdate = true;
  return material;
}
