// Offline preview of the actual runtime animation, with a fixed frame and clock.
import * as THREE from "three";
import {mkdirSync,writeFileSync} from "node:fs";
import {createOwlTower} from "../src/generators/owlTower.js";
import {rasterizeBuildingObject} from "../src/render/buildingVisualization.js";
import {disposeBuildingObject} from "../src/generators/buildingDesignObject.js";
const out=process.argv[2]??"artifacts/owl-tower-animation";
mkdirSync(out,{recursive:true});
const tower=createOwlTower();
// Box3 includes invisible geometry; the rasterizer excludes it from drawing.
// This prevents moving birds from changing the camera crop frame by frame.
const frame=new THREE.Mesh(new THREE.BoxGeometry(9,13,9));
frame.position.y=6;frame.visible=false;tower.add(frame);
const fps=15,duration=22;
for(let i=0;i<fps*duration;i++) {
  tower.userData.update(18+i/fps);
  writeFileSync(`${out}/${String(i).padStart(4,"0")}.png`,rasterizeBuildingObject(tower,{size:512}).png);
}
disposeBuildingObject(tower);
console.log(JSON.stringify({out,fps,duration,frames:fps*duration,clockStart:18}));
