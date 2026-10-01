// Derived scenery: legacy courtyard specs gain the same fountain without save edits.
export function planCourtyardFountain({ plan, bounds, surfaceY, trim, occluders = [] }) {
  const centerX = Math.round((bounds.minX + bounds.maxX) / 2);
  const centerZ = Math.round((bounds.minZ + bounds.maxZ) / 2);
  const span = Math.min(bounds.maxX - bounds.minX + 1, bounds.maxZ - bounds.minZ + 1);
  const radius = Math.min(12, Math.floor(span * 0.19));
  if (radius < 4) return null;
  const height = radius >= 10 ? 13 : 10;
  // Reserve a walking apron too; concave sites and occupied centres are skipped.
  const clearance = radius + 2;
  for (let dz = -clearance; dz <= clearance; dz += 1) {
    for (let dx = -clearance; dx <= clearance; dx += 1) {
      const key = `${centerX + dx},${centerZ + dz}`;
      if (!plan.has(key) || occluders.some(({ mass, plan: occupied }) => (
        occupied.has(key) && mass.baseYVoxels <= surfaceY + height
        && mass.baseYVoxels + mass.heightVoxels > surfaceY
      ))) return null;
    }
  }
  const voxels = new Map();
  const put = (x, y, z, material) => voxels.set(`${x},${y},${z}`, { x, y, z, material });
  const octagon = (x, z, r) => Math.max(Math.abs(x), Math.abs(z)) <= r && Math.abs(x) + Math.abs(z) <= Math.floor(r * 1.5);
  const layer = (r, y, rimOnly, material) => {
    for (let z = -r; z <= r; z += 1) for (let x = -r; x <= r; x += 1) {
      if (octagon(x, z, r) && (!rimOnly || !octagon(x, z, r - 1))) put(x, y, z, material);
    }
  };
  layer(radius, 1, false, trim);
  layer(radius - 1, 2, false, "water");
  layer(radius, 2, true, trim);
  layer(radius, 3, true, trim);
  const bowlY = height - 4;
  for (let y = 2; y < bowlY; y += 1) layer(y === 2 ? 2 : 1, y, false, trim);
  const bowlRadius = radius >= 10 ? 4 : 3;
  layer(bowlRadius - 1, bowlY - 1, false, trim);
  layer(bowlRadius, bowlY, false, trim);
  layer(bowlRadius - 1, bowlY + 1, false, "waterLight");
  layer(bowlRadius, bowlY + 1, true, trim);
  // Small central jet and four descending spill streams, shared by every renderer.
  for (let y = bowlY + 1; y <= height; y += 1) put(0, y, 0, "waterLight");
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let y = 3; y <= bowlY; y += 1) put(dx * bowlRadius, y, dz * bowlRadius, "waterLight");
  }
  return {
    centerX, centerZ, radius, height,
    voxels: [...voxels.values()].map(({ x, y, z, material }) => ({ x: x + centerX, y: y + surfaceY, z: z + centerZ, material }))
  };
}
