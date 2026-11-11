'use client';
import {useEffect,useMemo,useState} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {parts as catalogue} from '@/lib/data';
import {GARAGE_KEY,type GarageRobot,type Spec} from '@/lib/garage';
import {readStore,writeStore,useStore,uid} from '@/lib/store';
import {createRoverConcept,defaultRoverRequirements,roverRoleChoices,swapRoverPart,seedRoverAssembly,reconcileRoverAssembly,saveRoverVersion,type RoverRequirements} from '@/lib/roverDesign';
import {defaultRoverCad,roverCadArtifacts,type RoverCadSettings,type RoverPlate} from '@/lib/roverPackage';
import {componentById} from '@/lib/components';
import type {CataloguePart} from '@/lib/forgeEngine';
import type {RobotSpec} from '@/components/forge/model';
import {shouldRecoverRoverDraft} from '@/lib/roverDraft';
import {DEMO_EVENT} from '@/lib/demoMode';
import EnclosureDrawing from './EnclosureDrawing';
import styles from './RoverDesigner.module.css';
const Robot3D=dynamic(()=>import('@/components/kit/Robot3D'),{ssr:false,loading:()=> <p>Loading the 3D concept…</p>});
const AssemblyWorkspace=dynamic(()=>import('@/components/assembly/AssemblyWorkspace'),{ssr:false});
const PrintPreview=dynamic(()=>import('@/components/assembly/PrintPreview'),{ssr:false});
const cat=catalogue as unknown as CataloguePart[];
const DRAFT_KEY='rf.rover-draft.v1';
const STEPS=['Describe','Choose parts','Assemble','Generate CAD','Build package'];
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const now=()=>new Date().toISOString();
function NumberField({label,value,onChange,min=1,step=1}:{label:string;value:number;onChange:(n:number)=>void;min?:number;step?:number}){
 return <label className="g-field"><span>{label}</span><input type="number" min={min} max={600} step={step} value={Number.isFinite(value)?value:''} onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))}/></label>;
}
function PlateFields({value,onChange,onError,prefix}:{value:RoverPlate;onChange:(v:RoverPlate)=>void;onError:(s:string)=>void;prefix:string}){
 const [holes,setHoles]=useState(value.holes.map(p=>p.join(', ')).join('\n'));
 return <><div className={styles.fields}>{(['lengthMm','widthMm','thicknessMm','holeDiameterMm'] as const).map(key=><NumberField key={key} label={prefix+' '+({lengthMm:'length (mm)',widthMm:'width (mm)',thicknessMm:'thickness (mm)',holeDiameterMm:'hole diameter (mm)'})[key]} value={value[key]} step={.1} min={.5} onChange={n=>onChange({...value,[key]:n})}/>)}</div>
 <label className="g-field"><span>{prefix} hole coordinates — X, Y in mm, one pair per line</span><textarea rows={3} value={holes} placeholder="Leave blank for no holes" onChange={e=>{setHoles(e.target.value);try{const rows=e.target.value.trim()?e.target.value.trim().split('\n').map(row=>{const pair=row.split(',');if(pair.length!==2||pair.some(v=>!v.trim()))throw new Error('Use one numeric X, Y pair per line.');return pair.map(Number);}):[];if(rows.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new Error('Use one numeric X, Y pair per line.');onError('');onChange({...value,holes:rows as [number,number][]});}catch(err){onError((err as Error).message);}}}/></label><p className="faint g-small">Coordinates are relative to the plate centre. No mounting holes are inferred from a component envelope.</p></>;
}
export default function RoverDesigner(){
 const [robots,,ready]=useStore<GarageRobot[]>(GARAGE_KEY,[]);
 const [requirements,setRequirements]=useState(defaultRoverRequirements);
 const [draft,setDraft]=useState<Spec|null>(null),[robotId,setRobotId]=useState(''),[expected,setExpected]=useState<string|null>(null);
 const [step,setStep]=useState(0),[dirty,setDirty]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[inputErrors,setInputErrors]=useState<Record<string,string>>({});
 const inputError=Object.values(inputErrors).filter(Boolean).join(' ');
 const setInputError=(field:string,message:string)=>setInputErrors(errors=>({...errors,[field]:message}));
 const [contextEpoch,setContextEpoch]=useState(0);
 const [briefDirty,setBriefDirty]=useState(false),[cadDirty,setCadDirty]=useState(false),[restored,setRestored]=useState(false);
 const [cad,setCad]=useState<RoverCadSettings|null>(null),[busy,setBusy]=useState(false),[failed3D,setFailed3D]=useState(false);
 const candidates=robots.filter(r=>!r.archivedAt&&r.versions.at(-1)?.planned&&r.versions.at(-1)?.spec?.forge&&['differential','mecanum'].includes(r.versions.at(-1)?.spec?.drivetrain));
 const robot=robots.find(r=>r.id===robotId),latest=robot?.versions.at(-1);
 const stale=!!robotId&&latest?.id!==expected;
 const load=(r:GarageRobot)=>{
  const v=r.versions.at(-1)!;let spec=clone(v.spec);
  if(!spec.roverDesign){const req={...defaultRoverRequirements(),name:r.name,purpose:spec.description||'Continue this planned rover',archetype:spec.drivetrain==='mecanum'?'mecanum_rover' as const:'differential_rover' as const};spec.roverDesign=createRoverConcept(req,cat).roverDesign;spec=seedRoverAssembly(spec,uid('assembly'),now());}
  setRobotId(r.id);setExpected(v.id);setDraft(spec);setRequirements(clone(spec.roverDesign.requirements));setCad(clone(spec.roverDesign.cad||defaultRoverCad(spec)));setDirty(!v.spec.roverDesign);setError('');setInputErrors({});setBriefDirty(false);setCadDirty(false);setFailed3D(false);
 };
 useEffect(()=>{
  if(robotId&&latest&&latest.id!==expected&&!dirty)load(robot!);
  // A workbench save refreshes a clean editor; an unsaved draft is never replaced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[latest?.id,robotId]);
 useEffect(()=>{
  if(!ready)return;
  try{
   const id=new URLSearchParams(window.location.search).get('robot');
   const r=id&&readStore<GarageRobot[]>(GARAGE_KEY,[]).find(r=>r.id===id&&!r.archivedAt);
   const cached=readStore<{format:string;requirements:RoverRequirements;draft:Spec|null;robotId:string;expected:string|null;cad:RoverCadSettings|null;dirty:boolean;briefDirty:boolean;cadDirty:boolean;step:number}|null>(DRAFT_KEY,null);
   if(shouldRecoverRoverDraft(cached,id)&&cached?.requirements&&Array.isArray(cached.requirements.sensors)){
    setRequirements(cached.requirements);setDraft(cached.draft);setRobotId(cached.robotId);setExpected(cached.expected);setCad(cached.cad);setDirty(cached.dirty);setBriefDirty(cached.briefDirty);setCadDirty(cached.cadDirty);setStep(Number.isInteger(cached.step)&&cached.step>=0&&cached.step<5?cached.step:0);setNotice(cached.dirty&&id&&id!==cached.robotId?'Recovered your unfinished draft instead of replacing it with a different robot. Save or discard it before choosing another design.':'Recovered your local design draft. It is separate from saved Workshop robots.');
   }else if(r)load(r);
  }catch(e){setError((e as Error).message);}finally{setRestored(true);}
 },[ready,contextEpoch]);
 useEffect(()=>{const resetContext=()=>{setRequirements(defaultRoverRequirements());setBriefDirty(false);setCadDirty(false);setNotice('');setError('');setRestored(false);setDraft(null);setRobotId('');setExpected(null);setDirty(false);setCad(null);setStep(0);setInputErrors({});setContextEpoch(n=>n+1);};window.addEventListener(DEMO_EVENT,resetContext);return()=>window.removeEventListener(DEMO_EVENT,resetContext);},[]);
 useEffect(()=>{
  if(!ready||!restored)return;
  const record=draft||dirty?{format:'robotforge-rover-draft-v1',requirements,draft,robotId,expected,cad,dirty,briefDirty,cadDirty,step}:null;
  const error=writeStore(DRAFT_KEY,record);if(error)setError('Draft recovery could not save: '+error);
 },[ready,restored,requirements,draft,robotId,expected,cad,dirty,briefDirty,cadDirty,step]);

 const updateReq=(changes:Partial<RoverRequirements>)=>{setRequirements(r=>({...r,...changes}));setDirty(true);setBriefDirty(true);};
 const generate=()=>{try{const concept=seedRoverAssembly(createRoverConcept(requirements,cat),uid('preview'),now());setBriefDirty(false);setCadDirty(false);setDraft(concept);setCad(defaultRoverCad(concept));setDirty(true);setFailed3D(false);setError('');setNotice('Concept preview only. Save it when you are ready; nothing has been added to your Workshop yet.');}catch(e){setError((e as Error).message);}};
 const save=(withCad=false)=>{
  if(!draft)return;
  try{
   if(briefDirty)throw new Error('Generate the updated brief before saving the concept.');
   if(inputError)throw new Error(inputError);
   let spec=clone(draft);
   if((withCad||cadDirty)&&cad){roverCadArtifacts(spec,cad);spec.length_m=cad.chassis.lengthMm/1000;spec.width_m=cad.chassis.widthMm/1000;spec.roverDesign.cad=clone(cad);spec=reconcileRoverAssembly(spec);}
   const id=robotId||uid('robot'),v=uid('v');
   const next=saveRoverVersion(readStore<GarageRobot[]>(GARAGE_KEY,[]),spec,id,expected,v,now());
   const err=writeStore(GARAGE_KEY,next);if(err)throw new Error(err);
   load(next.find(r=>r.id===id)!);setDirty(false);setNotice(withCad?'CAD dimensions saved with this planned robot version.':'Planned rover saved in Workshop. Earlier versions and your inventory are unchanged.');setError('');
  }catch(e){setError((e as Error).message);}
 };
 const reset=()=>{setDraft(null);setRobotId('');setExpected(null);setRequirements(defaultRoverRequirements());setCad(null);setCadDirty(false);setBriefDirty(false);setInputErrors({});setDirty(false);setError('');setNotice('New concept. Your saved robots are unchanged.');setStep(0);};
 const roles=useMemo(()=>draft?roverRoleChoices(draft,cat):[],[draft]);
 const artifacts=useMemo(()=>{try{return draft&&cad?{value:roverCadArtifacts(draft,cad),error:''}:{value:null,error:''};}catch(e){return {value:null,error:(e as Error).message};}},[draft,cad]);
 const updateCad=(next:RoverCadSettings)=>{setCad(next);setCadDirty(true);setDirty(true);};
 const exportPackage=async()=>{
  if(!robotId||!expected)return;setBusy(true);setError('');
  try{if(dirty)throw new Error('Save your design and CAD changes before exporting.');const fresh=readStore<GarageRobot[]>(GARAGE_KEY,[]).find(r=>r.id===robotId);if(!fresh)throw new Error('The saved robot no longer exists.');const {createRoverPackage}=await import('@/lib/roverPackage');const pack=createRoverPackage(fresh,expected,now());const blob=new Blob([new Uint8Array(pack.bytes)],{type:'application/zip'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=pack.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice(`Build package downloaded: ${pack.files.length} files from saved version ${expected}.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 if(!ready)return <p>Loading your design workspace…</p>;
 return <div className={styles.workspace}>
 <div className={styles.toolbar}><label className="g-field"><span>Continue a planned rover</span><select aria-label="Continue a planned rover" value={robotId} disabled={dirty} onChange={e=>{const r=candidates.find(r=>r.id===e.target.value);if(r)load(r);else reset();}}><option value="">New concept</option>{candidates.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><button className="btn btn-sm" onClick={reset}>{dirty?'Discard unsaved edits':'New rover'}</button>{robotId&&<Link className="btn btn-sm" href={'/garage/#robot='+robotId}>Open in Workshop</Link>}</div>
 <nav className={styles.steps} aria-label="Rover design steps">{STEPS.map((title,i)=><button type="button" key={title} disabled={i>0&&(!draft||briefDirty)} aria-current={i===step?'step':undefined} onClick={()=>{setStep(i);setError('');}}><span>{i+1}</span>{title}</button>)}</nav>
 {error&&<p className="g-error" role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
 {stale&&<p className="g-error" role="alert">A newer robot version was saved elsewhere. Reload it before editing or exporting. <button className="btn btn-sm" onClick={()=>robot&&load(robot)}>Reload saved version</button></p>}
 {step===0&&<section className={styles.split}><div className={styles.card}><span className="eyebrow">Start with a purpose</span><h2>What are we building?</h2>
 <label className="g-field"><span>Robot name</span><input value={requirements.name} maxLength={100} onChange={e=>updateReq({name:e.target.value})}/></label>
 <label className="g-field"><span>What should the rover do?</span><textarea rows={4} value={requirements.purpose} maxLength={4000} onChange={e=>updateReq({purpose:e.target.value})}/></label>
 <div className={styles.fields}><label className="g-field"><span>Drive type</span><select value={requirements.archetype} onChange={e=>updateReq({archetype:e.target.value as RoverRequirements['archetype']})}><option value="differential_rover">Differential rover</option><option value="mecanum_rover">Mecanum rover</option></select></label><label className="g-field"><span>Starting size</span><select value={requirements.size} onChange={e=>updateReq({size:e.target.value as RoverRequirements['size']})}><option value="compact">Compact</option><option value="standard">Standard</option><option value="large">Large</option></select></label></div>
 <fieldset className={styles.sensors}><legend>Sensors</legend>{[['camera','Camera'],['depth_camera','Depth camera'],['lidar','LiDAR'],['imu','IMU'],['ultrasonic','Ultrasonic']].map(([id,label])=><label key={id}><input type="checkbox" checked={requirements.sensors.includes(id)} onChange={e=>updateReq({sensors:e.target.checked?[...requirements.sensors,id]:requirements.sensors.filter(s=>s!==id)})}/>{label}</label>)}</fieldset>
 <div className={styles.fields}>{(['budgetUsd','payloadKg'] as const).map(key=><label key={key} className="g-field"><span>{key==='budgetUsd'?'Target budget (USD, optional)':'Target payload (kg, optional)'}</span><input type="number" min={.01} step={.01} value={requirements[key]??''} onChange={e=>updateReq({[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</div><p className="faint g-small">Budget and payload are requirements to investigate. Generated concepts do not establish price, carrying capacity or hardware performance.</p>
 <button className="btn btn-primary" onClick={generate}>Generate rover preview</button></div>
 <div className={styles.card}><h2>Your concept</h2>{draft?<><div className={styles.preview}>{failed3D?<p>Interactive 3D requires WebGL on this device.</p>:<Robot3D key={draft.assembly?.id+JSON.stringify(draft.forge.ids)} spec={draft as RobotSpec} instances={draft.assembly?.components} connections={draft.assembly?.connections} explode={0} selected={null} onSelect={()=>{}} onFail={()=>setFailed3D(true)}/>}</div><p className="faint">Catalogue envelopes and placement are estimates. No detailed manufacturer CAD or measured twin is implied.</p><details><summary>Selected parts and assumptions</summary><p>Starting dimensions, total mass and assembly poses are design estimates. Missing electrical or mechanical ratings remain unknown.</p><ul>{draft.forge.bom.map((b:{partId:string;qty:number})=><li key={b.partId}>{b.qty} × {cat.find(p=>p.id===b.partId)?.name||b.partId}</li>)}</ul></details><div className={styles.actions}><button className="btn btn-primary" disabled={stale} onClick={()=>save()}>Save planned rover</button><button className="btn" onClick={()=>setStep(1)}>Choose parts →</button></div></>:<div className={styles.empty}>Describe your rover, then generate an editable 3D concept. Previewing creates no saved robot.</div>}</div></section>}
 {step===1&&draft&&<section className={styles.card}><h2>Choose the parts for {draft.name}</h2><p>Replacements keep quantities and update recorded ratings. Missing specifications remain unknown. Selecting a part does not mark it as owned.</p><div className={styles.roleGrid}>{roles.map(role=><label className="g-field" key={role.role}><span>{role.label} ×{role.quantity}</span><select value={role.partId} onChange={e=>{try{const next=swapRoverPart(draft,role.role,e.target.value,cat);setDraft(next);setDirty(true);setError('');}catch(err){setError((err as Error).message);}}}>{role.options.map(p=><option key={p.id} value={p.id}>{p.name||p.id}</option>)}</select><small className="faint">{role.partId} · catalogue</small></label>)}</div>
 <details><summary>Complete bill of materials ({draft.forge.bom.length} part types)</summary><ul>{draft.forge.bom.map((b:{partId:string;qty:number})=><li key={b.partId}>{b.qty} × {cat.find(p=>p.id===b.partId)?.name||b.partId} <span className="faint">({b.partId})</span></li>)}</ul></details>
 <h3>Component specifications and sources</h3><div className={styles.roleGrid}>{draft.forge.bom.map((b:{partId:string;qty:number})=>{const p=cat.find(p=>p.id===b.partId);const envelope=componentById('catalog--'+b.partId);const source=p?.found_url||p?.shops?.[0]?.url;return <details key={b.partId}><summary>{p?.name||b.partId} ×{b.qty}</summary><dl>{Object.entries(p?.specs||{}).map(([key,value])=><div key={key}><dt>{key.replace(/_/g,' ')}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd></div>)}</dl><p className="faint g-small">Missing: {envelope?.missing.join('; ')||'Physical fit and actual hardware measurements'}</p>{source&&/^https?:\/\//i.test(source)&&<a href={source} target="_blank" rel="noreferrer">Catalogue source / supplier reference</a>}</details>;})}</div>
 <h3>Engineering findings</h3><ul className={styles.findings}>{draft.forge.checks.map((c:{id:string;verdict:string;detail:string})=><li key={c.id}><span className="fbadge">{c.verdict}</span> {c.detail}</li>)}</ul><div className={styles.actions}><button className="btn btn-primary" disabled={stale} onClick={()=>save()}>Save part selections</button><button className="btn" onClick={()=>setStep(2)}>Assemble →</button></div></section>}
 {step===2&&draft&&<section><div className={styles.card}><h2>Assemble your rover</h2><p>Move and rotate individual components, review envelope overlaps, and plan connections. Every applied assembly edit creates a new planned version.</p>{!robotId||dirty||stale?<><p>Save your current concept before editing its assembly.</p><button className="btn btn-primary" disabled={stale} onClick={()=>save()}>Save design for assembly</button></>:<p><Link href={'/garage/#robot='+robotId+'&tab=build'}>Open this assembly in the full Workshop</Link></p>}</div>{robotId&&!dirty&&!stale&&<AssemblyWorkspace key={robotId} robotId={robotId}/>}<button className="btn" onClick={()=>setStep(3)}>Generate CAD →</button></section>}
 {step===3&&draft&&cad&&<section className={styles.split}><div className={styles.card}><h2>Generate chassis and custom parts</h2><p>Starting chassis dimensions follow the concept size; thickness starts at a 4 mm design default. Edit them, review the geometry, and save a version.</p><PlateFields key={'chassis-'+draft.assembly?.id} prefix="Chassis" value={cad.chassis} onChange={chassis=>updateCad({...cad,chassis})} onError={s=>setInputError('chassis',s)}/>
 <h3>Component mount</h3><label className="g-field"><span>Mount for assembly instance</span><select value={cad.mount?.instanceId||''} onChange={e=>{setInputError('mount','');const instance=draft.assembly?.components.find((c:{id:string})=>c.id===e.target.value),p=instance&&componentById(instance.componentId);updateCad({...cad,mount:p?{instanceId:instance.id,lengthMm:Math.round(p.sizeM[0]*1000+12),widthMm:Math.round(p.sizeM[1]*1000+12),thicknessMm:3,holes:[],holeDiameterMm:3.2}:null});}}><option value="">No component mount</option>{draft.assembly?.components.map((c:{id:string;componentId:string})=><option key={c.id} value={c.id}>{componentById(c.componentId)?.name||c.componentId} · {c.id}</option>)}</select></label>{cad.mount&&<PlateFields key={cad.mount.instanceId} prefix="Mount" value={cad.mount} onError={s=>setInputError('mount',s)} onChange={mount=>updateCad({...cad,mount:{...mount,instanceId:cad.mount!.instanceId}})}/>}
 <label className={styles.check}><input type="checkbox" checked={!!cad.enclosure} onChange={e=>updateCad({...cad,enclosure:e.target.checked?{length_mm:120,width_mm:90,height_mm:45,wall_mm:2,clearance_mm:.3,cable_dia_mm:8,cable_count:0}:null})}/>Generate an electronics enclosure</label>{cad.enclosure&&<><p className="faint g-small">Enclosure defaults: 120 × 90 × 45 mm, 2 mm walls, 0.3 mm lid clearance; no cable holes until specified.</p><div className={styles.fields}>{Object.entries(cad.enclosure).map(([key,value])=><NumberField key={key} label={'Enclosure '+key.replace(/_/g,' ')} value={value} min={key==='cable_count'||key==='clearance_mm'?0:.1} step={key==='cable_count'?1:.1} onChange={n=>updateCad({...cad,enclosure:{...cad.enclosure!,[key]:n}})}/>)}</div></>}
 {(inputError||artifacts.error)&&<p role="alert" className="g-error">{inputError||artifacts.error}</p>}<button className="btn btn-primary" disabled={stale||!!inputError||!!artifacts.error} onClick={()=>save(true)}>Save CAD dimensions</button></div>
 <div className={styles.card}><h2>Chassis geometry preview</h2>{artifacts.value&&<><PrintPreview mount={artifacts.value.chassis}/><p>{cad.chassis.lengthMm} × {cad.chassis.widthMm} × {cad.chassis.thicknessMm} mm · {cad.chassis.holes.length} explicit holes</p>{cad.mount&&<><h3>Component mount preview</h3><PrintPreview mount={roverCadArtifacts(draft,{...cad,chassis:cad.mount,mount:null,enclosure:null}).chassis}/></>}<ul className={styles.findings}>{artifacts.value.warnings.map(w=><li key={w}>{w}</li>)}</ul><details><summary>Generated editable OpenSCAD</summary><pre className={styles.code}>{artifacts.value.files['cad/chassis.scad']}</pre></details>{cad.enclosure&&<><h3>Enclosure geometry</h3><EnclosureDrawing settings={cad.enclosure}/><details><summary>Editable enclosure source</summary><pre className={styles.code}>{artifacts.value.files['cad/enclosure.scad']}</pre></details></>}</>}<button className="btn" onClick={()=>setStep(4)}>Build package →</button></div></section>}
 {step===4&&draft&&<section className={styles.card}><span className="eyebrow">One saved design. One package.</span><h2>Export {draft.name}</h2><p>The ZIP contains your exact saved specification, parts list with quantities and sources, individual assembly poses, planned wiring, CAD, plate STL, assembly guidance, and checks with missing evidence.</p><p>Assembly uses metres and degrees. CAD and STL use millimetres. The simulation file is RobotForge JSON; no Gazebo pass or URDF is claimed.</p><ul><li>Chassis and selected mounts: editable OpenSCAD + matching STL.</li><li>Enclosure, when selected: editable OpenSCAD box and lid.</li><li>Manifest records the robot version and assembly revision.</li></ul>{(!robotId||dirty||!draft.roverDesign.cad)&&<p role="status">Save the design and reviewed CAD dimensions before exporting.</p>}<button className="btn btn-primary" disabled={busy||stale||dirty||!robotId||!draft.roverDesign.cad} onClick={()=>void exportPackage()}>{busy?'Preparing build package…':'Download build package ZIP'}</button>{robotId&&<p className="faint g-small">Saved robot version: {expected} · assembly: {draft.assembly?.id}</p>}</section>}
 </div>;
}
