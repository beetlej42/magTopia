import {
  confirmBuildingDesign,
  createBuildingDesignDraft,
  createBuildingUpgradeDraft,
  reviseBuildingDesign
} from "./building-design.js";
import { createEngineContext, executeCityCommand } from "./engine.js";
import { GAMEPLAY_PURPOSES } from "../gameplay/schema.js";
import { findCandidateParcels } from "./solver.js";
import { createCityState } from "./state.js";
import { createBlankVoxelWorldContract } from "./voxel-world.js";

const FIXED_TIME = "2026-08-02T08:00:00.000Z";

const DISTRICT_PROGRAM = Object.freeze([
  {
    id: "lantern-row",
    name: "Lantern Row",
    purpose: "compact residential and shopping street",
    bounds: { minColumn: 42, maxColumn: 47, minRow: 18, maxRow: 25 },
    buildings: [
      { name: "Lantern House", footprint: "1x1", entrance: "south", purpose: "residential", gameplayPurpose: "residential", style: "victorian_domestic", frontage: "residential", floors: 2 },
      { name: "Moon Tailor", footprint: "1x1", entrance: "north", purpose: "tailor shop", gameplayPurpose: "commercial", style: "victorian_gothic", frontage: "display", floors: 3 },
      { name: "Briar Apothecary", footprint: "1x1", entrance: "west", purpose: "apothecary", gameplayPurpose: "commercial", style: "victorian_gothic", frontage: "display", floors: 1 }
    ]
  },
  {
    id: "market-court",
    name: "Market Court",
    purpose: "market, guild and workshop quarter",
    bounds: { minColumn: 27, maxColumn: 34, minRow: 23, maxRow: 30 },
    buildings: [
      { name: "Mercury Market Hall", footprint: "3x2", entrance: "east", purpose: "covered market", gameplayPurpose: "commercial", style: "victorian_gothic", composition: "hall", frontage: "large_bay", prominence: "important" },
      { name: "Guild Courtyard", footprint: "2x2", entrance: "south", purpose: "guild meeting hall", gameplayPurpose: "public_service", style: "civic_classical", composition: "court", frontage: "institutional", prominence: "ordinary" },
      { name: "Clockmakers Yard", footprint: "2x2", entrance: "north", purpose: "clockwork workshops", gameplayPurpose: "production", style: "industrial_iron", composition: "yard", frontage: "workshop", prominence: "ordinary" }
    ]
  },
  {
    id: "west-bank",
    name: "West Bank",
    purpose: "riverside residential and civic quarter",
    bounds: { minColumn: 1, maxColumn: 5, minRow: 20, maxRow: 27 },
    buildings: [
      { name: "Bridgekeeper Cottage", footprint: "1x1", entrance: "east", purpose: "residential", gameplayPurpose: "residential", style: "victorian_domestic", frontage: "residential", floors: 2 },
      { name: "Starlight Academy", footprint: "3x2", entrance: "south", purpose: "neighbourhood school", gameplayPurpose: "public_service", style: "civic_classical", composition: "tower", frontage: "institutional", prominence: "landmark" }
    ]
  }
]);

/**
 * A deterministic, headless municipal Agent acceptance run. It consumes only
 * contracts and structured diagnostics: no camera, screenshot or vision model.
 */
