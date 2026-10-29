"use client";
import { useRef, useEffect, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { setFlow } from "./assistantSlice";
import { validFlow } from "@/lib/conversation";
import { setActiveRobot } from "./forgeSlice";
import { hydrate } from "./workspaceSlice";
import { validTable, validRecord } from "@/lib/workspace";
import { makeStore, type AppStore } from "./store";

export default function Providers({ children }: { children: ReactNode }) {
  const ref = useRef<AppStore | null>(null);
  if (!ref.current) ref.current = makeStore();
  const [storageError,setStorageError]=useState('');
  useEffect(()=>{
    const store=ref.current!;
    let tables=[],records=[];let storageReadable=true,applyingStorage=false;
    try { const raw=localStorage.getItem('robotforge-notebook-v1');if(raw){if(raw.length>5_000_000)throw Error('Stored notebook is too large');const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.tables)||!Array.isArray(saved.records)||!saved.tables.every(validTable)||!saved.records.every(validRecord))throw Error("Unsupported or invalid notebook schema");tables=Array.isArray(saved.tables)?saved.tables.filter(validTable):[];records=Array.isArray(saved.records)?saved.records.filter(validRecord):[];} }
    catch {storageReadable=false;setStorageError('Saved notebook could not be read. New changes remain in this session; export a backup.');}
    store.dispatch(hydrate({tables,records}));
    try{const raw=sessionStorage.getItem('robotforge-active-spec-v1');if(raw&&raw.length<50000){const active=JSON.parse(raw);if(active?.spec&&typeof active.spec==='object'&&!Array.isArray(active.spec)&&typeof active.source==='string')store.dispatch(setActiveRobot(active));}}catch{/* Active context is optional. */}
    try{const raw=sessionStorage.getItem('robotforge-conversation-draft-v1');if(raw&&raw.length<500000){const draft=JSON.parse(raw);if(validFlow(draft,validRecord))store.dispatch(setFlow(draft));}}catch{/* Invalid drafts never become writes. */}
    let previousFlow=store.getState().assistant.flow;
    let previousSpec=store.getState().forge.activeSpec;

    let previous=store.getState().workspace;
    const unsubscribe=store.subscribe(()=>{
      const currentFlow=store.getState().assistant.flow;
      if(currentFlow!==previousFlow){previousFlow=currentFlow;try{if(currentFlow)sessionStorage.setItem('robotforge-conversation-draft-v1',JSON.stringify(currentFlow));else sessionStorage.removeItem('robotforge-conversation-draft-v1');}catch{setStorageError('The conversation draft is only in this session. Saved notebook records are unchanged.');}}
      const forge=store.getState().forge;
      if(forge.activeSpec!==previousSpec){previousSpec=forge.activeSpec;try{if(forge.activeSpec)sessionStorage.setItem('robotforge-active-spec-v1',JSON.stringify({spec:forge.activeSpec,source:forge.source}));else sessionStorage.removeItem('robotforge-active-spec-v1');}catch{/* Notebook export remains available. */}}
      const next=store.getState().workspace;if(next.tables===previous.tables&&next.records===previous.records)return;previous=next;
      if(applyingStorage||!storageReadable)return;
      try{localStorage.setItem('robotforge-notebook-v1',JSON.stringify({version:1,tables:next.tables,records:next.records}));setStorageError('');}
      catch{setStorageError('Browser storage is full or unavailable. Changes are only in this session. Export a notebook backup before closing.');}
    });
    const onStorage=(event:StorageEvent)=>{if(event.key!=='robotforge-notebook-v1'||!event.newValue)return;try{if(event.newValue.length>5_000_000)return;const saved=JSON.parse(event.newValue);if(saved.version!==1||!Array.isArray(saved.tables)||!saved.tables.every(validTable)||!Array.isArray(saved.records)||!saved.records.every(validRecord))return;applyingStorage=true;store.dispatch(hydrate({tables:saved.tables,records:saved.records}));}catch{/* Ignore malformed external-tab data. */}finally{applyingStorage=false}};
    window.addEventListener('storage',onStorage);
    return ()=>{unsubscribe();window.removeEventListener('storage',onStorage)};
  },[]);
  return <Provider store={ref.current}>{storageError&&<div role="alert" style={{padding:12,background:"#3a250f",color:"#ffe1a0"}}>{storageError}</div>}{children}</Provider>;
}
