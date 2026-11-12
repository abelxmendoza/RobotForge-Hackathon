'use client';
import {useMemo,useState} from 'react';
import {useDemoMode} from '@/lib/demoMode';
import UnityWorkshop from './UnityWorkshop';
import type {SceneSnapshot} from '@/lib/unityProtocol';
import type {Spec} from '@/lib/garage';
/** Optional immersive renderer. A missing build never disables the current app. */
export default function UnitySceneChoice({robotId,versionId,spec,children,studio=false}:{robotId:string;versionId:string;spec:Spec;children:React.ReactNode;studio?:boolean}){
 const demo=useDemoMode();
 const [immersive,setImmersive]=useState(false);const [settings,setSettings]=useState(false);
 const revision=JSON.stringify(spec);
 const sessionId=useMemo(()=>globalThis.crypto?.randomUUID?.()??`unity-${Date.now()}`,[robotId,versionId,revision,immersive,demo]);
 const snapshot:SceneSnapshot=useMemo(()=>({protocolVersion:1,sessionId,robotId,versionId,draftRevision:revisionHash(revision),assetId:spec.referenceModel==='unitree-g1-23'?'unitree-g1-23':'rover-proxy',selectedLink:'',hiddenLinks:[],explode:0,joints:{},evidence:spec.referenceModel?'Manufacturer reference · no physical validation':'Estimated geometry · no hardware validation',...(spec.referenceModel?{}:{rover:{length:Number(spec.length_m),width:Number(spec.width_m),height:Number(spec.height_m),mass:Number(spec.mass_kg),wheelDiameter:Number(spec.wheel?.diameter_m)}})}),[sessionId,robotId,versionId,revision,spec]);
 if(studio)return <div className="studio-renderer"><div className="studio-view-settings"><button aria-expanded={settings} onClick={()=>setSettings(v=>!v)}>View settings</button>{settings&&<div role="group" aria-label="3D view quality"><button disabled={immersive} aria-pressed={!immersive} onClick={()=>{setImmersive(false);setSettings(false);}}>Standard</button><button aria-pressed={immersive} onClick={()=>{setImmersive(true);setSettings(false);}}>Immersive</button></div>}</div>{immersive?<UnityWorkshop studio snapshot={snapshot} onExit={()=>setImmersive(false)}/>:children}</div>;
 return <><div className="ta-controls" role="group" aria-label="Workshop renderer"><button className="btn btn-sm" aria-pressed={!immersive} disabled={immersive} onClick={()=>setImmersive(false)}>Current 3D view</button><button className="btn btn-sm" aria-pressed={immersive} onClick={()=>setImmersive(true)}>Immersive · Unity</button></div>{immersive?<UnityWorkshop snapshot={snapshot} onExit={()=>setImmersive(false)}/>:children}</>;
}
function revisionHash(text:string):string{let value=2166136261;for(let i=0;i<text.length;i++){value^=text.charCodeAt(i);value=Math.imul(value,16777619);}return `draft-${(value>>>0).toString(16)}`;}
