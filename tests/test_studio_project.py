"""Save/version and routing invariants for the simplified Workshop."""
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[1]

def test_studio_preserves_evidence_and_rejects_stale_edits(tmp_path):
 for name in ['studioProject','versionGuard']:
  source=(ROOT/f'web-next/src/lib/{name}.ts').read_text().replace("'./versionGuard'","'./versionGuard.ts'")
  (tmp_path/f'{name}.ts').write_text(source)
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'check.mjs').write_text('''
import assert from 'node:assert/strict';
import {saveStudioVersion,studioRoute,partLabel} from './studioProject.ts';
const records=[{id:'r',name:'Rover',createdAt:'a',photo:'kept',versions:[{id:'v1',createdAt:'a',label:'Baseline',source:'photo',spec:{mass_kg:2},planned:true,estimatedPaths:['mass_kg']}]}];
const draft={mass_kg:3};const next=saveStudioVersion(records,'r','v1',draft,'v2','b');
assert.equal(records[0].versions.length,1);assert.equal(next[0].versions.length,2);
assert.equal(next[0].photo,'kept');assert.equal(next[0].versions[1].planned,true);
assert.deepEqual(next[0].versions[1].estimatedPaths,['mass_kg']);
draft.mass_kg=99;assert.equal(next[0].versions[1].spec.mass_kg,3);
assert.throws(()=>saveStudioVersion(next,'r','v1',{},'v3','c'),/newer saved/);
assert.throws(()=>saveStudioVersion([{...records[0],archivedAt:'2026-01-01'}],'r','v1',{},'v3','c'),/archived/);
assert.throws(()=>saveStudioVersion([],'r','v1',{},'v3','c'),/removed/);
assert.equal(studioRoute('#tab=simulate').mode,'checks');
assert.equal(studioRoute('#tab=specs').panel,'specs');
assert.equal(studioRoute('#rover-design').panel,'design');
assert.equal(studioRoute('#omega1').legacy,true);
assert.equal(partLabel('left_elbow_joint'),'Left Elbow');
''')
 result=subprocess.run(['node',str(tmp_path/'check.mjs')],capture_output=True,text=True)
 assert result.returncode==0,result.stdout+result.stderr


def test_workshop_drafts_follow_demo_namespace(tmp_path):
 import os
 (tmp_path/'demoMode.ts').write_text((ROOT/'web-next/src/lib/demoMode.ts').read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 os.symlink(ROOT/'web-next/node_modules',tmp_path/'node_modules',target_is_directory=True)
 (tmp_path/'demo.mjs').write_text("""
import assert from 'node:assert/strict';
import {effectiveStorageKey} from './demoMode.ts';
let demo=false;globalThis.window={localStorage:{getItem:()=>demo?'1':null}};
const draft='robotforge.workshop.draft.robot-1';
assert.equal(effectiveStorageKey(draft),draft);
demo=true;assert.equal(effectiveStorageKey(draft),draft+'.demo');
assert.equal(effectiveStorageKey('rf.auth.v1'),'rf.auth.v1');
demo=false;assert.equal(effectiveStorageKey(draft),draft);
""")
 result=subprocess.run(['node',str(tmp_path/'demo.mjs')],capture_output=True,text=True)
 assert result.returncode==0,result.stdout+result.stderr
