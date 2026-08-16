import { createHash } from "node:crypto";
import { deepFreeze } from "./schema.js";

// PR E — Owl Daily / Narrative Interface.
//
// Two authority layers live in this module:
//
// 1. ReportContext is SYSTEM-owned. It is a deterministic projection of the
//    immutable TurnFacts plus read-only city metadata (building and officer
//    names). It contains no prose and never recomputes gameplay; it is frozen
//    so an Agent cannot mutate the facts it is given.
//
// 2. OwlReport is AGENT-owned. It is the newspaper the Agent edits from a
//    ReportContext. The Agent decides news value, section placement, and
//    narration; it references facts through stable fact refs instead of
//    re-authoring them.
//
// The server binds each report to a resolved turn and to the exact digest of
// that turn's frozen facts, so an Agent can neither submit a stale context for
// a new turn nor overwrite the canonical report of an already-reported turn.

export const REPORT_CONTEXT_SCHEMA_VERSION = 1;
export const OWL_REPORT_SCHEMA_VERSION = 1;

export const ARTICLE_IMPORTANCE = Object.freeze(["front_page", "secondary", "brief"]);
export const SUGGESTED_ARTICLE_CATEGORIES = Object.freeze([
  "development", "exposure", "arcane_officer", "population", "economy", "community", "other"
]);

const OWL_REPORT_TOP_LEVEL_FIELDS = Object.freeze(new Set([
  "masthead", "edition", "headline", "subheadline", "lead", "articles", "briefs", "actionBox", "tomorrowWatch"
]));

const MASTHEAD_FIELDS = Object.freeze(new Set(["title", "subtitle"]));
const ARTICLE_FIELDS = Object.freeze(new Set(["id", "headline", "dek", "body", "category", "importance", "relatedFactRefs"]));
const BRIEF_FIELDS = Object.freeze(new Set(["id", "text", "category", "relatedFactRefs"]));
const ACTION_BOX_FIELDS = Object.freeze(new Set(["id", "incidentRef", "factRefs", "reason"]));
const TOMORROW_WATCH_FIELDS = Object.freeze(new Set(["id", "text", "factRefs"]));

const LIMITS = Object.freeze({
  mastheadTitle: 120,
  mastheadSubtitle: 200,
  edition: 120,
  headline: 240,
  subheadline: 320,
  lead: 4000,
  articleHeadline: 240,
  articleDek: 400,
  articleBody: 12000,
  category: 60,
  reason: 2000,
  briefText: 2000,
  tomorrowText: 4000,
  id: 80,
  maxArticles: 20,
  maxBriefs: 40,
  maxActionBoxEntries: 10,
  maxTomorrowWatchEntries: 10,
  maxFactRefsPerEntry: 40
});

export function factRef(kind, id) {
  return id == null || id === "" ? `fact-${kind}` : `fact-${kind}-${id}`;
}

// Deterministic, cross-process stable digest of the frozen TurnFacts. A report
// is bound to this digest so a stale context can never be submitted for a
// different resolved turn.
export function factsDigest(facts) {
  return createHash("sha256").update(stableStringify(facts)).digest("hex");
}

