'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { ASSEMBLY_KEY, effectiveAssemblies, currentAssembly, type Assemblies } from '@/lib/assembly';
import { planUpgrade, applyUpgrade, UPGRADE_BOARDS, type UpgradeInputs, type UpgradeBoardId } from '@/lib/upgradePlan';
import { downloadText, readStore, useStore, writeStore, uid } from '@/lib/store';

export interface UpgradeRequest {robotId:string;expectedRobotVersionId:string;expectedAssemblyRevision:string|null;boardId?:UpgradeBoardId;inputs?:UpgradeInputs}
export default function UpgradeProposal({request,onApplied,onCancel,onInputsChange}:{request:UpgradeRequest;onApplied:(id:string)=>void;onCancel:()=>void;onInputsChange:(inputs:UpgradeInputs)=>void}) {
  const [robots,,ready]=useStore<GarageRobot[]>(GARAGE_KEY,[]);
  const [legacy,,assemblyReady]=useStore<Assemblies>(ASSEMBLY_KEY,{});
  const [base,setBase]=useState(request);
  const inputs=request.inputs ?? {};
  const updateInputs=(patch:Partial<UpgradeInputs>)=>onInputsChange({...inputs,...patch});
  const [error,setError]=useState('');
  const used=useRef(false);
  const robot=robots.find(r=>r.id===base.robotId&&!r.archivedAt);
  const assembly=robot?currentAssembly(effectiveAssemblies(robots,legacy),robot.id):null;
  const stale=!robot||robot.versions.at(-1)?.id!==base.expectedRobotVersionId||(assembly?.id||null)!==base.expectedAssemblyRevision;
  const result=useMemo(()=>{
    if(!ready||!assemblyReady||!robot||!assembly||stale)return {plan:null,error:''};
    try{return {plan:planUpgrade(robot,assembly,inputs,base.boardId??'raspberry-pi-5-sbc'),error:''};}
    catch(e){return {plan:null,error:(e as Error).message};}
  },[ready,assemblyReady,robot,assembly,stale,inputs,base.boardId]);
  const plan=result.plan;
  const refresh=()=>{
    const fresh=readStore<GarageRobot[]>(GARAGE_KEY,[]),r=fresh.find(r=>r.id===request.robotId&&!r.archivedAt);
    if(!r?.versions.at(-1)){setError('This saved robot is no longer active.');return;}
    const a=currentAssembly(effectiveAssemblies(fresh,readStore<Assemblies>(ASSEMBLY_KEY,{})),r.id);
    setBase({robotId:r.id,expectedRobotVersionId:r.versions.at(-1)!.id,expectedAssemblyRevision:a.id||null});onInputsChange({});setError('');
  };
  const numeric=(label:string,key:keyof UpgradeInputs)=><label className="g-field" key={key}><span>{label}</span><input type="number" step="any" min="0" value={typeof inputs[key]==='number'&&Number.isFinite(inputs[key])?String(inputs[key]):''} placeholder="Unknown — use documented values" onChange={e=>{updateInputs({[key]:e.target.value===''?undefined:Number(e.target.value)});setError('');}}/></label>;
  const note=(label:string,key:keyof UpgradeInputs)=><label className="g-field" key={key}><span>{label}</span><input type="text" maxLength={1000} value={typeof inputs[key]==='string'?String(inputs[key]):''} placeholder="Documented reference / measurement" onChange={e=>updateInputs({[key]:e.target.value||undefined})}/></label>;
  return <section className="fc-msg bot" role="region" aria-label="Coordinated robot upgrade proposal">
    <strong>Wrench upgrade proposal · Raspberry {UPGRADE_BOARDS[base.boardId??'raspberry-pi-5-sbc'].short}</strong>
    <p>{robot?.name??'Saved robot'} · one planned version for the assembly, wiring and printable designs.</p>
    <p>Uses the latest saved robot, not unsaved Specs edits. You approve a plan; this is not authorization to power the hardware.</p>
    {stale&&ready&&<p role="alert">This proposal is stale or its robot was removed. Refresh it before applying. <button type="button" className="btn btn-sm" onClick={refresh}>Refresh saved version</button></p>}
    {!ready||!assemblyReady?<p>Loading saved robot…</p>:null}
    <details open className="ws-disclosure"><summary>Power facts and missing evidence</summary>
      <p>Blank fields use explicit saved facts where available. Nominal battery voltage is never expanded into a full charge/discharge range. Entries below are user-entered and unverified. You can also tell Wrench “battery voltage is 9 to 12.6 V” or “load is 2 A” while this proposal is open.</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10}}>
        {numeric('Battery minimum operating voltage (V)','supplyMinV')}
        {numeric('Battery maximum operating voltage (V)','supplyMaxV')}
        {numeric('Pi + peripheral design load (A)','loadCurrentA')}
        {numeric('Pi documented minimum input (V)','loadMinV')}
        {numeric('Pi documented maximum input (V)','loadMaxV')}
        {numeric('Converter qualified continuous output (A)','qualifiedConverterCurrentA')}
        {note('Qualification reference for this setup','qualificationSource')}
        {note('Temperature, cooling and operating conditions','thermalConditions')}
        {note('Power connector / USB-PD interface evidence','interfaceEvidence')}
      </div>
      <label><input type="checkbox" checked={inputs.powerInterfaceConfirmed===true} onChange={e=>updateInputs({powerInterfaceConfirmed:e.target.checked})}/> I have checked the documented power delivery interface for this setup.</label>
      <p className="faint">A converter&apos;s output amperage does not establish USB-PD support. Do not enter the Pi&apos;s recommended supply capacity as if it were a measured load.</p>
    </details>
    {(error||result.error)&&<p role="alert">{error||result.error}</p>}
    {plan&&<>
      <p>{plan.summary}</p>
      {plan.candidate&&<p><strong>Converter candidate: {plan.candidate.name}</strong> · <a href={plan.candidate.url} target="_blank" rel="noreferrer">Manufacturer evidence</a><br/>{plan.candidate.note}</p>}
      {!!plan.blockers.length&&<div role="alert"><strong>Cannot apply this proposal</strong><ul>{plan.blockers.map((s,i)=><li key={i}>{s}</li>)}</ul></div>}
      {!!plan.missing.length&&<div><strong>Incomplete · still needs evidence</strong><ul>{plan.missing.map((s,i)=><li key={i}>{s}</li>)}</ul></div>}
      {!!plan.warnings.length&&<details className="ws-disclosure"><summary>Assumptions and limits</summary><ul>{plan.warnings.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
      <details className="ws-disclosure"><summary>Proposed assembly and wiring</summary>
        <p>{plan.assembly.components.length} assembly components · {plan.wiring.connections.length} documented/planned wiring connections.</p>
        <ul>{plan.wiring.connections.map((c,i)=><li key={i}>{c.from} → {c.to} · {c.kind} · {c.volts==null?'voltage not specified':`${c.volts} V`}</li>)}</ul>
        <p>Pin assignments, cable protection, mounting fit and cable cut lengths remain unchecked unless separately documented.</p>
      </details>
      <details className="ws-disclosure"><summary>Electrical check evidence</summary>
        {plan.checks.map((c,i)=><p key={i}><strong>{c.check} · {c.coverage} · {c.severity}</strong><br/>{c.subject}: {c.detail}{c.missing.length?` Missing: ${c.missing.join('; ')}`:''}</p>)}
      </details>
      <details className="ws-disclosure"><summary>Printable designs · planned, fit unverified</summary>
        {plan.artifacts.map(a=><p key={a.filename}><button type="button" className="btn btn-sm" onClick={()=>downloadText(a.filename,a.source)}>Download {a.filename}</button></p>)}
        <p>Generated from the same Pi component record. Cooler height, connector access and physical fit still need confirmation.</p>
      </details>
      <button type="button" className="btn btn-primary btn-sm" disabled={stale||!!plan.blockers.length} onClick={()=>{
        if(used.current)return;used.current=true;
        try{
          const id=uid('v');
          const next=applyUpgrade(readStore<GarageRobot[]>(GARAGE_KEY,[]),readStore<Assemblies>(ASSEMBLY_KEY,{}),plan,id,new Date().toISOString());
          const failure=writeStore(GARAGE_KEY,next);if(failure)throw new Error(failure);
          onApplied(id);
        }catch(e){used.current=false;setError((e as Error).message);}
      }}>{plan.missing.length?'Save incomplete upgrade plan':'Apply planned upgrade'}</button>{' '}
    </>}
    <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel upgrade</button>
    <p><Link href={`/garage/#robot=${encodeURIComponent(request.robotId)}&tab=build`}>Open this robot in the Workshop</Link></p>
  </section>;
}
