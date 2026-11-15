'use client';
/* The build guide's last step: the starter rover in a 3 × 3 m arena on
 * the Workshop's Rapier drive sandbox. Drive it by hand, or switch to
 * Auto and it runs the obstacle avoider (lib/buildGuide.ts's autopilot,
 * the same steps and numbers as the sketch). Side panels: the controls
 * and serial monitor, the arena editor, and the code walkthrough. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDriveWorld } from '@/lib/drivePhysics';
import { driveInput } from '@/lib/simulation';
import {
  ARENA_HALF, AUTO, BOARDS, DEFAULT_ARENA, SONAR_MIN_TOP_M, arenaSolids, avoiderSketch, createAutopilot, parseArena, serializeArena,
  sidesToInput, sonarCm, starterRoverSpec, type ArenaBox, type BoardId, type FlowId,
} from '@/lib/buildGuide';
import { yawDeg } from '@/lib/omega1Sim';
import { buildRover, setLed, SONAR_X, WHEEL_R } from './roverModel';
import ArenaEditor from './ArenaEditor';
import { FlowChart, FlowCode } from './CodeWalk';

const ARENA_KEY = 'rf.buildguide.arena.v1';
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'];
type Mode = 'manual' | 'auto';
type Live = { cm: number; servo: number; led: boolean; buzzer: boolean; node: FlowId | null; trail: FlowId[]; x: number; y: number; heading: number };

function loadArena(): ArenaBox[] {
  try { return parseArena(localStorage.getItem(ARENA_KEY)) ?? DEFAULT_ARENA; } catch { return DEFAULT_ARENA; }
}

export default function DriveLab({ board }: { board: BoardId }) {
  const spec = useMemo(() => starterRoverSpec(), []);
  const code = useMemo(() => avoiderSketch(board), [board]);
  const host = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const [arena, setArena] = useState<ArenaBox[]>(DEFAULT_ARENA);
  const [applied, setApplied] = useState<ArenaBox[]>(DEFAULT_ARENA);
  const [resetKey, setResetKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'drive' | 'arena' | 'code'>('drive');
  const [mode, setMode] = useState<Mode>('manual');
  const [speed, setSpeed] = useState(70);
  const [head, setHead] = useState(90);
  const [led, setLedOn] = useState(false);
  const [beep, setBeep] = useState(false);
  const [sound, setSound] = useState(true);
  const [follow, setFollow] = useState(true);
  const [picked, setPicked] = useState<FlowId | null>(null);
  const [followFlow, setFollowFlow] = useState(true);
  const [serial, setSerial] = useState<string[]>([]);
  const [live, setLive] = useState<Live>({ cm: AUTO.NO_ECHO_CM, servo: 90, led: false, buzzer: false, node: null, trail: [], x: 0, y: 0, heading: 0 });
  const ctl = useRef({ mode, speed, head, led, beep, sound, follow });
  ctl.current = { mode, speed, head, led, beep, sound, follow };

  // The saved arena, once, after mount (localStorage is per viewer).
  useEffect(() => { const a = loadArena(); setArena(a); setApplied(a); }, []);
  useEffect(() => { try { localStorage.setItem(ARENA_KEY, serializeArena(arena)); } catch { /* private mode: not saved */ } }, [arena]);

  const log = useCallback((lines: string[], t: number) => {
    if (!lines.length) return;
    const stamp = `[${t.toFixed(1).padStart(5)} s] `;
    setSerial((s) => [...s, ...lines.map((l) => stamp + l)].slice(-80));
  }, []);

  useEffect(() => {
    const norm = (k: string) => (k.startsWith('Arrow') ? k : k.toLowerCase());
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable],[role=application]')) return;
      const k = norm(e.key);
      if (k === ' ') { e.preventDefault(); keys.current.clear(); setMode('manual'); return; }
      if (!KEYS.includes(k)) return;
      e.preventDefault(); keys.current.add(k); if (ctl.current.mode === 'auto') setMode('manual');
    };
    const up = (e: KeyboardEvent) => keys.current.delete(norm(e.key));
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); };
  }, []);

  // A fresh autopilot each time Auto starts.
  const pilot = useRef<ReturnType<typeof createAutopilot> | null>(null);
  const simNow = useRef(0);
  useEffect(() => {
    if (mode === 'auto') { pilot.current = createAutopilot(simNow.current * 1000); log(['Auto: obstacle avoider running'], simNow.current); }
    else if (pilot.current) { pilot.current = null; log(['Manual'], simNow.current); }
  }, [mode, log]);

  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined;
    setReady(false); setError('');
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (disposed || !host.current) return;
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b1622);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
      host.current.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50); camera.up.set(0, 0, 1);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
      const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(1.5, -1, 3); sun.castShadow = true;
      sun.shadow.camera.left = sun.shadow.camera.bottom = -2; sun.shadow.camera.right = sun.shadow.camera.top = 2; sun.shadow.mapSize.set(2048, 2048);
      scene.add(sun, new THREE.HemisphereLight(0xe2f2ff, 0x4a5a50, 1.7));
      const disposables: { dispose(): void }[] = [];
      const keep = <X extends { dispose(): void }>(x: X) => { disposables.push(x); return x; };
      const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2)), keep(new THREE.MeshStandardMaterial({ color: 0x23453d, roughness: 0.95 })));
      floor.receiveShadow = true; scene.add(floor);
      const grid = new THREE.GridHelper(ARENA_HALF * 2, 12, 0x3f7468, 0x2e5a50); grid.rotation.x = Math.PI / 2; grid.position.z = 0.001; scene.add(grid); disposables.push(grid);
      const solids = arenaSolids(applied);
      const tones: Record<ArenaBox['tone'], number> = { card: 0xc9965a, wood: 0xa8743f, blue: 0x4f86c6 };
      const wallMat = keep(new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 }));
      solids.forEach((s, i) => {
        const m = new THREE.Mesh(keep(new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2)), s.wall ? wallMat : keep(new THREE.MeshStandardMaterial({ color: tones[applied[i - 4].tone], roughness: 0.85 })));
        m.position.set(s.x, s.y, s.z); m.castShadow = m.receiveShadow = true; scene.add(m);
      });
      const beamGeo = keep(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]));
      const beamMat = keep(new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.85 }));
      const beam = new THREE.Line(beamGeo, beamMat); scene.add(beam);
      const car = new THREE.Group(); scene.add(car);
      const model = buildRover(THREE, board); car.add(model.root);
      const resize = () => { if (!host.current) return; const w = host.current.clientWidth, h = host.current.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); };
      const ro = new ResizeObserver(resize); ro.observe(host.current); resize();
      camera.position.set(-1.0, -1.1, 0.95); controls.target.set(0, 0, 0.05); controls.update();

      let world: Awaited<ReturnType<typeof createDriveWorld>> | undefined, raf = 0;
      let audio: AudioContext | null = null, osc: OscillatorNode | null = null;
      const buzz = (on: boolean) => {
        if (on && !osc && ctl.current.sound) {
          try { audio ??= new AudioContext(); osc = audio.createOscillator(); const g = audio.createGain(); g.gain.value = 0.04; osc.frequency.value = 2300; osc.type = 'square'; osc.connect(g).connect(audio.destination); osc.start(); } catch { osc = null; }
        } else if (!on && osc) { try { osc.stop(); } catch { /* already stopped */ } osc = null; }
      };
      cleanup = () => { cancelAnimationFrame(raf); buzz(false); audio?.close().catch(() => {}); ro.disconnect(); controls.dispose(); world?.free(); model.dispose(); for (const d of disposables) d.dispose(); renderer.dispose(); renderer.domElement.remove(); };

      try { world = await createDriveWorld(spec, 'flat', solids); } catch (e) { if (!disposed) setError((e as Error).message); return; }
      if (disposed) { world.free(); world = undefined; return; }
      setReady(true);
      setSerial([`Starter rover · ${BOARDS[board].name} · simulated`, `Serial @ 115200 baud`, `HC-SR04, SG90 and L9110S ready`]);

      // A rebuilt world restarts the clock at 0: a running autopilot starts over on it.
      if (pilot.current) pilot.current = createAutopilot(0);
      let last = performance.now(), acc = 0, simT = 0, nextTick = 0, tick = 0;
      let pose = { t: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
      let servo = 90, cm = AUTO.NO_ECHO_CM, input = { throttle: 0, turn: 0 };
      let out: ReturnType<NonNullable<typeof pilot.current>['tick']> | null = null;
      const cam = new THREE.Vector3();
      const frame = (now: number) => {
        if (disposed) return;
        acc = Math.min(acc + (now - last) / 1000, 4 / 60); last = now;
        const c = ctl.current;
        while (acc >= 1 / 60) {
          const yaw = yawDeg(pose), a = (yaw * Math.PI) / 180;
          const target = c.mode === 'auto' ? (out?.servo ?? 90) : c.head;
          servo += Math.sign(target - servo) * Math.min(Math.abs(target - servo), 400 / 60); // SG90: about 0.1 s per 60°
          cm = sonarCm(pose.x + Math.cos(a) * SONAR_X, pose.y + Math.sin(a) * SONAR_X, yaw + servo - 90, solids);
          if (c.mode === 'auto' && pilot.current) {
            // The sketch loops about every 20 ms (its delay(20) plus a reading).
            while (simT * 1000 >= nextTick) { out = pilot.current.tick(nextTick, cm); nextTick += 20; if (out.log.length) log(out.log, simT); }
            input = out ? sidesToInput(out.left, out.right) : { throttle: 0, turn: 0 };
          } else {
            out = null; nextTick = simT * 1000;
            const k = driveInput(keys.current), s = c.speed / 100;
            input = { throttle: k.throttle * s, turn: k.turn * s };
          }
          pose = world!.step(input.throttle, input.turn); acc -= 1 / 60; simT += 1 / 60;
        }
        simNow.current = simT;
        const yaw = yawDeg(pose), a = (yaw * Math.PI) / 180;
        car.position.set(pose.x, pose.y, pose.z - 0.0); car.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
        model.head.rotation.z = ((servo - 90) * Math.PI) / 180;
        const ledOn = c.mode === 'auto' ? !!out?.led : c.led, buzOn = c.mode === 'auto' ? !!out?.buzzer : c.beep;
        setLed(model, ledOn); buzz(buzOn);
        // Wheels turn with their side's command (looks only; physics moves the car).
        const sides = { left: input.throttle - input.turn, right: input.throttle + input.turn };
        for (const w of model.wheels) w.obj.rotation.y += (sides[w.side] * 0.3 / WHEEL_R) / 60;
        const ha = a + ((servo - 90) * Math.PI) / 180;
        beam.position.set(pose.x + Math.cos(a) * SONAR_X, pose.y + Math.sin(a) * SONAR_X, 0.112); beam.rotation.set(0, 0, ha);
        beam.scale.set(Math.min(cm, 400) / 100, 1, 1); beamMat.color.set(cm < AUTO.STOP_CM ? 0xf87171 : 0x5eead4);
        if (c.follow) { const dx = pose.x - controls.target.x, dy = pose.y - controls.target.y; cam.copy(camera.position); camera.position.set(cam.x + dx, cam.y + dy, cam.z); controls.target.x += dx; controls.target.y += dy; }
        controls.update(); renderer.render(scene, camera);
        if (++tick % 6 === 0) setLive({ cm, servo, led: ledOn, buzzer: buzOn, node: out?.node ?? null, trail: out?.trail ?? [], x: pose.x, y: pose.y, heading: yaw });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch((e) => { if (!disposed) setError((e as Error).message); cleanup?.(); cleanup = undefined; });
    return () => { disposed = true; cleanup?.(); };
  }, [resetKey, applied, board, spec, log]);

  const press = (k: string, on: boolean) => { if (on) { keys.current.add(k); if (mode === 'auto') setMode('manual'); } else keys.current.delete(k); };
  const reset = () => { setMode('manual'); keys.current.clear(); setResetKey((n) => n + 1); };
  const dirty = serializeArena(arena) !== serializeArena(applied);
  const showNode = followFlow && mode === 'auto' && live.node ? live.node : picked ?? 'drive';

  return (
    <div className="bg-lab">
      <figure className="bg-lab-scene">
        <div className="bg-lab-canvas" ref={host} tabIndex={0} aria-label="The starter rover in its arena, 3D" />
        <div className="bg-hud" aria-live="off">
          <span><i>Distance</i><b className={live.cm < AUTO.STOP_CM ? 'warn' : ''}>{live.cm >= AUTO.NO_ECHO_CM ? 'no echo' : `${live.cm.toFixed(1)} cm`}</b></span>
          <span><i>Mode</i><b>{mode === 'auto' ? 'AUTO' : 'MANUAL'}</b></span>
          <span><i>Head</i><b>{Math.round(live.servo)}°</b></span>
          {live.led && <span className="bg-hud-led" aria-label="LED on" />}
        </div>
        <figcaption>Browser physics (Rapier) · typical kit numbers, not measured · one-ray sensor</figcaption>
      </figure>
      {error && <p className="g-error" role="alert">{error}</p>}

      <div className="bg-lab-side">
        <div className="bg-tabs" role="tablist" aria-label="Simulator panels">
          {(['drive', 'arena', 'code'] as const).map((p) => (
            <button key={p} role="tab" aria-selected={panel === p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>
              {p === 'drive' ? 'Drive' : p === 'arena' ? 'Arena' : 'Code'}
            </button>
          ))}
        </div>

        {panel === 'drive' && (
          <div className="bg-panel" role="tabpanel">
            <div className="bg-seg" role="radiogroup" aria-label="Mode">
              <button role="radio" aria-checked={mode === 'manual'} className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>Manual</button>
              <button role="radio" aria-checked={mode === 'auto'} className={mode === 'auto' ? 'on' : ''} disabled={!ready} onClick={() => setMode('auto')}>Auto</button>
              <button className="bg-stop" onClick={() => { keys.current.clear(); setMode('manual'); }}>Stop</button>
            </div>
            <div className="bg-pad" role="group" aria-label="Drive">
              {([['ArrowUp', 'Forward', '↑', 'up'], ['ArrowLeft', 'Turn left', '←', 'left'], ['ArrowDown', 'Backward', '↓', 'down'], ['ArrowRight', 'Turn right', '→', 'right']] as const).map(([k, label, icon, area]) => (
                <button key={k} className={'btn bg-pad-' + area} aria-label={label} disabled={!ready}
                  onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(k, true); }}
                  onPointerUp={() => press(k, false)} onPointerCancel={() => press(k, false)} onLostPointerCapture={() => press(k, false)}>{icon}</button>
              ))}
            </div>
            <label className="bg-slider"><span>Speed</span><input type="range" min={20} max={100} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><output>{speed}%</output></label>
            <label className="bg-slider"><span>Head</span><input type="range" min={0} max={180} value={head} disabled={mode === 'auto'} onChange={(e) => setHead(Number(e.target.value))} /><output>{head}°</output></label>
            <div className="bg-row">
              <button className={'btn btn-sm' + (led ? ' on' : '')} aria-pressed={led} disabled={mode === 'auto'} onClick={() => setLedOn(!led)}>LED</button>
              <button className="btn btn-sm" disabled={mode === 'auto'} onPointerDown={() => setBeep(true)} onPointerUp={() => setBeep(false)} onPointerLeave={() => setBeep(false)}>Beep</button>
              <button className="btn btn-sm" onClick={reset}>Reset car</button>
            </div>
            <div className="bg-row g-small">
              <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Camera follows</label>
              <label><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Buzzer sound</label>
            </div>
            <p className="faint g-small">Arrows or WASD drive · Space stops</p>
            <div className="bg-serial" aria-label="Serial monitor" role="log">
              <div className="bg-serial-head"><b>Serial monitor</b><button className="btn btn-sm" onClick={() => setSerial([])}>Clear</button></div>
              <pre>{serial.join('\n')}</pre>
            </div>
          </div>
        )}

        {panel === 'arena' && (
          <div className="bg-panel" role="tabpanel">
            <ArenaEditor boxes={arena} onChange={setArena} car={{ x: live.x, y: live.y, heading: live.heading }} />
            <div className="bg-row">
              <button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => { setApplied(arena); setMode('manual'); }}>Drive in this arena</button>
              <button className="btn btn-sm" onClick={() => setArena(DEFAULT_ARENA)}>Default boxes</button>
              <button className="btn btn-sm" onClick={() => setArena([])}>Empty</button>
            </div>
            <p className="faint g-small">3 × 3 m floor. Boxes under {SONAR_MIN_TOP_M * 100} cm tall slip under the sensor’s beam. Saved in this browser.</p>
          </div>
        )}

        {panel === 'code' && (
          <div className="bg-panel" role="tabpanel">
            <div className="bg-row g-small">
              <label><input type="checkbox" checked={followFlow} onChange={(e) => setFollowFlow(e.target.checked)} /> Follow the car in Auto</label>
              {mode !== 'auto' && <button className="btn btn-sm" disabled={!ready} onClick={() => setMode('auto')}>Start Auto</button>}
            </div>
            <FlowChart live={mode === 'auto' ? live.node : null} trail={mode === 'auto' ? live.trail : []} picked={showNode} onPick={(id) => { setPicked(id); setFollowFlow(false); }} />
            <FlowCode code={code} id={showNode} file={`rover_avoid_${board}.ino`} />
          </div>
        )}
      </div>
    </div>
  );
}
