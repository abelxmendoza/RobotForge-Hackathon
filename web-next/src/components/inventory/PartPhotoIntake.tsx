"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {intakePartPhoto} from '@/lib/partIntake';
import {GARAGE_KEY,type GarageRobot} from '@/lib/garage';
import {INVENTORY_KEY,type InventoryPart} from '@/lib/inventory';
import {readStore,useStore,writeStore} from '@/lib/store';
export default function PartPhotoIntake({file}:{file:File}){
  const started=useRef(false);const [id,setId]=useState('');const [error,setError]=useState('');
  const [robots]=useStore<GarageRobot[]>(GARAGE_KEY,[]);
  const [parts]=useStore<InventoryPart[]>(INVENTORY_KEY,[]);
  const part=parts.find(p=>p.id===id);
  useEffect(()=>{if(started.current)return;started.current=true;intakePartPhoto(file,null).then(result=>{setId(result.id);setError(result.warning);}).catch(e=>setError((e as Error).message));},[file]);
  return <div className="card"><strong>{id?'Saved to inventory':'Saving part photo and checking identification…'}</strong>{error&&<p role="alert">{error}</p>}{part&&<><p>{part.name} · {part.category.replace(/_/g,' ')} · needs confirmation</p><label className="g-field"><span>For robot</span><select value={part.robot_id??''} onChange={e=>{const next=readStore<InventoryPart[]>(INVENTORY_KEY,[]).map(p=>p.id===id?{...p,robot_id:e.target.value||null}:p);const failure=writeStore(INVENTORY_KEY,next);setError(failure??'');}}><option value="">Shared / unassigned</option>{robots.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><p><Link href={'/inventory/?part='+encodeURIComponent(id)}>Open saved part, specs and count →</Link></p></>}</div>;
}
