'use client';
import {useMemo} from 'react';
import {useSelector} from 'react-redux';
import type {RootState} from '@/store/store';
import {builtInTables} from '@/lib/workspaceData';
import type {DataTable, Cell} from '@/lib/workspace';
export function useTables(){
 const custom=useSelector((s:RootState)=>s.workspace.tables),records=useSelector((s:RootState)=>s.workspace.records);
 return useMemo(()=>{const columns=['id','name','relationship','category','location','observed_at','notes','updated_at','sources','specification'];const notebook:DataTable={id:'notebook',name:'My robot notebook',source:'Your local notebook; ownership and sighting labels are user supplied',columns,rows:records.map(r=>({id:r.id,name:r.name,relationship:r.relationship,category:r.category,location:r.location,observed_at:r.observedAt,notes:r.notes,updated_at:r.updatedAt,sources:r.sources.join(' | '),specification:JSON.stringify(r.spec)} as Record<string,Cell>))};return [...builtInTables,notebook,...custom]},[custom,records]);
}
