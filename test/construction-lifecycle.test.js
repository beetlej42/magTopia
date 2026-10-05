import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createCityState } from "../src/city/state.js";
import { createEngineContext, executeCityCommand } from "../src/city/engine.js";
import { resolveTurn, previewCitySystems } from "../src/gameplay/simulation.js";
import { openNextTurn } from "../src/gameplay/turn.js";
import { completeDueConstruction, constructionSchedule } from "../src/gameplay/construction.js";
import { specialStructureConcealment, specialStructureExposureModifier } from "../src/gameplay/cards.js";
import { deriveBootstrapProgress } from "../src/gameplay/bootstrap.js";
import { createConstructionSite } from "../src/generators/constructionSite.js";
import { createMagicLondonStarterDistrict } from "../src/generators/magicLondonStarterDistrict.js";
import { disposeBuildingObject } from "../src/generators/buildingDesignObject.js";

const now = "2026-10-05T00:00:00.000Z";
function fixture() {
  const cells = [];
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    cells.push({ id: `cell-${column}-${row}`, column, row, center: { x: column * 4, z: -row * 4 }, buildable: true });
  }
  const grid = { columns: 8, rows: 8, cellWorldSize: 4, cells };
  let id = 0;
  return { grid, state: createCityState({ mapId: "construction", grid }, { resources: { coins: 5000 } }),
    context: createEngineContext({ now: () => now, createId: prefix => `${prefix}-${++id}` }) };
}
function proposal(purpose, column = 2) {
  return { actor: "agent:test", site: { lotId: `cell-${column}-3`, footprint: "1x1", entrance: "south" },
    program: { name: purpose, purpose, archetype: "canonical" },
    gameplayBuilding: { units: [{ purpose, area: 1, magicRatio: 0.5 }] }, design: { prompt: "A city building." } };
}
function settle(state) {
  const result = resolveTurn(state, { expectedTurn: state.turn }, { now: () => now, seed: "construction", options: { turnCooldownMs: 1 } });
  assert.equal(result.error, null);
  return result;
}
function open(state) { return openNextTurn(state, "2026-10-05T00:01:00.000Z", { turnCooldownMs: 1 }); }

test("new sites occupy and charge once, skip same-turn effects, and automatically commission next turn", () => {
  let { state, context } = fixture();
  for (const [i, purpose] of ["residential", "commercial", "public_service"].entries()) {
    const built = executeCityCommand(state, { type: "construct_building", proposal: proposal(purpose, i + 2) }, context);
    assert.equal(built.accepted, true);
    state = built.state;
    assert.equal(built.building.status, "construction");
    assert.equal(state.cells[built.building.site.lotId].occupancy, built.building.id);
    assert.deepEqual(built.building.construction, constructionSchedule(0));
  }
  assert.ok(state.resources.coins < 5000);
  const balance = state.resources.coins;
  const ids = Object.keys(state.buildings).sort();
  const planning = deriveBootstrapProgress(state);
  assert.equal(planning.milestones.housing, true);
  assert.equal(planning.milestones.income, true);
  assert.deepEqual(planning.buildingsCompleted, []);
  const preview = previewCitySystems(state);
  assert.equal(preview.construction.under_construction.length, 3);
  assert.equal(preview.economy.gross_next_income.coins, 0);
  assert.ok(preview.risk.buildings.every(b => b.exposure_pressure === 0));
  const original = structuredClone(state);
  assert.equal(completeDueConstruction(state, now), state);
  const first = settle(state);
  assert.deepEqual(state, original, "settlement cannot mutate the source state");
  assert.deepEqual(first.facts.buildingsStarted, ids);
  assert.deepEqual(first.facts.buildingsCompleted, []);
  assert.deepEqual(first.facts.resourceDelta, { coins: 0, arcaneEnergy: 0 });
  assert.equal(first.nextState.gameplay.population.muggles.capacity, 0);
  assert.deepEqual(first.facts.exposureChanges, {});
  assert.deepEqual(first.facts.incidents, []);
  assert.equal(Object.values(first.nextState.buildings)[0].status, "construction", "settlement alone does not commission buildings");
  assert.equal(openNextTurn(first.nextState, "2026-10-04T00:00:00.000Z"), null);
  const opened = open(first.nextState);
  assert.equal(opened.resources.coins, balance, "opening a turn never earns or spends coins");
  assert.ok(Object.values(opened.buildings).every(b => b.status === "completed"));
  assert.equal(opened.events.filter(e => e.type === "building_completed").length, 3);
  assert.equal(openNextTurn(opened, now), null, "reopening cannot duplicate completions");
  assert.equal(completeDueConstruction(opened, now), opened);
  const second = settle(opened);
  assert.deepEqual(second.facts.buildingsStarted, []);
  assert.deepEqual(second.facts.buildingsCompleted, ids);
  assert.ok(second.facts.resourceDelta.coins > 0);
  assert.ok(second.nextState.gameplay.population.muggles.capacity > 0);
  assert.deepEqual(first.facts.buildingsCompleted, [], "opening cannot rewrite the previous report");
});

