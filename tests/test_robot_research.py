"""Bounded public-source discovery never treats search links as imported models."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
def test_public_robot_research(tmp_path):
 (tmp_path/'research.ts').write_text((ROOT/'web-next/src/lib/robotResearch.ts').read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'check.mjs').write_text('''
import assert from 'node:assert/strict';
import {robotResearchName,collectRobotResearch} from './research.ts';
assert.equal(robotResearchName('identify robot Example Rover'),'Example Rover');
assert.equal(robotResearchName('research TurtleBot3 Burger'),'TurtleBot3 Burger');
assert.equal(robotResearchName('identify this robot'),null);
assert.equal(robotResearchName('remove the lidar'),null);
let count=0;const report=await collectRobotResearch('Example Rover',async q=>{count++;if(count===2)throw Error('unavailable');return [{url:'https://example.org/robot.step',title:'Open CAD'},{url:'javascript:alert(1)',title:'bad'},{url:'https://user:secret@example.org/data',title:'bad'}];},'now');
assert.equal(count,3);assert.equal(report.resources.length,1);assert.equal(report.resources[0].kind,'CAD / 3D model');assert.equal(report.coverage.filter(c=>c.status==='unavailable').length,1);
assert.equal(report.resources[0].assetStatus,'discovered link');assert.equal(report.resources[0].license,'Not verified');
''')
 r=subprocess.run(['node',str(tmp_path/'check.mjs')],capture_output=True,text=True)
 assert r.returncode==0,r.stdout+r.stderr
