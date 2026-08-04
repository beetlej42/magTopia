import * as THREE from "three";
import { createVoxelMassingLab } from "./voxelBuildingLab.js";

export const PUBLIC_BUILDING_STYLE_IDS = Object.freeze([
  "civic_classical",
  "industrial_iron",
  "victorian_gothic",
  "alchemical_glass",
  "victorian_domestic"
]);

export const PUBLIC_BUILDING_STYLE_LABELS = Object.freeze({
  civic_classical: "皇家歌剧院 · 古典市政",
  industrial_iron: "魔法器械厂 · 工业铁构",
  victorian_gothic: "星光学院 · 哥特学院",
  alchemical_glass: "魔药研究院 · 炼金温室",
  victorian_domestic: "街区图书馆 · 维多利亚街区"
});

export const PUBLIC_BUILDING_STYLE_COMPARISON_PRESETS = Object.freeze({
  fiveStyleDay: Object.freeze({
    id: "public-building-five-style-day",
    seed: "public-building-five-style-001",
    sunTime: 0.58,
    nightLighting: 0.08,
    showLabels: 1,
    spacing: 12.4,
    scale: 0.76
  }),
  fiveStyleEvening: Object.freeze({
    id: "public-building-five-style-evening",
    seed: "public-building-five-style-001",
    sunTime: 0.12,
    nightLighting: 0.78,
    showLabels: 1,
    spacing: 12.4,
    scale: 0.76
  })
});

export function normalizePublicBuildingStyleComparisonConfig(config = {}) {
  const base = { ...PUBLIC_BUILDING_STYLE_COMPARISON_PRESETS.fiveStyleDay, ...config };
  return {
    id: String(base.id || "public-building-style-comparison"),
    seed: String(base.seed || "public-building-style-comparison-001"),
    sunTime: clamp(base.sunTime ?? 0.58, 0, 1),
    nightLighting: clamp(base.nightLighting ?? 0.08, 0, 1),
    showLabels: Number(base.showLabels ?? 1) >= 0.5 ? 1 : 0,
    spacing: clamp(base.spacing ?? 12.4, 10, 16),
    scale: clamp(base.scale ?? 0.76, 0.58, 0.9),
    viewFraming: { horizontalOffset: 0, zoom: 1 }
  };
}

export function createPublicBuildingStylePreset(style, options = {}) {
  const widthCells = clampInteger(options.widthCells ?? 3, 2, 6);
  const depthCells = clampInteger(options.depthCells ?? 2, 2, 6);
  const shared = {
    id: options.id ?? `${style}-public-building`,
    seed: options.seed ?? `${style}-public-building`,
    widthCells,
    depthCells,
    sunTime: options.sunTime ?? 0.58,
    nightLighting: options.nightLighting ?? 0.08,
    viewFraming: { horizontalOffset: 0, zoom: 1.04 },
    metadata: {
      styleFamily: style,
      identityLayers: ["silhouette", "facade_rhythm", "material_palette", "emissive_accent"]
    }
  };
  if (style === "industrial_iron") return industrialPreset(shared);
  if (style === "victorian_gothic") return gothicPreset(shared);
  if (style === "alchemical_glass") return alchemicalPreset(shared);
  if (style === "victorian_domestic") return domesticCivicPreset(shared);
  return classicalPreset(shared);
}

