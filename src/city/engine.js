import { completeAssetPrompt, normalizeConnectionRequest, normalizeConstructionProposal, normalizeDistrictDefinition } from "./contracts.js";
import { appendEvent, cloneCityState } from "./state.js";
import { previewConnectionBetween, previewConstruction } from "./solver.js";
import { deriveGameplayBuilding } from "../gameplay/building-metadata.js";
import { incomeForSettlement, systemOwnedBonusForBuilding } from "../gameplay/economy.js";

export function createEngineContext(options = {}) {
  const sequences = new Map();
  return {
    now: options.now ?? (() => new Date().toISOString()),
    constructionDiscountRate: options.constructionDiscountRate ?? 0,
    createId: options.createId ?? ((prefix) => {
      const sequence = (sequences.get(prefix) ?? 0) + 1;
      sequences.set(prefix, sequence);
      return `${prefix}-${sequence}`;
    })
  };
}

export function executeCityCommand(currentState, input, context = createEngineContext()) {
  switch (input.type) {
    case "define_district": return defineDistrict(currentState, input, context);
    case "cancel_district": return cancelDistrict(currentState, input, context);
    case "construct_building": return constructBuilding(currentState, input, context);
    case "upgrade_building": return upgradeBuilding(currentState, input, context);
    case "connect": return connect(currentState, input, context);
    case "reserve_construction": return reserveConstruction(currentState, input, context);
    case "complete_reserved_construction": return completeReservedConstruction(currentState, input, context);
    case "cancel_construction_reservation": return cancelConstructionReservation(currentState, input, context);
    case "advance_time": return advanceTime(currentState, input, context);
    default: return rejected(currentState, "UNSUPPORTED_COMMAND", `Unsupported city command: ${input.type}`);
  }
}

function defineDistrict(currentState, input, context) {
  let district;
  try { district = normalizeDistrictDefinition(input.district ?? input, context); }
  catch (error) { return rejected(currentState, "INVALID_DISTRICT", error.message); }
  const corners = [
    `cell-${district.bounds.minColumn}-${district.bounds.minRow}`,
    `cell-${district.bounds.maxColumn}-${district.bounds.minRow}`,
    `cell-${district.bounds.minColumn}-${district.bounds.maxRow}`,
    `cell-${district.bounds.maxColumn}-${district.bounds.maxRow}`
  ];
  if (!corners.every((cellId) => currentState.cells[cellId])) {
    return rejected(currentState, "DISTRICT_OUT_OF_BOUNDS", "District bounds must stay inside the city grid");
  }
  if (currentState.districts?.[district.id]) return rejected(currentState, "DISTRICT_ID_CONFLICT", `District ${district.id} already exists`);
  const next = cloneCityState(currentState);
  next.districts[district.id] = { ...district, status: "active", createdAtTurn: next.turn };
  bump(next, false);
  appendEvent(next, {
    type: "district_defined",
    actor: district.actor,
    districtId: district.id,
    name: district.name,
    purpose: district.purpose,
    bounds: district.bounds,
    summary: `${district.name} was designated for ${district.purpose}.`
  }, context);
  return accepted(currentState, next, { district: structuredClone(next.districts[district.id]) });
}

function cancelDistrict(currentState, input, context) {
  const districtId = String(input.districtId ?? input.district_id ?? input.id ?? "").trim();
  if (!districtId) return rejected(currentState, "DISTRICT_ID_REQUIRED", "District id is required to cancel a district");
  const district = currentState.districts?.[districtId];
  if (!district) return rejected(currentState, "DISTRICT_NOT_FOUND", `District ${districtId} was not found`);
  if ((district.status ?? "active") === "cancelled") {
    return rejected(currentState, "DISTRICT_ALREADY_CANCELLED", `District ${districtId} is already cancelled`);
  }

  const next = cloneCityState(currentState);
  bump(next, false);
  const reason = String(input.reason ?? input.actorNote ?? "cancelled_by_actor").trim().slice(0, 160) || "cancelled_by_actor";
  next.districts[districtId] = {
    ...district,
    status: "cancelled",
    cancelledAt: context.now(),
    cancelledAtTurn: next.turn,
    cancelledBy: input.actor ?? "agent:unknown",
    cancellationReason: reason
  };
  const preservedBuildings = Object.values(currentState.buildings ?? {}).filter((building) => (
    building.districtId === districtId || building.program?.attributes?.districtId === districtId
  )).length;
  const preservedRoads = Object.values(currentState.cells ?? {}).filter((cell) => (
    cell.column >= district.bounds.minColumn && cell.column <= district.bounds.maxColumn
      && cell.row >= district.bounds.minRow && cell.row <= district.bounds.maxRow
      && (cell.infrastructure === "road" || currentState.infrastructure?.[cell.id]?.type === "bridge")
  )).length;
  appendEvent(next, {
    type: "district_cancelled",
    actor: input.actor ?? "agent:unknown",
    districtId,
    reason,
    preservedBuildings,
    preservedRoads,
    summary: `${district.name} was released as an active development plan; existing construction remains.`
  }, context);
  return accepted(currentState, next, {
    district: structuredClone(next.districts[districtId]),
    preserved: { buildings: preservedBuildings, roads: preservedRoads }
  });
}

