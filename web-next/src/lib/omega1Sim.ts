/* The Omega1 simulator page (/simulator/, 2026-11-10): drive Omega1's
 * 3D twin in a small walled pen, watch its motors and its ultrasonic
 * sensor on live gauges, or let a self-running tour drive it.
 *
 * Pure, zero imports (tests/test_omega1_simulator.py runs it under
 * node). The page draws what this module computes.
 *
 * Where every number comes from — the honesty rules:
 *  - DOCUMENTED facts (drivetrain, four motors, the PCA9685 channel
 *    map, the HC-SR04's GPIO pins, the battery's 7.4 V) come from
 *    docs/omega1/omega1.extracted.json and omega1.template.json.
 *  - The real robot's size, mass and wheel are MEASURE_ME in those
 *    records: nobody has measured them. The physics can't run without
 *    them, so this page takes them from the 3D twin itself (the
 *    ProjectSim rover model, assets/omega1-twin/omega1-rover.glb) and
 *    labels each one TWIN_ESTIMATE. They are what the model is, not
 *    what the robot is.
 *  - Omega1's records have no motor datasheet, so the stall torque is
 *    a STAND_IN: a typical figure for the yellow TT-class gearmotor,
 *    named as such.
 *  - The repo's CODE_DEFAULT wheel radius (0.05 m), track (0.20 m) and
 *    max rpm (300) are flagged wrong-sized by the extraction and are
 *    not used. No speed is shown anywhere on the page: the sandbox's
 *    drive command is a fixed setting for every robot, not Omega1's
 *    top speed.
 *  - The tour's "stop before the wall" is a rule of this page, not
 *    code from Omega1's repo, and the page says so. */

export type SimBasis = 'DOCUMENTED' | 'TWIN_ESTIMATE' | 'STAND_IN';

export interface SimNumber {
  path: string;
  label: string;
  value: number;
  unit: 'm' | 'kg' | 'N·m';
  basis: SimBasis;
  source: string;
}

const TWIN = 'the ProjectSim rover model (omega1-rover.glb)';

/* Read off the twin's own mesh bounds (glTF, metres; the model is at
 * real-world scale): whole model 176 × 140 × 190 mm (W × H × L);
 * each wheel link 67 mm across and 27 mm wide; the chassis' lowest
 * point between the axles is 26 mm off the floor. */
export const OMEGA1_SIM_NUMBERS: SimNumber[] = [
  { path: 'length_m', label: 'Body length', value: 0.19, unit: 'm', basis: 'TWIN_ESTIMATE', source: `Front to back of the chassis in ${TWIN}.` },
  { path: 'width_m', label: 'Body width between the wheels', value: 0.122, unit: 'm', basis: 'TWIN_ESTIMATE', source: `The model is 176 mm across the tyres; minus two 27 mm tyres.` },
  { path: 'height_m', label: 'Height', value: 0.14, unit: 'm', basis: 'TWIN_ESTIMATE', source: `Floor to the top of the sensor head in ${TWIN}.` },
  { path: 'ground_clearance_m', label: 'Ground clearance', value: 0.026, unit: 'm', basis: 'TWIN_ESTIMATE', source: `Lowest chassis point between the axles in ${TWIN}.` },
  { path: 'wheel.diameter_m', label: 'Wheel diameter', value: 0.067, unit: 'm', basis: 'TWIN_ESTIMATE', source: `The wheel links of ${TWIN}.` },
  { path: 'wheel.width_m', label: 'Tyre width', value: 0.027, unit: 'm', basis: 'TWIN_ESTIMATE', source: `The wheel links of ${TWIN}.` },
  { path: 'mass_kg', label: 'Mass', value: 0.6835, unit: 'kg', basis: 'TWIN_ESTIMATE', source: 'ProjectSim’s own mass estimate for the rover model.' },
  { path: 'motor.stall_torque_nm', label: 'Motor stall torque', value: 0.08, unit: 'N·m', basis: 'STAND_IN', source: 'A typical figure for a yellow 1:48 TT-class gearmotor (about 0.8 kg·cm at 6 V). Omega1’s records name no motor datasheet.' },
];

export const BASIS_TEXT: Record<SimBasis, string> = {
  DOCUMENTED: 'From Omega1’s own records',
  TWIN_ESTIMATE: 'Read off the 3D twin — not measured on the robot',
  STAND_IN: 'Stand-in — Omega1’s records have no value',
};

