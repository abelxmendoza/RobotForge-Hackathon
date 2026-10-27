/* Browser validation subset — a port of the core of
 * src/robotforge/validate.py plus the required-field/type layer of
 * src/robotforge/schema.py (RobotSpec.from_dict), identical to the
 * block between the forge-validate markers in assets/js/forge.js.
 * Pure: tests compare its output line for line with the Python
 * validator. It is a SUBSET: the full schema strictness (wiring
 * blocks, unknown keys) and everything downstream (URDF, twin,
 * gate) live in the CLI. */

const FV_DRIVETRAINS = [
  'differential', 'skid_steer', 'ackermann', 'mecanum', 'tracked',
  'multirotor', 'quadruped', 'humanoid', 'robotic_arm',
];
const FV_GROUND = ['differential', 'skid_steer', 'ackermann', 'mecanum', 'tracked'];
const FV_SENSOR_KINDS = [
  'ultrasonic', 'lidar_2d', 'depth_camera', 'rgb_camera', 'imu', 'gps',
  'bumper', 'encoder',
];

function fvFmt3(v: number): string {
  return v.toFixed(3);
}
function fvFmtG(v: number): string {
  return String(parseFloat(v.toPrecision(6)));
}
function fvIsNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function fvIsInt(v: unknown): v is number {
  return fvIsNum(v) && Number.isInteger(v);
}

export interface ValidateResult {
  lines: string[];
  schemaErrors: boolean;
  errors: boolean;
}

type Rec = Record<string, unknown>;

