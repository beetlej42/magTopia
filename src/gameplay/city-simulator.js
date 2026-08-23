import { createBlankVoxelWorldContract } from "../city/voxel-world.js";
import { createCityState } from "../city/state.js";
import { createEngineContext, executeCityCommand } from "../city/engine.js";
import { findCandidateParcels } from "../city/solver.js";
import { ECONOMY_RULES } from "./economy.js";
import { resolveTurn } from "./simulation.js";

export const CITY_SIMULATION_STRATEGIES = Object.freeze([
  "balanced",
  "housing-first",
  "economy-first",
  "service-first"
]);

const PURPOSES = Object.freeze(["residential", "commercial", "production", "public_service", "greenhouse"]);
const DEFAULT_TURNS = 20;
const MAX_TURNS = 100;
const SIMULATION_WORLD_COLUMNS = 30;
const SIMULATION_WORLD_ROWS = 30;

/**
 * Run a deterministic, headless municipal build. Every mutation goes through
 * the city solver/engine and every settlement goes through resolveTurn; this
 * module only selects legal proposals and records facts for comparison.
 */
export function runCitySimulation(options = {}) {
  const turns = normalizeTurns(options.turns ?? DEFAULT_TURNS);
  const strategy = normalizeStrategy(options.strategy ?? "balanced");
  const seed = normalizeSeed(options.seed ?? "city-simulation-001");
  const world = createBlankVoxelWorldContract({
    seed,
    mapId: `headless-city-${seed}`,
    columns: SIMULATION_WORLD_COLUMNS,
    rows: SIMULATION_WORLD_ROWS,
    terrainSubdivisions: 4
  });
  let state = createCityState(world, {
    cityId: `headless-city-${seed}`,
    mapSeed: seed
  });

  const context = createEngineContext({
    now: () => simulationTime(state.turn + 1),
    createId: deterministicIds(seed)
  });
  const timeline = [];
  const anomalies = [];
  let maximumContinuousStall = 0;
  let continuousStall = 0;
  let totalConstructionSpend = 0;
  let totalRoadSpend = 0;
  let totalBuildings = 0;
  let roadsBuilt = 0;
  const buildingsByPurpose = Object.fromEntries(PURPOSES.map((purpose) => [purpose, 0]));

  for (let turn = 1; turn <= turns; turn += 1) {
    const turnNumber = state.turn + 1;
    const before = snapshotTurnState(state);
    const actions = [];
    const buildingsBefore = Object.keys(state.buildings ?? {}).length;
    const buildingCountsBefore = countBuildingsByPurpose(state);

    // Bootstrap access is itself a legal road command. It is intentionally
    // performed through the node/road solver, not by writing infrastructure.
    if (turn === 1) {
      const roadTarget = pickBootstrapRoadTarget(state);
      if (roadTarget) {
        const roadResult = executeCityCommand(state, {
          type: "connect",
          from: { kind: "node", id: "old_town_entry" },
          to: { kind: "cell", id: roadTarget },
          mode: "road",
          actor: "system:headless-simulator"
        }, context);
        actions.push(actionRecord("connect", roadResult, {
          target: roadTarget,
          purpose: "bootstrap_access"
        }));
        if (roadResult.accepted) {
          state = roadResult.state;
          totalRoadSpend += Number(roadResult.plan?.cost?.coins ?? 0);
          roadsBuilt += Number(roadResult.plan?.roadCells?.length ?? 0) + Number(roadResult.plan?.bridgeCells?.length ?? 0);
        }
      } else {
        actions.push({ type: "connect", accepted: false, code: "NO_BOOTSTRAP_TARGET", reason: "No legal road target exists" });
      }
    }

    const proposalChoice = chooseProposal(state, strategy, seed, turnNumber);
    if (proposalChoice) {
      const result = executeCityCommand(state, {
        type: "construct_building",
        proposal: makeProposal(proposalChoice, strategy, turnNumber, seed)
      }, context);
      actions.push(actionRecord("construct_building", result, {
        lotId: proposalChoice.lotId,
        requestedPurpose: proposalChoice.purpose,
        entrance: proposalChoice.entrance
      }));
      if (result.accepted) {
        state = result.state;
        totalConstructionSpend += Number(result.preview?.cost?.coins ?? 0);
        totalRoadSpend += Number(result.preview?.connectionPlan?.cost?.coins ?? 0);
        roadsBuilt += Number(result.preview?.connectionPlan?.roadCells?.length ?? 0)
          + Number(result.preview?.connectionPlan?.bridgeCells?.length ?? 0);
      }
    } else {
      actions.push({ type: "construct_building", accepted: false, code: "NO_LEGAL_CANDIDATE", reason: "No legal site and affordable canonical building candidate exists" });
    }

    const settlementBefore = snapshotSettlement(state);
    const resolved = resolveTurn(state, { expectedTurn: state.turn }, {
      now: () => simulationTime(turnNumber),
      createId: context.createId,
      // A fixed roller is supplied even though PR-D mode disables incidents.
      roller: () => 0.5,
      options: {
        enableCards: false,
        enableIncidents: false,
        enableExposure: false
      }
    });
    if (resolved.error) {
      anomalies.push({ turn: turnNumber, code: resolved.error.code, message: resolved.error.message });
      actions.push({ type: "resolve_turn", accepted: false, code: resolved.error.code, reason: resolved.error.message });
    } else {
      actions.push({ type: "resolve_turn", accepted: true, turn: turnNumber });
      state = openNextTurn(resolved.nextState);
    }

    const facts = resolved.facts;
    const settlementAfter = snapshotSettlement(state);
    const buildingsAfter = Object.keys(state.buildings ?? {}).length;
    const buildingCountsAfter = countBuildingsByPurpose(state);
    const constructionAccepted = actions.some((action) => action.type === "construct_building" && action.accepted);
    if (constructionAccepted) continuousStall = 0;
    else continuousStall += 1;
    maximumContinuousStall = Math.max(maximumContinuousStall, continuousStall);
    totalBuildings = buildingsAfter;
    PURPOSES.forEach((purpose) => { buildingsByPurpose[purpose] = buildingCountsAfter[purpose]; });

    const report = {
      turn: turnNumber,
      actions,
      buildings: {
        before: buildingsBefore,
        after: buildingsAfter,
        byPurpose: buildingCountsAfter,
        builtThisTurn: diffCounts(buildingCountsBefore, buildingCountsAfter)
      },
      construction: {
        spend: sumAcceptedBuildingCost(actions),
        cumulativeSpend: totalConstructionSpend
      },
      roads: {
        spend: sumAcceptedRoadCost(actions),
        cumulativeSpend: totalRoadSpend,
        cellsBuiltThisTurn: roadsBuilt - (timeline.at(-1)?.roads?.cumulativeCells ?? 0),
        cumulativeCells: roadsBuilt
      },
      coins: {
        before: settlementBefore.coins,
        income: Number(facts?.resourceDelta?.coins ?? 0),
        after: settlementAfter.coins
      },
      arcaneEnergy: {
        before: settlementBefore.arcaneEnergy,
        income: Number(facts?.resourceDelta?.arcaneEnergy ?? 0),
        after: settlementAfter.arcaneEnergy
      },
      population: populationReport(state, facts),
      publicService: publicServiceReport(facts),
      stallReason: constructionAccepted ? null : stallReason(actions, state),
      invariants: checkInvariants(before, state, facts, actions)
    };
    report.anomalies = report.invariants.filter((entry) => !entry.ok);
    report.anomalies.forEach((entry) => anomalies.push({ turn: turnNumber, code: entry.code, message: entry.message }));
    timeline.push(report);
  }

  const final = snapshotSettlement(state);
  const validInvariants = timeline.every((entry) => entry.invariants.every((invariant) => invariant.ok));
  return {
    schemaVersion: 1,
    seed,
    strategy,
    turnsRequested: turns,
    rules: {
      initialCoins: ECONOMY_RULES.initialCoins,
      initialArcaneEnergy: ECONOMY_RULES.initialArcaneEnergy,
      migrationRate: ECONOMY_RULES.defaultMigrationRate,
      publicService: structuredClone(ECONOMY_RULES.publicService)
    },
    timeline,
    summary: {
      turns: timeline.length,
      finalTurn: state.turn,
      cumulativeConstruction: { buildings: totalBuildings, byPurpose: buildingsByPurpose, coins: totalConstructionSpend },
      cumulativeRoad: { cells: roadsBuilt, coins: totalRoadSpend },
      continuousStallTurns: maximumContinuousStall,
      sustainable: validInvariants && totalBuildings > 0 && final.coins >= 0,
      anomalies,
      final: {
        coins: final.coins,
        arcaneEnergy: final.arcaneEnergy,
        population: structuredClone(state.gameplay.population)
      }
    },
    // Expose the final authority state for diagnostics and downstream tests;
    // callers should treat timeline/summary as the stable report surface.
    finalState: state
  };
}

