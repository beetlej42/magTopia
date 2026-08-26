import { applyVoxelStylizedHighlight } from "./voxelStylizedHighlight.js";

export const STORYBOOK_SURFACE_KINDS = Object.freeze({
  none: 0,
  plaster: 1,
  brick: 2,
  slate: 3,
  painted: 4,
  felt: 5,
  stone: 6
});

const MATERIAL_KIND_BY_ID = Object.freeze({
  brickRed: STORYBOOK_SURFACE_KINDS.brick,
  brickBrown: STORYBOOK_SURFACE_KINDS.brick,
  sandstone: STORYBOOK_SURFACE_KINDS.plaster,
  limestone: STORYBOOK_SURFACE_KINDS.plaster,
  stoneShadow: STORYBOOK_SURFACE_KINDS.stone,
  slate: STORYBOOK_SURFACE_KINDS.slate,
  timber: STORYBOOK_SURFACE_KINDS.painted,
  iron: STORYBOOK_SURFACE_KINDS.painted,
  patinaMetal: STORYBOOK_SURFACE_KINDS.painted,
  pavement: STORYBOOK_SURFACE_KINDS.stone,
  road: STORYBOOK_SURFACE_KINDS.stone,
  grass: STORYBOOK_SURFACE_KINDS.felt,
  grassLight: STORYBOOK_SURFACE_KINDS.felt,
  grassDark: STORYBOOK_SURFACE_KINDS.felt,
  soil: STORYBOOK_SURFACE_KINDS.felt,
  foliage: STORYBOOK_SURFACE_KINDS.felt,
  foliageDark: STORYBOOK_SURFACE_KINDS.felt,
  foliageLight: STORYBOOK_SURFACE_KINDS.felt
});

let storybookSurfaceStrength = 0.78;

export function setStorybookSurfaceStrength(value) {
  storybookSurfaceStrength = Math.min(1, Math.max(0, Number(value) || 0));
  return storybookSurfaceStrength;
}

export function getStorybookSurfaceStrength() {
  return storybookSurfaceStrength;
}

export function storybookSurfaceKindForMaterial(materialId) {
  return MATERIAL_KIND_BY_ID[materialId] ?? STORYBOOK_SURFACE_KINDS.none;
}

export function applyStorybookSurfaceMaterial(material, {
  surfaceKind = STORYBOOK_SURFACE_KINDS.none,
  useSurfaceKindAttribute = false,
  strength = storybookSurfaceStrength
} = {}) {
  material = applyVoxelStylizedHighlight(material);
  if (!material || material.userData?.storybookSurface || strength <= 0) return material;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  const resolvedKind = Number(surfaceKind) || 0;
  const resolvedStrength = Math.min(1, Math.max(0, Number(strength) || 0));
  material.userData.storybookSurface = {
    version: "procedural-microtexture-v1",
    surfaceKind: resolvedKind,
    useSurfaceKindAttribute: Boolean(useSurfaceKindAttribute),
    strength: resolvedStrength
  };
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.uniforms.storybookSurfaceKind = { value: resolvedKind };
    shader.uniforms.storybookSurfaceStrength = { value: resolvedStrength };
    const kindSource = useSurfaceKindAttribute
      ? "attribute float voxelSurfaceKind;"
      : "uniform float storybookSurfaceKind;";
    const kindAssignment = useSurfaceKindAttribute ? "voxelSurfaceKind" : "storybookSurfaceKind";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${kindSource}\nvarying vec3 vStorybookWorldPosition;\nvarying vec3 vStorybookWorldNormal;\nvarying float vStorybookSurfaceKind;`)
      .replace("#include <project_vertex>", `#include <project_vertex>\nvStorybookWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvStorybookWorldNormal = normalize(mat3(modelMatrix) * objectNormal);\nvStorybookSurfaceKind = ${kindAssignment};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float storybookSurfaceStrength;\nvarying vec3 vStorybookWorldPosition;\nvarying vec3 vStorybookWorldNormal;\nvarying float vStorybookSurfaceKind;\n\nfloat storybookHash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\nfloat storybookLine(float value, float width) {\n  float distanceToLine = min(fract(value), 1.0 - fract(value));\n  return 1.0 - smoothstep(width, width + fwidth(value) * 1.35, distanceToLine);\n}\n\nvec2 storybookPlanarUv(vec3 position, vec3 normal) {\n  vec3 axis = abs(normalize(normal));\n  if (axis.y > axis.x && axis.y > axis.z) return position.xz;\n  if (axis.x > axis.z) return position.zy;\n  return position.xy;\n}\n\nfloat storybookSurfaceModulation(float kind, vec3 position, vec3 normal) {\n  vec2 uv = storybookPlanarUv(position, normal);\n  float fine = storybookHash(floor(uv * 92.0));\n  float coarse = storybookHash(floor(uv * 18.0 + 17.0));\n  float paper = mix(0.965, 1.035, fine) * mix(0.985, 1.015, coarse);\n  float modulation = paper;\n  if (kind > 1.5 && kind < 2.5) {\n    vec3 axis = abs(normalize(normal));\n    float vertical = 1.0 - smoothstep(0.62, 0.88, axis.y);\n    vec2 brickUv = uv * vec2(2.75, 5.5);\n    brickUv.x += mod(floor(brickUv.y), 2.0) * 0.5;\n    float mortar = max(storybookLine(brickUv.x, 0.045), storybookLine(brickUv.y, 0.055));\n    modulation *= 1.0 - mortar * vertical * 0.105;\n  } else if (kind > 2.5 && kind < 3.5) {\n    float slateBand = storybookLine(uv.y * 10.0, 0.035);\n    modulation *= 1.0 - slateBand * 0.045;\n  } else if (kind > 3.5 && kind < 4.5) {\n    float brush = storybookHash(vec2(floor(uv.x * 34.0), floor(uv.y * 9.0)));\n    modulation *= mix(0.975, 1.025, brush);\n  } else if (kind > 4.5 && kind < 5.5) {\n    float felt = storybookHash(floor(uv * 42.0)) * 0.65 + storybookHash(floor(uv.yx * 73.0 + 9.0)) * 0.35;\n    modulation *= mix(0.945, 1.035, felt);\n  } else if (kind > 5.5 && kind < 6.5) {\n    float aggregate = storybookHash(floor(uv * 31.0));\n    modulation *= mix(0.955, 1.025, aggregate);\n  }\n  return mix(1.0, modulation, storybookSurfaceStrength);\n}`)
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= storybookSurfaceModulation(vStorybookSurfaceKind, vStorybookWorldPosition, vStorybookWorldNormal);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + storybookSurfaceStrength * 0.035, 0.0, 1.0);");
    shader.fragmentShader = shader.fragmentShader
      .replace("mortar * vertical * 0.105", "mortar * vertical * 0.16")
      .replace("storybookLine(uv.y * 10.0, 0.035)", "storybookLine(uv.y * 10.0, 0.04)")
      .replace("slateBand * 0.045", "slateBand * 0.075")
      .replace("mix(0.975, 1.025, brush)", "mix(0.97, 1.03, brush)")
      .replace("mix(0.945, 1.035, felt)", "mix(0.925, 1.045, felt)")
      .replace("mix(0.955, 1.025, aggregate)", "mix(0.94, 1.035, aggregate)");
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|storybook-surface-v1:${useSurfaceKindAttribute ? "attribute" : resolvedKind}`;
  material.needsUpdate = true;
  return material;
}
