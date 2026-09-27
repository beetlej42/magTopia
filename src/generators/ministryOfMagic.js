import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ACTIVE_VISUAL_THEME } from "../render/sunlitStorybookTheme.js";

export const MINISTRY_ASSET_ID = "ministry-tudor-001";
export const MINISTRY_PARCEL_SIZE = 8;
export function ministryOfMagicSpec() {
  return { specVersion: "1.0", id: MINISTRY_ASSET_ID, assetId: MINISTRY_ASSET_ID,
    footprint: { worldWidth: MINISTRY_PARCEL_SIZE, worldDepth: MINISTRY_PARCEL_SIZE } };
}

// Authored in world units, ground at Y=0, entrance at +Z. Geometry is merged
// by material: the hundreds of small architectural parts cost only a few draws.
export function createMinistryOfMagic({ cellWorldSize = 4, nightLighting = 0 } = {}) {
  const root = new THREE.Group();
  root.name = "MinistryOfMagic";
  const palette = ACTIVE_VISUAL_THEME.materials;
  const colors = {
    plaster: palette.limestone, stone: palette.sandstone, stoneDark: palette.stoneShadow,
    timber: palette.timber, timberLight: "#79634c", roof: "#60736c", roofLight: "#718177",
    roofDark: "#53645f", iron: palette.iron, brass: "#c6a568", glass: "#749697",
    glow: palette.warmWindow, door: palette.patinaMetal, grass: palette.grass,
    leaf: palette.foliage, leafLight: palette.foliageLight, leafDark: palette.foliageDark,
    paving: palette.pavement, pavingLight: "#ccc2b0", pavingDark: "#ada798",
    soil: palette.soil, flowers: "#a897bd", brick: palette.brickRed, water: palette.waterLight
  };
  const batches = new Map();
  function part(geometry, color, x, y, z, rotation) {
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    geometry.translate(x, y, z);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    // All primitives have position/normal/uv; discard UVs (no textures).
    flat.deleteAttribute("uv");
    if (!batches.has(color)) batches.set(color, []);
    batches.get(color).push(flat);
  }
  const box = (x,y,z,w,h,d,c,rotation) => part(new THREE.BoxGeometry(w,h,d),c,x,y,z,rotation);
  function beam(a,b,width,color="timber",depth=width) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const g = new THREE.BoxGeometry(width, from.distanceTo(to), depth);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),to.clone().sub(from).normalize()));
    const mid = from.add(to).multiplyScalar(.5); part(g,color,...mid.toArray());
  }
  const cylinder = (x,y,z,rt,rb,h,c,n=8) => part(new THREE.CylinderGeometry(rt,rb,h,n),c,x,y,z);
  const sphere = (x,y,z,r,c) => part(new THREE.IcosahedronGeometry(r,0),c,x,y,z);
  function ring(x,y,z,r,t,c,rotation=[0,0,0]) { part(new THREE.TorusGeometry(r,t,4,24),c,x,y,z,rotation); }
  function triangleWall(x,z,y,w,h,depth) {
    const shape = new THREE.Shape(); shape.moveTo(-w/2,0); shape.lineTo(w/2,0); shape.lineTo(0,h); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false});
    part(g,"plaster",x,y,z-depth/2);
  }
  function roof(x,z,y,w,d,rise) {
    triangleWall(x,z,y,w,rise,d);
    const slope = Math.atan2(rise,w/2), length = Math.hypot(w/2,rise);
    for (const side of [-1,1]) {
      box(x+side*w/4,y+rise/2,z,length+.22,.13,d+.36,"roofDark",[0,0,-side*slope]);
      // Shingle courses have quiet, deterministic variation, no noisy texture.
      const rows = Math.ceil(length/.24), cols = Math.ceil((d+.32)/.38);
      for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
        const t = (row+.5)/rows;
        const px = x+side*w/2*(1-t), py = y+rise*t+.085;
        const pz = z-(d+.32)/2+(col+.5)*(d+.32)/cols;
        box(px,py,pz,length/rows+.035,.055,(d+.32)/cols-.015,
          (row*17+col*7+row*col*3)%23<3?"roofLight":"roof",[0,0,-side*slope]);
      }
    }
    for (const faceZ of [z-d/2-.2,z+d/2+.2]) {
      beam([x-w/2-.1,y,faceZ],[x,y+rise+.1,faceZ],.13,"timber");
      beam([x,y+rise+.1,faceZ],[x+w/2+.1,y,faceZ],.13,"timber");
    }
    box(x,y+rise+.11,z,.19,.16,d+.5,"roofDark");
  }
  // Window on a local +Z facade; side windows are rotated around their centre.
  function window(x,y,z,w,h,side=false) {
    const start = new Map([...batches].map(([k,v])=>[k,v.length]));
    box(0,0,.012,w+.17,h+.18,.12,"timberLight");
    box(0,0,.085,w,h,.08,"glass");
    for (const dx of [-w/2,0,w/2]) box(dx,0,.15,.055,h+.06,.07,"timber");
    for (const dy of [-h/2,0,h/2]) box(0,dy,.15,w+.08,.055,.07,"timber");
    box(0,-h/2-.11,.14,w+.3,.11,.3,"stone");
    // A few amber panes keep the daylight facade quiet and light up at night.
    box(-w/4,-h/4,.13,w/2-.06,h/2-.06,.025,"glow");
    for (const [key,geometries] of batches) for(let i=start.get(key)??0;i<geometries.length;i++) {
      if(side) geometries[i].rotateY(Math.PI/2);
      geometries[i].translate(x,y,z);
    }
  }
  function planter(x,z,w=.75,d=.48) {
    box(x,.24,z,w,.36,d,"stoneDark"); box(x,.44,z,w+.06,.1,d+.06,"stone");
    for(let i=0;i<4;i++) sphere(x-w*.32+i*w*.21,.6,z,.22,i%2?"leafLight":"leaf");
    for(let i=0;i<5;i++) sphere(x-w*.35+i*w*.17,.77,z+.03,.065,"flowers");
  }

  // Thin parcel edge, not a tall podium. Open foreground and eastern garden.
  box(0,.035,0,7.84,.07,7.84,"stoneDark");
  box(0,.08,0,7.68,.05,7.68,"grass");
  for(let iz=0;iz<13;iz++) for(let ix=0;ix<13;ix++) {
    const x=-3.53+ix*.58, z=-3.53+iz*.58;
    // Paved approach plus path to the exterior stair; planting at the edges.
    if ((z>0.25 && x<1.75 && z<3.5) || (x>1.5&&x<2.35&&z>-.2) || (z<.25&&x<2.3))
      box(x,.135,z,.552,.07,.552,(ix*13+iz*7+ix*iz)%17<3?"pavingLight":"paving");
  }
  // Narrow ground storey, upper jetty, slightly offset attic. No bulky plinth.
  box(-1.02,1.17,-1.12,2.82,2.04,2.85,"plaster");
  box(-1.05,3.25,-1.16,3.42,2.05,3.22,"plaster");
  box(-1.18,5.26,-1.2,3.54,1.93,3.28,"plaster");
  for (const [x,y,z,w,d] of [[-1.02,.32,-1.12,2.9,2.92],[-1.05,2.23,-1.16,3.62,3.42],[-1.18,4.29,-1.2,3.72,3.46],[-1.18,6.24,-1.2,3.7,3.46]]) {
    box(x,y,z,w,.17,d,y<1?"stone":"timber");
    if(y>1) box(x,y+.12,z,w,.055,d,"timberLight");
  }
  // Front frame: long, slender uprights and deliberate diagonal braces.
  for(const [y,h,z,xs] of [[1.22,1.82,.34,[-2.38,-1.42,.32]],[3.28,1.87,.49,[-2.7,-1.18,.6]],[5.28,1.82,.49,[-2.9,-1.18,.55]]]) {
    for(const x of xs) box(x,y,z,.12,h,.14,"timber");
  }
  beam([-2.65,2.4,.51],[-1.64,3.18,.51],.1);
  beam([-.9,4.45,.52],[.45,5.35,.52],.11);
  beam([-2.78,5.3,.52],[-1.5,6.08,.52],.11);
  // Both side and rear elevations are finished, not just the hero facade.
  for(const [x,z0,z1,y0,y1] of [[.69,-2.72,.42,2.4,4.17],[.63,-2.78,.42,4.45,6.13],[-2.96,-2.78,.42,4.45,6.13],[-2.81,-2.72,.42,2.4,4.17]]) {
    for(const z of [z0,(z0+z1)/2,z1]) box(x,(y0+y1)/2,z,.13,y1-y0,.13,"timber");
    beam([x,y0,z0+.15],[x,y1-.1,z0+.9],.1);
  }
  for(const y of [3.25,5.3]) {
    window(-2.06,y+.07,.54,.72,1.15);
    if(y>4) window(-.35,y+.07,.54,.8,1.15);
    window(.7,y,-1.82,.85,1.12,true);
    window(.7,y,-.45,.75,1.12,true);
    for(const x of [-2.05,-.35]) {
      // Rear windows use the same frame, facing outward.
      const start = new Map([...batches].map(([k,v])=>[k,v.length]));
      window(-x,y,2.91,.72,1.1);
      for (const [key,gs] of batches) for(let i=start.get(key)??0;i<gs.length;i++) gs[i].rotateY(Math.PI);
    }
    // Left side: a quiet single bay, framed by the diagonal timber braces.
    const start = new Map([...batches].map(([k,v])=>[k,v.length]));
    window(y>4?2.97:2.82,y,.45,.76,1.04,true);
    for(const [key,gs] of batches) for(let i=start.get(key)??0;i<gs.length;i++) gs[i].rotateY(Math.PI);
    for(const x of [-2.85,-1.18,.51]) box(x,y,-2.91,.11,1.78,.12,"timber");
  }
  // Rear service door and framed attic prevent an unfinished blank back.
  box(-.55,1.02,-2.6,.7,1.65,.1,"door");
  box(-.55,.24,-2.87,1.06,.15,.65,"stone");
  beam([-1.18,6.42,-3.06],[-1.18,8.56,-3.06],.12);
  beam([-2.35,6.47,-3.06],[-1.23,7.72,-3.06],.1);
  beam([-.01,6.47,-3.06],[-1.13,7.72,-3.06],.1);
  // Ground public entrance beneath the cantilever, with transom and hood.
  box(-1,1.05,.345,.92,1.72,.14,"timber");
  box(-1,.99,.44,.7,1.48,.08,"door");
  box(-1,1.48,.49,.5,.3,.045,"glass");
  box(-1,.65,.49,.52,.45,.04,"timberLight"); sphere(-.76,.98,.52,.045,"brass");
  box(-1,.2,.75,1.3,.15,.65,"stone");
  window(-2,1.25,.35,.43,.83);
  // Jetty brackets leave open air beneath the upper storey.
  for(const x of [-2.45,.35]) beam([x,1.72,.28],[x,2.16,.68],.14);
  // Shallow side annex under a lower roof, with an exterior stair and landing.
  box(1.25,1.38,-1.42,1.04,2.43,2.53,"plaster");
  box(1.26,2.66,-1.4,1.25,.16,2.72,"timber");
  roof(1.25,-1.42,2.76,1.32,2.7,1.23);
  window(1.79,1.56,-1.34,.72,1.05,true);
  box(.62,2.24,1.02,2.04,.14,1.03,"timberLight");
  for(const x of [-.28,1.47]) box(x,1.17,1.33,.11,2.04,.11,"timber");
  // Stair climbs away from the courtyard towards the first-floor side door.
  for(let i=0;i<10;i++) box(1.38,.28+i*.205,3.43-i*.232,.9,.11,.27,"timberLight");
  for(const x of [.93,1.83]) {
    beam([x,.17,3.55],[x,2.18,1.27],.13);
    beam([x,.95,3.55],[x,2.99,1.27],.065);
    for(const i of [0,3,6,9]) box(x,.57+i*.205,3.43-i*.232,.065,.9,.065,"timber");
  }
  for(const x of [-.28,.25,.8,1.47]) box(x,2.64,1.53,.065,.75,.065,"timber");
  box(.6,3.03,1.53,1.87,.08,.08,"timber");
  box(.09,2.99,.56,.6,1.35,.15,"door");
  box(.09,3.29,.65,.4,.42,.035,"glass");
  sphere(.29,2.84,.67,.04,"brass");
  beam([-1.07,2.47,.52],[-.48,3.94,.52],.1);
  // Dominant steep gable and a small offset dormer in the right roof plane.
  roof(-1.18,-1.2,6.33,3.92,3.67,2.34);
  beam([-1.18,6.4,.69],[-1.18,8.58,.69],.12);
  box(-1.18,6.45,.69,3.7,.12,.13,"timber");
  beam([-2.38,6.47,.69],[-1.23,7.72,.69],.1);
  beam([.02,6.47,.69],[-1.13,7.72,.69],.1);
  window(-1.18,7.09,.71,.57,.8);
  // Small dormer breaking the long right roof plane. The gable looks east.
  {
    const start = new Map([...batches].map(([k,v])=>[k,v.length]));
    box(0,0,0,.86,.75,.82,"plaster");
    window(0,.02,.45,.5,.57);
    roof(0,0,.4,1.04,1.05,.64);
    for(const [key,gs] of batches) for(let i=start.get(key)??0;i<gs.length;i++) {
      gs[i].rotateY(Math.PI/2); gs[i].translate(.04,7.52,-1.65);
    }
  }
  // Copper-roofed oriel, readable from the principal three-quarter view.
  box(.56,5.35,-.65,.46,1.33,.96,"plaster");
  window(.83,5.35,-.65,.65,.9,true);
  box(.56,6.08,-.65,.72,.12,1.14,"timber");
  cylinder(.56,6.35,-.65,0,.68,.56,"roofDark",4);
  // Tall terracotta flue and modest brass weather vane.
  box(-2.05,7.95,-2.24,.5,2.22,.51,"brick");
  for(let y=7.0;y<9.05;y+=.23) box(-2.05,y,-2.24,.515,.035,.525,"stoneDark");
  box(-2.05,9.09,-2.24,.7,.13,.71,"stone");
  for(const x of [-2.21,-1.91]) cylinder(x,9.32,-2.24,.105,.13,.4,"brick");
  beam([-1.18,8.78,-.2],[-1.18,9.23,-.2],.04,"brass");
  beam([-1.54,9.08,-.2],[-.82,9.08,-.2],.045,"brass");
  sphere(-1.18,9.27,-.2,.09,"brass");
  // Ministry standard: patinated green with a small gold rune, no text texture.
  beam([.62,4.07,.72],[1.58,4.07,.72],.055,"iron");
  box(1.2,3.64,.73,.57,.76,.055,"door");
  for(const [a,b] of [[[.99,3.39,.775],[.99,3.84,.775]],[[.99,3.84,.775],[1.2,3.6,.775]],[[1.2,3.6,.775],[1.41,3.84,.775]],[[1.41,3.84,.775],[1.41,3.39,.775]]]) beam(a,b,.035,"brass");
  // Garden astrolabe: one magic focal point instead of many floating effects.
  cylinder(2.93,.22,1.12,.62,.7,.22,"stone",8);
  cylinder(2.93,.63,1.12,.19,.29,.66,"stoneDark",8);
  cylinder(2.93,1.01,1.12,.35,.3,.12,"stone",8);
  ring(2.93,1.51,1.12,.48,.035,"brass",[.3,.5,.3]);
  ring(2.93,1.51,1.12,.42,.035,"brass",[Math.PI/2,.2,0]);
  sphere(2.93,1.51,1.12,.14,"water");
  beam([2.93,1.01,1.12],[2.93,2.11,1.12],.04,"brass");
  // Low clipped planting, lavender, a reading bench, and one sculptural tree.
  for(const [x,z,w,d] of [[-2.65,2.73,1.22,.62],[2.94,2.85,1.18,.7],[-3.27,-2.9,.52,.8]]) planter(x,z,w,d);
  for(const z of [-2.5,-1.95,-1.4,-.85,-.3]) {
    sphere(3.34,.47,z,.36,"leaf"); sphere(3.28,.68,z,.27,"leafLight");
  }
  beam([2.8,.18,-2.65],[2.75,1.88,-2.7],.14,"timberLight");
  beam([2.76,1.1,-2.68],[3.18,1.87,-2.65],.08,"timberLight");
  for(const [x,y,z,r,c] of [[2.72,2.05,-2.72,.69,"leaf"],[3.14,1.96,-2.64,.48,"leafLight"],[2.59,2.52,-2.66,.5,"leafLight"],[2.36,1.94,-2.59,.45,"leafDark"]]) sphere(x,y,z,r,c);
  for(const x of [-3.18,-2.24]) { box(x,.34,1.43,.1,.45,.52,"iron"); box(x,.69,1.19,.08,.76,.08,"iron"); }
  for(const z of [1.26,1.44,1.62]) box(-2.71,.6,z,1.2,.075,.12,"timberLight");
  for(const y of [.8,1]) box(-2.71,y,1.19,1.2,.12,.07,"timberLight");
  // Entry lantern, attached to facade and kept below the balcony.
  beam([.3,1.89,.38],[.3,1.89,.88],.055,"iron");
  box(.3,1.58,.84,.19,.34,.19,"glow");
  for(const y of [1.37,1.79]) box(.3,y,.84,.28,.07,.28,"iron");

  const materials = [];
  const opaque = [];
  for(const [key,geometries] of batches) {
    const geometry = mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    const color = new THREE.Color(colors[key]);
    const values = new Float32Array(geometry.getAttribute("position").count*3);
    for(let i=0;i<values.length;i+=3) color.toArray(values,i);
    geometry.setAttribute("color",new THREE.BufferAttribute(values,3));
    if(key!=="glow") { opaque.push(geometry); continue; }
    const material = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,flatShading:true,emissive:colors[key],emissiveIntensity:.12+nightLighting*.85});
    const mesh = new THREE.Mesh(geometry,material); mesh.name="Ministry-warm-windows";
    mesh.castShadow=true; mesh.receiveShadow=true; root.add(mesh); materials.push(material);
  }
  const geometry = mergeGeometries(opaque,false); opaque.forEach(g=>g.dispose());
  const body = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.92,flatShading:true}));
  body.name="Ministry-architecture-and-garden"; body.castShadow=true; body.receiveShadow=true; root.add(body);
  const scale = cellWorldSize/4; root.scale.setScalar(scale);
  root.userData = { assetId:MINISTRY_ASSET_ID, representation:"special-landmark-prefab", sphereProjectionRoot:true, footprint:"2x2", entrance:"north", authoredParcelSize:8,
    updateDaylight(style) {
      const factor = Number(style?.nightFactor ?? nightLighting);
      for(const material of materials) if(material.emissive.getHex()) material.emissiveIntensity=.12+factor*.85;
    }
  };
  return root;
}
