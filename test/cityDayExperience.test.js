import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chooseCardOrientation, phaseLightTarget, PHASE_LABELS, createCityDayExperience } from "../src/ui/cityDayExperience.js";
import { createCityDayController } from "../src/ui/cityDayController.js";

const OFFER = {
  offer_id: "offer-1",
  turn: 0,
  cards: [
    { card_id: "ministry-grant", type: "resource", title: "Ministry Grant", description: "x" },
    { card_id: "statute-of-secrecy-reinforcement", type: "policy", title: "Statute", description: "x", duration: { type: "turns", turns: 3 } },
    { card_id: "owl-tower", type: "special_structure", title: "Owl Tower", description: "x" }
  ]
};

test("portrait and narrow screens stack the three cards vertically", () => {
  assert.equal(chooseCardOrientation({ width: 360, height: 720 }), "portrait");
  assert.equal(chooseCardOrientation({ width: 640, height: 900 }), "portrait");
  assert.equal(chooseCardOrientation({ width: 0, height: 0 }), "portrait");
});

test("landscape and wide screens lay the three cards horizontally", () => {
  assert.equal(chooseCardOrientation({ width: 1280, height: 720 }), "landscape");
  assert.equal(chooseCardOrientation({ width: 1024, height: 600 }), "landscape");
});

test("phase light targets stay within the sun axis and are deterministic", () => {
  for (const phase of ["dawn", "early_morning", "morning", "day", "night"]) {
    const target = phaseLightTarget(phase);
    assert.ok(target >= 0 && target <= 1, `${phase} target ${target} is on the 0..1 sun axis`);
  }
  assert.ok(phaseLightTarget("night") > phaseLightTarget("day"));
  assert.ok(phaseLightTarget("day") > phaseLightTarget("morning"));
  assert.ok(phaseLightTarget("morning") > phaseLightTarget("dawn"));
});

test("unknown phases fall back to the stable morning light", () => {
  assert.equal(phaseLightTarget("sunset-unknown"), phaseLightTarget("morning"));
  assert.equal(phaseLightTarget(null), phaseLightTarget("morning"));
});

test("every presentation phase has a Chinese player-facing label", () => {
  for (const phase of ["dawn", "early_morning", "morning", "day", "night"]) {
    assert.ok(PHASE_LABELS[phase]?.length > 0, `${phase} has a label`);
  }
});

// ---- Full-screen layer lifecycle (root-cause regression) --------------------
//
// The real-device "cards visible but completely unclickable" bug was caused by
// the empty full-screen `.city-day-placement` layer being created without
// `hidden`. Once the card modal opened it became hit-testable and, sharing
// z-index with `.city-day-cards` while appearing later in the DOM, sat above
// the cards and swallowed every tap. These tests lock in the invariant that the
// three full-screen layers start hidden and are mutually exclusive: at most one
// is ever visible, and no empty layer can participate in painting or hit-test.

function visibleLayerCount(experience) {
  return ["newspaper", "cards", "placement"].filter((name) => !experience.layers[name].hidden).length;
}

test("createCityDayExperience starts every full-screen layer hidden", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    assert.equal(experience.layers.newspaper.hidden, true);
    assert.equal(experience.layers.cards.hidden, true);
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(visibleLayerCount(experience), 0);
    assert.equal(experience.root.hidden, true);
  });
});

test("presentCards shows only the cards layer", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentCards({ cards: OFFER.cards }, () => {});
    assert.equal(experience.layers.cards.hidden, false);
    assert.equal(experience.layers.newspaper.hidden, true);
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(experience.root.hidden, false);
    assert.equal(visibleLayerCount(experience), 1);
  });
});

