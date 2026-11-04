"""Omega1 identity + Pi 4B fix (feat/omega1-identity-pi4b).

Pins, in the house style (run the real TypeScript in node; source pins
for Garage/PhotoSpin behaviour):

- the component table knows the Raspberry Pi 4B, the Pi Camera OV5647
  and a generic hobby servo, and resolveComponent accepts them;
- the coordinated upgrade plan names the Pi 4B with its own power
  facts (5 V / 3 A) and instance/artifact naming, and the Pi 5 path is
  unchanged;
- Wrench's proposal ask maps Pi 4B / pi camera / servo names;
- the Garage Overview treats a robot NAMED Omega1 (not just the
  canonical id) as Omega1 for the twin, its note and the reference
  photo, and the ProjectSim twin has exactly one deliberate opener;
- uploaded still photos can be removed (one or all) from the Overview,
  reference photos get no removal controls, and the set-removal helper
  empties cleanly.
"""
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web-next/src'
NODE = shutil.which('node') or 'node'


def _run(tmp_path, files, run):
    for name, text in files.items():
        (tmp_path / name).write_text(text)
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text(run)
    r = subprocess.run([NODE, '--experimental-strip-types', str(tmp_path / 'run.mjs')],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def _lib(name):
    return (WEB / 'lib' / name).read_text()


def test_new_components_resolve(tmp_path):
    _run(tmp_path, {'components.ts': _lib('components.ts')}, '''
import assert from 'node:assert/strict';
import {COMPONENTS, resolveComponent} from './components.ts';
for (const id of ['raspberry-pi-4b-sbc','pi-camera-ov5647','servo-hobby-generic'])
  assert.ok(COMPONENTS.some(c=>c.id===id), id+' missing from the component table');
assert.equal(resolveComponent('raspberry pi 4b').id,'raspberry-pi-4b-sbc');
assert.equal(resolveComponent('pi 4b').id,'raspberry-pi-4b-sbc');
assert.equal(resolveComponent('pi camera').id,'pi-camera-ov5647');
assert.equal(resolveComponent('ov5647').id,'pi-camera-ov5647');
assert.equal(resolveComponent('servo').id,'servo-hobby-generic');
assert.equal(resolveComponent('sg90').id,'servo-hobby-generic');
assert.equal(resolveComponent('raspberry pi 5').id,'raspberry-pi-5-sbc');
assert.throws(()=>resolveComponent('flux capacitor'),/Raspberry Pi 4B/);
assert.throws(()=>resolveComponent('flux capacitor'),/Pi Camera OV5647/);
assert.throws(()=>resolveComponent('flux capacitor'),/hobby servo/);
const servo=COMPONENTS.find(c=>c.id==='servo-hobby-generic');
assert.match(servo.note,/PCA9685/);
assert.match(servo.note,/no torque|not.*claim/i);
console.log('ok');
''')


def test_pi4b_coordinated_plan(tmp_path):
    lib = WEB / 'lib'
    files = {p.name: re.sub(r"from '(\./[^']+?)(?<!\.ts)'", r"from '\1.ts'", p.read_text())
             for p in lib.glob('*.ts')}
    _run(tmp_path, files, '''
import assert from 'node:assert/strict';
import {planUpgrade} from './upgradePlan.ts';
const a={id:'a1',note:'base',createdAt:'t',components:[],connections:[]};
const r={id:'r1',name:'Omega1',versions:[{id:'v1',spec:{mass_kg:1,battery:{voltage_v:12},wiring:{nodes:[{id:'battery',label:'Battery'}],connections:[]}}}]};
const inputs={supplyMinV:10,supplyMaxV:16,loadCurrentA:3};
const p4=planUpgrade(r,a,inputs,'raspberry-pi-4b-sbc');
assert.match(p4.componentName,/Raspberry Pi 4B/);
assert.match(p4.summary,/Pi 4B/);
assert.equal(p4.boardId,'raspberry-pi-4b-sbc');
assert.ok(p4.assembly.components.some(c=>c.componentId==='raspberry-pi-4b-sbc'&&c.id==='upgrade-pi4b'));
assert.ok(p4.assembly.connections.some(c=>c.from==='upgrade-pi4b-converter'&&c.to==='upgrade-pi4b'));
assert.ok(p4.artifacts.every(f=>f.filename.startsWith('pi4b-')));
assert.ok(p4.warnings.some(w=>/3 A/.test(w)&&/4B/.test(w)));
assert.ok(p4.warnings.some(w=>/no USB-PD/.test(w)));
const p5=planUpgrade(r,a,inputs);
assert.match(p5.componentName,/Raspberry Pi 5/);
assert.equal(p5.boardId,'raspberry-pi-5-sbc');
assert.ok(p5.assembly.components.some(c=>c.id==='upgrade-pi5'));
assert.ok(p5.artifacts.every(f=>f.filename.startsWith('pi5-')));
assert.ok(p5.warnings.some(w=>/5 A USB-PD/.test(w)));
console.log('ok');
''')


def test_proposal_ask_and_load_ratings(tmp_path):
    files = {
        'components.ts': _lib('components.ts'),
        'upgradeProposal.ts': _lib('upgradeProposal.ts').replace("from './components'", "from './components.ts'"),
        'garage.ts': _lib('garage.ts'),
    }
    # upgradeProposal only type-imports garage; strip it for the node run.
    files['upgradeProposal.ts'] = re.sub(r"import type \{[^}]*\} from '\./garage';", '', files['upgradeProposal.ts'])
    _run(tmp_path, files, '''
import assert from 'node:assert/strict';
import {parseUpgradeAsk, LOAD_RATINGS} from './upgradeProposal.ts';
assert.deepEqual(parseUpgradeAsk('Wrench, add a Raspberry Pi 4B to this rover'), { componentId: 'raspberry-pi-4b-sbc' });
assert.deepEqual(parseUpgradeAsk('add a pi camera to this rover'), { componentId: 'pi-camera-ov5647' });
assert.deepEqual(parseUpgradeAsk('add a servo to this rover'), { componentId: 'servo-hobby-generic' });
assert.deepEqual(parseUpgradeAsk('Wrench, add a Raspberry Pi 5 to this rover'), { componentId: 'raspberry-pi-5-sbc' });
assert.equal(parseUpgradeAsk('add a raspberry pi to this rover'), null);
assert.equal(LOAD_RATINGS['raspberry-pi-4b-sbc'].amps, 3);
assert.equal(LOAD_RATINGS['raspberry-pi-4b-sbc'].volts, 5.1);
assert.equal(LOAD_RATINGS['raspberry-pi-5-sbc'].amps, 5);
console.log('ok');
''')


def test_overview_twin_keyed_on_name_too():
    garage = (WEB / 'components/garage/Garage.tsx').read_text()
    assert "isOmega1Name" in garage and "from '@/lib/saveRobot'" in garage
    assert 'const isOmegaRobot' in garage
    assert "robot.id === OMEGA1_ROBOT_ID || isOmega1Name(robot.name)" in garage
    assert 'model={isOmegaRobot ? <TwinView subject={omega1Rover} explode />' in garage
    assert 'modelReady={isOmegaRobot || hasBody(draft)}' in garage
    assert 'if (isOmegaRobot) return { ...OMEGA1_PHOTO' in garage


def test_twin_has_exactly_one_opener():
    garage = (WEB / 'components/garage/Garage.tsx').read_text()
    assert garage.count('setTwinOpen(true)') == 1
    assert 'View ProjectSim twin' in garage
    # PR #152 stays intact: no specimen button back in the sidebar list.
    assert 'Built-in specimen' not in garage


def test_photo_removal_controls_and_semantics(tmp_path):
    spin = (WEB / 'components/garage/PhotoSpin.tsx').read_text()
    garage = (WEB / 'components/garage/Garage.tsx').read_text()
    # Controls exist, in the house two-step confirm pattern...
    assert 'Remove this photo' in spin and 'Remove all photos' in spin
    assert 'g-remove-confirm' in spin and 'g-remove-yes' in spin
    assert 'window.confirm' not in spin
    # ...but only for the owner's own photos (a reference photo is not
    # theirs to delete), and only in the reference view.
    assert "view === 'reference' && photo && onPhotosSave" in spin
    # Garage persists a set-level clear: photo, photoSet AND photoAddedAt.
    assert 'onPhotosSave={(next) => patchRobot' in garage
    assert 'photoSet: _s' in garage and 'photoAddedAt: _a' in garage
    # The helper: removing the last photo empties the set (null).
    _run(tmp_path, {'photoSpin.ts': _lib('photoSpin.ts')}, '''
import assert from 'node:assert/strict';
import {removePhotoFromSet} from './photoSpin.ts';
assert.deepEqual(removePhotoFromSet(['a','b','c'],1),['a','c']);
assert.deepEqual(removePhotoFromSet(['a','b'],0),['b']);
assert.equal(removePhotoFromSet(['a'],0),null);
assert.deepEqual(removePhotoFromSet(['a','b'],5),['a','b']);
console.log('ok');
''')


def test_scan_studio_presave_discard():
    studio = (WEB / 'components/scan/ScanStudio.tsx').read_text()
    assert 'Discard scan' in studio
    assert 'Nothing was saved' in studio
