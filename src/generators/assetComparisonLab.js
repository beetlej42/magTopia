import * as THREE from "three";
import { resolveAsset } from "../city/assets.js";
import { createStandaloneStarterAsset } from "./magicLondonStarterDistrict.js";

export const ASSET_COMPARISON_PRESETS = {
  cottageDepthVsHunyuan: {
    seed: "cottage-depth-vs-hunyuan-001",
    assetId: "starter-cottage-001",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  workshopDepthVsHunyuan: {
    seed: "workshop-depth-vs-hunyuan-001",
    assetId: "starter-workshop-001",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  herbalistDepthVsHunyuan: {
    seed: "herbalist-depth-vs-hunyuan-001",
    assetId: "starter-herbalist-001",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  cottageWallsGroundVsHunyuan: {
    seed: "cottage-walls-ground-vs-hunyuan-001",
    assetId: "starter-cottage-001",
    fitSurfaces: "walls-ground",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  cottageMetricIndoorSmallVsHunyuan: {
    seed: "cottage-metric-indoor-small-vs-hunyuan-001",
    assetId: "starter-cottage-001",
    fitSurfaces: "metric-indoor-small",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  workshopMetricIndoorSmallVsHunyuan: {
    seed: "workshop-metric-indoor-small-vs-hunyuan-001",
    assetId: "starter-workshop-001",
    fitSurfaces: "metric-indoor-small",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  },
  herbalistMetricIndoorSmallVsHunyuan: {
    seed: "herbalist-metric-indoor-small-vs-hunyuan-001",
    assetId: "starter-herbalist-001",
    fitSurfaces: "metric-indoor-small",
    sunTime: 0.62,
    depthStrength: 1,
    comparisonYaw: 0,
    separation: 7.2,
    showBounds: 1,
    depthWireframe: 0
  }
};

export function normalizeAssetComparisonConfig(config = {}) {
  const base = { ...ASSET_COMPARISON_PRESETS.cottageDepthVsHunyuan, ...config };
  return {
    ...base,
    assetId: base.assetId || "starter-cottage-001",
    fitSurfaces: ["walls-ground", "metric-indoor-small"].includes(base.fitSurfaces) ? base.fitSurfaces : "all",
    sunTime: clamp(base.sunTime, 0, 1),
    depthStrength: clamp(base.depthStrength, 0, 2),
    comparisonYaw: clamp(base.comparisonYaw, -180, 180),
    separation: clamp(base.separation, 5.5, 10),
    showBounds: Math.round(clamp(base.showBounds, 0, 1)),
    depthWireframe: Math.round(clamp(base.depthWireframe, 0, 1))
  };
}

export function getAssetComparisonContract(config = {}) {
  const params = normalizeAssetComparisonConfig(config);
  return {
    mode: "comparison",
    assetId: params.assetId,
    left: "global-linear-guide-fit rigid depth mesh",
    right: "Hunyuan3D runtime GLB",
    parcelDimensions: { length: 4, width: 4, height: 4, unit: "world" },
    synchronizedYaw: params.comparisonYaw,
    depthStrength: params.depthStrength,
    fitSurfaces: params.fitSurfaces
  };
}

export function createAssetComparisonLab(config = {}) {
  const params = normalizeAssetComparisonConfig(config);
  const asset = resolveAsset(params.assetId);
  if (!asset) throw new Error(`Unknown comparison asset: ${params.assetId}`);
  if (!asset.model?.glb) throw new Error(`${params.assetId} has no runtime 3D model for comparison`);

  const root = new THREE.Group();
  root.name = `AssetComparisonLab-${asset.assetId}`;
  const depthLabel = params.fitSurfaces === "metric-indoor-small"
    ? { title: "Metric Indoor Small", detail: "Metric meters · global translation only" }
    : params.fitSurfaces === "walls-ground"
      ? { title: "Walls + ground fit", detail: "Top face excluded from global fit" }
      : { title: "All-surfaces fit", detail: "Flat top included in global fit" };
  const depthHolder = createSpecimenHolder({
    x: -params.separation / 2,
    label: depthLabel.title,
    detail: depthLabel.detail,
    accent: "#ad6ee7"
  });
  const modelHolder = createSpecimenHolder({
    x: params.separation / 2,
    label: "3D reference asset",
    detail: "Hunyuan3D · normalized to the same parcel",
    accent: "#56a69b"
  });
  const depthTurntable = new THREE.Group();
  const modelTurntable = new THREE.Group();
  depthTurntable.name = "DepthMeshTurntable";
  modelTurntable.name = "ModelTurntable";

  const depthAsset = createStandaloneStarterAsset(asset, {
    representation: "depth",
    parcelSize: 4,
    depthStrength: params.depthStrength,
    depthVariant: params.fitSurfaces,
    label: "Fitted depth mesh"
  });
  const modelAsset = createStandaloneStarterAsset(asset, {
    representation: "model",
    parcelSize: 4,
    label: "Hunyuan3D reference"
  });
  depthTurntable.add(depthAsset);
  modelTurntable.add(modelAsset);
  depthHolder.content.add(depthTurntable);
  modelHolder.content.add(modelTurntable);
  root.add(depthHolder.group, modelHolder.group);

  const dividerGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.04, -2.8),
    new THREE.Vector3(0, 0.04, 2.8)
  ]);
  const divider = new THREE.Line(dividerGeometry, new THREE.LineBasicMaterial({ color: "#caaed5", transparent: true, opacity: 0.55 }));
  divider.name = "ComparisonDivider";
  root.add(divider);

  const updateComparisonConfig = (next = {}) => {
    const normalized = normalizeAssetComparisonConfig({ ...params, ...next });
    const yaw = THREE.MathUtils.degToRad(normalized.comparisonYaw);
    depthTurntable.rotation.y = yaw;
    modelTurntable.rotation.y = yaw;
    depthHolder.bounds.visible = Boolean(normalized.showBounds);
    modelHolder.bounds.visible = Boolean(normalized.showBounds);
    depthAsset.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      object.material.wireframe = Boolean(normalized.depthWireframe);
      if (object.material.uniforms?.depthReliefStrength) object.material.uniforms.depthReliefStrength.value = normalized.depthStrength;
      object.material.needsUpdate = true;
    });
    root.userData.config = normalized;
    return normalized;
  };

  root.userData = {
    config: params,
    contract: getAssetComparisonContract(params),
    updateComparisonConfig,
    getComparisonDiagnostics: () => ({
      assetId: asset.assetId,
      depthRepresentation: depthAsset.userData.representation,
      modelRepresentation: modelAsset.userData.representation,
      modelStatus: modelAsset.userData.modelStatus,
      modelWorldBounds: modelAsset.userData.worldBounds ?? null,
      modelOrientation: modelAsset.userData.orientation ?? null,
      depthEncoding: depthAsset.userData.depthMeshController?.depthEncoding ?? asset.depthEncoding,
      fitSurfaces: depthAsset.userData.depthFitSurfaces,
      synchronizedYaw: root.userData.config.comparisonYaw
    })
  };
  updateComparisonConfig(params);
  return root;
}