export function createPublicBuildingStyleComparison(config = {}) {
  const params = normalizePublicBuildingStyleComparisonConfig(config);
  const root = new THREE.Group();
  root.name = `PublicBuildingStyleComparison-${params.id}`;
  const entries = PUBLIC_BUILDING_STYLE_IDS.map((style, index) => {
    const preset = createPublicBuildingStylePreset(style, {
      id: `${params.id}-${style}`,
      seed: `${params.seed}:${style}`,
      sunTime: params.sunTime,
      nightLighting: params.nightLighting
    });
    const building = createVoxelMassingLab({ ...preset, renderStrategy: "greedy", maxMergeSpanVoxels: 8 });
    building.name = `StyleStudy-${style}`;
    building.scale.setScalar(params.scale);
    building.position.x = (index - (PUBLIC_BUILDING_STYLE_IDS.length - 1) / 2) * params.spacing;
    root.add(building);
    addStudyPlinth(root, building.position.x, params.spacing * 0.86);
    if (params.showLabels && typeof document !== "undefined") {
      const label = createLabelSprite(PUBLIC_BUILDING_STYLE_LABELS[style]);
      label.position.set(building.position.x, 11.3, 1.2);
      root.add(label);
    }
    const diagnostics = building.userData.getVoxelDiagnostics();
    return {
      style,
      label: PUBLIC_BUILDING_STYLE_LABELS[style],
      positionX: building.position.x,
      capTypes: diagnostics.capTypes,
      facadeOrders: [...new Set(building.userData.spec.masses.map((mass) => mass.facade.order))],
      materialCounts: diagnostics.materialCounts,
      massCount: diagnostics.massCount
    };
  });
  root.userData.diagnostics = { mode: "public-building-style-comparison", entries };
  root.userData.getVoxelDiagnostics = () => structuredClone(root.userData.diagnostics);
  root.userData.updateDaylight = (style) => root.children.forEach((child) => child.userData.updateDaylight?.(style));
  return root;
}

function classicalPreset(base) {
  const center = Math.floor(base.widthCells / 2);
  const front = base.depthCells - 1;
  return {
    ...base,
    masses: [
      {
        id: "opera-hall",
        role: "primary",
        type: "solid",
        cells: rowCells(base.widthCells, 0),
        heightVoxels: 36,
        cap: { type: "mansard", heightVoxels: 9, dormerCount: 4, ridgeRailHeightVoxels: 2 },
        materials: { wall: "sandstone", trim: "limestone", roof: "slate", window: "warmWindow" },
        facade: classicalFacade({ entranceEmphasis: 1, pedimentHeightVoxels: 8 })
      },
      {
        id: "gilded-dome",
        role: "crown",
        type: "solid",
        cells: [[center, 0]],
        dimensionsVoxels: { width: 22, depth: 22 },
        heightVoxels: 14,
        planShape: "octagonal",
        cap: { type: "dome", heightVoxels: 18, ribCount: 8, ringCount: 2, finialHeightVoxels: 5 },
        materials: { wall: "limestone", trim: "gildedMetal", roof: "gildedMetal", window: "warmWindow" },
        facade: classicalFacade({ entranceEmphasis: 0, openness: 0.5 })
      },
      {
        id: "stage-house",
        role: "service",
        type: "solid",
        cells: [[center, 0]],
        dimensionsVoxels: { width: 28, depth: 20 },
        placement: { offsetVoxels: { z: -6 } },
        heightVoxels: 48,
        cap: { type: "parapet", parapetHeightVoxels: 4 },
        materials: { wall: "sandstone", trim: "limestone", roof: "slate", window: "warmWindow" },
        facade: classicalFacade({ entranceEmphasis: 0.08, openness: 0.3 })
      },
      {
        id: "opera-portico",
        role: "entrance",
        type: "open",
        cells: [[center, front]],
        dimensionsVoxels: { width: 30, depth: 15 },
        placement: { offsetVoxels: { z: -8 } },
        heightVoxels: 22,
        cap: { type: "gable", heightVoxels: 9, orientation: "north_south" },
        enclosure: {
          sides: { north: "auto", east: "columns", south: "columns", west: "columns" },
          columnSpacingVoxels: 6,
          columnWidthVoxels: 3,
          beamHeightVoxels: 3,
          plinthHeightVoxels: 3,
          capitalHeightVoxels: 3
        },
        materials: { wall: "limestone", frame: "limestone", trim: "gildedMetal" }
      },
      ceremonialGround("opera-plaza", rowCells(base.widthCells, front), "courtyard")
    ],
    relations: [{ type: "stacked", from: "stage-house", to: "gilded-dome" }]
  };
}

