# Tree and grove visual redesign task

## Context

PR #84 correctly wired deterministic clustered voxel vegetation into the actual `/cities/:id` / `agentcity` runtime, but the first visual result is not acceptable. The runtime composition is technically working, yet the landscape reads as noisy and toy-like: too many tiny independent shrubs, tree silhouettes are thin and under-scaled next to 3–5 storey buildings, and the mixture of many small props destroys clean lawn/park negative space.

A concept image was reviewed and accepted as the target direction: larger, more realistic voxel trees, clear silhouette families, tree heights that visually match surrounding buildings, and vegetation composed mainly as sparse groves instead of field-wide scatter.

## Goal

Redesign runtime voxel vegetation around **fewer, larger, better-looking tree groves**.

The primary visual unit should be a grove/tree group, not independent tree and shrub props scattered across every meadow cell.

## Tree design requirements

Use procedural voxel geometry only. No GLB, image, Hunyuan, or external vegetation assets.

Implement three realistic, visually coherent tree families:

1. **Broad-canopy tree** — main workhorse. Thick/shorter trunk, wide and heavy crown, strong horizontal mass.
2. **Round-canopy tree** — secondary family. Compact, full rounded crown with a clear natural broadleaf silhouette.
3. **Tall upright tree** — accent family. Taller and narrower, but still with substantial crown volume; must not read as a pole with a small green cap.

Do **not** add a hero/special tree archetype in this PR. Special/landmark trees can later exist as authored special buildings/assets.

Tree variation should come from controlled differences within these families: height, crown width/depth, slight crown asymmetry/offset, trunk thickness, and modest proportion changes. Avoid random fragmented voxel noise.

## Scale relative to buildings

Trees must visually match the current MAGTOPIA street-house scale.

Target approximate visual ranges:

- small/support tree: ~1.5–2 storeys
- regular city/park tree: ~2.5–3.5 storeys
- dominant tree inside a grove: ~4–5 storeys and may reach or slightly exceed nearby rooflines

Do not simply stretch trunks. Crown width and crown mass should increase at least as much as overall height. Prefer a substantial mature-tree silhouette over a thin/tall one.

## Grove composition

- Preserve the deterministic clustered runtime architecture from #84.
- Make groves the main visible vegetation feature.
- Typical visible grove should contain roughly 2–6 trees, with one dominant tree and supporting trees of different size/family where space allows.
- Trees within a grove may overlap crowns slightly so the grove reads as a coherent green mass at distance.
- Grove composition should show obvious height/width rhythm rather than equal-size repeated props.
- Keep large areas of meadow/lawn visually clean. Do not fill open grass with scattered tiny decorations.
- Woodland/background terrain may use denser grove coverage, but still as grouped masses rather than uniform noise.

## Low vegetation

The current independent shrub scatter is visually noisy and should be heavily reduced.

- Remove or reduce meadow-wide independent shrub scatter by roughly 80–90% relative to the #84 result.
- Low shrubs/flowers should primarily be subordinate detail **inside or immediately around tree groves**, not standalone dots spread across the whole lawn.
- Large meadow areas should be allowed to contain no low vegetation at all.
- Preserve negative space as a first-class visual goal.

## Runtime and safety constraints

Keep the successful technical behavior from #84:

- actual `createAgentVoxelVegetationLayer()` runtime path
- same state + seed remains deterministic
- no city-state migration
- building, road, infrastructure, reservation and non-buildable exclusions
- one-cell construction/road visual safety margin unless a tested improvement replaces it
- current `VoxelInstanceBuffer` greedy/batched rendering approach
- no meaningful draw-call/material proliferation regression

Existing cities should automatically render the new visual design on reload so visual iteration remains easy during development.

## Diagnostics / automated acceptance

Update tests/diagnostics so code review can verify:

1. Runtime still reports the new vegetation renderer/composition path.
2. Same state + seed is deterministic.
3. Exclusion and safety-margin tests remain green.
4. Only the three intended normal tree families are used.
5. Tree height/crown proportions stay inside defined design ranges; the tall family must still have substantial crown mass.
6. Grove groups contain tier/size variation where enough trees are present.
7. Meadow low-vegetation density is substantially lower than the #84 behavior and large clean meadow regions remain possible.
8. Shrubs/flowers are preferentially associated with groves instead of uniform cell scatter.
9. CI remains green.

## Manual visual acceptance

The coding agent is not expected to autonomously judge final visual quality. After automated checks pass, the user will inspect an existing city and judge:

- trees feel mature and realistically proportioned next to buildings;
- all three tree families are attractive and visually distinct while sharing one style language;
- the tall tree does not look like a pole;
- tree groups read as coherent groves/green masses;
- lawns and open ground have strong clean negative space;
- low vegetation no longer looks like randomly scattered voxel debris;
- distant landscape is calmer and more natural than the #84 screenshot.

## Primary target

- `src/generators/agentVoxelInfrastructure.js`
- `test/agentVoxelInfrastructure.test.js`

Avoid unrelated changes.