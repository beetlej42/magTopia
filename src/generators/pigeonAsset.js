import * as THREE from 'three';
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
const lerp=(a,b,t)=>a+(b-a)*t;

function box(g,c,x,y,z,w,h,d){

 const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:c}));m.position.set(x,y,z);g.add(m);return m;
}
export function createPigeonAsset(i){
 const root=new THREE.Group(),body=new THREE.Group();root.add(body);root.scale.setScalar(.40/1.02);
 const color=['#7f8a99','#b3bac2','#596979','#d4d1c6','#7f8a99'][i];
 box(body,color,0,.38,0,.42,.40,.60);
 const neck=new THREE.Group();neck.position.set(0,.53,.13);body.add(neck);
 box(neck,'#526775',0,.10,.08,.25,.30,.24);
 box(neck,i===3?'#acaea7':'#56616f',0,.25,.09,.30,.28,.28);
 box(neck,'#c1b698',0,.21,.28,.13,.09,.16);
 const wings=[],feet=[],legs=[];
 for(const side of [-1,1]){
  box(neck,'#22272d',side*.154,.29,.145,.018,.045,.04);
  const wing=new THREE.Group();wing.position.set(side*.2,.48,-.05);body.add(wing);
  box(wing,color,side*.32,0,-.06,.66,.11,.44);
  box(wing,'#434e5c',side*.37,.058,-.13,.56,.015,.065);
  box(wing,'#434e5c',side*.37,.058,-.27,.56,.015,.05);
  wings.push(wing);
  feet.push(box(root,'#a37b72',side*.11,.025,.09,.07,.045,.16));
  legs.push(box(root,'#a37b72',side*.11,.12,.03,.045,.20,.045));
 }
 const tail=box(body,'#4d5866',0,.31,-.38,.26,.09,.31);tail.rotation.x=-.18;
 return {root,body,neck,wings,feet,legs};
}
export function posePigeon(b,t,i,{spread=0,walk=0,peck=0,crouch=0,land=0}={}){
 b.body.position.y=-.10*crouch+(walk?Math.abs(Math.sin(walk*Math.PI*2))*.035:0);
 b.body.rotation.x=land*-.2;
 b.neck.rotation.x=peck*1.05;
 b.neck.position.z=.13+(walk?Math.sin(walk*Math.PI*2)*.045:0);
 b.wings.forEach((w,j)=>{const side=j?1:-1;
  w.scale.x=lerp(.22,1,spread);
  w.rotation.z=side*lerp(-.35,Math.sin(t*22+i*.8)*.85,spread);
 });
 b.feet.forEach((f,j)=>{
  const cycle=(walk+(j?.5:0))%1;
  // During stance, foot moves backward relative to the advancing body.
  const z=walk?(cycle<.5?.048-.192*cycle:-.048+.096*ease((cycle-.5)*2)):.04;
  const lift=walk&&cycle>.5?.10*Math.sin((cycle-.5)*Math.PI*2):0;
  f.position.y=.025+lift+spread*(1-land)*.07;f.position.z=z+.06;
  const leg=b.legs[j];leg.position.y=(.22+f.position.y)/2;leg.position.z=z/2;
  leg.rotation.x=Math.atan2(-z,.22-f.position.y);
  leg.scale.y=Math.hypot(z,.22-f.position.y)/.20;
 });
}