test("presentReport shows only the newspaper layer", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentReport({ masthead: { title: "Owl Daily", subtitle: "Owl Daily" }, edition: "Day 1", headline: "H", lead: "L", articles: [], briefs: [] }, { ready: true });
    assert.equal(experience.layers.newspaper.hidden, false);
    assert.equal(experience.layers.cards.hidden, true);
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(experience.root.hidden, false);
    assert.equal(visibleLayerCount(experience), 1);
    assert.equal(experience.layers.newspaper.querySelector(".city-day-paper-action-box"), null, "an empty action box must not render as a blank rule");
    assert.equal(experience.layers.newspaper.querySelector(".city-day-paper-tomorrow"), null, "an empty tomorrow section must not render");
  });
});

test("Owl Daily renders subheadline, article dek, action box, and tomorrow watch", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentReport({
      masthead: { title: "猫头鹰日报", subtitle: "Owl Daily" },
      edition: "第 5 日",
      headline: "月光温室照亮东区",
      subheadline: "秘法产量上涨，隐蔽压力也随之而来",
      lead: "城市进入新的魔法经济阶段。",
      articles: [{ id: "a1", headline: "温室开门", dek: "六点秘法能量进入账本。", body: "规划署提醒邻里补足隐蔽。", category: "economy", importance: "front_page" }],
      briefs: [],
      actionBox: [{ id: "act1", incidentRef: "fact-incident-1", factRefs: [], reason: "派遣掩护专员处理目击事件。" }],
      tomorrowWatch: [{ id: "watch1", text: "观察公共服务覆盖后的巫师迁入。", factRefs: [] }]
    }, { ready: true });
    assert.equal(experience.layers.newspaper.querySelector(".city-day-paper-subheadline").textContent, "秘法产量上涨，隐蔽压力也随之而来");
    assert.equal(experience.layers.newspaper.querySelector(".city-day-paper-dek").textContent, "六点秘法能量进入账本。");
    assert.match(experience.layers.newspaper.querySelector(".city-day-paper-action-box").children[1].textContent, /掩护专员/);
    assert.match(experience.layers.newspaper.querySelector(".city-day-paper-tomorrow").children[1].textContent, /巫师迁入/);
  });
});

test("presentPlacementChoice keeps using the cards layer and keeps the placement layer hidden", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementChoice({ card_id: "owl-tower", title: "Owl Tower" }, () => {});
    assert.equal(experience.layers.cards.hidden, false);
    assert.equal(experience.layers.newspaper.hidden, true);
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(visibleLayerCount(experience), 1);
  });
});

test("placement mode choice immediately shows progress and suppresses duplicate submissions", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    let calls = 0;
    experience.presentPlacementChoice({ card_id: "ministry-of-magic", title: "Ministry of Magic" }, async () => {
      calls += 1;
      return new Promise(() => {});
    });
    const self = collectButtons(experience.layers.cards).find((button) => button.textContent === "自己放置");
    const delegate = collectButtons(experience.layers.cards).find((button) => button.textContent === "交给 Agent");
    self.dispatchEvent({ type: "click" });
    delegate.dispatchEvent({ type: "click" });
    assert.equal(calls, 1, "a slow selection cannot be submitted twice");
    assert.equal(self.disabled, true);
    assert.equal(delegate.disabled, true);
    assert.match(experience.layers.cards.querySelector(".city-day-placement-progress").textContent, /正在确认/);
  });
});

test("presentPlacementMode shows only the placement layer", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    assert.equal(experience.layers.placement.hidden, false);
    assert.equal(experience.layers.cards.hidden, true);
    assert.equal(experience.layers.newspaper.hidden, true);
    assert.equal(experience.root.hidden, false);
    assert.equal(visibleLayerCount(experience), 1);
  });
});

