const FOOTPRINTS = new Set(["1x1", "1x2", "1x3", "2x2", "4x1", "4x2"]);
const ENTRANCES = new Set(["north", "east", "south", "west"]);

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

  return {
    id: input.id ?? context.createId?.("proposal") ?? `proposal-${Date.now()}`,
    actor: input.actor ?? "agent:unknown",
    type: "construct_building",
    site: { lotId: String(input.site.lotId), footprint: footprint.id, entrance },
    program: {
      archetype: String(input.program.archetype),
      assetId: input.program.assetId ?? null,
      purpose: input.program.purpose ?? "mixed_use",
      name: input.program.name ?? input.program.archetype,
      description: input.program.description ?? "",
      attributes: { ...(input.program.attributes ?? {}) }
    },
    design: {
      districtStyle: input.design.districtStyle ?? "london_common",
      patterns: [...(input.design.patterns ?? [])],
      prompt: String(input.design.prompt).trim()
    },
    connectionRequest: input.connectionRequest ?? null
  };
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
