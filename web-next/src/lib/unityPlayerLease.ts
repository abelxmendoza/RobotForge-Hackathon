export interface UnityInstance {SendMessage:(object:string,method:string,payload:string)=>void;Quit:()=>Promise<void>}
let tail:Promise<void>=Promise.resolve();
/** Serialize teardown, including a createUnityInstance that resolves late. */
export function leaseUnityPlayer(create:()=>Promise<UnityInstance>){
 const previous=tail;let released:()=>void=()=>{};const release=new Promise<void>(resolve=>{released=resolve;});tail=previous.then(()=>release);
 let closed=false;let closing:Promise<void>|null=null;
 const ready=previous.then(()=>{if(closed)throw new Error('Unity launch cancelled');return create();});
 ready.catch(()=>released());
 const close=()=>{
  if(closing)return closing;closed=true;
  closing=(async()=>{try{const instance=await ready;await instance.Quit();}catch{/* failed startup has no player */}finally{released();}})();return closing;
 };
 return {ready,close};
}