test("presenting a new layer hides the previously visible one", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentCards({ cards: OFFER.cards }, () => {});
    experience.presentPlacementChoice({ card_id: "owl-tower", title: "Owl Tower" }, () => {});
    assert.equal(experience.layers.cards.hidden, false, "the placement choice reuses the cards layer");
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(visibleLayerCount(experience), 1);

    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    assert.equal(experience.layers.placement.hidden, false);
    assert.equal(experience.layers.cards.hidden, true, "entering placement hides the cards layer");
    assert.equal(experience.layers.newspaper.hidden, true);
    assert.equal(visibleLayerCount(experience), 1);

    experience.presentReport({ masthead: { title: "Owl Daily", subtitle: "Owl Daily" }, edition: "Day 1", headline: "H", lead: "L", articles: [], briefs: [] }, { ready: true });
    assert.equal(experience.layers.newspaper.hidden, false);
    assert.equal(experience.layers.placement.hidden, true, "presenting the report hides the placement layer");
    assert.equal(experience.layers.cards.hidden, true);
    assert.equal(visibleLayerCount(experience), 1);
  });
});

test("every close path returns its full-screen layer to hidden", async () => {
  await withFakeDom(async ({ timers }) => {
    const experience = createCityDayExperience({});

    experience.presentCards({ cards: OFFER.cards }, () => {});
    experience.closeCards();
    assert.equal(experience.layers.cards.hidden, true);
    assert.equal(experience.root.hidden, true);

    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    experience.closePlacement();
    assert.equal(experience.layers.placement.hidden, true);
    assert.equal(experience.root.hidden, true);

    experience.presentReport({ masthead: { title: "Owl Daily", subtitle: "Owl Daily" }, edition: "Day 1", headline: "H", lead: "L", articles: [], briefs: [] }, { ready: true });
    experience.dismissReport(0, 0);
    for (const timer of timers.splice(0)) timer();
    assert.equal(experience.layers.newspaper.hidden, true, "dismissing the report hides the newspaper layer");
    assert.equal(experience.root.hidden, true);
    assert.equal(visibleLayerCount(experience), 0);
  });
});

test("no stale placement overlay can intercept the card choice", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    let selected = null;
    experience.presentCards({ cards: [OFFER.cards[0]] }, (card) => {
      selected = card;
    });
    assert.equal(experience.layers.placement.hidden, true, "the empty placement layer is not visible while cards are shown");
    const cardButton = collectButtons(experience.layers.cards).find((button) => button.className.includes("city-day-card"));
    assert.ok(cardButton, "the offer renders a card button");
    cardButton.dispatchEvent({ type: "click" });
    assert.equal(selected?.card_id, "ministry-grant", "the tap reached the card button, not a hidden overlay");
  });
});

test("dispatching a click on a card button invokes selection", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    let selected = null;
    experience.presentCards({ cards: [OFFER.cards[0]] }, (card) => {
      selected = card;
    });
    const cardButton = collectButtons(experience.layers.cards).find((button) => button.className.includes("city-day-card"));
    assert.ok(cardButton, "the offer renders a card button");
    cardButton.dispatchEvent({ type: "click" });
    assert.equal(selected?.card_id, "ministry-grant", "the dispatched click reached the card's selection callback");
  });
});

test("tapping a special-structure card opens 自己放置 / 交给 Agent before any POST", async () => {  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    const calls = stubFetch({
      "/api/v1/cities/city-1/city-day": { body: { phase: "early_morning", settled: false, report: { ready: false, dismissed: false }, card: { choicePending: true, playerPlacementPending: false }, agent: { workStarted: false }, incident: { phaseActive: false } } },
      "/api/v1/cities/city-1/cards/current": { body: { city_id: "city-1", city_version: 7, turn: 0, offer: OFFER, choice: { status: "pending" } } },
      "/api/v1/cards": { body: { data: OFFER.cards } }
    });
    const controller = createCityDayController({
      experience,
      api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
      setLight: () => {},
      onPlayerTurnComplete: () => {}
    });
    await controller.sync();
    const specialButton = collectButtons(experience.layers.cards).find((button) => button.className.includes("city-day-card-special_structure"));
    assert.ok(specialButton, "the special-structure card is rendered");
    assert.equal(experience.layers.placement.hidden, true, "the placement overlay stays hidden while the card choice is open");
    specialButton.dispatchEvent({ type: "click" });
    const labels = collectButtons(experience.layers.cards).map((button) => button.textContent);
    assert.ok(labels.some((label) => label.includes("自己放置")), "the local 自己放置 choice opens");
    assert.ok(labels.some((label) => label.includes("交给 Agent")), "the local 交给 Agent choice opens");
    assert.equal(experience.layers.placement.hidden, true, "the placement overlay is still hidden during the 自己放置 / 交给 Agent choice");
    assert.equal(experience.layers.cards.hidden, false, "the choice reuses the visible cards layer");
    assert.equal(calls.some((call) => call.url.endsWith("/cards/select")), false, "no selection POST happens before the local choice");
  });
});

