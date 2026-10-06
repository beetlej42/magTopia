import { constructionSchedule } from "./construction.js";
import { getCard, CARD_TYPES, CARD_CATALOG, CARD_CHOICE_KINDS, CARD_DECISION_MODES, normalizeCardDuration } from "./card-catalog.js";
import { manhattanDistance, cellFootprint } from "./exposure.js";
import { createRoller, hashSeed, pick } from "./random.js";
import { normalizeActivePolicy, normalizeArcaneOfficer, normalizeCardChoice, normalizeCardOffer, normalizePendingPlacement, normalizeGameplayResources, normalizePopulationState } from "./schema.js";
import { canOccupyFootprint } from "../city/state.js";
import { getEntranceFrontageCells } from "../city/solver.js";
import { getFootprintCells } from "../city/contracts.js";
import { cityBlockOfBuilding } from "../city/blocks.js";
import { arcaneOfficerCapacity, arcaneOfficerRecruitmentUnlocked, generateArcaneOfficerIdentity } from "./arcane-officers.js";

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

// Deterministic three-card offer for (cityId, turn). Ordinary turns expose the
// three distinct v0.3 directions; Special turns expose only heavyweight
// families. Same city + same turn + same state always returns the same offer.
export function specialChoiceTurn(turn) {
  const value = Number(turn);
  return Number.isSafeInteger(value) && value > 0 && value % 5 === 0;
}

// Pure eligibility audit. The returned reason codes are persisted with the
// offer so Owl reports and clients can explain why a candidate was omitted.
export function cardEligibility(state = {}, cardOrId, { turn = state.turn } = {}) {
  const card = typeof cardOrId === "string" ? getCard(cardOrId) : cardOrId;
  const reasons = [];
  if (!card) return { eligible: false, reasons: ["unknown_card"] };
  const buildings = Object.values(state.buildings ?? {});
  const activePlacements = Object.values(state.gameplay?.cardState?.placements ?? {})
    .filter((entry) => !["completed", "cancelled"].includes(entry.status));
  if (state.gameplay?.cardState?.pendingPlacement
      && !["completed", "cancelled"].includes(state.gameplay.cardState.pendingPlacement.status)) {
    activePlacements.push(state.gameplay.cardState.pendingPlacement);
  }
  const hasStructure = id => buildings.some((building) => (
    building?.specialStructure?.cardId === id
      // A placed entity owns its unique slot permanently, including sealed or
      // inactive buildings. Only an explicit cancelled placement reopens it.
      && building.status !== "cancelled"
  ));
  if (card.unique && (hasStructure(card.cardId) || activePlacements.some((entry) => entry.cardId === card.cardId))) reasons.push("unique_already_claimed");
  const prerequisites = card.prerequisites ?? {};
  if (prerequisites.minBuildings != null && buildings.filter((b) => ["completed", "active"].includes(b.status ?? "completed")).length < Number(prerequisites.minBuildings)) reasons.push("requires_more_buildings");
  if (prerequisites.governance && !arcaneOfficerRecruitmentUnlocked(state)) reasons.push("requires_ministry_or_governance");
  if (prerequisites.officerCapacity && arcaneOfficerCapacity(state) <= Object.keys(state.gameplay?.arcaneOfficers ?? {}).length) reasons.push("officer_capacity_full");
  const arcaneEnergy = Number(state.gameplay?.resources?.arcaneEnergy ?? state.resources?.arcaneEnergy ?? 0);
  if (prerequisites.minArcaneEnergy != null && arcaneEnergy < Number(prerequisites.minArcaneEnergy)) reasons.push("requires_arcane_energy");
  if (prerequisites.requiredPurpose && !buildings.some((building) => (
    ["completed", "active"].includes(building.status ?? "completed")
      && canonicalBuildingPurposes(building).includes(String(prerequisites.requiredPurpose))
  ))) reasons.push("requires_canonical_purpose");
  if (prerequisites.economicBasis && !buildings.some((building) => (
    ["completed", "active"].includes(building.status ?? "completed")
      && canonicalBuildingPurposes(building).some((purpose) => ["commercial", "production"].includes(purpose))
  ))) reasons.push("requires_economic_basis");
  const minCoins = Number(prerequisites.minCoins ?? 0);
  // Every special_structure is a free system grant; affordability never makes
  // a gifted building a dead card. Prices may still gate non-gifted families.
  if (card.type !== CARD_TYPES.special_structure && Number(state.resources?.coins ?? 0) < minCoins) reasons.push("insufficient_coins");
  // Ministry's guarantee is handled by generateOffer; this guard keeps the
  // card itself legal for direct eligibility callers.
  return { eligible: reasons.length === 0, reasons, cardId: card.cardId, turn: Number(turn) };
}

