/* Pure drive-train math for the browser drive sandbox — the
 * prediction half of the sandbox. drivePhysics.ts (Rapier) simulates
 * a spec with two hard limits: tyre friction 0.85 and motor force
 * capped at 60% of the spec's recorded stall torque. Those constants
 * live HERE so the analysis below is provably about the same sandbox
 * the visitor drives — one source, imported by both.
 *
 * Everything in this file is a computation on the spec's declared
 * numbers (mass, wheel size, motor count, stall torque), made before
 * any simulation runs: the torque a manoeuvre demands, the friction
 * it needs, and how both compare with what the motors and the floor
 * can give. Assumptions are constants, printed wherever results are
 * shown — never buried:
 *  - ASSUMED_ACCEL_MPS2: the design acceleration the cases demand.
 *  - ASSUMED_ROLLING_RESISTANCE: rolling-resistance coefficient for
 *    hard wheels on a hard floor.
 *  - Weight is spread evenly over the wheels, so the driven wheels
 *    carry motorCount / wheelCount of the weight; every motor drives
 *    one wheel and the load splits evenly between motors. */

export const GRAVITY_MPS2 = 9.81;
/** The friction drivePhysics gives the floor and the tyres. */
export const SIM_TYRE_FRICTION = 0.85;
/** The fraction of stall torque the sandbox's motors may apply. */
export const SIM_USABLE_STALL_FRACTION = 0.6;
export const ASSUMED_ACCEL_MPS2 = 0.5;
export const ASSUMED_ROLLING_RESISTANCE = 0.015;

export interface DriveSpec {
  massKg: number;
  wheelRadiusM: number;
  wheelCount: number;
  motorCount: number;
  stallTorqueNm: number;
}

export interface DriveCase {
  slopeDeg: number;
  accelMps2: number;
}

/** Tangential force the drive must produce at the contact patches:
 *  accelerate the mass, hold it against gravity on the slope, and
 *  overcome rolling resistance. F = m·a + m·g·sinθ + Crr·m·g·cosθ. */
export function requiredForceN(
  massKg: number,
  c: DriveCase,
  rolling = ASSUMED_ROLLING_RESISTANCE,
): number {
  const th = (c.slopeDeg * Math.PI) / 180;
  return (
    massKg * c.accelMps2 +
    massKg * GRAVITY_MPS2 * Math.sin(th) +
    rolling * massKg * GRAVITY_MPS2 * Math.cos(th)
  );
}

/** Per-motor torque at the wheel: total force × wheel radius,
 *  split evenly across the motors. */
export function requiredTorquePerMotorNm(d: DriveSpec, c: DriveCase): number {
  return (requiredForceN(d.massKg, c) * d.wheelRadiusM) / d.motorCount;
}

export type TorqueBand = "within-usable" | "above-usable" | "beyond-stall";

/** Where the demand sits against the motor: under the sandbox's
 *  usable cap, under stall but above the cap (a real motor near
 *  stall barely turns, and the sandbox will not apply it), or past
 *  stall entirely (no motor state produces it). */
export function torqueBand(requiredNm: number, stallNm: number): TorqueBand {
  if (requiredNm > stallNm) return "beyond-stall";
  if (requiredNm > SIM_USABLE_STALL_FRACTION * stallNm) return "above-usable";
  return "within-usable";
}

export interface TractionResult {
  /** Friction coefficient the driven wheels must find: tangential
   *  force over the normal load the driven wheels carry. */
  requiredMu: number;
  drivenWeightFraction: number;
  availableMu: number;
  /** True when the sandbox floor's friction covers the demand. */
  ok: boolean;
}

export function requiredFriction(d: DriveSpec, c: DriveCase): TractionResult {
  const th = (c.slopeDeg * Math.PI) / 180;
  const drivenWeightFraction = d.motorCount / d.wheelCount;
  const normalN =
    drivenWeightFraction * d.massKg * GRAVITY_MPS2 * Math.cos(th);
  const requiredMu =
    normalN > 0 ? requiredForceN(d.massKg, c) / normalN : Infinity;
  return {
    requiredMu,
    drivenWeightFraction,
    availableMu: SIM_TYRE_FRICTION,
    ok: requiredMu <= SIM_TYRE_FRICTION,
  };
}

export interface StepAssessment {
  stepM: number;
  /** Step height over wheel radius — the geometry of the climb. */
  ratioToRadius: number;
  /** Quasi-statically, a wheel can roll over a step only below its
   *  own radius: at h = r the contact force's line passes through
   *  the axle and no finite torque rolls it up. Momentum is not
   *  modelled, and the verdict says so. */
  rollsQuasiStatically: boolean;
}

export function stepAssessment(wheelRadiusM: number, stepM: number): StepAssessment {
  return {
    stepM,
    ratioToRadius: stepM / wheelRadiusM,
    rollsQuasiStatically: stepM < wheelRadiusM,
  };
}

export interface DriveCaseResult extends DriveCase {
  id: string;
  label: string;
  forceN: number;
  torquePerMotorNm: number;
  pctOfStall: number;
  pctOfUsable: number;
  band: TorqueBand;
}

export interface DriveAnalysis {
  cases: DriveCaseResult[];
  /** Traction at the hardest case (steepest slope + acceleration). */
  traction: TractionResult;
}

const CASES: { id: string; label: string; slopeDeg: number; accelMps2: number }[] = [
  { id: "flat-accel", label: "Accelerate on the flat", slopeDeg: 0, accelMps2: ASSUMED_ACCEL_MPS2 },
  { id: "ramp-climb", label: "Climb the 10° ramp, steady speed", slopeDeg: 10, accelMps2: 0 },
  { id: "ramp-accel", label: "Accelerate up the 10° ramp", slopeDeg: 10, accelMps2: ASSUMED_ACCEL_MPS2 },
];

export function driveAnalysis(d: DriveSpec): DriveAnalysis {
  const usableNm = SIM_USABLE_STALL_FRACTION * d.stallTorqueNm;
  const cases = CASES.map((c) => {
    const torque = requiredTorquePerMotorNm(d, c);
    return {
      ...c,
      forceN: requiredForceN(d.massKg, c),
      torquePerMotorNm: torque,
      pctOfStall: (torque / d.stallTorqueNm) * 100,
      pctOfUsable: (torque / usableNm) * 100,
      band: torqueBand(torque, d.stallTorqueNm),
    };
  });
  const hardest = CASES[CASES.length - 1];
  return { cases, traction: requiredFriction(d, hardest) };
}
