from pathlib import Path
import subprocess,json,hashlib,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
def test_g1_controller(tmp_path):
 p=ROOT/'web-next/src/lib/humanoid.ts'
 assert p.exists(),'G1 controller missing'
 (tmp_path/'humanoid.ts').write_text(p.read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'test.mjs').write_text('''import assert from 'node:assert/strict';import {parseHumanoidCommand,clampJoint} from './humanoid.ts';
assert.equal(parseHumanoidCommand('how do I explode the model?'),null);
assert.equal(parseHumanoidCommand("don't reset humanoid"),null);
assert.deepEqual(parseHumanoidCommand('explode humanoid'),{kind:'explode'});
assert.deepEqual(parseHumanoidCommand('pose left_knee_joint to 30 degrees'),{kind:'pose',joint:'left_knee_joint',degrees:30});
assert.equal(clampJoint(99,-1,1),1);assert.equal(clampJoint(-99,-1,1),-1);assert.throws(()=>clampJoint(NaN,-1,1));''')
 r=subprocess.run(['node',str(tmp_path/'test.mjs')],capture_output=True,text=True)
 assert r.returncode==0,r.stderr

def test_g1_assets():
 folder=ROOT/'assets/models/unitree-g1'
 manifest=json.loads((folder/'provenance.json').read_text())
 assert len(manifest['commit'])==40
 assert 'BSD 3-Clause' in (folder/'LICENSE').read_text()
 for path,entry in manifest['files'].items():assert hashlib.sha256((folder/path).read_bytes()).hexdigest()==entry['sha256']
 root=ET.parse(folder/'g1_23dof.urdf').getroot()
 for mesh in root.iter('mesh'):assert (folder/mesh.attrib['filename'].removeprefix('package://g1_description/')).is_file()
 assert len([j for j in root.findall('joint') if j.attrib['type']=='revolute'])==23
