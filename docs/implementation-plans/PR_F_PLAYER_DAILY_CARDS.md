# PR F — Player Daily Cards and Policy System

## Goal

Complete the MVP human → Agent → city → Owl Daily loop with a server-authoritative daily three-choice card system.

Each newly opened turn gets one canonical three-card offer. The player may choose exactly one card. The selected card changes the city's direction or gives the Agent a mandate, but must not let the player or Agent forge gameplay effects.

The MVP offer always contains one card from each of these categories:

1. Special structure / facility / magical plant
2. Resource / personnel
3. City policy

Tradeoff / risk-reward event cards are reserved for a later PR.

Core product principle:

> The player uses cards to change the direction and fate of the city, rather than taking over the Agent's day-to-day work. The Agent is responsible for turning the player's choice into city action.

## Read first

Before implementation, sync the latest `main` and read:

- `docs/CORE_GAMEPLAY_DESIGN.md`
- `docs/CORE_GAMEPLAY_IMPLEMENTATION_PLAN.md`
- `docs/agent-playbook.md`
- PR C/D/E merged strategy API, turn scheduler, and Owl Daily implementation
- `src/gameplay/simulation.js`
- `src/gameplay/schema.js`
- `src/gameplay/owl-report.js`
- `apps/server/app.js`
- `apps/server/openapi.js`

Do not duplicate or bypass existing gameplay authority, scheduler, persistence, concurrency, building validation, population limits, or Arcane Officer hiring rules.

---

## 1. MVP card catalog

The first version contains 12 built-in cards.

All mechanical values must live in centralized system-owned configuration/catalog definitions, not in routes and not in client input.

### A. Special structures / facilities / magical plants — 5 cards

#### 1. Diagon Alley Entrance

Type: `special_structure`

Effect:

- Once placed, provides a concealment bonus to magical buildings in the same block.
- Exact values must be centralized in the card/effect catalog.

Placement decision:

- `player_place`: the player chooses a legal location.
- `delegate_to_agent`: the player delegates location selection to the Agent.

The system owns the structure's effect. Neither player nor Agent may submit concealment values or effect parameters.

#### 2. Owl Tower

Type: `special_structure`

Effect:

- Provides a modest population-attraction / community-prosperity benefit to its block.

MVP explicitly does not implement a real communication system.

This is also a future extension point for Owl Daily / communication features.

Supports `player_place` and `delegate_to_agent`.

#### 3. Floo Fireplace Station

Type: `special_structure`

Effect:

- Provides a small prosperity or population-growth benefit to its block.

MVP explicitly does not implement transport simulation or a transport graph.

Supports `player_place` and `delegate_to_agent`.

#### 4. Concealment Statue

Type: `special_structure`

Effect:

- Provides a stronger concealment bonus to a smaller local area.

Design distinction:

- Diagon Alley Entrance: broader same-block concealment.
- Concealment Statue: smaller radius, stronger local effect.

Supports `player_place` and `delegate_to_agent`.

#### 5. Moonlight Herb Plot

Type: `special_structure` / `magical_plant`

Effect:

- Produces a small amount of magic resource.
- Also creates a small exposure risk.

Purpose:

- Magical plants should exist as visible city objects in the MVP, not only as abstract modifiers.

Supports `player_place` and `delegate_to_agent`.

---

### B. Resources / personnel — 3 cards

#### 6. Ministry Grant

Type: `resource`

Effect:

- Immediately grants a fixed amount of coins.

Duration: `instant`.

The amount is system-owned and may not be supplied by the client.

#### 7. New Wizard Residents

Type: `resource`

Effect:

- Immediately adds a fixed number of wizard residents.

Duration: `instant`.

Must obey existing population capacity rules. This card must not bypass capacity enforcement or write population directly in the route layer.

#### 8. Arcane Officer Reinforcement

Type: `personnel`

Effect:

- Recruit one new Arcane Officer.

The new officer must have at least:

- `id`
- `name`
- `archetype`
- `investigation`
- `containment`
- `concealment`
- `specialties`
- `status`

The player-facing identity should be a real generated name, not primarily `officer-1`.

Reuse existing Arcane Officer archetype / hiring authority where possible. Client input must not supply stats, specialties, cost, or privileged profile data.

Out of scope for this PR:

