import * as THREE from "three";

export const OWL_FLIGHT_CYCLE = 37;
export const OWL_FLIGHT_REST = 20;
const smooth = x => { const t = THREE.MathUtils.clamp(x,0,1); return t*t*(3-2*t); };

// Local tower coordinates: fly out beyond the eaves before climbing. The high
// circuit stays above the roof; descent returns down the clear front approach.
export function attachOwlTowerAnimation(tower, courier, keeper) {
  const perch=courier.position.clone();
  const route=new THREE.CatmullRomCurve3([
    perch.clone(),new THREE.Vector3(-.375,5.4,2.7),
    new THREE.Vector3(2.8,7.8,3),new THREE.Vector3(3.1,10.1,.4),
    new THREE.Vector3(.4,10.7,-3.2),new THREE.Vector3(-3.1,10.3,-.5),
    new THREE.Vector3(-2.7,8.6,3),new THREE.Vector3(-.375,6.2,3),
    new THREE.Vector3(-.375,5.4,2.7),perch.clone()
  ],false,"centripetal");
  const left=courier.getObjectByName("left-wing"),right=courier.getObjectByName("right-wing");
  const courierHead=courier.getObjectByName("head"),keeperHead=keeper.getObjectByName("head");
  const tangent=new THREE.Vector3(),next=new THREE.Vector3(),prev=new THREE.Vector3();
  const euler=new THREE.Euler(0,0,0,"YXZ");
  const worldPosition=new THREE.Vector3(),cameraPosition=new THREE.Vector3(),worldScale=new THREE.Vector3();
  let enabled=true;
  tower.userData.updateAnimationView = camera => {
    tower.getWorldPosition(worldPosition);camera.getWorldPosition(cameraPosition);tower.getWorldScale(worldScale);
    enabled=worldPosition.distanceTo(cameraPosition)<90*Math.max(worldScale.x,worldScale.y,worldScale.z);
    courier.visible=keeper.visible=enabled;
  };
  tower.userData.update = elapsed => {
    if(!enabled||!Number.isFinite(elapsed)) return;
    const time=((elapsed%OWL_FLIGHT_CYCLE)+OWL_FLIGHT_CYCLE)%OWL_FLIGHT_CYCLE;
    // Long quiet pauses between small, smooth head turns.
    keeperHead.rotation.y=.5*Math.sin(elapsed*.65)*Math.pow(Math.max(0,Math.sin(elapsed*.27)),4);
    if(time<=OWL_FLIGHT_REST) {
      courier.position.copy(perch);courier.quaternion.identity();
      left.rotation.z=right.rotation.z=0;
      courierHead.rotation.y=.3*Math.sin(time*.8)*Math.pow(Math.max(0,Math.sin(time*.4)),4);
      courier.userData.flightState="perched";
      return;
    }
    // Land facing inward, step fully through the opening before turning, then
    // walk forward back to the exterior perch. Never reverse into the doorway.
    if(time>=32) {
      left.rotation.z=right.rotation.z=0;
      courierHead.rotation.y=0;
      courier.position.copy(perch);
      let progress=0;
      if(time<33.5) {
        progress=smooth((time-32)/1.5);
        courier.position.z=THREE.MathUtils.lerp(perch.z,0,progress);
        courier.rotation.set(0,Math.PI,0);
        courier.userData.flightState="walking-in";
      } else if(time<35) {
        courier.position.z=0;
        courier.rotation.set(0,Math.PI+Math.PI*smooth((time-33.5)/1.5),0);
        courier.userData.flightState="turning-inside";
      } else {
        progress=smooth((time-35)/2);
        courier.position.z=THREE.MathUtils.lerp(0,perch.z,progress);
        courier.rotation.set(0,0,0);
        courier.userData.flightState="walking-out";
      }
      if(time<33.5||time>=35)
        courier.position.y+=.035*Math.pow(Math.sin(progress*Math.PI*3),2);
      return;
    }
    const phase=(time-OWL_FLIGHT_REST)/12;
    const u=smooth(phase),envelope=smooth(phase/.12)*smooth((1-phase)/.12);
    route.getPoint(u,courier.position);
    const clearance = phase < .2 || phase > .8 ? smooth((courier.position.z-1.6)/.6) : 1;
    // Reuse vectors; do not allocate or rebuild voxel geometry in the hot path.
    route.getPoint(Math.max(0,u-.001),prev);route.getPoint(Math.min(1,u+.001),next);
    tangent.subVectors(next,prev).normalize();
    const yaw=Math.atan2(tangent.x,tangent.z);
    const bank=Math.sin(phase*Math.PI*2)*.16*envelope;
    euler.set(.45*envelope*clearance,yaw,bank*clearance,"YXZ");
    courier.quaternion.setFromEuler(euler);
    // A short glide in the high arc interrupts the otherwise regular wingbeats.
    const glide=smooth((phase-.35)/.05)*smooth((.64-phase)/.05);
    const beat=Math.sin((time-OWL_FLIGHT_REST)*Math.PI*2*2.6);
    const spread=envelope*clearance*(1.1+(.46*beat)*(1-glide));
    left.rotation.z=-spread;right.rotation.z=spread;
    courierHead.rotation.y=0;
    courier.userData.flightState=phase<.15?"takeoff":phase>.85?"landing":glide>.95?"gliding":"flying";
  };
  tower.userData.update(0);
}