test("placement HUD shows status, cancel, rotate, confirm and no lot list", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    const status = experience.layers.placement.querySelector(".city-day-placement-status");
    assert.ok(status, "the placement HUD shows a status pill");
    assert.ok(status.querySelector("strong")?.textContent.includes("正在放置"), "the status names the placement session");
    assert.equal(experience.layers.placement.querySelector(".city-day-lot-list"), null, "no legal-lot button list is rendered");
    const buttons = collectButtons(experience.layers.placement);
    assert.equal(buttons.length, 3, "exactly cancel, rotate and confirm are offered");
    assert.ok(buttons.some((button) => button.className.includes("is-cancel")), "cancel control exists");
    assert.ok(buttons.some((button) => button.className.includes("is-rotate")), "rotate control exists");
    assert.ok(buttons.some((button) => button.className.includes("is-confirm")), "confirm control exists");
  });
});

test("placement confirm starts disabled until a legal target is driven in near view", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    const confirm = collectButtons(experience.layers.placement).find((button) => button.className.includes("is-confirm"));
    const rotate = collectButtons(experience.layers.placement).find((button) => button.className.includes("is-rotate"));
    const actions = experience.layers.placement.querySelector(".city-day-placement-actions");
    assert.equal(confirm.disabled, true, "confirm starts disabled with no target");
    assert.equal(actions.hidden, false, "near view shows the placement actions");

    experience.updatePlacementControls({ viewMode: "near", hasTarget: true, isLegal: false, reason: "目标被占用" });
    assert.equal(confirm.disabled, true, "an invalid target keeps confirm disabled");
    assert.equal(experience.layers.placement.querySelector(".city-day-placement-status").classList.has("is-invalid"), true, "invalid targets mark the status");

    experience.updatePlacementControls({ viewMode: "near", hasTarget: true, isLegal: true, reason: null });
    assert.equal(confirm.disabled, false, "a legal target enables confirm");
    assert.equal(experience.layers.placement.querySelector(".city-day-placement-status").classList.has("is-invalid"), false, "legal targets clear the invalid mark");
  });
});

test("far view hides rotate and confirm but keeps cancel and status", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    const actions = experience.layers.placement.querySelector(".city-day-placement-actions");
    const status = experience.layers.placement.querySelector(".city-day-placement-status");
    const cancel = collectButtons(experience.layers.placement).find((button) => button.className.includes("is-cancel"));
    assert.equal(actions.hidden, false, "near view shows rotate/confirm");

    experience.updatePlacementControls({ viewMode: "far", hasTarget: false, isLegal: false });
    assert.equal(actions.hidden, true, "far view hides rotate/confirm");
    assert.equal(cancel.hidden, false, "far view keeps the cancel control");
    assert.equal(status.hidden, false, "far view keeps the placement status");
    assert.ok(status.querySelector("strong")?.textContent.includes("正在放置"), "far view keeps the placement status text");
  });
});

test("confirm is disabled again when the target becomes illegal", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentPlacementMode({ card: { title: "Owl Tower" }, onRotate() {}, onConfirm() {}, onCancel() {} });
    const confirm = collectButtons(experience.layers.placement).find((button) => button.className.includes("is-confirm"));
    experience.updatePlacementControls({ viewMode: "near", hasTarget: true, isLegal: true });
    assert.equal(confirm.disabled, false);
    experience.updatePlacementControls({ viewMode: "near", hasTarget: true, isLegal: false, reason: "入口没有临街面" });
    assert.equal(confirm.disabled, true);
    assert.equal(experience.layers.placement.querySelector(".city-day-placement-status").classList.has("is-invalid"), true);
  });
});