function industrialPreset(base) {
  const front = base.depthCells - 1;
  const chimneyCell = base.widthCells - 1;
  return {
    ...base,
    masses: [
      {
        id: "assembly-shed",
        role: "primary",
        type: "solid",
        cells: rowCells(base.widthCells, 0),
        heightVoxels: 25,
        cap: { type: "sawtooth", heightVoxels: 9, toothCount: Math.min(6, base.widthCells + 2), orientation: "north_south" },
        materials: { wall: "brickBrown", trim: "iron", roof: "iron", frame: "iron", window: "lightGlass", door: "iron" },
        facade: industrialFacade({ entranceEmphasis: 0.34, openness: 0.72, bayWidthVoxels: 16 })
      },
      {
        id: "boiler-house",
        type: "solid",
        cells: [[0, front]],
        dimensionsVoxels: { width: 26, depth: 24 },
        heightVoxels: 34,
        cap: { type: "parapet", parapetHeightVoxels: 4 },
        materials: { wall: "brickRed", trim: "iron", roof: "iron", frame: "iron", window: "warmWindow", door: "iron" },
        facade: industrialFacade({ entranceEmphasis: 0.2, openness: 0.48, bayWidthVoxels: 12 })
      },
      industrialChimney("main-stack", chimneyCell, 0, 56, { x: 7, z: 5 }),
      industrialChimney("secondary-stack", chimneyCell, 0, 45, { x: -6, z: -7 }),
      {
        id: "loading-canopy",
        type: "open",
        cells: [[Math.floor(base.widthCells / 2), front]],
        dimensionsVoxels: { width: 30, depth: 13 },
        heightVoxels: 13,
        cap: { type: "parapet", parapetHeightVoxels: 2 },
        enclosure: { sides: { north: "auto", east: "open", south: "columns", west: "open" }, columnSpacingVoxels: 10, columnWidthVoxels: 2, beamHeightVoxels: 3 },
        materials: { wall: "brickBrown", frame: "iron", trim: "iron" }
      },
      ceremonialGround("service-yard", rowCells(base.widthCells, front), "bordered")
    ],
    relations: []
  };
}

function gothicPreset(base) {
  const center = Math.floor(base.widthCells / 2);
  const front = base.depthCells - 1;
  return {
    ...base,
    masses: [
      {
        id: "great-hall",
        role: "primary",
        type: "solid",
        cells: rowCells(base.widthCells, 0),
        heightVoxels: 42,
        cap: { type: "gable", heightVoxels: 20, orientation: "east_west", ridgeRailHeightVoxels: 3 },
        materials: { wall: "brickBrown", trim: "sandstone", roof: "slate", frame: "iron", window: "violetMagic", door: "timber" },
        facade: gothicFacade({ entranceEmphasis: 0.42, openness: 0.31 })
      },
      {
        id: "teaching-tower",
        role: "crown",
        type: "solid",
        cells: [[center, 0]],
        dimensionsVoxels: { width: 15, depth: 15 },
        heightVoxels: 74,
        planShape: "octagonal",
        profile: { type: "tapered", stepHeightVoxels: 18, stepVoxels: 1, maxInsetVoxels: 5 },
        cap: { type: "spire", heightVoxels: 30, ribCount: 8, ringCount: 2, finialHeightVoxels: 8 },
        materials: { wall: "brickBrown", trim: "sandstone", roof: "slate", window: "violetMagic" },
        facade: gothicFacade({ entranceEmphasis: 0, openness: 0.3 })
      },
      {
        id: "pointed-gatehouse",
        role: "entrance",
        type: "solid",
        cells: [[center, front]],
        dimensionsVoxels: { width: 16, depth: 11 },
        heightVoxels: 28,
        cap: { type: "gable", heightVoxels: 15, orientation: "north_south", finialHeightVoxels: 4 },
        materials: { wall: "brickBrown", frame: "iron", trim: "sandstone", roof: "slate", window: "violetMagic", door: "timber" },
        facade: gothicFacade({ entranceEmphasis: 1, openness: 0.24 })
      },
      gothicButtress("west-buttress", 0, -13),
      gothicButtress("east-buttress", base.widthCells - 1, 13),
      ceremonialGround("college-court", rowCells(base.widthCells, front), "courtyard")
    ],
    relations: []
  };
}

