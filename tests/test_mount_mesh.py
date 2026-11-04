"""The downloadable STL uses the same closed millimetre geometry as the preview."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT=Path(__file__).resolve().parents[1]


def test_mount_stl_is_closed_and_dimensioned():
    node=shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    module=(ROOT/'web-next/src/lib/mountMesh.ts').as_uri()
    script='''
import assert from 'node:assert/strict';
const {mountGeometry}=await import(MODULE);
const geometry=mountGeometry({lengthMm:80,widthMm:60,thicknessMm:3,holeDiameterMm:4,holes:[[-25,-15],[25,-15],[25,15],[-25,15]]});
const b=geometry.boundingBox;
assert.deepEqual([b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z],[80,60,3]);
const p=geometry.attributes.position;
const edges=new Map();let volume=0;
const point=i=>[p.getX(i),p.getY(i),p.getZ(i)];
const key=v=>v.map(n=>n.toFixed(5)).join(',');
for(let i=0;i<p.count;i+=3){
 const [a,b,c]=[point(i),point(i+1),point(i+2)];
 volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
 for(const [u,v] of [[a,b],[b,c],[c,a]]){const k=[key(u),key(v)].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
}
assert.ok([...edges.values()].every(n=>n===2),'Every mesh edge must be shared by exactly two triangles');
assert.ok(Math.abs(volume-(80*60-4*Math.PI*4)*3)<1,'Volume must account for four through holes');
geometry.dispose();
'''.replace('MODULE',json.dumps(module))
    result=subprocess.run([node,'--experimental-strip-types','--input-type=module','-e',script],cwd=ROOT/'web-next',capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
