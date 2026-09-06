# Railway gateway implementation plan

## Map plan

The canonical city is 50 × 50 logical cells. Each Agent-world cell is 4 world
units (32 voxels at 0.125), so the planning field is 200 × 200 world units.
The older flat Studio terrain uses the same 50 × 50 logic at 2.88 world units
per cell. Layout is therefore expressed in cells and scales correctly in both
renderers.

The railway is an east-west through line near the north edge, targeting row 6
(12% of map depth). The planner may move it to the nearest dry row so the fixed
gateway footprint never overlaps water or shore.

```text
north / outside world
══════════════════════════  through railway (row ~6)
      [ 6 × 3 station ]     fixed footprint, levels 1–3
      [ plaza │ plaza ]     6 × 3 reserved forecourt
              │             paved threshold / urban connection point
              ▼ south
        first 5 × 6 district
```

The railway corridor, station and two forecourt halves are system-owned
infrastructure. The centre-most inner forecourt cell is rendered with a short
road-textured threshold but remains station paving in the authoritative graph.
This gives the player a visible starting stub while the bootstrap Agent still
learns the road command by extending the main street into the first district.

## Asset plan

- Track: voxel ballast, timber sleepers, twin iron rails and station platform.
- Train: one compact Victorian steam locomotive, tender and two coaches. It
  spawns west of the map, pauses at the platform, then exits east; no reversing,
  coupling or terminal operations are needed.
- Station: reuse the deterministic public-building massing compiler, then add
  railway-specific fixed elements. All levels keep a 6 × 3 footprint.
  - Level 1: low brick hall, gabled roof, simple platform canopy.
  - Level 2: taller booking hall, clock tower, longer iron-and-glass canopy.
  - Level 3: grand symmetrical frontage, taller clock tower, glazed train shed,
    gilded crest and denser facade rhythm.

## Integration and acceptance

The long-lived node id remains `old_town_entry` for API compatibility, but its
type becomes `railway_station_gateway`. It owns the station level and exposes a
single `urbanConnectionPoint`; road routing does not need railway knowledge.
Station upgrades are system commands with levels capped at three. Visual
acceptance covers the Studio railway mode and the player Agent-city renderer;
unit tests cover layout invariants, fixed footprint, asset diagnostics, road
routing from the station and upgrade costs/caps.