function upgradeBuilding(currentState, input, context) {
  const building = currentState.buildings?.[input.buildingId];
  if (!building) return rejected(currentState, "BUILDING_NOT_FOUND", `Unknown building ${input.buildingId}`);
  const design = input.voxelDesign;
  if (!design?.generation?.sourceSpec) return rejected(currentState, "INVALID_BUILDING_DESIGN", "Upgrade requires a versioned voxel design");
  if (design.source?.buildingId !== building.id) return rejected(currentState, "BUILDING_DESIGN_TARGET_MISMATCH", "Upgrade design targets a different building");
  if (design.source?.baseDesignId && (
    building.voxelDesign?.id !== design.source.baseDesignId
    || building.voxelDesign?.revision !== design.source.baseDesignRevision
  )) {
    return rejected(currentState, "BUILDING_DESIGN_BASE_CONFLICT", "Building changed after this upgrade design was created");
  }
  if (design.site?.lotId !== building.site?.lotId || design.site?.footprint !== building.site?.footprint) {
    return rejected(currentState, "UPGRADE_FOOTPRINT_CHANGE_UNSUPPORTED", "The first upgrade version must preserve the existing footprint");
  }
  const next = cloneCityState(currentState);
  const prior = next.buildings[building.id];
  next.buildings[building.id] = {
    ...prior,
    program: {
      ...prior.program,
      name: design.intent?.name ?? prior.program?.name,
      purpose: design.intent?.purpose ?? prior.program?.purpose,
      description: design.intent?.description ?? prior.program?.description
    },
    voxelDesign: structuredClone(design),
    designRevision: design.revision,
    designHistory: [
      ...(prior.designHistory ?? []),
      prior.voxelDesign ? { designId: prior.voxelDesign.id, revision: prior.voxelDesign.revision, specHash: prior.voxelDesign.specHash } : null
    ].filter(Boolean),
    updatedAtTurn: next.turn
  };
  bump(next, false);
  appendEvent(next, {
    type: "building_upgraded",
    actor: input.actor ?? "agent:unknown",
    buildingId: building.id,
    designId: design.id,
    designRevision: design.revision,
    summary: `${next.buildings[building.id].program.name} was upgraded.`
  }, context);
  return accepted(currentState, next, { building: structuredClone(next.buildings[building.id]) });
}

function constructBuilding(currentState, input, context) {
  let proposal;
  try { proposal = normalizeConstructionProposal(input.proposal ?? input, context); }
  catch (error) { return rejected(currentState, "INVALID_PROPOSAL", error.message); }
  const preview = previewConstruction(currentState, proposal, { constructionDiscountRate: context.constructionDiscountRate });
  if (!preview.feasible) return rejected(currentState, classifyPreviewError(preview), preview.errors?.[0] ?? "Construction is not feasible", { preview });
  const next = cloneCityState(currentState);
  const buildingId = input.buildingId ?? context.createId("building");
  applyCompletedBuilding(next, { proposal, preview, buildingId, assetId: input.assetId ?? proposal.program.assetId }, context);
  return accepted(currentState, next, { building: structuredClone(next.buildings[buildingId]), preview });
}

