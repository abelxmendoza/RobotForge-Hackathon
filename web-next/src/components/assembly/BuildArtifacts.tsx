'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { generateCad } from '@/lib/cadGen';
import { generateMount, mountDefaults, enclosureFit, type MountOptions } from '@/lib/buildArtifacts';
import type { ComponentDefinition } from '@/lib/components';
import { downloadJSON, downloadText, readStore, writeStore } from '@/lib/store';
import { assetPath } from '@/components/home/asset';
import styles from './BuildArtifacts.module.css';

const PrintPreview = dynamic(()=>import('./PrintPreview'),{ssr:false,loading:()=> <p>Loading printable geometry…</p>});
const DESIGN_KEY='rf.build-designs.v1';
interface EnclosureOptions { length_mm:number; width_mm:number; height_mm:number; wall_mm:number; clearance_mm:number; cable_dia_mm:number; cable_count:number }
interface SavedDesign { robotId:string; robotVersionId:string; componentId:string; mount:MountOptions; enclosure:EnclosureOptions }
const round=(n:number)=>Math.round(n*10)/10;

export default function BuildArtifacts({part,robotId,robotVersionId}:{part:ComponentDefinition;robotId:string;robotVersionId:string}) {
  const [kind,setKind]=useState<'mount'|'enclosure'>('mount');
  const [mountOptions,setMountOptions]=useState<MountOptions>(()=>mountDefaults(part));
  const [enclosureOptions,setEnclosureOptions]=useState<EnclosureOptions>(()=>({length_mm:round(part.sizeM[0]*1000+16),width_mm:round(part.sizeM[1]*1000+16),height_mm:round(Math.max(32,part.sizeM[2]*1000+part.mounting.standoffHeightMm+12)),wall_mm:2,clearance_mm:.3,cable_dia_mm:8,cable_count:2}));
  const [preview3D,setPreview3D]=useState(false);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const mount=useMemo(()=>{try{return {value:generateMount(mountOptions,part),error:''};}catch(e){return {value:null,error:(e as Error).message};}},[mountOptions,part]);
  const enclosure=useMemo(()=>{try{return {value:generateCad({template:'enclosure',params:{...enclosureOptions}}),error:''};}catch(e){return {value:null,error:(e as Error).message};}},[enclosureOptions]);
  const error=kind==='mount'?mount.error:enclosure.error;
  const fit=useMemo(()=>enclosureFit(enclosureOptions,part),[enclosureOptions,part]);
  const componentFits=fit.fits;
  const save=()=>{
    const design:SavedDesign={robotId,robotVersionId,componentId:part.id,mount:mountOptions,enclosure:enclosureOptions};
    const records=readStore<Record<string,SavedDesign>>(DESIGN_KEY,{});
    const err=writeStore(DESIGN_KEY,{...records,[robotId+':'+part.id]:design});
    setNotice(err??'Build dimensions saved for this component and robot version.');
  };
  const restore=()=>{
    const saved=readStore<Record<string,SavedDesign>>(DESIGN_KEY,{})[robotId+':'+part.id];
    if(!saved){setNotice('No saved build dimensions for this component yet.');return;}
    if(saved.robotVersionId!==robotVersionId){setNotice('Robot version changed. Saved dimensions need review; they were not restored.');return;}
    setMountOptions(saved.mount);setEnclosureOptions(saved.enclosure);setNotice('Saved build dimensions restored.');
  };
  const exportRecord=()=>downloadJSON('robotforge-build-design.json',{format:'robotforge-build-design-v1',robotId,robotVersionId,componentId:part.id,componentSource:part.source,mount:mount.value,enclosure:enclosure.value,assumptions:['Component envelope and mounting pattern require physical confirmation.','No structural, thermal, waterproofing or electrical safety certification.']});
  const exportStl=async()=>{
    if(!mount.value)return;
    setBusy(true);setNotice('');
    let geometry:import('three').BufferGeometry|undefined;
    let material:import('three').Material|undefined;
    try{
      const [{Mesh,MeshBasicMaterial},{STLExporter},{mountGeometry}]=await Promise.all([import('three'),import('three/examples/jsm/exporters/STLExporter.js'),import('@/lib/mountMesh')]);
      geometry=mountGeometry(mount.value);material=new MeshBasicMaterial();
      const mesh=new Mesh(geometry,material);
      downloadText('component-mount-mm.stl',new STLExporter().parse(mesh),'model/stl');
      setNotice('Mount STL exported in millimetres. Confirm the mounting pattern and slicer scale before printing.');
    }catch(e){setNotice('STL export failed: '+(e as Error).message);}finally{geometry?.dispose();material?.dispose();setBusy(false);}
  };
  const field=(label:string,value:number,onChange:(n:number)=>void,min:number,max:number,step=1)=><label key={label} className="g-field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={Number.isFinite(value)?value:''} onChange={e=>{setNotice('');onChange(e.target.value===''?NaN:Number(e.target.value));}}/></label>;
  return <section className={styles.panel} aria-label="Generate printable parts">
    <div className={styles.heading}><h3>Generate printable parts</h3><span className="fbadge">Parametric CAD</span></div>
    <p className={styles.note}>Design around <strong>{part.name}</strong>. Dimensions start from its recorded envelope; confirm measurements and mounting holes before printing.</p>
    <div className={styles.tabs} role="group" aria-label="Printable part type">
      <button type="button" className="chip" aria-pressed={kind==='mount'} onClick={()=>{setKind('mount');setNotice('');}}>Component mount</button>
      <button type="button" className="chip" aria-pressed={kind==='enclosure'} onClick={()=>{setKind('enclosure');setNotice('');}}>Harness enclosure</button>
    </div>
    <div className={styles.grid}>
      <div><div className={styles.fields}>
        {kind==='mount'?<>
          {field('Plate length (mm)',mountOptions.lengthMm,n=>setMountOptions(o=>({...o,lengthMm:n})),1,600)}
          {field('Plate width (mm)',mountOptions.widthMm,n=>setMountOptions(o=>({...o,widthMm:n})),1,600)}
          {field('Plate thickness (mm)',mountOptions.thicknessMm,n=>setMountOptions(o=>({...o,thicknessMm:n})),.5,30,.1)}
          {field('Hole diameter (mm)',mountOptions.holeDiameterMm,n=>setMountOptions(o=>({...o,holeDiameterMm:n})),.5,20,.1)}
        </>:<>
          {field('Box length (mm)',enclosureOptions.length_mm,n=>setEnclosureOptions(o=>({...o,length_mm:n})),10,500)}
          {field('Box width (mm)',enclosureOptions.width_mm,n=>setEnclosureOptions(o=>({...o,width_mm:n})),10,500)}
          {field('Box height (mm)',enclosureOptions.height_mm,n=>setEnclosureOptions(o=>({...o,height_mm:n})),10,500)}
          {field('Wall thickness (mm)',enclosureOptions.wall_mm,n=>setEnclosureOptions(o=>({...o,wall_mm:n})),1,10,.1)}
          {field('Lid clearance / side (mm)',enclosureOptions.clearance_mm,n=>setEnclosureOptions(o=>({...o,clearance_mm:n})),0,2,.05)}
          {field('Cable hole diameter (mm)',enclosureOptions.cable_dia_mm,n=>setEnclosureOptions(o=>({...o,cable_dia_mm:n})),1,80,.5)}
          {field('Cable holes',enclosureOptions.cable_count,n=>setEnclosureOptions(o=>({...o,cable_count:n})),0,12)}
        </>}
      </div>
      {error&&<p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {kind==='mount'?<>
          <button type="button" className="btn btn-sm btn-primary" disabled={!mount.value} onClick={()=>mount.value&&downloadText(mount.value.filename,mount.value.source)}>Download mount CAD</button>
          <button type="button" className="btn btn-sm" disabled={!mount.value||busy} onClick={()=>void exportStl()}>{busy?'Exporting…':'Download STL'}</button>
        </>:<>
          <button type="button" className="btn btn-sm btn-primary" disabled={!enclosure.value} onClick={()=>enclosure.value&&downloadText(enclosure.value.filename,enclosure.value.source)}>Download enclosure CAD</button>
          {enclosure.value?.files?.map(f=><button type="button" className="btn btn-sm" key={f.filename} onClick={()=>downloadText(f.filename,f.source)}>Download {f.filename.includes('lid')?'lid':'box'}</button>)}
        </>}
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn-sm" disabled={!!mount.error||!!enclosure.error} onClick={save}>Save dimensions</button>
        <button type="button" className="btn btn-sm" onClick={restore}>Restore saved</button>
        <button type="button" className="btn btn-sm" disabled={!!mount.error||!!enclosure.error} onClick={exportRecord}>Export design record</button>
      </div>
      </div>
      <div>
        {kind==='mount'&&mount.value?<>
          <div className={styles.preview}><svg role="img" aria-label="Dimensioned mounting plate, top view" viewBox={`${-mount.value.lengthMm/2-15} ${-mount.value.widthMm/2-15} ${mount.value.lengthMm+30} ${mount.value.widthMm+30}`}>
            <rect x={-mount.value.lengthMm/2} y={-mount.value.widthMm/2} width={mount.value.lengthMm} height={mount.value.widthMm} rx="0" fill="#258e89" stroke="#8df5e7" strokeWidth=".5"/>
            <rect x={-part.sizeM[0]*500} y={-part.sizeM[1]*500} width={part.sizeM[0]*1000} height={part.sizeM[1]*1000} fill="none" stroke="#a7c9e8" strokeDasharray="2 2" strokeWidth=".5"/>
            {mount.value.holes.map(([x,y],i)=><circle key={i} cx={x} cy={-y} r={mount.value!.holeDiameterMm/2} fill="#101c2b" stroke="#e3fffa" strokeWidth=".4"/>)}
          </svg></div>
          <p className={styles.note}>{mount.value.lengthMm} × {mount.value.widthMm} × {mount.value.thicknessMm} mm · {mount.value.holes.length} mounting holes. Dashed outline: component footprint.</p>
          <button type="button" className="btn btn-sm" aria-pressed={preview3D} onClick={()=>setPreview3D(v=>!v)}>{preview3D?'Hide':'Show'} printable 3D preview</button>
          {preview3D&&<PrintPreview mount={mount.value}/>}
          <details className="ws-disclosure"><summary>Fit checks and assumptions</summary>{mount.value.warnings.map(w=><p className={styles.note} key={w}>{w}</p>)}</details>
        </>:kind==='enclosure'&&enclosure.value?<>
          <div className={styles.preview}><svg role="img" aria-label="Enclosure top section and cable opening plan" viewBox={`-10 -10 ${enclosureOptions.length_mm+20} ${enclosureOptions.width_mm+20}`}>
            <rect width={enclosureOptions.length_mm} height={enclosureOptions.width_mm} fill="#258e89" stroke="#8df5e7" strokeWidth=".6"/>
            <rect x={enclosureOptions.wall_mm} y={enclosureOptions.wall_mm} width={fit.length} height={fit.width} fill="#101c2b" stroke="#76b7b7" strokeWidth=".5"/>
            <rect x={(enclosureOptions.length_mm-part.sizeM[0]*1000)/2} y={(enclosureOptions.width_mm-part.sizeM[1]*1000)/2} width={part.sizeM[0]*1000} height={part.sizeM[1]*1000} fill="none" stroke={componentFits?'#a7c9e8':'#fda4af'} strokeDasharray="2 2" strokeWidth=".7"/>
            {Array.from({length:enclosureOptions.cable_count},(_,i)=><line key={i} x1={enclosureOptions.wall_mm+(i+1)*fit.length/(enclosureOptions.cable_count+1)-enclosureOptions.cable_dia_mm/2} x2={enclosureOptions.wall_mm+(i+1)*fit.length/(enclosureOptions.cable_count+1)+enclosureOptions.cable_dia_mm/2} y1="0" y2="0" stroke="#fbbf24" strokeWidth="2"/>)}
          </svg></div>
          <p className={styles.note}>Top section · usable {fit.length} × {fit.width} × {fit.height} mm, reserving the lid-lip band. Yellow: cable entries; dashed: component footprint.</p>
          {!componentFits&&<p role="alert" className={styles.error}>This enclosure does not fit the selected component and its recorded standoff height. Increase its dimensions.</p>}
          <p className={styles.note}>Separate box and loose locating-lip lid. No fastener retention, sealing, strain relief or cooling is verified. Open the CAD in OpenSCAD and render each part to export enclosure STL.</p>
          {enclosureOptions.length_mm>220||enclosureOptions.width_mm>220?<p className={styles.error}>Box exceeds the assumed 220 × 220 mm printer bed.</p>:null}
          {enclosure.value.alternateExports?.map(alt=><details className="ws-disclosure" key={alt.filename}><summary>YAPP enclosure export · open-source generator</summary>
            <p className={styles.note}>Alternative YAPP box with its own ridge/lid fit. Download the wrapper and dependencies into the same folder. This is a separate design; review its dimensions and clearance in OpenSCAD.</p>
            <button type="button" className="btn btn-sm" onClick={()=>downloadText(alt.filename,alt.source)}>Download YAPP wrapper</button>{' '}
            {alt.dependencies.map(d=><a key={d.filename} className="btn btn-sm" href={assetPath(d.url.replace(/^\//,''))} download={d.filename}>{d.filename}</a>)}
          </details>)}
        </>:<p className={styles.note}>Enter valid dimensions to preview this part.</p>}
      </div>
    </div>
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
