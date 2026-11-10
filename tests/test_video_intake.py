"""Video decoder regression tests with a browser API double, not real footage."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_video_frames_noop_seek_short_clip_and_decode_failure(tmp_path):
    (tmp_path / 'image.ts').write_text((ROOT / 'web-next/src/lib/image.ts').read_text())
    (tmp_path / 'package.json').write_text('{"type":"module"}')
    (tmp_path / 'test.mjs').write_text('''
import assert from 'node:assert/strict';
import {videoFrames} from './image.ts';
let video, revoked=0, drawn=0, failed=false;
URL.createObjectURL=()=> 'blob:test';
URL.revokeObjectURL=()=>revoked++;
globalThis.document={createElement(kind){
 if(kind==='canvas')return {width:0,height:0,getContext:()=>({drawImage(){drawn++;}}),toDataURL:()=> 'data:image/jpeg;base64,frame'};
 let time=0;
 video={duration:.02,videoWidth:640,videoHeight:480,readyState:2,
 pause(){},removeAttribute(){},load(){},
 set src(value){queueMicrotask(()=>failed?this.onerror?.():this.onloadeddata?.());},
 get currentTime(){return time;},
 set currentTime(next){assert.ok(next>=0 && next<this.duration,'valid seek time');if(next===time)return;time=next;queueMicrotask(()=>this.onseeked?.());}
 };
 return video;
}};
const progress=[];
const frames=await Promise.race([videoFrames(new Blob(['video']),3,560,.7,(done,total)=>progress.push([done,total])),new Promise((_,reject)=>setTimeout(()=>reject(Error('Video extraction hung at a no-op seek')),200))]);
assert.equal(frames.length,3);assert.equal(drawn,3);assert.equal(revoked,1);
assert.deepEqual(progress,[[1,3],[2,3],[3,3]]);
await assert.rejects(()=>videoFrames(new Blob(),0),/frame/i);
failed=true;
await assert.rejects(()=>videoFrames(new Blob(['invalid']),3),/video/i);
assert.equal(revoked,2);
''')
    result = subprocess.run(['node', '--experimental-strip-types', str(tmp_path / 'test.mjs')], capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
