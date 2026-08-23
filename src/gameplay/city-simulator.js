import { createBlankVoxelWorldContract } from "../city/voxel-world.js";
import { createCityState } from "../city/state.js";
import { createEngineContext, executeCityCommand } from "../city/engine.js";
import { findCandidateParcels, getEntranceFrontageCells } from "../city/solver.js";
import { initializeFreshCitySchedule, openNextTurn } from "./turn.js";
import { ECONOMY_RULES } from "./economy.js";
import { BUILDING_COST_BY_PURPOSE } from "./construction-cost.js";
import { resolvePublicServiceBaselineTurn } from "./simulation.js";

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
const SIMULATION_COOLDOWN_MS = 1000;
const SIMULATION_START_TIME = "2040-01-01T08:00:00.000Z";

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
  state = initializeFreshCitySchedule(state, SIMULATION_START_TIME, { turnCooldownMs: SIMULATION_COOLDOWN_MS });

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
        const commandState = state;
        const commandDigest = stableStateDigest(commandState);
        const roadResult = executeCityCommand(state, {
          type: "connect",
          from: { kind: "node", id: "old_town_entry" },
          to: { kind: "cell", id: roadTarget },
          mode: "road",
          actor: "system:headless-simulator"
        }, context);
        actions.push(actionRecord("connect", roadResult, {
          target: roadTarget,
          purpose: "bootstrap_access",
          stateUnchanged: roadResult.accepted ? null : stableStateDigest(roadResult.state) === commandDigest
        }));
        if (roadResult.accepted) {
          state = roadResult.state;
          totalRoadSpend += Number(roadResult.plan?.cost?.coins ?? 0);
          roadsBuilt += Number(roadResult.plan?.roadCells?.length ?? 0) + Number(roadResult.plan?.bridgeCells?.length ?? 0);
        }
      } else {
        actions.push({ type: "connect", accepted: false, code: "NO_BOOTSTRAP_TARGET", reason: "No legal road target exists", stateUnchanged: true });
      }
    }

    let proposalChoice = chooseProposal(state, strategy, seed, turnNumber);
    if (!proposalChoice) {
      const extension = extendRoadFrontage(state, strategy, seed, turnNumber, context);
      if (extension) {
        actions.push(extension.action);
        if (extension.action.accepted) {
          state = extension.state;
          totalRoadSpend += Number(extension.result.plan?.cost?.coins ?? 0);
          roadsBuilt += Number(extension.result.plan?.roadCells?.length ?? 0)
            + Number(extension.result.plan?.bridgeCells?.length ?? 0);
          proposalChoice = chooseProposal(state, strategy, seed, turnNumber);
        }
      }
    }
    if (proposalChoice) {
      const commandState = state;
      const commandDigest = stableStateDigest(commandState);
      const result = executeCityCommand(state, {
        type: "construct_building",
        proposal: makeProposal(proposalChoice, strategy, turnNumber, seed)
      }, context);
      actions.push(actionRecord("construct_building", result, {
        lotId: proposalChoice.lotId,
        requestedPurpose: proposalChoice.purpose,
        entrance: proposalChoice.entrance,
        stateUnchanged: result.accepted ? null : stableStateDigest(result.state) === commandDigest
      }));
      if (result.accepted) {
        state = result.state;
        totalConstructionSpend += Number(result.preview?.cost?.coins ?? 0);
        totalRoadSpend += Number(result.preview?.connectionPlan?.cost?.coins ?? 0);
        roadsBuilt += Number(result.preview?.connectionPlan?.roadCells?.length ?? 0)
          + Number(result.preview?.connectionPlan?.bridgeCells?.length ?? 0);
      }
    } else {
      actions.push({ type: "construct_building", accepted: false, code: "NO_LEGAL_CANDIDATE", reason: "No legal site and affordable canonical building candidate exists", stateUnchanged: true });
    }

    const settlementBefore = snapshotSettlement(state);
    const settlementStateDigest = stableStateDigest(state);
    const resolvedAt = simulationTime(turnNumber);
    const resolved = resolvePublicServiceBaselineTurn(state, { expectedTurn: state.turn }, {
      now: () => resolvedAt,
      createId: context.createId,
      // A fixed roller is supplied even though PR-D mode disables incidents.
      roller: () => 0.5,
      options: { settlementSource: "agent", turnCooldownMs: SIMULATION_COOLDOWN_MS }
    });
    let schedule = null;
    if (resolved.error) {
      anomalies.push({ turn: turnNumber, code: resolved.error.code, message: resolved.error.message });
      actions.push({ type: "resolve_turn", accepted: false, code: resolved.error.code, reason: resolved.error.message, stateUnchanged: stableStateDigest(resolved.nextState) === settlementStateDigest });
    } else {
      actions.push({ type: "resolve_turn", accepted: true, turn: turnNumber });
      const retryDigest = stableStateDigest(resolved.nextState);
      const retry = resolvePublicServiceBaselineTurn(resolved.nextState, { expectedTurn: resolved.nextState.turn }, {
        now: () => resolvedAt,
        createId: context.createId,
        options: { settlementSource: "agent", turnCooldownMs: SIMULATION_COOLDOWN_MS }
      });
      actions.push({
        type: "resolve_turn_retry",
        accepted: !retry.error,
        code: retry.error?.code ?? "UNEXPECTED_RETRY_SUCCESS",
        reason: retry.error?.message ?? "A resolved turn was accepted twice",
        stateUnchanged: stableStateDigest(retry.nextState) === retryDigest
      });
      const unlockAt = resolved.nextState.gameplay.nextTurnUnlockAt;
      const reopenAt = new Date(Math.max(new Date(resolvedAt).getTime(), new Date(unlockAt).getTime())).toISOString();
      const reopened = openNextTurn(resolved.nextState, reopenAt, { turnCooldownMs: SIMULATION_COOLDOWN_MS });
      if (!reopened) {
        anomalies.push({ turn: turnNumber, code: "TURN_REOPEN_FAILED", message: `Turn did not unlock at ${reopenAt}` });
        state = resolved.nextState;
      } else {
        schedule = {
          openedAt: resolved.nextState.gameplay.turnOpenedAt,
          resolvedAt,
          unlockAt,
          reopenedAt: reopened.gameplay.turnOpenedAt,
          nextUnlockAt: reopened.gameplay.nextTurnUnlockAt
        };
        state = reopened;
      }
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
        turnStart: before.coins,
        actionsSpend: acceptedSpend(actions),
        beforeSettlement: settlementBefore.coins,
        income: Number(facts?.resourceDelta?.coins ?? 0),
        after: settlementAfter.coins
      },
      arcaneEnergy: {
        turnStart: before.arcaneEnergy,
        actionsSpend: 0,
        beforeSettlement: settlementBefore.arcaneEnergy,
        income: Number(facts?.resourceDelta?.arcaneEnergy ?? 0),
        after: settlementAfter.arcaneEnergy
      },
      population: populationReport(state, facts),
      publicService: publicServiceReport(facts),
      schedule,
      stallReason: constructionAccepted ? null : stallReason(actions, state),
      invariants: checkInvariants(before, state, facts, actions)
    };
    report.invariants.push(invariant("REPORT_FINITE", reportNumbersFinite(report), "All numeric report values must be finite"));
    report.anomalies = report.invariants.filter((entry) => !entry.ok);
    report.anomalies.forEach((entry) => anomalies.push({ turn: turnNumber, code: entry.code, message: entry.message }));
    timeline.push(report);
  }

  const final = snapshotSettlement(state);
  const validInvariants = timeline.every((entry) => entry.invariants.every((invariant) => invariant.ok));
  const cumulativeIncome = timeline.reduce((sum, entry) => sum + entry.coins.income, 0);
  const recentWindow = timeline.slice(-Math.min(5, timeline.length));
  const recent = {
    turns: recentWindow.length,
    income: recentWindow.reduce((sum, entry) => sum + entry.coins.income, 0),
    spend: recentWindow.reduce((sum, entry) => sum + entry.coins.actionsSpend, 0),
    builds: recentWindow.reduce((sum, entry) => sum + Object.values(entry.buildings.builtThisTurn).reduce((inner, count) => inner + count, 0), 0),
    stalls: recentWindow.filter((entry) => entry.stallReason != null).length
  };
  const cumulativeSpend = timeline.reduce((sum, entry) => sum + entry.coins.actionsSpend, 0);
  const selfFunding = cumulativeIncome >= cumulativeSpend && recent.income >= recent.spend && recent.stalls === 0;
  const canAffordNextBuild = final.coins >= Math.min(...Object.values(BUILDING_COST_BY_PURPOSE));
  return {
    schemaVersion: 1,
    seed,
    strategy,
    turnsRequested: turns,
    rules: {
      initialCoins: ECONOMY_RULES.initialCoins,
      initialArcaneEnergy: ECONOMY_RULES.initialArcaneEnergy,
      migrationRate: ECONOMY_RULES.defaultMigrationRate,
      buildingCostByPurpose: structuredClone(BUILDING_COST_BY_PURPOSE),
      publicService: structuredClone(ECONOMY_RULES.publicService)
    },
    timeline,
    summary: {
      turns: timeline.length,
      finalTurn: state.turn,
      cumulativeConstruction: { buildings: totalBuildings, byPurpose: buildingsByPurpose, coins: totalConstructionSpend },
      cumulativeRoad: { cells: roadsBuilt, coins: totalRoadSpend },
      cumulativeIncome,
      recentWindow: recent,
      selfFunding,
      canAffordNextBuild,
      continuousStallTurns: maximumContinuousStall,
      sustainable: validInvariants && totalBuildings > 0 && final.coins >= 0 && selfFunding && canAffordNextBuild,
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

// A canonical, insertion-order-independent state digest lets rejected command
// records prove that an engine failure did not mutate the authority state.
function stableStateDigest(value) {
  const serialize = (entry) => {
    if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(",")}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${serialize(entry[key])}`).join(",")}}`;
  };
  return serialize(value);
}

function simulationTime(turn) {
  const timestamp = new Date(new Date(SIMULATION_START_TIME).getTime() + Math.max(1, Number(turn)) * 86_400_000);
  return timestamp.toISOString();
}

function pickBootstrapRoadTarget(state) {
  const gateway = state.nodes?.old_town_entry?.cellId;
  if (!gateway) return null;
  const candidates = findCandidateParcels(state, { footprint: "1x1", limit: 1000 })
    .filter((candidate) => candidate.lotId !== gateway)
    .sort((left, right) => {
      const leftParts = cellParts(left.lotId);
      const rightParts = cellParts(right.lotId);
      const gatewayParts = cellParts(gateway);
      return Math.abs(leftParts.row - gatewayParts.row) - Math.abs(rightParts.row - gatewayParts.row)
        || manhattan(right.lotId, gateway) - manhattan(left.lotId, gateway)
        || left.lotId.localeCompare(right.lotId);
    });
  return candidates[0]?.lotId ?? null;
}

function chooseProposal(state, strategy, seed, turn) {
  const candidates = findCandidateParcels(state, { footprint: "1x1", limit: 5000 })
    .filter((candidate) => candidate.context.adjacentRoad && candidate.context.roadFrontageDirections.length > 0);
  if (!candidates.length) return null;
  const buildings = Object.values(state.buildings ?? {});
  const residential = buildings.filter((building) => building.gameplay?.units?.some((unit) => unit.purpose === "residential"));
  const services = buildings.filter((building) => building.gameplay?.units?.some((unit) => unit.purpose === "public_service"));
  const priorities = strategyPriorities(strategy, turn);
  const purpose = priorities[0];
  const ranked = candidates.map((candidate) => {
    const distanceToResidence = distanceToBuilding(candidate, residential);
    const distanceToService = distanceToBuilding(candidate, services);
    const stable = stableToken(`${seed}:${strategy}:${turn}:${candidate.lotId}`);
    const tie = Number.parseInt(stable.slice(-6), 16) / 0xffffff;
    return {
      candidate,
      distanceToResidence,
      distanceToService,
      clusterDistance: distanceToBuilding(candidate, buildings),
      tie,
      purpose,
      rank: candidateRank({ candidate, distanceToResidence, distanceToService, clusterDistance: distanceToBuilding(candidate, buildings), tie }, purpose, strategy)
    };
  });
  const best = ranked.sort((left, right) => compareTuple(left.rank, right.rank) || left.candidate.lotId.localeCompare(right.candidate.lotId))[0];
  if (!best) return null;
  const entrance = best.candidate.context.roadFrontageDirections[0];
  return {
    ...best.candidate,
    purpose: best.purpose,
    entrance,
    entranceCellId: getEntranceFrontageCells(state, best.candidate.footprintCells, entrance)[0] ?? null
  };
}

function extendRoadFrontage(state, strategy, seed, turn, context) {
  const roads = Object.values(state.cells ?? {})
    .filter((cell) => cell.infrastructure === "road" || state.infrastructure?.[cell.id]?.type === "bridge")
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!roads.length) return null;
  const candidates = findCandidateParcels(state, { footprint: "1x1", limit: 5000 })
    .filter((candidate) => !candidate.context.adjacentRoad)
    .map((candidate) => ({ candidate, target: roadableNeighbor(state, candidate.lotId), tie: stableToken(`${seed}:${strategy}:${turn}:${candidate.lotId}`) }))
    .filter((entry) => entry.target)
    .sort((left, right) => manhattan(left.candidate.lotId, roads[0].id) - manhattan(right.candidate.lotId, roads[0].id)
      || left.tie.localeCompare(right.tie)
      || left.candidate.lotId.localeCompare(right.candidate.lotId));
  const selected = candidates[0];
  if (!selected) return null;
  const source = roads.sort((left, right) => manhattan(left.id, selected.target) - manhattan(right.id, selected.target) || left.id.localeCompare(right.id))[0];
  const commandState = state;
  const commandDigest = stableStateDigest(commandState);
  const result = executeCityCommand(state, {
    type: "connect",
    from: { kind: "cell", id: source.id },
    to: { kind: "cell", id: selected.target },
    mode: "road",
    actor: "agent:headless-simulator"
  }, context);
  return {
    result,
    state: result.accepted ? result.state : state,
    action: actionRecord("connect", result, {
      target: selected.target,
      purpose: "frontage_extension",
      stateUnchanged: result.accepted ? null : stableStateDigest(result.state) === commandDigest
    })
  };
}

