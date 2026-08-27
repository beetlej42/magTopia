// PR F — Player Daily Cards catalog.
//
// SYSTEM-owned card definitions. Every mechanical value lives here (or in
// policy/effect definitions referenced from here); routes and client input
// must never supply effect parameters. Players choose a card; the Agent sees
// the player's choice; the system owns every number that changes the city.

export const CARD_TYPES = Object.freeze({
  special_structure: "special_structure",
  resource: "resource",
  personnel: "personnel",
  policy: "policy",
  building: "building",
  people: "people"
});

export const CARD_CHOICE_KINDS = Object.freeze({
  ordinary: "ordinary",
  special: "special"
});

export const CARD_DECISION_MODES = Object.freeze({
  immediate: "immediate",
  player_place: "player_place",
  delegate_to_agent: "delegate_to_agent"
});

// Centralized coarse numeric values (MVP numeric principles). No tiny
// percentage modifiers; every number is legible and test-covered.
export const EFFECT_VALUES = Object.freeze({
  ministryGrantCoins: 100,
  newWizardResidents: 4,
  wizardGrowthBonusRate: 0.15,
  // Ordinary BUILDING is a single-use 20% discount. The old 50% multi-turn
  // policy remains a legacy catalog entry, but is never part of ordinary
  // choice generation.
  ordinaryConstructionDiscountRate: 0.2,
  constructionDiscountRate: 0.5,
  incidentResponseBonus: 1,
  secrecyConcealmentBonus: 1,
  diagonAlleyConcealment: 2,
  diagonAlleyRadius: 4,
  concealmentStatueConcealment: 3,
  concealmentStatueRadius: 2,
  owlTowerWizardCapacity: 3,
  owlTowerCoinOutput: 4,
  flooCoinOutput: 5,
  flooWizardCapacity: 2,
  moonlightArcaneEnergyOutput: 6,
  moonlightExposureModifier: 2,
  ordinaryPopulation: 2,
  ordinaryResourceCoins: 20,
  largeSpecialGrantCoins: 180,
  specialArcaneReserveCoins: 240,
  arcaneConservatoryEnergy: 16
});

export const SPECIAL_STRUCTURES = Object.freeze({
  "diagon-alley-entrance": Object.freeze({
    archetype: "special_structure",
    name: "Diagon Alley Entrance",
    footprint: "2x2",
    purpose: "special_structure"
  }),
  "owl-tower": Object.freeze({
    archetype: "special_structure",
    name: "Owl Tower",
    footprint: "1x1",
    purpose: "special_structure"
  }),
  "floo-fireplace-station": Object.freeze({
    archetype: "special_structure",
    name: "Floo Fireplace Station",
    footprint: "1x1",
    purpose: "special_structure"
  }),
  "concealment-statue": Object.freeze({
    archetype: "special_structure",
    name: "Concealment Statue",
    footprint: "1x1",
    purpose: "special_structure"
  }),
  "moonlight-herb-plot": Object.freeze({
    archetype: "special_structure",
    name: "Moonlight Herb Plot",
    footprint: "1x1",
    purpose: "special_structure"
  }),
  "ministry-of-magic": Object.freeze({
    archetype: "special_structure",
    name: "Ministry of Magic",
    footprint: "2x2",
    purpose: "special_structure",
    canonicalProgram: "ministry_of_magic",
    placeholder: true
  }),
  "royal-botanical-greenhouse": Object.freeze({
    archetype: "special_structure",
    name: "Royal Botanical Greenhouse",
    footprint: "2x2",
    purpose: "special_structure",
    canonicalProgram: "royal_botanical_greenhouse",
    placeholder: true
  })
});

