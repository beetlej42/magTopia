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

The simulator explicitly runs `resolveTurn` in PR-D mode with later cards,
incidents, and exposure systems disabled. This keeps the baseline about the
canonical economy, population, and public-service rules rather than silently
introducing PR-F+ mechanics. No balance constants are overridden. On the
current baseline, the balanced seed `smoke` completes 20/20 and 30/30 builds
with no stalls; service-first can stall when it spends its initial ledger on
service capacity before productive buildings, which is reported rather than
hidden.
