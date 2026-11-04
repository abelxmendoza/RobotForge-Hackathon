'use client';
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import type {GarageRobot,Spec} from '@/lib/garage';
import {driveInput,simulationIssues,type Scenario,type SimPose} from '@/lib/simulation';
import {createDriveWorld} from '@/lib/drivePhysics';
import {readScanFile} from '@/lib/scanStore';
import {omega1Rover} from '@/lib/omega1Twin';
import {robots,physicsOf} from '@/lib/data';
import {assetPath} from '@/components/home/asset';
export default function DriveScene({spec,robot,identity,scenario,running,resetKey,cameraReset,keys,replay,onSample,onReady,onLimit}:{spec:Spec;robot?:GarageRobot;identity:string;scenario:Scenario;running:boolean;resetKey:number;cameraReset:number;keys:MutableRefObject<Set<string>>;replay?:SimPose[];onSample:(pose:SimPose)=>void;onReady:(ready:boolean)=>void;onLimit:()=>void}){
 const host=useRef<HTMLDivElement>(null),active=useRef(running),callbacks=useRef({onSample,onReady,onLimit}),reframe=useRef<(()=>void)|null>(null);
 const [caption,setCaption]=useState('Loading the robot…'),[error,setError]=useState('');
 active.current=running;callbacks.current={onSample,onReady,onLimit};
 useEffect(()=>{reframe.current?.();},[cameraReset]);
 useEffect(()=>{
  let disposed=false,cleanup:(()=>void)|undefined;
  callbacks.current.onReady(false);setError('');setCaption('Loading the robot…');
  (async()=>{
   const THREE=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');
   if(disposed||!host.current)return;
   const scene=new THREE.Scene();scene.background=new THREE.Color(0x09131e);
   const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;host.current.appendChild(renderer.domElement);
   const camera=new THREE.PerspectiveCamera(45,1,.01,100);camera.up.set(0,0,1);
   const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
   const shell=new THREE.Group();scene.add(shell);
   const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(3,-2,5);light.castShadow=true;scene.add(light,new THREE.HemisphereLight(0xe2f7ff,0x53645c,2));
   const ground=new THREE.Mesh(new THREE.BoxGeometry(24,24,.2),new THREE.MeshStandardMaterial({color:0x263542,roughness:.9}));ground.position.z=-.1;ground.receiveShadow=true;scene.add(ground);
   const grid=new THREE.GridHelper(24,48,0x507080,0x344957);grid.rotation.x=Math.PI/2;grid.position.z=.001;scene.add(grid);
   if(scenario!=='flat'){const mesh=new THREE.Mesh(new THREE.BoxGeometry(scenario==='ramp'?2:.3,scenario==='ramp'?1.6:1.4,scenario==='ramp'?.1:.03),new THREE.MeshStandardMaterial({color:0x66877e}));mesh.position.set(scenario==='ramp'?1.7:.9,0,scenario==='ramp'?Math.sin(Math.PI/18):.015);if(scenario==='ramp')mesh.rotation.y=-Math.PI/18;mesh.receiveShadow=true;mesh.castShadow=true;scene.add(mesh);}
   const size=Math.max(.2,spec.length_m||.3,spec.width_m||.25,spec.height_m||.2);
   const resetCamera=()=>{camera.position.set(shell.position.x+size*1.6,shell.position.y-size*2,size*1.5);controls.target.set(shell.position.x,shell.position.y,(spec.height_m||.2)/2);controls.update();};reframe.current=resetCamera;resetCamera();
   const resize=()=>{if(!host.current)return;const w=host.current.clientWidth,h=host.current.clientHeight;renderer.setSize(w,h);camera.aspect=w/Math.max(h,1);camera.updateProjectionMatrix();};
   const observer=new ResizeObserver(resize);observer.observe(host.current);resize();
   let world:Awaited<ReturnType<typeof createDriveWorld>>|undefined,raf=0,elapsed=0,last=performance.now(),sampleTick=0,replayTick=0;
   const freeObject=(object:import('three').Object3D)=>{object.traverse(o=>{const mesh=o as import('three').Mesh;mesh.geometry?.dispose();for(const m of Array.isArray(mesh.material)?mesh.material:mesh.material?[mesh.material]:[]){for(const v of Object.values(m))if(v&&typeof v==='object'&&(v as import('three').Texture).isTexture)(v as import('three').Texture).dispose();m.dispose();}});};
   cleanup=()=>{cancelAnimationFrame(raf);observer.disconnect();controls.dispose();world?.free();freeObject(scene);renderer.dispose();renderer.domElement.remove();reframe.current=null;};
   // Fallback geometry is explicitly a proxy, never presented as a detailed twin.
   const proxy=new THREE.Group();const bodyH=Number(spec.height_m)||.18,clear=Number(spec.ground_clearance_m)||.02,L=Number(spec.length_m)||.3,W=Number(spec.width_m)||.2;
   const body=new THREE.Mesh(new THREE.BoxGeometry(L,W,Math.max(.01,bodyH-clear)),new THREE.MeshStandardMaterial({color:0x2da99c,metalness:.3,roughness:.5}));body.position.z=clear+(bodyH-clear)/2;body.castShadow=true;proxy.add(body);
   const n=[2,4].includes(spec.wheel?.count)?spec.wheel.count:4,r=Number(spec.wheel?.diameter_m)/2||.04,ww=Number(spec.wheel?.width_m)||.02;
   for(let i=0;i<n;i++){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(r,r,ww,24),new THREE.MeshStandardMaterial({color:0x11191f,roughness:.9}));wheel.position.set(n===2?0:(i<2?1:-1)*(L/2-r),(i%2===0?1:-1)*(W/2+ww/2),r);proxy.add(wheel);wheel.castShadow=true;}
   shell.add(proxy);setCaption('Physics proxy · no detailed model attached');
   const tick=(now:number)=>{
    if(disposed)return;elapsed+=Math.min((now-last)/1000,.05);last=now;
    if(active.current){
     if(replay?.length){if(elapsed>=1/15){elapsed=0;const p=replay[Math.min(replayTick++,replay.length-1)];shell.position.set(p.x,p.y,p.z);shell.quaternion.set(p.qx,p.qy,p.qz,p.qw);if(replayTick>=replay.length)callbacks.current.onLimit();}}
     else if(world){while(elapsed>=1/60){elapsed-=1/60;const input=driveInput(keys.current),p=world.step(input.throttle,input.turn);shell.position.set(p.x,p.y,p.z);shell.quaternion.set(p.qx,p.qy,p.qz,p.qw);if(++sampleTick%6===0)callbacks.current.onSample(p);if(p.t>=120){callbacks.current.onLimit();break;}}}
    }else elapsed=0;
    controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(tick);
   };raf=requestAnimationFrame(tick);
   try{if(!replay&&!simulationIssues(spec).length)world=await createDriveWorld(spec,scenario);if(disposed){world?.free();world=undefined;return;}callbacks.current.onReady(Boolean(world||replay?.length));}catch(e){if(!disposed)setError((e as Error).message);}
   let object:import('three').Object3D|undefined,source='';
   try{
    if(robot?.scan){const bytes=await readScanFile(robot.id);if(!bytes)throw new Error('The uploaded model is unavailable in this browser.');
     if(robot.scan.format==='glb'){const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');object=(await new GLTFLoader().parseAsync(bytes,'')).scene;object.rotation.x=Math.PI/2;}
     else if(robot.scan.format==='obj'){const {OBJLoader}=await import('three/addons/loaders/OBJLoader.js');object=new OBJLoader().parse(new TextDecoder().decode(bytes));object.rotation.x=Math.PI/2;}
     else {const {PLYLoader}=await import('three/addons/loaders/PLYLoader.js');const geo=new PLYLoader().parse(bytes);object=geo.index?new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:geo.hasAttribute('color'),color:0xdddddd,side:THREE.DoubleSide})):new THREE.Points(geo,new THREE.PointsMaterial({size:.003,vertexColors:geo.hasAttribute('color'),color:0xdddddd}));}
     source='Your uploaded model · display scale fitted to spec';
    }else if(/^omega[ -]?1$/i.test(spec.name||robot?.name||'')){const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');object=(await new GLTFLoader().loadAsync(assetPath(omega1Rover.model))).scene;object.rotation.x=Math.PI/2;source='Omega1 reconstruction · estimated geometry';}
    else {const entry=robots.find(r=>r.name.toLowerCase()===(spec.name||'').toLowerCase().replace(/ \(demo\)$/,'' )||r.slug===(spec.name||'').toLowerCase());const physics=entry?.slug?physicsOf(entry.slug):undefined;if(physics?.urdf_url&&physics.status==='urdf'){const {default:URDFLoader}=await import('urdf-loader');const loader=new URDFLoader();loader.packages=physics.packages||{};object=await loader.loadAsync(assetPath(physics.urdf_url));source='Recorded robot model · joints held at their zero pose';}}
    if(object){if(disposed){freeObject(object);return;}object.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(object),extent=box.getSize(new THREE.Vector3());const max=Math.max(extent.x,extent.y,extent.z);if(!Number.isFinite(max)||max<=0){freeObject(object);throw new Error('The model has no usable bounds.');}const scale=Math.max(L,W,bodyH)/max;object.scale.multiplyScalar(scale);const fitted=new THREE.Box3().setFromObject(object),center=fitted.getCenter(new THREE.Vector3());object.position.sub(new THREE.Vector3(center.x,center.y,fitted.min.z));shell.remove(proxy);freeObject(proxy);shell.add(object);object.traverse(o=>{(o as import('three').Mesh).castShadow=true;});setCaption(source+' · simplified collision body');}
   }catch(e){if(!disposed)setCaption('Physics proxy · detailed model could not load: '+(e as Error).message);}
  })().catch(e=>{if(!disposed){setError((e as Error).message);callbacks.current.onReady(false);}cleanup?.();cleanup=undefined;});
  return()=>{disposed=true;cleanup?.();callbacks.current.onReady(false);};
 // identity includes the exact draft; changing robots/specs replaces the whole physical world.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[identity,scenario,resetKey,replay]);
 return <figure className="sim-drive-scene"><div className="sim-drive-canvas" tabIndex={0} ref={host} aria-label="Robot simulation scene"/>{error&&<p className="g-error" role="alert">{error}</p>}<figcaption>{caption}</figcaption></figure>;
}
