// PR G — City-Day presentation read model.
//
// This module is a *presentation projection* of authoritative turn/workflow
// state. It never stores gameplay truth, never settles a turn, and never
// produces resources/population/exposure. Visual time-of-day is an output of
// workflow state, never an input to gameplay.
//
// Derivation contract:
// - `dawn`          previous turn fully resolved; a completed-day Owl Daily is
//                   ready to present (or enough state exists to present the
//                   completed day).
// - `early_morning` newspaper dismissed; player is choosing today's card or
//                   finishing a player-owned placement.
// - `morning`       player decision complete; the Agent has not yet performed a
//                   meaningful gameplay action for this turn.
// - `day`           the Agent has actually begun current-turn city work.
// - `night`         the turn has entered incident/Arcane Officer response work.
//
// The critical async rule: elapsed wall-clock time alone can never advance
// morning -> day -> night. Only observed authoritative state changes do.

import { normalizeCardState } from "./schema.js";
import { pendingPlacements } from "./cards.js";
import { deriveBootstrapProgress, isBootstrapTurn } from "./bootstrap.js";

export const CITY_DAY_PHASES = Object.freeze(["dawn", "early_morning", "morning", "day", "night"]);

export const CITY_DAY_SETTLED_STATUSES = Object.freeze(new Set(["resolved", "reported", "closed"]));
export const CITY_DAY_ACTIVE_STATUSES = Object.freeze(new Set(["open", "building", "strategy"]));

// Accepted Agent gameplay command types that count as "meaningful city work".
// Presence/connection alone never produces these. Reuses the existing engine
// event stream instead of a parallel activity log.
const AGENT_WORK_EVENT_TYPES = Object.freeze(new Set([
  "building_constructed",
  "building_upgraded",
  "road_connected",
  "district_defined",
  "construction_reserved",
  "construction_reservation_completed"
]));

// The day whose completed report is presented at dawn. This is the last settled
// turn's frozen facts turn; a fresh city that has never settled has none.
export function completedReportTurn(state) {
  return state?.gameplay?.lastTurnFacts?.turn ?? null;
}

function eventWindowStartMs(state, turnOpenedAt) {
  if (turnOpenedAt != null) {
    const opened = new Date(turnOpenedAt).getTime();
    if (Number.isFinite(opened)) return opened;
  }
  const resolvedAt = state?.gameplay?.lastTurnFacts?.wallClock?.resolvedAt;
  if (resolvedAt != null) {
    const resolved = new Date(resolvedAt).getTime();
    if (Number.isFinite(resolved)) return resolved;
  }
  return null;
}

// True when the Agent has accepted at least one qualifying city-work command
// after the current turn opened (or, for pre-scheduler cities, after the last
// settlement). Wall clock alone and mere Agent presence never set this signal.
export function agentWorkStartedForTurn(state, { turnOpenedAt = null } = {}) {
  const windowStartMs = eventWindowStartMs(state, turnOpenedAt);
  for (const event of state?.events ?? []) {
    if (!AGENT_WORK_EVENT_TYPES.has(event?.type)) continue;
    if (!String(event?.actor ?? "").startsWith("agent:")) continue;
    if (windowStartMs != null) {
      const at = new Date(event?.at ?? event?.created_at ?? 0).getTime();
      if (!Number.isFinite(at) || at < windowStartMs) continue;
    }
    return true;
  }
  return false;
}

// Whether the current workflow has entered the incident/Arcane Officer phase.
// Authoritative signal: the strategy phase is active (assignments accepted) or
// a dispatch plan is pending. Never inferred from elapsed time.
export function incidentPhaseActive(state) {
  const gameplay = state?.gameplay ?? {};
  if (gameplay.turnStatus === "strategy") return true;
  if (Array.isArray(gameplay.pendingAssignments) && gameplay.pendingAssignments.length > 0) return true;
  return false;
}

