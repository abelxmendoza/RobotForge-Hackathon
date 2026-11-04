"""Regression cases from the Freenove/RC car conversation."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_context_helpers(tmp_path):
    node = shutil.which('node')
    assert node
    script = tmp_path / 'run.mjs'
    script.write_text('''
import assert from 'node:assert/strict';
const {conversationMessage,spawnDesignPrompt,researchQuery,contextualWebIntent}=await import(process.argv[2]);
const turns=[{who:'user',text:'I want to build a new robot'},
 {who:'bot',html:'<p>Which robot?</p>'},
 {who:'user',text:'Its an RC car'},
 {who:'user',text:'Freenove 4WD with Raspberry Pi 4B, camera, two servos and four yellow gearbox motors'}];
const msg=conversationMessage('spawn it in my workshop as a new robot',turns);
assert.ok(msg.includes('Raspberry Pi 4B'));
assert.ok(msg.includes('Which robot?'));
assert.ok(!msg.includes('<p>'));
assert.ok(msg.endsWith('spawn it in my workshop as a new robot'));
assert.ok(msg.length<=2000);
assert.equal(conversationMessage('x'.repeat(2000),turns).length,2000);
assert.throws(()=>conversationMessage('x'.repeat(2001),turns),/limit/);
assert.ok(spawnDesignPrompt('spawn it in my workshop as a new robot',turns).includes('four yellow gearbox motors'));
assert.ok(spawnDesignPrompt('spawn it with a lidar and 6 wheels',turns).includes('lidar and 6 wheels'));
assert.ok(researchQuery('search for it',turns).includes('Freenove'));
assert.ok(contextualWebIntent('search for it',turns,{kind:'search',query:'it'}).query.includes('Freenove'));
assert.deepEqual(contextualWebIntent('look up this https://example.com',turns,{kind:'scrape',url:'https://example.com'}),{kind:'scrape',url:'https://example.com'});
assert.equal(spawnDesignPrompt('do not spawn it',turns),null);
assert.equal(spawnDesignPrompt('what is its battery?',turns),null);
assert.equal(spawnDesignPrompt('spawn it',[]),null);
assert.ok(researchQuery('well I already have parts cant you look up freenove and search for it?',turns).includes('freenove'));
assert.ok(researchQuery('are you familiar with that one online?',turns).includes('Freenove'));
assert.equal(researchQuery('what is my robot battery?',turns),null);
''')
    result = subprocess.run([node, '--experimental-strip-types', str(script), str(ROOT / 'web-next/src/lib/museConversation.ts')],capture_output=True,text=True)
    assert result.returncode == 0, result.stdout + result.stderr
