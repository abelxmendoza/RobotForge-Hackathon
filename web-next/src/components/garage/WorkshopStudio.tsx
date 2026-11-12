'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {GARAGE_KEY,getPath,setPath,type GarageRobot,type Spec} from '@/lib/garage';
import {readStore,writeStore,useStore,uid,downloadJSON} from '@/lib/store';
import {useDemoMode} from '@/lib/demoMode';
import {workshopDraftKey} from '@/lib/robotOwnership';
import {saveStudioVersion,studioRoute} from '@/lib/studioProject';
import {forgeValidateSpec} from '@/components/forge/validate';
import {publishWorkshopContext,summarizeSpec,WORKSHOP_ACTION_EVENT,WORKSHOP_FIX_EVENT,type WorkshopAction} from '@/lib/workshopContext';
import {BENCH_EVENT,benchTransition,type BenchResult,type BenchState} from '@/lib/workshopBench';
import {taBuildParts} from '@/components/kit/takeapart';
import {teardownSteps} from '@/lib/teardown';
import {G1_SPEC} from '@/lib/humanoid';
import {promptWrench} from '@/lib/wrenchPrompt';
import {isWiring} from '@/lib/wiring';
import type {RobotSpec} from '@/components/forge/model';
import RobotAvatar from './RobotAvatar';
import RoverKitPanel,{downloadRoverPackage} from './RoverKitPanel';
import {ROVER_KIT_EVENT,canBeRoverKit,roverKitFromConcept,matchPart,withCad,type RoverKitResult} from '@/lib/roverKit';
import {roverRoleChoices,swapRoverPart,saveRoverVersion} from '@/lib/roverDesign';
import {defaultRoverCad} from '@/lib/roverPackage';
import {parts as catalogueParts} from '@/lib/data';
import type {CataloguePart} from '@/lib/forgeEngine';
import HumanoidWorkshop from './HumanoidWorkshop';
import UnitySceneChoice from '@/components/unity/UnitySceneChoice';
const Robot3D=dynamic(()=>import('@/components/kit/Robot3D'),{ssr:false});
const WiringView=dynamic(()=>import('@/components/wiring/WiringView'),{ssr:false});
const SimulationWorkspace=dynamic(()=>import('@/components/simulation/SimulationWorkspace'),{ssr:false});
const Garage=dynamic(()=>import('./Garage'),{ssr:false});
const clone=(v:Spec):Spec=>JSON.parse(JSON.stringify(v));
const kitCatalogue=catalogueParts as unknown as CataloguePart[];
type Draft={robotId:string;baseline:string;spec:Spec;baseSpec:Spec};
type Mode='build'|'wiring'|'checks';
const fields=[['mass_kg','Mass','kg'],['length_m','Length','m'],['width_m','Width','m'],['height_m','Height','m'],['wheel.diameter_m','Wheel diameter','m']] as const;

