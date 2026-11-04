/** Pure coordinated Pi 5 proposal. No storage, network or hardware side effects. */
import type { GarageRobot } from './garage';
import { currentAssembly, effectiveAssemblies, type Assemblies, type AssemblyVersion } from './assembly';
import { componentById } from './components';
import { generateMount, mountDefaults } from './buildArtifacts';
import { generateCad } from './cadGen';
import { harnessPlan, type HarnessCheck } from './harnessPlan';
import type { Wiring } from './wiring';

export interface UpgradeInputs { supplyMinV?:number; supplyMaxV?:number; loadCurrentA?:number; qualifiedConverterCurrentA?:number; powerInterfaceConfirmed?:boolean; loadMinV?:number; loadMaxV?:number; qualificationSource?:string; thermalConditions?:string; interfaceEvidence?:string }
export interface UpgradePlan {
  robotId:string; expectedRobotVersionId:string; expectedAssemblyRevision:string|null;
  inputs:UpgradeInputs; componentName:string; summary:string; blockers:string[]; missing:string[]; warnings:string[];
  checks:HarnessCheck[]; assembly:AssemblyVersion; wiring:Wiring; artifacts:{filename:string;source:string}[];
  candidate:{name:string;url:string;note:string}|null;
}
const copy = <T>(v:T):T => structuredClone(v);
const PI = 'raspberry-pi-5-sbc';
export function planUpgrade(robot:GarageRobot, assembly:AssemblyVersion, inputs:UpgradeInputs):UpgradePlan {
  const version=robot.versions.at(-1);
  if (!version) throw new Error('Save a robot first.');
  const spec=version.spec ?? {}, part=componentById(PI)!;
  const wiring:Wiring=copy(spec.wiring ?? {nodes:[],connections:[]});
  const next=copy(assembly), blockers:string[]=[], missing:string[]=[], warnings:string[]=[
    'PLANNED / UNVERIFIED: not ready for power. User-entered electrical values are unverified.',
    'Raspberry Pi recommends a 5.1 V supply and 5 A USB-PD capacity; this is not measured bare-board consumption. https://www.raspberrypi.com/documentation/computers/raspberry-pi.html',
    'Cable routing and component placement are planning estimates. Pinouts, ampacity, protection, thermal clearance and physical fit need verification.',
    'Simulation is incomplete: added hardware mass and inertia have not been calibrated; prior version results do not apply.',
  ];
  if (robot.archivedAt && Number.isFinite(Date.parse(robot.archivedAt))) blockers.push('Robot is archived.');
  for (const key of ['supplyMinV','supplyMaxV','loadCurrentA','qualifiedConverterCurrentA','loadMinV','loadMaxV'] as const) {
    const value=inputs[key];
    if(value!==undefined && (typeof value!=='number'||!Number.isFinite(value)||value<=0)) blockers.push(key+' must be a finite positive number.');
  }
  if(inputs.powerInterfaceConfirmed!==undefined && typeof inputs.powerInterfaceConfirmed!=='boolean') blockers.push('Power interface confirmation must be boolean.');
  if(spec.battery && typeof spec.battery==='object' && !wiring.nodes.some(n=>n.id==='battery')) {
    wiring.nodes.push({id:'battery',label:'Saved battery — identity and physical properties unverified'});
  }
  const source=wiring.nodes.find(n=>n.id==='battery') as (typeof wiring.nodes[number] & {output_min_v?:number;output_max_v?:number})|undefined;
  const lo=inputs.supplyMinV ?? source?.output_min_v ?? spec.battery?.min_voltage_v ?? spec.battery?.voltage_min_v;
  const hi=inputs.supplyMaxV ?? source?.output_max_v ?? spec.battery?.max_voltage_v ?? spec.battery?.voltage_max_v;
  const valid=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  if(lo===undefined) missing.push('Supply minimum voltage across discharge and operating conditions.');
  else if(!valid(lo)) blockers.push('Recorded supply minimum must be finite and positive.');
  if(hi===undefined) missing.push('Supply maximum voltage including full charge and transients.');
  else if(!valid(hi)) blockers.push('Recorded supply maximum must be finite and positive.');
  if(valid(lo)&&valid(hi)&&lo>hi) blockers.push('Supply minimum exceeds maximum.');
  if(!inputs.loadCurrentA) missing.push('Measured or specified total Pi rail load current including peripherals and startup.');
  if(!inputs.powerInterfaceConfirmed) missing.push('Power interface and USB-PD/connector/cable qualification; converter amperage does not establish USB-PD.');
  if(!inputs.loadMinV||!inputs.loadMaxV) missing.push('Confirmed Pi input operating bounds and delivered voltage under load; recommended supply voltage is not an operating range.');
  if(inputs.loadMinV && inputs.loadMaxV && inputs.loadMinV>inputs.loadMaxV) blockers.push('Load minimum exceeds maximum.');
  if(!inputs.qualificationSource?.trim() || !inputs.thermalConditions?.trim()) missing.push('Converter current qualification source and actual thermal conditions.');
  if(!inputs.interfaceEvidence?.trim()) missing.push('Power interface evidence describing actual USB-PD or alternate power connection.');
  if(inputs.qualifiedConverterCurrentA && inputs.qualifiedConverterCurrentA>8) blockers.push('Claimed continuous rating exceeds the published typical maximum 8 A; choose and document another converter.');
  missing.push('Mounting fit, cooler/port clearances, wiring pin assignments, fusing and simulation mass/inertia.');
  if(source) {
    Object.assign(source, {
      ...(valid(lo)?{output_min_v:lo}:{}), ...(valid(hi)?{output_max_v:hi}:{}),
      electrical_facts_source:(inputs.supplyMinV!==undefined||inputs.supplyMaxV!==undefined)
        ? 'User-entered supply voltage bounds — unverified; original saved source facts retained where not overridden.'
        : 'Saved explicit source/battery voltage bounds only — unverified; nominal voltage is not expanded.',
    });
    if(!next.components.some(c=>c.id===source.id)) {
      next.components.push({id:source.id,componentId:'battery-envelope',positionM:[0,-0.065,0.02],yawDeg:0});
      missing.push('Battery geometry is an illustrative placeholder: exact identity, dimensions, mass, retention, connectors and protection remain unverified.');
    }
  }
  const piId='upgrade-pi5', converterId='upgrade-pi5-converter';
  if(next.components.some(c=>c.componentId===PI)||wiring.nodes.some(n=>n.id===piId||/raspberry\s*pi\s*5/i.test(n.label))) blockers.push('A Raspberry Pi 5 is already present; resolve the existing instance first.');
  if([...next.components,...wiring.nodes].some(n=>n.id===converterId||n.id===piId)) blockers.push('Upgrade instance ID already exists.');
  const clearance=valid(spec.ground_clearance_m)?spec.ground_clearance_m:0;
  next.components.push({id:piId,componentId:PI,positionM:[0,0,clearance+0.003+part.mounting.standoffHeightMm/1000+part.sizeM[2]/2],yawDeg:0});
  wiring.nodes.push({id:piId,label:part.name,...(inputs.loadCurrentA?{current_a:inputs.loadCurrentA}:{}),...(inputs.loadMinV?{rated_min_v:inputs.loadMinV}:{}),...(inputs.loadMaxV?{rated_max_v:inputs.loadMaxV}:{})});
  let candidate:UpgradePlan['candidate']=null;
  if(valid(hi)&&hi>5.2) warnings.push('Direct supply is incompatible with the Pi 5 V power input; do not connect the battery directly.');
  if(valid(lo)&&valid(hi)&&lo<=hi) {
    if(hi>38) blockers.push('Supply exceeds the candidate converter 38 V maximum. Choose and qualify another converter.');
    else if(lo>=6.5) {
      candidate={name:'Pololu D24V90F5 — electrical candidate only',url:'https://www.pololu.com/product/2866',note:'5 V nominal ±4% (4.8–5.2 V); VIN up to 38 V, effective lower limit output plus load-dependent 0.5–1.5 V dropout. Typical continuous current 4–8 A depends on operating and thermal conditions; 9 A headline is not a qualified continuous rating. Geometry remains an illustrative converter-envelope placeholder.'};
      next.components.push({id:converterId,componentId:'converter-envelope',positionM:[-0.07,0,clearance+0.02],yawDeg:0});
      wiring.nodes.push({id:converterId,label:candidate.name,...{rated_min_v:6.5,rated_max_v:38,output_min_v:4.8,output_max_v:5.2,...(inputs.qualifiedConverterCurrentA?{output_current_a:inputs.qualifiedConverterCurrentA}:{})}});
      if(!inputs.qualifiedConverterCurrentA) missing.push('Converter continuous current qualification at actual VIN, load, airflow, ambient temperature and heatsinking.');
      if(inputs.loadCurrentA && inputs.qualifiedConverterCurrentA && inputs.loadCurrentA>inputs.qualifiedConverterCurrentA) blockers.push('Pi rail load exceeds user-qualified converter continuous current.');
      if(source) {
        wiring.connections.push({from:source.id,to:converterId,kind:'power',label:'Planned supply feed; input current unknown',...{volts_min_v:lo,volts_max_v:hi}});
        if(next.components.some(c=>c.id===source.id)) next.connections.push({id:source.id+'--'+converterId,from:source.id,to:converterId});
      } else missing.push('Identify the existing supply wiring node and its physical assembly instance.');
      wiring.connections.push({from:converterId,to:piId,kind:'power',label:'Planned 5 V feed; interface unverified',volts:5,...{volts_min_v:4.8,volts_max_v:5.2},...(inputs.loadCurrentA?{current_a:inputs.loadCurrentA}:{})});
      next.connections.push({id:converterId+'--'+piId,from:converterId,to:piId});
    } else missing.push('No qualified power topology: full supply range must support regulation and load-dependent dropout; buck/boost selection remains unresolved.');
  }
  next.note='Planned incomplete Raspberry Pi 5 coordinated upgrade';
  const mount=generateMount(mountDefaults(part),part);
  const enclosure=generateCad({template:'enclosure',params:{length_mm:part.sizeM[0]*1000+20,width_mm:part.sizeM[1]*1000+20,height_mm:part.sizeM[2]*1000+part.mounting.standoffHeightMm+part.orientation.thermalClearanceTopMm+8,wall_mm:2}});
  const header='// Pi 5 planning enclosure from '+part.source+'\n// UNVERIFIED: cooler/ports/thermal airflow and standoff attachment require redesign and physical verification.\n';
  const artifacts=[{filename:'pi5-mount.scad',source:mount.source},...(enclosure.files??[{filename:enclosure.filename,source:enclosure.source}]).map(f=>({filename:'pi5-'+f.filename,source:header+f.source}))];
  const checks=harnessPlan(wiring).checks;
  // Preserve and surface any known conflict in the base graph as well.
  for(const check of checks) if(check.severity==='ERROR') blockers.push(check.subject+': '+check.detail);
  return {robotId:robot.id,expectedRobotVersionId:version.id,expectedAssemblyRevision:assembly.id||null,inputs:copy(inputs),componentName:part.name,summary:'Planned incomplete Pi 5 upgrade with coordinated assembly, wiring and printable CAD proposals. Not ready for power.',blockers:[...new Set(blockers)],missing,warnings,checks,assembly:next,wiring,artifacts,candidate};
}
export function applyUpgrade(robots:GarageRobot[],legacy:Assemblies,plan:UpgradePlan,versionId:string,createdAt:string):GarageRobot[] {
  const robot=robots.find(r=>r.id===plan.robotId);
  if(!robot) throw new Error('Robot was deleted.');
  if(robot.archivedAt&&Number.isFinite(Date.parse(robot.archivedAt))) throw new Error('Robot is archived.');
  if(robot.versions.at(-1)?.id!==plan.expectedRobotVersionId) throw new Error('Robot spec changed. Make a fresh proposal.');
  const assembly=currentAssembly(effectiveAssemblies(robots,legacy),robot.id);
  if((assembly.id||null)!==plan.expectedAssemblyRevision) throw new Error('Assembly changed. Make a fresh proposal.');
  if(!versionId||robot.versions.some(v=>v.id===versionId)) throw new Error('Choose a new version ID.');
  const fresh=planUpgrade(robot,assembly,plan.inputs);
  if(fresh.blockers.length) throw new Error(fresh.blockers.join(' '));
  const spec=copy(robot.versions.at(-1)!.spec);
  spec.assembly={...fresh.assembly,id:versionId,createdAt}; spec.wiring=fresh.wiring;
  spec.upgradePlan={...fresh,assembly:spec.assembly,status:'planned_incomplete',evidenceSource:'User-entered electrical inputs are unverified'};
  spec.upgradeArtifacts=fresh.artifacts;
  for(const key of ['gate_status','gate_report','gateReport','simulation_results','simulationResults','test_results','testResults']) delete spec[key];
  spec.simulation_status='incomplete: added hardware mass and inertia require calibration';
  return robots.map(r=>r.id!==robot.id?r:{...r,versions:[...r.versions,{id:versionId,label:'Planned incomplete Pi 5 upgrade',note:fresh.summary,source:'edit',createdAt,planned:true,spec}]});
}
