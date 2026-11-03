/* Forge Tests — generated acceptance tests for a Garage robot spec.
 *
 * A test PLAN with computed predictions, not a simulation run and
 * never a measurement: every number below is a first-order estimate
 * from the spec's own recorded fields, produced by the same formulas
 * the repo's field checks use (lib/rover.ts — usable torque 40% of
 * stall, wheels climb ≈ 40% of diameter, drive efficiency 50%,
 * chemistry usable-capacity fractions), re-derived here so this
 * module stays import-free like lib/forgeEngine.ts and the numbers
 * agree with the Simulate and Checks tabs.
 *
 * Thresholds are THIS PLAN's stated thresholds, not standards, and
 * the basis line on every test says so. A test whose inputs the spec
 * does not carry is NOT_CHECKED with the missing field named — it
 * never guesses a motor, battery, or geometry value.
 *
 * Failure fixes name real remedies only: a Forge Engine modification
 * string the engine's grammar actually accepts (the two used here —
 * 'swap in a bigger battery', 'add imu' — are duplicated from
 * lib/forgeEngine.ts's applyModification grammar on purpose, so this
 * module keeps zero imports), or guidance text pointing at the
 * Workshop's existing fix routes. */

export type ForgeTestVerdict = 'PASS' | 'FAIL' | 'NOT_CHECKED';

export interface ForgeTestFix { kind: 'modification' | 'guidance'; text: string }

export interface ForgeTest {
  id: string;
  name: string;
  kind: 'acceptance' | 'fault_injection';
  procedure: string[];
  expected: string;
  predicted: string;
  verdict: ForgeTestVerdict;
  inputs: string[];
  basis: string;
  suggestedFix?: ForgeTestFix;
}

