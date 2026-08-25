import { getCard, CARD_TYPES, CARD_CATALOG, getCardsByCategory, normalizeCardDuration } from "./card-catalog.js";
import { manhattanDistance, cellFootprint } from "./exposure.js";
import { createRoller, hashSeed, pick } from "./random.js";
import { normalizeActivePolicy, normalizeArcaneOfficer, normalizeCardChoice, normalizeCardOffer, normalizePendingPlacement, normalizeGameplayResources, normalizePopulationState } from "./schema.js";
import { canOccupyFootprint } from "../city/state.js";
import { getEntranceFrontageCells } from "../city/solver.js";
import { getFootprintCells } from "../city/contracts.js";
import { cityBlockOfBuilding } from "../city/blocks.js";
import { arcaneOfficerCapacity, generateArcaneOfficerIdentity } from "./arcane-officers.js";

// PR F — Player Daily Cards domain.
//
// Authority boundary:
// - PLAYER chooses one offered card and, for placement cards, manual placement
//   vs delegation.
// - AGENT reads the player's choice and fulfills delegated placements.
// - SYSTEM owns the catalog, the canonical offer, the random seed, every
//   effect value, policy duration, officer generation, and placement legality.
//
// Card, choice, policy, and placement state is persisted in
// state.gameplay.cardState. Everything is immutable-friendly: mutation
// functions return a fresh state.

export function cardOfferId(cityId, turn) {
  return `card-offer-${String(cityId).slice(0, 12)}-turn-${Number(turn)}`;
}

// Deterministic canonical three-category offer for (cityId, turn). Same city +
// same turn always returns the same offer; the seed is system-owned.
export function generateOffer(cityId, turn) {
  const roller = createRoller({ seed: hashSeed(`${String(cityId)}:card-offer:${Number(turn)}`) });
  const byCategory = getCardsByCategory();
  const special = pick(roller, byCategory.special_structure);
  const resourceOrPersonnelPool = [...byCategory.resource, ...byCategory.personnel];
  const resourceOrPersonnel = pick(roller, resourceOrPersonnelPool);
  const policy = pick(roller, byCategory.policy);
  return {
    offerId: cardOfferId(cityId, turn),
    turn: Number(turn),
    offeredCardIds: [special.cardId, resourceOrPersonnel.cardId, policy.cardId]
  };
}

// Persists the canonical offer for the current turn if one is not already
// present. Re-reading never rerolls: the offer is stored, not derived fresh.
export function ensureCardOffer(state, cityId) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  if (cardState.offer && cardState.offer.turn === Number(state.turn) && cardState.offer.offeredCardIds.length === 3) {
    return state;
  }
  const offer = generateOffer(cityId, state.turn);
  const choice = normalizeCardChoice(cardState.choice.offerId === offer.offerId ? cardState.choice : { offerId: offer.offerId, status: "pending" });
  return withCardState(state, {
    offer,
    choice,
    activePolicies: cardState.activePolicies,
    pendingPlacement: cardState.pendingPlacement,
    placements: cardState.placements
  }, { bumpVersion: false });
}

// Validates that a fresh turn opened: resets the choice so the new turn's
// offer starts pending. Delegated special placements deliberately survive
// across turns — they are mandates that must never silently disappear until
// legally placed or cancelled. A player-owned pending placement that was never
// located is recorded in the previous turn's frozen facts and reset.
export function openTurnCardState(state, cityId, { now = () => new Date().toISOString(), turn = state.turn } = {}) {
  const offer = generateOffer(cityId, turn);
  const priorPlacements = state.gameplay?.cardState?.placements ?? {};
  const deferred = Object.fromEntries(Object.entries(priorPlacements).filter(([, entry]) => entry.status === "deferred"));
  const firstDeferred = Object.values(deferred)[0] ?? null;
  return withCardState(state, {
    offer,
    choice: normalizeCardChoice({ offerId: offer.offerId, status: "pending" }),
    activePolicies: (state.gameplay?.cardState?.activePolicies ?? []).map((entry) => normalizeActivePolicy(entry)),
    pendingPlacement: firstDeferred,
    placements: deferred
  }, { bumpVersion: false });
}

