# Headless city simulation

The deterministic city simulator is a small orchestration harness for PR-D
balance checks. It uses the real city state, legal site search, construction and
road commands, canonical `gameplayBuilding` units, the construction coins
ledger, and `resolveTurn` settlement. It does not write completed buildings or
income directly into state.

Run a concise summary with:

```sh
npm run simulate:city -- --turns 20 --strategy balanced --seed demo
npm run simulate:city -- --turns 30 --strategy economy-first --seed demo
```

Use `--json` for CI and comparison tooling. Supported strategies are
`balanced`, `housing-first`, `economy-first`, and `service-first`. The strategy
only ranks legal candidates and chooses a canonical purpose; it cannot bypass
solver validation or resource costs.

Each timeline entry records actions (including rejected commands and reasons),
buildings by purpose, construction and road spend, resource before/income/after
values, population capacity/target/delta, service coverage and migration rates,
stall reason, and invariant checks. The summary reports cumulative construction,
roads, longest continuous stall, sustainability, final resources/population, and
anomalies. `finalState` is included for diagnostics; the timeline and summary
are the stable report surface.

The simulator explicitly runs the exported `resolvePublicServiceBaselineTurn`
PR-D profile with later cards, incidents, and exposure systems disabled. The
production `resolveTurn` path remains complete and cannot be partially disabled
through context flags. This keeps the baseline about canonical economy,
population, and public-service rules rather than silently introducing PR-F+
mechanics. No balance constants are overridden.

With one-turn construction, the `audit` balanced run builds 30 buildings in 30
turns, spends 2,000 coins on buildings and 44 on 22 road cells, and finishes with
2,516 coins and 260 AE. Population reaches 30/40, with no stalls or anomalies and
`sustainable=true`. Sites become operational through the real next-turn opening
path, after the turn in which they were started has settled. These are observed
outcomes, not strategy assertions.
