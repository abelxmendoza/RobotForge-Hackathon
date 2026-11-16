/* The starter rover drawn from simple shapes, in metres: x forward,
 * y left, z up, the origin on the floor under the middle of the car.
 * Sizes are the usual ones for this kit (65 mm wheels, TT motors,
 * 3 mm acrylic decks). It is an illustration, not CAD. */
import type * as THREE_NS from 'three';
import type { BoardId, PieceId } from '@/lib/buildGuide';

type T = typeof THREE_NS;
export interface RoverModel {
  root: THREE_NS.Group;
  pieces: Record<PieceId, THREE_NS.Object3D[]>;
  head: THREE_NS.Group;
  wheels: { obj: THREE_NS.Object3D; side: 'left' | 'right' }[];
  led: THREE_NS.Mesh;
  /** 0 = assembled, 1 = spread apart (the "Parts" step). */
  explode(f: number): void;
  dispose(): void;
}

export const WHEEL_R = 0.0325;
export const SONAR_X = 0.13; // sensor face, ahead of the car's centre

export function buildRover(THREE: T, board: BoardId): RoverModel {
  const root = new THREE.Group();
  const pieces = {} as Record<PieceId, THREE_NS.Object3D[]>;
  const offsets: { obj: THREE_NS.Object3D; base: THREE_NS.Vector3; out: THREE_NS.Vector3 }[] = [];
  const mats: THREE_NS.Material[] = [], geos: THREE_NS.BufferGeometry[] = [];
  const mat = (color: number, extra: Partial<THREE_NS.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra }); mats.push(m); return m;
  };
  const box = (x: number, y: number, z: number, m: THREE_NS.Material) => { const g = new THREE.BoxGeometry(x, y, z); geos.push(g); const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; return o; };
  const cyl = (r: number, h: number, m: THREE_NS.Material, seg = 24) => { const g = new THREE.CylinderGeometry(r, r, h, seg); geos.push(g); const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
  const add = (id: PieceId, obj: THREE_NS.Object3D, out: [number, number, number]) => {
    (pieces[id] ??= []).push(obj); root.add(obj);
    offsets.push({ obj, base: obj.position.clone(), out: new THREE.Vector3(...out) });
  };

  const acrylic = mat(0xcfe8f5, { transparent: true, opacity: 0.55, roughness: 0.15 });
  const yellow = mat(0xf2c230), black = mat(0x1d2126, { roughness: 0.9 }), brass = mat(0xc9a24a, { metalness: 0.7, roughness: 0.35 });
  const pcbBlue = mat(0x1f6fb2), pcbRed = mat(0xc0392b), pcbBlack = mat(0x22262b), silver = mat(0xb9c2cc, { metalness: 0.8, roughness: 0.3 });
  const servoBlue = mat(0x2d6fd6), cell = mat(0x2a7bd4);

  const zBottom = 0.050, zMiddle = 0.078, zTop = 0.096, deckT = 0.003;
  const deck = (id: PieceId, len: number, z: number, x: number, out: number) => { const d = box(len, 0.13, deckT, acrylic); d.position.set(x, 0, z); add(id, d, [0, 0, out]); };
  deck('deckBottom', 0.24, zBottom, 0, 0);
  deck('deckMiddle', 0.24, zMiddle, 0, 0.09);
  deck('deckTop', 0.12, zTop, -0.06, 0.19);

  // Motors under the bottom deck, wheels on their shafts.
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const m = box(0.065, 0.022, 0.019, yellow); m.position.set(sx * 0.06, sy * 0.042, WHEEL_R); add('motors', m, [0, sy * 0.06, -0.01]);
    const w = new THREE.Group();
    const tyre = cyl(WHEEL_R, 0.027, black, 28), hub = cyl(0.018, 0.029, yellow, 12);
    w.add(tyre, hub); w.position.set(sx * 0.07, sy * 0.081, WHEEL_R);
    add('wheels', w, [sx * 0.03, sy * 0.1, 0]);
  }
  // Standoffs between the decks.
  for (const sx of [0.1, 0.03, -0.03, -0.1]) for (const sy of [1, -1]) {
    const s = cyl(0.0025, zMiddle - zBottom, brass, 8); s.rotation.x = Math.PI / 2; s.position.set(sx, sy * 0.055, (zBottom + zMiddle) / 2); add('standoffs', s, [0, 0, 0.04]);
  }
  for (const sx of [-0.01, -0.11]) for (const sy of [1, -1]) {
    const s = cyl(0.0025, zTop - zMiddle, brass, 8); s.rotation.x = Math.PI / 2; s.position.set(sx, sy * 0.05, (zMiddle + zTop) / 2); add('standoffs', s, [0, 0, 0.13]);
  }
  // Motor driver, front left of the middle deck.
  const drv = box(0.03, 0.025, 0.004, pcbRed); drv.position.set(0.05, 0.03, zMiddle + 0.006); add('driver', drv, [0.02, 0.05, 0.12]);
  // Controller behind it.
  const ctl = new THREE.Group();
  const board0 = board === 'uno' ? box(0.068, 0.053, 0.003, pcbBlue) : box(0.06, 0.05, 0.003, pcbBlack);
  ctl.add(board0);
  if (board === 'uno') { const chip = box(0.035, 0.008, 0.004, black); chip.position.set(0, -0.008, 0.004); const usb = box(0.016, 0.012, 0.011, silver); usb.position.set(-0.03, 0.02, 0.007); ctl.add(chip, usb); }
  else { const dev = box(0.05, 0.026, 0.003, pcbBlack); dev.position.z = 0.008; const can = box(0.018, 0.016, 0.003, silver); can.position.set(0.012, 0, 0.0105); ctl.add(dev, can); }
  ctl.position.set(-0.005, -0.005, zMiddle + 0.012); add('controller', ctl, [0, -0.04, 0.15]);
  // Servo and the sensor head that turns on it.
  const servo = box(0.023, 0.012, 0.022, servoBlue); servo.position.set(0.1, 0, zMiddle + 0.008); add('servo', servo, [0.05, 0, 0.1]);
  const head = new THREE.Group(); head.position.set(0.105, 0, zMiddle + 0.03);
  const sonar = new THREE.Group();
  const pcb = box(0.003, 0.045, 0.02, pcbBlue); sonar.add(pcb);
  for (const sy of [1, -1]) { const t = cyl(0.008, 0.012, silver, 16); t.rotation.z = Math.PI / 2; t.position.set(0.007, sy * 0.013, 0); sonar.add(t); }
  sonar.position.set(0.02, 0, 0.004); head.add(sonar);
  add('sonar', head, [0.07, 0, 0.14]);
  // Battery holder with two cells on the top deck.
  const bat = new THREE.Group(); const holder = box(0.077, 0.042, 0.016, black); bat.add(holder);
  for (const sy of [1, -1]) { const c = cyl(0.009, 0.065, cell, 16); c.rotation.z = Math.PI / 2; c.position.set(0, sy * 0.0105, 0.006); bat.add(c); }
  bat.position.set(-0.06, 0, zTop + 0.01); add('battery', bat, [-0.04, 0, 0.22]);
  const sw = box(0.012, 0.006, 0.008, black); sw.position.set(-0.02, 0.058, zTop + 0.006); add('switch', sw, [0, 0.06, 0.2]);
  const ledMat = mat(0x7a1010, { emissive: 0x000000 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), ledMat); geos.push(led.geometry); led.position.set(0.035, -0.045, zMiddle + 0.008); add('led', led, [0.02, -0.06, 0.12]);
  const buz = cyl(0.006, 0.009, black, 16); buz.rotation.x = Math.PI / 2; buz.position.set(0.0, 0.055, zTop + 0.006); add('buzzer', buz, [0, 0.07, 0.2]);

  // Jumper wires: soft curves from the shield to each part.
  const wireTo = (from: [number, number, number], to: [number, number, number], color: number) => {
    const mid = new THREE.Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, Math.max(from[2], to[2]) + 0.02);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(...from), mid, new THREE.Vector3(...to)]);
    const g = new THREE.TubeGeometry(curve, 16, 0.0012, 5, false); geos.push(g);
    const w = new THREE.Mesh(g, mat(color)); add('wires', w, [0, 0, 0.15]);
  };
  const shield: [number, number, number] = [-0.005, -0.005, zMiddle + 0.02];
  wireTo(shield, [0.05, 0.03, zMiddle + 0.01], 0xf0a020);
  wireTo([-0.01, 0.0, zMiddle + 0.02], [0.05, 0.035, zMiddle + 0.01], 0x2f9e44);
  wireTo([0.0, -0.01, zMiddle + 0.02], [0.1, 0.0, zMiddle + 0.02], 0xe8590c);
  wireTo([0.005, 0.01, zMiddle + 0.02], [0.125, 0.01, zMiddle + 0.04], 0x1c7ed6);
  wireTo([0.0, -0.02, zMiddle + 0.02], [0.035, -0.045, zMiddle + 0.01], 0xc92a2a);
  wireTo([-0.02, 0.01, zMiddle + 0.02], [0.0, 0.055, zTop + 0.008], 0x862e9c);

  const wheels = (pieces.wheels ?? []).map((obj) => ({ obj, side: (obj.position.y > 0 ? 'left' : 'right') as 'left' | 'right' }));
  return {
    root, pieces, head, wheels, led,
    explode(f) { for (const o of offsets) o.obj.position.copy(o.base).addScaledVector(o.out, f); },
    dispose() { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); },
  };
}

/** Light the LED (the Drive step's actuators). */
export function setLed(model: RoverModel, on: boolean) {
  const m = model.led.material as THREE_NS.MeshStandardMaterial;
  m.emissive.setHex(on ? 0xff2020 : 0x000000); m.emissiveIntensity = on ? 2.5 : 0; m.color.setHex(on ? 0xff4040 : 0x7a1010);
}
