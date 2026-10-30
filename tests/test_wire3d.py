"""3D route illustration must retain endpoints and handle coincident parts."""
import shutil
import subprocess
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]

def test_cable_geometry_and_motion(tmp_path):
    node=shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    shutil.copyfile(ROOT/'web-next/src/lib/wire3d.ts',tmp_path/'wire3d.ts')
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {cableControlPoints,animationPhase} from './wire3d.ts';
const a=[0,0,0.01], b=[0.1,-0.1,0.04];
const copy=JSON.stringify([a,b]);
const route=cableControlPoints(a,b);
assert.deepEqual(route[0],a);assert.deepEqual(route.at(-1),b);
assert.ok(route[1][2]>Math.max(a[2],b[2]));
assert.ok(cableControlPoints(a,b,2)[1][2]>route[1][2]);
assert.equal(JSON.stringify([a,b]),copy);
const loop=cableControlPoints(a,a);
assert.notDeepEqual(loop[1],loop[2]);
assert.ok(loop.flat().every(Number.isFinite));
assert.throws(()=>cableControlPoints([NaN,0,0],b));
for(const t of [-100,0,0.5,10,1000]){
  const phase=animationPhase(t,2);assert.ok(phase>=0&&phase<1);
}
assert.notEqual(animationPhase(0,0),animationPhase(0,1));
''')
    result=subprocess.run([node,'--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