// Builds the SYSTEM-owned newspaper source context for a single resolved turn.
// `state` supplies only read-only presentation metadata; every gameplay value
// comes from the immutable `facts`. The returned object is deep-frozen.
export function buildReportContext({ cityId = null, state = {}, facts, options = {} }) {
  if (!facts || typeof facts !== "object") throw new Error("ReportContext requires immutable TurnFacts");
  const turn = Number(facts.turn);
  const refs = new Set();
  const buildingName = (id) => state?.buildings?.[id]?.program?.name ?? id;
  const buildingArchetype = (id) => state?.buildings?.[id]?.program?.archetype ?? null;
  const buildingPurpose = (id) => state?.buildings?.[id]?.program?.purpose ?? null;
  const officerName = (id) => (
    state?.gameplay?.arcaneOfficers?.[id]?.name
    ?? state?.gameplay?.wardens?.[id]?.name
    ?? id
  );

  const buildingFacts = (list = []) => list.map((buildingId) => {
    const id = String(buildingId);
    refs.add(factRef("building", id));
    return {
      factRef: factRef("building", id),
      buildingId: id,
      name: buildingName(id),
      archetype: buildingArchetype(id),
      purpose: buildingPurpose(id)
    };
  });

  const exposureChanges = Object.fromEntries(Object.entries(facts.exposureChanges ?? {}).map(([id, change]) => {
    refs.add(factRef("building", id));
    return [id, { factRef: factRef("building", id), buildingId: id, name: buildingName(id), ...change }];
  }));

  // Incidents come strictly from the frozen facts. resolveTurn snapshots every
  // incident relevant to the turn (generated, dispatched, and unaddressed) into
  // facts.incidents at settlement time, so a historical backfill never reads
  // live gameplay state and cannot drift as the city changes later.
  const incidents = (facts.incidents ?? []).map((incident) => {
    refs.add(factRef("incident", incident.id));
    return { ...incident, factRef: factRef("incident", incident.id), buildingName: buildingName(incident.buildingId) };
  });

  const unaddressedIncidents = (facts.unaddressedIncidents ?? []).map((entry) => {
    refs.add(factRef("unaddressed", entry.incidentId));
    return { ...entry, factRef: factRef("unaddressed", entry.incidentId), buildingName: buildingName(entry.buildingId) };
  });

  const assignments = (facts.assignments ?? []).map((entry) => {
    refs.add(factRef("assignment", entry.incidentId));
    return { ...entry, factRef: factRef("assignment", entry.incidentId), arcaneOfficerName: officerName(entry.arcaneOfficerId) };
  });

  const rolls = (facts.rolls ?? []).map((entry) => {
    refs.add(factRef("roll", entry.incidentId));
    return { ...entry, factRef: factRef("roll", entry.incidentId), arcaneOfficerName: officerName(entry.arcaneOfficerId) };
  });

  const outcomes = (facts.outcomes ?? []).map((entry) => {
    refs.add(factRef("outcome", entry.incidentId));
    return { ...entry, factRef: factRef("outcome", entry.incidentId), arcaneOfficerName: officerName(entry.arcaneOfficerId) };
  });

  const sealedBuildings = (facts.sealedBuildings ?? []).map((buildingId) => {
    const id = String(buildingId);
    refs.add(factRef("building", id));
    return { factRef: factRef("building", id), buildingId: id, name: buildingName(id) };
  });

  const nextRisks = (facts.nextRisks ?? []).map((entry) => {
    refs.add(factRef("risk", entry.buildingId));
    return { ...entry, factRef: factRef("risk", entry.buildingId), name: buildingName(entry.buildingId) };
  });

  refs.add(factRef("turn"));
  refs.add(factRef("resource-delta"));
  refs.add(factRef("population-delta"));

  const context = {
    schemaVersion: REPORT_CONTEXT_SCHEMA_VERSION,
    cityId,
    turn,
    worldDay: turn,
    factsDigest: factsDigest(facts),
    settlement: {
      settledBy: facts.wallClock?.settledBy ?? null,
      openedAt: facts.wallClock?.openedAt ?? null,
      resolvedAt: facts.wallClock?.resolvedAt ?? null,
      turnDeadlineAt: facts.wallClock?.turnDeadlineAt ?? null,
      nextTurnUnlockAt: facts.wallClock?.nextTurnUnlockAt ?? null
    },
    resourceDelta: { factRef: factRef("resource-delta"), ...facts.resourceDelta },
    populationDelta: { factRef: factRef("population-delta"), ...facts.populationDelta },
    buildingsStarted: buildingFacts(facts.buildingsStarted),
    buildingsCompleted: buildingFacts(facts.buildingsCompleted),
    exposureChanges,
    incidents,
    unresolvedIncidents: incidents.filter((incident) => incident.status !== "resolved"),
    unaddressedIncidents,
    assignments,
    rolls,
    outcomes,
    sealedBuildings,
    nextRisks,
    factRefs: [...refs].sort()
  };
  return deepFreeze(context);
}

