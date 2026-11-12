import { categoryHint, importedPart, partReality, partSection, PART_CATEGORIES, type InventoryPart } from './inventory';
import { cataloguePartLinks, webPartShopLinks } from './shopLinks';
import type { WebPartRecord } from './webParts';
import type { CataloguePart } from './forgeEngine';
import type { GarageRobot } from './garage';
export const CATEGORY_NAMES: Record<string,string> = {battery:'Batteries',motor:'Motors',motor_driver:'Motor drivers',controller:'Controllers',computer:'Computers',sensor:'Sensors',wheel:'Wheels',servo:'Servos',power:'Power',radio:'Radios',frame:'Frames & mounts',cable:'Cables & connectors',tool:'Tools',storage:'Memory & storage',material:'Materials',end_effector:'End effectors',propulsion:'Propellers & air propulsion',flight_controller:'Flight controllers',pcb:'Circuit boards',safety:'Safety & protection',other:'Other'};
export function categoryFor(category:string,name:string): string {
  // Catalogue classes are authoritative; names only refine broad classes.
  const key=category.toLowerCase().replace(/[\s-]+/g,'_');
  if(key==='power')return !/charger/i.test(name)&&/battery|\blipo\b|li[ -]?ion|\bni[ -]?mh\b|\bcell\b/i.test(name)?'battery':'power';
  if(key==='actuators')return /servo/i.test(name)?'servo':'motor';
  const classes:Record<string,string>={batteries:'battery',drivers:'motor_driver',sbc:'computer',microcontrollers:'controller',cameras_sensors:'sensor',wheels:'wheel',power_protection:'safety',communications:'radio',comms:'radio',frames:'frame',structural:'frame',structure:'frame',connectors:'cable',cables_connectors:'cable',tools:'tool',printed:'frame',materials:'material',memory_storage:'storage',end_effectors:'end_effector',propulsion_air:'propulsion',flight_control:'flight_controller',custom_boards:'pcb',safety_protection:'safety'};
  if(classes[key])return classes[key];
  if ((PART_CATEGORIES as readonly string[]).includes(key)) return key;
  return categoryHint(name);
}
function base(id:string,name:string,category:string):InventoryPart {
  return {id,name,category,reality:'sim_only',ownership:'wishlist',section:category==='tool'?'tools':'parts',quantity:1,catalog_part_id:null,specs:{},read_from_label:[],condition:'unknown',confidence:'low',status:'needs_confirmation',question:'',photo:null,chat:[],createdAt:'',source:'manual'};
}
export function libraryItems(stock:InventoryPart[],web:WebPartRecord[]):InventoryPart[] {
  const linked=new Set(stock.map(p=>p.web_record_id));
  return [...stock.filter(p=>!p.archivedAt),...web.filter(r=>!linked.has(r.id)).map(r=>({...base('web:'+r.id,r.name,categoryFor(r.category,r.name)),web_record_id:r.id,origin:'web' as const,source_url:r.provenance.sourceUrl,specs:r.specs,createdAt:r.provenance.fetchedAt,notes:r.verification,shops:webPartShopLinks({name:r.name,category:r.category,sourceUrl:r.provenance.sourceUrl}),...(r.images?.length?{image_urls:r.images,image_credit:'Photo: '+(r.store||'the source page')}:{}),...(r.store?{store:r.store}:{}),...(r.priceEstimate?{price_estimate:{text:r.priceEstimate.text,amountUsd:r.priceEstimate.amountUsd,sourceUrl:r.priceEstimate.sourceUrl,fetchedAt:r.priceEstimate.fetchedAt}}:{})}))];
}
/** Display the full catalogue without creating stock or changing saved records. */
export function organizedLibraryItems(stock:InventoryPart[],web:WebPartRecord[],catalogue:InventoryPart[]):InventoryPart[] {
  const saved=libraryItems(stock,web);
  const linked=new Set([...stock,...saved].map(p=>p.catalog_part_id).filter(Boolean));
  return [...saved,...catalogue.filter(p=>!linked.has(p.catalog_part_id))];
}