export function currentOffer(state) {
  const offer = state?.gameplay?.cardState?.offer ?? null;
  if (!offer) return null;
  return {
    offer_id: offer.offerId,
    turn: offer.turn,
    cards: offer.offeredCardIds.map((cardId) => {
      const definition = getCard(cardId);
      return definition
        ? {
          card_id: definition.cardId,
          type: definition.type,
          title: definition.title,
          description: definition.description,
          decision_mode: definition.decisionMode,
          duration: definition.duration,
          ...(definition.structure ? { structure: definition.structure } : {})
        }
        : { card_id: cardId };
    })
  };
}

export function currentChoice(state) {
  const choice = state?.gameplay?.cardState?.choice ?? {};
  return {
    offer_id: choice.offerId ?? null,
    status: choice.status ?? "pending",
    selected_card_id: choice.selectedCardId ?? null,
    decision_mode: choice.decisionMode ?? null,
    choice_resolved_at: choice.choiceResolvedAt ?? null,
    card_effects: { ...(choice.cardEffects ?? {}) }
  };
}

export function activePolicies(state) {
  return (state?.gameplay?.cardState?.activePolicies ?? []).map((entry) => ({
    policy_id: entry.policyId,
    source_card_id: entry.sourceCardId,
    started_at_turn: entry.startedAtTurn,
    duration_type: entry.durationType,
    duration_turns: entry.durationTurns,
    remaining_turns: entry.remainingTurns,
    effects: [...(entry.effects ?? [])]
  }));
}

// Pending special-structure placement mandates, including deferred (Agent-owned)
// and player-owned ones awaiting a location. Never silently dropped.
export function pendingPlacements(state) {
  return Object.values(state?.gameplay?.cardState?.placements ?? {})
    .filter((entry) => !["completed", "cancelled"].includes(entry.status))
    .map((entry) => ({
      placement_id: entry.placementId,
      card_id: entry.cardId,
      mode: entry.mode,
      status: entry.status,
      delegated_at_turn: entry.delegatedAtTurn,
      card: {
        card_id: entry.cardId,
        title: getCard(entry.cardId)?.title ?? null,
        description: getCard(entry.cardId)?.description ?? null,
        structure: getCard(entry.cardId)?.structure ?? null
      }
    }));
}

// Aggregated active policy modifiers consumed by the simulation. Same-policy
// non-stacking is enforced at selection (refresh instead of stack); discount
// uses the strongest single rate so a single instance never double-counts.
export function collectPolicyEffects(state) {
  const effects = {
    concealmentBonus: 0,
    constructionDiscountRate: 0,
    wizardGrowthBonusRate: 0,
    incidentResponseBonus: 0
  };
  for (const policy of state?.gameplay?.cardState?.activePolicies ?? []) {
    for (const entry of policy.effects ?? []) {
      if (entry.kind === "concealment_bonus") effects.concealmentBonus += Number(entry.value ?? 0);
      if (entry.kind === "construction_discount") effects.constructionDiscountRate = Math.max(effects.constructionDiscountRate, Number(entry.value ?? 0));
      if (entry.kind === "wizard_growth_bonus") effects.wizardGrowthBonusRate += Number(entry.value ?? 0);
      if (entry.kind === "incident_response_bonus") effects.incidentResponseBonus += Number(entry.value ?? 0);
    }
  }
  return effects;
}

export function activeConstructionDiscountRate(state) {
  return collectPolicyEffects(state).constructionDiscountRate;
}

export function specialStructureBuildings(state) {
  return Object.values(state?.buildings ?? {}).filter((building) => building?.specialStructure?.cardId);
}