export function eligibleCardCandidates(state = {}, kind, { turn = state.turn } = {}) {
  return CARD_CATALOG.filter((card) => card.choiceKind === kind && cardEligibility(state, card, { turn }).eligible);
}

export function generateOffer(cityId, turn, state = {}) {
  const roller = createRoller({ seed: hashSeed(`${String(cityId)}:card-offer:${Number(turn)}`) });
  const special = specialChoiceTurn(turn);
  const kind = special ? CARD_CHOICE_KINDS.special : CARD_CHOICE_KINDS.ordinary;
  let candidates = eligibleCardCandidates(state, kind, { turn });
  const ministryBuilt = Object.values(state.buildings ?? {}).some((building) => building?.specialStructure?.cardId === "ministry-of-magic" && building.status !== "cancelled");
  const ministryPending = Boolean(state.gameplay?.cardState?.pendingPlacement?.cardId === "ministry-of-magic"
    && !["completed", "cancelled"].includes(state.gameplay.cardState.pendingPlacement.status))
    || Object.values(state.gameplay?.cardState?.placements ?? {}).some((entry) => entry.cardId === "ministry-of-magic" && !["completed", "cancelled"].includes(entry.status));
  let guaranteed = null;
  if (special && !ministryBuilt && !ministryPending) {
    const ministry = getCard("ministry-of-magic");
    guaranteed = ministry;
    candidates = candidates.filter((card) => card.cardId !== ministry.cardId);
  }
  const selected = guaranteed ? [guaranteed] : [];
  const pool = [...candidates];
  while (selected.length < 3 && pool.length) {
    const choice = pick(roller, pool);
    selected.push(choice);
    pool.splice(pool.indexOf(choice), 1);
  }
  // Deterministic legal fallback ensures a meaningful three-card offer even
  // after a mature city has exhausted all unique special buildings.
  if (selected.length < 3) {
    const fallback = CARD_CATALOG.filter((card) => card.choiceKind === kind && !selected.includes(card) && cardEligibility(state, card, { turn }).eligible);
    while (selected.length < 3 && fallback.length) {
      const choice = fallback.shift();
      selected.push(choice);
    }
  }
  return {
    offerId: cardOfferId(cityId, turn),
    turn: Number(turn),
    choiceKind: kind,
    offeredCardIds: selected.slice(0, 3).map((card) => card.cardId),
    eligibilityAudit: CARD_CATALOG.filter((card) => card.choiceKind === kind).map((card) => ({ cardId: card.cardId, ...cardEligibility(state, card, { turn }) }))
  };
}

// Persists the canonical offer for the current turn if one is not already
// present. Re-reading never rerolls: the offer is stored, not derived fresh.
export function ensureCardOffer(state, cityId) {
  // Turn 0 is a bootstrap turn.  In particular, this guard must run before
  // any offer generation so read paths and legacy scheduler recovery cannot
  // create a player choice implicitly.
  if (state?.turn != null && Number(state.turn) === 0) return state;
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const expectedKind = specialChoiceTurn(state.turn) ? CARD_CHOICE_KINDS.special : CARD_CHOICE_KINDS.ordinary;
  const legacySelected = cardState.choice.status === "selected" && cardState.choice.offerId === cardState.offer?.offerId;
  if (cardState.offer && cardState.offer.turn === Number(state.turn)
      && (legacySelected || (cardState.offer.offeredCardIds.length === 3 && cardState.offer.choiceKind === expectedKind))) {
    return state;
  }
  const offer = generateOffer(cityId, state.turn, state);
  const choice = normalizeCardChoice(cardState.choice.offerId === offer.offerId ? cardState.choice : { offerId: offer.offerId, status: "pending", choiceKind: offer.choiceKind });
  return withCardState(state, {
    offer,
    choice,
    activePolicies: cardState.activePolicies,
    pendingPlacement: cardState.pendingPlacement,
    placements: cardState.placements,
    constructionDiscount: cardState.constructionDiscount
  }, { bumpVersion: false });
}

