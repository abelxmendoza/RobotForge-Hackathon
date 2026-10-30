"use client";
import { componentById } from '@/lib/components';
import type { ComponentInstance, Connection } from '@/lib/assembly';
export default function AssemblyPlan({ lengthM, widthM, instances, connections, selected, onSelect }: {
  lengthM: number; widthM: number; instances: ComponentInstance[]; connections: Connection[];
  selected: string|null; onSelect: (id:string)=>void;
}) {
  const length=Number.isFinite(lengthM)&&lengthM>0?lengthM*1000:300;
  const width=Number.isFinite(widthM)&&widthM>0?widthM*1000:200;
  const extentX=Math.max(length/2,...instances.map(c=>Math.abs(c.positionM[0]*1000)+Math.hypot(...(componentById(c.componentId)?.sizeM.slice(0,2)??[0.1,0.1]))*500)) + 30;
  const extentY=Math.max(width/2,...instances.map(c=>Math.abs(c.positionM[1]*1000)+Math.hypot(...(componentById(c.componentId)?.sizeM.slice(0,2)??[0.1,0.1]))*500)) + 30;
  const font=Math.max(5,Math.min(extentX,extentY)/15);
  return <div className="card">
    <p>Top view · X forward → · Y left ↑ · outlines are envelopes; vertical separation is not shown.</p>
    <svg viewBox={`${-extentX} ${-extentY} ${extentX*2} ${extentY*2}`} style={{display:'block',width:'100%',maxHeight:360,minHeight:180}} aria-label="Top-down robot assembly">
      <rect x={-length/2} y={-width/2} width={length} height={width} fill="#132431" stroke="#91a5b8" strokeWidth="1"/>
      <text x={-length/2+4} y={-width/2+font+2} fill="#c7d4df" fontSize={font}>Robot footprint</text>
      {connections.map(c=>{
        const from=instances.find(p=>p.id===c.from),to=instances.find(p=>p.id===c.to);
        return from&&to?<line key={c.id} x1={from.positionM[0]*1000} y1={-from.positionM[1]*1000} x2={to.positionM[0]*1000} y2={-to.positionM[1]*1000} stroke="#fbbf24" strokeWidth="2" strokeDasharray="4 3"/>:null;
      })}
      {instances.map(c=>{
        const part=componentById(c.componentId); if(!part) return null;
        const l=part.sizeM[0]*1000,w=part.sizeM[1]*1000;
        return <g key={c.id} role="button" tabIndex={0} aria-label={`Select ${part.name}`} onClick={()=>onSelect(c.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(c.id);}}} transform={`translate(${c.positionM[0]*1000} ${-c.positionM[1]*1000}) rotate(${-c.yawDeg})`} style={{cursor:'pointer'}}>
          <title>{part.name}: {c.positionM.map(n=>Math.round(n*1000)).join(', ')} mm</title>
          <rect x={-l/2} y={-w/2} width={l} height={w} fill={selected===c.id?'#0d766e':'#24545e'} fillOpacity="0.75" stroke={selected===c.id?'#5eead4':'#a4e6df'} strokeWidth="1.5"/>
          <text textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(font,l/14)} fill="#ffffff" pointerEvents="none">{part.id.startsWith('jetson')?'Jetson':part.id.startsWith('battery')?'Battery':'Converter'}</text>
        </g>;
      })}
    </svg>
  </div>;
}
