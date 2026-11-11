'use client';
/* The Omega1 teardown film (/film/): Omega1's 3D twin taking itself
 * apart, one piece at a time, each with its own camera, then a full
 * explode on a turntable, back together, and a drive-out. Everything
 * on screen and every sound is a pure function of the film time in
 * lib/omega1Film.ts; this component only draws it. Time comes from
 * performance.now, so tools/capture_3d.cjs can record it frame-perfect. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  filmFrame, filmLength, filmShots, renderScore,
  type Corner, type FilmCut, type FilmPart,
} from '@/lib/omega1Film';
import { omega1Rover, OMEGA1_PHOTO, TWIN_ESTIMATE_NOTE } from '@/lib/omega1Twin';
import { assetPath } from '@/components/home/asset';

const SAMPLE_RATE = 44100;

export default function Omega1Film() {
  const host = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState<FilmCut>('full');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [sound, setSound] = useState(false);
  const total = filmLength(cut);
  const spans = useMemo(() => filmShots(cut), [cut]);
  // The clock: film time = base + (now - startedAt) while playing.
  const clock = useRef({ base: 0, startedAt: 0, playing: false, cut: 'full' as FilmCut });
  const audio = useRef<{ ctx: AudioContext | null; buffers: Partial<Record<FilmCut, AudioBuffer>>; src: AudioBufferSourceNode | null }>({ ctx: null, buffers: {}, src: null });
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const filmTime = useCallback(() => {
    const c = clock.current;
    return c.playing ? c.base + (performance.now() - c.startedAt) / 1000 : c.base;
  }, []);

  const stopAudio = useCallback(() => { try { audio.current.src?.stop(); } catch { /* already stopped */ } audio.current.src = null; }, []);
  const startAudio = useCallback((from: number) => {
    stopAudio();
    if (!soundRef.current) return;
    const a = audio.current;
    a.ctx ??= new AudioContext();
    const c = clock.current.cut;
    if (!a.buffers[c]) {
      const pcm = renderScore(c, SAMPLE_RATE);
      const b = a.ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      a.buffers[c] = b;
    }
    void a.ctx.resume();
    const src = a.ctx.createBufferSource();
    src.buffer = a.buffers[c]!; src.connect(a.ctx.destination);
    src.start(0, Math.max(0, from));
    a.src = src;
  }, [stopAudio]);

  const play = useCallback((from?: number) => {
    const c = clock.current;
    let t = from ?? c.base;
    if (t >= filmLength(c.cut) - 0.01) t = 0;
    c.base = t; c.startedAt = performance.now(); c.playing = true;
    setPlaying(true); startAudio(t);
  }, [startAudio]);
  const pause = useCallback(() => {
    const c = clock.current;
    c.base = filmTime(); c.playing = false; setPlaying(false); stopAudio();
  }, [filmTime, stopAudio]);
  const seek = useCallback((t: number) => {
    const c = clock.current;
    c.base = t; c.startedAt = performance.now();
    setTime(t);
    if (c.playing) startAudio(t);
  }, [startAudio]);
  const chooseCut = (next: FilmCut) => { clock.current.cut = next; setCut(next); seek(0); play(0); };

  // Sound toggled mid-film: start or stop the score where the picture is.
  useEffect(() => { if (clock.current.playing) { if (sound) startAudio(filmTime()); else stopAudio(); } }, [sound, startAudio, stopAudio, filmTime]);
  useEffect(() => () => { stopAudio(); void audio.current.ctx?.close(); }, [stopAudio]);

  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined;
    (async () => {
      const THREE = await import('three');
      const [{ GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/environments/RoomEnvironment.js'),
      ]);
      if (disposed || !host.current) return;
      const el = host.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a1520);
      scene.fog = new THREE.Fog(0x0a1520, 1.2, 3.2);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const env = pmrem.fromScene(room, 0.04);
      scene.environment = env.texture; room.dispose(); pmrem.dispose();
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(0.6, 1.2, 0.8); key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.1, far: 4 });
      const rim = new THREE.DirectionalLight(0x7fe9da, 1.1); rim.position.set(-0.8, 0.5, -0.9);
      scene.add(key, rim, new THREE.HemisphereLight(0xdff4ff, 0x1d2b33, 0.5));
      const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: 0x15232e, roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.203, 96), new THREE.MeshBasicMaterial({ color: 0x42d6c4, transparent: true, opacity: 0.45 }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0008; scene.add(ring);
      const grid = new THREE.GridHelper(3, 60, 0x2b4250, 0x1b2d38); grid.position.y = 0.0005; scene.add(grid);
      const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.005, 20);
      const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); };
      const observer = new ResizeObserver(resize); observer.observe(el); resize();

      const free = (o: import('three').Object3D) => o.traverse((c) => { const m = c as import('three').Mesh; m.geometry?.dispose(); for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) { for (const v of Object.values(mat)) if (v && typeof v === 'object' && (v as import('three').Texture).isTexture) (v as import('three').Texture).dispose(); mat.dispose(); } });
      let raf = 0;
      cleanup = () => { cancelAnimationFrame(raf); observer.disconnect(); free(scene); env.dispose(); renderer.dispose(); renderer.domElement.remove(); };

      const model = (await new GLTFLoader().loadAsync(assetPath(omega1Rover.model))).scene;
      if (disposed) { free(model); return; }
      model.updateMatrixWorld(true);
      model.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      const root = new THREE.Group(); root.add(model); scene.add(root);
      // One pivot per film part, at the part's own centre (wheels spin about their axle).
      const pivots: Partial<Record<FilmPart, import('three').Group>> = {};
      const home: Partial<Record<FilmPart, import('three').Vector3>> = {};
      for (const node of [...model.children]) {
        let part: FilmPart | null = null;
        const c = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
        if (node.name === 'sensor_head') part = 'head';
        // Sort wheels by where they sit: +x is Omega1's left, +z its front. The GLB's names are mirrored.
        else if (node.name.startsWith('wheel_')) part = `${c.z > 0 ? 'front' : 'rear'}_${c.x > 0 ? 'left' : 'right'}` as Corner;
        if (!part) continue;
        const pivot = new THREE.Group(); pivot.position.copy(c); model.add(pivot); pivot.add(node); node.position.sub(c);
        pivots[part] = pivot; home[part] = c.clone();
      }
      if (disposed) return;
      setReady(true);
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) play(0);

      let lastShown = -1;
      const frame = () => {
        if (disposed) return;
        const c = clock.current;
        const len = filmLength(c.cut);
        let t = filmTime();
        if (c.playing && t >= len) { c.base = len; c.playing = false; t = len; setPlaying(false); }
        const f = filmFrame(c.cut, t);
        root.position.set(0, 0, f.driveZ);
        root.rotation.y = f.yaw;
        for (const [part, pivot] of Object.entries(pivots) as [FilmPart, import('three').Group][]) {
          const o = f.offsets[part];
          pivot.position.set(home[part]!.x + o[0], home[part]!.y + o[1], home[part]!.z + o[2]);
          if (part !== 'head') pivot.rotation.x = f.wheelRoll + f.partSpin[part];
        }
        camera.position.set(...f.camera.pos);
        camera.lookAt(...f.camera.target);
        if (camera.fov !== f.camera.fov) { camera.fov = f.camera.fov; camera.updateProjectionMatrix(); }
        renderer.render(scene, camera);
        const shown = Math.round(t * 20);
        if (shown !== lastShown) { lastShown = shown; setTime(t); }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })().catch((e) => { if (!disposed) setError((e as Error).message); cleanup?.(); cleanup = undefined; });
    return () => { disposed = true; cleanup?.(); };
  }, [filmTime, play]);

  const f = filmFrame(cut, time);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="o1film">
      <header className="o1sim-head">
        <div>
          <p className="eyebrow">Omega1 teardown film</p>
          <h1>Watch Omega1 come apart</h1>
          <p className="faint">Its 3D twin takes itself apart one piece at a time, each with its own camera, then goes back together and drives off. {cut === 'full' ? `${Math.round(total)} seconds.` : `The ${Math.round(total)}-second cut, for posting.`}</p>
        </div>
        <div className="o1sim-badges"><span className="fbadge local">Rendered live in your browser</span><span className="fbadge planned">Estimated twin</span></div>
      </header>

      <figure className="o1film-scene">
        <div className="o1film-canvas" ref={host} aria-label="Omega1's 3D twin coming apart, piece by piece" role="img" />
        {!ready && !error && <p className="o1film-loading">Loading Omega1&apos;s twin…</p>}
        <div className="o1film-caption" role="status" aria-live="polite">
          <p className="o1sim-step">{f.index + 1} / {spans.length} · {f.shot.title}</p>
          <p>{f.shot.say}</p>
        </div>
      </figure>
      {error && <p className="g-error" role="alert">The twin could not load: {error}</p>}

      <div className="o1film-bar">
        <button className="btn btn-primary" disabled={!ready} onClick={() => (playing ? pause() : play())}>{playing ? 'Pause' : time >= total - 0.01 ? '▶ Play again' : '▶ Play'}</button>
        <input className="o1film-scrub" type="range" min={0} max={total} step={0.01} value={Math.min(time, total)} disabled={!ready}
          aria-label="Film time" aria-valuetext={`${fmt(time)} of ${fmt(total)}, ${f.shot.title}`}
          onChange={(e) => seek(Number(e.target.value))} />
        <span className="o1film-time">{fmt(time)} / {fmt(total)}</span>
        <div className="o1film-cuts" role="group" aria-label="Which cut">
          <button className="btn btn-sm" aria-pressed={cut === 'full'} onClick={() => chooseCut('full')}>Full · {Math.round(filmLength('full'))} s</button>
          <button className="btn btn-sm" aria-pressed={cut === 'short'} onClick={() => chooseCut('short')}>Short · {Math.round(filmLength('short'))} s</button>
        </div>
        <label className="o1sim-follow"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound</label>
      </div>

      <ol className="o1film-shots" aria-label="Shots">
        {spans.map(({ shot, start }, i) => (
          <li key={shot.id}>
            <button className={'chip' + (i === f.index ? ' on' : '')} aria-current={i === f.index ? 'step' : undefined} disabled={!ready}
              onClick={() => { seek(start); if (!playing) play(start); }}>{fmt(start)} · {shot.title}</button>
          </li>
        ))}
      </ol>

      <section className="o1sim-sources">
        <h2>What you&apos;re watching</h2>
        <p>{TWIN_ESTIMATE_NOTE} The film only moves the twin&apos;s own six pieces. The Pi, the motor hat and the cells aren&apos;t separate pieces in it, so the film names them on the deck instead of pulling out parts it would have to invent.</p>
        <p className="faint g-small">The channel numbers and sensor pins in the captions come from Omega1&apos;s own code (docs/omega1/omega1.extracted.json). The drive-out shows no speed: Omega1&apos;s wheel size and motor speed have never been measured. The score is synthesised in your browser from the same timeline as the picture.</p>
        <div className="o1sim-links">
          <a className="btn btn-sm" href="/simulator/">Drive the twin yourself</a>
          <a className="btn btn-sm" href="/explain/?robot=omega1">How does Omega1 work?</a>
          <a className="btn btn-sm" href="/garage/#omega1">Open Omega1 in the Workshop</a>
          <a className="btn btn-sm" href={OMEGA1_PHOTO.source} target="_blank" rel="noreferrer">The real robot&apos;s photo ↗</a>
        </div>
      </section>
    </div>
  );
}
