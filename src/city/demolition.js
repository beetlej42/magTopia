import {
  calculateBuildingConstructionCost,
  calculateDemolitionRefund,
  calculateRoadCost
} from "../gameplay/construction-cost.js";

export const MAX_ROAD_DEMOLITION_CELLS = 64;

export function previewDemolition(state, input = {}) {
  let target;
  try {
    target = normalizeDemolitionTarget(input.target ?? input);
  } catch (error) {
    return infeasible("INVALID_DEMOLITION_TARGET", error.message);
  }
  if (target.kind === "building") return previewBuildingDemolition(state, target);
  return previewRoadDemolition(state, target);
}

export function normalizeDemolitionTarget(input = {}) {
  const kind = String(input.kind ?? "").trim();
  if (kind === "building") {
    const buildingId = String(input.buildingId ?? input.building_id ?? input.id ?? "").trim();
    if (!buildingId) throw new Error("Building demolition requires target.building_id");
    return { kind, buildingId };
  }
  if (kind === "road_cells") {
    const source = input.cellIds ?? input.cell_ids;
    if (!Array.isArray(source)) throw new Error("Road demolition requires target.cell_ids");
    const cellIds = [...new Set(source.map((value) => String(value ?? "").trim()))];
    if (!cellIds.length || cellIds.some((id) => !id)) {
      throw new Error("Road demolition requires at least one non-empty cell id");
    }
    if (cellIds.length > MAX_ROAD_DEMOLITION_CELLS) {
      throw new Error(`Road demolition is limited to ${MAX_ROAD_DEMOLITION_CELLS} cells per command`);
    }
    return { kind, cellIds };
  }
  throw new Error(`Unsupported demolition target kind: ${kind || "missing"}`);
}

function previewBuildingDemolition(state, target) {
  const building = state.buildings?.[target.buildingId];
  if (!building) return infeasible("BUILDING_NOT_FOUND", `Building ${target.buildingId} was not found`, target);
  if (isProtectedBuilding(building)) {
    return infeasible("SPECIAL_BUILDING_PROTECTED", `Special building ${target.buildingId} cannot be demolished in the first demolition version`, target);
  }
  const activeIncidents = Object.values(state.gameplay?.incidents ?? {})
    .filter((incident) => String(incident.buildingId ?? incident.building_id ?? "") === target.buildingId)
    .filter((incident) => ["open", "assigned"].includes(incident.status))
    .map((incident) => String(incident.id));
  if (activeIncidents.length) {
    return infeasible("BUILDING_HAS_ACTIVE_INCIDENTS", `Building ${target.buildingId} has active incidents`, target, { activeIncidents });
  }

  let baseCost;
  try {
    const persisted = Number(building.constructionCost?.coins);
    baseCost = Number.isSafeInteger(persisted) && persisted >= 0
      ? persisted
      : calculateBuildingConstructionCost(building, { persistedBuilding: true, allowLegacy: true }).coins;
  } catch (error) {
    return infeasible("BUILDING_COST_UNAVAILABLE", `Building ${target.buildingId} has no recoverable construction cost: ${error.message}`, target);
  }
  const refund = calculateDemolitionRefund(baseCost);
  return {
    feasible: true,
    target,
    baseCost: { coins: baseCost },
    refund: { coins: refund.coins },
    refundPolicy: { rate: refund.rate, rounding: refund.rounding },
    affected: {
      buildingIds: [target.buildingId],
      footprintCellIds: [...(building.footprintCells ?? [])],
      roadCellIds: [],
      bridgeCellIds: []
    },
    warnings: ["Roads connected to this building are preserved and are not included in the refund."]
  };
}

function previewRoadDemolition(state, target) {
  const roadCellIds = [];
  const bridgeCellIds = [];
  for (const cellId of target.cellIds) {
    const cell = state.cells?.[cellId];
    if (!cell) return infeasible("CELL_NOT_FOUND", `Cell ${cellId} was not found`, target);
    if (cell.node || cell.reservation) {
      return infeasible("ROAD_CELL_PROTECTED", `Cell ${cellId} is a protected node or active reservation`, target);
    }
    const bridge = state.infrastructure?.[cellId]?.type === "bridge";
    if (bridge) bridgeCellIds.push(cellId);
    else if (cell.infrastructure === "road") roadCellIds.push(cellId);
    else return infeasible("ROAD_CELL_NOT_DEMOLISHABLE", `Cell ${cellId} is not an ordinary road or bridge`, target);
  }
  const baseCost = calculateRoadCost({ roadCells: roadCellIds.length, bridgeCells: bridgeCellIds.length });
  const refund = calculateDemolitionRefund(baseCost.coins);
  return {
    feasible: true,
    target,
    baseCost: { coins: baseCost.coins },
    refund: { coins: refund.coins },
    refundPolicy: { rate: refund.rate, rounding: refund.rounding },
    affected: { buildingIds: [], footprintCellIds: [], roadCellIds, bridgeCellIds },
    warnings: ["The first demolition version does not reject road removals that disconnect a building."]
  };
}

function isProtectedBuilding(building) {
  return Boolean(building.specialStructure
    || building.program?.archetype === "special_structure"
    || building.program?.attributes?.specialCardId != null
    || building.program?.canonicalProgram != null
    || building.program?.attributes?.canonicalProgram != null);
}

function infeasible(code, message, target = null, details = {}) {
  return {
    feasible: false,
    code,
    errors: [message],
    target,
    baseCost: { coins: 0 },
    refund: { coins: 0 },
    affected: { buildingIds: [], footprintCellIds: [], roadCellIds: [], bridgeCellIds: [] },
    warnings: [],
    ...details
  };
}