- officer progression
- portraits / moving photographs
- biography
- detailed personality
- ranks / promotions

Those belong to the later Arcane Officer progression PR.

---

### C. City policies — 4 cards

Policies are not hardcoded to last one turn.

The policy model must support:

- `instant`
- `turns: N`
- `until_replaced`

MVP built-in policies mainly use `turns: N`.

`until_replaced` should be supported by the domain/schema if practical, even if no MVP card uses it yet.

Policies should be stored centrally as `activePolicies[]` or an equivalent authoritative structure.

Each active policy should carry at least:

- `policyId`
- `sourceCardId`
- `startedAtTurn`
- `durationType`
- `durationTurns`
- `remainingTurns`
- `effects[]`

Policy lifetime must advance through the deterministic turn lifecycle. Individual gameplay modules must not decrement their own policy durations independently.

The same policy must not stack without limit.

MVP recommended repeat behavior: selecting the same policy refreshes its duration rather than numerically stacking its effect. If implementation chooses a different simple deterministic rule, document it and test it explicitly.

#### 9. Statute of Secrecy Reinforcement

Type: `policy`

Effect:

- Applicable magical buildings receive `concealment +1`.

Duration: 3 turns.

#### 10. City Construction Mobilization

Type: `policy`

Effect:

- Reduces applicable construction cost.

Duration: 2 turns.

The discount must be consumed through a unified gameplay modifier path, not route-layer card-specific branching.

#### 11. Wizard Settlement Initiative

Type: `policy`

Effect:

- Increases wizard population growth.

Duration: 3 turns.

#### 12. Arcane Officer Special Duty Order

Type: `policy`

Effect:

- Increases Arcane Officer incident-response capacity.

MVP preferred rule:

- +1 incident response capacity per turn.

Duration: 2 turns.

Do not introduce fatigue, shift schedules, overtime simulation, or work-hour systems in this PR.

---

## 2. Unified card definition

Do not model every card as a completely unrelated API payload.

Create a unified system-owned card definition/catalog abstraction.

A card definition should include at least the equivalent of:

- `cardId`
- `type`
- `title`
- `description`
- `effect`
- `decisionMode`
- `duration`
- `metadata`

`rarity` may be reserved but is not required for MVP.

Supported decision modes must include at least:

- `immediate`
- `player_place`
- `delegate_to_agent`

For special placement cards, `player_place` and `delegate_to_agent` are two resolution choices after selecting the same card. They must not be represented as two separate cards.

The client chooses only a card and allowed decision parameters. It must never submit authoritative effect values.

SYSTEM is the source of truth for every card's mechanical effect.

---

## 3. Canonical three-choice offer

Each newly opened turn receives one canonical card offer.

MVP composition is fixed:

- 1 special structure / facility / magical plant card
- 1 resource or personnel card
- 1 policy card

No complex rarity weighting is required yet.

Each category can be selected using deterministic server-owned randomness.

Requirements:

- Same city + same turn always returns the same offer.
- Re-reading the current offer must not reroll it.
- Server restart must not change the offer.
- Agent and client must not control the seed.
- Prefer persisting the offer rather than deriving a fresh random selection on every read.
- One turn → one canonical card offer.

---

## 4. Turn flow

Target MVP flow:

`turn opens`
→ SYSTEM creates canonical card offer
→ player reads 3 cards
→ player selects exactly 1 card
→ selected card resolves immediately or enters a placement/mandate state
→ Agent strategy context sees the player choice and authoritative effect state
→ Agent plans/builds/responds
→ `resolveTurn()`
→ Owl Daily is produced from immutable facts
→ next turn

The player must never be able to select more than one card in a turn.

If the player does not choose a card before deadline:

- record an explicit `skipped` / `no_card` choice state;
- do not block settlement;
- scheduler must still resolve normally;
- next turn must still open normally;
- no offline multi-choice catch-up should be introduced.

---

## 5. Special placement and Agent delegation

Selecting a special structure card requires a placement decision.

### `player_place`

The card enters a pending placement state and the player submits a target location.

Placement must go through existing authoritative building/block/cell validation.

The card system must not become a bypass around:

- legal cells
- block constraints
- occupancy
- footprint rules
- construction authority
- existing build validation

### `delegate_to_agent`

The system records an explicit Agent mandate / pending special placement.

Strategy context must tell the Agent:

