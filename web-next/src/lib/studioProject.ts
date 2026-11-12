import {requireRobotVersion} from './versionGuard';
import type {GarageRobot,RobotVersion,Spec} from './garage';
/** Append against the current record, retaining project and evidence metadata. */
export function saveStudioVersion(records:GarageRobot[],robotId:string,baseline:string,spec:Spec,id:string,at:string):GarageRobot[]{
 const robot=requireRobotVersion(records,robotId,baseline);
 const previous=robot.versions.at(-1)!;
 const version:RobotVersion={...previous,id,createdAt:at,label:`Version ${robot.versions.length+1}`,source:'edit',note:'Edited in Workshop.',spec:JSON.parse(JSON.stringify(spec))};
 return records.map(r=>r.id===robotId?{...r,versions:[...r.versions,version]}:r);
}
export function studioRoute(hash:string):{mode:'build'|'wiring'|'checks';panel:string;legacy:boolean}{
 const value=hash.replace(/^#(?:tab=)?/,'');
 if(value==='rover-design')return {mode:'build',panel:'design',legacy:false};
 if(value==='wiring')return {mode:'wiring',panel:'parts',legacy:false};
 if(['checks','simulate'].includes(value))return {mode:'checks',panel:'parts',legacy:false};
 if(value==='history')return {mode:'build',panel:'versions',legacy:false};
 if(value==='specs')return {mode:'build',panel:'specs',legacy:false};
 return {mode:'build',panel:'parts',legacy:!!value&&!['overview','build','wrench'].includes(value)};
}
export function partLabel(id:string):string{return id.replace(/_(link|joint)$/,'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
