# PR G — Playable MVP Integration / City-Day Experience

## Goal

Turn the completed gameplay MVP into a coherent player-facing daily experience without adding new gameplay systems.

This PR integrates the already-implemented card system, Agent strategy flow, turn scheduler, exposure incidents, Arcane Officer response, Owl Daily facts/reporting, and existing 3D city viewer into one asynchronous city-day loop.

Core experience:

> The player returns at dawn, receives yesterday's Owl Daily, makes one meaningful card decision, then leaves. The Agent may act later and asynchronously. The city's visible time of day tells the player what phase of the city-day has actually happened.

This PR must not create a second simulation clock. Visual time is a projection of existing turn/workflow state only.

---

## 1. Product flow

Target loop:

`DAWN`
→ Owl flies through city and opens Owl Daily
→ player dismisses newspaper with a swipe in any direction
→ short visual transition from dawn toward early morning
→ three-card player choice
→ optional manual special-structure placement
→ player turn completes
→ short visual transition into morning
→ `MORNING` waits for actual Agent activity
→ Agent performs planning/building/delegated placement during `DAY`
→ exposure / incident response phase moves city into `NIGHT`
→ Agent/system finishes assignments + resolveTurn + Owl report preparation
→ next `DAWN`

The player is not expected to stay online while the Agent works.

---

## 2. Critical authority / async constraint

MAGTOPIA cannot assume the game server can actively wake or invoke the player's Agent.

Agent work may begin because of:

- an external timer/automation;
- a user instruction outside the game;
- an Agent reconnecting later;
- another external trigger.

Therefore:

- completing the player's card choice MUST NOT automatically imply Agent work has started;
- the game MUST NOT fake progress based only on elapsed wall-clock time;
- after the player completes their choice, the city remains in `MORNING` until the system observes real Agent gameplay activity for that turn;
- an Agent being merely connected/online is not enough to transition into `DAY`;
- use the first meaningful, accepted Agent gameplay command/action for the current turn as the start-of-work signal;
- if the Agent disconnects after beginning work, do not rewind the visual phase.

Do not add Agent heartbeat/online-state complexity just to support this PR.

---

## 3. Visual city-day state model

Introduce a lightweight presentation state derived from authoritative gameplay/workflow facts.

Recommended semantic phases:

### `DAWN`

Meaning:

- previous turn is fully resolved;
- Owl Daily for the previous turn is available or the system has enough state to present the completed day;
- next player-facing day is ready.

Visual direction:

- cool/warm dawn light;
- soft low sun;
- morning haze/fog if compatible with current renderer;
- city mostly quiet.

At normal post-first-day entry, the Owl delivery sequence begins here.

### `EARLY_MORNING`

Meaning:

- the newspaper has been dismissed;
- player is reading/choosing today's cards or performing the resulting manual placement.

This does not need to be a gameplay enum stored in simulation state if it is purely local UI transition state.

Visual direction:

- gently brighter than dawn;
- transition should happen while moving from newspaper to card choice, not as a hard scene cut.

### `MORNING`

Meaning:

- player decision for the turn is complete;
- any required player placement is complete, or the chosen placement has been delegated;
- Agent has not yet performed a meaningful gameplay action for this turn.

This state may last minutes or many hours.

Visual direction:

- stable pleasant morning;
- no progress spinner required;
- player may freely inspect/screenshot the city.

This is the required idle/waiting state when the Agent has not started.

### `DAY`

Meaning:

- the Agent has actually begun current-turn city work;
- planning/building/roads/delegated special placement and other non-incident work are underway or have occurred.

Visual direction:

- normal daylight;
- optionally progress very slowly through late morning / noon / afternoon / dusk as actual Agent actions continue;
- these subdivisions are visual interpolation only, not new gameplay turn states.

Do not drive economy/population/resource settlement from this interpolation.

### `NIGHT`

Meaning:

- the turn has entered exposure/incident response work;
- Arcane Officer assignments and incident handling are the active semantic phase, or the Agent has moved into the final strategy/resolve stage associated with those incidents.

Visual direction:

- nighttime city lighting;
- exposure/Arcane Officer work should feel naturally associated with this phase.

### Return to `DAWN`

Meaning:

- all turn work has completed;
- standard `resolveTurn()` has settled exactly once;
- immutable TurnFacts exist;
- the report for that completed day is ready for the next player session or can be surfaced when available according to existing report semantics.

The city can remain at dawn indefinitely until the player returns.

---

## 4. No second time system

This PR MUST preserve the existing gameplay rule:

