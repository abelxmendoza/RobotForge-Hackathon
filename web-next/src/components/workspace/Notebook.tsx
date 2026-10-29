'use client';
import {useState} from 'react';
import {useDispatch,useSelector} from 'react-redux';
import type {RootState} from '@/store/store';
import {saveRecord,removeRecord} from '@/store/workspaceSlice';
import {setActiveRobot} from '@/store/forgeSlice';
import {downloadJSON} from '../forge/model';
import {validRecord,validTable,type RobotRecord} from '@/lib/workspace';
import PhotoCapture from '../photo/PhotoCapture';
import {saveTable} from '@/store/workspaceSlice';
const blank=():RobotRecord=>({id:'',name:'',relationship:'owned',category:'Ground rover',notes:'',location:'',observedAt:'',sources:[],spec:{},updatedAt:''});
export default function Notebook(){
 const dispatch=useDispatch(), workspace=useSelector((s:RootState)=>s.workspace),active=useSelector((s:RootState)=>s.forge.activeSpec);
 const [draft,setDraft]=useState<RobotRecord>(blank),[specText,setSpecText]=useState('{}'),[sourceText,setSourceText]=useState(''),[message,setMessage]=useState(''),[capture,setCapture]=useState(false),[search,setSearch]=useState('');
 const edit=(r:RobotRecord)=>{setDraft(r);setSpecText(JSON.stringify(r.spec,null,2));setSourceText(r.sources.join('\n'));};
 const reset=()=>{setDraft(blank());setSpecText('{}');setSourceText('');};
 const enteredSpec=(()=>{try{return JSON.parse(specText)}catch{return {}}})();
 const setMeasurement=(field:string,value:string)=>{try{const current=JSON.parse(specText);if(!current||Array.isArray(current)||typeof current!=='object')throw Error();if(value==='')delete current[field];else current[field]=Number(value);setSpecText(JSON.stringify(current,null,2));}catch{setMessage('Fix the advanced JSON before editing measurements.')}};
 const save=()=>{try{const spec=JSON.parse(specText);const record={...draft,id:draft.id||crypto.randomUUID(),name:draft.name.trim(),sources:sourceText.split('\n').map(s=>s.trim()).filter(Boolean),spec,updatedAt:new Date().toISOString()};if(!record.name||!validRecord(record))throw Error('Give the robot a name, use HTTPS source links, and enter a JSON object for its specifications.');dispatch(saveRecord(record));setMessage('Saved in this browser. Export a backup for another device.');reset();}catch(e){setMessage(e instanceof Error?e.message:'Could not save');}};
 return <section><p className="eyebrow">Your robotics notebook</p><h1>Robots, projects & sightings</h1><p>Keep your own build separate from robots you are researching or spotted elsewhere. Saved locally in this browser; no account or cloud sync is connected.</p>
 <div className="workspace-actions"><button className="btn" onClick={()=>downloadJSON({version:1,records:workspace.records,tables:workspace.tables},'robotforge-notebook.json')}>Export notebook backup</button><label className="btn">Restore backup<input type="file" accept=".json" hidden onChange={async e=>{try{const f=e.target.files?.[0];if(!f)return;if(f.size>5_000_000)throw Error('Backup must be under 5 MB');const d=JSON.parse(await f.text());if(d.version!==1||!Array.isArray(d.records)||!Array.isArray(d.tables)||!d.records.every(validRecord)||!d.tables.every(validTable))throw Error('Invalid notebook backup');d.records.forEach((r:RobotRecord)=>dispatch(saveRecord(r)));d.tables.forEach((t:Parameters<typeof saveTable>[0])=>dispatch(saveTable(t)));setMessage('Backup merged by record ID.');}catch(err){setMessage(String(err))}e.target.value='';}}/></label></div>
 <div className="workspace-grid"><form className="card workspace-form" onSubmit={e=>{e.preventDefault();save()}}><h2>{draft.id?'Edit robot':'Create a robot record'}</h2>
 <label>Robot name<input required maxLength={120} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
 <label>This is<select value={draft.relationship} onChange={e=>setDraft({...draft,relationship:e.target.value as RobotRecord['relationship']})}><option value="owned">My robot — I own or work on it</option><option value="research">Research — someone else’s robot</option><option value="sighting">Sighting — a robot I spotted</option></select></label>
 <label>Category<select value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}>{['Ground rover','Underwater / submarine','Drone / aerial','Legged robot','Arm / manipulator','Robotics community','Other robotics'].map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Location (optional)<input maxLength={160} value={draft.location} onChange={e=>setDraft({...draft,location:e.target.value})}/></label>
 <label>Observed / worked on<input type="date" value={draft.observedAt} onChange={e=>setDraft({...draft,observedAt:e.target.value})}/></label>
 <label>Build notes / what you saw<textarea rows={3} maxLength={10000} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
 <label>Sources — one HTTPS URL per line<textarea value={sourceText} onChange={e=>setSourceText(e.target.value)}/></label>
 <h3>Robot measurements</h3><p>Enter values you know, with units. These are user supplied; describe how they were measured or estimated in your notes.</p>
 <div className="workspace-grid">{[['length_m','Length (m)'],['width_m','Width (m)'],['height_m','Height (m)'],['mass_kg','Mass (kg)']].map(([field,label])=><label key={field}>{label}<input type="number" min="0" step="any" value={typeof enteredSpec?.[field]==='number'?enteredSpec[field]:''} onChange={e=>setMeasurement(field,e.target.value)}/></label>)}</div>
 <details><summary>Advanced specification JSON</summary><label>Specifications (JSON; retain units and estimated labels)<textarea rows={6} value={specText} onChange={e=>setSpecText(e.target.value)}/></label></details>
 <button className="btn" type="button" disabled={!active} onClick={()=>setSpecText(JSON.stringify(active,null,2))}>Use current chat / Forge specification</button>
 {draft.photo&&<img src={draft.photo} alt="Robot record" style={{maxHeight:180,maxWidth:'100%'}}/>}<button type="button" className="btn" onClick={()=>setCapture(true)}>Add or retake photo</button>
 <div className="workspace-actions"><button className="btn btn-primary" type="submit">Save robot</button><button className="btn" type="button" onClick={reset}>New record</button></div></form>
 <div className="workspace-form"><label>Find my records<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, club, category, notes…"/></label>
 {workspace.records.filter(r=>JSON.stringify(r).toLowerCase().includes(search.toLowerCase())).map(r=><article className="card" key={r.id} style={{marginTop:12,padding:20}}><small>{r.relationship} · {r.category}</small><h2>{r.name}</h2>{r.photo&&<img src={r.photo} alt={r.name} style={{maxWidth:'100%',maxHeight:160}}/>}<p>{r.notes}</p><p>{r.location} {r.observedAt}</p>{r.sources.map(s=><p key={s}><a href={s} target="_blank" rel="noreferrer">{s}</a></p>)}<div className="workspace-actions"><button className="btn" onClick={()=>edit(r)}>Edit</button><button className="btn" onClick={()=>{dispatch(setActiveRobot({spec:{...r.spec,name:r.name},source:'Notebook: '+r.relationship}));setMessage(r.name+' is now the active robot for chat.')}}>Discuss this robot</button><button className="btn" onClick={()=>{dispatch(removeRecord(r.id));setMessage('Removed from local notebook; exported backups remain.')}}>Remove</button></div></article>)}{!workspace.records.length&&<p>Create your first robot here. Your records also appear as a table on the Data page.</p>}</div></div>
 <p role="status">{message}</p>{capture&&<PhotoCapture onClose={()=>setCapture(false)} onSelect={async(file)=>{const {prepareImage}=await import('../photo/image');const image=await prepareImage(file,480);setDraft(d=>({...d,photo:image}));setCapture(false);}}/>}</section>;
}
