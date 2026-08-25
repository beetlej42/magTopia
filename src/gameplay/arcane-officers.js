import { normalizeArcaneOfficer } from "./schema.js";
import { createRoller, hashSeed } from "./random.js";

export const ARCANE_OFFICER_HIRE_COST_COINS = 150;
export const ARCANE_OFFICER_CAPACITY_DIVISOR = 10;
export const ARCANE_OFFICER_MAINTENANCE_COINS = 10;
export const ARCANE_OFFICER_CONFIG = Object.freeze({ refreshIntervalTurns: 3, candidateCount: 3, hireCostCoins: ARCANE_OFFICER_HIRE_COST_COINS, maintenanceCoinsPerTurn: ARCANE_OFFICER_MAINTENANCE_COINS, capacityDivisor: 10, growthChance: 0.08, criticalGrowthChance: 0.2, attributeCap: 5 });
export const ARCANE_OFFICER_PURPOSES = Object.freeze(["residential", "commercial", "public_service", "production", "greenhouse"]);
export const LEGACY_OFFICER_SPECIALTIES = Object.freeze(["investigation", "suppression", "cover_up", "containment", "concealment"]);

function validatedConfig(options = {}) {
  const config = { ...ARCANE_OFFICER_CONFIG, ...options, ...(options.config ?? {}) };
  const integer = (name, minimum, maximum = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(Number(config[name])) || Number(config[name]) < minimum || Number(config[name]) > maximum) {
      throw new Error(`Invalid arcane officer config: ${name}`);
    }
    config[name] = Number(config[name]);
  };
  integer("refreshIntervalTurns", 1);
  integer("candidateCount", 2, 3);
  integer("hireCostCoins", 120, 180);
  integer("maintenanceCoinsPerTurn", 8, 12);
  integer("attributeCap", 0, 5);
  if (!Number.isFinite(Number(config.capacityDivisor)) || Number(config.capacityDivisor) <= 0) {
    throw new Error("Invalid arcane officer config: capacityDivisor");
  }
  config.capacityDivisor = Number(config.capacityDivisor);
  for (const name of ["growthChance", "criticalGrowthChance"]) {
    if (!Number.isFinite(Number(config[name])) || Number(config[name]) < 0 || Number(config[name]) > 1) {
      throw new Error(`Invalid arcane officer config: ${name}`);
    }
    config[name] = Number(config[name]);
  }
  if (config.growthChance > config.criticalGrowthChance) {
    throw new Error("Invalid arcane officer config: growthChance must not exceed criticalGrowthChance");
  }
  return config;
}

export function arcaneOfficerCapacity(state, options = {}) {
  const config = validatedConfig(options);
  const wizards = Number(state?.gameplay?.population?.wizards?.current ?? 0);
  return Math.floor(Math.max(0, wizards) / config.capacityDivisor);
}

