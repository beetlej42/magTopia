// PR G — Player-facing city-day experience overlay.
//
// Pure DOM presentation over the existing 3D city viewer. It never owns
// gameplay truth: every choice is submitted through the authoritative card API
// and every placement through /cards/place. Visual time-of-day is projected
// from the server-derived city-day presentation phase only; this module never
// advances a gameplay clock.
//
// Responsibilities:
// - Dawn Owl Daily newspaper presentation with swipe-dismiss in any direction.
// - Responsive centered three-card choice (vertical portrait, horizontal
//   landscape).
// - Special structure choice: 自己放置 / 交给 Agent.
// - Lightweight manual placement mode that keeps the existing camera system and
//   submits through the authoritative /cards/place validation.
// - Phase-driven light projection and MORNING idle/DAY/NIGHT presentation.
// - Restoration from the server city-day read model after reload.

const DISMISS_SWIPE_MIN_PX = 72;
const DISMISS_VELOCITY_THRESHOLD = 0.55;
const LIGHT_PROJECTION = Object.freeze({
  dawn: 0.3,
  early_morning: 0.42,
  morning: 0.5,
  day: 0.58,
  night: 0.86
});

export const PHASE_LABELS = Object.freeze({
  dawn: "破晓",
  early_morning: "清晨",
  morning: "清晨等待",
  day: "白昼",
  night: "夜晚"
});

// Projection of a presentation phase onto the 0..1 sun-time axis. This is the
// only place visual light is derived; it is never written back to gameplay.
export function phaseLightTarget(phase) {
  return LIGHT_PROJECTION[phase] ?? LIGHT_PROJECTION.morning;
}

// Landscape/wide screens lay the three cards out horizontally; portrait stacks
// them vertically. Safe-area aware.
export function chooseCardOrientation({ width = 0, height = 0 } = {}) {
  return width >= height && width >= 700 ? "landscape" : "portrait";
}

