import { normalizeVeilWarden } from "./schema.js";

export const WARDEN_HIRE_COST_COINS = 50;
export const WARDEN_CAPACITY_DIVISOR = 10;

export function wardenCapacity(state) {
  const wizards = state?.gameplay?.population?.wizards?.current ?? 0;
  return Math.floor(wizards / WARDEN_CAPACITY_DIVISOR);
}

export function wardenRoster(state) {
  return Object.values(state?.gameplay?.wardens ?? {});
}

export function hireWarden(state, input = {}, context = {}) {
  const wardens = state?.gameplay?.wardens ?? {};
  const capacity = wardenCapacity(state);
  const rosterSize = Object.keys(wardens).length;
  if (rosterSize >= capacity) {
    return { accepted: false, error: { code: "WARDEN_CAPACITY_REACHED", message: `Warden roster is at its capacity of ${capacity}` } };
  }
  const cost = Number.isFinite(Number(input.cost)) ? Number(input.cost) : WARDEN_HIRE_COST_COINS;
  const coins = state?.gameplay?.resources?.coins ?? 0;
  if (coins < cost) {
    return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring a warden requires ${cost} coins but only ${coins} available` } };
  }
  const warden = normalizeVeilWarden({
    id: String(input.id ?? context.createId?.("warden") ?? `warden-${rosterSize + 1}`),
    name: String(input.name ?? "Unnamed Veil Warden"),
    investigation: input.investigation ?? 1,
    containment: input.containment ?? 1,
    concealment: input.concealment ?? 1,
    specialties: input.specialties ?? [],
    status: "available",
    hiredAtTurn: state.turn
  });
  const nextState = {
    ...state,
    gameplay: {
      ...state.gameplay,
      resources: { ...state.gameplay.resources, coins: coins - cost },
      wardens: { ...wardens, [warden.id]: warden }
    }
  };
  return { accepted: true, warden, cost, nextState };
}

export function setWardenStatus(state, wardenId, status) {
  const warden = state?.gameplay?.wardens?.[wardenId];
  if (!warden) return { ok: false, error: { code: "WARDEN_NOT_FOUND", message: `Unknown warden ${wardenId}` } };
  const normalized = normalizeVeilWarden({ ...warden, status });
  return {
    ok: true,
    nextState: {
      ...state,
      gameplay: {
        ...state.gameplay,
        wardens: { ...state.gameplay.wardens, [wardenId]: normalized }
      }
    }
  };
}
