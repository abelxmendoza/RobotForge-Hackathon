'use client';
/* The wiring as physical parts on a bench (Abel, 2026-11-01: "3d render
 * animate ... the physical electronics in wiring and use the take apart
 * skill").
 *
 * Every part and cable comes from the spec's own `wiring` block: one
 * object per node, one cable per connection. What is NOT from the data
 * is the look of each part: shapes are generic stand-ins picked from the
 * part's type (battery, board, motor, lidar…), not manufacturer CAD, and
 * sizes are not to scale. The caption says so.
 *
 *  - Layout: columns by supply depth (battery on the left), rows in spec
 *    order, the same placement rule as the 2D schematic (wiring.ts).
 *  - Power on: cables light stage by stage outward from the battery;
 *    each part's status light turns green when a power feed reaches it,
 *    red if that feed is a recorded over-voltage; the lidar puck spins
 *    and motor hubs turn once powered. Data links pulse teal.
 *  - Take apart: parts lift off one at a time, outside-in (sensors, then
 *    motors, boards, power), cables stretching after them; the battery
 *    stays on the bench. Put back reverses it.
 *
 * Three.js loads on mount; without WebGL the bench says so and the 2D
 * schematic below still works. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import {
  badConns, depths, layout, nodeMap, nodeStatus, role, shortLabel, stageOf, volts,
  type Wiring,
} from '@/lib/wiring';

type Kind = 'battery' | 'regulator' | 'driver' | 'board' | 'motor' | 'lidar' | 'camera' | 'sensor' | 'other';

/* Generic shape family from the part's role sentence (wiring.ts role()). */
export function kindOf(w: Wiring, id: string): Kind {
  const r = role(w, id);
  if (r === 'the battery' || r === 'the power supply') return 'battery';
  if (r.includes('regulator')) return 'regulator';
  if (r.includes('driver') || r.includes('ESC') || r.includes('distribution')) return 'driver';
  if (r.includes('lidar')) return 'lidar';
  if (r.includes('camera')) return 'camera';
  if (r.includes('motor')) return 'motor';
  if (r.includes('IMU') || r.includes('ultrasonic')) return 'sensor';
  if (r.includes('controller') || r.includes('computer') || r.includes('board') || r.includes('microcontroller')) return 'board';
  return 'other';
}

/* Take-apart order: outside-in, the battery (power source) stays. */
const OFF_ORDER: Kind[] = ['lidar', 'camera', 'sensor', 'motor', 'other', 'board', 'driver', 'regulator', 'battery'];
export function benchTeardown(w: Wiring): { steps: string[]; core: string | null } {
  const ids = w.nodes.map((n) => n.id);
  const ordered = [...ids].sort((a, b) => OFF_ORDER.indexOf(kindOf(w, a)) - OFF_ORDER.indexOf(kindOf(w, b)));
  if (ordered.length <= 1) return { steps: [], core: ordered[0] ?? null };
  return { steps: ordered.slice(0, -1), core: ordered[ordered.length - 1] };
}

/* How many units a label names: "DC gearmotors ×2" → 2 (max 4 drawn). */
function countOf(label: string): number {
  const m = label.match(/[×x]\s*(\d+)/i);
  return m ? Math.max(1, Math.min(4, Number(m[1]))) : 1;
}

