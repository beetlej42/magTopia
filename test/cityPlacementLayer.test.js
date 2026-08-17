import assert from "node:assert/strict";
import test from "node:test";
import { footprintWorldSizeForCandidate } from "../src/ui/cityPlacementLayer.js";

test("a 1x1 lot previews a single-cell footprint", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-2-3", footprintCells: ["cell-2-3"] },
    4
  );
  assert.deepEqual(size, { width: 4, depth: 4 });
});

test("a 2x2 lot previews a two-by-two footprint", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-2-3", footprintCells: ["cell-2-3", "cell-3-3", "cell-2-4", "cell-3-4"] },
    4
  );
  assert.deepEqual(size, { width: 8, depth: 8 });
});

test("an explicit footprint hint overrides the derived cell count", () => {
  const size = footprintWorldSizeForCandidate(
    { lotId: "cell-1-1", footprintCells: ["cell-1-1"], footprintColumns: 3, footprintRows: 2 },
    4
  );
  assert.deepEqual(size, { width: 12, depth: 8 });
});

test("a lot without footprint cells falls back to a single cell", () => {
  assert.deepEqual(footprintWorldSizeForCandidate({ lotId: "cell-0-0" }, 4), { width: 4, depth: 4 });
  assert.deepEqual(footprintWorldSizeForCandidate(null, 4), { width: 4, depth: 4 });
});
