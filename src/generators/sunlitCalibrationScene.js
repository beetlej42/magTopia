import * as THREE from "three";
import { createVoxelBuildingLab, VOXEL_BUILDING_PRESETS, voxelDaylightStyle } from "./voxelBuildingLab.js";
import { projectDistrictOntoSphere } from "./voxelIntentDistrict.js";
import { ACTIVE_VISUAL_THEME } from "../render/sunlitStorybookTheme.js";
import { applyStorybookSurfaceMaterial, STORYBOOK_SURFACE_KINDS } from "../render/storybookSurfaceMaterial.js";

// Studio-only: deterministic terraces using the same generators/materials as
// the city. Near rows expose both wall orientations; distant rows probe haze.
export function createSunlitCalibrationScene(config = {}) {
  const root = new THREE.Group();
  root.name = "SunlitCalibrationTerraces";
  const rows = [];
  for (const [index, z] of [-1, -13, -36, -65].entries()) {
    const row = createVoxelBuildingLab({
      ...VOXEL_BUILDING_PRESETS.connectedTerraceDay,
      seed: "sunlit-calibration-terrace", floors: 2,
      floorPrograms: VOXEL_BUILDING_PRESETS.connectedTerraceDay.floorPrograms.slice(0, 2),
      buildingCount: 3, sunTime: config.sunTime ?? 0.38,
      nightLighting: 0, includeStreetBase: true, includeStreetLamps: true,
      renderStrategy: "greedy", voxelChunkSize: 128, maxMergeSpanVoxels: 8
    });
    row.name = `CalibrationTerrace-${index}`;
    row.position.set(-6, 0.03, z);
    row.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.userData.calibrationRow = index;
      if (mesh.userData.voxelRenderStrategy) mesh.castShadow = !mesh.material.transparent;
    });
    rows.push(row);
    root.add(row);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 220, 60, 72),
    applyStorybookSurfaceMaterial(new THREE.MeshStandardMaterial({ color: ACTIVE_VISUAL_THEME.materials.grass, roughness: 1 }), {
      surfaceKind: STORYBOOK_SURFACE_KINDS.felt
    }));
  ground.geometry.rotateX(-Math.PI / 2);
  ground.position.set(0, -0.08, -30);
  ground.receiveShadow = true;
  ground.userData.flatVoxelGeometry = true;
  root.add(ground);
  projectDistrictOntoSphere(root, 220);
  root.userData.surfaceNavigation = {
    radius: 220, bounds: { minX: -40, maxX: 40, minZ: -80, maxZ: 20 },
    yawDegrees: 45, elevationDegrees: 35.264, cameraDistance: 34, targetHeight: 3
  };
  root.userData.updateDaylight = (style) => rows.forEach((row) => row.userData.updateDaylight?.(style));
  root.userData.getVoxelDiagnostics = () => ({ success: true, renderer: "sunlit-calibration", buildings: 12, rows: 4 });
  root.userData.updateDaylight(voxelDaylightStyle(config.sunTime ?? 0.38));
  return root;
}
