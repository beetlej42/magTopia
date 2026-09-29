import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {createDiagonAlley,diagonAlleySpec,addDiagonDetails} from "../src/generators/diagonAlley.js";
import {createVoxelMassingLab} from "../src/generators/voxelBuildingLab.js";
import {createBuildingDesignObject,disposeBuildingObject,buildingEntranceRotation} from "../src/generators/buildingDesignObject.js";
import {resolveSpecialStructurePreview,createSpecialStructurePreview} from "../src/ui/specialStructurePreview.js";
import {createMagicLondonStarterDistrict} from "../src/generators/magicLondonStarterDistrict.js";
import {renderBuildingVisualization} from "../src/render/buildingVisualization.js";

test("alley remains on the shared voxel grid and within its parcel in all orientations",()=>{
  const model=createDiagonAlley();let triangles=0;
  model.traverse(m=>{if(!m.isMesh)return;
    triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;
    for(const v of m.geometry.attributes.position.array) assert.ok(Math.abs(v/.125-Math.round(v/.125))<1e-5);
  });
  assert.ok(triangles<14000);assert.ok(model.children.length<=12);
  for(const direction of ["north","east","south","west"]){
    model.rotation.y=buildingEntranceRotation(direction);
    const b=new THREE.Box3().setFromObject(model);
    assert.ok(b.min.x>=-4.00001&&b.max.x<=4.00001&&b.min.z>=-4.00001&&b.max.z<=4.00001);
  }
  disposeBuildingObject(model);
});

test("brick gateway and internal lane have continuous clear walking headroom",()=>{
  const model=createVoxelMassingLab({spec:diagonAlleySpec(),renderStrategy:"greedy",voxelDetailPass(buffer){
    addDiagonDetails(buffer);
    for(let z=-2;z<=30;z++) for(let x=-2;x<=2;x++) for(let y=1;y<=9;y++)
      assert.equal(buffer.getMaterialAt(x,y,z),null,`blocked route at ${x},${y},${z}`);
  }});disposeBuildingObject(model);
});

test("existing city placements, preview and visualizer use the same alley asset",()=>{
  const source=resolveSpecialStructurePreview({card:{card_id:"diagon-alley-entrance",structure:{footprint:"2x2"}}});
  assert.equal(source.kind,"prefab");
  const preview=createSpecialStructurePreview(source.spec);
  const compiled=createBuildingDesignObject({generation:{mode:"landmark_prefab",sourceSpec:source.spec}});
  const equal=(a,b)=>{
    assert.equal(a.children.length,b.children.length);
    a.children.forEach((m,i)=>assert.deepEqual(m.geometry.attributes.position.array,b.children[i].geometry.attributes.position.array));
  };equal(preview,compiled);
  const cells=[0,1,2,3].map(i=>({id:`cell-${i%2}-${Math.floor(i/2)}`,column:i%2,row:Math.floor(i/2),center:{x:(i%2)*4-2,z:2-Math.floor(i/2)*4}}));
  for(const entrance of ["north","east","south","west"]){
    const building={id:"alley",specialStructure:{cardId:"diagon-alley-entrance"},site:{lotId:cells[0].id,footprint:"2x2",entrance},footprintCells:cells.map(c=>c.id),program:{name:"Alley"}};
    const city=createMagicLondonStarterDistrict({grid:{cells,cellWorldSize:4},sampleGroundHeight:()=>0,cityState:{buildings:{alley:building}}});
    const model=city.getObjectByName("DiagonAlley");assert.ok(model);equal(model,compiled);
    assert.equal(model.rotation.y,buildingEntranceRotation(entrance));disposeBuildingObject(city);
  }
  const input={sourceSpec:diagonAlleySpec(),site:{entrance:"north"}};
  const front=renderBuildingVisualization(input,{size:256});
  assert.equal(front.metadata.generationMode,"landmark_prefab");
  assert.deepEqual(front.png,renderBuildingVisualization(input,{size:256}).png);
  assert.notDeepEqual(front.png,renderBuildingVisualization(input,{view:"top",size:256}).png);
  disposeBuildingObject(preview);disposeBuildingObject(compiled);
});