- which special card the player selected;
- what structure/plant must be placed;
- that the Agent owns the location decision;
- system-owned effects in read-only form;
- legal placement constraints.

The Agent may choose the location and execute the permitted construction workflow.

The Agent may not submit or override:

- concealment bonus
- resource production
- exposure modifier
- card effect parameters
- policy values

If a delegated placement is not completed by turn end, it must not silently disappear.

MVP preferred behavior:

- keep the mandate `pending` / `deferred` across turns until legally placed or explicitly cancelled by a later supported action.

If implementation chooses expiry instead, it must be explicit and tested. Silent disappearance is not allowed.

---

## 6. Resource and personnel resolution

Resource/personnel cards normally resolve immediately and exactly once.

### Coins

SYSTEM applies the catalog amount.

### Population

SYSTEM applies the catalog amount through the existing population/capacity rules.

### Arcane Officer

SYSTEM generates/recruits the officer through the existing authoritative officer logic.

Agent/client must not choose final stats or specialties.

All immediate effects must be idempotent and resistant to replay/double application.

---

## 7. Policy effect integration

Policies must feed a reusable modifier layer rather than route-level card-specific `if` statements.

Relevant gameplay consumers include:

- concealment calculation
- building cost
- population growth
- incident response capacity

A central active-policy state should answer which effects are currently active and with what remaining duration.

Policy expiration must be part of deterministic turn lifecycle processing.

Turn settlement facts should be able to expose:

- policies activated this turn
- policies active during this turn
- policies refreshed this turn
- policies expired this turn
- remaining durations where relevant

This enables Owl Daily to later report facts such as:

- “The strengthened secrecy order enters its final day.”
- “The construction mobilization order expired today.”

This PR does not generate that prose. It only supplies authoritative immutable facts for the existing Owl Daily narrative layer.

---

## 8. Player / Agent authority boundary

Player authority:

- read the current offer
- choose exactly one offered card
- choose `player_place` vs `delegate_to_agent` when the selected card supports it
- provide only required legal location input for player placement

Agent authority:

- read the player's choice and active authoritative effects
- plan around it
- choose a location for delegated special placement
- execute permitted existing building actions

SYSTEM authority:

- card catalog
- offer generation
- random seed
- effect values
- resource amounts
- population amount
- policy duration/effects
- officer profile generation
- placement legality
- policy lifecycle
- card facts recorded into settlement

Agent must not have permission to choose a card on behalf of the player.

---

## 9. Strategy context integration

Extend the existing Agent strategy context with read-only card state, including the equivalent of:

- current turn card offer
- choice status: `pending` / `selected` / `skipped`
- selected card
- resolved immediate effects
- active policies
- policy remaining durations
- pending delegated placement
- completed special placement status where useful

The Agent can observe these fields but cannot author them.

Do not pass untrusted Agent input into card resolution options or policy modifiers.

---

## 10. API semantics

Fit endpoint naming to the existing server style. Suggested semantics:

- `GET /api/v1/cities/{city_id}/cards/current`
- `POST /api/v1/cities/{city_id}/cards/select`
- `POST /api/v1/cities/{city_id}/cards/place`

Selection input should contain only the equivalent of:

- offer identifier / turn
- selected card id
- supported decision mode when applicable
- expected version / concurrency guard

Placement input should contain only the minimum location selector required by the authoritative building validation path.

Client requests must reject attempts to supply or override:

- card effect
- duration
- coins amount
- population delta
- concealment bonus
- policy modifier
- officer stats
- officer specialties
- special structure bonus
- random seed
- offer contents

All command endpoints must use the project's existing idempotency and concurrency conventions:

- `Idempotency-Key`
- expected city version or equivalent concurrency protection
- safe replay
- no double application of resources, population, policies, officer recruitment, or placement state

---

## 11. TurnFacts and Owl Daily integration

Card choices and their system-authoritative consequences must become immutable turn facts.

Add the equivalent of:

- `cardOfferId`
- `offeredCardIds`
- `selectedCardId`
- `choiceStatus`
- `choiceResolvedAt`
- `cardEffects`
- `policyStarted`
- `policyRefreshed`
- `policyExpired`
- `specialPlacementMandate`
- `specialPlacementCompleted`

Do not store player-editable prose in TurnFacts.

