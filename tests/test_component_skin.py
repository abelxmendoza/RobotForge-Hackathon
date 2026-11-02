"""Decorative graphics must remain inside the envelope used for spatial checks."""
import json
import shutil
import subprocess
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
def test_visual_detail_stays_inside_envelopes(tmp_path):
    node=shutil.which('node')
    three=ROOT/'web-next/node_modules/three/build/three.module.js'
    if not node or not three.exists(): pytest.skip('Optional web dependencies unavailable')
    skin=ROOT/'web-next/src/components/kit/componentSkin.ts'
    components=ROOT/'web-next/src/lib/components.ts'
    script=f"""
import assert from 'node:assert/strict';
import * as THREE from {json.dumps(str(three))};
import {{addComponentSkin}} from {json.dumps(str(skin))};
import {{COMPONENTS}} from {json.dumps(str(components))};
assert.ok(COMPONENTS.length >= 12);
for(const comp of COMPONENTS){{
 const id=comp.id;
 const size=comp.sizeM;
 const root=new THREE.Group();addComponentSkin(THREE,root,size,id);
 const bounds=new THREE.Box3().setFromObject(root);
 assert.ok(!bounds.isEmpty(),id);
 assert.ok(root.children.length >= 4, id+' has multiple 3D hardware sub-meshes');
 for(const [i,axis] of ['x','y','z'].entries()){{
  assert.ok(bounds.min[axis]>=-size[i]/2-1e-7,id+' minimum '+axis+' ('+bounds.min[axis]+' < '+(-size[i]/2)+')');
  assert.ok(bounds.max[axis]<=size[i]/2+1e-7,id+' maximum '+axis+' ('+bounds.max[axis]+' > '+(size[i]/2)+')');
 }}
 root.traverse(object=>{{object.geometry?.dispose();const m=object.material;if(Array.isArray(m))m.forEach(x=>x.dispose());else m?.dispose();}});
}}
"""
    (tmp_path/'run.mjs').write_text(script)
    result=subprocess.run([node,'--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
