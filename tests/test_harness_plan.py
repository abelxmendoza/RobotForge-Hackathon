"""Browser harness calculations exercise real TypeScript through Node."""
import shutil
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

def test_harness_plan(tmp_path):
    source = REPO / 'web-next/src/lib/harnessPlan.ts'
    assert source.exists(), 'Harness planner has not been implemented'
    (tmp_path / 'harnessPlan.ts').write_text(source.read_text())
    (tmp_path / 'run.mjs').write_text(r'''
import assert from 'node:assert/strict';
import { harnessPlan, harnessCSV, wirevizYAML } from './harnessPlan.ts';
const w = { nodes: [{id:'battery',label:'Battery',output_current_a:2},{id:'load',label:'Load',rated_min_v:4.8,rated_max_v:5.2,current_a:3}], connections:[{from:'battery',to:'load',kind:'power',volts:6,cable:{gauge_awg:24,length_mm:1000}}] };
let p = harnessPlan(w);
assert.equal(p.checks.find(c=>c.check==='voltage_range').severity,'ERROR');
assert.equal(p.checks.find(c=>c.check==='rail_budget').severity,'ERROR');
assert.ok(p.checks.find(c=>c.check==='voltage_drop').values.drop_v > 0.4);
assert.equal(wirevizYAML(w).yaml,null);
assert.ok(wirevizYAML(w).missing.some(s=>s.includes('from_pin')));
assert.ok(harnessCSV(w).includes('from_pin'));
w.connections[0].volts=5; delete w.nodes[1].rated_min_v;
assert.equal(harnessPlan(w).checks[0].coverage,'PARTIAL');
delete w.nodes[1].current_a;
assert.equal(harnessPlan(w).checks.find(c=>c.check==='voltage_drop').coverage,'NOT_CHECKED');
w.nodes[1].current_a=1; w.connections[0].volts_min_v=4; w.connections[0].volts_max_v=6;
assert.equal(harnessPlan(w).checks[0].severity,'ERROR');
w.connections[0].from_pin='1'; w.connections[0].to_pin='VIN';
assert.ok(wirevizYAML(w).yaml.includes('"connections":'));
const selfDraw={nodes:[{id:'s',label:'source',output_current_a:1},{id:'ctrl',label:'controller',current_a:.4},{id:'sensor',label:'sensor',current_a:.1}],connections:[{from:'s',to:'ctrl',kind:'power',volts:5,cable:{gauge_awg:20,length_mm:100}},{from:'ctrl',to:'sensor',kind:'power',volts:5}]};
assert.equal(harnessPlan(selfDraw).checks.find(c=>c.check==='rail_budget').values.known_load_a,.5);
delete selfDraw.nodes[1].current_a;
assert.equal(harnessPlan(selfDraw).checks.find(c=>c.check==='rail_budget').coverage,'NOT_CHECKED');
selfDraw.connections[0].current_a=.5;
assert.equal(harnessPlan(selfDraw).checks.find(c=>c.check==='rail_budget').coverage,'CHECKED');
selfDraw.connections[0].cable.gauge_awg=20.5;
assert.equal(harnessPlan(selfDraw).checks.find(c=>c.check==='voltage_drop').coverage,'NOT_CHECKED');
selfDraw.connections[0].volts_min_v=NaN;
assert.equal(harnessPlan(selfDraw).checks[0].coverage,'NOT_CHECKED');
selfDraw.connections[0].current_a=NaN;
assert.equal(harnessPlan(selfDraw).checks.find(c=>c.check==='rail_budget').coverage,'NOT_CHECKED');
const invalidSource={nodes:[{id:'s',label:'s',output_min_v:NaN},{id:'load',label:'load',rated_min_v:4,rated_max_v:6,current_a:1}],connections:[{from:'s',to:'load',kind:'power',volts:5,cable:{gauge_awg:20,length_mm:50}}]};
assert.equal(harnessPlan(invalidSource).checks[0].coverage,'NOT_CHECKED');
assert.equal(harnessPlan(invalidSource).checks.find(c=>c.check==='voltage_drop').coverage,'NOT_CHECKED');
const incomplete = {nodes:[{id:'s',label:'s',output_current_a:1},{id:'a',label:'a',current_a:2},{id:'b',label:'b'}],connections:[{from:'s',to:'a',kind:'power',volts:5},{from:'s',to:'b',kind:'power',volts:5}]};
const rail = harnessPlan(incomplete).checks.find(c=>c.check==='rail_budget');
assert.equal(rail.coverage,'PARTIAL'); assert.equal(rail.severity,'ERROR');
assert.equal(harnessPlan(incomplete).checks[0].coverage,'NOT_CHECKED');
const converted = {nodes:[{id:'s',label:'s'},{id:'reg',label:'reg'},{id:'a',label:'a',current_a:2}],connections:[{from:'s',to:'reg',kind:'power',volts:12,cable:{gauge_awg:20,length_mm:100}},{from:'reg',to:'a',kind:'power',volts:5}]};
assert.equal(harnessPlan(converted).checks.find(c=>c.check==='voltage_drop').coverage,'NOT_CHECKED');
converted.connections[0].current_a=0;
assert.equal(harnessPlan(converted).checks.find(c=>c.check==='voltage_drop').values.drop_v,0);
w.connections.push({from:'load',to:'battery',kind:'power'});
assert.equal(harnessPlan(w).checks.find(c=>c.check==='rail_budget').coverage,'NOT_CHECKED');
''')
    result = subprocess.run([shutil.which('node') or 'node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_wiring_facts_validation(tmp_path):
    lib = REPO / 'web-next/src/lib'
    for name in ('wiring.ts', 'wiringFacts.ts'):
        (tmp_path / name).write_text((lib / name).read_text())
    (tmp_path / 'run.mjs').write_text(r'''
import assert from 'node:assert/strict';
import {saveWiringFacts} from './wiringFacts.ts';
const w={nodes:[{id:'a',label:'A',custom:42}],connections:[{from:'a',to:'a',kind:'power',custom:'keep',cable:{connector:'USB',length_mm:50}}]};
assert.throws(()=>saveWiringFacts(w,'node',0,{current_a:'-1'}));
assert.throws(()=>saveWiringFacts(w,'connection',0,{gauge_awg:'41'}));
assert.throws(()=>saveWiringFacts(w,'connection',0,{length_mm:'Infinity'}));
const next=saveWiringFacts(w,'connection',0,{from_pin:'VIN',length_mm:'',current_a:'0'});
assert.equal(next.connections[0].cable.connector,'USB');
assert.equal(next.connections[0].cable.length_mm,undefined);
assert.equal(next.connections[0].current_a,0);
assert.equal(next.connections[0].custom,'keep');
assert.equal(w.connections[0].cable.length_mm,50);
assert.match(next.connections[0].electrical_facts_source,/unverified/);
''')
    result = subprocess.run([shutil.which('node') or 'node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