PR E's ReportContext must project card/policy facts only from frozen TurnFacts / frozen historical facts, preserving the same historical immutability rules already established for incidents.

Examples of future Owl Daily stories enabled by these facts:

- Ministry approves a new city grant.
- A three-day secrecy order takes effect.
- A named Arcane Officer joins the city.
- A Diagon Alley entrance opens in the north district.

This PR supplies facts and provenance; it does not auto-write newspaper text.

---

## 12. MVP numeric principles

Keep values coarse and legible.

Prefer rules such as:

- concealment `+1`
- fixed coin grant
- fixed population grant
- meaningful construction discount
- duration of 2 or 3 turns
- incident response capacity `+1`

Avoid a large collection of tiny percentage modifiers such as `+7%` or `-3%` unless the existing economy architecture strongly requires percentages.

All numeric values must live in centralized definitions and be covered by tests.

---

## 13. Persistence and history

Card offer, player choice, active policies, pending placement mandate, and any state required for exact replay/restart behavior must survive repository/server restart in both supported persistence paths.

Memory and PostgreSQL repositories must have equivalent semantics.

Historical TurnFacts / ReportContext must remain stable after later turns mutate current policy/placement/city state.

Avoid introducing unbounded history. Follow the existing bounded-history patterns where historical retention is needed.

---

## 14. Required tests

At minimum cover all of the following:

1. Every turn has only one canonical card offer.
2. Offer composition is exactly one special + one resource/personnel + one policy.
3. Re-reading the same turn returns the exact same offer.
4. Restart does not change an existing offer.
5. Player can choose only one card per turn.
6. Agent cannot choose a card for the player.
7. Forged card effects are rejected.
8. Forged duration is rejected.
9. Forged resource amount is rejected.
10. Resource card applies exactly once.
11. Population card obeys population capacity.
12. Officer card cannot inject stats or specialties.
13. Recruited officer has a player-facing name.
14. Special card supports `player_place`.
15. Special card supports `delegate_to_agent`.
16. Special placement cannot bypass existing cell/block/build validation.
17. Delegated placement mandate appears in strategy context.
18. Immediate card effect appears in strategy context.
19. Active policy appears in strategy context.
20. Multi-turn policy remains active for the correct number of turns.
21. Policy expires on the correct turn boundary.
22. Re-selecting the same policy does not infinitely stack its effect.
23. No-card deadline does not block turn settlement.
24. Card system cannot advance a turn more than once.
25. Card choice/effect state enters frozen TurnFacts.
26. Owl ReportContext can read card/policy facts from frozen history.
27. Failed selection changes no gameplay state.
28. Idempotent replay does not duplicate resources, population, policy, or officer recruitment.
29. PostgreSQL and memory repository semantics match.
30. OpenAPI and Agent playbook fully describe the workflow and authority boundary.
31. Historical card/policy ReportContext does not drift when later turns change current policy or placement state.
32. Pending delegated special placement does not silently disappear at settlement.

---

## 15. Explicitly out of scope

Do not implement in PR F:

- concrete risk/reward tradeoff cards
- complex rarity / deck building
- paid draws / monetized card mechanics
- card upgrades
- Arcane Officer career progression
- Arcane Officer portraits or moving photographs
- detailed officer biography/personality
- complex policy stacking
- complex event chains
- real transport system
- final special-building art/UI
- three-card visual UI
- real newspaper rendering

This PR is limited to:

- card catalog
- canonical daily offer
- player selection
- special placement / delegation contract
- resource/personnel resolution
- named MVP officer generation
- multi-turn policy lifecycle
- strategy integration
- TurnFacts / Owl Daily integration
- authority / idempotency / persistence

---

## 16. PR completion requirements

When implementation is complete, update this Draft PR rather than opening a second PR.

Before marking ready for review, the PR description must clearly summarize:

- MVP 12-card catalog
- three-category offer rule
- player authority boundary
- special placement vs Agent delegation
- resource/personnel system authority
- named Arcane Officer MVP behavior
- multi-turn policy lifecycle
- repeat/stacking rule
- strategy context integration
- TurnFacts / Owl Daily integration
- deadline/no-choice behavior
- idempotency / persistence
- test coverage
- explicit out-of-scope items

Do not silently change the gameplay rules above. If implementation discovers an architectural conflict, document the tradeoff in the Draft PR before changing the product semantics.