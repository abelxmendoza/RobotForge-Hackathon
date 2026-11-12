from pathlib import Path
import subprocess,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
def test_stage_only_complete_artifacts(tmp_path):
 source=tmp_path/'input';(source/'Build').mkdir(parents=True)
 for ext in ['loader.js','data','framework.js','wasm']:(source/'Build'/f'workshop.{ext}').write_bytes(b'synthetic packaging test only')
 script=ROOT/'web-next/scripts/stage-unity.mjs'
 assert script.exists(),'Unity staging script missing'
 command=['node',str(script),'--source',str(source),'--build-id','test-build','--dest',str(tmp_path/'public/unity')]
 r=subprocess.run(command,capture_output=True,text=True);assert r.returncode!=0
 (source/'robotforge-build.json').write_text(json.dumps({'buildId':'test-build','protocolVersion':1}));
 (source/'Licenses').mkdir();(source/'Licenses/Unitree-G1-LICENSE.txt').write_text('test license receipt');(source/'Licenses/Unitree-G1-provenance.json').write_text('{}')
 r=subprocess.run(command,capture_output=True,text=True);assert r.returncode==0,r.stderr
 manifest=json.loads((tmp_path/'public/unity/current.json').read_text());assert manifest['buildId']=='test-build'
 for url,record in manifest['files'].items():assert hashlib.sha256((tmp_path/'public'/url.lstrip('/')).read_bytes()).hexdigest()==record['sha256']
 # No overwrite of an existing artifact, and failed staging retains the pointer.
 before=(tmp_path/'public/unity/current.json').read_bytes()
 r=subprocess.run(command,capture_output=True,text=True);assert r.returncode!=0
 assert (tmp_path/'public/unity/current.json').read_bytes()==before