// Concealment bonus granted to a magical building by nearby special structures.
// Diagon Alley Entrance is block-scoped: every magical building in the same
// road-bounded city block receives the bonus regardless of distance, and a
// block separated by a road never does even when physically close. The
// Concealment Statue keeps local-area (radius) semantics.
export function specialStructureConcealment(state, building) {
  const magicLevel = Number(building?.program?.attributes?.magicLevel ?? building?.metadata?.magicLevel ?? 0);
  if (magicLevel <= 0) return 0;
  const ownBlockId = cityBlockOfBuilding(state, building);
  const ownFootprint = cellFootprint(building);
  let total = 0;
  for (const structure of specialStructureBuildings(state)) {
    if (structure.id === building.id) continue;
    const effect = structure.specialStructure.effect ?? {};
    const bonus = Number(effect.concealmentBonus ?? 0);
    if (!bonus) continue;
    if (effect.scope === "same_block") {
      if (ownBlockId != null && cityBlockOfBuilding(state, structure) === ownBlockId) total += bonus;
      continue;
    }
    const radius = Number(effect.concealmentRadius ?? 3);
    const distance = cellFootprint(structure)
      .map((cellId) => Math.min(...ownFootprint.map((ownCell) => manhattanDistance(ownCell, cellId))))
      .reduce((best, candidate) => Math.min(best, candidate), Infinity);
    if (Number.isFinite(distance) && distance <= radius) total += bonus;
  }
  return total;
}

// Exposure pressure added by special structures such as Moonlight Herb Plot.
export function specialStructureExposureModifier(state) {
  let modifier = 0;
  for (const structure of specialStructureBuildings(state)) {
    modifier += Number(structure.specialStructure.effect?.exposureModifier ?? 0);
  }
  return modifier;
}

// The player selects exactly one offered card. Immediate effects (coins,
// population, officer, policy) apply here exactly once; placement cards enter a
// pending placement state. The Agent can never select on the player's behalf.
export function selectCard(state, cityId, input = {}, context = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const offer = cardState.offer;
  const now = context.now ?? (() => new Date().toISOString());
  if (!offer) return { accepted: false, code: "NO_CARD_OFFER", message: "No card offer exists for the current turn" };
  if (Number(offer.turn) !== Number(state.turn)) {
    return { accepted: false, code: "OFFER_TURN_MISMATCH", message: `Offer ${offer.offerId} belongs to turn ${offer.turn}, not the current turn ${state.turn}` };
  }
  if (input.offerId != null && String(input.offerId) !== offer.offerId) {
    return { accepted: false, code: "OFFER_MISMATCH", message: `Offer ${input.offerId} does not match the current offer ${offer.offerId}` };
  }
  if (["resolved", "reported", "closed"].includes(state.gameplay?.turnStatus)) {
    return { accepted: false, code: "TURN_CLOSED", message: `Turn ${state.turn} is already settled; cards cannot be chosen` };
  }
  const cardId = String(input.selectedCardId ?? "");
  const card = getCard(cardId);
  if (!card || !offer.offeredCardIds.includes(cardId)) {
    return { accepted: false, code: "CARD_NOT_OFFERED", message: `Card ${cardId || "(missing)"} is not part of the current offer` };
  }
  const choice = normalizeCardChoice(cardState.choice);
  if (choice.status === "selected") {
    return { accepted: false, code: "CARD_ALREADY_SELECTED", message: `A card for turn ${state.turn} was already selected; exactly one card per turn is allowed` };
  }
  const decisionMode = input.decisionMode ?? card.decisionMode;
  if (!["immediate", "player_place", "delegate_to_agent"].includes(decisionMode)) {
    return { accepted: false, code: "INVALID_DECISION_MODE", message: `Unsupported decision mode: ${decisionMode}` };
  }
  if (card.type === CARD_TYPES.special_structure && !["player_place", "delegate_to_agent"].includes(decisionMode)) {
    return { accepted: false, code: "PLACEMENT_MODE_REQUIRED", message: `Special structure cards require player_place or delegate_to_agent` };
  }

  let next = state;
  const cardEffects = {};
  let placementPatch = null;
  if (card.type === CARD_TYPES.special_structure) {
    const placementId = context.createId?.("placement") ?? `placement-${state.turn}-${cardId}`;
    const placement = normalizePendingPlacement({
      cardId,
      placementId,
      mode: decisionMode,
      status: decisionMode === "player_place" ? "pending" : "deferred",
      delegatedAtTurn: state.turn
    });
    cardEffects.placement = { placement_id: placement.placementId, mode: decisionMode };
    placementPatch = {
      pendingPlacement: placement,
      placements: { ...cardState.placements, [placement.placementId]: placement }
    };
  } else if (card.type === CARD_TYPES.resource || card.type === CARD_TYPES.personnel) {
    const resolution = resolveImmediateCard(next, card, cityId, context);
    if (!resolution.accepted) return resolution;
    next = resolution.nextState;
    Object.assign(cardEffects, resolution.effects);
  } else if (card.type === CARD_TYPES.policy) {
    const policyResult = applyPolicySelection(next, card, state.turn, context);
    next = policyResult.nextState;
    cardEffects.policy = {
      policy_id: card.effect.policyId,
      action: policyResult.refreshed ? "refreshed" : "started",
      duration_turns: policyResult.durationTurns,
      remaining_turns: policyResult.remainingTurns
    };
  }

  // Single authoritative write: record the resolved choice exactly once. Every
  // immediate effect already flowed into the gameplay fields above.
  next = withCardState(next, {
    offer,
    choice: normalizeCardChoice({
      offerId: offer.offerId,
      status: "selected",
      selectedCardId: cardId,
      decisionMode,
      choiceResolvedAt: now(),
      cardEffects
    }),
    activePolicies: next.gameplay.cardState.activePolicies,
    pendingPlacement: placementPatch?.pendingPlacement ?? next.gameplay.cardState.pendingPlacement,
    placements: placementPatch?.placements ?? next.gameplay.cardState.placements
  });
  return { accepted: true, code: "OK", nextState: next, cardId, cardEffects };
}

