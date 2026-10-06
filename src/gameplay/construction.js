import { capacitiesFromSettlementMetadata, systemOwnedBonusForBuilding } from "./economy.js";
import { normalizePopulationState } from "./schema.js";

// Gameplay construction is independent of asset generation / order fulfillment.
// Roads remain immediate. Only newly accepted buildings receive this clock;
// existing archives without it keep their original lifecycle.
export const CONSTRUCTION_TURNS = 1;

export function constructionSchedule(turn = 0) {
  const startedAtTurn = Number(turn);
  return { startedAtTurn, readyAtTurn: startedAtTurn + CONSTRUCTION_TURNS, completedAtTurn: null };
}

export function constructionInfo(building) {
  return {
    building_status: building.status ?? "completed",
    construction_started_at_turn: building.construction?.startedAtTurn ?? null,
    ready_at_turn: building.construction?.readyAtTurn ?? null,
    completed_at_turn: building.construction?.completedAtTurn ?? null,
    operational: ["active", "completed"].includes(building.status ?? "completed")
  };
}

// Called only when a turn opens, or an asynchronous asset becomes ready in an
// already-open eligible turn. Never invoked by GETs or during income settlement.
export function completeDueConstruction(state, now) {
  if (!["open", "building", "strategy"].includes(state.gameplay?.turnStatus ?? "open")) return state;
  const due = Object.values(state.buildings ?? {}).filter((building) =>
    building.status === "construction" && Number.isSafeInteger(building.construction?.readyAtTurn)
      && building.construction.readyAtTurn <= Number(state.turn));
  if (!due.length) return state;
  const next = { ...state, buildings: { ...state.buildings }, events: [...(state.events ?? [])] };
  for (const building of due.sort((a, b) => a.id.localeCompare(b.id))) {
    next.buildings[building.id] = {
      ...building, status: "completed",
      construction: { ...building.construction, completedAtTurn: state.turn }
    };
    next.events.push({
      id: `construction-completed:${building.id}:${building.construction.startedAtTurn}`,
      type: "building_completed", turn: state.turn, cityVersion: state.version,
      at: now, actor: "system:construction", buildingId: building.id,
      summary: `${building.program?.name ?? building.id} completed construction and is now operational.`
    });
  }
  // Arrival cards read the persisted capacity before settlement. Commissioned
  // housing must be usable immediately, without also migrating people or
  // crediting income. Add only these newly commissioned units; the normal
  // settlement still reconciles total capacity (including later demolitions).
  const metadata = Object.fromEntries(due.map(({ id }) => {
    const building = next.buildings[id];
    return [id, {
      ...(building.metadata ?? (building.gameplay?.canonical ? building.gameplay : {})),
      status: "completed",
      ...(systemOwnedBonusForBuilding(building) ? { systemOwnedCardId: building.specialStructure.cardId } : {})
    }];
  }));
  const capacity = capacitiesFromSettlementMetadata(metadata);
  if (capacity.muggles || capacity.wizards) {
    const population = normalizePopulationState(next.gameplay?.population);
    next.gameplay = { ...next.gameplay, population: {
      muggles: { ...population.muggles, capacity: population.muggles.capacity + capacity.muggles },
      wizards: { ...population.wizards, capacity: population.wizards.capacity + capacity.wizards }
    } };
  }
  return next;
}
