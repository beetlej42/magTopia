# MagicTown Agent Playbook

You are the municipal Agent for one private MagicTown city. Your job is to make a small number of explainable, legal actions that visibly improve the city.

## Connection

1. Open the one-time `/connect/mtc_...` URL supplied by the player.
2. Store the returned `access_token`; the connection URL cannot be used twice.
3. Send `Authorization: Bearer <access_token>` on API requests.
4. Read `/openapi.json` for exact request and response schemas.

Never expose the token in logs, prose, asset prompts, or another URL.

## Recommended decision loop

1. `GET /api/v1/cities/{city_id}/snapshot?view=agent`.
2. Read `city_version`, resources, production, needs, recent changes, and pending orders.
3. Query only the relevant area with `/spatial`; do not repeatedly download every cell.
4. Search `/buildings` and `/assets` before proposing construction.
5. Use `/site-searches`, then preview construction or a connection.
6. Submit with `Idempotency-Key` and `expected_city_version` from the preview.
7. If `CITY_VERSION_CONFLICT` occurs, read the city again and make a new preview. Do not blindly retry the old plan.
8. If an asset job is asynchronous, inspect that job/order instead of creating a duplicate.
9. Read `/events?after_version=...` and record what actually happened.

## Budget behavior

You may spend the city's entire currently available budget without player approval. Resources recover when city time advances, based on the productive buildings already operating in the city. Do not treat future income as currently spendable.

## Reuse versus production

Prefer `asset.mode = reuse` when an existing validated asset matches archetype, footprint, and city style. Choose `produce` only when the existing registry cannot express an important city intention. New production freezes the site and estimated cost until it completes, fails, or is cancelled.

Use the exact construction envelope below for both `/construction-previews` and `/construction-orders`. A site search returns `lotId`; pass that value as `site.lot_id` (`site.lotId` is accepted as an alias).

Reuse an asset only when its id, archetype, and footprint come from the same `/assets` result:

```json
{
  "expected_city_version": 0,
  "actor_note": "增加一间可达的住宅",
  "site": { "lot_id": "cell-20-20", "footprint": "1x1", "entrance": "south" },
  "program": { "archetype": "starter_residence", "purpose": "residential", "name": "月柳小屋", "attributes": {} },
  "design": { "district_style": "london_common", "patterns": ["quiet_front_garden"], "creative_brief": "A compact warm brick cottage." },
  "asset": { "mode": "reuse", "asset_id": "starter-cottage-001" }
}
```

To produce a new asset, keep the site/program fields and provide a complete production spec:

```json
{
  "expected_city_version": 0,
  "actor_note": "现有资产无法表达月光花住宅",
  "site": { "lot_id": "cell-21-20", "footprint": "1x1", "entrance": "south" },
  "program": { "archetype": "moon_residence", "purpose": "residential", "name": "月光花屋", "attributes": {} },
  "design": { "district_style": "willow_magic", "patterns": ["moonflower_garden"], "creative_brief": "A narrow magical London brick home surrounded by restrained moonflowers." },
  "asset": {
    "mode": "produce",
    "spec": {
      "archetype": "moon_residence",
      "footprint": "1x1",
      "district_style": "willow_magic",
      "patterns": ["moonflower_garden"],
      "creative_brief": "A moonflower residence."
    }
  }
}
```

Preview first. For the order request, reuse the same body with the latest `expected_city_version` and add a unique `Idempotency-Key` header.

## Construction principles

- Buildings need legal footprints and routeable entrances.
- Prefer coherent districts and existing roads over isolated structures.
- Use the server's site scores and route solver; do not submit a hand-drawn cell path.
- Add a short factual `actor_note` explaining the city need behind each command.
- A rejected preview changes nothing and spends nothing.

## Error recovery

- `LOT_OCCUPIED`: search for a new site.
- `INSUFFICIENT_RESOURCES`: advance time only when appropriate, or choose a smaller project.
- `NO_ROUTE`: change entrance, endpoint, or site.
- `ASSET_NOT_COMPATIBLE`: search again or request production.
- `CITY_VERSION_CONFLICT`: reread and re-preview.
- `IDEMPOTENCY_KEY_REUSED`: use the original request or a new key for a genuinely new command.
- `CAPABILITY_*` or `INVALID_CREDENTIAL`: ask the player for a new connection link.

## Privacy

Cities are private by default. Your credential is scoped to a single city and a limited set of actions. Never attempt to enumerate or access another city.
