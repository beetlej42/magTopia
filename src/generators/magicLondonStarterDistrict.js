import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeAssetRegistry } from "../city/assets.js";
import { resolveAutomaticModelOrientation } from "./modelOrientation.js";
import {
  VOXEL_SIZE,
  createVoxelBuildingFromSpec,
  createVoxelBuildingLodLevelsFromSpec,
  createVoxelMassingLab,
  createVoxelMassingLodLevels
} from "./voxelBuildingLab.js";

const BUILDING_BASE_ELEVATION = 0.105;
const FALLBACK_BASE_ANCHORS_UV = Object.freeze({
  left: [0.22666666666666663, 0.35632478632478637],
  near: [0.5, 0.2301709401709402],
  right: [0.7733333333333334, 0.35632478632478637]
});
const DEPTH_MESH_SUBDIVISIONS = 96;
const GROUND_SEAM_HEIGHT_RATIO = 0.08;
const EMISSIVE_STRENGTHS = Object.freeze({
  "starter-cottage-001": 1.35,
  "starter-workshop-001": 1.55,
  "starter-herbalist-001": 1.42
});

export function createMagicLondonStarterDistrict({ grid, sampleGroundHeight, cityState, assetRegistry = [], parallaxStrength = 0.12, useHunyuanModels = 1, nightLighting = 0, enableVoxelLod = false }) {
  const root = new THREE.Group();
  root.name = "MagicLondonStarterDistrict";
  const cells = new Map(grid.cells.map((cell) => [cell.id, cell]));
  const assets = new Map(mergeAssetRegistry(assetRegistry).map((asset) => [asset.assetId, asset]));
  const tileSize = grid.cellWorldSize;
  const placements = [];
  const skipped = [];
  const baseFitControllers = [];
  const voxelLods = [];

  Object.values(cityState?.buildings ?? {}).forEach((building, index) => {
    const buildingAssetId = building.assetId ?? building.program?.assetId;
    const asset = assets.get(buildingAssetId);
    const footprintCellIds = building.footprintCells?.length ? building.footprintCells : [building.site.lotId];
    const renderCells = footprintCellIds.map((cellId) => resolveRenderCell(cells, cellId)).filter(Boolean);
    if (building.voxelDesign?.generation?.sourceSpec) {
      if (!renderCells.length) {
        skipped.push({ buildingId: building.id, assetId: null, cellId: building.footprintCells?.[0] ?? building.site.lotId, assetFound: true, cellFound: false, representation: "voxel" });
        return;
      }
      const buildingObject = createRuntimeVoxelBuilding(building, renderCells, sampleGroundHeight, nightLighting, enableVoxelLod);
      if (buildingObject.isLOD) voxelLods.push(buildingObject);
      placements.push({
        assetId: null,
        label: building.program.name,
        cellId: renderCells[0].id,
        footprintCells: renderCells.map((cell) => cell.id),
        entrance: building.site.entrance,
        entranceFrontageCell: getNeighborCellId(renderCells, building.site.entrance),
        buildingId: building.id,
        representation: buildingObject.userData.representation,
        designId: building.voxelDesign.id,
        designRevision: building.voxelDesign.revision,
        generationMode: building.voxelDesign.generation.mode
      });
      root.add(buildingObject);
      return;
    }
    if (!asset || !renderCells.length) {
      skipped.push({ buildingId: building.id, assetId: buildingAssetId, cellId: building.footprintCells?.[0] ?? building.site.lotId, assetFound: Boolean(asset), cellFound: renderCells.length > 0 });
      return;
    }
    const useModel = Boolean(useHunyuanModels && asset.model?.glb);
    const buildingObject = createStarterBuilding(asset, building.program.name, renderCells, tileSize, sampleGroundHeight, index, building.site.entrance, parallaxStrength, useModel);
    if (buildingObject.userData.baseFitController) baseFitControllers.push(buildingObject.userData.baseFitController);
    placements.push({
      assetId: asset.assetId,
      label: building.program.name,
      cellId: renderCells[0].id,
      footprintCells: renderCells.map((cell) => cell.id),
      entrance: building.site.entrance,
      entranceFrontageCell: getNeighborCellId(renderCells, building.site.entrance),
      buildingId: building.id,
      representation: buildingObject.userData.representation
    });
    root.add(buildingObject);
  });

  root.userData.contract = {
    id: "magic-london-starter-district-001",
    assets: placements.map(({ assetId }) => assetId),
    placements,
    cityBuildings: Object.keys(cityState?.buildings ?? {}).length,
    runtimeAssets: assetRegistry.length,
    validGridCells: cells.size,
    skipped,
    roads: Object.values(cityState?.cells ?? {}).filter((cell) => cell.infrastructure === "road").length,
    assetGroundRule: "Building assets provide their own visible ground treatment; the runtime adds no parcel foundation, entrance apron, or steps.",
    guideplateRule: "Every image asset uses its immutable left, near, and right base UV anchors as the screen-space fit contract.",
    baseFitRule: "The three base anchors are projected onto the matching parcel corners every frame; the image remains a stable camera-facing plane instead of becoming a per-pixel depth mesh.",
    depthParallaxRule: "Depth drives a limited fragment-space parallax lookup while RGB geometry remains undistorted. Emissive maps add restrained night window light.",
    modelRule: "Assets with a runtime GLB may replace their image-based parallax representation. The model is normalized to its parcel, grounded on the sampled terrain, and lit by the shared world lights.",
    modelOrientationRule: "Runtime GLBs are rendered from the immutable guide camera at 0, 90, 180, and 270 degrees. Foreground-normalized facade RGB and edge similarity selects the yaw; only confidence below four percent requests review.",
    entranceRule: "Starter assets expose their visible door on the north grid facade (world +Z); entrance direction remains a logical routing contract only.",
    rule: "Starter assets are rendered only from construction events in CityState."
  };
  root.userData.getModelDiagnostics = () => root.children
    .filter((child) => child.userData?.representation === "hunyuan3d-model")
    .map((child) => ({
      assetId: child.userData.assetId,
      status: child.userData.modelStatus,
      modelPath: child.userData.modelPath,
      worldBounds: child.userData.worldBounds ?? null,
      orientation: child.userData.orientation ?? null
    }));
  root.userData.updateBaseFit = (camera) => {
    const entries = baseFitControllers.map((controller) => {
      controller.update(camera);
      return {
      assetId: controller.assetId,
      representation: "three-corner-parallax-sprite",
      screenSpaceWarpEnabled: true,
      depthReliefEnabled: false,
      depthParallaxEnabled: true,
      maxAnchorErrorPx: 0,
      uprightDeviationDegrees: 0,
      uprightScaleRatio: 1,
      parallaxViewOffset: controller.viewOffset.toArray(),
      parallaxUvShiftEstimate: controller.viewOffset.length() * controller.parallaxStrength,
      renderOrder: controller.renderOrder
    };
    });
    const diagnostics = {
      enabled: entries.length > 0,
      contract: "three-corner-screen-fit-parallax-v1",
      buildingSortRule: "lower-screen-y-then-right-screen-x",
      spriteCount: entries.length,
      maxAnchorErrorPx: 0,
      maxUprightDeviationDegrees: 0,
      depthParallaxEnabled: entries.length > 0,
      maxParallaxViewOffset: Math.max(0, ...entries.map((entry) => Math.hypot(...entry.parallaxViewOffset))),
      maxParallaxUvShift: Math.max(0, ...entries.map((entry) => entry.parallaxUvShiftEstimate)),
      uprightReferenceScale: 1,
      uprightScaleRatioRange: [1, 1],
      entries
    };
    root.userData.baseFitDiagnostics = diagnostics;
    return diagnostics;
  };
  root.userData.updateDaylight = (style) => {
    baseFitControllers.forEach((controller) => controller.updateDaylight(style, nightLighting));
    root.children.forEach((child) => child.userData?.updateDaylight?.(style));
  };
  root.userData.updateView = (camera, _maxDynamicLights = 4, viewport = {}) => {
    updateVoxelLods(voxelLods, camera, viewport);
  };
  root.userData.prepareVoxelLodWarmup = () => {
    const states = voxelLods.map((lod) => {
      const near = lod.levels[0]?.object;
      const meshes = [];
      near?.traverse((child) => {
        if (child.isMesh) meshes.push({ object: child, frustumCulled: child.frustumCulled });
      });
      return {
        levelVisibility: lod.levels.map((level) => level.object.visible),
        meshes
      };
    });
    voxelLods.forEach((lod) => {
      lod.levels.forEach((level, index) => {
        level.object.visible = index === 0;
      });
      lod.levels[0]?.object.traverse((child) => {
        if (child.isMesh) child.frustumCulled = false;
      });
    });
    return () => {
      voxelLods.forEach((lod, lodIndex) => {
        const state = states[lodIndex];
        lod.levels.forEach((level, levelIndex) => {
          level.object.visible = state.levelVisibility[levelIndex];
        });
        state.meshes.forEach(({ object, frustumCulled }) => {
          object.frustumCulled = frustumCulled;
        });
      });
    };
  };
  root.userData.getVoxelLodDiagnostics = () => getVoxelLodDiagnostics(voxelLods);
  return root;
}