export interface ForgeTestPlan {
  generatedAt: string;
  model: string;
  tests: ForgeTest[];
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Spec = any;

/* --- Constants mirrored from lib/rover.ts (keep in step) ---------- */
const G = 9.81;
const USABLE_TORQUE_FRACTION = 0.4; // rover.ts USABLE_TORQUE_FRACTION
const STEP_FRACTION = 0.4;          // rover.ts STEP_FRACTION
const MARGIN_OK = 1.5;              // rover.ts MARGIN_OK
const DRIVE_EFFICIENCY = 0.5;       // rover.ts DRIVE_EFFICIENCY
const ELECTRONICS_W = 5.0;          // rover.ts ELECTRONICS_W_DEFAULT
const MOTOR_NO_LOAD_W = 2.0;        // rover.ts MOTOR_NO_LOAD_W
const SKID_FACTOR = 1.5;            // rover.ts SKID_FACTOR
const CRR_INDOOR = 0.015;           // rover.ts TERRAINS.indoor
const USABLE_CAPACITY: Record<string, number> = {
  lipo: 0.8, liion: 0.8, lifepo4: 0.9, nimh: 0.8, lead_acid: 0.5,
};

/* --- This plan's stated constants (plan choices, not standards) --- */
const DRIVE_DISTANCE_M = 1.0;
const DRIVE_TOLERANCE_PCT = 5;      // ±5% open-loop dead-reckoning allowance
const DIAMETER_MISMATCH_PCT = 1;    // assumed left/right wheel diameter mismatch
const DROOP_PCT_AT_FULL_LOAD = 5;   // predicted shortfall at 100% of usable torque
const TURN_ANGLE_DEG = 90;
const TURN_TOLERANCE_DEG = 5;       // ±5° open-loop heading allowance
const MECANUM_HEADING_FACTOR = 3;   // catalogue note: mecanum odometry is unreliable by design
const TEST_PAYLOAD_FRACTION = 0.2;  // test payload = 20% of the robot's own mass
const SLOPE_DEG = 10;
const STEP_M = 0.025;               // 25 mm kerb
const TEST_SPEED_MPS = 0.3;         // roverSim.ts target ground speed
const DUTY_CYCLE = 0.5;             // driving half the time, electronics always on
const TARGET_MIN = 30;              // plan endurance target (rover.ts default target)
const SLIP_PCT = 20;                // injected fault: one wheel travels 20% less
const DRIFT_TOLERANCE_DEG = 15;     // plan threshold for an uncorrected heading drift
const BATTERY_TEST_PCT = 80;        // injected fault: battery at 80% charge
const SAG_FACTOR = 0.9;             // stated assumption: torque scales with sagged voltage

const WHEELED = ['differential', 'skid_steer', 'ackermann', 'mecanum', 'tracked'];

const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function get(spec: Spec, path: string): unknown {
  return path.split('.').reduce((o: Spec, k) => (o && typeof o === 'object' ? o[k] : undefined), spec);
}
function missing(spec: Spec, paths: string[]): string | null {
  for (const p of paths) if (!isPos(get(spec, p))) return p;
  return null;
}
function notChecked(
  id: string, name: string, kind: ForgeTest['kind'], field: string, why?: string,
): ForgeTest {
  return {
    id, name, kind,
    procedure: [],
    expected: '',
    predicted: '',
    verdict: 'NOT_CHECKED',
    inputs: [],
    basis: why ?? `Not checked: the spec does not record ${field}, and this plan never invents it.`,
  };
}

/* Track width is not a spec field: it is derived as the overall
 * width minus one wheel width (wheel centres sit half a wheel width
 * in from each side). The derivation is stated wherever it is used. */
function trackM(spec: Spec): number | null {
  const w = num(spec?.width_m), ww = num(spec?.wheel?.width_m);
  if (!isPos(w) || !isPos(ww) || w <= ww) return null;
  return w - ww;
}

/* Cruise torque utilisation: the share of usable torque (40% of
 * stall, the repo convention) that rolling resistance alone demands
 * on flat indoor ground. Drives the plan's droop model below. */
function cruiseUtilisation(spec: Spec): number | null {
  const gap = missing(spec, ['mass_kg', 'wheel.diameter_m', 'motor.count', 'motor.stall_torque_nm']);
  if (gap) return null;
  const need = spec.mass_kg * G * CRR_INDOOR * (spec.wheel.diameter_m / 2);
  const have = spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION * spec.motor.count;
  return have > 0 ? need / have : null;
}

function usableTorque(spec: Spec): number {
  return spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION * spec.motor.count;
}

/* Runtime estimate, mirroring rover.ts estimateRuntime: usable
 * energy from the recorded pack, draw from rolling resistance at the
 * test speed through the drive efficiency, plus no-load motor draw
 * and the electronics allowance. Duty cycle is this plan's: driving
 * half the time, electronics always on. */
function endurance(spec: Spec): { minutes: number; energyWh: number; avgDrawW: number } | null {
  const gap = missing(spec, ['battery.voltage_v', 'battery.capacity_mah', 'mass_kg', 'motor.count']);
  if (gap) return null;
  const usable = USABLE_CAPACITY[String(spec.battery.chemistry ?? '').toLowerCase()] ?? 0.8;
  const energyWh = (spec.battery.voltage_v * spec.battery.capacity_mah) / 1000 * usable;
  const skid = spec.drivetrain === 'skid_steer' || spec.drivetrain === 'tracked' ? SKID_FACTOR : 1;
  const driveW = (spec.mass_kg * G * CRR_INDOOR * skid * TEST_SPEED_MPS) / DRIVE_EFFICIENCY;
  const avgDrawW = DUTY_CYCLE * (driveW + MOTOR_NO_LOAD_W * spec.motor.count) + ELECTRONICS_W;
  return { minutes: (energyWh / avgDrawW) * 60, energyWh, avgDrawW };
}

const BIGGER_BATTERY_FIX: ForgeTestFix = { kind: 'modification', text: 'swap in a bigger battery' };
const TORQUE_GUIDANCE: ForgeTestFix = {
  kind: 'guidance',
  text: 'Raise usable torque (higher stall-torque motors) or cut mass — usable torque is 40% of stall by the repo convention. The Fix with Muse Spark flow in the Checks tab can propose spec changes.',
};

/* ------------------------------------------------------------------ */

function driveAccuracy(spec: Spec): ForgeTest {
  const id = 'drive_1m', name = 'Drive accuracy — 1.0 m straight';
  const gap = missing(spec, ['wheel.diameter_m', 'mass_kg', 'motor.count', 'motor.stall_torque_nm']);
  if (gap) return notChecked(id, name, 'acceptance', gap, `Not checked: needs ${gap} for the load-droop term — the spec does not record it, and this plan never invents it.`);
  const u = cruiseUtilisation(spec) as number;
  const mismatchPct = DIAMETER_MISMATCH_PCT / 2; // two wheels average out
  const droopPct = Math.min(u, 1) * DROOP_PCT_AT_FULL_LOAD;
  const errPct = mismatchPct + droopPct;
  const verdict: ForgeTestVerdict = errPct <= DRIVE_TOLERANCE_PCT ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      'Mark a start line on flat, hard floor and place the robot behind it, nose on the line.',
      `Command a straight ${DRIVE_DISTANCE_M.toFixed(1)} m drive, open loop (no heading correction).`,
      'Measure where the nose stops against the start line.',
    ],
    expected: `Stops within ±${DRIVE_TOLERANCE_PCT}% of ${DRIVE_DISTANCE_M.toFixed(1)} m (this plan's open-loop allowance, not a standard).`,
    predicted: `Predicted distance error ≈ ${r2(errPct)}% (${Math.round(errPct * 10)} mm over 1.0 m): ${r1(mismatchPct)}% from the assumed ±${DIAMETER_MISMATCH_PCT}% left/right diameter mismatch, ${r2(droopPct)}% load droop at ${r1(u * 100)}% of usable torque. Prediction, not a measurement.`,
    verdict,
    inputs: [`wheel.diameter_m = ${spec.wheel.diameter_m} m`, `mass_kg = ${spec.mass_kg}`, `motor.stall_torque_nm = ${spec.motor.stall_torque_nm} × ${spec.motor.count}`, `rolling resistance ${CRR_INDOOR} (indoor)`],
    basis: `Plan model: distance error = half the assumed diameter mismatch + droop proportional to cruise torque utilisation (capped at ${DROOP_PCT_AT_FULL_LOAD}% at full usable torque). Threshold ±${DRIVE_TOLERANCE_PCT}% is this plan's allowance.`,
    ...(verdict === 'FAIL' ? { suggestedFix: { kind: 'guidance', text: 'Close the loop: wheel encoders or an IMU heading hold remove most open-loop error. The Fix with Muse Spark flow in the Checks tab can propose the spec changes.' } as ForgeTestFix } : {}),
  };
}

