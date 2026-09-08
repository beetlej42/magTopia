const freezeTheme = (theme) => Object.freeze({
  ...theme,
  materials: Object.freeze({ ...theme.materials }),
  materialVariants: Object.freeze(Object.fromEntries(
    Object.entries(theme.materialVariants).map(([key, colors]) => [key, Object.freeze([...colors])])
  )),
  environment: Object.freeze({ ...theme.environment }),
  grading: Object.freeze({ ...theme.grading }),
  atmosphere: Object.freeze({ ...theme.atmosphere })
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

export const LEGACY_VISUAL_THEME = freezeTheme({
  id: "legacy",
  materials: legacyMaterials,
  materialVariants: legacyVariants,
  environment: {
    middaySkyTop: "#80bad9", middayHorizon: "#d8edf2", cloudLight: "#fff7e7",
    cloudShadow: "#b9cbd3", fog: "#d8edf2", sun: "#fff0c7",
    ambientSky: "#dceef2", ambientGround: "#99a58f"
  },
  grading: { toneMapping: "none", exposure: 1 },
  atmosphere: { enabled: false, near: 70, far: 210 }
});

const sunlitMaterials = {
  brickRed: "#985d4d", brickBrown: "#684b42", sandstone: "#c5b596",
  limestone: "#d4cdbd", stoneShadow: "#8b8478", slate: "#46515e",
  timber: "#3b3931", iron: "#292f32", patinaMetal: "#536b66",
  grass: "#73845b", grassLight: "#87956a", grassDark: "#596c4c",
  foliage: "#607451", foliageLight: "#748560", foliageDark: "#465d43",
  soil: "#715746", road: "#686b6b", pavement: "#a59f94",
  water: "#56879a", waterLight: "#78a5ae", warmWindow: "#e9ad5c",
  violetMagic: "#7d69a9", tealMagic: "#5b9d98"
};

const family = (base, ...variants) => [base, ...variants];
const sunlitVariants = {
  brickRed: family(sunlitMaterials.brickRed, "#a36552", "#8d5548", "#9e6250"),
  brickBrown: family(sunlitMaterials.brickBrown, "#725148", "#60463e"),
  sandstone: family(sunlitMaterials.sandstone, "#cebea0", "#baa98b"), stoneShadow: family(sunlitMaterials.stoneShadow, "#958d80", "#80796f"),
  limestone: family(sunlitMaterials.limestone, "#ddd5c5", "#c7c0b2"), slate: family(sunlitMaterials.slate, "#505c69", "#3e4955", "#56616d"),
  timber: family(sunlitMaterials.timber, "#454137", "#33352f"),
  foliage: family(sunlitMaterials.foliage, "#697b57", "#566b4b"), foliageDark: family(sunlitMaterials.foliageDark, "#506649", "#3e563e"),
  foliageLight: family(sunlitMaterials.foliageLight, "#7e8e67", "#6b7d58"), grass: family(sunlitMaterials.grass, "#7c8b61", "#697a54"),
  grassLight: family(sunlitMaterials.grassLight, "#909d72", "#7e8c63"), grassDark: family(sunlitMaterials.grassDark, "#627453", "#506548"),
  soil: family(sunlitMaterials.soil, "#7b5f4c", "#685041"), water: family(sunlitMaterials.water, "#6091a2", "#4d7e91"),
  waterLight: family(sunlitMaterials.waterLight, "#82adb5", "#6e9ca7"), warmWindow: family(sunlitMaterials.warmWindow, "#f0ba69", "#d99e50"),
  violetMagic: family(sunlitMaterials.violetMagic, "#8b75b7", "#705c9b"), tealMagic: family(sunlitMaterials.tealMagic, "#68aaa3", "#4f918e"),
  iron: family(sunlitMaterials.iron, "#343a3c", "#23292c"), patinaMetal: family(sunlitMaterials.patinaMetal, "#607770", "#485f5c"),
  pavement: family(sunlitMaterials.pavement, "#afa99d", "#99948b"), road: family(sunlitMaterials.road, "#727474", "#5f6263")
};

export const SUNLIT_STORYBOOK_THEME = freezeTheme({
  id: "sunlit-storybook",
  materials: sunlitMaterials,
  materialVariants: sunlitVariants,
  environment: {
    middaySkyTop: "#88b4ca", middayHorizon: "#d8dfd5", cloudLight: "#f7f1e4",
    cloudShadow: "#aebbc0", fog: "#d3dcd4", sun: "#fff1d3",
    ambientSky: "#d4e0df", ambientGround: "#96998a"
  },
  grading: { toneMapping: "aces-filmic", exposure: 1.05 },
  atmosphere: { enabled: true, near: 72, far: 215 }
});

export function resolveVisualTheme(value) {
  return String(value ?? "").toLowerCase() === "legacy" ? LEGACY_VISUAL_THEME : SUNLIT_STORYBOOK_THEME;
}

export function visualThemeFromLocation(locationLike = globalThis.location) {
  const search = typeof locationLike?.search === "string" ? locationLike.search : "";
  return resolveVisualTheme(new URLSearchParams(search).get("visualTheme"));
}

export const ACTIVE_VISUAL_THEME = visualThemeFromLocation();
