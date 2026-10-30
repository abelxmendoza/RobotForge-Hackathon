/* Envelope-only spatial tools. These do not certify detailed CAD fit. */
import type { ComponentInstance, Pose } from './assembly';
import { componentById } from './components';
export function snapPlacement(position: Pose, gridM: number, deckTopM: number|null, heightM: number): Pose {
  if (![...position,gridM,heightM].every(Number.isFinite) || gridM<=0 || heightM<=0 || (deckTopM!==null&&!Number.isFinite(deckTopM))) throw new Error('Invalid placement inputs.');
  return [Math.round(position[0]/gridM)*gridM,Math.round(position[1]/gridM)*gridM,deckTopM===null?position[2]:deckTopM+heightM/2];
}
export function envelopesOverlap(a: ComponentInstance,b: ComponentInstance): boolean {
  const x=componentById(a.componentId),y=componentById(b.componentId);
  if(!x||!y) return false;
  if(Math.abs(a.positionM[2]-b.positionM[2]) >= (x.sizeM[2]+y.sizeM[2])/2-1e-8) return false;
  const angleA=a.yawDeg*Math.PI/180,angleB=b.yawDeg*Math.PI/180;
  const axesA=[[Math.cos(angleA),Math.sin(angleA)],[-Math.sin(angleA),Math.cos(angleA)]];
  const axesB=[[Math.cos(angleB),Math.sin(angleB)],[-Math.sin(angleB),Math.cos(angleB)]];
  const dot=(p:number[],q:number[])=>p[0]*q[0]+p[1]*q[1];
  const delta=[b.positionM[0]-a.positionM[0],b.positionM[1]-a.positionM[1]];
  for(const axis of [...axesA,...axesB]) {
    const ra=x.sizeM[0]/2*Math.abs(dot(axesA[0],axis))+x.sizeM[1]/2*Math.abs(dot(axesA[1],axis));
    const rb=y.sizeM[0]/2*Math.abs(dot(axesB[0],axis))+y.sizeM[1]/2*Math.abs(dot(axesB[1],axis));
    if(Math.abs(dot(delta,axis))>=ra+rb-1e-8) return false;
  }
  return true;
}
export function overlapPairs(instances: ComponentInstance[]): [string,string][] {
  const pairs: [string,string][]=[];
  instances.forEach((a,i)=>instances.slice(i+1).forEach(b=>{if(envelopesOverlap(a,b))pairs.push([a.id,b.id]);}));
  return pairs;
}
export function shortestYaw(from:number,to:number,t:number):number {
  return from+((((to-from)%360+540)%360)-180)*Math.max(0,Math.min(1,t));
}