/* A spec the drive sandbox can run: the documented seed (passed in,
 * so this module stays import-free) plus the numbers above. Returns a
 * new object; the seed is not changed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function omega1SimSpec(seed: any): any {
  const spec = JSON.parse(JSON.stringify(seed));
  for (const n of OMEGA1_SIM_NUMBERS) {
    const keys = n.path.split('.');
    let at = spec;
    for (const k of keys.slice(0, -1)) at = at[k] ??= {};
    at[keys[keys.length - 1]] = n.value;
  }
  spec.simulation_numbers = 'Size, mass and wheel read off the 3D twin; motor torque is a stand-in. Not measured on the robot.';
  return spec;
}

/* ---------- Motors: which PCA9685 channel each wheel is on ---------- */

export type WheelId = 'front_left' | 'rear_left' | 'front_right' | 'rear_right';
export type Turning = 'forward' | 'backward' | 'stopped';

/* DOCUMENTED: README motor table (omega1.extracted.json,
 * motors.channel_map.*). */
export const OMEGA1_CHANNELS: Record<WheelId, { forward: number; backward: number; label: string; side: 'left' | 'right' }> = {
  front_left: { forward: 1, backward: 0, label: 'Front left', side: 'left' },
  rear_left: { forward: 2, backward: 3, label: 'Rear left', side: 'left' },
  front_right: { forward: 7, backward: 6, label: 'Front right', side: 'right' },
  rear_right: { forward: 5, backward: 4, label: 'Rear right', side: 'right' },
};
export const WHEEL_ORDER: WheelId[] = ['front_left', 'rear_left', 'front_right', 'rear_right'];

export interface WheelCommand {
  id: WheelId;
  label: string;
  turning: Turning;
  /** 0..1 — how hard this wheel is asked to turn, against the sandbox's
   * strongest command. A share of the command, not a speed. */
  effort: number;
  /** The PCA9685 channel this command lights; null when stopped. */
  channel: number | null;
}

/* The sandbox's mixing, the same formula drivePhysics applies to every
 * wheel (lib/drivePhysics.ts): rim command = cmd × throttle − gain ×
 * turn × y, with y the wheel's sideways offset (+ left). */
export function wheelCommands(throttle: number, turn: number, halfTrackM: number, cmdMps: number, turnGain: number): WheelCommand[] {
  const side = (s: 'left' | 'right') => cmdMps * throttle - turnGain * turn * (s === 'left' ? halfTrackM : -halfTrackM);
  const most = cmdMps + turnGain * halfTrackM;
  return WHEEL_ORDER.map((id) => {
    const c = OMEGA1_CHANNELS[id];
    const v = side(c.side);
    const turning: Turning = Math.abs(v) < 1e-9 ? 'stopped' : v > 0 ? 'forward' : 'backward';
    return {
      id,
      label: c.label,
      turning,
      effort: Math.min(1, Math.abs(v) / most),
      channel: turning === 'stopped' ? null : turning === 'forward' ? c.forward : c.backward,
    };
  });
}

/* ---------- The pen and the HC-SR04 ---------- */

/** DOCUMENTED pins; CODE_DEFAULT range from sensor_node.py (0.02–4 m). */
export const HC_SR04 = { trigGpio: 27, echoGpio: 22, minM: 0.02, maxM: 4 };

export interface PenWall { x: number; y: number; hx: number; hy: number }
/** The walled pen the robot drives in: 3.6 m square inside, plus one
 * low crate to drive around. Wall height is drawn, not sensed. */
export const PEN_HALF = 1.8;
export const PEN_WALL_H = 0.16;
export const PEN_WALLS: PenWall[] = [
  { x: PEN_HALF + 0.05, y: 0, hx: 0.05, hy: PEN_HALF + 0.1 },
  { x: -PEN_HALF - 0.05, y: 0, hx: 0.05, hy: PEN_HALF + 0.1 },
  { x: 0, y: PEN_HALF + 0.05, hx: PEN_HALF + 0.1, hy: 0.05 },
  { x: 0, y: -PEN_HALF - 0.05, hx: PEN_HALF + 0.1, hy: 0.05 },
  { x: 1.1, y: -0.9, hx: 0.2, hy: 0.2 },
];

/** Heading in degrees from a z-up quaternion (0 = facing +x, the start). */
export function yawDeg(q: { qx: number; qy: number; qz: number; qw: number }): number {
  const { qx, qy, qz, qw } = q;
  return (Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) * 180) / Math.PI;
}

/** Signed change between two headings, wrapped to (-180, 180]. */
export function headingDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/* One ray straight ahead from the sensor (the HC-SR04's real beam is a
 * cone of roughly 15°; a single ray is the simplification, and the page
 * says so). Returns metres from the sensor to the first wall face, or
 * null when nothing is inside the sensor's range ("no echo"). */
