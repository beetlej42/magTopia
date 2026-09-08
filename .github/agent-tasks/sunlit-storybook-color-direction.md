# Sunlit Storybook runtime color-direction task

## Context

MAGTOPIA already has the right broad art-direction language in `docs/ART_DIRECTION.md` and `docs/VISUAL_TARGET.md`: warm brick, slate blue-grey roofs, warm sandstone/limestone, restrained vegetation, warm window light, cool shadows, and a soft isometric miniature-city presentation.

The live runtime, however, does not yet enforce that direction from one source of truth. Color and lighting decisions are currently distributed across at least:

- `src/generators/voxelBuildingLab.js` — `MATERIAL_LIBRARY`
- `src/generators/voxelIntentDistrict.js` — macro terrain / road / parcel palette and fallback colors
- `src/city/voxel-sky.js` — sky stops and cloud colors
- `src/main.js` + `voxelDaylightStyle()` — scene/world lighting
- related runtime voxel vegetation / infrastructure paths where direct color literals still exist

The current midday presentation can therefore drift toward a brighter, more game-like blue/green palette than the intended painterly miniature-city look.

This task establishes the first runtime implementation of the visual direction internally named:

**Sunlit Storybook / 日光绘本**

Core principle:

> **Bright light, muted materials.**
>
> Daylight should feel clear and luminous, while material colors remain restrained, slightly aged, and harmonized.

This PR is a color-direction / environment-rendering PR only. Do not use it as an opportunity to redesign geometry or gameplay.

---

## Goal

For the same existing city, same camera, same geometry, and same time of day, make the runtime read as a coherent warm historical miniature city under clear daylight:

- warm but muted brick and stone;
- dark slate roofs as visual anchors;
- restrained olive / natural greens rather than vivid game greens;
- blue-grey / grey-cyan atmospheric sky rather than saturated cartoon blue;
- warm-white sunlight with cool-grey ambient shadows;
- visible atmospheric depth in mid/far distance;
- warm windows and magic colors remain sparse accents;
- no heavy “Harry Potter LUT” or yellow/brown global filter.

The preferred default should be the new Sunlit Storybook theme, with an explicit legacy A/B switch retained for review.

---

## Required implementation

### 1. Create one runtime visual-theme source of truth

Add a dedicated module, recommended:

`src/render/sunlitStorybookTheme.js`

The exact API is flexible, but it must centralize semantic color roles rather than introduce another set of duplicated literals.

Recommended structure:

```js
{
  id: "sunlit-storybook",
  materials: {
    brickRed,
    brickBrown,
    sandstone,
    limestone,
    stoneShadow,
    slate,
    timber,
    iron,
    patinaMetal,
    grass,
    grassLight,
    grassDark,
    foliage,
    foliageLight,
    foliageDark,
    soil,
    road,
    pavement,
    water,
    waterLight,
    warmWindow,
    violetMagic,
    tealMagic
  },
  environment: {
    middaySkyTop,
    middayHorizon,
    cloudLight,
    cloudShadow,
    fog,
    sun,
    ambientSky,
    ambientGround
  },
  grading: {
    exposure
  }
}
```

Prefer immutable hex/string data or otherwise avoid exporting shared mutable `THREE.Color` objects that callers can accidentally mutate via `.lerp()` / `.copy()`.

The project should be able to identify the active theme in diagnostics / DOM dataset.

### 2. Centralize the building/material palette

Refactor `MATERIAL_LIBRARY` in `src/generators/voxelBuildingLab.js` to consume the theme for color values.

Keep material behavior such as roughness, opacity, metalness, emissive semantics, and surface-kind classification in the appropriate material code; this task is not a material-system rewrite.

Preserve the existing semantic IDs such as:

- `brickRed`
- `brickBrown`
- `sandstone`
- `limestone`
- `slate`
- `timber`
- `grass*`
- `foliage*`
- `road`
- `pavement`
- `water*`
- `warmWindow`
- `violetMagic`
- `tealMagic`

Do not let Agent/building APIs start accepting arbitrary RGB/HEX values in this PR.

### 3. Tighten material variation

Keep the existing 3–4 color variants per material where useful, but reduce the “confetti” effect.

Intent:

- variants should read as one material family first;
- local variation should be mostly subtle luminance / temperature drift;
- grass/foliage variants should not jump into bright yellow-green;
- brick variants should remain warm/earthy without becoming saturated red;
- slate should remain a dark blue-grey anchor.

Use the existing `storybookSurfaceMaterial` system; do not replace it.

### 4. Centralize live terrain / road / water colors