test("phase chrome and strategy facts remain visible after choice layers close", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.applyPresentation({ phase: "morning", turn: 6 });
    experience.presentCards({ choice_kind: "ordinary", cards: OFFER.cards }, () => {});
    experience.closeCards();
    assert.equal(experience.root.hidden, false, "the decorative phase layer is not hidden with the cards");
    assert.equal(experience.layers.phase.hidden, false);
    experience.applyStrategyFacts({
      incidents: [{ id: "incident-1", summary: "A trace was observed" }],
      arcane_officer_recruitment: { candidates: [{ candidate_id: "candidate-1", identity: { name: "Vesper Lark" } }] }
    });
    assert.equal(experience.layers.strategy.hidden, false);
    assert.ok([...experience.layers.strategy.children].some((child) => /incident-1|A trace/.test(child.textContent)));
    assert.ok([...experience.layers.strategy.children].some((child) => /Vesper Lark/.test(child.textContent)));
  });
});

test("ordinary and special offers expose distinct headings and card facts without stale special state", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentCards({
      turn: 4,
      choice_kind: "ordinary",
      cards: [{ card_id: "building", type: "building", title: "Building Materials", description: "x", choice_kind: "ordinary", family: "ordinary_building" }, { card_id: "people", type: "people", title: "People", description: "x" }, { card_id: "resource", type: "resource", title: "Resource", description: "x" }]
    }, () => {});
    assert.equal(experience.layers.cards.dataset.choiceKind, "ordinary");
    assert.equal(experience.layers.cards.classList.has("is-special-choice"), false);
    assert.match(experience.layers.cards.children[0].children[0].textContent, /ORDINARY CHOICE/);
    assert.ok(collectButtons(experience.layers.cards).some((button) => button.querySelector(".city-day-card-kind")?.textContent.includes("BUILDING")));
    assert.ok(experience.layers.cards.querySelector(".city-day-card-facts"), "ordinary family fact is shown");

    experience.presentCards({
      turn: 5,
      choice_kind: "special",
      eligibility_audit: [{ cardId: "ministry-of-magic", eligible: true }],
      cards: [{ card_id: "ministry-of-magic", type: "special_structure", title: "Ministry", description: "x", choice_kind: "special", family: "special_building", unique: true, free_placement: true, structure: { footprint: "2x2" } }, { card_id: "other", type: "resource", title: "Reserve", description: "x" }, { card_id: "policy", type: "policy", title: "Policy", description: "x" }]
    }, () => {});
    assert.equal(experience.layers.cards.dataset.choiceKind, "special");
    assert.equal(experience.layers.cards.classList.has("is-special-choice"), true);
    assert.match(experience.layers.cards.children[0].children[0].textContent, /SPECIAL CHOICE.*5/);
    const specialCard = collectButtons(experience.layers.cards).find((button) => button.className.includes("city-day-card-special_structure"));
    const specialFacts = specialCard.querySelector(".city-day-card-facts");
    const factText = [...specialFacts.children].map((child) => child.textContent).join(" | ");
    assert.match(factText, /SPECIAL FAMILY/);
    assert.match(factText, /唯一资格/);
    assert.match(factText, /免费放置/);
    assert.match(factText, /2x2/);
    assert.match(factText, /自己放置 \/ 交给 Agent/);

    experience.presentCards({ turn: 6, choice_kind: "ordinary", cards: [{ card_id: "resource", type: "resource", title: "Resource", description: "x" }] }, () => {});
    assert.equal(experience.layers.cards.dataset.choiceKind, "ordinary");
    assert.equal(experience.layers.cards.classList.has("is-special-choice"), false, "special styling is cleared when returning to ordinary");
  });
});