export function arcaneOfficerRoster(state) {
  return Object.values(state?.gameplay?.arcaneOfficers ?? {});
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
export function recruitmentConfigSummary(options = {}) {
  const config = validatedConfig(options);
  return {
    refresh_interval_turns: config.refreshIntervalTurns,
    candidate_count: config.candidateCount,
    hire_cost_coins: config.hireCostCoins,
    maintenance_coins_per_turn: config.maintenanceCoinsPerTurn,
    capacity_divisor: config.capacityDivisor,
    growth_chance: config.growthChance,
    critical_growth_chance: config.criticalGrowthChance,
    attribute_cap: config.attributeCap
  };
}
function poolWindow(turn, config) { return Math.floor(Number(turn ?? 0) / Number(config.refreshIntervalTurns)); }
function poolForWindow(cityId, window, config) {
  const seed = `${String(cityId)}:arcane-officer-candidates:${window}`;
  return Array.from({ length: config.candidateCount }, (_, index) => {
    const candidateId = `officer-candidate-${hashSeed(`${seed}:${index}`).toString(16)}`;
    const identity = generateArcaneOfficerIdentity({ seed: `${seed}:${index}`, id: candidateId, hiredAtTurn: window * config.refreshIntervalTurns, nameIndex: index });
    return { candidateId, identity, costCoins: config.hireCostCoins, status: "available", window };
  });
}

function normalizeCandidate(candidate, id, fallbackWindow) {
  return {
    candidateId: String(candidate.candidateId ?? id),
    identity: normalizeArcaneOfficer(candidate.identity ?? candidate),
    costCoins: Number.isSafeInteger(Number(candidate.costCoins)) && Number(candidate.costCoins) >= 0 ? Number(candidate.costCoins) : ARCANE_OFFICER_CONFIG.hireCostCoins,
    status: ["available", "recruited", "expired"].includes(candidate.status) ? candidate.status : "available",
    window: Number.isSafeInteger(Number(candidate.window)) ? Number(candidate.window) : fallbackWindow
  };
}

export function normalizeRecruitmentState(value = {}) {
  const window = Number.isSafeInteger(Number(value.window)) ? Number(value.window) : null;
  return { schemaVersion: 1, window, candidates: Object.fromEntries(Object.entries(value.candidates ?? {}).map(([id, candidate]) => [String(id), normalizeCandidate(candidate, id, window ?? 0)])) };
}

function candidateMatches(left, right) {
  return left.candidateId === right.candidateId && left.costCoins === right.costCoins && JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

export function ensureOfficerCandidatePool(state, cityId = state?.cityId ?? "", options = {}) {
  const config = validatedConfig(options);
  const desiredWindow = poolWindow(state.turn, config);
  const current = normalizeRecruitmentState(state.gameplay?.arcaneOfficerRecruitment);
  const expected = poolForWindow(cityId, desiredWindow, config);
  const persisted = current.window === desiredWindow ? current.candidates : {};
  const candidates = Object.fromEntries(expected.map((candidate) => {
    const prior = persisted[candidate.candidateId];
    return [candidate.candidateId, prior && candidateMatches(prior, candidate) ? { ...candidate, status: prior.status } : candidate];
  }));
  const unchanged = current.window === desiredWindow && expected.every((candidate) => persisted[candidate.candidateId] && candidateMatches(persisted[candidate.candidateId], candidate));
  if (unchanged) return state;
  return { ...state, gameplay: { ...state.gameplay, arcaneOfficerRecruitment: { schemaVersion: 1, window: desiredWindow, candidates } } };
}

export function currentOfficerCandidates(state, cityId = state?.cityId ?? "", options = {}) {
  const refreshed = ensureOfficerCandidatePool(state, cityId, options);
  const recruitment = normalizeRecruitmentState(refreshed.gameplay?.arcaneOfficerRecruitment);
  return { state: refreshed, candidates: Object.values(recruitment.candidates).filter((candidate) => candidate.status === "available") };
}

function candidateInputId(input) {
  const keys = Object.keys(input ?? {});
  if (keys.some((key) => !["candidateId", "candidate_id"].includes(key)) || (input.candidateId != null && input.candidate_id != null)) {
    return { error: { code: "ARCANE_OFFICER_FORGERY", message: "Recruitment accepts only one candidate_id" } };
  }
  const id = input.candidateId ?? input.candidate_id;
  if (id == null || String(id).trim() === "") return { error: { code: "ARCANE_OFFICER_CANDIDATE_REQUIRED", message: "Recruitment requires a current candidate_id" } };
  return { id: String(id) };
}

export function hireArcaneOfficerCandidate(state, input = {}, context = {}) {
  const config = validatedConfig({ ...(context.options ?? {}), ...(context.config ?? {}) });
  const parsed = candidateInputId(input);
  if (parsed.error) return { accepted: false, error: parsed.error };
  if (!arcaneOfficerRecruitmentUnlocked(state, context.options ?? {})) return { accepted: false, error: { code: "ARCANE_OFFICER_RECRUITMENT_LOCKED", message: "Recruitment requires a completed Ministry of Magic or governance facility" } };
  const officers = state?.gameplay?.arcaneOfficers ?? {};
  const capacity = arcaneOfficerCapacity(state, config);
  if (Object.keys(officers).length >= capacity) return { accepted: false, error: { code: "ARCANE_OFFICER_CAPACITY_REACHED", message: `Arcane officer roster is at its capacity of ${capacity}` } };
  const pool = currentOfficerCandidates(state, context.cityId ?? state.cityId ?? "", config);
  const candidate = pool.candidates.find((entry) => entry.candidateId === parsed.id);
  if (!candidate) return { accepted: false, error: { code: "ARCANE_OFFICER_CANDIDATE_INVALID", message: "candidate_id is not a current available recruitment candidate" } };
  const coins = state?.resources?.coins;
  if (!Number.isSafeInteger(coins) || coins < 0) return { accepted: false, error: { code: "INVALID_COINS_LEDGER", message: "Authoritative coins ledger is invalid" } };
  if (coins < candidate.costCoins) return { accepted: false, error: { code: "INSUFFICIENT_COINS", message: `Hiring an arcane officer requires ${candidate.costCoins} coins but only ${coins} available` } };
  const officer = normalizeArcaneOfficer({ ...candidate.identity, hiredAtTurn: state.turn, history: [] });
  const recruitment = normalizeRecruitmentState(pool.state.gameplay.arcaneOfficerRecruitment);
  const afterCoins = coins - candidate.costCoins;
  return {
    accepted: true,
    arcaneOfficer: officer,
    candidate,
    cost: candidate.costCoins,
    nextState: {
      ...pool.state,
      resources: { ...pool.state.resources, coins: afterCoins },
      gameplay: { ...pool.state.gameplay, resources: { ...(pool.state.gameplay.resources ?? {}), coins: afterCoins }, arcaneOfficers: { ...officers, [officer.id]: officer }, arcaneOfficerRecruitment: { ...recruitment, candidates: { ...recruitment.candidates, [parsed.id]: { ...candidate, status: "recruited" } } } }
    }
  };
}

export function maintenanceForRoster(state, options = {}) {
  const config = validatedConfig(options);
  const count = arcaneOfficerRoster(state).length;
  return { count, rate: config.maintenanceCoinsPerTurn, total: count * config.maintenanceCoinsPerTurn };
}
