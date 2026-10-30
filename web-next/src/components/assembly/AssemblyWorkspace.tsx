"use client";
import AssemblyPlan from './AssemblyPlan';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { COMPONENTS, componentById } from '@/lib/components';
import { ASSEMBLY_KEY, applyAssembly, currentAssembly, operationFor, previewAssembly, undoAssembly, type Assemblies, type AssemblyOperation, type ComponentInstance, type Pose } from '@/lib/assembly';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { downloadJSON, readStore, uid, useStore, writeStore } from '@/lib/store';
import type { RobotSpec } from '@/components/forge/model';
const Robot3D = dynamic(() => import('@/components/kit/Robot3D'), { ssr: false, loading: () => <p>Loading 3D assembly…</p> });

function PoseEditor({ instance, onMove }: {instance: ComponentInstance; onMove: (p: Pose, yaw: number) => void}) {
  const [position, setPosition] = useState(instance.positionM.map(n => String(Math.round(n*100000)/100)));
  const [yaw, setYaw] = useState(String(instance.yawDeg));
  return <fieldset className="g-group"><legend>Position and orientation</legend>
    <p className="faint">Component centre in robot coordinates: X forward, Y left, Z up. Metres internally; edit millimetres here.</p>
    {['X','Y','Z'].map((axis,i) => <label className="g-field" key={axis}><span>{axis} (mm)</span><input type="number" step="1" value={position[i]} onChange={e => setPosition(p => p.map((v,j) => j === i ? e.target.value : v))}/></label>)}
    <label className="g-field"><span>Yaw (degrees)</span><input type="number" min="-360" max="360" value={yaw} onChange={e => setYaw(e.target.value)}/></label>
    <button type="button" className="btn btn-sm" onClick={() => onMove(position.map(v => v.trim() ? Number(v)/1000 : NaN) as Pose, yaw.trim() ? Number(yaw) : NaN)}>Preview move</button>
  </fieldset>;
}

