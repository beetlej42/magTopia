import { normalizeScheduler } from "./schema.js";

// Turn lifecycle under the consolidated gameplay rules.
//
// Wall clock decides only *when* a turn may be resolved (the cooldown gate)
// and *when* the next turn may open. It never settles a turn: there is no
// auto-settle deadline, no offline multi-turn catch-up, and no timer-driven
// gameplay advance. Every gameplay change flows through the single
// authoritative resolveTurn() in simulation.js, triggered by the Agent / the
// normal gameplay flow.
//
// `nextTurnUnlockAt` has one meaning per turn status:
//   - active turn: the earliest wall-clock time the Agent may resolve it;
//   - settled turn: the earliest wall-clock time the next turn may open.
// It is written when the turn opens as `turnOpenedAt + TURN_COOLDOWN`.

export const DEFAULT_TURN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const ACTIVE_TURN_STATUSES = Object.freeze(new Set(["open", "building", "strategy"]));
export const SETTLED_TURN_STATUSES = Object.freeze(new Set(["resolved", "reported", "closed"]));

// Accepts turnCooldownSeconds (new), turnCooldownMs (test convenience), and the
// legacy turnIntervalMs (deprecated alias) so persisted configs keep working.
// turnDeadlineMs is intentionally ignored: no deadline auto-settle exists.
export function normalizeTurnSchedule(config = {}) {
  const fromSeconds = Number(config.turnCooldownSeconds);
  const fromMs = Number(config.turnCooldownMs);
  const legacyMs = Number(config.turnIntervalMs);
  const cooldownMs = fromSeconds > 0
    ? fromSeconds * 1000
    : finiteMs(fromMs > 0 ? fromMs : legacyMs, DEFAULT_TURN_COOLDOWN_MS);
  return { turnCooldownMs: cooldownMs };
}

export function needsTurnScheduleInit(state) {
  const gameplay = state?.gameplay ?? {};
  if (ACTIVE_TURN_STATUSES.has(gameplay.turnStatus) && gameplay.nextTurnUnlockAt == null) return true;
  if (SETTLED_TURN_STATUSES.has(gameplay.turnStatus) && gameplay.nextTurnUnlockAt == null) return true;
  return false;
}

export function initializeTurnSchedule(state, now, config = {}) {
  if (!needsTurnScheduleInit(state)) return null;
  const schedule = normalizeTurnSchedule(config);
  const gameplay = state.gameplay ?? {};
  const at = new Date(now).getTime();
  if (ACTIVE_TURN_STATUSES.has(gameplay.turnStatus)) {
    const openedAt = gameplay.turnOpenedAt ?? new Date(at).toISOString();
    return withGameplay(state, {
      turnOpenedAt: openedAt,
      // Earliest time the Agent may resolve this turn.
      nextTurnUnlockAt: new Date(new Date(openedAt).getTime() + schedule.turnCooldownMs).toISOString(),
      turnDeadlineAt: null,
      scheduler: normalizeScheduler({ openedAt })
    });
  }
  return withGameplay(state, {
    nextTurnUnlockAt: new Date(at + schedule.turnCooldownMs).toISOString()
  });
}

export function shouldOpenNextTurn(state, now) {
  const gameplay = state?.gameplay ?? {};
  if (!SETTLED_TURN_STATUSES.has(gameplay.turnStatus)) return false;
  if (!gameplay.nextTurnUnlockAt) return false;
  return new Date(now).getTime() >= new Date(gameplay.nextTurnUnlockAt).getTime();
}

export function openNextTurn(state, now, config = {}) {
  if (!shouldOpenNextTurn(state, now)) return null;
  const schedule = normalizeTurnSchedule(config);
  const at = new Date(now).getTime();
  const openedAt = new Date(at).toISOString();
  return withGameplay(state, {
    turnStatus: "open",
    turnOpenedAt: openedAt,
    nextTurnUnlockAt: new Date(at + schedule.turnCooldownMs).toISOString(),
    turnDeadlineAt: null,
    // The scheduler metadata describes the *current* turn: the previous turn's
    // settlement (settledBy/resolvedAt) already lives in lastTurnFacts.wallClock.
    scheduler: normalizeScheduler({ openedAt })
  });
}

// True when the current active turn cannot be resolved yet because its cooldown
// gate has not elapsed. Cities without a scheduled gate (pre-scheduler state)
// are never locked.
export function isTurnResolveLocked(state, now) {
  const gameplay = state?.gameplay ?? {};
  if (!ACTIVE_TURN_STATUSES.has(gameplay.turnStatus)) return false;
  if (gameplay.nextTurnUnlockAt == null) return false;
  return new Date(now).getTime() < new Date(gameplay.nextTurnUnlockAt).getTime();
}

export function dueActionFor(state, now) {
  if (needsTurnScheduleInit(state)) return "init";
  if (shouldOpenNextTurn(state, now)) return "open-next";
  return null;
}

function withGameplay(state, gameplayPatch) {
  return {
    ...state,
    version: (state.version ?? 0) + 1,
    gameplay: {
      ...(state.gameplay ?? {}),
      ...gameplayPatch
    }
  };
}

function finiteMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
