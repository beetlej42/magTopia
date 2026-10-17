import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createUrbanMassingSpec } from "./voxelMassingGrammar.js";
import { createVoxelMassingLab, VoxelInstanceBuffer, VOXEL_SIZE, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";

export const ROYAL_GREENHOUSE_ASSET_ID = "royal-greenhouse-001";
export const ROYAL_GREENHOUSE_CARD_ID = "royal-botanical-greenhouse";
export const ROYAL_GREENHOUSE_REVISION = 1;

export function royalGreenhouseSpec() {
  const spec = createUrbanMassingSpec({
    id: ROYAL_GREENHOUSE_ASSET_ID, seed: "royal-greenhouse-v1", widthCells: 2, depthCells: 2,
    masses: [{ id: "botanical-garden", type: "ground", cells: [[0,0],[1,0],[0,1],[1,1]],
      heightVoxels: 1, materials: { ground: "grass", trim: "grass" },
      groundTreatment: { pattern: "plain" }, cap: { type: "flat" } }]
  });
  return { ...spec, assetId: ROYAL_GREENHOUSE_ASSET_ID, assetRevision: ROYAL_GREENHOUSE_REVISION,
    footprint: { ...spec.footprint, worldWidth: 8, worldDepth: 8 } };
}

function voxelTools(buffer) {
  const write = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "royal-greenhouse:details" };
  const box = (m,x,y,z,w=1,h=1,d=1) => buffer.addBox(m,x,y,z,w,h,d,0,write);
  const voxel = (m,x,y,z) => box(m,x,y,z);
  // Connected integer stair steps, including the diagonal sides of the pavilion.
  function line(m,a,b,width=1) {
    const delta=b.map((v,i)=>v-a[i]), steps=Math.max(...delta.map(Math.abs));
    const last=[...a]; box(m,...last,width,width,width);
    for(let i=1;i<=steps;i++) {
      const next=a.map((v,j)=>Math.round(v+delta[j]*i/steps));
      for(let axis=0;axis<3;axis++) while(last[axis]!==next[axis]) {
        last[axis]+=Math.sign(next[axis]-last[axis]); box(m,...last,width,width,width);
      }
    }
  }
  return {box,voxel,line};
}

const pavilionInside = (x,z,r) => Math.max(Math.abs(x+.5),Math.abs(z+.5)) <= r && Math.abs(x+.5)+Math.abs(z+.5) <= r*1.58;
const pavilionEdge = (x,z,r) => pavilionInside(x,z,r) && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz])=>!pavilionInside(x+dx,z+dz,r));
const domeHeight = (x,z) => {
  const radius=Math.max(Math.abs(x+.5),Math.abs(z+.5),(Math.abs(x+.5)+Math.abs(z+.5))/1.58);
  return 29+Math.min(12,Math.max(0,Math.floor((13-radius)/.7)));
};

// Moving rigid parts can straddle the shared mesher's fixed chunk origin.
// Merge equal-material chunks within each small part, retaining vertex colours.
function partMeshes(buffer,mergeOpaque=true) {
  const meshes=buffer.createMeshes({strategy:"greedy",mergeOpaque}),groups=new Map();
  for(const mesh of meshes) {
    const key=mesh.userData.materialId;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(mesh);
  }
  return [...groups.values()].map(group=>{
    const first=group[0];
    if(group.length>1) {
      const geometry=mergeGeometries(group.map(mesh=>mesh.geometry),false);
      if(!geometry) throw new Error("Greenhouse rigid part geometry could not be merged");
      for(const mesh of group) {mesh.geometry.dispose();if(mesh!==first)mesh.material.dispose();}
      first.geometry=geometry;geometry.computeBoundingSphere();
    }
    first.castShadow=true;
    return first;
  });
}


