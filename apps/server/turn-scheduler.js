import { hashSeed } from "../../src/gameplay/random.js";
import { normalizeScheduler } from "../../src/gameplay/schema.js";
import { resolveTurn } from "../../src/gameplay/simulation.js";
import { dueActionFor, initializeTurnSchedule, isTurnOverdue, normalizeTurnSchedule, openNextTurn } from "../../src/gameplay/turn.js";

// The turn scheduler is the only server-owned wall-clock actor. It never
// invents gameplay rules: it only (a) opens a settled turn once its persisted
// unlock time is reached, (b) force-settles an unfinished turn once its
// persisted deadline has passed through the exact same resolveTurn(), and
// (c) lazily seeds a schedule for cities that predate scheduling. Every
// mutation goes through repository.schedulerTransact(), which takes the city
// row lock and deduplicates by idempotency key, so retries and concurrent
// Agent resolves can never double-settle a turn.
export function createTurnScheduler({ repository, config, now = () => new Date(), logger = console }) {
  const schedule = normalizeTurnSchedule(config);
  let stopped = false;

  async function pollOnce() {
    const due = await repository.scanCitiesForScheduler(now().toISOString());
    const results = [];
    for (const row of due) {
      try {
        results.push(await processCity(row));
      } catch (error) {
        logger.error?.("Turn scheduler failed for city", { cityId: row.id, error: error.message, code: error.code });
        results.push({ city_id: row.id, status: "error", error: error.message });
      }
    }
    return results;
  }

  async function processCity(row) {
    const cityId = row.id;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const latest = await repository.getCityForScheduler(cityId);
      if (!latest) return { city_id: cityId, status: "missing" };
      const nowValue = now();
      const action = dueActionFor(latest.state, nowValue);
      if (!action) return { city_id: cityId, status: "noop" };
      try {
        const response = await repository.schedulerTransact({
          cityId,
          endpoint: `turn-scheduler/${cityId}/${action}`,
          idempotencyKey: `${action}-${latest.state.turn}`,
          requestBody: {},
          expectedVersion: latest.state.version,
          action: `turn_scheduler_${action}`,
          reason: reasonFor(action)
        }, ({ state }) => handleAction(state, action, nowValue, cityId));
        return { city_id: cityId, status: response.status, turn: response.turn, settled_by: response.settled_by, facts: response.facts };
      } catch (error) {
        if (error.code === "CITY_VERSION_CONFLICT") continue;
        throw error;
      }
    }
    return { city_id: cityId, status: "retry_exhausted" };
  }

  function handleAction(state, action, nowValue, cityId) {
    if (action === "init") {
      const initialized = initializeTurnSchedule(state, nowValue, schedule);
      if (!initialized) return { nextState: null, response: { status: "noop", reason: "not_initializable" } };
      return {
        nextState: initialized,
        response: {
          status: "opened",
          turn: initialized.turn,
          turn_status: initialized.gameplay.turnStatus,
          turn_opened_at: initialized.gameplay.turnOpenedAt,
          turn_deadline_at: initialized.gameplay.turnDeadlineAt,
          next_turn_unlock_at: initialized.gameplay.nextTurnUnlockAt,
          city_version_after: initialized.version
        }
      };
    }
    if (action === "open-next") {
      const opened = openNextTurn(state, nowValue, schedule);
      if (!opened) return { nextState: null, response: { status: "noop", reason: "not_unlocked" } };
      return {
        nextState: opened,
        response: {
          status: "opened",
          turn: opened.turn,
          turn_status: opened.gameplay.turnStatus,
          turn_opened_at: opened.gameplay.turnOpenedAt,
          turn_deadline_at: opened.gameplay.turnDeadlineAt,
          next_turn_unlock_at: opened.gameplay.nextTurnUnlockAt,
          city_version_after: opened.version
        }
      };
    }
    if (action === "resolve-deadline") {
      const gameplay = state.gameplay ?? {};
      if (["resolved", "reported", "closed"].includes(gameplay.turnStatus)) {
        return { nextState: null, response: { status: "noop", reason: "already_settled" } };
      }
      if (!isTurnOverdue(state, nowValue)) {
        return { nextState: null, response: { status: "noop", reason: "not_overdue" } };
      }
      const assignments = gameplay.pendingAssignments ?? [];
      const result = resolveTurn(state, { assignments, expectedTurn: state.turn }, schedulerContext(config, cityId, state.turn, nowValue));
      if (result.error) {
        // Pending plans are validated on submission, so this should not happen;
        // still, an unreadable plan must never block the deadline. Fall back to
        // a settlement without assignments: every open incident then takes the
        // uniform conservative unaddressed path inside resolveTurn().
        logger.error?.("Turn scheduler dropped an unreadable pending plan", { cityId, turn: state.turn, code: result.error.code });
        const fallback = resolveTurn(state, { assignments: [], expectedTurn: state.turn }, schedulerContext(config, cityId, state.turn, nowValue));
        const nextState = { ...fallback.nextState, gameplay: { ...fallback.nextState.gameplay, pendingAssignments: [] } };
        return {
          nextState,
          response: {
            status: "deadline_resolved",
            turn: nextState.turn,
            settled_by: "deadline",
            dropped_plan: true,
            facts: fallback.facts,
            city_version_after: nextState.version
          }
        };
      }
      const nextState = { ...result.nextState, gameplay: { ...result.nextState.gameplay, pendingAssignments: [], scheduler: normalizeScheduler(result.nextState.gameplay.scheduler ?? {}) } };
      return {
        nextState,
        response: {
          status: "deadline_resolved",
          turn: nextState.turn,
          settled_by: "deadline",
          facts: result.facts,
          city_version_after: nextState.version
        }
      };
    }
    return { nextState: null, response: { status: "noop", reason: "unknown_action" } };
  }

  async function run() {
    while (!stopped) {
      await pollOnce();
      if (!stopped) await delay(config.turnSchedulerPollMs ?? 1000);
    }
  }

  return {
    pollOnce,
    processCity,
    run,
    stop: () => { stopped = true; }
  };
}

function schedulerContext(config, cityId, turn, nowValue) {
  return {
    seed: hashSeed(`${cityId}:turn-${turn}`),
    now: () => nowValue.toISOString(),
    options: {
      turnIntervalMs: config.turnIntervalMs,
      turnDeadlineMs: config.turnDeadlineMs,
      settlementSource: "deadline"
    }
  };
}

function reasonFor(action) {
  switch (action) {
    case "init": return "city predates turn scheduling; seed wall-clock schedule";
    case "open-next": return "wall-clock unlock reached for the next turn";
    case "resolve-deadline": return "turn deadline reached without an Agent settlement";
    default: return null;
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
