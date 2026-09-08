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

test("Sunlit Storybook exposes immutable semantic roles and restrained variants", () => {
  for (const role of requiredMaterialRoles) {
    assert.match(SUNLIT_STORYBOOK_THEME.materials[role], /^#[0-9a-f]{6}$/i, role);
    assert.ok(SUNLIT_STORYBOOK_THEME.materialVariants[role].length >= 2, `${role} variants`);
    assert.ok(Object.isFrozen(SUNLIT_STORYBOOK_THEME.materialVariants[role]), `${role} immutable`);
  }
  assert.ok(Object.isFrozen(SUNLIT_STORYBOOK_THEME));
  assert.equal(SUNLIT_STORYBOOK_THEME.atmosphere.enabled, true);
  assert.ok(SUNLIT_STORYBOOK_THEME.atmosphere.near < SUNLIT_STORYBOOK_THEME.atmosphere.far);
});

test("visual theme selection is deterministic and defaults to Sunlit Storybook", () => {
  assert.equal(resolveVisualTheme("legacy"), LEGACY_VISUAL_THEME);
  assert.equal(resolveVisualTheme("LEGACY"), LEGACY_VISUAL_THEME);
  assert.equal(resolveVisualTheme("sunlit"), SUNLIT_STORYBOOK_THEME);
  assert.equal(resolveVisualTheme("unknown"), SUNLIT_STORYBOOK_THEME);
  assert.equal(visualThemeFromLocation({ search: "?visualTheme=legacy" }), LEGACY_VISUAL_THEME);
  assert.equal(visualThemeFromLocation({ search: "?visualTheme=sunlit" }), SUNLIT_STORYBOOK_THEME);
});
