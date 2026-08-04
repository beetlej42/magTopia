import { createCityState } from "./state.js";
import { createCityWorkbench } from "./workbench.js";

const STARTER_DESIGNS = [
  {
    actor: "system:starter-district",
    site: { footprint: "1x1" },
    program: { assetId: "starter-cottage-001", archetype: "starter_residence", purpose: "residential", name: "Rosebank Cottage" },
    design: { districtStyle: "london_common", patterns: ["quiet_front_garden"], prompt: "A welcoming compact London brick cottage with a slate roof, warm windows, and a small front threshold." },
    connectionRequest: null
  },
  {
    actor: "system:starter-district",
    site: { footprint: "1x1" },
    program: { assetId: "starter-workshop-001", archetype: "starter_workshop", purpose: "workshop", name: "Brass & Briar Workshop" },
    design: { districtStyle: "london_common", patterns: ["warm_lantern_rhythm"], prompt: "A small Victorian brick workshop with a broad timber door, slate roof, and a practical lantern over the entrance." },
    connectionRequest: null
  },
  {
    actor: "system:starter-district",
    site: { footprint: "1x1" },
    program: { assetId: "starter-herbalist-001", archetype: "starter_herbalist", purpose: "residential", name: "Moss & Moon Herbalist" },
    design: { districtStyle: "willow_magic", patterns: ["preserve_existing_trees", "warm_lantern_rhythm"], prompt: "A friendly magical herbalist cottage with brick walls, slate roof, teal window glow, and restrained botanical details." },
    connectionRequest: null
  }
];

export function createStarterCityWorkbench(worldContract, options = {}) {
  const workbench = createCityWorkbench(createCityState(worldContract, {
    mapSeed: options.mapSeed ?? null,
    resources: { coins: 2400, timber: 600, stone: 600, ...(options.resources ?? {}) }
  }));
  // Two north-facing buildings share one street; the third branches from its
  // midpoint. This deliberately exercises automatic T-junction generation.
  const targets = [[22, 22], [28, 22], [25, 24]];
  const proposals = [];
  const constructionResults = [];
  STARTER_DESIGNS.forEach((design, index) => {
    const candidates = workbench.findCandidateParcels({ footprint: "1x1", limit: 3000 });
    const target = targets[index];
    const lot = candidates.sort((a, b) => distanceToCell(a.lotId, target) - distanceToCell(b.lotId, target))[0];
    if (!lot) return;
    const proposal = {
      ...structuredClone(design),
      site: { lotId: lot.lotId, footprint: "1x1", entrance: lot.entranceDirections.includes("north") ? "north" : lot.entranceDirections[0] }
    };
    proposals.push(proposal);
    constructionResults.push(workbench.submitConstruction(proposal));
  });
  const buildingIds = constructionResults.filter((result) => result.accepted).map((result) => result.building.id);
  const connectionResults = [];
  for (let index = 1; index < buildingIds.length; index += 1) {
    connectionResults.push(workbench.connectRoad({
      fromBuildingId: buildingIds[index - 1],
      toBuildingId: buildingIds[index],
      actor: "system:starter-district"
    }));
  }
  return { workbench, results: [...constructionResults, ...connectionResults], constructionResults, connectionResults, proposals };
}

export function getStarterScenarioProposals() {
  return STARTER_DESIGNS.map((proposal) => structuredClone(proposal));
}

function distanceToCell(id, target) {
  const match = /^cell-(\d+)-(\d+)$/.exec(id);
  if (!match) return Number.POSITIVE_INFINITY;
  return Math.abs(Number(match[1]) - target[0]) + Math.abs(Number(match[2]) - target[1]);
}
