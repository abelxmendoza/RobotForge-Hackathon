/* Rover field checks — a port of src/robotforge/rover.py.
 *
 * Slope climb, step climb and battery runtime: first-order estimates
 * from the spec's own numbers, each naming its assumptions. A check
 * whose inputs are missing is NOT_CHECKED with the field named.
 * tests/test_rover.py runs this file under node and compares it with
 * the Python on the example specs. */

export const G = 9.81;
export const USABLE_TORQUE_FRACTION = 0.4;
export const STEP_FRACTION = 0.4;
export const MARGIN_OK = 1.5;
export const DRIVE_EFFICIENCY = 0.5;
export const ELECTRONICS_W_DEFAULT = 5.0;
export const MOTOR_NO_LOAD_W = 2.0;
export const SKID_FACTOR = 1.5;
export const TERRAINS: Record<string, number> = {
  indoor: 0.015,
  outdoor: 0.05,
  rough: 0.15,
};
const USABLE_CAPACITY: Record<string, number> = {
  lipo: 0.8, liion: 0.8, lifepo4: 0.9, nimh: 0.8, lead_acid: 0.5,
};
const GROUND = ['differential', 'skid_steer', 'ackermann', 'mecanum', 'tracked'];

export type RoverStatus = 'PASS' | 'MARGINAL' | 'FAIL' | 'NOT_CHECKED';

export interface RoverCheck {
  name: string;
  status: RoverStatus;
  summary: string;
  value: number | null;
  unit: string;
  assumptions: string[];
}

export interface RoverOptions {
  slopeDeg?: number;
  stepM?: number;
  terrain?: string;
  speedMps?: number;
  electronicsW?: number;
  targetMin?: number;
}

