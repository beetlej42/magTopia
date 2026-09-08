import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_VISUAL_THEME,
  SUNLIT_STORYBOOK_THEME,
  resolveVisualTheme,
  visualThemeFromLocation
} from "../src/render/sunlitStorybookTheme.js";

const requiredMaterialRoles = [
  "brickRed", "brickBrown", "sandstone", "limestone", "stoneShadow", "slate",
  "timber", "iron", "patinaMetal", "grass", "grassLight", "grassDark",
  "foliage", "foliageLight", "foliageDark", "soil", "road", "pavement",
  "water", "waterLight", "warmWindow", "violetMagic", "tealMagic"
];
const requiredTerrainRoles = [
  "grass", "grassLight", "grassDark", "water", "waterLight", "shore",
  "road", "pavement", "parcel", "soil", "stone"
];
const requiredTreePaletteRoles = [
  "foliage", "birchFoliage", "pineFoliage", "yewFoliage",
  "timber", "birchTimber", "pineTimber"
];

test("Sunlit Storybook exposes immutable semantic roles and restrained variants", () => {
  for (const role of requiredMaterialRoles) {
    assert.match(SUNLIT_STORYBOOK_THEME.materials[role], /^#[0-9a-f]{6}$/i, role);
    assert.ok(SUNLIT_STORYBOOK_THEME.materialVariants[role].length >= 2, `${role} variants`);
    assert.ok(Object.isFrozen(SUNLIT_STORYBOOK_THEME.materialVariants[role]), `${role} immutable`);
  }
  for (const role of requiredTerrainRoles) {
    assert.match(SUNLIT_STORYBOOK_THEME.terrain[role], /^#[0-9a-f]{6}$/i, `terrain.${role}`);
  }
  for (const role of requiredTreePaletteRoles) {
    assert.ok(SUNLIT_STORYBOOK_THEME.treePalettes[role].length >= 3, `treePalettes.${role}`);
    assert.ok(Object.isFrozen(SUNLIT_STORYBOOK_THEME.treePalettes[role]), `treePalettes.${role} immutable`);
  }
  assert.ok(Object.isFrozen(SUNLIT_STORYBOOK_THEME));
  assert.equal(SUNLIT_STORYBOOK_THEME.atmosphere.enabled, true);
  assert.ok(SUNLIT_STORYBOOK_THEME.atmosphere.near < SUNLIT_STORYBOOK_THEME.atmosphere.far);
});

test("legacy terrain roles preserve the pre-theme runtime baseline", () => {
  assert.deepEqual(LEGACY_VISUAL_THEME.terrain, {
    grass: "#76925a", grassLight: "#91a967", grassDark: "#4f7047",
    water: "#4389a8", waterLight: "#579bb5", shore: "#b99f78",
    road: "#696c70", pavement: "#a8a198", parcel: "#8d9e69",
    soil: "#765a45", stone: "#77766d"
  });
});

test("visual theme selection is deterministic and defaults to Sunlit Storybook", () => {
  assert.equal(resolveVisualTheme("legacy"), LEGACY_VISUAL_THEME);
  assert.equal(resolveVisualTheme("LEGACY"), LEGACY_VISUAL_THEME);
  assert.equal(resolveVisualTheme("sunlit"), SUNLIT_STORYBOOK_THEME);
  assert.equal(resolveVisualTheme("unknown"), SUNLIT_STORYBOOK_THEME);
  assert.equal(visualThemeFromLocation({ search: "?visualTheme=legacy" }), LEGACY_VISUAL_THEME);
  assert.equal(visualThemeFromLocation({ search: "?visualTheme=sunlit" }), SUNLIT_STORYBOOK_THEME);
});