Refactor the live runtime palette in `src/generators/voxelIntentDistrict.js` and any directly relevant agent-city runtime/fallback paths so terrain, parcels, roads, pavement, water, soil, and stone consume the same theme roles.

Examples of current duplicated runtime literals include the macro terrain palette around:

- grass `#76925a`
- grassLight `#91a967`
- grassDark `#4f7047`
- water `#4389a8`
- road `#696c70`
- pavement `#a8a198`
- parcel `#8d9e69`

Do not blindly replace every color literal in the repository. Scope this first pass to the actual voxel city / agent-city product path and obvious fallback surfaces used by that path.

### 5. Recalibrate the midday voxel sky

Update `src/city/voxel-sky.js` so midday remains clearly sunny/blue but shifts from vivid cartoon blue toward a slightly greyed cyan-blue with a warmer, lighter horizon.

Initial target family, not hard acceptance values:

- zenith / upper sky: around muted blue-cyan, e.g. `#88B4CA`
- horizon: pale grey-cyan / warm atmospheric neutral, e.g. `#D8DFD5`
- cloud light: warm off-white / parchment white
- cloud shadow: cool neutral grey-blue

Do not make midday look overcast.

Do not damage the existing dawn/dusk/night cycle. The user already likes the more atmospheric morning/evening direction. Midday is the primary tuning target, while adjacent sky stops should interpolate naturally.

### 6. Recalibrate voxel daylight

Keep the existing architecture of `voxelDaylightStyle()`; tune it rather than replacing the whole day/night system.

Midday intent:

- sun = warm white, not orange/yellow;
- ambient sky = pale grey-cyan;
- ambient ground = restrained warm grey-green;
- shadows remain readable and slightly cool;
- daytime rim contribution should be subtle, not a visible colored edge light;
- back streets remain readable without flattening the model.

Suggested sun family: roughly `#FFF1D3`, subject to actual screenshot tuning.

The existing “stylized daylight lower than a physical noon sun so cast shadows remain readable” intent should be preserved.

### 7. Add lightweight atmospheric perspective

Introduce distance fog / atmospheric blending for the voxel city product path.

Preferred first implementation: built-in `THREE.Fog` or an equivalently cheap solution. Do not add a new expensive full-screen atmospheric pass.

Requirements:

- fog color should track the horizon/atmosphere, not pure white;
- near buildings must retain their material identity;
- mid-distance should begin to lose contrast/saturation;
- far-distance structures should converge toward the horizon color;
- the effect must work with the existing curved world and current Bokeh path;
- the sky dome itself should remain visually coherent and must not be accidentally flattened by the fog implementation.

Choose near/far distances from the current world/camera scale rather than copying arbitrary values without testing. Expose the chosen values in diagnostics or constants so they are easy to tune.

### 8. Enable explicit tone mapping

The renderer currently uses sRGB output. Add an explicit filmic tone-mapping baseline, preferably `THREE.ACESFilmicToneMapping`, and a documented exposure value.

Do not add a heavy LUT in this PR.

The desired result is:

- softer highlight rolloff;
- bright sunny walls without harsh clipping;
- dark slate/brick still retain detail;
- no global sepia cast.

Confirm the current `OutputPass` pipeline behaves correctly with the selected renderer tone-mapping settings.

### 9. Preserve Bokeh architecture

Do not redesign `AdaptiveBokehPass`, focus behavior, blur kernel, or motion policy in this PR.

The intended compositing relationship is:

```text
semantic palette
  -> storybook surface material
  -> world lighting
  -> atmospheric perspective
  -> existing Bokeh
  -> output / tone mapping
```

If tone-mapping/output ordering requires a small technical adjustment, keep it minimal and document why.

### 10. Add an A/B visual-theme switch

Add a startup/debug switch so the same city can be rendered with old and new color direction without reverting code.

Recommended URL parameter:

`?visualTheme=legacy`
`?visualTheme=sunlit`

New theme should be the default unless there is a concrete compatibility blocker.

Expose the resolved theme in a DOM dataset / runtime diagnostic, e.g.:

`data-magic-town-visual-theme="sunlit-storybook"`

Legacy mode must be close enough to the previous runtime to make screenshot A/B useful; it does not need to preserve every internal implementation detail.

---

## Initial palette direction

These are starting points / families, not pixel-perfect required constants. Tune against the actual city.

### Buildings

- brick: muted terracotta / earthy red
- dark brick: brown-red rather than purple/black
- sandstone/limestone: warm parchment / cream-grey, never pure white
- slate: dark blue-grey, one of the darkest large-area materials
- timber: deep brown / green-brown, not pure black
- iron: charcoal, not absolute black

### Nature

