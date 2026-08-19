// Progressive-disclosure playbook guidance for Agent read models.
//
// The full gameplay contract lives in docs/agent-playbook.md; API responses
// only surface a short, context-appropriate hint (1-3 items) plus a pointer to
// the playbook. Guidance is advisory prose and never a hard constraint: only
// SYSTEM authoritative validation (assignment validation, card ownership, etc.)
// can reject an Agent action.

import { normalizeCardState } from "./schema.js";

// The discovery anchor is always present so an Agent can always find the
// authoritative contract without the API re-printing it.
export const PLAYBOOK_DISCOVERY_GUIDANCE = Object.freeze(
  "Read the MAGTOPIA Agent Playbook before planning; it is the authoritative gameplay contract."
);

export const PLAYBOOK_BASE_GUIDANCE = Object.freeze([
  PLAYBOOK_DISCOVERY_GUIDANCE,
  "Player choices are authoritative: never select a card or invent a SYSTEM settlement result.",
  "Balance development with population, exposure, concealment, and incident risk."
]);

// At most MAX_CONTEXTUAL_HINTS context hints are surfaced (total response stays
// within the 1-3 low-token spec: 1 discovery anchor + up to 2 context hints).
const MAX_CONTEXTUAL_HINTS = 2;

export function playbookGuidance(state, options = {}) {
  const hints = [];
  const cardState = normalizeCardState(state?.gameplay?.cardState);
  const gameplay = state?.gameplay ?? {};

  const addContextual = (hint) => {
    if (hints.length < MAX_CONTEXTUAL_HINTS) hints.push(hint);
  };

  // Highest-priority context first. A locked resolve gate is the most decisive
  // thing to know, then agent-mandated work, then risk, then player-owed steps.
  if (options.turnLocked) {
    addContextual(`The current turn cannot be resolved yet: nextTurnUnlockAt (${options.turnLocked}) gates resolution. Stop low-value new work and wait.`);
  }
  const delegatedPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "delegate_to_agent" && ["pending", "deferred"].includes(entry.status));
  if (delegatedPlacement) {
    addContextual(`The player delegated the ${delegatedPlacement.cardId} location to you; resolve it via the cards/place endpoint with placement_id ${delegatedPlacement.placementId}.`);
  }
  const openIncidents = Object.values(gameplay.incidents ?? {}).some((incident) => incident.status === "open");
  const pendingAssignments = Array.isArray(gameplay.pendingAssignments) && gameplay.pendingAssignments.length > 0;
  if (openIncidents || pendingAssignments) {
    addContextual("Open incidents remain: dispatch available Arcane Officers or accept that they are recorded as unaddressed at settlement.");
  }
  const playerPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "player_place" && entry.status === "pending");
  if (playerPlacement) {
    addContextual("A player-owned special structure placement is pending; the player must place it.");
  }
  if (cardState.choice?.status === "pending") {
    addContextual("The player still owes today's card choice; observe it, never choose on their behalf.");
  }

  return [PLAYBOOK_DISCOVERY_GUIDANCE, ...hints];
}
