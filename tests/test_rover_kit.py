"""Rover design lives in Wrench and the Workshop's Kit panel (2026-11-12)."""
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / 'web-next/src/lib'


def _copy(tmp_path, names):
    for name in names:
        text = (LIB / f'{name}.ts').read_text()
        for dep in ['components', 'forgeEngine', 'roverDesign', 'assembly', 'versionGuard', 'garage']:
            text = text.replace(f"from './{dep}'", f"from './{dep}.ts'")
        (tmp_path / f'{name}.ts').write_text(text)
    (tmp_path / 'parts.json').write_text((ROOT / 'catalog/parts.json').read_text())
    (tmp_path / 'package.json').write_text('{"type":"module"}')


def test_rover_kit_words_and_concepts(tmp_path):
    _copy(tmp_path, ['roverKit', 'roverDesign', 'components', 'forgeEngine', 'assembly'])
    (tmp_path / 'run.mjs').write_text(r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseRoverKitCommand,matchPart,roverRequirementsFromBrief,roverKitFromBrief,uniqueName,withCad,parseHoles} from './roverKit.ts';
import {roverRoleChoices,assertRoverConsistency} from './roverDesign.ts';
const cat=JSON.parse(readFileSync(new URL('./parts.json',import.meta.url))).parts;
assert.deepEqual(parseRoverKitCommand('export the build kit'),{kind:'export'});
assert.deepEqual(parseRoverKitCommand('Download the build package.'),{kind:'export'});
assert.deepEqual(parseRoverKitCommand('swap the motor for a 37D gearmotor'),{kind:'swap',role:'motor',part:'37d gearmotor'});
assert.deepEqual(parseRoverKitCommand('replace the motor driver with tb6612'),{kind:'swap',role:'driver',part:'tb6612'});
assert.deepEqual(parseRoverKitCommand('make the chassis 260 by 200 mm'),{kind:'chassis',lengthMm:260,widthMm:200,thicknessMm:undefined});
assert.equal(parseRoverKitCommand('how do I export the build kit?'),null,'a question is answered, not run');
assert.equal(parseRoverKitCommand('swap the colour for blue'),null);
assert.equal(parseRoverKitCommand('make the chassis 5 by 5 mm'),null);
assert.equal(parseRoverKitCommand('what is a chassis'),null);
const req=roverRequirementsFromBrief('Design a compact mecanum rover called Scout with a lidar');
assert.equal(req.name,'Scout');assert.equal(req.archetype,'mecanum_rover');assert.equal(req.size,'compact');assert.ok(req.sensors.includes('lidar'));
assert.equal(roverRequirementsFromBrief('Design a robot arm that picks parts'),null);
assert.equal(roverRequirementsFromBrief('build a drone with a camera'),null);
assert.equal(uniqueName('Scout',['scout','Scout 2']),'Scout 3');
const spec=roverKitFromBrief(req,cat,'v1','2026-11-12T00:00:00Z');assertRoverConsistency(spec);
const controller=roverRoleChoices(spec,cat).find(r=>r.role==='controller');
assert.match(matchPart(controller.options,'raspberry pi 4').name,/Pi 4/);
assert.equal(matchPart(controller.options,'flux capacitor'),null);
const cad={chassis:{lengthMm:260,widthMm:200,thicknessMm:4,holes:parseHoles('10, 10\n-10, -10'),holeDiameterMm:3.2},mount:null,enclosure:null};
const sized=withCad(spec,cad);assert.equal(sized.length_m,.26);assert.equal(sized.roverDesign.cad.chassis.holes.length,2);assertRoverConsistency(sized);
assert.throws(()=>parseHoles('10'),/X, Y/);
""")
    r = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_studio_routes_keep_deep_links(tmp_path):
    _copy(tmp_path, ['studioProject'])
    (tmp_path / 'versionGuard.ts').write_text('export function requireRobotVersion(){}')
    (tmp_path / 'garage.ts').write_text('export {}')
    (tmp_path / 'run.mjs').write_text(r"""
import assert from 'node:assert/strict';
import {studioRoute} from './studioProject.ts';
assert.deepEqual(studioRoute('#robot=r1&tab=kit'),{mode:'build',panel:'kit',legacy:false,robotId:'r1'});
assert.deepEqual(studioRoute('#robot=r2&tab=overview'),{mode:'build',panel:'parts',legacy:false,robotId:'r2'});
assert.equal(studioRoute('#robot=r3').robotId,'r3');
assert.equal(studioRoute('#tab=simulate').mode,'checks');
assert.equal(studioRoute('#rover-design').panel,'kit');
assert.equal(studioRoute('#tab=bom').legacy,true,'BOM still opens the full records view');
""")
    r = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_no_separate_rover_designer():
    src = ROOT / 'web-next/src'
    assert not (src / 'components/design/RoverDesigner.tsx').exists()
    assert '#kit' in (src / 'app/design/page.tsx').read_text()
    thread = (src / 'components/forge/ForgeThread.tsx').read_text()
    assert 'roverKitFromBrief' in thread and 'saveRoverVersion' in thread
    dock = (src / 'components/chat/ChatDock.tsx').read_text()
    assert 'parseRoverKitCommand' in dock
