"""Synthetic software checks of coherent rover snapshots (no hardware validation)."""
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def test_rover_design(tmp_path):
    for name in ['roverDesign', 'components', 'forgeEngine', 'assembly']:
        text = (ROOT / f'web-next/src/lib/{name}.ts').read_text()
        for dep in ['components', 'forgeEngine', 'roverDesign']:
            text = text.replace(f"from './{dep}'", f"from './{dep}.ts'")
        (tmp_path / f'{name}.ts').write_text(text)
    (tmp_path / 'parts.json').write_text((ROOT / 'catalog/parts.json').read_text())
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultRoverRequirements,createRoverConcept,roverRoleChoices,swapRoverPart,seedRoverAssembly,reconcileRoverAssembly,assertRoverConsistency,saveRoverVersion,roverDesignChecks,roverComponentDefinition} from './roverDesign.ts';
import {CATALOGUE_COMPONENTS,componentById} from './components.ts';
import {commitAssemblyVersion,operationFor,effectiveAssemblies} from './assembly.ts';
const cat=JSON.parse(readFileSync(new URL('./parts.json',import.meta.url))).parts;
assert.equal(CATALOGUE_COMPONENTS.length,cat.length);
for(const p of cat){const c=componentById('catalog--'+p.id);assert.ok(c);assert.deepEqual(c.mounting.holePatternMm,[]);assert.deepEqual(c.terminals,[]);}
const req={...defaultRoverRequirements(),name:'Synthetic scout',purpose:'Inspect a simulated room',budgetUsd:300,payloadKg:1};
assert.throws(()=>createRoverConcept({...req,budgetUsd:-1},cat));
const preview=createRoverConcept(req,cat);assert.equal(preview.assembly,undefined);assert.equal(preview.roverDesign.requirements.budgetUsd,300);
assert.ok(preview.forge.checks.some(c=>c.id==='requirement-budget'&&c.verdict==='NOT_CHECKED'));
assert.equal(preview.forge.checks.find(c=>c.id==='print-bed-fit').verdict,'ERROR','Oversized chassis is not magically split into joined tiles');
assert.ok(!roverRoleChoices(preview,cat).find(r=>r.role==='driver').options.some(p=>['driver_a4988','driver_pca9685'].includes(p.id)),'DC motor choice must exclude stepper and PWM-only boards');
const clone=JSON.stringify(preview);
const custom={id:'test_motor',name:'Unrated DC gearmotor',part_class:'actuators',specs:{kind:'dc_gearmotor'}};
const withCad=structuredClone(preview);withCad.roverDesign.cad={chassis:{lengthMm:320,widthMm:260,thicknessMm:5,holes:[[10,10]],holeDiameterMm:3.2},enclosure:{length_mm:120},mount:null};
const preservedCad=swapRoverPart(withCad,'controller','raspberry_pi_4b',cat);assert.deepEqual(preservedCad.roverDesign.cad,withCad.roverDesign.cad,'Unrelated part swap preserves custom CAD');
const swapped=swapRoverPart(preview,'motor',custom.id,[...cat,custom]);assert.equal(swapped.motor.count,2);assert.equal(swapped.motor.voltage_v,null);assert.equal(swapped.motor.stall_torque_nm,null);assert.equal(JSON.stringify(preview),clone);assert.equal(swapped.forge.checks.find(c=>c.id==='motor-count').verdict,'PASS');
assert.throws(()=>swapRoverPart(preview,'motor','lipo_4s_5200',cat));
assert.ok(roverRoleChoices(preview,cat).find(c=>c.role==='motor').options.every(c=>c.part_class==='actuators'));
let seeded=seedRoverAssembly(preview,'v1','2026-11-10T00:00:00Z');assertRoverConsistency(seeded);
assert.equal(seeded.assembly.components.length,seeded.forge.bom.reduce((n,b)=>n+b.qty,0));
const motors=seeded.assembly.components.filter(c=>c.componentId==='catalog--'+seeded.forge.ids.motor);assert.equal(motors.length,2);assert.notEqual(motors[0].positionM[1],motors[1].positionM[1]);
seeded.assembly.components[0].positionM=[.01,.02,.03];
const reconciled=reconcileRoverAssembly(seeded);assert.deepEqual(reconciled.assembly.components[0].positionM,[.01,.02,.03]);assert.deepEqual(reconciled.forge.placement[0].pos_mm,[10,20,30]);
const added=structuredClone(seeded);added.assembly.components.push({...motors[0],id:'extra_motor'});const more=reconcileRoverAssembly(added);assert.equal(more.motor.count,3);assert.equal(more.forge.bom.find(b=>b.partId===more.forge.ids.motor).qty,3);
const invalid=structuredClone(seeded);invalid.assembly.components[0].componentId='unknown';assert.throws(()=>reconcileRoverAssembly(invalid),/identity/i);
const missing=structuredClone(seeded);missing.assembly.components=missing.assembly.components.filter(c=>c.componentId!=='catalog--'+missing.forge.ids.motor);assert.throws(()=>assertRoverConsistency(reconcileRoverAssembly(missing)),/motor/i);
const first=saveRoverVersion([],preview,'robot',null,'v1','2026-11-10T00:00:00Z');assert.equal(first[0].versions[0].planned,true);const history=JSON.stringify(first);
assert.throws(()=>saveRoverVersion(first,preview,'robot','wrong','v2','t'),/changed/i);assert.throws(()=>saveRoverVersion(first,preview,'other',null,'v2','t'),/name/i);
const next=saveRoverVersion(first,preview,'robot','v1','v2','2026-11-10T00:01:00Z');assert.equal(next[0].versions.length,2);assert.equal(next[0].versions[1].spec.assembly.id,'v2');assert.equal(JSON.stringify(first),history);
assert.throws(()=>saveRoverVersion([{...first[0],archivedAt:'2026-11-10T00:00:00Z'}],preview,'robot','v1','v2','t'),/archived/i);