export function validateOwlReport(input, context) {
  const errors = [];
  const allowedRefs = new Set((context?.factRefs ?? []).map(String));
  const incidentRefs = new Set((context?.incidents ?? []).map((incident) => incident.factRef));

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ code: "REPORT_NOT_OBJECT", message: "report must be an object", path: "report" }] };
  }

  for (const key of Object.keys(input)) {
    if (!OWL_REPORT_TOP_LEVEL_FIELDS.has(key)) {
      errors.push({ code: "UNKNOWN_REPORT_FIELD", message: `OwlReport contains unsupported field "${key}"; agents may only author newspaper composition, never system facts`, path: key });
    }
  }

  const masthead = input.masthead;
  requireObject(masthead, "masthead", errors);
  if (masthead && typeof masthead === "object" && !Array.isArray(masthead)) {
    rejectUnknownFields(masthead, MASTHEAD_FIELDS, "masthead", errors);
    requireString(masthead, "title", true, LIMITS.mastheadTitle, errors, "masthead.title");
    requireString(masthead, "subtitle", false, LIMITS.mastheadSubtitle, errors, "masthead.subtitle");
  }
  requireString(input, "edition", true, LIMITS.edition, errors, "edition");
  requireString(input, "headline", true, LIMITS.headline, errors, "headline");
  requireString(input, "subheadline", false, LIMITS.subheadline, errors, "subheadline");
  requireString(input, "lead", true, LIMITS.lead, errors, "lead");

  validateArticleArray(input.articles, errors, allowedRefs);
  validateBriefArray(input.briefs, errors, allowedRefs);
  validateActionBox(input.actionBox, errors, allowedRefs, incidentRefs);
  validateTomorrowWatch(input.tomorrowWatch, errors, allowedRefs);

  return { ok: errors.length === 0, errors };
}

function validateArticleArray(value, errors, allowedRefs) {
  if (value == null) return;
  if (!Array.isArray(value)) { errors.push({ code: "INVALID_ARTICLE", message: "articles must be an array", path: "articles" }); return; }
  if (value.length > LIMITS.maxArticles) { errors.push({ code: "TOO_MANY_ARTICLES", message: `at most ${LIMITS.maxArticles} articles per edition`, path: "articles" }); return; }
  const ids = new Set();
  value.forEach((article, index) => {
    const path = `articles[${index}]`;
    const valid = requireObject(article, path, errors);
    if (!valid) return;
    rejectUnknownFields(article, ARTICLE_FIELDS, path, errors);
    if (!isNonEmptyString(article.id)) { errors.push({ code: "ARTICLE_ID_REQUIRED", message: "article.id is required", path }); }
    else if (ids.has(article.id)) { errors.push({ code: "DUPLICATE_ARTICLE_ID", message: `duplicate article id ${article.id}`, path }); }
    else ids.add(article.id);
    requireString(article, "headline", true, LIMITS.articleHeadline, errors, `${path}.headline`);
    requireString(article, "dek", false, LIMITS.articleDek, errors, `${path}.dek`);
    requireString(article, "body", true, LIMITS.articleBody, errors, `${path}.body`);
    requireString(article, "category", false, LIMITS.category, errors, `${path}.category`);
    if (article.importance != null && !ARTICLE_IMPORTANCE.includes(article.importance)) {
      errors.push({ code: "UNSUPPORTED_IMPORTANCE", message: `article.importance must be one of ${ARTICLE_IMPORTANCE.join(", ")}`, path: `${path}.importance` });
    }
    requireFactRefs(article.relatedFactRefs, `${path}.relatedFactRefs`, errors, allowedRefs);
  });
}

