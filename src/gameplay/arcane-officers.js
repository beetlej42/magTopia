import { normalizeArcaneOfficer } from "./schema.js";

export const ARCANE_OFFICER_HIRE_COST_COINS = 50;
export const ARCANE_OFFICER_CAPACITY_DIVISOR = 10;

export const ARCANE_OFFICER_ARCHETYPES = Object.freeze({
  trainee: Object.freeze({ label: "Trainee", investigation: 1, containment: 1, concealment: 1, specialties: [] }),
  investigation: Object.freeze({ label: "Investigation Officer", investigation: 3, containment: 1, concealment: 2, specialties: ["investigation"] }),
  containment: Object.freeze({ label: "Containment Officer", investigation: 1, containment: 3, concealment: 2, specialties: ["containment"] }),
  concealment: Object.freeze({ label: "Concealment Officer", investigation: 1, containment: 2, concealment: 3, specialties: ["concealment"] }),
  veteran: Object.freeze({ label: "Veteran", investigation: 3, containment: 3, concealment: 3, specialties: ["investigation", "containment", "concealment"] })
});

export const HIREABLE_ARCANE_OFFICER_ARCHETYPES = Object.freeze(["trainee", "investigation", "containment", "concealment"]);

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
  const coins = state?.gameplay?.resources?.coins ?? 0;
  if (coins < cost) {
    return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring an arcane officer requires ${cost} coins but only ${coins} available` } };
  }
  const archetypeId = String(input.archetype ?? "trainee");
  const profile = context.profile
    ?? arcaneOfficerArchetype(archetypeId);
  if (!context.profile && !HIREABLE_ARCANE_OFFICER_ARCHETYPES.includes(archetypeId)) {
    return { accepted: false, error: { code: "ARCANE_OFFICER_ARCHETYPE_NOT_ALLOWED", message: `Archetype ${archetypeId} cannot be hired directly; it requires a trusted profile or promotion` } };
  }
  if (!Number.isFinite(Number(profile.investigation)) || !Number.isFinite(Number(profile.containment)) || !Number.isFinite(Number(profile.concealment))) {
    return { accepted: false, error: { code: "INVALID_OFFICER_PROFILE", message: "Officer profile requires numeric investigation, containment, and concealment" } };
  }
  const officer = normalizeArcaneOfficer({
    id: String(input.id ?? context.createId?.("arcaneOfficer") ?? `arcaneOfficer-${rosterSize + 1}`),
    name: String(input.name ?? profile.label ?? "Unnamed Arcane Officer"),
    investigation: profile.investigation,
    containment: profile.containment,
    concealment: profile.concealment,
    specialties: profile.specialties ?? [],
    archetype: profile.archetype ?? archetypeId,
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
