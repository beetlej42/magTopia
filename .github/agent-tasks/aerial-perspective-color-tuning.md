# Aerial perspective + Sunlit Storybook color tuning

## Context

PR #103 established the first runtime **Sunlit Storybook / 日光绘本** theme.

After merging and inspecting the real mobile city, two issues are visually clear:

1. the current built-in `THREE.Fog` reads as a strong white/cream fog layer rather than natural aerial perspective;
2. the large-area color relationships are still not as pleasant as the target direction. The current combination of olive grass, muted brown-red brick, very dark slate, and greenish low sky reads closer to an old model railway / military miniature palette than the intended bright, soft storybook miniature city.

The close view is already substantially better than the far view. Building geometry, Bokeh, and the overall lighting architecture are not the problem in this task.

Core visual principle remains:

> **Bright light, muted materials.**

This PR should refine the color relationships and replace traditional fog with a lightweight shader-based aerial-perspective treatment.

---

## Goal

For the same existing city:

- remove the visible “white fog” layer entirely;
- retain clear near-field materials and contrast;
- create subtle spatial depth in the middle/far city using aerial perspective rather than object disappearance;
- make the midday palette more appealing and coherent;
- keep the current close-view miniature/Bokeh quality intact;
- preserve the current performance budget.

The desired far-view behavior is:

```text
near:
full material identity
clear local contrast
normal saturation

mid:
slightly lower saturation
slightly softer contrast
slightly lifted shadows

far:
still visibly the same brick / stone / slate materials
more unified by the low-sky atmosphere color
not white
not washed out
not disappearing into fog
```

There is no need for a separate “extreme distance disappearance” system because the current playable scene is too small to require one.

---

## 1. Remove THREE.Fog completely

Remove the runtime use of `scene.fog` / `THREE.Fog` introduced by the Sunlit Storybook pass.

Requirements:

- Sunlit mode must not create or update `scene.fog`.
- Legacy mode does not need a separate fog implementation.
- remove or revise atmosphere diagnostics that describe fog near/far.
- remove obsolete `environment.fog`, `atmosphere.near`, and `atmosphere.far` values if they no longer have a real consumer.
- tests should explicitly verify that the product path does not depend on `THREE.Fog`.

Do not keep a tiny fallback fog “just in case”. The decision for this PR is intentional: **no traditional distance fog**.

---

## 2. Add lightweight voxel aerial perspective

Implement aerial perspective in the existing voxel material/shader path rather than as a new full-screen post-process.

The preferred place is the shared voxel shader customization path, likely:

- `src/render/voxelCurvedWorldTwinkle.js`
- and/or the shared material wrapper around it

Do not duplicate the same logic in multiple voxel material systems.

The effect should be cheap: a small number of uniforms + scalar/vector arithmetic and `mix()` operations in the existing fragment shader.

### Required behavior

Aerial perspective should be driven primarily by:

- camera-to-fragment distance;
- view direction / horizon-facing weight.

Optional:

- a mild height / skyline factor, if it can be implemented robustly and cheaply.

### Effect components

At increasing atmospheric weight:

1. **Saturation decreases slightly**
2. **Contrast decreases slightly**
3. **Dark/shadow values lift slightly**
4. **Color shifts subtly toward the current low-sky / horizon atmosphere color**

Do not make color converge to 100% atmosphere color within the playable world.

A good starting magnitude at the furthest normal visible city distance:

- saturation reduction: roughly 15–25%
- contrast reduction: roughly 10–20%
- atmosphere tint: roughly 10–20%
- black/shadow lift: subtle, enough to soften but not flatten

These are tuning ranges, not hard constants.

### Horizon weighting

The effect should be weaker when looking steeply down and stronger when looking toward the skyline.

Intent:

```text
looking almost straight down at nearby streets:
very little aerial perspective

oblique city view:
moderate

toward distant skyline / horizon:
strongest
```

This should prevent the entire ground plane from looking veiled.

### Skyline / vertical readability

If a height factor is added:

- distant lower building masses may blend more;
- tall towers/spires should retain a slightly clearer silhouette;
- do not create an obvious vertical gradient band.

This is optional for the first implementation; distance + view-angle weighting are required.

---

## 3. Aerial perspective color must track the live sky

Do not use a fixed white/cream atmosphere color.

The color should derive from the **actual low-sky presentation** at the current time of day.

Current voxel sky already has:

- topColor
- horizonColor
- a lower-sky `bottomColor` derived from horizonColor

The previous white-fog mismatch happened partly because the atmosphere color was brighter than the actually rendered low sky.

Create one explicit daylight/environment value such as:

`style.atmosphereColor`

derived from the live voxel sky state, close to the real visible lower-sky color.

Requirements:

- midday: neutral grey-blue / pale blue-grey, not greenish white;
- dawn/dusk: follows the warm/cool transition;
- night: becomes dark enough to avoid brightening the skyline unnaturally;
- no per-frame object allocation/DOM diagnostics in the render loop.

Update shared shader uniforms when daylight style updates, not by rebuilding materials.

---

## 4. Tune the low sky / horizon away from green

The current far-view screenshot shows a noticeable green-grey low-sky band.

Midday should remain clear and blue, but the lower sky should shift toward a more neutral warm-grey-blue.

Direction:

```text
zenith:
clear muted cyan-blue

middle:
soft pale blue

horizon / low sky:
neutral pale grey-blue
slightly warm if needed
but not visibly green
```

Starting-family examples only:

- upper sky around `#82AFC5`
- middle around `#AFC8CE`
- horizon around `#D1D5CC`

Do not turn midday into overcast weather.

