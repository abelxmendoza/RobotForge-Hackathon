"""Self-contained, offline triangle viewer for generated asset bundles."""
import json


def viewer_html(report):
    # Escape script terminators even when the robot name is user-controlled.
    payload = json.dumps(report).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    return _HTML.replace('__DATA__', payload)


_HTML = '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RobotForge · Mesh inspector</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101820;color:#eef5f5;font:16px system-ui}main{max-width:1200px;margin:auto;padding:24px}h1{margin:8px 0}p{color:#b5c6ca;max-width:80ch}canvas{width:100%;height:60vh;min-height:300px;background:#17242e;border:1px solid #41515b;border-radius:12px;touch-action:none}label,button{margin:8px;display:inline-block}button,select{background:#273e49;color:white;border:1px solid #78909b;padding:10px;border-radius:6px}a{color:#65dec3}#parts label{font-size:14px}output{color:#65dec3}.tag{color:#ffcc80}input{accent-color:#65dec3}
</style><main><a href="https://github.com/abelxmendoza/RobotForge-Hackathon">RobotForge</a>
<h1 id="name"></h1><p id="scope"></p><p class="tag" id="status"></p>
<canvas aria-label="Interactive 3D robot mesh: drag to orbit, scroll to zoom" tabindex="0"></canvas>
<div><label>Explode <input id="explode" type="range" min="0" max="100" value="0"></label>
<label><input id="wire" type="checkbox"> Wireframe</label><button id="reset">Reset view</button></div>
<div><label>Load gate report for recorded replay <input id="report" type="file" accept=".json"></label>
<label>Recorded pose <input id="replay" type="range" min="0" max="0" value="0" disabled></label>
<p id="replay-status" role="status">No simulation loaded. Replay uses measured ground-truth samples, without real-time timing.</p></div>
<div id="parts"></div><output id="summary"></output>
<p>Drag to orbit · scroll to zoom · arrow keys to orbit. Geometry inspection only; no motion or physics result is implied.</p>
<p><a href="assets.json" download>Validation + provenance</a> · <a href="robot.urdf" download>URDF</a> · <a href="model.sdf" download>SDF</a> · <a href="spec.json" download>Specification</a></p>
</main><script>
const data=__DATA__;
document.querySelector('#name').textContent=data.robot;
document.querySelector('#scope').textContent=data.scope;
document.querySelector('#status').textContent=(data.estimated?'ESTIMATED dimensions · ':'')+'Mesh topology checked · Physics not verified by this export';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
let yaw=.65,pitch=.5,zoom=1,drag=null;
let poses=[],pose=null,replayCenter=[0,0,0],replaySpan=0;
const hidden=new Set(),colors=['#65dec3','#8598a3','#71849b','#b6c5d2','#8fbaad','#ffcc80'];
const extent=Math.max(...data.parts.flatMap(p=>p.vertices.map(v=>Math.hypot(...v)+Math.hypot(...p.xyz)))),scaleBase=extent||1;
data.parts.forEach((p,i)=>{const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true;check.onchange=()=>{check.checked?hidden.delete(i):hidden.add(i);draw()};label.append(check,document.createTextNode(' '+p.name+(p.assumed?' (assumed size)':'')));document.querySelector('#parts').append(label)});
document.querySelector('#summary').textContent=data.assets.length+' assets · '+data.assets.reduce((n,a)=>n+a.triangles,0)+' triangles · units: metres';
function rotate(v,r){let [x,y,z]=v;let [a,b,c]=r;[y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];[x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];return [x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c),z]}
function draw(){const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;ctx.scale(dpr,dpr);const w=rect.width,h=rect.height,s=Math.min(w,h)*.55/Math.max(scaleBase,replaySpan)*zoom,explode=+document.querySelector('#explode').value/100*scaleBase*.5;ctx.clearRect(0,0,w,h);
function project(v){let [x,y,z]=rotate(v.map((x,i)=>x-replayCenter[i]),[0,0,yaw]);return [w/2+x*s,h*.63-(z*Math.cos(pitch)-y*Math.sin(pitch))*s,y*Math.cos(pitch)+z*Math.sin(pitch)]}
const tris=[];data.parts.forEach((p,i)=>{if(hidden.has(i))return;const vs=p.vertices.map(v=>{const q=rotate(v,p.rpy);let assembled=q.map((x,j)=>x+p.xyz[j]+(j===2?explode*(i?1:0):explode*Math.sign(p.xyz[j])));if(pose){assembled=rotate(assembled,[0,0,pose[2]*Math.PI/180]);assembled[0]+=pose[0]-poses[0][0];assembled[1]+=pose[1]-poses[0][1]}return project(assembled)});p.faces.forEach(f=>tris.push({v:f.map(j=>vs[j]),i}))});tris.sort((a,b)=>a.v.reduce((n,v)=>n+v[2],0)-b.v.reduce((n,v)=>n+v[2],0));tris.forEach(t=>{ctx.beginPath();t.v.forEach((v,j)=>j?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));ctx.closePath();ctx.fillStyle=colors[t.i%colors.length];ctx.strokeStyle='#17242e';ctx.lineWidth=.4;if(!document.querySelector('#wire').checked)ctx.fill();ctx.stroke()});}
canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};canvas.onpointerup=()=>drag=null;canvas.onpointercancel=()=>drag=null;canvas.onpointermove=e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];draw()};canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw()},{passive:false});canvas.onkeydown=e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();yaw+=e.key==='ArrowLeft'?-.1:e.key==='ArrowRight'?.1:0;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.key==='ArrowUp'?.1:e.key==='ArrowDown'?-.1:0)));draw()};document.querySelector('#explode').oninput=draw;document.querySelector('#wire').onchange=draw;document.querySelector('#reset').onclick=()=>{yaw=.65;pitch=.5;zoom=1;document.querySelector('#explode').value=0;draw()};document.querySelector('#report').onchange=async e=>{const status=document.querySelector('#replay-status'),slider=document.querySelector('#replay');poses=[];pose=null;replayCenter=[0,0,0];replaySpan=0;slider.disabled=true;try{const file=e.target.files[0];if(!file)return;if(file.size>10000000)throw Error('Report is too large');const report=JSON.parse(await file.text());if(report.spec_sha256!==data.spec_sha256)throw Error('Report does not match this exact specification; export a fresh bundle and run-gate report');const trajectory=report.measurements?.trajectory;if(trajectory?.source!=='Gazebo ground truth'||trajectory.units!=='m, m, deg')throw Error('Report has no ground-truth trajectory');const samples=trajectory.poses;if(!Array.isArray(samples)||!samples.length||samples.length>20000||!samples.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('Invalid trajectory samples');poses=samples;pose=poses[0];const xs=poses.map(p=>p[0]-poses[0][0]),ys=poses.map(p=>p[1]-poses[0][1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);replayCenter=[(minX+maxX)/2,(minY+maxY)/2,0];replaySpan=Math.hypot(maxX-minX,maxY-minY)+scaleBase;slider.max=poses.length-1;slider.value=0;slider.disabled=false;status.textContent='Recorded gate: '+report.verdict+' · '+poses.length+' ground-truth poses · sample-order replay (no real-time timing)';}catch(error){status.textContent=error.message}draw()};document.querySelector('#replay').oninput=e=>{pose=poses[+e.target.value];draw()};window.addEventListener('resize',draw);draw();
</script></html>'''