function alchemicalPreset(base) {
  const front = base.depthCells - 1;
  const glassCells = rowCells(base.widthCells - 1, 0).map(([x, z]) => [x + 1, z]);
  return {
    ...base,
    masses: [
      {
        id: "laboratory-house",
        role: "primary",
        type: "solid",
        cells: [[0, 0]],
        heightVoxels: 38,
        cap: { type: "mansard", heightVoxels: 10, dormerCount: 2, ridgeRailHeightVoxels: 2 },
        materials: { wall: "brickBrown", trim: "patinaMetal", roof: "slate", frame: "patinaMetal", window: "tealMagic" },
        facade: industrialFacade({ entranceEmphasis: 0.9, openness: 0.44, bayWidthVoxels: 8 })
      },
      {
        id: "great-glasshouse",
        type: "framed",
        cells: glassCells,
        heightVoxels: 15,
        cap: { type: "glass_barrel", heightVoxels: 17, orientation: "east_west", ribCount: 10, ringCount: 2, finialHeightVoxels: 5 },
        framing: { baySpacingVoxels: 7, frameWidthVoxels: 2, floorBeamSpacingVoxels: 8, reliefDepthVoxels: 1 },
        materials: { frame: "patinaMetal", trim: "gildedMetal", panel: "tealGlass", roof: "tealGlass" }
      },
      {
        id: "distillation-tower",
        type: "solid",
        cells: [[0, 0]],
        dimensionsVoxels: { width: 12, depth: 12 },
        placement: { offsetVoxels: { x: 7, z: -7 } },
        heightVoxels: 53,
        planShape: "octagonal",
        cap: { type: "dome", heightVoxels: 11, ribCount: 6, finialHeightVoxels: 6 },
        materials: { wall: "patinaMetal", trim: "gildedMetal", roof: "patinaMetal", window: "tealMagic" },
        facade: industrialFacade({ entranceEmphasis: 0, openness: 0.28, bayWidthVoxels: 7 })
      },
      ceremonialGround("herb-court", rowCells(base.widthCells, front), "garden")
    ],
    relations: [{ type: "portal", from: "laboratory-house", to: "great-glasshouse", widthVoxels: 8, heightVoxels: 14 }]
  };
}

function domesticCivicPreset(base) {
  const front = base.depthCells - 1;
  const masses = rowCells(base.widthCells, 0).map(([x, z], index) => ({
    id: `library-house-${index + 1}`,
    role: index === Math.floor(base.widthCells / 2) ? "primary" : "secondary",
    type: "solid",
    cells: [[x, z]],
    dimensionsVoxels: {
      width: [27, 30, 28, 29, 27, 30][index],
      depth: [27, 31, 26, 30, 28, 31][index]
    },
    placement: { offsetVoxels: { z: [-3, 2, -1, 3, -2, 1][index] } },
    heightVoxels: [28, 34, 25, 31, 27, 33][index],
    cap: index % 2 === 0
      ? { type: "gable", heightVoxels: 11, orientation: "east_west", dormerCount: 1 }
      : { type: "mansard", heightVoxels: 9, dormerCount: 2 },
    materials: { wall: index % 2 ? "brickBrown" : "brickRed", trim: "sandstone", roof: "slate", frame: "timber", window: "warmWindow", door: "timber" },
    facade: { symmetry: 0.42, openness: 0.4, entranceEmphasis: index === Math.floor(base.widthCells / 2) ? 0.72 : 0.16, detailDensity: 0.78, floorHeightVoxels: 14, bayWidthVoxels: [7, 9, 8, 7, 9, 8][index], order: "plain", baseCourseHeightVoxels: 1, corniceHeightVoxels: 1, cornerPierWidthVoxels: 0, rooflineOrnaments: [1, 3, 2, 1, 2, 3][index] }
  }));
  return {
    ...base,
    masses: [...masses, ceremonialGround("reading-garden", rowCells(base.widthCells, front), "garden")],
    relations: []
  };
}

