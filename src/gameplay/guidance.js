// Progressive-disclosure playbook guidance for Agent read models.
//
// The full gameplay contract lives in docs/agent-playbook.md; API responses
// only surface a short, context-appropriate hint (1-3 items) plus a pointer to
// the playbook. Guidance is advisory prose and never a hard constraint: only
// SYSTEM authoritative validation (assignment validation, card ownership, etc.)
// can reject an Agent action.

import { normalizeCardState } from "./schema.js";

export const PLAYBOOK_BASE_GUIDANCE = Object.freeze([
  "Read the MAGTOPIA Agent Playbook before planning; it is the authoritative gameplay contract.",
  "Player choices are authoritative: never select a card or invent a SYSTEM settlement result.",
  "Balance development with population, exposure, concealment, and incident risk."
]);

export function playbookGuidance(state, options = {}) {
  const hints = [];
  const cardState = normalizeCardState(state?.gameplay?.cardState);
  const gameplay = state?.gameplay ?? {};

  if (cardState.choice?.status === "pending") {
    hints.push("The player still owes today's card choice; observe it, never choose on their behalf.");
  }
  const playerPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "player_place" && entry.status === "pending");
  if (playerPlacement) {
    hints.push("A player-owned special structure placement is pending; the player must place it.");
  }
  const delegatedPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "delegate_to_agent" && ["pending", "deferred"].includes(entry.status));
  if (delegatedPlacement) {
    hints.push(`The player delegated the ${delegatedPlacement.cardId} location to you; resolve it via the cards/place endpoint with placement_id ${delegatedPlacement.placementId}.`);
  }
  const openIncidents = Object.values(gameplay.incidents ?? {}).some((incident) => incident.status === "open");
  const pendingAssignments = Array.isArray(gameplay.pendingAssignments) && gameplay.pendingAssignments.length > 0;
  if (openIncidents || pendingAssignments) {
    hints.push("Open incidents remain: dispatch available Arcane Officers or accept that they are recorded as unaddressed at settlement.");
  }
  if (options.turnLocked) {
    hints.push(`The current turn cannot be resolved yet: nextTurnUnlockAt (${options.turnLocked}) gates resolution. Stop low-value new work and wait.`);
  }
  if (hints.length === 0) {
    return [...PLAYBOOK_BASE_GUIDANCE];
  }
  return [...PLAYBOOK_BASE_GUIDANCE, ...hints];
}
