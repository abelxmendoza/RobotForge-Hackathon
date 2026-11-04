"""Execute the pure TypeScript CAD generator: enclosure behavior and bad inputs."""
import json
import subprocess
import shutil
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = '/snap/node/12219/bin/node' if Path('/snap/node/12219/bin/node').exists() else shutil.which('node')

@pytest.fixture(scope='module')
def cad(tmp_path_factory):
    out = tmp_path_factory.mktemp('enclosure-ts')
    subprocess.run([NODE, str(ROOT / 'web-next/node_modules/typescript/bin/tsc'), str(ROOT / 'web-next/src/lib/cadGen.ts'), '--outDir', str(out), '--target', 'es2020', '--module', 'commonjs', '--skipLibCheck'], check=True, capture_output=True)
    def run(js):
        result = subprocess.run([NODE, '-e', f"const c=require({json.dumps(str(out / 'cadGen.js'))});\n" + js], check=True, text=True, capture_output=True)
        return json.loads(result.stdout)
    return run

def test_enclosure_chat_and_separate_print_parts(cad):
    r = cad("console.log(JSON.stringify(c.cadFromText('make enclosure 100x80x40 mm wall 2 mm clearance 0.3 mm cable diameter 8 mm cable count 2')))")
    assert r['template'] == 'enclosure'
    values = {p['key']: p['value'] for p in r['params']}
    assert values == dict(length_mm=100, width_mm=80, height_mm=40, wall_mm=2, clearance_mm=0.3, cable_dia_mm=8, cable_count=2)
    assert [f['filename'] for f in r['files']] == ['enclosure_box.scad', 'enclosure_lid.scad']
    assert 'enclosure_box();' in r['files'][0]['source']
    assert 'enclosure_lid();' in r['files'][1]['source']
    assert 'ESTIMATED / PLANNED' in r['source']
    assert 'not YAPP' in r['source']
    assert 'front' in r['summary'] and 'outer' in r['summary']

def test_defaults_and_legacy(cad):
    r = cad("console.log(JSON.stringify([c.cadFromText('make enclosure'),c.cadFromText('make spacer length 20')]))")
    assert len(r[0]['defaultsUsed']) == 7
    assert r[1]['template'] == 'spacer'
    assert r[1]['filename'] == 'spacer.scad'

@pytest.mark.parametrize('params', ["{length_mm:NaN}", "{height_mm:Infinity}", "{wall_mm:-1}", "{clearance_mm:-0.1}", "{length_mm:4,wall_mm:2}", "{height_mm:2,wall_mm:2}", "{cable_count:1.5}", "{cable_count:30}", "{cable_count:2,cable_dia_mm:70}", "{wall_mm:'2;echo(1)'}", "{clearance_mm:50}"])
def test_invalid_rejected(cad, params):
    assert cad(f"try {{ c.generateCad({{template:'enclosure',params:{params}}}); console.log(false); }} catch(e) {{console.log(e instanceof RangeError);}}")

def test_no_holes_and_zero_clearance(cad):
    r = cad("console.log(JSON.stringify(c.generateCad({template:'enclosure',params:{cable_count:0,clearance_mm:0}})))")
    assert 'cable_count = 0;' in r['source']
    assert 'if (cable_count > 0)' in r['source']

def test_yapp_alternate_has_pinned_dependencies(cad):
    r = cad("console.log(JSON.stringify(c.generateCad({template:'enclosure',params:{}})))")
    y = r['alternateExports'][0]
    assert y['filename'] == 'enclosure_yapp.scad'
    assert 'include <YAPPgenerator_v3.scad>' in y['source']
    assert 'YAPPgenerate();' in y['source']
    assert 'f9400c419ef1dea7dc0b3607876989b4f3faa2b7' in y['source']
    assert [d['filename'] for d in y['dependencies']] == ['YAPPgenerator_v3.scad', 'LICENSE']
    assert (ROOT / 'web-next/public/vendor/yapp/LICENSE').read_text().startswith('MIT License')
