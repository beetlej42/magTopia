# Tree model refinement task

## Context

PR #85 has already merged and established the correct performance architecture: shared pre-generated tree geometry + `InstancedMesh`, deterministic grove placement, and shrubs remaining on the voxel/greedy path. Performance improved substantially, but manual visual acceptance shows the tree models themselves are still too primitive and too many trees are over-scaled relative to surrounding buildings.

The next iteration should **keep the #85 architecture** and focus narrowly on tree modeling quality and scale distribution.

The accepted visual target is not a Minecraft-style stack of rectangular boxes. Trees should read as **low-resolution voxel sculptures**: chunky and clearly voxel-built, but with deliberate tapering, overlap, silhouette rhythm, and believable broadleaf massing.

## Keep from #85

- Keep shared pre-generated geometry + `InstancedMesh` for trees.
- Keep deterministic grove placement and exclusions.
- Keep shrubs on the voxel/greedy path unless a small visual tweak is necessary.
- Do not regress back to per-tree voxelization.
- Preserve the strong performance gains from #85.

## Modeling requirements

The current result reads as stacked boxes rather than mature trees. Implement the three normal families as intentionally modeled voxel silhouettes, not simple vertical box stacks.

### Sculpted voxel crown rule

Major crown masses must themselves be shaped, not left as untouched full rectangular cuboids.

- Build crown masses as stepped voxel volumes with 2–4 size changes from lower/middle mass toward top and outer edges.
- Use stepped inset/outset layers so top, bottom and side profiles taper instead of ending in large flat rectangular faces.
- Prefer overlapping chunky sub-volumes that merge into one readable crown silhouette at gameplay distance.
- Avoid large full-width flat top faces, large rectangular side walls, and obvious `box + box + box` stacking.
- Preserve the blocky voxel character: all modeling coordinates and major faces remain grid-aligned; do not use smooth spheres, arbitrary vertex rotations, or non-voxel curved geometry.
- Silhouette is the priority. Internal detail that cannot be read at normal gameplay distance is unnecessary.

### Trunk and crown transition

The trunk must feel structurally connected to the crown rather than like a pole inserted into a green block.

- Lower foliage should overlap or partially wrap the upper trunk.
- Broad and round families may use 1–2 coarse grid-aligned branch stubs before the crown begins.
- Branch stubs should be thick and short, supporting major crown masses; do not add thin twig detail.
- Trunk thickness should increase with tree size tier. Dominant broad/round trees should visibly carry heavier trunks than small/support trees.
- Keep enough lower trunk visible that the object still clearly reads as a tree rather than a foliage column.

### Broad-canopy

- Thick, relatively short trunk.
- Crown built from ~5–8 overlapping sculpted voxel masses across 2–3 vertical levels.
- Largest mass should sit in the lower/middle crown, with visible horizontal shoulders and intentional left/right or front/back asymmetry.
- Crown width target: ~0.65–0.9 of total tree height.
- Lower crown should be broad and heavy; upper layers should step inward rather than forming a flat roof.
- The overall silhouette should read as a mature spreading broadleaf tree.

### Round-canopy

- Medium-thickness trunk.
- Crown built from ~4–7 overlapping sculpted masses.
- Widest through the middle; taper clearly toward top, bottom and lateral edges.
- Crown width target: ~0.5–0.7 of total height.
- Use stepped perimeter changes to create a rounded block silhouette rather than a cube.
- The crown should feel compact and full, with no obvious single rectangular primary block.

### Tall upright

- Use ~4–7 vertically offset sculpted masses to make a narrow but organic continuous crown.
- Crown should be widest in the middle/upper-middle and taper progressively toward the top.
- Crown width target: ~0.3–0.45 of total height.
- Must still have substantial foliage volume; no pole-with-cap silhouette.
- Avoid a repeated vertical stack of equal boxes; successive masses should vary in width/depth and offset while remaining grid-aligned.
- This family should be uncommon and used as an accent.

### Foliage tone placement

Use 2–3 foliage tone bands to reinforce volume spatially, not as arbitrary horizontal stripes.