export function runNonVisualAgentBuildScenario(options = {}) {
  const seed = String(options.seed ?? "agent-district-acceptance-001");
  const world = createBlankVoxelWorldContract({ seed, mapId: `agent-blank-${seed}` });
  let state = createCityState(world, {
    cityId: "city-agent-acceptance",
    mapSeed: seed,
    resources: { coins: 100_000 },
  });
  const engineContext = createEngineContext({ now: () => FIXED_TIME });
  const actions = [];
  const failures = [];
  const districtResults = [];
  let designSequence = 0;

  for (const district of DISTRICT_PROGRAM) {
    const result = executeCityCommand(state, {
      type: "define_district",
      id: district.id,
      name: district.name,
      purpose: district.purpose,
      bounds: district.bounds,
      actor: "agent:district-builder"
    }, engineContext);
    actions.push({ type: "define_district", districtId: district.id, accepted: result.accepted });
    if (!result.accepted) failures.push({ stage: "district_definition", districtId: district.id, error: result.errors?.[0], code: result.code });
    else state = result.state;
  }

  const roadTarget = pickRoadTarget(state, DISTRICT_PROGRAM.at(-1).bounds);
  const roadResult = roadTarget ? executeCityCommand(state, {
    type: "connect",
    from: { kind: "node", id: "old_town_entry" },
    to: { kind: "cell", id: roadTarget },
    mode: "road",
    actor: "agent:district-builder"
  }, engineContext) : { accepted: false, code: "NO_ROAD_TARGET", errors: ["No routeable western road target"] };
  actions.push({ type: "connect", purpose: "district_spine", accepted: roadResult.accepted, target: roadTarget, plan: roadResult.plan ?? null });
  if (!roadResult.accepted) failures.push({ stage: "district_roads", error: roadResult.errors?.[0], code: roadResult.code });
  else state = roadResult.state;

  for (const district of DISTRICT_PROGRAM) {
    const branch = pickDistrictRoadBranch(state, district.bounds);
    if (!branch) continue;
    const result = executeCityCommand(state, {
      type: "connect",
      from: { kind: "cell", id: branch.from },
      to: { kind: "cell", id: branch.to },
      mode: "road",
      actor: "agent:district-builder"
    }, engineContext);
    actions.push({ type: "connect", purpose: "district_branch", districtId: district.id, accepted: result.accepted, ...branch, plan: result.plan ?? null });
    if (!result.accepted) failures.push({ stage: "district_roads", districtId: district.id, error: result.errors?.[0], code: result.code });
    else state = result.state;
  }

  for (const district of DISTRICT_PROGRAM) {
    const buildingIds = [];
    for (const definition of district.buildings) {
      if (!GAMEPLAY_PURPOSES.includes(definition.gameplayPurpose)) {
        failures.push({ stage: "fixture_validation", districtId: district.id, building: definition.name, error: "Every fixture building must declare a valid gameplayPurpose" });
        continue;
      }
      const candidates = findCandidateParcels(state, {
        footprint: definition.footprint,
        bounds: district.bounds,
        districtId: district.id,
        limit: 100
      });
      const site = candidates.find((candidate) => candidate.context.roadFrontageDirections.includes(definition.entrance))
        ?? candidates.find((candidate) => candidate.context.adjacentRoad);
      if (!site) {
        failures.push({ stage: "site_search", districtId: district.id, building: definition.name, error: "No road-fronting legal parcel" });
        continue;
      }
      const entrance = site.context.roadFrontageDirections.includes(definition.entrance)
        ? definition.entrance
        : site.context.roadFrontageDirections[0];
      designSequence += 1;
      const designContext = {
        id: `design-${designSequence}`,
        seed: `${seed}:design:${designSequence}`,
        actor: "agent:district-builder",
        now: () => FIXED_TIME
      };
      try {
        let design = createBuildingDesignDraft({
          site: { lot_id: site.lotId, footprint: definition.footprint, entrance },
          intent: {
            name: definition.name,
            purpose: definition.purpose,
            description: `${definition.name} in ${district.name}`,
            style: definition.style,
            frontage: definition.frontage,
            composition: definition.composition,
            prominence: definition.prominence
          },
          requirements: { preferred_floors: definition.floors }
        }, designContext);
        const decorationAnchor = design.generation.mode === "floor_stack"
          ? "main/roof"
          : `${design.generation.sourceSpec.masses.find((mass) => mass.type !== "ground")?.id}/cap`;
        design = reviseBuildingDesign(design, {
          expected_revision: design.revision,
          operations: [{
            op: "add_decoration",
            decoration: { id: `detail-${designSequence}`, type: "roof_finial", anchor: decorationAnchor, parameters: { glow: 0.15 } }
          }]
        }, designContext);
        const confirmed = confirmBuildingDesign(design, { expected_revision: design.revision }, designContext);
        const primaryPort = confirmed.ports.find((port) => port.type === "primary_entrance");
        const proposal = {
          id: `proposal-${designSequence}`,
          actor: "agent:district-builder",
          districtId: district.id,
          site: {
            lotId: confirmed.site.lotId,
            footprint: confirmed.site.footprint,
            entrance: confirmed.site.entrance,
            entranceCellId: primaryPort.frontageCellId
          },
          program: {
            archetype: `voxel_${confirmed.generation.mode}`,
            purpose: definition.purpose,
            name: definition.name,
            description: `${definition.name} in ${district.name}`,
            attributes: { districtId: district.id }
          },
          gameplayBuilding: {
            units: [{
              purpose: definition.gameplayPurpose,
              area: footprintAreaFor(definition.footprint),
              magicRatio: 0
            }]
          },
          design: { districtStyle: definition.style, patterns: [], prompt: `${definition.name}, ${definition.style}, ${definition.purpose}` },
          voxelDesign: confirmed
        };
        const result = executeCityCommand(state, { type: "construct_building", proposal }, engineContext);
        actions.push({
          type: "construct_building",
          districtId: district.id,
          building: definition.name,
          accepted: result.accepted,
          code: result.code ?? null,
          lotId: site.lotId,
          footprint: definition.footprint,
          entrance,
          generationMode: confirmed.generation.mode,
          compileDiagnostics: confirmed.compileDiagnostics,
          connectionPlan: result.preview?.connectionPlan ?? null
        });
        if (!result.accepted) {
          failures.push({ stage: "construction", districtId: district.id, building: definition.name, error: result.errors?.[0], code: result.code });
          continue;
        }
        state = result.state;
        buildingIds.push(result.building.id);
      } catch (error) {
        failures.push({ stage: "design", districtId: district.id, building: definition.name, error: error.message });
      }
    }
    districtResults.push({ id: district.id, name: district.name, bounds: district.bounds, buildingIds });
  }

  const firstBuilding = Object.values(state.buildings)[0];
  if (firstBuilding?.voxelDesign) {
    try {
      const upgradeContext = { id: "upgrade-1", seed: `${seed}:upgrade`, actor: "agent:district-builder", now: () => FIXED_TIME };
      const draft = createBuildingUpgradeDraft(firstBuilding, { goal: { type: "add_floor", count: 1 } }, upgradeContext);
      const confirmed = confirmBuildingDesign(draft, { expected_revision: draft.revision }, upgradeContext);
      const result = executeCityCommand(state, { type: "upgrade_building", buildingId: firstBuilding.id, voxelDesign: confirmed, actor: "agent:district-builder" }, engineContext);
      actions.push({ type: "upgrade_building", buildingId: firstBuilding.id, accepted: result.accepted, compileDiagnostics: confirmed.compileDiagnostics });
      if (result.accepted) state = result.state;
      else failures.push({ stage: "upgrade", building: firstBuilding.program.name, error: result.errors?.[0], code: result.code });
    } catch (error) {
      failures.push({ stage: "upgrade_design", building: firstBuilding.program.name, error: error.message });
    }
  }

  const diagnostics = diagnoseAgentBuild(state, actions);
  return {
    world,
    state,
    report: {
      method: "headless-structured-contracts-only",
      usedMultimodalVision: false,
      seed,
      districts: districtResults,
      actions,
      failures,
      diagnostics,
      success: failures.length === 0 && diagnostics.allChecksPassed
    }
  };
}

