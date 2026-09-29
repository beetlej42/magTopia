import { createUrbanMassingSpec } from "./voxelMassingGrammar.js";
import { createVoxelMassingLab, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";

export const DIAGON_ASSET_ID = "diagon-alley-001";
export function diagonAlleySpec() {
  const shop = (id,x,z,width,depth,height,wall,roofHeight,base=0,orientation="north_south") => ({
    id,type:"solid",cells:[[x>=0?1:0,z>=0?1:0]],dimensionsVoxels:{width,depth},
    placement:{offsetVoxels:{x:x-(x>=0?16:-16),z:z-(z>=0?16:-16)}},heightVoxels:height,baseYVoxels:base,
    cap:{type:"gable",heightVoxels:roofHeight,orientation},
    materials:{wall,roof:"slate",trim:"timber",window:"warmWindow"},facade:{enabled:false}
  });
  const spec=createUrbanMassingSpec({id:DIAGON_ASSET_ID,seed:"diagon-alley-v2",widthCells:2,depthCells:2,
    masses:[shop("wand-shop",-18,-1,22,52,44,"stoneShadow",17),
      shop("bookshop",12,-19,34,20,31,"pavement",10),
      shop("apothecary",21,15,18,20,17,"brickBrown",9),
      shop("bookshop-tower",14,-20,12,14,16,"pavement",14,31),
      shop("wand-dormer",-8,-4,10,12,8,"stoneShadow",7,48,"east_west") ]});
  return {...spec,assetId:DIAGON_ASSET_ID,assetRevision:2,footprint:{...spec.footprint,worldWidth:8,worldDepth:8}};
}

export function addDiagonDetails(buffer) {
  const write={priority:VOXEL_WRITE_PRIORITIES.decoration,owner:"diagon:details"};
  const box=(m,x,y,z,w,h,d)=>buffer.addBox(m,x,y,z,w,h,d,0,write);
  // The alley is walkable negative space, not a fourth solid building.
  box("pavement",-31,0,-31,62,1,62);
  for(let z=-28;z<30;z+=4) for(let x=-29+(z%8===0?2:0);x<30;x+=6)
    box("stoneShadow",x,0,z,1,1,1);
  // Continuous L-shaped paving strip, rather than a central open courtyard.
  box("stoneShadow",-5,0,-3,1,1,29);box("stoneShadow",10,0,5,1,1,21);
  box("stoneShadow",0,0,3,29,1,1);
  box("brickBrown",30,1,-8,1,17,34); // closes side shortcuts around the shops
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
  shopfront(potions,"shopWine",18,"potions");
  for(const u of [3,18]) window(wand,u,20);
  // A hanging upper room and projecting casements exaggerate the silhouette
  // without diagonal geometry or occupying the walking lane at ground level.
  box("stoneShadow",-7,31,-17,4,13,24);
  box("timber",-7,30,-18,5,1,26);box("slate",-7,44,-18,5,2,26);
  const jetty=facade(-3,-17,"right");
  for(const u of [3,17]) window(jetty,u,34,5,8);
  const dormer=facade(-3,-10,"right");window(dormer,3,49,5,6);
  const tower=facade(8,-13,"front");window(tower,3,36,5,9);
  box("shopGreen",7,32,-13,14,2,2);box("shopGreen",7,46,-13,14,2,2);
  // A tiny copper finial tops the disproportionately tall bookshop roof.
  box("patinaMetal",13,60,-21,2,4,2);box("gildedMetal",13,64,-21,1,2,1);
  for(const u of [3,20]) window(books,u,21,5,6);
  // Street-facing end elevations, with fewer windows than the shop fronts.
  const wandEnd=facade(-29,25,"front");
  for(const y of [21,35]) window(wandEnd,8,y,5,6);
  // Restrained service elevations keep the asset complete when the city rotates.
  const rearWand=facade(-29,-7,"left"), rearBooks=facade(-5,-30,"back");
  for(const y of [20,34]) window(rearWand,0,y,4,6);
  for(const u of [6,23]) window(rearBooks,u,21,4,6);
  rearBooks("timber",15,1,0,5,11);rearBooks("iron",19,5,1,1,1);
  box("iron",-30,1,-23,1,42,1);box("iron",27,1,-30,1,29,1);
  for(const [x,z,w,d,levels] of [[-29,-27,22,52,[15,30,43]],[-5,-29,34,20,[16,30]],[12,5,18,20,[16]]]) {
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
  // Closed magical brick entrance: no visible arch, public shop window, or
  // gap through which the street can look into the alley. Opening animation
  // is intentionally not part of this fixed asset.
  box("brickBrown",-30,1,26,61,18,3);
  box("stoneShadow",-30,19,26,61,1,3);
  for(let y=2;y<18;y+=3) for(let x=-29+(y%2)*3;x<29;x+=7)
    box("brickRed",x,y,28,4,1,1);
  // A subtle offset-brick seam identifies the secret panel only close up.
  for(let y=2;y<15;y+=3) box("stoneShadow",-5,y,28,1,1,1);
  box("brickRed",1,8,28,2,1,1);
  // Modest book crates and a freestanding notice board inside the alley.
  box("timber",25,1,-7,4,3,2);box("brickRed",26,4,-7,1,2,2);
  box("shopGreen",25,1,3,1,7,1);box("timber",24,3,3,4,5,1);
  box("sandstone",25,4,4,2,3,1);
}

export function createDiagonAlley({cellWorldSize=4,nightLighting=0}={}) {
  const root=createVoxelMassingLab({spec:diagonAlleySpec(),renderStrategy:"greedy",nightLighting,voxelDetailPass:addDiagonDetails});
  root.name="DiagonAlley";root.scale.setScalar(cellWorldSize/4);
  root.userData={...root.userData,assetId:DIAGON_ASSET_ID,assetRevision:2,representation:"special-landmark-voxel",
    sphereProjectionRoot:true,footprint:"2x2",entrance:"north",authoredParcelSize:8,voxelSize:.125};
  return root;
}