function validateBriefArray(value, errors, allowedRefs) {
  if (value == null) return;
  if (!Array.isArray(value)) { errors.push({ code: "INVALID_BRIEF", message: "briefs must be an array", path: "briefs" }); return; }
  if (value.length > LIMITS.maxBriefs) { errors.push({ code: "TOO_MANY_BRIEFS", message: `at most ${LIMITS.maxBriefs} briefs per edition`, path: "briefs" }); return; }
  const ids = new Set();
  value.forEach((brief, index) => {
    const path = `briefs[${index}]`;
    const valid = requireObject(brief, path, errors);
    if (!valid) return;
    rejectUnknownFields(brief, BRIEF_FIELDS, path, errors);
    if (!isNonEmptyString(brief.id)) { errors.push({ code: "BRIEF_ID_REQUIRED", message: "brief.id is required", path }); }
    else if (ids.has(brief.id)) { errors.push({ code: "DUPLICATE_BRIEF_ID", message: `duplicate brief id ${brief.id}`, path }); }
    else ids.add(brief.id);
    requireString(brief, "text", true, LIMITS.briefText, errors, `${path}.text`);
    requireString(brief, "category", false, LIMITS.category, errors, `${path}.category`);
    requireFactRefs(brief.relatedFactRefs, `${path}.relatedFactRefs`, errors, allowedRefs);
  });
}

function validateActionBox(value, errors, allowedRefs, incidentRefs) {
  if (value == null) return;
  if (!Array.isArray(value)) { errors.push({ code: "INVALID_ACTION_BOX", message: "actionBox must be an array", path: "actionBox" }); return; }
  if (value.length > LIMITS.maxActionBoxEntries) { errors.push({ code: "TOO_MANY_ACTION_BOX_ENTRIES", message: `at most ${LIMITS.maxActionBoxEntries} action box entries`, path: "actionBox" }); return; }
  const ids = new Set();
  value.forEach((entry, index) => {
    const path = `actionBox[${index}]`;
    const valid = requireObject(entry, path, errors);
    if (!valid) return;
    rejectUnknownFields(entry, ACTION_BOX_FIELDS, path, errors);
    if (!isNonEmptyString(entry.id)) { errors.push({ code: "ACTION_BOX_ID_REQUIRED", message: "actionBox entry id is required", path }); }
    else if (ids.has(entry.id)) { errors.push({ code: "DUPLICATE_ACTION_BOX_ID", message: `duplicate actionBox id ${entry.id}`, path }); }
    else ids.add(entry.id);
    if (!isNonEmptyString(entry.incidentRef) || !incidentRefs.has(String(entry.incidentRef))) {
      errors.push({ code: "UNKNOWN_INCIDENT_REF", message: "actionBox entry must reference an incident fact ref from this turn's ReportContext", path: `${path}.incidentRef` });
    }
    requireFactRefs(entry.factRefs, `${path}.factRefs`, errors, allowedRefs);
    requireString(entry, "reason", false, LIMITS.reason, errors, `${path}.reason`);
  });
}

function validateTomorrowWatch(value, errors, allowedRefs) {
  if (value == null) return;
  if (!Array.isArray(value)) { errors.push({ code: "INVALID_TOMORROW_WATCH", message: "tomorrowWatch must be an array", path: "tomorrowWatch" }); return; }
  if (value.length > LIMITS.maxTomorrowWatchEntries) { errors.push({ code: "TOO_MANY_TOMORROW_WATCH_ENTRIES", message: `at most ${LIMITS.maxTomorrowWatchEntries} tomorrow watch entries`, path: "tomorrowWatch" }); return; }
  const ids = new Set();
  value.forEach((entry, index) => {
    const path = `tomorrowWatch[${index}]`;
    const valid = requireObject(entry, path, errors);
    if (!valid) return;
    rejectUnknownFields(entry, TOMORROW_WATCH_FIELDS, path, errors);
    if (!isNonEmptyString(entry.id)) { errors.push({ code: "TOMORROW_WATCH_ID_REQUIRED", message: "tomorrowWatch entry id is required", path }); }
    else if (ids.has(entry.id)) { errors.push({ code: "DUPLICATE_TOMORROW_WATCH_ID", message: `duplicate tomorrowWatch id ${entry.id}`, path }); }
    else ids.add(entry.id);
    requireString(entry, "text", true, LIMITS.tomorrowText, errors, `${path}.text`);
    requireFactRefs(entry.factRefs, `${path}.factRefs`, errors, allowedRefs);
  });
}