export default function WorkshopStudio(){
 const [records,,ready]=useStore<GarageRobot[]>(GARAGE_KEY,[]),demo=useDemoMode();
 const robots=useMemo(()=>records.filter(r=>!r.archivedAt&&r.versions.length),[records]);
 const [selectedId,setSelectedId]=useState(''),[edit,setEdit]=useState<Draft|null>(null);
 const [mode,setMode]=useState<Mode>('build'),[panel,setPanel]=useState('parts'),[legacy,setLegacy]=useState(false);
 const [notice,setNotice]=useState(''),[newRobot,setNewRobot]=useState(false),[pending,setPending]=useState<string|null>(null);
 const [part,setPart]=useState<string|null>(null),[search,setSearch]=useState(''),[explode,setExplode]=useState(0),[cameraReset,setCameraReset]=useState(0),[failed,setFailed]=useState(false);
 const [bench,setBench]=useState<BenchState>({active:false,off:0,direction:1});
 const dialog=useRef<HTMLDialogElement>(null);
 const [routeRobot,setRouteRobot]=useState<string|null>(null);
 const robot=robots.find(r=>r.id===selectedId)??robots[0],latest=robot?.versions.at(-1);
 const dirty=!!(edit&&robot&&edit.robotId===robot.id&&latest&&JSON.stringify(edit.spec)!==JSON.stringify(edit.baseSpec));
 const spec=edit?.robotId===robot?.id?edit?.spec:latest?.spec;
 const stale=!!(dirty&&edit?.baseline!==latest?.id);
 const identity=robot?.id+':'+latest?.id+':'+demo;
 const humanoid=spec?.referenceModel==='unitree-g1-23';
 const isKit=!!spec?.roverDesign,canKit=!isKit&&canBeRoverKit(spec,latest?.planned);
 const built=useMemo(()=>{try{return spec&&!humanoid?taBuildParts(spec as RobotSpec):null;}catch{return null;}},[spec,humanoid]);
 const steps=useMemo(()=>teardownSteps(built?.parts.map(p=>p.id)??[]).steps,[built]);
 const target=bench.active?steps[bench.direction<0?bench.off-1:bench.off]:null;
 const picked=built?.parts.find(p=>p.id===part);
 const checks=useMemo(()=>spec&&!humanoid?forgeValidateSpec(spec):null,[spec,humanoid]);
 const failures=checks?.lines.filter(l=>l.startsWith('[ERROR]'))??[];
 useEffect(()=>{setSelectedId('');setEdit(null);setPart(null);setBench({active:false,off:0,direction:1});setNewRobot(false);setPending(null);setNotice('');},[demo]);
 useEffect(()=>{
  if(!robot||!latest)return;
  setEdit(current=>{
   if(current?.robotId===robot.id&&JSON.stringify(current.spec)!==JSON.stringify(current.baseSpec)&&current.baseline!==latest.id)return current;
   if(current?.robotId===robot.id&&current.baseline===latest.id)return current;
   const cached=readStore<{baseline:string;spec:Spec}|null>(workshopDraftKey(robot.id),null);
   return {robotId:robot.id,baseline:cached?.baseline??latest.id,spec:clone(cached?.spec??latest.spec),baseSpec:clone(robot.versions.find(v=>v.id===(cached?.baseline??latest.id))?.spec??latest.spec)};
  });
  setPart(null);setExplode(0);setFailed(false);setBench({active:false,off:0,direction:1});
 },[identity]);
 useEffect(()=>{
  if(!edit||edit.robotId!==robot?.id)return;
  const error=writeStore(workshopDraftKey(edit.robotId),dirty?{baseline:edit.baseline,spec:edit.spec,label:'',note:'',planned:latest?.planned??false}:null);
  if(error)setNotice('Draft could not be kept in this browser. '+error);
 },[edit,dirty,robot?.id,latest?.planned]);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{
  const route=()=>{const r=studioRoute(location.hash);setMode(r.mode);setPanel(r.panel);setLegacy(r.legacy);if(r.robotId)setRouteRobot(r.robotId);};route();window.addEventListener('hashchange',route);return()=>window.removeEventListener('hashchange',route);
 },[]);
 useEffect(()=>{
  if(legacy)return;
  publishWorkshopContext(robot&&spec?{robotId:robot.id,robotName:robot.name,draftDirty:dirty,versionLabel:latest?.label??'',tab:mode,tabLabel:mode==='wiring'?'Wire':mode==='checks'?'Test':'Build',specLines:summarizeSpec(spec),checksVerdict:humanoid?'Reference · not checked':failures.length?'Needs attention':'Checks pass',checkLines:checks?.lines??[]}:null);
  return()=>publishWorkshopContext(null);
 },[robot,spec,dirty,latest,mode,legacy,checks,humanoid]);
 useEffect(()=>{
  if(legacy)return;
  const action=(event:Event)=>{const detail=(event as CustomEvent<{action:WorkshopAction;handled:boolean}>).detail;if(!detail||detail.handled)return;detail.handled=true;if(detail.action.kind==='tab'){const r=studioRoute('#'+detail.action.tab);setMode(r.mode);setPanel(r.panel);setLegacy(r.legacy);}else setLegacy(true);};
  const fix=()=>setMode('checks');
  window.addEventListener(WORKSHOP_ACTION_EVENT,action);window.addEventListener(WORKSHOP_FIX_EVENT,fix);return()=>{window.removeEventListener(WORKSHOP_ACTION_EVENT,action);window.removeEventListener(WORKSHOP_FIX_EVENT,fix);};
 },[legacy]);
 useEffect(()=>{
  if(legacy||mode!=='build'||humanoid)return;
  const handle=(event:Event)=>{const r=(event as CustomEvent<BenchResult>).detail;if(r.handled)return;r.handled=true;
   if(r.command==='explain'||r.command==='hint'){r.message=picked?`${picked.name}: ${picked.does}`:'Select a part first.';}else{setBench(b=>benchTransition(b,r.command,steps.length));setPanel('guide');r.message='Updated visual assembly practice. Saved robot unchanged.';}
  };window.addEventListener(BENCH_EVENT,handle);return()=>window.removeEventListener(BENCH_EVENT,handle);
 },[legacy,mode,humanoid,picked,steps.length]);
 useEffect(()=>{
  if(legacy)return;
  const handle=(event:Event)=>{const r=(event as CustomEvent<RoverKitResult>).detail;if(r.handled||!robot||!spec||!latest)return;r.handled=true;const c=r.command;
   if(!isKit){r.message=canKit?`${robot.name} isn't a rover kit yet. Open Build → Kit and tap “Make it a rover kit”.`:`${robot.name} isn't a planned rover. Ask me to design a rover first.`;return;}
   setMode('build');setPanel('kit');
   try{
    if(c.kind==='open'){r.message='Opened the rover kit.';}
    else if(c.kind==='export'){if(dirty){r.message='Save your changes first, then ask again.';return;}void downloadRoverPackage(robot.id,latest.id).then(setNotice,e=>setNotice((e as Error).message));r.message=`Exporting ${robot.name}'s build kit (ZIP with parts list, CAD and STL).`;}
    else if(c.kind==='swap'){const role=roverRoleChoices(spec,kitCatalogue).find(x=>x.role===c.role);if(!role){r.message=`This rover has no ${c.role.replace('_',' ')} to swap.`;return;}const part=matchPart(role.options,c.part);if(!part){r.message=`I couldn't match “${c.part}”. Options: ${role.options.slice(0,4).map(p=>p.name).join(', ')}…`;return;}draftSpec(swapRoverPart(spec,c.role,part.id,kitCatalogue));r.message=`Swapped the ${role.label} for ${part.name}. Press Save to keep it.`;}
    else if(c.kind==='chassis'){const cad=spec.roverDesign.cad??defaultRoverCad(spec);draftSpec(withCad(spec,{...cad,chassis:{...cad.chassis,lengthMm:c.lengthMm,widthMm:c.widthMm,thicknessMm:c.thicknessMm??cad.chassis.thicknessMm}}));r.message=`Chassis set to ${c.lengthMm} × ${c.widthMm} mm. Press Save to keep it.`;}
   }catch(e){r.message=(e as Error).message;}
  };window.addEventListener(ROVER_KIT_EVENT,handle);return()=>window.removeEventListener(ROVER_KIT_EVENT,handle);
 });
 useEffect(()=>{if(newRobot||pending!==null){dialog.current?.showModal();}else dialog.current?.close();},[newRobot,pending]);
 const save=()=>{
  if(!robot||!edit||!dirty)return true;
  try{const fresh=readStore<GarageRobot[]>(GARAGE_KEY,[]);const next=edit.spec.roverDesign?saveRoverVersion(fresh,edit.spec,robot.id,edit.baseline,uid('v'),new Date().toISOString()):saveStudioVersion(fresh,robot.id,edit.baseline,edit.spec,uid('v'),new Date().toISOString());const error=writeStore(GARAGE_KEY,next);if(error)throw new Error(error);const saved=next.find(r=>r.id===robot.id)!.versions.at(-1)!;setEdit({robotId:robot.id,baseline:saved.id,spec:clone(saved.spec),baseSpec:clone(saved.spec)});writeStore(workshopDraftKey(robot.id),null);setNotice('Version saved');return true;}catch(e){setNotice((e as Error).message);return false;}
 };
 useEffect(()=>{if(routeRobot&&robots.some(r=>r.id===routeRobot)){switchRobot(routeRobot);setRouteRobot(null);}},[routeRobot,robots]);
 const switchRobot=(id:string)=>{if(id===robot?.id)return;if(dirty){setPending(id);return;}setSelectedId(id);setEdit(null);setNotice('');};
 const addReference=()=>{
  const fresh=readStore<GarageRobot[]>(GARAGE_KEY,[]);const existing=fresh.find(r=>!r.archivedAt&&r.versions.at(-1)?.spec?.referenceModel==='unitree-g1-23');
  if(existing){setNewRobot(false);switchRobot(existing.id);return;}
  const id=uid('g1'),at=new Date().toISOString();const error=writeStore(GARAGE_KEY,[...fresh,{id,name:G1_SPEC.name,createdAt:at,versions:[{id:uid('v'),label:'Manufacturer reference',source:'robodex',createdAt:at,spec:G1_SPEC,planned:true}]}]);
  if(error){setNotice(error);return;}setNewRobot(false);switchRobot(id);
 };
 const draftSpec=(next:Spec)=>{if(!robot||!latest)return;setEdit({robotId:robot.id,baseline:edit?.baseline??latest.id,spec:next,baseSpec:edit?.baseSpec??clone(latest.spec)});};
 const change=(path:string,value:number)=>{if(!Number.isFinite(value)||!robot||!latest)return;const next=clone(spec);setPath(next,path,value);setEdit({robotId:robot.id,baseline:edit?.baseline??latest.id,spec:next,baseSpec:edit?.baseSpec??clone(latest.spec)});};
 const reset=()=>{setCameraReset(n=>n+1);setExplode(0);setPart(null);setBench({active:false,off:0,direction:1});};
 if(!ready)return <p role="status">Opening workshop…</p>;
 return <div className="studio" data-mode={mode}>
  <header className="studio-header"><div className="studio-project-name"><span className="studio-bay">WORKSHOP / {String(Math.max(0,robots.indexOf(robot))+1).padStart(2,'0')}</span><h1>{robot?.name??'Your next robot'}</h1><span className="studio-evidence">{humanoid?'Manufacturer reference':latest?.planned?'Planned · estimated':'Spec model · estimated'}</span></div>
   <nav className="studio-modes" aria-label="Workshop modes">{([['build','Build'],['wiring','Wire'],['checks','Test']] as const).map(([id,label])=><button key={id} aria-pressed={!legacy&&mode===id} onClick={()=>{setMode(id);setLegacy(false);}}>{label}</button>)}</nav>
   <div className="studio-header-actions"><button onClick={()=>{setPanel('versions');setLegacy(false);}} disabled={!robot}>Versions</button><button className="studio-primary" onClick={()=>save()} disabled={!dirty||stale}>Save{dirty?' •':''}</button><button onClick={()=>setNewRobot(true)}>+ Robot</button></div>
  </header>
  {notice&&<div className="studio-notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
  {stale&&<div className="studio-notice" role="alert">A newer version exists. Your draft is kept.<button onClick={()=>downloadJSON('workshop-draft.json',edit?.spec)}>Export draft</button><button onClick={()=>{if(robot&&latest){setEdit({robotId:robot.id,baseline:latest.id,spec:clone(latest.spec),baseSpec:clone(latest.spec)});writeStore(workshopDraftKey(robot.id),null);}}}>Load latest</button></div>}
  {legacy?<div className="studio-records"><button onClick={()=>setLegacy(false)}>← Back to workspace</button><Garage initialTab={mode}/></div>:!robot||!spec?<div className="studio-empty"><span className="studio-bay">A SPACE TO BUILD</span><h2>Bring your robot to the bench.</h2><button className="studio-primary" onClick={()=>setNewRobot(true)}>Add your first robot</button></div>:<>
   {mode==='build'&&<div className="studio-build">
    {humanoid?<UnitySceneChoice studio robotId={robot.id} versionId={latest?.id??'new'} spec={spec}><HumanoidWorkshop studio/></UnitySceneChoice>:<div className="studio-scene-grid">
     <div className="studio-canvas"><div className="studio-scene-tools"><button onClick={reset}>Fit view</button><button aria-pressed={explode>0} onClick={()=>setExplode(n=>n?0:.8)}>Separate parts</button><button onClick={()=>setPanel('guide')}>Assemble</button></div>
      {failed?<div className="studio-empty"><h2>3D view unavailable</h2><p>Your parts and project are still available.</p><button onClick={()=>{setFailed(false);setCameraReset(n=>n+1);}}>Retry 3D</button></div>:<Robot3D key={robot.id+':'+cameraReset} spec={spec} workshop cameraReset={cameraReset} fill explode={explode} selected={part} onSelect={id=>{setPart(id);setPanel('parts');}} onFail={()=>setFailed(true)} autoRotate={false} showComMarker={false} teardown={bench.active?{removed:steps.slice(0,bench.off),isolate:target??null}:undefined}/>}
      <span className="studio-scene-caption">Drag to orbit · select a part</span>
     </div>
     <aside className="studio-inspector" aria-label="Robot inspector"><div className="studio-seg" role="group" aria-label="Side panel">{([['parts','Parts'],...(isKit||canKit?[['kit','Kit']]:[]),['specs','Size']] as [string,string][]).map(([id,label])=><button key={id} aria-pressed={panel===id||(id==='parts'&&panel==='guide')} onClick={()=>setPanel(id)}>{label}</button>)}</div>
      {panel==='kit'?(isKit?<RoverKitPanel key={robot.id} spec={spec} robotId={robot.id} versionId={latest?.id??''} dirty={dirty} onChange={draftSpec} onNotice={setNotice}/>:canKit?<><h3>Make it a rover kit</h3><p>Swap parts, set the chassis and export CAD and a parts list.</p><button className="studio-primary" onClick={()=>{try{draftSpec(roverKitFromConcept(spec,robot.name,kitCatalogue,uid('assembly'),new Date().toISOString()));}catch(e){setNotice((e as Error).message);}}}>Make it a rover kit</button></>:<><h3>No rover kit</h3><p>Ask Wrench to design a rover, like “a compact rover with a camera”.</p><button onClick={()=>promptWrench({mode:'design',text:'Design a rover that '})}>Ask Wrench</button></>):panel==='guide'?<><span className="studio-bay">ILLUSTRATIVE · NOT BUILD INSTRUCTIONS</span><h3>{bench.active?(target?built?.parts.find(p=>p.id===target)?.name:'Practice complete'):'Build it, part by part'}</h3><p>{bench.active?'Add the highlighted part to the model.':'Explore how the model goes together.'}</p><progress aria-label="Assembly progress" max={steps.length||1} value={bench.active?steps.length-bench.off:0}/><span>{bench.active?steps.length-bench.off:0} / {steps.length} part groups</span><div className="studio-inline"><button onClick={()=>{setBench(b=>benchTransition(b,bench.active?'next':'assemble',steps.length));setExplode(0);}} className="studio-primary">{bench.active?'Next part':'Start assembly'}</button><button onClick={()=>setBench(b=>benchTransition(b,'back',steps.length))} disabled={!bench.active}>Back</button><button onClick={reset}>Reset</button></div></>:panel==='specs'?<><p className="studio-muted">Changes save as a new version.</p>{fields.filter(([path])=>typeof getPath(spec,path)==='number').map(([path,label,unit])=><label className="studio-field" key={path}><span>{label} <small>{unit}</small></span><input type="number" min="0.001" step="0.001" value={Number(getPath(spec,path))} onChange={e=>change(path,Number(e.target.value))}/></label>)}</>:panel==='versions'?<>{robot.versions.slice().reverse().map((v,i)=><button className="studio-version" key={v.id} onClick={()=>{setNotice(v.label+' · '+new Date(v.createdAt).toLocaleDateString());}}><strong>v{robot.versions.length-i} · {v.label}</strong><small>{new Date(v.createdAt).toLocaleDateString()}</small></button>)}<button onClick={()=>downloadJSON('robot.json',spec)}>Export project</button><button onClick={()=>{if(dirty&&!save())return;setLegacy(true);}}>Open project records</button></>:<><input className="studio-search" aria-label="Find a part" placeholder="Find a part…" value={search} onChange={e=>setSearch(e.target.value)}/><div className="studio-parts" role="group" aria-label="Robot parts">{built?.parts.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=><button key={p.id} aria-pressed={part===p.id} onClick={()=>setPart(p.id)}><span>{p.name}</span><small>×{p.qty}</small></button>)}</div>{picked?<div className="studio-part-card"><span className="studio-bay">SELECTED PART</span><h3>{picked.name}</h3><p>{picked.does}</p><span>{picked.dims}</span><button onClick={()=>promptWrench({mode:'chat',text:'Explain this part',send:true})}>Ask Wrench</button></div>:<p className="studio-muted">Select a part to inspect it.</p>}<button className="studio-primary" onClick={()=>setPanel('guide')}>Start assembly</button></>}
     </aside></div>}
    {humanoid&&panel==='versions'&&<div className="studio-overlay-panel"><button onClick={()=>setPanel('parts')}>Close versions</button>{robot.versions.map(v=><p key={v.id}>{v.label}</p>)}<button onClick={()=>{setPanel('parts');setLegacy(true);}}>Project records</button></div>}
   </div>}
   {mode==='wiring'&&<div className="studio-task-view"><div className="studio-task-head"><h2>Connections</h2><button onClick={()=>promptWrench({mode:'chat',text:'Help me wire this robot',send:true})}>Ask Wrench</button></div>{isWiring(spec.wiring)?<WiringView compact wiring={spec.wiring} spec={spec} onWiringChange={wiring=>{setEdit({robotId:robot.id,baseline:edit?.baseline??latest!.id,spec:{...clone(spec),wiring},baseSpec:edit?.baseSpec??clone(latest!.spec)});}}/>:<div className="studio-empty"><h2>{humanoid?'No reference wiring recorded':'Plan your connections'}</h2><p>Record the battery, controller and connections first.</p><button onClick={()=>{if(dirty&&!save())return;setLegacy(true);}}>Open wiring tools</button></div>}</div>}
   {mode==='checks'&&<div className="studio-task-view"><div className="studio-task-head"><h2>{humanoid?'Reference inspection':'Test your design'}</h2><span className="studio-evidence">{humanoid?'Not hardware validated':failures.length?`${failures.length} checks need attention`:'Spec checks pass · not hardware validation'}</span></div>{humanoid?<div className="studio-empty"><h2>Inspect and pose this model.</h2><p>No walking controller or validated gait is recorded.</p><button onClick={()=>setMode('build')}>Return to G1</button></div>:<><SimulationWorkspace spec={spec} robot={robot} robotId={robot.id} versionId={(dirty?'draft:':'')+(latest?.id??'new')}/>{failures.length>0&&<div className="studio-test-issues"><h3>Needs attention</h3>{failures.map(l=><p key={l}>{l.replace('[ERROR] ','')}</p>)}</div>}</>}</div>}
  </>}
  <footer className="studio-fleet" aria-label="Your robot shelf"><span className="studio-bay">MY ROBOTS</span><div>{robots.map(r=><button key={r.id} aria-current={r.id===robot?.id?'true':undefined} onClick={()=>switchRobot(r.id)}><RobotAvatar names={[r.name]} size={40}/><span><strong>{r.name}</strong><small>{r.versions.at(-1)?.planned?'Planned':'Saved project'}</small></span></button>)}</div><button aria-label="Add robot" onClick={()=>setNewRobot(true)}>+</button></footer>
  <dialog ref={dialog} className="studio-dialog" onCancel={()=>{setNewRobot(false);setPending(null);}}>
   {pending!==null?<><h2>Keep your changes?</h2><p>Your current robot has an unfinished draft.</p><button className="studio-primary" onClick={()=>{if(save()){setSelectedId(pending);setEdit(null);setPending(null);}}}>Save & switch</button><button onClick={()=>{if(robot)writeStore(workshopDraftKey(robot.id),null);setSelectedId(pending);setEdit(null);setPending(null);}}>Discard & switch</button><button onClick={()=>setPending(null)}>Stay here</button></>:<><div className="studio-panel-head"><h2>Bring a robot in</h2><button onClick={()=>setNewRobot(false)}>Close</button></div><button className="studio-new-card" onClick={()=>{setNewRobot(false);promptWrench({mode:'design',text:'Design a rover that '});}}><strong>Design a rover</strong><span>Tell Wrench what it should do</span></button><button className="studio-new-card" onClick={addReference}><strong>Explore Unitree G1</strong><span>Official humanoid reference</span></button><Link className="studio-new-card" href="/import/"><strong>Import a robot</strong><span>GitHub, photos or a spec</span></Link></>}
  </dialog>
 </div>;
}
