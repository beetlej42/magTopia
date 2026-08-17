import assert from "node:assert/strict";
import test from "node:test";
import {
  agentWorkStartedForTurn,
  cardChoicePending,
  completedReportTurn,
  deriveCityDayPresentation,
  incidentPhaseActive,
  playerPlacementPending
} from "../src/gameplay/city-day.js";

function baseState(overrides = {}) {
  return {
    turn: 0,
    version: 0,
    events: [],
    gameplay: {
      turnStatus: "open",
      turnOpenedAt: "2026-01-01T00:00:00.000Z",
      lastTurnFacts: null,
      cardState: {
        offer: null,
        choice: { status: "pending", offerId: null, selectedCardId: null, decisionMode: null, cardEffects: {} },
        activePolicies: [],
        pendingPlacement: null,
        placements: {}
      },
      incidents: {},
      pendingAssignments: []
    },
    ...overrides
  };
}

function withSettlement(state, turn = 1) {
  return {
    ...state,
    gameplay: {
      ...state.gameplay,
      turnStatus: "resolved",
      lastTurnFacts: { turn, wallClock: { resolvedAt: "2026-01-02T00:00:00.000Z" } }
    }
  };
}

function withSelectedChoice(state, { cardId = "ministry-grant", mode = "immediate" } = {}) {
  return {
    ...state,
    gameplay: {
      ...state.gameplay,
      cardState: {
        ...state.gameplay.cardState,
        choice: { status: "selected", offerId: "offer-1", selectedCardId: cardId, decisionMode: mode, cardEffects: {} }
      }
    }
  };
}

test("a fresh open turn with no report resolves to early_morning (card choice)", () => {
  const presentation = deriveCityDayPresentation(baseState(), { reportReady: false, reportDismissed: false });
  assert.equal(presentation.phase, "early_morning");
  assert.equal(presentation.settled, false);
  assert.equal(presentation.card.choicePending, true);
});

test("a settled turn is dawn regardless of report publication lag", () => {
  const state = withSettlement(baseState());
  const beforeReport = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.equal(beforeReport.phase, "dawn", "settlement alone is dawn, even before the Agent's report exists");
  assert.equal(beforeReport.report.ready, false);
  const withReport = deriveCityDayPresentation(state, { reportReady: true, reportDismissed: false });
  assert.equal(withReport.phase, "dawn");
  assert.equal(withReport.report.ready, true);
});

test("an undismissed ready report is presented before the card choice", () => {
  const state = {
    ...baseState(),
    turn: 1,
    gameplay: {
      ...baseState().gameplay,
      lastTurnFacts: { turn: 1, wallClock: { resolvedAt: "2026-01-02T00:00:00.000Z" } }
    }
  };
  const presentation = deriveCityDayPresentation(state, { reportReady: true, reportDismissed: false });
  assert.equal(presentation.phase, "dawn", "the new day's report is presented before the card choice");
});

test("a dismissed report lets the pending card choice take over", () => {
  const state = baseState();
  const presentation = deriveCityDayPresentation(state, { reportReady: true, reportDismissed: true });
  assert.equal(presentation.phase, "early_morning");
});

test("a completed choice with no Agent work waits in morning", () => {
  const state = withSelectedChoice(baseState());
  const presentation = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.equal(presentation.phase, "morning");
  assert.equal(presentation.agent.workStarted, false);
});

test("first accepted Agent work moves the presentation to day", () => {
  const state = withSelectedChoice(baseState());
  state.events.push({
    id: "e1", turn: 0, cityVersion: 1, at: "2026-01-01T01:00:00.000Z",
    type: "building_constructed", actor: "agent:credential-1"
  });
  const presentation = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.equal(presentation.agent.workStarted, true);
  assert.equal(presentation.phase, "day");
});

test("an event before the current turn opened does not count as this turn's work", () => {
  const state = withSelectedChoice(baseState());
  state.events.push({
    id: "e-old", turn: 0, cityVersion: 1, at: "2025-12-31T00:00:00.000Z",
    type: "building_constructed", actor: "agent:credential-1"
  });
  const presentation = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.equal(presentation.agent.workStarted, false, "pre-turn events are not current-turn work");
  assert.equal(presentation.phase, "morning");
});

test("a player-facing swipe or render cannot move the phase by itself", () => {
  const state = withSelectedChoice(baseState());
  const a = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  const b = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.deepEqual(a, b, "identical authoritative state yields an identical projection");
});

test("the incident/strategy phase drives night ahead of card state", () => {
  const state = { ...baseState(), gameplay: { ...baseState().gameplay, turnStatus: "strategy" } };
  const presentation = deriveCityDayPresentation(state, { reportReady: false, reportDismissed: false });
  assert.equal(presentation.incident.phaseActive, true);
  assert.equal(presentation.phase, "night");
});

test("helper predicates are conservative and authority-only", () => {
  const open = baseState();
  assert.equal(cardChoicePending(open), true);
  assert.equal(completedReportTurn(open), null);
  assert.equal(incidentPhaseActive(open), false);
  assert.equal(playerPlacementPending(open), false);

  const withPendingPlacement = {
    gameplay: {
      cardState: { choice: { status: "selected" }, placements: { p1: { mode: "player_place", status: "pending" } } }
    }
  };
  assert.equal(playerPlacementPending(withPendingPlacement), true);

  const settled = withSettlement(baseState());
  assert.equal(completedReportTurn(settled), 1);
  assert.equal(agentWorkStartedForTurn(settled, { turnOpenedAt: "2026-01-01T00:00:00.000Z" }), false);
});
