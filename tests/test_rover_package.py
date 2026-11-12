"""Build archive tests use synthetic planned designs, not hardware validation."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_rover_package_roundtrip(tmp_path):
    lib = ROOT / 'web-next/src/lib'
    names = ['roverPackage', 'roverDesign', 'forgeEngine', 'components', 'buildArtifacts', 'cadGen', 'mountMesh']
    for name in names:
        source = lib / f'{name}.ts'
        if not source.exists():
            continue
        text = source.read_text()
        for dep in names:
            text = text.replace(f"from './{dep}'", f"from './{dep}.ts'")
        (tmp_path / f'{name}.ts').write_text(text)
    (tmp_path / 'node_modules').symlink_to(ROOT / 'web-next/node_modules', target_is_directory=True)
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'parts.json').write_text((ROOT / 'catalog/parts.json').read_text())
    (tmp_path / 'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {createRoverConcept,defaultRoverRequirements,saveRoverVersion} from './roverDesign.ts';
import {defaultRoverCad,roverCadArtifacts,createRoverPackage} from './roverPackage.ts';
const cat=JSON.parse(readFileSync(new URL('./parts.json',import.meta.url))).parts;
let spec=createRoverConcept({...defaultRoverRequirements(),name:'Test / Rover',purpose:'Indoor inspection'},cat);
const settings=defaultRoverCad(spec);settings.chassis.lengthMm=spec.length_m*1000;settings.chassis.widthMm=spec.width_m*1000;
spec.roverDesign.cad=settings;
const saved=saveRoverVersion([],spec,'rover',null,'v1','2026-11-10T12:00:00Z')[0];
const archive=createRoverPackage(saved,'v1','2026-11-10T12:00:00Z');
const entries=unzipSync(archive.bytes);
for(const name of ['manifest.json','robot-spec.json','simulation-spec.json','bom.json','bom.csv','assembly.json','wiring.json','assembly-guide.md','findings.json','README.md','cad/chassis.scad','cad/chassis-mm.stl'])assert.ok(entries[name],name);
const manifest=JSON.parse(strFromU8(entries['manifest.json']));
assert.equal(manifest.robotId,'rover');assert.equal(manifest.robotVersionId,'v1');
assert.deepEqual(JSON.parse(strFromU8(entries['robot-spec.json'])),saved.versions.at(-1).spec);
assert.ok(strFromU8(entries['cad/chassis.scad']).includes('cube('));
assert.ok(!strFromU8(entries['cad/chassis.scad']).includes('printed in'));
const stl=strFromU8(entries['cad/chassis-mm.stl']);assert.ok(stl.startsWith('solid '));assert.ok(stl.includes('facet normal'));
const vertices=[...stl.matchAll(/vertex ([^ ]+) ([^ ]+) ([^\\n]+)/g)].map(m=>m.slice(1).map(Number));
for(let axis=0;axis<3;axis++){const extent=Math.max(...vertices.map(p=>p[axis]))-Math.min(...vertices.map(p=>p[axis]));assert.ok(Math.abs(extent-[settings.chassis.lengthMm,settings.chassis.widthMm,settings.chassis.thicknessMm][axis])<.001,'STL millimetre bounds');}
assert.ok(!Object.keys(entries).some(k=>k.includes('..')||k.startsWith('/')));
assert.ok(!archive.filename.includes('/'));
assert.throws(()=>createRoverPackage(saved,'stale','today'),/changed|version/i);
assert.throws(()=>roverCadArtifacts(spec,{...settings,chassis:{...settings.chassis,lengthMm:NaN}}),/finite|size/i);
const more=structuredClone(saved.versions.at(-1).spec);
const controller=more.assembly.components.find(c=>c.componentId==='catalog--'+more.forge.ids.controller);
const custom=structuredClone(settings);custom.chassis.holes=[[0,0]];
custom.mount={instanceId:controller.id,lengthMm:140,widthMm:100,thicknessMm:3,holes:[[0,0]],holeDiameterMm:3.2};
custom.enclosure={length_mm:120,width_mm:90,height_mm:45,wall_mm:2,clearance_mm:.3,cable_dia_mm:8,cable_count:2};
more.roverDesign.cad=custom;
const second=saveRoverVersion([saved],more,'rover','v1','v2','2026-11-10T13:00:00Z')[0];
const bundle=unzipSync(createRoverPackage(second,'v2','2026-11-10T13:00:00Z').bytes);
for(const name of ['cad/component-mount.scad','cad/component-mount-mm.stl','cad/enclosure.scad','cad/enclosure_box.scad','cad/enclosure_lid.scad'])assert.ok(bundle[name],name);
assert.ok(strFromU8(bundle['cad/enclosure_box.scad']).includes('enclosure_box();'));
assert.ok(!strFromU8(bundle['cad/enclosure_box.scad']).includes('translate([length_mm + 10, 0, 0]) enclosure_lid();'));
assert.ok(strFromU8(bundle['cad/chassis-mm.stl']).length>stl.length,'Hole geometry must appear in STL, not only metadata');
assert.equal(saved.versions.length,1,'Export and later CAD versions preserve earlier robot history');
assert.throws(()=>roverCadArtifacts(spec,{...settings,chassis:{...settings.chassis,holes:[[0,0],[0,0]]}}),/overlap/i);
const bed=roverCadArtifacts(spec,settings);assert.equal(bed.chassis.holes.length,0);assert.ok(bed.warnings.some(w=>/bed/i.test(w)));
assert.throws(()=>roverCadArtifacts(spec,{...settings,mount:{instanceId:'missing',lengthMm:100,widthMm:80,thicknessMm:3,holes:[],holeDiameterMm:3.2}}),/instance/i);
assert.throws(()=>createRoverPackage({...saved,versions:[{...saved.versions[0],spec:{...saved.versions[0].spec,roverDesign:{...saved.versions[0].spec.roverDesign,cad:{...settings,chassis:{...settings.chassis,lengthMm:100}}}}}]},'v1','today'),/chassis|dimensions/i);
''')
    result = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
