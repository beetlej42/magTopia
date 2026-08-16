import { normalizeArcaneOfficer } from "./schema.js";

export const ARCANE_OFFICER_HIRE_COST_COINS = 50;
export const ARCANE_OFFICER_CAPACITY_DIVISOR = 10;

export function arcaneOfficerCapacity(state) {
  const wizards = state?.gameplay?.population?.wizards?.current ?? 0;
  return Math.floor(wizards / ARCANE_OFFICER_CAPACITY_DIVISOR);
}

export function arcaneOfficerRoster(state) {
  return Object.values(state?.gameplay?.arcaneOfficers ?? {});
}

export function hireArcaneOfficer(state, input = {}, context = {}) {
  const officers = state?.gameplay?.arcaneOfficers ?? {};
  const capacity = arcaneOfficerCapacity(state);
  const rosterSize = Object.keys(officers).length;
  if (rosterSize >= capacity) {
    return { accepted: false, error: { code: "ARCANE_OFFICER_CAPACITY_REACHED", message: `Arcane officer roster is at its capacity of ${capacity}` } };
  }
  const cost = ARCANE_OFFICER_HIRE_COST_COINS;
  const coins = state?.gameplay?.resources?.coins ?? 0;
  if (coins < cost) {
    return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring an arcane officer requires ${cost} coins but only ${coins} available` } };
  }
  const officer = normalizeArcaneOfficer({
    id: String(input.id ?? context.createId?.("arcaneOfficer") ?? `arcaneOfficer-${rosterSize + 1}`),
    name: String(input.name ?? "Unnamed Arcane Officer"),
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
      arcaneOfficers: { ...officers, [officer.id]: officer }
    }
  };
  return { accepted: true, arcaneOfficer: officer, cost, nextState };
}

export function setArcaneOfficerStatus(state, officerId, status) {
  const officer = state?.gameplay?.arcaneOfficers?.[officerId];
  if (!officer) return { ok: false, error: { code: "ARCANE_OFFICER_NOT_FOUND", message: `Unknown arcane officer ${officerId}` } };
  const normalized = normalizeArcaneOfficer({ ...officer, status });
  return {
    ok: true,
    nextState: {
      ...state,
      gameplay: {
        ...state.gameplay,
        arcaneOfficers: { ...state.gameplay.arcaneOfficers, [officerId]: normalized }
      }
    }
  };
}