function turnAccuracy(spec: Spec): ForgeTest {
  const id = 'turn_90', name = 'Turn accuracy — 90° in place';
  const gap = missing(spec, ['wheel.diameter_m', 'width_m', 'wheel.width_m', 'mass_kg', 'motor.count', 'motor.stall_torque_nm']);
  if (gap) return notChecked(id, name, 'acceptance', gap, `Not checked: needs ${gap} (track width is derived from width and wheel width) — the spec does not record it, and this plan never invents it.`);
  const track = trackM(spec) as number;
  const u = cruiseUtilisation(spec) as number;
  const factor = spec.drivetrain === 'mecanum' ? MECANUM_HEADING_FACTOR : 1;
  const errDeg = (DIAMETER_MISMATCH_PCT / 100) * TURN_ANGLE_DEG * factor + Math.min(u, 1) * 2;
  const verdict: ForgeTestVerdict = errDeg <= TURN_TOLERANCE_DEG ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      'Mark the robot’s starting heading on the floor with tape.',
      `Command a ${TURN_ANGLE_DEG}° turn in place, open loop.`,
      'Measure the final heading against the tape mark.',
    ],
    expected: `Final heading within ±${TURN_TOLERANCE_DEG}° of ${TURN_ANGLE_DEG}° (this plan's open-loop allowance, not a standard).`,
    predicted: `Predicted heading error ≈ ${r1(errDeg)}°: ${r1((DIAMETER_MISMATCH_PCT / 100) * TURN_ANGLE_DEG * factor)}° from the assumed ±${DIAMETER_MISMATCH_PCT}% diameter mismatch over the derived ${Math.round(track * 1000)} mm track${spec.drivetrain === 'mecanum' ? ` (×${MECANUM_HEADING_FACTOR} for mecanum rollers — the catalogue itself notes mecanum odometry is unreliable by design)` : ''}, plus ${r1(Math.min(u, 1) * 2)}° of load scrub at ${r1(u * 100)}% of usable torque. Prediction, not a measurement.`,
    verdict,
    inputs: [`width_m = ${spec.width_m}`, `wheel.width_m = ${spec.wheel.width_m} (track derived: width − wheel width)`, `wheel.diameter_m = ${spec.wheel.diameter_m} m`, `motor.stall_torque_nm = ${spec.motor.stall_torque_nm} × ${spec.motor.count}`],
    basis: `Plan model: a diameter mismatch ε turns the robot ε × the commanded angle; scrub adds up to 2° at full usable torque. Threshold ±${TURN_TOLERANCE_DEG}° is this plan's allowance.`,
    ...(verdict === 'FAIL' ? { suggestedFix: { kind: 'guidance', text: 'Close the heading loop with an IMU or encoders — open-loop turns cannot correct mismatch. The Fix with Muse Spark flow in the Checks tab can propose the spec changes.' } as ForgeTestFix } : {}),
  };
}

