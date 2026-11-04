"""Simulation input and robot/version provenance contracts."""
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_simulation_contract(tmp_path):
    (tmp_path/'simulation.ts').write_text((ROOT/'web-next/src/lib/simulation.ts').read_text())
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'test.mjs').write_text('''
import assert from 'node:assert/strict';
import {simulationIssues,driveInput,parseSimCommand,runFingerprint,validGazeboRun} from './simulation.ts';
const s={drivetrain:'differential',length_m:.3,width_m:.2,height_m:.2,mass_kg:2,ground_clearance_m:.02,wheel:{diameter_m:.1,width_m:.02,count:2},motor:{stall_torque_nm:.5,count:2}};
assert.deepEqual(simulationIssues(s),[]);
assert.ok(simulationIssues({...s,mass_kg:undefined}).includes('mass_kg'));
assert.ok(simulationIssues({...s,drivetrain:'multirotor'}).length);
assert.deepEqual(driveInput(new Set(['ArrowUp','ArrowLeft'])),{throttle:1,turn:1});
assert.deepEqual(driveInput(new Set()),{throttle:0,turn:0});
assert.equal(parseSimCommand('try the ramp').scenario,'ramp');
assert.equal(parseSimCommand('what is a ramp?'),null);
assert.notEqual(runFingerprint('r','v',s),runFingerprint('r','v',{...s,mass_kg:3}));
assert.notEqual(runFingerprint('r','v',s),runFingerprint('r2','v',s));
assert.equal(validGazeboRun({status:'complete',robotId:'r',versionId:'v',result:{trajectory:{poses:[[0,0,0],[.5,0,90]]},drive:{truth_m:.5},turn:{truth_deg:90}}},'r','v'),true);
assert.equal(validGazeboRun({status:'complete',robotId:'other',versionId:'v'},'r','v'),false);
''')
    r=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'test.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr


def test_browser_drive_has_actual_contact_motion(tmp_path):
    import os
    lib=ROOT/'web-next/src/lib'
    for name in ['drivePhysics','simulation']:
        (tmp_path/f'{name}.ts').write_text((lib/f'{name}.ts').read_text().replace("from './simulation'","from './simulation.ts'"))
    os.symlink(ROOT/'web-next/node_modules',tmp_path/'node_modules',target_is_directory=True)
    (tmp_path/'package.json').write_text('{"type":"module"}')
    import json
    fixture=(ROOT/'examples/pathfinder.json').read_text()
    (tmp_path/'drive.mjs').write_text('''
import assert from 'node:assert/strict';
import {createDriveWorld} from './drivePhysics.ts';
const spec='''+fixture+''';
const world=await createDriveWorld(spec,'flat');
try{
 let pose;for(let i=0;i<120;i++)pose=world.step(0,0);
 assert.ok(Math.hypot(pose.x,pose.y)<.05,'stays still without a drive command');
 for(let i=0;i<180;i++)pose=world.step(1,0);
 assert.ok(pose.x>.3&&pose.x<1.2,'wheel motors really drive the physical chassis forward');
 for(let i=0;i<120;i++)pose=world.step(0,1);
 assert.ok(Math.abs(pose.qz)>.1,'differential wheel speeds turn the body');
 assert.ok(Object.values(pose).every(Number.isFinite));
}finally{world.free();}
const two=await createDriveWorld({...spec,wheel:{...spec.wheel,count:2},motor:{...spec.motor,count:2}},'flat');
try{let p;for(let i=0;i<120;i++)p=two.step(0,0);for(let i=0;i<180;i++)p=two.step(1,0);assert.ok(p.x>.3,'two-wheel rover casters must roll rather than stick to the ground');}finally{two.free();}
''')
    r=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'drive.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
