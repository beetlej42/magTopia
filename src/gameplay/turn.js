import { normalizeScheduler } from "./schema.js";

// Wall-clock only decides *when* a turn may open and when an unfinished turn
// must be settled by the system. It never produces resources, population,
// exposure, or incident outcomes directly; every gameplay change still flows
// through the single authoritative resolveTurn() in simulation.js.

export const DEFAULT_TURN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TURN_DEADLINE_MS = 24 * 60 * 60 * 1000;

export const ACTIVE_TURN_STATUSES = Object.freeze(new Set(["open", "building", "strategy"]));
export const SETTLED_TURN_STATUSES = Object.freeze(new Set(["resolved", "reported", "closed"]));

export function normalizeTurnSchedule(config = {}) {
  return {
    turnIntervalMs: finiteMs(config.turnIntervalMs, DEFAULT_TURN_INTERVAL_MS),
    turnDeadlineMs: finiteMs(config.turnDeadlineMs, DEFAULT_TURN_DEADLINE_MS)
  };
}

export function needsTurnScheduleInit(state) {
  const gameplay = state?.gameplay ?? {};
  if (ACTIVE_TURN_STATUSES.has(gameplay.turnStatus) && gameplay.turnDeadlineAt == null) return true;
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
      turnDeadlineAt: new Date(at + schedule.turnDeadlineMs).toISOString(),
      scheduler: normalizeScheduler({ ...(gameplay.scheduler ?? {}), openedAt })
    });
  }
  return withGameplay(state, {
    nextTurnUnlockAt: new Date(at + schedule.turnIntervalMs).toISOString()
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
  const gameplay = state.gameplay ?? {};
  const at = new Date(now).getTime();
  const openedAt = new Date(at).toISOString();
  return withGameplay(state, {
    turnStatus: "open",
    turnOpenedAt: openedAt,
    turnDeadlineAt: new Date(at + schedule.turnDeadlineMs).toISOString(),
    nextTurnUnlockAt: null,
    scheduler: normalizeScheduler({ ...(gameplay.scheduler ?? {}), openedAt })
  });
}

export function isTurnOverdue(state, now) {
  const gameplay = state?.gameplay ?? {};
  if (!ACTIVE_TURN_STATUSES.has(gameplay.turnStatus)) return false;
  if (!gameplay.turnDeadlineAt) return false;
  return new Date(now).getTime() > new Date(gameplay.turnDeadlineAt).getTime();
}

export function dueActionFor(state, now) {
  if (needsTurnScheduleInit(state)) return "init";
  if (isTurnOverdue(state, now)) return "resolve-deadline";
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
