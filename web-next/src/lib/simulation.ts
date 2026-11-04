import type {Spec} from './garage';
export const SIM_RUNS_KEY='rf.simruns.v1';
export const SIM_COMMAND_EVENT='rf-simulation-command';
export type Scenario='flat'|'ramp'|'obstacle';
export const SCENARIOS:{id:Scenario;label:string}[]=[{id:'flat',label:'Flat ground'},{id:'ramp',label:'Ramp · 10°'},{id:'obstacle',label:'Obstacle · 30 mm'}];
export type SimPose={t:number;x:number;y:number;z:number;qx:number;qy:number;qz:number;qw:number};
export type SavedSimRun={id:string;robotId:string;versionId:string;fingerprint:string;spec:Spec;scenario:Scenario;engine:'Browser · Rapier'|'Gazebo';createdAt:string;seconds:number;distanceM:number;poses:SimPose[];note:string;gazeboVersion?:string};
export function simulationIssues(spec:Spec,engine:'browser'|'gazebo'='browser'):string[]{
 const missing:string[]=[];
 if(!['differential','skid_steer'].includes(spec?.drivetrain))missing.push('a differential or skid-steer drivetrain');
 for(const [key,min,max] of [['length_m',.03,3],['width_m',.03,3],['height_m',.02,3],['mass_kg',.05,200],['ground_clearance_m',.001,.5]] as const){const n=spec?.[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)missing.push(key);}
 for(const [key,min,max] of [['diameter_m',.01,1],['width_m',.005,.5]] as const){const n=spec?.wheel?.[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)missing.push('wheel.'+key);}
 if(![2,4].includes(spec?.wheel?.count))missing.push('wheel.count (2 or 4)');
 if(engine==='browser'&&(!Number.isInteger(spec?.motor?.count)||spec.motor.count<1||spec.motor.count>spec.wheel?.count))missing.push('motor.count');
 if(engine==='browser'&&(!(spec?.motor?.stall_torque_nm>0)||!Number.isFinite(spec?.motor?.stall_torque_nm)||spec.motor.stall_torque_nm>1000))missing.push('motor.stall_torque_nm');
 if(spec?.ground_clearance_m>=spec?.height_m||spec?.wheel?.diameter_m>spec?.length_m||spec?.wheel?.width_m>spec?.width_m)missing.push('consistent wheel/body dimensions');
 return missing;
}
export function driveInput(keys:Set<string>):{throttle:number;turn:number}{return {throttle:Number(keys.has('ArrowUp')||keys.has('w'))-Number(keys.has('ArrowDown')||keys.has('s')),turn:Number(keys.has('ArrowLeft')||keys.has('a'))-Number(keys.has('ArrowRight')||keys.has('d'))};}
export function runFingerprint(robotId:string,versionId:string,spec:Spec):string{return JSON.stringify([robotId,versionId,spec]);}
export function parseSimCommand(text:string):{action:'run'|'pause'|'reset'|'scenario'|'connect';scenario?:Scenario}|null{
 const t=text.trim().replace(/[.!]$/,'').toLowerCase();if(t.includes('?')||/\b(don't|do not)\b/.test(t))return null;
 if(/^(?:run|start|resume) (?:the )?(?:simulation|simulator)$/.test(t))return {action:'run'};
 if(/^(?:pause|stop) (?:the )?(?:simulation|simulator)$/.test(t))return {action:'pause'};
 if(/^reset (?:the )?(?:simulation|simulator)$/.test(t))return {action:'reset'};
 if(/^(?:connect|check) (?:local )?gazebo$/.test(t))return {action:'connect'};
 for(const id of ['flat','ramp','obstacle'] as Scenario[])if(new RegExp(`^(?:try|use|test|simulate)(?: on)? (?:the |a )?${id}(?: ground)?$`).test(t))return {action:'scenario',scenario:id};
 return null;
}
export type GazeboJob={id:string;status:'running'|'complete'|'failed'|'cancelled';robotId:string;versionId:string;error?:string;version?:string;model?:string;result?:{trajectory:{poses:number[][]};drive:{truth_m:number};turn:{truth_deg:number}}};
export function validGazeboRun(job:GazeboJob,robotId:string,versionId:string):boolean{return job?.status==='complete'&&job.robotId===robotId&&job.versionId===versionId&&Array.isArray(job.result?.trajectory?.poses)&&job.result!.trajectory.poses.length>1&&job.result!.trajectory.poses.every(p=>Array.isArray(p)&&p.length===3&&p.every(v=>typeof v==='number'&&Number.isFinite(v)))&&Number.isFinite(job.result?.drive?.truth_m)&&Number.isFinite(job.result?.turn?.truth_deg);}
