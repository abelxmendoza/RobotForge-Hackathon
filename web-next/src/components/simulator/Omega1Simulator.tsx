'use client';
/* The Omega1 simulator page (/simulator/): Omega1's 3D twin on Rapier
 * physics in a walled pen, live gauges for its four motors and its
 * HC-SR04, and a self-running tour. Every number it shows comes from
 * lib/omega1Sim.ts, which says where each one came from. The physics
 * is the Workshop's drive sandbox (lib/drivePhysics.ts) — the same
 * engine the Simulate tab runs — fed with the twin's own numbers. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDriveWorld, type SimWall } from '@/lib/drivePhysics';
import { driveInput } from '@/lib/simulation';
import { SIM_DRIVE_CMD_MPS, SIM_TURN_GAIN, driveAnalysis } from '@/lib/driveMath';
import { omega1SeedSpec } from '@/lib/omega1Garage';
import { omega1Rover, OMEGA1_PHOTO } from '@/lib/omega1Twin';
import {
  BASIS_TEXT, HC_SR04, OMEGA1_SIM_NUMBERS, OMEGA1_TOUR, PEN_HALF, PEN_WALLS, PEN_WALL_H, TOUR_STOP_M,
  headingDelta, omega1SimSpec, tourStepDone, ultrasonicRange, wheelCommands, yawDeg, type WheelCommand,
} from '@/lib/omega1Sim';
import { assetPath } from '@/components/home/asset';

type Gauges = { t: number; tripM: number; heading: number; range: number | null; wheels: WheelCommand[] };
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'];

export default function Omega1Simulator() {
  const spec = useMemo(() => omega1SimSpec(omega1SeedSpec()), []);
  const halfTrack = spec.width_m / 2 + spec.wheel.width_m / 2;
  const frontOffset = spec.length_m / 2;
  const idle = useMemo(() => wheelCommands(0, 0, halfTrack, SIM_DRIVE_CMD_MPS, SIM_TURN_GAIN), [halfTrack]);
  const host = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const [resetKey, setResetKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [modelNote, setModelNote] = useState('Loading Omega1’s twin…');
  const [error, setError] = useState('');
  const [tourIdx, setTourIdx] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [gauges, setGauges] = useState<Gauges>({ t: 0, tripM: 0, heading: 0, range: null, wheels: idle });
  const tour = useRef<{ idx: number | null; start: number; startYaw: number }>({ idx: null, start: 0, startYaw: 0 });
  const followRef = useRef(follow);
  followRef.current = follow;
  const analysis = useMemo(() => driveAnalysis({ massKg: spec.mass_kg, wheelRadiusM: spec.wheel.diameter_m / 2, wheelCount: 4, motorCount: 4, stallTorqueNm: spec.motor.stall_torque_nm }), [spec]);

  const startTour = useCallback(() => { keys.current.clear(); tour.current = { idx: 0, start: -1, startYaw: 0 }; setTourIdx(0); setResetKey((n) => n + 1); }, []);
  const stopTour = useCallback(() => { tour.current.idx = null; setTourIdx(null); }, []);
  const reset = useCallback(() => { stopTour(); keys.current.clear(); setResetKey((n) => n + 1); }, [stopTour]);

  // Keyboard driving. Any key during the tour hands control back.
  useEffect(() => {
    const norm = (k: string) => (k.startsWith('Arrow') ? k : k.toLowerCase());
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      const k = norm(e.key);
      if (!KEYS.includes(k)) return;
      e.preventDefault();
      if (tour.current.idx !== null) stopTour();
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(norm(e.key));
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); };
  }, [stopTour]);

  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined;
    setReady(false); setError('');
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (disposed || !host.current) return;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x09131e);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
      host.current.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100); camera.up.set(0, 0, 1);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
      const light = new THREE.DirectionalLight(0xffffff, 2.4); light.position.set(2, -1.5, 4); light.castShadow = true;
      light.shadow.camera.left = light.shadow.camera.bottom = -2.5; light.shadow.camera.right = light.shadow.camera.top = 2.5; light.shadow.mapSize.set(2048, 2048);
      scene.add(light, new THREE.HemisphereLight(0xe2f7ff, 0x53645c, 1.9));
      const floor = new THREE.Mesh(new THREE.BoxGeometry(PEN_HALF * 2 + 0.4, PEN_HALF * 2 + 0.4, 0.02), new THREE.MeshStandardMaterial({ color: 0x263542, roughness: 0.95 }));
      floor.position.z = -0.01; floor.receiveShadow = true; scene.add(floor);
      const grid = new THREE.GridHelper(PEN_HALF * 2, 18, 0x507080, 0x344957); grid.rotation.x = Math.PI / 2; grid.position.z = 0.001; scene.add(grid);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x66877e, roughness: 0.8 }), crateMat = new THREE.MeshStandardMaterial({ color: 0xb98a4b, roughness: 0.7 });
      const walls: SimWall[] = PEN_WALLS.map((w, i) => {
        const h = i === PEN_WALLS.length - 1 ? 0.2 : PEN_WALL_H;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w.hx * 2, w.hy * 2, h), i === PEN_WALLS.length - 1 ? crateMat : wallMat);
        m.position.set(w.x, w.y, h / 2); m.castShadow = m.receiveShadow = true; scene.add(m);
        return { x: w.x, y: w.y, z: h / 2, hx: w.hx, hy: w.hy, hz: h / 2 };
      });
      // The sensor beam: one ray, drawn.
      const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
      const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.8 }));
      scene.add(beam);
      const robot = new THREE.Group(); scene.add(robot);
      const resize = () => { if (!host.current) return; const w = host.current.clientWidth, h = host.current.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(host.current); resize();
      camera.position.set(-0.55, -0.6, 0.45); controls.target.set(0, 0, 0.06); controls.update();

      let world: Awaited<ReturnType<typeof createDriveWorld>> | undefined, raf = 0;
      const wheels: { pivot: import('three').Object3D; side: 'left' | 'right' }[] = [];
      const free = (o: import('three').Object3D) => o.traverse((c) => { const m = c as import('three').Mesh; m.geometry?.dispose(); for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) { for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as import('three').Texture).isTexture) (v as import('three').Texture).dispose(); mat.dispose(); } });
      cleanup = () => { cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); world?.free(); free(scene); renderer.dispose(); renderer.domElement.remove(); };

      try { world = await createDriveWorld(spec, 'flat', walls); } catch (e) { if (!disposed) setError((e as Error).message); return; }
      // Reset or unmount while Rapier was loading: cleanup already ran, so free this world here.
      if (disposed) { world.free(); world = undefined; return; }

      try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const model = (await new GLTFLoader().loadAsync(assetPath(omega1Rover.model))).scene;
        if (disposed) { free(model); return; }
        model.updateMatrixWorld(true);
        for (const node of [...model.children]) {
          if (!node.name.startsWith('wheel_')) continue;
          const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
          const pivot = new THREE.Group(); pivot.position.copy(c); model.add(pivot); pivot.add(node); node.position.sub(c);
          // glTF +x is Omega1's left once the model faces +x (front = +z in the model).
          wheels.push({ pivot, side: c.x > 0 ? 'left' : 'right' });
        }
        model.traverse((o) => { (o as import('three').Mesh).castShadow = true; });
        const upright = new THREE.Group(); model.rotation.x = Math.PI / 2; upright.add(model); upright.rotation.z = Math.PI / 2;
        robot.add(upright);
        setModelNote('Omega1 twin · ProjectSim model at its own scale · estimated geometry');
      } catch (e) {
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(spec.length_m, spec.width_m, spec.height_m - spec.ground_clearance_m), new THREE.MeshStandardMaterial({ color: 0x2da99c }));
        proxy.position.z = spec.ground_clearance_m + (spec.height_m - spec.ground_clearance_m) / 2; robot.add(proxy);
        setModelNote('Physics proxy · the twin model could not load: ' + (e as Error).message);
      }
      setReady(true);

      let last = performance.now(), acc = 0, simT = 0, trip = 0, px = 0, py = 0, tick = 0;
      const r = spec.wheel.diameter_m / 2;
      const cam = new THREE.Vector3(), look = new THREE.Vector3();
      let pose = { t: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
      let info: { yaw: number; range: number | null } = { yaw: 0, range: ultrasonicRange(0, 0, 0, frontOffset) };
      let input = { throttle: 0, turn: 0 };
      const tState = tour.current;
      // What to command next: the tour's current step, or the keys.
      const decide = () => {
        if (tState.idx === null) return driveInput(keys.current);
        if (tState.start < 0) { tState.start = simT; tState.startYaw = info.yaw; }
        const s = OMEGA1_TOUR[tState.idx];
        if (tourStepDone(s, { elapsedS: simT - tState.start, turnedDeg: headingDelta(tState.startYaw, info.yaw), rangeM: info.range })) {
          const next = tState.idx + 1;
          if (next >= OMEGA1_TOUR.length - 1) { tState.idx = null; setTourIdx(OMEGA1_TOUR.length - 1); return { throttle: 0, turn: 0 }; }
          tState.idx = next; tState.start = simT; tState.startYaw = info.yaw; setTourIdx(next);
        }
        const cur = OMEGA1_TOUR[tState.idx];
        return { throttle: cur.throttle, turn: cur.turn };
      };
      const frame = (now: number) => {
        if (disposed) return;
        acc = Math.min(acc + (now - last) / 1000, 4 / 60); last = now;
        let steps = 0;
        while (acc >= 1 / 60) {
          input = decide();
          pose = world!.step(input.throttle, input.turn); acc -= 1 / 60; simT += 1 / 60; steps++;
          const yaw = yawDeg(pose);
          info = { yaw, range: ultrasonicRange(pose.x, pose.y, yaw, frontOffset) };
        }
        trip += Math.hypot(pose.x - px, pose.y - py); px = pose.x; py = pose.y;
        robot.position.set(pose.x, pose.y, pose.z); robot.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
        const cmds = wheelCommands(input.throttle, input.turn, halfTrack, SIM_DRIVE_CMD_MPS, SIM_TURN_GAIN);
        const dt = steps / 60;
        for (const w of wheels) { const c = cmds.find((m) => m.id.endsWith(w.side))!; const v = (c.turning === 'stopped' ? 0 : c.turning === 'forward' ? 1 : -1) * c.effort * (SIM_DRIVE_CMD_MPS + SIM_TURN_GAIN * halfTrack); w.pivot.rotation.x += (v / r) * dt; }
        const a = (info.yaw * Math.PI) / 180, fx = Math.cos(a), fy = Math.sin(a);
        const sx = pose.x + fx * frontOffset, sy = pose.y + fy * frontOffset, len = info.range ?? HC_SR04.maxM;
        beam.position.set(sx, sy, 0.1); beam.rotation.set(0, 0, a); beam.scale.set(len, 1, 1);
        (beam.material as import('three').LineBasicMaterial).color.set(info.range !== null && info.range < TOUR_STOP_M ? 0xf87171 : 0x5eead4);
        // Camera: the tour frames each step; driving yourself, it follows.
        const touring = tState.idx !== null;
        controls.enabled = !touring;
        const mode = touring ? OMEGA1_TOUR[tState.idx!].camera : null;
        if (mode === 'chase') { cam.set(pose.x - fx * 0.75, pose.y - fy * 0.75, 0.42); look.set(pose.x + fx * 0.3, pose.y + fy * 0.3, 0.05); }
        else if (mode === 'top') { cam.set(pose.x - fx * 0.05, pose.y - fy * 0.05, 1.05); look.set(pose.x, pose.y, 0); }
        else if (mode === 'orbit') { const o = simT * 0.35; cam.set(pose.x + Math.cos(o) * 0.6, pose.y + Math.sin(o) * 0.6, 0.35); look.set(pose.x, pose.y, 0.06); }
        if (mode) { camera.position.lerp(cam, 0.06); controls.target.lerp(look, 0.12); }
        else if (followRef.current) { const dx = pose.x - controls.target.x, dy = pose.y - controls.target.y; camera.position.x += dx; camera.position.y += dy; controls.target.x += dx; controls.target.y += dy; }
        controls.update(); renderer.render(scene, camera);
        if (++tick % 6 === 0) {
          setGauges({ t: simT, tripM: trip, heading: info.yaw, range: info.range, wheels: cmds });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch((e) => { if (!disposed) setError((e as Error).message); cleanup?.(); cleanup = undefined; });
    return () => { disposed = true; cleanup?.(); };
  }, [resetKey, spec, halfTrack, frontOffset]);

  const step = tourIdx === null ? null : OMEGA1_TOUR[tourIdx];
  const touring = tour.current.idx !== null;
  const press = (k: string, on: boolean) => { if (on) { if (tour.current.idx !== null) stopTour(); keys.current.add(k); } else keys.current.delete(k); };

  return (
    <div className="o1sim">
      <header className="o1sim-head">
        <div>
          <p className="eyebrow">Omega1 simulator</p>
          <h1>Drive Omega1&apos;s digital twin</h1>
          <p className="faint">Omega1 is offline for repairs, so here is its 3D twin on real-time physics. Take the tour, or drive it yourself and watch what its motors and sensor would be doing.</p>
        </div>
        <div className="o1sim-badges"><span className="fbadge local">Browser · Rapier physics</span><span className="fbadge planned">Estimated twin</span></div>
      </header>

      <div className="o1sim-stage">
        <figure className="o1sim-scene">
          <div className="o1sim-canvas" ref={host} tabIndex={0} aria-label="Omega1 driving in a walled pen, 3D" />
          {step && (
            <div className={'o1sim-caption' + (touring ? '' : ' done')} role="status" aria-live="polite">
              <p className="o1sim-step">{tourIdx! + 1} / {OMEGA1_TOUR.length} · {step.title}</p>
              <p>{step.say}</p>
            </div>
          )}
          <figcaption>{modelNote}</figcaption>
        </figure>
        {error && <p className="g-error" role="alert">{error}</p>}

        <div className="o1sim-bar">
          {touring
            ? <button className="btn btn-primary" onClick={stopTour}>Stop the tour</button>
            : <button className="btn btn-primary" disabled={!ready} onClick={startTour}>{tourIdx === null ? '▶ Take the tour' : '▶ Tour again'}</button>}
          <button className="btn" onClick={reset}>Reset</button>
          <label className="o1sim-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Camera follows</label>
          <div className="o1sim-pad" role="group" aria-label="Drive Omega1">
            {([['ArrowLeft', 'Turn left', '←'], ['ArrowUp', 'Drive forward', '↑'], ['ArrowDown', 'Drive backward', '↓'], ['ArrowRight', 'Turn right', '→']] as const).map(([k, label, icon]) => (
              <button key={k} className="btn" aria-label={label} disabled={!ready}
                onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(k, true); }}
                onPointerUp={() => press(k, false)} onPointerCancel={() => press(k, false)} onLostPointerCapture={() => press(k, false)}
                onClick={(e) => { if (e.detail === 0) { press(k, true); setTimeout(() => press(k, false), 300); } }}>{icon}</button>
            ))}
          </div>
        </div>
        <p className="faint g-small">Drive with the arrow keys, WASD or the buttons. Drag to look around.</p>
      </div>

      <section className="o1sim-gauges" aria-label="Live gauges">
        <div className="o1sim-gauge o1sim-motors">
          <h3>Motors <span className="faint g-small">PCA9685 hat · I2C 0x40</span></h3>
          <div className="o1sim-wheels">
            {gauges.wheels.map((w) => (
              <div key={w.id} className={'o1sim-wheel ' + w.turning}>
                <span className="o1sim-wheel-name">{w.label}</span>
                <span className="o1sim-wheel-dir" aria-hidden="true">{w.turning === 'forward' ? '▲' : w.turning === 'backward' ? '▼' : '■'}</span>
                <span className="o1sim-wheel-ch">{w.channel === null ? 'off' : `ch ${w.channel}`}</span>
                <span className="o1sim-meter"><span style={{ width: `${Math.round(w.effort * 100)}%` }} /></span>
                <span className="sr-only">{w.label}: {w.turning}{w.channel !== null ? `, channel ${w.channel}` : ''}</span>
              </div>
            ))}
          </div>
          <p className="faint g-small">The channel each wheel&apos;s command lights, from Omega1&apos;s own motor table. Bars show the share of the strongest command, not speed.</p>
        </div>

        <div className="o1sim-gauge">
          <h3>HC-SR04 <span className="faint g-small">GPIO {HC_SR04.trigGpio} trig · {HC_SR04.echoGpio} echo</span></h3>
          <p className={'o1sim-big' + (gauges.range !== null && gauges.range < TOUR_STOP_M ? ' warn' : '')}>{gauges.range === null ? 'no echo' : `${Math.round(gauges.range * 100)} cm`}</p>
          <span className="o1sim-meter wide"><span style={{ width: `${gauges.range === null ? 100 : Math.round((gauges.range / HC_SR04.maxM) * 100)}%` }} /></span>
          <p className="faint g-small">Range {HC_SR04.minM * 100} cm to {HC_SR04.maxM} m (the default in Omega1&apos;s sensor code). One straight ray here; the real sensor sees a cone about 15° wide.</p>
        </div>

        <div className="o1sim-gauge">
          <h3>Heading</h3>
          <svg viewBox="-50 -50 100 100" className="o1sim-dial" role="img" aria-label={`Heading ${Math.round(gauges.heading)} degrees from the start`}>
            <circle r="44" className="ring" />
            {[0, 90, 180, 270].map((d) => <line key={d} x1="0" y1="-44" x2="0" y2="-36" className="tick" transform={`rotate(${d})`} />)}
            <line x1="0" y1="8" x2="0" y2="-34" className="needle" transform={`rotate(${-gauges.heading})`} />
            <circle r="4" className="hub" />
          </svg>
          <p className="o1sim-mid">{Math.round(gauges.heading)}° from the start</p>
        </div>

        <div className="o1sim-gauge">
          <h3>Trip</h3>
          <p className="o1sim-big">{gauges.tripM.toFixed(2)} m</p>
          <p className="faint g-small">Distance driven in the twin, {gauges.t.toFixed(0)} s of sim time. No speed is shown: the real wheel size and motor speed haven&apos;t been measured.</p>
          <h3 style={{ marginTop: 12 }}>Battery</h3>
          <p className="o1sim-mid">7.4 V nominal</p>
          <p className="faint g-small">Two 18650 cells in series. Their capacity isn&apos;t recorded, so there&apos;s no runtime estimate.</p>
        </div>
      </section>

      <section className="o1sim-sources">
        <h2>Where these numbers come from</h2>
        <p>Omega1&apos;s records say what it is (four gearmotors on a PCA9685 hat, skid steer, an HC-SR04 up front), but its size, weight and wheel have never been measured. Physics can&apos;t run without them, so this page reads them off the 3D twin and says so.</p>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Number</th><th>Value</th><th>Where it comes from</th></tr></thead>
            <tbody>
              {OMEGA1_SIM_NUMBERS.map((n) => (
                <tr key={n.path}>
                  <td>{n.label}</td>
                  <td className="num">{n.unit === 'm' ? `${Math.round(n.value * 1000)} mm` : `${n.value} ${n.unit}`}</td>
                  <td><span className={'fbadge ' + (n.basis === 'STAND_IN' ? 'planned' : 'local')}>{BASIS_TEXT[n.basis]}</span> {n.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="g-small">With these numbers, climbing a 10° ramp at steady speed asks each motor for {analysis.cases[1].torquePerMotorNm.toFixed(3)} N·m, {analysis.cases[1].pctOfStall.toFixed(0)}% of the stand-in stall torque.</p>
        <p className="faint g-small">Not used on purpose: the wheel radius (50 mm), track (200 mm) and 300 rpm defaults in Omega1&apos;s code. The repo extraction flags them as wrong-sized. When Omega1 is measured, its saved copy in the Workshop runs the same sandbox on real numbers.</p>
        <div className="o1sim-links">
          <a className="btn btn-sm" href="/explain/?robot=omega1">How does Omega1 work?</a>
          <a className="btn btn-sm" href="/film/">Watch Omega1 come apart</a>
          <a className="btn btn-sm" href="/garage/#omega1">Open Omega1 in the Workshop</a>
          <a className="btn btn-sm" href={OMEGA1_PHOTO.source} target="_blank" rel="noreferrer">The real robot&apos;s photo ↗</a>
        </div>
      </section>
    </div>
  );
}
