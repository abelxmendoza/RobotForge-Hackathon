"""Wrench upgrade requests resolve explicit/selected robots without guessing identity."""
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def test_upgrade_requests(tmp_path):
    source=ROOT/'web-next/src/lib/upgradeRequest.ts'
    assert source.exists(), 'Upgrade request parser is not implemented'
    (tmp_path/'upgradeRequest.ts').write_text(source.read_text())
    (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {parseUpgradeRequest,parseUpgradeFacts} from './upgradeRequest.ts';
assert.deepEqual(parseUpgradeFacts('battery voltage is 9 to 12.6 V'),{supplyMinV:9,supplyMaxV:12.6});
assert.deepEqual(parseUpgradeFacts('load is 2 A'),{loadCurrentA:2});
assert.deepEqual(parseUpgradeFacts('converter continuous current is 5 A'),{qualifiedConverterCurrentA:5});
assert.equal(parseUpgradeFacts('How much current should I use?'),null);
const robots=[{id:'r1',name:'Omega1'},{id:'r2',name:'Runt'}];
assert.equal(parseUpgradeRequest('Plan a Raspberry Pi 5 upgrade for "Omega1"',robots).robotId,'r1');
assert.equal(parseUpgradeRequest('add a Raspberry Pi 5 to this rover',robots,'r2').robotId,'r2');
assert.equal(parseUpgradeRequest('Can you add a Pi 5 to "Omega1"?',robots).robotId,'r1');
assert.throws(()=>parseUpgradeRequest('add a Pi 5 to my rover',robots),/select|name/i);
assert.throws(()=>parseUpgradeRequest('add a Raspberry Pi to "Omega1"',robots),/exact|Pi 5/i);
assert.throws(()=>parseUpgradeRequest('add a Pi 5 to "Missing"',robots),/unique|saved/i);
assert.equal(parseUpgradeRequest('How do I add a Pi 5?',robots,'r1'),null);
assert.equal(parseUpgradeRequest('do not add a Pi 5',robots,'r1'),null);
assert.equal(parseUpgradeRequest('add a camera to "Omega1"',robots,'r1'),null);
assert.throws(()=>parseUpgradeRequest('add a Pi 5 to "Omega1"',[...robots,{id:'r3',name:'Omega1'}]),/unique/i);
''')
    r=subprocess.run([shutil.which('node') or 'node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert r.returncode==0,r.stdout+r.stderr
