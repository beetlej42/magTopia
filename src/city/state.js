import { getFootprintCells } from "./contracts.js";

export function createCityState(worldContract, options = {}) {
  if (!worldContract?.grid?.cells?.length) throw new Error("CityState requires a world contract with valid cells");
  const cells = Object.fromEntries(worldContract.grid.cells.map((cell) => [cell.id, { ...cell, occupancy: null, infrastructure: null, reservation: null }]));
  const gateway = pickEasternGateway(Object.values(cells));
  cells[gateway.id].node = "old_town_entry";
  return {
    schemaVersion: 2,
    version: 0,
    cityId: options.cityId ?? null,
    rulesetVersion: options.rulesetVersion ?? "magic-london-mvp@1",
    mapId: worldContract.mapId,
    mapSeed: options.mapSeed ?? null,
    turn: 0,
    elapsedHours: 0,
    resources: { coins: 600, timber: 120, stone: 120, ...(options.resources ?? {}) },
    economy: { lastIncome: { coins: 0, timber: 0, stone: 0 }, lifetimeIncome: { coins: 0, timber: 0, stone: 0 } },
    cells,
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
    resources: { ...state.resources },
    cells: Object.fromEntries(Object.entries(state.cells).map(([id, cell]) => [id, { ...cell }])),
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

function pickEasternGateway(cells) {
  return [...cells].sort((a, b) => b.column - a.column || Math.abs(a.row - 25) - Math.abs(b.row - 25))[0];
}