function payloadMargin(spec: Spec): ForgeTest {
  const id = 'payload_carry', name = 'Payload margin — carry the test payload';
  const gap = missing(spec, ['mass_kg', 'wheel.diameter_m', 'motor.count', 'motor.stall_torque_nm']);
  if (gap) return notChecked(id, name, 'acceptance', gap);
  const payload = r2(spec.mass_kg * TEST_PAYLOAD_FRACTION);
  const total = spec.mass_kg + payload;
  const a = (SLOPE_DEG * Math.PI) / 180;
  const need = total * G * (Math.sin(a) + CRR_INDOOR * Math.cos(a)) * (spec.wheel.diameter_m / 2);
  const have = usableTorque(spec);
  const margin = need > 0 ? have / need : Infinity;
  const verdict: ForgeTestVerdict = margin >= MARGIN_OK ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      `Load the robot with the test payload: ${payload} kg (${Math.round(TEST_PAYLOAD_FRACTION * 100)}% of its own mass, this plan's test load).`,
      `Drive it up the ${SLOPE_DEG}° ramp and hold for 10 seconds.`,
      'Pass if it climbs and holds without stalling or rolling back.',
    ],
    expected: `Usable torque at least ${MARGIN_OK}× the torque the loaded climb needs (the repo's margin convention in lib/rover.ts).`,
    predicted: `Loaded mass ${r2(total)} kg needs ${r2(need)} N·m at the wheels on the ${SLOPE_DEG}° slope; usable torque is ${r2(have)} N·m (40% of stall) — margin ${r1(margin)}×. Prediction, not a measurement.`,
    verdict,
    inputs: [`mass_kg = ${spec.mass_kg}`, `test payload = ${payload} kg (plan: 20% of mass)`, `wheel.diameter_m = ${spec.wheel.diameter_m} m`, `motor.stall_torque_nm = ${spec.motor.stall_torque_nm} × ${spec.motor.count}`],
    basis: 'Force balance on the slope (gravity + rolling resistance) against usable torque; margin convention mirrors lib/rover.ts.',
    ...(verdict === 'FAIL' ? { suggestedFix: TORQUE_GUIDANCE } : {}),
  };
}

