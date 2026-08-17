// Authoritative city-domain block resolution.
//
// A city block is the maximal area of buildable land enclosed by roads,
// bridges, water, city nodes, or the grid edge. Blocks are resolved by
// flood-fill over the live cell grid, so card effects that are scoped to "the
// same block" follow the real urban structure instead of an arbitrary fixed
// grid. Two buildings are in the same block iff their footprint cells belong
// to the same flood-filled component.

const CARDINALS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);

export function isBlockBarrier(state, cell) {
  if (!cell) return true;
  if (cell.buildable === false) return true; // water or otherwise non-buildable
  if (cell.infrastructure === "road" || state.infrastructure?.[cell.id]?.type === "bridge") return true;
  if (cell.node) return true; // city nodes such as the external gateway
  return false;
}

// Returns a Map<cellId, blockId>. The block id is stable and deterministic:
// it is derived from the north-west corner cell of each component.
export function computeCityBlocks(state) {
  const blockForCell = new Map();
  const visited = new Set();
  const cells = state?.cells ?? {};
  for (const cell of Object.values(cells)) {
    if (isBlockBarrier(state, cell) || visited.has(cell.id)) continue;
    const members = [];
    const queue = [cell.id];
    visited.add(cell.id);
    while (queue.length) {
      const current = cells[queue.shift()];
      members.push(current);
      for (const [dx, dy] of CARDINALS) {
        const next = cells[`cell-${current.column + dx}-${current.row + dy}`];
        if (!next || isBlockBarrier(state, next) || visited.has(next.id)) continue;
        visited.add(next.id);
        queue.push(next.id);
      }
    }
    const anchor = members.reduce((best, member) => (
      member.column < best.column || (member.column === best.column && member.row < best.row) ? member : best
    ));
    const blockId = `block-cell-${anchor.column}-${anchor.row}`;
    for (const member of members) blockForCell.set(member.id, blockId);
  }
  return blockForCell;
}

export function cityBlockOf(state, cellId) {
  return computeCityBlocks(state).get(String(cellId ?? "")) ?? null;
}

export function cityBlockOfBuilding(state, building) {
  const cellId = building?.site?.lotId ?? building?.footprintCells?.[0] ?? building?.id;
  return cityBlockOf(state, cellId);
}

// True when two buildings share the same road-bounded city block.
export function sameCityBlock(state, a, b) {
  const blockA = cityBlockOfBuilding(state, a);
  const blockB = cityBlockOfBuilding(state, b);
  return blockA != null && blockA === blockB;
}
