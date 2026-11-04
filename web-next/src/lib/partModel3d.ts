/* Generated 3D models for any part in My Parts and Tools.
 *
 * Every part gets a 3D model built in the browser from two things
 * the record actually has: what KIND of part it is (its category
 * and name) and its SIZE (the dimensions its specs state, else a
 * typical size for that kind). The geometry is a parametric stand-in
 * in the style of the Workshop's component skins: a recognisable
 * battery pack, gearmotor, wheel, servo, board, and so on.
 *
 * Honesty rules:
 * - This is NOT the manufacturer's CAD and NOT a scan. The viewer
 *   says so, and says whether the size came from the part's specs
 *   or is a typical size for its kind (sizeBasis).
 * - Nothing here reads a photo; pictures stay pictures.
 *
 * Pure apart from the THREE namespace it is handed (same convention
 * as components/kit/componentSkin.ts), so a node test can build every
 * kind and check it stays inside its stated envelope. Z is up, the
 * model is centred on the origin, units are metres. */
import type * as T from 'three';
import { addComponentSkin } from '../components/kit/componentSkin';

export type ModelKind =
  | 'battery' | 'gearmotor' | 'brushless' | 'stepper' | 'servo' | 'wheel' | 'propeller'
  | 'sbc' | 'jetson' | 'controller' | 'driver' | 'converter' | 'radio'
  | 'depth_camera' | 'camera' | 'lidar' | 'ultrasonic' | 'imu'
  | 'plate' | 'cable' | 'tool' | 'estop' | 'board';

export interface PartShape {
  kind: ModelKind;
  /** Envelope in metres: [length along X, width along Y, height along Z]. */
  size: [number, number, number];
  /** 'specs' when a stated dimension set the size; 'typical' otherwise. */
  sizeBasis: 'specs' | 'typical';
  label: string;
}

export interface ShapeInput { name: string; category: string; specs?: Record<string, unknown> }

const KIND_LABEL: Record<ModelKind, string> = {
  battery: 'battery pack', gearmotor: 'gearmotor', brushless: 'brushless motor', stepper: 'stepper motor',
  servo: 'servo', wheel: 'wheel', propeller: 'propeller', sbc: 'single-board computer', jetson: 'AI computer module',
  controller: 'microcontroller board', driver: 'motor driver board', converter: 'power converter board',
  radio: 'radio module', depth_camera: 'depth camera', camera: 'camera module', lidar: 'lidar', ultrasonic: 'ultrasonic sensor',
  imu: 'sensor breakout', plate: 'plate / frame', cable: 'cable and connector', tool: 'hand tool', estop: 'emergency stop', board: 'circuit board',
};

/* Typical envelopes (metres), used only when the specs don't state a size. */
const TYPICAL: Record<ModelKind, [number, number, number]> = {
  battery: [0.106, 0.034, 0.026], gearmotor: [0.068, 0.037, 0.037], brushless: [0.028, 0.028, 0.032],
  stepper: [0.042, 0.042, 0.048], servo: [0.054, 0.02, 0.04], wheel: [0.065, 0.026, 0.065], propeller: [0.127, 0.02, 0.012],
  sbc: [0.085, 0.056, 0.02], jetson: [0.1, 0.079, 0.03], controller: [0.052, 0.028, 0.012], driver: [0.043, 0.043, 0.027],
  converter: [0.043, 0.021, 0.014], radio: [0.03, 0.02, 0.008], depth_camera: [0.025, 0.09, 0.025], camera: [0.025, 0.024, 0.02],
  lidar: [0.096, 0.07, 0.055], ultrasonic: [0.02, 0.045, 0.02], imu: [0.027, 0.02, 0.006], plate: [0.12, 0.08, 0.004],
  cable: [0.12, 0.02, 0.012], tool: [0.18, 0.026, 0.026], estop: [0.04, 0.04, 0.04], board: [0.05, 0.04, 0.008],
};

