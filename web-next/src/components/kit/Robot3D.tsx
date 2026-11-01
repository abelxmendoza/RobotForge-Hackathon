'use client';
/* 3D take-apart — the React equivalent of assets/js/robot3d.js.
 * Renders the SAME kit the 2D views draw: geometry comes from
 * taGeom3d/taBuildParts in takeapart.ts — this file only turns
 * those units into Three.js meshes. Three.js is imported
 * dynamically on mount, so a load failure or a missing WebGL
 * context lands in onFail and the pane shows "3D unavailable
 * here — the 2D take-apart still works" instead of breaking.
 * Coordinates are the robot's own (x forward, y left, z up),
 * matching kit.html's Z-up convention. */
import { useEffect, useRef } from 'react';
import type * as THREE_NS from 'three';
import type { ComponentInstance, Connection } from '@/lib/assembly';
import { addComponentSkin } from './componentSkin';
import { snapPlacement, shortestYaw } from '@/lib/spatial';
import { cableControlPoints, animationPhase } from '@/lib/wire3d';
import { componentById } from '@/lib/components';
import type { RobotSpec } from '../forge/model';
import { taBuildParts, taGeom3d } from './takeapart';

type ThreeModule = typeof THREE_NS;

const PALETTE: Record<string, number> = {
  plate: 0x8a5a17, wheel: 0x22262e, mount: 0x3d4656, caster: 0x5b6472,
  lidar: 0x22262e, camera: 0x3d4656, ultrasonic: 0x3d4656,
  frame: 0x3d4656, arm: 0x51606f, rotor: 0x22262e, battery: 0x51606f,
  fc: 0x22262e, body: 0x51606f, leg: 0x3d4656, head: 0x22262e,
  pelvis: 0x3d4656, torso: 0x51606f, base: 0x8a5a17, link: 0x51606f,
  gripper: 0x22262e,
};
const EDGE: Record<string, number> = {
  plate: 0xf59e0b, wheel: 0xe8eaee, mount: 0x9aa3ae, caster: 0x9aa3ae,
  lidar: 0xe8eaee, camera: 0x9aa3ae, ultrasonic: 0x9aa3ae,
  frame: 0xf59e0b, arm: 0x9aa3ae, rotor: 0xe8eaee, battery: 0x9aa3ae,
  fc: 0x34d399, body: 0xf59e0b, leg: 0x9aa3ae, head: 0xe8eaee,
  pelvis: 0x9aa3ae, torso: 0xf59e0b, base: 0xf59e0b, link: 0x9aa3ae,
  gripper: 0xe8eaee,
};

interface Session {
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  controls: { update: () => void };
  materials: Record<string, THREE_NS.MeshStandardMaterial>;
  groups: THREE_NS.Group[];
  selected: string | null;
  hover: string | null;
  explode: number;
  refresh?: () => void;
  applyExplode?: () => void;
}

