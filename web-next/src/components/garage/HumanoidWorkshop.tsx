'use client';
import {useEffect,useRef,useState} from 'react';
import type {URDFRobot} from 'urdf-loader';
import type * as Three from 'three';
import {assetPath} from '@/components/home/asset';
import {addWorkshopScenery,visibleForPicking} from '@/components/kit/workshopScenery';
import {BENCH_EVENT,type BenchResult} from '@/lib/workshopBench';
import {HUMANOID_EVENT,clampJoint,type HumanoidResult,type HumanoidCommand} from '@/lib/humanoid';

type Joint={name:string;lower:number;upper:number};
export default function HumanoidWorkshop(){
 const host=useRef<HTMLDivElement>(null),robotRef=useRef<URDFRobot|null>(null);
 const [links,setLinks]=useState<string[]>([]),[joints,setJoints]=useState<Joint[]>([]),[selected,setSelected]=useState(''),[hidden,setHidden]=useState<string[]>([]),[spread,setSpread]=useState(0),[poses,setPoses]=useState<Record<string,number>>({}),[status,setStatus]=useState('Loading official G1 model…');
 const [lightweight,setLightweight]=useState(false);const cameraReset=useRef<()=>void>(()=>{});
 const poseRef=useRef(poses);poseRef.current=poses;
 const current=useRef({selected,hidden,spread});current.current={selected,hidden,spread};
 const command=(cmd:HumanoidCommand):string=>{
  if(!links.length)return 'The G1 link records are still loading.';
  if(cmd.kind==='select'){if(!links.includes(cmd.link))return 'That link is not in this G1 model.';setSelected(cmd.link);return `Selected ${cmd.link}.`;}
  if(cmd.kind==='pose'){
   const joint=joints.find(j=>j.name===cmd.joint);if(!joint)return 'That movable joint is not recorded in this model.';
   const angle=clampJoint(cmd.degrees*Math.PI/180,joint.lower,joint.upper);robotRef.current?.setJointValue(joint.name,angle);setPoses(p=>({...p,[joint.name]:angle}));setSpread(0);
   return `${robotRef.current ? 'Posed' : 'Prepared visual pose for'} ${joint.name} to ${(angle*180/Math.PI).toFixed(1)} degrees within its URDF limits. Visual pose only; no balance or collision validation.`;
  }
  if(cmd.kind==='explode'){setSpread(1);return 'Exploded the visible link geometry for inspection; joint structure is unchanged.';}
  if(cmd.kind==='reset'){for(const j of joints)robotRef.current?.setJointValue(j.name,clampJoint(0,j.lower,j.upper));setPoses({});setSpread(0);setHidden([]);cameraReset.current();return 'Reset G1 pose, visibility and camera.';}
  if(cmd.kind==='next'){const next=links[(links.indexOf(selected)+1)%links.length];setSelected(next);return `Explore ${next}. This is model link order, not a verified assembly sequence.`;}
  const link=robotRef.current?.links[selected];return selected?`${selected}: manufacturer URDF link${link?.inertial?.mass ? `, declared mass ${link.inertial.mass} kg` : ''}. Connected joints: ${joints.filter(j=>j.name.replace('_joint','_link')===selected).map(j=>j.name).join(', ')||'see joint controls'}. Model data, not a physical measurement.`:'Select a link first.';
 };
 useEffect(()=>{const onCommand=(e:Event)=>{const r=(e as CustomEvent<HumanoidResult>).detail;if(r.handled)return;r.handled=true;r.message=command(r.command);setStatus(r.message);};const onBench=(e:Event)=>{const r=(e as CustomEvent<BenchResult>).detail;if(r.handled)return;r.handled=true;const kind=r.command==='reset'?'reset':r.command==='explain'||r.command==='hint'?'explain':r.command==='disassemble'?'explode':'next';r.message=command({kind});setStatus(r.message);};window.addEventListener(BENCH_EVENT,onBench);window.addEventListener(HUMANOID_EVENT,onCommand);return()=>{window.removeEventListener(BENCH_EVENT,onBench);window.removeEventListener(HUMANOID_EVENT,onCommand);};});
 useEffect(()=>{
  let disposed=false;let cleanup=()=>{};const abort=new AbortController();
  (async()=>{
   let robot:URDFRobot|null=null;
   const free=(root:Three.Object3D)=>root.traverse(o=>{const m=o as Three.Mesh;m.geometry?.dispose();const mats=Array.isArray(m.material)?m.material:[m.material];mats.filter(Boolean).forEach(mat=>mat.dispose());});
   try{
    const base=assetPath('assets/models/unitree-g1/');const response=await fetch(base+'g1_23dof.urdf',{signal:abort.signal});if(!response.ok)throw new Error('Model file unavailable');const xml=await response.text();
    const doc=new DOMParser().parseFromString(xml,'text/xml');if(doc.querySelector('parsererror'))throw new Error('Invalid URDF');
    const names=Array.from(doc.querySelectorAll('robot > link')).map(e=>e.getAttribute('name')!);
    const limits=Array.from(doc.querySelectorAll('robot > joint[type="revolute"]')).map(e=>({name:e.getAttribute('name')!,lower:Number(e.querySelector('limit')?.getAttribute('lower')),upper:Number(e.querySelector('limit')?.getAttribute('upper'))}));
    if(disposed)return;setLinks(names);setJoints(limits);if(lightweight){setStatus('Link records ready · lightweight inspection');return;}
    const THREE=await import('three');const [{default:URDFLoader},{OrbitControls}]=await Promise.all([import('urdf-loader'),import('three/addons/controls/OrbitControls.js')]);if(disposed)return;
    const manager=new THREE.LoadingManager();let meshFailed=false;const meshesReady=new Promise<void>(resolve=>{manager.onLoad=()=>resolve();manager.onError=()=>{meshFailed=true;};});
    const loader=new URDFLoader(manager);loader.workingPath=base;loader.packages={g1_description:base};loader.parseCollision=false;robot=loader.parse(xml);robotRef.current=robot;await meshesReady;
    if(disposed){free(robot);return;}if(meshFailed)throw new Error('A G1 mesh could not load. Link records remain available.');
    for(const joint of limits)robot.setJointValue(joint.name,clampJoint(poseRef.current[joint.name]??0,joint.lower,joint.upper));
    const shared=new Set<Three.Material>();robot.traverse(o=>{const mesh=o as Three.Mesh;if(mesh.material){const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];originals.forEach(m=>shared.add(m));mesh.material=Array.isArray(mesh.material)?originals.map(m=>m.clone()):originals[0].clone();}});shared.forEach(m=>m.dispose());
    const el=host.current;if(!el){free(robot);return;}
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;el.appendChild(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x081321);scene.add(robot);scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,-3,4);scene.add(light);
    // URDF uses metres and Z-up. Raise the model so its feet meet the work surface.
    robot.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(robot);robot.position.z-=box.min.z;robot.updateMatrixWorld(true);
    const height=box.max.z-box.min.z;addWorkshopScenery(THREE,scene,height);
    const camera=new THREE.PerspectiveCamera(40,1,.01,50);camera.up.set(0,0,1);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=false;
    cameraReset.current=()=>{camera.position.set(height*2,-height*2.5,height*1.7);controls.target.set(0,0,height*.5);controls.update();};cameraReset.current();
    const visuals:{object:Three.Object3D;home:Three.Vector3;offset:Three.Vector3;link:string}[]=[];
    Object.entries(robot.links).forEach(([name,link],i)=>{link.children.filter(o=>(o as unknown as {isURDFVisual?:boolean}).isURDFVisual).forEach(object=>{const direction=new THREE.Vector3(i%2?1:-1,0,(i%5-2)*.25).multiplyScalar(height*.35);direction.applyQuaternion(link.getWorldQuaternion(new THREE.Quaternion()).invert());visuals.push({object,home:object.position.clone(),offset:direction,link:name});});});
    const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=[0,0];const onDown=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};
    const onUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const meshes:Three.Object3D[]=[];robot!.traverse(o=>{if((o as Three.Mesh).isMesh&&visibleForPicking(o))meshes.push(o);});let hit=ray.intersectObjects(meshes,false)[0]?.object;while(hit&&!(hit as unknown as {isURDFLink?:boolean}).isURDFLink)hit=hit.parent!;if(hit)setSelected(hit.name);};
    renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointerup',onUp);
    const resize=()=>{renderer.setSize(el.clientWidth,420);camera.aspect=el.clientWidth/420;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(el);resize();
    renderer.setAnimationLoop(()=>{if(document.hidden)return;for(const v of visuals){v.object.visible=!current.current.hidden.includes(v.link);v.object.position.copy(v.home).addScaledVector(v.offset,current.current.spread);v.object.traverse(o=>{const material=(o as Three.Mesh).material;if(material&&!Array.isArray(material)&&'emissive' in material)(material as Three.MeshStandardMaterial).emissive.setHex(v.link===current.current.selected?0x164b55:0);});}controls.update();renderer.render(scene,camera);});
    setStatus('Official G1 23-DoF model ready · inspection and visual joint posing');
    cleanup=()=>{renderer.setAnimationLoop(null);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',onUp);controls.dispose();free(scene);renderer.dispose();renderer.domElement.remove();robotRef.current=null;cameraReset.current=()=>{};};if(disposed)cleanup();
   }catch(e){if(robot)free(robot);if(!disposed)setStatus(`${(e as Error).message}. Use link and joint records below.`);}
  })();return()=>{disposed=true;abort.abort();cleanup();};
 },[lightweight]);
 return <section className="ws-guided" aria-label="G1 humanoid workbench"><span className="eyebrow">Manufacturer reference · Unitree G1</span><h3>Explore a humanoid, link by link</h3><p>Official 23-DoF URDF. Model inspection and posing; no walking controller, hardware connection, or verified build sequence.</p><div ref={host} style={{minHeight:lightweight?0:420}} aria-label="Interactive G1 model"/><p role="status">{status}</p>
 <div className="ta-controls"><button className="btn btn-sm" onClick={()=>setStatus(command({kind:'next'}))}>Next link</button><button className="btn btn-sm" onClick={()=>setStatus(command({kind:'reset'}))}>Reset humanoid</button><button className="btn btn-sm" onClick={()=>setLightweight(v=>!v)}>{lightweight?'Show 3D':'Lightweight view'}</button><a href={assetPath('assets/models/unitree-g1/LICENSE')}>BSD-3-Clause license</a></div>
 <label className="g-field">Exploded inspection<input aria-label="G1 exploded view" type="range" min="0" max="1" step=".01" value={spread} onChange={e=>setSpread(Number(e.target.value))}/></label>
 <label className="g-field">Selected link<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a link</option>{links.map(link=><option key={link}>{link}</option>)}</select></label>
 {selected&&<div><button className="btn btn-sm" onClick={()=>setHidden(v=>v.includes(selected)?v.filter(id=>id!==selected):[...v,selected])}>{hidden.includes(selected)?'Show':'Hide'} selected link</button><button className="btn btn-sm" onClick={()=>setStatus(command({kind:'explain'}))}>Explain this link</button></div>}
 <details className="ws-disclosure"><summary>Joint posing · {joints.length} actuated joints</summary><p className="faint">Radians within URDF limits. Poses are visual, without collision or balance checks.</p>{joints.map(j=><label className="g-field" key={j.name}>{j.name} · {(poses[j.name]??0).toFixed(2)} rad<input aria-label={j.name} type="range" min={j.lower} max={j.upper} step=".01" value={poses[j.name]??clampJoint(0,j.lower,j.upper)} onChange={e=>setStatus(command({kind:'pose',joint:j.name,degrees:Number(e.target.value)*180/Math.PI}))}/></label>)}</details>
 <details className="ws-disclosure"><summary>Use Wrench</summary><p>“Explode humanoid”, “next humanoid part”, “explain humanoid part”, “select humanoid pelvis”, “pose left_knee_joint to 30 degrees”, or “reset humanoid”. Open this view before issuing a command.</p></details>
 </section>;
}