export default function AssemblyWorkspace({robotId}: {robotId: string}) {
  const [robots] = useStore<GarageRobot[]>(GARAGE_KEY, []);
  const [all,,ready] = useStore<Assemblies>(ASSEMBLY_KEY, {});
  const [tab,setTab] = useState<'components'|'wiring'>('components');
  const [componentId,setComponentId] = useState(COMPONENTS[0].id);
  const [selected,setSelected] = useState<string|null>(null);
  const [proposal,setProposal] = useState<AssemblyOperation|null>(null);
  const [notice,setNotice] = useState('');
  const [failed3D,setFailed3D] = useState(false);
  const [view,setView] = useState<'3d'|'top'>('3d');
  const [from,setFrom] = useState(''); const [to,setTo] = useState('');
  const robot = robots.find(r => r.id === robotId);
  const spec = robot?.versions.at(-1)?.spec;
  const saved = useMemo(()=>currentAssembly(all,robotId),[all,robotId]);
  const {preview,previewError} = useMemo(()=>{
    if(!proposal) return {preview:saved,previewError:''};
    try {return {preview:previewAssembly(robots,all,proposal),previewError:''};}
    catch(e) {return {preview:saved,previewError:(e as Error).message};}
  },[robots,all,proposal,saved]);
  const instance = preview.components.find(c => c.id === selected);
  const definition = instance ? componentById(instance.componentId) : null;
  if (!ready || !spec) return <p>Loading saved robot assembly…</p>;
  const propose = (args: Parameters<typeof operationFor>[3]) => {
    try {
      const op = operationFor(robots,all,robotId,args);
      previewAssembly(robots,all,op); setProposal(op); setNotice('');
    } catch(e) { setNotice((e as Error).message); }
  };
  const apply = () => {
    if (!proposal) return;
    const op = proposal; setProposal(null);
    try {
      const freshRobots = readStore<GarageRobot[]>(GARAGE_KEY,[]);
      const fresh = readStore<Assemblies>(ASSEMBLY_KEY,{});
      const next = applyAssembly(freshRobots,fresh,op,uid('assembly'),new Date().toISOString());
      const error = writeStore(ASSEMBLY_KEY,next); if(error) throw new Error(error);
      if(op.kind === 'add') setSelected(op.instanceId);
      setNotice('Assembly saved as a new version.');
    } catch(e) { setNotice((e as Error).message); }
  };
  const add = () => {
    const part = componentById(componentId)!;
    propose({kind:'add',instanceId:uid('part'),componentId,positionM:[0,0,Number(spec.ground_clearance_m ?? 0)+0.003+part.sizeM[2]/2]});
  };
  return <section className="g-editor" id="assembly" aria-label="Robot assembly">
    <h3>Assembly workbench</h3>
    <p className="sub">This uses the latest saved robot spec. Added parts, placement and planned connections save separately from the CLI spec. These added parts are not yet included in mass, electrical or Gazebo checks. Your unsaved spec draft stays in the editor below.</p>
    <div className="g-tabs" aria-label="Workbench views">
      <button type="button" className="chip" aria-pressed={tab==='components'} onClick={()=>setTab('components')}>Components & placement</button>
      <button type="button" className="chip" aria-pressed={tab==='wiring'} onClick={()=>setTab('wiring')}>Wiring ({saved.connections.length})</button>
      <button type="button" className="chip" onClick={()=>downloadJSON('robot-assembly.json',{format:'robotforge-assembly-v1',robotId,spec,versions:all[robotId]??[]})}>Export assembly</button>
      <button type="button" className="chip" disabled={!saved.id} onClick={()=>{
        try { const fresh=readStore<Assemblies>(ASSEMBLY_KEY,{}); const next=undoAssembly(fresh,robotId,saved.id,uid('assembly'),new Date().toISOString()); const error=writeStore(ASSEMBLY_KEY,next); if(error) throw new Error(error); setProposal(null); setNotice('Previous assembly restored as a new version.'); } catch(e) {setNotice((e as Error).message);}
      }}>Undo assembly change</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {proposal && <div className="card" role="region" aria-label="Assembly operation preview">
      <strong>Preview: {previewError || preview.note}</strong>
      <p>Placement is illustrative. No fastener fit, collision, thermal or electrical validation has been performed.</p>
      <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(previewError)} onClick={apply}>Apply assembly change</button>{' '}
      <button type="button" className="btn btn-sm" onClick={()=>setProposal(null)}>Cancel</button>
    </div>}
    <p className="faint">3D: robot schematic + component envelopes. Amber dashed lines are planned connections, not routed harnesses.</p>
    <div className="g-tabs" aria-label="Assembly visualization"><button type="button" className="chip" aria-pressed={view==='3d'&&!failed3D} disabled={failed3D} onClick={()=>setView('3d')}>3D</button><button type="button" className="chip" aria-pressed={view==='top'||failed3D} onClick={()=>setView('top')}>Top view</button></div>
    {view==='3d' && !failed3D ? <Robot3D spec={spec as RobotSpec} explode={0} selected={selected} onSelect={setSelected} onFail={()=>setFailed3D(true)} instances={preview.components} connections={preview.connections}/> : <>{failed3D && <p role="status">WebGL is unavailable here. Showing the top view; positions remain editable below.</p>}<AssemblyPlan lengthM={Number(spec.length_m)} widthM={Number(spec.width_m)} instances={preview.components} connections={preview.connections} selected={selected} onSelect={setSelected}/></>}
    {tab==='components' ? <>
      <label className="g-field"><span>Add a component by name</span><select value={componentId} onChange={e=>setComponentId(e.target.value)}>{COMPONENTS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <p className="faint">{componentById(componentId)?.note}</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={add}>Preview component</button>
      <p>Or tell the Guide: <code>add a Jetson Orin Nano to "{robot?.name}"</code></p>
    </> : <>
      <h4>Planned component connections</h4>
      <p>NOT_CHECKED — these are component-to-component planning edges. Pin assignments, wire gauge, protection, voltage ranges and current ratings are not yet entered or checked. They do not alter the core harness report.</p>
      {[['From',from,setFrom],['To',to,setTo]].map(([label,value,setter])=><label className="g-field" key={String(label)}><span>{String(label)}</span><select value={String(value)} onChange={e=>(setter as (s:string)=>void)(e.target.value)}><option value="">Select component</option>{saved.components.map(c=><option value={c.id} key={c.id}>{componentById(c.componentId)?.name} ({c.id})</option>)}</select></label>)}
      <button type="button" className="btn btn-sm" disabled={!from||!to} onClick={()=>propose({kind:'connect',instanceId:from,targetId:to})}>Preview connection</button>
      <ul>{saved.connections.map(c=><li key={c.id}>{c.from} → {c.to} · NOT_CHECKED <button type="button" className="chip" onClick={()=>propose({kind:'disconnect',instanceId:c.id})}>Remove connection</button></li>)}</ul>
    </>}
    <h4>Components ({preview.components.length})</h4>
    {!preview.components.length && <p>No components yet. Add one above or through the Guide.</p>}
    <ul>{preview.components.map(c=><li key={c.id}><button type="button" className="chip" aria-pressed={selected===c.id} onClick={()=>setSelected(c.id)}>{componentById(c.componentId)?.name} · {c.id}</button> <span className="faint">{c.positionM.map(v=>Math.round(v*1000)).join(', ')} mm · yaw {c.yawDeg}°</span></li>)}</ul>
    {instance && definition && <div className="card">
      <h4>{definition.name}</h4><p>{definition.note}</p>
      <p>{definition.sizeM.map(v=>Math.round(v*1000)).join(' × ')} mm · {definition.geometry === 'published-envelope' ? 'Published envelope; simplified geometry' : 'ESTIMATED illustrative dimensions'}</p>
      {definition.source && <p><a href={definition.source} target="_blank" rel="noreferrer">Manufacturer dimension source</a></p>}
      <p>Still needed: {definition.missing.join('; ')}.</p>
      <PoseEditor key={instance.id+'-'+saved.id} instance={instance} onMove={(positionM,yawDeg)=>propose({kind:'move',instanceId:instance.id,positionM,yawDeg})}/>
      <h4>Three placement starting points</h4><p className="faint">Geometric guesses at the schematic deck surface, not fit or cooling recommendations. Inspect and adjust each preview.</p>
      {['Centre','Forward','Rear'].map((label,i)=><button type="button" className="chip" key={label} onClick={()=>propose({kind:'move',instanceId:instance.id,positionM:[i===0?0:(i===1?1:-1)*Number(spec.length_m)*0.25,0,Number(spec.ground_clearance_m??0)+0.003+definition.sizeM[2]/2],yawDeg:0})}>{label}</button>)}
      <p><button type="button" className="btn btn-sm" onClick={()=>propose({kind:'remove',instanceId:instance.id})}>Preview removal (includes attached connections)</button></p>
    </div>}
    <p className="faint">Assembly history: {(all[robotId]??[]).length} saved versions. Export includes every assembly version.</p>
  </section>;
}
