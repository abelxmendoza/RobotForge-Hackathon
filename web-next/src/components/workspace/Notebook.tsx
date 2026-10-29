'use client';
import {useState} from 'react';
import dynamic from 'next/dynamic';
import {useDispatch,useSelector} from 'react-redux';
import type {RootState} from '@/store/store';
import {requestConversation} from '@/store/assistantSlice';
import {ChatWidget} from '../chat/ChatDock';
const NotebookEditor=dynamic(()=>import('./NotebookEditor'));
export default function Notebook(){
 const dispatch=useDispatch();
 const flow=useSelector((s:RootState)=>s.assistant.flow),records=useSelector((s:RootState)=>s.workspace.records);
 const [manual,setManual]=useState(false);
 const start=(message:string)=>dispatch(requestConversation({id:crypto.randomUUID(),message}));
 const activeSpec=useSelector((s:RootState)=>s.forge.activeSpec);
 const selectedRecord=records.find(r=>r.name===activeSpec?.name||r.spec.name===activeSpec?.name);
 const draft=flow?.kind==='robot'?flow.draft:selectedRecord??null;
 const savedPreview=Boolean(draft&&flow?.kind!=='robot');
 return <section className="conversation-workshop">
  <p className="eyebrow">Your workshop, in conversation</p><h1>Tell me about your robot.</h1>
  <p className="intro">I’ll ask what I need, fill in the details and keep your robot’s record up to date. No forms required. Unknown measurements can stay unknown.</p>
  <div className="workspace-actions"><button className="btn btn-primary" onClick={()=>start('Create a robot')}>Start a robot conversation</button><button className="btn" onClick={()=>start('Log a robot sighting')}>I spotted a robot</button><button className="btn" onClick={()=>start('Create a spreadsheet')}>Create a table in chat</button></div>
  <div className="conversation-layout"><ChatWidget docked={false} embedded/>
   <aside className="conversation-preview" aria-label="Automatically filled robot record" aria-live="polite">
    <div className="card workspace-form"><p className="eyebrow">{savedPreview?"Saved robot record":"Filled in as you talk"}</p><h2>{draft?.name||'Your robot record'}</h2>{draft?<><dl><dt>Record type</dt><dd>{flow?.kind==='robot'&&flow.phase==='relationship'?'Waiting for your answer':draft.relationship}</dd><dt>Robot type</dt><dd>{draft.category||'Not provided'}</dd><dt>Location</dt><dd>{draft.location||'Unknown'}</dd>{['length_m','width_m','height_m','mass_kg'].map(k=><div key={k}><dt>{k.replace('_m',' (m)').replace('_kg',' (kg)').replace(/^./,c=>c.toUpperCase())}</dt><dd>{draft.spec[k]===undefined?'Unknown':String(draft.spec[k])}</dd></div>)}<dt>Notes</dt><dd>{draft.notes||'None yet'}</dd></dl><small>{savedPreview?"Saved in your notebook. You can keep editing through chat.":"This is a draft. I’ll say when it’s saved."} Your answers are not independently verified measurements.</small></>:flow?.kind==='table'?<><p>Spreadsheet: {flow.name||'Waiting for a name'}</p><p>Columns: {flow.columns.join(', ')||'Not provided yet'}</p></>:flow?.kind==='research'?<><p>Location: {flow.location||'Waiting for your answer'}</p><p>Interest: {flow.interest||'Not provided yet'}</p></>:<p>Start with “I own a rover called Atlas” or “I saw an underwater robot.” I’ll ask follow-up questions and assemble the record here.</p>}</div>
    <div className="card workspace-form"><h2>Saved robots <span className="faint">{records.length}</span></h2>{records.map(r=><article key={r.id} className="conversation-record"><small>{r.relationship} · {r.category}</small><h3>{r.name}</h3><p>{r.notes.slice(0,160)}</p><button className="btn" onClick={()=>dispatch(requestConversation({id:crypto.randomUUID(),editId:r.id}))}>Edit in chat</button></article>)}{!records.length&&<p>Your saved projects, research and sightings will appear here and in your data table.</p>}</div>
   </aside></div>
  <p className="muted">Records save in this browser. Say “cancel” to discard a draft. Use “Edit in chat” to change an existing record without creating a duplicate.</p>
  <details className="conversation-advanced" open={manual} onToggle={e=>setManual(e.currentTarget.open)}><summary>Optional manual editor and backups</summary>{manual&&<NotebookEditor/>}</details>
 </section>;
}
