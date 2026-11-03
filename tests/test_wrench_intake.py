"""Main composer accepts phone meshes and resolves targets without guessing."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]

def test_wrench_intake_helpers(tmp_path):
    lib=ROOT/'web-next/src/lib'
    for name in ['handoff','wrenchIntake','garage']:
        (tmp_path/f'{name}.ts').write_text((lib/f'{name}.ts').read_text().replace("from './garage'","from './garage.ts'"))
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {handoffKind,HANDOFF_ACCEPT} from './handoff.ts';
import {intakeTarget,friendlyEdit,conceptRequest,mergePhotoDraft,modificationRequest} from './wrenchIntake.ts';
for(const name of ['robot.GLB','scan.obj','depth.ply']){
 assert.equal(handoffKind({name,type:'application/octet-stream'}),'scan');
 assert.ok(HANDOFF_ACCEPT.includes('.'+name.split('.').pop().toLowerCase()));
}
assert.equal(handoffKind({name:'robot.gltf',type:'application/json'}),null);
const a={id:'a',name:'Omega1'},b={id:'b',name:'Omega1'};
assert.equal(intakeTarget([a,b],{robotId:'b',robotName:'Omega1'}).id,'b');
assert.throws(()=>intakeTarget([a,b],{robotName:'Omega1'}),/select/i);
assert.throws(()=>intakeTarget([a],{robotId:'gone',robotName:'Omega1'}),/no longer/i);
assert.equal(intakeTarget([a],null),null);
assert.deepEqual(friendlyEdit('make the wheels 100 mm'),{path:'wheel.diameter_m',value:0.1});
assert.deepEqual(friendlyEdit('my robot weighs 1250 g'),{path:'mass_kg',value:1.25});
assert.deepEqual(friendlyEdit('set the length to 30 cm'),{path:'length_m',value:0.3});
assert.equal(friendlyEdit('make it better'),null);
assert.equal(friendlyEdit('set length to -30 cm'),null);
assert.equal(conceptRequest('generate a compact rover'),'new');
assert.equal(conceptRequest('regenerate it with a camera'),'regenerate');
assert.equal(conceptRequest('how do I generate a rover?'),null);
assert.equal(conceptRequest('generate a twin from my photo'),null);
assert.equal(modificationRequest('Would a bigger battery help?'),false);
assert.equal(modificationRequest("Don't add a camera"),false);
assert.equal(modificationRequest('Add a camera'),true);
const merged=mergePhotoDraft({name:'My robot',mass_kg:1.2,wheel:{count:4},ground_clearance_m:0},{name:'Guess',mass_kg:9,wheel:{count:2,diameter_m:0.1},height_m:0.3});
assert.equal(merged.spec.mass_kg,1.2);
assert.equal(merged.spec.name,'My robot');
assert.equal(merged.spec.wheel.count,4);
assert.equal(merged.spec.wheel.diameter_m,0.1);
assert.equal(merged.spec.ground_clearance_m,0);
assert.ok(merged.estimatedPaths.includes('wheel.diameter_m'));
assert.ok(!merged.estimatedPaths.includes('mass_kg'));
''')
    r=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
