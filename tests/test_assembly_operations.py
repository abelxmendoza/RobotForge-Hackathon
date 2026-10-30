"""Exercise component assembly transactions independently of React/WebGL."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_assembly_transactions(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    lib = ROOT / 'web-next/src/lib'
    for name in ['assembly', 'components']:
        (tmp_path / f'{name}.ts').write_text((lib / f'{name}.ts').read_text().replace("from './components'", "from './components.ts'"))
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {resolveComponent} from './components.ts';
import {parseAssemblyCommand,previewAssembly,applyAssembly,operationFor,currentAssembly,undoAssembly} from './assembly.ts';
const robots=[{id:'robot1',name:'Omega1',versions:[{id:'v1',spec:{name:'Omega1',ground_clearance_m:0.03}}]}];
const original=JSON.stringify(robots);
assert.equal(resolveComponent('Jetson Orin Nano').sizeM[0],0.1);
assert.throws(()=>resolveComponent('Jetson AGX'));
assert.equal(parseAssemblyCommand('what is a Jetson?',robots,{},'part1'),null);
const add=parseAssemblyCommand('add a Jetson Orin Nano to "Omega1"',robots,{},'part1');
assert.equal(add.componentId,'jetson-orin-nano-reference-devkit');
assert.ok(Math.abs(previewAssembly(robots,{},add).components[0].positionM[2] - 0.0435) < 1e-12);
const all=applyAssembly(robots,{},add,'a1','t1');
assert.equal(JSON.stringify(robots),original);
assert.equal(all.robot1.length,1);
assert.throws(()=>applyAssembly(robots,all,add,'a2','t2'),/changed/);
assert.throws(()=>applyAssembly([{...robots[0],versions:[{id:'v2'}]}],{},add,'a2','t2'),/spec changed/);
assert.throws(()=>previewAssembly(robots,{}, {...add,componentId:'invented'}));
assert.throws(()=>previewAssembly(robots,{}, {...add,robotId:'__proto__'}));
for(const positionM of [[NaN,0,0],[0,Infinity,0],[0,0],[11,0,0],['0',0,0]]) assert.throws(()=>previewAssembly(robots,{}, {...add,positionM}));
const move=operationFor(robots,all,'robot1',{kind:'move',instanceId:'part1',positionM:[0.1,0,0.05],yawDeg:90});
const moved=applyAssembly(robots,all,move,'a2','t2');
assert.equal(currentAssembly(moved,'robot1').components[0].yawDeg,90);
assert.equal(currentAssembly(all,'robot1').components[0].yawDeg,0);
assert.throws(()=>previewAssembly(robots,all,{...move,yawDeg:NaN}));
assert.throws(()=>previewAssembly(robots,all,{...move,kind:'execute'}));
const moveCmd=parseAssemblyCommand('move "part1" on "Omega1" to 10 -20 80 mm yaw 45',robots,all,'unused');
assert.deepEqual(moveCmd.positionM,[0.01,-0.02,0.08]);
assert.equal(moveCmd.yawDeg,45);
const addBattery=parseAssemblyCommand('add a battery to "Omega1"',robots,moved,'battery1');
const withBattery=applyAssembly(robots,moved,addBattery,'a3','t3');
const connect=parseAssemblyCommand('connect "battery1" to "part1" on "Omega1"',robots,withBattery,'unused');
const namedConnection=parseAssemblyCommand('connect "battery" to "Jetson Orin Nano" on "Omega1"',robots,withBattery,'unused');
assert.equal(namedConnection.instanceId,'battery1'); assert.equal(namedConnection.targetId,'part1');
const connected=applyAssembly(robots,withBattery,connect,'a4','t4');
assert.equal(currentAssembly(connected,'robot1').connections.length,1);
assert.match(currentAssembly(connected,'robot1').note,/NOT_CHECKED/);
assert.throws(()=>previewAssembly(robots,withBattery,{...connect,targetId:'battery1'}),/itself/);
assert.throws(()=>previewAssembly(robots,withBattery,{...connect,targetId:'missing'}),/existing/);
const duplicate=operationFor(robots,connected,'robot1',{kind:'connect',instanceId:'battery1',targetId:'part1'});
assert.throws(()=>previewAssembly(robots,connected,duplicate),/already exists/);
const remove=parseAssemblyCommand('remove "battery1" from "Omega1"',robots,connected,'unused');
const removed=applyAssembly(robots,connected,remove,'a5','t5');
assert.equal(currentAssembly(removed,'robot1').components.length,1);
assert.equal(currentAssembly(removed,'robot1').connections.length,0);
const undone=undoAssembly(removed,'robot1','a5','a6','t6');
assert.equal(currentAssembly(undone,'robot1').connections.length,1);
assert.equal(currentAssembly(undone,'robot1').components.length,2);
assert.throws(()=>undoAssembly(undone,'robot1','a5','a7','t7'),/changed/);
const empty=undoAssembly(all,'robot1','a1','a2','t2');
assert.equal(currentAssembly(empty,'robot1').components.length,0);
assert.throws(()=>parseAssemblyCommand('add a Jetson Orin Nano to "Omega1"',[...robots,{...robots[0],id:'r2'}],{},'p'),/unique/);
console.log('assembly checks passed');
''')
    result = subprocess.run([node, '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
