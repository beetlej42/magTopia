export { createBlankVoxelWorldContract } from "../../src/city/voxel-world.js";
import { createBlankVoxelWorldContract } from "../../src/city/voxel-world.js";

export function createServiceWorldContract(options = {}) {
  return createBlankVoxelWorldContract(options);
}
