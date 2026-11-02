'use client';
/* One ProjectSim twin subject in 3D (lib/omega1Twin.ts): the model
 * was generated from a photo or a text description, so everything
 * about its geometry is an ESTIMATE — the caption says so, and the
 * fallback states never dress the flat preview render up as a model.
 *
 * The explode control exists only for the whole-rover subject and
 * only moves the rover model's OWN links (chassis stays; the sensor
 * head and the four wheels slide out). The separately generated part
 * models are never fitted into the rover: they were reconstructed
 * independently and share no frame with it. */
import { useEffect, useRef, useState } from 'react';
import { assetPath } from '@/components/home/asset';
import { fitScan } from '@/lib/scan3d';
import { ROVER_LINKS, type TwinSubject } from '@/lib/omega1Twin';

export default function TwinView({ subject, explode = false }: { subject: TwinSubject; explode?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [turning, setTurning] = useState(true);
  const [spread, setSpread] = useState(0);
  const turnRef = useRef(true);
  turnRef.current = turning;
  const spreadRef = useRef(0);
  spreadRef.current = spread;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      try {
        const res = await fetch(assetPath(subject.model));
        if (disposed) return;
        if (!res.ok) { setState('missing'); return; }
        const data = await res.arrayBuffer();
        const THREE = await import('three');
        const [{ OrbitControls }, { RoomEnvironment }, { GLTFLoader }] = await Promise.all([
          import('three/addons/controls/OrbitControls.js'),
          import('three/addons/environments/RoomEnvironment.js'),
          import('three/addons/loaders/GLTFLoader.js'),
        ]);
        const gltf = await new GLTFLoader().parseAsync(data, '');
        const object = gltf.scene;
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

        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const { scale, distance } = fitScan([size.x, size.y, size.z]);
        const pivot = new THREE.Group();
        object.position.sub(centre);
        pivot.add(object);
        pivot.scale.setScalar(scale);
        scene.add(pivot);

        /* Explode prep: group the model's meshes by its own link
         * (the converter names each node "<link>__<bucket>"). The
         * chassis stays put; every other link slides away from the
         * model's centre — wheels out sideways, the sensor head up. */
        const span = Math.max(size.x, size.y, size.z) || 1;
        const movers: { obj: import('three').Object3D; dir: import('three').Vector3 }[] = [];
        if (explode) {
          const byLink = new Map<string, import('three').Mesh[]>();
          object.traverse((o) => {
            const m = o as import('three').Mesh;
            if (!m.isMesh) return;
            const link = m.name.split('__')[0];
            if ((ROVER_LINKS as readonly string[]).includes(link) && link !== 'chassis') {
              byLink.set(link, [...(byLink.get(link) ?? []), m]);
            }
          });
          for (const [link, meshes] of byLink) {
            const lb = new THREE.Box3();
            meshes.forEach((m) => lb.expandByObject(m));
            const lc = lb.getCenter(new THREE.Vector3());
            const dir = link === 'sensor_head'
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(lc.x - centre.x, 0, lc.z - centre.z);
            if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
            dir.normalize();
            meshes.forEach((m) => movers.push({ obj: m, dir }));
          }
        }

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
          const s = spreadRef.current;
          for (const mv of movers) mv.obj.position.copy(mv.dir).multiplyScalar(s * span * 0.45);
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
        if (!disposed) { setError((e as Error).message || 'This model could not be read.'); setState('error'); }
      }
    })();
    return () => { disposed = true; cleanup?.(); };
  }, [subject.id, subject.model, explode]);

  return (
    <figure className="ps-figure">
      <div className="scan-stage" ref={host} role="img" aria-label={`3D model of ${subject.name} (generated reconstruction, estimated geometry). Drag to orbit, pinch or scroll to zoom.`}>
        {state === 'loading' && <p className="faint scan-wait">Loading the model…</p>}
        {state === 'missing' && (
          <div className="scan-wait">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="twin-preview" src={assetPath(subject.preview)} alt={`Preview render of ${subject.name} from the generator`} />
            <p className="faint g-small">The 3D model file is not in this deployment yet, so this is the generator’s flat preview render — not a model you can orbit.</p>
          </div>
        )}
        {state === 'error' && <p className="g-error scan-wait" role="alert">Could not show this model: {error}</p>}
      </div>
      {state === 'ready' && (
        <div className="ps-bar">
          <button type="button" className="btn btn-sm" aria-pressed={!turning} onClick={() => setTurning((t) => !t)}>{turning ? 'Pause' : 'Turn'}</button>
          {explode && (
            <label className="twin-spread">
              <span className="faint g-small">Pull the links apart</span>
              <input type="range" min={0} max={100} value={Math.round(spread * 100)} aria-label="Explode the rover's own links" onChange={(e) => setSpread(Number(e.target.value) / 100)} />
            </label>
          )}
          <span className="faint g-small">Drag to orbit · scroll or pinch to zoom</span>
        </div>
      )}
      <figcaption className="faint g-small">
        ProjectSim reconstruction of {subject.name}. Generated from {subject.generatedFrom.charAt(0).toLowerCase() + subject.generatedFrom.slice(1)} Its shape and scale are estimates, not measurements.
      </figcaption>
    </figure>
  );
}