export function createCityDayExperience({ onPhaseChange = () => {}, onReportDismissed = () => {}, onPlayerTurnComplete = () => {} }) {
  const root = document.createElement("div");
  root.className = "city-day-experience";
  root.hidden = true;
  document.body.append(root);

  const state = {
    phase: null,
    presentation: null,
    reportOpen: false,
    cardOpen: false,
    placementOpen: false,
    activePlacement: null,
    swipe: null
  };

  const layers = {
    phase: document.createElement("div"),
    owl: document.createElement("div"),
    newspaper: document.createElement("section"),
    cards: document.createElement("section"),
    placement: document.createElement("section"),
    toast: document.createElement("div")
  };
  layers.phase.className = "city-day-phase-chip";
  layers.owl.className = "city-day-owl";
  layers.owl.setAttribute("aria-hidden", "true");
  layers.newspaper.className = "city-day-newspaper";
  layers.cards.className = "city-day-cards";
  layers.placement.className = "city-day-placement";
  layers.toast.className = "city-day-toast";
  for (const layer of Object.values(layers)) root.append(layer);

  // ---- Interactive vs pass-through ------------------------------------------
  //
  // The experience layer must be explicitly hit-testable while any modal player
  // interaction is open (report, card choice, mode choice, placement) and fully
  // pass-through otherwise so the 3D city viewer beneath keeps receiving
  // gestures. Driving this from state instead of a parent `pointer-events:
  // none` / child `auto` inheritance trick is what keeps the full-screen
  // overlay tappable on iOS Safari.

  function syncInteractiveState() {
    const interactive = state.reportOpen || state.cardOpen || state.placementOpen;
    root.classList.toggle("is-interactive", interactive);
    root.dataset.interactive = String(interactive);
  }

  // ---- Newspaper (Owl Daily) ----------------------------------------------

  function buildNewspaper(report, reportMeta) {
    layers.newspaper.replaceChildren();
    const sheet = document.createElement("div");
    sheet.className = "city-day-paper-sheet";

    const masthead = document.createElement("header");
    masthead.className = "city-day-paper-masthead";
    const mastheadTitle = document.createElement("h2");
    mastheadTitle.textContent = report?.masthead?.title ?? "猫头鹰日报";
    const mastheadSubtitle = document.createElement("p");
    mastheadSubtitle.textContent = report?.masthead?.subtitle ?? "Owl Daily";
    masthead.append(mastheadTitle, mastheadSubtitle);

    const edition = document.createElement("p");
    edition.className = "city-day-paper-edition";
    edition.textContent = report?.edition ?? reportMeta?.edition ?? "";

    const headline = document.createElement("h3");
    headline.className = "city-day-paper-headline";
    headline.textContent = report?.headline ?? reportMeta?.headline ?? "";

    const lead = document.createElement("p");
    lead.className = "city-day-paper-lead";
    lead.textContent = report?.lead ?? "";

    const body = document.createElement("div");
    body.className = "city-day-paper-body";
    for (const article of report?.articles ?? []) {
      const articleEl = document.createElement("article");
      const articleHeadline = document.createElement("h4");
      articleHeadline.textContent = article.headline;
      const articleBody = document.createElement("p");
      articleBody.textContent = article.body;
      articleEl.append(articleHeadline, articleBody);
      body.append(articleEl);
    }
    for (const brief of report?.briefs ?? []) {
      const briefEl = document.createElement("p");
      briefEl.className = "city-day-paper-brief";
      briefEl.textContent = brief.text;
      body.append(briefEl);
    }
    const hint = document.createElement("p");
    hint.className = "city-day-paper-dismiss-hint";
    hint.textContent = "向任意方向滑动报纸以继续";
    sheet.append(masthead, edition, headline, lead, body, hint);
    layers.newspaper.append(sheet);
  }

  function attachSwipe(element) {
    let start = null;
    const move = (event) => {
      if (!state.swipe?.active) return;
      const dx = event.clientX - state.swipe.startX;
      const dy = event.clientY - state.swipe.startY;
      state.swipe.dx = dx;
      state.swipe.dy = dy;
      element.style.setProperty("--swipe-x", `${dx}px`);
      element.style.setProperty("--swipe-y", `${dy}px`);
      element.classList.toggle("is-swipeable", Math.hypot(dx, dy) > 8);
    };
    const end = (event) => {
      if (!state.swipe?.active) return;
      state.swipe.active = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      element.style.setProperty("--swipe-x", "0px");
      element.style.setProperty("--swipe-y", "0px");
      element.classList.remove("is-swipeable");
      const { dx, dy } = state.swipe;
      const distance = Math.hypot(dx, dy);
      const moved = distance >= DISMISS_SWIPE_MIN_PX || Math.abs(dx) > 40;
      if (moved) dismissReport(dx, dy);
      else start = null;
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      state.swipe = { active: true, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 };
      element.setPointerCapture?.(event.pointerId);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
    return start;
  }

  function presentReport(report, reportMeta) {
    buildNewspaper(report, reportMeta);
    layers.newspaper.hidden = false;
    layers.newspaper.classList.add("is-entering");
    layers.owl.classList.remove("is-flying");
    // Restart the fly-through on each fresh presentation.
    void layers.owl.offsetWidth;
    layers.owl.classList.add("is-flying");
    state.reportOpen = true;
    attachSwipe(layers.newspaper);
    root.hidden = false;
    syncInteractiveState();
  }

  async function dismissReport(_dx, _dy) {
    if (!state.reportOpen) return;
    state.reportOpen = false;
    syncInteractiveState();
    layers.newspaper.classList.add("is-dismissing");
    layers.owl.classList.remove("is-flying");
    onReportDismissed();
    window.setTimeout(() => {
      layers.newspaper.hidden = true;
      layers.newspaper.classList.remove("is-entering", "is-dismissing");
      root.hidden = !state.cardOpen && !state.placementOpen;
    }, 320);
  }

  // ---- Three-card choice ---------------------------------------------------

  function buildCardShell(card, index, onPick) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `city-day-card city-day-card-${card.type ?? "unknown"}`;
    element.dataset.cardId = card.card_id;
    const title = document.createElement("strong");
    title.className = "city-day-card-title";
    title.textContent = card.title;
    const kind = document.createElement("span");
    kind.className = "city-day-card-kind";
    kind.textContent = card.type === "special_structure"
      ? "特殊建筑"
      : card.type === "policy"
        ? "市政政策"
        : card.type === "resource" || card.type === "personnel"
          ? "资源 / 人事"
          : "卡牌";
    const description = document.createElement("p");
    description.className = "city-day-card-description";
    description.textContent = card.description;
    const effect = document.createElement("p");
    effect.className = "city-day-card-effect";
    effect.textContent = cardDurationLabel(card);
    element.append(kind, title, description, effect);
    element.addEventListener("click", () => onPick(card, index));
    return element;
  }

  function cardDurationLabel(card) {
    if (card.type === "special_structure") return "选择后需要放置位置";
    if (typeof card.duration === "object" && card.duration?.turns) {
      return `持续 ${card.duration.turns} 回合`;
    }
    return "";
  }

  function presentCards(offer, onSelect) {
    layers.cards.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "city-day-cards-heading";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "今日卡牌";
    const title = document.createElement("h2");
    title.textContent = "为今天的城市做出一个选择";
    heading.append(eyebrow, title);
    layers.cards.append(heading);

    const grid = document.createElement("div");
    grid.className = "city-day-cards-grid";
    (offer?.cards ?? []).forEach((card, index) => {
      grid.append(buildCardShell(card, index, (picked) => onSelect(picked, offer)));
    });
    layers.cards.append(grid);
    layers.cards.hidden = false;
    root.hidden = false;
    state.cardOpen = true;
    syncInteractiveState();
  }

  // ---- Special structure choice: 自己放置 / 交给 Agent -----------------------

  function presentPlacementChoice(card, onDecide) {
    layers.cards.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "city-day-cards-heading";
    const title = document.createElement("h2");
    title.textContent = card.title;
    const description = document.createElement("p");
    description.className = "city-day-placement-question";
    description.textContent = "这座特殊建筑将建在城市里，你希望如何完成它？";
    heading.append(title, description);
    layers.cards.append(heading);

    const actions = document.createElement("div");
    actions.className = "city-day-placement-actions";
    const self = document.createElement("button");
    self.type = "button";
    self.className = "city-day-placement-action is-primary";
    self.textContent = "自己放置";
    self.addEventListener("click", () => onDecide("player_place"));
    const delegate = document.createElement("button");
    delegate.type = "button";
    delegate.className = "city-day-placement-action";
    delegate.textContent = "交给 Agent";
    delegate.addEventListener("click", () => onDecide("delegate_to_agent"));
    actions.append(self, delegate);
    layers.cards.append(actions);
    layers.cards.hidden = false;
    root.hidden = false;
    syncInteractiveState();
  }

  // ---- Manual placement mode (keeps existing camera) ------------------------

  function presentPlacementMode({ card, candidates = [], onPlace, onPickCandidate, onCancel }) {
    layers.placement.replaceChildren();
    state.placementOpen = true;
    state.activePlacement = { card, candidates, onPlace, onPickCandidate, onCancel, selectedCandidate: null };
    syncInteractiveState();

    const heading = document.createElement("div");
    heading.className = "city-day-cards-heading";
    const title = document.createElement("h2");
    title.textContent = `放置 ${card.title}`;
    const description = document.createElement("p");
    description.textContent = "在城市中点选高亮地块预览位置，确认后完成放置。你可以自由旋转/缩放城市。";
    heading.append(title, description);
    layers.placement.append(heading);

    const list = document.createElement("div");
    list.className = "city-day-lot-list";
    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.className = "city-day-lot-empty";
      empty.textContent = "没有找到合法空地，你可以取消放置或稍后再试。";
      list.append(empty);
    }
    candidates.forEach((candidate) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "city-day-lot-item";
      item.dataset.lotId = candidate.lotId;
      const name = document.createElement("strong");
      const center = candidate.center;
      name.textContent = Number.isFinite(Number(center?.x)) && Number.isFinite(Number(center?.z))
        ? `街区 ${Math.round(Number(center.x))}, ${Math.round(-Number(center.z))}`
        : `地块 ${candidate.lotId}`;
      const note = document.createElement("span");
      note.textContent = candidate.context?.adjacentRoad
        ? `临街 ${(candidate.context.roadFrontageDirections ?? []).length} 侧`
        : "可建造空地";
      item.append(name, note);
      item.addEventListener("click", () => {
        selectCandidate(candidate);
        item.classList.add("is-selected");
        list.querySelectorAll(".city-day-lot-item").forEach((other) => {
          if (other !== item) other.classList.remove("is-selected");
        });
      });
      list.append(item);
    });
    layers.placement.append(list);

    const footer = document.createElement("div");
    footer.className = "city-day-lot-footer";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "city-day-placement-action is-primary";
    confirm.textContent = "确认放置";
    confirm.disabled = true;
    confirm.addEventListener("click", () => {
      const { onPlace: place, selectedCandidate } = state.activePlacement ?? {};
      if (place && selectedCandidate) place(selectedCandidate);
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "city-day-placement-action";
    cancel.textContent = "取消放置";
    cancel.addEventListener("click", () => {
      const { onCancel: cancelPlacement } = state.activePlacement ?? {};
      closePlacement();
      cancelPlacement?.();
    });
    footer.append(cancel, confirm);
    layers.placement.append(footer);
    layers.placement.hidden = false;
    root.hidden = false;
    layers.cards.hidden = true;
    state.activePlacement.confirmButton = confirm;
  }

  function selectCandidate(candidate) {
    if (!state.activePlacement) return;
    state.activePlacement.selectedCandidate = candidate;
    state.activePlacement.onPickCandidate?.(candidate);
    if (state.activePlacement.confirmButton) state.activePlacement.confirmButton.disabled = false;
  }  function closePlacement() {
    state.placementOpen = false;
    state.activePlacement = null;
    layers.placement.hidden = true;
    layers.placement.replaceChildren();
    root.hidden = !state.cardOpen && !state.reportOpen;
    syncInteractiveState();
  }

  function closeCards() {
    state.cardOpen = false;
    layers.cards.hidden = true;
    layers.cards.replaceChildren();
    root.hidden = !state.placementOpen && !state.reportOpen;
    syncInteractiveState();
  }

  // ---- Phase projection ----------------------------------------------------

  function applyPresentation(presentation) {
    const nextPhase = presentation?.phase ?? "morning";
    if (state.phase === nextPhase && !state.reportOpen) {
      state.presentation = presentation;
      return;
    }
    state.presentation = presentation;
    const changed = state.phase !== nextPhase;
    state.phase = nextPhase;
    layers.phase.textContent = PHASE_LABELS[nextPhase] ?? nextPhase;
    layers.phase.hidden = false;
    layers.phase.dataset.phase = nextPhase;
    if (changed) onPhaseChange(nextPhase, presentation);
  }

  function showIdleNote(message) {
    layers.toast.textContent = message ?? "";
    layers.toast.hidden = !message;
  }

  function setHidden(hidden) {
    root.hidden = hidden;
  }

  function setSwipeDirectionalHint(enabled) {
    layers.newspaper.classList.toggle("city-day-newspaper-touch", enabled);
  }

  return {
    root,
    layers,
    state,
    applyPresentation,
    presentReport,
    dismissReport,
    presentCards,
    presentPlacementChoice,
    presentPlacementMode,
    selectCandidateFromLayer: selectCandidate,
    closePlacement,
    closeCards,
    showIdleNote,
    setHidden,
    setSwipeDirectionalHint,
    phaseLightTarget
  };
}
