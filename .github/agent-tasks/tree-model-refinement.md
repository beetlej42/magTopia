# Tree model refinement task

## Context

PR #85 has already merged and established the correct performance architecture: shared pre-generated tree geometry + `InstancedMesh`, deterministic grove placement, and shrubs remaining on the voxel/greedy path. Performance improved substantially, but manual visual acceptance shows the tree models themselves are still too primitive and too many trees are over-scaled relative to surrounding buildings.

The next iteration should **keep the #85 architecture** and focus narrowly on tree modeling quality and scale distribution.

## Keep from #85

- Keep shared pre-generated geometry + `InstancedMesh` for trees.
- Keep deterministic grove placement and exclusions.
- Keep shrubs on the voxel/greedy path unless a small visual tweak is necessary.
- Do not regress back to per-tree voxelization.
- Preserve the strong performance gains from #85.

## Modeling requirements

The current result reads as stacked boxes rather than mature trees. Implement the three normal families as intentionally modeled voxel silhouettes, not simple vertical box stacks.

### Broad-canopy

- Thick, relatively short trunk.
- Crown built from ~5–8 overlapping voxel masses across 2–3 vertical levels.
- Largest mass should sit in the lower/middle crown, with visible shoulders and slight asymmetry.
- Crown width target: ~0.65–0.9 of total tree height.
- Avoid flat rectangular top/bottom silhouettes.

### Round-canopy

- Medium-thickness trunk.
- Crown built from ~4–7 overlapping masses, widest through the middle and tapering toward top/bottom/sides.
- Crown width target: ~0.5–0.7 of total height.
- Should read as a full broadleaf crown, not a cube on a pole.

### Tall upright

- Use ~4–7 vertically offset masses to make a narrow but organic crown.
- Crown should be widest in the middle/upper-middle and taper toward the top.
- Crown width target: ~0.3–0.45 of total height.
- Must still have substantial foliage volume; no pole-with-cap silhouette.
- This family should be uncommon and used as an accent.

### Variation

- Provide at least 2 geometry variants per family (about 6 shared templates total) while retaining instancing.
- Variation should come from crown offsets/asymmetry, trunk proportion, controlled width/depth changes, rotation, and scale.
- Use only 2–3 foliage tone bands for volume; avoid noisy random color fragmentation.

## Scale distribution

The merged #85 scene makes too many trees building-scale or taller. Keep some large trees, but most trees should be materially smaller.

Target population mix:
- dominant: ~10–15%
- regular: ~55–65%
- small/support: ~25–35%

Visual height targets:
- small/support: ~1.5–2 storeys
- regular: ~2–3 storeys
- dominant: ~3.5–4.5 storeys, with only rare cases near ~5 storeys

The tall-upright family should not imply dominant scale by default; family and size tier are separate concepts.

## Composition acceptance

- Most of the city should read as regular-size mature trees, with occasional larger canopy trees.
- Groves should have clear height rhythm rather than all members competing with nearby buildings.
- Broad/round/tall must be visually distinguishable at normal gameplay distance.
- Trees must no longer read as stacked cuboids or placeholder props.

## Performance acceptance

- Preserve the #85 instanced-tree architecture.
- Tree draw calls should remain close to the shared-template count, not tree count.
- Do not materially regress #85 vegetation build time, rendered triangles, or draw-call proxy.
- Continue using the vegetation benchmark added in #85 to report any change.

## Completion model

Automated tests should cover family/template usage, tier distribution bounds, deterministic placement, and performance regression. Final visual quality remains manual user acceptance on an existing city.
