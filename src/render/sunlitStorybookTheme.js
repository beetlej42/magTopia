const freezeTheme = (theme) => Object.freeze({
  ...theme,
  materials: Object.freeze({ ...theme.materials }),
  materialVariants: Object.freeze(Object.fromEntries(
    Object.entries(theme.materialVariants).map(([key, colors]) => [key, Object.freeze([...colors])])
  )),
  terrain: Object.freeze({ ...theme.terrain }),
  treePalettes: Object.freeze(Object.fromEntries(
    Object.entries(theme.treePalettes).map(([key, colors]) => [key, Object.freeze([...colors])])
  )),
  environment: Object.freeze({ ...theme.environment }),
  grading: Object.freeze({ ...theme.grading }),
  aerialPerspective: Object.freeze({ ...theme.aerialPerspective }),
  toon: Object.freeze({ ...theme.toon })
});

const legacyMaterials = {
  brickRed: "#9f5847", brickBrown: "#62453f", sandstone: "#c9b796",
  limestone: "#d8d0c0", stoneShadow: "#8f8475", slate: "#485262",
  timber: "#273f3d", iron: "#252b31", patinaMetal: "#536d6b",
  grass: "#76925a", grassLight: "#91a967", grassDark: "#4f7047",
  foliage: "#557748", foliageLight: "#78965a", foliageDark: "#355b43",
  soil: "#765442", road: "#686b70", pavement: "#aaa49a",
  water: "#3e87aa", waterLight: "#70b4c9", warmWindow: "#f1b65b",
  violetMagic: "#8067b8", tealMagic: "#5dacaa"
};

const legacyVariants = {
  brickRed: ["#9f5847", "#a9634f", "#8f4d40", "#b06b54"],
  brickBrown: ["#62453f", "#704b42", "#583d39", "#795148"],
  sandstone: ["#c9b796", "#d4c4a6", "#baa783"], stoneShadow: ["#8f8475", "#9b8e7d", "#7c746a"],
  limestone: ["#d8d0c0", "#c9c1b4", "#e0d9ca"], slate: ["#485262", "#566173", "#3c4655", "#626b7a"],
  timber: ["#273f3d", "#2e4d48", "#3f312c", "#4c382f"],
  foliage: ["#557748", "#6d8b50", "#3f6849", "#8b9950"], foliageDark: ["#355b43", "#41694a", "#294e3b"],
  foliageLight: ["#78965a", "#8aa568", "#66884f"], grass: ["#76925a", "#819d61", "#68844e", "#8ca66b"],
  grassLight: ["#91a967", "#9ab374", "#829d5d"], grassDark: ["#4f7047", "#5b7b4e", "#45643f"],
  soil: ["#765442", "#684939", "#815d48"], water: ["#3e87aa", "#4a96b8", "#367a9d"],
  waterLight: ["#70b4c9", "#62a8c1", "#82bfd0"], warmWindow: ["#f1b65b", "#ffc96d", "#df9345"],
  violetMagic: ["#8067b8", "#9a79d0", "#684f9e"], tealMagic: ["#5dacaa", "#78c4b9", "#438f91"],
  iron: ["#252b31", "#343a40", "#1c2228"], patinaMetal: ["#536d6b", "#607b77", "#405c5b"],
  pavement: ["#aaa49a", "#b9b2a6", "#96938e"], road: ["#686b70", "#74767a", "#5e6268"]
};

const legacyTerrain = {
  grass: "#76925a", grassLight: "#91a967", grassDark: "#4f7047",
  water: "#4389a8", waterLight: "#579bb5", shore: "#b99f78",
  road: "#696c70", pavement: "#a8a198", parcel: "#8d9e69",
  soil: "#765a45", stone: "#77766d"
};

const legacyTreePalettes = {
  foliage: ["#244832", "#365d39", "#527842", "#779650"],
  birchFoliage: ["#31543a", "#4c7042", "#72904e", "#9cac62"],
  pineFoliage: ["#193b31", "#28503c", "#386348", "#53795a"],
  yewFoliage: ["#112f28", "#1d4533", "#2d5c3d", "#47734c"],
  timber: ["#493224", "#62442b", "#795735"],
  birchTimber: ["#62635b", "#989687", "#cac6ad"],
  pineTimber: ["#59321f", "#824a28", "#aa6733"]
};

export const LEGACY_VISUAL_THEME = freezeTheme({
  id: "legacy",
  materials: legacyMaterials,
  materialVariants: legacyVariants,
  terrain: legacyTerrain,
  treePalettes: legacyTreePalettes,
  environment: {
    middaySkyTop: "#80bad9", middayHorizon: "#d8edf2", cloudLight: "#fff7e7",
    cloudShadow: "#b9cbd3", sun: "#fff0c7", twilightSun: "#e17d5c",
    ambientSky: "#dceef2", ambientGround: "#99a58f",
    twilightAmbientSky: "#202a49", twilightAmbientGround: "#202738"
  },
  grading: { toneMapping: "none", exposure: 1 },
  aerialPerspective: {
    enabled: false, near: 44, far: 185, strength: 0,
    horizonStrength: 0, saturationReduction: 0, contrastReduction: 0, shadowLift: 0
  },
  toon: {
    enabled: false, strength: 0, shadowLevel: 0.72, midLevel: 0.92,
    highlightLevel: 1.08, transitionSoftness: 0.09
  }
});

