# OpenAPI Agent Discoverability Fix

## Goal

Bring the generated OpenAPI contract back in sync with the actual Agent-facing runtime API so an Agent can discover how to inspect, search, and navigate a city without relying on undocumented knowledge.

The immediate trigger is `GET /cities/{city_id}/spatial`: the runtime accepts a bounded-grid query, but the OpenAPI document exposes no query parameters, so an Agent cannot discover how to move its observation window.

## Root cause

The current OpenAPI helpers describe request bodies and command headers reasonably well, but GET/query parameters are mostly omitted. In addition, several runtime read routes are not present in `openapi.js` at all. This makes write operations substantially more discoverable than read/navigation operations.

## Required changes

### P0 — expose all existing read/query parameters

#### `GET /cities/{city_id}/spatial`

Expose these query parameters:

- `min_col`: integer, inclusive left/start column, default `0`
- `min_row`: integer, inclusive start row, default `0`
- `max_col`: integer, inclusive right/end column, default `min_col + 9`
- `max_row`: integer, inclusive end row, default `min_row + 9`

Document that:

- bounds are inclusive;
- reversed bounds are invalid;
- maximum requested area is 400 logical cells;
- omitting all bounds returns the default 10×10 window;
- changing these four values is how an Agent inspects another area of the city.

Include at least one concrete example such as:

`/cities/{city_id}/spatial?min_col=20&min_row=10&max_col=29&max_row=19`

#### `GET /cities/{city_id}/events`

Expose:

- `after_version`: integer, default `0`, for incremental event reads
- `limit`: integer, default `100`

Descriptions should make the intended incremental-sync usage obvious.

#### `GET /cities/{city_id}/buildings`

Expose:

- `query`: free-text search over name/archetype/purpose/description
- `archetype`
- `purpose`
- `limit`: integer, default `20`, maximum `100`
- `min_col`
- `min_row`
- `max_col`
- `max_row`

Document that the bounding-box filter matches buildings with at least one footprint cell inside the requested rectangle.

#### `GET /assets`

Expose:

- `archetype`
- `footprint`
- `district_style`
- `limit`: integer, default `20`, maximum `50`

#### `GET /cities/{city_id}/report-context`

Expose:

- `turn`: positive integer

Document that omitting `turn` selects the latest resolved turn that has frozen facts.

### P0 — expose runtime routes that are currently missing from OpenAPI

Add these existing runtime routes to `paths`:

#### `GET /cities/{city_id}/cells/{cell_id}`

Purpose: retrieve one expanded logical cell after it has been discovered through `/spatial` or another response.

#### `GET /cities/{city_id}/buildings/{building_id}`

Purpose: retrieve one full building after discovery through `/buildings`, `/spatial`, district data, events, or strategy/report facts.

#### `GET /cities/{city_id}/construction-orders`

Purpose: list construction orders. The runtime already supports this; currently only POST on the collection and GET on a single order are described in OpenAPI.

These should support the normal progressive-disclosure pattern: list/search first, then fetch one object by id.

### P1 — resolve playbook/OpenAPI/runtime inconsistencies

#### `snapshot?view=agent`

The playbook currently recommends:

`GET /api/v1/cities/{city_id}/snapshot?view=agent`

The runtime snapshot route does not consume `view`.

Choose one consistent behavior:

1. preferred if there is no real alternate snapshot view: remove `?view=agent` from the playbook and examples; or
2. implement a real `view` query contract and expose it in OpenAPI.

Do not leave a documented no-op parameter.

### P1 — replace Agent-facing generic JSON request bodies where the fields are known

Audit Agent-facing operations that still use the generic schema:

`{ type: "object", additionalProperties: true }`

At minimum, give `POST /cities/{city_id}/buildings/{building_id}/upgrade-designs` a concrete request schema matching the actual accepted upgrade-design inputs.

Also review other generic bodies such as city creation, Agent links, cancel endpoints, and asset-job artifact submission. Prioritize those an Agent is expected to call directly. The goal is not to over-model internal payloads, but to avoid making an Agent guess fields that the server already knows.

## OpenAPI design guidance

Prefer reusable helpers/components for repeated query concepts instead of duplicating ad hoc parameter definitions everywhere. For example, bounded-grid query parameters used by `/spatial` and `/buildings` should share descriptions and semantics.

Keep the existing automatic path-parameter injection for `{city_id}`, `{building_id}`, etc. The defect is query/body discoverability, not path parameters.

The generated OpenAPI document should remain the authoritative machine-readable contract. The playbook may explain workflows, but it should not be the only place an Agent can learn legal parameter names.

## Tests / acceptance criteria

Add regression coverage so this does not drift again.

### Contract tests

Assert that generated `/openapi.json` contains:

- all four `/spatial` bounds query parameters with integer schemas;
- `/events` `after_version` and `limit`;
- `/buildings` search/filter/bounds parameters;
- `/assets` search parameters;
- `/report-context` `turn`;
- `GET /cities/{city_id}/cells/{cell_id}`;
- `GET /cities/{city_id}/buildings/{building_id}`;
- `GET /cities/{city_id}/construction-orders`.

### Runtime/OpenAPI route coverage

Add a test that compares Agent-facing `/api/v1` runtime routes with the generated OpenAPI paths/methods and fails when an eligible runtime route disappears from OpenAPI.

Allow an explicit small denylist for intentionally non-Agent/internal/public-only routes rather than silently ignoring mismatches.

### Query-contract coverage

For key query-driven endpoints, add tests that couple runtime-supported query names to OpenAPI parameter names. At minimum cover `/spatial`, `/events`, `/buildings`, `/assets`, and `/report-context`.

The purpose is to prevent a future runtime change from adding a useful query parameter without also making it discoverable.

### Behavioral checks

- Existing API behavior must remain backward compatible.
- No runtime parameter names should be renamed solely for documentation convenience.
- Existing path parameter auto-injection and `commandOperation()` headers (`Idempotency-Key`, optional `If-Match`) must continue working.
- Existing OpenAPI consumers should still receive valid OpenAPI 3.1.

## Expected Agent impact

After this change an Agent should be able to infer, from OpenAPI alone, how to:

1. inspect an arbitrary rectangular part of the city;
2. incrementally read events;
3. search buildings by text/type/purpose/location;
4. search reusable assets with supported filters;
5. fetch a specific cell or building after discovery;
6. list and inspect construction orders;
7. read a specific resolved turn's report context.

No hidden parameter knowledge should be required for these workflows.
