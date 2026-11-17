"""The detailed visual must retain the complete pinned source geometry."""
import hashlib,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def test_burger_geometry_partition_and_sources():
 manifest=json.loads((ROOT/'assets/models/turtlebot3-burger/model.json').read_text())
 assert manifest['schema']=='robotforge.detailed-model.v1'
 assert len(manifest['parts'])>=18
 assert len({p['id'] for p in manifest['parts']})==len(manifest['parts'])
 assert set(manifest['teardown'])=={p['id'] for p in manifest['parts']}
 base=ROOT/'assets/models/turtlebot3-burger'
 for source in manifest['sources']:
  b=(base/source['file']).read_bytes()
  assert hashlib.sha256(b).hexdigest()==source['sha256']
  count=struct.unpack_from('<I',b,80)[0]
  indices=[]
  for part in manifest['parts']:
   if part['file']==source['file']:
    for start,n in part['ranges']:indices.extend(range(start,start+n))
  assert sorted(indices)==list(range(count)),source['file']
 assert manifest['sourceRevision']=='fc817ce3073af1d6032397c64504134882af5e9a'
 assert 'interpretive' in manifest['assemblyEvidence'].lower()
 assert all(p['evidence']=='manufacturer mesh; RobotForge grouping' for p in manifest['parts'])


def test_burger_selection_and_reversible_assembly(tmp_path):
 import subprocess
 src=ROOT/'web-next/src/lib/turtlebotModel.ts'
 (tmp_path/'model.ts').write_text(src.read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'test.mjs').write_text('''
import assert from 'node:assert/strict';
import {isDetailedBurger,inspectionTransition,parseInspectionCommand,findInspectionParts} from './model.ts';
const stock={name:'turtlebot3-burger',length_m:.178,width_m:.138,height_m:.192,wheel:{diameter_m:.066,count:2}};
assert.equal(isDetailedBurger(stock),true);assert.equal(isDetailedBurger({...stock,name:'TurtleBot3 Burger (demo)'}),true);
assert.equal(isDetailedBurger({...stock,width_m:.5}),false);assert.equal(isDetailedBurger({...stock,name:'Custom rover'}),false);
assert.deepEqual(findInspectionParts([{id:'lidar',name:'Laser scanner'},{id:'lidar-deck',name:'Lidar deck'}],'lidar').map(p=>p.id),['lidar']);
const ids=['lidar','plate','base'];let state={removed:[],history:[]};
for(const id of ids)state=inspectionTransition(state,{kind:'remove',id},ids);
assert.deepEqual(state.removed,ids);for(let i=0;i<3;i++)state=inspectionTransition(state,{kind:'undo'},ids);
assert.deepEqual(state.removed,[]);
assert.equal(inspectionTransition(state,{kind:'remove',id:'unknown'},ids),state);
assert.deepEqual(parseInspectionCommand('remove the lidar'),{kind:'remove',name:'lidar'});
assert.equal(parseInspectionCommand('what happens if I remove the lidar?'),null);
''')
 result=subprocess.run(['node',str(tmp_path/'test.mjs')],capture_output=True,text=True)
 assert result.returncode==0,result.stdout+result.stderr


def test_robodex_intake_preserves_existing_and_clones_spec(tmp_path):
 import subprocess
 (tmp_path/'intake.ts').write_text((ROOT/'web-next/src/lib/robodexIntake.ts').read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'test.mjs').write_text('''
import assert from 'node:assert/strict';
import {stageRobodexRobot} from './intake.ts';
const ref={name:'TurtleBot3 Burger',slug:'turtlebot3-burger',specFile:'examples/turtlebot3-burger.json'};
const spec={name:'turtlebot3-burger',wheel:{count:2}};
const result=stageRobodexRobot([],ref,spec,'r1','v1','2026-11-14');
assert.equal(result.records[0].versions[0].source,'robodex');assert.equal(result.added,true);
spec.wheel.count=99;assert.equal(result.records[0].versions[0].spec.wheel.count,2);
const again=stageRobodexRobot(result.records,ref,spec,'r2','v2','2026-11-14');
assert.equal(again.added,false);assert.equal(again.robotId,'r1');assert.equal(again.records,result.records);
const archived=[{...result.records[0],archivedAt:'2026-11-14'}];
const fresh=stageRobodexRobot(archived,ref,spec,'r2','v2','2026-11-14');assert.equal(fresh.records.length,2);assert.equal(archived.length,1);
''')
 result=subprocess.run(['node',str(tmp_path/'test.mjs')],capture_output=True,text=True)
 assert result.returncode==0,result.stdout+result.stderr
