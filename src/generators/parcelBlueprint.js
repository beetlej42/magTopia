import * as THREE from "three";

export const PARCEL_BLUEPRINT_PRESETS = {
  cottage: { seed: "parcel-1x1", footprint: "1x1", floors: 2, maxHeight: 5.4 },
  shop: { seed: "parcel-1x2", footprint: "1x2", floors: 3, maxHeight: 8.2 },
  tower: { seed: "parcel-1x3", footprint: "1x3", floors: 4, maxHeight: 11.2 },
  house: { seed: "parcel-2x2", footprint: "2x2", floors: 3, maxHeight: 8.5 },
  park: { seed: "parcel-4x1", footprint: "4x1", floors: 1, maxHeight: 2.4 },
  hall: { seed: "parcel-4x2", footprint: "4x2", floors: 2, maxHeight: 7.2 }
};

const UNIT = 4;
const SAFE_MARGIN = 0.32;
const CAMERA_CONTRACT = Object.freeze({ yaw: 45, elevation: 55, roll: 0, projection: "orthographic" });

export function normalizeParcelBlueprintConfig(config = {}) {
  const base = { ...PARCEL_BLUEPRINT_PRESETS.shop, ...config };
  const [columns, rows] = parseFootprint(base.footprint);
  const maxHeight = clamp(base.dimensions?.height ?? base.maxHeight, 0.5, 12);
  const dimensions = {
    length: clamp(base.dimensions?.length ?? columns * UNIT, 0.5, 64),
    width: clamp(base.dimensions?.width ?? rows * UNIT, 0.5, 64),
    height: maxHeight,
    unit: "world"
  };
  return {
    ...base,
    footprint: `${columns}x${rows}`,
    columns,
    rows,
    unitSize: UNIT,
    floors: Math.round(clamp(base.floors, 1, 4)),
    maxHeight,
    dimensions,
    camera: CAMERA_CONTRACT
  };
}

export function createParcelBlueprint(config = {}) {
  const params = normalizeParcelBlueprintConfig(config);
  const width = params.dimensions.length;
  const depth = params.dimensions.width;
  const root = new THREE.Group();
  root.name = "ParcelBlueprint";
  root.userData.config = params;
  root.userData.contract = getParcelContract(params);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: "#65707a", roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  root.add(createGrid(width, depth, params.columns, params.rows));
  root.add(createOutline(width, depth, "#f5c96a", 0.1));

  const safeWidth = Math.max(0.4, width - SAFE_MARGIN * 2);
  const safeDepth = Math.max(0.4, depth - SAFE_MARGIN * 2);
  const envelope = new THREE.Mesh(
    new THREE.BoxGeometry(safeWidth, params.maxHeight, safeDepth),
    new THREE.MeshStandardMaterial({
      color: "#7586a8",
      emissive: "#25334f",
      transparent: true,
      opacity: 0.19,
      roughness: 0.9,
      depthWrite: false
    })
  );
  envelope.position.y = params.maxHeight / 2;
  root.add(envelope);
  root.add(createOutline(safeWidth, safeDepth, "#b9c9ea", 0.045));
  root.add(createHeightGuides(safeWidth, safeDepth, params.maxHeight));

  const front = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.08, depth / 2 + 0.3), 1.1, 0xf5c96a, 0.26, 0.15);
  front.name = "FrontDirection";
  root.add(front);
  const sun = new THREE.ArrowHelper(new THREE.Vector3(-0.45, -0.78, 0.43).normalize(), new THREE.Vector3(width * 0.42, params.maxHeight + 2, -depth * 0.35), 2.2, 0xffd990, 0.38, 0.2);
  sun.name = "WarmAfternoonKeyLight";
  root.add(sun);

  return root;
}

export function getParcelContract(config = {}) {
  const params = normalizeParcelBlueprintConfig(config);
  return {
    footprint: params.footprint,
    gridUnits: { width: params.columns, depth: params.rows, worldUnit: UNIT },
    dimensions: params.dimensions,
    safeMargin: SAFE_MARGIN,
    floors: params.floors,
    maxHeight: params.maxHeight,
    camera: CAMERA_CONTRACT,
    prompt: buildParcelPrompt(params)
  };
}

export function buildParcelPrompt(config = {}) {
  const params = normalizeParcelBlueprintConfig(config);
  return [
    "Use case: stylized-concept",
    "Asset type: standalone expandable city-building asset for 2.5D depth parallax.",
    "Camera contract: orthographic high three-quarter view; yaw 45 degrees; elevation 55 degrees; roll 0.",
    `Envelope contract: placement footprint ${params.footprint}; exact world dimensions ${params.dimensions.length} length × ${params.dimensions.width} width × ${params.dimensions.height} height; ${params.floors} storeys. The program-supplied guideplate has an immutable base and a translucent blue hard envelope; replace only the envelope with the building, preserving its camera, base, entrance, and 8% clean margin.`,
    "Style: soft isometric low-poly urban diorama; visible roof plane plus front and side walls, clear geometric facets, London brick-and-slate language, and a silhouette that can join a continuous street wall; no pixel grid, no HD2D, no black outlines, no photorealistic texture, no front-facing flat storefront, no isolated fairy-tale cottage.",
    "Lighting: warm afternoon key light from upper left; cool blue-grey shadows; low specular response.",
    "Palette: London brick red, deep brick brown, slate blue-grey, warm sandstone, aged timber, warm window gold; violet or teal only as a small magic accent.",
    "Output constraints: flat #FF00FF chroma-key background, no neighbouring buildings, no road beyond the parcel, no characters, no vehicles, no text, no watermark."
  ].join(" ");
}

function createGrid(width, depth, columns, rows) {
  const points = [];
  for (let column = 0; column <= columns; column += 1) {
    const x = -width / 2 + column * UNIT;
    points.push(x, 0.025, -depth / 2, x, 0.025, depth / 2);
  }
  for (let row = 0; row <= rows; row += 1) {
    const z = -depth / 2 + row * UNIT;
    points.push(-width / 2, 0.025, z, width / 2, 0.025, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#dbe5ef", transparent: true, opacity: 0.56 }));
}

function createOutline(width, depth, color, height) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.94 }));
  outline.position.y = height / 2 + 0.03;
  return outline;
}

function createHeightGuides(width, depth, height) {
  const points = [];
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) points.push(x, 0, z, x, height, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#c7d7f5", transparent: true, opacity: 0.74 }));
}

function parseFootprint(value) {
  const match = /^(1|2|4)x(1|2|3)$/.exec(String(value));
  if (!match) return [1, 2];
  return [Number(match[1]), Number(match[2])];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}
