# Interactive Special Building Placement

## Goal

Replace the current button-list placement flow for player-placed special buildings with an in-world 3D placement mode that behaves like a city-builder placement tool.

This PR is intentionally separate from gameplay-rules work. It changes player placement UX and rendering only; server authority and `/cards/place` validation remain authoritative.

## Product behavior

### Entry

When a player chooses a `special_structure` card and selects **自己放置 / player_place**:

1. Enter a persistent placement session for that card/placement mandate.
2. Do not show legal lots as UI buttons.
3. Preserve normal city camera navigation, including pan, zoom, and camera rotation.
4. Keep a visible but lightweight cancel action for the whole placement session.

### Far view = navigation mode

Far view exists to move across the city quickly.

While placement is active and the camera is in the existing far-view state:

- allow pan / zoom / camera rotation normally;
- do not render a building ghost;
- do not render rotate-building or confirm-placement controls;
- keep only the placement-session cancel action plus a small non-blocking status such as `正在放置 · <building name>`;
- zooming back to near view resumes placement instead of ending the session.

No hidden candidate should be committed or selected while in far view.

### Near view = placement mode

When the camera is in the existing near-view state:

1. Determine the lot/cell under the same FOV-center selection pipeline already used by the viewer for center-focused building/district interactions. Do not create a second incompatible definition of "screen center" unless unavoidable.
2. Render the special building preview on that center target.
3. As the camera pans and the FOV center moves into a different lot/cell, snap the preview naturally to the new center target.
4. Show three icon-first controls:
   - cancel placement session;
   - rotate building by 90°;
   - confirm placement.
5. Do not present a scrollable/list/button representation of legal lots.

The placement target follows camera translation. Camera rotation alone must not rotate the building.

## Camera rotation vs building rotation

These are separate state variables.

- Camera/world-view rotation changes how the player looks at the city.
- Building rotation changes the proposed building orientation in world coordinates.
- Rotating the camera must leave the proposed building's world orientation unchanged.
- Pressing the rotate-building control rotates the building exactly 90° in world space.

The UI should make this distinction unambiguous.

## Ghost preview

Prefer a real massing preview over a footprint-only marker so the player can judge scale, frontage, height, and relationship to nearby buildings.

Recommended visual treatment:

- clone/reuse the actual building preview geometry when practical;
- replace normal materials with a uniform translucent placement material;
- valid candidate: muted blue-green / cyan-green ghost consistent with city-builder convention;
- invalid target: red-tinted ghost and/or clear red outline;
- optional subtle edge outline is acceptable if it improves voxel readability;
- preserve normal depth testing so the preview remains spatially understandable among surrounding buildings;
- avoid an always-visible x-ray rendering through existing buildings.

Preview transforms must use the real footprint, scale, pivot, and orientation used by final placement so confirmation does not visibly jump.

## Candidate and legality model

Do not request `/site-searches` every render frame or on every camera movement.

Preferred flow:

1. On entering placement, fetch the authoritative legal candidate set for the pending special placement.
2. Build a local lookup keyed by lot/cell identity and relevant orientation/frontage facts.
3. Re-evaluate the current FOV-center target locally whenever center selection changes.
4. Re-evaluate on building rotation because footprint dimensions and entrance orientation may change.
5. On confirm, submit the authoritative `/cards/place` command with the selected candidate/orientation and existing version/idempotency semantics.
6. The server remains the final authority; stale/invalid placement errors must return the player to a usable placement state rather than silently exiting.

If the existing site-search contract does not provide enough orientation-specific legality information, make the smallest contract change needed rather than moving authority entirely into the client.

### Invalid center targets

The preview may remain visible on an invalid center target so the player understands what they are trying to place, but:

- visually mark it invalid;
- disable confirm;
- expose a very short contextual reason when available, e.g. occupied lot, incompatible frontage, outside buildable terrain, footprint collision;
- do not open a large modal or candidate list.

If there is no meaningful lot/cell under the center, hide the ghost and disable confirm.

## View transitions

### Near → far

- hide ghost preview;
- hide rotate + confirm controls;
- preserve placement session, chosen building rotation, and pending mandate;
- keep cancel/status affordance.

### Far → near

- wait until the camera is actually in the near-view state;
- derive the new FOV-center target from the resulting camera state;
- then show/snap the ghost at that new target;
- do not animate the ghost flying from an old far-view target across the map.

## Cancel behavior

Cancel is required in both near and far view.

Cancel means **exit the player's local placement session**, not place the building and not implicitly delegate it to the Agent.

Preserve the underlying pending player-placement mandate unless the existing gameplay contract explicitly defines cancellation semantics. If the current contract has no way to abandon/rechoose the card decision, the UI should return to the appropriate current city-day state without inventing a server mutation.

