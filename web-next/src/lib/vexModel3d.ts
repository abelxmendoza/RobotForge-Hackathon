/* A 3D stand-in of a VEX V5 drive base, drawn from the spec's own
 * numbers: frame size, wheel count / size / kind (omni, traction,
 * mecanum), motor count, cartridge colour and gear teeth. It is a
 * picture of the build, not CAD: VEX parts are drawn at their nominal
 * sizes (C-channel 1×2×1, V5 motor, Brain, battery, high-strength
 * gears with 24 teeth per inch of pitch diameter).
 *
 * Coordinates are the robot's own: x forward, y left, z up, metres,
 * with the floor at z = 0. Three.js is passed in so the module can
 * be loaded on demand. */
import type * as T from 'three';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

const IN = 0.0254;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

export interface VexLayout {
  length: number; width: number; wheelD: number; wheelW: number;
  wheelKind: 'omni' | 'traction' | 'mecanum';
  perSide: number; wheelXs: number[]; motors: number; motorXs: number[];
  cartridge: 'red' | 'green' | 'blue'; driving: number; driven: number;
  mechs: ('intake' | 'lift' | 'pneumatics')[];
}

/** Where everything goes, from the spec (pure; tested in tests/test_vex.py). */
export function vexLayout(spec: Spec): VexLayout {
  const length = num(spec?.length_m, 0.38);
  const width = num(spec?.width_m, 0.38);
  const wheelD = num(spec?.wheel?.diameter_m, 4 * IN);
  const mecanum = spec?.drivetrain === 'mecanum';
  const wheelKind: VexLayout['wheelKind'] = mecanum ? 'mecanum' : spec?.wheel?.kind === 'traction' ? 'traction' : 'omni';
  const wheelW = num(spec?.wheel?.width_m, mecanum ? 0.035 : 0.028);
  const count = Math.max(2, Math.round(num(spec?.wheel?.count, 4)));
  const perSide = Math.max(1, Math.ceil(count / 2));
  const span = Math.max(0, length - wheelD - 0.02);
  const wheelXs = perSide === 1 ? [0] : Array.from({ length: perSide }, (_, i) => span / 2 - (i * span) / (perSide - 1));
  const motors = Math.max(0, Math.round(num(spec?.motor?.count, 4)));
  const motorsPerSide = Math.max(1, Math.ceil(motors / 2));
  // A motor per wheel when there are enough; a 2-motor bot drives the middle (chained) position.
  const motorXs = motorsPerSide >= perSide ? wheelXs.slice()
    : motorsPerSide === 1 ? [wheelXs[Math.floor((perSide - 1) / 2)]]
    : Array.from({ length: motorsPerSide }, (_, i) => wheelXs[Math.round((i * (perSide - 1)) / (motorsPerSide - 1))]);
  const rpm = num(spec?.gearing?.motor_free_rpm, 200);
  const cartridge = rpm <= 100 ? 'red' : rpm >= 600 ? 'blue' : 'green';
  return {
    length, width, wheelD, wheelW, wheelKind, perSide, wheelXs, motors, motorXs, cartridge,
    driving: Math.round(num(spec?.gearing?.driving_teeth, 1)),
    driven: Math.round(num(spec?.gearing?.driven_teeth, 1)),
    mechs: Array.isArray(spec?.vex_mechanisms) ? (['intake', 'lift', 'pneumatics'] as const).filter((m) => spec.vex_mechanisms.includes(m)) : [],
  };
}

const COLORS = {
  alu: 0xc7ccd3, hole: 0x2a2f37, motor: 0x23262c, red: 0xd8383f, green: 0x2fa84f, blue: 0x2f6fd8,
  brain: 0x1d2128, screen: 0x0c3b66, battery: 0xc8323a, tyre: 0x1a1b1f, hub: 0xe4e7ec, roller: 0x2b2d33,
  mecRoller: 0x3a3d44, gear: 0x30343c, radio: 0x30343c, axle: 0x9aa1aa,
};