const four=seedRoverAssembly(createRoverConcept({...req,archetype:'mecanum_rover'},cat),'four','t');assertRoverConsistency(four);assert.equal(four.motor.count,4);assert.equal(four.forge.wiring.filter(w=>four.assembly.components.find(c=>c.id===w.to)?.componentId==='catalog--'+four.forge.ids.motor).length,4);
assert.throws(()=>swapRoverPart(preview,'wheel','mecanum_wheel_100mm',cat),/incompatible/i);
const sup=structuredClone(seeded);sup.assembly.components.push({id:'extra_structure',componentId:'catalog--'+cat.find(p=>p.part_class==='structure'&&!seeded.forge.bom.some(b=>b.partId===p.id)).id,positionM:[0,0,.1],yawDeg:0});sup.gate_status='PASS';const supplemented=reconcileRoverAssembly(sup);assert.equal(supplemented.gate_status,undefined);assert.ok(supplemented.forge.checks.some(c=>c.id==='supplemental-effects'&&c.verdict==='NOT_CHECKED'));assertRoverConsistency(supplemented);
const connected=structuredClone(seeded);connected.assembly.connections=[{id:'custom-link',from:motors[0].id,to:motors[1].id}];assert.deepEqual(reconcileRoverAssembly(connected).assembly.connections,connected.assembly.connections);
const stale=structuredClone(seeded);stale.forge.placement[0].pos_mm=[999,999,999];assert.throws(()=>assertRoverConsistency(stale),/stale/i);
const duplicate=structuredClone(seeded);duplicate.assembly.components.push(duplicate.assembly.components[0]);assert.throws(()=>reconcileRoverAssembly(duplicate),/Duplicate/);

