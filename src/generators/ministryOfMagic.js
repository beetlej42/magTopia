import { createUrbanMassingSpec } from "./voxelMassingGrammar.js";
import { createVoxelMassingLab, VOXEL_SIZE, VOXEL_WRITE_PRIORITIES } from "./voxelBuildingLab.js";

export const MINISTRY_ASSET_ID = "ministry-tudor-001";
export const MINISTRY_PARCEL_SIZE = 8;
export const MINISTRY_ASSET_REVISION = 6;
// Material roles match the existing civic buildings. Metal is an accent, not
// a substitute for slate roofing or glazing; no asset-specific RGB palette.
export const MINISTRY_MATERIALS = Object.freeze({
  wall: "limestone", trim: "timber", roof: "slate", window: "warmWindow", door: "timber"
});

// Public-building grammar: a narrow reception, two jettied storeys and a garden.
export function ministryOfMagicSpec() {
  const materials = MINISTRY_MATERIALS;
  const facade = { enabled: false, openness: 0, entranceEmphasis: 0, detailDensity: 0, order: "plain" };
  const mass = (id, x, z, width, depth, base, height, cap = { type: "flat" }) => ({
    id, type: "solid", cells: [[0, 0]], dimensionsVoxels: { width, depth },
    placement: { offsetVoxels: { x: x + 16, z: z + 16 } },
    baseYVoxels: base, heightVoxels: height, cap, materials, facade
  });
  const spec = createUrbanMassingSpec({
    id: MINISTRY_ASSET_ID, seed: "ministry-tudor-voxel-v6", widthCells: 2, depthCells: 2,
    masses: [
      mass("reception", -9, -10, 22, 23, 0, 18),
      mass("council", -9, -10, 28, 26, 18, 17),
      mass("archive", -10, -10, 30, 27, 35, 16,
        { type: "gable", heightVoxels: 19, orientation: "north_south", overhangVoxels: 2 }),
      mass("roof-dormer", 0, -13, 8, 9, 57, 6,
        { type: "gable", heightVoxels: 5, orientation: "east_west", overhangVoxels: 1 }),
      { ...mass("registry-annex", 0, -12, 9, 22, 0, 22,
        { type: "gable", heightVoxels: 9, orientation: "north_south", overhangVoxels: 1 }),
        cells: [[1,0]], placement: { offsetVoxels: { x: -6, z: 4 } } },
      { id: "east-garden", type: "ground", cells: [[1,0]], dimensionsVoxels: { width: 12, depth: 58 },
        placement: { offsetVoxels: { x: 9, z: 16 } }, heightVoxels: 1,
        materials: { ground: "grass", trim: "grass" }, cap: { type: "flat" },
        groundTreatment: { pattern: "plain" } }
    ],
    relations: [{ type: "stacked", from: "reception", to: "council" }, { type: "stacked", from: "council", to: "archive" }]
  });
  return { ...spec, assetId: MINISTRY_ASSET_ID, assetRevision: MINISTRY_ASSET_REVISION,
    footprint: { ...spec.footprint, worldWidth: 8, worldDepth: 8 } };
}