test("asset readiness respects the reservation start turn and charges no second cost", () => {
  const { state, context } = fixture();
  const reserved = executeCityCommand(state, { type: "reserve_construction", proposal: proposal("commercial"), reservationId: "reservation" }, context);
  assert.equal(deriveBootstrapProgress(reserved.state).milestones.income, true);
  assert.deepEqual(deriveBootstrapProgress(reserved.state).buildingsCompleted, []);
  const finish = s => executeCityCommand(s, { type: "complete_reserved_construction", reservationId: "reservation", assetId: "ready-asset" }, context);
  const early = finish(reserved.state);
  assert.equal(early.building.status, "construction");
  assert.equal(early.state.resources.coins, reserved.state.resources.coins);
  const settled = settle(reserved.state);
  const between = finish(settled.nextState);
  assert.equal(between.building.status, "construction", "asset ready between turns waits for opening");
  assert.equal(open(between.state).buildings[between.building.id].status, "completed");
  const late = finish(open(settled.nextState));
  assert.equal(late.building.status, "completed", "late assets do not restart the one-turn clock");
  assert.equal(late.building.construction.readyAtTurn, 1);
  assert.equal(late.state.resources.coins, reserved.state.resources.coins);
  assert.equal(late.state.events.filter(e => e.type === "building_completed").length, 1);
  assert.equal(finish(late.state).code, "RESERVATION_NOT_FOUND");
});

test("demolished construction never reappears, and completed legacy buildings stay completed", () => {
  const { state, context } = fixture();
  const built = executeCityCommand(state, { type: "construct_building", proposal: proposal("residential") }, context);
  const demolition = executeCityCommand(built.state, { type: "demolish", target: { kind: "building", buildingId: built.building.id } }, context);
  assert.equal(demolition.accepted, true);
  const opened = open(settle(demolition.state).nextState);
  assert.equal(opened.buildings[built.building.id], undefined);
  assert.equal(opened.events.some(e => e.type === "building_completed"), false);
  const legacy = { ...state, turn: 4, buildings: { legacy: { id: "legacy", status: "completed" } } };
  assert.equal(completeDueConstruction(legacy, now), legacy);
});

test("special and neighborhood effects exclude construction until commissioning", () => {
  const { state } = fixture();
  const target = { id: "home", footprintCells: ["cell-2-3"], program: { attributes: { magicLevel: 1 } } };
  state.buildings.statue = { id: "statue", footprintCells: ["cell-3-3"], status: "construction", construction: constructionSchedule(0),
    specialStructure: { cardId: "concealment-statue", effect: { concealmentBonus: 3, concealmentRadius: 3, exposureModifier: 2 } } };
  assert.equal(specialStructureConcealment(state, target), 0);
  assert.equal(specialStructureExposureModifier(state), 0);
  const opened = completeDueConstruction({ ...state, turn: 1 }, now);
  assert.equal(specialStructureConcealment(opened, target), 3);
  assert.equal(specialStructureExposureModifier(opened), 2);
});

test("construction geometry fits occupied cells, shares outer boundaries, and keeps gardens low", () => {
  for (const entrance of ["north", "east", "south", "west"]) {
    const object = createConstructionSite({ entrance });
    const bounds = new THREE.Box3().setFromObject(object);
    assert.ok(bounds.min.x >= -2 && bounds.max.x <= 2);
    assert.ok(bounds.min.z >= -2 && bounds.max.z <= 2);
    assert.ok(bounds.max.y < 2.1);
    assert.equal(object.userData.construction.boundaryEdges, 4);
    assert.ok(object.children.length <= 12, "materials are merged to keep draw calls low");
    disposeBuildingObject(object);
  }
  const large = createConstructionSite({ cellOffsets: [{ x:-2,z:-2 },{ x:2,z:-2 },{ x:-2,z:2 },{ x:2,z:2 }] });
  assert.equal(large.userData.construction.boundaryEdges, 8, "no interior fences on a 2x2 site");
  disposeBuildingObject(large);
  const garden = createConstructionSite({ openSpace: true });
  assert.ok(new THREE.Box3().setFromObject(garden).max.y <= 1.4);
  disposeBuildingObject(garden);
});

test("city renderer shows worksites before final assets and includes awaiting-asset reservations", () => {
  const { state, context, grid } = fixture();
  const built = executeCityCommand(state, { type: "construct_building", proposal: proposal("commercial") }, context);
  const reserved = executeCityCommand(built.state, { type: "reserve_construction", proposal: proposal("residential", 4), reservationId: "waiting" }, context);
  const root = createMagicLondonStarterDistrict({ grid, cityState: reserved.state, sampleGroundHeight: () => 0, assetRegistry: [] });
  assert.equal(root.userData.contract.placements.length, 2);
  assert.ok(root.userData.contract.placements.every(p => p.representation === "construction-site"));
  assert.ok(root.userData.contract.placements.some(p => p.awaitingAsset));
  assert.deepEqual(root.userData.contract.skipped, []);
  disposeBuildingObject(root);
});