function createRuntimeVoxelBuilding(building, renderCells, sampleGroundHeight, nightLighting, enableVoxelLod = false) {
  const design = building.voxelDesign;
  const nearObject = design.generation.mode === "urban_massing"
    ? createVoxelMassingLab({ spec: design.generation.sourceSpec, decorations: design.decorations, nightLighting, renderStrategy: "greedy" })
    : createVoxelBuildingFromSpec(design.generation.sourceSpec, { decorations: design.decorations, nightLighting, renderStrategy: "greedy" });
  const object = enableVoxelLod
    ? createAgentVoxelBuildingLod(nearObject, design, nightLighting)
    : nearObject;
  const center = renderCells.reduce((sum, cell) => ({ x: sum.x + cell.center.x, z: sum.z + cell.center.z }), { x: 0, z: 0 });
  center.x /= renderCells.length;
  center.z /= renderCells.length;
  object.position.set(center.x, sampleGroundHeight(center.x, center.z) + BUILDING_BASE_ELEVATION, center.z);
  object.rotation.y = {
    north: 0,
    east: Math.PI / 2,
    south: Math.PI,
    west: -Math.PI / 2
  }[building.site.entrance] ?? Math.PI;
  object.name = `RuntimeVoxelBuilding-${building.id}`;
  object.userData = {
    ...object.userData,
    buildingId: building.id,
    designId: design.id,
    designRevision: design.revision,
    representation: `voxel-${design.generation.mode}`
  };
  return object;
}

function createAgentVoxelBuildingLod(nearObject, design, nightLighting) {
  const sourceSpec = design.generation.sourceSpec;
  const pipeline = design.generation.mode === "urban_massing"
    ? createVoxelMassingLodLevels({
      spec: sourceSpec,
      nightLighting,
      renderStrategy: "greedy",
      voxelChunkSize: 128,
      maxMergeSpanVoxels: 8
    }, [2, 3])
    : createVoxelBuildingLodLevelsFromSpec(sourceSpec, {
      decorations: design.decorations,
      nightLighting,
      renderStrategy: "greedy",
      voxelChunkSize: 128,
      maxMergeSpanVoxels: 8
    }, [2, 3]);
  const lod = new THREE.LOD();
  lod.name = `${nearObject.name}-LOD`;
  lod.autoUpdate = false;
  const nearShadowCasterCount = disableCastShadows(nearObject);
  const shadowProxy = createShadowProxy(pipeline.levels[0]?.group);
  lod.userData = {
    ...nearObject.userData,
    sphereProjectionRoot: true,
    currentLevel: null,
    boundingRadius: getObjectBoundingRadius(nearObject),
    shadowPolicy: "low-lod-proxy",
    nearShadowCasterCount: 0,
    nearShadowCastersDisabled: nearShadowCasterCount,
    shadowProxyMeshCount: shadowProxy.userData.shadowProxyMeshCount
  };
  lod.addLevel(nearObject, 0);
  pipeline.levels.forEach((level, index) => lod.addLevel(level.group, index + 1));
  lod.addLevel(new THREE.Group(), 3);
  // Keep a coarse, color-write-disabled copy active for the directional shadow pass
  // across LOD transitions. It is cheap to render and avoids promoting the near
  // building's full-detail meshes into the 2048px shadow map.
  shadowProxy.visible = true;
  lod.add(shadowProxy);
  lod.userData.updateDaylight = (style) => {
    nearObject.userData.updateDaylight?.(style);
    pipeline.updateDaylight?.(style);
  };
  return lod;
}

