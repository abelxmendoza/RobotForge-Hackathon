/* Pure planned-rover transactions. No geometry or test result here constitutes hardware evidence. */
import { generateRobot, suggestPlacement, suggestWiring, planPrints, runEngineChecks, recordedVoltageNominal } from './forgeEngine';
import type { CataloguePart, ForgeSpec, ForgeSize, ForgeBomLine, ForgeCheck } from './forgeEngine';
import type { GarageRobot } from './garage';
import type { AssemblyVersion, ComponentInstance } from './assembly';
import { componentById, COMPONENTS } from './components';
export interface RoverRequirements { name:string; purpose:string; archetype:'differential_rover'|'mecanum_rover'; size:ForgeSize; sensors:string[]; budgetUsd:number|null; payloadKg:number|null }
export function defaultRoverRequirements():RoverRequirements { return {name:'New rover',purpose:'Explore an indoor environment',archetype:'differential_rover',size:'standard',sensors:['imu'],budgetUsd:null,payloadKg:null}; }
const copy = <T>(value:T):T => JSON.parse(JSON.stringify(value));
const finite = (value:unknown):number|null => typeof value==='number' && Number.isFinite(value) ? value : null;
function validId(id:string) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || ['__proto__','prototype','constructor'].includes(id)) throw new Error('Invalid revision or instance identity.'); }
function validate(req:RoverRequirements) {
  if(typeof req.name!=='string'||!req.name.trim()||req.name.length>100||typeof req.purpose!=='string'||!req.purpose.trim()||req.purpose.length>4000) throw new Error('Provide a name and purpose.');
  if(!['differential_rover','mecanum_rover'].includes(req.archetype)||!['compact','standard','large'].includes(req.size)) throw new Error('Choose a supported rover and size.');
  if(!Array.isArray(req.sensors)||req.sensors.some(s=>!['lidar','camera','depth_camera','imu','ultrasonic'].includes(s))) throw new Error('Unsupported sensor role.');
  for(const key of ['budgetUsd','payloadKg'] as const) if(req[key]!==null && (finite(req[key])===null || req[key]!<=0)) throw new Error('Optional budget and payload must be positive finite numbers.');
}
function catalogue(spec:ForgeSpec):CataloguePart[] { return spec.roverDesign?.catalogueLibrary ?? spec.roverDesign?.catalogue ?? []; }
function snapshot(spec:ForgeSpec,cat:CataloguePart[]) { const ids=new Set(spec.forge.bom.map((b:ForgeBomLine)=>b.partId));spec.roverDesign.catalogue=copy(cat.filter(p=>ids.has(p.id))); }
function compatible(role:string,p:CataloguePart):boolean {
 const s=p.specs??{}, kind=String(s.kind??'').toLowerCase();
 switch(role) {
 case 'motor': return p.part_class==='actuators' && /dc_gearmotor|dc_brushed/.test(kind);
 case 'wheel': return p.part_class==='wheels' && !/caster|track/.test(p.id+' '+kind);
 case 'battery': return p.part_class==='power' && ('capacity_mah' in s || 'chemistry' in s);
 case 'regulator': return p.part_class==='power' && ('output_v' in s);
 case 'driver': return p.part_class==='drivers' && !/esc|stepper|servo|pwm/.test(p.id+' '+kind) && (/motor driver|h.bridge/i.test(p.name||'')||kind==='h_bridge');
 case 'controller': return ['sbc','microcontrollers'].includes(p.part_class??'');
 case 'caster': return p.part_class==='wheels' && /caster/.test(p.id);
 case 'lidar': return p.part_class==='cameras_sensors' && /lidar/.test(kind);
 case 'imu': return p.part_class==='cameras_sensors' && /imu/.test(kind);
 case 'ultrasonic': return p.part_class==='cameras_sensors' && /ultrasonic/.test(kind);
 case 'depth_camera': return p.part_class==='cameras_sensors' && /rgbd|depth/.test(kind);
 case 'camera': return p.part_class==='cameras_sensors' && /camera/.test(kind) && !/rgbd|depth/.test(kind);
 default: return false;
 }
}
function wheelCompatible(spec:ForgeSpec,p:CataloguePart):boolean { const mecanum=/mecanum|mec4/.test(p.id+' '+String(p.specs?.kind??''));return spec.drivetrain==='mecanum'?mecanum:!mecanum; }
function ratings(spec:ForgeSpec,cat:CataloguePart[]) {
 const by=(role:string)=>cat.find(p=>p.id===spec.forge.ids[role]);const motor=by('motor'),wheel=by('wheel'),battery=by('battery');
 const dimension=(s:Record<string,unknown>|undefined,k:string)=>finite(s?.[k+'_m'])??(finite(s?.[k+'_mm'])===null?null:finite(s?.[k+'_mm'])!/1000);
 spec.motor={...spec.motor,kind:motor?.specs?.kind??null,voltage_v:recordedVoltageNominal(motor),stall_torque_nm:finite(motor?.specs?.stall_torque_nm)};
 spec.wheel={...spec.wheel,diameter_m:dimension(wheel?.specs,'diameter'),width_m:dimension(wheel?.specs,'width')};
 spec.battery={chemistry:battery?.specs?.chemistry??null,voltage_v:recordedVoltageNominal(battery),capacity_mah:finite(battery?.specs?.capacity_mah)};
}
/** Checks are evaluated against saved instances and existing planned edges, never regenerated poses. */
export function roverDesignChecks(spec:ForgeSpec):ForgeCheck[] {
 const cat=catalogue(spec),instances:ComponentInstance[]=spec.assembly?.components??[];
 let view=spec,checkCatalogue=cat;
 if(spec.assembly) {
  view=copy(spec);
  checkCatalogue=instances.map(c=>{const p=cat.find(p=>'catalog--'+p.id===c.componentId);return {...p,id:c.id};});
  const savedIds=new Set(instances.map(c=>c.id));
  view.forge.wiring=spec.forge.wiring.filter((e:{from:string;to:string})=>savedIds.has(e.from)&&savedIds.has(e.to));
  view.forge.bom=instances.map(c=>({partId:c.id,qty:1,source:'catalogue'}));
  view.forge.ids=Object.fromEntries(Object.entries(spec.forge.ids).map(([role,id])=>[role,instances.find(c=>c.componentId==='catalog--'+id)?.id]));
  view.forge.placement=instances.map(c=>({partId:c.id,role:roleFor(spec,c.componentId.slice(9)),pos_mm:c.positionM.map(n=>n*1000),orient:`saved yaw ${c.yawDeg} degrees`,why:'Saved estimated assembly envelope'}));
 }
 const checks=runEngineChecks(view,checkCatalogue);
 for(const role of ['motor','wheel']) {
  const qty=spec.forge.bom.filter((b:ForgeBomLine)=>b.partId===spec.forge.ids[role]).reduce((n:number,b:ForgeBomLine)=>n+b.qty,0);
  const check=checks.find(c=>c.id===role+'-count');
  if(check){check.verdict=qty>0&&qty===spec[role]?.count?'PASS':'ERROR';check.detail=`Spec ${role} count ${spec[role]?.count} vs selected catalogue BOM quantity ${qty}.`;}
 }
 if(spec.assembly) {
  const known=new Set(instances.map(c=>c.id));
  const edges=spec.forge.wiring as {from:string;to:string;kind:string}[];
  const invalid=edges.filter(e=>!known.has(e.from)||!known.has(e.to));
  if(invalid.length)checks.push({id:'wiring-endpoints',verdict:'ERROR',detail:'Planned wiring refers to missing assembly instances.'});
  const reachable=new Set(instances.filter(c=>c.componentId==='catalog--'+spec.forge.ids.battery).map(c=>c.id));
  for(let step=0;step<instances.length;step++){let changed=false;for(const e of edges)if(e.kind==='power'&&reachable.has(e.from)&&known.has(e.to)&&!reachable.has(e.to)){reachable.add(e.to);changed=true;}if(!changed)break;}
  const active=instances.filter(c=>{const p=cat.find(p=>'catalog--'+p.id===c.componentId);return ['actuators','drivers','sbc','microcontrollers','flight_control','custom_boards'].includes(p?.part_class??'')||c.componentId==='catalog--'+spec.forge.ids.regulator;});
  const unpowered=active.filter(c=>!reachable.has(c.id));
  const powerCheck=checks.find(c=>c.id==='unpowered')!;
  powerCheck.verdict=unpowered.length||invalid.length?'ERROR':'PASS';
  powerCheck.detail=unpowered.length?'No battery-rooted planned power path for saved instances: '+unpowered.map(c=>c.id+' ('+c.componentId.slice(9)+')').join(', ')+'.':invalid.length?'Power paths cannot be checked while endpoints are missing.':'Every saved actuator/driver/controller has a battery-rooted planned power path; pinout, wire sizing and hardware remain unverified.';
  for(const role of ['motor','wheel','battery','controller','driver','regulator'])if(!instances.some(c=>c.componentId==='catalog--'+spec.forge.ids[role]))checks.push({id:'missing-role-'+role,verdict:'ERROR',detail:'Missing selected '+role+' instance from saved assembly.'});
  const supplemental=instances.filter(c=>roleFor(spec,c.componentId.slice(9))==='supplemental');
  if(supplemental.length)checks.push({id:'supplemental-effects',verdict:'NOT_CHECKED',detail:'Supplemental hardware mass, power and simulation effects unknown: '+[...new Set(supplemental.map(c=>c.componentId.slice(9)))].join(', ')});
 }
 const driver=cat.find(p=>p.id===spec.forge.ids.driver),driverQty=spec.forge.bom.filter((b:ForgeBomLine)=>b.partId===driver?.id).reduce((n:number,b:ForgeBomLine)=>n+b.qty,0),channels=finite(driver?.specs?.channels);
 checks.push({id:'driver-channels',verdict:channels===null?'NOT_CHECKED':channels*driverQty>=spec.motor.count?'PASS':'ERROR',detail:channels===null?'Driver channel count is not recorded.':`${driverQty} driver(s) × ${channels} recorded channels for ${spec.motor.count} motors; interfaces and current still need verification.`});
 const cad=spec.roverDesign.cad;
 const sizes=[[spec.length_m*1000,spec.width_m*1000],...(cad?.mount?[[cad.mount.lengthMm,cad.mount.widthMm]]:[]),...(cad?.enclosure?[[cad.enclosure.length_mm,cad.enclosure.width_mm]]:[])];
 const bed=checks.find(c=>c.id==='print-bed-fit');
 if(bed){const exceeds=sizes.some(s=>s.some((n:number)=>n>220));bed.verdict=exceeds?'ERROR':cad?'PASS':'NOT_CHECKED';bed.detail=exceeds?'Full unjoined chassis, mount or enclosure exceeds the assumed 220 × 220 mm bed. Use a larger printer or redesign; no joined-tile design is generated.':cad?'Generated CAD outer dimensions fit the assumed 220 × 220 mm bed; slicing, mounting and strength remain unverified.':'Chassis fits the assumed bed, but custom mount and enclosure CAD have not been reviewed.';}
 const req=spec.roverDesign.requirements;
 for(const [key,label] of [['budgetUsd','budget'],['payloadKg','payload']] as const)if(req[key]!==null)checks.push({id:'requirement-'+label,verdict:'NOT_CHECKED',detail:label==='budget'?'Budget requirement retained; complete sourced prices are unavailable.':'Payload requirement retained; structural and torque validation are unavailable.'});
 return checks;
}
/** Local display proxy: generated chassis geometry uses the design's exact outer dimensions. */
export function roverComponentDefinition(spec:ForgeSpec,instance:ComponentInstance) {
 const definition=componentById(instance.componentId);if(!definition)return undefined;
 if(!spec.roverDesign||instance.componentId!=='catalog--'+spec.forge?.ids?.chassis)return definition;
 const next=copy(definition),thickness=finite(spec.roverDesign.cad?.chassis?.thicknessMm)??4;
 if(!(spec.length_m>0&&spec.width_m>0&&thickness>0))return definition;
 next.sizeM=[spec.length_m,spec.width_m,thickness/1000];next.geometry='illustrative';next.note='Generated chassis outer dimensions; verify mounting interfaces and material strength.';return next;
}
function refresh(spec:ForgeSpec,cat:CataloguePart[]) {
 spec.forge.placement=suggestPlacement(spec,cat);spec.forge.wiring=suggestWiring(spec,cat);spec.forge.prints=planPrints(spec,cat).map(p=>p.name==='Chassis plate'?{...p,scad:'Planning summary only: full unjoined chassis plate; editable geometry is generated separately in the CAD step.',bed_fit:Math.max(spec.length_m,spec.width_m)*1000<=220?'yes' as const:'no' as const}:p);
 snapshot(spec,cat);
 // During an assembly refresh these temporary role plans are converted to saved instance plans below.
 if(!spec.assembly)spec.forge.checks=roverDesignChecks(spec);
}
function invalidate(spec:ForgeSpec) {
 for(const key of ['gate_status','gate_report','gateReport','simulation_results','simulationResults','test_results','testResults','forgeTests','upgradePlan','upgrade','upgradeReport','upgradeArtifacts']) delete spec[key];
 spec.simulation_status='incomplete: planned assembly changes require mass, inertia, power and interface verification';
}
export function createRoverConcept(req:RoverRequirements,cat:CataloguePart[]):ForgeSpec {
 validate(req);const spec=generateRobot({text:req.purpose,name:req.name.trim(),archetype:req.archetype,size:req.size,sensors:[...req.sensors]},cat);
 spec.roverDesign={schemaVersion:1,requirements:copy({...req,name:req.name.trim()}),catalogue:[],catalogueLibrary:copy(cat),warnings:['Assembly poses and catalogue envelopes are planning estimates; verify dimensions, mass and interfaces.']};
 ratings(spec,cat);refresh(spec,cat);return spec;
}
export function roverRoleChoices(spec:ForgeSpec,cat:CataloguePart[]):{role:string;label:string;partId:string;quantity:number;options:CataloguePart[]}[] {
 return Object.entries(spec.forge?.ids??{}).flatMap(([role,id])=> { const current=cat.find(p=>p.id===id);if(!current||!compatible(role,current))return [];return [{role,label:role.replace(/_/g,' '),partId:String(id),quantity:spec.forge.bom.filter((b:ForgeBomLine)=>b.partId===id).reduce((n:number,b:ForgeBomLine)=>n+b.qty,0),options:cat.filter(p=>compatible(role,p)&&(role!=='wheel'||wheelCompatible(spec,p)))}]; });
}
export function swapRoverPart(input:ForgeSpec,role:string,partId:string,cat:CataloguePart[]):ForgeSpec {
 const next=copy(input),old=next.forge?.ids?.[role],part=cat.find(p=>p.id===partId);
 if(!next.roverDesign||!old||!part||!compatible(role,part)||(role==='wheel'&&!wheelCompatible(next,part))) throw new Error('Unsupported or incompatible catalogue role replacement.');
 if(Object.entries(next.forge.ids).some(([r,id])=>r!==role&&id===old)) throw new Error('Ambiguous shared role identity; reconcile before replacing.');
 next.forge.ids[role]=partId;next.forge.bom.forEach((b:ForgeBomLine)=>{if(b.partId===old)b.partId=partId;});
 if(next.assembly) next.assembly.components.forEach((c:ComponentInstance)=>{if(c.componentId==='catalog--'+old)c.componentId='catalog--'+partId;});
 next.roverDesign.catalogueLibrary=copy(cat);if(next.roverDesign.cad?.mount&&next.assembly?.components.some((c:ComponentInstance)=>c.id===next.roverDesign.cad.mount.instanceId&&c.componentId==='catalog--'+partId))next.roverDesign.warnings=[...new Set([...(next.roverDesign.warnings||[]),'Selected mount component changed; review its footprint and hole pattern before fabrication.'])];ratings(next,cat);refresh(next,cat);invalidate(next);
 return next.assembly?reconcileRoverAssembly(next):next;
}
function roleFor(spec:ForgeSpec,id:string):string { const roles=Object.entries(spec.forge.ids).filter(([,v])=>v===id);if(roles.length>1)throw new Error('Ambiguous catalogue role identity: '+id);return roles[0]?.[0]??'supplemental'; }
export function seedRoverAssembly(input:ForgeSpec,revisionId:string,at:string):ForgeSpec {
 validId(revisionId);const spec=copy(input);if(spec.assembly)return spec;
 const placements=suggestPlacement(spec,catalogue(spec));const components:ComponentInstance[]=[];
 spec.forge.bom.forEach((b:ForgeBomLine,bi:number)=>{
  const role=roleFor(spec,b.partId),base=placements.find(p=>p.partId===b.partId);
  if(!Number.isInteger(b.qty)||b.qty<1)throw new Error('Invalid BOM quantity.');
  for(let i=0;i<b.qty;i++) {
   let pos:[number,number,number]=base?base.pos_mm.map(n=>n/1000) as [number,number,number]:[0,0,spec.ground_clearance_m??.03];
   if(role==='motor'||role==='wheel'||role==='motorMount')pos=[b.qty>2?(i<2?1:-1)*spec.length_m*.32:spec.length_m*.32,(i%2?1:-1)*(spec.width_m/2+(role==='wheel'?.016:0)),(spec.wheel?.diameter_m??.1)/2];
   else if(!base)pos=[(i-(b.qty-1)/2)*.04,0,spec.ground_clearance_m??.03];
   components.push({id:`rover-${bi+1}-${i+1}`,componentId:'catalog--'+b.partId,positionM:pos,yawDeg:role==='motor'?90:0});
  }
 });
 spec.assembly={id:revisionId,createdAt:at,note:'Seed estimated individual catalogue envelopes',components,connections:[]} satisfies AssemblyVersion;
 return reconcileRoverAssembly(spec);
}
function identify(c:ComponentInstance,cat:CataloguePart[]):string {
 if(c.componentId.startsWith('catalog--')) {const id=c.componentId.slice(9);if(cat.some(p=>p.id===id))return id;}
 const curated=COMPONENTS.find(p=>p.id===c.componentId);
 // Generic proxies do not identify a real part, even when their illustration does.
 if(curated && !/hobby-generic/.test(curated.id)) {const match=cat.filter(p=>(p as CataloguePart&{image?:string}).image===curated.image);if(match.length===1)return match[0].id;}
 throw new Error('Unknown or ambiguous component identity: '+c.componentId+'. Choose an exact catalogue part before export.');
}
export function reconcileRoverAssembly(input:ForgeSpec):ForgeSpec {
 const spec=copy(input);if(!spec.roverDesign||!spec.assembly)return spec;
 const cat=catalogue(spec),components:ComponentInstance[]=spec.assembly.components;const seen=new Set<string>(),counts=new Map<string,number>();
 for(const c of components){validId(c.id);if(seen.has(c.id))throw new Error('Duplicate instance identity.');seen.add(c.id);if(!Array.isArray(c.positionM)||c.positionM.length!==3||c.positionM.some(n=>finite(n)===null||Math.abs(n)>10)||finite(c.yawDeg)===null||Math.abs(c.yawDeg)>360)throw new Error('Invalid assembly pose.');const original=componentById(c.componentId);const id=identify(c,cat);if(!c.componentId.startsWith('catalog--') && original)spec.roverDesign.warnings=[...new Set([...(spec.roverDesign.warnings??[]),'Original workbench envelope '+original.name+' mapped by unique catalogue illustration; physical identity and geometry remain unverified.'])];c.componentId='catalog--'+id;if(id===spec.forge.ids.chassis)c.sizeM=roverComponentDefinition(spec,c)?.sizeM;else delete c.sizeM;counts.set(id,(counts.get(id)??0)+1);}
 for(const edge of spec.assembly.connections)if(!seen.has(edge.from)||!seen.has(edge.to))throw new Error('Planned connection refers to missing instance.');
 // A second incompatible drive/control identity cannot silently become supplemental hardware.
 for(const [id] of counts){const part=cat.find(p=>p.id===id)!;if(roleFor(spec,id)==='supplemental') {const critical=['motor','wheel','battery','driver','controller'].filter(r=>compatible(r,part));if(critical.length)throw new Error('Ambiguous '+critical.join('/')+' role: replace the selected role before adding a different identity.');}}
 const old:ForgeBomLine[]=spec.forge.bom;
 spec.forge.bom=[...counts].map(([partId,qty])=>({partId,qty,source:old.find(b=>b.partId===partId)?.source??'catalogue'}));
 if((counts.get(spec.forge.ids.battery)??0)>1)throw new Error('Ambiguous battery topology; choose one battery or provide an explicit reconciled power model.');
 spec.motor.count=counts.get(spec.forge.ids.motor)??0;spec.wheel.count=counts.get(spec.forge.ids.wheel)??0;
 ratings(spec,cat);refresh(spec,cat);
 spec.forge.placement=components.map(c=>{const id=c.componentId.slice(9);return {partId:id,instanceId:c.id,role:roleFor(spec,id),pos_mm:c.positionM.map(n=>n*1000),orient:`saved yaw ${c.yawDeg} degrees`,why:'ESTIMATED envelope pose saved by the assembly workbench; mounting interfaces unverified.'};});
 // Planned role wiring is expanded to the actual identities. User assembly connections remain separate and unchanged.
 spec.forge.wiring=spec.forge.wiring.map((w:{from:string;to:string;kind:string;volts:number|null})=>{if(w.kind!=='power')return w;const source=cat.find(p=>p.id===w.from);return {...w,volts:w.from===spec.forge.ids.driver||w.from===spec.forge.ids.regulator?finite(source?.specs?.output_v):recordedVoltageNominal(source)};}).flatMap((w:{from:string;to:string})=>{const from=components.filter(c=>c.componentId==='catalog--'+w.from),to=components.filter(c=>c.componentId==='catalog--'+w.to);if(from.length>1&&to.length>1) return to.map((b,i)=>({...w,from:from[Math.min(from.length-1,Math.floor(i*from.length/to.length))].id,to:b.id}));return from.flatMap(a=>to.map(b=>({...w,from:a.id,to:b.id})));});
 spec.forge.checks=roverDesignChecks(spec);
 invalidate(spec);return spec;
}
export function assertRoverConsistency(spec:ForgeSpec):void {
 if(!spec.roverDesign||!spec.forge)throw new Error('A managed rover design is required.');
 for(const role of ['motor','wheel','battery','controller','driver','regulator']) {const id=spec.forge.ids?.[role];const qty=spec.forge.bom.filter((b:ForgeBomLine)=>b.partId===id).reduce((n:number,b:ForgeBomLine)=>n+b.qty,0);if(!id||qty<1)throw new Error('Missing required '+role+' in effective BOM.');}
 if(spec.motor?.count!==spec.wheel?.count)throw new Error('Drive motor and wheel counts differ; reconcile the drivetrain before export.');
 if(!spec.assembly)throw new Error('Seed an assembly revision before export.');
 const clean=reconcileRoverAssembly(spec);
 for(const key of ['motor','wheel'])if(spec[key]?.count!==clean[key].count)throw new Error(key+' count differs from assembly.');
 for(const instance of spec.assembly.components as ComponentInstance[])if(JSON.stringify(instance.sizeM)!==JSON.stringify(clean.assembly.components.find((c:ComponentInstance)=>c.id===instance.id)?.sizeM))throw new Error('Chassis dimensions are stale; reconcile saved geometry first.');
 const normalize=(bom:ForgeBomLine[])=>JSON.stringify([...bom].sort((a,b)=>a.partId.localeCompare(b.partId)).map(b=>[b.partId,b.qty]));
 if(normalize(spec.forge.bom)!==normalize(clean.forge.bom))throw new Error('BOM quantities differ from assembly instances.');
 for(const role of ['motor','wheel','battery','controller','driver','regulator'])if(!clean.forge.bom.some((b:ForgeBomLine)=>b.partId===clean.forge.ids[role]&&b.qty>0))throw new Error('Missing required '+role+' in assembly.');
 if(JSON.stringify(spec.forge.checks)!==JSON.stringify(roverDesignChecks(spec)))throw new Error('Derived engineering checks are stale; reconcile assembly first.');
 if(JSON.stringify(spec.forge.placement)!==JSON.stringify(clean.forge.placement)||JSON.stringify(spec.forge.wiring)!==JSON.stringify(clean.forge.wiring))throw new Error('Derived placement or wiring is stale; reconcile assembly first.');
}
export function saveRoverVersion(all:GarageRobot[],input:ForgeSpec,robotId:string,expectedVersionId:string|null,versionId:string,at:string):GarageRobot[] {
 validId(robotId);validId(versionId);const existing=all.find(r=>r.id===robotId);
 if(existing?.archivedAt&&Number.isFinite(Date.parse(existing.archivedAt)))throw new Error('Robot is archived. Restore it before editing.');
 if((existing?.versions.at(-1)?.id??null)!==expectedVersionId)throw new Error('Robot changed. Refresh the saved version.');
 validate(input.roverDesign.requirements);
 if(all.some(r=>r.id!==robotId&&r.name.trim().toLowerCase()===input.name.trim().toLowerCase()))throw new Error('A robot with that name already exists.');
 if(all.some(r=>r.versions.some(v=>v.id===versionId)))throw new Error('Version identity already exists.');
 let spec=seedRoverAssembly(input,versionId,at);spec=reconcileRoverAssembly(spec);spec.assembly.id=versionId;spec.assembly.createdAt=at;assertRoverConsistency(spec);
 const version={id:versionId,label:existing?'Rover design revision':'Rover design concept',note:'Catalogue-grounded plan; hardware validation remains incomplete.',source:'generated' as const,planned:true,createdAt:at,spec};
 return existing?all.map(r=>r===existing?{...r,name:spec.name,versions:[...r.versions,version]}:r):[...all,{id:robotId,name:spec.name,createdAt:at,versions:[version]}];
}
