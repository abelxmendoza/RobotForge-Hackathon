from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
def test_protocol_transport(tmp_path):
 for name in ['unityProtocol','unityTransport']:
  source=ROOT/f'web-next/src/lib/{name}.ts'
  assert source.exists(),f'missing {name}'
  (tmp_path/source.name).write_text(source.read_text().replace("'./unityProtocol'","'./unityProtocol.ts'"))
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';
import {validateSnapshot,validateResult,validateOperation} from './unityProtocol.ts';
import {UnityTransport} from './unityTransport.ts';
const identity={protocolVersion:1,sessionId:'s1',robotId:'r1',versionId:'v1',draftRevision:'d1'};
const snapshot={...identity,assetId:'unitree-g1-23',selectedLink:'',hiddenLinks:[],explode:0,joints:{},evidence:'manufacturer-reference'};
assert.equal(validateSnapshot(snapshot),true);
assert.equal(validateSnapshot({...snapshot,explode:NaN}),false);
assert.equal(validateSnapshot({...snapshot,assetId:'https://evil.test/a'}),false);
assert.equal(validateOperation('eval',{}),false);
assert.equal(validateOperation('setJointPose',{joint:'left_knee_joint',radians:Infinity}),false);
assert.equal(validateResult({...identity,type:'result',requestId:'a',status:'applied',message:'ok'}),true);
assert.equal(validateResult({...identity,type:'result',requestId:'a',status:'yes',message:'ok'}),false);
let sent=[];const transport=new UnityTransport(identity,c=>sent.push(c),100);
transport.ready({type:'ready',protocolVersion:1,buildId:'test',operations:['loadSnapshot','resetView','setJointPose']},'test');
const pending=transport.send('resetView',{});assert.equal(sent.length,1);
transport.receive({...sent[0],type:'result',status:'applied',message:'reset'});
assert.equal((await pending).message,'reset');
const second=transport.send('resetView',{});
transport.receive({...sent[1],sessionId:'stale',type:'result',status:'applied',message:'wrong'});
transport.receive({...sent[1],type:'result',status:'rejected',message:'no'});
assert.equal((await second).status,'rejected');
await assert.rejects(transport.send('eval',{}),/Unsupported/);
const cancelled=transport.send('resetView',{});transport.dispose();await assert.rejects(cancelled,/closed/);
const timeout=new UnityTransport(identity,()=>{},5);timeout.ready({type:'ready',protocolVersion:1,buildId:'test',operations:['resetView']},'test');
await assert.rejects(timeout.send('resetView',{}),/timed out/);timeout.dispose();
const mismatch=new UnityTransport(identity,()=>{});assert.throws(()=>mismatch.ready({type:'ready',protocolVersion:2,buildId:'test',operations:[]},'test'),/protocol/);mismatch.dispose();
''')
 r=subprocess.run(['node',str(tmp_path/'run.mjs')],capture_output=True,text=True)
 assert r.returncode==0,r.stdout+r.stderr

def test_player_lifecycle_and_build_validation(tmp_path):
 for name in ['unityPlayerLease','unityBuild']:(tmp_path/f'{name}.ts').write_text((ROOT/f'web-next/src/lib/{name}.ts').read_text())
 (tmp_path/'package.json').write_text('{"type":"module"}')
 (tmp_path/'run.mjs').write_text('''
import assert from 'node:assert/strict';import {leaseUnityPlayer} from './unityPlayerLease.ts';import {validateUnityBuild} from './unityBuild.ts';
let finish;let firstQuit=0,secondStarted=0;
const first=leaseUnityPlayer(()=>new Promise(resolve=>{finish=resolve;}));
await Promise.resolve();const closing=first.close();
const second=leaseUnityPlayer(async()=>{secondStarted++;return {SendMessage(){},async Quit(){}};});
await Promise.resolve();assert.equal(secondStarted,0);
finish({SendMessage(){},async Quit(){firstQuit++;}});await closing;await second.ready;
assert.equal(firstQuit,1);assert.equal(secondStarted,1);await first.close();assert.equal(firstQuit,1);await second.close();
const cancelled=leaseUnityPlayer(async()=>{throw new Error('loader failed');});await assert.rejects(cancelled.ready,/loader failed/);await cancelled.close();
const files={};const build={protocolVersion:1,buildId:'test',compression:'disabled',files};for(const key of ['loader','framework','data','wasm']){build[key]='/unity/test/'+key;files[build[key]]={sha256:'a'.repeat(64),bytes:10};}
assert.equal(validateUnityBuild(build),true);assert.equal(validateUnityBuild({...build,wasm:'https://evil.test/engine.wasm'}),false);assert.equal(validateUnityBuild({...build,protocolVersion:99}),false);
''')
 r=subprocess.run(['node',str(tmp_path/'run.mjs')],capture_output=True,text=True)
 assert r.returncode==0,r.stdout+r.stderr
