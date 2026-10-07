import test from "node:test";
import assert from "node:assert/strict";
import { upgradeMolewayNames } from "../src/gameplay/moleway-compatibility.js";
import { getCard } from "../src/gameplay/card-catalog.js";
import { createRepository } from "../apps/server/repository.js";

const cardId = "floo-fireplace-station";
function legacyState() {
  return { version: 9, buildings: Object.fromEntries(['construction', 'completed', 'sealed'].map(status =>
    [status, { id: status, status, program: { name: 'Floo Fireplace Station', purpose: 'commercial' },
      site: { lotId: 'cell-1-1', entrance: 'east', footprint: '1x1' }, specialStructure: { cardId } }])),
    gameplay: { cardState: { choice: { selectedCardId: cardId }, pendingPlacement: { cardId, placementId: 'legacy' } } } };
}
test('legacy Moleway buildings rename without changing placement, status, or chosen entitlement', () => {
  const old = legacyState(), next = upgradeMolewayNames(old);
  for (const status of ['construction', 'completed', 'sealed']) {
    assert.equal(next.buildings[status].program.name, '鼹鼠地道');
    assert.equal(next.buildings[status].status, status);
    assert.equal(next.buildings[status].site, old.buildings[status].site);
    assert.equal(old.buildings[status].program.name, 'Floo Fireplace Station');
  }
  assert.equal(next.gameplay, old.gameplay);
  assert.equal(next.version, old.version);
  assert.equal(upgradeMolewayNames(next), next);
  const card = getCard(old.gameplay.cardState.choice.selectedCardId);
  assert.equal(card.title, '鼹鼠地道');
  assert.equal(card.structure.name, '鼹鼠地道');
  assert.equal(card.unique, false);
});
test('persisted city scheduler reads expose the upgraded label immediately', async () => {
  const old = legacyState();
  const repository = createRepository({ query: async () => ({ rowCount: 1, rows: [{ state_jsonb: old }] }) }, {});
  const { state } = await repository.getCityForScheduler('legacy-city');
  assert.equal(state.buildings.completed.program.name, '鼹鼠地道');
  assert.equal(state.gameplay.cardState.pendingPlacement.placementId, 'legacy');
});