const moveOp=operationFor(first,effectiveAssemblies(first,{}),'robot',{kind:'move',instanceId:first[0].versions[0].spec.assembly.components[0].id,positionM:[.04,.05,.06],yawDeg:30});
const moved=commitAssemblyVersion(first,{},moveOp,'moved','2026-11-10T00:02:00Z');assertRoverConsistency(moved[0].versions.at(-1).spec);assert.deepEqual(moved[0].versions.at(-1).spec.forge.placement[0].pos_mm,[40,50,60]);assert.equal(JSON.stringify(first),history);
const extraOp=operationFor(first,effectiveAssemblies(first,{}),'robot',{kind:'add',instanceId:'third_motor',componentId:motors[0].componentId,positionM:[0,0,.1]});const extra=commitAssemblyVersion(first,{},extraOp,'extra','2026-11-10T00:03:00Z');assert.equal(extra[0].versions.at(-1).spec.motor.count,3);

const elevated=structuredClone(first[0].versions[0].spec);elevated.assembly.components.find(c=>c.componentId==='catalog--'+elevated.forge.ids.battery).positionM=[1,0,1];const actual=reconcileRoverAssembly(elevated);const batteryCheck=actual.forge.checks.find(c=>c.id==='battery-placement');assert.equal(batteryCheck.verdict,'WARN');assert.match(batteryCheck.detail,/1000, 0, 1000/);assert.deepEqual(roverDesignChecks(actual),actual.forge.checks);
const noRegulator=structuredClone(first[0].versions[0].spec);noRegulator.assembly.components=noRegulator.assembly.components.filter(c=>c.componentId!=='catalog--'+noRegulator.forge.ids.regulator);const unpowered=reconcileRoverAssembly(noRegulator);assert.equal(unpowered.forge.checks.find(c=>c.id==='unpowered').verdict,'ERROR');assert.ok(unpowered.forge.checks.some(c=>c.id==='missing-role-regulator'&&c.verdict==='ERROR'));assert.throws(()=>assertRoverConsistency(unpowered),/regulator|power/i);
const noWires=structuredClone(first[0].versions[0].spec);noWires.forge.wiring=[];assert.equal(roverDesignChecks(noWires).find(c=>c.id==='unpowered').verdict,'ERROR');assert.ok(!roverDesignChecks(noWires).some(c=>c.id.startsWith('voltage-')&&c.verdict==='PASS'));
const forged=structuredClone(first[0].versions[0].spec);forged.forge.checks.find(c=>c.id==='battery-placement').detail='invented';assert.throws(()=>assertRoverConsistency(forged),/checks|findings|stale/i);
const chassis=first[0].versions[0].spec.assembly.components.find(c=>c.componentId==='catalog--'+preview.forge.ids.chassis);const definition=roverComponentDefinition(preview,chassis);assert.deepEqual(definition.sizeM,[preview.length_m,preview.width_m,.004]);assert.deepEqual(definition.mounting.holePatternMm,[]);

assert.ok(first[0].versions[0].spec.forge.wiring.filter(w=>motors.some(m=>m.id===w.to)&&w.kind==='power').every(w=>w.volts===null));
const highReg={id:'test_regulator',name:'Recorded 12 V output regulator',part_class:'power',specs:{output_v:12,input_v_max:24}};const highRail=swapRoverPart(first[0].versions[0].spec,'regulator',highReg.id,[...cat,highReg]);const controllerInstance=highRail.assembly.components.find(c=>c.componentId==='catalog--'+highRail.forge.ids.controller);assert.equal(highRail.forge.wiring.find(w=>w.to===controllerInstance.id&&w.kind==='power').volts,12);

const savedChassis=first[0].versions[0].spec.assembly.components.find(c=>c.id===chassis.id);assert.deepEqual(savedChassis.sizeM,[preview.length_m,preview.width_m,.004]);const staleSize=structuredClone(first[0].versions[0].spec);staleSize.assembly.components.find(c=>c.id===chassis.id).sizeM=[.08,.05,.006];assert.throws(()=>assertRoverConsistency(staleSize),/dimensions|stale/);
console.log('Rover design invariants passed');





''')
    run = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'run.mjs')],capture_output=True,text=True)
    assert run.returncode == 0, run.stdout + run.stderr