- grass: muted olive / natural yellow-green
- trees: restrained broadleaf greens with clear light/dark hierarchy
- avoid bright lime/yellow-green on large areas

### Accents

- warm windows: amber-gold
- magic violet / teal: keep as sparse high-information accents
- do not increase magic saturation to compensate for the muted base palette

### Approximate composition rule

Keep the existing art-direction intent:

- majority: brick / stone / roof / road neutrals
- secondary: sky / water / vegetation
- small accent: warm window light, transport red, magic colors

No large-area neon or candy palette.

---

## Visual acceptance

The primary acceptance image is **midday**.

Use an existing dense city, fixed seed/state, fixed camera, fixed viewport, fixed `worldTime` near midday. Capture:

1. Desktop legacy
2. Desktop Sunlit Storybook
3. Mobile legacy
4. Mobile Sunlit Storybook

Also sanity-check morning and dusk with the same camera so the new midday calibration does not create broken transitions.

The new midday image should satisfy:

- the city still feels bright and sunny;
- brick is warm but not saturated red;
- slate roofs clearly anchor the composition;
- grass/trees feel natural and slightly muted;
- stone walls can get bright but do not clip to flat white;
- sky is blue/clear but less synthetic;
- horizon is lighter/greyer/warmer than zenith;
- mid/far city loses contrast into the atmosphere;
- shadows are readable, not black;
- no obvious global yellow/sepia filter;
- windows/magic accents remain special rather than competing with the whole city;
- existing voxel/storybook texture does not become noisier.

The key review question is:

> **Same city, same geometry: does the new image look materially closer to a polished “sunlit storybook miniature city” purely through color and environment rendering?**

---

## Performance acceptance

This is not a visual effect that may spend a new large frame budget.

- No new expensive post-processing pass.
- No meaningful draw-call increase.
- No meaningful geometry/instance-count increase.
- Fog/tone mapping should use existing/built-in cheap paths.
- Desktop and mobile frame time should remain within normal measurement noise; investigate a repeatable regression above roughly 3–5%.
- Existing mobile adaptive-quality and Bokeh behavior must remain intact.

Record before/after frame-time observations in the PR when available.

---

## Automated acceptance

Add focused tests where practical.

At minimum cover:

1. The Sunlit Storybook theme exposes all semantic roles required by the live voxel building + terrain paths.
2. Theme selection resolves `legacy` vs `sunlit` deterministically.
3. Midday `voxelDaylightStyle()` returns finite/valid lighting values and preserves the expected warm-sun / cool-ambient relationship.
4. Voxel sky midday remains daytime and interpolates correctly around adjacent time values.
5. Existing material semantic IDs and building contracts remain valid.
6. Existing Bokeh/mobile-performance tests remain green.
7. CI remains green.

Do not add brittle screenshot-pixel tests unless the existing test infrastructure already supports them robustly.

---

## Documentation

Update `docs/ART_DIRECTION.md` / `docs/VISUAL_TARGET.md` only as needed to formalize:

- internal direction name: **Sunlit Storybook / 日光绘本**
- principle: **Bright light, muted materials**
- midday as the baseline lighting condition
- runtime palette is semantic and centrally controlled

Do not rewrite the documents wholesale; the current art direction is already broadly correct.

---

## Non-goals

- No building geometry redesign.
- No tree-model redesign.
- No road-layout or city-generation changes.
- No Bokeh algorithm redesign.
- No heavy LUT / cinematic color-grade pass.
- No UI redesign.
- No gameplay changes.
- No Agent API redesign.
- No arbitrary RGB/HEX controls for Agents.
- No new external assets.
- No changes justified only by making a single hero screenshot look dramatic.

---

## Primary files

Expected primary implementation targets:

- `src/render/sunlitStorybookTheme.js` (new)
- `src/generators/voxelBuildingLab.js`
- `src/generators/voxelIntentDistrict.js`
- `src/city/voxel-sky.js`
- `src/main.js`

Likely supporting files:

- runtime voxel vegetation / infrastructure files if they contain duplicated live-path color literals
- focused tests under `test/`
- `docs/ART_DIRECTION.md`
- `docs/VISUAL_TARGET.md`

Before changing a supporting file, confirm it participates in the live voxel city / agent-city path.

---

## Delivery

Implement on this PR branch.

Before marking ready for review:

- run CI/local test suite;
- attach or link fixed-camera legacy vs Sunlit Storybook screenshots if the environment permits;
- report desktop/mobile frame-time comparison if measurable;
- summarize any palette/light/fog values changed after visual tuning;
- call out any requirement intentionally deferred.

If local visual capture is unavailable, do not invent a visual success claim. Complete the objective runtime/test wiring and leave the PR in Draft for visual review.
