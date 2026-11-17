'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Three from 'three';
import {assetPath} from '@/components/home/asset';
import {addWorkshopScenery,visibleForPicking} from '@/components/kit/workshopScenery';
import {openStudioInspector} from '@/lib/studioProject';
import {BENCH_EVENT,type BenchResult} from '@/lib/workshopBench';
import {INSPECTION_EVENT,inspectionTransition,findInspectionParts,type InspectionState,type InspectionCommand,type DetailedModel} from '@/lib/turtlebotModel';
import './detailedRobot.css';

const BASE='assets/models/turtlebot3-burger/';
export default function DetailedBurgerWorkshop({studio=false}:{studio?:boolean}){
 const host=useRef<HTMLDivElement>(null),fit=useRef(()=>{});
 const [model,setModel]=useState<DetailedModel|null>(null),[selected,setSelected]=useState(''),[query,setQuery]=useState('');
 const [state,setState]=useState<InspectionState>({removed:[],history:[]}),[spread,setSpread]=useState(0),[mode,setMode]=useState<'inspect'|'assemble'|'disassemble'>('inspect');
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[notice,setNotice]=useState('');
 const current=useRef({selected,state,spread});current.current={selected,state,spread};
 const ids=model?.teardown??[],part=model?.parts.find(p=>p.id===selected);
 const target=mode==='assemble'?ids.slice().reverse().find(id=>state.removed.includes(id)):ids.find(id=>!state.removed.includes(id));
 const apply=(action:Parameters<typeof inspectionTransition>[1])=>setState(s=>inspectionTransition(s,action,ids));
 const begin=(next:'assemble'|'disassemble')=>{setMode(next);apply({kind:next==='assemble'?'clear':'reset'});setSpread(0);openStudioInspector();};
 const next=()=>{if(!target)return;setSelected(target);apply({kind:mode==='assemble'?'restore':'remove',id:target});};
 useEffect(()=>{
  const bench=(e:Event)=>{const r=(e as CustomEvent<BenchResult>).detail;if(r.handled||!ready||!model)return;r.handled=true;
   if(r.command==='assemble'||r.command==='disassemble'){begin(r.command);r.message=`Started ${r.command==='assemble'?'assembly':'disassembly'} of the detailed Burger. Visual inspection sequence; not physical service instructions.`;}
   else if(r.command==='next'){next();r.message=target?`${mode==='assemble'?'Restored':'Removed'} ${model.parts.find(p=>p.id===target)?.name}.`:'All steps are complete.';}
   else if(r.command==='back'){apply({kind:'undo'});r.message='Undid the previous visual assembly change.';}
   else if(r.command==='reset'){apply({kind:'reset'});setSpread(0);setMode('inspect');fit.current();r.message='Restored the complete manufacturer Burger model.';}
   else r.message=part?`${part.name}: ${part.shellCount} source geometry shell${part.shellCount===1?'':'s'}; ${part.evidence}. ${model.assemblyEvidence}`:'Select a Burger part first.';
   setNotice(r.message);openStudioInspector();
  };
  const command=(e:Event)=>{const r=(e as CustomEvent<{command:InspectionCommand;handled:boolean;message:string}>).detail;if(r.handled||!ready||!model)return;
   const term=r.command.name.replace(/laser scanner|scanner/g,'lidar').replace(/raspberry pi/g,'pi');
   const matches=findInspectionParts(model.parts,term);r.handled=true;
   if(matches.length!==1){r.message=matches.length?'Choose a specific part: '+matches.map(p=>p.name).join(', '):'No matching part in the Burger reference. Open Parts to see available names.';return;}
   const p=matches[0];setSelected(p.id);openStudioInspector();
   if(r.command.kind!=='select')apply({kind:r.command.kind,id:p.id});
   r.message=`${r.command.kind==='select'?'Selected':r.command.kind==='remove'?'Removed':'Restored'} ${p.name} in the visual model.`;setNotice(r.message);
  };
  window.addEventListener(BENCH_EVENT,bench);window.addEventListener(INSPECTION_EVENT,command);
  return()=>{window.removeEventListener(BENCH_EVENT,bench);window.removeEventListener(INSPECTION_EVENT,command);};
 });
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};const abort=new AbortController();setReady(false);setError('');
  (async()=>{
   try{
    const response=await fetch(assetPath(BASE+'model.json'),{signal:abort.signal});if(!response.ok)throw new Error('Burger component manifest unavailable');
    const doc=await response.json() as DetailedModel;
    if(doc.schema!=='robotforge.detailed-model.v1'||!doc.parts.length)throw new Error('Invalid Burger model');
    const [THREE,{OrbitControls},{STLLoader}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js'),import('three/addons/loaders/STLLoader.js')]);
    const files=[...new Set(doc.parts.map(p=>p.file))];
    const buffers=await Promise.all(files.map(async file=>{if(!/^[\w-]+\.stl$/.test(file))throw new Error('Invalid model path');const r=await fetch(assetPath(BASE+file),{signal:abort.signal});if(!r.ok)throw new Error('Missing manufacturer mesh: '+file);return r.arrayBuffer();}));
    if(disposed||!host.current)return;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#0d1721');
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.4;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const camera=new THREE.PerspectiveCamera(38,1,.002,30);camera.up.set(0,0,1);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=.18;controls.maxDistance=2.5;controls.maxPolarAngle=Math.PI*.48;
    fit.current=()=>{camera.position.set(.31,-.40,.25);controls.target.set(-.015,0,.115);controls.update();};fit.current();
    scene.add(new THREE.HemisphereLight(0xe0f2ff,0x31444c,2.3));
    for(const [x,y,z,intensity] of [[1,-2,3,3.8],[-2,1,2,2.1],[0,2,1,1.8]]){const l=new THREE.DirectionalLight(0xf5f4eb,intensity);l.position.set(x,y,z);scene.add(l);}
    if(studio)addWorkshopScenery(THREE,scene,.27);
    else{const floor=new THREE.Mesh(new THREE.PlaneGeometry(3,3),new THREE.MeshStandardMaterial({color:0x152731,roughness:.9}));floor.position.z=-.003;scene.add(floor);}
    const loaded=new Map(files.map((file,i)=>[file,new STLLoader().parse(buffers[i])]));
    const groups:Three.Group[]=[],meshes:Three.Mesh[]=[],materials:Three.MeshStandardMaterial[]=[];
    let raf=0;
    const observer=new ResizeObserver(()=>resize());
    const resize=()=>{if(!host.current)return;const w=host.current.clientWidth||600,h=Math.max(280,host.current.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};
    const release=()=>{cancelAnimationFrame(raf);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);scene.traverse(o=>{const m=o as Three.Mesh;m.geometry?.dispose();const ms=Array.isArray(m.material)?m.material:[m.material];ms.filter(Boolean).forEach(mat=>mat.dispose());});loaded.forEach(g=>g.dispose());renderer.dispose();renderer.domElement.remove();fit.current=()=>{};};
    cleanup=release;
    for(const p of doc.parts){
     const source=loaded.get(p.file)!;const count=p.ranges.reduce((n,r)=>n+r[1],0)*9,positions=new Float32Array(count),normals=new Float32Array(count);let offset=0;
     for(const [start,n] of p.ranges){positions.set((source.getAttribute('position').array as Float32Array).subarray(start*9,(start+n)*9),offset);normals.set((source.getAttribute('normal').array as Float32Array).subarray(start*9,(start+n)*9),offset);offset+=n*9;}
     const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.scale(p.scale,p.scale,p.scale);geometry.computeBoundingSphere();
     const material=new THREE.MeshStandardMaterial({color:p.color,roughness:p.id.startsWith('hardware')?.35:.65,metalness:/pillars|hardware/.test(p.id)?.7:.12});
     const mesh=new THREE.Mesh(geometry,material);mesh.userData.part=p.id;mesh.castShadow=true;mesh.receiveShadow=true;
     const group=new THREE.Group();group.position.fromArray(p.position);group.add(mesh);scene.add(group);groups.push(group);meshes.push(mesh);materials.push(material);
    }
    loaded.forEach(g=>g.dispose());loaded.clear();
    let pointer=[0,0];function down(e:PointerEvent){pointer=[e.clientX,e.clientY];}
    function up(e:PointerEvent){if(Math.hypot(e.clientX-pointer[0],e.clientY-pointer[1])>5)return;const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObjects(meshes).find(h=>visibleForPicking(h.object));if(hit){setSelected(hit.object.userData.part);openStudioInspector();}}
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);host.current.appendChild(renderer.domElement);resize();observer.observe(host.current);
    const tick=()=>{if(disposed)return;raf=requestAnimationFrame(tick);const value=current.current;groups.forEach((group,i)=>{const p=doc.parts[i];group.visible=!value.state.removed.includes(p.id);const dest=new THREE.Vector3(...p.position).addScaledVector(new THREE.Vector3(...p.explode),value.spread);group.position.lerp(dest,.16);materials[i].emissive.set(value.selected===p.id?0x246e67:0x000000);materials[i].emissiveIntensity=.6;});controls.update();renderer.render(scene,camera);};tick();setModel(doc);setReady(true);
   }catch(e){cleanup();if(!disposed&&(e as Error).name!=='AbortError')setError((e as Error).message);}
  })();return()=>{disposed=true;abort.abort();cleanup();};
 },[attempt,studio]);
 return <section className={studio?'studio-scene-grid detailed-workbench':'detailed-workbench detailed-standalone'} aria-label="Detailed TurtleBot3 Burger">
  <div className="studio-canvas"><div className="studio-scene-tools"><button className="studio-mobile-only" onClick={openStudioInspector}>Parts</button><button onClick={()=>fit.current()}>Fit view</button><button aria-pressed={spread>0} onClick={()=>setSpread(n=>n?0:1)}>Separate parts</button><button onClick={()=>begin('disassemble')} disabled={!ready}>Disassemble</button><button onClick={()=>begin('assemble')} disabled={!ready}>Assemble</button></div>
   <div ref={host} className="studio-model" aria-label="Manufacturer TurtleBot3 Burger model"/>
   {!ready&&<div className="studio-load"><p role={error?'alert':'status'}>{error||'Loading manufacturer TurtleBot parts…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>Retry model</button>}</div>}
   <span className="studio-scene-caption">ROBOTIS reference · original geometry · select a part</span>
  </div>
  <aside className="studio-inspector" aria-label="TurtleBot component inspector">
   <div className="studio-panel-head"><h2>{mode==='inspect'?'Burger parts':mode==='assemble'?'Assembly':'Disassembly'}</h2><button onClick={()=>{apply({kind:'reset'});setMode('inspect');setSpread(0);}}>Reset</button></div>
   {mode!=='inspect'&&<div className="burger-step"><small>VISUAL SEQUENCE</small><h3>{target?model?.parts.find(p=>p.id===target)?.name:'Complete'}</h3><progress aria-label="Burger assembly progress" max={ids.length||1} value={mode==='assemble'?ids.length-state.removed.length:state.removed.length}/><span>{mode==='assemble'?ids.length-state.removed.length:state.removed.length} / {ids.length}</span><div className="studio-inline"><button className="studio-primary" disabled={!target} onClick={next}>{mode==='assemble'?'Add part':'Remove part'}</button><button disabled={!state.history.length} onClick={()=>apply({kind:'undo'})}>Undo</button><button onClick={()=>setMode('inspect')}>Inspect</button></div></div>}
   <input className="studio-search" aria-label="Find a Burger component" placeholder="Find a component…" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="studio-parts burger-part-list">{model?.parts.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(p=><button key={p.id} aria-pressed={p.id===selected} onClick={()=>setSelected(p.id)}><span>{p.name}</span><small>{state.removed.includes(p.id)?'Removed':''}</small></button>)}</div>
   {part&&<div className="studio-part-card"><h3>{part.name}</h3><span>{part.shellCount} source geometry shells</span><button onClick={()=>apply({kind:state.removed.includes(part.id)?'restore':'remove',id:part.id})}>{state.removed.includes(part.id)?'Restore selected part':'Remove selected part'}</button><button disabled={!state.history.length} onClick={()=>apply({kind:'undo'})}>Undo last change</button></div>}
   {notice&&<p role="status" className="studio-muted">{notice}</p>}
   <details className="burger-sources"><summary>Model &amp; assembly sources</summary><p>{model?.assemblyEvidence}</p><p>Original meshes; annotated materials and {model?.parts.length} inspection groups from {model?.sourceShells} base geometry shells.</p><a href="https://emanual.robotis.com/docs/en/platform/turtlebot3/hardware_setup/" target="_blank" rel="noreferrer">Manufacturer assembly manuals</a><a href={assetPath(BASE+'model.json')}>Geometry sources &amp; hashes</a><a href={assetPath(BASE+'LICENSE')}>Apache-2.0 license</a></details>
  </aside>
 </section>;
}