export function addRoyalGreenhouseDetails(buffer) {
  const {box,voxel,line}=voxelTools(buffer);
  // The narrow masonry plinth is hollow; plants grow in real interior space.
  box("pavement",-30,0,-21,60,1,34);
  box("pavement",-7,0,11,14,1,21);
  for(let z=13;z<31;z+=4) for(let x=-6;x<6;x+=4) {
    box("limestone",x,0,z,3,1,3);
  }
  for(let x=-13;x<13;x++) for(let dz=-13;dz<13;dz++) {
    if(!pavilionInside(x,dz,13)) continue;
    voxel("pavement",x,1,dz-6);
    if(!pavilionEdge(x,dz,13)) continue;
    if(dz>=11 && x>=-4 && x<=3) continue;
    box("limestone",x,2,dz-6,1,4,1);
    for(const y of [6,28]) voxel("shopGreen",x,y,dz-6);
  }
  // Eight clear structural ribs, with small paired feet and capitals.
  const corners=[[-8,-13],[7,-13],[12,-8],[12,7],[7,12],[-8,12],[-13,7],[-13,-8]];
  for(const [x,z] of corners) {
    box("shopGreen",x,6,z-6,1,23,1);
    box("sandstone",x-1,2,z-7,3,3,3);
    box("shopGreen",x-1,26,z-7,3,2,3);
  }
  for(let x=-13;x<13;x++) for(let dz=-13;dz<13;dz++) if(pavilionEdge(x,dz,13)) {
    if(!(dz>=11&&x>=-4&&x<=3)) voxel("shopGreen",x,16,dz-6);
  }
  // Continuous heightfield glazing with exposed ribs at the same top surface.
  // A two-voxel shell closes the 1–2 voxel risers of the stepped dome.
  for(let x=-13;x<13;x++) for(let z=-13;z<13;z++) {
    if(!pavilionInside(x,z,13)) continue;
    const y=domeHeight(x,z), ax=Math.abs(x+.5),az=Math.abs(z+.5);
    const rib=Math.abs(ax*.58-az)<.6||Math.abs(az*.58-ax)<.6;
    if(rib||pavilionEdge(x,z,13)||y===41) box("shopGreen",x,y-1,z-6,1,2,1);
  }
  // Low barrel-roofed wings leave the taller octagonal centre legible.
  for(const side of [-1,1]) {
    const x0=side<0?-29:13, x1=side<0?-14:28;
    box("limestone",x0,1,-17,x1-x0+1,4,1);
    box("limestone",x0,1,4,x1-x0+1,4,1);
    box("limestone",x0,1,-16,1,4,20);
    box("limestone",x1,1,-16,1,4,20);
    box("pavement",x0+1,2,-16,x1-x0-1,1,20);
    for(const z of [-17,4]) {
      for(const y of [5,13,22]) box("shopGreen",x0,y,z,x1-x0+1,1,1);
      for(let x=x0;x<=x1;x+=5) box("shopGreen",x,5,z,1,18,1);
      box("shopGreen",x1,5,z,1,18,1);
    }
    const outer=side<0?x0:x1;
    for(const z of [-17,-10,-3,4]) box("shopGreen",outer,5,z,1,18,1);
    box("shopGreen",outer,13,-17,1,1,22);
    for(let z=-17;z<=4;z++) {
      const height=22+Math.round(7*Math.sqrt(Math.max(0,1-((z+6.5)/10.5)**2)));
      for(let x=x0;x<=x1;x++) if(x===x0||x===x1||x===x0+5||x===x0+10||z===-7)
        voxel("shopGreen",x,height,z);
    }
    box("shopGreen",x0,30,-7,x1-x0+1,1,1);
    for(let x=x0+2;x<x1;x+=4) {
      voxel("gildedMetal",x,31,-7);box("shopGreen",x,30,-8,1,1,3);
    }
    // Potting benches sit behind the transparent front windows.
    box("timber",x0+2,8,-1,x1-x0-3,1,3);
    for(const x of [x0+2,x1-3]) box("timber",x,3,-1,1,5,3);
    for(let i=0;i<3;i++) {
      const x=x0+3+i*4, z=-14+(i%2)*3;
      box("brickRed",x,3,z,3,3,3);voxel("soil",x+1,6,z+1);
      box("foliageDark",x+1,7,z+1,1,3+i,1);
      for(const dir of [-1,1]) {
        line("foliage",[x+1,8+i,z+1],[x+1+dir*2,9+i,z],1);
        voxel(i===1?"blossomPink":"blossomGold",x+1+dir*2,10+i,z);
      }
    }
    for(let i=0;i<2;i++) {
      const x=x0+3+i*5;
      box("brickBrown",x,9,0,2,2,2);box("foliageLight",x,11,0,2,2,2);
    }
  }
  // Central lantern and a small openwork crown, all on the shared voxel grid.
  for(const x of [-3,2]) for(const z of [-9,-4]) box("shopGreen",x,41,z,1,6,1);
  box("shopGreen",-4,46,-10,8,1,8);
  box("gildedMetal",-3,47,-9,6,1,6);
  for(const [x,z] of [[-3,-9],[2,-9],[-3,-4],[2,-4]]) {
    box("gildedMetal",x,48,z,1,3,1);voxel("gildedMetal",x,51,z);
  }
  box("gildedMetal",-1,48,-7,2,4,2);voxel("gildedMetal",0,52,-6);
  // A small stone entrance projects beyond the glass, beneath an arched transom.
  box("sandstone",-6,1,7,12,1,7);
  box("limestone",-5,2,7,10,1,5);
  for(const x of [-5,4]) {
    box("limestone",x,3,7,1,15,2);box("sandstone",x-1,3,7,3,2,2);
  }
  for(let x=-5;x<=4;x++) {
    const y=19-Math.max(0,Math.abs(x+.5)-2);
    box("limestone",x,y,7,1,2,2);
  }
  for(const x of [-4,0,3]) box("shopGreen",x,3,8,1,13,1);
  for(const y of [3,9,16]) box("shopGreen",-4,y,8,8,1,1);
  for(const x of [-1,1]) voxel("gildedMetal",x,9,9);
  box("shopGreen",-2,22,7,4,5,1);
  line("gildedMetal",[-1,23,8],[1,25,8]);voxel("gildedMetal",-1,25,8);voxel("gildedMetal",1,23,8);
  // Two espalier-like vines frame the doorway, avoiding the central sightline.
  for(const side of [-1,1]) for(let y=5;y<=15;y++) {
    const x=side*(7+(y>10?1:0));
    voxel("foliageDark",x,y,7);
    if(y%3===0) box("foliage",x+(side<0?-1:0),y,8,2,1,1);
    if(y===9||y===15) voxel("blossomPink",x,y,9);
  }
  // Matching garden beds, informal planting and a low boundary with one post per corner.
  function bed(x,z,w,d,pink) {
    box("sandstone",x,1,z,w,2,d);box("soil",x+1,3,z+1,w-2,1,d-2);
    for(let dx=1;dx<w-1;dx+=3) for(let dz=1;dz<d-1;dz+=3) {
      const h=2+(dx+dz)%3;
      box("foliage",x+dx,4,z+dz,2,h,2);
      voxel(pink?"blossomPink":"blossomGold",x+dx,4+h,z+dz);
    }
  }
  bed(-27,17,16,9,true);bed(11,17,16,9,false);
  for(const side of [-1,1]) {
    const x=side<0?-28:11;
    box("shopGreen",x,2,28,17,1,1);box("shopGreen",x,5,28,17,1,1);
    for(let dx=0;dx<=16;dx+=4) box("shopGreen",x+dx,2,28,1,5,1);
    for(const dx of [0,16]) voxel("gildedMetal",x+dx,7,28);
  }
  // Rear maintenance hatch, stacked pots and a little rain barrel reward rotation.
  box("shopGreen",-4,2,-20,8,10,1);
  for(const x of [-4,3]) box("sandstone",x,2,-21,1,11,1);
  box("sandstone",-4,12,-21,8,1,1);voxel("gildedMetal",2,6,-21);
  box("timber",18,1,-25,5,6,5);
  for(const y of [2,5]) {
    box("iron",18,y,-25,5,1,1);box("iron",18,y,-21,5,1,1);
    box("iron",18,y,-24,1,1,3);box("iron",22,y,-24,1,1,3);
  }
  box("water",19,7,-24,3,1,3);box("patinaMetal",18,8,-22,1,7,1);
  for(const [x,z,h] of [[-21,-24,3],[-17,-23,5],[-24,-22,2]]) {
    box("brickRed",x,1,z,3,h,3);box("soil",x+1,h+1,z+1,1,1,1);
  }
  // A terracotta tub and curved trunk anchor the moon-crown plant.
  box("sandstone",-5,2,-11,10,3,10);box("soil",-4,5,-10,8,1,8);
  for(let y=6;y<=30;y++) {
    const x=y<15?-1:y<23?0:1;
    box("timber",x,y,-7,2,1,2);
  }
  for(const [y,x,z] of [[15,-7,-9],[21,7,-10],[26,-6,-2],[29,5,-5]])
    line("timber",[1,y-3,-6],[x,y,z]);
  // Gardener's open ledger and brass tools, visible beside the pots.
  box("sandstone",-25,9,-1,4,1,3);voxel("timber",-23,10,0);
  line("gildedMetal",[21,9,0],[25,9,1]);voxel("iron",25,9,2);
}