function slopeClimb(spec: Spec): ForgeTest {
  const id = 'slope_10', name = `Slope climb — ${SLOPE_DEG}°`;
  const gap = missing(spec, ['mass_kg', 'wheel.diameter_m', 'motor.count', 'motor.stall_torque_nm']);
  if (gap) return notChecked(id, name, 'acceptance', gap);
  const r = spec.wheel.diameter_m / 2;
  const a = (SLOPE_DEG * Math.PI) / 180;
  const need = spec.mass_kg * G * (Math.sin(a) + CRR_INDOOR * Math.cos(a)) * r;
  const have = usableTorque(spec);
  const margin = need > 0 ? have / need : Infinity;
  // steepest holdable slope, same derivation as rover.ts maxSlopeDeg
  const k = have / r / (spec.mass_kg * G);
  const rho = Math.hypot(1, CRR_INDOOR);
  const best = k >= rho ? 90 : Math.max(0, ((Math.asin(k / rho) - Math.atan(CRR_INDOOR)) * 180) / Math.PI);
  const verdict: ForgeTestVerdict = margin >= MARGIN_OK ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      `Set a ramp to ${SLOPE_DEG}°.`,
      'Drive the robot straight up it from a standing start.',
      'Pass if it reaches the top without stalling, sliding back, or tipping.',
    ],
    expected: `Usable torque at least ${MARGIN_OK}× the climb's need (the repo's margin convention in lib/rover.ts).`,
    predicted: `${SLOPE_DEG}° needs ${r2(need)} N·m at the wheels; usable ${r2(have)} N·m — margin ${r1(margin)}×. Steepest holdable slope ≈ ${Math.round(best)}°. Prediction, not a measurement.`,
    verdict,
    inputs: [`mass_kg = ${spec.mass_kg}`, `wheel.diameter_m = ${spec.wheel.diameter_m} m`, `motor.stall_torque_nm = ${spec.motor.stall_torque_nm} × ${spec.motor.count}`, `rolling resistance ${CRR_INDOOR} (indoor)`],
    basis: 'Same slope model as lib/rover.ts checkSlope; traction assumed sufficient (no wheel slip).',
    ...(verdict === 'FAIL' ? { suggestedFix: TORQUE_GUIDANCE } : {}),
  };
}

function stepClear(spec: Spec): ForgeTest {
  const id = 'step_clear', name = `Step clear — ${Math.round(STEP_M * 1000)} mm kerb`;
  if (!spec?.wheel) return notChecked(id, name, 'acceptance', 'wheel', 'Not checked: no wheels in this spec.');
  const gap = missing(spec, ['wheel.diameter_m']);
  if (gap) return notChecked(id, name, 'acceptance', gap);
  const wheelLimit = STEP_FRACTION * spec.wheel.diameter_m;
  const limits = [wheelLimit];
  let detail = `wheels clear ≈ ${Math.round(wheelLimit * 1000)} mm (${Math.round(STEP_FRACTION * 100)}% of diameter)`;
  if (isPos(spec.ground_clearance_m)) {
    limits.push(spec.ground_clearance_m);
    detail += `, belly clears ${Math.round(spec.ground_clearance_m * 1000)} mm`;
  } else {
    detail += '; ground clearance not recorded, so the belly is not checked';
  }
  const limit = Math.min(...limits);
  const margin = limit / STEP_M;
  const verdict: ForgeTestVerdict = limit >= STEP_M ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      `Place a ${Math.round(STEP_M * 1000)} mm kerb across the robot's path.`,
      'Drive straight at it at test speed.',
      'Pass if the robot crosses without grounding its belly or needing a push.',
    ],
    expected: `Step limit (smaller of wheel climb and belly clearance) at least ${Math.round(STEP_M * 1000)} mm.`,
    predicted: `Limit ≈ ${Math.round(limit * 1000)} mm — ${detail}; margin ${r1(margin)}× against the ${Math.round(STEP_M * 1000)} mm step. Prediction, not a measurement.`,
    verdict,
    inputs: [`wheel.diameter_m = ${spec.wheel.diameter_m} m`, ...(isPos(spec.ground_clearance_m) ? [`ground_clearance_m = ${spec.ground_clearance_m} m`] : ['ground_clearance_m not recorded'])],
    basis: 'Same step model as lib/rover.ts checkStep: rigid wheels climb ≈ 40% of diameter, and the belly must clear the edge while crossing.',
    ...(verdict === 'FAIL' ? { suggestedFix: { kind: 'guidance', text: 'Fit larger wheels or raise ground_clearance_m — the step limit is set by whichever is smaller. The Fix with Muse Spark flow in the Checks tab can propose the spec changes.' } as ForgeTestFix } : {}),
  };
}