// Records the explicit skipped/no-card choice at settlement. Never blocks
// settlement and never backfills multiple choices.
export function markChoiceSkipped(state, { now = () => new Date().toISOString() } = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const choice = normalizeCardChoice(cardState.choice);
  if (choice.status !== "pending") return state;
  return withCardState(state, {
    offer: cardState.offer,
    choice: normalizeCardChoice({ ...choice, status: "skipped", choiceResolvedAt: now() }),
    activePolicies: cardState.activePolicies,
    pendingPlacement: cardState.pendingPlacement,
    placements: cardState.placements
  }, { bumpVersion: false });
}

// The player or Agent places a pending special structure at a legal location.
// Placement goes through the authoritative cell/block occupancy and entrance
// validation; the system owns the structure's effects.
//
// The placement is located by its stable `placement_id` inside
// `cardState.placements` so that multiple deferred (delegate_to_agent) mandates
// stay independently actionable — a new selection or a new turn never shadows
// an older deferred mandate.
export function placeSpecialStructure(state, cityId, input = {}, context = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const cardId = String(input.cardId ?? input.selectedCardId ?? "");
  const card = getCard(cardId);
  if (!card || card.type !== CARD_TYPES.special_structure) {
    return { accepted: false, code: "NOT_SPECIAL_CARD", message: `Card ${cardId || "(missing)"} is not a special structure card` };
  }
  const placementId = String(input.placementId ?? input.placement_id ?? cardState.pendingPlacement?.placementId ?? "");
  const placement = placementId && cardState.placements[placementId] ? cardState.placements[placementId] : null;
  if (!placement) {
    return { accepted: false, code: "PLACEMENT_NOT_FOUND", message: `No pending placement exists for id ${placementId || "(none)"}` };
  }
  if (placement.cardId !== cardId) {
    return { accepted: false, code: "PLACEMENT_CARD_MISMATCH", message: `Placement ${placement.placementId} belongs to card ${placement.cardId}, not ${cardId}` };
  }
  if (placement.status === "completed") {
    return { accepted: false, code: "PLACEMENT_ALREADY_COMPLETED", message: `Placement ${placement.placementId} was already completed` };
  }
  if (["resolved", "reported", "closed"].includes(state.gameplay?.turnStatus) && placement.mode === "delegate_to_agent" && placement.status === "pending") {
    return { accepted: false, code: "TURN_CLOSED", message: "The turn has settled; the pending placement remains open for a later turn" };
  }

  const structure = card.structure;
  const lotId = String(input.lotId ?? input.lot_id ?? "");
  const footprint = String(input.footprint ?? structure.footprint ?? "1x1");
  const entrance = String(input.entrance ?? "south").toLowerCase();
  if (!lotId) return { accepted: false, code: "LOT_REQUIRED", message: "A legal lot_id is required for special structure placement" };
  if (!["north", "east", "south", "west"].includes(entrance)) {
    return { accepted: false, code: "INVALID_ENTRANCE", message: `Unsupported entrance direction: ${entrance}` };
  }
  const occupancy = canOccupyFootprint(state, lotId, footprint);
  if (!occupancy.ok) return { accepted: false, code: "PLACEMENT_ILLEGAL", message: occupancy.reason };
  const footprintCells = getFootprintCells(state.cells[lotId], footprint);
  const frontage = getEntranceFrontageCells(state, footprintCells, entrance);
  if (!frontage.length) return { accepted: false, code: "PLACEMENT_ILLEGAL", message: `Entrance ${entrance} has no buildable frontage at this location` };

  const buildingId = context.createId?.("building") ?? `building-${state.turn}-${cardId}`;
  const effect = { ...(card.effect ?? {}) };
  const next = structuredClone(state);
  next.version = (state.version ?? 0) + 1;
  for (const cellId of footprintCells) {
    next.cells[cellId] = { ...next.cells[cellId], occupancy: buildingId, reservation: null };
  }
  next.buildings[buildingId] = {
    id: buildingId,
    site: { lotId, footprint, entrance },
    footprintCells,
    program: {
      archetype: structure.archetype,
      purpose: structure.purpose,
      name: structure.name,
      description: card.description,
      attributes: { magicLevel: effect.magicLevel ?? 0.5, specialCardId: card.cardId }
    },
    status: "completed",
    specialStructure: { cardId: card.cardId, effect },
    createdAtTurn: state.turn
  };
  if (next.events) {
    next.events.push({
      id: context.createId?.("event") ?? `event-${state.turn}-${cardId}`,
      turn: state.turn,
      cityVersion: (state.version ?? 0) + 1,
      at: context.now?.() ?? new Date().toISOString(),
      type: "special_structure_placed",
      actor: "system:card",
      cardId: card.cardId,
      buildingId,
      lotId,
      footprint,
      summary: `${structure.name} was placed by the daily card system.`
    });
  }
  const completed = normalizePendingPlacement({ ...placement, status: "completed", buildingId, lotId, footprint, entrance });
  const placements = { ...cardState.placements, [placement.placementId]: completed };
  const pendingPlacement = cardState.pendingPlacement?.placementId === placement.placementId
    ? completed
    : cardState.pendingPlacement;
  const completions = [
    ...(cardState.choice.specialPlacementsCompleted ?? []),
    { placementId: placement.placementId, cardId: placement.cardId, buildingId, mode: placement.mode }
  ];
  next.gameplay = {
    ...next.gameplay,
    cardState: normalizeCardState({
      offer: cardState.offer,
      choice: normalizeCardChoice({ ...cardState.choice, specialPlacementsCompleted: completions }),
      activePolicies: cardState.activePolicies,
      pendingPlacement,
      placements
    })
  };
  return { accepted: true, code: "OK", nextState: next, buildingId, placement: completed };
}