export function catalogItems(catalogue:CataloguePart[]):InventoryPart[] {
  return catalogue.map(p=>{const links=cataloguePartLinks(p);return {...base('catalog:'+p.id,p.name||p.id,categoryFor(p.part_class||'',p.name||p.id)),catalog_part_id:p.id,origin:'catalogue' as const,...catalogPhoto(p),...(links.length?{shops:links}:{}),specs:Object.fromEntries(Object.entries(p.specs||{}).filter(([,v])=>typeof v==='number'||typeof v==='string')) as InventoryPart['specs']};});
}
/* A catalogue part's verified web photo (catalog/parts.json `photo`,
 * state web_gathered with its source page and credit), else nothing. */
function catalogPhoto(p:CataloguePart):Partial<InventoryPart> {
  const ph=(p as unknown as {photo?:{url?:string;source_page?:string;credit?:string;state?:string}}).photo;
  if(!ph||ph.state!=='web_gathered'||!ph.url||!/^https?:\/\//.test(ph.url)||!ph.credit)return {};
  return {image_urls:[ph.url],image_credit:ph.credit,...(ph.source_page&&/^https?:\/\//.test(ph.source_page)?{source_url:ph.source_page}:{})};
}
export function ownershipLabel(p:InventoryPart):string {return p.ownership==='wishlist'?'Wishlist':partReality(p)==='sim_only'?'Sim only':'Owned';}
export function originLabel(p:InventoryPart):string {return p.origin==='custom'?'Custom':p.origin==='web'?'Web-sourced':p.catalog_part_id?'Catalogue':p.source==='photo'?'Photo':'Added by you';}
export function robotMatches(p:InventoryPart,robots:GarageRobot[]):{robot:GarageRobot;kind:'planned'|'installed'|'suggested';reason:string}[] {
  return robots.filter(r=>!r.archivedAt).flatMap((robot):{robot:GarageRobot;kind:'planned'|'installed'|'suggested';reason:string}[]=>{
    const link=p.robot_links?.find(l=>l.robot_id===robot.id);
    if(link || p.robot_id===robot.id)return [{robot,kind:link?.kind||'planned',reason:link?.kind==='installed'?'Recorded by you as installed':'Linked by you; fitting and stock are unchanged'}];
    const spec=robot.versions.at(-1)?.spec;
    const id=p.catalog_part_id||p.web_record_id;
    if(id && (spec?.forge?.bom?.some((b:{partId:string})=>b.partId===id)||spec?.added_parts?.some((b:{id:string})=>b.id===id)))return [{robot,kind:'suggested' as const,reason:'Exact part ID appears in this robot’s plan; physical fit is unchecked'}];
    return [];
  });
}
export type LibraryCommand = {kind:'save';query:string;ownership:'owned'|'wishlist';quantity?:number} | {kind:'link';query:string;robotName:string;relation:'planned'|'installed'} | {kind:'nest';query:string;parentQuery:string|null} | {kind:'archive';query:string} | {kind:'restore';query:string} | {kind:'edit';query:string;updates:Partial<InventoryPart>;description:string} | {kind:'shared';query:string} | {kind:'confirm';query:string};
export function parseLibraryCommand(text:string):LibraryCommand|null {
  const q=text.trim().replace(/[.!]$/,'');
  if(/https?:\/\//i.test(q)||/[?]/.test(q)||/\b(don't|do not|never)\b/i.test(q))return null;
  let m=q.match(/^(archive|remove|restore) (?:part|tool) "([^"\n]+)"(?: from my library)?$/i);
  if(m)return {kind:m[1].toLowerCase()==='restore'?'restore':'archive',query:m[2]};
  m=q.match(/^nest "([^"\n]+)" inside "([^"\n]+)"$/i);
  if(m)return {kind:'nest',query:m[1],parentQuery:m[2]};
  m=q.match(/^detach "([^"\n]+)"$/i);
  if(m)return {kind:'nest',query:m[1],parentQuery:null};
  m=q.match(/^rename (?:part|tool) "([^"\n]+)" to "([^"\n]+)"$/i);
  if(m&&m[2].trim())return {kind:'edit',query:m[1],updates:{name:m[2].trim()},description:'Rename to '+m[2].trim()};
  m=q.match(/^set category of "([^"\n]+)" to (.+)$/i);
  if(m){const category=PART_CATEGORIES.find(c=>c===m![2].toLowerCase()||CATEGORY_NAMES[c].toLowerCase()===m![2].toLowerCase());if(category)return {kind:'edit',query:m[1],updates:{category,section:category==='tool'?'tools':'parts'},description:'Set category to '+CATEGORY_NAMES[category]};return null;}
  m=q.match(/^set "([^"\n]+)" (voltage|capacity|mass|diameter|width|current|torque|speed) to (\d+(?:\.\d+)?)\s*(V|mAh|Ah|g|kg|mm|cm|m|A|mA|Nm|rpm)$/i);
  if(m){
    const definitions:Record<string,{key:string;units:Record<string,number>}>= {voltage:{key:'voltage_v',units:{v:1}},capacity:{key:'capacity_mah',units:{mah:1,ah:1000}},mass:{key:'mass_g',units:{g:1,kg:1000}},diameter:{key:'diameter_mm',units:{mm:1,cm:10,m:1000}},width:{key:'width_mm',units:{mm:1,cm:10,m:1000}},current:{key:'current_a',units:{a:1,ma:.001}},torque:{key:'stall_torque_nm',units:{nm:1}},speed:{key:'rpm',units:{rpm:1}}};
    const def=definitions[m[2].toLowerCase()],factor=def.units[m[4].toLowerCase()],value=Number(m[3])*factor;
    if(factor&&Number.isFinite(value)&&value>0)return {kind:'edit',query:m[1],updates:{specs:{[def.key]:value}},description:`Record ${m[2]} as ${m[3]} ${m[4]}`};
    return null;
  }
  m=q.match(/^save\s+"?(.+?)"?\s+to my wishlist$/i);
  if(m)return {kind:'save',query:m[1],ownership:'wishlist'};
  m=q.match(/^mark\s+"(.+)"\s+as\s+(owned|wishlist)$/i);
  if(m)return {kind:'save',query:m[1],ownership:m[2].toLowerCase() as 'owned'|'wishlist'};
  m=q.match(/^I (?:own|have)\s+(\d+)\s+"?(.+?)"?$/i);
  if(m)return {kind:'save',query:m[2],quantity:Number(m[1]),ownership:'owned'};
  m=q.match(/^(plan|install)\s+"(.+)"\s+(?:for|on)\s+"(.+)"$/i);
  if(m)return {kind:'link',query:m[2],robotName:m[3],relation:m[1].toLowerCase()==='install'?'installed':'planned'};
  m=q.match(/^make\s+"(.+)"\s+shared$/i);
  if(m)return {kind:'shared',query:m[1]};
  m=q.match(/^confirm (?:part|tool)\s+"(.+)"$/i);
  return m?{kind:'confirm',query:m[1]}:null;
}
export function changeLibrary(stock:InventoryPart[],web:WebPartRecord[],catalogue:InventoryPart[],robots:GarageRobot[],command:LibraryCommand,at:string,newId:string):{parts:InventoryPart[];description:string} {
  if(command.kind!=='restore'&&stock.some(p=>p.archivedAt&&(p.id===command.query||p.name.toLowerCase()===command.query.toLowerCase())))throw new Error('Restore the archived item before changing it.');
  const saved=command.kind==='restore'?stock.filter(p=>p.archivedAt):libraryItems(stock,web);
  const all=[...saved,...catalogue.filter(c=>!saved.some(p=>p.catalog_part_id===c.catalog_part_id))];
  const exact=all.filter(p=>p.id===command.query || p.name.toLowerCase()===command.query.toLowerCase());
  if(exact.length>1)throw new Error('Use a unique item name or its ID.');
  let item=exact[0];
  if(!item && command.kind==='save')item=base(newId,command.query,categoryHint(command.query));
  if(!item)throw new Error('That item is not in your library or catalogue. Search for it first.');
  const existing=stock.find(p=>p.id===item.id);
  if(command.kind==='restore'&&!existing?.archivedAt)throw new Error('That item is not archived.');
  if(command.kind==='archive'&&!existing&&!item.web_record_id)throw new Error('That catalogue item is not saved in your library.');
  let next:InventoryPart={...item,id:existing?.id||newId,createdAt:item.createdAt||at};
  let description='';
  if(command.kind==='save') {
    if(command.quantity!==undefined && (!Number.isSafeInteger(command.quantity)||command.quantity<0))throw new Error('Use a whole nonnegative quantity.');
    next={...next,ownership:command.ownership,reality:command.ownership==='owned'?'real':'sim_only',quantity:command.quantity??next.quantity};
    description=`${command.ownership==='owned'?'Record as owned':'Save to wishlist'}: ${item.name}${command.quantity!==undefined?' ×'+command.quantity:''}`;
  } else if(command.kind==='archive') {
    next={...next,archivedAt:at};description='Archive '+item.name+' (kept in your export; ask Wrench to restore it)';
  } else if(command.kind==='restore') {
    next={...next,archivedAt:undefined};description='Restore '+item.name;
  } else if(command.kind==='nest') {
    const parents=command.parentQuery?stock.filter(p=>!p.archivedAt&&(p.id===command.parentQuery||p.name.toLowerCase()===command.parentQuery!.toLowerCase())):[];
    if(command.parentQuery&&parents.length!==1)throw new Error('Use a unique saved parent part name or ID.');
    const parent=parents[0];
    if(parent&&partSection(parent)!==partSection(next))throw new Error('Keep nested components in the same parts or tools section.');
    const seen=new Set([next.id]);let ancestor=parent;
    while(ancestor){if(seen.has(ancestor.id))throw new Error('A part cannot be nested inside itself.');seen.add(ancestor.id);ancestor=stock.find(p=>p.id===ancestor.parent_id)!;}
    next={...next,parent_id:parent?.id??null,...(parent?{robot_id:parent.robot_id??null,robot_links:robotLinksForRevision(parent)}:{})};description=parent?'Nest '+item.name+' inside '+parent.name:'Detach '+item.name;
  } else if(command.kind==='edit') {
    next={...next,...command.updates,specs:{...next.specs,...command.updates.specs}};description=command.description+': '+item.name;
  } else if(command.kind==='confirm') {
    next={...next,status:'confirmed',confidence:'owner'};description='Confirm identification: '+item.name;
  } else if(command.kind==='shared') {
    if(next.parent_id)throw new Error('This item is nested inside another part. Move its parent to the shared shelf first.');
    next={...next,robot_id:null,robot_links:[]};description='Keep shared: '+item.name;
  } else {
    const targets=robots.filter(r=>!r.archivedAt&&(r.name.toLowerCase()===command.robotName.toLowerCase()||r.id===command.robotName));
    if(targets.length!==1)throw new Error('Use a unique active robot name or ID.');
    if(next.parent_id)throw new Error('This item is nested inside another part. Link its parent to the robot instead.');
    if(command.relation==='installed' && (partReality(next)!=='real'||next.quantity<1))throw new Error('Only an owned item with stock can be recorded as installed.');
    const links=next.robot_links|| (next.robot_id?[{robot_id:next.robot_id,kind:'planned' as const}]:[]);
    next={...next,robot_links:[...links.filter(l=>l.robot_id!==targets[0].id),{robot_id:targets[0].id,kind:command.relation}]};
    description=`${command.relation==='planned'?'Plan':'Record as installed'} ${item.name} ${command.relation==='planned'?'for':'on'} ${targets[0].name}`;
  }
  let updated=existing?stock.map(p=>p.id===existing.id?next:p):[...stock,next];
  if(existing&&(command.kind==='link'||command.kind==='shared'||command.kind==='nest')){
    const descendants=new Set([existing.id]);let changed=true;
    while(changed){changed=false;for(const p of stock)if(p.parent_id&&descendants.has(p.parent_id)&&!descendants.has(p.id)){descendants.add(p.id);changed=true;}}
    updated=updated.map(p=>p.id!==existing.id&&descendants.has(p.id)?{...p,robot_id:next.robot_id??null,robot_links:(next.robot_links||[]).map(l=>({...l,kind:'planned' as const}))}:p);
  }
  if(command.kind==='archive')updated=updated.map(p=>p.parent_id===next.id?{...p,parent_id:next.parent_id??null}:p);
  return {parts:updated,description};
}

