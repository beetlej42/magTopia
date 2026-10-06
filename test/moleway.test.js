import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMoleway,molewaySpec,MOLEWAY_CARD_ID} from '../src/generators/moleway.js';
import {markMolewayTerrainOpenings} from '../src/city/moleway-opening.js';
import {createBuildingDesignObject,disposeBuildingObject} from '../src/generators/buildingDesignObject.js';
import {resolveSpecialStructurePreview} from '../src/ui/specialStructurePreview.js';
import {createVoxelDistrictMacroSurface} from '../src/generators/voxelIntentDistrict.js';
import {createMagicLondonStarterDistrict} from '../src/generators/magicLondonStarterDistrict.js';
import {cardEligibility} from '../src/gameplay/cards.js';
import {incomeForSettlement,capacitiesFromSettlementMetadata} from '../src/gameplay/economy.js';

function fixture(entrance='north',status='completed') {
  const cell={id:'cell-5-4',column:5,row:4,center:{x:2,z:2},buildable:true};
  const building={id:'moleway',status,specialStructure:{cardId:MOLEWAY_CARD_ID},site:{lotId:cell.id,footprint:'1x1',entrance},footprintCells:[cell.id],program:{name:'Moleway Entrance'}};
  return {cells:{[cell.id]:cell},buildings:{moleway:building}};
}

test('Moleway is repeatable and each completed entrance adds income and capacity',()=>{
  const state=fixture();assert.equal(cardEligibility(state,MOLEWAY_CARD_ID).eligible,true);
  const done={status:'completed',canonical:false,systemOwnedCardId:MOLEWAY_CARD_ID};
  const data={a:done,b:{...done},pending:{...done,status:'construction'},sealed:{...done,status:'sealed'}};
  assert.equal(incomeForSettlement(data,{}).coins,10);
  assert.deepEqual(capacitiesFromSettlementMetadata(data),{muggles:0,wizards:4});
});

test('Moleway preview uses the same compact one-cell prefab as its compiler',()=>{
  const source=resolveSpecialStructurePreview({card:{card_id:MOLEWAY_CARD_ID,structure:{footprint:'1x1'}}});
  assert.equal(source.kind,'prefab');assert.deepEqual(source.spec,molewaySpec());
  const root=createBuildingDesignObject({generation:{mode:'landmark_prefab',sourceSpec:source.spec}});
  const bounds=new THREE.Box3().setFromObject(root);
  assert.equal(bounds.min.x,-2);assert.equal(bounds.max.x,2);assert.equal(bounds.min.z,-2);assert.equal(bounds.max.z,2);
  assert.ok(bounds.min.y< -1);let count=0;root.traverse(m=>{if(m.isMesh)count+=m.geometry.index.count/3;});assert.ok(count<4000);
  disposeBuildingObject(root);
});

test('terrain openings follow all four entrances and remain closed during construction or after removal',()=>{
  for(const direction of ['north','east','south','west']) {
    const state=fixture(direction),grid={width:320,height:256,index:(x,z)=>z*320+x};
    const mask=markMolewayTerrainOpenings(grid,state);assert.equal(mask.reduce((a,b)=>a+b,0),384);
    state.buildings.moleway.status='construction';assert.equal(markMolewayTerrainOpenings(grid,state).some(Boolean),false);
    state.buildings={};assert.equal(markMolewayTerrainOpenings(grid,state).some(Boolean),false);
  }
});

test('real terrain mesh leaves the stairwell open but keeps the side paving supported',()=>{
  for(const entrance of ['north','east','south','west']) {
    const state=fixture(entrance);
    const terrain=createVoxelDistrictMacroSurface({seed:'moleway',worldColumns:10,worldRows:8,blankConstruction:true,constructionState:state,vegetationDensity:0});
    terrain.group.updateMatrixWorld(true);
    const ray=new THREE.Raycaster(new THREE.Vector3(2.1,10,2.1),new THREE.Vector3(0,-1,0));
    assert.equal(ray.intersectObjects(terrain.group.children.filter(m=>m.userData.materialId==='macroTerrain'),false).length,0);
    ray.ray.origin.set(3.8,10,3.8);
    assert.ok(ray.intersectObjects(terrain.group.children.filter(m=>m.userData.materialId==='macroTerrain'),false).length>0, 'corner paving retains terrain');
    disposeBuildingObject(terrain.group);
    const district=createMagicLondonStarterDistrict({grid:{cellWorldSize:4,cells:Object.values(state.cells)},cityState:state,sampleGroundHeight:()=>-.0625});
    assert.ok(district.getObjectByName('Moleway'));disposeBuildingObject(district);
  }
});
