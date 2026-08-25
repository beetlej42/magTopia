import { normalizeArcaneOfficer } from "./schema.js";
import { createRoller, hashSeed } from "./random.js";

export const ARCANE_OFFICER_HIRE_COST_COINS = 150;
export const ARCANE_OFFICER_CAPACITY_DIVISOR = 10;
export const ARCANE_OFFICER_MAINTENANCE_COINS = 10;
export const ARCANE_OFFICER_CONFIG = Object.freeze({ refreshIntervalTurns: 3, candidateCount: 3, hireCostCoins: ARCANE_OFFICER_HIRE_COST_COINS, maintenanceCoinsPerTurn: ARCANE_OFFICER_MAINTENANCE_COINS, capacityDivisor: 10, growthChance: 0.08, criticalGrowthChance: 0.2, attributeCap: 5 });
export const ARCANE_OFFICER_PURPOSES = Object.freeze(["residential", "commercial", "public_service", "production", "greenhouse"]);
export const LEGACY_OFFICER_SPECIALTIES = Object.freeze(["investigation", "suppression", "cover_up", "containment", "concealment"]);

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

export function arcaneOfficerCapacity(state, options = {}) {
  const wizards = state?.gameplay?.population?.wizards?.current ?? 0;
  return Math.floor(wizards / Number(options.capacityDivisor ?? ARCANE_OFFICER_CONFIG.capacityDivisor));
}

export function arcaneOfficerRoster(state) {
  return Object.values(state?.gameplay?.arcaneOfficers ?? {});
}