function createSpecimenHolder({ x, label, detail, accent }) {
  const group = new THREE.Group();
  group.position.x = x;
  const content = new THREE.Group();
  content.name = `${label}-Content`;
  group.add(content);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.12, 4.8),
    new THREE.MeshStandardMaterial({ color: "#eee4ed", roughness: 0.94, metalness: 0 })
  );
  platform.position.y = 0.04;
  platform.receiveShadow = true;
  group.add(platform);

  const grid = new THREE.GridHelper(4, 4, "#a989b7", "#d8c7dc");
  grid.position.y = 0.105;
  group.add(grid);

  const bounds = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(-2, 0.105, -2), new THREE.Vector3(2, 4.105, 2)),
    new THREE.Color(accent)
  );
  bounds.name = `${label}-FourUnitEnvelope`;
  group.add(bounds);

  const title = createLabelSprite(label, detail, accent);
  title.position.set(0, 5.15, 0);
  group.add(title);
  return { group, content, bounds };
}

function createLabelSprite(title, detail, accent) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 144;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255, 250, 253, 0.9)";
  context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.strokeStyle = accent;
  context.lineWidth = 5;
  context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  context.fillStyle = "#553263";
  context.font = "500 38px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(title, canvas.width / 2, 62);
  context.fillStyle = "#80698a";
  context.font = "400 24px Inter, system-ui, sans-serif";
  context.fillText(detail, canvas.width / 2, 103);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5.6, 1.05, 1);
  sprite.renderOrder = 10;
  sprite.userData.textures = [texture];
  return sprite;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value), minimum), maximum);
}
