import { createMoleway, MOLEWAY_ASSET_ID } from "./moleway.js";
import { createOwlTower, OWL_TOWER_ASSET_ID } from "./owlTower.js";
import { createVoxelBuildingFromSpec, createVoxelMassingLab } from "./voxelBuildingLab.js";
import { createMinistryOfMagic, MINISTRY_ASSET_ID } from "./ministryOfMagic.js";
import { createDiagonAlley, DIAGON_ASSET_ID } from "./diagonAlley.js";

// Keep confirmation, city rendering and offline visualization on the same compiler.
export function createBuildingDesignObject(design, renderOptions = {}) {
  if (!design?.generation?.sourceSpec) throw new Error("Building design has no source spec to compile");
  if (design.generation.mode === "landmark_prefab" && design.generation.sourceSpec.assetId === MOLEWAY_ASSET_ID) return createMoleway(renderOptions);
  const options = { ...renderOptions, decorations: design.decorations, renderStrategy: "greedy" };
  if (design.generation.mode === "landmark_prefab" && design.generation.sourceSpec.assetId === OWL_TOWER_ASSET_ID) return createOwlTower(renderOptions);
  if (design.generation.mode === "landmark_prefab" && design.generation.sourceSpec.assetId === DIAGON_ASSET_ID) return createDiagonAlley(renderOptions);
  if (design.generation.mode === "landmark_prefab" && design.generation.sourceSpec.assetId === MINISTRY_ASSET_ID) {
    return createMinistryOfMagic(renderOptions);
  }
  if (design.generation.mode === "urban_massing") {
    return createVoxelMassingLab({ spec: design.generation.sourceSpec, ...options });
  }
  if (design.generation.mode === "floor_stack") return createVoxelBuildingFromSpec(design.generation.sourceSpec, options);
  throw new Error(`Unsupported building generation mode: ${design.generation.mode}`);
}

export function buildingEntranceRotation(entrance = "south") {
  return ({ north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 })[entrance] ?? Math.PI;
}

export function disposeBuildingObject(object) {
  object?.traverse((child) => {
    child.geometry?.dispose?.();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) material?.dispose?.();
  });
}