export default function Robot3D({
  spec,
  explode,
  selected,
  onSelect,
  onFail,
  instances,
  connections,
  animate = true,
  xray = false,
  collisionIds = [], dragMode = false, snapDeck = true, ghostMount = false,
  quality = 'balanced',
  fov, comparison, replay = 1, playing = false, onMove, onPlaybackEnd,
  teardown,
  autoRotate = false,
}: {
  spec: RobotSpec;
  explode: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onFail: () => void;
  instances?: ComponentInstance[];
  connections?: Connection[];
  animate?: boolean;
  xray?: boolean;
  quality?: 'high'|'balanced';
  collisionIds?: string[]; dragMode?: boolean; snapDeck?: boolean; ghostMount?: boolean;
  fov?: {angleDeg:number;rangeM:number}; comparison?: ComponentInstance[];
  replay?: number; playing?: boolean;
  onMove?: (id:string,position:[number,number,number])=>void;
  onPlaybackEnd?: ()=>void;
  /* Optional step-by-step teardown: parts in `removed` lift off the
   * robot and dim (the newest stays bright); `isolate` fades everything
   * but that part. Omitted = the viewer behaves exactly as before. */
  teardown?: { removed: string[]; isolate: string | null };
  /* Slow turntable spin; pauses while you drag a part or the user
   * prefers reduced motion. */
  autoRotate?: boolean;
}) {
  const motionRef = useRef({animate,xray,collisionIds,dragMode,snapDeck,ghostMount,fov,replay,playing,teardown,autoRotate});
  motionRef.current = {animate,xray,collisionIds,dragMode,snapDeck,ghostMount,fov,replay,playing,teardown,autoRotate};
  const previousRef = useRef<ComponentInstance[]>([]);
  const cameraRef = useRef<{position:[number,number,number];target:[number,number,number]}|null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const cbRef = useRef({ onSelect, onFail, onMove, onPlaybackEnd });
  cbRef.current = { onSelect, onFail, onMove, onPlaybackEnd };
  const stateRef = useRef({ explode, selected });
  stateRef.current = { explode, selected };

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const THREE = (await import('three')) as unknown as ThreeModule;
        const { OrbitControls } = await import(
          'three/addons/controls/OrbitControls.js'
        );
        const [{RoomEnvironment},{RoundedBoxGeometry}]=await Promise.all([
          import('three/addons/environments/RoomEnvironment.js'),
          import('three/addons/geometries/RoundedBoxGeometry.js'),
        ]);
        if (disposed) return;
        const studio=quality==='high';
        const built = taBuildParts(spec);
        const units = taGeom3d(spec, built.parts, built.pos);

        const previous = previousRef.current;
        previousRef.current = instances ?? [];
        const renderInstances=[...(instances??[]),...(comparison??[]).filter(old=>!instances?.some(c=>c.id===old.id))];
        for (const [index,instance] of renderInstances.entries()) {
          const part = componentById(instance.componentId);
          if (!part) continue;
          units.push({ part: instance.id, explode: [0, 0, 1 + index*0.35], meshes: [{
            kind: 'box', size: part.sizeM, center: instance.positionM,
            rot: [0, 0, instance.yawDeg * Math.PI / 180],
          }] });
        }

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, studio ? 2 : 1.25));
        renderer.outputColorSpace=THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background=new THREE.Color(0x081321);
        const pmrem=new THREE.PMREMGenerator(renderer);
        const room=new RoomEnvironment();
        const environment=pmrem.fromScene(room,0.04);
        scene.environment=environment.texture;
        room.dispose();pmrem.dispose();
        const camera = new THREE.PerspectiveCamera(42, 2, 0.01, 30);
        camera.up.set(0, 0, 1);
        const span = Math.max(
          spec.length_m,
          spec.width_m,
          spec.height_m * 0.75,
          0.2,
        );
        camera.position.set(span * 1.25, -span * 1.45, span * 1.0);
        if(cameraRef.current) camera.position.set(...cameraRef.current.position);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, spec.height_m * 0.45);
        if(cameraRef.current) controls.target.set(...cameraRef.current.target);
        controls.enableDamping = true;
        /* Two-finger pan on a phone-sized canvas loses the robot
         * off-screen too easily; rotate + pinch-zoom stay. */
        controls.enablePan = window.innerWidth >= 768;
        controls.minDistance = span * 0.4;
        controls.maxDistance = span * 6;

        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.9));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(span, -span * 0.7, span * 1.6);
        key.castShadow = true;
        key.shadow.mapSize.set(studio?2048:1024,studio?2048:1024);
        key.shadow.camera.left=-span*1.5;key.shadow.camera.right=span*1.5;
        key.shadow.camera.top=span*1.5;key.shadow.camera.bottom=-span*1.5;
        key.shadow.camera.near=0.01;key.shadow.camera.far=span*8;
        key.shadow.normalBias=0.001;key.shadow.bias=-0.0001;
        key.shadow.camera.updateProjectionMatrix();
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x3fe4db, 1.4);
        rim.position.set(-span, span, span * 0.6);
        scene.add(rim);
        const fill=new THREE.DirectionalLight(0x7d9bff,0.8);
        fill.position.set(-span,-span,span*0.5);scene.add(fill);

        const ground = new THREE.Mesh(
          new THREE.CircleGeometry(span * 1.5, 96),
          new THREE.MeshStandardMaterial({
            color: 0x102132,
            roughness: 0.58,
            metalness:0.35,
          }),
        );
        ground.receiveShadow = true;
        ground.position.z=-0.003;
        scene.add(ground);
        /* Soft floor glow past the stage disk, fading into the background,
         * so the stage reads as lit floor rather than a coin in space. */
        const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=256;
        const gctx=glowCanvas.getContext('2d');
        if(gctx){
          const g=gctx.createRadialGradient(128,128,0,128,128,128);
          g.addColorStop(0,'rgba(36,159,158,0.22)');g.addColorStop(0.45,'rgba(16,33,50,0.55)');g.addColorStop(1,'rgba(8,19,33,0)');
          gctx.fillStyle=g;gctx.fillRect(0,0,256,256);
        }
        const glowTex=new THREE.CanvasTexture(glowCanvas);glowTex.colorSpace=THREE.SRGBColorSpace;
        const floorGlow=new THREE.Mesh(new THREE.PlaneGeometry(span*5,span*5),new THREE.MeshBasicMaterial({map:glowTex,transparent:true,depthWrite:false}));
        floorGlow.position.z=-0.005;scene.add(floorGlow);
        const stageRing=new THREE.Mesh(new THREE.RingGeometry(span*1.3,span*1.305,128),new THREE.MeshBasicMaterial({color:0x249f9e,transparent:true,opacity:0.45,depthWrite:false}));
        stageRing.position.z=-0.002;scene.add(stageRing);
        const grid = new THREE.PolarGridHelper(
          span,
          12,
          6,
          48,
          0x28465b,
          0x193044,
        );
        grid.rotation.x = Math.PI / 2;
        grid.position.z = 0.001;
        scene.add(grid);

        const materials: Session['materials'] = {};
        const pickMeshes: THREE_NS.Mesh[] = [];
        const groups: THREE_NS.Group[] = [];
        units.forEach((u) => {
          if (!materials[u.part]) {
            materials[u.part] = new THREE.MeshPhysicalMaterial({
              color: PALETTE[u.part] || 0x167f83,
              roughness: u.part==='wheel'?0.9:0.38,
              metalness: u.part==='wheel'?0.05:0.45,
              clearcoat:0.25,
              clearcoatRoughness:0.3,
            });
          }
          const g = new THREE.Group();
          u.meshes.forEach((m) => {
            let geo: THREE_NS.BufferGeometry;
            if (m.kind === 'box') geo = new RoundedBoxGeometry(m.size[0],m.size[1],m.size[2],studio?3:1,Math.min(...m.size)*0.12);
            else if (m.kind === 'cyl')
              geo = new THREE.CylinderGeometry(m.size[0], m.size[0], m.size[1], 28);
            else geo = new THREE.SphereGeometry(m.size[0], 24, 18);
            const mesh = new THREE.Mesh(geo, materials[u.part]);
            if (m.kind === 'cyl' && m.axis === 'z')
              mesh.rotation.x = Math.PI / 2;
            if (m.rot) mesh.rotation.set(m.rot[0], m.rot[1], m.rot[2]);
            mesh.position.set(m.center[0], m.center[1], m.center[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.part = u.part;
            const component=renderInstances.find(c=>c.id===u.part);
            if(component){
              mesh.castShadow=false;
              addComponentSkin(THREE,mesh,componentById(component.componentId)!.sizeM,component.componentId);
            }
            if (m.kind === 'box') {
              const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(geo),
                new THREE.LineBasicMaterial({
                  color: EDGE[u.part] || 0x9aa3ae,
                  transparent: true,
                  opacity: 0.6,
                }),
              );
              mesh.add(edges);
            }
            g.add(mesh);
            pickMeshes.push(mesh);
          });
          g.userData = { part: u.part, explode: u.explode, target: new THREE.Vector3() };
          const old = previous.find(p=>p.id===u.part);
          const current = renderInstances.find(p=>p.id===u.part);
          if(current){
            if(old) g.position.set(...current.positionM.map((v,i)=>old.positionM[i]-v) as [number,number,number]);
            else g.position.z=0.06;
          }
          if(current){
            const part=componentById(current.componentId)!;
            const tray=new THREE.Group();
            const material=new THREE.MeshBasicMaterial({color:0x5eead4,wireframe:true,transparent:true,opacity:0.5});
            const plate=new THREE.Mesh(new THREE.BoxGeometry(part.sizeM[0]+0.008,part.sizeM[1]+0.008,0.003),material);
            plate.position.z=-part.sizeM[2]/2-0.005;tray.add(plate);
            for(const x of [-1,1])for(const y of [-1,1]){
              const support=new THREE.Mesh(new THREE.CylinderGeometry(0.002,0.002,0.01,8),material);
              support.rotation.x=Math.PI/2;support.position.set(x*(part.sizeM[0]/2+0.002),y*(part.sizeM[1]/2+0.002),-part.sizeM[2]/2);
              tray.add(support);
            }
            tray.position.set(...current.positionM);tray.rotation.z=current.yawDeg*Math.PI/180;
            tray.visible=false;g.add(tray);g.userData.tray=tray;
            const haloRadius=Math.hypot(part.sizeM[0],part.sizeM[1])*0.56;
            const halo=new THREE.Mesh(new THREE.RingGeometry(haloRadius,haloRadius+0.0015,96),new THREE.MeshBasicMaterial({color:new THREE.Color(0.25,1.8,1.6),transparent:true,opacity:0.6,depthWrite:false,side:THREE.DoubleSide}));
            halo.position.set(current.positionM[0],current.positionM[1],current.positionM[2]-part.sizeM[2]/2-0.002);
            halo.visible=false;g.add(halo);g.userData.halo=halo;
          }
          scene.add(g);
          groups.push(g);
        });

        const cables: {curve: THREE_NS.CatmullRomCurve3; mesh: THREE_NS.Mesh; pulse: THREE_NS.Mesh; anchors: THREE_NS.Mesh[]; a: ComponentInstance; b: ComponentInstance; index:number; last:string}[] = [];
        for (const [index,connection] of (connections ?? []).entries()) {
          const a = instances?.find(c => c.id === connection.from);
          const b = instances?.find(c => c.id === connection.to);
          if (!a || !b) continue;
          const curve=new THREE.CatmullRomCurve3(cableControlPoints(a.positionM,b.positionM,index).map(p=>new THREE.Vector3(...p)));
          const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,32,0.0016,8,false),new THREE.MeshStandardMaterial({color:0xfbbf24,emissive:0x805000,emissiveIntensity:0.3,roughness:0.5}));
          mesh.userData.part=connection.id;
          scene.add(mesh); pickMeshes.push(mesh);
          const pulse=new THREE.Mesh(new THREE.SphereGeometry(0.003,10,8),new THREE.MeshBasicMaterial({color:new THREE.Color(3,2.3,1.1)}));
          scene.add(pulse);
          const anchors=[a,b].map(()=>{
            const anchor=new THREE.Mesh(new THREE.SphereGeometry(0.0025,10,8),new THREE.MeshBasicMaterial({color:0x5eead4}));
            anchor.userData.part=connection.id;
            scene.add(anchor);pickMeshes.push(anchor);
            return anchor;
          });
          cables.push({curve,mesh,pulse,anchors,a,b,index,last:''});
        }
        // A restrained bloom pass catches the bright cable markers and selection glow.
        let composer: import('three/addons/postprocessing/EffectComposer.js').EffectComposer|undefined;
        if(studio){
          try{
            const [{EffectComposer},{RenderPass},{UnrealBloomPass},{OutputPass}]=await Promise.all([
              import('three/addons/postprocessing/EffectComposer.js'),import('three/addons/postprocessing/RenderPass.js'),
              import('three/addons/postprocessing/UnrealBloomPass.js'),import('three/addons/postprocessing/OutputPass.js'),
            ]);
            if(disposed){
              controls.dispose();
              scene.traverse(object=>{const drawable=object as THREE_NS.Mesh;drawable.geometry?.dispose();const material=drawable.material;if(Array.isArray(material))material.forEach(m=>m.dispose());else material?.dispose();});
              renderer.dispose();environment.dispose();host.removeChild(renderer.domElement);return;
            }
            composer=new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene,camera));
            composer.addPass(new UnrealBloomPass(new THREE.Vector2(700,430),0.25,0.4,1.1));
            composer.addPass(new OutputPass());
          }catch{composer?.dispose();composer=undefined;}
        }
        const axes = new THREE.AxesHelper(span*0.4);
        scene.add(axes);
        const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
        const clock=new THREE.Clock();
        // Teardown pulls the camera back so lifted parts stay in frame, and returns it after.
        let tdDolly:THREE_NS.Vector3|null=null,tdWas=false;
        const TD_PULL=1.55;
        (controls as unknown as {addEventListener:(e:string,f:()=>void)=>void}).addEventListener('start',()=>{tdDolly=null;});
        let playStart:number|null=null,playFinished=false;
        const fovMesh=new THREE.Mesh(new THREE.ConeGeometry(1,1,32,1,true),new THREE.MeshBasicMaterial({color:0x38bdf8,transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}));
        // Cone tip at its origin, extending down local -Y; rotate toward local +X.
        fovMesh.geometry.translate(0,-0.5,0);
        const fovGroup=new THREE.Group();fovGroup.add(fovMesh);scene.add(fovGroup);
        fovGroup.visible=false;
        let dragging:{id:string;group:THREE_NS.Group;start:THREE_NS.Vector3;plane:THREE_NS.Plane;grab:THREE_NS.Vector3;position:[number,number,number];pointerId:number}|null=null;
        const abortDrag=()=>{
          if(!dragging)return;
          dragging.group.position.copy(dragging.start);
          (dragging.group.userData.target as THREE_NS.Vector3).copy(dragging.start);
          if(renderer.domElement.hasPointerCapture(dragging.pointerId))renderer.domElement.releasePointerCapture(dragging.pointerId);
          dragging=null;controls.enabled=true;
        };
        const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')abortDrag();};
        window.addEventListener('keydown',onEscape);

        const st: Session = {
          renderer,
          scene,
          camera,
          controls: controls as unknown as Session['controls'],
          materials,
          groups,
          selected: stateRef.current.selected,
          hover: null,
          explode: stateRef.current.explode,
        };
        sessionRef.current = st;

        const refresh = () => {
          Object.entries(st.materials).forEach(([part, mat]) => {
            if (part === st.selected) {
              mat.emissive.setHex(0xf59e0b);
              mat.emissiveIntensity = 0.35;
            } else if (part === st.hover) {
              mat.emissive.setHex(0xf59e0b);
              mat.emissiveIntensity = 0.15;
            } else {
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
            }
          });
        };
        const applyExplode = () => {
          const e = st.explode / 1000;
          st.groups.forEach((g) => {
            const v = g.userData.explode as [number, number, number];
            (g.userData.target as THREE_NS.Vector3).set(v[0] * e, v[1] * e, v[2] * e);
          });
        };
        st.refresh = refresh;
        st.applyExplode = applyExplode;
        applyExplode();
        refresh();

        const ray = new THREE.Raycaster();
        const ptr = new THREE.Vector2();
        const pick = (ev: PointerEvent): string | null => {
          const rect = renderer.domElement.getBoundingClientRect();
          ptr.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          ptr.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          ray.setFromCamera(ptr, camera);
          const hit = ray.intersectObjects(pickMeshes, false)[0];
          return hit ? (hit.object.userData.part as string) : null;
        };
        let downAt: [number, number] | null = null;
        const onMove = (ev: PointerEvent) => {
          if(dragging&&ev.pointerId!==dragging.pointerId)return;
          if(dragging){
            const rect=renderer.domElement.getBoundingClientRect();
            ptr.set((ev.clientX-rect.left)/rect.width*2-1,-(ev.clientY-rect.top)/rect.height*2+1);
            ray.setFromCamera(ptr,camera);
            const point=new THREE.Vector3();
            if(ray.ray.intersectPlane(dragging.plane,point)){
              const item=instances?.find(c=>c.id===dragging!.id);
              const part=item&&componentById(item.componentId);
              if(item&&part){
                point.sub(dragging.grab);
                const deck=motionRef.current.snapDeck?Number(spec.ground_clearance_m??0)+0.003:null;
                const position=snapPlacement([point.x,point.y,item.positionM[2]],0.005,deck,part.sizeM[2]);
                dragging.position=position;
                dragging.group.position.set(...position.map((v,i)=>v-item.positionM[i]) as [number,number,number]);
                (dragging.group.userData.target as THREE_NS.Vector3).copy(dragging.group.position);
              }
            }
            return;
          }
          /* Hover picking is mouse-only: on touch it just burns a
           * raycast per move during orbits. */
          if (ev.pointerType !== 'mouse') return;
          st.hover = pick(ev);
          renderer.domElement.style.cursor = st.hover ? 'pointer' : '';
          refresh();
        };
        const onDown = (ev: PointerEvent) => {
          if(motionRef.current.dragMode && ev.button===0){
            const id=pick(ev);const item=instances?.find(c=>c.id===id);
            const group=groups.find(g=>g.userData.part===id);
            if(item&&group&&ev.isPrimary){
              const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-item.positionM[2]);
              const point=new THREE.Vector3();
              if(ray.ray.intersectPlane(plane,point)){
                dragging={id:item.id,group,start:group.position.clone(),plane,grab:point.sub(new THREE.Vector3(...item.positionM)),position:[...item.positionM],pointerId:ev.pointerId};
                controls.enabled=false;renderer.domElement.setPointerCapture(ev.pointerId);
                ev.stopImmediatePropagation();cbRef.current.onSelect(item.id);return;
              }
            }
          }
          downAt = [ev.clientX, ev.clientY];
        };
        const onUp = (ev: PointerEvent) => {
          if(dragging&&ev.pointerId!==dragging.pointerId)return;
          if(dragging){
            const result=dragging;dragging=null;controls.enabled=true;
            if(renderer.domElement.hasPointerCapture(ev.pointerId))renderer.domElement.releasePointerCapture(ev.pointerId);
            ev.stopImmediatePropagation();
            result.group.position.copy(result.start);
            (result.group.userData.target as THREE_NS.Vector3).copy(result.start);
            const item=instances?.find(c=>c.id===result.id);
            if(item&&result.position.some((v,i)=>Math.abs(v-item.positionM[i])>1e-7))cbRef.current.onMove?.(result.id,result.position);
            return;
          }
          if (!downAt) return;
          const moved = Math.hypot(
            ev.clientX - downAt[0],
            ev.clientY - downAt[1],
          );
          downAt = null;
          if (moved > 10) return; // it was an orbit drag (fingertip jitter on touch runs past 5px)
          const part = pick(ev);
          if (part) cbRef.current.onSelect(part);
        };
        renderer.domElement.addEventListener('pointermove', onMove);
        renderer.domElement.addEventListener('pointerdown', onDown,true);
        renderer.domElement.addEventListener('pointercancel',abortDrag);
        renderer.domElement.addEventListener('pointerup', onUp);

        let fitted = false;
        const resize = () => {
          const w = host.clientWidth || 700;
          const viewportHeight=window.visualViewport?.height??window.innerHeight;
          const h = window.innerWidth <= 768 ? Math.max(220,Math.min(420,Math.round(viewportHeight*0.48))) : 460;
          renderer.setSize(w, h);
          composer?.setSize(w,h);
          camera.aspect = w / h;
          if (!fitted && !cameraRef.current) {
            fitted = true;
            /* Portrait viewports crop the model's width at the
             * span-derived distance: pull the camera back once,
             * before first render, until the bounding sphere fits
             * horizontally as well as vertically. */
            const r =
              0.62 *
              Math.hypot(spec.length_m, spec.width_m, spec.height_m);
            const vFit = r / Math.tan(THREE.MathUtils.degToRad(21));
            const need = Math.max(vFit, vFit / camera.aspect);
            const dist = camera.position.distanceTo(controls.target);
            if (need > dist) {
              const dir = camera.position
                .clone()
                .sub(controls.target)
                .normalize();
              camera.position
                .copy(controls.target)
                .addScaledVector(dir, need);
              controls.maxDistance = Math.max(controls.maxDistance, need * 1.6);
            }
          }
          camera.updateProjectionMatrix();
        };
        resize();
        let ro: ResizeObserver | null = null;
        if (window.ResizeObserver) {
          ro = new ResizeObserver(resize);
          ro.observe(host);
        }
        window.addEventListener('resize', resize);
        window.visualViewport?.addEventListener('resize',resize);

        renderer.setAnimationLoop(() => {
          const delta=Math.min(clock.getDelta(),0.05);
          const effects=motionRef.current.animate&&!reducedMotion.matches;
          const settings=motionRef.current;
          if(!settings.playing){playStart=null;playFinished=false;}
          else if(playStart===null)playStart=clock.elapsedTime;
          const progress=settings.playing?(effects?Math.min(1,(clock.elapsedTime-(playStart??0))/2):1):settings.replay;
          if(settings.playing&&progress>=1&&!playFinished){playFinished=true;cbRef.current.onPlaybackEnd?.();}
          const tdNow=Boolean(settings.teardown);
          if(tdNow!==tdWas){
            tdWas=tdNow;
            tdDolly=camera.position.clone().sub(controls.target).multiplyScalar(tdNow?TD_PULL:1/TD_PULL).add(controls.target);
          }
          if(tdDolly){
            if(effects)camera.position.lerp(tdDolly,1-Math.exp(-delta*4));else camera.position.copy(tdDolly);
            if(camera.position.distanceTo(tdDolly)<span*0.002)tdDolly=null;
          }
          for(const g of groups){
            if(dragging?.group===g)continue;
            const target=(g.userData.target as THREE_NS.Vector3).clone();
            const current=renderInstances.find(c=>c.id===g.userData.part);
            const old=comparison?.find(c=>c.id===g.userData.part);
            if(current&&old){
              target.add(new THREE.Vector3(...old.positionM.map((v,i)=>(v-current.positionM[i])*(1-progress)) as [number,number,number]));
              const yaw=shortestYaw(old.yawDeg,current.yawDeg,progress)*Math.PI/180;
              for(const child of g.children)if(child instanceof THREE.Mesh)child.rotation.z=yaw;
              (g.userData.tray as THREE_NS.Group).rotation.z=yaw;
            }
            g.visible=!current || (instances?.some(c=>c.id===current.id)?(old?true:progress>0.001):progress<0.999);
            if(g.userData.tray)(g.userData.tray as THREE_NS.Group).visible=settings.ghostMount&&g.userData.part===st.selected;
            const halo=g.userData.halo as THREE_NS.Mesh|undefined;
            if(halo){halo.visible=g.userData.part===st.selected;(halo.material as THREE_NS.MeshBasicMaterial).opacity=effects?0.55+Math.sin(clock.elapsedTime*2.5)*0.12:0.6;}
            const td=settings.teardown;
            if(td&&td.removed.includes(g.userData.part)){
              // Lift the part off and out along its own explode direction.
              const v=g.userData.explode as [number,number,number];
              const h=Math.hypot(v[0],v[1]);
              const out=h>0?span*0.5*Math.min(1,h)/h:0;
              if(v[2]<0&&h===0){
                // Parts that drop out from underneath (a drone's battery) slide out sideways
                // instead, clear of the parts above them and of the floor.
                target.add(new THREE.Vector3(0,-span*0.6,0));
              }else{
                target.add(new THREE.Vector3(v[0]*out,v[1]*out,v[2]<0?0:span*0.22));
              }
            }
            if(effects) g.position.lerp(target,1-Math.exp(-delta*(td?6:12))); else g.position.copy(target);
          }
          for(const [id,material] of Object.entries(materials)){
            const isComponent=Boolean(instances?.some(c=>c.id===id));
            material.transparent=isComponent||(motionRef.current.xray&&!isComponent);
            material.opacity=isComponent?(motionRef.current.collisionIds.includes(id)?0.3:0.10):(material.transparent?0.18:1);
            const td=motionRef.current.teardown;
            if(td&&!isComponent){
              const newest=td.removed[td.removed.length-1];
              let o=1;
              if(td.isolate) o=id===td.isolate?1:0.07;
              else if(td.removed.includes(id)&&id!==newest) o=0.28;
              if(o<1){material.transparent=true;material.opacity=Math.min(material.opacity,o);}
            }
            material.depthWrite=!material.transparent;
            if(motionRef.current.collisionIds.includes(id)){
              material.color.setHex(0xef4444);material.emissive.setHex(0x7f1111);
            }else material.color.setHex(PALETTE[id]||0x167f83);
            if(id===st.selected&&effects) material.emissiveIntensity=0.3+Math.sin(clock.elapsedTime*3)*0.1;
          }
          const focused=renderInstances.find(c=>c.id===st.selected);
          fovGroup.visible=Boolean(settings.fov&&focused);
          if(settings.fov&&focused){
            const group=groups.find(g=>g.userData.part===focused.id);
            const old=comparison?.find(c=>c.id===focused.id);
            const yaw=shortestYaw(old?.yawDeg??focused.yawDeg,focused.yawDeg,progress)*Math.PI/180;
            fovGroup.visible=Boolean(group?.visible);
            fovGroup.position.set(...focused.positionM).add(group?.position??new THREE.Vector3());
            fovGroup.rotation.z=yaw+Math.PI/2;
            const radius=Math.tan(settings.fov.angleDeg*Math.PI/360)*settings.fov.rangeM;
            fovMesh.scale.set(radius,settings.fov.rangeM,radius);
          }
          for(const cable of cables){
            const offset=(id:string)=>groups.find(g=>g.userData.part===id)?.position ?? new THREE.Vector3();
            const a=new THREE.Vector3(...cable.a.positionM).add(offset(cable.a.id));
            const b=new THREE.Vector3(...cable.b.positionM).add(offset(cable.b.id));
            // Visual anchor proxies at envelope tops, not documented connector locations.
            a.z+=(componentById(cable.a.componentId)?.sizeM[2]??0)/2+0.002;
            b.z+=(componentById(cable.b.componentId)?.sizeM[2]??0)/2+0.002;
            cable.anchors[0].position.copy(a);cable.anchors[1].position.copy(b);
            const material=cable.mesh.material as THREE_NS.MeshStandardMaterial;
            material.emissiveIntensity=st.selected===cable.mesh.userData.part?0.9:0.3;
            const signature=[...a.toArray(),...b.toArray()].map(v=>v.toFixed(5)).join(',');
            if(signature!==cable.last){
              cable.curve.points=cableControlPoints(a.toArray() as [number,number,number],b.toArray() as [number,number,number],cable.index).map(p=>new THREE.Vector3(...p));
              cable.curve.updateArcLengths();
              cable.mesh.geometry.dispose();
              cable.mesh.geometry=new THREE.TubeGeometry(cable.curve,32,0.0016,8,false);
              cable.last=signature;
            }
            const endpointsVisible=groups.find(g=>g.userData.part===cable.a.id)?.visible&&groups.find(g=>g.userData.part===cable.b.id)?.visible;
            cable.mesh.visible=Boolean(endpointsVisible);
            cable.anchors.forEach(anchor=>anchor.visible=Boolean(endpointsVisible));
            cable.pulse.visible=effects&&Boolean(endpointsVisible);
            if(effects) cable.pulse.position.copy(cable.curve.getPoint(animationPhase(clock.elapsedTime,cable.index)));
          }
          controls.autoRotate=Boolean(settings.autoRotate)&&!reducedMotion.matches&&!dragging;
          controls.autoRotateSpeed=1.4;
          controls.update();
          if(composer)composer.render(delta);else renderer.render(scene, camera);
        });

        cleanup = () => {
          renderer.setAnimationLoop(null);
          if (ro) ro.disconnect();
          window.removeEventListener('resize', resize);
          window.visualViewport?.removeEventListener('resize',resize);
          renderer.domElement.removeEventListener('pointermove', onMove);
          renderer.domElement.removeEventListener('pointerdown', onDown,true);
          renderer.domElement.removeEventListener('pointercancel',abortDrag);
          window.removeEventListener('keydown',onEscape);
          renderer.domElement.removeEventListener('pointerup', onUp);
          cameraRef.current={position:camera.position.toArray() as [number,number,number],target:controls.target.toArray() as [number,number,number]};
          controls.dispose();
          scene.traverse(object => {
            const drawable = object as THREE_NS.Mesh;
            drawable.geometry?.dispose();
            const material = drawable.material;
            if (Array.isArray(material)) material.forEach(m => m.dispose());
            else material?.dispose();
          });
          composer?.passes.forEach(pass=>pass.dispose());composer?.dispose();
          environment.dispose();glowTex.dispose();
          renderer.dispose();
          if (renderer.domElement.parentElement === host) {
            host.removeChild(renderer.domElement);
          }
          sessionRef.current = null;
        };
        if (disposed) cleanup();
      } catch {
        if (!disposed) cbRef.current.onFail();
      }
    })();
    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, instances, connections, comparison, quality]);

  useEffect(() => {
    const st = sessionRef.current;
    if (st) {
      st.explode = explode;
      if (st.applyExplode) st.applyExplode();
    }
  }, [explode]);

  useEffect(() => {
    const st = sessionRef.current;
    if (st) {
      st.selected = selected;
      if (st.refresh) st.refresh();
    }
  }, [selected]);

  return <div ref={hostRef} role="img" aria-label="Interactive 3D robot assembly and planned cable connections" className="assembly-viewport" style={{minHeight:220}} />;
}
