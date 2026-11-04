'use client';
import { useState } from 'react';
import type { Wiring } from '@/lib/wiring';
import { NODE_FACTS, CONNECTION_FACTS, saveWiringFacts } from '@/lib/wiringFacts';
const unit = (key: string) => key.endsWith('_v') || key === 'volts' ? 'V' : key.endsWith('_a') ? 'A' : key === 'length_mm' ? 'mm' : key === 'gauge_awg' ? 'AWG' : 'documented pin ID';
export default function WiringFactsEditor({ wiring, onChange }: { wiring: Wiring; onChange: (w: Wiring) => void }) {
  const [selection,setSelection] = useState('node:0');
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [kind,indexText] = selection.split(':');
  const index = Number(indexText);
  const target = kind === 'node' ? 'node' : 'connection';
  const data = (target === 'node' ? wiring.nodes[index] : wiring.connections[index]) as unknown as Record<string,unknown> | undefined;
  const cable = data?.cable as Record<string,unknown> | undefined;
  const fields = target === 'node' ? NODE_FACTS : CONNECTION_FACTS;
  return <details className="g-howto wv-notebox"><summary>Record electrical facts and connector pins</summary>
    <p>Copy values from your exact part documentation or measurements. Saved facts are marked user-entered and unverified. Empty means unknown; no value is inferred. Save each selected part or connection before switching.</p>
    <label>Part or connection <select value={selection} onChange={e=>{setSelection(e.target.value);setError('');setSaved(false);}}>
      {wiring.nodes.map((n,i)=><option key={`n${i}`} value={`node:${i}`}>{n.label}</option>)}
      {wiring.connections.map((c,i)=><option key={`c${i}`} value={`connection:${i}`}>{c.from} → {c.to} ({c.kind})</option>)}
    </select></label>
    {data && <form key={`${selection}:${JSON.stringify(data)}`} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const values=Object.fromEntries(fields.map(k=>[k,String(form.get(k) ?? '')]));try {const next=saveWiringFacts(wiring,target,index,values);onChange(next);setError('');setSaved(true);}catch(err){setError(err instanceof Error ? err.message : 'Invalid facts');setSaved(false);}}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBlock:12}}>{fields.map(key=><label key={key} style={{display:'grid',gap:4}}>{key} ({unit(key)})<input name={key} type="text" inputMode={key.endsWith('_pin') ? 'text':'decimal'} defaultValue={String(data[key] ?? cable?.[key] ?? '')} placeholder="Unknown" /></label>)}</div>
      <button type="submit" className="btn btn-sm">Save recorded facts</button>
      {error && <p role="alert">{error}</p>}{saved && <p role="status">Saved as user-entered, unverified facts.</p>}
    </form>}
  </details>;
}