- darkest tone: primarily lower crown, recessed/interior overlaps, and underside masses;
- mid tone: majority of crown volume;
- light tone: mainly upper and outer-facing stepped surfaces / smaller highlight masses.
- Do not assign colors randomly per voxel and do not split the crown into obvious flat horizontal color slabs.
- The palette should remain coherent across all tree families so diversity comes from form first, color second.

### Variation

- Provide at least 2 genuinely different geometry variants per family (about 6 shared templates total) while retaining instancing.
- Variants must differ in silhouette, not merely recolor or uniformly rescale the same template.
- Variation should come primarily from crown offsets/asymmetry, trunk/branch proportion, controlled width/depth changes, template choice, and scale.
- A variant should still be immediately identifiable as belonging to its family.

### Grid-aligned rotation

Trees must preserve the orthogonal voxel language of MAGTOPIA. Do **not** use arbitrary free yaw rotation on tree instances.

- Quantize tree yaw to 90-degree increments only: 0°, 90°, 180°, 270°.
- Near-symmetric broad/round variants may intentionally use fewer orientations (for example 0°/90° only) if that avoids redundant visual states.
- Do not rotate the geometry itself off-grid to manufacture variety.
- Variation should come from modeled geometry variants, size tiers, crown asymmetry, trunk/crown proportions, and grove composition rather than arbitrary angles.
- Add an automated assertion that every emitted tree rotation is grid-aligned within floating-point tolerance.

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

## Explicit anti-goals

Reject implementations that achieve the numeric proportions but still visually resemble placeholders.

Do not ship:
- a trunk with one large rectangular crown block;
- three or four full cuboids simply stacked vertically;
- flat tabletop crowns;
- equal-width vertical foliage columns;
- tiny caps on long trunks;
- many small disconnected noisy foliage cubes;
- arbitrary diagonal yaw/rotation;
- family variants that are only scale or color changes.

If the silhouette still reads as a few primitive boxes at normal gameplay distance, the modeling requirement is not met even if automated proportion tests pass.

## Composition acceptance

- Most of the city should read as regular-size mature trees, with occasional larger canopy trees.
- Groves should have clear height rhythm rather than all members competing with nearby buildings.
- Broad/round/tall must be visually distinguishable at normal gameplay distance.
- Each family should retain a coherent shared visual language while its variants avoid copy-paste repetition.
- Trees must read as sculpted voxel broadleaf forms, not stacked cuboids or placeholder props.
- Tree silhouettes must remain visually aligned with the voxel/grid world; no obvious diagonal instance rotations.
- At normal gameplay distance, crown masses should visually merge into a clear overall silhouette rather than reading as independent boxes.

## Automated/model diagnostics

Automated checks cannot judge beauty, but should guard the intended construction:

- only the approved broad/round/tall families are emitted;
- at least two shared geometry variants are reachable per family;
- tree yaw is always grid-aligned;
- tier population stays near the requested dominant/regular/support distribution;
- family crown-width/height ratios remain within their design bands;
- dominant trunks are thicker than support-tree trunks within comparable families;
- each template uses multiple crown masses and multiple stepped levels rather than a single crown cuboid;
- tall variants taper across levels rather than using equal-width repeated boxes;
- rendered triangle and draw-call diagnostics remain within the #85 performance envelope.

## Performance acceptance

- Preserve the #85 instanced-tree architecture.
- Tree draw calls should remain close to the shared-template count, not tree count.
- Do not materially regress #85 vegetation build time, rendered triangles, or draw-call proxy.
- Adding ~6 sculpted shared templates is acceptable; do not increase complexity by returning to per-tree unique geometry.
- Continue using the vegetation benchmark added in #85 to report any change.

## Completion model

Automated tests should cover family/template usage, tier distribution bounds, deterministic placement, grid-aligned tree rotation, basic modeled-geometry structure, and performance regression.

Final acceptance remains manual visual inspection on an existing city. The visual benchmark is the previously approved concept direction: mature, chunky, sculpted voxel trees with clean silhouettes and believable scale against the miniature city. If the result still looks materially simpler than that concept, iterate before calling the task complete.