function connect(currentState, input, context) {
  let connection;
  try { connection = normalizeConnectionRequest(input); }
  catch (error) { return rejected(currentState, "INVALID_CONNECTION", error.message); }
  if (connection.mode !== "road") return rejected(currentState, "UNSUPPORTED_CONNECTION_MODE", `Unsupported connection mode: ${connection.mode}`);
  const plan = previewConnectionBetween(currentState, connection.from, connection.to);
  if (!plan.feasible) return rejected(currentState, "NO_ROUTE", plan.reason, { plan });
  const resourcesAfter = subtract(currentState.resources, plan.cost);
  const shortages = negativeKeys(resourcesAfter);
  if (shortages.length) return rejected(currentState, "INSUFFICIENT_RESOURCES", `Insufficient ${shortages.join(", ")}`, { plan, resourcesAfter });
  const next = cloneCityState(currentState);
  applyRoadPlan(next, plan);
  next.resources = resourcesAfter;
  bump(next, false);
  appendEvent(next, {
    type: "road_connected",
    actor: connection.actor,
    from: connection.from,
    to: connection.to,
    cost: plan.cost,
    summary: `Road connected ${connection.from.kind}:${connection.from.id} to ${connection.to.kind}:${connection.to.id}.`
  }, context);
  return accepted(currentState, next, { plan });
}

function reserveConstruction(currentState, input, context) {
  let proposal;
  try { proposal = normalizeConstructionProposal(input.proposal ?? input, context); }
  catch (error) { return rejected(currentState, "INVALID_PROPOSAL", error.message); }
  const preview = previewConstruction(currentState, proposal, { constructionDiscountRate: context.constructionDiscountRate });
  if (!preview.feasible) return rejected(currentState, classifyPreviewError(preview), preview.errors?.[0] ?? "Construction is not feasible", { preview });
  const reservationId = input.reservationId ?? context.createId("reservation");
  const next = cloneCityState(currentState);
  const reservedCells = [...new Set([...preview.footprintCells, ...preview.connectionPlan.roadCells, ...preview.connectionPlan.bridgeCells])];
  for (const cellId of reservedCells) {
    if (next.cells[cellId]) next.cells[cellId].reservation = reservationId;
  }
  next.resources = preview.resourcesAfter;
  next.reservations[reservationId] = {
    id: reservationId,
    proposal,
    preview,
    reservedCells,
    frozenCost: preview.cost,
    actor: proposal.actor,
    createdAt: context.now()
  };
  bump(next, false);
  appendEvent(next, { type: "construction_reserved", actor: proposal.actor, reservationId, cost: preview.cost }, context);
  return accepted(currentState, next, { reservation: structuredClone(next.reservations[reservationId]), preview });
}

function completeReservedConstruction(currentState, input, context) {
  const reservation = currentState.reservations?.[input.reservationId];
  if (!reservation) return rejected(currentState, "RESERVATION_NOT_FOUND", `Unknown reservation ${input.reservationId}`);
  const next = cloneCityState(currentState);
  const live = next.reservations[input.reservationId];
  const buildingId = input.buildingId ?? context.createId("building");
  clearReservationMarks(next, live);
  applyCompletedBuilding(next, {
    proposal: live.proposal,
    preview: live.preview,
    buildingId,
    assetId: input.assetId ?? live.proposal.program.assetId,
    resourcesAlreadyDebited: true
  }, context);
  delete next.reservations[input.reservationId];
  appendEvent(next, { type: "construction_reservation_completed", reservationId: input.reservationId, buildingId }, context);
  return accepted(currentState, next, { building: structuredClone(next.buildings[buildingId]) });
}

function cancelConstructionReservation(currentState, input, context) {
  const reservation = currentState.reservations?.[input.reservationId];
  if (!reservation) return rejected(currentState, "RESERVATION_NOT_FOUND", `Unknown reservation ${input.reservationId}`);
  const next = cloneCityState(currentState);
  clearReservationMarks(next, reservation);
  next.resources = add(next.resources, reservation.frozenCost);
  delete next.reservations[input.reservationId];
  bump(next, false);
  appendEvent(next, { type: "construction_reservation_cancelled", reservationId: input.reservationId, reason: input.reason ?? "cancelled", refund: reservation.frozenCost }, context);
  return accepted(currentState, next, { refunded: reservation.frozenCost });
}

