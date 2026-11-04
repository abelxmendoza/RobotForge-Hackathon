'use client';
import { useEffect, useRef, useState } from 'react';
import type { MountArtifact } from '@/lib/buildArtifacts';
import styles from './BuildArtifacts.module.css';

export default function PrintPreview({ mount }: { mount: MountArtifact }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed,setFailed] = useState(false);
  useEffect(() => {
    let disposed=false;
    let cleanup=()=>{};
    setFailed(false);
    void Promise.all([import('three'),import('three/examples/jsm/controls/OrbitControls.js'),import('three/examples/jsm/environments/RoomEnvironment.js'),import('@/lib/mountMesh')]).then(([THREE,{OrbitControls},{RoomEnvironment},{mountGeometry}])=>{
      if(disposed || !host.current)return;
      const el=host.current;
      const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
      renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.setClearColor(0x101c2b);
      const scene=new THREE.Scene();
      const pmrem=new THREE.PMREMGenerator(renderer);
      const room=new RoomEnvironment();
      const env=pmrem.fromScene(room,.04);
      scene.environment=env.texture;
      room.dispose();pmrem.dispose();
      const geometry=mountGeometry(mount);
      const material=new THREE.MeshStandardMaterial({color:0x35a8a1,roughness:.44,metalness:.08});
      const mesh=new THREE.Mesh(geometry,material);
      // Geometry and STL remain in mm. Display orientation matches Z-up CAD.
      mesh.rotation.x=-Math.PI/2;
      scene.add(mesh);
      const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(80,130,100);scene.add(light);
      const span=Math.max(mount.lengthMm,mount.widthMm);
      const camera=new THREE.PerspectiveCamera(38,1,.1,span*15);
      camera.position.set(span*.95,span*1.1,span*1.4);
      const controls=new OrbitControls(camera,renderer.domElement);
      controls.target.set(0,mount.thicknessMm/2,0);controls.enableDamping=true;controls.minDistance=span*.4;controls.maxDistance=span*5;
      el.appendChild(renderer.domElement);
      renderer.domElement.setAttribute('aria-label','3D mounting plate preview. Drag to rotate; scroll to zoom.');
      renderer.domElement.setAttribute('role','img');
      const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
      const observer=new ResizeObserver(resize);observer.observe(el);resize();
      let frame=0;
      const render=()=>{if(disposed)return;controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
      cleanup=()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometry.dispose();material.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();};
    }).catch(()=>{if(!disposed)setFailed(true);});
    return ()=>{disposed=true;cleanup();};
  },[mount]);
  return failed ? <p role="status">3D preview needs WebGL. The dimensioned drawing and CAD downloads remain available.</p> : <div ref={host} className={styles.preview3d}/>;
}