/** Editing CAD never rewrites the physical stock represented by an owned part. */
export function saveCadDesign(stock:InventoryPart[],cad:{filename:string;template:string;source:string;params:{key:string;value:number}[]},request:string,at:string,id:string,revisionId?:string):InventoryPart[] {
  const previous=revisionId?stock.find(p=>p.id===revisionId&&!p.archivedAt&&p.origin==='custom'):undefined;
  if(revisionId&&!previous)throw new Error('That custom design no longer exists.');
  const fork=previous&&partReality(previous)==='real';
  const next:InventoryPart={...(previous||base(id,cad.filename.replace('.scad','').replace(/_/g,' '),cad.template==='wheel_disc'?'wheel':'frame')),id:previous&&!fork?previous.id:id,origin:'custom',ownership:'wishlist',reality:'sim_only',quantity:1,parent_id:null,robot_id:null,robot_links:previous?robotLinksForRevision(previous):[],createdAt:previous&&!fork?previous.createdAt:at,confidence:'owner',status:'confirmed',specs:Object.fromEntries(cad.params.map(p=>[p.key,p.value])),design:{filename:cad.filename,versions:[...(previous?.design?.versions||[]),{source:cad.source,createdAt:at,request}]},...(fork?{name:previous.name+' revision'}:{})};
  return previous&&!fork?stock.map(p=>p.id===previous.id?next:p):[...stock,next];
}
function robotLinksForRevision(p:InventoryPart):NonNullable<InventoryPart['robot_links']> {
  const links=p.robot_links|| (p.robot_id?[{robot_id:p.robot_id,kind:'planned' as const}]:[]);
  return links.map(l=>({...l,kind:'planned'}));
}