function resolveImmediateCard(state, card, cityId, context) {
  const effect = card.effect ?? {};
  const next = structuredClone(state);
  const effects = {};
  if (effect.kind === "grant_coins") {
    const amount = Number(effect.coins ?? 0);
    const gameplay = normalizeGameplayResources(next.gameplay.resources);
    next.gameplay.resources = { ...gameplay, coins: gameplay.coins + amount };
    next.resources = { ...next.resources, coins: (next.resources.coins ?? 0) + amount };
    effects.grant = { kind: "coins", amount };
  } else if (effect.kind === "grant_population") {
    const requested = Number(effect.wizards ?? 0);
    const population = normalizePopulationState(next.gameplay.population);
    const capacity = population.wizards.capacity;
    const current = population.wizards.current;
    const granted = Math.max(0, Math.min(requested, Math.max(0, capacity - current)));
    next.gameplay.population = {
      ...population,
      wizards: { ...population.wizards, current: current + granted }
    };
    effects.grant = { kind: "population", requested, granted, capacity };
  } else if (effect.kind === "recruit_officer") {
    const recruitment = generateArcaneOfficer(next, cityId, context);
    if (!recruitment.accepted) {
      return { accepted: false, code: recruitment.code, message: recruitment.message, nextState: state };
    }
    next.gameplay.arcaneOfficers = {
      ...(next.gameplay.arcaneOfficers ?? {}),
      [recruitment.officer.id]: recruitment.officer
    };
    effects.recruit = { officer_id: recruitment.officer.id, officer_name: recruitment.officer.name, archetype: recruitment.officer.archetype };
  } else {
    return { accepted: false, code: "UNSUPPORTED_CARD_EFFECT", message: `Card effect ${effect.kind} is not supported` };
  }
  return { accepted: true, nextState: next, effects };
}

