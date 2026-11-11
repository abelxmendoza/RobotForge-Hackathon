/** Build files derived from one saved planned rover revision. No model or hardware claims. */
import { zipSync, strToU8 } from 'fflate';
import { Mesh, MeshBasicMaterial } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { generateMount, enclosureFit, type MountArtifact } from './buildArtifacts';
import { generateCad } from './cadGen';
import { mountGeometry } from './mountMesh';
import { componentById } from './components';
import { assertRoverConsistency, reconcileRoverAssembly } from './roverDesign';
import type { CataloguePart } from './forgeEngine';
import type { GarageRobot, Spec } from './garage';

export interface RoverPlate { lengthMm:number; widthMm:number; thicknessMm:number; holes:[number,number][]; holeDiameterMm:number }
export interface RoverCadSettings {
  chassis:RoverPlate;
  mount:(RoverPlate & {instanceId:string})|null;
  enclosure:{length_mm:number;width_mm:number;height_mm:number;wall_mm:number;clearance_mm:number;cable_dia_mm:number;cable_count:number}|null;
}
export function defaultRoverCad(spec:Spec):RoverCadSettings {
  return {chassis:{lengthMm:Math.round(spec.length_m*1000),widthMm:Math.round(spec.width_m*1000),thicknessMm:4,holes:[],holeDiameterMm:3.2},mount:null,enclosure:null};
}
function plate(options:RoverPlate,name:string,sizeM:[number,number,number]):MountArtifact {
  if(!Array.isArray(options.holes)||options.holes.length>100||options.holes.some(p=>!Array.isArray(p)||p.length!==2))throw new Error('Use up to 100 explicit X,Y hole coordinates.');
  return generateMount({lengthMm:options.lengthMm,widthMm:options.widthMm,thicknessMm:options.thicknessMm,holeDiameterMm:options.holeDiameterMm},{name,sizeM,source:'Saved rover design — user-reviewed dimensions',mounting:{holePatternMm:options.holes,holeDiameterMm:options.holeDiameterMm,notes:options.holes.length?'Hole coordinates entered by the designer; verify against physical hardware.':'No hole pattern specified. Blank plate; no mounting holes inferred.'}});
}
function stl(mount:MountArtifact):string {
  const geometry=mountGeometry(mount),material=new MeshBasicMaterial();
  try{return new STLExporter().parse(new Mesh(geometry,material));}finally{geometry.dispose();material.dispose();}
}
export function roverCadArtifacts(spec:Spec,settings:RoverCadSettings):{chassis:MountArtifact;files:Record<string,string>;warnings:string[]} {
  const chassis=plate(settings.chassis,'Rover chassis',[settings.chassis.lengthMm/1000,settings.chassis.widthMm/1000,.004]);
  const files:Record<string,string>={'cad/chassis.scad':chassis.source,'cad/chassis-mm.stl':stl(chassis)};
  const warnings=[...chassis.warnings,'Chassis dimensions are design inputs, not measurements. No structural/load validation has been performed.'];
  if(settings.mount){
    const instance=spec.assembly?.components?.find((c:{id:string})=>c.id===settings.mount!.instanceId);
    const part=instance&&componentById(instance.componentId);
    if(!part)throw new Error('Choose an existing assembly instance for the component mount.');
    const mount=plate(settings.mount,part.name,part.sizeM);
    files['cad/component-mount.scad']=mount.source;files['cad/component-mount-mm.stl']=stl(mount);
    warnings.push(...mount.warnings,'Component mount footprint uses a catalogue envelope; confirm the physical part.');
  }
  if(settings.enclosure){
    const e=settings.enclosure;
    if(Object.values(e).some(n=>!Number.isFinite(n)))throw new Error('Enclosure dimensions must be finite.');
    const generated=generateCad({template:'enclosure',params:{...e}});
    files['cad/enclosure.scad']=generated.source;
    for(const file of generated.files||[])files['cad/'+file.filename]=file.source;
    warnings.push('Enclosure is editable OpenSCAD; no enclosure STL is generated. Verify clearances, cooling and cable openings.');
    if(e.length_mm>220||e.width_mm>220)warnings.push('Enclosure exceeds the assumed 220 × 220 mm printer bed. Use a larger bed or redesign.');
    if(settings.mount){
      const instance=spec.assembly.components.find((c:{id:string})=>c.id===settings.mount!.instanceId);
      const part=instance&&componentById(instance.componentId);
      if(part&&!enclosureFit(e,part).fits)warnings.push('Selected component does not fit the enclosure cavity with its current standoff allowance.');
    }
  }
  return {chassis,files,warnings:[...new Set(warnings)]};
}
const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function createRoverPackage(robot:GarageRobot,expectedVersionId:string,at:string):{filename:string;bytes:Uint8Array;files:string[]} {
  if(robot.archivedAt)throw new Error('Restore the archived robot before exporting.');
  const version=robot.versions.at(-1);
  if(!version||version.id!==expectedVersionId)throw new Error('Robot version changed. Reload the saved design before exporting.');
  if(!version.planned||!version.spec?.roverDesign)throw new Error('Save a planned rover design before exporting.');
  const spec=version.spec;
  assertRoverConsistency(spec);
  const settings:RoverCadSettings=spec.roverDesign.cad;
  if(!settings)throw new Error('Save reviewed chassis dimensions before exporting.');
  if(Math.abs(settings.chassis.lengthMm/1000-spec.length_m)>.00001||Math.abs(settings.chassis.widthMm/1000-spec.width_m)>.00001)throw new Error('Saved chassis dimensions differ from the robot spec. Review and save them together.');
  const cad=roverCadArtifacts(spec,settings);
  const catalogue:CataloguePart[]=spec.roverDesign.catalogue||[];
  const bom=spec.forge.bom.map((line:{partId:string;qty:number;source:string})=>{
    const p=catalogue.find(p=>p.id===line.partId);
    return {...line,name:p?.name||line.partId,sourceUrl:p?.found_url||p?.shops?.[0]?.url||null,specs:p?.specs||{},ownership:'selection only — not owned stock'};
  });
  const checks=reconcileRoverAssembly(spec).forge.checks;
  const findings={status:'PLANNED — software checks only',checks,requirements:spec.roverDesign.requirements,warnings:[...cad.warnings,'Budget and payload requirements are not validated by this package.','Mass and catalogue envelopes may be estimates; verify physical dimensions, mounting, electrical interfaces and drive performance.']};
  const assembly=spec.assembly;
  const files:Record<string,string>={
    'robot-spec.json':json(spec),'simulation-spec.json':json(spec),
    'bom.json':json(bom),
    'bom.csv':['Part ID,Name,Quantity,Source,Source URL',...bom.map((p:{partId:string;name:string;qty:number;source:string;sourceUrl:string|null})=>[p.partId,p.name,p.qty,p.source,p.sourceUrl].map(cell).join(','))].join('\n')+'\n',
    'assembly.json':json(assembly),
    'wiring.json':json({status:'NOT_CHECKED — planned connections',rolePlan:spec.forge.wiring,instanceConnections:assembly.connections}),
    'findings.json':json(findings),
    'cad/settings.json':json(settings),
    'assembly-guide.md':[
      '# Rover assembly planning guide','',
      'Generic planning steps, not verified instructions for your physical hardware.','',
      '1. Confirm the parts list, dimensions, mounting patterns and fasteners against actual hardware.',
      '2. Review chassis and mount CAD in OpenSCAD; check printer-bed size and print a fit sample.',
      '3. Use assembly.json for individual component positions (metres) and yaw (degrees); mounting must be designed and checked.',
      '4. Fit the chassis, drive hardware and low-mounted battery without energizing the robot.',
      '5. Position electronics and sensors using the saved assembly. Confirm access, thermal clearance and sensor sight lines.',
      '6. Review wiring.json against manufacturer documentation. Planned links do not verify pins, current limits or protection.',
      '7. Bench-check with appropriate current limiting and wheels raised; record measurements before trusting simulation.',
      '',`Saved robot version: ${version.id}. Assembly revision: ${assembly.id}.`,'',
    ].join('\n'),
    'README.md':[
      '# RobotForge rover build package','',`Robot ID: ${robot.id}`,`Robot version: ${version.id}`,`Assembly revision: ${assembly.id}`,`Exported: ${at}`,'',
      'PLANNED design. This archive is software-generated, not hardware-tested or manufacturing-certified.',
      'robot-spec.json is the exact saved design. simulation-spec.json is the same JSON for RobotForge; this is not a URDF or Gazebo acceptance result.',
      'Assembly positions use metres; yaw uses degrees. CAD and STL use millimetres. CAD hole coordinates are relative to the plate centre.',
      'STL files are generated from the same rectangular plate and hole parameters as the accompanying OpenSCAD. OpenSCAD is editable; enclosure STL is not included.',
      'No joined-tile chassis or invented mounting pattern is provided. Larger plates need a suitable printer or redesign.',
      'Consult findings.json for checks, missing evidence, estimates and CAD warnings. Budget/payload and physical fit still need verification.',
      'BOM entries are design selections, not a claim of ownership or a purchase.', '',
    ].join('\n'),...cad.files,
  };
  const manifest={format:'robotforge-rover-build-v1',robotId:robot.id,robotVersionId:version.id,assemblyRevisionId:assembly.id,createdAt:at,units:{assembly:'m',rotation:'deg',cad:'mm'},files:Object.keys(files).sort(),status:'PLANNED'};
  files['manifest.json']=json(manifest);
  const bytes=zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])),{level:6});
  const slug=robot.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'rover';
  return {filename:slug+'-build.zip',bytes,files:Object.keys(files).sort()};
}
