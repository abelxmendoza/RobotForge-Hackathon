"use client";
import { useRef } from 'react';
import Link from 'next/link';
import { componentById } from '@/lib/components';
import { ASSEMBLY_KEY, applyAssembly, previewAssembly, type Assemblies, type AssemblyOperation } from '@/lib/assembly';
import { GARAGE_KEY, type GarageRobot } from '@/lib/garage';
import { readStore, uid, useStore, writeStore } from '@/lib/store';
export default function AssemblyProposal({operation,onApplied,onCancel,onError}: {operation: AssemblyOperation; onApplied:(id:string)=>void; onCancel:()=>void; onError:(text:string)=>void}) {
  const [robots] = useStore<GarageRobot[]>(GARAGE_KEY,[]);
  const [all,,ready] = useStore<Assemblies>(ASSEMBLY_KEY,{});
  const consumed=useRef(false);
  let note='',error='';
  try {note=previewAssembly(robots,all,operation).note;} catch(e) {error=(e as Error).message;}
  const component=componentById(operation.componentId??'');
  return <div className="fc-msg bot" role="region" aria-label="Assembly operation preview">
    <strong>Assembly preview</strong><p>{ready ? error || note : 'Loading assembly…'}</p>
    {component && <p>{component.note}</p>}
    {operation.positionM && <p>Centre: {operation.positionM.map(v=>Math.round(v*1000)).join(', ')} mm (X forward, Y left, Z up).</p>}
    <p>Geometry and connections are planning aids. Fit, cooling and electrical compatibility are NOT_CHECKED. These added parts are not yet included in spec checks or simulation.</p>
    <button type="button" className="btn btn-primary btn-sm" disabled={!ready||Boolean(error)} onClick={()=>{
      if(consumed.current) return; consumed.current=true;
      try {
        const versionId=uid('assembly');
        const next=applyAssembly(readStore<GarageRobot[]>(GARAGE_KEY,[]),readStore<Assemblies>(ASSEMBLY_KEY,{}),operation,versionId,new Date().toISOString());
        const failure=writeStore(ASSEMBLY_KEY,next); if(failure) throw new Error(failure);
        onApplied(versionId);
      } catch(e) {onError((e as Error).message);}
    }}>Apply assembly change</button>{' '}
    <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
    <p><Link href="/garage/#assembly">Open assembly workbench in My robots</Link></p>
  </div>;
}
