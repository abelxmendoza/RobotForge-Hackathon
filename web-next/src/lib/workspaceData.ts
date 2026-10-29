import {robots,parts,gateReports} from './data';
import specsDoc from '@/data/robot-specs.json';
import type {DataTable,Cell} from './workspace';
import type {PartialSpec} from '@/components/forge/model';
export const robotSpecs=specsDoc as unknown as Record<string,PartialSpec>;
const scalar=(v:unknown):Cell => typeof v==='string'||typeof v==='number'||typeof v==='boolean'?v:v==null?null:JSON.stringify(v);
const fromRows=(id:string,name:string,source:string,rows:Record<string,Cell>[]):DataTable=>({id,name,source,columns:Array.from(new Set(rows.flatMap(r=>Object.keys(r)))),rows:rows.map(r=>Object.fromEntries(Array.from(new Set(rows.flatMap(x=>Object.keys(x)))).map(c=>[c,r[c]??null])))});
export const builtInTables:DataTable[]=[
  fromRows('robots','Robots','catalog/robots.json + per-robot example specifications',robots.map(r=>{const s=robotSpecs[r.spec_file??'']??{};return {name:r.name,class:r.class,drivetrain:scalar(s.drivetrain),mass_kg:scalar(s.mass_kg),length_m:scalar(s.length_m),width_m:scalar(s.width_m),height_m:scalar(s.height_m),battery_voltage_v:scalar(s.battery?.voltage_v),wheel_diameter_m:scalar(s.wheel?.diameter_m),gate_status:scalar(typeof r.gate_status==='object'?r.gate_status?.status:r.gate_status),description:scalar(s.description??r.description),source:r.spec_file??'catalog/robots.json',provenance:scalar(r.provenance)};})),
  fromRows('parts','Parts','catalog/parts.json',parts.map(p=>({id:p.id,name:p.name,part_class:p.part_class,...Object.fromEntries(Object.entries(p.specs??{}).map(([k,v])=>[k,scalar(v)])),source:p.source??'catalog/parts.json'}))),
  fromRows('runs','Simulation checks','catalog/gate-reports.json — recorded checks, not independent experiments',gateReports.flatMap(r=>{const doc=r.doc as {spec?:string;verdict?:string;checks?:Array<Record<string,unknown>>}|undefined;return (doc?.checks??[]).map(c=>({run_id:r.id,robot:doc?.spec??r.title,gate_verdict:doc?.verdict??null,check:scalar(c.name),reference:scalar(c.commanded),measured:scalar(c.measured),error:scalar(c.error),unit:scalar(c.unit),verdict:scalar(c.verdict),source:'catalog/gate-reports.json#'+r.id}));}))
];
export function robotTable(spec:PartialSpec,source:string):DataTable {
 return fromRows('draft-'+String(spec.name??'robot').toLowerCase().replace(/[^a-z0-9]+/g,'-'),'My robot: '+String(spec.name??'Untitled'),source,[{name:scalar(spec.name),...Object.fromEntries(Object.entries(spec).filter(([k])=>k!=='name').map(([k,v])=>[k,scalar(v)])),source}]);
}
