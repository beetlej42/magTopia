import { createUrbanMassingSpec } from "./voxelMassingGrammar.js";
import { createVoxelMassingLab, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";

export const DIAGON_ASSET_ID = "diagon-alley-001";
export function diagonAlleySpec() {
  const shop = (id,x,z,width,depth,height,wall,roofHeight) => ({
    id,type:"solid",cells:[[x>=0?1:0,z>=0?1:0]],dimensionsVoxels:{width,depth},
    placement:{offsetVoxels:{x:x-(x>=0?16:-16),z:z-(z>=0?16:-16)}},heightVoxels:height,
    cap:{type:"gable",heightVoxels:roofHeight,orientation:"north_south"},
    materials:{wall,roof:"slate",trim:"timber",window:"warmWindow"},facade:{enabled:false}
  });
  const spec=createUrbanMassingSpec({id:DIAGON_ASSET_ID,seed:"diagon-alley-v1",widthCells:2,depthCells:2,
    masses:[shop("wand-shop",-18,-7,22,40,44,"stoneShadow",13),
      shop("bookshop",12,-19,34,20,31,"pavement",10),
      shop("apothecary",21,12,18,14,14,"brickBrown",6)]});
  return {...spec,assetId:DIAGON_ASSET_ID,assetRevision:1,footprint:{...spec.footprint,worldWidth:8,worldDepth:8}};
}

export function addDiagonDetails(buffer) {
  const write={priority:VOXEL_WRITE_PRIORITIES.decoration,owner:"diagon:details"};
  const box=(m,x,y,z,w,h,d)=>buffer.addBox(m,x,y,z,w,h,d,0,write);
  // The alley is walkable negative space, not a fourth solid building.
  box("pavement",-31,0,-31,62,1,62);
  for(let z=-28;z<30;z+=4) for(let x=-29+(z%8===0?2:0);x<30;x+=6)
    box("stoneShadow",x,0,z,1,1,1);
  // Facade coordinates: horizontal u, vertical y, outward depth d.
  function facade(x,z,face) {
    return (m,u,y,d,w,h,t=1)=> {
      if(face==="right") box(m,x+d,y,z+u,t,h,w);
      else if(face==="left") box(m,x-d-t+1,y,z+u,t,h,w);
      else if(face==="back") box(m,x+u,y,z-d-t+1,w,h,t);
      else box(m,x+u,y,z+d,w,h,t);
    };
  }
  function window(p,u,y,w=5,h=7) {
    p("warmWindow",u,y,0,w,h);
    for(const a of [-1,w]) p("timber",u+a,y-1,1,1,h+2);
    for(const a of [-1,h]) p("timber",u-1,y+a,1,w+2,1);
    p("timber",u,y+Math.floor(h*.6),1,w,1);
    p("stoneShadow",u-1,y-2,1,w+2,1,2);
  }
  function shopfront(p,color,width,kind) {
    p(color,0,1,0,width,13);
    for(const u of [0,width-1]) p(color,u,1,1,1,14);
    p(color,-1,14,1,width+2,2,2);
    p("timber",1,1,1,4,11);
    p("warmWindow",2,7,1,2,4); // Flush door glazing.
    p("gildedMetal",4,5,2,1,1);
    // Projecting box window, shallow enough to preserve the narrow lane.
    p(color,6,2,1,width-7,10,2);
    p("warmWindow",7,4,3,width-9,7);
    p(color,6,3,3,width-7,1); p(color,6,11,3,width-7,1);
    for(let u=10;u<width-3;u+=4) p(color,u,4,4,1,7);
    // Small silhouettes of stock, with no unreadable text textures.
    for(let u=7;u<width-2;u+=3) {
      p(kind==="books"?"brickRed":kind==="potions"?"tealMagic":"timber",u,4,4,1,kind==="wands"?4:2);
      if(kind==="books") p("sandstone",u,6,4,2,1);
      if(kind==="potions") p("iron",u,6,4,1,1);
    }
    p("gildedMetal",3,14,3,width-6,1);
    // Suspended sign with an icon on the outside-facing surface.
    p("iron",width-3,17,0,1,1,7);
    p(color,width-4,12,6,4,5);
    p("sandstone",width-3,13,7,1,3);
    if(kind==="books") p("sandstone",width-1,13,7,1,3);
  }
  const wand=facade(-7,-19,"right");
  const books=facade(-4,-9,"front");
  const potions=facade(12,6,"left");
  shopfront(wand,"timber",26,"wands");
  shopfront(books,"shopGreen",30,"books");
  shopfront(potions,"shopWine",12,"potions");
  for(const y of [20,34]) for(const u of [3,18]) window(wand,u,y);
  for(const u of [3,20]) window(books,u,21,5,6);
  // Street-facing end elevations, with fewer windows than the shop fronts.
  const wandEnd=facade(-29,13,"front");
  for(const y of [6,21,35]) window(wandEnd,8,y,5,6);
  const chemEnd=facade(12,19,"front"); shopfront(chemEnd,"shopWine",17,"potions");
  // Restrained service elevations keep the asset complete when the city rotates.
  const rearWand=facade(-29,-7,"left"), rearBooks=facade(-5,-30,"back");
  for(const y of [20,34]) window(rearWand,0,y,4,6);
  for(const u of [6,23]) window(rearBooks,u,21,4,6);
  rearBooks("timber",15,1,0,5,11);rearBooks("iron",19,5,1,1,1);
  box("iron",-30,1,-23,1,42,1);box("iron",27,1,-30,1,29,1);
  for(const [x,z,w,d,levels] of [[-29,-27,22,40,[15,30,43]],[-5,-29,34,20,[16,30]],[12,5,18,14,[13]]]) {
    for(const y of levels) {
      box("stoneShadow",x-1,y,z-1,w+2,1,1);box("stoneShadow",x-1,y,z+d,w+2,1,1);
      box("stoneShadow",x-1,y,z,1,1,d);box("stoneShadow",x+w,y,z,1,1,d);
    }
  }
  // Chimneys give the grouped roofs a recognisable old-London silhouette.
  for(const [x,z,y,h] of [[-25,-20,44,18],[22,-24,31,16],[25,8,14,12]]) {
    box("brickBrown",x,y,z,3,h,3);box("stoneShadow",x-1,y+h,z-1,5,1,5);
    box("brickRed",x,y+h+1,z,1,3,1);box("brickRed",x+2,y+h+1,z+2,1,3,1);
  }
  // Low enclosing wall and a stepped opened-brick arch. Clear passage is
  // x=-5..6, with at least ten voxels of headroom under the springing.
  box("brickBrown",-30,1,26,23,7,2);box("brickBrown",9,1,26,22,7,2);
  for(const x of [-10,7]) box("brickRed",x,1,25,3,11,4);
  for(let i=0;i<4;i++) {
    box("brickRed",-7+i,11+i,25,1,2,3);
    box("brickRed",6-i,11+i,25,1,2,3);
  }
  box("brickRed",-3,15,25,6,2,3);
  box("stoneShadow",-30,8,26,20,1,2);box("stoneShadow",10,8,26,21,1,2);
  for(const x of [-27,-21,-15,13,19,25]) box("brickRed",x,4,28,3,1,1);
  // A few displaced bricks suggest the wall has just opened.
  box("brickRed",-12,1,29,3,2,2);box("brickBrown",10,1,29,2,1,2);
  for(const x of [-11,10]) {
    box("iron",x,8,28,1,5,1);box("warmWindow",x,10,29,1,2,1);
    box("iron",x-1,12,28,3,1,2);
  }
  // Modest book crates and a freestanding notice board inside the alley.
  box("timber",-2,1,-6,4,3,3);box("brickRed",-1,4,-5,1,2,2);
  box("shopGreen",5,1,-5,1,7,1);box("timber",4,3,-4,4,5,1);
  box("sandstone",5,4,-3,2,3,1);
}

export function createDiagonAlley({cellWorldSize=4,nightLighting=0}={}) {
  const root=createVoxelMassingLab({spec:diagonAlleySpec(),renderStrategy:"greedy",nightLighting,voxelDetailPass:addDiagonDetails});
  root.name="DiagonAlley";root.scale.setScalar(cellWorldSize/4);
  root.userData={...root.userData,assetId:DIAGON_ASSET_ID,assetRevision:1,representation:"special-landmark-voxel",
    sphereProjectionRoot:true,footprint:"2x2",entrance:"north",authoredParcelSize:8,voxelSize:.125};
  return root;
}