test("population cards show the authoritative projected grant before selection", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    experience.presentCards({
      turn: 2,
      choice_kind: "ordinary",
      cards: [{
        card_id: "ordinary-people-migration",
        type: "people",
        title: "Supported Wizard Arrivals",
        description: "Wizard residents arrive within capacity.",
        choice_kind: "ordinary",
        family: "ordinary_people",
        effect_preview: { kind: "wizard_population", requested: 2, projected_grant: 0, current: 0, capacity: 0 }
      }]
    }, () => {});
    const card = collectButtons(experience.layers.cards).find((button) => button.className.includes("city-day-card"));
    const warning = card.querySelector(".is-warning");
    assert.match(warning.textContent, /预计迁入 0\/2 位巫师/);
    assert.match(warning.textContent, /巫师住房 0\/0/);
  });
});

test("controller and experience walk bootstrap through Turn 10 without duplicate card submissions", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    let turn = 0;
    let choicePending = false;
    let selectCount = 0;
    let specialChoiceCount = 0;
    const ordinaryCards = [
      { card_id: "ordinary-building-discount", type: "building", title: "Materials", description: "x", choice_kind: "ordinary", family: "ordinary_building" },
      { card_id: "ordinary-people-migration", type: "people", title: "People", description: "x", choice_kind: "ordinary", family: "ordinary_people" },
      { card_id: "ordinary-resource-grant", type: "resource", title: "Resource", description: "x", choice_kind: "ordinary", family: "ordinary_resource" }
    ];
    const specialCards = [
      { card_id: "ministry-of-magic", type: "special_structure", title: "Ministry of Magic", description: "x", choice_kind: "special", family: "special_building", unique: true, free_placement: true, structure: { footprint: "2x2" } },
      { card_id: "special-development-grant", type: "resource", title: "Special Grant", description: "x", choice_kind: "special", family: "large_resource" },
      { card_id: "special-secrecy-charter", type: "policy", title: "Secrecy", description: "x", choice_kind: "special", family: "multi_turn_modifier" }
    ];
    const calls = stubFetch({
      "/api/v1/cities/city-1/city-day": () => ({ body: { phase: choicePending ? "early_morning" : "morning", turn, settled: false, report: { ready: false, dismissed: false }, card: { choicePending, playerPlacementPending: false }, agent: { workStarted: false }, incident: { phaseActive: false } } }),
      "/api/v1/cities/city-1/cards/current": () => ({ body: { city_id: "city-1", city_version: turn + selectCount, turn, offer: { offer_id: `offer-${turn}`, turn, choice_kind: turn % 5 === 0 ? "special" : "ordinary", eligibility_audit: [], cards: turn % 5 === 0 ? specialCards : ordinaryCards }, choice: { status: choicePending ? "pending" : "selected" } } }),
      "/api/v1/cards": { body: { data: [...ordinaryCards, ...specialCards] } },
      "/api/v1/cities/city-1/cards/select": (init) => {
        const body = JSON.parse(String(init.body));
        selectCount += 1;
        if (turn % 5 === 0) {
          specialChoiceCount += 1;
          assert.equal(body.decision_mode, "delegate_to_agent");
        } else assert.equal(body.decision_mode, "immediate");
        choicePending = false;
        return { body: { status: "selected", selected_card_id: body.selected_card_id } };
      }
    });
    const controller = createCityDayController({
      experience,
      api: { baseUrl: "/api/v1", cityId: "city-1", token: "session" },
      setLight: () => {}
    });
    await controller.sync();
    assert.equal(calls.some((call) => call.url.endsWith("/cards/current")), false, "bootstrap Turn 0 has no card request");
    for (turn = 1; turn <= 10; turn += 1) {
      choicePending = true;
      await controller.sync();
      const isSpecial = turn % 5 === 0;
      assert.equal(experience.layers.cards.dataset.choiceKind, isSpecial ? "special" : "ordinary");
      const cards = collectButtons(experience.layers.cards);
      cards.find((button) => button.className.includes(isSpecial ? "city-day-card-special_structure" : "city-day-card-building")).dispatchEvent({ type: "click" });
      if (isSpecial) {
        const delegate = collectButtons(experience.layers.cards).find((button) => button.textContent.includes("交给 Agent"));
        assert.ok(delegate, `Turn ${turn} opens the placement decision`);
        delegate.dispatchEvent({ type: "click" });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(selectCount, 10, "each turn submits exactly one card selection");
    assert.equal(specialChoiceCount, 2, "Turn 5 and Turn 10 are Special Choice");
    assert.equal(calls.filter((call) => call.url.endsWith("/cards/select")).length, 10);
  });
});

