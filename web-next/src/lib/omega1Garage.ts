/* Omega1 as an OWNED Garage robot — the upgrade path from the
 * built-in twin specimen (lib/omega1Twin.ts) to a stored copy Abel
 * can improve: attach his own scans, apply measured dimensions, and
 * keep the real wiring map.
 *
 * The seed stands on the records only (docs/omega1/omega1.template.json
 * + docs/omega1/omega1.extracted.json, extracted from Abel's own
 * Omega-Code repo on 2026-11-01):
 *  - every field below is DOCUMENTED there;
 *  - every MEASURE_ME field stays ABSENT — dimensions, mass, wheel
 *    diameter, battery capacity and motor voltage must come from the
 *    real robot (tape, calipers, scale, or an applied scan), never
 *    from the vendor envelope (0.21/0.15/0.125 m) and never from the
 *    repo's CODE_DEFAULT numbers (wheel radius 0.05 m, track 0.2 m,
 *    max rpm 300), which the extraction itself flags as wrong-sized
 *    starting estimates.
 */
import { getPath, type GarageRobot, type Spec, type VersionSource } from './garage';

export const OMEGA1_ROBOT_ID = 'omega1';

/* One electrical connection on a stored robot's spec: a row of the
 * wiring map on the Wiring tab. Evidence says where the row came
 * from — a robot record (DOCUMENTED), a code default in the robot's
 * own software (CODE_DEFAULT), or the owner typing it in (OWNER,
 * stamped with the date it was added). */
export interface SpecConnection {
  from: string;
  to: string;
  detail: string;
  evidence: 'DOCUMENTED' | 'CODE_DEFAULT' | 'OWNER';
  at?: string;
  /* Set when the owner confirms this row against the real robot
   * (the wiring step's one-tap Confirm): an ISO date. The row keeps
   * its evidence badge — confirmation is the owner's check, stated
   * next to the record, not a rewrite of it. Editing a row instead
   * makes it OWNER with `at` stamped (see ConnectionsSection). */
  verifiedAt?: string;
}

/* The MEASURE_ME shopping list from omega1.template.json — the
 * numbers only a tape measure, calipers or a scale on the real robot
 * can give. The Improve-this-twin flow's step 3 is a mini-form over
 * exactly these fields; the flow's done-state is "every one of these
 * is present in the saved spec". Display: lengths in mm (stored in
 * metres), mass in kg, capacity in mAh. */
export interface MeasureField { path: string; label: string; unit: 'mm' | 'kg' | 'mAh' }
export const OMEGA1_MEASURE_FIELDS: MeasureField[] = [
  { path: 'length_m', label: 'Chassis plate length', unit: 'mm' },
  { path: 'width_m', label: 'Chassis plate width', unit: 'mm' },
  { path: 'height_m', label: 'Height — floor to tallest fixed part', unit: 'mm' },
  { path: 'ground_clearance_m', label: 'Ground clearance', unit: 'mm' },
  { path: 'wheel.diameter_m', label: 'Wheel diameter — calipers across the tyre', unit: 'mm' },
  { path: 'wheel.width_m', label: 'Wheel (tyre) width', unit: 'mm' },
  { path: 'mass_kg', label: 'Whole robot mass — batteries in', unit: 'kg' },
  { path: 'battery.capacity_mah', label: 'Battery capacity — printed on your 18650 cells', unit: 'mAh' },
];

/* Omega1's wiring, from the DOCUMENTED fields of the extraction only:
 * the PCA9685 channel map (README motor table + servo parameters),
 * the HC-SR04 GPIO pair, the line-tracking GPIOs, the ADS1115 address
 * and the CSI camera. The battery→hat row rests on the template's
 * battery provenance: the kit's two 18650 cells in series power the
 * robot through its PWM hat. */
