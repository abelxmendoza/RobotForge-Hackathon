"""Build-tab mounting artifacts use the exact previewed dimensions and hole locations."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_mount_artifact_geometry(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node unavailable')
    source = ROOT / 'web-next/src/lib/buildArtifacts.ts'
    assert source.exists(), 'Build artifact generator is not implemented'
    (tmp_path / 'buildArtifacts.ts').write_text(source.read_text())
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'check.mjs').write_text('''
import assert from 'node:assert/strict';
import { generateMount, mountDefaults, enclosureFit } from './buildArtifacts.ts';
const part = {name:'Sensor board',sizeM:[.06,.04,.012],source:'https://example.com/board',
 mounting:{holePatternMm:[[-20,-10],[20,-10],[20,10],[-20,10]],holeDiameterMm:3.2,notes:'Check the datasheet'}};
const defaults=mountDefaults(part);
assert.equal(defaults.lengthMm,72);
assert.equal(defaults.widthMm,52);
const mount=generateMount({...defaults,thicknessMm:4},part);
assert.equal(mount.lengthMm,72);
assert.equal(mount.holes.length,4);
assert.throws(()=>generateMount({...defaults,thicknessMm:.0001},part));
const precise=generateMount({...defaults,thicknessMm:3.123456},part);
assert.equal(precise.thicknessMm,3.123);
const tall={...part,sizeM:[.06,.04,.037],mounting:{...part.mounting,standoffHeightMm:0}};
assert.equal(enclosureFit({length_mm:80,width_mm:60,height_mm:40,wall_mm:2},tall).fits,false);
assert.equal(enclosureFit({length_mm:80,width_mm:60,height_mm:44,wall_mm:2},tall).fits,true);
assert.deepEqual(mount.holes[0],[-20,-10]);
assert.ok(mount.source.includes('plate_thickness_mm = 4;'));
assert.ok(mount.source.includes('translate([-20, -10, -1])'));
assert.ok(mount.source.includes('UNVERIFIED'));
assert.ok(mount.source.includes('https://example.com/board'));
assert.ok(mount.warnings.some(w=>w.includes('mounting')));
for(const invalid of [NaN,Infinity,-1,0]){
 assert.throws(()=>generateMount({...defaults,lengthMm:invalid},part));
}
assert.throws(()=>generateMount({...defaults,lengthMm:30},part), /hole|footprint/i);
assert.throws(()=>generateMount({...defaults,holeDiameterMm:30},part), /hole/i);
const unknown={...part,mounting:{...part.mounting,holePatternMm:[]}};
const blank=generateMount(mountDefaults(unknown),unknown);
assert.equal(blank.holes.length,0);
assert.ok(blank.warnings.some(w=>w.includes('No mounting')));
const large=generateMount({...defaults,lengthMm:230},part);
assert.equal(large.bedFit,false);
const injected={...part,name:'bad\\ntranslate([0,0,0]) cube(9);',source:'link\\nmalicious();'};
const safe=generateMount(defaults,injected);
assert.ok(!safe.source.includes('\\nmalicious();'));
assert.ok(!safe.source.includes('\\ntranslate([0,0,0]) cube(9);'));
''')
    result = subprocess.run([node, '--experimental-strip-types', str(tmp_path / 'check.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
