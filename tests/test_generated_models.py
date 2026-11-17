"""No pending receipt or arbitrary external model URL becomes a shipped twin."""
import json,subprocess,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_index_requires_local_complete_geometry_and_receipt(tmp_path):
 folder=tmp_path/'assets/robot-twins';folder.mkdir(parents=True)
 (folder/'spot.json').write_text(json.dumps({'robot':'Spot','asset_id':'ast_test','glb':'assets/robot-twins/spot.glb'}))
 script=ROOT/'web-next/scripts/index-generated-models.mjs'
 def index():
  r=subprocess.run(['node','--input-type=module','-e',f"import {{indexGeneratedModels}} from {json.dumps(script.as_uri())}; console.log(JSON.stringify(indexGeneratedModels({json.dumps(str(tmp_path))})));"],capture_output=True,text=True)
  assert r.returncode==0,r.stderr
  return json.loads(r.stdout)
 assert index()==[]
 (folder/'spot.glb').write_bytes(b'glTF'+bytes(20));assert index()==[]
 (folder/'spot.glb').write_bytes(b'glTF'+struct.pack('<II',2,24)+bytes(12));assert index()[0]['slug']=='spot'
 (folder/'external.json').write_text(json.dumps({'robot':'Other','asset_id':'ast_other','glb':'https://example.com/remote.glb'}));assert len(index())==1