export function ultrasonicRange(x: number, y: number, headingDeg: number, frontOffsetM: number, walls: PenWall[] = PEN_WALLS): number | null {
  const a = (headingDeg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const sx = x + dx * frontOffsetM, sy = y + dy * frontOffsetM;
  let best = Infinity;
  for (const w of walls) {
    // Slab test against the wall's footprint.
    let t0 = -Infinity, t1 = Infinity;
    for (const [s, d, c, h] of [[sx, dx, w.x, w.hx], [sy, dy, w.y, w.hy]] as const) {
      if (Math.abs(d) < 1e-12) { if (s < c - h || s > c + h) { t0 = Infinity; break; } continue; }
      let ta = (c - h - s) / d, tb = (c + h - s) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && t1 >= 0) best = Math.min(best, Math.max(0, t0));
  }
  if (!Number.isFinite(best) || best > HC_SR04.maxM) return null;
  return Math.max(HC_SR04.minM, best);
}

/* ---------- The self-running tour ---------- */

export type TourUntil =
  | { kind: 'time'; s: number }
  | { kind: 'turned'; deg: number }
  | { kind: 'range'; belowM: number; maxS: number };

export interface TourStep {
  id: string;
  title: string;
  say: string;
  throttle: number;
  turn: number;
  until: TourUntil;
  /** Camera framing for the step. */
  camera: 'orbit' | 'chase' | 'top';
}

/** The tour's stop rule: a rule of this page, not Omega1's code. */
export const TOUR_STOP_M = 0.3;

export const OMEGA1_TOUR: TourStep[] = [
  {
    id: 'meet', title: 'Meet Omega1', camera: 'orbit', throttle: 0, turn: 0, until: { kind: 'time', s: 4 },
    say: 'This is Omega1’s 3D twin: a Freenove 4WD car with a Raspberry Pi 4B for a brain and a PCA9685 hat driving four DC gearmotors. Its size and mass here come from the 3D model, not a tape measure.',
  },
  {
    id: 'forward', title: 'All four wheels forward', camera: 'chase', throttle: 1, turn: 0, until: { kind: 'time', s: 2.5 },
    say: 'To drive straight, the Pi tells the PCA9685 to light the four forward channels: 1 and 2 on the left, 7 and 5 on the right.',
  },
  {
    id: 'spin-left', title: 'Turn on the spot', camera: 'top', throttle: 0, turn: 1, until: { kind: 'turned', deg: 90 },
    say: 'Omega1 has no steering. It turns like a tank (skid steer): the left wheels run backward on channels 0 and 3 while the right wheels run forward on 7 and 5.',
  },
  {
    id: 'to-wall', title: 'Drive at the wall', camera: 'chase', throttle: 1, turn: 0, until: { kind: 'range', belowM: TOUR_STOP_M, maxS: 12 },
    say: 'The HC-SR04 on the front pings ahead (trigger on GPIO 27, echo on GPIO 22). Watch its reading fall on the gauge as the wall gets closer.',
  },
  {
    id: 'stop', title: 'Stop short', camera: 'orbit', throttle: 0, turn: 0, until: { kind: 'time', s: 2.5 },
    say: 'Stopped 30 cm from the wall. That stop is a rule this tour adds; it is not code from Omega1’s repo.',
  },
  {
    id: 'back-off', title: 'Back up', camera: 'chase', throttle: -1, turn: 0, until: { kind: 'time', s: 1.5 },
    say: 'Reverse is the same four motors on their backward channels: 0 and 3 on the left, 6 and 4 on the right.',
  },
  {
    id: 'spin-right', title: 'Turn right', camera: 'top', throttle: 0, turn: -1, until: { kind: 'turned', deg: 90 },
    say: 'Turning right swaps the sides: left wheels forward (1 and 2), right wheels backward (6 and 4).',
  },
  {
    id: 'your-turn', title: 'Your turn', camera: 'chase', throttle: 0, turn: 0, until: { kind: 'time', s: 0 },
    say: 'That’s the tour. Drive it yourself with the arrow keys, WASD or the buttons, and keep an eye on the gauges.',
  },
];

export interface TourProgress { elapsedS: number; turnedDeg: number; rangeM: number | null }

/** Has this step finished? */
export function tourStepDone(step: TourStep, p: TourProgress): boolean {
  const u = step.until;
  if (u.kind === 'time') return p.elapsedS >= u.s;
  if (u.kind === 'turned') return Math.abs(p.turnedDeg) >= u.deg || p.elapsedS >= 12;
  return (p.rangeM !== null && p.rangeM <= u.belowM) || p.elapsedS >= u.maxS;
}