function roadableNeighbor(state, lotId) {
  const parts = cellParts(lotId);
  const neighbors = [[parts.column - 1, parts.row], [parts.column + 1, parts.row], [parts.column, parts.row - 1], [parts.column, parts.row + 1]]
    .map(([column, row]) => state.cells?.[`cell-${column}-${row}`])
    .filter(Boolean)
    .filter((cell) => cell.buildable !== false && cell.strictBuildable !== false && !cell.occupancy && !cell.reservation);
  return neighbors.sort((left, right) => left.id.localeCompare(right.id))[0]?.id ?? null;
}

function strategyPriorities(strategy, turn) {
  switch (strategy) {
    case "housing-first": return ["residential"];
    case "economy-first": return [turn % 2 ? "production" : "commercial"];
    case "service-first": return [turn <= 3 ? "public_service" : (turn % 3 === 1 ? "residential" : "public_service")];
    default: return [["production", "residential", "commercial", "residential", "public_service", "greenhouse"][((turn - 1) % 6)]];
  }
}

function candidateRank(entry, purpose, strategy) {
  // All candidates have real road frontage. The remaining tuple is purpose
  // aware and independently computed, so ranking cannot use a non-transitive
  // pairwise comparator or accidentally prefer an off-road parcel.
  if (purpose === "public_service") return [entry.distanceToResidence, entry.clusterDistance, entry.tie];
  if (purpose === "residential" && (strategy === "service-first" || strategy === "balanced")) {
    return [entry.distanceToService, entry.clusterDistance, entry.tie];
  }
  if (strategy === "economy-first") return [entry.clusterDistance, entry.tie];
  return [entry.clusterDistance, entry.tie];
}

