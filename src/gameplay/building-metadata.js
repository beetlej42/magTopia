import {
  GAMEPLAY_GRAMMAR_FIELDS,
  GAMEPLAY_PURPOSES,
  hasGameplayGrammar,
  normalizeGameplayBuilding,
} from "./schema.js";

const CATEGORY_BY_PURPOSE = Object.freeze({
  residential: "residential",
  home: "residential",
  housing: "residential",
  shop: "commercial",
  commercial: "commercial",
  retail: "commercial",
  visitor_service: "commercial",
  market: "commercial",
  workshop: "workshop",
  storage: "workshop",
  industry: "workshop",
  laboratory: "workshop",
  civic: "civic",
  institutional: "civic",
  education: "civic",
  school: "civic",
  library: "civic",
  office: "civic",
  theatre: "civic",
  theater: "civic",
  park: "green",
  garden: "green",
  plaza: "green",
  open_space: "green"
});

const CATEGORY_BY_FRONTAGE = Object.freeze({
  residential: "residential",
  display: "commercial",
  workshop: "workshop",
  large_bay: "workshop",
  institutional: "civic"
});

const COIN_OUTPUT_BY_CATEGORY = Object.freeze({
  residential: 6,
  commercial: 12,
  workshop: 12,
  civic: 4,
  green: 2,
  mixed: 4
});

const MAGIC_OUTPUT_BY_CATEGORY = Object.freeze({
  residential: 4,
  commercial: 5,
  workshop: 6,
  civic: 3,
  green: 1,
  mixed: 4
});

const MUGGLE_CAPACITY_BY_CATEGORY = Object.freeze({
  residential: 4,
  commercial: 2,
  workshop: 1,
  civic: 6,
  green: 0,
  mixed: 3
});

const CONCEALMENT_BY_CATEGORY = Object.freeze({
  residential: 1.2,
  commercial: 2,
  workshop: 1,
  civic: 1.8,
  green: 0.6,
  mixed: 1
});

const JOBS_BY_CATEGORY = Object.freeze({
  residential: 1,
  commercial: 4,
  workshop: 6,
  civic: 5,
  green: 1,
  mixed: 2
});

const VISIBILITY_BY_PROMINENCE = Object.freeze({ ordinary: 0.5, important: 0.8, landmark: 1.2 });

export function getMagicLevel(building, fallback = 0.35) {
  const candidates = [
    building?.program?.attributes?.magicLevel,
    building?.program?.intent?.magicLevel,
    building?.program?.magicLevel,
    building?.voxelDesign?.intent?.magicLevel,
    building?.voxelDesign?.generation?.sourceSpec?.intent?.magicLevel,
    building?.voxelDesign?.generation?.sourceSpec?.magicLevel,
    building?.attributes?.magicLevel
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.min(1, Math.max(0, number));
  }
  return fallback;
}

export function getProminence(building) {
  const value = building?.program?.intent?.prominence
    ?? building?.voxelDesign?.intent?.prominence
    ?? building?.program?.attributes?.prominence
    ?? "ordinary";
  return VISIBILITY_BY_PROMINENCE[value] ?? VISIBILITY_BY_PROMINENCE.ordinary;
}

export function getBuildingCategory(building) {
  const purpose = String(building?.program?.purpose ?? building?.purpose ?? "").toLowerCase();
  const archetype = String(building?.program?.archetype ?? building?.archetype ?? "").toLowerCase();
  const frontage = String(building?.program?.intent?.frontage ?? building?.intent?.frontage ?? "").toLowerCase();
  const matched = [purpose, archetype, frontage]
    .map((text) => CATEGORY_BY_PURPOSE[text] ?? CATEGORY_BY_FRONTAGE[text])
    .find(Boolean);
  return matched ?? "mixed";
}

export function footprintArea(building) {
  const cells = building?.footprintCells?.length;
  if (Number.isInteger(cells) && cells > 0) return cells;
  const footprint = String(building?.program?.footprint ?? building?.site?.footprint ?? "1x1");
  const match = /^(\d+)x(\d+)$/.exec(footprint);
  if (match) return Number(match[1]) * Number(match[2]);
  return 1;
}