/* Loose spec shape: the Garage edits raw JSON, so every field is
 * read defensively. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

function verdict(margin: number): RoverStatus {
  if (margin >= MARGIN_OK) return 'PASS';
  if (margin >= 1.0) return 'MARGINAL';
  return 'FAIL';
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const pct = (v: number) => Math.round(v * 100) + '%';

export function maxSlopeDeg(spec: Spec, crr: number): number | null {
  if (!spec.wheel || !spec.motor || !spec.motor.stall_torque_nm) return null;
  const r = spec.wheel.diameter_m / 2;
  const force = (spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION * spec.motor.count) / r;
  const k = force / (spec.mass_kg * G);
  const rho = Math.hypot(1, crr);
  if (k >= rho) return 90;
  return Math.max(0, ((Math.asin(k / rho) - Math.atan(crr)) * 180) / Math.PI);
}

export function checkSlope(spec: Spec, slopeDeg: number, crr: number): RoverCheck {
  const name = 'rover.slope_climb';
  if (!spec.wheel) return { name, status: 'NOT_CHECKED', summary: 'no wheels in this spec', value: null, unit: '', assumptions: [] };
  if (!spec.motor || !spec.motor.stall_torque_nm) {
    return { name, status: 'NOT_CHECKED', summary: 'needs motor.stall_torque_nm (from the motor datasheet)', value: null, unit: '', assumptions: [] };
  }
  const r = spec.wheel.diameter_m / 2;
  const a = (slopeDeg * Math.PI) / 180;
  const need = spec.mass_kg * G * (Math.sin(a) + crr * Math.cos(a)) * r;
  const have = spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION * spec.motor.count;
  const margin = need > 0 ? have / need : Infinity;
  const best = maxSlopeDeg(spec, crr) as number;
  return {
    name,
    status: verdict(margin),
    summary: `${slopeDeg}° slope needs ${need.toFixed(2)} N·m at the wheels; usable ${have.toFixed(2)} N·m (${margin.toFixed(1)}× margin). Steepest holdable slope ≈ ${best.toFixed(0)}°.`,
    value: r1(best),
    unit: 'deg',
    assumptions: [`usable torque = ${pct(USABLE_TORQUE_FRACTION)} of stall`, `rolling resistance ${crr}`, 'traction is sufficient (no wheel slip)'],
  };
}

export function checkStep(spec: Spec, stepM: number): RoverCheck {
  const name = 'rover.step_climb';
  if (!spec.wheel) return { name, status: 'NOT_CHECKED', summary: 'no wheels in this spec', value: null, unit: '', assumptions: [] };
  const wheelLimit = STEP_FRACTION * spec.wheel.diameter_m;
  const limits = [wheelLimit];
  let detail = `wheels clear ≈ ${(wheelLimit * 1000).toFixed(0)} mm`;
  if (typeof spec.ground_clearance_m === 'number') {
    limits.push(spec.ground_clearance_m);
    detail += `, belly clears ${(spec.ground_clearance_m * 1000).toFixed(0)} mm`;
  }
  const limit = Math.min(...limits);
  const margin = stepM > 0 ? limit / stepM : Infinity;
  return {
    name,
    status: verdict(margin),
    summary: `${(stepM * 1000).toFixed(0)} mm step: ${detail}; limit ${(limit * 1000).toFixed(0)} mm (${margin.toFixed(1)}× margin).`,
    value: r4(limit),
    unit: 'm',
    assumptions: [`rigid wheels climb ≈ ${pct(STEP_FRACTION)} of diameter`, 'the belly must clear the step edge while crossing'],
  };
}

export function estimateRuntime(spec: Spec, speedMps: number, crr: number, electronicsW: number) {
  const usable = USABLE_CAPACITY[String(spec.battery.chemistry).toLowerCase()] ?? 0.8;
  const energy = (spec.battery.voltage_v * spec.battery.capacity_mah) / 1000 * usable;
  const skid = spec.drivetrain === 'skid_steer' || spec.drivetrain === 'tracked' ? SKID_FACTOR : 1;
  const driveW = (spec.mass_kg * G * crr * skid * speedMps) / DRIVE_EFFICIENCY;
  const draw = driveW + MOTOR_NO_LOAD_W * spec.motor.count + electronicsW;
  return { hours: energy / draw, energy, draw };
}

export function checkRuntime(spec: Spec, speedMps: number, crr: number, electronicsW: number, targetMin: number): RoverCheck {
  const { hours, energy, draw } = estimateRuntime(spec, speedMps, crr, electronicsW);
  const minutes = hours * 60;
  const margin = targetMin > 0 ? minutes / targetMin : Infinity;
  return {
    name: 'rover.runtime',
    status: verdict(margin),
    summary: `≈ ${minutes.toFixed(0)} min driving at ${speedMps} m/s (${energy.toFixed(0)} Wh usable, ≈ ${draw.toFixed(1)} W draw) against a ${targetMin} min target.`,
    value: r1(minutes),
    unit: 'min',
    assumptions: [`drive efficiency ${pct(DRIVE_EFFICIENCY)}`, `${MOTOR_NO_LOAD_W} W no-load per motor`, `electronics draw ${electronicsW} W`, `skid-steer/tracked scrub ×${SKID_FACTOR}`, 'flat ground, steady speed; slopes and stops cost more'],
  };
}

export function isRover(spec: Spec): boolean {
  return Boolean(spec && GROUND.includes(spec.drivetrain) && spec.wheel && spec.motor && spec.battery);
}

export function checkRover(spec: Spec, opts: RoverOptions) {
  const terrain = opts.terrain ?? 'outdoor';
  const crr = TERRAINS[terrain] ?? TERRAINS.outdoor;
  return {
    robot: spec.name,
    terrain,
    checks: [
      checkSlope(spec, opts.slopeDeg ?? 15, crr),
      checkStep(spec, opts.stepM ?? 0.05),
      checkRuntime(spec, opts.speedMps ?? 0.5, crr, opts.electronicsW ?? ELECTRONICS_W_DEFAULT, opts.targetMin ?? 30),
    ],
  };
}
