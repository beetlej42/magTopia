# PR J — Frontend integration and playable city-day loop

The player surface consumes the authoritative city-day projection and never
creates a client-side gameplay clock. Ordinary cards are labelled by their
system category (`BUILDING`, `PEOPLE`, `RESOURCE`, `PERSONNEL`, or `POLICY`);
Special Choice is visually marked and each special card exposes its family,
unique entitlement, free placement, footprint, and the player-place/delegate
decision.

`GET /cities/{city_id}/city-day` and `GET /cities/{city_id}/cards/current`
both expose the stable `pending_placements` projection. The player controller
uses the first pending `player_place` entry in placement-id order, so a
mandate retained across a turn cannot be confused with the current turn's
card choice. A player cancellation is submitted to
`POST /cities/{city_id}/cards/cancel` with the current city version and an
idempotency key; rejected or failed cancellation restores the placement HUD.

During the authoritative `night` phase the player surface reads
`GET /cities/{city_id}/strategy` and displays only factual open incidents and
system-generated Arcane Officer candidates. It does not derive rolls, costs,
eligibility, or incident outcomes. Reloading simply re-reads these projections,
so report acknowledgement, card choice, placement, waiting, day, and night
states are recoverable without replaying commands.
