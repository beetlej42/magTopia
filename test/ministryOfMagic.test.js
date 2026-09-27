import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createMinistryOfMagic, ministryOfMagicSpec, MINISTRY_ASSET_ID } from "../src/generators/ministryOfMagic.js";
import { createBuildingDesignObject, disposeBuildingObject, buildingEntranceRotation } from "../src/generators/buildingDesignObject.js";
import { renderBuildingVisualization } from "../src/render/buildingVisualization.js";
import { createMagicLondonStarterDistrict } from "../src/generators/magicLondonStarterDistrict.js";
import { resolveSpecialStructurePreview, createSpecialStructurePreview } from "../src/ui/specialStructurePreview.js";
import { createCityPlacementLayer } from "../src/ui/cityPlacementLayer.js";
import { projectDistrictOntoSphere } from "../src/generators/voxelIntentDistrict.js";

test("Ministry stays inside 2x2 in every direction with a bounded two-draw mesh", () => {
  const object = createMinistryOfMagic();
  assert.equal(object.children.length, 2);
  let triangles = 0;
  object.traverse(child => { if(child.isMesh) triangles += child.geometry.attributes.position.count / 3; });
  assert.ok(triangles > 5000 && triangles < 16000);
  for(const entrance of ["north","east","south","west"]) {
    object.rotation.y = buildingEntranceRotation(entrance);
    const bounds = new THREE.Box3().setFromObject(object);
    assert.ok(bounds.min.x >= -4 && bounds.max.x <= 4);
    assert.ok(bounds.min.z >= -4 && bounds.max.z <= 4);
    assert.ok(bounds.min.y >= -1e-6 && bounds.max.y < 10);
  }
  const windows = object.getObjectByName("Ministry-warm-windows");
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
  assert.deepEqual(preview.children[1].geometry.attributes.position.array,compiled.children[1].geometry.attributes.position.array);
  const cells = [0,1,2,3].map(i=>({id:`cell-${i%2}-${Math.floor(i/2)}`,column:i%2,row:Math.floor(i/2),center:{x:(i%2)*4-2,z:2-Math.floor(i/2)*4}}));
  for(const entrance of ["north","east","south","west"]) {
    const building={id:"ministry",specialStructure:{cardId:"ministry-of-magic"},site:{lotId:cells[0].id,footprint:"2x2",entrance},footprintCells:cells.map(c=>c.id),program:{name:"Ministry"}};
    const city = createMagicLondonStarterDistrict({grid:{cells,cellWorldSize:4},sampleGroundHeight:()=>0,cityState:{buildings:{ministry:building}}});
    const model = city.getObjectByName("MinistryOfMagic");
    assert.ok(model,"existing special buildings without voxelDesign must render");
    assert.equal(model.userData.assetId,MINISTRY_ASSET_ID);
    assert.equal(model.rotation.y,buildingEntranceRotation(entrance));
    assert.deepEqual(model.children[1].geometry.attributes.position.array,compiled.children[1].geometry.attributes.position.array);
    projectDistrictOntoSphere(city,220);
    assert.equal(model.children.length,2,"sphere projection must keep the model together");
    disposeBuildingObject(city);
  }
  const layer=createCityPlacementLayer(); const root=new THREE.Group(); layer.setSceneRoot(root);
  layer.showGhost({hasTarget:true,isLegal:true,lotId:cells[0].id,footprintColumns:2,footprintRows:2,entrance:"north",previewSource:source,
    cells:cells.map(c=>({...c,centerX:c.center.x,centerZ:c.center.z}))});
  assert.equal(layer.object.getObjectByName("CityPlacementGhost").userData.ghostMode,"landmark-prefab-preview");
  const ghost = layer.object.getObjectByName("MinistryOfMagic");
  assert.deepEqual(ghost.children[1].geometry.attributes.position.array,compiled.children[1].geometry.attributes.position.array);
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
