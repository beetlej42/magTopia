import { attachOwlTowerAnimation } from "./owlTowerAnimation.js";
import * as THREE from "three";
import { createUrbanMassingSpec } from "./voxelMassingGrammar.js";
import { createVoxelMassingLab, VoxelInstanceBuffer, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";

export const OWL_TOWER_ASSET_ID = "owl-tower-001";
export function owlTowerSpec() {
  const spec = createUrbanMassingSpec({id:OWL_TOWER_ASSET_ID,seed:"owl-tower-v1",widthCells:1,depthCells:1,
    masses:[{id:"entry-paving",type:"ground",cells:[[0,0]],dimensionsVoxels:{width:22,depth:27},
      heightVoxels:1,materials:{ground:"pavement",trim:"pavement"},groundTreatment:{pattern:"plain"},cap:{type:"flat"}}]});
  return {...spec,assetId:OWL_TOWER_ASSET_ID,assetRevision:4,footprint:{...spec.footprint,worldWidth:4,worldDepth:4}};
}

// Hollow authored shell: openings are absent voxels, not painted black windows.
export function addOwlTowerDetails(buffer) {
  const write={priority:VOXEL_WRITE_PRIORITIES.decoration,owner:"owl-tower:details"};
  const box=(m,x,y,z,w,h,d)=>buffer.addBox(m,x,y,z,w,h,d,0,write);
  const voxel=(m,x,y,z)=>box(m,x,y,z,1,1,1);
  for(let y=1;y<39;y++) for(let x=-8;x<=7;x++) for(let z=-10;z<=5;z++) {
    const dx=Math.max(-7-x,0,x-6), dz=Math.max(-9-z,0,z-4);
    if(dx+dz>1) continue; // chamfered corners
    if(x>-7&&x<6&&z>-9&&z<4) continue;
    if(z>=4&&x>=-3&&x<=2&&y<13-Math.max(0,Math.abs(x+.5)-1)) continue;
    if(x<=-7&&z>=-5&&z<=-3&&y>=24&&y<=30) continue;
    if(x>=6&&z>=-3&&z<=-1&&y>=18&&y<=24) continue;
    if(z<=-9&&x>=0&&x<=2&&y>=28&&y<=33) continue;
    voxel("limestone",x,y,z);
  }
  // Sparse staggered stone repairs, avoiding a dotted repeating facade.
  for(const [x,y,z,w] of [[-6,6,5,3],[3,13,5,3],[-5,22,5,2],[1,32,5,3],[-4,18,-10,3],[3,25,-10,2]])
    box("sandstone",x,y,z,w,1,1);
  for(const [x,y,z,d] of [[7,8,-6,3],[7,28,0,2],[-8,12,-5,3],[-8,33,-7,2]])
    box("sandstone",x,y,z,1,1,d);
  // Foundation, narrow stone bands and a recessed timber entrance.
  box("sandstone",-9,1,-10,18,2,16);
  box("timber",-3,2,3,6,10,1);box("warmWindow",-2,9,4,4,2,1);
  voxel("gildedMetal",1,6,4);box("sandstone",-4,1,6,8,1,5);
  for(const y of [15,36]) {
    box("sandstone",-8,y,5,16,1,1);box("sandstone",-8,y,-10,16,1,1);
    box("sandstone",-8,y,-9,1,1,14);box("sandstone",7,y,-9,1,1,14);
  }
  box("warmWindow",-7,24,-5,1,7,3);box("warmWindow",6,18,-3,1,7,3);
  box("warmWindow",0,28,-9,3,6,1);
  // Projecting timber bird loft, supported by visible stepped brackets.
  for(const x of [-8,7]) for(const z of [-9,4]) {
    box("timber",x,34,z,1,4,1);box("timber",x-1,36,z-1,3,2,3);
  }
  box("timber",-11,38,-13,22,2,22);
  box("timber",-11,54,-13,22,2,22);
  // Four elevations with offset, genuinely open arched flight holes.
  function face(side,m,u,y,w,h,depth=0) {
    if(side===0) box(m,u,y,8+depth,w,h,1);
    if(side===1) box(m,10+depth,y,u,1,h,w);
    if(side===2) box(m,u,y,-13-depth,w,h,1);
    if(side===3) box(m,-11-depth,y,u,1,h,w);
  }
  for(let side=0;side<4;side++) {
    const start=side%2?-12:-10, end=side%2?7:9;
    const center=[-3,-4,3,-5][side];
    for(let u=start;u<=end;u++) for(let y=40;y<54;y++) {
      const du=Math.abs(u-center);
      if(du<=3&&y>=42&&y<=52-Math.max(0,du-1)) continue;
      face(side,(u===start||u===end||u===center-5||u===center+5)?"timber":"sandstone",u,y,1,1);
    }
    face(side,"timber",center-4,41,9,1,1);
    face(side,"timber",center-4,41,9,1,2);
    for(let u=center-4;u<=center+4;u++) {
      const archY=53-Math.max(0,Math.abs(u-center)-1);
      face(side,"timber",u,archY,1,1,1);
    }
  }
  // Inside roosts remain visible through the openings.
  // A continuous internal landing board supports the walk-in/turn/walk-out.
  box("timber",-7,41,-2,9,1,11);
  box("timber",-8,44,-7,16,1,1);box("timber",-6,40,-8,1,13,1);
  // Stepped slate hip roof; slightly offset apex makes the silhouette less rigid.
  for(let y=56;y<=75;y++) {
    const r=Math.max(1,12-Math.floor((y-56)*.57));
    const cx=y>68?1:0, cz=-2;
    for(let x=cx-r;x<cx+r;x++) for(let z=cz-r;z<cz+r;z++)
      if(x===cx-r||x===cx+r-1||z===cz-r||z===cz+r-1||y===56||y===75)
        voxel("slate",x,y,z);
  }
  // Paint the actual stepped roof surface so small weathering marks follow
  // the slate instead of floating above it or becoming raised white blocks.
  const roofSurface=new Map();
  for(const v of buffer.voxels.values()) if(v.materialId==="slate"&&v.y>=56)
    roofSurface.set(`${v.x},${v.z}`,Math.max(roofSurface.get(`${v.x},${v.z}`)??0,v.y));
  const roofMark=(m,x,z)=>{
    const y=roofSurface.get(`${x},${z}`);
    if(y!==undefined) voxel(m,x,y,z);
  };
  // Wind-caught leaves: a few asymmetric pairs, concentrated at lower eaves.
  for(const [x,z,m,dx,dz] of [
    [-8,6,"foliage",1,0],[5,7,"sandstone",0,1],[-5,8,"brickBrown",1,-1],
    [8,-5,"foliage",1,0],[-9,-8,"sandstone",0,1],[4,-11,"brickBrown",1,0],
    [-3,-6,"foliage",0,1],[8,3,"sandstone",1,-1]
  ]) { roofMark(m,x,z);roofMark(m,x+dx,z+dz); }
  // Chalky splashes with broken downslope tails, below habitual roof perches.
  for(const [x,z,dx,dz] of [[-4,3,0,1],[5,-3,1,0],[-3,-7,0,-1]]) {
    roofMark("limestone",x,z);roofMark("limestone",x+dz,z+dx);
    roofMark("limestone",x+dx,z+dz);
    roofMark("limestone",x+dx*3,z+dz*3);
  }
  box("iron",1,76,-2,1,5,1);box("iron",-2,79,-2,7,1,1);
  box("gildedMetal",3,80,-2,2,2,1);
  // Mail slot, projecting envelope sign, parcels, lantern and quiet planting.
  box("timber",6,5,6,3,5,2);box("iron",6,8,8,3,1,1);
  box("iron",-8,17,5,1,1,7);box("timber",-10,12,10,6,5,1);
  box("sandstone",-9,13,11,4,3,1);voxel("brickRed",-7,14,12);
  box("timber",5,1,10,4,3,3);box("sandstone",6,4,10,3,2,3);
  box("iron",3,13,6,1,1,3);box("warmWindow",3,10,8,2,3,2);
  box("iron",2,9,7,4,1,4);box("iron",2,13,7,4,1,4);
  box("sandstone",-13,1,-9,3,3,8);box("soil",-13,4,-9,3,1,8);
  for(let z=-8;z<-1;z+=2) box("foliage",-13,5,z,3,2,2);
  // Rear service hatch gives the maintenance side its own composition.
  box("timber",-3,3,-11,5,8,1);box("iron",-2,8,-12,3,1,1);
  for(let z=7;z<14;z+=3) for(let x=-9;x<5;x+=5) voxel("stoneShadow",x,0,z);
}

// Named rigid parts retain a deterministic perched pose for static previews.
function createPerchedOwl(name, pale = false) {
  const root=new THREE.Group();root.name=name;
  function part(name,draw,pivot=[0,0,0]) {
    const group=new THREE.Group();group.name=name;group.position.set(...pivot.map(v=>v*.125));
    const b=new VoxelInstanceBuffer(`owl:${name}`);
    draw((m,x,y,z,w,h,d)=>b.addBox(m,x,y,z,w,h,d));
    b.createMeshes({strategy:"greedy"}).forEach(m=>{m.castShadow=true;group.add(m);});root.add(group);
  }
  const feather=pale?"limestone":"timber",wing=pale?"sandstone":"brickBrown";
  part("body",b=>{
    b(feather,-2,1,-1,4,5,3);
    b("gildedMetal",-2,0,1,1,1,2);b("gildedMetal",1,0,1,1,1,2);
  });
  part("head",b=>{
    b(feather,-2,0,-1,4,4,3);
    b("sandstone",-2,1,2,4,2,1);b("iron",-2,2,3,1,1,1);b("iron",1,2,3,1,1,1);
    b("gildedMetal",0,1,3,1,1,1);b(feather,-2,4,0,1,1,2);b(feather,1,4,0,1,1,2);
  },[0,5,0]);
  part("left-wing",b=>{
    b(wing,-1,-3,-1,1,4,3);b(feather,-1,-5,0,1,2,2);
  },[-2,5,0]);
  part("right-wing",b=>{
    b(wing,0,-3,-1,1,4,3);b(feather,0,-5,0,1,2,2);
  },[2,5,0]);
  root.userData.plumage=pale?"ivory":"brown";
  root.userData.animationRole="perched-owl";
  return root;
}

export function createOwlTower({cellWorldSize=4,nightLighting=0}={}) {
  const root=createVoxelMassingLab({spec:owlTowerSpec(),renderStrategy:"greedy",nightLighting,voxelDetailPass:addOwlTowerDetails});
  root.name="OwlTower";
  const front=createPerchedOwl("OwlCourier",true);front.position.set(-3*.125,42*.125,9*.125);root.add(front);
  const side=createPerchedOwl("OwlKeeper");side.position.set(-12*.125,42*.125,-5*.125);side.rotation.y=-Math.PI/2;root.add(side);
  root.scale.setScalar(cellWorldSize/4);
  Object.assign(root.userData,{assetId:OWL_TOWER_ASSET_ID,assetRevision:4,representation:"special-landmark-voxel",
    sphereProjectionRoot:true,footprint:"1x1",entrance:"north",authoredParcelSize:4,voxelSize:.125,
    animationAnchors:{courier:"OwlCourier",keeper:"OwlKeeper"}});
  attachOwlTowerAnimation(root,front,side);
  return root;
}
