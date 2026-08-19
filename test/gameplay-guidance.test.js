import assert from "node:assert/strict";
import test from "node:test";
import { PLAYBOOK_DISCOVERY_GUIDANCE, playbookGuidance } from "../src/gameplay/guidance.js";

const base = () => ({
  gameplay: {
    cardState: {
      offer: null,
      choice: { status: "selected", offerId: "offer-1", selectedCardId: "card-1", decisionMode: "immediate", cardEffects: {} },
      activePolicies: [],
      pendingPlacement: null,
      placements: {}
    },
    incidents: {},
    pendingAssignments: []
  }
});

test("base guidance always discloses the playbook and stays minimal", () => {
  const guidance = playbookGuidance(base());
  assert.ok(Array.isArray(guidance) && guidance.length > 0);
  assert.ok(guidance.some((hint) => /playbook/i.test(hint)));
  assert.equal(guidance.length, 1, "with no active context only the playbook discovery anchor is returned");
});

test("a pending card choice adds a player-ownership hint", () => {
  const state = base();
  state.gameplay.cardState.choice.status = "pending";
  const guidance = playbookGuidance(state);
  assert.ok(guidance.some((hint) => /still owes today's card choice/i.test(hint)));
  assert.ok(guidance.some((hint) => /never choose on their behalf/i.test(hint)));
});

test("a player-owned pending placement warns the Agent not to pre-empt the player", () => {
  const state = base();
  state.gameplay.cardState.placements = {
    p1: { cardId: "card-special", placementId: "placement-p1", mode: "player_place", status: "pending" }
  };
  const guidance = playbookGuidance(state);
  assert.ok(guidance.some((hint) => /player-owned special structure placement is pending/i.test(hint)));
  assert.ok(guidance.some((hint) => /the player must place it/i.test(hint)));
});

test("a delegated placement discloses the mandate and its placement_id", () => {
  const state = base();
  state.gameplay.cardState.placements = {
    p2: { cardId: "card-owl-tower", placementId: "placement-p2", mode: "delegate_to_agent", status: "deferred" }
  };
  const guidance = playbookGuidance(state);
  const mandate = guidance.find((hint) => /delegated/.test(hint));
  assert.ok(mandate, "the delegated mandate is surfaced");
  assert.match(mandate, /card-owl-tower/);
  assert.match(mandate, /placement-p2/);
});

test("open incidents disclose the dispatch / unaddressed trade-off", () => {
  const state = base();
  state.gameplay.incidents = {
    "incident-1": { id: "incident-1", buildingId: "b1", type: "investigation", status: "open" }
  };
  const guidance = playbookGuidance(state);
  assert.ok(guidance.some((hint) => /Open incidents remain/i.test(hint)));
});

test("a turn locked by its cooldown gate discloses the wait-and-stop instruction", () => {
  const state = base();
  const guidance = playbookGuidance(state, { turnLocked: "2026-08-01T00:01:00.000Z" });
  assert.ok(guidance.some((hint) => /nextTurnUnlockAt \(2026-08-01T00:01:00\.000Z\) gates resolution/i.test(hint)));
  assert.ok(guidance.some((hint) => /Stop low-value new work and wait/i.test(hint)));
});

test("contextual hints stay within the 1-3 low-token budget, highest-priority first", () => {
  const state = base();
  state.gameplay.cardState.choice.status = "pending";
  state.gameplay.incidents = { "incident-1": { id: "incident-1", buildingId: "b1", type: "concealment", status: "open" } };
  state.gameplay.cardState.placements = {
    p1: { cardId: "card-special", placementId: "placement-p1", mode: "delegate_to_agent", status: "deferred" }
  };
  const guidance = playbookGuidance(state);
  assert.ok(guidance.length <= 3, "the total stays within the 1-3 spec");
  assert.ok(guidance.every((hint) => hint.length < 400), "each hint stays short and low-token");
  assert.equal(guidance[0], PLAYBOOK_DISCOVERY_GUIDANCE, "the playbook discovery anchor always comes first");
  assert.ok(guidance[1].includes("delegated"), "delegated placement (agent-mandated work) outranks card choice");
});

test("many competing contexts never exceed three hints", () => {
  const state = base();
  state.gameplay.cardState.choice.status = "pending";
  state.gameplay.incidents = { "incident-1": { id: "incident-1", buildingId: "b1", type: "concealment", status: "open" } };
  state.gameplay.cardState.placements = {
    p1: { cardId: "card-special", placementId: "placement-p1", mode: "delegate_to_agent", status: "deferred" },
    p2: { cardId: "card-other", placementId: "placement-p2", mode: "player_place", status: "pending" }
  };
  const guidance = playbookGuidance(state, { turnLocked: "2026-08-01T00:01:00.000Z" });
  assert.equal(guidance.length, 3, "discovery anchor + exactly two highest-priority context hints");
  assert.ok(guidance[1].includes("cannot be resolved yet"), "the locked gate is the most critical context");
});
