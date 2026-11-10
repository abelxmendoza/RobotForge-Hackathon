'use client';
/* A 3D 360° turntable of a VEX V5 drive base (lib/vexModel3d.ts):
 * it spins on its own, drag to turn it, scroll to zoom. Rebuilds when
 * the spec's drive changes, so word edits ("make #2 faster") show up
 * in the model. Rendering pauses while it is off screen, and the
 * spin stays off for people who ask for reduced motion. Three.js is
 * imported on mount; without WebGL the box says so instead. */
import { useEffect, useRef, useState } from 'react';
import type * as T from 'three';
import { buildVexModel, disposeVexModel, vexLayout } from '@/lib/vexModel3d';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

export default function VexModel3D({ spec, label, height = 190, caption = '3D 360° · drag to turn' }: { spec: Spec; label?: string; height?: number; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const L = vexLayout(spec);
  const key = JSON.stringify([L, spec?.length_m, spec?.width_m]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let raf = 0;
    let cleanup = () => {};
    (async () => {
      try {
        const THREE = (await import('three')) as unknown as typeof T;
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
        if (disposed) return;
        const W = Math.max(host.clientWidth, 160), H = Math.max(host.clientHeight, 140);
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, H);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        host.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('role', 'img');
        renderer.domElement.setAttribute('aria-label', (label ? label + ': ' : '') + '3D 360° model of the drive base. Drag to turn it.');

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x161b23);
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        const model = buildVexModel(THREE, spec);
        scene.add(model);
        // Frame the robot from its own layout (instanced parts make a
        // bounding-box fit unreliable).
        const lay = vexLayout(spec);
        const tall = lay.mechs.includes('lift') ? 0.46 : lay.mechs.length ? 0.34 : lay.wheelD + 0.06;
        const centre = new THREE.Vector3(0, 0, tall * 0.42);
        const radius = Math.max(lay.length, lay.width, tall * 1.2) / 2 + 0.03;

        const key = new THREE.DirectionalLight(0xffffff, 1.7);
        key.position.set(radius * 3, -radius * 3, radius * 6);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        const sc = key.shadow.camera as T.OrthographicCamera;
        sc.left = sc.bottom = -radius * 2; sc.right = sc.top = radius * 2; sc.near = 0.01; sc.far = radius * 20;
        key.shadow.bias = -0.0005;
        scene.add(key, new THREE.HemisphereLight(0xdbe6ff, 0x20242b, 0.4));
        // Field tile under the robot: grey foam with a faint 2 ft grid.
        const floor = new THREE.Mesh(new THREE.CircleGeometry(radius * 3, 64), new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 0.95 }));
        floor.receiveShadow = true;
        scene.add(floor);
        const grid = new THREE.GridHelper(radius * 6, 12, 0x3b4452, 0x323946);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = 0.0005;
        scene.add(grid);

        const camera = new THREE.PerspectiveCamera(32, W / H, radius / 50, radius * 60);
        camera.up.set(0, 0, 1);
        camera.position.set(centre.x + radius * 1.9, centre.y - radius * 2.3, centre.z + radius * 1.6);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.copy(centre);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.minDistance = radius * 1.6;
        controls.maxDistance = radius * 8;
        controls.maxPolarAngle = Math.PI * 0.49;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        controls.autoRotate = !reduce;
        controls.autoRotateSpeed = 2.4;
        controls.addEventListener('start', () => { controls.autoRotate = false; });
        controls.update();

        let visible = true;
        const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); });
        io.observe(host);
        const ro = new ResizeObserver(() => {
          const w2 = host.clientWidth, h2 = host.clientHeight;
          if (!w2 || !h2) return;
          renderer.setSize(w2, h2);
          camera.aspect = w2 / h2;
          camera.updateProjectionMatrix();
        });
        ro.observe(host);
        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (!visible) return;
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        cleanup = () => {
          cancelAnimationFrame(raf);
          io.disconnect();
          ro.disconnect();
          controls.dispose();
          disposeVexModel(model);
          floor.geometry.dispose(); (floor.material as T.Material).dispose();
          grid.geometry.dispose(); (grid.material as T.Material).dispose();
          scene.environment?.dispose();
          pmrem.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
        if (disposed) cleanup();
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <figure className="vex3d">
      <div ref={hostRef} className="vex3d-stage" style={{ height }} data-testid="vex-3d">
        {failed && <p className="faint g-small vex3d-fail">3D isn’t available in this browser. The numbers below still apply.</p>}
      </div>
      <figcaption className="faint">{caption}</figcaption>
    </figure>
  );
}
