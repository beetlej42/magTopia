import { normalizeScheduler } from "../../src/gameplay/schema.js";
import { dueActionFor, initializeTurnSchedule, normalizeTurnSchedule, openNextTurn } from "../../src/gameplay/turn.js";
import { ensureCardOffer, openTurnCardState } from "../../src/gameplay/cards.js";

// The turn scheduler is the only server-owned wall-clock actor. It never
// settles a turn and never invents gameplay: there is no deadline auto-settle
// and no offline multi-turn catch-up. It only (a) lazily seeds a schedule for
// cities that predate scheduling and (b) opens a settled turn once its
// persisted unlock time is reached. Resolving a turn is always the Agent's /
// the normal gameplay flow's job, gated by the cooldown `nextTurnUnlockAt`.
// Every mutation goes through repository.schedulerTransact(), which takes the
// city row lock and deduplicates by idempotency key, so retries and concurrent
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
    if ((state?.turn != null && Number(state.turn) === 0) || state?.gameplay?.turnKind === "bootstrap") {
      return { nextState: null, response: { status: "noop", reason: "bootstrap_requires_agent_resolve" } };
    }
    if (action === "init") {
      const initialized = initializeTurnSchedule(state, nowValue, schedule);
      if (!initialized) return { nextState: null, response: { status: "noop", reason: "not_initializable" } };
      // Every opened turn carries one canonical card offer. Existing cities
      // that predate the card system receive one lazily here.
      const withCards = ensureCardOffer(initialized, cityId);
      return {
        nextState: withCards,
        response: {
          status: "opened",
          turn: withCards.turn,
          turn_status: withCards.gameplay.turnStatus,
          turn_opened_at: withCards.gameplay.turnOpenedAt,
          turn_deadline_at: withCards.gameplay.turnDeadlineAt,
          next_turn_unlock_at: withCards.gameplay.nextTurnUnlockAt,
          city_version_after: withCards.version
        }
      };
    }
    if (action === "open-next") {
      const opened = openNextTurn(state, nowValue, schedule);
      if (!opened) return { nextState: null, response: { status: "noop", reason: "not_unlocked" } };
      // Reset the choice and create the canonical offer for the newly opened
      // turn; pending delegated placements deliberately survive settlement.
      const withCards = openTurnCardState(opened, cityId, { turn: opened.turn, now: () => nowValue.toISOString() });
      return {
        nextState: withCards,
        response: {
          status: "opened",
          turn: withCards.turn,
          turn_status: withCards.gameplay.turnStatus,
          turn_opened_at: withCards.gameplay.turnOpenedAt,
          turn_deadline_at: withCards.gameplay.turnDeadlineAt,
          next_turn_unlock_at: withCards.gameplay.nextTurnUnlockAt,
          city_version_after: withCards.version
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

function reasonFor(action) {
  switch (action) {
    case "init": return "city predates turn scheduling; seed wall-clock schedule";
    case "open-next": return "wall-clock unlock reached for the next turn";
    default: return null;
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