- wall clock controls unlock/deadline only;
- `resolveTurn()` is the only strategic settlement;
- visual sunlight/time-of-day never generates resources, population, exposure, incidents, policies, or extra turns.

Forbidden architecture:

- realtime resource tick based on sun position;
- “night reached, therefore resolve”; 
- elapsed-hours-driven automatic Agent progress;
- visual day cycling independently through all phases while no gameplay action occurred.

Visual phase is an output of workflow state, not an input to gameplay truth.

---

## 5. Entry behavior and session restoration

On opening the game, derive the correct visible experience from persisted authoritative state.

Cases:

### First-ever city/day with no previous Owl Daily

- show dawn/early-morning city;
- skip Owl delivery/report sequence;
- enter today's card choice directly after a short dawn → early-morning transition.

### Previous day complete, new report available, current player choice pending

- show `DAWN`;
- play Owl fly-through once for this new report/day in the current player experience;
- open the newspaper.

### Newspaper already dismissed but card choice still pending

- restore directly to the three-card choice at `EARLY_MORNING`;
- do not replay the owl/report every reload.

Persist or deterministically derive enough player-experience acknowledgement state to avoid replay loops.

### Player already chose card, Agent has not begun

- restore `MORNING`;
- no card UI;
- no fake Agent progress.

### Agent has begun city work

- restore `DAY` at an appropriate daylight point derived from actual workflow/activity state.

### Agent is handling incidents / final strategy

- restore `NIGHT`.

### Turn finished while player was away

- next opening returns to `DAWN` and presents the newly completed Owl Daily.

Reloading or reopening must never let the player choose a second card for the same turn.

---

## 6. Owl Daily presentation

The Owl Daily should feel like an in-world newspaper, not a generic modal or debug report.

MVP behavior:

- at `DAWN`, an owl flies across/through the city view;
- the motion transitions naturally into the newspaper opening in the foreground;
- newspaper content uses the existing OwlReport model (`masthead`, edition, headline, lead, articles, briefs, actionBox/tomorrowWatch where available);
- no new gameplay facts may be invented in the UI;
- report data remains bound to the existing system-facts/Agent-narrative contract.

Dismiss interaction:

- swipe/drag the newspaper in ANY direction;
- once movement passes a comfortable threshold, continue the sheet outward and dismiss it;
- avoid requiring a small close button as the primary interaction;
- keyboard/mouse accessibility may keep a secondary explicit close affordance if useful.

After dismissal:

- begin the short dawn → early-morning light transition;
- then reveal today's three cards.

Do not require final newspaper art direction or elaborate print layout in this PR. The structure and interaction matter more than decorative polish.

---

## 7. Three-card choice UI

Use the existing canonical card offer API and system-owned values.

Layout:

- three options should be centered in the viewport;
- portrait/narrow screens: arrange the three cards vertically;
- landscape/wide screens: arrange horizontally;
- cards do NOT need playing-card proportions;
- choose comfortable responsive proportions that allow enough information to be read.

Each card should have room for:

- title;
- type/category cue;
- concise description;
- key mechanical effect;
- duration/remaining semantics when relevant;
- for special structures, clearly indicate that placement follows selection.

The UI must not expose editable effect values.

Selection:

- clear selected/pressed state;
- submit through existing authoritative card API;
- handle version conflict / stale offer gracefully by refreshing authoritative state;
- never locally apply gameplay effects before server acceptance.

Special structure card after selection:

- ask whether to `自己放置` or `交给 Agent`;
- both choices resolve the same underlying card, not two cards.

Resource/personnel/policy cards complete the player action immediately after successful server selection.

---

## 8. Manual special-structure placement

For `player_place`, enter a lightweight placement mode inside the existing city viewer.

Requirements:

- preserve the current far/near camera system and current camera interaction;
- do not force a new fixed camera;
- highlight legal placement opportunities clearly without overwhelming the scene;
- show the selected structure footprint preview on hover/touch candidate where practical;
- allow confirm/cancel/back before final placement;
- final placement MUST use existing authoritative `/cards/place` validation;
- illegal placement responses must be reflected visually and must not consume the entitlement.

Cancelling the UI does not cancel the card/entitlement unless an explicit gameplay cancel action exists. The player can return to the pending placement experience.

After a successful manual placement, the player's turn is complete.

For `delegate_to_agent`, no placement mode opens; transition directly toward `MORNING` after successful selection.

---

## 9. Player-turn completion transition

After the player has completed everything required of them for the current turn:

