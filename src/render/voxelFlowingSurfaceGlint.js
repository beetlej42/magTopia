const VOXEL_GLINT_QUERY_PARAM = "voxelGlint";

function queryFlagEnabled(name) {
  if (typeof globalThis.location?.search !== "string") return false;
  const value = new URLSearchParams(globalThis.location.search).get(name);
  return value === "1" || value === "true" || value === "on";
}

export function applyVoxelFlowingSurfaceGlint(material) {
  if (!material || material.userData?.voxelShader !== "diffuse" || material.userData?.voxelFlowingSurfaceGlint) {
    return material;
  }
  if (!queryFlagEnabled(VOXEL_GLINT_QUERY_PARAM)) return material;

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.userData.voxelFlowingSurfaceGlint = {
    version: "surface-flow-v3",
    note: "short moving edge/corner glints; no extra geometry"
  };

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vVoxelGlintQuadUv;\nvarying vec3 vVoxelGlintWorldPosition;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n#if __VERSION__ >= 300\n  float voxelGlintCornerIndex = mod(float(gl_VertexID), 4.0);\n  if (voxelGlintCornerIndex < 0.5) {\n    vVoxelGlintQuadUv = vec2(0.0, 0.0);\n  } else if (voxelGlintCornerIndex < 1.5) {\n    vVoxelGlintQuadUv = vec2(1.0, 0.0);\n  } else if (voxelGlintCornerIndex < 2.5) {\n    vVoxelGlintQuadUv = vec2(1.0, 1.0);\n  } else {\n    vVoxelGlintQuadUv = vec2(0.0, 1.0);\n  }\n#else\n  vVoxelGlintQuadUv = vec2(0.5);\n#endif\nvVoxelGlintWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec2 vVoxelGlintQuadUv;\nvarying vec3 vVoxelGlintWorldPosition;`
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0 && __VERSION__ >= 300\n  // Felt-like surfaces are grass / soil / foliage in the current voxel palette.\n  // Keep them matte; transparent water never reaches this diffuse voxel path.\n  float voxelGlintHardSurface = 1.0 - step(4.5, vStorybookSurfaceKind) * step(vStorybookSurfaceKind, 5.5);\n\n  vec2 voxelEdgeDistances = min(vVoxelGlintQuadUv, vec2(1.0) - vVoxelGlintQuadUv);\n  bool voxelVerticalEdge = voxelEdgeDistances.x < voxelEdgeDistances.y;\n  float voxelEdgeDistance = min(voxelEdgeDistances.x, voxelEdgeDistances.y);\n  float voxelAlongEdge = voxelVerticalEdge ? vVoxelGlintQuadUv.y : vVoxelGlintQuadUv.x;\n\n  // Keep the carrier very narrow, but with a faint shoulder so it reads less like a hard white line.\n  float voxelEdgeWidth = max(fwidth(voxelEdgeDistance), 0.0015);\n  float voxelEdgeCore = 1.0 - smoothstep(voxelEdgeWidth * 0.25, voxelEdgeWidth * 1.15, voxelEdgeDistance);\n  float voxelEdgeShoulder = 1.0 - smoothstep(voxelEdgeWidth * 0.4, voxelEdgeWidth * 2.8, voxelEdgeDistance);\n\n  vec3 voxelLightDir = directionalLights[0].direction;\n  float voxelSunFacing = saturate(dot(geometryNormal, voxelLightDir));\n  vec3 voxelHalfDir = normalize(voxelLightDir + geometryViewDir);\n  float voxelReflection = pow(saturate(dot(geometryNormal, voxelHalfDir)), 28.0);\n  float voxelSunGate = smoothstep(0.20, 0.70, voxelSunFacing);\n\n  // Stable broad cell seed: far fewer candidates than the previous per-quad sparkle prototype.\n  vec3 voxelCell = floor(vVoxelGlintWorldPosition / 1.35);\n  float voxelSeed = fract(sin(dot(voxelCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);\n  float voxelCandidate = smoothstep(0.965, 0.995, voxelSeed);\n\n  // Let the pulse center move continuously as the view vector changes. This changes position,\n  // rather than merely modulating the brightness of a fixed full edge.\n  float voxelViewPhase = dot(geometryViewDir, vec3(0.31, 0.53, 0.79));\n  float voxelPulseCenter = fract(voxelSeed * 1.73 + voxelViewPhase * 0.72 + voxelSunFacing * 0.19);\n  float voxelPulseDistance = abs(voxelAlongEdge - voxelPulseCenter);\n  voxelPulseDistance = min(voxelPulseDistance, 1.0 - voxelPulseDistance);\n  float voxelPulseWidth = mix(0.115, 0.055, saturate(length(fwidth(vVoxelGlintWorldPosition)) * 3.0));\n  float voxelPulse = 1.0 - smoothstep(voxelPulseWidth * 0.55, voxelPulseWidth, voxelPulseDistance);\n  voxelPulse *= voxelPulse;\n\n  // Corners get a small extra chance to sparkle, but never turn the whole face glossy.\n  float voxelCornerDistance = max(voxelEdgeDistances.x, voxelEdgeDistances.y);\n  float voxelCornerWidth = max(fwidth(voxelCornerDistance) * 1.6, 0.002);\n  float voxelCorner = 1.0 - smoothstep(voxelCornerWidth * 0.35, voxelCornerWidth * 1.35, voxelCornerDistance);\n\n  float voxelGlintCore = max(voxelEdgeCore * voxelPulse, voxelCorner * 0.75);\n  float voxelGlint = voxelGlintHardSurface\n    * voxelCandidate\n    * voxelSunGate\n    * voxelReflection\n    * voxelGlintCore;\n\n  // Bright compact core + weak warm shoulder. The shoulder is intentionally not a true\n  // post-process bloom; it softens the carrier without another pass or draw call.\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.965, 0.88)\n    * voxelGlint\n    * 1.15;\n  reflectedLight.directSpecular += directionalLights[0].color\n    * vec3(1.0, 0.88, 0.72)\n    * voxelCandidate\n    * voxelSunGate\n    * voxelReflection\n    * voxelPulse\n    * voxelEdgeShoulder\n    * 0.09;\n#endif`
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|voxel-flowing-surface-glint-v3`;
  material.needsUpdate = true;
  return material;
}