// A card definition. `effect` is a stable machine-readable effect block that
// the resolution layer reads; `metadata` carries presentation hints. `rarity`
// is reserved but unused in the MVP.
function card(cardId, type, title, description, effect, options = {}) {
  const systemEffect = type === CARD_TYPES.special_structure
    ? { freePlacement: true, ...effect }
    : effect;
  return Object.freeze({
    cardId,
    type,
    title,
    description,
    effect: Object.freeze(systemEffect),
    decisionMode: options.decisionMode ?? CARD_DECISION_MODES.immediate,
    duration: options.duration ?? "instant",
    structure: options.structure ?? null,
    choiceKind: options.choiceKind ?? (type === CARD_TYPES.special_structure ? CARD_CHOICE_KINDS.special : null),
    family: options.family ?? (type === CARD_TYPES.special_structure ? "special_building" : null),
    unique: Boolean(options.unique),
    prerequisites: Object.freeze(options.prerequisites ?? {}),
    metadata: Object.freeze(options.metadata ?? {})
  });
}

export const CARD_CATALOG = Object.freeze([
  // ---- A. Special structures / facilities / magical plants (5) ----
  card(
    "ministry-of-magic",
    CARD_TYPES.special_structure,
    "Ministry of Magic",
    "A system-owned civic placeholder that grants one free special-structure placement and unlocks Arcane Officer recruitment once built.",
    { kind: "special_structure", magicLevel: 0.5, canonicalProgram: "ministry_of_magic", freePlacement: true, governance: true },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["ministry-of-magic"], metadata: { placeholder: true, canonicalProgram: "ministry_of_magic" } }
  ),
  card(
    "diagon-alley-entrance",
    CARD_TYPES.special_structure,
    "Diagon Alley Entrance",
    "A hidden entrance to the wizarding high street. Once placed, it conceals magical buildings in its block, sheltering them from muggle attention.",
    {
      kind: "special_structure",
      magicLevel: 0.6,
      scope: "same_block",
      concealmentBonus: EFFECT_VALUES.diagonAlleyConcealment,
      concealmentRadius: EFFECT_VALUES.diagonAlleyRadius
    },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["diagon-alley-entrance"] }
  ),
  card(
    "owl-tower",
    CARD_TYPES.special_structure,
    "Owl Tower",
    "A modest tower for owl roosts and messenger flocks. It draws wizarding households to its block and adds a touch of community prosperity.",
    {
      kind: "special_structure",
      magicLevel: 0.4,
      wizardCapacity: EFFECT_VALUES.owlTowerWizardCapacity,
      coinOutput: EFFECT_VALUES.owlTowerCoinOutput
    },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["owl-tower"] }
  ),
  card(
    "floo-fireplace-station",
    CARD_TYPES.special_structure,
    "Floo Fireplace Station",
    "A public hearth linked into the floo network. It brings travellers and trade to its block, lifting local prosperity.",
    {
      kind: "special_structure",
      magicLevel: 0.5,
      coinOutput: EFFECT_VALUES.flooCoinOutput,
      wizardCapacity: EFFECT_VALUES.flooWizardCapacity
    },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["floo-fireplace-station"] }
  ),
  card(
    "concealment-statue",
    CARD_TYPES.special_structure,
    "Concealment Statue",
    "A heavily enchanted statue that pushes local concealment much higher across a smaller area.",
    {
      kind: "special_structure",
      magicLevel: 0.7,
      scope: "radius",
      concealmentBonus: EFFECT_VALUES.concealmentStatueConcealment,
      concealmentRadius: EFFECT_VALUES.concealmentStatueRadius
    },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["concealment-statue"] }
  ),
  card(
    "moonlight-herb-plot",
    CARD_TYPES.special_structure,
    "Moonlight Herb Plot",
    "A magical garden of moonlit herbs. It slowly produces magic for the city, at the cost of a small exposure risk.",
    {
      kind: "special_structure",
      magicLevel: 0.8,
      arcaneEnergyOutput: EFFECT_VALUES.moonlightArcaneEnergyOutput,
      exposureModifier: EFFECT_VALUES.moonlightExposureModifier
    },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["moonlight-herb-plot"] }
  ),

  card(
    "royal-botanical-greenhouse",
    CARD_TYPES.special_structure,
    "Royal Botanical Greenhouse",
    "A rare civic greenhouse placeholder that produces arcane energy for a growing city.",
    { kind: "special_structure", magicLevel: 0.85, arcaneEnergyOutput: 12, canonicalProgram: "royal_botanical_greenhouse" },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: SPECIAL_STRUCTURES["royal-botanical-greenhouse"], prerequisites: { minBuildings: 4 }, metadata: { placeholder: true } }
  ),
  card(
    "arcane-energy-conservatory",
    CARD_TYPES.special_structure,
    "Arcane Energy Conservatory",
    "A high-order greenhouse placeholder that becomes available only after the city proves its arcane economy.",
    { kind: "special_structure", magicLevel: 1, arcaneEnergyOutput: EFFECT_VALUES.arcaneConservatoryEnergy, canonicalProgram: "arcane_energy_conservatory" },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "special_building", unique: true, decisionMode: CARD_DECISION_MODES.player_place, structure: { ...SPECIAL_STRUCTURES["royal-botanical-greenhouse"], name: "Arcane Energy Conservatory", canonicalProgram: "arcane_energy_conservatory" }, prerequisites: { minArcaneEnergy: 40, requiredPurpose: "greenhouse", economicBasis: true }, metadata: { placeholder: true } }
  ),

  // ---- B. Resources / personnel (3) ----
  card(
    "ministry-grant",
    CARD_TYPES.resource,
    "Ministry Grant",
    "The Ministry of Magic approves an emergency civic grant for the city treasury.",
    { kind: "grant_coins", coins: EFFECT_VALUES.ministryGrantCoins },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: "instant" }
  ),
  card(
    "ordinary-building-discount",
    CARD_TYPES.building,
    "Building Materials Charter",
    "Your next ordinary building costs 80% of its system-calculated coin cost. This is consumed by one successful construction.",
    { kind: "construction_discount_once", discountRate: EFFECT_VALUES.ordinaryConstructionDiscountRate, uses: 1 },
    { choiceKind: CARD_CHOICE_KINDS.ordinary, family: "ordinary_building", decisionMode: CARD_DECISION_MODES.immediate }
  ),
  card(
    "ordinary-people-migration",
    CARD_TYPES.people,
    "Supported Wizard Arrivals",
    "Immediately move around two wizard residents into supported available housing, clamped by authoritative capacity.",
    { kind: "grant_population", wizards: EFFECT_VALUES.ordinaryPopulation },
    { choiceKind: CARD_CHOICE_KINDS.ordinary, family: "ordinary_people", decisionMode: CARD_DECISION_MODES.immediate }
  ),
  card(
    "ordinary-resource-grant",
    CARD_TYPES.resource,
    "Civic Resource Grant",
    "Add 20 coins to the city treasury immediately.",
    { kind: "grant_coins", coins: EFFECT_VALUES.ordinaryResourceCoins },
    { choiceKind: CARD_CHOICE_KINDS.ordinary, family: "ordinary_resource", decisionMode: CARD_DECISION_MODES.immediate }
  ),
  card(
    "special-development-grant",
    CARD_TYPES.resource,
    "Special Development Grant",
    "A large one-time grant reserved for a mature magical city.",
    { kind: "grant_coins", coins: EFFECT_VALUES.largeSpecialGrantCoins },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "large_resource", decisionMode: CARD_DECISION_MODES.immediate, prerequisites: { minBuildings: 2 } }
  ),
  card(
    "emergency-special-grant",
    CARD_TYPES.resource,
    "Emergency Magical Reserve",
    "A repeatable large reserve grant for special-turn strategic choices.",
    { kind: "grant_coins", coins: EFFECT_VALUES.largeSpecialGrantCoins },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "large_resource", decisionMode: CARD_DECISION_MODES.immediate }
  ),
  card(
    "new-wizard-residents",
    CARD_TYPES.resource,
    "New Wizard Residents",
    "A family of wizard settlers arrives and takes up residence, within the city's housing capacity.",
    { kind: "grant_population", wizards: EFFECT_VALUES.newWizardResidents },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: "instant" }
  ),
  card(
    "arcane-officer-reinforcement",
    CARD_TYPES.personnel,
    "Arcane Officer Reinforcement",
    "A named Arcane Officer transfers to the city and joins the response roster.",
    { kind: "recruit_officer" },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "rare_person", decisionMode: CARD_DECISION_MODES.immediate, duration: "instant", prerequisites: { governance: true, officerCapacity: true } }
  ),
  card(
    "arcane-development-charter",
    CARD_TYPES.policy,
    "Arcane Development Charter",
    "A multi-turn charter that increases the city's magical growth while it is active.",
    { kind: "policy", policyId: "arcane-development-charter", wizardGrowthBonusRate: 0.2 },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "multi_turn_modifier", decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 4 }, prerequisites: { minBuildings: 2 } }
  ),
  card(
    "special-secrecy-charter",
    CARD_TYPES.policy,
    "Special Secrecy Charter",
    "A repeatable multi-turn concealment charter reserved for Special Choice.",
    { kind: "policy", policyId: "special-secrecy-charter", concealmentBonus: 2 },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "multi_turn_modifier", decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 3 } }
  ),
  card(
    "special-arcane-reserve",
    CARD_TYPES.resource,
    "Arcane Infrastructure Reserve",
    "A substantial reserve for a city pursuing a special-turn infrastructure route.",
    { kind: "grant_coins", coins: EFFECT_VALUES.specialArcaneReserveCoins },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "large_resource", decisionMode: CARD_DECISION_MODES.immediate }
  ),
  card(
    "special-warding-program",
    CARD_TYPES.policy,
    "Warding Programme",
    "A repeatable multi-turn programme that reduces magical exposure pressure.",
    { kind: "policy", policyId: "special-warding-program", concealmentBonus: 2 },
    { choiceKind: CARD_CHOICE_KINDS.special, family: "multi_turn_modifier", decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 4 } }
  ),

  // ---- C. City policies (4) ----
  card(
    "statute-of-secrecy-reinforcement",
    CARD_TYPES.policy,
    "Statute of Secrecy Reinforcement",
    "For three turns, magical buildings receive an extra concealment bonus against muggle attention.",
    {
      kind: "policy",
      policyId: "statute-of-secrecy-reinforcement",
      concealmentBonus: EFFECT_VALUES.secrecyConcealmentBonus
    },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 3 } }
  ),
  card(
    "city-construction-mobilization",
    CARD_TYPES.policy,
    "City Construction Mobilization",
    "For two turns, city construction costs are meaningfully reduced.",
    {
      kind: "policy",
      policyId: "city-construction-mobilization",
      constructionDiscountRate: EFFECT_VALUES.constructionDiscountRate
    },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 2 } }
  ),
  card(
    "wizard-settlement-initiative",
    CARD_TYPES.policy,
    "Wizard Settlement Initiative",
    "For three turns, wizard population growth is accelerated.",
    {
      kind: "policy",
      policyId: "wizard-settlement-initiative",
      wizardGrowthBonusRate: EFFECT_VALUES.wizardGrowthBonusRate
    },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 3 } }
  ),
  card(
    "arcane-officer-special-duty-order",
    CARD_TYPES.policy,
    "Arcane Officer Special Duty Order",
    "For two turns, Arcane Officers gain additional incident-response capacity.",
    {
      kind: "policy",
      policyId: "arcane-officer-special-duty-order",
      incidentResponseBonus: EFFECT_VALUES.incidentResponseBonus
    },
    { decisionMode: CARD_DECISION_MODES.immediate, duration: { type: "turns", turns: 2 } }
  )
]);

export function getCard(cardId) {
  return CARD_CATALOG.find((entry) => entry.cardId === cardId) ?? null;
}

export function getCardsByCategory() {
  const byCategory = { special_structure: [], resource: [], personnel: [], policy: [] };
  for (const entry of CARD_CATALOG) {
    if (byCategory[entry.type]) byCategory[entry.type].push(entry);
  }
  return byCategory;
}

// Unwraps the duration entry (either "instant" or a {type, turns} object).
export function normalizeCardDuration(duration) {
  if (duration && typeof duration === "object") {
    return { type: duration.type ?? "turns", turns: Number(duration.turns ?? 1) };
  }
  return { type: "instant", turns: 0 };
}
