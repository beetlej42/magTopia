import { normalizeArcaneOfficer } from "./schema.js";

export const ARCANE_OFFICER_HIRE_COST_COINS = 50;
export const ARCANE_OFFICER_CAPACITY_DIVISOR = 10;

export const ARCANE_OFFICER_ARCHETYPES = Object.freeze({
  trainee: Object.freeze({ label: "Trainee", investigation: 1, suppression: 1, coverUp: 1, specialties: [] }),
  investigation: Object.freeze({ label: "Investigation Officer", investigation: 3, suppression: 1, coverUp: 2, specialties: ["investigation"] }),
  suppression: Object.freeze({ label: "Suppression Officer", investigation: 1, suppression: 3, coverUp: 2, specialties: ["suppression"] }),
  cover_up: Object.freeze({ label: "Cover-up Officer", investigation: 1, suppression: 2, coverUp: 3, specialties: ["cover_up"] }),
  veteran: Object.freeze({ label: "Veteran", investigation: 3, suppression: 3, coverUp: 3, specialties: ["investigation", "suppression", "cover_up"] })
});

export const HIREABLE_ARCANE_OFFICER_ARCHETYPES = Object.freeze(["trainee", "investigation", "suppression", "cover_up"]);

export function arcaneOfficerArchetype(archetype) {
  return ARCANE_OFFICER_ARCHETYPES[archetype] ?? ARCANE_OFFICER_ARCHETYPES.trainee;
}

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
  const coins = Number(state?.resources?.coins);
  if (!Number.isSafeInteger(coins) || coins < 0) {
    return { accepted: false, error: { code: "INVALID_COINS_LEDGER", message: "The authoritative construction coins ledger is invalid" } };
  }
  if (coins < cost) {
    return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring an arcane officer requires ${cost} coins but only ${coins} available` } };
  }
  const archetypeId = String(input.archetype ?? "trainee");
  const profile = context.profile
    ?? arcaneOfficerArchetype(archetypeId);
  if (!context.profile && !HIREABLE_ARCANE_OFFICER_ARCHETYPES.includes(archetypeId)) {
    return { accepted: false, error: { code: "ARCANE_OFFICER_ARCHETYPE_NOT_ALLOWED", message: `Archetype ${archetypeId} cannot be hired directly; it requires a trusted profile or promotion` } };
  }
  if (!Number.isFinite(Number(profile.investigation)) || !Number.isFinite(Number(profile.suppression ?? profile.containment)) || !Number.isFinite(Number(profile.coverUp ?? profile.cover_up ?? profile.concealment))) {
    return { accepted: false, error: { code: "INVALID_OFFICER_PROFILE", message: "Officer profile requires numeric investigation, suppression, and coverUp" } };
  }
  const officer = normalizeArcaneOfficer({
    id: String(input.id ?? context.createId?.("arcaneOfficer") ?? `arcaneOfficer-${rosterSize + 1}`),
    name: String(input.name ?? profile.label ?? "Unnamed Arcane Officer"),
    investigation: profile.investigation,
    suppression: profile.suppression ?? profile.containment,
    coverUp: profile.coverUp ?? profile.cover_up ?? profile.concealment,
    specialties: profile.specialties ?? [],
    archetype: profile.archetype ?? archetypeId,
    status: "available",
    hiredAtTurn: state.turn
  });
  const nextState = {
    ...state,
    resources: { ...(state.resources ?? {}), coins: coins - cost },
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