// Named MVP Arcane Officer generation. Uses the authoritative archetype
// profiles and the existing roster-capacity rule; no coin cost because the
// card grant is system-owned. Agent/client input never supplies stats.
export function generateArcaneOfficer(state, cityId, context = {}) {
  const officers = state?.gameplay?.arcaneOfficers ?? {};
  const rosterSize = Object.keys(officers).length;
  const wizards = state?.gameplay?.population?.wizards?.current ?? 0;
  const capacity = arcaneOfficerCapacity(state);
  if (rosterSize >= capacity) {
    return { accepted: false, code: "ARCANE_OFFICER_CAPACITY_REACHED", message: `Arcane officer roster is at its capacity of ${capacity}` };
  }
  const officer = generateArcaneOfficerIdentity({
    seed: `${String(cityId)}:card-officer:${state.turn}:${rosterSize}`,
    id: context.createId?.("arcaneOfficer") ?? `arcaneOfficer-${rosterSize + 1}`,
    hiredAtTurn: state.turn,
    nameIndex: rosterSize
  });
  return { accepted: true, officer };
}

export const ARCANE_OFFICER_NAMES = Object.freeze([
  "Vesper Lark",
  "Rowan Featherstone",
  "Mira Holler",
  "Cassian Dusk",
  "Ivy Thornbush",
  "Silas Moonshadow",
  "Elowen Reed",
  "Cormac Whistler",
  "Seraphine Vale",
  "Bram Bramble",
  "Isolde Nightingale",
  "Percival Ashcroft"
]);

// Applying a policy card. The same policy never stacks without limit: a repeat
// selection refreshes its duration instead of numerically stacking the effect.
export function applyPolicySelection(state, card, turn, context = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const policyId = String(card.effect?.policyId ?? card.cardId);
  const duration = normalizeCardDuration(card.duration);
  const effects = policyEffectsFor(card);
  const existingIndex = cardState.activePolicies.findIndex((entry) => entry.policyId === policyId);
  const refreshed = existingIndex >= 0;
  const nextPolicies = [...cardState.activePolicies];
  if (refreshed) {
    const existing = nextPolicies[existingIndex];
    nextPolicies[existingIndex] = normalizeActivePolicy({
      ...existing,
      remainingTurns: duration.turns,
      effects
    });
  } else {
    nextPolicies.push(normalizeActivePolicy({
      policyId,
      sourceCardId: card.cardId,
      startedAtTurn: turn,
      durationType: duration.type,
      durationTurns: duration.turns,
      remainingTurns: duration.turns,
      effects
    }));
  }
  return {
    refreshed,
    durationTurns: duration.turns,
    remainingTurns: duration.turns,
    nextState: withCardState(state, {
      offer: cardState.offer,
      choice: cardState.choice,
      activePolicies: nextPolicies,
      pendingPlacement: cardState.pendingPlacement,
      placements: cardState.placements
    }, { bumpVersion: false })
  };
}

export function policyEffectsFor(card) {
  const effect = card.effect ?? {};
  const effects = [];
  if (effect.concealmentBonus != null) effects.push({ kind: "concealment_bonus", value: Number(effect.concealmentBonus) });
  if (effect.constructionDiscountRate != null) effects.push({ kind: "construction_discount", value: Number(effect.constructionDiscountRate) });
  if (effect.wizardGrowthBonusRate != null) effects.push({ kind: "wizard_growth_bonus", value: Number(effect.wizardGrowthBonusRate) });
  if (effect.incidentResponseBonus != null) effects.push({ kind: "incident_response_bonus", value: Number(effect.incidentResponseBonus) });
  return effects;
}