function enduranceTest(spec: Spec): ForgeTest {
  const id = 'endurance', name = 'Endurance — runtime at test duty cycle';
  const gap = missing(spec, ['battery.voltage_v', 'battery.capacity_mah', 'mass_kg', 'motor.count']);
  if (gap) return notChecked(id, name, 'acceptance', gap);
  const e = endurance(spec) as { minutes: number; energyWh: number; avgDrawW: number };
  const verdict: ForgeTestVerdict = e.minutes >= TARGET_MIN ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'acceptance',
    procedure: [
      'Charge the pack fully and note the time.',
      `Run the robot at the test duty cycle: driving at ${TEST_SPEED_MPS} m/s half the time, electronics on throughout.`,
      'Stop when the pack reaches its low-voltage cutoff; record the runtime.',
    ],
    expected: `At least ${TARGET_MIN} min at the test duty cycle (this plan's target, the repo's default in lib/rover.ts).`,
    predicted: `ESTIMATE ≈ ${Math.round(e.minutes)} min: ${r1(e.energyWh)} Wh usable from the recorded pack at an average draw of ≈ ${r1(e.avgDrawW)} W. An estimate from the spec, not a measured runtime.`,
    verdict,
    inputs: [`battery = ${spec.battery.voltage_v} V × ${spec.battery.capacity_mah} mAh (${spec.battery.chemistry ?? 'chemistry not recorded'})`, `mass_kg = ${spec.mass_kg}`, `motor.count = ${spec.motor.count}`, `duty cycle ${Math.round(DUTY_CYCLE * 100)}% at ${TEST_SPEED_MPS} m/s`],
    basis: `Mirrors lib/rover.ts estimateRuntime: chemistry usable-capacity fraction, drive power = rolling resistance ÷ ${Math.round(DRIVE_EFFICIENCY * 100)}% efficiency, ${MOTOR_NO_LOAD_W} W no-load per motor, ${ELECTRONICS_W} W electronics. Slopes, stops and starts cost more.`,
    ...(verdict === 'FAIL' ? { suggestedFix: BIGGER_BATTERY_FIX } : {}),
  };
}

function faultWheelSlip(spec: Spec): ForgeTest {
  const id = 'fault_wheel_slip', name = `Fault injection — ${SLIP_PCT}% slip on one wheel`;
  const gap = missing(spec, ['width_m', 'wheel.width_m', 'wheel.diameter_m']);
  if (gap) return notChecked(id, name, 'fault_injection', gap, `Not checked: needs ${gap} (track width is derived from width and wheel width) — the spec does not record it, and this plan never invents it.`);
  const track = trackM(spec) as number;
  const shortfall = (SLIP_PCT / 100) * DRIVE_DISTANCE_M;
  const driftDeg = (Math.atan(shortfall / track) * 180) / Math.PI;
  const verdict: ForgeTestVerdict = driftDeg <= DRIFT_TOLERANCE_DEG ? 'PASS' : 'FAIL';
  const imuFix: ForgeTestFix = spec?.forge?.ids && !spec.forge.ids.imu
    ? { kind: 'modification', text: 'add imu' }
    : { kind: 'guidance', text: 'Fit an IMU or wheel encoders and close the heading loop — open-loop dead reckoning cannot correct a slipping wheel.' };
  return {
    id, name, kind: 'fault_injection',
    procedure: [
      'This is an injected-fault prediction, evaluated on the plan’s model — not a physical fault test.',
      `Model: over a commanded ${DRIVE_DISTANCE_M.toFixed(1)} m straight drive, one drive wheel travels ${SLIP_PCT}% less than the other (tape on a tyre, a loose hub).`,
      'Compare the predicted heading drift with what a real run shows if you stage it.',
    ],
    expected: `Predicted uncorrected heading drift no more than ${DRIFT_TOLERANCE_DEG}° over 1.0 m (this plan's resilience threshold).`,
    predicted: `Predicted heading drift ≈ ${r1(driftDeg)}° over 1.0 m: a ${Math.round(shortfall * 1000)} mm travel difference across the derived ${Math.round(track * 1000)} mm track. Injected-fault prediction, not a measurement.`,
    verdict,
    inputs: [`width_m = ${spec.width_m}`, `wheel.width_m = ${spec.wheel.width_m} (track derived: width − wheel width)`, `injected slip = ${SLIP_PCT}%`, `drive distance = ${DRIVE_DISTANCE_M} m`],
    basis: 'Differential-drive geometry: heading change = travel difference ÷ track width (arctangent form). No correction is modelled — that is the point of the fault.',
    ...(verdict === 'FAIL' ? { suggestedFix: imuFix } : {}),
  };
}

