// Progressive-disclosure playbook guidance for Agent read models.
//
// The full gameplay contract lives in docs/agent-playbook.md; API responses
// only surface a short, context-appropriate hint (1-3 items) plus a pointer to
// the playbook. Guidance is advisory prose and never a hard constraint: only
// SYSTEM authoritative validation (assignment validation, card ownership, etc.)
// can reject an Agent action.

import { normalizeCardState } from "./schema.js";

// The discovery anchor is always present so an Agent can always find the
// authoritative contract without the API re-printing it.
export const PLAYBOOK_DISCOVERY_GUIDANCE = Object.freeze(
  "Read the MAGTOPIA Agent Playbook before planning; it is the authoritative gameplay contract."
);

export const PLAYBOOK_BASE_GUIDANCE = Object.freeze([
  PLAYBOOK_DISCOVERY_GUIDANCE,
  "Player choices are authoritative: never select a card or invent a SYSTEM settlement result.",
  "Balance development with population, exposure, concealment, and incident risk."
]);

// At most MAX_CONTEXTUAL_HINTS context hints are surfaced (total response stays
// within the 1-3 low-token spec: 1 discovery anchor + up to 2 context hints).
const MAX_CONTEXTUAL_HINTS = 2;

export function playbookGuidance(state, options = {}) {
  const hints = [];
  const cardState = normalizeCardState(state?.gameplay?.cardState);
  const gameplay = state?.gameplay ?? {};

  const addContextual = (hint) => {
    if (hints.length < MAX_CONTEXTUAL_HINTS) hints.push(hint);
  };

  if (state?.turn != null && Number(state.turn) === 0) {
    addContextual("Turn 0 is bootstrap: no card choice is owed. Build a compact route from old_town_entry with affordable housing and an income building; this guidance is advisory.");
    return [PLAYBOOK_DISCOVERY_GUIDANCE, ...hints];
  }

  // Highest-priority context first. A locked resolve gate is the most decisive
  // thing to know, then agent-mandated work, then risk, then player-owed steps.
  if (options.turnLocked) {
    addContextual(`The current turn cannot be resolved yet: nextTurnUnlockAt (${options.turnLocked}) gates resolution. Stop low-value new work and wait.`);
  }
  const delegatedPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "delegate_to_agent" && ["pending", "deferred"].includes(entry.status));
  if (delegatedPlacement) {
    addContextual(`The player delegated the ${delegatedPlacement.cardId} location to you; resolve it via the cards/place endpoint with placement_id ${delegatedPlacement.placementId}.`);
  }
  const openIncidents = Object.values(gameplay.incidents ?? {}).some((incident) => incident.status === "open");
  const pendingAssignments = Array.isArray(gameplay.pendingAssignments) && gameplay.pendingAssignments.length > 0;
  if (openIncidents || pendingAssignments) {
    addContextual("Open incidents remain: dispatch available Arcane Officers or accept that they are recorded as unaddressed at settlement.");
  }
  const playerPlacement = Object.values(cardState.placements ?? {})
    .find((entry) => entry.mode === "player_place" && entry.status === "pending");
  if (playerPlacement) {
    addContextual("A player-owned special structure placement is pending; the player must place it.");
  }
  if (cardState.choice?.status === "pending") {
    addContextual("The player still owes today's card choice; observe it, never choose on their behalf.");
  }

  return [PLAYBOOK_DISCOVERY_GUIDANCE, ...hints];
}


// Optional, stage-specific writing hints for Agent-to-player updates. These are
// presentation guidance, never gameplay instructions or authoritative event facts.
// Keep them compact: most API responses need no narrative prompt at all.
const INCIDENT_NARRATIVE_GUIDANCE = Object.freeze({
  discovered: Object.freeze({
    context: "incident_discovered",
    audience: "player",
    instruction: "向玩家简短讲述城市哪里出现了什么异常、为何值得留意。像一位身处魔法伦敦的城市管理者，不要念出事件等级、检定难度或暴露数值。",
    boundaries: "这是待处理事件。不得声称秘法官已出动或事件已解决；没有事实支持时不要编造具体异象、目击者或后果。"
  }),
  dispatched: Object.freeze({
    context: "incident_dispatched",
    audience: "player",
    instruction: "如需向玩家汇报进展，介绍哪位秘法官已获派遣、正准备处理什么事件。用自然的城市叙事代替能力值、匹配分数和派遣机制。",
    boundaries: "当前只确认派遣计划已被接受，不代表行动成功；不得提前宣布结局或杜撰现场行动。"
  }),
  settled: Object.freeze({
    context: "incident_settled",
    audience: "player",
    instruction: "如需向玩家汇报，依据本次结算的 incidents、assignments、outcomes 和 unaddressedIncidents，简短讲述秘法官行动的结果与城市余波，而不是骰点、成功等级和暴露值。",
    boundaries: "逐事件核对成功、失败及未处理状态；新出现的事件不可写成已解决。未给出的异常细节和人物言行不可当作事实。"
  })
});

export function incidentNarrativeGuidance(stage) {
  return INCIDENT_NARRATIVE_GUIDANCE[stage] ?? null;
}

// The newspaper is a fictional in-world publication, not a settlement ledger.
export const OWL_DAILY_NARRATIVE_GUIDANCE = Object.freeze({
  context: "owl_daily",
  audience: "city_readers",
  instruction: "以维多利亚风格魔法伦敦的《猫头鹰日报》主编口吻写新闻。挑选一件最有新闻价值的事展开：地点、人物、发生了什么、如何收场及城市反响；其余写短讯。文字克制、生动，带一点英式幽默，不逐字段翻译结算数据。",
  style_rule: "默认不在报道正文讲暴露值、骰点、检定、资源增减、事件等级或其他游戏机制；这些属于游戏数据界面。",
  fact_rule: "所有权威事实以本回合 ReportContext 为准并关联对应 factRefs。可以用修辞烘托气氛，但不能编造具体魔法异象、目击者证词、建筑完工、人口变动或秘法官结局；不确定的事保留悬念。"
});
