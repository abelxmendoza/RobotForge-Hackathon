'use client';
/* The Demo page's broken -> fixed replay, in 3D.
 *
 * Everything on it reads one number, t (0 = the broken spec, 1 = the
 * spec the checks accepted), through replayPose() in lib/fixreplay.ts:
 * the meshes, the red fault glow, and the readouts beside the view.
 * Nothing is animated by hand. Geometry is the same kit geometry the
 * take-apart viewer draws (taGeom3d), plus a battery block whose size
 * and spot are a labeled kit assumption.
 *
 * Three.js loads on mount; without WebGL the panel says so and the
 * rest of the demo is unaffected. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import { easeInOut, replayPose, type ReplayPose } from '@/lib/fixreplay';
import type { Spec } from '@/lib/garage';

type ThreeModule = typeof THREE_NS;

const PALETTE: Record<string, number> = {
  plate: 0x8a5a17, wheel: 0x22262e, mount: 0x3d4656, caster: 0x5b6472,
  lidar: 0x22262e, camera: 0x3d4656, ultrasonic: 0x3d4656, battery: 0x2f6f9f,
};
const FAULT = 0xef4444;
const PLAY_MS = 4200;

export default function FixReplay3D({
  before,
  after,
  beforeLines,
  afterLines,
  autoplay,
  resolved = true,
}: {
  before: Spec;
  after: Spec | null; // null while the fix is still being worked out
  beforeLines: string[];
  afterLines: string[];
  autoplay: boolean;
  resolved?: boolean; // false when the loop stopped with checks still failing
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const tRef = useRef(0);
  tRef.current = t;
  const target = after ?? before;
  const targetLines = after ? afterLines : beforeLines;
  const poseArgs = useRef({ before, target, beforeLines, targetLines });
  poseArgs.current = { before, target, beforeLines, targetLines };
  const pose: ReplayPose = useMemo(
    () => replayPose(before, target, beforeLines, targetLines, t),
    [before, target, beforeLines, targetLines, t],
  );

  /* Play once by itself when the fix arrives (not under reduced motion). */
  const autoplayed = useRef(false);
  useEffect(() => {
    if (!after || !autoplay || autoplayed.current) return;
    autoplayed.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setTimeout(() => { setT(0); setPlaying(true); }, 1500);
    return () => window.clearTimeout(id);
  }, [after, autoplay]);

  /* The Play button: t follows an eased clock from 0 to 1. */
  useEffect(() => {
    if (!playing) return;
    const start = performance.now() - tRef.current * PLAY_MS;
    let raf = 0;
    const step = (now: number) => {
      const x = Math.min(1, (now - start) / PLAY_MS);
      setT(easeInOut(x));
      if (x < 1) raf = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* The scene: built once, redrawn every frame from the current pose. */
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const THREE = (await import('three')) as unknown as ThreeModule;
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        if (disposed) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        host.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const span = Math.max(before.length_m ?? 0.4, before.width_m ?? 0.3, 0.2);
        const camera = new THREE.PerspectiveCamera(38, 2, 0.01, 30);
        camera.up.set(0, 0, 1);
        camera.position.set(span * 0.95, -span * 1.12, span * 0.72);
        const home = camera.position.clone();
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, (before.height_m ?? 0.2) * 0.3);
        controls.enableDamping = true;
        controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        controls.autoRotateSpeed = 0.6;
        let touched = false;
        controls.addEventListener('start', () => { controls.autoRotate = false; touched = true; });
        scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x1a1d24, 1.4));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(span * 2, -span * 1.5, span * 3);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        const sc = key.shadow.camera;
        sc.left = -span * 1.5; sc.right = span * 1.5; sc.top = span * 1.5; sc.bottom = -span * 1.5;
        sc.near = 0.01; sc.far = span * 10;
        scene.add(key);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.ShadowMaterial({ opacity: 0.35 }));
        floor.receiveShadow = true;
        scene.add(floor);
        const grid = new THREE.GridHelper(span * 4, 20, 0x3a4250, 0x262b34);
        grid.rotation.x = Math.PI / 2;
        scene.add(grid);

        const geos = {
          box: new THREE.BoxGeometry(1, 1, 1),
          cyl: new THREE.CylinderGeometry(1, 1, 1, 40),
          sphere: new THREE.SphereGeometry(1, 28, 18),
        };
        const faultColor = new THREE.Color(FAULT);
        type Slot = { wrap: THREE_NS.Object3D; mesh: THREE_NS.Mesh; mat: THREE_NS.MeshStandardMaterial };
        let slots: Slot[][] = [];
        let signature = '';
        const root = new THREE.Group();
        scene.add(root);
        const build = (p: ReplayPose) => {
          slots.flat().forEach((s) => { root.remove(s.wrap); s.mat.dispose(); });
          slots = p.units.map((u) => u.meshes.map((m) => {
            const mat = new THREE.MeshStandardMaterial({ color: PALETTE[u.part] ?? 0x51606f, roughness: 0.55, metalness: 0.2 });
            const mesh = new THREE.Mesh(geos[m.kind], mat);
            mesh.castShadow = true;
            const wrap = new THREE.Object3D();
            wrap.add(mesh);
            root.add(wrap);
            return { wrap, mesh, mat };
          }));
          signature = p.units.map((u) => u.part + u.meshes.map((m) => m.kind).join('')).join('|');
        };
        const apply = (p: ReplayPose, time: number) => {
          const sig = p.units.map((u) => u.part + u.meshes.map((m) => m.kind).join('')).join('|');
          if (sig !== signature) build(p);
          const pulse = 0.55 + 0.45 * Math.sin(time * 5);
          p.units.forEach((u, i) => u.meshes.forEach((m, j) => {
            const s = slots[i][j];
            s.wrap.position.set(...m.center);
            s.wrap.rotation.set(...(m.rot ?? [0, 0, 0]));
            s.mesh.rotation.set(0, 0, 0);
            if (m.kind === 'box') s.mesh.scale.set(m.size[0], m.size[1], m.size[2]);
            else if (m.kind === 'sphere') s.mesh.scale.setScalar(Math.max(m.size[0], 1e-4));
            else {
              // Three's cylinder runs along local Y.
              s.mesh.scale.set(m.size[0], Math.max(m.size[1], 1e-4), m.size[0]);
              if (m.axis === 'z') s.mesh.rotation.x = Math.PI / 2;
              else if (m.axis === 'x') s.mesh.rotation.z = Math.PI / 2;
            }
            s.mat.emissive.copy(faultColor);
            s.mat.emissiveIntensity = u.glow * pulse * 0.7;
          }));
        };

        const resize = () => {
          const w = host.clientWidth || 640;
          const h = Math.max(240, Math.min(400, Math.round(w * 0.56)));
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          // Narrow views pull the camera back so the whole robot stays in frame.
          if (!touched) {
            const k = Math.max(1, 1.6 / camera.aspect);
            camera.position.copy(home).sub(controls.target).multiplyScalar(k).add(controls.target);
          }
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(host);
        const clock = new THREE.Clock();
        let raf = 0;
        const frame = () => {
          raf = requestAnimationFrame(frame);
          const a = poseArgs.current;
          apply(replayPose(a.before, a.target, a.beforeLines, a.targetLines, tRef.current), clock.getElapsedTime());
          controls.update();
          renderer.render(scene, camera);
        };
        frame();
        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          controls.dispose();
          slots.flat().forEach((s) => s.mat.dispose());
          Object.values(geos).forEach((g) => g.dispose());
          renderer.dispose();
          host.removeChild(renderer.domElement);
        };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => { disposed = true; cleanup?.(); };
    // The scene is rebuilt only if the robot itself changes size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before.length_m, before.width_m, before.height_m]);

  const label = pose.endpoint === 'broken' ? 'Broken spec, as loaded' : pose.endpoint === 'fixed' ? (resolved ? 'Fixed spec, as checked' : 'Proposed fix, checks still fail') : 'In between (illustration)';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const errs = (lines: string[]) => lines.filter((l) => l.startsWith('[ERROR]')).length;
  const warns = (lines: string[]) => lines.filter((l) => l.startsWith('[WARN]')).length;
  const lines = pose.endpoint === 'fixed' ? targetLines : beforeLines;

  return (
    <section className="fixreplay" aria-label="Broken to fixed, in 3D">
      <div className="fixreplay-stage">
        {failed ? (
          <p className="faint fixreplay-fallback">3D isn’t available in this browser. The panels below show the same before and after.</p>
        ) : (
          <div ref={hostRef} className="fixreplay-canvas" />
        )}
        <span className={'fixreplay-tag ' + (pose.endpoint === 'fixed' && !resolved ? 'broken' : pose.endpoint ?? 'mid')}>{label}</span>
      </div>
      <div className="fixreplay-side">
        {pose.readouts.map((r) => (
          <div key={r.id} className={'fixreplay-gauge ' + (r.ok ? 'ok' : 'bad')}>
            <div className="fixreplay-gauge-head">
              <span>{r.label}</span>
              <strong>{r.value}</strong>
            </div>
            <div className="fixreplay-bar" aria-hidden="true">
              <span className="band" style={{ left: r.band[0] * 100 + '%', width: (r.band[1] - r.band[0]) * 100 + '%' }} />
              <span className="fill" style={{ width: r.frac * 100 + '%' }} />
            </div>
            <div className="faint g-small">{r.ok ? 'PASS' : 'FAIL'} · {r.limit}</div>
          </div>
        ))}
        <div className="fixreplay-gauge tally">
          <div className="fixreplay-gauge-head">
            <span>Engineering checks</span>
            <strong>{pose.endpoint === null ? '…' : `${plural(errs(lines), 'error')} · ${plural(warns(lines), 'warning')}`}</strong>
          </div>
          <div className="faint g-small">Run only on the two real ends, never on the in-between frames.</div>
        </div>
        <div className="fixreplay-controls">
          <button type="button" className="btn btn-primary" disabled={!after || playing} onClick={() => { setT(0); setPlaying(true); }}>
            {after ? (playing ? 'Playing…' : 'Play the fix') : 'Waiting for the fix…'}
          </button>
          <label className="fixreplay-scrub">
            <span className="faint g-small">Broken</span>
            <input
              type="range" min={0} max={1000} value={Math.round(t * 1000)} disabled={!after}
              aria-label="Scrub from broken to fixed"
              onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }}
            />
            <span className="faint g-small">{resolved ? 'Fixed' : 'Proposed'}</span>
          </label>
        </div>
        <p className="faint g-small">
          Red marks the parts a failing check points at. Only the two ends are real designs; the motion
          between them is interpolated for illustration. Battery block size and spot are a kit assumption.
        </p>
      </div>
    </section>
  );
}
