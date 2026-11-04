'use client';
/* The part modal's 3D views of one part, from lib/partModel3d:
 * - 'real': a lit, reflective 360° turntable (studio environment,
 *   soft shadow, filmic tone mapping). Drag to orbit, scroll to zoom.
 * - 'cad': the same geometry as an engineering view: flat grey solid,
 *   crisp edges, orthographic camera, mm grid, dimensions, view presets
 *   and an STL download.
 * One WebGL context per open view; everything is disposed on close. */
import { useEffect, useRef, useState } from 'react';
import type * as T from 'three';
import { buildPartModel, disposeModel, sizeMm, type PartShape } from '@/lib/partModel3d';

type View = 'iso' | 'front' | 'side' | 'top';

export default function PartViewer3D({ shape, mode, fileName }: { shape: PartShape; mode: 'real' | 'cad'; fileName: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ setView: (v: View) => void; exportStl: () => string | null; setSpin: (on: boolean) => void } | null>(null);
  const [failed, setFailed] = useState(false);
  const [spin, setSpin] = useState(true);
  const [view, setView] = useState<View>('iso');
  const key = shape.kind + shape.size.join(',') + mode;

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
        const W = Math.max(host.clientWidth, 200), H = Math.max(host.clientHeight, 200);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, H);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (mode === 'real') {
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.05;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
        host.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-label', mode === 'real' ? '3D 360 view of the part. Drag to turn it.' : '3D CAD view of the part. Drag to turn it.');

        const scene = new THREE.Scene();
        const model = buildPartModel(THREE, shape);
        const [l, w, h] = shape.size;
        const radius = Math.hypot(l, w, h) / 2;
        const pivot = new THREE.Group();
        pivot.add(model);
        scene.add(pivot);

        let pmrem: T.PMREMGenerator | null = null;
        const extra: T.Object3D[] = [];
        if (mode === 'real') {
          scene.background = new THREE.Color(0x1a1f27);
          pmrem = new THREE.PMREMGenerator(renderer);
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          const key = new THREE.DirectionalLight(0xffffff, 1.6);
          key.position.set(radius * 3, -radius * 4, radius * 6);
          key.castShadow = true;
          key.shadow.mapSize.set(1024, 1024);
          const sc = key.shadow.camera as T.OrthographicCamera;
          sc.left = sc.bottom = -radius * 2.5; sc.right = sc.top = radius * 2.5; sc.near = 0.001; sc.far = radius * 20;
          key.shadow.bias = -0.0005;
          scene.add(key, new THREE.HemisphereLight(0xdbe6ff, 0x20242b, 0.35));
          const ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 3.2, 64), new THREE.ShadowMaterial({ opacity: 0.38 }));
          ground.position.z = -h / 2 - 0.0005;
          ground.receiveShadow = true;
          const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 2.2, 64), new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.85, metalness: 0.1 }));
          disc.position.z = -h / 2 - 0.001;
          disc.receiveShadow = true;
          scene.add(disc, ground);
          extra.push(disc, ground);
        } else {
          scene.background = new THREE.Color(0x0d1b2a);
          scene.add(new THREE.HemisphereLight(0xffffff, 0x3b4a5c, 1.6));
          const d = new THREE.DirectionalLight(0xffffff, 0.8);
          d.position.set(1, -2, 3);
          scene.add(d);
          const solid = new THREE.MeshStandardMaterial({ color: 0xc8d3df, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
          const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b2540 });
          model.traverse((o) => {
            const m = o as T.Mesh;
            if (!m.isMesh) return;
            const old = m.material as T.Material;
            m.material = solid;
            old.dispose();
            m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edgeMat));
          });
          // mm grid under the part, 1 cm cells (5 mm for small parts)
          const cell = radius > 0.04 ? 0.01 : 0.005;
          const span = Math.ceil((radius * 3) / cell) * cell * 2;
          const grid = new THREE.GridHelper(span, Math.round(span / cell), 0x35618f, 0x1c3a5a);
          grid.rotation.x = Math.PI / 2;
          grid.position.z = -h / 2;
          scene.add(grid);
          // overall bounding box, dashed
          const bb = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(l, w, h)), new THREE.LineDashedMaterial({ color: 0x7dd3fc, dashSize: radius * 0.04, gapSize: radius * 0.03 }));
          bb.computeLineDistances();
          scene.add(bb);
          extra.push(grid, bb);
        }

        const aspect = W / H;
        const camera: T.PerspectiveCamera | T.OrthographicCamera = mode === 'real'
          ? new THREE.PerspectiveCamera(35, aspect, radius / 100, radius * 100)
          : new THREE.OrthographicCamera(-radius * 1.5 * aspect, radius * 1.5 * aspect, radius * 1.5, -radius * 1.5, -radius * 50, radius * 50);
        camera.up.set(0, 0, 1);
        const dirs: Record<View, [number, number, number]> = { iso: [1.2, -1.6, 0.95], front: [0, -1, 0.0001], side: [1, 0, 0.0001], top: [0.0001, -0.0001, 1] };
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.minDistance = radius * 1.2;
        controls.maxDistance = radius * 12;
        controls.autoRotateSpeed = 2.2;
        controls.autoRotate = mode === 'real';
        const place = (v: View) => {
          const dir = new THREE.Vector3(...dirs[v]).normalize();
          camera.position.copy(dir.multiplyScalar(radius * (mode === 'real' ? 4.4 : 6)));
          controls.target.set(0, 0, 0);
          if ((camera as T.OrthographicCamera).isOrthographicCamera) (camera as T.OrthographicCamera).zoom = 1;
          camera.updateProjectionMatrix();
          controls.update();
        };
        place('iso');
        controls.addEventListener('start', () => { controls.autoRotate = false; setSpin(false); });

        const onResize = () => {
          const w2 = host.clientWidth, h2 = host.clientHeight;
          if (!w2 || !h2) return;
          renderer.setSize(w2, h2);
          const a = w2 / h2;
          if ((camera as T.PerspectiveCamera).isPerspectiveCamera) (camera as T.PerspectiveCamera).aspect = a;
          else { const o = camera as T.OrthographicCamera; o.left = -radius * 1.5 * a; o.right = radius * 1.5 * a; }
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(host);

        const tick = () => { raf = requestAnimationFrame(tick); controls.update(); renderer.render(scene, camera); };
        tick();

        apiRef.current = {
          setView: (v) => { controls.autoRotate = false; place(v); },
          setSpin: (on) => { controls.autoRotate = on; },
          exportStl: () => {
            const lines: string[] = ['solid ' + fileName];
            const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
            model.updateMatrixWorld(true);
            model.traverse((o) => {
              const m = o as T.Mesh;
              if (!m.isMesh) return;
              const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
              const pos = g.getAttribute('position');
              for (let i = 0; i + 2 < pos.count; i += 3) {
                for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, i + k).applyMatrix4(m.matrixWorld).multiplyScalar(1000);
                n.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0])).normalize();
                lines.push(`facet normal ${n.x} ${n.y} ${n.z}`, ' outer loop', ...v.map((p) => `  vertex ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)}`), ' endloop', 'endfacet');
              }
              if (g !== m.geometry) g.dispose();
            });
            lines.push('endsolid ' + fileName);
            return lines.join('\n');
          },
        };

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          controls.dispose();
          disposeModel(model);
          extra.forEach(disposeModel);
          scene.environment?.dispose();
          pmrem?.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
          apiRef.current = null;
        };
        if (disposed) cleanup();
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => { disposed = true; cleanup(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [L, W, H] = sizeMm(shape);
  const download = () => {
    const stl = apiRef.current?.exportStl();
    if (!stl) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stl], { type: 'model/stl' }));
    a.download = fileName + '.stl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return (
    <div className={'pv3d pv3d-' + mode}>
      <div className="pv3d-stage" ref={hostRef}>
        {failed && <p className="pv3d-failed">3D needs WebGL, and this browser didn’t start it.</p>}
        {mode === 'cad' && !failed && <span className="pv3d-dims" aria-label="Overall size">{L} × {W} × {H} mm</span>}
      </div>
      <div className="pv3d-bar">
        {mode === 'real'
          ? <button type="button" className="btn btn-sm" aria-pressed={spin} onClick={() => { const on = !spin; setSpin(on); apiRef.current?.setSpin(on); }}>{spin ? 'Pause spin' : 'Spin 360°'}</button>
          : (['iso', 'front', 'side', 'top'] as View[]).map((v) => <button key={v} type="button" className="btn btn-sm" aria-pressed={view === v} onClick={() => { setView(v); apiRef.current?.setView(v); }}>{v === 'iso' ? 'Iso' : v[0].toUpperCase() + v.slice(1)}</button>)}
        <button type="button" className="btn btn-sm" onClick={download}>Download STL</button>
        <span className="faint g-small">Drag to turn · scroll to zoom</span>
      </div>
    </div>
  );
}
