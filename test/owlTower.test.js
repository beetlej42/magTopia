import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {createOwlTower,owlTowerSpec,addOwlTowerDetails} from "../src/generators/owlTower.js";
import {VoxelInstanceBuffer} from "../src/generators/voxelBuildingLab.js";
import {createBuildingDesignObject,disposeBuildingObject,buildingEntranceRotation} from "../src/generators/buildingDesignObject.js";
import {resolveSpecialStructurePreview,createSpecialStructurePreview} from "../src/ui/specialStructurePreview.js";
import {createMagicLondonStarterDistrict} from "../src/generators/magicLondonStarterDistrict.js";
import {projectDistrictOntoSphere} from "../src/generators/voxelIntentDistrict.js";
import {renderBuildingVisualization} from "../src/render/buildingVisualization.js";

function geometry(object) {
  const meshes=[];object.traverse(m=>{if(m.isMesh)meshes.push(Array.from(m.geometry.attributes.position.array));});return meshes;
}

test("owl tower stays in one parcel with independent static birds and a bounded mesh budget",()=>{
  const root=createOwlTower();let triangles=0;
  root.traverse(m=>{if(!m.isMesh)return;
    triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;
    for(const v of m.geometry.attributes.position.array) assert.ok(Math.abs(v/.125-Math.round(v/.125))<1e-5);
  });
  assert.ok(triangles<9000);
  for(const entrance of ["north","east","south","west"]) {
    root.rotation.y=buildingEntranceRotation(entrance);const b=new THREE.Box3().setFromObject(root);
    assert.ok(b.min.x>=-2.00001&&b.max.x<=2.00001&&b.min.z>=-2.00001&&b.max.z<=2.00001,JSON.stringify(b));
    assert.ok(b.max.y<11);
  }
  for(const name of ["OwlCourier","OwlKeeper"]) {
    const bird=root.getObjectByName(name);assert.ok(bird);assert.ok(bird.getObjectByName("left-wing"));assert.ok(bird.getObjectByName("right-wing"));
  }
  assert.equal(typeof root.userData.update,"function");
  assert.notEqual(root.getObjectByName("OwlCourier").userData.plumage,root.getObjectByName("OwlKeeper").userData.plumage);
  const window=root.children.find(m=>m.userData.materialId==="warmWindow");
  root.userData.updateDaylight({nightFactor:1});const night=window.material.emissiveIntensity;
  root.userData.updateDaylight({nightFactor:0});assert.ok(window.material.emissiveIntensity<night);
  disposeBuildingObject(root);
});

test("bird loft flight holes are open and have landing ledges",()=>{
  const b=new VoxelInstanceBuffer("owl-openings");addOwlTowerDetails(b);
  assert.equal(b.getMaterialAt(-3,47,8),null);
  assert.equal(b.getMaterialAt(10,47,-4),null);
  assert.equal(b.getMaterialAt(-3,41,10),"timber");
});

test("city, placement preview and offline compiler preserve the same asset including birds",()=>{
  const source=resolveSpecialStructurePreview({card:{card_id:"owl-tower",structure:{footprint:"1x1"}}});
  assert.equal(source.kind,"prefab");
  const preview=createSpecialStructurePreview(source.spec);
  const compiled=createBuildingDesignObject({generation:{mode:"landmark_prefab",sourceSpec:owlTowerSpec()}});
  assert.deepEqual(geometry(preview),geometry(compiled));
  for(const entrance of ["north","east","south","west"]) {
    const cell={id:"cell-0-0",column:0,row:0,center:{x:0,z:0}};
    const building={id:"owl",specialStructure:{cardId:"owl-tower"},site:{lotId:cell.id,footprint:"1x1",entrance},footprintCells:[cell.id],program:{name:"Owl Tower"}};
    const city=createMagicLondonStarterDistrict({grid:{cells:[cell],cellWorldSize:4},sampleGroundHeight:()=>0,cityState:{buildings:{owl:building}}});
    const model=city.getObjectByName("OwlTower");assert.ok(model);
    assert.equal(model.rotation.y,buildingEntranceRotation(entrance));assert.deepEqual(geometry(model),geometry(compiled));
    projectDistrictOntoSphere(city,220);assert.ok(model.getObjectByName("OwlCourier"));
    const perched=model.getObjectByName("OwlCourier").position.clone();
    city.userData.update(26);assert.ok(model.getObjectByName("OwlCourier").position.distanceTo(perched)>2);
    disposeBuildingObject(city);
  }
  const input={sourceSpec:owlTowerSpec(),site:{entrance:"north"}};
  const front=renderBuildingVisualization(input,{size:256});assert.equal(front.metadata.generationMode,"landmark_prefab");
  assert.deepEqual(front.png,renderBuildingVisualization(input,{size:256}).png);
  assert.notDeepEqual(front.png,renderBuildingVisualization(input,{size:256,view:"back"}).png);
  disposeBuildingObject(preview);disposeBuildingObject(compiled);
});

