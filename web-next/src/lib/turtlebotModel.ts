/** Visual reference routing and reversible inspection; no hardware control. */
export interface DetailedPart {id:string;name:string;color:string;explode:[number,number,number];file:string;position:[number,number,number];scale:number;ranges:[number,number][];shellCount:number;evidence:string}
export interface DetailedModel {schema:string;robot:string;revisionLabel:string;sourceRevision:string;sourceShells:number;assemblyEvidence:string;parts:DetailedPart[];teardown:string[]}
export function isDetailedBurger(spec:unknown):boolean {
 if(!spec||typeof spec!=='object')return false;
 const s=spec as {name?:string;length_m?:number;width_m?:number;height_m?:number;wheel?:{diameter_m?:number;count?:number};roverDesign?:unknown};
 return !s.roverDesign&&/^turtlebot3[ -]burger(?: \(demo\))?$/i.test(s.name??'')&&s.length_m===.178&&s.width_m===.138&&s.height_m===.192&&s.wheel?.diameter_m===.066&&s.wheel?.count===2;
}
export interface InspectionState {removed:string[];history:string[][]}
export type InspectionAction={kind:'remove'|'restore';id:string}|{kind:'undo'|'reset'|'clear'};
export function inspectionTransition(state:InspectionState,action:InspectionAction,ids:string[]):InspectionState {
 if(action.kind==='undo'){const last=state.history.at(-1);return last?{removed:last,history:state.history.slice(0,-1)}:state;}
 let removed:string[];
 if(action.kind==='reset')removed=[];
 else if(action.kind==='clear')removed=[...ids];
 else {if(!('id' in action))return state;if(!ids.includes(action.id))return state;removed=action.kind==='remove'?[...new Set([...state.removed,action.id])]:state.removed.filter(id=>id!==action.id);}
 if(JSON.stringify(removed)===JSON.stringify(state.removed))return state;
 return {removed,history:[...state.history.slice(-99),state.removed]};
}
export type InspectionCommand={kind:'select'|'remove'|'restore';name:string};
export const INSPECTION_EVENT='rf-detailed-inspection';
export function parseInspectionCommand(text:string):InspectionCommand|null {
 const m=text.trim().replace(/[.!]+$/,'').match(/^(select|remove|restore) (?:the )?([\w -]{2,60})$/i);
 return m?{kind:m[1].toLowerCase() as InspectionCommand['kind'],name:m[2].toLowerCase()}:null;
}
export function requestInspection(command:InspectionCommand){
 const result={command,handled:false,message:''};
 if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(INSPECTION_EVENT,{detail:result}));
 return result;
}

export function findInspectionParts<T extends {id:string;name:string}>(parts:T[],term:string):T[]{
 const exact=parts.find(p=>p.id===term||p.name.toLowerCase()===term);
 return exact?[exact]:parts.filter(p=>p.name.toLowerCase().includes(term)||p.id.includes(term));
}
