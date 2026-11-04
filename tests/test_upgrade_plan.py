"""Coordinated upgrade transactions run the actual TypeScript without a browser."""
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_upgrade_plan(tmp_path):
    lib = ROOT / 'web-next/src/lib'
    for path in lib.glob('*.ts'):
        (tmp_path / path.name).write_text(re.sub(r"from '(\./[^']+?)(?<!\.ts)'", r"from '\1.ts'", path.read_text()))
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text(r'''
import assert from 'node:assert/strict';
import {planUpgrade,applyUpgrade} from './upgradePlan.ts';
const a={id:'a1',note:'base',createdAt:'t',components:[],connections:[]};
const r={id:'r1',name:'R',versions:[{id:'v1',spec:{mass_kg:1,battery:{voltage_v:12},wiring:{nodes:[{id:'battery',label:'Battery'},{id:'motor',label:'Motor'}],connections:[{from:'battery',to:'motor',kind:'power',volts:12}]}}}]};
const original=JSON.stringify(r);
let p=planUpgrade(r,a,{});
assert.ok(p.missing.some(x=>/minimum/i.test(x))); assert.equal(p.candidate,null);
assert.equal(p.wiring.connections[0].to,'motor'); assert.equal(JSON.stringify(r),original);
for(const inputs of [{supplyMinV:NaN},{loadCurrentA:-1},{supplyMinV:12,supplyMaxV:10}]) assert.ok(planUpgrade(r,a,inputs).blockers.length);
p=planUpgrade(r,a,{supplyMinV:10,supplyMaxV:16,loadCurrentA:5});
assert.ok(p.candidate); assert.equal(p.assembly.components.length,3); assert.equal(p.artifacts.length,3);
assert.ok(p.warnings.some(x=>/direct/i.test(x))); assert.ok(p.missing.some(x=>/interface/i.test(x)));
const batteryGeometry=p.assembly.components.find(c=>c.id==='battery');
assert.equal(batteryGeometry.componentId,'battery-envelope');
assert.ok(p.assembly.connections.some(c=>c.from==='battery'&&c.to==='upgrade-pi5-converter'));
const starter={...r,versions:[{id:'v1',spec:{battery:{voltage_v:12}}}]};
const starterPlan=planUpgrade(starter,a,{supplyMinV:10,supplyMaxV:16});
const starterBattery=starterPlan.wiring.nodes.find(n=>n.id==='battery');
assert.equal(starterBattery.output_min_v,10);
assert.equal(starterBattery.output_max_v,16);
assert.match(starterBattery.electrical_facts_source,/user-entered.*unverified/i);
assert.equal(planUpgrade(starter,a,{}).wiring.nodes.find(n=>n.id==='battery').output_max_v,undefined);
assert.equal(planUpgrade(r,a,{supplyMinV:4,supplyMaxV:12}).candidate,null);
assert.equal(planUpgrade(r,a,{supplyMinV:6.4,supplyMaxV:12}).candidate,null);
assert.ok(planUpgrade(r,a,{supplyMinV:10,supplyMaxV:16,loadMinV:5,loadMaxV:5.1}).blockers.length);
assert.ok(planUpgrade(r,a,{supplyMinV:10,supplyMaxV:16,loadCurrentA:5,qualifiedConverterCurrentA:4}).blockers.length);
assert.ok(planUpgrade(r,a,{qualifiedConverterCurrentA:9}).blockers.length);
const qualified=planUpgrade(r,a,{supplyMinV:10,supplyMaxV:16,loadCurrentA:5,qualifiedConverterCurrentA:6,powerInterfaceConfirmed:true});
assert.ok(qualified.missing.some(x=>/qualification source/i.test(x)));
assert.ok(qualified.missing.some(x=>/interface evidence/i.test(x)));
assert.ok(planUpgrade(r,a,{supplyMinV:10,supplyMaxV:40}).blockers.length);
const altered=structuredClone(p); altered.wiring.nodes=[]; altered.artifacts=[];
const saved=applyUpgrade([r],{r1:[a]},altered,'v2','t2');
assert.equal(saved[0].versions.length,2); assert.ok(saved[0].versions[1].planned);
assert.equal(saved[0].versions[1].spec.mass_kg,1);
assert.ok(saved[0].versions[1].spec.wiring.nodes.length>2);
assert.ok(saved[0].versions[1].spec.upgradePlan.artifacts.length);
assert.equal(JSON.stringify(r),original);
const authorityRobot={...r,versions:[{...r.versions[0],spec:{...r.versions[0].spec,assembly:a}}]};
assert.equal(applyUpgrade([authorityRobot],{r1:[{...a,id:'legacy-stale'}]},p,'v2','t2')[0].versions.length,2);
const tampered=structuredClone(p);tampered.inputs.supplyMaxV=40;tampered.blockers=[];
assert.throws(()=>applyUpgrade([r],{r1:[a]},tampered,'v2','t2'),/38/);
assert.throws(()=>applyUpgrade(saved,{r1:[a]},p,'v3','t3'),/changed/);
assert.throws(()=>applyUpgrade([{...r,archivedAt:'2026-11-03T00:00:00Z'}],{r1:[a]},p,'v2','t2'),/archived/);
assert.throws(()=>applyUpgrade([r],{r1:[{...a,id:'a2'}]},p,'v2','t2'),/changed/);
assert.ok(planUpgrade(r,{...a,components:[{id:'pi',componentId:'raspberry-pi-5-sbc',positionM:[0,0,0],yawDeg:0}]},{}).blockers.length);
''')
    result = subprocess.run([str(Path('/snap/node/current/bin/node')) if Path('/snap/node/current/bin/node').exists() else (shutil.which('node') or 'node'),'--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode == 0, result.stdout+result.stderr
