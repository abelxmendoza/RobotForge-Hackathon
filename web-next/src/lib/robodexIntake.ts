import type {GarageRobot,Spec} from './garage';
export interface RobodexReference {name:string;slug:string;specFile:string}
/** Select existing active projects; never overwrite their drafts or versions. */
export function stageRobodexRobot(records:GarageRobot[],reference:RobodexReference,spec:Spec,robotId:string,versionId:string,at:string):{records:GarageRobot[];robotId:string;added:boolean}{
 const existing=records.find(r=>!r.archivedAt&&r.name.toLowerCase()===reference.name.toLowerCase()&&r.versions.length);
 if(existing)return {records,robotId:existing.id,added:false};
 if(!spec||typeof spec!=='object'||Array.isArray(spec))throw new Error('No usable recorded robot spec.');
 const entry:GarageRobot={id:robotId,name:reference.name,createdAt:at,versions:[{id:versionId,label:'Robodex reference',source:'robodex',createdAt:at,note:`Reference from Robodex: ${reference.slug} (${reference.specFile}). Recorded specifications; not a measurement of an owned robot.`,spec:JSON.parse(JSON.stringify(spec)),planned:true}]};
 return {records:[...records,entry],robotId,added:true};
}
