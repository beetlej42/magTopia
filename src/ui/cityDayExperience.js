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

export function createCityDayExperience({ onPhaseChange = () => {}, onReportDismissed = () => {} }) {
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
    toast: document.createElement("div"),
    strategy: document.createElement("aside")
  };
  layers.phase.className = "city-day-phase-chip";
  layers.owl.className = "city-day-owl";
  layers.owl.setAttribute("aria-hidden", "true");
  layers.newspaper.className = "city-day-newspaper";
  layers.newspaper.hidden = true;
  layers.cards.className = "city-day-cards";
  layers.cards.hidden = true;
  layers.placement.className = "city-day-placement";
  layers.placement.hidden = true;
  layers.toast.className = "city-day-toast";
  layers.strategy.className = "city-day-strategy-facts";
  layers.strategy.hidden = true;
  for (const layer of Object.values(layers)) root.append(layer);

  // ---- Full-screen layer mutual exclusion ----------------------------------
  //
  // newspaper / cards / placement are the three full-screen layers of the
  // experience. At most one is visible at a time; every other full-screen layer
  // must stay hidden (display:none) so an empty or stale layer can never cover
  // the active modal and swallow taps. `hidden` is the single source of truth
  // for which layer is hit-testable: a hidden layer cannot be painted or hit.
  function showLayer(name) {
    layers.newspaper.hidden = name !== "newspaper";
    layers.cards.hidden = name !== "cards";
    layers.placement.hidden = name !== "placement";
    state.reportOpen = name === "newspaper";
    state.cardOpen = name === "cards";
    state.placementOpen = name === "placement";
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

    const subheadline = document.createElement("p");
    subheadline.className = "city-day-paper-subheadline";
    subheadline.textContent = report?.subheadline ?? "";

    const lead = document.createElement("p");
    lead.className = "city-day-paper-lead";
    lead.textContent = report?.lead ?? "";

    const body = document.createElement("div");
    body.className = "city-day-paper-body";
    for (const article of report?.articles ?? []) {
      const articleEl = document.createElement("article");
      const articleHeadline = document.createElement("h4");
      articleHeadline.textContent = article.headline;
      const articleMeta = document.createElement("small");
      articleMeta.className = "city-day-paper-article-meta";
      articleMeta.textContent = [article.category, article.importance].filter(Boolean).join(" · ");
      const articleDek = document.createElement("p");
      articleDek.className = "city-day-paper-dek";
      articleDek.textContent = article.dek ?? "";
      const articleBody = document.createElement("p");
      articleBody.textContent = article.body;
      articleEl.append(articleHeadline, articleMeta, articleDek, articleBody);
      body.append(articleEl);
    }
    for (const brief of report?.briefs ?? []) {
      const briefEl = document.createElement("p");
      briefEl.className = "city-day-paper-brief";
      briefEl.textContent = brief.text;
      body.append(briefEl);
    }
    const actionBox = document.createElement("section");
    actionBox.className = "city-day-paper-action-box";
    if ((report?.actionBox ?? []).length) {
      const title = document.createElement("h4");
      title.textContent = "市政行动栏";
      actionBox.append(title);
      for (const action of report.actionBox) {
        const entry = document.createElement("p");
        entry.textContent = action.reason ?? `关注 ${action.incidentRef ?? "当前事件"}`;
        actionBox.append(entry);
      }
    }
    const tomorrow = document.createElement("section");
    tomorrow.className = "city-day-paper-tomorrow";
    if ((report?.tomorrowWatch ?? []).length) {
      const title = document.createElement("h4");
      title.textContent = "明日观察";
      tomorrow.append(title);
      for (const watch of report.tomorrowWatch) {
        const entry = document.createElement("p");
        entry.textContent = watch.text;
        tomorrow.append(entry);
      }
    }
    const hint = document.createElement("p");
    hint.className = "city-day-paper-dismiss-hint";
    hint.textContent = "向任意方向滑动报纸以继续";
    sheet.append(masthead, edition, headline, subheadline, lead, body);
    if ((report?.actionBox ?? []).length) sheet.append(actionBox);
    if ((report?.tomorrowWatch ?? []).length) sheet.append(tomorrow);
    sheet.append(hint);
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
    showLayer("newspaper");
    layers.newspaper.classList.add("is-entering");
    layers.owl.classList.remove("is-flying");
    // Restart the fly-through on each fresh presentation.
    void layers.owl.offsetWidth;
    layers.owl.classList.add("is-flying");
    attachSwipe(layers.newspaper);
    root.hidden = false;
  }

  async function dismissReport(_dx, _dy) {
    if (!state.reportOpen) return;
    state.reportOpen = false;
    layers.newspaper.classList.add("is-dismissing");
    layers.owl.classList.remove("is-flying");
    onReportDismissed();
    window.setTimeout(() => {
      layers.newspaper.hidden = true;
      layers.newspaper.classList.remove("is-entering", "is-dismissing");
      root.hidden = !state.presentation && !state.cardOpen && !state.placementOpen;
    }, 320);
  }

  // ---- Three-card choice ---------------------------------------------------

  function buildCardShell(card, index, onPick, audit = null) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `city-day-card city-day-card-${card.type ?? "unknown"}`;
    element.dataset.cardId = card.card_id;
    const title = document.createElement("strong");
    title.className = "city-day-card-title";
    title.textContent = card.title;
    const kind = document.createElement("span");
    kind.className = "city-day-card-kind";
    const typeLabels = {
      building: "BUILDING · 建设",
      people: "PEOPLE · 人口",
      resource: "RESOURCE · 资源",
      personnel: "PERSONNEL · 人事",
      policy: "POLICY · 政策",
      special_structure: "SPECIAL · 特殊建筑"
    };
    kind.textContent = typeLabels[card.type] ?? "CARD · 卡牌";
    const description = document.createElement("p");
    description.className = "city-day-card-description";
    description.textContent = card.description;
    const effect = document.createElement("p");
    effect.className = "city-day-card-effect";
    effect.textContent = cardDurationLabel(card);
    const facts = document.createElement("div");
    facts.className = "city-day-card-facts";
    const addFact = (text, className = "") => {
      if (!text) return;
      const fact = document.createElement("span");
      fact.className = className;
      fact.textContent = text;
      facts.append(fact);
    };
    if (card.type === "special_structure") {
      addFact(`SPECIAL FAMILY · ${String(card.family ?? "special_building").replaceAll("_", " ")}`);
      if (card.unique) addFact("唯一资格");
      if (card.free_placement ?? card.effect?.freePlacement) addFact("免费放置");
      if (card.structure?.footprint) addFact(`占地 ${card.structure.footprint}`);
      addFact(audit?.eligible === false ? "资格受限" : "资格：符合当前条件");
      addFact("选择后：自己放置 / 交给 Agent", "is-action");
    } else if (card.choice_kind) {
      addFact(`${String(card.choice_kind).toUpperCase()} CHOICE`);
      if (card.family) addFact(`FAMILY · ${String(card.family).replaceAll("_", " ")}`);
    }
    if (card.effect_preview?.kind === "wizard_population") {
      const preview = card.effect_preview;
      addFact(
        `预计迁入 ${preview.projected_grant}/${preview.requested} 位巫师 · 当前巫师住房 ${preview.current}/${preview.capacity}`,
        Number(preview.projected_grant) < Number(preview.requested) ? "is-warning" : "is-action"
      );
    } else if (card.effect_preview?.kind === "coins") {
      addFact(`预计立即获得 ${card.effect_preview.projected_grant} 金币`, "is-action");
    }
    element.append(kind, title, description, effect, facts);
    element.addEventListener("click", () => {
      if (element.dataset.selected === "true") return;
      element.dataset.selected = "true";
      element.setAttribute("aria-pressed", "true");
      element.classList.add("is-selected");
      onPick(card, index);
    });
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
    const isSpecial = offer?.choice_kind === "special";
    eyebrow.textContent = isSpecial
      ? `SPECIAL CHOICE · 第 ${offer?.turn ?? ""} 回合`
      : "ORDINARY CHOICE · 今日卡牌";
    const title = document.createElement("h2");
    title.textContent = "为今天的城市做出一个选择";
    heading.append(eyebrow, title);
    layers.cards.dataset.choiceKind = isSpecial ? "special" : "ordinary";
    layers.cards.classList.toggle("is-special-choice", isSpecial);
    layers.cards.append(heading);

    const grid = document.createElement("div");
    grid.className = "city-day-cards-grid";
    (offer?.cards ?? []).forEach((card, index) => {
      const audit = (offer?.eligibility_audit ?? []).find((entry) => entry.cardId === card.card_id || entry.card_id === card.card_id);
      grid.append(buildCardShell(card, index, (picked) => onSelect(picked, offer), audit));
    });
    layers.cards.append(grid);
    showLayer("cards");
    root.hidden = false;
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
    const delegate = document.createElement("button");
    delegate.type = "button";
    delegate.className = "city-day-placement-action";
    delegate.textContent = "交给 Agent";
    const progress = document.createElement("p");
    progress.className = "city-day-placement-progress";
    progress.setAttribute("role", "status");
    progress.hidden = true;
    let deciding = false;
    const decide = async (mode) => {
      if (deciding) return;
      deciding = true;
      self.disabled = true;
      delegate.disabled = true;
      actions.setAttribute("aria-busy", "true");
      progress.textContent = mode === "player_place"
        ? "正在确认选择并载入可放置位置…"
        : "正在确认选择并生成 Agent 放置委托…";
      progress.hidden = false;
      try {
        const accepted = await onDecide(mode);
        if (accepted !== false) return;
      } catch (error) {
        progress.textContent = error?.message ?? "提交失败，请重试。";
      }
      deciding = false;
      self.disabled = false;
      delegate.disabled = false;
      actions.removeAttribute("aria-busy");
    };
    self.addEventListener("click", () => void decide("player_place"));
    delegate.addEventListener("click", () => void decide("delegate_to_agent"));
    actions.append(self, delegate);
    layers.cards.append(actions, progress);
    showLayer("cards");
    root.hidden = false;
  }

  // ---- Manual placement mode (in-world FOV-center placement) ----------------
  //
  // PR #52: special-structure placement is a pass-through city-builder mode
  // driven by the camera FOV center. No legal-lot button list is shown and no
  // hidden fixed overlay intercepts map gestures: the `.city-day-placement`
  // layer is pointer-events:none and only the three icon buttons are
  // hit-testable. Far view keeps only cancel + status; near view adds rotate
  // and confirm.

  const PLACEMENT_ICONS = {
    cancel: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 2v4h-4"></path></svg>',
    confirm: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5 10 17.5 19 7.5"></path></svg>'
  };

  function buildPlacementButton({ className, label, icon, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `city-day-placement-button ${className}`.trim();
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = PLACEMENT_ICONS[icon] ?? "";
    button.addEventListener("click", onClick);
    return button;
  }

  function presentPlacementMode({ card, onRotate, onConfirm, onCancel }) {
    layers.placement.replaceChildren();
    // Entering placement closes the card choice: placement is a pass-through
    // map mode (the city must stay reachable for orbiting/picking), not a
    // full-screen modal interaction.
    layers.cards.replaceChildren();

    const status = document.createElement("div");
    status.className = "city-day-placement-status";
    const statusText = document.createElement("strong");
    statusText.textContent = `正在放置 · ${card.title}`;
    status.append(statusText);
    layers.placement.append(status);

    const controls = document.createElement("div");
    controls.className = "city-day-placement-controls";
    const cancel = buildPlacementButton({
      className: "is-cancel",
      label: "取消放置",
      icon: "cancel",
      onClick: () => {
        const { onCancel: cancelPlacement } = state.activePlacement ?? {};
        // The controller owns the authoritative cancellation mutation. Do not
        // close first and lose the recoverable session if that mutation fails.
        cancelPlacement?.();
      }
    });
    // Rotate/confirm belong to near-view precision placement; cancel stays
    // available in both near and far view.
    const actions = document.createElement("div");
    actions.className = "city-day-placement-actions";
    const rotate = buildPlacementButton({
      className: "is-rotate",
      label: "顺时针旋转建筑 90 度",
      icon: "rotate",
      onClick: () => state.activePlacement?.onRotate?.()
    });
    const confirm = buildPlacementButton({
      className: "is-confirm",
      label: "确认放置",
      icon: "confirm",
      onClick: () => state.activePlacement?.onConfirm?.()
    });
    confirm.disabled = true;
    actions.append(rotate, confirm);
    controls.append(cancel, actions);
    layers.placement.append(controls);

    state.activePlacement = {
      card,
      onRotate,
      onConfirm,
      onCancel,
      statusText,
      status,
      controls,
      actions,
      cancel,
      rotate,
      confirm,
      viewMode: "near",
      hasTarget: false,
      isLegal: false,
      reason: null,
      quarterTurns: 0
    };
    showLayer("placement");
    root.hidden = false;
  }

  // Called every frame while placement is active. Writes to the DOM only when a
  // control's effective state changes so per-frame camera movement does not
  // churn the placement HUD.
  function updatePlacementControls({ viewMode = "near", hasTarget = false, isLegal = false, reason = null, quarterTurns = 0 } = {}) {
    const placement = state.activePlacement;
    if (!placement) return;
    const nextViewMode = viewMode === "far" ? "far" : "near";
    const changed = placement.viewMode !== nextViewMode
      || placement.hasTarget !== Boolean(hasTarget)
      || placement.isLegal !== Boolean(isLegal)
      || placement.reason !== reason
      || placement.quarterTurns !== quarterTurns;
    if (!changed) return;
    placement.viewMode = nextViewMode;
    placement.hasTarget = Boolean(hasTarget);
    placement.isLegal = Boolean(isLegal);
    placement.reason = reason;
    placement.quarterTurns = quarterTurns;

    const invalid = nextViewMode === "near" && (!placement.hasTarget || !placement.isLegal);
    placement.status.classList.toggle("is-invalid", invalid);
    placement.statusText.textContent = `正在放置 · ${placement.card.title}`;
    placement.status.querySelector(".city-day-placement-reason")?.remove?.();
    if (invalid) {
      const reasonEl = document.createElement("span");
      reasonEl.className = "city-day-placement-reason";
      reasonEl.textContent = reason ?? "当前目标不可放置";
      placement.status.append(reasonEl);
    }

    placement.actions.hidden = nextViewMode !== "near";
    placement.confirm.disabled = nextViewMode !== "near" || !placement.hasTarget || !placement.isLegal;
    placement.rotate.setAttribute("aria-label", `顺时针旋转建筑 90 度（当前 ${placement.quarterTurns} 个 1/4 圈）`);
  }

  function closePlacement() {
    state.placementOpen = false;
    state.activePlacement = null;
    layers.placement.hidden = true;
    layers.placement.replaceChildren();
    root.hidden = !state.presentation && !state.cardOpen && !state.reportOpen;
  }

  function closeCards() {
    state.cardOpen = false;
    layers.cards.hidden = true;
    layers.cards.replaceChildren();
    root.hidden = !state.presentation && !state.placementOpen && !state.reportOpen;
  }

  // ---- Phase projection ----------------------------------------------------

  function applyPresentation(presentation) {
    const nextPhase = presentation?.phase ?? "morning";
    if (state.phase === nextPhase && !state.reportOpen) {
      state.presentation = presentation;
      return;
    }
    state.presentation = presentation;
    root.hidden = false;
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

  // Strategy data is read-only and supplied by the authoritative strategy
  // endpoint. The player sees factual incident/officer state without the
  // client deriving outcomes or inventing values.
  function applyStrategyFacts(strategy) {
    state.strategy = strategy ?? null;
    layers.strategy.replaceChildren();
    const incidents = strategy?.incidents ?? [];
    const candidates = strategy?.arcane_officer_recruitment?.candidates ?? [];
    if (!incidents.length && !candidates.length) {
      layers.strategy.hidden = true;
      return;
    }
    const title = document.createElement("strong");
    title.textContent = "夜间事实 · Agent / Arcane Officer";
    layers.strategy.append(title);
    if (incidents.length) {
      const incidentLine = document.createElement("p");
      incidentLine.textContent = `待处理事件 ${incidents.length} 件：${incidents.map((entry) => entry.summary ?? entry.type ?? entry.id).join("、")}`;
      layers.strategy.append(incidentLine);
    }
    if (candidates.length) {
      const officerLine = document.createElement("p");
      officerLine.textContent = `可招募 Arcane Officer：${candidates.map((entry) => entry.identity?.name ?? entry.candidate_id).join("、")}`;
      layers.strategy.append(officerLine);
    }
    layers.strategy.hidden = false;
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
    updatePlacementControls,
    closePlacement,
    closeCards,
    showIdleNote,
    applyStrategyFacts,
    setHidden,
    setSwipeDirectionalHint,
    phaseLightTarget
  };
}
