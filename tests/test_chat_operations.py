"""Execute the shared TS operation boundary with real Garage field metadata."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_chat_operation_transactions(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is unavailable')
    lib = ROOT / 'web-next/src/lib'
    (tmp_path / 'garage.ts').write_text((lib / 'garage.ts').read_text())
    (tmp_path / 'operations.ts').write_text(
        (lib / 'operations.ts').read_text().replace("from './garage'", "from './garage.ts'"))
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    script = '''
import assert from 'node:assert/strict';
import { parseCommand, proposeCommand, previewOperation, applyOperation, undoOperation } from './operations.ts';
const spec = {name:'Omega1', wheel:{diameter_m:0.1}, mass_kg:2};
const robots = [{id:'r',name:'Omega1',createdAt:'t',versions:[{id:'v0',label:'Baseline',note:'',source:'starter',createdAt:'t',spec}]}];
const original = JSON.stringify(robots);
assert.equal(parseCommand('what battery should I use?'), null);
assert.equal(parseCommand('undo last chat change').kind, 'undo');
const c = parseCommand('set "omega1" wheel.diameter_m to 0.12');
const p = proposeCommand(robots,c);
assert.equal(p.before,0.1); assert.equal(p.after,0.12);
const next = applyOperation(robots,p.operation,'v1','t1');
assert.equal(next[0].versions.at(-1).spec.wheel.diameter_m,0.12);
assert.equal(JSON.stringify(robots),original);
assert.throws(()=>applyOperation(next,p.operation,'v2','t2'),/changed/);
for (const value of [-1,0,NaN,Infinity,'12']) {
  assert.throws(()=>previewOperation(robots,{...p.operation,value}));
}
assert.throws(()=>previewOperation(robots,{...p.operation,path:'__proto__.polluted',value:1}));
assert.equal({}.polluted,undefined);
assert.throws(()=>previewOperation(robots,{...p.operation,path:'wheel.count',value:1.5}));
assert.throws(()=>previewOperation(robots,{...p.operation,path:'drivetrain',value:'magic'}));
assert.throws(()=>previewOperation(robots,{...p.operation,kind:'execute-code'}));
assert.throws(()=>proposeCommand([...robots,{...robots[0],id:'r2'}],c),/More than one/);
assert.throws(()=>proposeCommand(robots,{...c,rawValue:'120 mm'}),/spec units/);
assert.throws(()=>proposeCommand(robots,{...c,rawValue:'0x10'}));
const restored = undoOperation(next,'r','v1','v2','t2');
assert.deepEqual(restored[0].versions.at(-1).spec,spec);
assert.equal(restored[0].versions.length,3);
assert.throws(()=>undoOperation(restored,'r','v1','v3','t3'),/newer change/);
assert.throws(()=>proposeCommand(robots,{...c,robotName:'missing'}),/No saved robot/);
console.log('operation transaction checks passed');
'''
    (tmp_path / 'run.mjs').write_text(script)
    result = subprocess.run([node, '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
