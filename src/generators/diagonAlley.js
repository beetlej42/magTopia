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
  const spec=createUrbanMassingSpec({id:DIAGON_ASSET_ID,seed:"diagon-alley-v7",widthCells:2,depthCells:2,
    masses:[shop("wand-shop",-18,-1,22,52,29,"shopWine",12),
      shop("bookshop",12,-19,34,20,31,"shopGreen",10),
      shop("apothecary",21,15,18,20,17,"shopWine",9),
      shop("bookshop-tower",14,-20,12,14,16,"shopGreen",14,31),
      shop("wine-dormer-front",-9,14,8,9,5,"shopWine",6,32,"east_west"),
      shop("wine-dormer-middle",-9,0,8,9,5,"shopWine",6,32,"east_west"),
      {...shop("landmark-tower",-18,-19,14,16,28,"shopWine",18,29),
        cap:{type:"spire",heightVoxels:18}} ]});
  return {...spec,assetId:DIAGON_ASSET_ID,assetRevision:7,footprint:{...spec.footprint,worldWidth:8,worldDepth:8}};
}

export function addDiagonDetails(buffer) {
  const spireSurface=new Map();
  for(const v of buffer.voxels.values()) if(v.materialId==="slate"&&v.x>=-25&&v.x<=-12&&v.z>=-27&&v.z<=-12&&v.y>=57)
    spireSurface.set(`${v.x},${v.z}`,Math.max(spireSurface.get(`${v.x},${v.z}`)??0,v.y));
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
  function oriel(p,u,y,w,h,color) {
    p(color,u-1,y-2,0,w+2,h+4,3);
    p("warmWindow",u,y,3,w,h);
    for(let dx=0;dx<=w;dx+=3) p("sandstone",u+dx,y,4,1,h);
    p("sandstone",u-1,y-1,3,w+2,1,2);
    p("sandstone",u-1,y+h,3,w+2,1,2);
    p("gildedMetal",u,y+h+1,3,w,1);
    p(color,u-2,y+h+2,1,w+4,1,3);
    p("sandstone",u,y+Math.floor(h/2),4,w,1);
  }
  function flowerbox(p,u,y,w) {
    p("timber",u,y,3,w,1,2);
    p("foliage",u+1,y+1,3,w-2,1,2);
    for(const dx of [1,w-2]) p("blossomPink",u+dx,y+2,4,1,1);
    p("foliage",u+2,y-1,4,1,1);
  }
  const wand=facade(-7,-19,"right");
  const books=facade(-4,-9,"front");
  const potions=facade(12,6,"left");
  shopfront(wand,"shopWine",26,"wands");
  // Continue the interior retail frontage right up to the concealed entrance.
  shopfront(facade(-7,10,"right"),"shopWine",14,"wands");
  shopfront(books,"shopGreen",30,"books");
  shopfront(potions,"shopWine",18,"potions");
  for(const u of [3,18]) oriel(wand,u,19,5,9,"shopWine");
  for(const z of [-4,10]) window(facade(-5,z,"right"),2,33,4,4);
  flowerbox(wand,3,16,5);
  flowerbox(books,20,17,6);
  flowerbox(potions,6,1,5);
  // The two-storey wine shop is the low foreground; a single rear tower
  // carries the landmark silhouette rather than a full extra storey.
  const towerFront=facade(-25,-11,"front"), towerSide=facade(-11,-27,"right");
  oriel(towerFront,4,41,6,12,"shopWine");
  oriel(towerSide,5,41,6,12,"shopWine");
  for(const y of [39,55]) {
    box("sandstone",-26,y,-28,16,1,18);
    if(y===55) box("shopWine",-25,y+1,-27,14,1,16);
  }
  for(const x of [-25,-12]) box("sandstone",x,40,-11,1,15,1);
  for(const z of [-27,-12]) box("sandstone",-11,40,z,1,15,1);
  // Prone dragon: its belly follows the roof, not an upright torso.
  const roofY=(x,z)=>(spireSurface.get(`${x},${z}`)??57)+1;
  for(let z=-20;z<=-13;z++) for(let x=-20;x<=-16;x++)
    box("limestone",x,roofY(x,z),z,1,3,1);
  // Low bent neck turns outward into the alley; muzzle points across the roof.
  box("limestone",-18,66,-13,4,3,3);
  box("limestone",-15,67,-13,4,3,3);
  box("limestone",-12,67,-12,4,2,2);
  for(const z of [-13,-11]) box("stoneShadow",-15,70,z,1,2,1);
  box("gildedMetal",-13,69,-10,1,1,1);
  // Four spread claws clasp the sloping slate on either side of the belly.
  for(const z of [-18,-13]) for(const x of [-22,-15]) {
    const y=roofY(x,z);
    box("limestone",x,y,z,2,2,2);
    box("limestone",x===-22?x+1:x-1,y+1,z,2,3,2);
    box("stoneShadow",x,y,z+2,2,1,1);
  }
  const tail=[[-19,-19],[-20,-19],[-21,-19],[-21,-20],[-22,-20],[-23,-20],[-23,-21],[-24,-21],[-24,-22],[-24,-23],[-24,-24],[-23,-24],[-23,-25],[-22,-25],[-21,-25]];
  let previousY=roofY(-19,-19);
  for(const [x,z] of tail) {
    const y=(spireSurface.get(`${x},${z}`)??57)+1;
    box("limestone",x,Math.min(y,previousY),z,2,Math.abs(y-previousY)+2,2);
    previousY=y;
  }
  // Folded wings run lengthwise beside the back, tapering toward the tail.
  for(const sign of [-1,1]) for(let i=0;i<9;i++) {
    const z=-14-i, x=-18+sign*(i<4?4:3);
    const y=roofY(x,z)+3;
    const h=i<4?4:Math.max(1,8-i);
    box("stoneShadow",x,y,z,2,h,1);
    box("limestone",x,y+h,z,2,1,1);
  }
  const tower=facade(8,-13,"front");window(tower,3,36,5,9);
  box("shopGreen",7,32,-13,14,2,2);box("shopGreen",7,46,-13,14,2,2);
  // A tiny copper finial tops the disproportionately tall bookshop roof.
  box("patinaMetal",13,60,-21,2,4,2);box("gildedMetal",13,64,-21,1,2,1);
  for(const u of [3,20]) oriel(books,u,20,6,8,"shopGreen");
  // Slender painted pilasters tie the retail colour through the full facade.
  for(const u of [0,15,32]) books("sandstone",u,17,1,1,13);
  for(const u of [0,12,27]) wand("sandstone",u,17,1,1,12);
  // Two small stepped turrets echo the reference's clustered spires while
  // remaining integer voxels and keeping the central roof dominant.
  for(const x of [0,24]) {
    box("shopGreen",x,26,-17,5,13,6);
    box("sandstone",x-1,37,-18,7,1,8);
    box("warmWindow",x+1,30,-11,2,5,1);
    box("sandstone",x+2,30,-10,1,5,1);
    for(let level=0;level<3;level++)
      box("slate",x-1+level,39+level*3,-18+level,7-level*2,3,8-level*2);
    box("gildedMetal",x+2,48,-15,1,3,1);
  }
  // Street-facing end elevations, with fewer windows than the shop fronts.
  const wandEnd=facade(-29,25,"front");
  window(wandEnd,8,21,5,6);
  // Restrained service elevations keep the asset complete when the city rotates.
  const rearWand=facade(-29,-7,"left"), rearBooks=facade(-5,-30,"back");
  window(rearWand,0,20,4,6);
  window(facade(-25,-27,"back"),4,43,5,8);
  window(facade(-25,-23,"left"),0,43,5,8);
  for(const u of [6,23]) window(rearBooks,u,21,4,6);
  rearBooks("timber",15,1,0,5,11);rearBooks("iron",19,5,1,1,1);
  box("iron",-30,1,-23,1,28,1);box("iron",27,1,-30,1,29,1);
  for(const [x,z,w,d,levels] of [[-29,-27,22,52,[15,28]],[-5,-29,34,20,[16,30]],[12,5,18,20,[16]]]) {
    for(const y of levels) {
      box("stoneShadow",x-1,y,z-1,w+2,1,1);box("stoneShadow",x-1,y,z+d,w+2,1,1);
      box("stoneShadow",x-1,y,z,1,1,d);box("stoneShadow",x+w,y,z,1,1,d);
    }
  }
  // Chimneys give the grouped roofs a recognisable old-London silhouette.
  for(const [x,z,y,h] of [[22,-24,31,16],[25,8,14,12]]) {
    box("brickBrown",x,y,z,3,h,3);box("stoneShadow",x-1,y+h,z-1,5,1,5);
    box("brickRed",x,y+h+1,z,1,3,1);box("brickRed",x+2,y+h+1,z+2,1,3,1);
  }
  // Freeze the enchanted wall halfway through opening: an irregular narrow
  // slit with displaced brick ends, not a conventional gateway or animation.
  for(let y=1;y<=18;y++) {
    const left=y<4?-1:y<10?-3:y<15?-2:0;
    const right=y<5?3:y<12?4:y<16?3:2;
    box("brickBrown",-30,y,26,left+30,1,3);
    box("brickBrown",right,y,26,31-right,1,3);
    if(y%3===1) {
      box("brickRed",left-2,y,29,2,1,2);
      box("brickRed",right,y,25,2,1,2);
    }
  }
  box("stoneShadow",-30,19,26,61,1,3);
  for(let y=2;y<18;y+=3) for(let x=-29+(y%2)*3;x<29;x+=7)
    if(x+4 < -4 || x>5) box("brickRed",x,y,28,4,1,1);
  // Modest book crates and a freestanding notice board inside the alley.
  box("timber",25,1,-7,4,3,2);box("brickRed",26,4,-7,1,2,2);
  box("shopGreen",25,1,3,1,7,1);box("timber",24,3,3,4,5,1);
  box("sandstone",25,4,4,2,3,1);
  // A lived-in corner: parcel crate, stock barrel and a folded shop awning.
  box("timber",26,1,7,3,4,3);box("iron",26,2,7,3,1,3);
  box("soil",26,5,7,3,1,3);
  box("timber",23,1,-7,2,2,2);box("sandstone",23,3,-7,2,1,2);
  books("shopGreen",1,12,2,7,1,4);
  for(const u of [2,5]) books("sandstone",u,12,2,1,1,4);
}

export function createDiagonAlley({cellWorldSize=4,nightLighting=0}={}) {
  const root=createVoxelMassingLab({spec:diagonAlleySpec(),renderStrategy:"greedy",nightLighting,voxelDetailPass:addDiagonDetails});
  root.name="DiagonAlley";root.scale.setScalar(cellWorldSize/4);
  root.userData={...root.userData,assetId:DIAGON_ASSET_ID,assetRevision:7,representation:"special-landmark-voxel",
    sphereProjectionRoot:true,footprint:"2x2",entrance:"north",authoredParcelSize:8,voxelSize:.125};
  return root;
}
