"""Navigation must not replace an unfinished rover design with a saved version."""
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_rover_draft_recovery_priority(tmp_path):
    (tmp_path/'roverDraft.ts').write_text((ROOT/'web-next/src/lib/roverDraft.ts').read_text())
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {shouldRecoverRoverDraft as recover} from './roverDraft.ts';
const dirty={format:'robotforge-rover-draft-v1',dirty:true,robotId:'saved-rover'};
assert.ok(recover(dirty,'saved-rover'),'Reload of same robot retains unsaved CAD');
assert.ok(recover(dirty,'different-rover'),'A different deep link cannot silently discard the pending draft');
assert.ok(recover(dirty,null));
assert.equal(recover({...dirty,dirty:false},'different-rover'),false);
assert.equal(recover(null,'saved-rover'),false);
assert.equal(recover({...dirty,format:'unknown'},null),false);
''')
    r=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
