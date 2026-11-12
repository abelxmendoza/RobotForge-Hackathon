'use client';
import {partLabel} from '@/lib/studioProject';
import {useEffect,useRef,useState} from 'react';
import {UnityTransport} from '@/lib/unityTransport';
import {validateUnityBuild} from '@/lib/unityBuild';
import {leaseUnityPlayer,type UnityInstance} from '@/lib/unityPlayerLease';
import {UNITY_ASYNC_EVENT,validateResult,sameIdentity,type SceneSnapshot,type UnityOperation} from '@/lib/unityProtocol';
import {assetPath} from '@/components/home/asset';

export interface UnityRequest {operation:UnityOperation;payload:Record<string,unknown>;handled:boolean;complete:(message:string)=>void}
interface RuntimeWindow extends Window {createUnityInstance?:(canvas:HTMLCanvasElement,config:Record<string,unknown>,progress:(v:number)=>void)=>Promise<UnityInstance>;RobotForgeUnityReceive?:(json:string)=>void}
export default function UnityWorkshop({snapshot,onExit,onState,studio=false}:{snapshot:SceneSnapshot;onExit:()=>void;onState?:(state:SceneSnapshot)=>void;studio?:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),closeRef=useRef<()=>Promise<void>>(async()=>{}),transportRef=useRef<UnityTransport|null>(null);
 const [attempt,setAttempt]=useState(0);const [query,setQuery]=useState(''),[posePanel,setPosePanel]=useState(false);
 const [status,setStatus]=useState('Preparing Unity…'),[progress,setProgress]=useState(0),[ready,setReady]=useState(false),[leaving,setLeaving]=useState(false);
 const [viewState,setViewState]=useState(snapshot);
 const [inspection,setInspection]=useState<{links:{id:string;mass:number|null}[];joints:{id:string;lower:number;upper:number}[]}>({links:[],joints:[]});
 useEffect(()=>{setInspection({links:[],joints:[]});const abort=new AbortController();if(snapshot.assetId==='unitree-g1-23')fetch(assetPath('assets/models/unitree-g1/inspection.json'),{signal:abort.signal}).then(r=>r.json()).then(setInspection).catch(()=>{});return()=>abort.abort();},[snapshot.assetId]);
 const latestState=useRef(onState);latestState.current=onState;
 const send=async(operation:UnityOperation,payload:Record<string,unknown>)=>{
  try{const transport=transportRef.current;if(!transport)throw new Error('Unity is not ready');const result=await transport.send(operation,payload);setStatus(result.message);if(result.state){setViewState(result.state);latestState.current?.(result.state);}return result.message;}catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message);return message;}
 };
 useEffect(()=>{
  setReady(false);setProgress(0);setViewState(snapshot);setStatus('Preparing Unity…');
  let disposed=false;let rejectLoader:((error:Error)=>void)|undefined;let receiveHandler:((json:string)=>void)|undefined;let player:UnityInstance|null=null;let script:HTMLScriptElement|null=null;let loadTimer:ReturnType<typeof setTimeout>|undefined;let startupTimer:ReturnType<typeof setTimeout>|undefined;const abort=new AbortController();const target=window as RuntimeWindow;
  const launch=leaseUnityPlayer(async()=>{
   const response=await fetch(assetPath('unity/current.json'),{signal:abort.signal,cache:'no-cache'});
   if(!response.ok)throw new Error('Immersive Workshop is not available yet. Return to the current 3D view to keep working.');
   const build:unknown=await response.json();if(!validateUnityBuild(build))throw new Error('Unity build manifest is invalid');
   if(disposed)throw new Error('Unity launch cancelled');
   await new Promise<void>((resolve,reject)=>{
    rejectLoader=reject;
    script=document.createElement('script');script.src=assetPath(build.loader.replace(/^\//,''));script.onload=()=>{clearTimeout(loadTimer);resolve();};script.onerror=()=>{clearTimeout(loadTimer);reject(new Error('Unity loader could not download'));};loadTimer=setTimeout(()=>reject(new Error('Unity loader timed out')),30000);document.body.appendChild(script);
   });
   if(disposed||!canvas.current||!target.createUnityInstance)throw new Error('Unity launch cancelled or loader unavailable');
   let resolveReady:()=>void=()=>{};const readyMessage=new Promise<void>(resolve=>{resolveReady=resolve;});
   const transport=new UnityTransport(snapshot,c=>{
    const payload={...c.payload};if(c.operation==='loadSnapshot')payload.jointValues=Object.entries(snapshot.joints).map(([name,radians])=>({name,radians}));
    player?.SendMessage('WorkshopBridge','Receive',JSON.stringify({...c,payload}));
   });transportRef.current=transport;
   receiveHandler=(json:string)=>{
    if(disposed)return;
    try{
     const message=JSON.parse(json);
     if(message.type==='ready'){transport.ready(message,build.buildId);resolveReady();return;}
     if(message.state&&Array.isArray(message.state.jointValues))message.state.joints=Object.fromEntries(message.state.jointValues.map((j:{name:string;radians:number})=>[j.name,j.radians]));
     if(message.requestId==='selection'&&validateResult(message)&&sameIdentity(message,snapshot)&&message.state){setViewState(message.state);latestState.current?.(message.state);}else transport.receive(message);
    }catch{setStatus('Unity returned an invalid response');}
   };
   target.RobotForgeUnityReceive=receiveHandler;
   const instance=await target.createUnityInstance(canvas.current,{dataUrl:assetPath(build.data.slice(1)),frameworkUrl:assetPath(build.framework.slice(1)),codeUrl:assetPath(build.wasm.slice(1)),companyName:'RobotForge',productName:'RobotForge Workshop',productVersion:build.buildId},value=>{if(!disposed)setProgress(value);});
   player=instance;
   // Ready arrives from Unity Start; wait before sending the initial snapshot.
   void (async()=>{
    try{
     await Promise.race([readyMessage,new Promise<never>((_,reject)=>{startupTimer=setTimeout(()=>reject(new Error('Unity readiness timed out')),30000);})]);
     clearTimeout(startupTimer);if(disposed)return;const result=await transport.send('loadSnapshot',snapshot as unknown as Record<string,unknown>);
     if(result.status!=='applied')throw new Error(result.message);if(!disposed){if(result.state){setViewState(result.state);latestState.current?.(result.state);}setReady(true);setStatus('Unity workshop ready');}
    }catch(error){if(!disposed)setStatus(error instanceof Error?error.message:String(error));}
   })();
   return instance;
  });
  closeRef.current=async()=>{disposed=true;abort.abort();rejectLoader?.(new Error('Unity launch cancelled'));script?.remove();clearTimeout(loadTimer);clearTimeout(startupTimer);transportRef.current?.dispose();transportRef.current=null;await launch.close();if(target.RobotForgeUnityReceive===receiveHandler)delete target.RobotForgeUnityReceive;script?.remove();};
  launch.ready.catch(error=>{if(!disposed)setStatus(error instanceof Error?error.message:String(error));});
  const request=(event:Event)=>{const detail=(event as CustomEvent<UnityRequest>).detail;if(detail.handled)return;detail.handled=true;void send(detail.operation,detail.payload).then(detail.complete);};
  const visibility=()=>{if(transportRef.current)void send('pauseScene',{paused:document.hidden});};
  window.addEventListener(UNITY_ASYNC_EVENT,request);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener(UNITY_ASYNC_EVENT,request);document.removeEventListener('visibilitychange',visibility);void closeRef.current();};
 },[snapshot.sessionId,snapshot.robotId,snapshot.versionId,snapshot.draftRevision,attempt]); // identity owns a fresh runtime
 const exit=async()=>{setLeaving(true);await closeRef.current();onExit();};
 if(studio)return <section className="studio-scene-grid" aria-label="Unity workshop"><div className="studio-canvas"><div className="studio-scene-tools"><button disabled={!ready} onClick={()=>void send('resetView',{})}>Fit view</button><button disabled={!ready} aria-pressed={viewState.explode>0} onClick={()=>void send('setExplode',{amount:viewState.explode?0:1})}>Separate parts</button><button disabled={leaving} onClick={()=>void exit()}>{leaving?'Closing…':'Standard view'}</button></div><canvas id={`unity-${snapshot.sessionId}`} ref={canvas} style={{width:'100%',height:'100%',visibility:ready?'visible':'hidden'}} tabIndex={0} aria-label="Unity robot scene"/>{!ready&&<div className="studio-load"><p role="status">{status}</p><progress aria-label="Unity download progress" max={1} value={progress}/><button disabled={leaving} onClick={()=>setAttempt(n=>n+1)}>Retry</button></div>}</div>
 <aside className="studio-inspector" aria-label="Unity inspector"><div className="studio-panel-head"><h2>{posePanel?'Joint pose':'Parts'}</h2><button onClick={()=>setPosePanel(v=>!v)}>{posePanel?'Parts':'Pose'}</button></div><input className="studio-search" aria-label="Find a Unity part" placeholder="Find a part…" value={query} onChange={e=>setQuery(e.target.value)}/>
 {posePanel?<div className="studio-joints">{inspection.joints.filter(j=>partLabel(j.id).toLowerCase().includes(query.toLowerCase())).map(j=><label className="studio-field" key={j.id}><span>{partLabel(j.id)}</span><input type="number" min={j.lower} max={j.upper} step=".05" disabled={!ready} value={viewState.joints[j.id]??0} aria-label={partLabel(j.id)+' radians'} onChange={e=>{const radians=Number(e.target.value);if(Number.isFinite(radians))void send('setJointPose',{joint:j.id,radians:Math.max(j.lower,Math.min(j.upper,radians))});}}/></label>)}</div>:<div className="studio-parts">{inspection.links.filter(j=>partLabel(j.id).toLowerCase().includes(query.toLowerCase())).map(j=><button disabled={!ready} key={j.id} aria-pressed={viewState.selectedLink===j.id} onClick={()=>void send('selectLink',{link:j.id})}>{partLabel(j.id)}</button>)}</div>}
 {viewState.selectedLink&&<div className="studio-part-card"><span className="studio-bay">SELECTED PART</span><h3>{partLabel(viewState.selectedLink)}</h3><button disabled={!ready} onClick={()=>void send('setVisibility',{link:viewState.selectedLink,visible:viewState.hiddenLinks.includes(viewState.selectedLink)})}>{viewState.hiddenLinks.includes(viewState.selectedLink)?'Show part':'Hide part'}</button><button disabled={!ready} onClick={()=>void send('nextLink',{})}>Next part</button></div>}<p className="studio-muted">Visual reference · no physical validation</p>{ready&&!status.startsWith('Unity applied')&&status!=='Unity workshop ready'&&<p role="status">{status}</p>}</aside></section>;
 return <section className="ws-guided" aria-label="Unity workshop"><h3>Immersive workshop · Unity</h3><p role="status">{status}</p>{!ready&&<progress aria-label="Unity download progress" max={1} value={progress}/>}
 <canvas id={`unity-${snapshot.sessionId}`} ref={canvas} style={{width:'100%',height:420,visibility:ready?'visible':'hidden'}} tabIndex={0} aria-label="Unity robot scene"/>
 <div className="ta-controls">{!ready&&<button className="btn btn-sm" disabled={leaving} onClick={()=>setAttempt(n=>n+1)}>Retry Unity</button>}<button className="btn btn-sm" disabled={!ready} onClick={()=>void send('nextLink',{})}>Next link</button><button className="btn btn-sm" disabled={!ready} onClick={()=>void send('resetView',{})}>Reset scene</button><button className="btn btn-sm" disabled={leaving} onClick={()=>void exit()}>{leaving?'Closing Unity…':'Return to current 3D view'}</button></div>
 <label className="g-field">Selected link<select aria-label="Unity selected link" disabled={!ready} value={viewState.selectedLink} onChange={e=>void send('selectLink',{link:e.target.value})}><option value="">Choose a link</option>{(inspection.links.length?inspection.links:[{id:'chassis',mass:null}]).map(link=><option key={link.id}>{link.id}</option>)}</select></label>
 {viewState.selectedLink&&<div><button className="btn btn-sm" disabled={!ready} onClick={()=>void send('setVisibility',{link:viewState.selectedLink,visible:viewState.hiddenLinks.includes(viewState.selectedLink)})}>{viewState.hiddenLinks.includes(viewState.selectedLink)?'Show':'Hide'} selected link</button><p className="faint g-small">{viewState.selectedLink} · declared URDF mass: {inspection.links.find(link=>link.id===viewState.selectedLink)?.mass ?? 'not recorded'} kg</p></div>}
 <label className="g-field">Exploded view<input type="range" aria-label="Unity exploded view" disabled={!ready} min="0" max="1" step=".05" value={viewState.explode} onChange={e=>void send('setExplode',{amount:Number(e.target.value)})}/></label>
 {inspection.joints.length>0&&<details className="ws-disclosure"><summary>Joint controls · visual pose</summary>{inspection.joints.map(j=><label className="g-field" key={j.id}>{j.id}<input type="number" disabled={!ready} min={j.lower} max={j.upper} step=".05" value={viewState.joints[j.id]??0} aria-label={`Unity ${j.id} radians`} onChange={e=>{const radians=Number(e.target.value);if(Number.isFinite(radians))void send('setJointPose',{joint:j.id,radians:Math.max(j.lower,Math.min(j.upper,radians))});}}/></label>)}</details>}
 <p className="faint g-small">{snapshot.evidence}. Visual inspection; no physical validation.</p></section>;
}