// Integer voxels only. Diagonal timbers and rings use 6-connected stair steps.
export function addMinistryVoxelDetails(buffer) {
  const roofEnds = [...buffer.voxels.values()].filter(v =>
    (v.z===3 || v.z===-23) && v.y>=51 && v.materialId===MINISTRY_MATERIALS.roof);
  const write = { priority: VOXEL_WRITE_PRIORITIES.decoration, owner: "ministry:tudor-details" };
  const box = (m,x,y,z,w,h,d) => buffer.addBox(m,x,y,z,w,h,d,0,write);
  const voxel = (m,x,y,z) => buffer.addVoxel(m,x,y,z,0,write);
  function line(m, a, b, width = 1) {
    const delta = b.map((v,i)=>v-a[i]);
    const steps = Math.max(...delta.map(Math.abs));
    const last = [...a];
    box(m,...a,width,width,width);
    for(let i=1;i<=steps;i++) {
      const next = a.map((v,j)=>Math.round(v+delta[j]*i/steps));
      for(let axis=0;axis<3;axis++) while(last[axis]!==next[axis]) {
        last[axis]+=Math.sign(next[axis]-last[axis]); box(m,...last,width,width,width);
      }
    }
  }
  function crown(x,y,z,r) {
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++) for(let dz=-r;dz<=r;dz++) {
      if(dx*dx+dy*dy+dz*dz > r*r || Math.abs(dx)+Math.abs(dy)+Math.abs(dz)>r*1.65) continue;
      voxel(dy>1 ? "foliageLight" : dx+dz < -2 ? "foliageDark" : "foliage",x+dx,y+dy,z+dz);
    }
  }
  function window(x,y,z,w=6,h=9,face="front") {
    const patch = (m,dx,dy,dz,pw,ph,pd) => {
      if(face==="right") box(m,x+dz,y+dy,z+dx,pd,ph,pw);
      else if(face==="left") box(m,x-dz-pd+1,y+dy,z+dx,pd,ph,pw);
      else if(face==="back") box(m,x+dx,y+dy,z-dz-pd+1,pw,ph,pd);
      else box(m,x+dx,y+dy,z+dz,pw,ph,pd);
    };
    // One consistent pane material across the whole window; the existing
    // public-building daylight callback controls its emission at night.
    patch(MINISTRY_MATERIALS.window,0,0,0,w,h,1);
    // Glazing is inset behind a single-voxel frame, rather than buried in two
    // nested heavy borders. Small dormers have fewer divisions than tall bays.
    for(const dx of [-1,w]) patch("timber",dx,-1,1,1,h+2,1);
    for(const dy of [-1,h]) patch("timber",-1,dy,1,w+2,1,1);
    if(w>=6) patch("timber",Math.floor(w/2),0,1,1,h,1);
    if(h>=7) patch("timber",0,Math.floor(h*.57),1,w,1,1);
    patch("stoneShadow",-1,-2,0,w+2,1,2);
    patch("sandstone",-1,-2,2,w+2,1,1);
  }
  function planter(x,z,w=9,d=5) {
    box("sandstone",x,0,z,w,3,d); box("soil",x+1,3,z+1,w-2,1,d-2);
    for(let dx=1;dx<w-1;dx+=2) {
      box("foliage",x+dx,4,z+1,2,2,d-2); voxel("blossomPink",x+dx,6,z+2);
    }
  }
  // Paving and planting, confined to the 64 x 64 voxel parcel.
  // Flush, staggered rectangular slabs instead of raised checkerboard blocks.
  box("pavement",-30,0,4,48,1,27);
  for(let row=0;row<9;row++) for(let col=0;col<9;col++) {
    const x=-30+col*6+(row%2)*3, z=4+row*3;
    if(x+5>18) continue;
    box((row*11+col*7)%19===0?"sandstone":"pavement",x,0,z,5,1,2);
    // Just the staggered joint endpoints: continuous dark grid lines compete
    // with the timber facade at this voxel scale.
    voxel("stoneShadow",x+5,0,z);
  }
  box("grass",-31,0,27,13,1,4);
  for(const [x,y,z,w,d] of [[-21,0,-22,24,25],[-24,18,-24,30,28],[-26,35,-25,32,29],[-26,51,-25,32,29]])
    box(y===0?"sandstone":"timber",x,y,z,w,1,d);
  for(const [left,right,back,front,bottom,top] of [[-20,1,-21,1,1,17],[-23,4,-23,2,19,34],[-25,4,-23,3,36,50]]) {
    for(const x of [left,-10,right]) {
      box("timber",x,bottom,front,1,top-bottom+1,1); box("timber",x,bottom,back,1,top-bottom+1,1);
    }
    for(const x of [left,right]) for(const z of [back,-11,front]) box("timber",x,bottom,z,1,top-bottom+1,1);
    for(const x of [left,right]) box("timber",x,bottom,back+5,1,top-bottom+1,1);
  }
  window(-20,23,3,5,8);
  // One planted sill provides a small lived-in detail without repeating a
  // flower box on every window or hiding the structural window rhythm.
  box("timber",-20,20,5,6,1,2);
  box("foliage",-19,21,5,4,1,2);
  voxel("blossomPink",-19,22,6); voxel("blossomPink",-16,22,6);
  voxel("foliage",-18,19,6);
  // One principal casement; secondary openings stay narrow and leave plaster
  // visible. Side and rear elevations get one opening per storey, not pairs.
  window(-13,39,4,7,9);
  for(const y of [23,39]) {
    window(5,y+1,-5,5,8,"right");
    window(y===23?-24:-26,y+1,-6,5,8,"left");
    window(y===23?-19:-5,y+1,-24,5,8,"back");
  }
  window(-18,5,2,4,8);
  box("timber",-11,1,2,8,14,1); box("timber",-10,2,3,6,12,1);
  box("warmWindow",-9,10,4,4,3,1); voxel("gildedMetal",-5,7,4);
  box("sandstone",-13,0,4,12,1,4);
  box("timber",-3,19,3,6,13,1); box("warmWindow",-2,27,4,4,3,1);
  // Recessed timber door panels and a small brass latch, not a metal slab.
  box("timber",-9,3,4,4,4,1); box("timber",-2,20,4,4,4,1);
  voxel("gildedMetal",1,25,4);
  box("timber",-10,20,3,1,14,1);
  box("timber",-8,1,-23,6,13,1); box("sandstone",-10,0,-26,10,1,3);
  // Jetty brackets, slender balcony posts and exterior stair.
  for(const x of [-21,2]) {
    box("timber",x,15,1,2,3,2);
    box("timber",x,16,3,2,2,1);
    box("timber",x,17,4,2,1,2);
  }
  // Small repeated corbels make the upper jetty read as crafted joinery.
  for(const x of [-24,-11,3]) {
    box("timber",x,33,2,1,2,2); box("timber",x,34,4,1,1,1);
  }
  for(const z of [-21,-11,1]) {
    box("timber",3,33,z,2,2,1); box("timber",5,34,z,1,1,1);
  }
  box("timber",-4,18,3,18,1,10);
  for(const x of [-4,13]) box("timber",x,0,11,1,18,1);
  for(const x of [-4,0,4]) box("timber",x,19,12,1,6,1);
  box("timber",-4,25,12,11,1,1);
  // Keep the stair head open; the right-hand balustrade turns beside it.
  box("timber",14,25,4,1,1,8);
  for(const z of [4,8]) box("timber",14,19,z,1,6,1);
  for(let i=0;i<9;i++) box("timber",8,1+i*2,29-i*2,7,1,2);
  for(const x of [7,15]) {
    line("timber",[x,0,30],[x,17,12]); line("timber",[x,7,30],[x,24,12]);
    for(let i=0;i<9;i+=2) box("timber",x,2+i*2,29-i*2,1,7,1);
  }
  window(15,8,-14,4,8,"right");
  // Read the actual public-grammar roof heightfield so the timber edge cannot
  // drift away from its stepped roof. The gable infill sits one voxel behind.
  const roofHeights = new Map();
  // Extend only the ridge-axis ends, preserving the stock roof cross-section
  // and its thickness. Snapshot first: never iterate entries we are appending.
  // The massing compiler currently keeps this cap inside its mass bounds;
  // four added slices give two clear voxels beyond the projecting gable trim.
  for(const v of roofEnds) for(const distance of [1,2,3,4])
    voxel(MINISTRY_MATERIALS.roof,v.x,v.y,v.z+(v.z===3?distance:-distance));
  for(const v of buffer.voxels.values()) if(v.z===5 && v.y>=51 && v.materialId===MINISTRY_MATERIALS.roof)
    roofHeights.set(v.x,Math.max(roofHeights.get(v.x)??0,v.y));
  for(const z of [5,-25]) {
    for(const [x,y] of roofHeights) {
      voxel("timber",x,y,z===5?7:-27);
      if(x>=-25 && x<=4 && y>52) box("limestone",x,52,z===5?4:-24,1,y-52,1);
    }
    for(const x of [-18,-10,-2])
      box("timber",x,52,z,1,(roofHeights.get(x)??53)-52,1);
  }
  // The dormer lights the attic; the front gable remains solid timber/plaster.
  window(4,58,-14,4,4,"right");
  // Compact crest and stepped eave returns, with no out-of-grid geometry.
  for(const z of [-26,4]) {
    box("timber",-27,50,z,3,1,4); box("timber",4,50,z,3,1,4);
  }
  box("brickRed",-19,51,-19,4,23,4);
  // Brick bond stays subdued; broad alternating cream stripes looked toy-like.
  for(let y=54;y<74;y+=4) {
    voxel("brickBrown",-19,y,-18); voxel("brickBrown",-16,y+1,-17);
  }
  box("sandstone",-20,74,-20,6,1,6);
  box("brickRed",-19,75,-19,1,3,2); box("brickRed",-16,75,-19,1,3,2);
  // Pixel-rune banner and stepped astrolabe rings.
  box("iron",4,33,7,9,1,1); box("patinaMetal",8,26,7,5,7,1);
  for(const [dx,dy] of [[0,0],[0,1],[0,2],[0,3],[1,2],[2,1],[3,2],[4,3],[4,2],[4,1],[4,0]]) voxel("gildedMetal",8+dx,27+dy,8);
  box("sandstone",22,0,7,7,2,9); box("sandstone",21,0,8,9,2,7);
  box("stoneShadow",24,2,10,3,5,3); box("sandstone",22,7,8,7,1,7);
  const points=[];
  for(let i=0;i<=32;i++) points.push([Math.round(4*Math.cos(i*Math.PI/16)),Math.round(4*Math.sin(i*Math.PI/16))]);
  for(let i=1;i<points.length;i++) {
    const [a,b]=[points[i-1],points[i]];
    line("patinaMetal",[25+a[0],12+a[1],11],[25+b[0],12+b[1],11]);
    line("patinaMetal",[25+a[0],12,11+a[1]],[25+b[0],12,11+b[1]]);
  }
  box("gildedMetal",25,8,11,1,10,1); voxel("tealMagic",25,12,11);
  planter(-28,23,11,5); planter(21,24,9,5);
  for(const z of [-20,-14,-8,-2]) crown(28,3,z,3);
  box("timber",23,0,-23,2,15,2); line("timber",[24,7,-22],[27,14,-22]);
  crown(23,17,-23,5); crown(26,15,-23,4); crown(21,20,-22,4);
  for(const x of [-28,-20]) { box("iron",x,1,12,1,3,4); box("iron",x,1,12,1,8,1); }
  for(const z of [12,14,16]) box("timber",-29,4,z,11,1,1);
  for(const y of [6,8]) box("timber",-29,y,12,11,1,1);
  box("iron",1,15,3,1,1,4); box("warmWindow",1,11,6,2,3,2);
  box("iron",0,10,5,4,1,4); box("iron",0,14,5,4,1,4);
}

export function createMinistryOfMagic({ cellWorldSize = 4, nightLighting = 0 } = {}) {
  const root = createVoxelMassingLab({ spec: ministryOfMagicSpec(), renderStrategy: "greedy",
    nightLighting, voxelDetailPass: addMinistryVoxelDetails });
  root.name = "MinistryOfMagic";
  root.scale.setScalar(cellWorldSize / 4);
  root.userData.contract.sourceOfTruth = "UrbanMassingSpec + ministry-tudor-v6 authored voxel detail pass";
  root.userData = { ...root.userData, assetId: MINISTRY_ASSET_ID, assetRevision: MINISTRY_ASSET_REVISION,
    representation: "special-landmark-voxel", sphereProjectionRoot: true,
    footprint: "2x2", entrance: "north", authoredParcelSize: 8, voxelSize: VOXEL_SIZE };
  return root;
}