function footprintAreaFor(footprint = "1x1") {
  const match = /^(\d+)x(\d+)$/.exec(String(footprint));
  return match ? Number(match[1]) * Number(match[2]) : 1;
}

export function diagnoseAgentBuild(state, actions = []) {
  const buildings = Object.values(state.buildings);
  const districts = Object.values(state.districts ?? {});
  const roadIds = new Set(Object.values(state.cells).filter((cell) => cell.infrastructure === "road").map((cell) => cell.id));
  const bridgeIds = new Set(Object.entries(state.infrastructure).filter(([, infrastructure]) => infrastructure.type === "bridge").map(([cellId]) => cellId));
  const networkIds = new Set([...roadIds, ...bridgeIds]);
  const reachable = floodRoadNetwork(state, state.nodes.old_town_entry.cellId, networkIds);
  const entrancePorts = buildings.map((building) => building.site.entranceCellId
    ?? building.voxelDesign?.ports?.find((port) => port.type === "primary_entrance")?.frontageCellId).filter(Boolean);
  const footprints = buildings.flatMap((building) => building.footprintCells);
  const buildActions = actions.filter((action) => action.type === "construct_building" && action.accepted);
  const modes = [...new Set(buildings.map((building) => building.voxelDesign?.generation?.mode).filter(Boolean))];
  const footprintTypes = [...new Set(buildings.map((building) => building.site.footprint))];
  const styles = [...new Set(buildings.map((building) => building.voxelDesign?.intent?.style).filter(Boolean))];
  const checks = {
    atLeastThreeDistricts: districts.length >= 3,
    districtsPersistedInCityState: districts.every((district) => district.name && district.purpose && district.bounds),
    roadsBuiltBeforeBuildings: actions.findIndex((action) => action.type === "connect" && action.accepted) >= 0
      && actions.findIndex((action) => action.type === "connect" && action.accepted) < actions.findIndex((action) => action.type === "construct_building" && action.accepted),
    allBuildingsBelongToDistrict: buildings.every((building) => state.districts?.[building.districtId]),
    atLeastEightBuildings: buildings.length >= 8,
    bothGenerationModes: modes.includes("floor_stack") && modes.includes("urban_massing"),
    diverseFootprints: footprintTypes.length >= 3,
    diverseStyles: styles.length >= 4,
    uniqueFootprints: new Set(footprints).size === footprints.length,
    allFootprintsBuildable: footprints.every((cellId) => state.cells[cellId]?.buildable !== false && state.cells[cellId]?.strictBuildable !== false),
    allDesignsCompiled: buildings.every((building) => building.voxelDesign?.compileDiagnostics?.status === "compiled" && building.voxelDesign.compileDiagnostics.occupiedVoxels > 0),
    allBuildingsDecorated: buildings.every((building) => (building.voxelDesign?.decorations?.items?.length ?? 0) > 0),
    allEntrancesOnNetwork: entrancePorts.length === buildings.length && entrancePorts.every((cellId) => networkIds.has(cellId)),
    allEntrancesReachGateway: entrancePorts.length === buildings.length && entrancePorts.every((cellId) => reachable.has(cellId)),
    roadsAvoidBuildings: footprints.every((cellId) => !networkIds.has(cellId)),
    constructionActionsAccepted: buildActions.length === buildings.length
  };
  return {
    buildingCount: buildings.length,
    districtCount: districts.length,
    roadCellCount: roadIds.size,
    bridgeCellCount: bridgeIds.size,
    generationModes: modes,
    footprintTypes,
    styles,
    entrancePorts,
    reachableRoadCellCount: reachable.size,
    checks,
    allChecksPassed: Object.values(checks).every(Boolean)
  };
}

