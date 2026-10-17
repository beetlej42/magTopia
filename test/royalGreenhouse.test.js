import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRoyalGreenhouse, royalGreenhouseSpec, ROYAL_GREENHOUSE_ASSET_ID, ROYAL_GREENHOUSE_CARD_ID } from "../src/generators/royalGreenhouse.js";
import { buildingEntranceRotation, createBuildingDesignObject, disposeBuildingObject } from "../src/generators/buildingDesignObject.js";
import { resolveSpecialStructurePreview, createSpecialStructurePreview } from "../src/ui/specialStructurePreview.js";
import { createMagicLondonStarterDistrict } from "../src/generators/magicLondonStarterDistrict.js";
import { createCityPlacementLayer } from "../src/ui/cityPlacementLayer.js";
import { projectDistrictOntoSphere } from "../src/generators/voxelIntentDistrict.js";
import { renderBuildingVisualization } from "../src/render/buildingVisualization.js";
import { getCard } from "../src/gameplay/card-catalog.js";

function geometrySnapshot(object) {
  const result=[];
  object.updateMatrixWorld(true);
  object.traverse(child=>{
    if(!child.isMesh) return;
    result.push([child.name,Array.from(child.geometry.attributes.position.array),Array.from(child.geometry.index.array)]);
  });
  return result;
}
const cells=[0,1,2,3].map(i=>({id:`cell-${i%2}-${Math.floor(i/2)}`,column:i%2,row:Math.floor(i/2),center:{x:(i%2)*4-2,z:2-Math.floor(i/2)*4}}));
function cityBuilding(extra={}) {
  return {id:"greenhouse",specialStructure:{cardId:ROYAL_GREENHOUSE_CARD_ID},site:{lotId:cells[0].id,footprint:"2x2",entrance:"north"},footprintCells:cells.map(c=>c.id),program:{name:"Royal Greenhouse"},...extra};
}
function cityWith(building) {
  return createMagicLondonStarterDistrict({grid:{cells,cellWorldSize:4},sampleGroundHeight:()=>0,cityState:{buildings:{greenhouse:building}}});
}

test("greenhouse remains within its parcel in every direction and uses transparent non-shadowing glazing",()=>{
  const object=createRoyalGreenhouse();let triangles=0,draws=0,glass=0;
  object.traverse(child=>{
    if(!child.isMesh)return;
    draws++;triangles+=(child.geometry.index?.count??child.geometry.attributes.position.count)/3;
    assert.equal(child.userData.flatVoxelGeometry,true);
    for(const v of child.geometry.attributes.position.array) assert.ok(Math.abs(v/.125-Math.round(v/.125))<1e-5);
    if(child.userData.materialId==="lightGlass") {
      glass++;assert.equal(child.material.transparent,true);assert.ok(child.material.opacity>0&&child.material.opacity<.4);
      assert.equal(child.material.depthWrite,false);assert.equal(child.castShadow,false);
    }
  });
  assert.ok(glass>0);assert.ok(triangles<16000);assert.ok(draws<=20);
  for(const entrance of ["north","east","south","west"]) {
    object.rotation.y=buildingEntranceRotation(entrance);
    for(const time of [0,4,13,47]) {
      object.userData.update(time);
      const b=new THREE.Box3().setFromObject(object);
      assert.ok(b.min.x>=-4.000001&&b.max.x<=4.000001);
      assert.ok(b.min.z>=-4.000001&&b.max.z<=4.000001);
      assert.ok(b.min.y>=-.250001&&b.max.y<7);
    }
  }
  const scaled=createRoyalGreenhouse({cellWorldSize:6});
  assert.equal(new THREE.Box3().setFromObject(scaled).getSize(new THREE.Vector3()).x,12);
  disposeBuildingObject(scaled);disposeBuildingObject(object);
});