function addGreenhouseGlazing(buffer) {
  const {box,voxel}=voxelTools(buffer);
  for(let x=-13;x<13;x++) for(let dz=-13;dz<13;dz++) if(pavilionEdge(x,dz,13)) {
    for(let y=7;y<28;y++) {
      if(dz>=11&&x>=-5&&x<=4) continue;
      // Door to each wing remains open within the joined building.
      if(Math.abs(x+.5)>12&&dz>=-5&&dz<=4&&y<21) continue;
      voxel("lightGlass",x,y,dz-6);
    }
  }
  for(let x=-13;x<13;x++) for(let z=-13;z<13;z++) if(pavilionInside(x,z,13)) {
    const y=domeHeight(x,z);box("lightGlass",x,y-1,z-6,1,2,1);
  }
  for(const side of [-1,1]) {
    const x0=side<0?-29:13,x1=side<0?-14:28,outer=side<0?x0:x1;
    for(const z of [-17,4]) box("lightGlass",x0,6,z,x1-x0+1,16,1);
    box("lightGlass",outer,6,-17,1,16,22);
    for(let z=-17;z<=4;z++) {
      const y=22+Math.round(7*Math.sqrt(Math.max(0,1-((z+6.5)/10.5)**2)));
      box("lightGlass",x0,y,z,x1-x0+1,1,1);
      if(z>-17) {
        const prev=22+Math.round(7*Math.sqrt(Math.max(0,1-((z-1+6.5)/10.5)**2)));
        box("lightGlass",x0,Math.min(y,prev),z,x1-x0+1,Math.abs(y-prev),1);
      }
      // End gables close the curved roof without filling the interior.
      box("lightGlass",outer,22,z,1,y-22,1);
    }
  }
  for(const z of [-9,-4]) box("lightGlass",-2,42,z,4,4,1);
  for(const x of [-3,2]) box("lightGlass",x,42,-8,1,4,4);
  box("lightGlass",-3,41,-9,6,1,6);
  for(const x of [-3,1]) box("lightGlass",x,4,8,2,12,1);
  box("lightGlass",-3,17,7,6,1,1);
}

