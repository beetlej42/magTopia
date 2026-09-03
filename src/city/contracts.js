import { normalizeDistrictLayout } from "./district-layout.js";

const FOOTPRINTS = new Set(Array.from({ length: 6 }, (_, columnIndex) => (
  Array.from({ length: 6 }, (_, rowIndex) => `${columnIndex + 1}x${rowIndex + 1}`)
)).flat());
const ENTRANCES = new Set(["north", "east", "south", "west"]);
const GAMEPLAY_PURPOSES = new Set(["residential", "commercial", "public_service", "production", "greenhouse"]);
const MAGIC_RATIOS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export function normalizeFootprint(value = "1x1") {
  const footprint = String(value).toLowerCase();
  if (!FOOTPRINTS.has(footprint)) throw new Error(`Unsupported footprint: ${footprint}`);
  const [columns, rows] = footprint.split("x").map(Number);
  return { id: footprint, columns, rows };
}

export function normalizeConstructionProposal(input = {}, context = {}) {
  const footprint = normalizeFootprint(input.site?.footprint);
  const entrance = String(input.site?.entrance ?? "south").toLowerCase();
  if (!ENTRANCES.has(entrance)) throw new Error(`Unsupported entrance direction: ${entrance}`);
  if (!input.site?.lotId) throw new Error("Construction proposal requires site.lot_id (camelCase site.lotId is also accepted)");
  if (!input.program?.archetype) throw new Error("Construction proposal requires program.archetype");
  if (!input.design?.prompt?.trim()) throw new Error("Construction proposal requires design.prompt");

  const submittedGameplayBuilding = input.gameplayBuilding ?? input.gameplay ?? input.program.gameplay;
  const derivedGameplayBuilding = deriveGameplayBuildingFromVoxelDesign(
    input.voxelDesign,
    footprint,
    input.program,
    submittedGameplayBuilding
  );

  return {
    id: input.id ?? context.createId?.("proposal") ?? `proposal-${Date.now()}`,
    actor: input.actor ?? "agent:unknown",
    type: "construct_building",
    districtId: input.districtId ?? input.district_id ?? input.program?.attributes?.districtId ?? null,
    site: {
      lotId: String(input.site.lotId),
      footprint: footprint.id,
      entrance,
      entranceCellId: input.site.entranceCellId ?? input.site.entrance_cell_id ?? input.voxelDesign?.ports?.find((port) => port.type === "primary_entrance")?.frontageCellId ?? null
    },
    program: {
      archetype: String(input.program.archetype),
      assetId: input.program.assetId ?? null,
      purpose: input.program.purpose ?? "mixed_use",
      name: input.program.name ?? input.program.archetype,
      description: input.program.description ?? "",
      attributes: { ...(input.program.attributes ?? {}) }
    },
    // A confirmed voxel design is the geometry authority. The Agent may still
    // describe gameplay purpose/magicRatio per actual floor, but area/cells are
    // never trusted: the gameplay normalizer derives one footprint-area worth
    // of functional cells for each floor in this sanitized grammar.
    gameplayBuilding: derivedGameplayBuilding
      ?? (submittedGameplayBuilding ? structuredClone(submittedGameplayBuilding) : null),
    design: {
      districtStyle: input.design.districtStyle ?? "london_common",
      patterns: [...(input.design.patterns ?? [])],
      prompt: String(input.design.prompt).trim()
    },
    connectionRequest: input.connectionRequest ?? null,
    voxelDesign: input.voxelDesign ? structuredClone(input.voxelDesign) : null
  };
}

function deriveGameplayBuildingFromVoxelDesign(voxelDesign, footprint, program = {}, submittedGameplayBuilding = null) {
  const sourceSpec = voxelDesign?.generation?.sourceSpec;
  if (!sourceSpec) return null;

  const defaultPurpose = canonicalGameplayPurpose(
    voxelDesign.intent?.gameplayPurpose
      ?? voxelDesign.intent?.purpose
      ?? program.gameplayPurpose
      ?? program.purpose,
    voxelDesign.generation?.mode === "urban_massing" ? "public_service" : "residential"
  );
  const submittedFloors = submittedFloorSemantics(submittedGameplayBuilding);

  if (voxelDesign.generation?.mode === "floor_stack" && Array.isArray(sourceSpec.floorSpecs) && sourceSpec.floorSpecs.length) {
    assertSubmittedFloorCount(submittedFloors, sourceSpec.floorSpecs.length);
    return {
      floors: sourceSpec.floorSpecs.map((floor, index) => sanitizeFloorSemantic(
        submittedFloors?.[index],
        canonicalGameplayPurpose(floor.purpose, defaultPurpose)
      ))
    };
  }

  const floorCount = estimateMassingStoreys(sourceSpec);
  assertSubmittedFloorCount(submittedFloors, floorCount);
  return {
    floors: Array.from({ length: floorCount }, (_, index) => sanitizeFloorSemantic(
      submittedFloors?.[index],
      defaultPurpose
    ))
  };
}

function submittedFloorSemantics(value) {
  if (!value || typeof value !== "object") return null;
  for (const field of ["floors", "floorSpecs", "floorPrograms"]) {
    if (Array.isArray(value[field])) return value[field];
  }
  const nested = value.grammar ?? value.massing;
  if (nested && typeof nested === "object") {
    for (const field of ["floors", "floorSpecs", "floorPrograms"]) {
      if (Array.isArray(nested[field])) return nested[field];
    }
  }
  // Old unit/mass grammars may still arrive from stale Agents. They are
  // intentionally ignored for voxel construction because their area is not
  // tied to the confirmed design. Visual floor purposes remain a safe fallback.
  return null;
}

