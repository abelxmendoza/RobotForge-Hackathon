/* Rapier physics runs for a garage robot (Tier 2, 2026-11-01).
 *
 * The Simulate tab's animations act out the first-order estimates in
 * lib/rover.ts. This file runs the same two tests as an actual rigid-
 * body simulation in the browser, so the outcome comes from contact,
 * friction and torque limits rather than from a formula:
 *   - slope: the robot drives up a ramp of the chosen angle;
 *   - kerb:  the robot drives at a kerb of the chosen height.
 *
 * Model (stated in the UI, never hidden):
 *   - the chassis is one box (length x width x body height) sitting at
 *     the spec's ground clearance, carrying the spec's mass minus the
 *     wheels; wheels are cylinders of the spec's size;
 *   - motor.count wheels are driven, each by a velocity motor whose
 *     torque is capped at the same usable fraction of stall torque the
 *     estimate uses; any other wheels roll freely, and a two-wheel
 *     robot gets a frictionless caster ball front and back;
 *   - tyre grip is an assumed friction coefficient per terrain;
 *   - the slope is made by tilting gravity, which is equivalent to
 *     tilting the ground and keeps the geometry simple.
 * It is a browser physics run of a simplified model, not Gazebo. */
import { G, USABLE_TORQUE_FRACTION } from './rover';
import type { Spec } from './garage';

export const GRIP: Record<string, number> = { indoor: 0.9, outdoor: 0.8, rough: 0.6 };
const HZ = 60;
const SPEED = 0.3; // m/s target ground speed

export interface Pose { t: number; x: number; z: number; pitchDeg: number }
export interface SimRun {
  outcome: 'climbs' | 'stalls' | 'slides back' | 'tips over' | 'clears it' | 'blocked';
  ok: boolean;
  distanceM: number;
  seconds: number;
  maxPitchDeg: number;
  poses: Pose[];
}
export interface RoverSim { slope: SimRun; step: SimRun; assumptions: string[] }