// Advances the deterministic policy lifecycle at settlement. Policies lose one
// remaining turn per resolved turn; expiring policies are removed. The choice
// of this turn (policy started/refreshed) is reported for the frozen facts.
export function advancePolicies(state, { now = () => new Date().toISOString(), turn = state.turn } = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const choice = normalizeCardChoice(cardState.choice);
  const activePolicies = cardState.activePolicies;
  const expired = [];
  const nextPolicies = [];
  for (const policy of activePolicies) {
    if (policy.durationType === "until_replaced") {
      nextPolicies.push(policy);
      continue;
    }
    const remaining = policy.remainingTurns - 1;
    if (remaining <= 0) {
      expired.push(policy.policyId);
    } else {
      nextPolicies.push(normalizeActivePolicy({ ...policy, remainingTurns: remaining }));
    }
  }
  const started = choice.status === "selected" && choice.selectedCardId
    ? (getCard(choice.selectedCardId)?.type === CARD_TYPES.policy ? [String(choice.cardEffects?.policy?.policy_id ?? choice.selectedCardId)] : [])
    : [];
  const refreshed = choice.status === "selected" && choice.cardEffects?.policy?.action === "refreshed"
    ? [String(choice.cardEffects.policy.policy_id)]
    : [];
  const nextState = withCardState(state, {
    offer: cardState.offer,
    choice: normalizeCardChoice({
      ...choice,
      policyStarted: started,
      policyRefreshed: refreshed,
      policyExpired: expired
    }),
    activePolicies: nextPolicies,
    pendingPlacement: cardState.pendingPlacement,
    placements: cardState.placements
  }, { bumpVersion: false });
  return { nextState, started, refreshed, expired };
}

// The card facts block frozen into TurnFacts at settlement.
export function cardFacts(state, turn) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const choice = normalizeCardChoice(cardState.choice);
  const offer = cardState.offer;
  const skipped = choice.status === "pending";
  return {
    cardOfferId: offer?.offerId ?? null,
    offeredCardIds: offer?.offeredCardIds ?? [],
    selectedCardId: skipped ? null : choice.selectedCardId,
    choiceStatus: skipped ? "skipped" : choice.status,
    choiceResolvedAt: choice.choiceResolvedAt,
    cardEffects: { ...(choice.cardEffects ?? {}) },
    policyStarted: [...(choice.policyStarted ?? [])],
    policyRefreshed: [...(choice.policyRefreshed ?? [])],
    policyExpired: [...(choice.policyExpired ?? [])],
    specialPlacementMandate: cardState.pendingPlacement
      ? { ...cardState.pendingPlacement, status: cardState.pendingPlacement.status }
      : null,
    specialPlacementsCompleted: [...(choice.specialPlacementsCompleted ?? [])]
  };
}

export function listCards() {
  return CARD_CATALOG.map((entry) => ({
    card_id: entry.cardId,
    type: entry.type,
    title: entry.title,
    description: entry.description,
    decision_mode: entry.decisionMode,
    duration: entry.duration,
    ...(entry.structure ? { structure: entry.structure } : {})
  }));
}

function withCardState(state, patch, { bumpVersion = true } = {}) {
  return {
    ...state,
    version: bumpVersion ? (state.version ?? 0) + 1 : (state.version ?? 0),
    gameplay: {
      ...(state.gameplay ?? {}),
      cardState: normalizeCardState(patch)
    }
  };
}

function normalizeCardState(value = {}) {
  return {
    offer: value.offer ? normalizeCardOffer(value.offer) : null,
    choice: normalizeCardChoice(value.choice ?? {}),
    activePolicies: [...(value.activePolicies ?? [])].map((entry) => normalizeActivePolicy(entry)),
    pendingPlacement: value.pendingPlacement ? normalizePendingPlacement(value.pendingPlacement) : null,
    placements: Object.fromEntries(Object.entries(value.placements ?? {}).map(([id, entry]) => [id, normalizePendingPlacement(entry)]))
  };
}