Adjust `src/city/voxel-sky.js` and/or theme environment roles so the dome lower-sky calculation and aerial-perspective color are deliberately coordinated.

---

## 5. Tune large-area Sunlit Storybook colors

This is a small, controlled palette tuning pass. Do not redesign material semantics.

### Grass / terrain

Current grass reads too yellow/olive across large areas.

Move the Sunlit grass family toward **sage / grey-green**:

- less yellow
- slightly cooler
- still natural
- still muted

Suggested family direction only:

- base around `#7D8E6D`
- light around `#879879`
- dark around `#5E7354`

Do not increase overall saturation.

### Brick

Current brick reads slightly too brown/muddy.

Move it slightly toward warm terracotta:

- a little warmer/redder
- a little brighter
- still muted and historical

Example direction:

`#985D4D -> roughly #A66454`

Preserve coherent variant spacing.

### Slate

Current slate becomes a large near-black mass in dense blocks.

Keep it as the dark visual anchor but lift it slightly:

`#46515E -> roughly #515E69`

Maintain cool blue-grey identity.

### Limestone / sandstone

The close-view architecture already works well, but stone can become a little warmer and more parchment/cream-like.

Goals:

- bright sunlight feels warm rather than grey-white;
- no clipping to flat white under ACES;
- public/civic buildings keep strong readability.

Do not make stone yellow.

### Trees

Keep the newly centralized tree palettes consistent with the updated sage ground palette.

Trees may remain slightly deeper/richer than grass, but should not become the most saturated green object in the frame.

---

## 6. Preserve what already works

Do **not** change:

- building geometry
- road/city layout
- tree geometry or LOD
- Bokeh algorithm or focus behavior
- ACES tone mapping architecture
- shadow system
- sun-path / time-of-day mechanics
- Agent API
- gameplay/UI

Do not add:

- LUT
- full-screen atmospheric pass
- volumetric fog
- noise-based fog
- depth texture post-processing
- external assets

---

## 7. Shader architecture

Prefer one shared aerial-perspective implementation that all relevant voxel surfaces receive.

The current shared shader path already exposes world position in `voxelCurvedWorldTwinkle.js`:

`vVoxelWorldPosition`

Use that rather than adding redundant varyings if possible.

Recommended uniform set, naming flexible:

```js
aerialPerspectiveEnabled
aerialPerspectiveColor
aerialPerspectiveNear
aerialPerspectiveFar
aerialPerspectiveStrength
aerialPerspectiveHorizonStrength
```

“Near/Far” here describe the range of the **partial atmospheric effect**, not traditional fog extinction. The shader should clamp the maximum contribution well below 1.0.

If actual camera distance ranges make better normalization possible, use clear constants/configuration rather than magic numbers scattered through GLSL.

The uniforms should be updatable when the sky/daylight changes without recompiling shaders.

---

## 8. Performance

This visual improvement must remain extremely cheap.

Acceptance:

- no extra render pass;
- no additional scene traversal per frame;
- no geometry increase;
- no draw-call increase;
- no material proliferation;
- only a few arithmetic instructions in the existing voxel fragment shader;
- no per-frame DOM writes;
- no per-frame material recompilation.

If possible, compare far-view frame time before/after on mobile acceptance settings.

A repeatable >3% regression should be investigated.

---

## 9. Automated tests

Add focused tests where practical.

Required coverage:

1. Sunlit theme no longer enables traditional fog.
2. Product runtime does not create `THREE.Fog` for Sunlit.
3. aerial-perspective config has sane finite values and maximum blend is clearly below full extinction.
4. midday atmosphere color is finite and tracks the low-sky family.
5. night atmosphere color is materially darker than midday.
6. updated palette roles remain valid hex values.
7. existing sky/daylight tests remain green.
8. existing Bokeh/material/agent-city tests remain green.
9. CI remains green.

Do not create brittle screenshot-pixel assertions.

---

## 10. Manual visual acceptance

Primary reference: the same dense existing city on mobile.

Capture or inspect both:

- far view
- close view

At midday.

### Far-view acceptance

- no visible white fog layer;
- distant buildings do not turn white;
- distant red brick still reads as muted warm material;
- distant slate still reads dark/cool;
- skyline separates naturally from the sky;
- depth is visible through reduced contrast/saturation, not opacity-like whitening;
- low sky does not read green;
- large grass areas feel sage/soft rather than olive/military;
- image is brighter/more pleasant without becoming candy-colored.

### Close-view acceptance

- current Bokeh miniature feeling remains;
- foreground buildings retain contrast and color;
- brick/stone/slate relationship is at least as good as the current merged version;
- aerial perspective should not noticeably veil the focal building.

### Negative acceptance

Reject the result if any of these occur:

- far buildings look white/cream;
- the scene looks like foggy weather;
- all distant colors collapse into one flat color;
- grass becomes neon or yellow-green;
- brick becomes bright orange/red;
- roof loses its role as a dark anchor;
- close view becomes washed out.

---

## Primary files

Expected:

- `src/render/sunlitStorybookTheme.js`
- `src/render/voxelCurvedWorldTwinkle.js`
- `src/generators/voxelBuildingLab.js`
- `src/city/voxel-sky.js`
- `src/main.js`
- focused tests

Potential supporting files:

- shared material/shader helpers if needed to update uniforms cleanly
- agent tree theme values only for palette tuning

Before touching other files, confirm they are in the actual live `agentcity` / district voxel path.

---

## Delivery

Implement on this PR branch.

Before marking ready:

- CI green;
- summarize the final aerial-perspective formula and max contribution;
- report final changed palette values;
- if visual capture is available, attach far + close mobile screenshots;
- do not claim the visual target is met without seeing the rendered scene.
