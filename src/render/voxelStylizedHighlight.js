export function applyVoxelStylizedHighlight(material) {
  if (!material || material.userData?.voxelShader !== "diffuse" || material.userData?.voxelStylizedHighlight) {
    return material;
  }

  const previousCompile = material.onBeforeCompile;
  material.userData.voxelStylizedHighlight = {
    version: "sun-specular-v1",
    exponent: 24,
    strength: 0.22
  };

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n  vec3 voxelHighlightLightDir = directionalLights[0].direction;\n  float voxelSunFacing = saturate(dot(geometryNormal, voxelHighlightLightDir));\n  vec3 voxelHalfDir = normalize(voxelHighlightLightDir + geometryViewDir);\n  float voxelSpec = pow(saturate(dot(geometryNormal, voxelHalfDir)), 24.0);\n  float voxelGate = smoothstep(0.15, 0.60, voxelSunFacing);\n  float voxelRoughnessResponse = clamp(1.10 - roughnessFactor, 0.0, 1.0);\n  float voxelMetalBoost = mix(1.0, 1.8, clamp(metalnessFactor, 0.0, 1.0));\n  float voxelHighlight = voxelSpec * voxelGate * voxelRoughnessResponse * voxelMetalBoost * 0.22;\n  vec3 voxelHighlightColor = mix(vec3(1.0, 0.95, 0.86), diffuseColor.rgb, 0.12);\n  reflectedLight.directSpecular += directionalLights[0].color * voxelHighlightColor * voxelHighlight;\n#endif`
    );
  };

  material.needsUpdate = true;
  return material;
}