function classicalFacade({ entranceEmphasis = 0.4, openness = 0.4, pedimentHeightVoxels = 0 } = {}) {
  return { symmetry: 1, openness, entranceEmphasis, detailDensity: 1, floorHeightVoxels: 18, bayWidthVoxels: 9, order: "classical", baseCourseHeightVoxels: 4, stringCourseHeightVoxels: 2, corniceHeightVoxels: 4, cornerPierWidthVoxels: 2, pedimentHeightVoxels, pedimentWidthVoxels: pedimentHeightVoxels ? 24 : 0, rooflineOrnaments: 3 };
}

function industrialFacade({ entranceEmphasis = 0.25, openness = 0.6, bayWidthVoxels = 14 } = {}) {
  return { symmetry: 0.2, openness, entranceEmphasis, detailDensity: 0.82, floorHeightVoxels: 24, bayWidthVoxels, order: "industrial", baseCourseHeightVoxels: 2, stringCourseHeightVoxels: 0, corniceHeightVoxels: 2, cornerPierWidthVoxels: 2, rooflineOrnaments: 0 };
}

function gothicFacade({ entranceEmphasis = 0.5, openness = 0.38 } = {}) {
  return { symmetry: 0.82, openness, entranceEmphasis, detailDensity: 1, floorHeightVoxels: 26, bayWidthVoxels: 6, order: "gothic", baseCourseHeightVoxels: 2, stringCourseHeightVoxels: 0, corniceHeightVoxels: 1, cornerPierWidthVoxels: 3, pedimentHeightVoxels: entranceEmphasis > 0.8 ? 14 : 0, pedimentWidthVoxels: 16, rooflineOrnaments: 0 };
}

function gothicButtress(id, cellX, offsetX) {
  return { id, role: "buttress", type: "solid", cells: [[cellX, 0]], dimensionsVoxels: { width: 4, depth: 10 }, placement: { offsetVoxels: { x: offsetX, z: 10 } }, heightVoxels: 35, profile: { type: "tapered", stepHeightVoxels: 12, stepVoxels: 1, maxInsetVoxels: 2 }, cap: { type: "spire", heightVoxels: 7 }, materials: { wall: "sandstone", trim: "sandstone", roof: "slate", window: "violetMagic" }, facade: gothicFacade({ entranceEmphasis: 0, openness: 0.08 }) };
}

function industrialChimney(id, x, z, heightVoxels, offsetVoxels) {
  return { id, role: "service", type: "solid", cells: [[x, z]], dimensionsVoxels: { width: 7, depth: 7 }, placement: { offsetVoxels }, heightVoxels, planShape: "octagonal", profile: { type: "tapered", stepHeightVoxels: 20, stepVoxels: 1, maxInsetVoxels: 2 }, cap: { type: "parapet", parapetHeightVoxels: 3 }, materials: { wall: "brickBrown", trim: "iron", roof: "iron", window: "warmWindow" }, facade: industrialFacade({ entranceEmphasis: 0, openness: 0.08, bayWidthVoxels: 8 }) };
}

function ceremonialGround(id, cells, pattern) {
  return { id, type: "ground", cells, heightVoxels: 2, cap: { type: "flat" }, groundTreatment: { pattern, borderWidthVoxels: 2, pathWidthVoxels: pattern === "garden" ? 7 : 12, axisMaterial: "stoneShadow", planterCount: pattern === "garden" ? 6 : 2, fenceHeightVoxels: pattern === "garden" ? 3 : 0, lampCount: 4, stepWidthVoxels: 20, stepDepthVoxels: 6 } };
}

function rowCells(width, z) {
  return Array.from({ length: width }, (_, x) => [x, z]);
}

function addStudyPlinth(root, x, width) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.16, 9.2),
    new THREE.MeshStandardMaterial({ color: "#c9c1b4", roughness: 1 })
  );
  mesh.position.set(x, -0.1, 0);
  mesh.receiveShadow = true;
  root.add(mesh);
}

function createLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(255,249,253,0.92)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(91,54,118,0.28)";
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = "#51345f";
  context.font = "700 34px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(8.3, 1.1, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function clampInteger(value, minimum, maximum) {
  return Math.round(clamp(value, minimum, maximum));
}
