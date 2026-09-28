import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createMinistryOfMagic, ministryOfMagicSpec, addMinistryVoxelDetails, MINISTRY_ASSET_ID, MINISTRY_MATERIALS } from "../src/generators/ministryOfMagic.js";
import { VoxelInstanceBuffer, createVoxelMassingLab } from "../src/generators/voxelBuildingLab.js";
import { createPublicBuildingStylePreset } from "../src/generators/publicBuildingStyleComparison.js";
import { createBuildingDesignObject, disposeBuildingObject, buildingEntranceRotation } from "../src/generators/buildingDesignObject.js";
import { renderBuildingVisualization } from "../src/render/buildingVisualization.js";
import { createMagicLondonStarterDistrict } from "../src/generators/magicLondonStarterDistrict.js";
import { resolveSpecialStructurePreview, createSpecialStructurePreview } from "../src/ui/specialStructurePreview.js";
import { createCityPlacementLayer } from "../src/ui/cityPlacementLayer.js";
import { projectDistrictOntoSphere } from "../src/generators/voxelIntentDistrict.js";

test("Ministry stays inside 2x2 in every direction with shared voxel meshing and a bounded budget", () => {
  const object = createMinistryOfMagic();
  assert.ok(object.children.length <= 12);
  assert.equal(object.userData.diagnostics.renderer, "voxel-massing-v1");
  assert.equal(object.userData.diagnostics.voxelSize, 0.125);
  assert.equal(object.userData.diagnostics.renderStats.strategy, "greedy-chunks");
  let triangles = 0;
  object.traverse(child => {
    if (!child.isMesh) return;
    triangles += (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3;
    assert.equal(child.userData.flatVoxelGeometry, true);
    for (const coordinate of child.geometry.attributes.position.array)
      assert.ok(Math.abs(coordinate / 0.125 - Math.round(coordinate / 0.125)) < 1e-5, "every vertex must lie on the shared voxel grid");
    const normals = child.geometry.attributes.normal.array;
    for (let i = 0; i < normals.length; i += 3)
      assert.equal(Math.abs(normals[i]) + Math.abs(normals[i+1]) + Math.abs(normals[i+2]), 1, "all faces must be axis-aligned voxel faces");
  });
  assert.ok(triangles > 5000 && triangles < 16000);
  for(const entrance of ["north","east","south","west"]) {
    object.rotation.y = buildingEntranceRotation(entrance);
    const bounds = new THREE.Box3().setFromObject(object);
    assert.ok(bounds.min.x >= -4.000001 && bounds.max.x <= 4.000001);
    assert.ok(bounds.min.z >= -4.000001 && bounds.max.z <= 4.000001);
    assert.ok(bounds.min.y >= -0.250001 && bounds.max.y < 10);
  }
  const windows = object.children.find(child => child.userData.materialId === "warmWindow");
  object.userData.updateDaylight({nightFactor:1}); const night = windows.material.emissiveIntensity;
  object.userData.updateDaylight({nightFactor:0});
  assert.ok(windows.material.emissiveIntensity < night);
  disposeBuildingObject(object);
});

test("CLI compiler, placement preview and city use the exact same landmark geometry", () => {
  const spec = ministryOfMagicSpec();
  const source = resolveSpecialStructurePreview({card:{card_id:"ministry-of-magic",structure:{footprint:"2x2"}}});
  assert.equal(source.kind,"prefab");
  const preview = createSpecialStructurePreview(source.spec);
  const compiled = createBuildingDesignObject({generation:{mode:"landmark_prefab",sourceSpec:spec}});
  assertGeometryEqual(preview, compiled);
  const cells = [0,1,2,3].map(i=>({id:`cell-${i%2}-${Math.floor(i/2)}`,column:i%2,row:Math.floor(i/2),center:{x:(i%2)*4-2,z:2-Math.floor(i/2)*4}}));
  for(const entrance of ["north","east","south","west"]) {
    const building={id:"ministry",specialStructure:{cardId:"ministry-of-magic"},site:{lotId:cells[0].id,footprint:"2x2",entrance},footprintCells:cells.map(c=>c.id),program:{name:"Ministry"}};
    const city = createMagicLondonStarterDistrict({grid:{cells,cellWorldSize:4},sampleGroundHeight:()=>0,cityState:{buildings:{ministry:building}}});
    const model = city.getObjectByName("MinistryOfMagic");
    assert.ok(model,"existing special buildings without voxelDesign must render");
    assert.equal(model.userData.assetId,MINISTRY_ASSET_ID);
    assert.equal(model.rotation.y,buildingEntranceRotation(entrance));
    assertGeometryEqual(model, compiled);
    projectDistrictOntoSphere(city,220);
    assert.equal(model.children.length,compiled.children.length,"sphere projection must keep the model together");
    disposeBuildingObject(city);
  }
  const layer=createCityPlacementLayer(); const root=new THREE.Group(); layer.setSceneRoot(root);
  layer.showGhost({hasTarget:true,isLegal:true,lotId:cells[0].id,footprintColumns:2,footprintRows:2,entrance:"north",previewSource:source,
    cells:cells.map(c=>({...c,centerX:c.center.x,centerZ:c.center.z}))});
  assert.equal(layer.object.getObjectByName("CityPlacementGhost").userData.ghostMode,"landmark-prefab-preview");
  const ghost = layer.object.getObjectByName("MinistryOfMagic");
  assertGeometryEqual(ghost, compiled);
  layer.dispose(); disposeBuildingObject(preview); disposeBuildingObject(compiled);
});

test("lightweight visualizer renders distinct deterministic landmark views", () => {
  const input={sourceSpec:ministryOfMagicSpec(),site:{entrance:"north"}};
  const front=renderBuildingVisualization(input,{size:512});
  assert.equal(front.metadata.generationMode,"landmark_prefab");
  assert.deepEqual(front.png,renderBuildingVisualization(input,{size:512}).png);
  for(const view of ["back","top"]) {
    const result=renderBuildingVisualization(input,{view,size:512});
    assert.ok(result.png.length>10000);
    assert.notDeepEqual(result.png,front.png);
  }
});

function assertGeometryEqual(actual, expected) {
  assert.equal(actual.children.length, expected.children.length);
  for (let i = 0; i < expected.children.length; i++) {
    const a = actual.children[i].geometry, b = expected.children[i].geometry;
    assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
    assert.deepEqual(a.index.array, b.index.array);
  }
}

test("Ministry shares civic roof/window roles and uses one material across every window pane", () => {
  const civic = createPublicBuildingStylePreset("civic_classical");
  const hall = civic.masses.find(mass => mass.id === "opera-hall");
  assert.equal(MINISTRY_MATERIALS.roof, hall.materials.roof);
  assert.equal(MINISTRY_MATERIALS.window, hall.materials.window);
  for (const mass of ministryOfMagicSpec().masses.filter(mass => mass.type === "solid")) {
    assert.equal(mass.materials.roof, "slate");
    assert.equal(mass.materials.window, "warmWindow");
  }
  const buffer = new VoxelInstanceBuffer("ministry-material-regression");
  addMinistryVoxelDetails(buffer);
  // Four separate panes in the front upper casement: previously just the
  // lower-left pane was warmWindow and the rest incorrectly used patinaMetal.
  for (const x of [-21,-17]) for (const y of [41,46]) {
    assert.equal(buffer.getMaterialAt(x,y,4), "warmWindow");
    assert.equal(buffer.getMaterialAt(x,y,5), null, "glass stays recessed behind the one-voxel frame");
  }
  assert.equal(buffer.getMaterialAt(-19,41,5), "timber", "slender mullion projects in front of the panes");
  // Use a stock public building to compare actual shared material parameters,
  // not just material ID strings.
  const reference = createVoxelMassingLab({spec:civic,renderStrategy:"greedy"});
  const ministry = createMinistryOfMagic();
  const material = object => object.children.find(mesh => mesh.userData.materialId === "warmWindow").material;
  assert.equal(material(ministry).color.getHex(), material(reference).color.getHex());
  assert.equal(material(ministry).roughness, material(reference).roughness);
  assert.equal(material(ministry).metalness, material(reference).metalness);
  for (const nightFactor of [0,1]) {
    ministry.userData.updateDaylight({nightFactor}); reference.userData.updateDaylight({nightFactor});
    assert.equal(material(ministry).emissiveIntensity, material(reference).emissiveIntensity);
  }
  disposeBuildingObject(reference); disposeBuildingObject(ministry);
});
