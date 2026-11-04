"""A stale unsaved draft cannot overwrite a newer coordinated robot snapshot."""
import shutil
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]


def test_robot_version_guard(tmp_path):
    source=ROOT/'web-next/src/lib/versionGuard.ts'
    assert source.exists(), 'Version guard is not implemented'
    (tmp_path/'versionGuard.ts').write_text(source.read_text())
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {requireRobotVersion} from './versionGuard.ts';
const r={id:'r',versions:[{id:'base'},{id:'upgrade'}]};
assert.throws(()=>requireRobotVersion([r],'r','base'),/newer|changed|draft/i);
assert.equal(requireRobotVersion([r],'r','upgrade'),r);
assert.throws(()=>requireRobotVersion([],'r','upgrade'),/removed|exists/i);
assert.throws(()=>requireRobotVersion([{...r,archivedAt:'2026-11-03T00:00:00Z'}],'r','upgrade'),/archived/i);
''')
    r=subprocess.run([shutil.which('node') or 'node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
