import * as THREE from 'three';
import {mkdirSync,writeFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {createMoleway} from '../src/generators/moleway.js';
import {createBuildingSpec} from '../src/generators/voxelBuildingGrammar.js';
import {createVoxelBuildingFromSpec,VoxelInstanceBuffer} from '../src/generators/voxelBuildingLab.js';
import {rasterizeBuildingObject} from '../src/render/buildingVisualization.js';
import {disposeBuildingObject} from '../src/generators/buildingDesignObject.js';
const out=process.argv[2]??'artifacts/Moleway-Preview.png';
mkdirSync(out.slice(0,out.lastIndexOf('/'))||'.',{recursive:true});
function terrainBase(root,neighbours=false) {
  const b=new VoxelInstanceBuffer('moleway-preview-ground');
  // Presentation cutaway only. Runtime terrain supplies this surrounding earth.
  for(let x=neighbours?-48:-16;x<(neighbours?48:16);x++)for(let z=-16;z<20;z++) {
    if(x>=-8&&x<8&&z>=-12&&z<12)continue;
    b.addBox('stoneShadow',x,-14,z,1,13,1);
    b.addBox('pavement',x,-1,z,1,1,1);
  }
  const ground=new THREE.Group();b.createMeshes({strategy:'greedy'}).forEach(m=>ground.add(m));root.add(ground);
}
const asset=createMoleway();terrainBase(asset);
const street=new THREE.Group();street.add(createMoleway());terrainBase(street,true);
for(const [i,x]of [[0,-4],[1,4]]) {
  const spec=createBuildingSpec({id:`moleway-neighbour-${i}`,seed:`moleway-neighbour-${i}`,widthVoxels:30,depthVoxels:30,
    baseFloors:2,floorHeight:16,variation:0,archetype:'townhouse',style:'london_brick',roofForm:'gable_street',detailDensity:.4});
  const house=createVoxelBuildingFromSpec(spec,{renderStrategy:'greedy'});house.position.x=x;street.add(house);
}
const first=PNG.sync.read(rasterizeBuildingObject(asset,{size:1024,direction:new THREE.Vector3(.65,1,1)}).png);
const second=PNG.sync.read(rasterizeBuildingObject(street,{size:1024,direction:new THREE.Vector3(.5,.95,1)}).png);
const sheet=new PNG({width:2048,height:1024});PNG.bitblt(first,sheet,0,0,1024,1024,0,0);PNG.bitblt(second,sheet,0,0,1024,1024,1024,0);
writeFileSync(out,PNG.sync.write(sheet));disposeBuildingObject(asset);disposeBuildingObject(street);console.log(out);