// Validates that a fresh turn opened: resets the choice so the new turn's
// offer starts pending. Delegated special placements deliberately survive
// across turns — they are mandates that must never silently disappear until
// legally placed or cancelled. A player-owned pending placement that was never
// located is recorded in the previous turn's frozen facts and reset.
export function openTurnCardState(state, cityId, { now = () => new Date().toISOString(), turn = state.turn } = {}) {
  if ((turn != null && Number(turn) === 0) || (turn == null && state?.turn != null && Number(state.turn) === 0)) return state;
  const offer = generateOffer(cityId, turn, state);
  const priorPlacements = state.gameplay?.cardState?.placements ?? {};
  // Both player-owned pending and delegated deferred entitlements survive the
  // turn boundary until explicitly placed or cancelled. Older code retained
  // only deferred mandates, which silently dropped an unplaced player choice.
  const retained = Object.fromEntries(Object.entries(priorPlacements).filter(([, entry]) => !["completed", "cancelled"].includes(entry.status)));
  const legacyPending = state.gameplay?.cardState?.pendingPlacement;
  if (legacyPending && !["completed", "cancelled"].includes(legacyPending.status)) retained[legacyPending.placementId] = legacyPending;
  const firstPending = Object.values(retained).find((entry) => entry.status === "pending") ?? Object.values(retained)[0] ?? null;
  return withCardState(state, {
    offer,
    choice: normalizeCardChoice({ offerId: offer.offerId, status: "pending", choiceKind: offer.choiceKind }),
    activePolicies: (state.gameplay?.cardState?.activePolicies ?? []).map((entry) => normalizeActivePolicy(entry)),
    pendingPlacement: firstPending,
    placements: retained,
    constructionDiscount: state.gameplay?.cardState?.constructionDiscount ?? null
  }, { bumpVersion: false });
}

export function currentOffer(state) {
  if (state?.turn != null && Number(state.turn) === 0) return null;
  const offer = state?.gameplay?.cardState?.offer ?? null;
  if (!offer) return null;
  return {
    offer_id: offer.offerId,
    turn: offer.turn,
    choice_kind: offer.choiceKind ?? null,
    eligibility_audit: [...(offer.eligibilityAudit ?? [])],
    cards: offer.offeredCardIds.map((cardId) => {
      const definition = getCard(cardId);
      return definition
        ? {
          card_id: definition.cardId,
          type: definition.type,
          title: definition.title,
          description: definition.description,
          decision_mode: definition.decisionMode,
          choice_kind: definition.choiceKind,
          family: definition.family,
          unique: definition.unique,
          choice_required: true,
          recommended_action: "Select exactly one offered card through POST /cards/select before the Agent resolves the turn.",
          available_decision_modes: definition.type === CARD_TYPES.special_structure
            ? [CARD_DECISION_MODES.player_place, CARD_DECISION_MODES.delegate_to_agent]
            : [CARD_DECISION_MODES.immediate],
          effect_summary: summarizeCardEffect(definition),
          effect_preview: previewCardEffect(state, definition),
          skip_consequence: "If the turn is resolved while this choice is pending, no offered card effect is applied.",
          free_placement: Boolean(definition.effect?.freePlacement),
          placement_required: definition.type === CARD_TYPES.special_structure,
          duration: definition.duration,
          ...(definition.structure ? { structure: definition.structure } : {})
        }
        : { card_id: cardId };
    })
  };
}

function summarizeCardEffect(definition) {
  const effect = definition.effect ?? {};
  if (effect.kind === "grant_coins") return `Immediately add ${effect.coins} coins.`;
  if (effect.kind === "grant_population") return `Immediately add up to ${effect.wizards} wizard residents, limited by housing capacity.`;
  if (effect.kind === "construction_discount_once") return `The next successful ordinary construction costs ${Math.round((1 - effect.discountRate) * 100)}% of its normal coin price.`;
  if (effect.kind === "recruit_officer") return "Immediately recruit one system-generated Arcane Officer when capacity allows.";
  if (effect.kind === "special_structure") return `Create one free ${definition.structure?.name ?? "special structure"} placement entitlement.`;
  if (effect.kind === "policy") {
    const turns = typeof definition.duration === "object" ? definition.duration.turns : null;
    return `Activate ${effect.policyId ?? definition.title}${turns ? ` for ${turns} turns` : ""}.`;
  }
  return definition.description;
}