const sunlitMaterials = {
  brickRed: "#ef8a4e", brickBrown: "#d07f5d", sandstone: "#e4cea5",
  limestone: "#ece0c7", stoneShadow: "#a39787", slate: "#5e7088",
  timber: "#493f35", iron: "#34383a", patinaMetal: "#607a70",
  grass: "#adb97b", grassLight: "#a5b88a", grassDark: "#71875f",
  foliage: "#78915f", foliageLight: "#8ea670", foliageDark: "#5b744d",
  soil: "#80614d", road: "#777a78", pavement: "#b8b0a4",
  water: "#5e93a6", waterLight: "#88b7c0", warmWindow: "#f2b75f",
  violetMagic: "#8873b3", tealMagic: "#66a9a2"
};

const family = (base, ...variants) => [base, ...variants];
const sunlitVariants = {
  brickRed: family(sunlitMaterials.brickRed, "#f59859", "#df7943", "#e98349"),
  brickBrown: family(sunlitMaterials.brickBrown, "#dc8b65", "#bf704f"),
  sandstone: family(sunlitMaterials.sandstone, "#e4d1b0", "#d0bb9b"), stoneShadow: family(sunlitMaterials.stoneShadow, "#ada092", "#998d7e"),
  limestone: family(sunlitMaterials.limestone, "#ece2ce", "#d8cebb"), slate: family(sunlitMaterials.slate, "#687b92", "#53657d", "#708198"),
  timber: family(sunlitMaterials.timber, "#54483c", "#41382f"),
  foliage: family(sunlitMaterials.foliage, "#839a68", "#6e8757"), foliageDark: family(sunlitMaterials.foliageDark, "#657e55", "#526b47"),
  foliageLight: family(sunlitMaterials.foliageLight, "#98ad79", "#839967"), grass: family(sunlitMaterials.grass, "#b5bf85", "#a0ad70"),
  grassLight: family(sunlitMaterials.grassLight, "#afbf93", "#9aac7f"), grassDark: family(sunlitMaterials.grassDark, "#7c9168", "#687d57"),
  soil: family(sunlitMaterials.soil, "#8a6954", "#755947"), water: family(sunlitMaterials.water, "#69a0b1", "#54889c"),
  waterLight: family(sunlitMaterials.waterLight, "#94c0c8", "#7cabb6"), warmWindow: family(sunlitMaterials.warmWindow, "#f7c46e", "#e8a950"),
  violetMagic: family(sunlitMaterials.violetMagic, "#9681c0", "#7964a6"), tealMagic: family(sunlitMaterials.tealMagic, "#73b6ae", "#589b96"),
  iron: family(sunlitMaterials.iron, "#414648", "#2c3133"), patinaMetal: family(sunlitMaterials.patinaMetal, "#6d887d", "#536d65"),
  pavement: family(sunlitMaterials.pavement, "#c1b9ad", "#aaa398"), road: family(sunlitMaterials.road, "#828582", "#6d716f")
};

const sunlitTerrain = {
  grass: sunlitMaterials.grass, grassLight: sunlitMaterials.grassLight, grassDark: sunlitMaterials.grassDark,
  water: sunlitMaterials.water, waterLight: sunlitMaterials.waterLight, shore: sunlitMaterials.sandstone,
  road: sunlitMaterials.road, pavement: sunlitMaterials.pavement, parcel: sunlitMaterials.grassLight,
  soil: sunlitMaterials.soil, stone: sunlitMaterials.stoneShadow
};

const sunlitTreePalettes = {
  foliage: ["#5e7a50", "#718b5c", "#849c69", "#99ad7a"],
  birchFoliage: ["#68845a", "#7c9568", "#8fa777", "#a0b486"],
  pineFoliage: ["#466458", "#557466", "#668578", "#789689"],
  yewFoliage: ["#40594b", "#4e6856", "#5f7a61", "#728c71"],
  timber: ["#584335", "#684f3b", "#7a5e45"],
  birchTimber: ["#7b7a70", "#aaa796", "#d1cab2"],
  pineTimber: ["#614332", "#76503a", "#8b6245"]
};

export const SUNLIT_STORYBOOK_THEME = freezeTheme({
  id: "sunlit-storybook",
  materials: sunlitMaterials,
  materialVariants: sunlitVariants,
  terrain: sunlitTerrain,
  treePalettes: sunlitTreePalettes,
  environment: {
    middaySkyTop: "#80bad9", middayHorizon: "#e4e7da", cloudLight: "#f7f1e4",
    cloudShadow: "#aebbc0", sun: "#ffe7c2", twilightSun: "#f2aa7b",
    ambientSky: "#d8e5ec", ambientGround: "#a9b2b7",
    twilightAmbientSky: "#a9bdd1", twilightAmbientGround: "#aa9b84"
  },
  grading: { toneMapping: "aces-filmic", exposure: 1.22 },
  aerialPerspective: {
    enabled: true, near: 18, far: 125, strength: 0.10,
    horizonStrength: 0.8, saturationReduction: 0.05, contrastReduction: 0, shadowLift: 0
  },
  toon: {
    enabled: true, strength: 0.4, shadowLevel: 0.22, midLevel: 0.68,
    highlightLevel: 1.0, transitionSoftness: 0.09
  }
});

export function resolveVisualTheme(value) {
  return String(value ?? "").toLowerCase() === "legacy" ? LEGACY_VISUAL_THEME : SUNLIT_STORYBOOK_THEME;
}

export function visualThemeFromLocation(locationLike = globalThis.location) {
  const search = typeof locationLike?.search === "string" ? locationLike.search : "";
  return resolveVisualTheme(new URLSearchParams(search).get("visualTheme"));
}

export const ACTIVE_VISUAL_THEME = visualThemeFromLocation();
