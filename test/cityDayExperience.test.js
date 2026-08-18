import assert from "node:assert/strict";
import test from "node:test";
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

// ---- DOM/event-boundary regressions ----------------------------------------
//
// The node --test environment has no browser; a minimal fake DOM drives the
// real experience/controller modules and exercises the explicit
// interactive-vs-pass-through contract with dispatched click events instead of
// relying on browser-specific parent/child pointer inheritance.

test("opening the three-card choice marks the experience interactive", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    assert.equal(experience.root.classList.has("is-interactive"), false, "freshly created overlay starts pass-through");
    experience.presentCards({ cards: OFFER.cards }, () => {});
    assert.equal(experience.root.classList.has("is-interactive"), true, "card choice opens interactive mode");
    assert.equal(experience.root.dataset.interactive, "true");
    assert.equal(experience.root.hidden, false);
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

test("tapping a special-structure card opens 自己放置 / 交给 Agent before any POST", async () => {
  await withFakeDom(async () => {
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
    specialButton.dispatchEvent({ type: "click" });
    const labels = collectButtons(experience.layers.cards).map((button) => button.textContent);
    assert.ok(labels.some((label) => label.includes("自己放置")), "the local 自己放置 choice opens");
    assert.ok(labels.some((label) => label.includes("交给 Agent")), "the local 交给 Agent choice opens");
    assert.equal(calls.some((call) => call.url.endsWith("/cards/select")), false, "no selection POST happens before the local choice");
  });
});

test("closing report, card and placement layers returns the experience to pass-through", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});

    experience.presentCards({ cards: OFFER.cards }, () => {});
    assert.equal(experience.root.classList.has("is-interactive"), true);
    assert.equal(experience.root.classList.has("is-placement"), false);
    experience.closeCards();
    assert.equal(experience.root.classList.has("is-interactive"), false, "closing the card choice returns to pass-through");
    assert.equal(experience.root.dataset.interactive, "false");
    assert.equal(experience.root.hidden, true);

    experience.presentReport({ masthead: { title: "Owl Daily", subtitle: "Owl Daily" }, edition: "Day 1", headline: "H", lead: "L", articles: [], briefs: [] }, { ready: true });
    assert.equal(experience.root.classList.has("is-interactive"), true);
    experience.dismissReport(0, 0);
    assert.equal(experience.root.classList.has("is-interactive"), false, "closing the report returns to pass-through");

    experience.presentPlacementMode({ card: { title: "Owl Tower" }, candidates: [], onPlace() {}, onPickCandidate() {}, onCancel() {} });
    assert.equal(experience.root.classList.has("is-interactive"), false, "placement is not a full-screen modal interaction");
    assert.equal(experience.root.classList.has("is-placement"), true, "placement opens its own pass-through map mode");
    experience.closePlacement();
    assert.equal(experience.root.classList.has("is-placement"), false, "closing placement returns to pass-through");
    assert.equal(experience.root.hidden, true);
  });
});

test("placement mode keeps the full-screen root out of the pointer path while its controls stay interactive", async () => {
  await withFakeDom(async () => {
    const experience = createCityDayExperience({});
    let cancelled = 0;
    experience.presentPlacementMode({
      card: { title: "Owl Tower" },
      candidates: [],
      onPlace() {},
      onPickCandidate() {},
      onCancel: () => {
        cancelled += 1;
      }
    });

    // The root must never become a pointer target in placement mode, otherwise
    // taps on world-space lot markers and camera gestures would be intercepted
    // before the Three.js canvas sees them.
    assert.equal(experience.root.classList.has("is-interactive"), false, "placement keeps the full-screen root pass-through");
    assert.equal(experience.root.dataset.interactive, "false");
    assert.equal(experience.root.dataset.placement, "true", "placement mode is tagged for the pass-through-map state");

    // The placement controls themselves remain hit-testable.
    const cancelButton = collectButtons(experience.layers.placement).find((button) => button.textContent.includes("取消放置"));
    assert.ok(cancelButton, "the placement cancel control is rendered");
    cancelButton.dispatchEvent({ type: "click" });
    assert.equal(cancelled, 1, "the placement cancel control is still interactive");
    assert.equal(experience.root.classList.has("is-placement"), false, "cancelling returns to pass-through");
    assert.equal(experience.root.dataset.placement, "false");
  });
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
  const { document, window } = createFakeDom();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  try {
    await run({ document, window });
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}