/** The drive base as a Three.js group, sitting on the floor (z = 0). */
export function buildVexModel(THREE: typeof T, spec: Spec): T.Group {
  const L = vexLayout(spec);
  const root = new THREE.Group();
  root.name = 'vex-drive-base';
  const mat = (color: number, opts: Partial<T.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...opts });
  const alu = mat(COLORS.alu, { metalness: 0.75, roughness: 0.35 });
  const holeMat = mat(COLORS.hole, { roughness: 0.9 });
  const cast = (m: T.Mesh) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (sx: number, sy: number, sz: number, m: T.Material, x: number, y: number, z: number) => {
    const b = cast(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m));
    b.position.set(x, y, z);
    root.add(b);
    return b;
  };

  const r = L.wheelD / 2;
  const axleZ = r; // wheels touch the floor
  const railH = 1 * IN, railW = 0.5 * IN;
  const railZ = axleZ + 0.004;
  const railY = L.width / 2 - L.wheelW - 0.012; // rails just inside the wheels
  // Frame: two side C-channels, a front and back cross channel.
  const holes: { x: number; y: number; z: number; ax: 'z' | 'y' }[] = [];
  for (const s of [1, -1]) {
    box(L.length, railW, railH, alu, 0, s * railY, railZ);
    for (let x = -L.length / 2 + 0.25 * IN; x <= L.length / 2 - 0.2 * IN; x += 0.5 * IN) holes.push({ x, y: s * (railY + railW / 2 + 0.0004), z: railZ, ax: 'y' });
  }
  for (const s of [1, -1]) {
    box(railW, railY * 2 - railW, railH, alu, s * (L.length / 2 - railW / 2), 0, railZ);
    for (let y = -railY + 0.5 * IN; y <= railY - 0.5 * IN; y += 0.5 * IN) holes.push({ x: s * (L.length / 2 - railW / 2), y, z: railZ + railH / 2 + 0.0004, ax: 'z' });
  }
  // Square VEX holes as one instanced mesh.
  const holeGeo = new THREE.BoxGeometry(0.182 * IN, 0.182 * IN, 0.0008);
  const holeMesh = new THREE.InstancedMesh(holeGeo, holeMat, holes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  holes.forEach((h, i) => {
    q.setFromEuler(new THREE.Euler(h.ax === 'y' ? Math.PI / 2 : 0, 0, 0));
    m4.compose(new THREE.Vector3(h.x, h.y, h.z), q, one);
    holeMesh.setMatrixAt(i, m4);
  });
  root.add(holeMesh);

  // Wheels.
  for (const s of [1, -1]) {
    L.wheelXs.forEach((x, i) => {
      const w = makeWheel(THREE, L, mat, i, s);
      w.position.set(x, s * (L.width / 2 - L.wheelW / 2), axleZ);
      root.add(w);
      // Axle through the rail.
      const axle = cast(new THREE.Mesh(new THREE.BoxGeometry(0.125 * IN, L.width / 2 - railY + 0.02, 0.125 * IN), mat(COLORS.axle, { metalness: 0.8, roughness: 0.3 })));
      axle.position.set(x, s * ((L.width / 2 + railY) / 2 - 0.01), axleZ);
      root.add(axle);
    });
  }

  // Motors, inside the rails, coloured cap = cartridge.
  const capColor = COLORS[L.cartridge];
  const geared = L.driving !== L.driven;
  const pitchD = (teeth: number) => (teeth / 24) * IN;
  const motorW = 0.045, motorL = 0.065, motorH = 0.045;
  for (const s of [1, -1]) {
    for (const x0 of L.motorXs) {
      // A geared motor sits ahead of its wheel by the gears' centre distance.
      const cd = geared ? (pitchD(L.driving) + pitchD(L.driven)) / 2 : 0;
      const forward = x0 + cd > L.length / 2 - motorL / 2 ? -1 : 1;
      const mx = x0 + forward * cd;
      const my = s * (railY - railW / 2 - motorW / 2 - 0.004);
      const body = box(motorL, motorW, motorH, mat(COLORS.motor, { roughness: 0.6 }), mx, my, axleZ);
      body.name = 'motor';
      const cap = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 24), mat(capColor, { emissive: capColor, emissiveIntensity: 0.25 })));
      cap.position.set(mx, my - s * (motorW / 2 + 0.002), axleZ);
      root.add(cap);
      if (geared) {
        const gy = s * (railY - railW / 2 - 0.006);
        const g1 = makeGear(THREE, L.driving, mat(COLORS.gear, { metalness: 0.2 }));
        g1.position.set(mx, gy, axleZ);
        const g2 = makeGear(THREE, L.driven, mat(COLORS.gear, { metalness: 0.2 }));
        g2.position.set(x0, gy, axleZ);
        g2.rotation.y = Math.PI / Math.max(L.driven, 1);
        // Shift the motor inboard so the gears sit between it and the rail.
        body.position.y -= s * 0.008; cap.position.y -= s * 0.008;
        root.add(g1, g2);
      }
    }
  }

  // Electronics on a centre deck: Brain (screen up), battery, radio.
  const deckZ = railZ + railH / 2;
  const brain = box(0.11, 0.075, 0.02, mat(COLORS.brain), -0.02, 0, deckZ + 0.03);
  brain.name = 'brain';
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.052), new THREE.MeshStandardMaterial({ color: COLORS.screen, emissive: 0x1f6fb8, emissiveIntensity: 0.55, roughness: 0.2 }));
  screen.position.set(-0.02, 0, deckZ + 0.0402);
  root.add(screen);
  box(0.13, 0.05, 0.035, mat(COLORS.battery), -0.02, 0, railZ); // battery slung between the rails
  box(0.03, 0.025, 0.012, mat(COLORS.radio), 0.06, 0.035, deckZ + 0.026);
  // Mounting standoffs under the Brain.
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const so = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 10), alu));
    so.rotation.x = Math.PI / 2;
    so.position.set(-0.02 + sx * 0.045, sy * 0.03, deckZ + 0.01);
    root.add(so);
  }
  // A cross channel under the electronics.
  box(railW, railY * 2 - railW, railH * 0.5, alu, 0.075, 0, deckZ - railH * 0.25);
  // Front marker: a small accent bar on the front channel.
  box(0.004, 0.06, 0.01, mat(0x2dd4bf, { emissive: 0x2dd4bf, emissiveIntensity: 0.6 }), L.length / 2 + 0.002, 0, railZ);

  // Team licence plates on both sides, as on every V5RC robot.
  for (const s of [1, -1]) {
    const plate = makePlate(THREE, String(spec?.vex_team ?? 'RF 1A'));
    plate.position.set(-L.length / 4, s * (L.width / 2 + 0.004), 2 * r + 0.026);
    plate.rotation.z = s > 0 ? Math.PI : 0; // face outwards
    root.add(plate);
  }

  if (L.mechs.length) addMechanisms(THREE, root, L, { alu, holeMat, mat, railY, railZ, railH, railW, axleZ });
  return root;
}