Do not use browser navigation/back as the only way out.

## Controls and layout

Keep placement UI minimal and screenshot-friendly.

Near view:
- cancel icon;
- rotate icon;
- confirm/check icon;
- optional tiny status/reason text.

Far view:
- cancel icon;
- tiny `正在放置 · <name>` status;
- no rotate/confirm.

Use the project's existing icon/button visual language. Avoid text-heavy floating panels.

## Integration constraints

- Reuse the existing near/far camera states instead of adding a third zoom model.
- Reuse the existing FOV-center selection mechanism where possible.
- Placement rendering must not interfere with camera touch/pointer handling.
- Keep the previous mobile full-screen-layer tap regression in mind: no invisible fixed overlay may intercept city interaction when it is not visibly interactive.
- Camera pan/rotate/zoom must remain responsive on mobile.
- Do not regress pure-view / UI-hidden behavior outside placement mode.
- Do not change Agent-delegated special-structure behavior in this PR.
- Do not change gameplay balance, card generation, or turn scheduling in this PR.

## Expected state model

A small explicit client placement state is preferred, e.g. conceptually:

- `activePlacement`
- `viewMode: far_navigation | near_preview`
- `centerLotId`
- `buildingRotationQuarterTurns`
- `candidate`
- `isLegal`

Avoid encoding placement state indirectly through DOM visibility alone.

## Acceptance criteria

1. Pick special-structure card → choose `自己放置` → placement session starts.
2. No legal-lot button list is shown.
3. User can zoom to far view, pan across the city, and rotate the camera with no building ghost or rotate/confirm controls shown.
4. Returning to near view shows the building ghost on the current FOV-center target.
5. Panning in near view causes the ghost to snap to the new center lot/cell without network requests per frame.
6. Camera rotation does not change building world orientation.
7. Rotate-building changes proposed orientation by 90° and refreshes footprint/frontage legality.
8. Valid targets show a valid ghost state and enable confirm.
9. Invalid targets show an invalid state and disable confirm.
10. Confirm submits exactly one `/cards/place` logical command using existing `Idempotency-Key` and optimistic version behavior.
11. Successful placement exits placement mode and the real building appears at the previewed location/orientation without a visible transform jump.
12. Server rejection/stale version leaves the player in a recoverable placement session and refreshes authoritative candidates/state as needed.
13. Cancel works in both near and far view and never silently places or delegates the building.
14. Mobile touch navigation remains functional and no invisible placement layer swallows map gestures.

## Suggested tests

- placement session state transitions: entry, near/far, cancel, success, rejection;
- FOV-center target changes update preview locally;
- no site-search fetch storm during camera movement;
- camera rotation and building rotation are independent;
- rotated 1x2 / 2x1 footprint legality;
- confirm disabled on invalid/no target;
- correct `/cards/place` payload, placement id, city version, orientation and idempotency behavior;
- placement session survives far-view navigation;
- DOM/pointer regression ensuring hidden controls/layers do not intercept map input;
- mobile viewport interaction test;
- full `node --test` and `vite build`.

## Non-goals

- redesigning general construction for the Agent;
- drag-and-drop buildings under a finger;
- free continuous-angle building rotation;
- changing server dice/economy/exposure rules;
- changing the new-turn/card loop;
- modifying PR #51 gameplay rule consolidation.

## Implementation notes (PR #52 round 1)

Decisions made while implementing this plan, per first-round review:

- **Cancel is a durable local exit.** Cancelling marks the pending `placement_id`
  as locally dismissed (client memory only, keyed by placement id). The
  periodic city-day sync will not reopen the same cancelled placement; a page
  reload restores the pending placement, and a fresh `placement_id` opens
  normally. No server mutation is invented.
- **Ghost is a phased massing fallback.** A pending special-structure placement
  has no server-authored building design to clone (`voxelDesign` exists only
  after `/cards/place` completes), so the ghost renders a per-cell voxel
  massing with a roof cap over the real footprint cells
  (`ghost.userData.ghostMode === "massing-voxel-fallback"`). Cloning the final
  per-card geometry for the ghost is the explicit visual follow-up.
- **`/site-searches` is authoritative eligibility hints, not a closed
  allow-list.** The candidate payload is bounded by `limit` and is default-
  orientation only, so `isLegal` is judged by a local mirror of the server's
  occupancy/frontage rules over the render-state; candidate hints steer the
  preferred entrance and the resolved target exposes `candidateHint`. The
  server remains the final authority at `/cards/place`. An orientation-aware
  server candidate contract is the smallest follow-up if a stricter local gate
  is ever required.

