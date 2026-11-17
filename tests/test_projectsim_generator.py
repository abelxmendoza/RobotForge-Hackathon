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
