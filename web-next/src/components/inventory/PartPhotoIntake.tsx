"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {intakePartPhoto} from '@/lib/partIntake';
import {INVENTORY_KEY,type InventoryPart} from '@/lib/inventory';
import {useStore} from '@/lib/store';
import {promptWrench} from '@/lib/wrenchPrompt';
export default function PartPhotoIntake({file}:{file:File}){
 const started=useRef(false);const [id,setId]=useState('');const [error,setError]=useState('');
 const [parts]=useStore<InventoryPart[]>(INVENTORY_KEY,[]);const part=parts.find(p=>p.id===id);
 useEffect(()=>{if(started.current)return;started.current=true;intakePartPhoto(file,null).then(result=>{setId(result.id);setError(result.warning);}).catch(e=>setError((e as Error).message));},[file]);
 return <div className="card"><strong>{id?'Photo saved to Library':'Saving your part photo…'}</strong>{error&&<p role="alert">{error}</p>}{part&&<><p>{part.name} · needs identification confirmation</p><button className="btn btn-sm" onClick={()=>promptWrench({mode:'chat',text:`Confirm part "${part.id}"`})}>Confirm through Wrench</button><p><Link href={'/inventory/?part='+encodeURIComponent(id)}>Open part details →</Link></p></>}</div>;
}
