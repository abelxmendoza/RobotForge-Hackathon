"""Generator retries reuse the same paid request and cannot escape the download root."""
import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module():
 s=importlib.util.spec_from_file_location('projectsim_generate',ROOT/'tools/projectsim_generate.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def test_request_checkpoint_is_stable_and_rejects_changed_input(tmp_path):
 m=module();first=m.request_checkpoint(tmp_path,{'name':'robot'});again=m.request_checkpoint(tmp_path,{'name':'robot'})
 assert first==again
 assert first['idempotency_key']
 import pytest
 with pytest.raises(ValueError):m.request_checkpoint(tmp_path,{'name':'different'})
 assert 'token' not in json.dumps(first).lower()

def test_generation_inputs_are_authored_and_bounded():
 m=module();subjects=m.load_subjects()
 assert {'boston-dynamics-spot','vex-v5-tank-drive'}<=subjects.keys()
 for slug in ['boston-dynamics-spot','vex-v5-tank-drive']:
  b=m.body_for(slug,subjects[slug]);assert b['inputs']['text'];assert 'images' not in b['inputs'];assert b['params']['physics']['articulated']


def test_read_poll_recovers_timeout_and_service_failure_without_creation():
 from types import SimpleNamespace
 m=module()
 class NetworkFailure(Exception):pass
 class Response:
  def __init__(self,status):self.status_code=status
  def json(self):return {'status':'running'}
 class Client:
  calls=0
  def get(self,path):
   self.calls+=1
   if self.calls==1:raise NetworkFailure('temporary timeout')
   return Response(503 if self.calls==2 else 200)
 client=Client();pauses=[]
 result=m.get_with_retry(client,SimpleNamespace(TransportError=NetworkFailure),'/v1/jobs/existing',sleep=pauses.append)
 assert result.json()['status']=='running'
 assert client.calls==3 and pauses==[2,4]


def test_interrupted_download_never_publishes_partial_model(tmp_path):
 from types import SimpleNamespace
 m=module();target=tmp_path/'robot.usd';target.write_bytes(b'previous complete model')
 class NetworkFailure(Exception):pass
 class Response:
  status_code=200
  def __init__(self,fail):self.fail=fail
  def __enter__(self):return self
  def __exit__(self,*args):return False
  def iter_bytes(self,size):
   yield b'first'
   if self.fail:raise NetworkFailure('connection lost')
   yield b'second'
 calls=[]
 def stream(*args,**kwargs):
  calls.append(1)
  assert target.read_bytes()==b'previous complete model'
  return Response(len(calls)==1)
 pauses=[]
 m.download_with_retry(SimpleNamespace(stream=stream,TransportError=NetworkFailure),'https://example.com/model',target,sleep=pauses.append)
 assert target.read_bytes()==b'firstsecond'
 assert len(calls)==2 and pauses==[2]
 assert not target.with_name('robot.usd.partial').exists()


def test_batch_submits_all_subjects_before_waiting(monkeypatch):
 import sys
 from types import SimpleNamespace
 m=module();events=[]
 class Client:
  def __init__(self,**kwargs):pass
  def __enter__(self):return self
  def __exit__(self,*args):return False
 monkeypatch.setitem(sys.modules,'httpx',SimpleNamespace(Client=Client))
 monkeypatch.setattr(sys,'argv',['generator','boston-dynamics-spot-with-arm','vex-v5-tank-drive','--yes'])
 monkeypatch.setattr(m,'token',lambda:'kps_test')
 monkeypatch.setattr(m,'submit_one',lambda client,slug,subject:events.append(('submit',slug)))
 monkeypatch.setattr(m,'run_one',lambda client,httpx,slug,subject:events.append(('wait',slug)))
 m.main()
 assert events==[('submit','boston-dynamics-spot-with-arm'),('submit','vex-v5-tank-drive'),('wait','boston-dynamics-spot-with-arm'),('wait','vex-v5-tank-drive')]

def test_saved_asset_submission_does_not_create_replacement(tmp_path,monkeypatch):
 from types import SimpleNamespace
 m=module();monkeypatch.setattr(m,'DOWNLOADS',tmp_path);monkeypatch.setattr(m,'OUT',tmp_path/'output')
 slug='boston-dynamics-spot-with-arm';subject=m.load_subjects()[slug]
 dest=tmp_path/slug;record=m.request_checkpoint(dest,m.body_for(slug,subject));record.update(asset_id='ast_existing',job_id='job_existing');m.save_checkpoint(dest,record)
 assert m.submit_one(SimpleNamespace(),slug,subject)['job_id']=='job_existing'
