// Turn 0 (bootstrap) read model.  This is deliberately a projection: progress
// is computed from the authoritative city state/event stream and is never
// accepted as Agent input or persisted by a GET request.

const START_EVENTS = new Set(["construction_reserved", "building_constructed", "construction_reservation_completed", "special_structure_placed"]);
const COMPLETE_EVENTS = new Set(["building_constructed", "construction_reservation_completed", "special_structure_placed"]);

export function isBootstrapTurn(state) {
  return (state?.turn != null && Number(state.turn) === 0) || state?.gameplay?.turnKind === "bootstrap";
}

export function deriveBootstrapProgress(state = {}) {
  const roads = new Set();
  for (const cell of Object.values(state.cells ?? {})) {
    if (cell?.infrastructure === "road") roads.add(String(cell.id));
  }
  for (const [id, value] of Object.entries(state.infrastructure ?? {})) {
    if (value?.type === "bridge") roads.add(String(id));
  }
  const buildings = Object.values(state.buildings ?? {}).filter(Boolean);
  const residential = buildings.filter((b) => purposeFamily(b) === "residential").map((b) => String(b.id)).sort();
  const commercial = buildings.filter((b) => purposeFamily(b) === "commercial").map((b) => String(b.id)).sort();
  const publicService = buildings.filter((b) => purposeFamily(b) === "public_service").map((b) => String(b.id)).sort();
  const connected = [...roads].sort();
  const events = (state.events ?? []).filter((e) => START_EVENTS.has(e?.type));
  const gatewayNode = state.nodes?.old_town_entry;
  const gatewayCell = gatewayNode?.cellId ? state.cells?.[gatewayNode.cellId] : null;
  const gatewayAdjacentRoad = gatewayCell && Object.values(state.cells ?? {}).some((cell) =>
    cell.infrastructure === "road" && Math.abs(Number(cell.column) - Number(gatewayCell.column)) + Math.abs(Number(cell.row) - Number(gatewayCell.row)) === 1);
  const gatewayEvent = (state.events ?? []).some((event) => event?.type === "road_connected"
    && ([event.from, event.to].some((endpoint) => endpoint?.kind === "node" && String(endpoint.id) === "old_town_entry")));
  const gateway = Boolean(gatewayNode && (gatewayAdjacentRoad || gatewayEvent));
  const started = new Set();
  const completed = new Set();
  for (const event of events) {
    const id = event.buildingId ?? event.building_id ?? event.proposalId ?? event.reservationId;
    if (id == null) continue;
    const value = String(id);
    if (START_EVENTS.has(event.type)) started.add(value);
    if (COMPLETE_EVENTS.has(event.type)) completed.add(value);
  }
  // Existing authoritative buildings are also evidence when an old archive has
  // no event history.  This makes the projection migration-safe and stable.
  for (const building of buildings) {
    if (building.id == null) continue;
    started.add(String(building.id));
    if (building.status === "completed" || building.status === "active") completed.add(String(building.id));
  }
  return {
    gatewayConnected: gateway,
    gatewayNodeId: gateway ? "old_town_entry" : null,
    roadsConnected: connected,
    roadsConnectedCount: connected.length,
    buildingsStarted: [...started].sort(),
    buildingsCompleted: [...completed].sort(),
    residentialBuildings: residential,
    commercialBuildings: commercial,
    publicServiceBuildings: publicService,
    totalBuildings: buildings.length,
    // A compact objective signal for clients; it is descriptive, not a gate.
    milestones: {
      gateway: gateway,
      road: connected.length > 0,
      housing: residential.length > 0,
      income: commercial.length > 0,
      publicService: publicService.length > 0
    }
  };
}

export function bootstrapGuidance(progress) {
  const missing = [];
  if (!progress?.gatewayConnected) missing.push("connect the first main road to old_town_entry");
  if (!progress?.roadsConnectedCount) missing.push("lay a compact street frontage");
  if (!progress?.residentialBuildings?.length) missing.push("add low-cost housing");
  if (!progress?.commercialBuildings?.length) missing.push("add an income-producing building");
  if (!progress?.publicServiceBuildings?.length) missing.push("add a small public service when affordable");
  return `Bootstrap guidance (advisory): start from old_town_entry with a compact street district; ${missing.length ? `consider ${missing.join(", ")}.` : "the suggested starter mix is already represented."} Resolve remains available regardless of these suggestions.`;
}

function purposeFamily(building) {
  const text = `${building?.program?.purpose ?? ""} ${building?.program?.archetype ?? ""} ${building?.gameplay?.purpose ?? ""}`.toLowerCase();
  if (/residen|housing|house|home|lodging/.test(text)) return "residential";
  if (/shop|commercial|retail|market|income|cafe|tavern/.test(text)) return "commercial";
  if (/public|service|civic|library|school|academy|hospital|ministry|station/.test(text)) return "public_service";
  return "other";
}