function createLeaf(name,origin,delta,width) {
  const group=new THREE.Group();group.name=name;group.position.set(...origin.map(v=>v*VOXEL_SIZE));
  const buffer=new VoxelInstanceBuffer(name),{voxel}=voxelTools(buffer);
  const steps=Math.max(Math.abs(delta[0]),Math.abs(delta[2]));
  for(let t=0;t<=steps;t++) {
    const u=t/steps, x=Math.round(delta[0]*u),z=Math.round(delta[2]*u);
    const y=Math.round(delta[1]*u+2*Math.sin(Math.PI*u));
    const half=Math.max(0,Math.round(width*Math.sin(Math.PI*u)));
    for(let s=-half;s<=half;s++) {
      const px=x+(Math.abs(delta[0])<Math.abs(delta[2])?s:0);
      const pz=z+(Math.abs(delta[0])>=Math.abs(delta[2])?s:0);
      voxel(s===0?"foliageLight":s<0?"foliageDark":"foliage",px,y-(Math.abs(s)>1?1:0),pz);
    }
  }
  partMeshes(buffer).forEach(mesh=>group.add(mesh));
  return group;
}

function createMoonFlowers() {
  const buffer=new VoxelInstanceBuffer("moon-crown-flowers"),{box,voxel,line}=voxelTools(buffer);
  for(const [x,y,z,r] of [[0,34,-6,3],[-5,30,-3,2],[5,31,-9,2]]) {
    line("foliageDark",[1,28,-6],[x,y-1,z]);
    box("blossomGold",x-1,y,z-1,3,2,3);
    for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      box("limestone",x+dx*r-1,y+1,z+dz*r-1,3,1,3);
      box("blossomGold",x+dx*(r+1),y+2,z+dz*(r+1),1,1,1);
    }
    voxel("tealMagic",x,y+2,z);
  }
  const group=new THREE.Group();group.name="MoonCrownFlowers";
  partMeshes(buffer,false).forEach(mesh=>group.add(mesh));
  return group;
}

