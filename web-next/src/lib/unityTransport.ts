import {OPERATIONS,sameIdentity,validateOperation,validateResult,type SceneIdentity,type SceneCommand,type SceneResult,type UnityReady,type UnityOperation} from './unityProtocol';
/** One transport per player/robot revision. No automatic retries after uncertainty. */
export class UnityTransport {
 private pending=new Map<string,{resolve:(v:SceneResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 private capabilities=new Set<string>();private closed=false;private sequence=0;private initialized=false;
 private identity:SceneIdentity;private emit:(command:SceneCommand)=>void;private timeoutMs:number;
 constructor(identity:SceneIdentity,emit:(command:SceneCommand)=>void,timeoutMs=5000){this.identity=identity;this.emit=emit;this.timeoutMs=timeoutMs;}
 ready(message:UnityReady,buildId:string):void{
  if(this.closed||message.type!=='ready'||message.protocolVersion!==1||message.buildId!==buildId||!Array.isArray(message.operations)||message.operations.some(x=>!OPERATIONS.includes(x as UnityOperation)))throw new Error('Unity protocol/build mismatch');
  this.capabilities=new Set(message.operations);this.initialized=true;
 }
 send(operation:UnityOperation,payload:Record<string,unknown>):Promise<SceneResult>{
  if(this.closed)return Promise.reject(new Error('Unity session closed'));
  if(!this.initialized)return Promise.reject(new Error('Unity is not ready'));
  if(!validateOperation(operation,payload)||!this.capabilities.has(operation))return Promise.reject(new Error('Unsupported Unity operation or payload'));
  if(this.pending.size>=32)return Promise.reject(new Error('Unity command queue full'));
  const requestId=`${this.identity.sessionId}:${++this.sequence}`;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Unity command timed out; refresh state before retrying'));},this.timeoutMs);
   this.pending.set(requestId,{resolve,reject,timer});
   try{this.emit({...this.identity,requestId,operation,payload});}catch(e){clearTimeout(timer);this.pending.delete(requestId);reject(e instanceof Error?e:new Error('Unity send failed'));}
  });
 }
 receive(value:unknown):void{
  if(this.closed||!validateResult(value)||!sameIdentity(value,this.identity))return;
  const job=this.pending.get(value.requestId);if(!job)return;
  if(value.state&&!sameIdentity(value.state,this.identity))return;
  clearTimeout(job.timer);this.pending.delete(value.requestId);job.resolve(value);
 }
 dispose():void{this.closed=true;for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(new Error('Unity session closed'));}this.pending.clear();}
}
