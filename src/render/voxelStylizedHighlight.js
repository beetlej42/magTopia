export function applyVoxelStylizedHighlight(material) {
  if (!material || material.userData?.voxelShader !== "diffuse" || material.userData?.voxelStylizedHighlight) {
    return material;
  }

  const previousCompile = material.onBeforeCompile;
  material.userData.voxelStylizedHighlight = {
    version: "sun-specular-v2",
    exponent: 12,
    strength: 0.28
  };

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n  vec3 voxelHighlightLightDir = directionalLights[0].direction;\n  float voxelSunFacing = saturate(dot(geometryNormal, voxelHighlightLightDir));\n  vec3 voxelHalfDir = normalize(voxelHighlightLightDir + geometryViewDir);\n  float voxelSpec = pow(saturate(dot(geometryNormal, voxelHalfDir)), 12.0);\n  float voxelGate = smoothstep(0.08, 0.50, voxelSunFacing);\n  float voxelHighlight = voxelSpec * voxelGate * 0.28;\n  vec3 voxelHighlightColor = mix(vec3(1.0, 0.95, 0.86), diffuseColor.rgb, 0.08);\n  reflectedLight.directSpecular += directionalLights[0].color * voxelHighlightColor * voxelHighlight;\n#endif`
    );
  };

  material.needsUpdate = true;
  return material;
}