test("existing cities, compiler and placement ghost share the authored landmark",()=>{
  const source=resolveSpecialStructurePreview({card:{card_id:ROYAL_GREENHOUSE_CARD_ID,structure:{footprint:"2x2"}}});
  assert.equal(source.kind,"prefab");assert.equal(source.spec.assetId,ROYAL_GREENHOUSE_ASSET_ID);
  const preview=createSpecialStructurePreview(source.spec);
  const compiled=createBuildingDesignObject({generation:{mode:"landmark_prefab",sourceSpec:royalGreenhouseSpec()}});
  const expected=geometrySnapshot(compiled);assert.deepEqual(geometrySnapshot(preview),expected);
  for(const entrance of ["north","east","south","west"]) {
    const city=cityWith(cityBuilding({site:{lotId:cells[0].id,footprint:"2x2",entrance}}));
    const model=city.getObjectByName("RoyalGreenhouse");assert.ok(model);
    assert.equal(model.rotation.y,buildingEntranceRotation(entrance));assert.deepEqual(geometrySnapshot(model),expected);
    projectDistrictOntoSphere(city,220);assert.equal(model.userData.sphereProjectionRoot,true);
    const leaf=model.getObjectByName("MoonCrownLeaf-0");city.userData.update(5);assert.notEqual(leaf.rotation.z,0);
    disposeBuildingObject(city);
  }
  const layer=createCityPlacementLayer();layer.setSceneRoot(new THREE.Group());
  layer.showGhost({hasTarget:true,isLegal:true,lotId:cells[0].id,footprintColumns:2,footprintRows:2,entrance:"north",previewSource:source,
    cells:cells.map(c=>({...c,centerX:c.center.x,centerZ:c.center.z}))});
  assert.deepEqual(geometrySnapshot(layer.object.getObjectByName("RoyalGreenhouse")),expected);
  layer.dispose();disposeBuildingObject(preview);disposeBuildingObject(compiled);
});

test("construction stays scaffolded; a differently sized legacy lot retains its fallback",()=>{
  const construction=cityWith(cityBuilding({status:"construction",construction:{readyAtTurn:3}}));
  assert.equal(construction.getObjectByName("RoyalGreenhouse"),undefined);
  assert.equal(construction.userData.contract.placements[0].representation,"construction-site");
  disposeBuildingObject(construction);
  const legacy=cityWith(cityBuilding({site:{lotId:cells[0].id,footprint:"1x1",entrance:"north"},footprintCells:[cells[0].id]}));
  assert.equal(legacy.getObjectByName("RoyalGreenhouse"),undefined);disposeBuildingObject(legacy);
});

test("leaf animation reuses geometry, resets at zero, and flower light follows city daylight",()=>{
  const object=createRoyalGreenhouse(),leaf=object.getObjectByName("MoonCrownLeaf-0"),mesh=leaf.children[0];
  const geometry=mesh.geometry,flower=object.getObjectByName("MoonCrownFlowers").children.find(m=>m.userData.materialId==="tealMagic");
  object.userData.update(4);assert.notEqual(leaf.rotation.z,0);assert.equal(mesh.geometry,geometry);
  object.userData.update(0);assert.equal(leaf.rotation.z,0);assert.equal(leaf.rotation.x,0);
  object.userData.updateDaylight({nightFactor:1});const night=flower.material.emissiveIntensity;
  object.userData.updateDaylight({nightFactor:0});assert.ok(flower.material.emissiveIntensity<night);
  object.userData.update(NaN);assert.equal(leaf.rotation.z,0);disposeBuildingObject(object);
});

test("raw manifest visualizations are deterministic; greenhouse becomes ready without changing its game rules",()=>{
  const input={assetId:ROYAL_GREENHOUSE_ASSET_ID,site:{entrance:"north"}};
  const front=renderBuildingVisualization(input,{size:256});
  assert.equal(front.metadata.generationMode,"landmark_prefab");
  assert.deepEqual(front.png,renderBuildingVisualization(input,{size:256}).png);
  for(const view of ["back","top"]) assert.notDeepEqual(renderBuildingVisualization(input,{size:256,view}).png,front.png);
  const card=getCard(ROYAL_GREENHOUSE_CARD_ID);
  assert.equal(card.structure.placeholder,false);assert.equal(card.metadata.placeholder,false);
  assert.equal(card.effect.arcaneEnergyOutput,12);assert.equal(card.structure.footprint,"2x2");assert.equal(card.unique,true);
  assert.equal(getCard("arcane-energy-conservatory").structure.placeholder,true);
});
