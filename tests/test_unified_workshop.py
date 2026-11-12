"""Behavior of the shared Workshop assembly controller and navigation."""
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def test_workshop_controller(tmp_path):
    lib = ROOT / 'web-next/src/lib'
    for name in ['workshopBench', 'workshopNavigation']:
        source = lib / f'{name}.ts'
        assert source.exists(), f'missing shared controller: {name}'
        (tmp_path / source.name).write_text(source.read_text())
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text(r"""
import assert from 'node:assert/strict';
import {benchTransition, parseBenchCommand, restoreBench} from './workshopBench.ts';
import {workshopMainTab} from './workshopNavigation.ts';
for(const t of ['bom','tools','drivetrain']) assert.equal(workshopMainTab(t),'build');
assert.equal(workshopMainTab('simulate'),'checks');
assert.equal(workshopMainTab('specs'),'overview');
assert.equal(parseBenchCommand('how do I take it apart?'),null);
assert.equal(parseBenchCommand("don't take it apart"),null);
assert.equal(parseBenchCommand('next assembly step'),'next');
assert.equal(parseBenchCommand('start guided assembly'),'assemble');
assert.equal(parseBenchCommand('explain this part'),'explain');
const count=3;
let s={active:false,off:0,direction:-1};
s=benchTransition(s,'assemble',count); assert.deepEqual(s,{active:true,off:3,direction:-1});
s=benchTransition(s,'next',count); assert.equal(s.off,2);
s=benchTransition(s,'back',count); assert.equal(s.off,3);
for(let i=0;i<8;i++) s=benchTransition(s,'next',count);
assert.equal(s.off,0); // completed assembly cannot underflow
s=benchTransition(s,'disassemble',count); assert.equal(s.off,0);
s=benchTransition(s,'next',count); assert.equal(s.off,1);
s=benchTransition(s,'back',count); assert.equal(s.off,0);
s=benchTransition(s,'reset',count); assert.equal(s.active,false);
assert.deepEqual(benchTransition(s,'assemble',0),s);
const state={active:true,off:2,direction:-1};
assert.deepEqual(restoreBench({identity:'v1',state},'v1',3),state);
assert.equal(restoreBench({identity:'v1',state},'v2',3),null);
assert.equal(restoreBench({identity:'v1',state:{...state,off:99}},'v1',3),null);
assert.equal(restoreBench({identity:'v1',state:{...state,direction:0}},'v1',3),null);
assert.equal(restoreBench(null,'v1',3),null);
""")
    result=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'run.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr

def test_design_service(tmp_path):
    lib=ROOT/'web-next/src/lib'
    for name in ['workshopDesign','forgeEngine']:
        source=lib/f'{name}.ts'
        assert source.exists(), f'missing shared design service: {name}'
        (tmp_path/source.name).write_text(source.read_text().replace("from './forgeEngine'", "from './forgeEngine.ts'"))
    (tmp_path/'parts.json').write_text((ROOT/'catalog/parts.json').read_text())
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'design.mjs').write_text('''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {designConcept, canApplyDesign} from './workshopDesign.ts';
const cat=JSON.parse(readFileSync(new URL('./parts.json',import.meta.url))).parts;
assert.equal(canApplyDesign('a','v1','a','v1',false),true);
assert.equal(canApplyDesign('a','v1','b','v1',false),false);
assert.equal(canApplyDesign('a','v1','a','v2',false),false);
assert.equal(canApplyDesign('a','v1','a','v1',true),false);
assert.equal(canApplyDesign('a','v1',undefined,'v1',false),false);
const spec=designConcept('a compact rover with camera',cat);
assert.ok(spec.forge.bom.length);
assert.equal(spec.conceptSize,'compact');
assert.throws(()=>designConcept('a humanoid',cat),/supports rovers/);
const regenerated=designConcept('add lidar',cat,{...spec,name:'Keep my name',drivetrain:'mecanum',conceptSize:'compact'});
assert.equal(regenerated.name,'Keep my name');
assert.equal(regenerated.conceptSize,'compact');
assert.equal(regenerated.drivetrain,'mecanum');
assert.ok(regenerated.forge.ids.camera);
''')
    result=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'design.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr

def test_hidden_part_ancestors_do_not_intercept_selection(tmp_path):
    source=ROOT/'web-next/src/components/kit/workshopScenery.ts'
    (tmp_path/'scenery.ts').write_text(source.read_text())
    (tmp_path/'package.json').write_text('{"type":"module"}')
    (tmp_path/'visibility.mjs').write_text('''
import assert from 'node:assert/strict';
import {visibleForPicking} from './scenery.ts';
const root={visible:true,parent:null};
const shell={visible:false,parent:root};
const mesh={visible:true,parent:shell};
assert.equal(visibleForPicking(mesh),false);
shell.visible=true; assert.equal(visibleForPicking(mesh),true);
root.visible=false; assert.equal(visibleForPicking(mesh),false);
root.visible=true; mesh.visible=false; assert.equal(visibleForPicking(mesh),false);
''')
    result=subprocess.run(['node','--experimental-strip-types',str(tmp_path/'visibility.mjs')],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