export function forgeValidateSpec(specIn: unknown): ValidateResult {
  /* Returns { lines: ['[SEVERITY] check: message', ...],
   *           schemaErrors: bool, errors: bool } */
  const lines: string[] = [];
  const schema = (check: string, msg: string) =>
    lines.push('[ERROR] ' + check + ': ' + msg);
  if (typeof specIn !== 'object' || specIn === null || Array.isArray(specIn)) {
    schema('schema.type', 'the spec is not a JSON object');
    return { lines, schemaErrors: true, errors: true };
  }
  const spec = specIn as Rec;
  /* Required fields follow the spec's class, as in schema.py:
   * wheels + ground clearance belong to the ground drivetrains;
   * the other classes declare rotors / legs / arms instead. */
  const reqTop = ['name', 'drivetrain', 'length_m', 'width_m', 'height_m', 'mass_kg', 'motor', 'battery'];
  if (FV_GROUND.includes(spec.drivetrain as string)) {
    reqTop.push('ground_clearance_m', 'wheel');
  }
  if (spec.drivetrain === 'multirotor') reqTop.push('rotors');
  if (spec.drivetrain === 'quadruped' || spec.drivetrain === 'humanoid') {
    reqTop.push('legs');
  }
  if (spec.drivetrain === 'humanoid' || spec.drivetrain === 'robotic_arm') {
    reqTop.push('arms');
  }
  for (const k of reqTop) {
    if (!(k in spec)) schema('schema.required', 'missing field: ' + k);
  }
  const reqNested: Record<string, string[]> = {
    wheel: ['diameter_m', 'width_m', 'count'],
    motor: ['kind', 'voltage_v', 'count'],
    battery: ['chemistry', 'voltage_v', 'capacity_mah'],
    rotors: ['count', 'prop_diameter_m'],
    legs: ['count'],
    arms: ['count'],
  };
  for (const obj of Object.keys(reqNested)) {
    if (typeof spec[obj] !== 'object' || spec[obj] === null) {
      if (obj in spec) schema('schema.type', obj + ' is not an object');
      continue;
    }
    for (const k of reqNested[obj]) {
      if (!(k in (spec[obj] as Rec))) {
        schema('schema.required', 'missing field: ' + obj + '.' + k);
      }
    }
  }
  if (lines.length) return { lines, schemaErrors: true, errors: true };
  /* types (schema.py coerces with float()/int()/str(); the browser
   * subset requires real JSON numbers/strings instead) */
  if (typeof spec.name !== 'string') {
    schema('schema.type', 'name is not a string');
  }
  for (const k of ['length_m', 'width_m', 'height_m', 'mass_kg']) {
    if (!fvIsNum(spec[k])) schema('schema.type', k + ' is not a number');
  }
  if (spec.ground_clearance_m !== undefined && !fvIsNum(spec.ground_clearance_m)) {
    schema('schema.type', 'ground_clearance_m is not a number');
  }
  const wheel = spec.wheel as Rec | undefined;
  if (wheel !== undefined && wheel !== null) {
    if (!fvIsNum(wheel.diameter_m)) {
      schema('schema.type', 'wheel.diameter_m is not a number');
    }
    if (!fvIsNum(wheel.width_m)) {
      schema('schema.type', 'wheel.width_m is not a number');
    }
    if (!fvIsInt(wheel.count)) {
      schema('schema.type', 'wheel.count is not an integer');
    }
  }
  const rotors = spec.rotors as Rec | undefined;
  if (rotors !== undefined && rotors !== null) {
    if (!fvIsInt(rotors.count)) {
      schema('schema.type', 'rotors.count is not an integer');
    }
    if (!fvIsNum(rotors.prop_diameter_m)) {
      schema('schema.type', 'rotors.prop_diameter_m is not a number');
    }
  }
  for (const key of ['legs', 'arms']) {
    const limb = spec[key] as Rec | undefined;
    if (limb !== undefined && limb !== null && !fvIsInt(limb.count)) {
      schema('schema.type', key + '.count is not an integer');
    }
  }
  const motor = spec.motor as Rec;
  const battery = spec.battery as Rec;
  if (typeof motor.kind !== 'string') {
    schema('schema.type', 'motor.kind is not a string');
  }
  if (!fvIsNum(motor.voltage_v)) {
    schema('schema.type', 'motor.voltage_v is not a number');
  }
  if (!fvIsInt(motor.count)) {
    schema('schema.type', 'motor.count is not an integer');
  }
  if (typeof battery.chemistry !== 'string') {
    schema('schema.type', 'battery.chemistry is not a string');
  }
  if (!fvIsNum(battery.voltage_v)) {
    schema('schema.type', 'battery.voltage_v is not a number');
  }
  if (!fvIsInt(battery.capacity_mah)) {
    schema('schema.type', 'battery.capacity_mah is not an integer');
  }
  if (!FV_DRIVETRAINS.includes(spec.drivetrain as string)) {
    schema('schema.drivetrain', 'unknown drivetrain: ' + String(spec.drivetrain));
  }
  const sensors = (spec.sensors === undefined ? [] : spec.sensors) as unknown[];
  if (!Array.isArray(sensors)) {
    schema('schema.type', 'sensors is not a list');
  } else {
    for (const s of sensors) {
      const sr = s as Rec | null;
      if (!sr || typeof sr !== 'object' || !FV_SENSOR_KINDS.includes(sr.kind as string)) {
        schema('schema.sensor_kind', 'unknown sensor kind: ' + String(sr && sr.kind));
      } else if (typeof sr.position !== 'string') {
        schema('schema.type', 'sensor position is not a string');
      }
    }
  }
  if (lines.length) return { lines, schemaErrors: true, errors: true };

  /* coherence checks — validate.py, check for check */
  const f = (sev: string, check: string, msg: string) =>
    lines.push('[' + sev + '] ' + check + ': ' + msg);
  const num = (v: unknown) => v as number;
  const L = num(spec.length_m);
  const H = num(spec.height_m);
  const mass = num(spec.mass_kg);
  if (wheel) {
    const radius = num(wheel.diameter_m) / 2.0;
    if (spec.ground_clearance_m != null && (spec.ground_clearance_m as number) > radius) {
      f(
        'ERROR',
        'geometry.clearance_vs_wheel',
        'ground clearance ' +
          fvFmt3(spec.ground_clearance_m as number) +
          ' m exceeds wheel radius ' +
          fvFmt3(radius) +
          ' m — impossible without a lifted chassis design',
      );
    }
    if (num(wheel.diameter_m) > H) {
      f(
        'WARN',
        'geometry.wheel_vs_height',
        'wheel diameter ' +
          fvFmt3(num(wheel.diameter_m)) +
          ' m is larger than body height ' +
          fvFmt3(H) +
          ' m',
      );
    }
    if (
      num(wheel.width_m) * num(wheel.count) > L * 2 &&
      (spec.drivetrain === 'differential' || spec.drivetrain === 'skid_steer')
    ) {
      f('WARN', 'geometry.wheel_footprint', 'total wheel width looks large relative to body length');
    }
    if (spec.drivetrain === 'differential' && wheel.count !== 2) {
      f(
        'WARN',
        'drivetrain.wheel_count',
        'differential drive normally has 2 driven wheels, spec declares ' + wheel.count + ' wheels',
      );
    }
    if (spec.drivetrain === 'ackermann' && wheel.count !== 4) {
      f('WARN', 'drivetrain.wheel_count', 'ackermann steering normally uses 4 wheels');
    }
  }
  if (num(motor.count) < 1) {
    f('ERROR', 'drivetrain.motor_count', 'no motors declared');
  }
  if (
    (spec.drivetrain === 'differential' || spec.drivetrain === 'skid_steer') &&
    motor.count === 1
  ) {
    f(
      'WARN',
      'drivetrain.motor_count',
      'a single motor cannot drive a differential/skid-steer drivetrain without a shared axle gearbox',
    );
  }
  /* class coherence — validate.py's non-ground checks, mirrored */
  if (spec.drivetrain === 'multirotor') {
    if (!rotors) {
      f('ERROR', 'class.rotors_missing', 'multirotor spec declares no rotors block');
    } else {
      if (rotors.count !== motor.count) {
        f(
          'WARN',
          'drivetrain.rotor_motor_match',
          'a multirotor normally has one motor per rotor, spec declares ' +
            rotors.count +
            ' rotors and ' +
            motor.count +
            ' motors',
        );
      }
      const spacing = Math.min(L, num(spec.width_m));
      if (num(rotors.prop_diameter_m) > spacing) {
        f(
          'WARN',
          'geometry.prop_overlap',
          'propeller diameter ' +
            fvFmt3(num(rotors.prop_diameter_m)) +
            ' m exceeds the ' +
            fvFmt3(spacing) +
            ' m between neighbouring motors — the props would overlap',
        );
      }
    }
  }
  if (spec.drivetrain === 'quadruped' || spec.drivetrain === 'humanoid') {
    const legs = spec.legs as Rec | undefined;
    if (!legs) {
      f('ERROR', 'class.legs_missing', spec.drivetrain + ' spec declares no legs block');
    } else {
      const want = spec.drivetrain === 'quadruped' ? 4 : 2;
      if (legs.count !== want) {
        f(
          'WARN',
          'drivetrain.leg_count',
          'a ' + spec.drivetrain + ' normally has ' + want + ' legs, spec declares ' + legs.count,
        );
      }
    }
  }
  if (spec.drivetrain === 'humanoid' || spec.drivetrain === 'robotic_arm') {
    const arms = spec.arms as Rec | undefined;
    if (!arms) {
      f('ERROR', 'class.arms_missing', spec.drivetrain + ' spec declares no arms block');
    } else {
      const want = spec.drivetrain === 'humanoid' ? 2 : 1;
      if (arms.count !== want) {
        f(
          'WARN',
          'drivetrain.arm_count',
          'a ' + spec.drivetrain + ' normally has ' + want + ' arm(s), spec declares ' + arms.count,
        );
      }
    }
  }
  if (num(motor.voltage_v) > num(battery.voltage_v) * 1.05) {
    f(
      'ERROR',
      'electrical.voltage_match',
      'motor voltage ' +
        fvFmtG(num(motor.voltage_v)) +
        ' V exceeds battery ' +
        fvFmtG(num(battery.voltage_v)) +
        ' V — motors would be undervolted or need a boost converter',
    );
  } else if (num(motor.voltage_v) < num(battery.voltage_v) * 0.5) {
    f(
      'WARN',
      'electrical.voltage_match',
      'motor voltage ' +
        fvFmtG(num(motor.voltage_v)) +
        ' V is far below battery ' +
        fvFmtG(num(battery.voltage_v)) +
        ' V — a regulator is required and was not declared',
    );
  }
  const cm = spec.component_mass_kg as Record<string, number> | undefined;
  if (cm && typeof cm === 'object' && Object.keys(cm).length) {
    const total = Object.values(cm).reduce((a, b) => a + Number(b), 0);
    if (total > mass * 1.005) {
      f(
        'ERROR',
        'mass.budget',
        'component masses sum to ' +
          total.toFixed(2) +
          ' kg, above the declared total ' +
          mass.toFixed(2) +
          ' kg',
      );
    } else if (total < mass * 0.4) {
      f(
        'WARN',
        'mass.budget',
        'component masses sum to ' +
          total.toFixed(2) +
          ' kg, only ' +
          Math.round((100 * total) / mass) +
          '% of the declared total ' +
          mass.toFixed(2) +
          ' kg — mass is unaccounted for',
      );
    }
  }
  for (const s of sensors as { kind: string; position: string; range_m?: number | null }[]) {
    if (s.range_m != null && s.range_m <= 0) {
      f('ERROR', 'sensor.range', s.kind + ' sensor at ' + s.position + ' has non-positive range ' + String(s.range_m));
    }
  }
  if (!lines.length) {
    lines.push('[INFO] all: spec passed all engineering checks');
  }
  return {
    lines,
    schemaErrors: false,
    errors: lines.some((l) => l.startsWith('[ERROR]')),
  };
}
