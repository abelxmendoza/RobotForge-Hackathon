export interface UnityBuild {protocolVersion:1;buildId:string;loader:string;data:string;framework:string;wasm:string;compression:'disabled'|'brotli';files:Record<string,{sha256:string;bytes:number}>}
export function validateUnityBuild(value:unknown):value is UnityBuild {
 if(!value||typeof value!=='object')return false;const v=value as UnityBuild;
 if(v.protocolVersion!==1||!/^[-a-zA-Z0-9]{1,80}$/.test(v.buildId)||!['disabled','brotli'].includes(v.compression)||!v.files||typeof v.files!=='object')return false;
 return ['loader','data','framework','wasm'].every(key=>{
  const path=v[key as 'loader'];const f=v.files[path];
  return typeof path==='string'&&path.startsWith(`/unity/${v.buildId}/`)&&!path.includes('..')&&/^\/unity\/[a-zA-Z0-9_./-]+$/.test(path)&&!!f&&/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isInteger(f.bytes)&&f.bytes>0&&f.bytes<100_000_000;
 });
}
