import {
  VOXEL_FACET_DECLARATIONS_MARKER,
  applyVoxelCurvedWorldTwinkle
} from "./voxelCurvedWorldTwinkle.js";

export const STORYBOOK_SURFACE_KINDS = Object.freeze({
  none: 0,
  plaster: 1,
  brick: 2,
  slate: 3,
  painted: 4,
  felt: 5,
  stone: 6,
  water: 7,
  glass: 8
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
  foliageLight: STORYBOOK_SURFACE_KINDS.felt,
  water: STORYBOOK_SURFACE_KINDS.water,
  waterLight: STORYBOOK_SURFACE_KINDS.water,
  glass: STORYBOOK_SURFACE_KINDS.glass,
  lightGlass: STORYBOOK_SURFACE_KINDS.glass,
  tealGlass: STORYBOOK_SURFACE_KINDS.glass,
  warmWindow: STORYBOOK_SURFACE_KINDS.glass,
  violetMagic: STORYBOOK_SURFACE_KINDS.glass,
  tealMagic: STORYBOOK_SURFACE_KINDS.glass
});

const STORYBOOK_SURFACE_GLSL = `
float storybookHandcraftedVoxelColor(float kind, vec3 position, vec3 normal) {
  // glint mode is deliberately a clean material baseline for screenshot comparison.
  if (voxelFacetMode > 0.5 && voxelFacetMode < 1.5) return 1.0;
  if (kind < 0.5 || (kind > 6.5 && kind < 8.5)) return 1.0;

  vec2 uv = voxelFacetPlanarUv(position, normal);
  vec2 grid = uv / max(voxelFacetCellSize, 0.0001);
  vec2 cell = floor(grid);
  float seed = voxelFacetHash(cell + vec2(kind * 13.17, kind * 7.91));
  float seedB = voxelFacetHash(cell + vec2(19.37 + kind, 41.83));
  float facetDetailStrength = clamp(voxelFacetStrength * storybookSurfaceStrength, 0.0, 1.0);
  float heightSignal = clamp(voxelHeightField(cell) * 8.0, -1.0, 1.0);
  float materialJitter = (seed - 0.5) * 0.08;
  float blockSignal = clamp(heightSignal + materialJitter, -1.0, 1.0);
  float variation = 1.0;
  float cavityStrength = 0.0;

  if (kind > 0.5 && kind < 1.5) {
    // Plaster/limestone: nearly clean, with only a restrained block lift.
    variation = 1.0 + blockSignal * 0.035;
    cavityStrength = 0.018;
  } else if (kind > 1.5 && kind < 2.5) {
    // Brick: readable warm block variation without a black grid.
    variation = 1.0 + blockSignal * 0.075;
    cavityStrength = 0.060;
  } else if (kind > 2.5 && kind < 3.5) {
    // Slate: the strongest handcrafted block read.
    variation = 1.0 + blockSignal * 0.16;
    cavityStrength = 0.12;
  } else if (kind > 3.5 && kind < 4.5) {
    // Painted/timber: soft color drift, no regular grid.
    variation = 1.0 + blockSignal * 0.045;
    cavityStrength = 0.025;
  } else if (kind > 4.5 && kind < 5.5) {
    // Felt/grass/soil/foliage are a clean baseline in this experiment. Their
    // existing material colors remain untouched and receive no regular pattern.
    return 1.0;
  } else if (kind > 5.5 && kind < 6.5) {
    // Stone/pavement: visible block variation with soft cavity response.
    variation = 1.0 + blockSignal * 0.09;
    cavityStrength = 0.075;
  } else {
    return 1.0;
  }

  // Neighbor-height curvature supplies a soft cavity/AO cue. It is continuous
  // across the voxel boundary and therefore cannot turn into a black grid.
  float cavity = max(voxelHeightCavity(cell), 0.0) * (0.82 + 0.18 * seedB);
  variation *= 1.0 - cavity * cavityStrength * facetDetailStrength;
  // Fade block response before a cell becomes sub-pixel to avoid shimmer.
  float detailFade = 1.0 - smoothstep(0.70, 1.55, length(fwidth(grid)));
  return mix(1.0, variation, facetDetailStrength * detailFade);
}

float storybookHandcraftedVoxelRoughness(float kind, vec3 position, vec3 normal, float baseRoughness) {
  if (voxelFacetMode > 0.5 && voxelFacetMode < 1.5) return baseRoughness;
  if (kind > 4.5 && kind < 5.5) return baseRoughness;
  if (kind < 0.5 || (kind > 6.5 && kind < 9.5)) return baseRoughness;
  vec2 uv = voxelFacetPlanarUv(position, normal);
  vec2 cell = floor(uv / max(voxelFacetCellSize, 0.0001));
  float seed = voxelFacetHash(cell + vec2(kind * 5.13, 17.37));
  float heightSignal = clamp(voxelHeightField(cell) * 8.0, -1.0, 1.0);
  float blockSignal = clamp(heightSignal + (seed - 0.5) * 0.08, -1.0, 1.0);
  float spread = kind > 2.5 && kind < 3.5 ? 0.075 : kind > 5.5 && kind < 6.5 ? 0.045 : 0.025;
  float detailFade = 1.0 - smoothstep(0.70, 1.55, length(fwidth(uv / max(voxelFacetCellSize, 0.0001))));
  float facetDetailStrength = clamp(voxelFacetStrength * storybookSurfaceStrength, 0.0, 1.0);
  return clamp(baseRoughness + blockSignal * spread * facetDetailStrength * detailFade, 0.0, 1.0);
}
`;

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
  material = applyVoxelCurvedWorldTwinkle(material, { surfaceKind, useSurfaceKindAttribute });
  if (!material || material.userData?.storybookSurface || strength <= 0) return material;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  const resolvedKind = Number(surfaceKind) || 0;
  const resolvedStrength = Math.min(1, Math.max(0, Number(strength) || 0));
  material.userData.storybookSurface = {
    version: "handcrafted-voxel-surface-v2",
    surfaceKind: resolvedKind,
    useSurfaceKindAttribute: Boolean(useSurfaceKindAttribute),
    strength: resolvedStrength
  };
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.uniforms.storybookSurfaceKind = { value: resolvedKind };
    shader.uniforms.storybookSurfaceStrength = { value: resolvedStrength };
    shader.fragmentShader = shader.fragmentShader
      .replace(VOXEL_FACET_DECLARATIONS_MARKER, `${VOXEL_FACET_DECLARATIONS_MARKER}\nuniform float storybookSurfaceStrength;\n${STORYBOOK_SURFACE_GLSL}`)
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= storybookHandcraftedVoxelColor(vVoxelSurfaceKind, vVoxelWorldPosition, vVoxelWorldNormal);")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = storybookHandcraftedVoxelRoughness(vVoxelSurfaceKind, vVoxelWorldPosition, vVoxelWorldNormal, roughnessFactor);");
  };
  material.customProgramCacheKey = () => `${previousCacheKey?.() ?? material.type}|storybook-surface-v2:${useSurfaceKindAttribute ? "attribute" : resolvedKind}`;
  material.needsUpdate = true;
  return material;
}