function previewCardEffect(state, definition) {
  const effect = definition.effect ?? {};
  if (effect.kind === "grant_population") {
    const population = normalizePopulationState(state.gameplay?.population);
    const requested = Number(effect.wizards ?? 0);
    const current = Number(population.wizards.current ?? 0);
    const capacity = Number(population.wizards.capacity ?? 0);
    const availableCapacity = Math.max(0, capacity - current);
    const projectedGrant = Math.max(0, Math.min(requested, availableCapacity));
    return {
      kind: "wizard_population",
      requested,
      projected_grant: projectedGrant,
      current,
      capacity,
      warning: projectedGrant < requested
        ? `Only ${projectedGrant} of ${requested} wizard residents can arrive with the current wizard housing capacity.`
        : null
    };
  }
  if (effect.kind === "grant_coins") {
    return { kind: "coins", projected_grant: Number(effect.coins ?? 0), current: Number(state.gameplay?.resources?.coins ?? state.resources?.coins ?? 0) };
  }
  return null;
}

export function currentChoice(state) {
  if (state?.turn != null && Number(state.turn) === 0) {
    return { offer_id: null, status: "not_applicable", choice_kind: null, selected_card_id: null, decision_mode: null, choice_resolved_at: null, card_effects: {} };
  }
  const choice = state?.gameplay?.cardState?.choice ?? {};
  return {
    offer_id: choice.offerId ?? null,
    status: choice.status ?? "pending",
    choice_kind: choice.choiceKind ?? state?.gameplay?.cardState?.offer?.choiceKind ?? null,
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
  const cardState = state?.gameplay?.cardState ?? {};
  const entries = [...Object.values(cardState.placements ?? {})];
  // Older persisted states may still carry the single legacy pointer without
  // the indexed placements map. Project it as well so reload recovery does
  // not lose a valid entitlement during the schema transition.
  if (cardState.pendingPlacement?.placementId
      && !entries.some((entry) => entry?.placementId === cardState.pendingPlacement.placementId)) {
    entries.push(cardState.pendingPlacement);
  }
  return entries
    .filter((entry) => !["completed", "cancelled"].includes(entry.status))
    .sort((a, b) => {
      const turnA = Number.isFinite(Number(a.delegatedAtTurn)) ? Number(a.delegatedAtTurn) : Number.MAX_SAFE_INTEGER;
      const turnB = Number.isFinite(Number(b.delegatedAtTurn)) ? Number(b.delegatedAtTurn) : Number.MAX_SAFE_INTEGER;
      return turnA - turnB || String(a.placementId).localeCompare(String(b.placementId));
    })
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
        structure: getCard(entry.cardId)?.structure ?? null,
        free_placement: Boolean(getCard(entry.cardId)?.effect?.freePlacement),
        unique: Boolean(getCard(entry.cardId)?.unique),
        family: getCard(entry.cardId)?.family ?? null
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
  const policyRate = collectPolicyEffects(state).constructionDiscountRate;
  const discount = state?.gameplay?.cardState?.constructionDiscount;
  const oneTimeRate = Number(discount?.remainingUses ?? 0) > 0 ? Number(discount.discountRate ?? 0) : 0;
  return Math.max(policyRate, oneTimeRate);
}

export function consumeConstructionDiscount(state, appliedRate = activeConstructionDiscountRate(state)) {
  const discount = state?.gameplay?.cardState?.constructionDiscount;
  if (!discount || Number(discount.remainingUses ?? 0) <= 0) return state;
  const oneTimeRate = Number(discount.discountRate ?? 0);
  const policyRate = collectPolicyEffects(state).constructionDiscountRate;
  // A one-shot entitlement is consumed only when it actually determines the
  // applied rate. A stronger legacy policy may coexist with it without
  // burning the player's unused entitlement.
  if (oneTimeRate + 1e-9 < Number(appliedRate ?? 0) || oneTimeRate + 1e-9 < policyRate) return state;
  return {
    ...state,
    gameplay: {
      ...state.gameplay,
      cardState: normalizeCardState({ ...(state.gameplay.cardState ?? {}), constructionDiscount: { ...discount, remainingUses: 0 } })
    }
  };
}

function canonicalBuildingPurposes(building) {
  // Persisted canonical gameplay units are authoritative. Do not let a
  // renderer/program label override them when the two disagree. The
  // gameplayBuilding spelling is accepted for transitional in-memory states;
  // only when neither canonical field exists do we use legacy fallbacks.
  const units = Array.isArray(building?.gameplay?.units)
    ? building.gameplay.units
    : Array.isArray(building?.gameplayBuilding?.units)
      ? building.gameplayBuilding.units
      : null;
  if (units) return units.map((unit) => String(unit?.purpose ?? "").toLowerCase()).filter(Boolean);
  return [String(building?.program?.purpose ?? building?.metadata?.purpose ?? "").toLowerCase()].filter(Boolean);
}

export function specialStructureBuildings(state) {
  return Object.values(state?.buildings ?? {}).filter((building) => building?.specialStructure?.cardId
    && ["active", "completed"].includes(building.status ?? "completed"));
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
  if (state?.turn != null && Number(state.turn) === 0) {
    return { accepted: false, code: "BOOTSTRAP_TURN_NO_CARD", message: "Turn 0 is the bootstrap turn; no card may be selected" };
  }
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
  if (card.choiceKind === CARD_CHOICE_KINDS.special) {
    const eligibility = cardEligibility(state, card, { turn: state.turn });
    if (!eligibility.eligible) {
      return { accepted: false, code: "CARD_PREREQUISITE_NOT_MET", message: `Card ${cardId} is no longer eligible: ${eligibility.reasons.join(", ")}` };
    }
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
  if (card.choiceKind === CARD_CHOICE_KINDS.ordinary && decisionMode !== CARD_DECISION_MODES.immediate) {
    return { accepted: false, code: "ORDINARY_IMMEDIATE_ONLY", message: "Ordinary choice cards resolve immediately and do not accept placement delegation" };
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
  } else if (card.type === CARD_TYPES.resource || card.type === CARD_TYPES.personnel || card.type === CARD_TYPES.people) {
    const resolution = resolveImmediateCard(next, card, cityId, context);
    if (!resolution.accepted) return resolution;
    next = resolution.nextState;
    Object.assign(cardEffects, resolution.effects);
  } else if (card.type === CARD_TYPES.building && card.effect?.kind === "construction_discount_once") {
    const existing = next.gameplay.cardState.constructionDiscount;
    const preserved = existing && Number(existing.remainingUses ?? 0) > 0;
    if (!preserved) {
      next = withCardState(next, {
        offer: cardState.offer,
        choice: cardState.choice,
        activePolicies: next.gameplay.cardState.activePolicies,
        pendingPlacement: next.gameplay.cardState.pendingPlacement,
        placements: next.gameplay.cardState.placements,
        constructionDiscount: { cardId: card.cardId, discountRate: Number(card.effect.discountRate), remainingUses: 1, grantedAtTurn: state.turn }
      }, { bumpVersion: false });
    }
    cardEffects.discount = { rate: preserved ? existing.discountRate : Number(card.effect.discountRate), uses: 1, preserved };
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
      choiceKind: offer.choiceKind ?? card.choiceKind,
      selectedCardId: cardId,
      decisionMode,
      choiceResolvedAt: now(),
      cardEffects
    }),
    activePolicies: next.gameplay.cardState.activePolicies,
    pendingPlacement: placementPatch?.pendingPlacement ?? next.gameplay.cardState.pendingPlacement,
    placements: placementPatch?.placements ?? next.gameplay.cardState.placements,
    constructionDiscount: next.gameplay.cardState.constructionDiscount
  });
  return { accepted: true, code: "OK", nextState: next, cardId, cardEffects };
}

