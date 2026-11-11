/* Drive train analysis for the Workshop's Drive train tab.
 *
 * Pure, zero imports: node runs it directly in tests/test_vex.py.
 * Every number is a computation on the spec's own recorded fields;
 * a number whose inputs are missing is null and the tab names the
 * missing field instead of guessing.
 *
 * Conventions (the same as src/robotforge/schema.py `Gearing`):
 *  - motor.stall_torque_nm is the torque each motor delivers AT THE
 *    WHEEL — what rover.ts, driveMath.ts and the sandbox read.
 *  - the optional `gearing` block says where that comes from:
 *      wheel rpm    = motor_free_rpm × driving_teeth / driven_teeth
 *      wheel torque = motor_shaft_stall_nm × driven_teeth / driving_teeth
 *  - VEX V5 numbers are VEX's published motor ratings, mirrored from
 *    src/robotforge/vex.py.
 */

export const ASSUMED_TRACTION_MU = 0.85; // = driveMath SIM_TYRE_FRICTION
export const GRAVITY = 9.81;
export const V5RC_MOTOR_POWER_CAP_W = 88;

export interface Cartridge { id: string; label: string; ratio: string; freeRpm: number; stallTorqueNm: number }
export const V5_CARTRIDGES: Cartridge[] = [
  { id: 'red', label: 'Red (torque)', ratio: '36:1', freeRpm: 100, stallTorqueNm: 2.1 },
  { id: 'green', label: 'Green (standard)', ratio: '18:1', freeRpm: 200, stallTorqueNm: 1.05 },
  { id: 'blue', label: 'Blue (speed)', ratio: '6:1', freeRpm: 600, stallTorqueNm: 0.35 },
];
export const V5_MOTOR_POWERS_W = [11, 5.5];
/** VEX high-strength gear sizes (teeth). */
export const VEX_GEAR_TEETH = [12, 36, 48, 60, 72, 84];
/** Nominal VEX wheel sizes, metres. */
export const VEX_WHEELS: { label: string; diameterM: number }[] = [
  { label: '2.75 in', diameterM: 0.06985 },
  { label: '3.25 in', diameterM: 0.08255 },
  { label: '4 in', diameterM: 0.1016 },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

export interface Gearing {
  motorFreeRpm: number | null;
  motorShaftStallNm: number | null;
  drivingTeeth: number;
  drivenTeeth: number;
  motorPowerW: number | null;
  platform: string | null;
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export function readGearing(spec: Spec): Gearing | null {
  const g = spec && typeof spec === 'object' ? spec.gearing : null;
  if (!g || typeof g !== 'object') return null;
  return {
    motorFreeRpm: pos(g.motor_free_rpm),
    motorShaftStallNm: pos(g.motor_shaft_stall_nm),
    drivingTeeth: pos(g.driving_teeth) ?? 1,
    drivenTeeth: pos(g.driven_teeth) ?? 1,
    motorPowerW: pos(g.motor_power_w),
    platform: typeof g.platform === 'string' ? g.platform : null,
  };
}

export const isVexV5 = (spec: Spec): boolean => (readGearing(spec)?.platform ?? '').toLowerCase() === 'vex_v5';
export const isVexIq = (spec: Spec): boolean => (readGearing(spec)?.platform ?? '').toLowerCase() === 'vex_iq';
/** VEX IQ Smart Motor (kb.vex.com): 120 rpm, 0.414 N·m stall, 1.4 W. Mirrors src/robotforge/vex.py. */
export const IQ_MOTOR = { freeRpm: 120, stallTorqueNm: 0.414, powerW: 1.4 } as const;

export interface WheelSpot { x: number; y: number; driven: boolean; side: 'left' | 'right' }

export interface DriveLayout {
  kind: string;
  label: string;
  /** How the robot steers, in a sentence. */
  steering: string;
  wheels: WheelSpot[];
  /** Wheels the 3D twin and Gazebo model draw (they model up to 4). */
  twinWheelNote: string | null;
}

const LAYOUT_TEXT: Record<string, { label: string; steering: string }> = {
  differential: { label: 'Differential drive', steering: 'Two driven wheels on one axle; it turns by running them at different speeds. A caster holds it level.' },
  skid_steer: { label: 'Tank drive (skid-steer)', steering: 'Each side is driven together; it turns by running the left and right sides at different speeds, so the wheels scrub sideways in a turn.' },
  mecanum: { label: 'Mecanum (holonomic)', steering: 'Four independently driven mecanum wheels; mixing their speeds drives it forward, sideways, or spinning in place.' },
  ackermann: { label: 'Car-like (Ackermann)', steering: 'Front wheels steer like a car; it cannot turn in place.' },
  tracked: { label: 'Tracked', steering: 'Each side drives a track; it turns like a tank drive, with more scrub.' },
};

export function driveLayout(spec: Spec): DriveLayout | null {
  const kind = String(spec?.drivetrain ?? '');
  const text = LAYOUT_TEXT[kind];
  const count = pos(spec?.wheel?.count);
  if (!text || !count) return null;
  const n = Math.round(count);
  const motors = Math.round(pos(spec?.motor?.count) ?? 0);
  const L = pos(spec?.length_m) ?? 0.4;
  const W = pos(spec?.width_m) ?? 0.3;
  const wheels: WheelSpot[] = [];
  const axles = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const axle = Math.floor(i / 2);
    const x = n === 2 ? 0 : axles === 1 ? 0 : L / 2 - (axle * L) / (axles - 1);
    const side = i % 2 === 0 ? 'left' : 'right';
    wheels.push({ x, y: side === 'left' ? W / 2 : -W / 2, side, driven: i < motors });
  }
  return {
    kind,
    label: `${n}-wheel ${text.label.toLowerCase()}`,
    steering: text.steering,
    wheels,
    // The 3D twin, URDF and Gazebo model draw every wheel (6-wheel drives
    // included); only the browser drive simulator stops at 6.
    twinWheelNote: n > 6 ? `The drive simulator handles up to 6 wheels; the 3D twin, the Gazebo model and the numbers on this tab use all ${n}.` : null,
  };
}

export interface DriveNumbers {
  /** Wheel speed with no load, rpm. */
  wheelRpm: number | null;
  /** Top speed with no load, m/s (free speed; a loaded robot is slower). */
  freeSpeedMps: number | null;
  /** Torque each motor delivers at its wheel, N·m (motor.stall_torque_nm). */
  wheelStallNm: number | null;
  /** Total stall push of the driven wheels, N. */
  stallPushN: number | null;
  /** Traction limit of the driven wheels on a μ=0.85 floor, N. */
  tractionPushN: number | null;
  /** Which limit sets the most the robot can push. */
  pushLimitedBy: 'motors' | 'traction' | null;
  /** The two torque sources disagree by more than 5%. */
  torqueMismatch: { fromGearing: number; recorded: number } | null;
  missing: string[];
}

export function driveNumbers(spec: Spec, override?: Partial<Gearing>): DriveNumbers {
  const missing: string[] = [];
  const base = readGearing(spec);
  const g: Gearing | null = base || override ? { motorFreeRpm: null, motorShaftStallNm: null, drivingTeeth: 1, drivenTeeth: 1, motorPowerW: null, platform: null, ...(base ?? {}), ...(override ?? {}) } : null;
  const d = pos(spec?.wheel?.diameter_m);
  const motors = pos(spec?.motor?.count);
  const wheels = pos(spec?.wheel?.count);
  const mass = pos(spec?.mass_kg);
  if (!d) missing.push('wheel.diameter_m');
  if (!motors) missing.push('motor.count');

  const ratio = g ? g.drivingTeeth / g.drivenTeeth : 1;
  const wheelRpm = g?.motorFreeRpm ? g.motorFreeRpm * ratio : null;
  if (!wheelRpm) missing.push('gearing.motor_free_rpm');
  const freeSpeedMps = wheelRpm && d ? (wheelRpm / 60) * Math.PI * d : null;

  const fromGearing = g?.motorShaftStallNm ? g.motorShaftStallNm / ratio : null;
  const recorded = pos(spec?.motor?.stall_torque_nm);
  // An override (a what-if) always speaks for itself; otherwise the
  // spec's recorded wheel torque is what every other check uses.
  const wheelStallNm = override && fromGearing ? fromGearing : recorded ?? fromGearing;
  if (!wheelStallNm) missing.push('motor.stall_torque_nm');
  const torqueMismatch = !override && fromGearing && recorded && Math.abs(fromGearing - recorded) > 0.05 * fromGearing
    ? { fromGearing, recorded } : null;

  const stallPushN = wheelStallNm && motors && d ? (wheelStallNm * motors) / (d / 2) : null;
  if (!mass) missing.push('mass_kg');
  if (!wheels) missing.push('wheel.count');
  const drivenFraction = motors && wheels ? Math.min(1, motors / wheels) : null;
  const tractionPushN = mass && drivenFraction != null ? ASSUMED_TRACTION_MU * mass * GRAVITY * drivenFraction : null;
  const pushLimitedBy = stallPushN != null && tractionPushN != null ? (stallPushN < tractionPushN ? 'motors' : 'traction') : null;
  return { wheelRpm, freeSpeedMps, wheelStallNm, stallPushN, tractionPushN, pushLimitedBy, torqueMismatch, missing };
}

export interface MotorBudget { capW: number; driveW: number; otherW: number; usedW: number; leftW: number; ok: boolean }

/** Drive motors' share of the V5RC motor-power cap (V5 specs only). */
export function v5rcBudget(spec: Spec, otherMotorsW = 0, override?: Partial<Gearing>): MotorBudget | null {
  if (!isVexV5(spec)) return null;
  const powerW = override?.motorPowerW ?? readGearing(spec)?.motorPowerW;
  const motors = pos(spec?.motor?.count);
  if (!powerW || !motors) return null;
  const driveW = powerW * motors;
  const usedW = driveW + otherMotorsW;
  return { capW: V5RC_MOTOR_POWER_CAP_W, driveW, otherW: otherMotorsW, usedW, leftW: V5RC_MOTOR_POWER_CAP_W - usedW, ok: usedW <= V5RC_MOTOR_POWER_CAP_W + 1e-9 };
}

export interface VexChoice { cartridgeId: string; drivingTeeth: number; drivenTeeth: number; motorPowerW: number }

/** The gearing block a VEX choice stands for. A 5.5 W motor has a fixed 200 rpm output. */
export function vexGearing(choice: VexChoice): Gearing {
  const c = choice.motorPowerW === 5.5 ? { freeRpm: 200, stallTorqueNm: 1.05 / 2 } : (V5_CARTRIDGES.find((x) => x.id === choice.cartridgeId) ?? V5_CARTRIDGES[1]);
  return { platform: 'vex_v5', motorFreeRpm: c.freeRpm, motorShaftStallNm: c.stallTorqueNm, drivingTeeth: choice.drivingTeeth, drivenTeeth: choice.drivenTeeth, motorPowerW: choice.motorPowerW };
}

/** The current spec's VEX choice, for the tab's controls. */
export function currentVexChoice(spec: Spec): VexChoice {
  const g = readGearing(spec);
  const cart = V5_CARTRIDGES.find((c) => c.freeRpm === g?.motorFreeRpm) ?? V5_CARTRIDGES[1];
  return { cartridgeId: cart.id, drivingTeeth: g?.drivingTeeth ?? 1, drivenTeeth: g?.drivenTeeth ?? 1, motorPowerW: g?.motorPowerW ?? 11 };
}

/** A copy of the spec with the gearing applied, and the wheel torque
 *  every other check reads kept in step with it. */
export function applyGearing(spec: Spec, g: Gearing): Spec {
  const next = JSON.parse(JSON.stringify(spec ?? {}));
  const block: Record<string, unknown> = { driving_teeth: g.drivingTeeth, driven_teeth: g.drivenTeeth };
  if (g.platform) block.platform = g.platform;
  if (g.motorFreeRpm) block.motor_free_rpm = g.motorFreeRpm;
  if (g.motorShaftStallNm) block.motor_shaft_stall_nm = g.motorShaftStallNm;
  if (g.motorPowerW) block.motor_power_w = g.motorPowerW;
  next.gearing = block;
  if (g.motorShaftStallNm) {
    next.motor = { ...(next.motor ?? {}) };
    next.motor.stall_torque_nm = Math.round((g.motorShaftStallNm * g.drivenTeeth / g.drivingTeeth) * 10000) / 10000;
  }
  return next;
}
