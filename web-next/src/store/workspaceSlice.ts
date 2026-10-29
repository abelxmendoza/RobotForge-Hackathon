import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { DataTable, RobotRecord } from '@/lib/workspace';
interface WorkspaceState { tables:DataTable[]; records:RobotRecord[]; selectedTable:string; loaded:boolean; }
const initialState: WorkspaceState={tables:[],records:[],selectedTable:'robots',loaded:false};
const slice=createSlice({name:'workspace',initialState,reducers:{
  hydrate(state,action:PayloadAction<{tables:DataTable[];records:RobotRecord[]}>){state.tables=action.payload.tables;state.records=action.payload.records;state.loaded=true;},
  saveRecord(state,action:PayloadAction<RobotRecord>){const i=state.records.findIndex(r=>r.id===action.payload.id);if(i<0)state.records.push(action.payload);else state.records[i]=action.payload;},
  removeRecord(state,action:PayloadAction<string>){state.records=state.records.filter(r=>r.id!==action.payload);},
  saveTable(state,action:PayloadAction<DataTable>){const i=state.tables.findIndex(t=>t.id===action.payload.id);if(i<0)state.tables.push(action.payload);else state.tables[i]=action.payload;state.selectedTable=action.payload.id;},
  selectTable(state,action:PayloadAction<string>){state.selectedTable=action.payload;},
  removeTable(state,action:PayloadAction<string>){state.tables=state.tables.filter(t=>t.id!==action.payload);if(state.selectedTable===action.payload)state.selectedTable='robots';}
}});
export const {hydrate,saveTable,selectTable,removeTable,saveRecord,removeRecord}=slice.actions; export default slice.reducer;