export function isLibraryExport(doc:unknown):boolean {
  if(!doc||typeof doc!=='object')return false;
  const d=doc as {format?:string};return ['robotforge-library-v1','robotforge-inventory-v2'].includes(d.format||'');
}
export function mergeLibraryExport(doc:unknown,stock:InventoryPart[],web:WebPartRecord[]):{parts:InventoryPart[];web:WebPartRecord[];added:number} {
  if(!isLibraryExport(doc))throw new Error('This is not a RobotForge library or inventory export.');
  const d=doc as {parts:unknown[];webParts?:WebPartRecord[]};
  if(!Array.isArray(d.parts)||d.parts.length>5000|| (d.webParts!==undefined&&!Array.isArray(d.webParts)))throw new Error('Invalid library export.');
  const parts=[...stock],records=[...web];let added=0;
  for(const raw of d.parts){
    const item=importedPart(raw);
    if(parts.some(p=>p.id===item.id||Boolean(p.web_record_id&&p.web_record_id===item.web_record_id)))continue;
    parts.push(item);added++;
  }
  for(const record of d.webParts||[]){
    if(!record||typeof record.id!=='string'||typeof record.name!=='string'||!/^https?:\/\//.test(record.provenance?.sourceUrl||'')||typeof record.provenance?.fetchedAt!=='string'||!record.specs||typeof record.specs!=='object'||Object.values(record.specs).some(v=>typeof v!=='string'&&(typeof v!=='number'||!Number.isFinite(v))))throw new Error('Invalid web part in export.');
    if(records.some(r=>r.id===record.id))continue;
    records.push({...record,images:Array.isArray(record.images)?record.images.filter(u=>typeof u==='string'&&/^https?:\/\//.test(u)).slice(0,6):undefined,verification:'WEB-SOURCED — UNVERIFIED'});added++;
  }
  return {parts,web:records,added};
}