export function normalizeTurns(value) {
  const turns = Number(value);
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > MAX_TURNS) {
    throw new RangeError(`turns must be an integer from 1 to ${MAX_TURNS}`);
  }
  return turns;
}

export function normalizeStrategy(value) {
  const strategy = String(value).trim().toLowerCase();
  if (!CITY_SIMULATION_STRATEGIES.includes(strategy)) {
    throw new RangeError(`strategy must be one of: ${CITY_SIMULATION_STRATEGIES.join(", ")}`);
  }
  return strategy;
}

function normalizeSeed(value) {
  const seed = String(value).trim();
  if (!seed || seed.length > 120) throw new RangeError("seed must be 1–120 characters");
  return seed;
}

function deterministicIds(seed) {
  const counters = new Map();
  return (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `sim-${stableToken(seed)}-${prefix}-${next}`;
  };
}

function stableToken(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function simulationTime(turn) {
  return `2040-01-${String(Math.min(28, Math.max(1, turn))).padStart(2, "0")}T08:00:00.000Z`;
}

function pickBootstrapRoadTarget(state) {
  const gateway = state.nodes?.old_town_entry?.cellId;
  if (!gateway) return null;
  const candidates = findCandidateParcels(state, { footprint: "1x1", limit: 1000 })
    .filter((candidate) => candidate.lotId !== gateway)
    .sort((left, right) => manhattan(left.lotId, gateway) - manhattan(right.lotId, gateway) || left.lotId.localeCompare(right.lotId));
  return candidates[0]?.lotId ?? null;
}

function chooseProposal(state, strategy, seed, turn) {
  const candidates = findCandidateParcels(state, { footprint: "1x1", limit: 5000 });
  if (!candidates.length) return null;
  const buildings = Object.values(state.buildings ?? {});
  const residential = buildings.filter((building) => building.gameplay?.units?.some((unit) => unit.purpose === "residential"));
  const services = buildings.filter((building) => building.gameplay?.units?.some((unit) => unit.purpose === "public_service"));
  const priorities = strategyPriorities(strategy, turn);
  const ranked = candidates.map((candidate, index) => {
    const distanceToResidence = distanceToBuilding(candidate, residential);
    const distanceToService = distanceToBuilding(candidate, services);
    const roadBonus = candidate.context.adjacentRoad ? -30 : 0;
    const stable = stableToken(`${seed}:${strategy}:${turn}:${candidate.lotId}`);
    const tie = Number.parseInt(stable.slice(-6), 16) / 0xffffff;
    return { candidate, index, distanceToResidence, distanceToService, roadBonus, tie, purpose: priorities[0] };
  });
  const best = ranked.sort((left, right) => scoreCandidate(right, left, strategy) - scoreCandidate(left, right, strategy)
    || left.candidate.lotId.localeCompare(right.candidate.lotId))[0];
  return best ? { ...best.candidate, purpose: best.purpose, entrance: best.candidate.entranceDirections[0] } : null;
}

function strategyPriorities(strategy, turn) {
  switch (strategy) {
    case "housing-first": return ["residential"];
    case "economy-first": return [turn % 2 ? "production" : "commercial"];
    case "service-first": return [turn <= 3 ? "public_service" : (turn % 3 === 1 ? "residential" : "public_service")];
    default: return [["production", "residential", "commercial", "residential", "public_service", "greenhouse"][((turn - 1) % 6)]];
  }
}

function scoreCandidate(right, left, strategy) {
  // The selected purpose is attached to both candidates by chooseProposal;
  // spatial scoring is strategy-only and never grants a legality exception.
  const rightRoad = right.roadBonus ?? 0;
  const leftRoad = left.roadBonus ?? 0;
  if (strategy === "economy-first") return rightRoad - leftRoad || left.tie - right.tie;
  if (strategy === "service-first") return (left.distanceToResidence - right.distanceToResidence) || rightRoad - leftRoad || left.tie - right.tie;
  if (strategy === "housing-first") return (left.distanceToResidence - right.distanceToResidence) || left.tie - right.tie;
  return rightRoad - leftRoad || (left.distanceToResidence - right.distanceToResidence) || left.tie - right.tie;
}

function makeProposal(choice, strategy, turn, seed) {
  const purpose = choice.purpose;
  const ratio = purpose === "public_service" || purpose === "production" ? 0.5 : purpose === "greenhouse" ? 0.25 : 0;
  return {
    id: `sim-proposal-${stableToken(`${seed}:${strategy}:${turn}:${choice.lotId}`)}`,
    actor: `agent:headless-${strategy}`,
    site: { lotId: choice.lotId, footprint: "1x1", entrance: choice.entrance },
    program: {
      archetype: `sim_${purpose}`,
      purpose,
      name: `${purpose.replaceAll("_", " ")} ${turn}`,
      description: `Deterministic ${strategy} municipal ${purpose} bootstrap`
    },
    gameplayBuilding: { units: [{ purpose, area: 1, magicRatio: ratio }] },
    design: { districtStyle: "london_common", patterns: [], prompt: `A compact ${purpose} building for the headless city simulation.` }
  };
}

function actionRecord(type, result, extra = {}) {
  return {
    type,
    accepted: Boolean(result.accepted),
    ...(result.accepted
      ? {
        code: "OK",
        cost: structuredClone(result.preview?.cost ?? result.plan?.cost ?? { coins: 0 }),
        ...(result.preview?.buildingCost ? { buildingCost: structuredClone(result.preview.buildingCost) } : {}),
        ...(result.preview?.connectionPlan?.cost ? { roadCost: structuredClone(result.preview.connectionPlan.cost) } : {})
      }
      : { code: result.code ?? "REJECTED", reason: result.errors?.[0] ?? result.message ?? "Command rejected" }),
    ...extra
  };
}

function sumAcceptedBuildingCost(actions) {
  return actions.filter((action) => action.type === "construct_building" && action.accepted)
    .reduce((sum, action) => sum + Number(action.buildingCost?.coins ?? action.cost?.coins ?? 0), 0);
}

function sumAcceptedRoadCost(actions) {
  return actions.filter((action) => action.accepted && (action.type === "connect" || action.type === "construct_building"))
    .reduce((sum, action) => sum + Number(action.type === "connect" ? action.cost?.coins ?? 0 : action.roadCost?.coins ?? 0), 0);
}

function populationReport(state, facts) {
  const population = state.gameplay.population;
  const delta = facts?.populationDelta ?? {};
  return {
    muggles: { current: population.muggles.current, capacity: population.muggles.capacity, target: facts?.publicService?.supportedTarget?.muggles ?? 0, delta: delta.muggles?.current ?? 0 },
    wizards: { current: population.wizards.current, capacity: population.wizards.capacity, target: facts?.publicService?.supportedTarget?.wizards ?? 0, delta: delta.wizards?.current ?? 0 },
    total: population.muggles.current + population.wizards.current,
    capacity: population.muggles.capacity + population.wizards.capacity,
    target: (facts?.publicService?.supportedTarget?.total ?? 0)
  };
}

function publicServiceReport(facts) {
  const service = facts?.publicService ?? {};
  return {
    coverage: Number(service.serviceCoverage ?? 0),
    target: structuredClone(service.supportedTarget ?? { muggles: 0, wizards: 0, total: 0 }),
    migrationRates: structuredClone(service.migrationRate ?? { muggles: 0, wizards: 0 }),
    servicedOccupancy: Number(service.supportedOccupancy ?? 0)
  };
}

function stallReason(actions, state) {
  const rejected = actions.find((action) => action.type === "construct_building" && !action.accepted);
  if (rejected) return `${rejected.code}: ${rejected.reason}`;
  if (state.resources.coins < 50) return "INSUFFICIENT_RESOURCES: coins below the cheapest canonical building";
  return "NO_VALID_CONSTRUCTION";
}

function snapshotTurnState(state) {
  return { turn: state.turn, version: state.version, coins: state.resources.coins, arcaneEnergy: state.gameplay.resources.arcaneEnergy, population: structuredClone(state.gameplay.population) };
}

function snapshotSettlement(state) {
  return { coins: Number(state.resources?.coins ?? 0), arcaneEnergy: Number(state.gameplay?.resources?.arcaneEnergy ?? 0) };
}

function countBuildingsByPurpose(state) {
  const counts = Object.fromEntries(PURPOSES.map((purpose) => [purpose, 0]));
  for (const building of Object.values(state.buildings ?? {})) {
    for (const unit of building.gameplay?.units ?? []) if (counts[unit.purpose] != null) counts[unit.purpose] += 1;
  }
  return counts;
}

function diffCounts(before, after) {
  return Object.fromEntries(PURPOSES.map((purpose) => [purpose, after[purpose] - before[purpose]]));
}

function checkInvariants(before, state, facts, actions) {
  const checks = [];
  const values = [state.resources.coins, state.gameplay.resources.arcaneEnergy, ...Object.values(state.gameplay.population).flatMap((bucket) => [bucket.current, bucket.capacity])];
  checks.push(invariant("FINITE_VALUES", values.every(Number.isFinite), "Resource and population values must be finite"));
  checks.push(invariant("NON_NEGATIVE_RESOURCES", state.resources.coins >= 0 && state.gameplay.resources.arcaneEnergy >= 0, "Coins and Arcane Energy must be non-negative"));
  checks.push(invariant("POPULATION_BOUNDS", Object.values(state.gameplay.population).every((bucket) => bucket.current >= 0 && bucket.current <= bucket.capacity), "Population must stay within capacity"));
  const target = facts?.publicService?.supportedTarget ?? {};
  checks.push(invariant("TARGET_BOUNDS", [target.muggles, target.wizards, target.total].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0), "Migration targets must be finite and non-negative"));
  checks.push(invariant("ONE_SETTLEMENT", state.turn === before.turn + 1 && facts?.turn === state.turn, "Each timeline turn must settle exactly once"));
  const accepted = actions.filter((action) => action.accepted);
  const spend = accepted.filter((action) => action.type === "construct_building" || action.type === "connect")
    .reduce((sum, action) => sum + Number(action.cost?.coins ?? 0), 0);
  const income = Number(facts?.resourceDelta?.coins ?? 0);
  const expectedCoins = before.coins - spend + income;
  checks.push(invariant("LEDGER_SPEND_PERSISTED", accepted.every((action) => Number(action.cost?.coins ?? 0) >= 0)
    && state.resources.coins === expectedCoins, "Construction/road spend must remain debited after settlement"));
  return checks;
}

function invariant(code, ok, message) { return { code, ok: Boolean(ok), message: ok ? null : message }; }

function openNextTurn(state) {
  return {
    ...state,
    gameplay: {
      ...state.gameplay,
      turnStatus: "open",
      turnOpenedAt: null,
      turnDeadlineAt: null,
      nextTurnUnlockAt: null,
      scheduler: null
    }
  };
}

function distanceToBuilding(candidate, buildings) {
  if (!buildings.length) return 999;
  return Math.min(...buildings.flatMap((building) => (building.footprintCells ?? []).map((cellId) => manhattan(candidate.lotId, cellId))));
}

function manhattan(left, right) {
  const a = /^cell-(\d+)-(\d+)$/.exec(left);
  const b = /^cell-(\d+)-(\d+)$/.exec(right);
  return a && b ? Math.abs(Number(a[1]) - Number(b[1])) + Math.abs(Number(a[2]) - Number(b[2])) : 999;
}
