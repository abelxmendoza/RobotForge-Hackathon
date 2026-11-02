"""Envelope math and snap semantics are independent of the renderer."""
import shutil
import subprocess
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
def test_spatial_tools(tmp_path):
    node=shutil.which('node')
    if not node: pytest.skip('Node unavailable')
    lib=ROOT/'web-next/src/lib'
    for name in ['components','spatial']:
        (tmp_path/f'{name}.ts').write_text((lib/f'{name}.ts').read_text().replace("from './components'","from './components.ts'"))
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {snapPlacement,envelopesOverlap,overlapPairs,shortestYaw} from './spatial.ts';
const a={id:'a',componentId:'battery-envelope',positionM:[0,0,0],yawDeg:0};
const b={id:'b',componentId:'converter-envelope',positionM:[0,0.039,0],yawDeg:0};
assert.equal(envelopesOverlap(a,b),false);
assert.equal(envelopesOverlap(a,{...b,yawDeg:90}),true);
assert.equal(envelopesOverlap({...b,yawDeg:90},a),true);
assert.equal(envelopesOverlap(a,{...b,positionM:[0,0,1]}),false);
assert.equal(envelopesOverlap(a,{...b,positionM:[0.0725,0,0]}),false); // face contact
assert.equal(envelopesOverlap(a,{...b,positionM:[0.07,0,0]}),true);
assert.equal(envelopesOverlap({...a,yawDeg:90},{...b,positionM:[0.07,0,0]}),false);
assert.deepEqual(overlapPairs([a,{...b,positionM:[0,0,0]}]),[['a','b']]);
const snapped=snapPlacement([0.012,-0.012,0.1],0.005,0.033,0.02);
assert.deepEqual(snapped.slice(0,2),[0.01,-0.01]);assert.ok(Math.abs(snapped[2]-0.043)<1e-12);
assert.equal(snapPlacement([0,0,0.1],0.005,null,0.02)[2],0.1);
assert.throws(()=>snapPlacement([NaN,0,0],0.005,null,0.02));
assert.throws(()=>snapPlacement([0,0,0],0,null,0.02));
assert.equal(shortestYaw(350,10,0.5),360);
assert.equal(shortestYaw(10,350,0.5),0);
assert.equal(shortestYaw(0,90,2),90);
assert.equal(shortestYaw(360,-360,0.5),360);

import {
  recommendSmartPlacement,
  evaluatePlacementIntelligence,
  terminalWorldPoint,
  mountingHoleWorldPoints,
} from './spatial.ts';
const spec={length_m:0.26,width_m:0.20,height_m:0.16,ground_clearance_m:0.03,mass_kg:1.8};
const camRec=recommendSmartPlacement('realsense-d435-depth-cam',[],spec);
assert.ok(camRec.positionM[0] > 0.05, 'depth camera placed near front perimeter');
assert.equal(camRec.yawDeg, 0, 'depth camera oriented +X forward');
const camInst={id:'cam1',componentId:'realsense-d435-depth-cam',positionM:camRec.positionM,yawDeg:camRec.yawDeg};
const imuRec=recommendSmartPlacement('imu-bno055-9dof',[camInst],spec);
assert.equal(imuRec.yawDeg, 0, 'IMU aligned with chassis +X');
const imuInst={id:'imu1',componentId:'imu-bno055-9dof',positionM:imuRec.positionM,yawDeg:imuRec.yawDeg};
assert.equal(envelopesOverlap(camInst,imuInst),false);
const holes=mountingHoleWorldPoints(imuInst);
assert.equal(holes.length, 4);
const term0=terminalWorldPoint(camInst, 0);
assert.equal(term0.length, 3);
const report=evaluatePlacementIntelligence([camInst,imuInst],spec,[{id:'w1',from:'cam1',to:'imu1',status:'NOT_CHECKED'}]);
assert.equal(report.com.status, 'balanced');
assert.equal(report.diagnostics.length, 2);
assert.ok(report.diagnostics.every(d=>d.placementStatus==='pass'&&d.mountingStatus==='pass'&&d.orientationStatus==='pass'));
assert.ok(report.cableLengthsMm.w1 > 0);
''')
    result=subprocess.run([node,'--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