interface Kit {
  alu: T.Material; holeMat: T.Material; railY: number; railZ: number; railH: number; railW: number; axleZ: number;
  mat: (c: number, o?: Partial<T.MeshStandardMaterialParameters>) => T.MeshStandardMaterial;
}

/** A C-channel (1×2) between two points, with its square holes. */
function beam(THREE: typeof T, root: T.Group, kit: Kit, a: T.Vector3, b: T.Vector3, w = 0.5 * IN, h = 1 * IN): T.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, w, h), kit.alu);
  m.castShadow = true; m.receiveShadow = true;
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
  const n = Math.max(1, Math.floor(len / (0.5 * IN)));
  const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.182 * IN, 0.182 * IN, 0.0008), kit.holeMat, n * 2);
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    for (const sy of [1, -1]) {
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      mm.compose(new THREE.Vector3(x, sy * (w / 2 + 0.0004), 0), q, one);
      holes.setMatrixAt(k++, mm);
    }
  }
  m.add(holes);
  root.add(m);
  return m;
}

/** The scoring mechanisms on top of the drive: intake/conveyor, lift tower, pneumatics. */
function addMechanisms(THREE: typeof T, root: T.Group, L: VexLayout, kit: Kit) {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const top = kit.railZ + kit.railH / 2;
  const red = kit.mat(0xb3262e, { roughness: 0.5 });
  const green = kit.mat(0x1f6b3a, { roughness: 0.5 });
  const chainMat = kit.mat(0x15171b, { roughness: 0.6, metalness: 0.5 });
  const sprocket = (teeth: number, m: T.Material, x: number, y: number, z: number) => {
    const g = makeGear(THREE, teeth, m);
    g.position.set(x, y, z);
    g.name = 'sprocket';
    root.add(g);
    return g;
  };
  const chain = (a: T.Vector3, b: T.Vector3, rad: number, y: number) => {
    // A stadium-shaped loop of links around two sprockets in the xz plane.
    const pts: T.Vector3[] = [];
    const d = new THREE.Vector2(b.x - a.x, b.z - a.z);
    const ang = Math.atan2(d.y, d.x);
    const arc = (c: T.Vector3, from: number) => { for (let i = 0; i <= 12; i++) { const t = from + (i / 12) * Math.PI; pts.push(V(c.x + Math.cos(t) * rad, y, c.z + Math.sin(t) * rad)); } };
    arc(b, ang - Math.PI / 2);
    arc(a, ang + Math.PI / 2);
    pts.push(pts[0].clone());
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.0035, 6, true), chainMat);
    tube.castShadow = true;
    root.add(tube);
  };

  if (L.mechs.includes('intake')) {
    // A sloped conveyor from the floor at the front up to the top centre,
    // driven by chain and sprockets, with green flex rollers at the mouth.
    const yS = Math.min(0.09, kit.railY - 0.03);
    const lo = V(L.length / 2 + 0.03, 0, 0.05), hi = V(-0.02, 0, 0.32);
    for (const s of [1, -1]) {
      beam(THREE, root, kit, V(lo.x, s * yS, lo.z), V(hi.x, s * yS, hi.z));
      // Uprights holding the top of the conveyor.
      beam(THREE, root, kit, V(hi.x + 0.02, s * (yS + 0.02), top), V(hi.x + 0.02, s * (yS + 0.02), hi.z + 0.02));
      sprocket(24, red, lo.x, s * (yS - 0.012), lo.z);
      sprocket(24, red, hi.x, s * (yS - 0.012), hi.z);
      sprocket(84, red, hi.x + 0.02, s * (yS + 0.035), hi.z - 0.06);
      chain(V(lo.x, 0, lo.z), V(hi.x, 0, hi.z), (24 / 24) * IN / 2 + 0.002, s * (yS - 0.012));
    }
    // Flex-wheel rollers across the mouth and a few cross bars on the ramp.
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      const p = V(lo.x + (hi.x - lo.x) * t * 0.9, 0, lo.z + (hi.z - lo.z) * t * 0.9);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, yS * 2, 10), kit.mat(0x9aa1aa, { metalness: 0.8 }));
      bar.position.copy(p);
      root.add(bar);
      if (i === 0) for (const yy of [-yS * 0.5, 0, yS * 0.5]) {
        const flex = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 18), green);
        flex.position.set(p.x, yy, p.z);
        flex.castShadow = true;
        root.add(flex);
      }
    }
  }

  if (L.mechs.includes('lift')) {
    // Two C-channel towers with a braced top, big green gears at the
    // base driven by a small one, rubber bands, and an arm reaching forward.
    const x0 = -0.06, H = 0.44;
    const y0 = kit.railY - 0.02;
    for (const s of [1, -1]) {
      beam(THREE, root, kit, V(x0, s * y0, top), V(x0, s * y0, H));
      beam(THREE, root, kit, V(x0 - 0.12, s * y0, top), V(x0, s * y0, H - 0.04));
      sprocket(84, green, x0 + 0.01, s * (y0 - 0.02), H - 0.03);
      sprocket(12, green, x0 + 0.01 + (84 + 12) / 48 * IN, s * (y0 - 0.02), H - 0.03);
      // The arm, pivoting at the gear and reaching forward and down.
      beam(THREE, root, kit, V(x0 + 0.01, s * (y0 - 0.035), H - 0.03), V(L.length / 2 + 0.02, s * (y0 - 0.035), H - 0.12));
      // Rubber bands from the tower to the arm.
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.16, 6), kit.mat(0xd8c08a, { roughness: 0.9 }));
      band.position.set(x0 + 0.06, s * (y0 - 0.03), H - 0.1);
      band.rotation.y = 0.9;
      root.add(band);
    }
    beam(THREE, root, kit, V(x0, -y0, H), V(x0, y0, H));
    beam(THREE, root, kit, V(L.length / 2 + 0.02, -y0 + 0.035, H - 0.12), V(L.length / 2 + 0.02, y0 - 0.035, H - 0.12));
    // Lift motors on the tower base.
    for (const s of [1, -1]) {
      const mtr = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.045, 0.045), kit.mat(0x23262c));
      mtr.position.set(x0 + 0.05, s * (y0 - 0.06), H - 0.03);
      mtr.castShadow = true;
      mtr.name = 'mech-motor';
      root.add(mtr);
    }
  }

  if (L.mechs.includes('pneumatics')) {
    // Two air tanks across the back, a cylinder (piston) on a clamp,
    // and black tubing between them.
    const steel = kit.mat(0xb8bec6, { metalness: 0.85, roughness: 0.3 });
    const tankY = Math.min(0.12, kit.railY - 0.03);
    for (const dz of [0, 0.045]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, tankY * 2, 24), steel);
      tank.position.set(-L.length / 2 + 0.05, 0, top + 0.022 + dz);
      tank.castShadow = true;
      tank.name = 'air-tank';
      root.add(tank);
      for (const s of [1, -1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.012, 24), kit.mat(0xb3262e));
        cap.position.set(tank.position.x, s * (tankY - 0.006), tank.position.z);
        root.add(cap);
      }
    }
    const a = V(-0.02, kit.railY - 0.04, top + 0.02), b = V(L.length / 2 - 0.03, kit.railY - 0.04, top + 0.11);
    const dir = new THREE.Vector3().subVectors(b, a);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, dir.length() * 0.6, 18), steel);
    body.position.copy(a).addScaledVector(dir, 0.3);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    body.castShadow = true;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, dir.length() * 0.45, 10), kit.mat(0xe5e7eb, { metalness: 0.9, roughness: 0.2 }));
    rod.position.copy(a).addScaledVector(dir, 0.78);
    rod.quaternion.copy(body.quaternion);
    root.add(body, rod);
    const tubeCurve = new THREE.CatmullRomCurve3([V(-L.length / 2 + 0.05, tankY - 0.01, top + 0.04), V(-0.12, tankY, top + 0.12), V(-0.03, kit.railY - 0.04, top + 0.05), a.clone()]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(tubeCurve, 40, 0.0025, 6, false), kit.mat(0x111317));
    root.add(tube);
  }
}

