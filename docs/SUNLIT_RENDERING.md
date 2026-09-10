# Sunlit rendering alignment

The default palette targets warm terracotta, cream stone, blue-grey slate and yellow-green vegetation. The main branch baseline is `660fdf0`; the previous local visual experiment was preserved as `codex/preserve-visual-experiment-20260910`.

## Rendering

- `src/render/sunlitStorybookTheme.js` centralizes building, terrain, foliage and sky colors. Runtime voxel meshes and decoded building artifacts share the same material roles; no artifact rebuild is required for the palette.
- The existing material shader groups direct diffuse lighting into three soft bands. The bounded Lambert correction keeps cast shadows and AO, with gentler shading on leaves and no banding on glass/water. No outline pass or new render target is introduced.
- Aerial perspective gradually reduces distant contrast and blends towards the current horizon color over 38–155 world units, capped at 24%. Its horizon weighting protects the downward-looking foreground. Night color comes from the day/night sky.
- Bokeh uses the same aperture/maximum radius on desktop and mobile. Radius is normalized to the viewport short edge instead of width, keeping the shape circular across portrait/landscape layouts. The existing half-resolution, depth-aware filter and shared scene depth remain in use; far view bypasses Bokeh.
- Tone mapping stays linear/NoToneMapping to retain the target's warm material colors. `?visualTheme=legacy` compares the original palette and lighting without toon/aerial changes; Bokeh's aspect correction remains active in both themes.

## Studio review

Start `pnpm dev:studio --port 4178`. Review `/studio?mode=district&worldTime=0.58&clock=0` or `/studio?mode=agentcity&worldTime=0.38&clock=0`. These deterministic local scenes differ from the deployed city layout in the supplied reference.

Capture desktop (1440×1000, DPR 1) and mobile-sized (390×844, DPR 2) views, near/far/night screenshots, GPU identity and settled/drag frame intervals:

```sh
STUDIO_MODE=district STUDIO_TIME=0.58 node scripts/capture-sunlit-studio.mjs district
```

`CHROMIUM_PATH` selects Chrome on other platforms; `STUDIO_URL` selects another local server. Results are in `artifacts/sunlit-alignment/`. This script uses native GPU rendering. A mobile viewport on a Mac is not a phone performance measurement.

Run the existing complete acceptance gate on native hardware:

```sh
RENDER_ACCEPTANCE_GPU=hardware \
RENDER_ACCEPTANCE_URL=http://127.0.0.1:4178 \
RENDER_ACCEPTANCE_DEVICE_SCALE_FACTOR=2 \
RENDER_ACCEPTANCE_DRAG_FRAMES=120 \
RENDER_ACCEPTANCE_MAX_P95_MS=17.2 \
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/run-render-acceptance.mjs
```

17.2ms allows browser timestamp rounding/jitter around 60Hz; it is not a strict 16.667ms GPU-time guarantee. Reports retain actual renderer, mean FPS and p95 frame interval. The palette/shader changes add no draw calls or full-screen passes. The Studio shadow correction adds shadow rendering for its authored plots; supported phones and the deployed city still need device measurements before claiming universal 60fps.

## Validation — 2026-09-10

- Main synchronized to `660fdf0`; implementation on `codex/sunlit-render-alignment`.
- Full unit suite: 669 passed, 5 skipped (database-dependent checks); focused rendering suite after the final shader change: 27 passed. Production build passed, retaining the existing bundle-size advisory.
- Native Apple M4 / Chrome, agent-city mobile viewport at DPR 2: near/far drag mean 60fps, p95 16.8ms. Near settled p95 16.7ms. No browser errors; shared depth active with zero fallback depth renders; far Bokeh disabled; return transition sampled at 0.117 before settling at full Bokeh. Full report: `artifacts/render-acceptance/report.json`.
- Studio district desktop and mobile-sized views: settled p95 16.8ms, drag p95 16.7ms; no browser errors. Screenshots reviewed at `artifacts/sunlit-alignment/district-{desktop,mobile}.png`, with `-far` and `-night` variants. Metrics: `artifacts/sunlit-alignment/district-report.json`.
- No phone hardware or deployed-city FPS measurement was performed. No deployment or push was performed.


## Correction: sunlight and shadow acceptance

The initial `district-*` screenshots are **not sufficient lighting acceptance**: the three authored Studio building plots used non-casting voxel meshes without the deployed runtime's persistent shadow proxies. The initial claim of visual acceptance is withdrawn; the prior frame timings did not include those missing building shadows.

The Studio district now explicitly enables opaque authored building meshes as shadow casters. This changes the review scene, not the deployed city's existing low-LOD proxy policy. Plot identity is retained on projected meshes because sphere projection reparents meshes out of their original plot containers. A regression assertion checks a real casting mesh for every plot after projection.

Run `STUDIO_MODE=district STUDIO_TIME=0.38 STUDIO_LIGHTING=1 node scripts/capture-sunlit-studio.mjs lighting-review`. In addition to the normal captures, this saves the same camera at times 0.32, 0.5 and 0.68, and fails if any authored plot has no shadow caster. Inspect roof/chimney self-shadow, courtyard occlusion, building silhouettes on grass/roads, opposite-facing walls and shadow direction across these views. These are normal lighting screenshots, without shadow-debug lighting.

Corrected screenshot entry: `artifacts/sunlit-alignment/lighting-review-desktop.png`; angle comparisons append `-sun-0.32`, `-sun-0.5`, `-sun-0.68`. The original deployed city layout and phone hardware still require separate validation before claiming final target parity.
