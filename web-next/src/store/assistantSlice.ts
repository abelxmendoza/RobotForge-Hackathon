import {createSlice,type PayloadAction} from '@reduxjs/toolkit';
import type {Flow} from '@/lib/conversation';
import type {Hit} from '@/components/chat/engine';
import type {PartialSpec} from '@/components/forge/model';
export interface ChatMessage {id:number;who:'bot'|'user';html?:string;text?:string;hits?:Hit[];image?:string;draft?:{spec:PartialSpec;image:string;note:string;source:string};}
interface AssistantState {flow:Flow|null;messages:ChatMessage[];request:{id:string;message?:string;editId?:string}|null;photo:{image:string;thumbnail:string}|null;}
const initialState:AssistantState={flow:null,messages:[],request:null,photo:null};
const slice=createSlice({name:'assistant',initialState,reducers:{
 setPendingPhoto(state,a:PayloadAction<AssistantState['photo']>){state.photo=a.payload;},
 setFlow(state,a:PayloadAction<Flow|null>){state.flow=a.payload;},
 setChatMessages(state,a:PayloadAction<ChatMessage[]>){state.messages=a.payload.slice(-80);},
 requestConversation(state,a:PayloadAction<AssistantState['request']>){state.request=a.payload;},
 clearChat(state){state.flow=null;state.messages=[];state.request=null;state.photo=null;}
}});
export const {setFlow,setChatMessages,requestConversation,clearChat,setPendingPhoto}=slice.actions;export default slice.reducer;