const RULES: [RegExp, ModelKind][] = [
  [/realsense|depth cam|oak-?d|zed\b|kinect/i, 'depth_camera'],
  [/lidar|rplidar|ld06|ld19/i, 'lidar'],
  [/ultrasonic|sonar|hc-?sr04/i, 'ultrasonic'],
  [/camera|cam module|webcam/i, 'camera'],
  [/imu|bno0|mpu-?\d|icm-?\d|gyro|acceler|breakout/i, 'imu'],
  [/jetson|orin/i, 'jetson'],
  [/raspberry pi(?! pico)|\brpi\b|single[- ]board|beaglebone|rock ?pi|odroid/i, 'sbc'],
  [/pico|rp2040|esp32|arduino|teensy|stm32|microcontroller|\bmcu\b|feather|xiao/i, 'controller'],
  [/flight controller|\bfc\b/i, 'controller'],
  [/e-?stop|emergency stop|kill switch/i, 'estop'],
  [/stepper|nema/i, 'stepper'],
  [/servo/i, 'servo'],
  [/brushless|bldc|\bkv\b|\d{4}\s*kv/i, 'brushless'],
  [/gear ?motor|dc motor|encoder motor|\bmotor\b(?!.*driver)/i, 'gearmotor'],
  [/motor driver|h-?bridge|tb6612|l298|drv8|\besc\b|motor controller/i, 'driver'],
  [/buck|boost|regulator|converter|\bbec\b|\bbms\b|power module|pdb/i, 'converter'],
  [/propell?er|\bprops?\b/i, 'propeller'],
  [/wheel|tyre|tire|caster/i, 'wheel'],
  [/lipo|li-?ion|lifepo|18650|battery|nimh|cell pack/i, 'battery'],
  [/receiver|transmitter|radio|telemetry|elrs|lora|xbee|wifi module|bluetooth/i, 'radio'],
  [/cable|wire|harness|connector|xt60|xt30|jst|pigtail|awg/i, 'cable'],
  [/plate|frame|chassis|bracket|mount|extrusion|deck|standoff/i, 'plate'],
  [/solder|screwdriver|multimeter|plier|cutter|crimp|caliper|wrench|hex key|allen|driver set|heat gun/i, 'tool'],
];

const BY_CATEGORY: Record<string, ModelKind> = {
  battery: 'battery', motor: 'gearmotor', motor_driver: 'driver', controller: 'controller', computer: 'sbc',
  sensor: 'imu', wheel: 'wheel', servo: 'servo', power: 'converter', radio: 'radio', frame: 'plate', cable: 'cable',
  tool: 'tool', other: 'board',
};

/* A stated dimension in millimetres: `<key>_mm`, or the catalogue's
 * metre form `<key>_m` converted. */