function assertSubmittedFloorCount(submittedFloors, actualFloorCount) {
  if (submittedFloors && submittedFloors.length !== actualFloorCount) {
    throw new Error(`Gameplay floor program count ${submittedFloors.length} does not match confirmed design floor count ${actualFloorCount}`);
  }
}

function sanitizeFloorSemantic(value, fallbackPurpose) {
  return {
    purpose: canonicalGameplayPurpose(value?.purpose, fallbackPurpose),
    magicRatio: normalizeMagicRatio(value?.magicRatio)
  };
}

function canonicalGameplayPurpose(value, fallback = "residential") {
  const text = String(value ?? "").trim().toLowerCase();
  if (GAMEPLAY_PURPOSES.has(text)) return text;
  if (/greenhouse|conservatory|glasshouse/.test(text)) return "greenhouse";
  if (/shop|commercial|retail|market|store|tailor|apothecary/.test(text)) return "commercial";
  if (/workshop|production|atelier|storage|industry|industrial|laboratory|factory/.test(text)) return "production";
  if (/public|civic|library|academy|school|hall|ministry|service|institution/.test(text)) return "public_service";
  if (/home|house|housing|residential|townhouse|cottage|apartment|flat/.test(text)) return "residential";
  return GAMEPLAY_PURPOSES.has(fallback) ? fallback : "residential";
}

function normalizeMagicRatio(value) {
  if (value == null) return 0;
  const number = Number(value);
  const match = MAGIC_RATIOS.find((candidate) => Math.abs(candidate - number) < Number.EPSILON * 8);
  if (!Number.isFinite(number) || match == null) {
    throw new Error(`magicRatio must be one of ${MAGIC_RATIOS.join(", ")}; received ${String(value)}`);
  }
  return match;
}

function estimateMassingStoreys(spec = {}) {
  const structuralMasses = Array.isArray(spec.masses)
    ? spec.masses.filter((mass) => mass?.type !== "ground")
    : [];
  const highest = Math.max(
    ...structuralMasses.map((mass) => Number(mass.baseYVoxels ?? 0) + Number(mass.heightVoxels ?? 0)),
    20
  );
  return Math.max(1, Math.round(highest / 20));
}

export function normalizeConnectionEndpoint(input, label = "endpoint") {
  if (!input || typeof input !== "object") throw new Error(`Connection ${label} is required`);
  const kind = String(input.kind ?? "");
  if (!["building", "cell", "node"].includes(kind)) throw new Error(`Unsupported connection ${label} kind: ${kind}`);
  if (!input.id) throw new Error(`Connection ${label}.id is required`);
  return { kind, id: String(input.id), entrance: input.entrance ?? null };
}

export function normalizeConnectionRequest(input = {}) {
  const from = normalizeConnectionEndpoint(input.from, "from");
  const to = normalizeConnectionEndpoint(input.to, "to");
  if (from.kind === to.kind && from.id === to.id) throw new Error("Connection endpoints must be different");
  return {
    type: "connect",
    from,
    to,
    mode: input.mode ?? "road",
    priority: input.priority ?? "normal",
    actor: input.actor ?? "agent:unknown"
  };
}

export function normalizeDistrictDefinition(input = {}, context = {}) {
  const name = String(input.name ?? "").trim();
  const purpose = String(input.purpose ?? "").trim();
  if (!name || name.length > 80) throw new Error("District name must contain 1–80 characters");
  if (!purpose || purpose.length > 160) throw new Error("District purpose must contain 1–160 characters");
  const sourceBounds = input.bounds ?? {};
  const bounds = {
    minColumn: integerBound(sourceBounds.minColumn ?? sourceBounds.min_column, "minColumn"),
    maxColumn: integerBound(sourceBounds.maxColumn ?? sourceBounds.max_column, "maxColumn"),
    minRow: integerBound(sourceBounds.minRow ?? sourceBounds.min_row, "minRow"),
    maxRow: integerBound(sourceBounds.maxRow ?? sourceBounds.max_row, "maxRow")
  };
  if (bounds.minColumn > bounds.maxColumn || bounds.minRow > bounds.maxRow) throw new Error("District bounds are reversed");
  return {
    id: input.id ?? context.createId?.("district") ?? `district-${Date.now()}`,
    name,
    purpose,
    bounds,
    layout: normalizeDistrictLayout(bounds),
    actor: input.actor ?? "agent:unknown"
  };
}

function integerBound(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`District bounds.${label} must be an integer`);
  return parsed;
}

export function completeAssetPrompt(proposal) {
  const { footprint, entrance } = proposal.site;
  return [
    proposal.design.prompt,
    "PROJECT CONTRACT (must preserve): soft isometric low-poly magical London urban diorama; Victorian-Edwardian brick and slate language; warm afternoon key light and cool blue-grey shadows.",
    `EXACT SITE CONTRACT: ${footprint} parcel, entrance facing ${entrance}, high three-quarter orthographic camera yaw 45 degrees elevation 55 degrees roll 0; building, threshold, steps and hard-surface base fully inside parcel with an 8% clean margin.`,
    "OUTPUT CONTRACT: isolated #FF00FF chroma-key background; no neighbouring buildings, road beyond parcel, characters, vehicles, text, watermark, pixel art, black outlines, photorealism, or front-facing flat storefront."
  ].join("\n\n");
}

export function getFootprintCells(lot, footprint) {
  const shape = normalizeFootprint(footprint);
  const cells = [];
  for (let row = 0; row < shape.rows; row += 1) {
    for (let column = 0; column < shape.columns; column += 1) {
      cells.push(`cell-${lot.column + column}-${lot.row + row}`);
    }
  }
  return cells;
}