/** A blue V5RC licence plate with the team number (text needs a DOM). */
function makePlate(THREE: typeof T, team: string): T.Mesh {
  let map: T.Texture | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    if (g) {
      g.fillStyle = '#1f5fbf'; g.fillRect(0, 0, 256, 96);
      g.strokeStyle = '#9cc3ff'; g.lineWidth = 6; g.strokeRect(6, 6, 244, 84);
      g.fillStyle = '#ffffff'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(team.slice(0, 6), 128, 52);
      map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
    }
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.045), new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x1f5fbf, map, roughness: 0.5 }));
  m.rotation.x = Math.PI / 2; // stand it up, facing +y
  m.name = 'licence-plate';
  const holder = new THREE.Group();
  holder.add(m);
  return holder as unknown as T.Mesh;
}

function makeWheel(THREE: typeof T, L: VexLayout, mat: (c: number, o?: Partial<T.MeshStandardMaterialParameters>) => T.MeshStandardMaterial, index: number, side: number): T.Group {
  const g = new THREE.Group();
  g.name = 'wheel';
  const r = L.wheelD / 2;
  const w = L.wheelW;
  const cyl = (rad: number, h: number, m: T.Material, seg = 40) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, seg), m); // axis along y
    c.castShadow = true;
    return c;
  };
  const hubM = mat(COLORS.hub, { roughness: 0.45 });
  if (L.wheelKind === 'traction') {
    const tyre = cyl(r, w, mat(COLORS.tyre, { roughness: 0.95 }));
    g.add(tyre);
    // Tread blocks.
    const n = Math.round((2 * Math.PI * r) / 0.008);
    const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(0.003, w * 0.9, 0.003), mat(COLORS.tyre, { roughness: 1 }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      m4.makeRotationY(-a).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
      tread.setMatrixAt(i, m4);
    }
    g.add(tread);
    const hub = cyl(r * 0.62, w * 1.02, hubM);
    g.add(hub);
  } else if (L.wheelKind === 'omni') {
    // Two hub plates, each ringed by free rollers whose axes run around the rim.
    const plateW = w * 0.32;
    const rollerR = Math.max(0.004, r * 0.16);
    const n = Math.max(8, Math.round((2 * Math.PI * (r - rollerR)) / (rollerR * 2.6)));
    const rollerGeo = new THREE.CylinderGeometry(rollerR, rollerR * 0.85, rollerR * 2.2, 14);
    const rollers = new THREE.InstancedMesh(rollerGeo, mat(COLORS.roller, { roughness: 0.85 }), n * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (const off of [-1, 1]) {
      const plate = cyl(r - rollerR * 1.1, plateW, hubM);
      plate.position.y = off * (w / 2 - plateW / 2);
      g.add(plate);
      for (let i = 0; i < n; i++) {
        const a = ((i + (off > 0 ? 0.5 : 0)) / n) * Math.PI * 2;
        // Roller axis is tangent to the rim, in the wheel's plane (xz).
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        m4.compose(new THREE.Vector3(Math.cos(a) * (r - rollerR), off * (w / 2 - plateW / 2), Math.sin(a) * (r - rollerR)), q, one);
        rollers.setMatrixAt(k++, m4);
      }
    }
    rollers.castShadow = true;
    g.add(rollers);
  } else {
    // Mecanum: two hub plates with rollers at 45° to the axle.
    const rollerR = Math.max(0.004, r * 0.13);
    const n = 12;
    for (const off of [-1, 1]) {
      const plate = cyl(r * 0.78, w * 0.12, hubM);
      plate.position.y = off * (w / 2 - w * 0.06);
      g.add(plate);
    }
    g.add(cyl(r * 0.3, w, hubM));
    const rollerGeo = new THREE.CylinderGeometry(rollerR * 0.8, rollerR * 0.8, w * 0.95, 16);
    const rollers = new THREE.InstancedMesh(rollerGeo, mat(COLORS.mecRoller, { roughness: 0.8 }), n);
    // Diagonal wheels mirror each other so the X pattern shows from above.
    const hand = (index + (side > 0 ? 0 : 1)) % 2 === 0 ? 1 : -1;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), hand * Math.PI / 4));
      m4.compose(new THREE.Vector3(Math.cos(a) * (r - rollerR), 0, Math.sin(a) * (r - rollerR)), q, new THREE.Vector3(1, 1, 1));
      rollers.setMatrixAt(i, m4);
    }
    rollers.castShadow = true;
    g.add(rollers);
  }
  return g;
}

/** A spur gear in the xz plane (axle along y), pitch diameter teeth/24 in. */
function makeGear(THREE: typeof T, teeth: number, m: T.Material): T.Mesh {
  const rp = (teeth / 24) * IN / 2;
  const add = IN / 24; // addendum ≈ 1 module
  const shape = new THREE.Shape();
  const n = Math.max(6, teeth);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const step = (Math.PI * 2) / n;
    const pts: [number, number][] = [
      [rp - add, a0], [rp + add, a0 + step * 0.2], [rp + add, a0 + step * 0.45], [rp - add, a0 + step * 0.65],
    ];
    pts.forEach(([rad, a], j) => {
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0 && j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const hole = new THREE.Path();
  const hs = 0.0625 * IN;
  hole.moveTo(-hs, -hs); hole.lineTo(hs, -hs); hole.lineTo(hs, hs); hole.lineTo(-hs, hs); hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -0.003);
  geo.rotateX(Math.PI / 2); // face along y
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.name = 'gear';
  return mesh;
}

export function disposeVexModel(root: T.Object3D): void {
  root.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const x of mats) x?.dispose();
  });
}