function disableCastShadows(object) {
  let count = 0;
  object.traverse((child) => {
    if (!child.isMesh || !child.castShadow) return;
    child.castShadow = false;
    count += 1;
  });
  return count;
}

function createShadowProxy(source) {
  const proxy = source?.clone(true) ?? new THREE.Group();
  proxy.name = `${source?.name ?? "VoxelBuilding"}-ShadowProxy`;
  let meshCount = 0;
  proxy.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = false;
    child.userData = { ...child.userData, shadowProxy: true };
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => {
        const clone = material.clone();
        clone.colorWrite = false;
        clone.depthWrite = false;
        return clone;
      });
    } else if (child.material) {
      child.material = child.material.clone();
      child.material.colorWrite = false;
      child.material.depthWrite = false;
    }
    meshCount += 1;
  });
  proxy.userData = { ...proxy.userData, shadowProxy: true, shadowProxyMeshCount: meshCount };
  return proxy;
}

function getObjectBoundingRadius(object) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  return Math.max(VOXEL_SIZE * 4, sphere.radius);
}

function updateVoxelLods(lods, camera, viewport = {}) {
  if (!camera || !lods.length) return;
  const viewportHeight = Math.max(1, Number(viewport.height) || 720);
  const projectionView = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
  lods.forEach((lod) => {
    const metrics = getVoxelLodScreenMetrics(lod, camera, frustum, viewportHeight);
    const nextLevel = selectVoxelLodLevel(lod.userData.currentLevel, metrics, 0.08);
    lod.levels.forEach((level, index) => {
      level.object.visible = index === nextLevel;
    });
    lod.userData.currentLevel = nextLevel;
    lod.userData.currentMetrics = metrics;
  });
}

function getVoxelLodScreenMetrics(lod, camera, frustum, viewportHeight) {
  const worldPosition = lod.getWorldPosition(new THREE.Vector3());
  const worldScale = lod.getWorldScale(new THREE.Vector3());
  const boundingRadius = lod.userData.boundingRadius * Math.max(worldScale.x, worldScale.y, worldScale.z);
  const visibleInFrustum = frustum.intersectsSphere(new THREE.Sphere(worldPosition, boundingRadius));
  const viewPosition = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
  const viewDepth = Math.max(0.001, -viewPosition.z);
  const pixelsPerWorldUnit = camera.isPerspectiveCamera
    ? viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDepth)
    : viewportHeight / Math.max(0.001, (camera.top - camera.bottom) / camera.zoom);
  return {
    visibleInFrustum: visibleInFrustum && viewPosition.z < 0,
    projectedVoxelPx: VOXEL_SIZE * pixelsPerWorldUnit,
    projectedDiameterPx: boundingRadius * 2 * pixelsPerWorldUnit
  };
}

function selectVoxelLodLevel(currentLevel, metrics, hysteresis) {
  if (!metrics.visibleInFrustum) return 3;
  const projected = metrics.projectedVoxelPx;
  if (currentLevel == null || currentLevel === 3) {
    return projected >= 2 ? 0 : projected >= 1 ? 1 : 2;
  }
  if (currentLevel === 0) return projected < 2 * (1 - hysteresis) ? 1 : 0;
  if (currentLevel === 1) {
    if (projected > 2 * (1 + hysteresis)) return 0;
    if (projected < 1 * (1 - hysteresis)) return 2;
    return 1;
  }
  return projected > 1 * (1 + hysteresis) ? 1 : 2;
}

function getVoxelLodDiagnostics(lods) {
  const currentLevels = lods.map((lod) => ({
    id: lod.userData.buildingId ?? lod.name,
    level: ["near", "medium", "far", "culled"][lod.userData.currentLevel] ?? "uninitialized",
    factor: lod.userData.currentLevel < 3 ? lod.userData.currentLevel + 1 : null,
    visibleInFrustum: lod.userData.currentMetrics?.visibleInFrustum ?? false,
    projectedVoxelPx: Number((lod.userData.currentMetrics?.projectedVoxelPx ?? 0).toFixed(3)),
    projectedDiameterPx: Number((lod.userData.currentMetrics?.projectedDiameterPx ?? 0).toFixed(1)),
    shadowPolicy: lod.userData.shadowPolicy ?? "near-casts-shadow",
    nearShadowCasterCount: lod.userData.nearShadowCasterCount ?? 0,
    nearShadowCastersDisabled: lod.userData.nearShadowCastersDisabled ?? 0,
    shadowProxyMeshCount: lod.userData.shadowProxyMeshCount ?? 0
  }));
  return {
    renderer: "agentcity-voxel-mip-lod-v1",
    sourceOfTruth: "Agent City BuildingSpec/UrbanMassingSpec compiled into fixed 2x and 3x macrovoxels",
    shadowPolicy: "low-lod-proxy",
    count: lods.length,
    selection: "camera frustum plus projected base-voxel screen size",
    projectedVoxelThresholdsPx: { near: 2, medium: 1 },
    hysteresis: 0.08,
    currentLevels,
    levelCounts: currentLevels.reduce((counts, entry) => {
      counts[entry.level] = (counts[entry.level] ?? 0) + 1;
      return counts;
    }, {})
  };
}

function createStarterBuilding(asset, label, cells, tileSize, sampleGroundHeight, index, entrance = "south", parallaxStrength = 0.12, useModel = false) {
  if (useModel) return createStarterModelBuilding(asset, label, cells, tileSize, sampleGroundHeight, entrance);
  return createThreeCornerParallaxBuilding(asset, label, cells, tileSize, sampleGroundHeight, index, entrance, parallaxStrength);
}

