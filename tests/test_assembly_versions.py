"""Authoritative version snapshots, legacy transition and full-spec undo."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_versioned_assembly_transactions(tmp_path):
    lib = ROOT / 'web-next/src/lib'
    for name in ['assembly', 'components']:
        (tmp_path / f'{name}.ts').write_text((lib / f'{name}.ts').read_text().replace("from './components'", "from './components.ts'"))
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {effectiveAssemblies,commitAssemblyVersion,undoVersionedAssembly,operationFor,currentAssembly} from './assembly.ts';
const a={id:'legacy',createdAt:'t',note:'old',components:[{id:'part',componentId:'jetson-orin-nano-reference-devkit',positionM:[0,0,.1],yawDeg:0}],connections:[]};
const legacy={r:[a]};
const r={id:'r',name:'Robot',versions:[{id:'v1',spec:{mass_kg:4,electrical:{keep:true}}}]};
const archived={id:'archived',archivedAt:'2026-11-03T00:00:00.000Z',versions:[{id:'a',spec:{}}]};
const robots=[r,archived]; const original=JSON.stringify(robots);
assert.equal(currentAssembly(effectiveAssemblies(robots,legacy),'r').id,'legacy');
const op=operationFor(robots,legacy,'r',{kind:'move',instanceId:'part',positionM:[.1,0,.1],yawDeg:90});
const next=commitAssemblyVersion(robots,legacy,op,'v2','t2');
assert.equal(JSON.stringify(robots),original); assert.equal(next[1],archived);
assert.equal(next[0].versions.length,2); assert.equal(next[0].versions[1].spec.mass_kg,4);
assert.equal(next[0].versions[1].spec.assembly.id,'v2');
assert.throws(()=>undoVersionedAssembly(next,legacy,'r','v2','legacy','undo','t3'),/changed/);
assert.throws(()=>undoVersionedAssembly([{...next[0],archivedAt:archived.archivedAt}],legacy,'r','v2','v2','undo','t3'),/archived/);
const staleLegacy={r:[{...a,id:'foreign',components:[]}]};
assert.equal(currentAssembly(effectiveAssemblies(next,staleLegacy),'r').id,'v2');
assert.throws(()=>commitAssemblyVersion(next,legacy,op,'v3','t3'),/changed/);
assert.throws(()=>commitAssemblyVersion([{...r,archivedAt:archived.archivedAt}],legacy,op,'v2','t2'),/archived/);
const upgrade={...next[0],versions:[...next[0].versions,{id:'upgrade',spec:{mass_kg:4,assembly:{...a,id:'upgrade'},electrical:{new:true},upgrade:{status:'checked'},artifacts:['new']}}]};
const undone=undoVersionedAssembly([upgrade,archived],legacy,'r','upgrade','upgrade','undo','t4');
assert.deepEqual(undone[0].versions.at(-1).spec,{...next[0].versions.at(-1).spec,assembly:{...next[0].versions.at(-1).spec.assembly,id:'undo',createdAt:'t4',note:'Undo previous assembly change'}});
assert.equal(undone[1],archived);
assert.throws(()=>undoVersionedAssembly([upgrade],legacy,'r','v2','upgrade','undo','t4'),/changed/);
const upgradedMove=operationFor([upgrade],effectiveAssemblies([upgrade],legacy),'r',{kind:'move',instanceId:'part',positionM:[0,0,.2],yawDeg:0});
const invalidated=commitAssemblyVersion([{...upgrade,versions:[...upgrade.versions.slice(0,-1),{...upgrade.versions.at(-1),spec:{...upgrade.versions.at(-1).spec,upgradePlan:{status:'checked'},upgradeArtifacts:['cached']}}]}],legacy,upgradedMove,'edit','t5');
assert.equal(invalidated[0].versions.at(-1).spec.upgradePlan,undefined);
assert.equal(invalidated[0].versions.at(-1).spec.upgradeArtifacts,undefined);
const restored=undoVersionedAssembly(next,legacy,'r','v2','v2','undo','t3');
assert.equal(restored[0].versions.at(-1).spec.assembly.components[0].yawDeg,0);
const linkedAssembly={...a,id:'linked',components:[...a.components,{...a.components[0],id:'pi'}],connections:[{id:'part--pi',from:'part',to:'pi'}]};
const linkedSpec={assembly:linkedAssembly,wiring:{nodes:[{id:'part'},{id:'pi'},{id:'untouched'}],connections:[{from:'part',to:'pi',kind:'power'},{from:'part',to:'pi',kind:'data'},{from:'untouched',to:'part',kind:'power'}]},upgradePlan:{assembly:linkedAssembly},forgeTests:{status:'passed'},gate_status:'passed',simulationResults:{ok:true}};
const linkedRobot={...r,versions:[...r.versions,{id:'linked',spec:linkedSpec}]};
const removeOp=operationFor([linkedRobot],effectiveAssemblies([linkedRobot],legacy),'r',{kind:'remove',instanceId:'pi'});
const removedLinked=commitAssemblyVersion([linkedRobot],legacy,removeOp,'removed','t6');
const removedSpec=removedLinked[0].versions.at(-1).spec;
assert.deepEqual(removedSpec.wiring.nodes,[{id:'part'},{id:'untouched'}]);
assert.deepEqual(removedSpec.wiring.connections,[{from:'untouched',to:'part',kind:'power'}]);
assert.equal(removedSpec.gate_status,undefined);assert.equal(removedSpec.forgeTests,undefined);assert.equal(removedSpec.simulationResults,undefined);
assert.match(removedSpec.simulation_status,/incomplete/);
const disconnectOp=operationFor([linkedRobot],effectiveAssemblies([linkedRobot],legacy),'r',{kind:'disconnect',instanceId:'part--pi'});
const disconnected=commitAssemblyVersion([linkedRobot],legacy,disconnectOp,'disconnected','t7');
assert.deepEqual(disconnected[0].versions.at(-1).spec.wiring.connections,linkedSpec.wiring.connections.slice(1));
const undoLinked=undoVersionedAssembly(removedLinked,legacy,'r','removed','removed','restored','t8');
assert.deepEqual(undoLinked[0].versions.at(-1).spec.wiring,linkedSpec.wiring);
assert.deepEqual(linkedRobot.versions.at(-1).spec,linkedSpec);
console.log('versioned assembly checks passed');
''')
    result = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'run.mjs')], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
