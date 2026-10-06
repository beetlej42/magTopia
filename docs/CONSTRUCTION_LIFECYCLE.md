# One-turn construction

New residential, commercial, public-space and special structures use one gameplay
turn of construction, independent of real time and asset generation. Roads remain
immediate. Existing buildings without construction metadata keep their lifecycle.
Design-only upgrades keep their current behavior.

| Stage | State | Effects |
| --- | --- | --- |
| Accept in turn N | `construction`, footprint occupied, cost charged once | None |
| Resolve N | Still under construction | Excluded from income, capacity, service, exposure and special bonuses |
| Open N+1 | `completed`; one `building_completed` event | Operational |
| Resolve N+1 | Included in normal settlement | First income |

`construction` stores `startedAtTurn`, `readyAtTurn` and `completedAtTurn`.
Only turn opening (under the existing city transaction lock) commissions due sites.
An asynchronous asset arriving in an already-open eligible turn may commission
its site immediately. Asset readiness during a settled/closed interval waits for
opening. Retries cannot charge again or duplicate completion events.
Commissioning adds the new housing capacity immediately so arrival cards can use
it; resident migration and income still happen only during normal settlement.

Construction-order and placement-mandate fulfillment remain separate from this
lifecycle. API responses expose `building_status`, `ready_at_turn`,
`construction_started_at_turn`, `completed_at_turn` and `operational`.
Planning projections list construction and waiting-asset sites. Bootstrap planning
milestones count accepted sites so the first turn does not deadlock.

Reports separately record starts and completions. Legacy construction event names
remain readable; opening a turn never rewrites previously frozen report facts.
Demolition removes a site normally, so it cannot later reappear as a completed
building. Special-building uniqueness still includes occupied construction sites.

## Worksite appearance

The procedural asset uses timber hoarding, brass-capped posts, a cream permit
placard, a warm lantern, stone foundations, brick and timber stacks, and a green
canvas-covered supply pile. Gardens use ground markings, paving and a wrapped
sapling. Underground sites use a dark opening and a simple timber winch.

The enclosure follows the actual footprint, including irregular cell unions, with
one entrance on the selected side and no internal fences. Construction branches
before completed building/prefab/baked-asset rendering. Waiting-asset reservations
use the same placeholder, terrain grade and info card. Geometry is merged by
material; the 1x1 example has about 1,800 triangles and the 2x2 about 4,000.
This first version is static, including a discreet hovering brick on magical
sites, with no animation loop or point lights.

Generate four actual-model previews (512 px) with:

```sh
node scripts/preview-construction-sites.mjs /tmp/construction-preview
```