export function createStandaloneStarterAsset(asset, {
  representation = "depth",
  parcelSize = 4,
  depthStrength = 1,
  depthVariant = "all",
  label = asset.assetId
} = {}) {
  const cell = {
    id: `comparison-${representation}`,
    column: 0,
    row: 0,
    center: { x: 0, z: 0 }
  };
  const sampleGroundHeight = () => 0;
  if (representation === "model") {
    return createStarterModelBuilding(asset, label, [cell], parcelSize, sampleGroundHeight, "south");
  }
  const variant = asset.depthVariants?.[depthVariant] ?? asset.depthVariants?.all;
  const depthAsset = variant
    ? { ...asset, maps: { ...asset.maps, depth: variant.depth, normal: variant.normal }, depthEncoding: variant.depthEncoding }
    : asset;
  const object = createRigidDepthMeshBuilding(depthAsset, label, [cell], parcelSize, sampleGroundHeight, 0, "south", 0.12 * depthStrength);
  object.userData.depthFitSurfaces = variant?.fitSurfaces ?? "all";
  return object;
}

function createStarterModelBuilding(asset, label, cells, tileSize, sampleGroundHeight, entrance) {
  const group = new THREE.Group();
  group.name = `${asset.assetId}-${label}`;
  const parcel = getParcelBounds(cells, tileSize);
  const baseY = sampleGroundHeight(parcel.center.x, parcel.center.z) + BUILDING_BASE_ELEVATION;
  group.userData = {
    assetId: asset.assetId,
    cellId: cells[0].id,
    footprintCells: cells.map((cell) => cell.id),
    entrance,
    label,
    representation: "hunyuan3d-model",
    modelPath: asset.model.glb,
    modelStatus: "loading",
    parcel: { cellSize: tileSize, width: parcel.width, depth: parcel.depth, worldDimensions: asset.dimensions }
  };

  new GLTFLoader().load(asset.model.glb, async (gltf) => {
    const model = gltf.scene;
    model.name = `${asset.assetId}-Hunyuan3D`;
    const fallbackRotationY = Number(asset.model.rotationY ?? 0);
    let orientation = {
      method: "configured-fallback",
      rotationY: fallbackRotationY,
      requiresReview: false,
      confidence: 1,
      scores: []
    };
    if (asset.model.orientationMode === "auto-rgb-four-way") {
      group.userData.modelStatus = "orienting";
      try {
        const result = await resolveAutomaticModelOrientation(asset, model);
        orientation = result;
      } catch (error) {
        orientation = {
          method: "configured-fallback",
          rotationY: fallbackRotationY,
          requiresReview: true,
          confidence: 0,
          scores: [],
          error: error?.message ?? String(error)
        };
      }
    }
    model.rotation.y = THREE.MathUtils.degToRad(orientation.rotationY);
    model.updateMatrixWorld(true);

    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const footprintSpan = Math.max(size.x, size.z, 0.001);
    const desiredSpan = Math.min(parcel.width, parcel.depth) * (asset.model.footprintFill ?? 0.9);
    model.scale.setScalar(desiredSpan / footprintSpan);
    model.updateMatrixWorld(true);

    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x += parcel.center.x - center.x;
    model.position.y += baseY - bounds.min.y;
    model.position.z += parcel.center.z - center.z;
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);

    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    group.add(model);
    group.userData.modelStatus = "loaded";
    group.userData.orientation = orientation;
    group.userData.worldBounds = {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: bounds.getSize(new THREE.Vector3()).toArray()
    };
  }, undefined, (error) => {
    group.userData.modelStatus = "error";
    group.userData.modelError = error?.message ?? String(error);
    console.error(`Failed to load ${asset.model.glb}`, error);
  });
  return group;
}

function createThreeCornerParallaxBuilding(asset, label, cells, tileSize, sampleGroundHeight, index, entrance = "south", parallaxStrength = 0.12) {
  const group = new THREE.Group();
  group.name = `${asset.assetId}-${label}`;
  const parcel = getParcelBounds(cells, tileSize);
  const anchors = normalizeBaseAnchors(asset.baseAnchorsUv ?? asset.guideplate?.baseAnchorsUv);
  const colorTexture = loadAssetTexture(asset.maps.rgb, true);
  const depthTexture = loadAssetTexture(asset.maps.depth, false);
  const normalTexture = loadAssetTexture(asset.maps.normal, false);
  const emissiveTexture = asset.maps.emissive ? loadAssetTexture(asset.maps.emissive, true) : createTransparentTexture();
  const material = createThreeCornerParallaxMaterial({
    anchors,
    colorTexture,
    depthTexture,
    normalTexture,
    emissiveTexture,
    parallaxStrength
  });
  const mesh = new THREE.Mesh(createScreenFitQuadGeometry(anchors), material);
  mesh.name = `${asset.assetId}-ThreeCornerParallaxSprite`;
  mesh.renderOrder = 1000 + index;
  mesh.frustumCulled = false;
  mesh.userData.textures = [colorTexture, depthTexture, normalTexture, emissiveTexture];
  group.add(mesh);

  const targetWorld = {
    left: new THREE.Vector3(parcel.minX, sampleGroundHeight(parcel.minX, parcel.maxZ) + BUILDING_BASE_ELEVATION, parcel.maxZ),
    near: new THREE.Vector3(parcel.maxX, sampleGroundHeight(parcel.maxX, parcel.maxZ) + BUILDING_BASE_ELEVATION, parcel.maxZ),
    right: new THREE.Vector3(parcel.maxX, sampleGroundHeight(parcel.maxX, parcel.minZ) + BUILDING_BASE_ELEVATION, parcel.minZ)
  };
  const viewOffset = new THREE.Vector2();
  let restDirection = null;
  const controller = {
    assetId: asset.assetId,
    parallaxStrength,
    viewOffset,
    get renderOrder() { return mesh.renderOrder; },
    update(camera) {
      if (!camera) return;
      camera.updateMatrixWorld();
      material.uniforms.targetLeft.value.copy(targetWorld.left).project(camera);
      material.uniforms.targetNear.value.copy(targetWorld.near).project(camera);
      material.uniforms.targetRight.value.copy(targetWorld.right).project(camera);
      mesh.renderOrder = getScreenSpaceBuildingRenderOrder(material.uniforms.targetNear.value);
      mesh.userData.screenSpaceRenderOrder = mesh.renderOrder;
      const direction = camera.getWorldDirection(new THREE.Vector3()).normalize();
      if (!restDirection) restDirection = direction.clone();
      const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      const delta = direction.clone().sub(restDirection);
      viewOffset.set(
        THREE.MathUtils.clamp(delta.dot(cameraRight) * 2.25, -1, 1),
        THREE.MathUtils.clamp(delta.dot(cameraUp) * 2.25, -1, 1)
      );
      material.uniforms.cameraViewOffset.value.copy(viewOffset);
    },
    updateDaylight(style, manualNightLighting = 0) {
      material.uniforms.globalLightColor.value.copy(style.rgbTint ?? new THREE.Color("#ffffff"));
      material.uniforms.globalLightStrength.value = style.rgbStrength ?? 1;
      material.uniforms.nightEmission.value = getStarterNightEmission(
        style,
        manualNightLighting,
        EMISSIVE_STRENGTHS[asset.assetId] ?? 1.4
      );
    }
  };

  group.userData = {
    assetId: asset.assetId,
    cellId: cells[0].id,
    footprintCells: cells.map((cell) => cell.id),
    entrance,
    label,
    representation: "three-corner-parallax-sprite",
    parcel: {
      cellSize: tileSize,
      width: parcel.width,
      depth: parcel.depth,
      worldDimensions: asset.dimensions ?? asset.guideplate?.dimensions ?? { length: 4, width: 4, height: 4, unit: "world" }
    },
    guideplate: asset.guideplate ?? null,
    baseFitController: controller
  };
  return group;
}

