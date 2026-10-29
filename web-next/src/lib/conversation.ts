/** Local action agent: explicit conversational state and deterministic writes.
 * No model-generated response can execute a save or change ownership. */
import type { DataTable, RobotRecord } from './workspace';
export type Flow =
  | {kind:'robot'; phase:'relationship'|'name'|'category'|'goal'|'details'|'edit'; draft:RobotRecord; editing:boolean; pendingLength?:number}
  | {kind:'table'; phase:'tableName'|'columns'|'rows'; name:string; columns:string[]}
  | {kind:'research'; phase:'location'|'interest'|'design'; location:string; interest:string; query:string; models:boolean};
export interface ConversationContext {
  records:RobotRecord[]; id:string; now:string; today:string;
  seed?:Record<string,unknown>|null;
}
export interface AgentTurn {handled:boolean; flow:Flow|null; reply:string; chips?:string[]; saveRobot?:RobotRecord; saveTable?:DataTable; research?:{route:'/research'|'/models';query:string};tableRows?:string;}
const skip = /^(?:skip|unknown|i (?:do not|don't|dont) know|not sure|nothing(?: else)?|no(?:ne)?|done|that's all|thats all|save(?: it)?|finish|empty)[.!\s]*$/i;
const categoryOf=(s:string)=>/underwater|submarine|\brov\b|\bauv\b|robosub/i.test(s)?'Underwater / submarine':/drone|aerial|quadcopter|\buav\b/i.test(s)?'Drone / aerial':/quadruped|humanoid|legged|robot dog/i.test(s)?'Legged robot':/manipulator|robot(?:ic)? arm|gripper/i.test(s)?'Arm / manipulator':/rover|wheeled|ground robot|differential|skid.steer/i.test(s)?'Ground rover':/club|university|team|community/i.test(s)?'Robotics community':/other/i.test(s)?'Other robotics':null;
const relationshipOf=(s:string):RobotRecord['relationship']|null=>/\bsighting\b|\bspotted\b|\bsaw (?:a|this|the|it)\b/i.test(s)?'sighting':/someone else|not mine|not my robot|research(?:ing)?|don't own|do not own/i.test(s)?'research':/\bi'm (?:building|working on)\b|\bowned\b|\bmine\b|my (?:own )?(?:robot|rover|drone|project)|\bi (?:own|built|am (?:building|working)|work on|'m (?:building|working))\b/i.test(s)?'owned':null;
const nameOf=(s:string)=>{
 const match=s.match(/(?:\b(?:named|called)|(?:its|the) name is|rename(?: (?:it|the robot))? to)\s+["“']?([^\n,.!?"”']{1,100})/i);
 return match?match[1].split(/\s+(?:and|with|that|which|weighs|measures|is a|it's a)\s+/i)[0].trim():null;
};
const cleanAnswer=(s:string)=>s.trim().replace(/^(?:it(?:'s| is)|this is|a|an)\s+/i,'').replace(/[.!]+$/,'');
const units:Record<string,number>={mm:.001,cm:.01,m:1,inch:.0254,inches:.0254,in:.0254,ft:.3048,kg:1,g:.001,lb:.45359237,lbs:.45359237};
function measurements(s:string):Record<string,number>{
 const result:Record<string,number>={};
 const labels:Record<string,string>={length:'length_m',long:'length_m',width:'width_m',wide:'width_m',height:'height_m',high:'height_m',tall:'height_m',mass:'mass_kg',weight:'mass_kg',weighs:'mass_kg',weigh:'mass_kg'};
 const unit='(mm|cm|m|inches|inch|in|ft|kg|g|lbs|lb)';
 const value='([0-9]+(?:\\.[0-9]+)?)';
 const accept=(label:string,number:string,u:string)=>{const key=labels[label.toLowerCase()];const mass=/^(kg|g|lbs?)$/i.test(u);if((key==='mass_kg')!==mass)return;const n=Number(number)*units[u.toLowerCase()];if(Number.isFinite(n)&&n>0)result[key]=Number(n.toPrecision(12));};
 for(const m of s.matchAll(new RegExp('\\b(length|width|height|mass|weight|weighs|weigh)\\s*(?:is|of|=|:)?\\s*'+value+'\\s*'+unit+'\\b','gi')))accept(m[1],m[2],m[3]);
 for(const m of s.matchAll(new RegExp('\\b'+value+'\\s*'+unit+'\\s*(long|wide|high|tall|length|width|height)\\b','gi')))accept(m[3],m[1],m[2]);
 const bareMass=s.match(/^(?:about\s+)?(\d+(?:\.\d+)?)\s*(kg|g|lbs|lb)[.!]?$/i);if(bareMass)accept('mass',bareMass[1],bareMass[2]);
 const triple=s.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|inches|inch|in|ft)\b/i);
 if(triple)for(const [i,key] of ['length','width','height'].entries())accept(key,triple[i+1],triple[4]);
 return result;
}
function patchRobot(draft:RobotRecord,s:string,ctx:ConversationContext,infer=false){
 const next={...draft,spec:{...draft.spec},sources:[...draft.sources]};
 const relationship=relationshipOf(s),category=categoryOf(s),name=nameOf(s);
 if(relationship&&(infer||/actually|ownership|relationship|not mine|not my robot|don't own|do not own|belongs to/i.test(s)||/^(?:owned|research|sighting|i own it|it'?s mine)[.!]*$/i.test(s)))next.relationship=relationship;
 if(category&&(infer||!draft.category||/(?:category|type) (?:is|to|:)|actually.*(?:a|an) /i.test(s)))next.category=category;if(name){next.name=name;next.spec.name=name;}
 const values=measurements(s);Object.assign(next.spec,values);
 if(Object.keys(values).length)next.spec.measurement_provenance=/\bestimat/i.test(s)?'User supplied estimates':'User supplied; measurement source not independently verified';
 const location=s.match(/(?:located in|location (?:is|:)|(?:saw|spotted) (?:it|this|the robot) (?:in|at)|based in)\s+([^.!?\n]{1,120})/i);
 if(location)next.location=location[1].trim();
 if(/\btoday\b/i.test(s))next.observedAt=ctx.today;
 const date=s.match(/\b(20\d\d-\d\d-\d\d)\b/);if(date){const parsed=new Date(date[1]+'T12:00:00');if(Number.isFinite(parsed.getTime())&&parsed.toISOString().startsWith(date[1]))next.observedAt=date[1];}
 for(const url of s.match(/https:\/\/[^\s<>"']+/g)??[]){try{const clean=new URL(url.replace(/[.,;)]*$/,''));if(clean.protocol==='https:'&&!next.sources.includes(clean.href))next.sources.push(clean.href)}catch{/* Keep malformed links out of records. */}}
 return next;
}
const turn=(flow:Flow|null,reply:string,chips?:string[]):AgentTurn=>({handled:true,flow,reply,chips});
export function questionFor(flow:Flow):string{
 if(flow.kind==='table')return flow.phase==='tableName'?'What should I call this spreadsheet?':flow.phase==='columns'?'What columns do you want? For example: robot, mass_kg, verdict. Include units in measurement column names.':'Send any starting rows, one per line in column order, separated by commas. Or say “empty” and I’ll create the table now.';
 if(flow.kind==='research')return flow.phase==='design'?'What part or robot design should the downloadable CAD models match? Tell me the function and any known size or mounting constraints.':flow.phase==='location'?'What city, region or university should I search around? You can also say “online” for a broader search.':'What kind of robotics interests you—rovers, underwater robots, drones, arms, or robotics in general?';
 switch(flow.phase){
 case 'relationship':return 'Is this a robot you own or work on, someone else’s robot you’re researching, or a sighting?';
 case 'name':return 'What should I call this robot? A nickname is fine.';
 case 'category':return 'What kind of robot is it—a rover, drone, underwater robot, legged robot, arm, or something else?';
 case 'goal':return 'What are you working on or trying to learn about it? You can say “skip” if you just want a record for now.';
 case 'details':return 'Any dimensions, mass, location, date, or source links you already know? You can say “30 cm long, 20 cm wide, weighs 2 kg,” or “skip.” Unknown details will stay blank.';
 case 'edit':return 'What would you like to change? Tell me the new name, measurements, ownership, category, notes, location or source links. I’ll update the same record.';
 }
}
export function seedRobotFlow(ctx:ConversationContext,seed?:Record<string,unknown>,photo?:string):Flow{
 const spec={...(seed??ctx.seed??{})};
 const draft:RobotRecord={id:ctx.id,name:typeof spec.name==='string'?spec.name:'',relationship:'research',category:categoryOf(String(spec.drivetrain??''))??'',notes:'',location:'',observedAt:'',sources:[],spec,photo,updatedAt:ctx.now};
 return {kind:'robot',phase:'relationship',draft,editing:false};
}
function advanceRobot(flow:Extract<Flow,{kind:'robot'}>,knownRelationship:boolean):Flow{
 const phase=!knownRelationship?'relationship':!flow.draft.name?'name':!flow.draft.category?'category':'goal';
 return {...flow,phase};
}
export function conversationTurn(q:string,flow:Flow|null,ctx:ConversationContext):AgentTurn{
 const s=q.trim().replace(/[‘’]/g,"'");if(!s)return {handled:false,flow,reply:''};
 if(/^(?:cancel|never mind|nevermind|discard draft|stop intake)[.!\s]*$/i.test(s))return flow?turn(null,'Draft discarded. Saved records were not changed. What would you like to do next?',['Create a robot','Create a spreadsheet','Find robotics clubs']):turn(null,'No draft is in progress. What would you like to do?');
 if(flow&&/^(?:start over|create another robot|new robot)[.!\s]*$/i.test(s))return conversationTurn('Create a robot',null,{...ctx,seed:null});
 // Allow informational questions during an intake without corrupting a field.
 if(flow&&/^(?:what|why|how|which|where can|can you explain)\b/i.test(s)&&!/^what (?:i|we) (?:want|need)/i.test(s))return {handled:false,flow,reply:''};
 if(!flow){
  const edit=s.match(/^(?:edit|update|change|modify)(?: my)?(?: robot| record)?\s+(.+?)[.!]?$/i);
  if(edit&&!/^(?:a|the|this) robot$/i.test(edit[1])){
   const target=edit[1].trim().replace(/[.!]$/,'');const matches=ctx.records.filter(r=>r.name.toLowerCase()===target.toLowerCase());
   if(matches.length===1){const next:Flow={kind:'robot',phase:'edit',draft:{...matches[0],spec:{...matches[0].spec},sources:[...matches[0].sources]},editing:true};return turn(next,`I’ve opened ${matches[0].name}. ${questionFor(next)}`);}
   if(matches.length>1)return turn(null,'More than one saved record has that name. Open the correct record with “Edit in chat” so I update the right one.');
   if(/^(edit|update|change)\b/i.test(s))return turn(null,'I couldn’t find a saved robot with that exact name. Tell me “create a robot,” or choose “Edit in chat” on a saved record.');
  }
  if(/(?:create|make|start|new|build).*(?:spreadsheet|table)|^(?:spreadsheet|table)\s*$/i.test(s)){
   const named=s.match(/(?:named|called)\s+(.+?)(?:\s+with columns|$)/i);const cols=s.match(/\bcolumns?\s*:?\s*(.+)$/i);
   const next:Flow={kind:'table',phase:named?(cols?'rows':'columns'):'tableName',name:named?.[1].trim()??'',columns:cols?cols[1].split(',').map(c=>c.trim()).filter(Boolean):[]};
   return turn(next,'I’ll create and fill the table from this conversation. '+questionFor(next));
  }
  if(/(?:find|search|discover|research|show).*(?:club|team|universit|communit)/i.test(s)){
   const next:Flow={kind:'research',phase:'location',location:'',interest:categoryOf(s)?s:'',query:s,models:false};return turn(next,questionFor(next));
  }
  if(/(?:find|suggest|recommend|pull|show).*(?:cad|3d|three models|3 models)/i.test(s)&&!/(?:for|of)\s+\w/i.test(s)){
   const next:Flow={kind:'research',phase:'design',location:'',interest:'',query:'',models:true};return turn(next,questionFor(next));
  }
  if(/(?:create|add|register|log|save|start|new|record|document).*(?:robot|rover|drone|sighting|project)|(?:\bi (?:own|built|am building|'m building)|\bmy robot|\bi (?:saw|spotted)\b|\bi am working on\b|\bi'm (?:building|working on)\b)/i.test(s)){
   const next=seedRobotFlow(ctx);if(next.kind!=='robot')return {handled:false,flow,reply:''};
   next.draft=patchRobot(next.draft,s,ctx,true);if(s.length>25)next.draft.notes=s;
   const advanced=advanceRobot(next,Boolean(relationshipOf(s)));
   return turn(advanced,'I’ll build the record as we talk. '+questionFor(advanced),advanced.kind==='robot'&&advanced.phase==='relationship'?['I own it','I’m researching it','It’s a sighting']:['Skip','Cancel']);
  }
  return {handled:false,flow:null,reply:''};
 }
 if(flow.kind==='research'){
  if(flow.phase==='design'){if(skip.test(s))return turn(flow,'I need a design description to find useful files. '+questionFor(flow));return {...turn(null,'I’m searching source repositories for matching downloadable files.'),research:{route:'/models',query:s.slice(0,200)}};}
  if(flow.phase==='location'){const next={...flow,location:cleanAnswer(s),phase:'interest' as const};if(next.interest)return {...turn(null,'I’m looking for source-linked robotics groups in '+next.location+'.'),research:{route:'/research',query:[next.location,next.interest,'university team club'].join(' ').slice(0,200)}};return turn(next,questionFor(next),['Rovers','Underwater robots','Drone clubs','Robotics in general']);}
  return {...turn(null,'I’m retrieving sourced leads. Coverage may be incomplete; verify the official team pages.'),research:{route:'/research',query:[flow.location,skip.test(s)?'robotics':s,'university team club'].join(' ').slice(0,200)}};
 }
 if(flow.kind==='table'){
  if(flow.phase==='tableName'){if(skip.test(s))return turn(flow,'Give it a short name so you can find it later.');const next={...flow,name:cleanAnswer(s).slice(0,120),phase:'columns' as const};return turn(next,questionFor(next));}
  if(flow.phase==='columns'){const columns=s.replace(/^columns?(?: are|:)?\s*/i,'').split(/,|\band\b/i).map(c=>c.trim().replace(/\s+/g,'_')).filter(Boolean);if(!columns.length||columns.length>100||new Set(columns).size!==columns.length||columns.some(c=>['__proto__','constructor','prototype'].includes(c)))return turn(flow,'Use unique column names separated by commas. For example: robot, mass_kg, verdict.');const next={...flow,columns,phase:'rows' as const};return turn(next,questionFor(next),['Empty']);}
  // Rows are parsed by the caller using the same strict CSV parser as uploads.
  const table:DataTable={id:'custom-'+ctx.id,name:flow.name,source:'Created through RobotForge chat',columns:flow.columns,rows:[],imported:true};
  return {...turn(null,'Created “'+table.name+'”. It is now the selected table for chat and the Data view.'),saveTable:table,tableRows:skip.test(s)?undefined:s};
 }
 if(/(?:^|[\s=:])(?:-\d+(?:\.\d+)?|0(?:\.0+)?)\s*(?:mm|cm|m|kg|g|lbs?|inches|inch|in|ft)\b/i.test(s))return turn(flow,'Use a positive measurement, or say “skip” if it is unknown. I haven’t changed the draft.');
 let input=s;
 if(flow.pendingLength!==undefined){const field=/\blength|\blong/i.test(s)?'length':/\bwidth|\bwide/i.test(s)?'width':/\bheight|\bhigh|\btall/i.test(s)?'height':null;if(!field&&!skip.test(s))return turn(flow,'Was that the length, width, or height? You can also say “skip.”');if(field)input=field+' '+flow.pendingLength+' m';flow={...flow,pendingLength:undefined};}
 const bareLength=s.match(/^(?:about\s+)?(\d+(?:\.\d+)?)\s*(mm|cm|m|inches|inch|in|ft)[.!]?$/i);
 if(bareLength&&(flow.phase==='details'||flow.phase==='edit'))return turn({...flow,pendingLength:Number(bareLength[1])*units[bareLength[2].toLowerCase()]},'Is that the length, width, or height?');
 const draft=patchRobot(flow.draft,input,ctx,flow.phase==='relationship');let next:Extract<Flow,{kind:'robot'}>={...flow,draft};
 if(flow.phase==='relationship'){
  if(!relationshipOf(s))return turn(flow,'I won’t guess ownership. Is it yours, a research robot, or a sighting?',['I own it','Research','Sighting']);
  next=advanceRobot(next,true) as Extract<Flow,{kind:'robot'}>;return turn(next,questionFor(next));
 }
 if(flow.phase==='name'){
  if(skip.test(s))next.draft={...draft,name:'Untitled robot',spec:{...draft.spec,name:'Untitled robot'}};
  if(!nameOf(s)&&!skip.test(s)&&s.length<=100&&!Object.keys(measurements(s)).length)next.draft={...draft,name:cleanAnswer(s),spec:{...draft.spec,name:cleanAnswer(s)}};
  if(!next.draft.name)return turn(next,'A nickname is enough—what should I call it?');next=advanceRobot(next,true) as Extract<Flow,{kind:'robot'}>;return turn(next,questionFor(next));
 }
 if(flow.phase==='category'){
  if(!next.draft.category){if(skip.test(s))next.draft={...draft,category:'Other robotics'};else return turn(next,'Tell me its type, or say “skip” to leave it as Other robotics.');}
  next.phase='goal';return turn(next,questionFor(next));
 }
 if(flow.phase==='goal'){
  if(!skip.test(s))next.draft={...draft,notes:[draft.notes,s].filter(Boolean).join('\n')};
  next.phase='details';return turn(next,questionFor(next),['Skip','I don’t know']);
 }
 if(flow.phase==='details'||flow.phase==='edit'){
  if(!skip.test(s)){
   const updated=Object.keys(measurements(input)).length||relationshipOf(s)||categoryOf(s)||nameOf(s)||draft.location!==flow.draft.location||draft.sources.length!==flow.draft.sources.length||draft.observedAt!==flow.draft.observedAt;
   if(!updated)next.draft={...draft,notes:[draft.notes,s].filter(Boolean).join('\n')};
  }
  const saved={...next.draft,updatedAt:ctx.now};
  if(!saved.name.trim())return turn({...next,phase:'name'},'What should I call this robot before saving it?');
  if(saved.sources.length>30||saved.notes.length>10000)return turn(next,'That record is too large. Please shorten the notes or source list.');
  return {...turn(null,`${flow.editing?'Updated':'Saved'} “${saved.name}” as ${saved.relationship==='owned'?'your robot':saved.relationship==='sighting'?'a sighting':'a research robot'}. I filled the record for you; unknown fields stay blank. The notebook and its data table are updated.`,['Create another robot','Create a spreadsheet','Find parts for this robot']),saveRobot:saved};
 }
 return turn(next,questionFor(next));
}
/** Shape check for resuming local drafts. Stored data never supplies an action. */
export function validFlow(value:unknown,recordCheck:(r:unknown)=>boolean):value is Flow{
 if(!value||typeof value!=='object')return false;const f=value as Flow;
 if(f.kind==='robot')return ['relationship','name','category','goal','details','edit'].includes(f.phase)&&typeof f.editing==='boolean'&&recordCheck(f.draft)&&(f.pendingLength===undefined||typeof f.pendingLength==='number'&&Number.isFinite(f.pendingLength)&&f.pendingLength>0);
 if(f.kind==='table')return ['tableName','columns','rows'].includes(f.phase)&&typeof f.name==='string'&&f.name.length<=120&&Array.isArray(f.columns)&&f.columns.length<=100&&f.columns.every(c=>typeof c==='string'&&c.length<=120&&!['__proto__','constructor','prototype'].includes(c))&&new Set(f.columns).size===f.columns.length;
 if(f.kind==='research')return ['location','interest','design'].includes(f.phase)&&[f.location,f.interest,f.query].every(s=>typeof s==='string'&&s.length<=1000)&&typeof f.models==='boolean';
 return false;
}