function faultBattery80(spec: Spec): ForgeTest {
  const id = 'fault_battery_80', name = `Fault injection — battery at ${BATTERY_TEST_PCT}%`;
  const gap = missing(spec, ['battery.voltage_v', 'battery.capacity_mah', 'mass_kg', 'motor.count']);
  if (gap) return notChecked(id, name, 'fault_injection', gap);
  const e = endurance(spec) as { minutes: number; energyWh: number; avgDrawW: number };
  const minutes80 = e.minutes * (BATTERY_TEST_PCT / 100);
  const verdict: ForgeTestVerdict = minutes80 >= TARGET_MIN ? 'PASS' : 'FAIL';
  return {
    id, name, kind: 'fault_injection',
    procedure: [
      'This is an injected-fault prediction, evaluated on the plan’s model — not a physical discharge test.',
      `Model: the same endurance run, but the pack starts at ${BATTERY_TEST_PCT}% charge and its voltage sags (torque assumed to scale with voltage, ×${SAG_FACTOR}).`,
      'Compare the predicted runtime with a real partial-charge run if you stage one.',
    ],
    expected: `Still meets the ${TARGET_MIN} min plan target starting from ${BATTERY_TEST_PCT}%.`,
    predicted: `Predicted runtime ≈ ${Math.round(minutes80)} min at ${BATTERY_TEST_PCT}% (full-charge estimate ${Math.round(e.minutes)} min × ${BATTERY_TEST_PCT}%). Torque-dependent margins shrink by ≈ ${Math.round((1 - SAG_FACTOR) * 100)}% under the stated sag assumption. Injected-fault prediction, not a measurement.`,
    verdict,
    inputs: [`battery = ${spec.battery.voltage_v} V × ${spec.battery.capacity_mah} mAh (${spec.battery.chemistry ?? 'chemistry not recorded'})`, `starting charge = ${BATTERY_TEST_PCT}%`, `voltage sag factor = ${SAG_FACTOR} (plan assumption)`],
    basis: 'Energy scales with starting charge; the endurance model is the one in the endurance test above.',
    ...(verdict === 'FAIL' ? { suggestedFix: BIGGER_BATTERY_FIX } : {}),
  };
}

/* Non-wheeled archetypes get honest abstentions, not fake numbers:
 * the wheeled rows say why they cannot run, and the one test that
 * could apply to the archetype names the field it would need. */