- remove card/placement UI;
- move visual light a small additional step from `EARLY_MORNING` into stable `MORNING`;
- do not jump immediately into daytime;
- do not show an artificial “Agent is working” state yet.

The city should simply feel ready for the day.

If helpful, a subtle non-blocking status may communicate that today's decision has been made and the city is awaiting its Agent, but avoid large management-dashboard UI.

---

## 10. Detecting meaningful Agent work

Define a server-owned/read-only signal that allows the viewer to distinguish `MORNING` from `DAY`.

The signal must be based on accepted current-turn Agent gameplay activity, not presence.

Examples of qualifying activity may include:

- accepted planning/building commands;
- accepted road/construction commands;
- completed delegated special placement;
- accepted strategy/assignment activity where it semantically belongs to the current workflow.

Prefer reusing existing events/command receipts/audit state rather than adding a parallel activity log solely for UI.

The first qualifying Agent action for the current turn transitions presentation into `DAY`.

If no qualifying action has occurred, stay in `MORNING` indefinitely.

---

## 11. Daylight progression during Agent building

During `DAY`, visual time may advance gradually toward afternoon/dusk.

Important:

- progress should be tied to observed Agent workflow/action progression where practical, with time-based interpolation only for visual smoothness;
- do not assume a fixed real-world duration for Agent work;
- a 30-second Agent run should still look coherent;
- a multi-hour gap should not loop multiple suns or produce multiple days;
- clamp within daytime until the workflow semantically reaches incident handling.

MVP may implement a simpler deterministic mapping such as:

- first meaningful building action → morning/daylight;
- additional accepted construction activity → noon/afternoon interpolation target;
- strategy/incident phase → transition to night.

Exact sun-angle values are rendering details and may be tuned during implementation.

---

## 12. Transition into night / incident phase

Move to `NIGHT` when the authoritative workflow indicates the Agent is handling exposure incidents / Arcane Officer strategy or final incident-resolution phase.

Do not transition to night merely because enough real time elapsed.

Existing incident/strategy data remains system authoritative.

Night UI can remain minimal in this PR. The primary requirement is that the city visually communicates the phase while the Agent works asynchronously.

Do not add a player incident-management UI; incident assignment remains Agent responsibility in this MVP.

---

## 13. Report readiness and next dawn

After the turn settles:

- `resolveTurn()` remains the sole gameplay settlement;
- TurnFacts become immutable as today;
- Owl Daily generation/publication remains under the existing SYSTEM facts + Agent narrative contract;
- when the completed day's report is available for player presentation, next-day experience is `DAWN`.

The UI must tolerate a short gap between settlement and report publication if the existing asynchronous flow allows it.

Do not fabricate an Agent newspaper from raw facts in the player UI.

If settlement is complete but the Agent-authored report is not yet available, keep a coherent completed-day/dawn state and surface the report once it exists; exact fallback messaging should be minimal and must not pretend the Agent authored text it did not submit.

---

## 14. Existing minimal HUD and pure-view mode

Preserve current MAGTOPIA visual principles:

- do not reintroduce the old large management dashboard;
- current compact resource display stays lightweight;
- card/report experiences overlay the existing 3D city;
- pure-view / screenshot mode must still be able to hide all UI;
- avoid permanent status panels for this flow.

The city remains the main screen.

---

## 15. Responsive/mobile behavior

This PR must be usable on mobile from the first playable test.

Required:

- portrait three-card layout: vertical;
- landscape: horizontal;
- safe-area aware;
- newspaper swipe works with touch and pointer input;
- placement mode remains compatible with existing touch camera controls;
- avoid tiny text/actions;
- avoid covering nearly the entire city with persistent chrome after player decision is complete.

Performance:

- owl/newspaper animations must not materially damage the existing 60Hz rendering target;
- pause/reduce expensive background animation when a large newspaper overlay obscures most of the scene if useful;
- respect current bokeh/performance architecture rather than introducing a second render path.

---

## 16. Persistence / acknowledgement state

The experience requires remembering which presentation steps the player has already acknowledged for the current day/report.

At minimum solve:

- whether a specific Owl Daily edition/report has been presented/dismissed;
- whether today's card choice is still pending;
- whether a player-owned placement remains pending;
- whether the player turn is complete.

Gameplay truth remains in existing server state. UI acknowledgement may use an appropriate lightweight persisted mechanism, but it must not weaken multi-device correctness.

Prefer server-associated acknowledgement for anything that would otherwise cause duplicate report/card flows across devices; purely cosmetic animation progress may stay local.