export const OMEGA1_CONNECTIONS: SpecConnection[] = [
  { from: 'Battery (2× 18650 in series)', to: 'PCA9685 PWM hat', detail: 'Power — 7.4 V nominal pack', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Front-left motor', detail: 'I2C 0x40 · PWM ch 1 fwd / ch 0 back · 50 Hz', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Rear-left motor', detail: 'I2C 0x40 · PWM ch 2 fwd / ch 3 back · 50 Hz', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Front-right motor', detail: 'I2C 0x40 · PWM ch 7 fwd / ch 6 back · 50 Hz', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Rear-right motor', detail: 'I2C 0x40 · PWM ch 5 fwd / ch 4 back · 50 Hz', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Pan servo', detail: 'PWM ch 8', evidence: 'DOCUMENTED' },
  { from: 'PCA9685 PWM hat', to: 'Tilt servo', detail: 'PWM ch 9', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'HC-SR04', detail: 'GPIO 27 TRIG · GPIO 22 ECHO · front', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'Line-tracking IR ×3', detail: 'GPIO 14 / 15 / 23', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'ADS1115 battery ADC', detail: 'I2C 0x48', evidence: 'DOCUMENTED' },
  { from: 'Raspberry Pi 4B', to: 'OV5647 camera', detail: 'CSI', evidence: 'DOCUMENTED' },
];

/* The first version's source: the seed was read out of Abel's own
 * GitHub repo (Omega-Code) by the docs/omega1 extraction — 'repo'
 * ("From a GitHub repo") is the honest member of the union. Not
 * 'generated' (no engine invented it) and not 'robodex' (it is not a
 * catalogue entry). */
export const OMEGA1_SEED_SOURCE: VersionSource = 'repo';

export const OMEGA1_SEED_NOTE =
  'Seeded from Omega1\u2019s records — the Freenove FNK0043 kit record and the extraction of Abel\u2019s Omega-Code repo (docs/omega1/, 2026-11-01). DOCUMENTED fields only: dimensions, mass, wheel diameter, battery capacity and motor voltage are MEASURE_ME in the records and stay blank until they are measured on the real robot or applied from a scan.';

/* The stored Omega1 entry adoption creates: fixed id, one
 * Baseline version from the documented seed spec. This is the
 * record the Robodex My robots specimen card (DexSources.tsx)
 * writes when adopted from there — field-for-field the record
 * the Workshop's Adopt button writes (Garage.tsx keeps its own
 * construction, pinned by tests/test_omega1_garage.py), so
 * adopting from either place yields the identical entry. */
export function buildOmega1SeedEntry(nowIso: string, versionId: string): GarageRobot {
  return {
    id: OMEGA1_ROBOT_ID,
    name: 'Omega1',
    createdAt: nowIso,
    versions: [{ id: versionId, label: 'Baseline', note: OMEGA1_SEED_NOTE, source: OMEGA1_SEED_SOURCE, createdAt: nowIso, spec: omega1SeedSpec() }],
  };
}

/* The spec the stored copy is born with. DOCUMENTED template fields
 * only; the MEASURE_ME names (length_m, width_m, height_m,
 * ground_clearance_m, mass_kg, wheel.diameter_m, wheel.width_m,
 * battery.capacity_mah, motor.voltage_v, motor.stall_torque_nm) are
 * not keys here at all. */
/* The guided flow's done-states, computed from the store and
 * nothing else (pinned by tests/test_omega1_garage.py):
 *  1 scans   — at least one labelled slot is attached;
 *  2 measure — a saved version carries the scan-apply note prefix
 *              (written by Garage.applyScanSize), i.e. dimensions
 *              really came from a scan, not from the step-3 form;
 *  3 numbers — every MEASURE_ME field is a number in the saved spec;
 *  4 wiring  — the connections list exists and every row confirmed. */
export function improveStepStates(robot: GarageRobot, savedSpec: Spec): {
  scans: boolean; measured: boolean; numbers: boolean; wiring: boolean; done: number;
  numbersIn: number; confirmed: number; connTotal: number;
} {
  const scans = (robot.scans?.length ?? 0) >= 1;
  const measured = robot.versions.some((v) => v.note.startsWith('Dimensions measured from scan'));
  const numbersIn = OMEGA1_MEASURE_FIELDS.filter((f) => typeof getPath(savedSpec, f.path) === 'number').length;
  const conns: SpecConnection[] = Array.isArray(savedSpec?.connections) ? (savedSpec.connections as SpecConnection[]) : [];
  const confirmed = conns.filter((c) => c?.verifiedAt).length;
  const states = {
    scans,
    measured,
    numbers: numbersIn === OMEGA1_MEASURE_FIELDS.length,
    wiring: conns.length > 0 && confirmed === conns.length,
    numbersIn,
    confirmed,
    connTotal: conns.length,
  };
  return { ...states, done: [states.scans, states.measured, states.numbers, states.wiring].filter(Boolean).length };
}

export function omega1SeedSpec(): Spec {
  return {
    name: 'Omega1',
    description:
      'Omega1 — Abel\u2019s own robot, a Freenove FNK0043 4WD Raspberry Pi car (ordinary wheels), skid-steer, manual remote control. This stored copy was seeded from its records: the kit record in docs/omega1/omega1.template.json and the per-field extraction of Abel\u2019s Omega-Code repo (docs/omega1/omega1.extracted.json, extracted 2026-11-01). Only DOCUMENTED fields are filled. Sizes, mass, wheel diameter, battery capacity and motor voltage are deliberately absent — in the records they are MEASURE_ME, to be taken on the real robot or applied from a scan; the vendor envelope and the code defaults were NOT entered as measurements.',
    drivetrain: 'skid_steer',
    wheel: { count: 4, driven: true },
    motor: { count: 4, kind: 'dc_gearmotor' },
    battery: { chemistry: 'liion', voltage_v: 7.4 },
    sensors: [
      { kind: 'ultrasonic', position: 'front' },
      { kind: 'rgb_camera', position: 'front' },
    ],
    connections: OMEGA1_CONNECTIONS.map((c) => ({ ...c })),
  };
}