export function hireArcaneOfficer(state, input = {}, context = {}) {
  // Kept as an explicit migration guard: all external recruitment must use a
  // current candidate_id. Trusted cards call generateArcaneOfficerIdentity.
  if (context?.systemGrant === true) {
    const officers = state?.gameplay?.arcaneOfficers ?? {};
    if (Object.keys(officers).length >= arcaneOfficerCapacity(state)) return { accepted: false, error: { code: "ARCANE_OFFICER_CAPACITY_REACHED", message: "Arcane Officer roster is at capacity" } };
    const officer = generateArcaneOfficerIdentity({ seed: `${context.cityId ?? state.cityId ?? ""}:system:${state.turn}:${Object.keys(officers).length}`, id: context.createId?.("arcaneOfficer"), hiredAtTurn: state.turn });
    return { accepted: true, arcaneOfficer: officer, cost: 0, nextState: { ...state, gameplay: { ...state.gameplay, arcaneOfficers: { ...officers, [officer.id]: officer } } } };
  }
  return { accepted: false, error: { code: "ARCANE_OFFICER_CANDIDATE_REQUIRED", message: "Arcane Officer recruitment requires a current candidate_id" } };
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

const IDENTITY_NAMES = Object.freeze(["Vesper Lark", "Rowan Featherstone", "Mira Holler", "Cassian Dusk", "Ivy Thornbush", "Silas Moonshadow", "Elowen Reed", "Cormac Whistler", "Seraphine Vale", "Bram Bramble", "Isolde Nightingale", "Percival Ashcroft"]);
function generatedProfile(seed) {
  const roller = createRoller({ seed: hashSeed(`${seed}:profile`) }); const total = 7 + Math.floor(roller.next() * 3); const values = [1, 1, 1]; let remaining = total - 3;
  while (remaining > 0) { const slot = Math.floor(roller.next() * 3); if (values[slot] < 5) { values[slot] += 1; remaining -= 1; } }
  return { investigation: values[0], suppression: values[1], coverUp: values[2], specialty: ARCANE_OFFICER_PURPOSES[Math.floor(roller.next() * ARCANE_OFFICER_PURPOSES.length)] };
}
export function generateArcaneOfficerIdentity({ seed = "arcane-officer", id, hiredAtTurn = 0, nameIndex = 0, profile } = {}) {
  const identitySeed = String(seed); const roller = createRoller({ seed: hashSeed(`${identitySeed}:identity`) }); const generated = profile ?? generatedProfile(identitySeed); const name = IDENTITY_NAMES[(nameIndex + Math.floor(roller.next() * IDENTITY_NAMES.length)) % IDENTITY_NAMES.length];
  const values = [generated.investigation, generated.suppression, generated.coverUp].map(Number);
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 5) || values.reduce((sum, value) => sum + value, 0) < 7 || values.reduce((sum, value) => sum + value, 0) > 9 || !ARCANE_OFFICER_PURPOSES.includes(generated.specialty)) throw new Error("Arcane Officer identity profile must contain integer 0..5 attributes totaling 7..9 and one purpose specialty");
  return normalizeArcaneOfficer({ id: String(id ?? `arcane-officer-${hashSeed(identitySeed).toString(16)}`), name, archetype: "purpose_specialist", appearanceSeed: hashSeed(`${identitySeed}:appearance`), visualRef: `arcane-officer-${hashSeed(`${identitySeed}:visual`).toString(16)}`, investigation: generated.investigation, suppression: generated.suppression, coverUp: generated.coverUp, specialty: generated.specialty, specialties: [generated.specialty], status: "available", hiredAtTurn, history: [] });
}
function governanceStructureId(building) { return String(building?.specialStructure?.id ?? building?.specialStructure?.structureId ?? building?.specialStructure?.cardId ?? "").toLowerCase(); }
export function isGovernanceFacility(building, options = {}) {
  if (!building || building.status === "sealed" || (building.status && !["completed", "active"].includes(building.status))) return false;
  const ids = new Set(options.governanceStructureIds ?? ["ministry-of-magic", "ministry_of_magic", "ministry-of-magic-hq"]); const programs = new Set(options.governancePrograms ?? ["ministry_of_magic", "ministry-of-magic", "magical_governance"]); const structure = governanceStructureId(building); const structureName = String(building.specialStructure?.name ?? "").toLowerCase(); const program = String(building.program?.canonicalProgram ?? building.program?.programId ?? building.metadata?.canonicalProgram ?? building.metadata?.programId ?? "").toLowerCase(); const programName = String(building.program?.canonicalName ?? building.program?.name ?? building.metadata?.canonicalName ?? "").toLowerCase(); const tags = [...(building.tags ?? []), ...(building.program?.tags ?? []), ...(building.metadata?.tags ?? [])].map((tag) => String(tag).toLowerCase());
  return ids.has(structure) || ["ministry of magic", "ministry of magic headquarters"].includes(structureName) || programs.has(program) || ["ministry of magic", "ministry of magic headquarters"].includes(programName) || tags.includes("ministry_of_magic") || tags.includes("governance_facility");
}
export function arcaneOfficerRecruitmentUnlocked(state, options = {}) { return options.recruitmentUnlocked === true || Object.values(state?.buildings ?? {}).some((building) => isGovernanceFacility(building, options)); }
export function recruitmentConfigSummary(options = {}) { const config = { ...ARCANE_OFFICER_CONFIG, ...options }; return { refresh_interval_turns: config.refreshIntervalTurns, candidate_count: config.candidateCount, hire_cost_coins: config.hireCostCoins, maintenance_coins_per_turn: config.maintenanceCoinsPerTurn, capacity_divisor: config.capacityDivisor, growth_chance: config.growthChance, critical_growth_chance: config.criticalGrowthChance, attribute_cap: config.attributeCap }; }
function poolWindow(turn, config) { return Math.floor(Number(turn ?? 0) / Number(config.refreshIntervalTurns)); }
function poolForWindow(cityId, window, config) { const seed = `${String(cityId)}:arcane-officer-candidates:${window}`; return Array.from({ length: Number(config.candidateCount) }, (_, index) => { const candidateId = `officer-candidate-${hashSeed(`${seed}:${index}`).toString(16)}`; const identity = generateArcaneOfficerIdentity({ seed: `${seed}:${index}`, id: candidateId, hiredAtTurn: window * config.refreshIntervalTurns, nameIndex: index }); return { candidateId, identity, costCoins: config.hireCostCoins, status: "available", window }; }); }
export function normalizeRecruitmentState(value = {}) { return { schemaVersion: 1, window: Number.isSafeInteger(Number(value.window)) ? Number(value.window) : null, candidates: Object.fromEntries(Object.entries(value.candidates ?? {}).map(([id, candidate]) => [String(id), { candidateId: String(candidate.candidateId ?? id), identity: normalizeArcaneOfficer(candidate.identity ?? candidate), costCoins: Number.isSafeInteger(Number(candidate.costCoins)) && Number(candidate.costCoins) >= 0 ? Number(candidate.costCoins) : ARCANE_OFFICER_CONFIG.hireCostCoins, status: ["available", "recruited", "expired"].includes(candidate.status) ? candidate.status : "available", window: Number(candidate.window ?? value.window ?? 0) }])) }; }
export function ensureOfficerCandidatePool(state, cityId = state?.cityId ?? "", options = {}) { const config = { ...ARCANE_OFFICER_CONFIG, ...options, ...(options.config ?? {}) }; const desiredWindow = poolWindow(state.turn, config); const current = normalizeRecruitmentState(state.gameplay?.arcaneOfficerRecruitment); if (current.window === desiredWindow && Object.keys(current.candidates).length > 0) return state; const candidates = Object.fromEntries(poolForWindow(cityId, desiredWindow, config).map((candidate) => [candidate.candidateId, candidate])); return { ...state, gameplay: { ...state.gameplay, arcaneOfficerRecruitment: { ...current, window: desiredWindow, candidates } } }; }
export function currentOfficerCandidates(state, cityId = state?.cityId ?? "", options = {}) { const refreshed = ensureOfficerCandidatePool(state, cityId, options); return { state: refreshed, candidates: Object.values(normalizeRecruitmentState(refreshed.gameplay?.arcaneOfficerRecruitment).candidates).filter((candidate) => candidate.status === "available") }; }
export function hireArcaneOfficerCandidate(state, input = {}, context = {}) { const config = { ...ARCANE_OFFICER_CONFIG, ...(context.options ?? {}), ...(context.config ?? {}), ...(context.options?.config ?? {}) }; if (!arcaneOfficerRecruitmentUnlocked(state, context.options ?? {})) return { accepted: false, error: { code: "ARCANE_OFFICER_RECRUITMENT_LOCKED", message: "Recruitment requires a completed Ministry of Magic or governance facility" } }; const capacity = arcaneOfficerCapacity(state, config); const officers = state?.gameplay?.arcaneOfficers ?? {}; if (Object.keys(officers).length >= capacity) return { accepted: false, error: { code: "ARCANE_OFFICER_CAPACITY_REACHED", message: `Arcane officer roster is at its capacity of ${capacity}` } }; const pool = currentOfficerCandidates(state, context.cityId ?? state.cityId ?? "", { ...context.options, config }); const candidateId = String(input.candidateId ?? input.candidate_id ?? ""); const candidate = pool.candidates.find((entry) => entry.candidateId === candidateId); if (!candidate) return { accepted: false, error: { code: "ARCANE_OFFICER_CANDIDATE_INVALID", message: "candidate_id is not a current available recruitment candidate" } }; const coins = Number(state?.resources?.coins); if (!Number.isSafeInteger(coins) || coins < config.hireCostCoins) return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring an arcane officer requires ${config.hireCostCoins} coins but only ${coins} available` } }; const officer = normalizeArcaneOfficer({ ...candidate.identity, hiredAtTurn: state.turn, history: [] }); const candidates = { ...normalizeRecruitmentState(pool.state.gameplay.arcaneOfficerRecruitment).candidates, [candidateId]: { ...candidate, status: "recruited" } }; const nextState = { ...pool.state, resources: { ...pool.state.resources, coins: coins - config.hireCostCoins }, gameplay: { ...pool.state.gameplay, resources: { ...(pool.state.gameplay.resources ?? {}), coins: coins - config.hireCostCoins }, arcaneOfficers: { ...officers, [officer.id]: officer }, arcaneOfficerRecruitment: { ...pool.state.gameplay.arcaneOfficerRecruitment, candidates } } }; return { accepted: true, arcaneOfficer: officer, candidate, cost: config.hireCostCoins, nextState }; }
export function maintenanceForRoster(state, options = {}) { const config = { ...ARCANE_OFFICER_CONFIG, ...options, ...(options.config ?? {}) }; const count = arcaneOfficerRoster(state).length; return { count, rate: config.maintenanceCoinsPerTurn, total: count * config.maintenanceCoinsPerTurn }; }