function canonicalGameplayInput(building, options) {
  const explicit = options.gameplayBuilding
    ?? building?.gameplayBuilding
    ?? building?.gameplay
    ?? building?.program?.gameplay;
  if (explicit) return explicit;

  const source = building?.voxelDesign?.generation?.sourceSpec ?? building?.voxelDesign ?? building;
  const grammarKeys = GAMEPLAY_GRAMMAR_FIELDS;
  const grammarEntries = grammarKeys.flatMap((key) => Array.isArray(source?.[key]) ? source[key] : []);
  const nestedGrammarSources = [source?.massing, source?.grammar].filter(Boolean);
  const nestedGrammarEntries = nestedGrammarSources.flatMap((container) => grammarKeys
    .flatMap((key) => Array.isArray(container[key]) ? container[key] : []));
  const allGrammarEntries = [...grammarEntries, ...nestedGrammarEntries];
  const hasFunctionalFields = ["units", "functionalUnits"].some((key) => Array.isArray(source?.[key]))
    || nestedGrammarSources.some((container) => ["units", "functionalUnits"]
      .some((key) => Array.isArray(container[key])));
  // A units/functionalUnits field is an explicit gameplay contract.  The
  // visual floor/mass grammars are only gameplay when they carry purpose
  // annotations; unannotated geometry remains on the legacy path.
  const allPurposesCanonical = allGrammarEntries.length > 0
    && allGrammarEntries.every((entry) => GAMEPLAY_PURPOSES.includes(String(entry?.purpose ?? "").toLowerCase()));
  const hasCanonicalGrammar = hasFunctionalFields
    || (allGrammarEntries.length > 0 && allPurposesCanonical);
  const hasGrammar = hasGameplayGrammar(source);
  const hasExplicitTopLevelGrammar = source === building && (
    hasGameplayGrammar(source)
  );
  const gameplayGrammarPresent = hasExplicitTopLevelGrammar || hasCanonicalGrammar;
  const purpose = building?.program?.purpose ?? building?.purpose ?? source?.purpose;
  const validRootPurpose = purpose == null || GAMEPLAY_PURPOSES.includes(String(purpose).toLowerCase());
  if (hasGrammar && gameplayGrammarPresent && validRootPurpose) {
    return {
      ...source,
      ...(purpose == null ? {} : { purpose }),
      footprintCells: building?.footprintCells ?? source?.footprintCells,
      site: building?.site ?? source?.site,
      magicRatio: options.magicRatio ?? source?.magicRatio ?? building?.magicRatio
    };
  }
  // Explicitly annotated grammar with an invalid root purpose must not be
  // silently downgraded to legacy metadata.  Let the canonical normalizer
  // produce the actionable purpose error.
  if (hasGrammar && gameplayGrammarPresent && purpose != null) {
    return { ...source, purpose };
  }
  return null;
}

function deriveCanonicalGameplayBuilding(building, input) {
  const normalized = normalizeGameplayBuilding(input, { canonical: true });
  return {
    schemaVersion: normalized.schemaVersion,
    canonical: true,
    units: normalized.units,
    functionalAreas: normalized.functionalAreas,
    defaultMagicRatio: normalized.defaultMagicRatio
  };
}

export function deriveGameplayBuilding(building, options = {}) {
  const canonicalInput = canonicalGameplayInput(building, options);
  if (canonicalInput) return deriveCanonicalGameplayBuilding(building, canonicalInput);
  const category = options.category ?? getBuildingCategory(building);
  const magicLevel = options.magicLevel ?? getMagicLevel(building);
  const area = footprintArea(building);
  const numeric = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  // System-owned special structure effects (daily cards) override the generic
  // category defaults. The values live in the card catalog; neither players nor
  // Agents can author them.
  const special = building?.specialStructure?.effect ?? null;
  const raw = {
    category,
    magicLevel,
    muggleCapacity: numeric(options.muggleCapacity, Math.round(MUGGLE_CAPACITY_BY_CATEGORY[category] * area)),
    wizardCapacity: numeric(options.wizardCapacity, special?.wizardCapacity != null ? Number(special.wizardCapacity) : Math.ceil(area * magicLevel * 8)),
    coinOutput: numeric(options.coinOutput, special?.coinOutput != null ? Number(special.coinOutput) : Math.round(COIN_OUTPUT_BY_CATEGORY[category] * area * (1 - magicLevel * 0.2))),
    magicOutput: numeric(options.magicOutput, special?.magicOutput != null ? Number(special.magicOutput) : Math.round(MAGIC_OUTPUT_BY_CATEGORY[category] * area * magicLevel)),
    concealment: numeric(options.concealment, special?.concealmentBonus != null ? Number(special.concealmentBonus) : CONCEALMENT_BY_CATEGORY[category] * (1 - magicLevel * 0.8)),
    activity: numeric(options.activity, 0.2 + magicLevel * 0.8),
    visibility: numeric(options.visibility, getProminence(building)),
    jobs: numeric(options.jobs, Math.round(JOBS_BY_CATEGORY[category] * area)),
    exposure: numeric(options.exposure, numeric(building?.exposure ?? building?.attributes?.exposure, 0)),
    status: options.status ?? building?.status ?? "active"
  };
  return normalizeGameplayBuilding(raw);
}

export function isSealedMetadata(metadata) {
  return metadata?.status === "sealed" || metadata?.exposure >= 100;
}