type R = typeof import('@dimforge/rapier3d-compat').default;
let rapier: Promise<R> | null = null;
async function loadRapier(): Promise<R> {
  if (!rapier) rapier = import('@dimforge/rapier3d-compat').then(async (m) => { await m.default.init(); return m.default; });
  return rapier;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

function pitchOf(q: { x: number; y: number; z: number; w: number }): number {
  // rotation about the world y axis (nose up positive when driving +x)
  const sinp = 2 * (q.w * q.y - q.z * q.x);
  return (-Math.asin(Math.max(-1, Math.min(1, sinp))) * 180) / Math.PI;
}
function tiltOf(q: { x: number; y: number; z: number; w: number }): number {
  // angle between the body's up axis and world up
  const upZ = 1 - 2 * (q.x * q.x + q.y * q.y);
  return (Math.acos(Math.max(-1, Math.min(1, upZ))) * 180) / Math.PI;
}

async function runOne(RAPIER: R, spec: Spec, opts: { slopeDeg: number; stepM: number; grip: number; kerb: boolean }): Promise<SimRun> {
  const L = num(spec.length_m, 0.3), W = num(spec.width_m, 0.2), H = num(spec.height_m, 0.15);
  const mass = num(spec.mass_kg, 1);
  const r = num(spec?.wheel?.diameter_m, 0.06) / 2;
  const ww = num(spec?.wheel?.width_m, 0.02);
  const nWheels = Math.max(2, Math.round(num(spec?.wheel?.count, 2)));
  const nDriven = Math.min(nWheels, Math.max(1, Math.round(num(spec?.motor?.count, nWheels))));
  const torque = num(spec?.motor?.stall_torque_nm, 0) * USABLE_TORQUE_FRACTION;
  const clear = num(spec.ground_clearance_m, Math.max(0.005, r * 0.5));
  const bodyH = Math.max(0.02, Math.min(H - clear, H * 0.5));

  const a = (opts.kerb ? 0 : opts.slopeDeg) * Math.PI / 180;
  const world = new RAPIER.World({ x: -G * Math.sin(a), y: 0, z: -G * Math.cos(a) });
  world.timestep = 1 / HZ;
  try {
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, 5, 0.5).setTranslation(45, 0, -0.5).setFriction(opts.grip), ground);
    const kerbX = L / 2 + 0.15;
    if (opts.kerb && opts.stepM > 0) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(5, 5, opts.stepM / 2).setTranslation(kerbX + 5, 0, opts.stepM / 2).setFriction(opts.grip), ground);
    }

    const wheelMass = Math.min(0.06 * mass, 0.3) ;
    const chassisMass = Math.max(0.05, mass - wheelMass * nWheels);
    const z0 = r; // axle height on flat ground
    const chassis = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, z0).setCanSleep(false));
    // box centred so its underside sits at the ground clearance
    const boxZ = clear + bodyH / 2 - z0;
    world.createCollider(RAPIER.ColliderDesc.cuboid(L / 2, W / 2, bodyH / 2).setTranslation(0, 0, boxZ).setMass(chassisMass).setFriction(0.3), chassis);

    // wheel stations along x: two wheels -> mid; more -> front and rear axles
    const xs = nWheels <= 2 ? [0] : [L / 2 - r, -(L / 2 - r)];
    const perAxle = Math.ceil(nWheels / xs.length);
    const stations: { x: number; y: number }[] = [];
    for (const x of xs) for (let i = 0; i < perAxle && stations.length < nWheels; i++) stations.push({ x, y: (i % 2 ? -1 : 1) * (W / 2 + ww / 2) });
    if (nWheels <= 2) {
      const cr = Math.min(clear, r) * 0.9;
      for (const sx of [L / 2 - cr, -(L / 2 - cr)]) {
        world.createCollider(RAPIER.ColliderDesc.ball(cr).setTranslation(sx, 0, cr + 0.003 - z0).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setMass(0.01), chassis);
      }
    }
    const motors: { j: InstanceType<R['RevoluteImpulseJoint']> }[] = [];
    stations.forEach((s, i) => {
      const wheel = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, z0).setCanSleep(false));
      world.createCollider(RAPIER.ColliderDesc.cylinder(ww / 2, r).setMass(wheelMass).setFriction(opts.grip), wheel);
      const jd = RAPIER.JointData.revolute({ x: s.x, y: s.y, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
      const j = world.createImpulseJoint(jd, chassis, wheel, true) as InstanceType<R['RevoluteImpulseJoint']>;
      if (i < nDriven && torque > 0) {
        j.configureMotorModel(RAPIER.MotorModel.ForceBased);
        j.configureMotorVelocity(SPEED / r, 50);
        j.setMotorMaxForce(torque);
        motors.push({ j });
      }
    });

    // settle on the ground, then drive
    const seconds = opts.kerb ? 6 : 5;
    const poses: Pose[] = [];
    let maxPitch = 0, maxTilt = 0;
    const x0 = chassis.translation().x;
    for (let k = 0; k < seconds * HZ; k++) {
      world.step();
      if (k % 3 === 0) {
        const p = chassis.translation(), q = chassis.rotation();
        const pitch = pitchOf(q);
        maxPitch = Math.max(maxPitch, Math.abs(pitch));
        maxTilt = Math.max(maxTilt, tiltOf(q));
        poses.push({ t: k / HZ, x: p.x - x0, z: p.z - z0, pitchDeg: pitch });
        if (maxTilt > 60 || p.x - x0 < -0.5) break; // tipped, or clearly sliding back down
      }
    }
    const last = poses[poses.length - 1];
    const d = last.x;
    let outcome: SimRun['outcome'];
    if (maxTilt > 60) outcome = 'tips over';
    else if (opts.kerb) outcome = d > kerbX + L / 2 && last.z > opts.stepM * 0.6 ? 'clears it' : 'blocked';
    else outcome = d > 0.25 * SPEED * seconds ? 'climbs' : d < -0.03 ? 'slides back' : 'stalls';
    return { outcome, ok: outcome === 'climbs' || outcome === 'clears it', distanceM: d, seconds: last.t, maxPitchDeg: maxPitch, poses };
  } finally {
    world.free();
  }
}

/** Why the physics run can't happen for this spec, or null when it can. */
export function simUnavailable(spec: Spec): string | null {
  if (!spec?.wheel || !(Number(spec.wheel.diameter_m) > 0)) return 'needs wheels with a diameter';
  if (!(Number(spec?.motor?.stall_torque_nm) > 0)) return 'needs motor.stall_torque_nm (from the motor datasheet)';
  if (!(Number(spec?.mass_kg) > 0) || !(Number(spec?.length_m) > 0) || !(Number(spec?.width_m) > 0)) return 'needs mass, length and width';
  return null;
}

export async function runRoverSim(spec: Spec, o: { slopeDeg: number; stepM: number; terrain: string }): Promise<RoverSim> {
  const why = simUnavailable(spec);
  if (why) throw new Error(why);
  const RAPIER = await loadRapier();
  const grip = GRIP[o.terrain] ?? GRIP.outdoor;
  const slope = await runOne(RAPIER, spec, { slopeDeg: o.slopeDeg, stepM: 0, grip, kerb: false });
  const step = await runOne(RAPIER, spec, { slopeDeg: 0, stepM: o.stepM, grip, kerb: true });
  return {
    slope, step,
    assumptions: [
      'chassis is one box at the spec\'s size, mass and ground clearance; wheels are plain cylinders',
      `${Math.round(USABLE_TORQUE_FRACTION * 100)}% of stall torque per driven wheel (same as the estimate), target speed ${SPEED} m/s`,
      `tyre grip μ = ${grip} on ${o.terrain} (assumed, not measured)`,
      'two-wheel robots get frictionless caster balls front and back, 3 mm off the ground so the wheels carry the weight',
      'Rapier rigid-body physics in this browser, 60 Hz; not Gazebo',
    ],
  };
}
