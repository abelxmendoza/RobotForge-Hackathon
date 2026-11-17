'use client';
/* The build guide's 3D view: the starter rover as far as the current
 * step has got, with this step's new parts outlined. Spins slowly until
 * touched; drag to look around. */
import { useEffect, useRef, useState } from 'react';
import { PIECE_STAGE, type BoardId, type PieceId, type Step } from '@/lib/buildGuide';
import { buildRover, type RoverModel } from './roverModel';

export default function StepStage({ board, step, hover }: { board: BoardId; step: Step; hover: PieceId[] }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ show(step: Step, hover: PieceId[]): void } | null>(null);
  const [error, setError] = useState('');
  const latest = useRef({ step, hover });
  latest.current = { step, hover };

  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined;
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (disposed || !host.current) return;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0e1b28);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
      host.current.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20); camera.up.set(0, 0, 1);
      camera.position.set(0.5, -0.48, 0.38);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, 0.06); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.8;
      controls.maxPolarAngle = Math.PI * 0.49; controls.minDistance = 0.18; controls.maxDistance = 1.4;
      controls.addEventListener('start', () => { controls.autoRotate = false; });
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(0.6, -0.4, 1.2); sun.castShadow = true;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -0.4; sun.shadow.camera.right = sun.shadow.camera.top = 0.4; sun.shadow.mapSize.set(1024, 1024);
      scene.add(sun, new THREE.HemisphereLight(0xe6f4ff, 0x3a4a44, 1.6));
      const mat = new THREE.MeshStandardMaterial({ color: 0x18303a, roughness: 1 });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), mat); floor.receiveShadow = true; scene.add(floor);
      const grid = new THREE.GridHelper(1.2, 24, 0x2c5560, 0x1f3a44); grid.rotation.x = Math.PI / 2; grid.position.z = 0.0005; scene.add(grid);

      const model: RoverModel = buildRover(THREE, board);
      scene.add(model.root);
      const outlines: import('three').BoxHelper[] = [];
      let explodeNow = 0, explodeGoal = 0, pulse = 0;
      const show = (s: Step, hov: PieceId[]) => {
        for (const [id, objs] of Object.entries(model.pieces) as [PieceId, import('three').Object3D[]][]) {
          const on = PIECE_STAGE[id] <= s.stage;
          for (const o of objs) o.visible = on;
        }
        explodeGoal = s.id === 'parts' ? 0.6 : 0;
        for (const b of outlines.splice(0)) { scene.remove(b); b.geometry.dispose(); (b.material as import('three').Material).dispose(); }
        const lit = new Set<PieceId>([...s.focus, ...hov]);
        for (const id of lit) for (const o of model.pieces[id] ?? []) {
          if (!o.visible || id === 'wires') continue;
          const b = new THREE.BoxHelper(o, 0x42d6c4); scene.add(b); outlines.push(b);
        }
      };
      api.current = { show };
      show(latest.current.step, latest.current.hover);

      const resize = () => { if (!host.current) return; const w = host.current.clientWidth, h = host.current.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); };
      const ro = new ResizeObserver(resize); ro.observe(host.current); resize();
      let raf = 0;
      const frame = () => {
        if (disposed) return;
        explodeNow += (explodeGoal - explodeNow) * 0.08; model.explode(explodeNow);
        pulse += 0.05;
        for (const b of outlines) { b.update(); (b.material as import('three').LineBasicMaterial).opacity = 0.55 + 0.45 * Math.sin(pulse); (b.material as import('three').LineBasicMaterial).transparent = true; }
        controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); model.dispose();
        for (const b of outlines) { b.geometry.dispose(); (b.material as import('three').Material).dispose(); }
        floor.geometry.dispose(); mat.dispose(); grid.dispose(); renderer.dispose(); renderer.domElement.remove(); api.current = null;
      };
    })().catch((e) => { if (!disposed) setError((e as Error).message); });
    return () => { disposed = true; cleanup?.(); };
  }, [board]);

  useEffect(() => { api.current?.show(step, hover); }, [step, hover]);

  return (
    <div className="bg-stage">
      <div className="bg-canvas" ref={host} role="img" aria-label={`3D view of the rover at step: ${typeof step.title === 'string' ? step.title : step.title[board]}`} />
      {error && <p className="g-error" role="alert">3D view unavailable: {error}</p>}
      <p className="bg-note">Illustration · drag to turn</p>
    </div>
  );
}
