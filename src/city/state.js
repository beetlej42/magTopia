import { getFootprintCells } from "./contracts.js";

export function createCityState(worldContract, options = {}) {
  if (!worldContract?.grid?.cells?.length) throw new Error("CityState requires a world contract with valid cells");
  const cells = Object.fromEntries(worldContract.grid.cells.map((cell) => [cell.id, { ...cell, occupancy: null, infrastructure: null, reservation: null }]));
  const gateway = pickEasternGateway(Object.values(cells), worldContract.grid.rows);
  cells[gateway.id].node = "old_town_entry";
  return {
    schemaVersion: 3,
    version: 0,
    cityId: options.cityId ?? null,
    rulesetVersion: options.rulesetVersion ?? "magic-london-mvp@1",
    mapId: worldContract.mapId,
    mapSeed: options.mapSeed ?? null,
    world: {
      mapRecipeVersion: worldContract.mapRecipeVersion ?? null,
      seed: worldContract.seed ?? options.mapSeed ?? null,
      blank: Boolean(worldContract.blank),
      coordinateSystem: structuredClone(worldContract.coordinateSystem ?? null),
      constructionDatum: structuredClone(worldContract.constructionDatum ?? null),
      grid: {
        columns: worldContract.grid.columns,
        rows: worldContract.grid.rows,
        cellWorldSize: worldContract.grid.cellWorldSize
      },
      diagnostics: structuredClone(worldContract.diagnostics ?? null)
    },
    turn: 0,
    elapsedHours: 0,
    // New-city economy: coins are the single core consumable resource. No
    // timber/stone initialization for new cities; legacy construction fields
    // were consolidated to the coins-only economy.
    resources: { coins: 600, ...(options.resources ?? {}) },
    gameplay: {
      schemaVersion: 1,
      turnStatus: "open",
      turnOpenedAt: null,
      turnDeadlineAt: null,
      nextTurnUnlockAt: null,
      scheduler: null,
      resources: { coins: (options.resources?.coins ?? 600), arcaneEnergy: 0 },
      population: {
        muggles: { current: 0, capacity: 0 },
        wizards: { current: 0, capacity: 0 }
      },
      arcaneOfficers: {},
      incidents: {},
      // Bounded per-turn history of the frozen settlement facts. Every resolved
      // turn keeps its facts here so an Agent can write a backfilled Owl Daily
      // report for a previously settled turn, not only the most recent one.
      turnFacts: {},
      lastTurnFacts: null,
      cardState: {
        offer: null,
        choice: { offerId: null, status: "pending", selectedCardId: null, decisionMode: null, choiceResolvedAt: null, cardEffects: {}, policyStarted: [], policyRefreshed: [], policyExpired: [], officerRecruitedId: null, specialPlacementMandate: null, specialPlacementsCompleted: [] },
        activePolicies: [],
        pendingPlacement: null,
        placements: {}
      }
    },
    economy: { lastIncome: { coins: 0 }, lifetimeIncome: { coins: 0 } },
    cells,
    districts: {},
    buildings: {},
    infrastructure: {},
    nodes: { old_town_entry: { id: "old_town_entry", type: "external_gateway", cellId: gateway.id } },
    reservations: {},
    events: []
  };
}

export function cloneCityState(state) {
  return {
    ...state,
    schemaVersion: Math.max(3, Number(state.schemaVersion ?? 0)),
    resources: { ...state.resources },
    gameplay: structuredClone(state.gameplay ?? null),
    cells: Object.fromEntries(Object.entries(state.cells).map(([id, cell]) => [id, { ...cell }])),
    districts: structuredClone(state.districts ?? {}),
    buildings: { ...state.buildings },
    infrastructure: { ...state.infrastructure },
    nodes: { ...state.nodes },
    economy: structuredClone(state.economy ?? { lastIncome: {}, lifetimeIncome: {} }),
    reservations: structuredClone(state.reservations ?? {}),
    events: [...state.events]
  };
}

export function canOccupyFootprint(state, lotId, footprint) {
  const lot = state.cells[lotId];
  if (!lot) return { ok: false, reason: "Unknown or non-buildable lot" };
  const cells = getFootprintCells(lot, footprint);
  for (const cellId of cells) {
    const cell = state.cells[cellId];
    if (!cell) return { ok: false, reason: `Footprint exceeds valid terrain at ${cellId}` };
    if (cell.buildable === false) return { ok: false, reason: `Cell ${cellId} is water or otherwise not buildable` };
    if (cell.strictBuildable === false) return { ok: false, reason: `Cell ${cellId} is shore terrain and requires a dry construction parcel` };
    if (cell.node) return { ok: false, reason: `Cell ${cellId} is reserved for city node ${cell.node}` };
    if (cell.occupancy || cell.infrastructure || cell.reservation) return { ok: false, reason: `Cell ${cellId} is already occupied or reserved` };
  }
  return { ok: true, cells };
}

export function appendEvent(state, event, context = {}) {
  state.events.push({
    id: event.id ?? context.createId?.("event") ?? `event-${state.events.length + 1}`,
    turn: state.turn,
    cityVersion: state.version,
    at: event.at ?? context.now?.() ?? new Date().toISOString(),
    ...event
  });
}

function pickEasternGateway(cells, rows = 50) {
  const routeable = cells.filter((cell) => cell.buildable !== false && cell.strictBuildable !== false);
  if (!routeable.length) throw new Error("CityState requires at least one buildable cell for its external gateway");
  const centerRow = (Number(rows) - 1) / 2;
  return [...routeable].sort((a, b) => b.column - a.column || Math.abs(a.row - centerRow) - Math.abs(b.row - centerRow))[0];
}
