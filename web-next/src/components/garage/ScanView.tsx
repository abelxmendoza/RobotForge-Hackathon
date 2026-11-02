'use client';
/* A 3D scan of the real robot (lib/scan3d.ts): shown as uploaded, on a
 * turning stage you can orbit. It is the user's own scan, not a model
 * RobotForge built, and the caption says so. */
import { useEffect, useRef, useState } from 'react';
import { readScanFile } from '@/lib/scanStore';
import { fitScan, fmtBytes, type ScanMeta } from '@/lib/scan3d';

export default function ScanView({ robotId, scan, name }: { robotId: string; scan: ScanMeta; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [points, setPoints] = useState(false);
  const [turning, setTurning] = useState(true);
  const turnRef = useRef(true);
  turnRef.current = turning;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const data = await readScanFile(robotId);
        if (disposed) return;
        if (!data) { setState('missing'); return; }
        const THREE = await import('three');
        const [{ OrbitControls }, { RoomEnvironment }] = await Promise.all([
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/environments/RoomEnvironment.js'),
        ]);
        let object: import('three').Object3D;
        if (scan.format === 'glb') {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          const gltf = await new GLTFLoader().parseAsync(data, '');
          object = gltf.scene;
        } else if (scan.format === 'obj') {
          const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
          object = new OBJLoader().parse(new TextDecoder().decode(data));
          object.traverse((o) => {
            const m = o as import('three').Mesh;
            if (m.isMesh && m.geometry && !m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
          });
        } else {
          const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
          const geo = new PLYLoader().parse(data);
          const colors = Boolean(geo.getAttribute('color'));
          if (geo.index) {
            if (!geo.getAttribute('normal')) geo.computeVertexNormals();
            object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: colors, color: colors ? 0xffffff : 0xb8c4d0, roughness: 0.8 }));
          } else {
            // No faces: a point cloud (a depth-camera cloud, or a Gaussian splat PLY).
            geo.computeBoundingBox();
            const bb = geo.boundingBox!;
            const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
            object = new THREE.Points(geo, new THREE.PointsMaterial({ size: span / 400, vertexColors: colors, color: colors ? 0xffffff : 0xb8c4d0 }));
            setPoints(true);
          }
        }
        if (disposed || !host.current) return;

        const el = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x081321);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        const env = pmrem.fromScene(room, 0.04);
        scene.environment = env.texture;
        room.dispose(); pmrem.dispose();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.8));

        // Centre the scan and fit it in a 1-unit box, whatever its units.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const { scale, distance } = fitScan([size.x, size.y, size.z]);
        const pivot = new THREE.Group();
        object.position.sub(centre);
        pivot.add(object);
        pivot.scale.setScalar(scale);
        scene.add(pivot);

        const camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.01, 100);
        camera.position.set(distance * 0.75, distance * 0.35, distance * 0.75);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.minDistance = 0.3;
        controls.maxDistance = distance * 4;

        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce) setTurning(false);
        const resize = () => {
          const w = el.clientWidth || 600;
          const h = Math.round(w * 0.75);
          renderer.setSize(w, Math.min(h, 460));
          camera.aspect = w / Math.min(h, 460);
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        renderer.setAnimationLoop(() => {
          if (turnRef.current && !reduce) pivot.rotation.y += 0.004;
          controls.update();
          renderer.render(scene, camera);
        });
        setState('ready');
        cleanup = () => {
          ro.disconnect();
          renderer.setAnimationLoop(null);
          controls.dispose();
          scene.traverse((o) => {
            const m = o as import('three').Mesh;
            m.geometry?.dispose?.();
            const mat = m.material as import('three').Material | import('three').Material[] | undefined;
            (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
          });
          env.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!disposed) { setError((e as Error).message || 'This scan could not be read.'); setState('error'); }
      }
    })();
    return () => { disposed = true; cleanup?.(); };
  }, [robotId, scan.addedAt, scan.format]);

  return (
    <figure className="ps-figure">
      <div className="scan-stage" ref={host} role="img" aria-label={`3D scan of ${name}. Drag to orbit, pinch or scroll to zoom.`}>
        {state === 'loading' && <p className="faint scan-wait">Loading the scan…</p>}
        {state === 'missing' && <p className="faint scan-wait">This scan is saved in another browser. Upload it again here to see it.</p>}
        {state === 'error' && <p className="g-error scan-wait" role="alert">Could not show this scan: {error}</p>}
      </div>
      {state === 'ready' && (
        <div className="ps-bar">
          <button type="button" className="btn btn-sm" aria-pressed={!turning} onClick={() => setTurning((t) => !t)}>{turning ? 'Pause' : 'Turn'}</button>
          <span className="faint g-small">Drag to orbit · scroll or pinch to zoom</span>
        </div>
      )}
      <figcaption className="faint g-small">
        Your own 3D scan of {name} ({scan.name}, {fmtBytes(scan.bytes)}). Kept in this browser only; Save to account does not copy it.
        {points && ' It has no surfaces, so it shows as points. For a solid model, export a mesh (GLB).'}
      </figcaption>
    </figure>
  );
}