// Records the explicit skipped/no-card choice at settlement. Never blocks
// settlement and never backfills multiple choices.
export function markChoiceSkipped(state, { now = () => new Date().toISOString() } = {}) {
  if (state?.turn != null && Number(state.turn) === 0) return state;
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const choice = normalizeCardChoice(cardState.choice);
  if (choice.status !== "pending") return state;
  return withCardState(state, {
    offer: cardState.offer,
    choice: normalizeCardChoice({ ...choice, status: "skipped", choiceResolvedAt: now() }),
    activePolicies: cardState.activePolicies,
    pendingPlacement: cardState.pendingPlacement,
    placements: cardState.placements,
    constructionDiscount: cardState.constructionDiscount
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
  if (placement.status === "cancelled") {
    return { accepted: false, code: "PLACEMENT_CANCELLED", message: `Placement ${placement.placementId} was cancelled and cannot be placed` };
  }
  if (!["pending", "deferred"].includes(placement.status)) {
    return { accepted: false, code: "PLACEMENT_NOT_ACTIVE", message: `Placement ${placement.placementId} is not active` };
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

  const buildingId = context.createId?.("building") ?? `building-${state.turn}-${cardId}-${placement.placementId}`;
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
      canonicalProgram: effect.canonicalProgram ?? structure.canonicalProgram ?? null,
      attributes: { magicLevel: effect.magicLevel ?? 0.5, specialCardId: card.cardId, canonicalProgram: effect.canonicalProgram ?? structure.canonicalProgram ?? null }
    },
    status: "construction",
    construction: constructionSchedule(state.turn),
    specialStructure: {
      cardId: card.cardId,
      structureId: card.cardId,
      canonicalProgram: effect.canonicalProgram ?? structure.canonicalProgram ?? null,
      effect
    },
    createdAtTurn: state.turn
  };
  if (next.events) {
    next.events.push({
      id: context.createId?.("event") ?? `event-${state.turn}-${cardId}`,
      turn: state.turn,
      cityVersion: (state.version ?? 0) + 1,
      at: context.now?.() ?? new Date().toISOString(),
      type: "special_structure_started",
      actor: "system:card",
      cardId: card.cardId,
      buildingId,
      lotId,
      footprint,
      summary: `${structure.name} began construction; ready at turn ${state.turn + 1}.`
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
      placements,
      constructionDiscount: cardState.constructionDiscount
    })
  };
  return { accepted: true, code: "OK", nextState: next, buildingId, placement: completed };
}

// Explicit cancellation is the only way a unique special card may become
// eligible again. It releases the entitlement but never mutates a placed
// building; completed/placed mandates are intentionally non-cancellable.
export function cancelSpecialStructurePlacement(state, input = {}, context = {}) {
  const cardState = normalizeCardState(state.gameplay?.cardState);
  const placementId = String(input.placementId ?? input.placement_id ?? "");
  const placement = cardState.placements[placementId];
  if (!placement) return { accepted: false, code: "PLACEMENT_NOT_FOUND", message: `No pending placement exists for id ${placement…47947 tokens truncated… 6, z - 1, 3, 3, 3, shadeKey + 3, write);
    return;
  }
  buffer.addBox("timber", x - 3, crownY - 2, z, 7, 2, 2, shadeKey + 1, write);
  buffer.addBox("foliageDark", x - 4, crownY - 1, z - 4, 9, 4, 9, shadeKey + 2, write);
  buffer.addBox("foliage", x - 3, crownY + 3, z - 3, 7, 3, 7, shadeKey + 3, write);
  [[-4, -3], [3, -3], [-4, 3], [3, 3]].forEach(([dx, dz], index) => {
    const drop = 3 + positiveModulo(shadeKey + index, 3);
    buffer.addBox(index % 2 ? "foliage" : "foliageDark", x + dx, crownY - drop, z + dz, 2, drop + 2, 2, shadeKey + index + 4, write);
  });
}

function addVoxelShrub(buffer, form, x, groundY, z, rng, shadeKey, write) {
  if (form === "rounded") {
    buffer.addBox("foliageDark", x - 1, groundY + 1, z - 1, 4, 2, 3, shadeKey, write);
    buffer.addBox("foliage", x, groundY + 3, z, 2, 1 + Math.round(rng()), 2, shadeKey + 1, write);
    return;
  }
  if (form === "fern") {
    buffer.addVoxel("foliageDark", x, groundY + 1, z, shadeKey, write);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], index) => {
      const length = 2 + positiveModulo(shadeKey + index, 2);
      for (let step = 1; step <= length; step += 1) {
        buffer.addVoxel("foliageLight", x + dx * step, groundY + Math.max(1, 3 - step), z + dz * step, shadeKey + index + step, write);
      }
    });
    return;
  }
  buffer.addBox("foliage", x - 1, groundY + 1, z - 1, 3, 3, 3, shadeKey, write);
  const blossom = rng() > 0.48 ? "blossomPink" : "blossomGold";
  [[-1, -1], [1, -1], [0, 1]].forEach(([dx, dz], index) => buffer.addVoxel(blossom, x + dx, groundY + 4 + (index % 2), z + dz, shadeKey + index + 1, write));
}

function districtCellAtVoxel(layout, x, z) {
  const column = Math.floor((x + layout.widthVoxels / 2) / layout.cellVoxels);
  const row = Math.floor((z + layout.depthVoxels / 2) / layout.cellVoxels);
  if (column < 0 || row < 0 || column >= layout.columns || row >= layout.rows) return null;
  return layout.cells[row * layout.columns + column] ?? null;
}

function districtCellBounds(column, row) {
  const minX = -DISTRICT_WIDTH_VOXELS / 2 + column * DISTRICT_CELL_VOXELS;
  const minZ = -DISTRICT_DEPTH_VOXELS / 2 + row * DISTRICT_CELL_VOXELS;
  return {
    minX,
    maxX: minX + DISTRICT_CELL_VOXELS,
    minZ,
    maxZ: minZ + DISTRICT_CELL_VOXELS
  };
}

function placeDistrictObject(object, placement, footprint) {
  const bounds = districtCellBounds(placement.column, placement.row);
  const centerX = bounds.minX + footprint.widthCells * DISTRICT_CELL_VOXELS / 2;
  const centerZ = bounds.minZ + footprint.depthCells * DISTRICT_CELL_VOXELS / 2;
  object.position.set(centerX * VOXEL_SIZE, 0, centerZ * VOXEL_SIZE);
  object.userData.districtPlacement = {
    column: placement.column,
    row: placement.row,
    widthCells: footprint.widthCells,
    depthCells: footprint.depthCells,
    centerVoxels: [centerX, centerZ],
    centerWorld: [centerX * VOXEL_SIZE, centerZ * VOXEL_SIZE]
  };
}

function createDistrictGridDiagnostics(layout, objects) {
  const placements = Object.fromEntries(Object.entries(objects).map(([id, object]) => {
    const placement = object.userData.districtPlacement;
    const voxelPosition = [object.position.x / VOXEL_SIZE, object.position.z / VOXEL_SIZE];
    return [id, {
      ...structuredClone(placement),
      voxelPosition,
      gridAligned: voxelPosition.every((value) => Number.isInteger(value))
    }];
  }));
  return {
    columns: layout.columns,
    rows: layout.rows,
    cellVoxels: layout.cellVoxels,
    cellWorldSize: layout.cellVoxels * VOXEL_SIZE,
    surfaceCounts: layout.cells.reduce((counts, cell) => ({
      ...counts,
      [cell.surface]: (counts[cell.surface] ?? 0) + 1
    }), {}),
    placements
  };
}

export function projectDistrictOntoSphere(root, radius) {
  root.updateMatrixWorld(true);
  const leaves = [];
  const collectProjectionLeaves = (object) => {
    if (object !== root && (
      object.userData?.sphereProjectionRoot
      || object.isInstancedMesh
      || object.isMesh
      || object.isLight
    )) {
      leaves.push(object);
      return;
    }
    object.children.forEach(collectProjectionLeaves);
  };
  collectProjectionLeaves(root);

  const instanceMatrix = new THREE.Matrix4();
  const flatMatrix = new THREE.Matrix4();
  const curvedMatrix = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let projectedInstances = 0;
  let projectedVertices = 0;
  let correctedReflectedGeometries = 0;
  let maximumTiltRadians = 0;

  leaves.forEach((object) => {
    if (object.isInstancedMesh) {
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, instanceMatrix);
        flatMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        maximumTiltRadians = Math.max(maximumTiltRadians, curveFlatMatrixOntoSphere(flatMatrix, curvedMatrix, radius));
        object.setMatrixAt(index, curvedMatrix);
        projectedInstances += 1;
      }
      object.instanceMatrix.needsUpdate = true;
      root.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.set(1, 1, 1);
      object.updateMatrix();
      object.computeBoundingSphere();
      return;
    }

    if (object.isMesh && object.userData.flatVoxelGeometry) {
      // Some API-backed layers mirror flat Z to reconcile row conventions.
      // Baking that negative transform into positions reverses triangle
      // winding, so restore the original outward-facing orientation before
      // using FrontSide materials on the curved result.
      if (object.matrixWorld.determinant() < 0 && reverseIndexedTriangleWinding(object.geometry)) {
        correctedReflectedGeometries += 1;
      }
      const positions = object.geometry.attributes.position;
      const flatPosition = new THREE.Vector3();
      const curvedPosition = new THREE.Vector3();
      for (let index = 0; index < positions.count; index += 1) {
        flatPosition.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        const frame = getVoxelSphereFrame(flatPosition.x, flatPosition.z, radius);
        curvedPosition.copy(frame.surface).addScaledVector(frame.normal, flatPosition.y);
        positions.setXYZ(index, curvedPosition.x, curvedPosition.y, curvedPosition.z);
        maximumTiltRadians = Math.max(maximumTiltRadians, frame.normal.angleTo(worldUp));
      }
      positions.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      projectedVertices += positions.count;
      projectedInstances += object.userData.sourceVoxelCount ?? 0;
      root.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.set(1, 1, 1);
      object.updateMatrix();
      return;
    }

    flatMatrix.copy(object.matrixWorld);
    maximumTiltRadians = Math.max(maximumTiltRadians, curveFlatMatrixOntoSphere(flatMatrix, curvedMatrix, radius));
    root.add(object);
    curvedMatrix.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrix();
  });
  root.updateMatrixWorld(true);
  return {
    type: "spherical-local-frame",
    radius,
    projectedObjects: leaves.length,
    projectedInstances,
    projectedVertices,
    correctedReflectedGeometries,
    maximumSurfaceTiltDegrees: THREE.MathUtils.radToDeg(maximumTiltRadians)
  };
}

function reverseIndexedTriangleWinding(geometry) {
  const index = geometry.getIndex();
  if (!index || index.count % 3 !== 0) return false;
  for (let offset = 0; offset < index.count; offset += 3) {
    const second = index.getX(offset + 1);
    index.setX(offset + 1, index.getX(offset + 2));
    index.setX(offset + 2, second);
  }
  index.needsUpdate = true;
  return true;
}

function curveFlatMatrixOntoSphere(flatMatrix, targetMatrix, radius) {
  const flatPosition = new THREE.Vector3();
  const flatQuaternion = new THREE.Quaternion();
  const flatScale = new THREE.Vector3();
  flatMatrix.decompose(flatPosition, flatQuaternion, flatScale);
  const frame = getVoxelSphereFrame(flatPosition.x, flatPosition.z, radius);
  const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(flatQuaternion);
  const axisY = new THREE.Vector3(0, 1, 0).applyQuaternion(flatQuaternion);
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(flatQuaternion);
  mapFlatDirectionToSphere(axisX, frame).normalize();
  mapFlatDirectionToSphere(axisY, frame).normalize();
  mapFlatDirectionToSphere(axisZ, frame).normalize();
  const curvedPosition = frame.surface.clone().addScaledVector(frame.normal, flatPosition.y);
  targetMatrix.makeBasis(axisX, axisY, axisZ);
  targetMatrix.scale(flatScale);
  targetMatrix.setPosition(curvedPosition);
  return frame.normal.angleTo(WORLD_UP);
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function getVoxelSphereFrame(x, z, radius, target = null) {
  const longitude = x / radius;
  const latitude = z / radius;
  const cosLongitude = Math.cos(longitude);
  const sinLongitude = Math.sin(longitude);
  const cosLatitude = Math.cos(latitude);
  const sinLatitude = Math.sin(latitude);
  const frame = target ?? {
    normal: new THREE.Vector3(),
    tangentX: new THREE.Vector3(),
    tangentZ: new THREE.Vector3(),
    surface: new THREE.Vector3()
  };
  frame.normal.set(
    sinLongitude * cosLatitude,
    cosLongitude * cosLatitude,
    sinLatitude
  );
  frame.tangentX.set(cosLongitude, -sinLongitude, 0);
  frame.tangentZ.set(
    -sinLongitude * sinLatitude,
    -cosLongitude * sinLatitude,
    cosLatitude
  );
  frame.surface.copy(frame.normal).multiplyScalar(radius);
  frame.surface.y -= radius;
  return frame;
}

function mapFlatDirectionToSphere(direction, frame) {
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  return direction.copy(frame.tangentX).multiplyScalar(x)
    .addScaledVector(frame.normal, y)
    .addScaledVector(frame.tangentZ, z);
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function withMagicBias(intent, bias) {
  return { ...intent, magicLevel: clamp(intent.magicLevel + bias, 0, 1) };
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clamp(value, minimum, maximum));
}
