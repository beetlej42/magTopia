# Vegetation Composition Overhaul

## Goal
Improve the visual richness and spatial composition of MAGTOPIA's existing procedural voxel vegetation without adding new external assets.

The current problem is not primarily raw asset count. Vegetation is generated independently per logical cell, which creates a sparse, evenly scattered look. The target is a miniature voxel city landscape with clear density gradients, clustered planting, stronger tree silhouettes, and preserved open-space rhythm.

This task must work for existing cities: reopening an existing city after this change should regenerate its procedural vegetation using the improved rules while respecting current buildings, roads, nodes, plazas, authored parks, and reserved cells.

## Scope
Primary files are expected to include:
- `src/generators/magicLondonVegetation.js`
- `test/vegetation.test.js`

Other files may be changed only when necessary to support the vegetation composition logic or tests.

## Constraints
- Voxel / low-poly procedural route only.
- Do not add GLB, image, texture, Hunyuan, relief, or other external vegetation assets.
- Continue using cheap Three.js primitive geometry and `InstancedMesh` where practical.
- Preserve the existing broadleaf / restrained park-green art direction.
- Preserve deterministic generation for the same city seed and state.
- Preserve suppression of procedural vegetation on occupied / infrastructure / node / reserved cells.
- Existing city saves must not require migration or reset.
- Do not solve this by merely increasing object counts uniformly.

## Required changes

### 1. Replace per-cell scatter with cross-cell composition
Introduce a deterministic cross-cell vegetation composition system so adjacent eligible cells can form shared vegetation clusters.

The visual result should contain:
- cluster cores with higher density,
- softer cluster edges,
- intentionally sparse or empty gaps,
- continuity across neighboring cells rather than every cell looking independently decorated.

Implementation details are flexible, but the cluster field must be deterministic from existing seed + grid/cell identity and must react correctly to currently occupied cells.

### 2. Keep meadow open but visibly richer
Current meadow coverage is too sparse. Increase low vegetation presence substantially, especially grass and flowers, while keeping meadow visually open.

Desired rhythm:
- open grass area,
- sparse flower/grass scatter,
- occasional shrub or small-tree edge,
- denser vegetation toward cluster boundaries or nearby grove/woodland.

Do not turn meadow into uniform shrubland or forest.

### 3. Strengthen grove / woodland density gradients
Grove and woodland should read as progressively denser layers rather than only different fixed item counts.

Prefer composition logic such as:
- meadow: mostly low layer with generous negative space,
- grove: mixed low/mid/high layers with visible clusters,
- woodland: strongest canopy grouping and understorey, while still avoiding regular spacing.

### 4. Increase tree silhouette diversity without new assets
Keep the existing procedural tree approach but add approximately two additional tree silhouette archetypes, or equivalent meaningful silhouette variation.

The goal is visible variation in:
- overall height,
- trunk-to-canopy ratio,
- crown width,
- crown verticality,
- number / arrangement of crown lobes.

The existing oak/lime identities can remain, but the rendered skyline should no longer look like repeated similarly sized green blobs.

Prefer a small number of strong archetypes over many trivial random variations.

### 5. Increase tree scale hierarchy
Within a cluster, create clearer hierarchy between dominant trees, medium trees, and smaller trees where appropriate.

Avoid uniform scale randomization. The desired result is a composed tree group with one or a few dominant silhouettes and supporting vegetation.

### 6. Existing-city compatibility
The improved logic must operate directly from current `grid` + `cityState` inputs.

A city that already contains buildings and roads should receive the upgraded vegetation automatically on reload. Procedural vegetation must not require save migration and must not appear inside currently occupied cells.

### 7. Performance discipline
Keep the existing low-cost rendering philosophy.

- Prefer instancing.
- Avoid per-frame procedural work; generation should remain plan/build time behavior.
- Avoid high-poly geometry or expensive new materials.
- Avoid introducing additional texture fetches.
- Do not materially regress mobile rendering cost solely to increase small ground-detail density.

## Acceptance criteria

### Functional
- Same seed + same grid + same city state => deterministic identical vegetation plan.
- Occupied, infrastructure, node, authored exclusion, and reserved cells remain vegetation-free as required by the existing contract.
- Existing city state requires no migration/reset.
- Procedural vegetation responds correctly when previously open cells become occupied.
- Existing `InstancedMesh` rendering path is retained for bulk vegetation.

### Visual / composition
- Adjacent open cells visibly form vegetation groups rather than independent equal scatter.
- Large open areas contain both denser clusters and intentional negative space.
- Meadow is richer at ground level but still reads as meadow.
- Grove reads denser and more layered than meadow.
- Woodland reads densest and has stronger canopy grouping than grove.
- Tree skyline has clearly more varied silhouettes and height hierarchy than current main.
- No obvious repeating four-anchor tree pattern should dominate large open areas.

### Tests
Update / extend `test/vegetation.test.js` to cover at minimum:
- determinism,
- occupied/reserved suppression,
- cross-cell clustering behavior or deterministic cluster metadata,
- preservation of forest-floor behavior where applicable,
- supported tree archetypes/species contract,
- instanced rendering path.

Tests should assert behavioral contracts rather than brittle exact object counts unless exact counts are essential to a rule.

## Non-goals
- No new standalone vegetation asset pack.
- No GLB vegetation.
- No image-based or texture-based foliage.
- No seasonal system.
- No new gameplay resource / ecology simulation.
- No vegetation save schema.
- No broad terrain-system rewrite.

## Review guidance
A change that only raises meadow/grove/woodland counts does not satisfy this task. The primary improvement must come from spatial composition and hierarchy across cells.

When reviewing visually, focus first on the existing developed city: vegetation should adapt to the remaining open-space shapes created by roads and buildings, producing believable clusters, edge planting, and open gaps instead of filling every leftover cell uniformly.
