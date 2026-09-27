import { createVoxelBuildingFromSpec, createVoxelMassingLab } from "./voxelBuildingLab.js";

// Keep confirmation, city rendering and offline visualization on the same compiler.
export function createBuildingDesignObject(design, renderOptions = {}) {
  if (!design?.generation?.sourceSpec) throw new Error("Building design has no source spec to compile");
  const options = { ...renderOptions, decorations: design.decorations, renderStrategy: "greedy" };
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