function nonWheeledPlan(spec: Spec): ForgeTest[] {
  const dt = String(spec?.drivetrain ?? 'unknown');
  const why = `Not checked: this is a ${dt} drivetrain — this test needs a wheeled drive base.`;
  const rows: ForgeTest[] = [
    notChecked('drive_1m', 'Drive accuracy — 1.0 m straight', 'acceptance', 'wheel', why),
    notChecked('turn_90', 'Turn accuracy — 90° in place', 'acceptance', 'wheel', why),
    notChecked('slope_10', `Slope climb — ${SLOPE_DEG}°`, 'acceptance', 'wheel', why),
    notChecked('step_clear', `Step clear — ${Math.round(STEP_M * 1000)} mm kerb`, 'acceptance', 'wheel', why),
    notChecked('fault_wheel_slip', `Fault injection — ${SLIP_PCT}% slip on one wheel`, 'fault_injection', 'wheel', why),
  ];
  if (dt === 'robotic_arm') {
    rows.push(notChecked(
      'arm_joint_torque', 'Arm joint torque — hold the test payload at full reach', 'acceptance',
      'motor.stall_torque_nm',
      'Not checked: the spec does not record motor.stall_torque_nm for the arm joints (servo torque lives on the catalogue part, not the spec), and this plan never moves numbers across that line.',
    ));
    rows.push(notChecked(
      'endurance', 'Endurance — runtime at test duty cycle', 'acceptance',
      'motor current draw',
      'Not checked: the rover runtime model is built around driving, which an arm does not do, and the spec records no servo current draw to model holding and moving instead.',
    ));
    rows.push(notChecked(
      'fault_battery_80', `Fault injection — battery at ${BATTERY_TEST_PCT}%`, 'fault_injection',
      'motor current draw',
      'Not checked: it re-runs the endurance model, which needs a servo current draw the spec does not record.',
    ));
  } else {
    // multirotor (or anything else without wheels): endurance would be
    // a flight-time estimate, and the spec records no hover draw.
    rows.push(notChecked(
      'endurance', 'Endurance — runtime at test duty cycle', 'acceptance',
      'motor thrust / hover current draw',
      'Not checked: a flight-time estimate needs hover power (motor thrust or current draw), which the spec does not record — the rover runtime model does not apply to a multirotor.',
    ));
    rows.push(notChecked(
      'fault_battery_80', `Fault injection — battery at ${BATTERY_TEST_PCT}%`, 'fault_injection',
      'motor thrust / hover current draw',
      'Not checked: it re-runs the endurance model, which needs hover power the spec does not record.',
    ));
  }
  return rows;
}

/** Generate the acceptance test plan for a spec. Pure and
 * deterministic given the spec (the caller supplies the timestamp,
 * so stored plans are reproducible in tests). */
export function generateForgeTests(spec: Spec, generatedAt = ''): ForgeTestPlan {
  const model = 'First-order estimates from the spec’s recorded fields, using the lib/rover.ts formulas. Predictions, not measurements; thresholds are this plan’s own.';
  if (!spec || typeof spec !== 'object') {
    return { generatedAt, model, tests: [notChecked('drive_1m', 'Drive accuracy — 1.0 m straight', 'acceptance', 'spec', 'Not checked: no spec to test.')] };
  }
  const wheeled = WHEELED.includes(String(spec.drivetrain ?? '')) && Boolean(spec.wheel);
  if (!wheeled) return { generatedAt, model, tests: nonWheeledPlan(spec) };
  return {
    generatedAt,
    model,
    tests: [
      driveAccuracy(spec),
      turnAccuracy(spec),
      payloadMargin(spec),
      slopeClimb(spec),
      stepClear(spec),
      enduranceTest(spec),
      faultWheelSlip(spec),
      faultBattery80(spec),
    ],
  };
}

/** One-line tally for section headers: "5 PASS · 1 FAIL · 2 NOT_CHECKED". */
export function forgeTestTally(plan: ForgeTestPlan): string {
  const n: Record<string, number> = { PASS: 0, FAIL: 0, NOT_CHECKED: 0 };
  for (const t of plan?.tests ?? []) n[t.verdict] = (n[t.verdict] ?? 0) + 1;
  return `${n.PASS} PASS · ${n.FAIL} FAIL · ${n.NOT_CHECKED} NOT_CHECKED`;
}