function requireFactRefs(value, path, errors, allowedRefs) {
  if (value == null) return;
  if (!Array.isArray(value)) { errors.push({ code: "INVALID_FACT_REFS", message: `${path} must be an array of fact refs`, path }); return; }
  if (value.length > LIMITS.maxFactRefsPerEntry) { errors.push({ code: "TOO_MANY_FACT_REFS", message: `${path} lists at most ${LIMITS.maxFactRefsPerEntry} fact refs`, path }); return; }
  for (const ref of value) {
    if (!isNonEmptyString(ref) || !allowedRefs.has(String(ref))) {
      errors.push({ code: "UNKNOWN_FACT_REF", message: `fact ref "${ref}" is not part of this turn's ReportContext`, path });
    }
  }
}

function requireObject(value, path, errors) {
  if (value != null && typeof value === "object" && !Array.isArray(value)) return true;
  errors.push({ code: "FIELD_NOT_OBJECT", message: `${path} must be an object`, path });
  return false;
}

function rejectUnknownFields(object, allowed, path, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      errors.push({ code: "UNKNOWN_REPORT_FIELD", message: `${path} contains unsupported field "${key}"; agents may only author newspaper composition, never system facts`, path: `${path}.${key}` });
    }
  }
}

function requireString(object, key, required, maxLength, errors, path) {
  const value = object?.[key];
  if (value == null || value === "") {
    if (required) errors.push({ code: "FIELD_REQUIRED", message: `${path} is required`, path });
    return;
  }
  if (typeof value !== "string") { errors.push({ code: "FIELD_NOT_STRING", message: `${path} must be a string`, path }); return; }
  if (value.length > maxLength) errors.push({ code: "FIELD_TOO_LONG", message: `${path} exceeds ${maxLength} characters`, path });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Normalizes a validated OwlReport: trims strings, fills optional defaults, and
// deduplicates fact refs. Assumes validateOwlReport passed; it never invents
// gameplay facts or re-authors system values.
export function normalizeOwlReport(input) {
  const articles = (input?.articles ?? []).map((article) => ({
    id: article.id,
    headline: article.headline.trim(),
    ...(article.dek != null ? { dek: article.dek.trim() } : {}),
    body: article.body.trim(),
    ...(article.category != null ? { category: article.category.trim() } : {}),
    importance: article.importance ?? "secondary",
    ...(article.relatedFactRefs?.length ? { relatedFactRefs: [...new Set(article.relatedFactRefs.map(String))] } : {})
  }));
  const briefs = (input?.briefs ?? []).map((brief) => ({
    id: brief.id,
    text: brief.text.trim(),
    ...(brief.category != null ? { category: brief.category.trim() } : {}),
    ...(brief.relatedFactRefs?.length ? { relatedFactRefs: [...new Set(brief.relatedFactRefs.map(String))] } : {})
  }));
  const actionBox = (input?.actionBox ?? []).map((entry) => ({
    id: entry.id,
    incidentRef: String(entry.incidentRef),
    ...(entry.factRefs?.length ? { factRefs: [...new Set(entry.factRefs.map(String))] } : {}),
    ...(entry.reason != null ? { reason: entry.reason.trim() } : {})
  }));
  const tomorrowWatch = (input?.tomorrowWatch ?? []).map((entry) => ({
    id: entry.id,
    text: entry.text.trim(),
    ...(entry.factRefs?.length ? { factRefs: [...new Set(entry.factRefs.map(String))] } : {})
  }));
  return {
    schemaVersion: OWL_REPORT_SCHEMA_VERSION,
    masthead: {
      title: input.masthead.title.trim(),
      ...(input.masthead.subtitle != null ? { subtitle: input.masthead.subtitle.trim() } : {})
    },
    edition: input.edition.trim(),
    headline: input.headline.trim(),
    ...(input.subheadline != null ? { subheadline: input.subheadline.trim() } : {}),
    lead: input.lead.trim(),
    articles,
    briefs,
    ...(actionBox.length ? { actionBox } : {}),
    ...(tomorrowWatch.length ? { tomorrowWatch } : {})
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