Do not create a second source of truth for card selection or turn phase.

---

## 17. Suggested presentation derivation

Prefer one derived `cityDayPresentation`/equivalent read model rather than scattering checks through UI components.

It should expose enough read-only information such as:

- `phase`: dawn / early_morning / morning / day / night;
- current turn;
- completed report available?;
- report already dismissed?;
- card choice pending/selected/skipped;
- player placement pending?;
- Agent meaningful-work-started?;
- incident/strategy phase active?;
- turn settled?;
- next unlock/deadline where useful.

This is a presentation projection. It must not become a second gameplay state machine that can diverge from scheduler/turn state.

---

## 18. Testing / acceptance

At minimum cover:

1. First-ever session skips missing newspaper and reaches card choice.
2. Completed prior day opens at dawn and presents its Owl Daily.
3. Dismissing newspaper advances to card choice without changing gameplay state.
4. Reopening after report dismissal does not replay the same mandatory report flow.
5. Portrait layout stacks three cards vertically.
6. Landscape layout lays them out horizontally.
7. Selecting a resource/personnel/policy card completes the player action exactly once.
8. Special card exposes `player_place` and `delegate_to_agent` for the same card.
9. Manual placement keeps existing near/far camera behavior.
10. Illegal manual placement does not consume/complete the pending entitlement.
11. Successful manual placement completes the player portion of the turn.
12. Delegating special placement completes the player portion without opening placement mode.
13. After player completion, visual phase becomes/stays `MORNING` while no Agent action occurs.
14. Advancing wall clock alone does not move MORNING → DAY.
15. Agent presence/connection alone does not move MORNING → DAY.
16. First accepted meaningful Agent gameplay action moves presentation to `DAY`.
17. Agent disconnect after work started does not rewind to MORNING.
18. Repeated Agent actions do not create extra gameplay turns.
19. Daylight interpolation never changes resources/population/exposure by itself.
20. Incident/Arcane Officer strategy phase moves presentation to `NIGHT` based on authoritative workflow state.
21. Real-time elapsed duration alone cannot force NIGHT.
22. Standard resolve settles exactly once and eventually returns presentation to next `DAWN`.
23. Reload during MORNING restores MORNING with no duplicate card choice.
24. Reload during DAY restores DAY.
25. Reload during NIGHT restores NIGHT.
26. Turn completion while player is offline leads to DAWN/report experience on return.
27. If settlement exists but Agent-authored Owl Report is not yet published, UI does not fabricate prose.
28. Existing scheduler deadline behavior remains correct.
29. Existing card/strategy/Owl API authority tests remain green.
30. Pure-view mode can hide the new report/card/status UI.
31. Touch newspaper dismissal works in any swipe direction.
32. OpenAPI/playbook/docs are updated if new server read/ack endpoints or fields are introduced.

Include at least one integration/e2e-style test that walks:

`previous turn resolved/report ready → dawn report → dismiss → card select → morning wait → Agent action → day → incident phase/night → resolve → next dawn`

Use deterministic/injected time where rendering state depends on transitions. Do not sleep in tests.

---

## 19. Explicitly out of scope

Do NOT add in PR G:

- new card types or risk/reward cards;
- Arcane Officer XP/ranks/progression;
- officer portraits/moving photographs/biographies;
- new exposure mechanics;
- new economy systems;
- new incident families;
- player-controlled incident assignment;
- autonomous server wake-up/invocation of external Agents;
- heartbeat/presence platform;
- realtime economy;
- full weather system;
- final production newspaper art;
- final card illustrations;
- complex cinematic cutscenes;
- a new management dashboard.

This PR is integration and presentation only.

---

## 20. Completion requirements

Before marking ready for review, update the Draft PR body with:

- final city-day state mapping;
- exact signal used for first meaningful Agent activity;
- exact signal used for incident/night transition;
- Owl Daily acknowledgement/restoration behavior;
- responsive card UI implementation;
- manual special placement flow;
- dawn/early-morning/morning/day/night rendering approach;
- behavior when Agent never arrives;
- behavior when report publication lags settlement;
- persistence/multi-device acknowledgement approach;
- tests and screenshots/video where practical;
- explicit confirmation that no second simulation clock or realtime resource tick was introduced.

## One-sentence principle

The city clock should show what actually happened in the asynchronous turn: dawn delivers yesterday, morning waits for the Agent, daylight means the Agent is truly building, night means incidents are being handled, and only the existing turn settlement creates a new day.