// Whether the player still owes a manual placement for this turn.
export function playerPlacementPending(state) {
  const cardState = normalizeCardState(state?.gameplay?.cardState);
  return Object.values(cardState.placements ?? {})
    .some((entry) => entry.mode === "player_place" && entry.status === "pending");
}

export function cardChoicePending(state) {
  if (state?.turn != null && Number(state.turn) === 0) return false;
  return normalizeCardState(state?.gameplay?.cardState).choice.status === "pending";
}

// Derives the city-day presentation projection from authoritative state.
//
// options:
//   reportReady      {boolean} a published OwlReport exists for the completed
//                    day and is ready for the player.
//   reportDismissed  {boolean} the player has already acknowledged/dismissed the
//                    completed day's report.
//   turnOpenedAt     {string|null} the current turn's opening time, used to
//                    bound the agent-work window.
export function deriveCityDayPresentation(state, options = {}) {
  const gameplay = state?.gameplay ?? {};
  const turnStatus = gameplay.turnStatus ?? "open";
  const settled = CITY_DAY_SETTLED_STATUSES.has(turnStatus);
  const reportTurn = completedReportTurn(state);
  const reportReady = Boolean(options.reportReady && reportTurn != null);
  const reportDismissed = Boolean(options.reportDismissed);
  const choice = (state?.turn != null && Number(state.turn) === 0)
    ? { status: "not_applicable", offerId: null, selectedCardId: null, decisionMode: null, choiceResolvedAt: null }
    : normalizeCardState(gameplay.cardState).choice;
  const placementPending = playerPlacementPending(state);
  // Keep the complete, stable placement projection in the read model. A
  // player's current card choice is not a reliable owner for an older
  // placement that survived a turn boundary.
  const placements = pendingPlacements(state)
    .sort((a, b) => {
      const turnA = Number.isFinite(Number(a.delegated_at_turn)) ? Number(a.delegated_at_turn) : Number.MAX_SAFE_INTEGER;
      const turnB = Number.isFinite(Number(b.delegated_at_turn)) ? Number(b.delegated_at_turn) : Number.MAX_SAFE_INTEGER;
      return turnA - turnB || String(a.placement_id).localeCompare(String(b.placement_id));
    });
  const incidentActive = incidentPhaseActive(state);
  const turnOpenedAt = options.turnOpenedAt ?? gameplay.turnOpenedAt ?? null;
  const agentWorkStarted = agentWorkStartedForTurn(state, { turnOpenedAt });

  let phase;
  if (settled) {
    // Completed day, no player action owed for it; the report presentation and
    // the next dawn share this phase.
    phase = "dawn";
  } else if (reportReady && !reportDismissed) {
    // Previous day complete, new report available, current choice pending:
    // present the report first.
    phase = "dawn";
  } else if (incidentActive) {
    // The Agent has entered incident/Arcane Officer response work: the city day
    // is at night even before the player finishes a (secondary) card choice.
    phase = "night";
  } else if (choice.status === "pending") {
    phase = "early_morning";
  } else if (placementPending) {
    phase = "early_morning";
  } else if (agentWorkStarted) {
    phase = "day";
  } else {
    phase = "morning";
  }

  return {
    phase,
    turn: Number(state?.turn ?? 0),
    turnKind: isBootstrapTurn(state) ? "bootstrap" : "normal",
    turnStatus,
    settled,
    bootstrap: isBootstrapTurn(state) ? { progress: deriveBootstrapProgress(state) } : null,
    report: {
      turn: reportTurn,
      ready: reportReady,
      dismissed: reportDismissed
    },
    card: {
      choiceStatus: choice.status,
      choicePending: choice.status === "pending",
      selectedCardId: choice.selectedCardId ?? null,
      decisionMode: choice.decisionMode ?? null,
      playerPlacementPending: placementPending,
      pendingPlacements: placements,
    },
    agent: {
      workStarted: agentWorkStarted
    },
    incident: {
      phaseActive: incidentActive
    },
    nextTurnUnlockAt: gameplay.nextTurnUnlockAt ?? null,
    turnDeadlineAt: gameplay.turnDeadlineAt ?? null
  };
}
