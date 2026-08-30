# Runtime voxel vegetation composition task

## Problem

PR #83 improved `src/generators/magicLondonVegetation.js`, but existing cities rendered through `/cities/:id` / `agentcity` do not use that generator.

The live path is:

`src/main.js` → `createAgentAcceptanceCity()` → `createAgentVoxelVegetationLayer()` in `src/generators/agentVoxelInfrastructure.js`.

The runtime vegetation still performs independent per-cell rolls and uses a single basic voxel tree silhouette, so existing cities show no visible change after #83.

## Goal

Move the vegetation-composition overhaul into the actual runtime voxel vegetation path used by existing cities.

## Required behavior

- Replace independent per-cell scatter with deterministic cross-cell grouping / density composition so adjacent open cells can form coherent vegetation clusters.
- Preserve intentional negative space instead of uniformly filling all available cells.
- Preserve and strengthen biome hierarchy. Woodland should read denser than open meadow/heath without leaking woodland-grade rules into other biome cells.
- Add clear tree scale hierarchy such as dominant / medium / small.
- Increase tree silhouette diversity using procedural voxel geometry only. Aim for roughly 3–4 clearly distinct broadleaf archetypes.
- Do not add GLB, image, Hunyuan, or other external vegetation assets.
- Keep existing building, road, infrastructure, reservation, and non-buildable exclusion behavior, including the visual safety margin around construction and roads unless there is a well-tested reason to change it.
- Existing city state must require no migration. Reloading the same state should regenerate vegetation from the new runtime rules.
- Same state + seed must remain deterministic.
- Continue using `VoxelInstanceBuffer` and the current greedy/batched voxel rendering path. Avoid material proliferation and meaningful draw-call regression.

## Runtime proof and diagnostics

Visual inspection of a real existing city is not a coding-agent completion requirement. Instead, make runtime wiring objectively testable.

Expose enough diagnostics on `AgentAcceptanceVegetation.userData.contract` to prove the new composition is executing in the product path. Useful diagnostics include, where appropriate:

- renderer/version identifier
- cluster/group count
- vegetated-cell count
- tree archetype counts
- dominant / medium / small tree counts
- tree / shrub / flower totals

Names do not need to match exactly; the contract should make the active algorithm obvious.

Add an integration-level or generator-level test that exercises the same path used by `createAgentAcceptanceCity()` and demonstrates that `AgentAcceptanceVegetation` is using the new runtime composition. Do not rely only on tests for `magicLondonVegetation.js`.

## Automated acceptance

1. Same state + seed is deterministic.
2. Buildings, roads, infrastructure, reservations, and non-buildable cells remain excluded.
3. Safety-margin behavior around construction and roads does not regress.
4. Cross-cell grouping exists; the implementation is not just higher independent per-cell probabilities.
5. Multiple tree archetypes and scale tiers are reachable and represented in diagnostics.
6. Biome density hierarchy remains coherent and biome rules do not leak across cells.
7. `createAgentAcceptanceCity({ cityState })` or equivalent runtime path exposes the new vegetation contract.
8. Existing `cityState` schema needs no migration.
9. CI remains green.

## Manual visual acceptance

After automated/runtime checks pass, the user will inspect an existing city and judge:

- vegetation reads as natural clusters rather than evenly scattered dots;
- meadow/open land keeps breathing room;
- tree groups have obvious height and silhouette variation;
- roads and building entrances remain visually clear;
- no obvious grid or bucket pattern is visible.

Do not block implementation on the coding agent being able to perform this visual step.

## Non-goals

- No new external vegetation assets.
- No GLB/Hunyuan/image-relief route.
- No city-state schema redesign.
- Do not remove PR #83; reuse its composition ideas where useful, but the real target is `createAgentVoxelVegetationLayer()`.
- Do not declare success by only increasing `treeChance` or `shrubChance`.

## Primary target

- `src/generators/agentVoxelInfrastructure.js`

Likely supporting runtime/test files:

- `src/generators/agentAcceptanceCity.js`
- tests covering agent voxel infrastructure and the agent-city runtime path