function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = Number(left[index] ?? 0) - Number(right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function makeProposal(choice, strategy, turn, seed) {
  const purpose = choice.purpose;
  const ratio = purpose === "public_service" || purpose === "production" ? 0.5 : purpose === "greenhouse" ? 0.25 : 0;
  return {
    id: `sim-proposal-${stableToken(`${seed}:${strategy}:${turn}:${choice.lotId}`)}`,
    actor: `agent:headless-${strategy}`,
    site: { lotId: choice.lotId, footprint: "1x1", entrance: choice.entrance, entranceCellId: choice.entranceCellId },
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

function acceptedSpend(actions) {
  return actions.filter((action) => action.accepted && (action.type === "connect" || action.type === "construct_building"))
    .reduce((sum, action) => sum + Number(action.cost?.coins ?? 0), 0);
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
  checks.push(invariant("TARGET_BOUNDS", [target.muggles, target.wizards, target.total].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
    && Number(target.muggles ?? 0) <= state.gameplay.population.muggles.capacity
    && Number(target.wizards ?? 0) <= state.gameplay.population.wizards.capacity, "Migration targets must be finite and within capacity"));
  const migrationWithinTarget = ["muggles", "wizards"].every((bucket) => {
    const prior = Number(before.population[bucket].current);
    const next = Number(state.gameplay.population[bucket].current);
    const desired = Number(target[bucket] ?? 0);
    return next >= Math.min(prior, desired) && next <= Math.max(prior, desired);
  });
  checks.push(invariant("MIGRATION_NO_OVERSHOOT", migrationWithinTarget, "Migration must move toward target without crossing it"));
  const service = facts?.publicService ?? {};
  checks.push(invariant("SERVICE_BOUNDS", Number.isFinite(Number(service.serviceCoverage)) && Number(service.serviceCoverage) >= 0 && Number(service.serviceCoverage) <= 1
    && Object.values(service.migrationRate ?? {}).every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1), "Service coverage and migration rates must be finite and bounded"));
  checks.push(invariant("ONE_SETTLEMENT", state.turn === before.turn + 1 && facts?.turn === state.turn, "Each timeline turn must settle exactly once"));
  checks.push(invariant("REJECTED_COMMAND_NO_MUTATION", actions.filter((action) => !action.accepted).every((action) => action.stateUnchanged === true), "Rejected commands must leave authoritative state unchanged"));
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

function reportNumbersFinite(report) {
  const inspect = (value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(inspect);
    if (value && typeof value === "object") return Object.values(value).every(inspect);
    return true;
  };
  return inspect({ coins: report.coins, arcaneEnergy: report.arcaneEnergy, population: report.population, publicService: report.publicService, construction: report.construction, roads: report.roads });
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

function cellParts(id) {
  const match = /^cell-(\d+)-(\d+)$/.exec(id);
  return { column: Number(match?.[1] ?? 0), row: Number(match?.[2] ?? 0) };
}