function num(specs: Record<string, unknown> | undefined, key: string): number | null {
  const read = (k: string) => {
    const v = specs?.[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const mm = read(key);
  if (mm !== null && mm < 5000) return mm;
  const m = read(key.replace(/_mm$/, '_m'));
  return m !== null && m < 5 ? m * 1000 : null;
}

/** Which model to build for a part, and how big. */
export function partShape(p: ShapeInput): PartShape {
  let kind: ModelKind | undefined;
  if (p.category === 'tool') kind = 'tool';
  for (const [re, k] of RULES) { if (!kind && re.test(p.name)) kind = k; }
  kind = kind || BY_CATEGORY[p.category] || 'board';
  const typical = TYPICAL[kind];
  const size: [number, number, number] = [...typical];
  let basis: 'specs' | 'typical' = 'typical';
  const L = num(p.specs, 'length_mm'), W = num(p.specs, 'width_mm'), H = num(p.specs, 'height_mm'), D = num(p.specs, 'diameter_mm');
  if (kind === 'wheel' && D) {
    size[0] = D / 1000; size[2] = D / 1000; basis = 'specs';
    if (W && W < D) size[1] = W / 1000;
  } else if (kind === 'propeller' && D) {
    size[0] = D / 1000; size[1] = D / 1000 * 0.16; basis = 'specs';
  } else if (L || W || H) {
    /* Scale the typical shape to the stated dimensions; an axis the
     * page didn't state keeps the typical proportion. */
    const k = (L ? L / 1000 / typical[0] : 0) || (W ? W / 1000 / typical[1] : 0) || (H ? H / 1000 / typical[2] : 1);
    size[0] = L ? L / 1000 : typical[0] * k;
    size[1] = W ? W / 1000 : typical[1] * k;
    size[2] = H ? H / 1000 : typical[2] * k;
    basis = 'specs';
  } else if (D && (kind === 'gearmotor' || kind === 'brushless')) {
    const r = D / 1000 / typical[1];
    size[1] = D / 1000; size[2] = D / 1000; size[0] = typical[0] * (kind === 'brushless' ? r : 1); basis = 'specs';
    if (kind === 'brushless') { size[0] = D / 1000; size[1] = D / 1000; size[2] = typical[2] * r; }
  }
  return { kind, size: size.map((v) => Math.min(Math.max(v, 0.002), 2)) as [number, number, number], sizeBasis: basis, label: KIND_LABEL[kind] };
}

/** Build the model for a shape: a Group centred at the origin, inside size/2 on every axis. */
export function buildPartModel(THREE: typeof T, shape: PartShape): T.Group {
  const root = new THREE.Group();
  root.name = 'part-model-' + shape.kind;
  const [l, w, h] = shape.size;
  const mat = (color: number, metalness = 0.2, roughness = 0.5) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const black = mat(0x15181d, 0.25, 0.55), rubber = mat(0x1b1d21, 0.05, 0.92), silver = mat(0xc9d1db, 0.9, 0.22);
  const alu = mat(0x9aa4b2, 0.85, 0.3), brass = mat(0xd5a038, 0.85, 0.28), pcb = mat(0x14532d, 0.15, 0.5), white = mat(0xe8ebef, 0.05, 0.4);
  const orange = mat(0xf59e0b, 0.25, 0.4), red = mat(0xc62828, 0.2, 0.45), blue = mat(0x1d4ed8, 0.2, 0.45), copper = mat(0xb87333, 0.85, 0.3);
  const add = (geo: T.BufferGeometry, m: T.Material, pos: [number, number, number], rot?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const box = (d: [number, number, number], pos: [number, number, number], m: T.Material) => add(new THREE.BoxGeometry(...d), m, pos);
  /* Cylinder along an axis ('x' | 'y' | 'z'). */
  const cyl = (r: number, len: number, axis: 'x' | 'y' | 'z', pos: [number, number, number], m: T.Material, seg = 32, r2?: number) =>
    add(new THREE.CylinderGeometry(r, r2 ?? r, len, seg), m, pos, axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : undefined);
  const header = (n: number, x0: number, x1: number, y: number, z: number) => {
    for (let i = 0; i < n; i++) box([Math.min(0.0024, (x1 - x0) / n * 0.8), 0.0024, 0.006 > h * 0.5 ? h * 0.5 : 0.006], [x0 + (i + 0.5) * (x1 - x0) / n, y, z], black);
  };

  switch (shape.kind) {
    case 'battery': case 'gearmotor': case 'driver': case 'converter': case 'depth_camera': case 'lidar':
    case 'ultrasonic': case 'imu': case 'estop': case 'sbc': case 'jetson': {
      const id = ({ battery: 'battery', gearmotor: 'gearmotor', driver: 'driver', converter: 'converter', depth_camera: 'realsense',
        lidar: 'rplidar', ultrasonic: 'ultrasonic', imu: 'imu', estop: 'estop', sbc: 'raspberry', jetson: 'jetson' } as Record<string, string>)[shape.kind];
      addComponentSkin(THREE, root, shape.size, id);
      root.traverse((o) => { const m = o as T.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      break;
    }
    case 'brushless': {
      const r = Math.min(l, w) / 2;
      cyl(r * 0.98, h * 0.18, 'z', [0, 0, -h * 0.41], alu, 40);              // mount base
      cyl(r * 0.9, h * 0.08, 'z', [0, 0, -h * 0.28], black, 40);             // stator gap
      cyl(r, h * 0.56, 'z', [0, 0, h * 0.04], mat(0x2b2f36, 0.8, 0.35), 40); // bell
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; box([r * 0.5, r * 0.12, h * 0.02], [Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, h * 0.33], silver).rotation.z = a; }
      cyl(r * 0.12, h * 0.18, 'z', [0, 0, h * 0.41], silver, 20);            // shaft
      break;
    }
    case 'stepper': {
      box([l * 0.98, w * 0.98, h * 0.2], [0, 0, h * 0.27], black);
      box([l * 0.96, w * 0.96, h * 0.5], [0, 0, -h * 0.08], alu);
      box([l * 0.98, w * 0.98, h * 0.12], [0, 0, -h * 0.4], black);
      cyl(Math.min(l, w) * 0.27, h * 0.03, 'z', [0, 0, h * 0.385], silver);
      cyl(Math.min(l, w) * 0.06, h * 0.12, 'z', [0, 0, h * 0.44], silver, 20);
      box([l * 0.2, w * 0.14, h * 0.12], [-l * 0.36, 0, -h * 0.2], white); // connector
      break;
    }
    case 'servo': {
      box([l * 0.74, w * 0.96, h * 0.72], [0, 0, -h * 0.04], mat(0x1f2937, 0.1, 0.5));
      box([l * 0.98, w * 0.96, h * 0.06], [0, 0, h * 0.12], mat(0x1f2937, 0.1, 0.5)); // mounting flange
      for (const s of [-1, 1]) cyl(Math.min(w, l) * 0.08, h * 0.07, 'z', [s * l * 0.43, 0, h * 0.12], brass, 16);
      cyl(w * 0.3, h * 0.1, 'z', [l * 0.18, 0, h * 0.37], mat(0x111827, 0.1, 0.5));
      box([l * 0.38, w * 0.26, h * 0.06], [l * 0.18, 0, h * 0.46], white); // horn
      box([l * 0.06, w * 0.3, h * 0.12], [-l * 0.42, 0, -h * 0.3], orange);  // lead
      break;
    }
    case 'wheel': {
      const r = Math.min(l, h) / 2, t = w;
      cyl(r, t * 0.96, 'y', [0, 0, 0], rubber, 48);
      cyl(r * 0.72, t * 0.8, 'y', [0, 0, 0], mat(0xd1d5db, 0.55, 0.3), 40);
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(new THREE.BoxGeometry(r * 0.5, t * 0.12, r * 0.12), mat(0x9ca3af, 0.7, 0.3), [Math.cos(a) * r * 0.42, side * t * 0.43, Math.sin(a) * r * 0.42], [0, -a, 0]); }
      cyl(r * 0.16, t, 'y', [0, 0, 0], silver, 24);
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; add(new THREE.BoxGeometry(r * 0.08, t * 0.9, r * 0.04), rubber, [Math.cos(a) * r * 0.955, 0, Math.sin(a) * r * 0.955], [0, -a, 0]); }
      break;
    }
    case 'propeller': {
      const r = l / 2;
      cyl(Math.min(r * 0.1, w * 0.45), h, 'z', [0, 0, 0], black, 24);
      for (const s of [0, 1]) {
        const blade = add(new THREE.BoxGeometry(r * 0.86, w * 0.8, h * 0.3), mat(0x0ea5e9, 0.1, 0.35), [0, 0, 0]);
        blade.geometry.translate(r * 0.52, 0, 0);
        blade.rotation.set(s ? -0.35 : 0.35, 0, s * Math.PI);
      }
      break;
    }
    case 'controller': case 'radio': case 'board': case 'camera': {
      const board = shape.kind === 'controller' ? mat(0x0b4f8a, 0.15, 0.45) : shape.kind === 'radio' ? mat(0x111827, 0.15, 0.45) : pcb;
      const camera = shape.kind === 'camera';
      box([l, w, camera ? h * 0.08 : h * 0.16], [0, 0, camera ? -h * 0.46 : -h * 0.42], board);
      if (camera) {
        box([l * 0.36, w * 0.36, h * 0.3], [0, 0, -h * 0.27], black);
        cyl(Math.min(l, w) * 0.15, h * 0.6, 'z', [0, 0, h * 0.18], black, 28);
        cyl(Math.min(l, w) * 0.1, h * 0.02, 'z', [0, 0, h * 0.49], mat(0x1e3a8a, 0.9, 0.05), 28);
        box([l * 0.5, w * 0.12, h * 0.06], [0, -w * 0.4, -h * 0.39], white);
      } else {
        box([l * 0.28, w * 0.36, h * 0.2], [0, 0, -h * 0.24], black);                 // main chip
        box([l * 0.12, w * 0.28, h * 0.36], [l * 0.43, 0, -h * 0.16], silver);        // USB
        header(Math.max(4, Math.round(l / 0.00254 * 0.8)), -l * 0.42, l * 0.36, w * 0.42, -h * 0.05);
        header(Math.max(4, Math.round(l / 0.00254 * 0.8)), -l * 0.42, l * 0.36, -w * 0.42, -h * 0.05);
        if (shape.kind === 'radio') cyl(Math.min(l, w) * 0.05, h * 0.5, 'z', [-l * 0.4, 0, h * 0.24], black, 12);
        else box([l * 0.08, w * 0.08, h * 0.1], [-l * 0.2, w * 0.2, -h * 0.29], mat(0x22c55e, 0.1, 0.2)); // LED
      }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) cyl(Math.min(l, w) * 0.035, h * 0.02, 'z', [sx * l * 0.44, sy * w * 0.4, camera ? -h * 0.41 : -h * 0.33], brass, 16);
      break;
    }
    case 'plate': {
      box([l, w, h * 0.98], [0, 0, 0], mat(0x374151, 0.6, 0.35));
      const holeR = Math.min(l, w) * 0.035;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) cyl(holeR, h * 1.0, 'z', [sx * (l / 2 - holeR * 2.2), sy * (w / 2 - holeR * 2.2), 0], black, 20);
      cyl(Math.min(l, w) * 0.18, h * 1.0, 'z', [0, 0, 0], black, 32);
      break;
    }
    case 'cable': {
      for (const [y, m] of [[-w * 0.18, red], [w * 0.18, black]] as [number, T.Material][]) cyl(Math.min(w, h) * 0.17, l * 0.7, 'x', [0, y, 0], m, 16);
      box([l * 0.15, w * 0.98, h * 0.98], [-l * 0.42, 0, 0], mat(0xfacc15, 0.15, 0.45));
      box([l * 0.15, w * 0.98, h * 0.98], [l * 0.42, 0, 0], mat(0xfacc15, 0.15, 0.45));
      for (const s of [-1, 1]) cyl(Math.min(w, h) * 0.12, l * 0.04, 'x', [s * l * 0.48, 0, 0], brass, 12);
      break;
    }
    case 'tool': {
      const r = Math.min(w, h) / 2;
      cyl(r * 0.98, l * 0.42, 'x', [-l * 0.29, 0, 0], orange, 6);
      cyl(r * 0.7, l * 0.1, 'x', [-l * 0.03, 0, 0], black, 24);
      cyl(r * 0.2, l * 0.44, 'x', [l * 0.25, 0, 0], silver, 16);
      cyl(r * 0.2, l * 0.04, 'x', [l * 0.48, 0, 0], silver, 16, r * 0.06);
      break;
    }
    default: {
      box([l, w, h], [0, 0, 0], pcb);
    }
  }
  void blue; void copper;
  return root;
}

/** Dispose every geometry and material under a model. */
export function disposeModel(root: T.Object3D): void {
  root.traverse((o) => {
    const m = o as T.Mesh;
    m.geometry?.dispose?.();
    const mt = m.material as T.Material | T.Material[] | undefined;
    if (Array.isArray(mt)) mt.forEach((x) => x.dispose()); else mt?.dispose?.();
  });
}

/** Dimensions in millimetres, for captions and the CAD view. */
export function sizeMm(shape: PartShape): [number, number, number] {
  return shape.size.map((v) => Math.round(v * 10000) / 10) as [number, number, number];
}