export default function WiringBench3D({ wiring }: { wiring: Wiring }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [powered, setPowered] = useState(false);
  const [off, setOff] = useState(0);
  const [playing, setPlaying] = useState<0 | 1 | -1>(0);
  const [spin, setSpin] = useState(false);
  const [labels, setLabels] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const wiringKey = useMemo(() => JSON.stringify(wiring), [wiring]);
  const td = useMemo(() => benchTeardown(wiring), [wiring]);
  const nodes = useMemo(() => nodeMap(wiring), [wiring]);
  const stateRef = useRef({ powered, off, spin, labels, selected, steps: td.steps });
  stateRef.current = { powered, off, spin, labels, selected, steps: td.steps };
  const selectRef = useRef(setSelected);

  /* Step the take-apart while playing. */
  useEffect(() => {
    if (!playing) return;
    const end = playing > 0 ? td.steps.length : 0;
    if (off === end) { setPlaying(0); return; }
    const t = setTimeout(() => setOff((n) => n + playing), off === (playing > 0 ? 0 : td.steps.length) ? 300 : 1300);
    return () => clearTimeout(t);
  }, [playing, off, td.steps.length]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        const { CSS2DRenderer, CSS2DObject } = await import('three/addons/renderers/CSS2DRenderer.js');
        const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        host.appendChild(renderer.domElement);
        const labelRenderer = new CSS2DRenderer();
        labelRenderer.domElement.className = 'wb-labels';
        host.appendChild(labelRenderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x081321);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        scene.environment = pmrem.fromScene(room, 0.04).texture;
        room.dispose(); pmrem.dispose();

        /* Layout: wiring.ts's schematic grid, mapped onto the bench (Y up). */
        const L = layout(wiring);
        const depth = depths(wiring);
        const bad = badConns(wiring);
        const GX = 0.2, GZ = 0.15;
        const raw = wiring.nodes.map((n) => L.pos[n.id]);
        const xs = raw.map((p) => p.x / 208), zs = raw.map((p) => p.y / 94);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const home: Record<string, THREE_NS.Vector3> = {};
        wiring.nodes.forEach((n, i) => { home[n.id] = new THREE.Vector3((xs[i] - cx) * GX, 0, (zs[i] - cz) * GZ); });
        const spanX = (Math.max(...xs) - Math.min(...xs)) * GX + 0.25;
        const spanZ = (Math.max(...zs) - Math.min(...zs)) * GZ + 0.2;
        const span = Math.max(spanX, spanZ, 0.35);

        const camera = new THREE.PerspectiveCamera(38, 2, 0.01, 20);
        camera.position.set(span * 0.45, span * 0.66, span * 0.86);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.02, 0);
        controls.enableDamping = true;
        controls.enablePan = window.innerWidth >= 768;
        controls.minDistance = span * 0.3;
        controls.maxDistance = span * 4;
        controls.maxPolarAngle = Math.PI * 0.48;

        scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.8));
        const key = new THREE.DirectionalLight(0xffffff, 2.0);
        key.position.set(span * 0.6, span * 1.4, span * 0.5);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.01, far: span * 6 });
        key.shadow.camera.updateProjectionMatrix();
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x3fe4db, 1.0);
        rim.position.set(-span, span * 0.6, -span);
        scene.add(rim);

        /* The bench: a dark mat with a faint grid. */
        const mat = new THREE.Mesh(new THREE.BoxGeometry(spanX + 0.12, 0.01, spanZ + 0.12),
          new THREE.MeshStandardMaterial({ color: 0x0f2233, roughness: 0.85, metalness: 0.1 }));
        mat.position.y = -0.005; mat.receiveShadow = true; scene.add(mat);
        const grid = new THREE.GridHelper(Math.max(spanX, spanZ) + 0.12, 24, 0x1f4a5a, 0x16313f);
        (grid.material as THREE_NS.Material).transparent = true; (grid.material as THREE_NS.Material).opacity = 0.35;
        grid.position.y = 0.0005; scene.add(grid);

        const disposables: { dispose(): void }[] = [];
        const std = (color: number, o: Partial<THREE_NS.MeshStandardMaterialParameters> = {}) => {
          const m = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, ...o });
          disposables.push(m); return m;
        };
        const add = (g: THREE_NS.Object3D, geo: THREE_NS.BufferGeometry, m: THREE_NS.Material, x = 0, y = 0, z = 0) => {
          disposables.push(geo);
          const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
          g.add(mesh); return mesh;
        };
        const pcb = std(0x1f6f4a, { roughness: 0.6 });
        const chip = std(0x15181d, { roughness: 0.4 });
        const metal = std(0xb8c0c8, { metalness: 0.9, roughness: 0.3 });
        const header = std(0x22262c);

        interface Part { id: string; group: THREE_NS.Group; top: number; led: THREE_NS.Mesh; spinner: THREE_NS.Object3D[]; kind: Kind; label: THREE_NS.Object3D }
        const parts: Part[] = [];
        for (const n of wiring.nodes) {
          const kind = kindOf(wiring, n.id);
          const g = new THREE.Group();
          g.userData.part = n.id;
          const spinner: THREE_NS.Object3D[] = [];
          let top = 0.03;
          if (kind === 'battery') {
            add(g, new THREE.BoxGeometry(0.11, 0.032, 0.045), std(0x2b3440, { roughness: 0.35 }), 0, 0.016, 0);
            add(g, new THREE.BoxGeometry(0.112, 0.012, 0.047), std(0xf59e0b, { roughness: 0.4 }), 0, 0.02, 0);
            add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.012, 12), std(0xd23b3b), 0.035, 0.038, 0.012);
            add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.012, 12), std(0x111111), 0.035, 0.038, -0.012);
            top = 0.04;
          } else if (kind === 'regulator') {
            add(g, new THREE.BoxGeometry(0.045, 0.003, 0.025), pcb, 0, 0.0015, 0);
            add(g, new THREE.CylinderGeometry(0.007, 0.007, 0.008, 16), std(0x3a3f47), -0.008, 0.007, 0);
            add(g, new THREE.BoxGeometry(0.009, 0.004, 0.009), chip, 0.01, 0.005, 0);
            top = 0.012;
          } else if (kind === 'driver') {
            add(g, new THREE.BoxGeometry(0.05, 0.003, 0.04), pcb, 0, 0.0015, 0);
            for (let i = -2; i <= 2; i++) add(g, new THREE.BoxGeometry(0.003, 0.014, 0.03), metal, i * 0.007, 0.01, 0);
            add(g, new THREE.BoxGeometry(0.044, 0.006, 0.006), header, 0, 0.006, 0.017);
            top = 0.018;
          } else if (kind === 'board') {
            add(g, new THREE.BoxGeometry(0.085, 0.003, 0.056), std(0x1d5c3a, { roughness: 0.6 }), 0, 0.0015, 0);
            add(g, new THREE.BoxGeometry(0.016, 0.004, 0.016), chip, -0.01, 0.005, 0);
            add(g, new THREE.BoxGeometry(0.05, 0.007, 0.005), header, 0, 0.0065, -0.024);
            add(g, new THREE.BoxGeometry(0.015, 0.012, 0.013), metal, 0.033, 0.009, 0.012);
            add(g, new THREE.BoxGeometry(0.015, 0.012, 0.013), metal, 0.033, 0.009, -0.006);
            top = 0.016;
          } else if (kind === 'motor') {
            const k = countOf(n.label);
            for (let i = 0; i < k; i++) {
              const z = (i - (k - 1) / 2) * 0.038;
              const can = add(g, new THREE.CylinderGeometry(0.014, 0.014, 0.05, 24), std(0x9aa3ae, { metalness: 0.8, roughness: 0.3 }), 0, 0.015, z);
              can.rotation.z = Math.PI / 2;
              const gear = add(g, new THREE.BoxGeometry(0.024, 0.026, 0.026), std(0xd9b44a, { metalness: 0.4 }), 0.035, 0.015, z);
              void gear;
              const hub = new THREE.Group(); hub.position.set(0.052, 0.015, z);
              const disc = add(hub, new THREE.CylinderGeometry(0.009, 0.009, 0.004, 6), std(0xeeeeee, { metalness: 0.6 }));
              disc.rotation.z = Math.PI / 2;
              g.add(hub); spinner.push(hub);
            }
            top = 0.032;
          } else if (kind === 'lidar') {
            add(g, new THREE.CylinderGeometry(0.035, 0.037, 0.014, 32), std(0x1c2026), 0, 0.007, 0);
            const puck = new THREE.Group(); puck.position.y = 0.022;
            add(puck, new THREE.CylinderGeometry(0.026, 0.026, 0.016, 32), std(0x2a2f37, { metalness: 0.5 }));
            add(puck, new THREE.BoxGeometry(0.012, 0.008, 0.004), std(0xff4d4d, { emissive: 0x661111 }), 0, 0, 0.026);
            g.add(puck); spinner.push(puck);
            top = 0.034;
          } else if (kind === 'camera') {
            add(g, new THREE.BoxGeometry(0.025, 0.003, 0.024), pcb, 0, 0.0015, 0);
            const lens = add(g, new THREE.CylinderGeometry(0.006, 0.007, 0.01, 20), chip, 0, 0.008, 0);
            void lens;
            top = 0.016;
          } else if (kind === 'sensor') {
            add(g, new THREE.BoxGeometry(0.045, 0.003, 0.02), std(0x1b4d8f), 0, 0.0015, 0);
            add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 20), metal, -0.012, 0.009, 0);
            add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 20), metal, 0.012, 0.009, 0);
            top = 0.018;
          } else {
            add(g, new THREE.BoxGeometry(0.04, 0.02, 0.03), std(0x3d4656), 0, 0.01, 0);
            top = 0.022;
          }
          /* Status light: grey until power reaches the part. */
          const ledMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, emissive: 0x000000, roughness: 0.3 });
          disposables.push(ledMat);
          const led = add(g, new THREE.SphereGeometry(0.0055, 14, 14), ledMat, 0, top + 0.006, 0);
          const div = document.createElement('div');
          div.className = 'wb-label';
          div.textContent = shortLabel(n);
          div.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectRef.current(n.id); });
          const label = new CSS2DObject(div);
          label.position.set(0, top + 0.022, 0);
          g.add(label);
          g.position.copy(home[n.id]);
          scene.add(g);
          parts.push({ id: n.id, group: g, top, led, spinner, kind, label });
        }

        /* Cables: real tubes that sag between parts and follow them when they lift. */
        interface Cable { i: number; from: Part; to: Part; mesh: THREE_NS.Mesh; mat: THREE_NS.MeshStandardMaterial; pulse: THREE_NS.Mesh; stage: number; power: boolean; bad: boolean; curve: THREE_NS.CatmullRomCurve3; sig: string }
        const cables: Cable[] = [];
        wiring.connections.forEach((c, i) => {
          const from = parts.find((p) => p.id === c.from), to = parts.find((p) => p.id === c.to);
          if (!from || !to) return;
          const power = c.kind === 'power';
          const color = power ? 0xd23b3b : 0x2fbfae;
          const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.05, roughness: 0.5 });
          disposables.push(m);
          const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
          const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
          mesh.castShadow = true; mesh.userData.cable = i;
          scene.add(mesh);
          const pm = new THREE.MeshBasicMaterial({ color: power ? 0xffd27a : 0x9ff5ea });
          disposables.push(pm);
          const pulse = new THREE.Mesh(new THREE.SphereGeometry(power ? 0.0045 : 0.0035, 10, 10), pm);
          pulse.visible = false; scene.add(pulse);
          cables.push({ i, from, to, mesh, mat: m, pulse, stage: stageOf(wiring, depth, i), power, bad: bad.has(i), curve, sig: '' });
        });
        /* Parallel cables between the same two parts fan out sideways. */
        const pairSeen: Record<string, number> = {};
        const fan = cables.map((c) => { const k = [c.from.id, c.to.id].sort().join('|'); const n = pairSeen[k] ?? 0; pairSeen[k] = n + 1; return n; });

        const ray = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const onPick = (ev: PointerEvent) => {
          const r = renderer.domElement.getBoundingClientRect();
          ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
          ray.setFromCamera(ndc, camera);
          const hit = ray.intersectObjects(parts.map((p) => p.group), true)[0];
          let o: THREE_NS.Object3D | null = hit?.object ?? null;
          while (o && !o.userData.part) o = o.parent;
          selectRef.current(o ? String(o.userData.part) : null);
        };
        let downAt = { x: 0, y: 0 };
        const onDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
        const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) onPick(e); };
        renderer.domElement.addEventListener('pointerdown', onDown);
        renderer.domElement.addEventListener('pointerup', onUp);

        const resize = () => {
          const w = host.clientWidth || 600;
          const h = Math.max(260, Math.min(460, Math.round(w * 0.55)));
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = h + 'px';
          labelRenderer.setSize(w, h);
          camera.aspect = w / h; camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize); ro.observe(host);

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
        const clock = new THREE.Clock();
        let poweredAt: number | null = null;
        const STAGE_S = 0.7;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        renderer.setAnimationLoop(() => {
          const dt = Math.min(clock.getDelta(), 0.05);
          const t = clock.elapsedTime;
          const st = stateRef.current;
          const still = reduced.matches;
          if (st.powered && poweredAt === null) poweredAt = t;
          if (!st.powered) poweredAt = null;
          const since = poweredAt === null ? -1 : (still ? 999 : t - poweredAt);
          const removed = new Set(st.steps.slice(0, st.off));
          const newest = st.off > 0 ? st.steps[st.off - 1] : null;

          /* Which parts have a lit power feed, and is any feed bad. */
          const lit = new Map<string, 'ok' | 'bad'>();
          if (since >= 0) {
            lit.set(wiring.nodes.find((n) => n.id === 'battery') ? 'battery' : wiring.nodes[0].id, 'ok');
            for (const c of cables) {
              if (!c.power || since < c.stage * STAGE_S) continue;
              if (c.bad) lit.set(c.to.id, 'bad');
              else if (!lit.has(c.to.id)) lit.set(c.to.id, 'ok');
            }
          }

          parts.forEach((p) => {
            const target = home[p.id].clone();
            const idx = st.steps.indexOf(p.id);
            if (removed.has(p.id)) {
              /* Lift off and back, fanned out so lifted parts don't stack. */
              target.y += 0.1 + idx * 0.04;
              target.z -= 0.07;
            }
            if (still) p.group.position.copy(target); else p.group.position.lerp(target, 1 - Math.exp(-dt * 6));
            const tilt = removed.has(p.id) && !still ? Math.sin(t * 1.3 + idx) * 0.08 : 0;
            p.group.rotation.z += (tilt - p.group.rotation.z) * Math.min(1, dt * 4);
            const dim = removed.has(p.id) && p.id !== newest;
            p.group.traverse((o) => {
              const mm = (o as THREE_NS.Mesh).material as THREE_NS.MeshStandardMaterial | undefined;
              if (!mm || !('opacity' in mm)) return;
              mm.transparent = dim; mm.opacity = dim ? 0.45 : 1; mm.depthWrite = !dim;
            });
            const state = lit.get(p.id);
            const ledMat = p.led.material as THREE_NS.MeshStandardMaterial;
            if (state === 'bad') { ledMat.color.setHex(0xff3b3b); ledMat.emissive.setHex(0xff2020); ledMat.emissiveIntensity = 1.2 + Math.sin(t * 10) * 0.8; }
            else if (state === 'ok') { ledMat.color.setHex(0x3dff9a); ledMat.emissive.setHex(0x22ff88); ledMat.emissiveIntensity = 1.3; }
            else { ledMat.color.setHex(0x3a4250); ledMat.emissive.setHex(0x000000); }
            if (state && !still) for (const s of p.spinner) {
              if (p.kind === 'lidar') s.rotation.y += dt * 9; else s.rotation.x += dt * 14;
            }
            const el = (p.label as unknown as { element: HTMLElement }).element;
            el.style.display = st.labels ? '' : 'none';
            el.classList.toggle('sel', st.selected === p.id);
            el.classList.toggle('bad', state === 'bad');
          });

          cables.forEach((c, k) => {
            a.copy(c.from.group.position); a.y += Math.min(c.from.top, 0.02);
            b.copy(c.to.group.position); b.y += Math.min(c.to.top, 0.02);
            const sig = a.toArray().concat(b.toArray()).map((v) => v.toFixed(4)).join(',');
            if (sig !== c.sig) {
              const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(fan[k] * 0.012);
              const mid1 = a.clone().lerp(b, 0.3).add(side); const mid2 = a.clone().lerp(b, 0.7).add(side);
              const lift = Math.max(a.y, b.y) - Math.min(a.y, b.y);
              mid1.y = Math.max(0.006, Math.min(a.y, b.y) * 0.5 + lift * 0.4 + 0.004);
              mid2.y = mid1.y;
              c.curve.points = [a.clone(), mid1, mid2, b.clone()];
              c.mesh.geometry.dispose();
              c.mesh.geometry = new THREE.TubeGeometry(c.curve, 40, c.power ? 0.0028 : 0.0018, 8, false);
              c.sig = sig;
            }
            const on = since >= 0 && since >= c.stage * STAGE_S;
            const sel = st.selected && (c.from.id === st.selected || c.to.id === st.selected);
            if (c.bad && on) { c.mat.color.setHex(0xff3b3b); c.mat.emissive.setHex(0xff2a2a); c.mat.emissiveIntensity = 0.6 + Math.sin(t * 10) * 0.5; }
            else { c.mat.emissiveIntensity = on ? 0.55 : (sel ? 0.4 : 0.05); }
            c.pulse.visible = on && !still;
            if (c.pulse.visible) c.pulse.position.copy(c.curve.getPoint(((t - c.stage * STAGE_S) * (c.power ? 0.6 : 0.9) + k * 0.17) % 1));
          });

          controls.autoRotate = st.spin && !still;
          controls.autoRotateSpeed = 1.2;
          controls.update();
          renderer.render(scene, camera);
          labelRenderer.render(scene, camera);
        });

        cleanup = () => {
          renderer.setAnimationLoop(null);
          ro.disconnect();
          renderer.domElement.removeEventListener('pointerdown', onDown);
          renderer.domElement.removeEventListener('pointerup', onUp);
          controls.dispose();
          cables.forEach((c) => c.mesh.geometry.dispose());
          disposables.forEach((d) => d.dispose());
          renderer.dispose();
          renderer.domElement.remove();
          labelRenderer.domElement.remove();
        };
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => { disposed = true; cleanup?.(); };
    // Rebuild only when the wiring's content changes, not on every new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiringKey]);

  const sel = selected ? nodes[selected] : null;
  const status = selected ? nodeStatus(wiring, selected) : null;
  const partName = (id: string | null) => (id && nodes[id] ? shortLabel(nodes[id]) : '');
  const tdLabel = off === 0 ? '' : off >= td.steps.length
    ? `All ${td.steps.length} parts off · ${partName(td.core)} stays on the bench`
    : `${off} of ${td.steps.length} off · ${partName(td.steps[off - 1])}`;

  if (failed) return (
    <div className="card" role="status">
      <h4>3D bench needs WebGL</h4>
      <p>This browser could not start 3D graphics. The schematic below shows the same wiring.</p>
    </div>
  );
  return (
    <section className="wb" aria-label="Wiring as physical parts, in 3D">
      <div className="ta-controls ta-teardown ws-motion">
        <button type="button" className={'btn btn-sm ' + (powered ? '' : 'btn-primary')} aria-pressed={powered} onClick={() => setPowered((v) => !v)}>
          {powered ? 'Power off' : 'Power on'}
        </button>
        {off === 0 && !playing ? (
          <button type="button" className="btn btn-sm" onClick={() => setPlaying(1)}>Take it apart</button>
        ) : (
          <>
            <button type="button" className="btn btn-sm" disabled={off === 0} onClick={() => { setPlaying(0); setOff((n) => Math.max(0, n - 1)); }}>&larr; Put back</button>
            <button type="button" className="btn btn-sm" disabled={off >= td.steps.length} onClick={() => { setPlaying(0); setOff((n) => Math.min(td.steps.length, n + 1)); }}>Next part &rarr;</button>
            <button type="button" className="btn btn-sm" onClick={() => { setPlaying(0); setPlaying(-1); }}>Reassemble</button>
          </>
        )}
        <button type="button" className="btn btn-sm ta-toggle" aria-pressed={spin} onClick={() => setSpin((v) => !v)}>Spin {spin ? 'on' : 'off'}</button>
        <button type="button" className="btn btn-sm ta-toggle" aria-pressed={labels} onClick={() => setLabels((v) => !v)}>Labels {labels ? 'on' : 'off'}</button>
        {tdLabel && <span className="ta-teardown-label" role="status">{tdLabel}</span>}
      </div>
      <div ref={hostRef} className="wb-stage" role="img" aria-label={`3D bench: ${wiring.nodes.length} parts and ${wiring.connections.length} cables from this robot's wiring`} />
      <p className="faint wb-cap">
        Every part and cable comes from this robot&apos;s wiring list. The shapes are generic stand-ins for each type of part, not the real parts, and not to scale.
        Red cables carry power, teal cables carry data. Drag to orbit, click a part for details.
      </p>
      {sel && status && (
        <div className="card wb-detail" role="status">
          <strong>{sel.label}</strong>
          <span className="faint"> · {role(wiring, sel.id).replace(/^the /, '')}</span>
          <p>
            Needs: {sel.req_label ?? 'not specified'} · rated max: {volts(sel.rated_max_v)} ·{' '}
            {status.state === 'bad' ? <b className="fail">over-voltage on a recorded feed</b>
              : status.state === 'ok' ? 'feed voltage checked, within rating'
              : `not voltage-checked: ${status.reason}`}
          </p>
          {status.feeds.length > 0 && <p className="faint">Powered from: {status.feeds.map((f) => `${shortLabel(nodes[f.from])} (${volts(f.volts)})`).join(', ')}</p>}
        </div>
      )}
    </section>
  );
}