test("flight returns smoothly, keeps geometry stable and pauses out of range",()=>{
  const tower=createOwlTower(),bird=tower.getObjectByName("OwlCourier"),keeper=tower.getObjectByName("OwlKeeper");
  const perch=bird.position.clone(),keeperPosition=keeper.position.clone(),meshes=[];
  tower.traverse(m=>{if(m.isMesh)meshes.push([m,m.geometry]);});
  for(const t of [0,10,20]) {tower.userData.update(t);assert.ok(bird.position.distanceTo(perch)<1e-8);}
  tower.userData.update(26);assert.ok(bird.position.y>9);assert.equal(bird.userData.flightState,"gliding");
  assert.ok(Math.abs(bird.getObjectByName("left-wing").rotation.z)>1);
  assert.deepEqual(keeper.position,keeperPosition);
  tower.userData.update(32);assert.deepEqual(bird.position,perch);
  assert.ok(new THREE.Vector3(0,0,1).applyQuaternion(bird.quaternion).z<-.99,"landing faces into the loft");
  tower.userData.update(33);assert.ok(bird.position.z<perch.z);assert.equal(bird.userData.flightState,"walking-in");
  tower.userData.update(34);assert.equal(bird.position.z,0);assert.equal(bird.userData.flightState,"turning-inside");
  tower.userData.update(36);assert.ok(bird.position.z>0);assert.equal(bird.userData.flightState,"walking-out");
  tower.userData.update(36.999);assert.ok(bird.position.distanceTo(perch)<1e-5);assert.ok(bird.quaternion.angleTo(new THREE.Quaternion())<1e-5);
  tower.userData.update(37);assert.deepEqual(bird.position,perch);
  for(const [mesh,geometry] of meshes)assert.equal(mesh.geometry,geometry);
  const camera=new THREE.PerspectiveCamera();camera.position.set(0,200,0);
  tower.userData.updateAnimationView(camera);tower.userData.update(26);
  assert.equal(bird.visible,false);assert.deepEqual(bird.position,perch);
  camera.position.set(0,10,10);tower.userData.updateAnimationView(camera);tower.userData.update(26);
  assert.equal(bird.visible,true);assert.ok(bird.position.y>9);
  disposeBuildingObject(tower);
});

test("both owls clear the tower voxel shell throughout the complete animation cycle",()=>{
  const b=new VoxelInstanceBuffer("collision");addOwlTowerDetails(b);
  const voxels=[...b.voxels.values()].filter(v=>v.y>=40);
  const tower=createOwlTower(),bird=tower.getObjectByName("OwlCourier");
  const parts=[];
  for(const owl of [bird,tower.getObjectByName("OwlKeeper")]) owl.traverse(m=>{if(m.isMesh){m.geometry.computeBoundingBox();parts.push(m);}});
  const p=new THREE.Vector3(),inverse=new THREE.Matrix4(),worldBox=new THREE.Box3();
  for(let i=0;i<=740;i++) {
    const t=i/20;tower.userData.update(t);tower.updateMatrixWorld(true);
    for(const mesh of parts) {
      // Conservative part boxes with a small tolerance for touching faces.
      const localBox=mesh.geometry.boundingBox.clone().expandByScalar(-.006);
      worldBox.copy(localBox).applyMatrix4(mesh.matrixWorld);inverse.copy(mesh.matrixWorld).invert();
      for(const v of voxels) {
        p.set((v.x+.5)*.125,(v.y+.5)*.125,(v.z+.5)*.125);
        if(!worldBox.containsPoint(p))continue;
        p.applyMatrix4(inverse);
        assert.ok(!localBox.containsPoint(p),`tower collision at t=${t} part=${mesh.parent.name} voxel=${v.x},${v.y},${v.z}`);
      }
    }
  }
  disposeBuildingObject(tower);
});