test("desktop card CSS gives the horizontal offer enough width for readable facts", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /@media \(orientation: landscape\) and \(min-width: 700px\)/);
  assert.match(css, /\.city-day-cards-grid\s*\{[^}]*width:\s*min\(1080px,\s*100%\)/s);
  assert.match(css, /\.city-day-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /grid-template-areas:\s*"kind"\s*"title"\s*"description"\s*"effect"\s*"facts"/s);
});

// ---- Fake DOM harness ------------------------------------------------------

function createFakeDom() {
  const timers = [];

  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.listeners = {};
      this.dataset = {};
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.offsetWidth = 0;
      this._attributes = {};
      this._classes = new Set();
      this.style = { setProperty() {}, getPropertyValue: () => "" };
    }

    get className() {
      return [...this._classes].join(" ");
    }

    set className(value) {
      this._classes.clear();
      String(value ?? "").split(/\s+/).filter(Boolean).forEach((name) => this._classes.add(name));
    }

    get classList() {
      return {
        add: (...names) => names.forEach((name) => this._classes.add(name)),
        remove: (...names) => names.forEach((name) => this._classes.delete(name)),
        toggle: (name, force) => {
          const enabled = force === undefined ? !this._classes.has(name) : Boolean(force);
          if (enabled) this._classes.add(name);
          else this._classes.delete(name);
          return enabled;
        },
        has: (name) => this._classes.has(name)
      };
    }

    setAttribute(name, value) {
      this._attributes[name] = String(value);
    }

    getAttribute(name) {
      return this._attributes[name] ?? null;
    }

    append(...nodes) {
      for (const node of nodes) {
        if (node == null) continue;
        node.parentNode = this;
        this.children.push(node);
      }
    }

    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }

    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    }

    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== handler);
    }

    dispatchEvent(event) {
      event.target ??= this;
      let current = this;
      while (current) {
        for (const handler of current.listeners[event.type] ?? []) {
          handler.call(current, event);
        }
        current = current.parentNode;
      }
      return !event.defaultPrevented;
    }

    closest(selector) {
      let current = this;
      while (current) {
        if (fakeMatches(current, selector)) return current;
        current = current.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (fakeMatches(child, selector)) results.push(child);
          walk(child);
        }
      };
      walk(this);
      return results;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    setPointerCapture() {}
    releasePointerCapture() {}
  }

  return {
    document: {
      createElement: (tagName) => new FakeElement(tagName),
      createElementNS: (ns, tagName) => new FakeElement(tagName),
      body: new FakeElement("body")
    },
    window: {
      setTimeout: (handler) => {
        timers.push(handler);
        return timers.length;
      },
      addEventListener() {},
      removeEventListener() {}
    },
    timers
  };
}

function fakeMatches(element, selector) {
  if (selector === "*") return true;
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return element.tagName === selector.toUpperCase();
  if (selector.startsWith(".")) return element.classList.has(selector.slice(1));
  if (selector.startsWith("#")) return element.getAttribute("id") === selector.slice(1);
  return false;
}

function collectButtons(root) {
  const buttons = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.tagName === "BUTTON") buttons.push(child);
      walk(child);
    }
  };
  walk(root);
  return buttons;
}

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const responder = routes[url];
    const { status = 200, body = {} } = typeof responder === "function" ? responder(init) : (responder ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
  return calls;
}

async function withFakeDom(run) {
  const { document, window, timers } = createFakeDom();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    await run({ document, window, timers });
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}
