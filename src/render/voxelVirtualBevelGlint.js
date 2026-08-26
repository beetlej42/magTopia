import * as THREE from "three";

const VOXEL_GLINT_QUERY_PARAM = "voxelGlint";
const VOXEL_GLINT_MARKER = "// MAGTOPIA_VOXEL_VIRTUAL_BEVEL_GLINT_V1";
const VOXEL_DIRECT_SPECULAR = "reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );";

function queryFlagEnabled(name) {
  if (typeof globalThis.location?.search !== "string") return false;
  const value = new URLSearchParams(globalThis.location.search).get(name);
  return value === "1" || value === "true" || value === "on";
}

export function installVoxelVirtualBevelGlint() {
  if (!queryFlagEnabled(VOXEL_GLINT_QUERY_PARAM)) return false;

  if (!THREE.ShaderChunk.common.includes(VOXEL_GLINT_MARKER)) {
    THREE.ShaderChunk.common += `
#ifdef USE_COLOR
varying vec2 vVoxelGlintQuadUv;
varying vec3 vVoxelGlintWorldPosition;
#endif
${VOXEL_GLINT_MARKER}
`;
  }

  if (!THREE.ShaderChunk.begin_vertex.includes(VOXEL_GLINT_MARKER)) {
    THREE.ShaderChunk.begin_vertex += `
#ifdef USE_COLOR
  #if __VERSION__ >= 300
    float voxelGlintCornerIndex = mod( float( gl_VertexID ), 4.0 );
    if ( voxelGlintCornerIndex < 0.5 ) {
      vVoxelGlintQuadUv = vec2( 0.0, 0.0 );
    } else if ( voxelGlintCornerIndex < 1.5 ) {
      vVoxelGlintQuadUv = vec2( 1.0, 0.0 );
    } else if ( voxelGlintCornerIndex < 2.5 ) {
      vVoxelGlintQuadUv = vec2( 1.0, 1.0 );
    } else {
      vVoxelGlintQuadUv = vec2( 0.0, 1.0 );
    }
  #else
    vVoxelGlintQuadUv = vec2( 0.5 );
  #endif
  vVoxelGlintWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif
${VOXEL_GLINT_MARKER}
`;
  }

  if (!THREE.ShaderChunk.lights_physical_pars_fragment.includes(VOXEL_GLINT_MARKER)) {
    const virtualBevelGlint = `${VOXEL_DIRECT_SPECULAR}
#ifdef USE_COLOR
  #if __VERSION__ >= 300
    vec2 voxelGlintEdgeDistances = min( vVoxelGlintQuadUv, vec2( 1.0 ) - vVoxelGlintQuadUv );
    float voxelGlintEdgeDistance = min( voxelGlintEdgeDistances.x, voxelGlintEdgeDistances.y );
    float voxelGlintCornerDistance = max( voxelGlintEdgeDistances.x, voxelGlintEdgeDistances.y );

    float voxelGlintEdgeWidth = max( fwidth( voxelGlintEdgeDistance ) * 1.45, 0.002 );
    float voxelGlintCornerWidth = max( fwidth( voxelGlintCornerDistance ) * 2.1, 0.003 );
    float voxelGlintEdgeBand = 1.0 - smoothstep(
      voxelGlintEdgeWidth * 0.35,
      voxelGlintEdgeWidth * 1.8,
      voxelGlintEdgeDistance
    );
    float voxelGlintCornerBand = 1.0 - smoothstep(
      voxelGlintCornerWidth * 0.2,
      voxelGlintCornerWidth * 1.45,
      voxelGlintCornerDistance
    );

    // Non-linear decay keeps the virtual bevel bright right at the edge and
    // makes it disappear rapidly into the otherwise flat voxel face.
    float voxelGlintShape = max( voxelGlintCornerBand, voxelGlintEdgeBand * 0.34 );
    voxelGlintShape *= voxelGlintShape;

    // Stable world-space cells break long greedy edges into sparse glint
    // segments instead of turning every merged quad boundary into an outline.
    vec3 voxelGlintCell = floor( vVoxelGlintWorldPosition / 0.32 );
    float voxelGlintSeed = fract(
      52.9829189 * fract( dot( voxelGlintCell, vec3( 0.06711056, 0.00583715, 0.753 ) ) )
    );
    float voxelGlintSparse = smoothstep( 0.80, 0.94, voxelGlintSeed );

    float voxelGlintSunFacing = saturate( dot( geometryNormal, directLight.direction ) );
    vec3 voxelGlintHalfDirection = normalize( directLight.direction + geometryViewDir );
    float voxelGlintReflection = pow(
      saturate( dot( geometryNormal, voxelGlintHalfDirection ) ),
      20.0
    );
    float voxelGlintSunGate = smoothstep( 0.12, 0.62, voxelGlintSunFacing );
    float voxelGlint = voxelGlintShape
      * voxelGlintSparse
      * voxelGlintReflection
      * voxelGlintSunGate;

    reflectedLight.directSpecular += irradiance
      * vec3( 1.0, 0.96, 0.86 )
      * voxelGlint
      * 0.9;
  #endif
#endif
${VOXEL_GLINT_MARKER}`;

    THREE.ShaderChunk.lights_physical_pars_fragment = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace(VOXEL_DIRECT_SPECULAR, virtualBevelGlint);
  }

  return true;
}

export const voxelVirtualBevelGlintEnabled = installVoxelVirtualBevelGlint();