function advanceTime(currentState, input, context) {
  // Consolidated gameplay: the wall clock never grants income or advances the
  // gameplay turn. Settlement flows through the single authoritative
  // resolveTurn() gated by the cooldown `nextTurnUnlockAt`. This legacy
  // time-advance path is explicitly disabled so it can never become a second
  // income/turn path.
  return rejected(currentState, "TIME_ADVANCE_DISABLED", "Manual time advance is disabled; income and turn progression flow through the cooldown-gated strategy resolve instead.");
}

export function calculateDailyIncome(state) {
  // Compatibility preview only: authoritative mutation remains resolveTurn,
  // but both paths call the same settlement aggregator and card whitelist.
  const metadata = Object.fromEntries(Object.entries(state.buildings ?? {})
    .filter(([, building]) => building.status === "completed")
    .map(([id, building]) => [id, {
      ...(building.gameplay?.canonical ? building.gameplay : {}),
      canonical: building.gameplay?.canonical === true,
      status: building.status,
      ...(systemOwnedBonusForBuilding(building) ? { systemOwnedCardId: building.specialStructure.cardId } : {})
    }]));
  return incomeForSettlement(metadata, state.gameplay?.population ?? {});
}

function applyCompletedBuilding(next, { proposal, preview, buildingId, assetId, resourcesAlreadyDebited = false }, context) {
  preview.footprintCells.forEach((cellId) => { next.cells[cellId].occupancy = buildingId; });
  applyRoadPlan(next, preview.connectionPlan);
  if (!resourcesAlreadyDebited) next.resources = preview.resourcesAfter;
  const canonicalMetadata = preview.buildingCost?.source === "canonical_functional_units"
    ? deriveGameplayBuilding(proposal)
    : null;
  next.buildings[buildingId] = {
    ...proposal,
    id: buildingId,
    status: "completed",
    assetId: assetId ?? null,
    assetPrompt: completeAssetPrompt(proposal),
    footprintCells: preview.footprintCells,
    gradingPlan: structuredClone(preview.gradingPlan ?? null),
    ...(canonicalMetadata ? { gameplay: canonicalMetadata, constructionCost: structuredClone(preview.buildingCost) } : {}),
    createdAtTurn: next.turn
  };
  bump(next, false);
  appendEvent(next, { type: "building_constructed", actor: proposal.actor, buildingId, proposalId: proposal.id, assetId: assetId ?? null, cost: preview.cost, summary: `${proposal.program.name} was built by ${proposal.actor}.` }, context);
}

function applyRoadPlan(state, plan) {
  plan.roadCells.forEach((cellId) => { if (state.cells[cellId] && !state.cells[cellId].occupancy) state.cells[cellId].infrastructure = "road"; });
  plan.bridgeCells.forEach((cellId) => { state.infrastructure[cellId] = { type: "bridge", cellId }; });
}

function clearReservationMarks(state, reservation) {
  for (const cellId of reservation.reservedCells ?? []) {
    if (state.cells[cellId]?.reservation === reservation.id) state.cells[cellId].reservation = null;
  }
}

// All engine mutations only advance the city version (optimistic concurrency).
// The gameplay turn is owned exclusively by the authoritative resolveTurn() in
// the gameplay layer; construction/road/district commands never move it.
function bump(state, incrementTurn = false) {
  state.version = (state.version ?? 0) + 1;
  if (incrementTurn) state.turn = (state.turn ?? 0) + 1;
}

function accepted(before, state, result) {
  return { accepted: true, cityVersionBefore: before.version ?? 0, cityVersionAfter: state.version, state, ...result };
}

function rejected(state, code, message, extra = {}) {
  return { accepted: false, code, errors: [message], state, ...extra };
}

function classifyPreviewError(preview) {
  const text = preview.errors?.join(" ") ?? "";
  if (preview.code) return preview.code;
  if (/district .*cancelled/i.test(text)) return "DISTRICT_CANCELLED";
  if (/Insufficient/.test(text)) return "INSUFFICIENT_RESOURCES";
  if (/occupied|reserved/i.test(text)) return "LOT_OCCUPIED";
  if (/route|target|entrance/i.test(text)) return "NO_ROUTE";
  return "CONSTRUCTION_REJECTED";
}

function negativeKeys(resources) { return Object.entries(resources).filter(([, value]) => value < 0).map(([key]) => key); }
function add(a = {}, b = {}) { return { coins: (a.coins ?? 0) + (b.coins ?? 0) }; }
function subtract(a, b) { return { coins: a.coins - b.coins }; }