function pickRoadTarget(state, bounds) {
  const centerRow = (bounds.minRow + bounds.maxRow) / 2;
  return Object.values(state.cells)
    .filter((cell) => cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
      && cell.row >= bounds.minRow && cell.row <= bounds.maxRow
      && cell.buildable !== false && cell.strictBuildable !== false && !cell.node)
    .sort((left, right) => left.column - right.column || Math.abs(left.row - centerRow) - Math.abs(right.row - centerRow) || left.id.localeCompare(right.id))[0]?.id ?? null;
}

function pickDistrictRoadBranch(state, bounds) {
  const inBounds = (cell) => cell.column >= bounds.minColumn && cell.column <= bounds.maxColumn
    && cell.row >= bounds.minRow && cell.row <= bounds.maxRow;
  const from = Object.values(state.cells).filter((cell) => inBounds(cell) && cell.infrastructure === "road")[0];
  if (!from) return null;
  const to = Object.values(state.cells)
    .filter((cell) => inBounds(cell) && cell.buildable !== false && cell.strictBuildable !== false && !cell.node && !cell.infrastructure)
    .sort((left, right) => (
      Math.abs(right.column - from.column) + Math.abs(right.row - from.row)
      - Math.abs(left.column - from.column) - Math.abs(left.row - from.row)
      || left.id.localeCompare(right.id)
    ))[0];
  return to ? { from: from.id, to: to.id } : null;
}

function floodRoadNetwork(state, startId, networkIds) {
  const reachable = new Set();
  const queue = networkIds.has(startId) ? [startId] : neighbors(startId).filter((cellId) => networkIds.has(cellId));
  while (queue.length) {
    const current = queue.shift();
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of neighbors(current)) if (networkIds.has(next) && !reachable.has(next)) queue.push(next);
  }
  return reachable;
}

function neighbors(cellId) {
  const match = /^cell-(-?\d+)-(-?\d+)$/.exec(cellId ?? "");
  if (!match) return [];
  const column = Number(match[1]);
  const row = Number(match[2]);
  return [`cell-${column - 1}-${row}`, `cell-${column + 1}-${row}`, `cell-${column}-${row - 1}`, `cell-${column}-${row + 1}`];
}

export function getNonVisualDistrictProgram() {
  return structuredClone(DISTRICT_PROGRAM);
}
