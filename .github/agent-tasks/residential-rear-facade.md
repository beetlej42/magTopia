# Residential rear facade generation

## Goal

Make ordinary residential buildings visually complete from the rear without adding any Agent-facing decisions or requiring migrations of existing city/building data.

The rear facade must be part of the existing deterministic residential voxel compilation workflow, not a runtime neighborhood-dependent decoration pass.

## Product constraints

- Existing cities must benefit automatically after deployment/re-bake.
- Do **not** add Agent/OpenAPI parameters or guidance.
- Do **not** add a persisted `rearFacade` field to `BuildingSpec` or require city-state migration.
- Do **not** change existing chimney behavior.
- Do not make a building mesh depend on mutable neighboring buildings at render time.
- Scope the first version to ordinary residential/floor-stack buildings only. Public/special/urban-massing buildings must not silently inherit residential rear-facade rules.

## Intended architecture

Current floor-stack compilation is approximately:

```
BuildingSpec
  -> addBuilding()
       -> addFacade()
       -> addBackWall()
       -> addSideWall()
       -> addFacadeModules()
       -> addSideFacadeModules()
       -> addRoof()
       -> addChimneys()
  -> LOD / greedy mesh
  -> baked building artifact
```

Add a deterministic rear-facade planning/compilation step inside this workflow:

```
BuildingSpec
  -> deriveRearFacade(building)     // deterministic, not persisted
  -> addBackWall(... rear openings ...)
  -> addRearFacadeModules(...)
```

The derived rear facade should use only immutable building-owned inputs already present in old specs, such as:

- building id / seed
- footprint width
- floors / floorSpecs / floorHeight
- archetype / purpose
- existing material palette

Use a stable seed path such as `stableSeed(building.seed, building.id, "rear-facade")`.

## Visual MVP

Rear facade should remain simpler and more utilitarian than the front facade.

Expected baseline:

- 0–1 service/rear door, normally on ground floor
- sparse regular windows, roughly 1–3 per floor depending on width
- simple frames using the existing trim/material vocabulary
- optional very small canopy/door-step detail if it can reuse existing primitives cleanly
- no shopfront language, main entrance treatment, full balconies, magic-window emphasis, or front-facade flower-box density

The result should read as a lived-in rear elevation, not a rotated copy of the front facade.

## Existing wall integration

The current `addBackWall()` fills the back wall as a solid surface. Update the rear wall generation so opening voxels are omitted before rear modules are inserted, analogous to the existing front/side approach.

Prefer reusing existing opening/module helpers and material semantics where practical instead of creating a parallel rendering system.

## Cache / baked artifact requirement

Generator code changes currently do not change `designRevision` or the design/spec hash for already-built homes. Therefore existing baked meshes would otherwise remain valid-looking to the cache.

Introduce an explicit mesh/compiler revision into baked-mesh cache identity so geometry-generation changes can invalidate immutable artifacts without pretending that the MTBA binary format changed.

Suggested direction:

```
BUILDING_MESH_COMPILER_VERSION = <new integer>

render source identity =
  hash(design/spec identity + mesh compiler version)
```

Keep binary artifact format versioning conceptually separate from compiler/generator versioning unless a binary contract change is actually required.

The implementation must ensure:

- existing ready artifacts generated with the previous compiler identity are treated as stale/not-current
- backfill/requeue can rebuild them
- rebuilt artifacts produce a new manifest SHA / city artifact pack identity
- browser `force-cache` cannot keep the old city pack after manifest identity changes
- fallback/source rendering still works while an artifact is absent/rebuilding

A one-time re-bake of existing affected buildings is acceptable. Avoid runtime invalidation triggered by later construction/demolition of neighboring buildings.

## Side facades

Do not expand this task into dynamic neighbor-aware side-wall mutation.

Existing persisted `adjacency` / `sideFacades` behavior can remain as-is. The rear facade should depend only on the building's own immutable spec.

## Tests

Add/adjust tests to cover at least:

1. deterministic rear-facade output for the same legacy-compatible BuildingSpec + seed
2. residential rear wall contains openings/modules instead of remaining a pure wall
3. non-residential/special/urban-massing paths are not unintentionally changed
4. old BuildingSpec data without any new rear-facade field compiles successfully
5. baked artifact/cache identity changes when mesh compiler version changes, even when design revision/spec hash do not
6. stale prior compiler artifacts are not exposed as current and are requeued/backfilled through the existing artifact pipeline
7. existing baked artifact codec/pack tests still pass

If practical, add a focused back-view visualization regression test using the existing building visualization path.

## Review focus

Review will specifically check:

- no Agent/OpenAPI cognitive load added
- no city-state or BuildingSpec migration required
- no mutable-neighborhood dependency introduced into immutable mesh cache
- deterministic seed behavior
- cache invalidation correctness for existing cities
- rear visual language remains subordinate to the front facade
- LOD/greedy-mesh path includes the new geometry
- tests exercise the baked artifact lifecycle, not only the direct generator
