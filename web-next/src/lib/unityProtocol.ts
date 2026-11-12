/** Versioned data only. React remains the authority for saved robot records. */
export const UNITY_PROTOCOL=1;
export const UNITY_ASYNC_EVENT='rf-unity-request';
export const OPERATIONS=['loadSnapshot','selectLink','setVisibility','setExplode','setJointPose','nextLink','resetView','pauseScene','explainLink'] as const;
export type UnityOperation=typeof OPERATIONS[number];
export interface SceneIdentity {protocolVersion:1;sessionId:string;robotId:string;versionId:string;draftRevision:string}
export interface SceneSnapshot extends SceneIdentity {assetId:'unitree-g1-23'|'rover-proxy';selectedLink:string;hiddenLinks:string[];explode:number;joints:Record<string,number>;evidence:string;rover?:{length:number;width:number;height:number;mass:number;wheelDiameter:number}}
export interface SceneCommand extends SceneIdentity {requestId:string;operation:UnityOperation;payload:Record<string,unknown>}
export interface SceneResult extends SceneIdentity {type:'result';requestId:string;status:'applied'|'rejected'|'failed';message:string;state?:SceneSnapshot}
export interface UnityReady {type:'ready';protocolVersion:number;buildId:string;operations:string[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200;
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const link=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_:-]{1,128}$/.test(v);
export function validateIdentity(v:unknown):v is SceneIdentity {return object(v)&&v.protocolVersion===1&&['sessionId','robotId','versionId','draftRevision'].every(k=>id(v[k]));}
export function sameIdentity(a:SceneIdentity,b:SceneIdentity):boolean{return ['protocolVersion','sessionId','robotId','versionId','draftRevision'].every(k=>a[k as keyof SceneIdentity]===b[k as keyof SceneIdentity]);}
export function validateSnapshot(v:unknown):v is SceneSnapshot {
 if(!validateIdentity(v)||!object(v))return false;
 const rover=v.rover;
 return ['unitree-g1-23','rover-proxy'].includes(String(v.assetId))&&typeof v.selectedLink==='string'&&(v.selectedLink===''||link(v.selectedLink))&&Array.isArray(v.hiddenLinks)&&v.hiddenLinks.length<=256&&v.hiddenLinks.every(link)&&number(v.explode)&&v.explode>=0&&v.explode<=1&&object(v.joints)&&Object.keys(v.joints).length<=128&&Object.entries(v.joints).every(([k,n])=>link(k)&&number(n))&&typeof v.evidence==='string'&&v.evidence.length<=500&&
 (v.assetId!=='rover-proxy'||(object(rover)&&['length','width','height','mass','wheelDiameter'].every(k=>number(rover[k])&&Number(rover[k])>0&&Number(rover[k])<=200)));
}
export function validateOperation(operation:unknown,payload:unknown):operation is UnityOperation {
 if(!OPERATIONS.includes(operation as UnityOperation)||!object(payload))return false;
 switch(operation){
 case 'loadSnapshot':return validateSnapshot(payload);
 case 'selectLink':return link(payload.link);
 case 'setVisibility':return link(payload.link)&&typeof payload.visible==='boolean';
 case 'setJointPose':return link(payload.joint)&&number(payload.radians);
 case 'setExplode':return number(payload.amount)&&payload.amount>=0&&payload.amount<=1;
 case 'pauseScene':return typeof payload.paused==='boolean';
 default:return Object.keys(payload).length===0;
 }
}
export function validateResult(v:unknown):v is SceneResult {return validateIdentity(v)&&object(v)&&v.type==='result'&&id(v.requestId)&&['applied','rejected','failed'].includes(String(v.status))&&typeof v.message==='string'&&v.message.length<=4000&&(v.state==null||validateSnapshot(v.state));}
