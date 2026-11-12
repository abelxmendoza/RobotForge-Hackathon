/** Manufacturer-model inspection commands; no hardware or gait control. */
export const HUMANOID_EVENT='rf-humanoid-command';
export type HumanoidCommand={kind:'explode'|'reset'|'next'|'explain'}|{kind:'select';link:string}|{kind:'pose';joint:string;degrees:number};
export interface HumanoidResult {command:HumanoidCommand;handled:boolean;message:string}
export function clampJoint(value:number,lower:number,upper:number):number {
 if(![value,lower,upper].every(Number.isFinite)||lower>upper)throw new Error('Invalid joint limits');
 return Math.max(lower,Math.min(upper,value));
}
export function parseHumanoidCommand(text:string):HumanoidCommand|null {
 const t=text.trim().toLowerCase().replace(/[.!]+$/,'');
 if(t.includes('?')||/\b(don't|do not)\b/.test(t))return null;
 const simple:Record<string,HumanoidCommand['kind']>={'explode humanoid':'explode','reset humanoid':'reset','next humanoid part':'next','explain humanoid part':'explain'};
 if(simple[t])return {kind:simple[t]} as HumanoidCommand;
 const pose=t.match(/^pose ([a-z0-9_]+) to (-?\d+(?:\.\d+)?) degrees$/);
 if(pose)return {kind:'pose',joint:pose[1],degrees:Number(pose[2])};
 const select=t.match(/^select humanoid ([a-z0-9_]+)$/);return select?{kind:'select',link:select[1]}:null;
}
export function requestHumanoid(command:HumanoidCommand):HumanoidResult {
 const result:HumanoidResult={command,handled:false,message:''};
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(HUMANOID_EVENT,{detail:result}));return result;
}
export const G1_SPEC={name:'Unitree G1 · 23-DoF reference',drivetrain:'humanoid',referenceModel:'unitree-g1-23',description:'Official Unitree G1 URDF reference for joint and link exploration. Not owned hardware; no walking controller or physical validation.'};
