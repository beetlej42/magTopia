import assert from "node:assert/strict";
import test from "node:test";
import { createCityState } from "../src/city/state.js";
import { createServiceWorldContract } from "../apps/server/world.js";
import {
  cardEligibility,
  currentOffer,
  ensureCardOffer,
  generateOffer,
  openTurnCardState,
  selectCard,
  placeSpecialStructure
} from "../src/gameplay/cards.js";
import { CARD_CHOICE_KINDS, CARD_TYPES } from "../src/gameplay/card-catalog.js";
import { activeConstructionDiscountRate } from "../src/gameplay/cards.js";
import { previewConstruction } from "../src/city/solver.js";
import { executeCityCommand } from "../src/city/engine.js";

function stateAt(turn, cityId = "pri-city") {
  const world = createServiceWorldContract({ seed: "pri-special-choice", columns: 20, rows: 20 });
  const state = createCityState(world, { cityId, mapSeed: "pri-special-choice" });
  state.turn = turn;
  state.gameplay.turnKind = turn === 0 ? "bootstrap" : "normal";
  state.gameplay.turnStatus = "open";
  return state;
}

function withOffer(turn) {
  const state = stateAt(turn);
  return ensureCardOffer(state, state.cityId);
}

function legalMinistryLot(state) {
  for (const cell of Object.values(state.cells)) {
    if (!cell.buildable || cell.strictBuildable === false || cell.node || cell.occupancy || cell.infrastructure) continue;
    const ids = [`cell-${cell.column}-${cell.row}`, `cell-${cell.column + 1}-${cell.row}`, `cell-${cell.column}-${cell.row + 1}`, `cell-${cell.column + 1}-${cell.row + 1}`];
    if (ids.every((id) => state.cells[id]?.buildable && state.cells[id]?.strictBuildable !== false && !state.cells[id].node && !state.cells[id].occupancy && !state.cells[id].infrastructure)) return cell.id;
  }
  return null;
}

test("PR-I cadence: Turn 0 has no card, ordinary windows are 1-4/6-9, Special is every fifth turn", () => {
  assert.equal(currentOffer(stateAt(0)), null);
  for (const turn of [1, 2, 3, 4, 6, 7, 8, 9]) {
    const offer = withOffer(turn).gameplay.cardState.offer;
    assert.equal(offer.choiceKind, CARD_CHOICE_KINDS.ordinary);
    assert.deepEqual(new Set(offer.offeredCardIds.map((id) => id.startsWith("ordinary-") ? id : id)), new Set(["ordinary-building-discount", "ordinary-people-migration", "ordinary-resource-grant"]));
  }
  for (const turn of [5, 10, 15]) {
    const offer = withOffer(turn).gameplay.cardState.offer;
    assert.equal(offer.choiceKind, CARD_CHOICE_KINDS.special);
    assert.equal(offer.offeredCardIds.length, 3);
    assert.ok(offer.offeredCardIds.every((id) => !id.startsWith("ordinary-")));
  }
});

test("Ministry is guaranteed, remains pending across turns, and is unique after placement even when sealed", () => {
  let state = withOffer(5);
  const offer = state.gameplay.cardState.offer;
  assert.ok(offer.offeredCardIds.includes("ministry-of-magic"));
  const selected = selectCard(state, state.cityId, { offerId: offer.offerId, selectedCardId: "ministry-of-magic" }, { createId: (prefix) => `${prefix}-ministry` });
  assert.equal(selected.accepted, true);
  state = selected.nextState;
  assert.equal(state.gameplay.cardState.placements["placement-ministry"].status, "pending");
  const opened = openTurnCardState({ ...state, turn: 10 }, state.cityId, { turn: 10 });
  assert.equal(opened.gameplay.cardState.placements["placement-ministry"].status, "pending");
  assert.ok(!opened.gameplay.cardState.offer.offeredCardIds.includes("ministry-of-magic"));
  const ministry = { id: legalMinistryLot(opened) };
  const placed = placeSpecialStructure(opened, opened.cityId, { cardId: "ministry-of-magic", placementId: "placement-ministry", lotId: ministry.id, entrance: "south" }, { createId: (prefix) => `${prefix}-building` });
  assert.equal(placed.accepted, true, placed.message);
  placed.nextState.buildings[placed.buildingId].status = "sealed";
  const after = { ...placed.nextState, turn: 15 };
  assert.ok(!generateOffer(after.cityId, 15, after).offeredCardIds.includes("ministry-of-magic"));
});

test("all special fallback cards remain eligible and exactly three are offered in a mature capped city", () => {
  const state = stateAt(20, "mature-city");
  state.gameplay.resources.arcaneEnergy = 0;
  state.gameplay.population.wizards = { current: 0, capacity: 0 };
  for (const id of ["ministry-of-magic", "diagon-alley-entrance", "owl-tower", "floo-fireplace-station", "concealment-statue", "moonlight-herb-plot", "royal-botanical-greenhouse", "arcane-energy-conservatory"]) {
    state.buildings[id] = { id, status: "sealed", specialStructure: { cardId: id }, program: { purpose: id === "royal-botanical-greenhouse" ? "greenhouse" : "commercial" } };
  }
  const offer = generateOffer(state.cityId, 20, state);
  assert.equal(offer.offeredCardIds.length, 3);
  assert.equal(new Set(offer.offeredCardIds).size, 3);
  assert.ok(offer.offeredCardIds.every((id) => cardEligibility(state, id, { turn: 20 }).eligible));
  assert.ok(offer.offeredCardIds.every((id) => id !== "ministry-grant"));
});

test("special card definitions are never ordinary and have stable family metadata", () => {
  const state = withOffer(5);
  for (const id of state.gameplay.cardState.offer.offeredCardIds) {
    const card = state.gameplay.cardState.offer.eligibilityAudit.find((entry) => entry.cardId === id);
    assert.equal(card.eligible, true);
  }
  assert.ok(state.gameplay.cardState.offer.eligibilityAudit.every((entry) => Array.isArray(entry.reasons)));
  assert.equal(CARD_TYPES.special_structure, "special_structure");
});

test("ordinary BUILDING discount is a one-use system entitlement and never applies to special structures", () => {
  let state = withOffer(1);
  const offer = state.gameplay.cardState.offer;
  const selected = selectCard(state, state.cityId, { offerId: offer.offerId, selectedCardId: "ordinary-building-discount" });
  assert.equal(selected.accepted, true);
  state = selected.nextState;
  assert.equal(activeConstructionDiscountRate(state), 0.2);
  const proposal = {
    actor: "agent:test",
    site: { lotId: "cell-0-0", footprint: "1x1", entrance: "south" },
    program: { archetype: "starter_residence", purpose: "residential", name: "Test Cottage", attributes: {} },
    gameplayBuilding: { units: [{ purpose: "residential", area: 1, magicRatio: 0 }] },
    design: { districtStyle: "willow_magic", patterns: [], prompt: "A compact cottage." }
  };
  const baseline = previewConstruction(state, proposal, { constructionDiscountRate: 0 });
  const discounted = previewConstruction(state, proposal, { constructionDiscountRate: activeConstructionDiscountRate(state) });
  assert.equal(discounted.cost.coins, Math.round(baseline.cost.coins * 0.8));
  const built = executeCityCommand(state, { type: "construct_building", proposal }, { now: () => "2026-08-27T00:00:00.000Z", createId: (prefix) => `${prefix}-discount` , constructionDiscountRate: activeConstructionDiscountRate(state) });
  assert.equal(built.accepted, true, built.message);
  assert.equal(built.state.gameplay.cardState.constructionDiscount.remainingUses, 0);
});
