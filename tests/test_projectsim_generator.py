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