function createScreenFitQuadGeometry(anchors) {
  const geometry = new THREE.BufferGeometry();
  const divisions = 24;
  const values = Array.from({ length: divisions + 1 }, (_, index) => index / divisions);
  const xCoordinates = uniqueSorted([...values, anchors.left[0], anchors.near[0], anchors.right[0]]);
  const yCoordinates = uniqueSorted([...values, anchors.left[1], anchors.near[1], anchors.right[1]]);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const y of yCoordinates) {
    for (const x of xCoordinates) {
      positions.push(0, 0, 0);
      uvs.push(x, y);
    }
  }
  const columns = xCoordinates.length;
  for (let row = 0; row < yCoordinates.length - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const northwest = row * columns + column;
      const northeast = northwest + 1;
      const southwest = northwest + columns;
      const southeast = southwest + 1;
      indices.push(northwest, southeast, northeast, northwest, southwest, southeast);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export function getScreenSpaceBuildingRenderOrder(point = {}) {
  const x = THREE.MathUtils.clamp(Number(point.x ?? 0), -2, 2);
  const y = THREE.MathUtils.clamp(Number(point.y ?? 0), -2, 2);
  const verticalBucket = Math.round((2 - y) * 1_000_000);
  const horizontalBucket = Math.round((x + 2) * 1_000);
  return 1000 + verticalBucket * 10_000 + horizontalBucket;
}

function createThreeCornerParallaxMaterial({ anchors, colorTexture, depthTexture, normalTexture, emissiveTexture, parallaxStrength }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      colorMap: { value: colorTexture },
      depthMap: { value: depthTexture },
      normalMap: { value: normalTexture },
      emissiveMap: { value: emissiveTexture },
      sourceLeft: { value: new THREE.Vector2(...anchors.left) },
      sourceNear: { value: new THREE.Vector2(...anchors.near) },
      sourceRight: { value: new THREE.Vector2(...anchors.right) },
      targetLeft: { value: new THREE.Vector3() },
      targetNear: { value: new THREE.Vector3() },
      targetRight: { value: new THREE.Vector3() },
      cameraViewOffset: { value: new THREE.Vector2() },
      parallaxStrength: { value: parallaxStrength },
      globalLightColor: { value: new THREE.Color("#ffffff") },
      globalLightStrength: { value: 1 },
      nightEmission: { value: 0 }
    },
    vertexShader: `
      uniform vec2 sourceLeft;
      uniform vec2 sourceNear;
      uniform vec2 sourceRight;
      uniform vec3 targetLeft;
      uniform vec3 targetNear;
      uniform vec3 targetRight;
      varying vec2 vUv;

      vec3 triangleWeights(vec2 point) {
        vec2 nearAxis = sourceNear - sourceLeft;
        vec2 rightAxis = sourceRight - sourceLeft;
        vec2 offset = point - sourceLeft;
        float determinant = nearAxis.x * rightAxis.y - nearAxis.y * rightAxis.x;
        float nearWeight = (offset.x * rightAxis.y - offset.y * rightAxis.x) / determinant;
        float rightWeight = (nearAxis.x * offset.y - nearAxis.y * offset.x) / determinant;
        return vec3(1.0 - nearWeight - rightWeight, nearWeight, rightWeight);
      }

      void main() {
        vUv = uv;
        vec3 weights = triangleWeights(uv);
        vec3 ndc = weights.x * targetLeft + weights.y * targetNear + weights.z * targetRight;
        gl_Position = vec4(ndc.xy, ndc.z - 0.00025, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colorMap;
      uniform sampler2D depthMap;
      uniform sampler2D normalMap;
      uniform sampler2D emissiveMap;
      uniform vec2 cameraViewOffset;
      uniform float parallaxStrength;
      uniform vec3 globalLightColor;
      uniform float globalLightStrength;
      uniform float nightEmission;
      varying vec2 vUv;

      vec2 parallaxUv(vec2 uv) {
        const int steps = 10;
        float layerDepth = 0.0;
        float layerStep = 1.0 / float(steps);
        vec2 delta = -clamp(cameraViewOffset, vec2(-1.0), vec2(1.0)) * parallaxStrength * layerStep;
        vec2 currentUv = uv;
        for (int i = 0; i < steps; i++) {
          float sampledDepth = texture2D(depthMap, clamp(currentUv, vec2(0.001), vec2(0.999))).r;
          if (layerDepth >= sampledDepth) break;
          currentUv -= delta;
          layerDepth += layerStep;
        }
        return currentUv;
      }

      void main() {
        vec4 silhouette = texture2D(colorMap, vUv);
        if (silhouette.a < 0.08) discard;
        vec2 sampleUv = parallaxUv(vUv);
        if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) discard;
        vec4 color = texture2D(colorMap, sampleUv);
        if (color.a < 0.08) color = silhouette;
        vec3 reliefNormal = normalize(texture2D(normalMap, sampleUv).rgb * 2.0 - 1.0);
        float normalLight = max(dot(reliefNormal, normalize(vec3(-0.3, 0.42, 0.86))), 0.0);
        color.rgb *= globalLightColor * globalLightStrength * (0.94 + normalLight * 0.1);
        vec4 emission = texture2D(emissiveMap, sampleUv);
        color.rgb += emission.rgb * emission.a * nightEmission;
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });
}

function createTransparentTexture() {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function getStarterNightEmission(style = {}, manualNightLighting = 0, emissiveStrength = 1.4) {
  const night = THREE.MathUtils.clamp(Math.max(Number(style.nightFactor ?? 0), Number(manualNightLighting ?? 0)), 0, 1);
  return night * Number(emissiveStrength ?? 0);
}

function createRigidDepthMeshBuilding(asset, label, cells, tileSize, sampleGroundHeight, index, entrance = "south", parallaxStrength = 0.12) {
  const group = new THREE.Group();
  group.name = `${asset.assetId}-${label}`;
  const parcel = getParcelBounds(cells, tileSize);
  const baseY = sampleGroundHeight(parcel.center.x, parcel.center.z) + BUILDING_BASE_ELEVATION;
  const baseAnchorsUv = normalizeBaseAnchors(asset.baseAnchorsUv ?? asset.guideplate?.baseAnchorsUv);
  const colorTexture = loadAssetTexture(asset.maps.rgb, true);
  const depthTexture = loadAssetTexture(asset.maps.depth, false);
  const normalTexture = loadAssetTexture(asset.maps.normal, false);
  const placement = createRigidDepthMeshPlacement(asset, parcel, sampleGroundHeight, baseY);
  const material = createRigidDepthMeshMaterial({ asset, colorTexture, depthTexture, normalTexture, baseAnchorsUv, placement, parallaxStrength });
  const mesh = new THREE.Mesh(createRigidDepthMeshGeometry(baseAnchorsUv), material);
  mesh.position.set(parcel.center.x, baseY, parcel.center.z);
  mesh.scale.set(placement.scaleX, placement.scaleY, placement.scaleZ);
  mesh.renderOrder = 2 + index;
  mesh.name = `${asset.assetId}-RigidDepthMesh`;
  mesh.userData.textures = [colorTexture, depthTexture, normalTexture];
  group.add(mesh);
  group.userData = {
    assetId: asset.assetId,
    cellId: cells[0].id,
    footprintCells: cells.map((cell) => cell.id),
    entrance,
    label,
    representation: "rigid-local-depth-mesh",
    parcel: { cellSize: tileSize, width: parcel.width, depth: parcel.depth, worldDimensions: asset.guideplate?.dimensions ?? { length: 4, width: 4, height: 4, unit: "world" } },
    guideplate: asset.guideplate ?? null,
    depthMeshController: {
      assetId: asset.assetId,
      groundSeamHeight: placement.groundSeamHeight,
      depthEncoding: asset.depthEncoding,
      depthStrength: parallaxStrength / 0.12
    }
  };
  return group;
}

function createRigidDepthMeshPlacement(asset, parcel, sampleGroundHeight, baseY) {
  const dimensions = asset.guideplate?.dimensions ?? asset.dimensions ?? { length: 4, width: 4, height: 4 };
  const nativeWidth = Math.max(Number(dimensions.length ?? 4), 1e-6);
  const nativeDepth = Math.max(Number(dimensions.width ?? 4), 1e-6);
  const nativeHeight = Math.max(Number(dimensions.height ?? 4), 1e-6);
  const scaleX = parcel.width / nativeWidth;
  const scaleZ = parcel.depth / nativeDepth;
  const scaleY = Math.min(scaleX, scaleZ);
  const sampleOffset = (x, z) => (sampleGroundHeight(x, z) + BUILDING_BASE_ELEVATION - baseY) / scaleY;
  return {
    nativeWidth,
    nativeDepth,
    nativeHeight,
    scaleX,
    scaleY,
    scaleZ,
    groundSeamHeight: nativeHeight * GROUND_SEAM_HEIGHT_RATIO,
    groundOffsets: {
      left: sampleOffset(parcel.minX, parcel.maxZ),
      near: sampleOffset(parcel.maxX, parcel.maxZ),
      right: sampleOffset(parcel.maxX, parcel.minZ),
      far: sampleOffset(parcel.minX, parcel.minZ)
    }
  };
}

function createRigidDepthMeshGeometry(baseAnchorsUv = FALLBACK_BASE_ANCHORS_UV) {
  const anchors = normalizeBaseAnchors(baseAnchorsUv);
  const axisValues = (axis) => uniqueSorted([
    ...Array.from({ length: DEPTH_MESH_SUBDIVISIONS + 1 }, (_, index) => index / DEPTH_MESH_SUBDIVISIONS),
    anchors.left[axis],
    anchors.near[axis],
    anchors.right[axis]
  ]);
  const columns = axisValues(0);
  const rows = axisValues(1);
  const positions = [];
  const uvs = [];
  rows.forEach((v) => columns.forEach((u) => {
    positions.push(0, 0, 0);
    uvs.push(u, v);
  }));
  const indices = [];
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < columns.length - 1; column += 1) {
      const bottomLeft = row * columns.length + column;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + columns.length;
      const topRight = topLeft + 1;
      indices.push(topLeft, bottomRight, topRight, topLeft, bottomLeft, bottomRight);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function loadAssetTexture(path, srgb, onLoad) {
  const texture = new THREE.TextureLoader().load(path, onLoad);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function createRigidDepthMeshMaterial({ asset, colorTexture, depthTexture, normalTexture, baseAnchorsUv, placement, parallaxStrength }) {
  const anchors = normalizeBaseAnchors(baseAnchorsUv);
  const dimensions = asset.guideplate?.dimensions ?? asset.dimensions ?? { length: 4, width: 4, height: 4 };
  const basis = createOrthographicCameraBasis(asset.guideplate?.camera ?? { yaw: 45, elevation: 55 });
  const localAnchors = {
    left: new THREE.Vector3(-placement.nativeWidth / 2, 0, placement.nativeDepth / 2),
    near: new THREE.Vector3(placement.nativeWidth / 2, 0, placement.nativeDepth / 2),
    right: new THREE.Vector3(placement.nativeWidth / 2, 0, -placement.nativeDepth / 2)
  };
  const screenAnchor = (point) => new THREE.Vector2(point.dot(basis.right), point.dot(basis.up));
  const expectedDepth = (point) => point.dot(basis.view);
  const encoding = asset.depthEncoding;
  if (!["global-linear-quantile-fit-v1", "metric-depth-view-translation-v1"].includes(encoding?.kind)) {
    throw new Error(`${asset.assetId} is missing a supported view-depth encoding`);
  }
  const uniforms = {
    colorMap: { value: colorTexture },
    depthMap: { value: depthTexture },
    normalMap: { value: normalTexture },
    sourceLeft: { value: new THREE.Vector2(...anchors.left) },
    sourceNear: { value: new THREE.Vector2(...anchors.near) },
    sourceRight: { value: new THREE.Vector2(...anchors.right) },
    screenLeft: { value: screenAnchor(localAnchors.left) },
    screenNear: { value: screenAnchor(localAnchors.near) },
    screenRight: { value: screenAnchor(localAnchors.right) },
    expectedAnchorDepths: { value: new THREE.Vector3(expectedDepth(localAnchors.left), expectedDepth(localAnchors.near), expectedDepth(localAnchors.right)) },
    depthRange: { value: new THREE.Vector2(Number(encoding.minimumViewDepth), Number(encoding.maximumViewDepth)) },
    guideRight: { value: basis.right },
    guideUp: { value: basis.up },
    guideView: { value: basis.view },
    depthReliefStrength: { value: parallaxStrength / 0.12 },
    nativeDimensions: { value: new THREE.Vector3(Number(dimensions.length ?? 4), Number(dimensions.height ?? 4), Number(dimensions.width ?? 4)) },
    groundOffsets: { value: new THREE.Vector4(placement.groundOffsets.left, placement.groundOffsets.near, placement.groundOffsets.right, placement.groundOffsets.far) },
    groundSeamHeight: { value: placement.groundSeamHeight }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      uniform sampler2D depthMap;
      uniform vec2 sourceLeft;
      uniform vec2 sourceNear;
      uniform vec2 sourceRight;
      uniform vec2 screenLeft;
      uniform vec2 screenNear;
      uniform vec2 screenRight;
      uniform vec3 expectedAnchorDepths;
      uniform vec2 depthRange;
      uniform vec3 guideRight;
      uniform vec3 guideUp;
      uniform vec3 guideView;
      uniform float depthReliefStrength;
      uniform vec3 nativeDimensions;
      uniform vec4 groundOffsets;
      uniform float groundSeamHeight;
      varying vec2 vUv;

      vec3 triangleWeights(vec2 point) {
        vec2 nearAxis = sourceNear - sourceLeft;
        vec2 rightAxis = sourceRight - sourceLeft;
        vec2 offset = point - sourceLeft;
        float determinant = nearAxis.x * rightAxis.y - nearAxis.y * rightAxis.x;
        float nearWeight = (offset.x * rightAxis.y - offset.y * rightAxis.x) / determinant;
        float rightWeight = (nearAxis.x * offset.y - nearAxis.y * offset.x) / determinant;
        return vec3(1.0 - nearWeight - rightWeight, nearWeight, rightWeight);
      }

      float decodeDepth(float encodedDepth) {
        return mix(depthRange.x, depthRange.y, clamp(encodedDepth, 0.0, 1.0));
      }

      void main() {
        vUv = uv;
        vec3 weights = triangleWeights(uv);
        vec2 screen = weights.x * screenLeft + weights.y * screenNear + weights.z * screenRight;
        float affineBaseDepth = dot(weights, expectedAnchorDepths);
        float globallyFittedViewDepth = decodeDepth(texture2D(depthMap, uv).r);
        float viewDepth = mix(affineBaseDepth, globallyFittedViewDepth, clamp(depthReliefStrength, 0.0, 2.0));
        vec3 localPosition = guideRight * screen.x + guideUp * screen.y + guideView * viewDepth;
        localPosition.x = clamp(localPosition.x, -nativeDimensions.x * 0.7, nativeDimensions.x * 0.7);
        localPosition.y = clamp(localPosition.y, -nativeDimensions.y * 0.08, nativeDimensions.y * 1.32);
        localPosition.z = clamp(localPosition.z, -nativeDimensions.z * 0.7, nativeDimensions.z * 0.7);

        float plotX = clamp(localPosition.x / nativeDimensions.x + 0.5, 0.0, 1.0);
        float plotZ = clamp(localPosition.z / nativeDimensions.z + 0.5, 0.0, 1.0);
        float positiveZOffset = mix(groundOffsets.x, groundOffsets.y, plotX);
        float negativeZOffset = mix(groundOffsets.w, groundOffsets.z, plotX);
        float groundOffset = mix(negativeZOffset, positiveZOffset, plotZ);
        float groundBlend = 1.0 - smoothstep(0.0, groundSeamHeight, max(localPosition.y, 0.0));
        localPosition.y += groundOffset * groundBlend;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D colorMap;
      uniform sampler2D normalMap;
      varying vec2 vUv;

      void main() {
        vec4 baseColor = texture2D(colorMap, vUv);
        if (baseColor.a < 0.08) discard;
        vec3 reliefNormal = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
        float normalLight = max(dot(reliefNormal, normalize(vec3(-0.3, 0.42, 0.86))), 0.0);
        baseColor.rgb *= 0.94 + normalLight * 0.1;
        gl_FragColor = baseColor;
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    alphaTest: 0.08,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    toneMapped: false
  });
  material.userData.rigidDepthMesh = true;
  return material;
}

export function createOrthographicCameraBasis(camera = {}) {
  const yaw = THREE.MathUtils.degToRad(Number(camera.yaw ?? 45));
  const elevation = THREE.MathUtils.degToRad(Number(camera.elevation ?? 55));
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinElevation = Math.sin(elevation);
  const cosElevation = Math.cos(elevation);
  return {
    right: new THREE.Vector3(cosYaw, 0, -sinYaw),
    up: new THREE.Vector3(-sinElevation * sinYaw, cosElevation, -sinElevation * cosYaw),
    view: new THREE.Vector3(cosElevation * sinYaw, sinElevation, cosElevation * cosYaw)
  };
}

export function reconstructRigidDepthPoint({
  uv,
  encodedDepth,
  baseAnchorsUv = FALLBACK_BASE_ANCHORS_UV,
  dimensions = { length: 4, width: 4, height: 4 },
  camera = { yaw: 45, elevation: 55 },
  depthEncoding
}) {
  const basis = createOrthographicCameraBasis(camera);
  const width = Number(dimensions.length ?? 4);
  const depth = Number(dimensions.width ?? 4);
  const localAnchors = {
    left: new THREE.Vector3(-width / 2, 0, depth / 2),
    near: new THREE.Vector3(width / 2, 0, depth / 2),
    right: new THREE.Vector3(width / 2, 0, -depth / 2)
  };
  const weights = getTriangleWeights(uv, baseAnchorsUv);
  const decode = (value) => THREE.MathUtils.lerp(
    Number(depthEncoding.minimumViewDepth),
    Number(depthEncoding.maximumViewDepth),
    THREE.MathUtils.clamp(Number(value), 0, 1)
  );
  const keys = ["left", "near", "right"];
  const screen = new THREE.Vector2();
  keys.forEach((key, index) => {
    const anchor = localAnchors[key];
    screen.addScaledVector(new THREE.Vector2(anchor.dot(basis.right), anchor.dot(basis.up)), weights[index]);
  });
  return basis.right.clone().multiplyScalar(screen.x)
    .addScaledVector(basis.up, screen.y)
    .addScaledVector(basis.view, decode(encodedDepth));
}

function getTriangleWeights(point, anchors) {
  const source = normalizeBaseAnchors(anchors);
  const left = source.left;
  const nearAxis = [source.near[0] - left[0], source.near[1] - left[1]];
  const rightAxis = [source.right[0] - left[0], source.right[1] - left[1]];
  const offset = [point[0] - left[0], point[1] - left[1]];
  const determinant = nearAxis[0] * rightAxis[1] - nearAxis[1] * rightAxis[0];
  if (Math.abs(determinant) < 1e-8) throw new Error("Base anchors must form a non-degenerate triangle");
  const nearWeight = (offset[0] * rightAxis[1] - offset[1] * rightAxis[0]) / determinant;
  const rightWeight = (nearAxis[0] * offset[1] - nearAxis[1] * offset[0]) / determinant;
  return [1 - nearWeight - rightWeight, nearWeight, rightWeight];
}

export function mapPointThroughBaseFit(point, sourceAnchors, targetAnchors) {
  const source = normalizeBaseAnchors(sourceAnchors);
  const left = source.left;
  const nearAxis = [source.near[0] - left[0], source.near[1] - left[1]];
  const rightAxis = [source.right[0] - left[0], source.right[1] - left[1]];
  const offset = [point[0] - left[0], point[1] - left[1]];
  const determinant = nearAxis[0] * rightAxis[1] - nearAxis[1] * rightAxis[0];
  if (Math.abs(determinant) < 1e-8) throw new Error("Base-fit source anchors must form a non-degenerate triangle");
  const nearWeight = (offset[0] * rightAxis[1] - offset[1] * rightAxis[0]) / determinant;
  const rightWeight = (nearAxis[0] * offset[1] - nearAxis[1] * offset[0]) / determinant;
  return [
    targetAnchors.left[0] + nearWeight * (targetAnchors.near[0] - targetAnchors.left[0]) + rightWeight * (targetAnchors.right[0] - targetAnchors.left[0]),
    targetAnchors.left[1] + nearWeight * (targetAnchors.near[1] - targetAnchors.left[1]) + rightWeight * (targetAnchors.right[1] - targetAnchors.left[1])
  ];
}

function normalizeBaseAnchors(baseAnchorsUv) {
  const anchors = baseAnchorsUv ?? FALLBACK_BASE_ANCHORS_UV;
  return {
    left: [...anchors.left],
    near: [...anchors.near],
    right: [...anchors.right]
  };
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Number(value.toFixed(12))))].sort((a, b) => a - b);
}

function resolveRenderCell(cells, sourceCellId) {
  const exact = cells.get(sourceCellId);
  if (exact) return exact;
  const match = /^cell-(\d+)-(\d+)$/.exec(sourceCellId ?? "");
  if (!match) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  return [...cells.values()].sort((a, b) =>
    Math.abs(a.column - column) + Math.abs(a.row - row) - (Math.abs(b.column - column) + Math.abs(b.row - row))
  )[0] ?? null;
}

function getParcelBounds(cells, tileSize) {
  const minX = Math.min(...cells.map((cell) => cell.center.x - tileSize / 2));
  const maxX = Math.max(...cells.map((cell) => cell.center.x + tileSize / 2));
  const minZ = Math.min(...cells.map((cell) => cell.center.z - tileSize / 2));
  const maxZ = Math.max(...cells.map((cell) => cell.center.z + tileSize / 2));
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
  };
}

function getNeighborCellId(cells, entrance) {
  const offsets = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const [dx, dy] = offsets[entrance] ?? offsets.south;
  const footprintIds = new Set(cells.map((cell) => cell.id));
  const edgeCells = cells.filter((cell) => !footprintIds.has(`cell-${cell.column + dx}-${cell.row + dy}`));
  const axis = entrance === "north" || entrance === "south" ? "column" : "row";
  edgeCells.sort((left, right) => left[axis] - right[axis] || left.id.localeCompare(right.id));
  const edge = edgeCells[Math.floor((edgeCells.length - 1) / 2)];
  return edge ? `cell-${edge.column + dx}-${edge.row + dy}` : null;
}