export function createRoyalGreenhouse({cellWorldSize=4,nightLighting=0}={}) {
  const root=createVoxelMassingLab({spec:royalGreenhouseSpec(),renderStrategy:"greedy",nightLighting,
    voxelDetailPass:buffer=>{
      // Glazing shares occupancy with the frame, but has lower write priority.
      addGreenhouseGlazing(buffer);
      addRoyalGreenhouseDetails(buffer);
    }});
  root.name="RoyalGreenhouse";
  root.traverse(mesh=>{
    if(mesh.userData.materialId!=="lightGlass") return;
    mesh.material.opacity=.24;mesh.material.depthWrite=false;mesh.castShadow=false;
    mesh.material.forceSinglePass=true;
  });
  const leaves=[
    [[-6,26,-2],[-5,-3,2],2],[[1,23,-6],[9,-3,4],3],
    [[1,25,-6],[-10,-2,-2],3],[[1,28,-6],[6,-1,-7],3],
    [[1,30,-6],[-7,1,4],3],[[1,29,-6],[5,2,6],2]
  ].map(([origin,delta,width],i)=>{
    const leaf=createLeaf(`MoonCrownLeaf-${i}`,origin,delta,width);root.add(leaf);return leaf;
  });
  const flowers=createMoonFlowers();root.add(flowers);
  const baseDaylight=root.userData.updateDaylight;
  root.userData.updateDaylight=style=>{
    baseDaylight(style);
    const night=THREE.MathUtils.clamp(Math.max(style.nightFactor??0,nightLighting),0,1);
    flowers.traverse(mesh=>{
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      for(const material of materials) if(material?.emissive) {
        if(mesh.userData.materialId==="tealMagic") material.emissiveIntensity=.1+night*.7;
        if(mesh.userData.materialId==="blossomGold"||mesh.userData.materialId==="limestone") {
          material.emissive.set(mesh.userData.materialId==="blossomGold"?"#e5ce78":"#ece0c7");
          material.emissiveIntensity=night*.5;
        }
      }
    });
  };
  // Rigid voxel leaves move by only a few degrees; no per-frame geometry work.
  root.userData.update=elapsed=>{
    if(!Number.isFinite(elapsed)) return;
    leaves.forEach((leaf,i)=>{
      const phase=i*1.17;
      leaf.rotation.z=.025*(Math.sin(elapsed*.55+phase)-Math.sin(phase));
      leaf.rotation.x=.018*(Math.sin(elapsed*.37+phase)-Math.sin(phase));
    });
  };
  root.scale.setScalar(cellWorldSize/4);
  Object.assign(root.userData,{assetId:ROYAL_GREENHOUSE_ASSET_ID,assetRevision:ROYAL_GREENHOUSE_REVISION,
    representation:"special-landmark-voxel",sphereProjectionRoot:true,footprint:"2x2",entrance:"north",
    authoredParcelSize:8,voxelSize:VOXEL_SIZE,animationAnchors:{leaves:leaves.map(leaf=>leaf.name)}});
  root.userData.updateDaylight({nightFactor:0});
  return root;
}
