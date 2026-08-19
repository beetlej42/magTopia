// PR #52 — Deterministic special-structure building preview.
//
// A pending special-structure placement has no server-authored `voxelDesign`
// yet (it only exists after /cards/place completes), so the placement ghost
// cannot clone the final building geometry. Instead every special-structure
// card gets a deterministic BuildingSpec (seeded by card id, sized to its
// footprint) that is rendered through the same voxel building grammar the city
// uses for ordinary buildings. Each card maps to a distinct archetype/height/
// roof profile so the preview carries an actual building silhouette (tower,
// shopfront, service station, statue, herb plot) instead of a generic cube.
//
// The placement layer clones this preview, replaces its materials with the
// translucent ghost material, and orients it on the sphere; the preview is
// cached per card so panning across cells never rebuilds the voxel geometry.

import { createBuildingSpec } from "../generators/voxelBuildingGrammar.js";
import { createVoxelBuildingFromSpec, VOXEL_SIZE } from "../generators/voxelBuildingLab.js";

// Per-card preview profiles. Only the building grammar's archetypes / styles /
// roof forms are used; heights and roof forms are chosen so distinct special
// buildings read differently in the ghost.
const PREVIEW_PROFILES = Object.freeze({
  "owl-tower": Object.freeze({
    archetype: "townhouse",
    style: "london_brick",
    roofForm: "hip",
    baseFloors: 7,
    variation: 0.5
  }),
  "floo-fireplace-station": Object.freeze({
    archetype: "workshop",
    style: "london_brick",
    roofForm: "gable_cross",
    baseFloors: 2,
    variation: 0.6
  }),
  "diagon-alley-entrance": Object.freeze({
    archetype: "magic_shop",
    style: "violet_alchemist",
    roofForm: "hip",
    baseFloors: 2,
    variation: 0.7
  }),
  "concealment-statue": Object.freeze({
    archetype: "townhouse",
    style: "london_brick",
    roofForm: "gable_street",
    baseFloors: 1,
    variation: 0.3
  }),
  "moonlight-herb-plot": Object.freeze({
    archetype: "workshop",
    style: "forest_craft",
    roofForm: "gable_street",
    baseFloors: 1,
    variation: 0.4
  })
});

// Builds the deterministic BuildingSpec for a special-structure card, sized to
// the card's footprint in world units (cellWorldSize per logical cell).
export function createSpecialStructurePreviewSpec(card = {}, cellWorldSize = 4) {
  const structure = card.structure ?? {};
  const footprint = String(structure.footprint ?? "1x1").toLowerCase();
  const [columns = 1, rows = 1] = footprint.split("x").map((value) => Math.max(1, Number(value)));
  const profile = PREVIEW_PROFILES[card.card_id] ?? {};
  const cellVoxels = Math.max(8, Math.round((Number(cellWorldSize) || 4) / VOXEL_SIZE));
  return createBuildingSpec({
    id: `special-preview-${card.card_id ?? "structure"}`,
    seed: `special-preview-${card.card_id ?? "structure"}`,
    widthVoxels: columns * cellVoxels,
    depthVoxels: rows * cellVoxels,
    baseFloors: profile.baseFloors ?? 2,
    floorHeight: 20,
    variation: profile.variation ?? 0.5,
    archetype: profile.archetype ?? "townhouse",
    style: profile.style ?? "london_brick",
    roofForm: profile.roofForm ?? "gable_street",
    detailDensity: 0.5
  });
}

// Renders the preview spec into a voxel mesh group (same machinery the city
// uses for voxel buildings). The placement layer replaces the materials with a
// translucent ghost material before display.
export function createSpecialStructurePreview(spec) {
  if (!spec?.specVersion || !spec?.floorSpecs?.length) {
    throw new Error("A complete BuildingSpec is required for the special structure preview");
  }
  return createVoxelBuildingFromSpec(spec, { renderStrategy: "greedy" });
}

// Uniform world-space scale that maps the built (possibly grammar-clamped)
// footprint onto the card's logical footprint in world units.
export function previewFootprintScale(spec, columns = 1, rows = 1, cellWorldSize = 4) {
  const desiredWidth = Math.max(1, Number(columns)) * (Number(cellWorldSize) || 4);
  const desiredDepth = Math.max(1, Number(rows)) * (Number(cellWorldSize) || 4);
  const builtWidth = Math.max(0.001, Number(spec?.footprint?.worldWidth ?? desiredWidth));
  const builtDepth = Math.max(0.001, Number(spec?.footprint?.worldDepth ?? desiredDepth));
  return {
    x: desiredWidth / builtWidth,
    z: desiredDepth / builtDepth
  };
}

// Entrance yaw convention shared with the city renderer
// (createRuntimeVoxelBuilding in magicLondonStarterDistrict.js): the authored
// door faces +Z (north) and is rotated to the requested entrance direction.
export const ENTRANCE_YAW_DEGREES = Object.freeze({
  north: 0,
  east: 90,
  south: 180,
  west: -90
});
