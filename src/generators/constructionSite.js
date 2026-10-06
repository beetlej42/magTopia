import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// One reusable, low-poly Victorian worksite. The boundary follows the actual
// occupied cells, including irregular footprints; adjacent cells share no fence.
export function createConstructionSite({ cellWorldSize = 4, cellOffsets = [{ x: 0, z: 0 }], entrance = "south", openSpace = false, underground = false, magicLevel = 0, seed = "site" } = {}) {
  const root = new THREE.Group();
  root.name = "ConstructionSite";
  root.userData.representation = "construction-site";
  const scale = cellWorldSize / 4;
  const cells = cellOffsets.map(({ x, z }) => ({ x: x / scale, z: z / scale }));
  const parts = new Map();
  const colors = { earth: "#988674", stone: "#b5aea0", wood: "#765641", lightWood: "#997859", darkWood: "#4f4038", brick: "#ae7860", canvas: "#526c60", brass: "#b59b63", paper: "#e6d9b9", lamp: "#f1c67b", leaf: "#64775a" };
  const box = (material, x, y, z, w, h, d) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(g);
  };
  const has = (x, z) => cells.some(c => Math.abs(c.x - x) < 0.01 && Math.abs(c.z - z) < 0.01);
  const sides = { north: [0, 1], south: [0, -1], east: [1, 0], west: [-1, 0] };
  const [gx, gz] = sides[entrance] ?? sides.south;
  const gateCell = cells.filter(c => !has(c.x + gx * 4, c.z + gz * 4))
    .sort((a, b) => Math.abs(gx ? a.z : a.x) - Math.abs(gx ? b.z : b.x))[0];
  let edgeCount = 0;
  const fencePosts = new Set();
  // Every gate and fence stays inside its own tile, leaving the road clear.
  for (const cell of cells) {
    box("earth", cell.x, -0.06, cell.z, 3.96, 0.08, 3.96);
    for (const [side, [dx, dz]] of Object.entries(sides)) {
      if (has(cell.x + dx * 4, cell.z + dz * 4)) continue;
      edgeCount++;
      const isGate = cell === gateCell && side === entrance;
      const along = (t, inset = 1.79) => ({ x: cell.x + dx * inset + dz * t, z: cell.z + dz * inset + dx * t });
      for (const t of [-1.79, ...(isGate ? [-0.65, 0.65] : [0]), 1.79]) {
        const p = along(t);
        // Perpendicular fence edges share one post at their intersection.
        const key = `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
        if (fencePosts.has(key)) continue;
        fencePosts.add(key);
        box("darkWood", p.x, 0, p.z, 0.13, 0.95, 0.13);
        box("brass", p.x, 0.94, p.z, 0.17, 0.07, 0.17);
      }
      for (let i = 0; i < 18; i++) {
        const t = -1.65 + i * 0.194;
        if (isGate && Math.abs(t) < 0.64) continue;
        const p = along(t);
        box(i % 3 ? "wood" : "lightWood", p.x, 0.08, p.z, dx ? 0.09 : 0.18, 0.72 + (i % 3) * 0.025, dx ? 0.18 : 0.09);
      }
      for (const y of [0.23, 0.64]) {
        const spans = isGate ? [[-1.2, 1.05], [1.2, 1.05]] : [[0, 3.55]];
        for (const [t, length] of spans) {
          const p = along(t, 1.72); box("darkWood", p.x, y, p.z, dx ? 0.07 : length, 0.09, dx ? length : 0.07);
        }
      }
      if (isGate) {
        // Cream permit placard with chunky line marks, legible as a sign at city scale.
        const p = along(-1.13, 1.87);
        box("paper", p.x, 0.43, p.z, dx ? 0.06 : 0.66, 0.42, dx ? 0.66 : 0.06);
        for (const y of [0.55, 0.67]) box("darkWood", p.x + dx * 0.035, y, p.z + dz * 0.035, dx ? 0.012 : 0.42, 0.035, dx ? 0.42 : 0.012);
        const l = along(0.65);
        box("darkWood", l.x, 0.95, l.z, 0.06, 0.35, 0.06);
        box("lamp", l.x, 1.05, l.z, 0.2, 0.23, 0.2);
        box("darkWood", l.x, 1.28, l.z, 0.27, 0.07, 0.27);
      }
    }
  }
  const hash = [...String(seed)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  for (let i = 0; i < cells.length; i++) {
    const { x, z } = cells[i];
    // Sparse internals allow viewers to read the earth and foundations.
    if (!openSpace) {
      box("stone", x - 0.1, 0.02, z + 0.35, 1.8, 0.19, 0.22);
      box("stone", x - 0.89, 0.02, z - 0.3, 0.22, 0.19, 1.3);
    } else {
      for (const dz of [-0.8, 0.6]) box("paper", x, 0.025, z + dz, 2.4, 0.015, 0.025);
      box("paper", x - 1.2, 0.025, z - 0.1, 0.025, 0.015, 1.4);
    }
    for (let row = 0; row < 3; row++) for (let j = 0; j < 3; j++) {
      box(openSpace ? "stone" : "brick", x + 0.62 + j * 0.21, 0.04 + row * 0.12, z + 0.7 + (row % 2) * 0.06, 0.19, 0.105, 0.42);
    }
    for (let j = 0; j < 3; j++) box("lightWood", x + 0.6 + j * 0.16, 0.03 + (j % 2) * 0.05, z - 0.6, 0.13, 0.11, 1.05);
    // Stepped canvas draped over supplies, not a fully formed building silhouette.
    for (let j = 0; j < 5; j++) box("canvas", x - 0.72 + j * 0.15, 0.03, z + 0.87, 0.15, 0.24 + (2 - Math.abs(j - 2)) * 0.1, 0.67);
    if (underground) {
      box("darkWood", x - 0.28, 0.025, z - 0.4, 1.3, 0.03, 1.2);
      for (const dx of [-0.93, 0.37]) box("lightWood", x + dx, 0.04, z - 0.4, 0.12, 0.2, 1.35);
    }
    if (!openSpace && (i % 2 === 0 || underground)) {
      const height = underground ? 1.55 : 1.65 + (hash % 3) * 0.12;
      for (const dx of [-1.08, 0.12]) for (const dz of [-0.9, -0.15]) box("wood", x + dx, 0, z + dz, 0.12, height, 0.12);
      for (const y of [0.68, height - 0.13]) {
        box("lightWood", x - 0.48, y, z - 0.9, 1.4, 0.11, 0.12);
        box("lightWood", x - 0.48, y, z - 0.15, 1.4, 0.11, 0.12);
      }
      for (let j = 0; j < 4; j++) box("lightWood", x - 0.48, 1.1, z - 0.9 + j * 0.23, 1.5, 0.09, 0.2);
      // Short ladder with substantial rungs: readable in the near city view.
      for (const dx of [0.34, 0.69]) box("wood", x + dx, 0, z - 0.1, 0.07, 1.35, 0.07);
      for (let j = 0; j < 6; j++) box("lightWood", x + 0.515, 0.15 + j * 0.2, z - 0.1, 0.42, 0.06, 0.08);
      if (underground) {
        box("brass", x - 0.48, 1.35, z - 0.52, 0.3, 0.25, 0.3);
        box("darkWood", x - 0.48, 0.12, z - 0.52, 0.035, 1.23, 0.035);
      }
    }
    if (openSpace && i % 2 === 0) {
      box("canvas", x - 0.65, 0.02, z - 0.52, 0.5, 0.32, 0.5);
      box("wood", x - 0.65, 0.3, z - 0.52, 0.12, 0.62, 0.12);
      box("leaf", x - 0.65, 0.7, z - 0.52, 0.55, 0.4, 0.55);
      box("leaf", x - 0.65, 1.05, z - 0.52, 0.3, 0.2, 0.3);
    }
  }
  for (const [key, geometries] of parts) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    const material = new THREE.MeshStandardMaterial({ color: colors[key], roughness: 1, flatShading: true,
      ...(key === "lamp" ? { emissive: colors.lamp, emissiveIntensity: 0.3 } : {}) });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
  }
  // A single static hovering brick is also readable when animation is disabled.
  // Its transform is deliberately fixed so spherical projection stays correct.
  if (magicLevel > 0.3) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.18), new THREE.MeshStandardMaterial({ color: colors.brick, roughness: 1 }));
    mesh.position.set(cells[0].x + 0.5, 0.85, cells[0].z + 0.5); mesh.rotation.y = 0.3;
    mesh.castShadow = true; root.add(mesh);
  }
  root.scale.setScalar(scale);
  root.userData.construction = { footprintCells: cells.length, boundaryEdges: edgeCount, gates: 1, openSpace, underground };
  return root;
}

export function constructionSiteOptions(building) {
  const spec = building.voxelDesign?.generation?.sourceSpec;
  const masses = spec?.masses ?? [];
  const openSpace = masses.length > 0 && masses.every(m => m.type === "ground")
    || /^(park|garden|courtyard|plaza|square)$/.test(building.program?.archetype ?? "");
  return { entrance: building.site?.entrance ?? "south", seed: building.id,
    openSpace, underground: /underground|subway/.test(building.program?.archetype ?? ""),
    magicLevel: Number(building.program?.attributes?.magicLevel ?? building.gameplay?.magicLevel ?? 0) };
}
