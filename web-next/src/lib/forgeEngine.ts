/* Forge Engine v1 — the deterministic core (design doc §1: the model
 * proposes, deterministic authorities dispose). Pure functions, no
 * app imports, no I/O: the caller passes the catalogue in, and every
 * number below is either a catalogue value, a conversion of one, or
 * a labeled assumption/estimate named as such on the line that
 * carries it. Nothing here invents a part, a price, or a rating.
 *
 * Generated robots are PLANS: the Garage saves them as planned
 * versions, and the checks say NOT_CHECKED (with the missing input
 * named) wherever the catalogue does not record what a verdict
 * would need. */

export interface CataloguePart {
  id: string;
  name?: string;
  part_class?: string;
  specs?: Record<string, unknown>;
  /* Set only on entries that arrived through the web knowledge
   * loop (lib/webParts.mergeCatalogue): a page the visitor fetched
   * and confirmed in chat. Their specs are WEB-SOURCED —
   * UNVERIFIED, and runEngineChecks says so on any build that uses
   * one. Built-in catalogue entries never carry this flag. */
  web_sourced?: boolean;
  provenance?: { sourceUrl: string; fetchedAt: string; sourceKind: 'scrape' | 'search' };
}

export type ArchetypeId = 'differential_rover' | 'mecanum_rover' | 'robotic_arm' | 'multirotor';
export type ForgeSize = 'compact' | 'standard' | 'large';
export type ForgeVerdict = 'PASS' | 'WARN' | 'ERROR' | 'NOT_CHECKED';

export interface ForgeBrief {
  text: string;
  archetype: ArchetypeId;
  size: ForgeSize;
  sensors: string[]; // subset of: lidar, camera, depth_camera, imu, ultrasonic
  name: string;
}

export interface ForgePlacement { partId: string; role: string; pos_mm: [number, number, number]; orient: string; why: string }
export interface ForgeWiring { from: string; to: string; kind: 'power' | 'data'; volts: number | null; connector: string; why: string }
export interface ForgePrint {
  name: string; scad: string; material: 'PLA' | 'PETG'; orientation: string;
  infill_pct: number; walls: number; bed_fit: 'yes' | 'no' | 'unknown';
  filament_g_est: number; time_min_est: number; estimate_label: string;
}
export interface ForgeCheck { id: string; verdict: ForgeVerdict; detail: string }
export interface ForgeBomLine { partId: string; qty: number; source: 'catalogue' | 'printed' | 'unknown' }
export interface ForgeData {
  placement: ForgePlacement[];
  wiring: ForgeWiring[];
  prints: ForgePrint[];
  checks: ForgeCheck[];
  bom: ForgeBomLine[];
  assembly: string[];
  gather: string[];
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type ForgeSpec = any;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (n: number) => Math.round(n * 100) / 100;

/* Recorded voltage ceiling of a part, from whichever field the
 * catalogue actually records. A range string ("4.8-7.2") reads as
 * its upper end. Absent = null = NOT_CHECKED downstream, never 0. */
export function recordedVoltageMax(part: CataloguePart | undefined): number | null {
  if (!part?.specs) return null;
  const s = part.specs;
  for (const k of ['voltage_v_max', 'input_v_max']) {
    const v = num(s[k]);
    if (v !== null) return v;
  }
  const v = s['voltage_v'];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ends = v.split('-').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
    if (ends.length) return Math.max(...ends);
  }
  return null;
}

/* Nominal (operating) voltage where the catalogue records one. */
export function recordedVoltageNominal(part: CataloguePart | undefined): number | null {
  if (!part?.specs) return null;
  const v = part.specs['voltage_v'];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ends = v.split('-').map((x) => parseFloat(x)).filter((x) => Number.isFinite(x));
    if (ends.length) return ends[ends.length - 1];
  }
  const out = num(part.specs['output_v']);
  return out;
}

function byId(catalogue: CataloguePart[]): Map<string, CataloguePart> {
  return new Map(catalogue.map((p) => [p.id, p]));
}

/* ------------------------------------------------------------------ */
/* Brief parsing: deterministic keywords + explicit options win.       */
/* ------------------------------------------------------------------ */

export function parseBrief(text: string, options?: Partial<ForgeBrief>): ForgeBrief {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  let archetype: ArchetypeId = 'differential_rover';
  if (/\b(mecanum|holonomic|omni|omniwheel)/.test(t)) archetype = 'mecanum_rover';
  else if (/\b(arm|manipulator|gripper|pick and place|pick-and-place)/.test(t)) archetype = 'robotic_arm';
  else if (/\b(drone|quadcopter|quad|multirotor|fly|flying|uav)/.test(t)) archetype = 'multirotor';
  else if (/\b(rover|differential|skid|tank|car|drive base|robot)\b/.test(t)) archetype = 'differential_rover';

  let size: ForgeSize = 'standard';
  if (/\b(compact|small|mini|tiny|desktop)\b/.test(t)) size = 'compact';
  if (/\b(large|big|heavy|outdoor|bigger)\b/.test(t)) size = 'large';

  const sensors: string[] = [];
  if (/\b(lidar|laser scan|rplidar)\b/.test(t)) sensors.push('lidar');
  if (/\b(depth camera|realsense|depth)\b/.test(t)) sensors.push('depth_camera');
  else if (/\b(camera|vision|webcam)\b/.test(t)) sensors.push('camera');
  if (/\b(imu|gyro|accelerometer|orientation sensor)\b/.test(t)) sensors.push('imu');
  if (/\b(ultrasonic|sonar|distance sensor)\b/.test(t)) sensors.push('ultrasonic');
  // Rovers get an IMU by default: heading is unobservable without one.
  if ((archetype === 'differential_rover' || archetype === 'mecanum_rover') && !sensors.includes('imu')) sensors.push('imu');

  const nameMatch = String(text ?? '').match(/\b(?:call(?:ed)?|name(?:d)?)\s+["']?([A-Za-z][A-Za-z0-9 _-]{1,30})/i);
  const fallbackName = {
    differential_rover: 'Generated Rover',
    mecanum_rover: 'Generated Mecanum Rover',
    robotic_arm: 'Generated Arm',
    multirotor: 'Generated Multirotor',
  }[archetype];

  const brief: ForgeBrief = {
    text: String(text ?? ''),
    archetype,
    size,
    sensors,
    name: nameMatch ? nameMatch[1].trim() : fallbackName,
  };
  if (options?.archetype) brief.archetype = options.archetype;
  if (options?.size) brief.size = options.size;
  if (options?.sensors) brief.sensors = [...options.sensors];
  if (options?.name?.trim()) brief.name = options.name.trim();
  return brief;
}

/* ------------------------------------------------------------------ */
/* Component selection: catalogue ids only. A need with no catalogue   */
/* part becomes a gather line, never an invented part.                 */
/* ------------------------------------------------------------------ */

interface Selection { bom: ForgeBomLine[]; gather: string[]; ids: Record<string, string> }

const NEEDS: Record<ArchetypeId, { key: string; partId: string; qty: number }[]> = {
  differential_rover: [
    { key: 'battery', partId: 'lipo_3s_2200', qty: 1 },
    { key: 'fuse', partId: 'fuse_inline', qty: 1 },
    { key: 'driver', partId: 'driver_tb6612fng', qty: 1 },
    { key: 'regulator', partId: 'buck_converter_5v', qty: 1 },
    { key: 'controller', partId: 'raspberry_pi_5', qty: 1 },
    { key: 'motor', partId: 'gearmotor_12v', qty: 2 },
    { key: 'wheel', partId: 'wheel_100mm', qty: 2 },
    { key: 'caster', partId: 'caster_ball', qty: 1 },
    { key: 'chassis', partId: 'chassis_plate', qty: 1 },
    { key: 'motorMount', partId: 'motor_mount', qty: 2 },
  ],
  mecanum_rover: [
    { key: 'battery', partId: 'lipo_3s_2200', qty: 1 },
    { key: 'fuse', partId: 'fuse_inline', qty: 1 },
    // TB6612FNG is a 2-channel driver: four mecanum motors need two.
    { key: 'driver', partId: 'driver_tb6612fng', qty: 2 },
    { key: 'regulator', partId: 'buck_converter_5v', qty: 1 },
    { key: 'controller', partId: 'raspberry_pi_5', qty: 1 },
    { key: 'motor', partId: 'gearmotor_12v', qty: 4 },
    { key: 'wheel', partId: 'mecanum_wheel_100mm', qty: 4 },
    { key: 'chassis', partId: 'chassis_plate', qty: 1 },
    { key: 'motorMount', partId: 'motor_mount', qty: 4 },
  ],
  robotic_arm: [
    { key: 'battery', partId: 'liion_18650_3s', qty: 1 },
    { key: 'fuse', partId: 'fuse_inline', qty: 1 },
    { key: 'regulator', partId: 'buck_converter_5v', qty: 1 },
    { key: 'controller', partId: 'teensy_41', qty: 1 },
    // MG996R is powered via the 5 V regulator: 5 V sits inside its
    // recorded 4.8-7.2 V range, so the mediated rail honestly passes.
    { key: 'servo', partId: 'servo_mg996r', qty: 4 },
    { key: 'gripper', partId: 'gripper_2finger', qty: 1 },
  ],
  multirotor: [
    { key: 'battery', partId: 'lipo_4s_1500', qty: 1 },
    { key: 'esc', partId: 'esc_4in1_45a', qty: 1 },
    { key: 'fc', partId: 'fc_f405_stack', qty: 1 },
    { key: 'motor', partId: 'brushless_2207_1960kv', qty: 4 },
    { key: 'propeller', partId: 'propeller_5040', qty: 4 },
    { key: 'frame', partId: 'quad_frame_5inch', qty: 1 },
    { key: 'receiver', partId: 'elrs_receiver', qty: 1 },
  ],
};

const SENSOR_PARTS: Record<string, { partId: string; qty: number; printedMount?: string }> = {
  lidar: { partId: 'rplidar_a1', qty: 1, printedMount: 'lidar_mount' },
  camera: { partId: 'camera_rpi_v2', qty: 1, printedMount: 'camera_bracket' },
  depth_camera: { partId: 'realsense_d435', qty: 1, printedMount: 'camera_bracket' },
  imu: { partId: 'imu_bno055', qty: 1 },
  ultrasonic: { partId: 'ultrasonic_hcsr04', qty: 1, printedMount: 'ultrasonic_bracket' },
};

const PRINTED_IDS = new Set(['chassis_plate', 'motor_mount', 'lidar_mount', 'camera_bracket', 'ultrasonic_bracket']);

function selectComponents(brief: ForgeBrief, catalogue: CataloguePart[]): Selection {
  const have = byId(catalogue);
  const bom: ForgeBomLine[] = [];
  const gather: string[] = [];
  const ids: Record<string, string> = {};
  const add = (key: string, partId: string, qty: number) => {
    if (!have.has(partId)) { gather.push(`No catalogue part for ${key} (${partId}) — gather request, not an invented part.`); return; }
    ids[key] = partId;
    const line = bom.find((b) => b.partId === partId);
    if (line) line.qty += qty;
    else bom.push({ partId, qty, source: PRINTED_IDS.has(partId) ? 'printed' : 'catalogue' });
  };
  for (const n of NEEDS[brief.archetype]) add(n.key, n.partId, n.qty);
  for (const s of brief.sensors) {
    const sp = SENSOR_PARTS[s];
    if (!sp) { gather.push(`Unknown sensor need "${s}" — gather request, not an invented part.`); continue; }
    add(s, sp.partId, sp.qty);
    if (sp.printedMount) add(`${s}Mount`, sp.printedMount, 1);
  }
  return { bom, gather, ids };
}

/* ------------------------------------------------------------------ */
/* Placement: every line carries the rule that placed it. Coordinates  */
/* are mm in the robot frame: +X forward, +Y left, +Z up, origin at    */
/* the chassis centre on the ground plane.                             */
/* ------------------------------------------------------------------ */

export function suggestPlacement(spec: ForgeSpec, catalogue: CataloguePart[]): ForgePlacement[] {
  const ids: Record<string, string> = spec?.forge?.ids ?? {};
  const L = Math.round((spec?.length_m ?? 0.3) * 1000);
  const W = Math.round((spec?.width_m ?? 0.25) * 1000);
  const H = Math.round((spec?.height_m ?? 0.2) * 1000);
  const out: ForgePlacement[] = [];
  const put = (key: string, role: string, pos: [number, number, number], orient: string, why: string) => {
    const partId = ids[key];
    if (partId) out.push({ partId, role, pos_mm: pos, orient, why });
  };

  if (spec?.drivetrain === 'multirotor') {
    put('fc', 'flight controller', [0, 0, Math.round(H * 0.55)], 'level, arrow forward (+X)', 'Flight controller at the frame centre, level: attitude sensing assumes a level centre mount.');
    put('battery', 'battery', [0, 0, Math.round(H * 0.3)], 'long axis along +X, connector aft', 'Battery low and central: keeps the centre of gravity at the frame centre so no motor works harder to hold level.');
    put('esc', 'ESC (4-in-1)', [0, 0, Math.round(H * 0.42)], 'stacked under the flight controller', 'ESC in the centre stack: equal wire runs to all four motors.');
    put('motor', 'motors ×4', [Math.round(L / 4), Math.round(W / 4), Math.round(H * 0.6)], 'shafts vertical, one per arm end (mirrored ±X, ±Y)', 'Motors symmetric at the arm ends: thrust lines balance around the centre of gravity.');
    put('receiver', 'receiver', [Math.round(-L / 4), 0, Math.round(H * 0.45)], 'antennas clear of the frame, angled apart', 'Receiver away from the power stack: fewer RF shadows from the battery and carbon frame (assumption — no RF model run).');
    return out;
  }
  if (spec?.drivetrain === 'robotic_arm') {
    put('controller', 'controller', [0, Math.round(W / 4), 10], 'level, USB aft', 'Controller on the base plate beside the arm: short servo leads, weight stays in the base.');
    put('battery', 'battery', [Math.round(-L / 4), 0, 10], 'long axis along +X', 'Battery in the base, low and behind the arm pivot: counterweight against a forward reach.');
    put('regulator', '5 V regulator', [Math.round(-L / 5), Math.round(W / 4), 10], 'output header toward the servos', 'Regulator beside the battery: the high-current servo rail stays short.');
    put('servo', 'joint servos', [0, 0, Math.round(H * 0.4)], 'output shafts horizontal, axes parallel', 'Joint servos stacked along the arm axis: each joint rotates in the same vertical plane.');
    put('gripper', 'gripper', [Math.round(L / 2), 0, H], 'fingers opening along +Y, facing +X', 'Gripper at the arm tip, facing forward (+X): the end of the reach envelope.');
    return out;
  }
  // Rovers (differential + mecanum share the deck rules).
  const wheelbaseX = Math.round(L * 0.32);
  const trackY = Math.round(W / 2);
  put('battery', 'battery', [0, 0, 25], 'long axis along +X, connector aft', 'Battery lowest and central: the heaviest part sits low to keep the centre of gravity down and between the axles.');
  put('driver', 'motor driver', [Math.round(-L / 6), 0, 45], 'terminals facing aft, toward the motors', 'Driver adjacent to the motors it feeds: short high-current runs, less voltage drop and noise.');
  put('regulator', '5 V regulator', [Math.round(-L / 6), Math.round(W / 5), 45], 'output header toward the controller', 'Regulator next to the battery output: the logic rail starts where the power enters.');
  put('controller', 'controller', [Math.round(L / 8), 0, 60], 'level, ports aft', 'Controller central on the deck: equal reach to driver and sensors, away from motor noise at the edges.');
  put('motor', 'motors', [wheelbaseX, trackY, 50], 'shafts along ±Y, mirrored left/right', 'Motors symmetric on the drive axle: equal load left and right, straight tracking.');
  put('wheel', 'wheels', [wheelbaseX, trackY + 16, 50], 'tread vertical, axle along Y', 'Wheels on the drive axle line, symmetric: the turning centre sits between them.');
  put('caster', 'ball caster', [Math.round(-L * 0.38), 0, 25], 'ball down', 'Caster at the rear, on the centre line: supports the tail without steering scrub.');
  put('lidar', 'lidar', [0, 0, H - 20], 'level, scan plane horizontal, front marker +X', 'Lidar top-centre with a clear 360° scan plane: nothing else on the deck may rise into it.');
  put('camera', 'camera', [Math.round(L / 2) - 5, 0, Math.round(H * 0.55)], 'lens facing forward (+X), level', 'Camera front-centre facing +X: it sees where the robot drives.');
  put('depth_camera', 'depth camera', [Math.round(L / 2) - 5, 0, Math.round(H * 0.55)], 'lens facing forward (+X), level', 'Depth camera front-centre facing +X: depth aligns with the direction of travel.');
  put('imu', 'IMU', [0, 0, 55], 'level, axes aligned with the robot frame (+X forward)', 'IMU at the centre axes, level: rotation readings describe the robot, not an offset corner.');
  put('ultrasonic', 'ultrasonic ranger', [Math.round(L / 2) - 2, 0, 40], 'transducers facing forward (+X)', 'Ultrasonic at the front face, facing +X: it ranges what the robot approaches.');
  void catalogue;
  return out;
}

/* ------------------------------------------------------------------ */
/* Wiring: power tree + data links, every line with its reason. The    */
/* voltage verdicts themselves live in runEngineChecks; a link that    */
/* is mediated (its source is a driver/regulator output) is checked    */
/* against that mediator's recorded output, not the raw battery.       */
/* ------------------------------------------------------------------ */

export function suggestWiring(spec: ForgeSpec, catalogue: CataloguePart[]): ForgeWiring[] {
  const have = byId(catalogue);
  const ids: Record<string, string> = spec?.forge?.ids ?? {};
  const bat = have.get(ids.battery ?? '');
  const batV = recordedVoltageNominal(bat);
  const out: ForgeWiring[] = [];
  const link = (fromKey: string, toKey: string, kind: 'power' | 'data', connector: string, why: string, volts: number | null) => {
    const from = ids[fromKey]; const to = ids[toKey];
    if (from && to) out.push({ from, to, kind, volts, connector, why });
  };

  if (spec?.drivetrain === 'multirotor') {
    link('battery', 'esc', 'power', 'XT60 (recorded on the battery)', 'Battery feeds the 4-in-1 ESC directly: it is the one board rated for the full pack voltage and current.', batV);
    link('esc', 'motor', 'power', '3 motor leads per motor (solder pads)', 'ESC outputs drive the brushless motors; the ESC mediates pack voltage, so the motors never see a raw-voltage verdict.', null);
    link('esc', 'fc', 'power', 'stack cable (assumption — connector not recorded)', 'The FC stack takes its power from the ESC board it stacks with.', null);
    link('fc', 'receiver', 'data', 'UART (recorded interface class)', 'Receiver talks to the flight controller over its recorded bus interface.', null);
    return out;
  }
  if (spec?.drivetrain === 'robotic_arm') {
    link('battery', 'fuse', 'power', 'pack lead (connector not recorded)', 'Fuse first on the battery output: every downstream rail inherits the protection.', batV);
    link('battery', 'regulator', 'power', 'screw terminals (assumption)', 'Battery feeds the 5 V regulator that the servos and controller share.', batV);
    link('regulator', 'servo', 'power', '3-pin servo leads', 'Servos run from the regulated 5 V rail — inside their recorded 4.8-7.2 V range — never raw pack voltage.', 5);
    link('regulator', 'controller', 'power', 'USB / 5 V header (assumption)', 'Controller logic runs from the same regulated 5 V rail.', 5);
    link('controller', 'servo', 'data', 'PWM headers (recorded interface)', 'Controller generates the PWM the servos are recorded to take.', null);
    link('controller', 'gripper', 'data', 'via the wrist servo (assumption — actuation not recorded)', 'The gripper is actuated through the wrist servo; its own actuation is not recorded in the catalogue.', null);
    return out;
  }
  // Rovers.
  link('battery', 'fuse', 'power', 'XT60 (recorded on the battery)', 'Fuse first on the battery output: every downstream rail inherits the protection.', batV);
  link('battery', 'driver', 'power', 'screw terminals (assumption)', 'Battery feeds the motor driver directly: the driver is the mediator the motors are rated through (the Andino rule).', batV);
  link('driver', 'motor', 'power', 'screw terminals (assumption)', 'Driver outputs feed the motors; mediated power is checked against the driver rating, not the battery.', batV);
  link('battery', 'regulator', 'power', 'screw terminals (assumption)', 'Battery also feeds the 5 V regulator for the logic rail: the controller must never see pack voltage.', batV);
  link('regulator', 'controller', 'power', 'USB-C 5 V (recorded supply: 5V/5A USB-C)', 'Controller runs from the regulated 5 V rail.', 5);
  link('controller', 'driver', 'data', 'GPIO PWM + direction (recorded interfaces include gpio)', 'Controller commands the driver over GPIO: PWM sets speed, direction pins set sense.', null);
  link('controller', 'lidar', 'data', 'UART/USB (recorded interface: uart/usb)', 'Lidar streams scans to the controller over its recorded interface.', null);
  link('controller', 'camera', 'data', 'CSI ribbon (recorded interface)', 'Camera connects over its recorded CSI interface.', null);
  link('controller', 'depth_camera', 'data', 'USB 3 (recorded interface: usb3)', 'Depth camera connects over its recorded USB interface.', null);
  link('controller', 'imu', 'data', 'I2C (recorded interface)', 'IMU is an I2C device on the controller bus.', null);
  link('controller', 'ultrasonic', 'data', 'GPIO trigger/echo (assumption — pins not recorded)', 'Ultrasonic ranging is timed on controller GPIO.', null);
  return out;
}

/* ------------------------------------------------------------------ */
/* Prints: CAD-kit part names/params. Filament/time are ESTIMATES      */
/* from the plate geometry and the catalogue filament density —        */
/* labeled on every line, never presented as a slicer result.          */
/* ------------------------------------------------------------------ */

export const FORGE_BED_MM = 220; // labeled assumption: a common 220×220 mm bed

export function planPrints(spec: ForgeSpec, catalogue: CataloguePart[]): ForgePrint[] {
  const have = byId(catalogue);
  const pla = num(have.get('pla_filament')?.specs?.density_g_cm3) ?? 1.24;
  const petg = num(have.get('petg_filament')?.specs?.density_g_cm3) ?? 1.27;
  const L = Math.round((spec?.length_m ?? 0.3) * 1000);
  const W = Math.round((spec?.width_m ?? 0.25) * 1000);
  const label = 'ESTIMATE — from plate geometry + catalogue filament density; not a slicer result';
  const est = (volCm3: number, density: number) => {
    const g = Math.round(volCm3 * density);
    return { g, min: Math.max(10, Math.round(g * 2.2)) }; // ~2.2 min/g at hobby print speeds (assumption)
  };
  const mk = (name: string, scad: string, material: 'PLA' | 'PETG', orientation: string,
    infill: number, walls: number, sx: number, sy: number, volCm3: number): ForgePrint => {
    const { g, min } = est(volCm3, material === 'PETG' ? petg : pla);
    return {
      name, scad, material, orientation, infill_pct: infill, walls,
      bed_fit: Math.max(sx, sy) <= FORGE_BED_MM ? 'yes' : 'no',
      filament_g_est: g, time_min_est: min, estimate_label: label,
    };
  };
  const out: ForgePrint[] = [];
  const ids: Record<string, string> = spec?.forge?.ids ?? {};
  if (spec?.drivetrain === 'multirotor' || spec?.drivetrain === 'robotic_arm') {
    // Frame and gripper are bought catalogue parts, not prints; the
    // honest print list for these archetypes is the electronics tray.
    out.push(mk('Electronics tray', 'battery_tray: tray under the stack', 'PETG',
      'flat face down', 30, 3, 90, 60, 90 * 60 * 3 / 1000 * 0.4));
    return out;
  }
  if (ids.chassis) {
    // A plate bigger than the bed prints in bolted tiles — a real
    // technique, and the scad summary says so instead of pretending
    // the whole plate fits.
    const tilesX = L > FORGE_BED_MM ? 2 : 1;
    const tilesY = W > FORGE_BED_MM ? 2 : 1;
    const tiles = tilesX * tilesY;
    const p = mk('Chassis plate', `chassis_plate: ${L}×${W} mm plate, 4× M3 holes${tiles > 1 ? `, printed in ${tiles} bolted tiles` : ''}`, 'PLA',
      'largest flat face down', 25, 3, Math.ceil(L / tilesX), Math.ceil(W / tilesY), L * W * 4 / 1000 * 0.35);
    out.push(p);
  }
  if (ids.motorMount) out.push(mk('Motor mounts', 'motor_mount: one per drive motor', 'PETG',
    'upright, mount face down', 40, 4, 45, 40, 45 * 40 * 25 / 1000 * 0.45));
  if (ids.lidarMount) out.push(mk('Lidar mount', 'lidar_mount: post to the deck top', 'PLA',
    'upright, base down', 30, 3, 75, 75, 75 * 75 * 30 / 1000 * 0.25));
  if (ids.cameraMount || ids.depth_cameraMount) out.push(mk('Camera bracket', 'camera_bracket: front deck bracket', 'PLA',
    'flat face down', 30, 3, 60, 30, 60 * 30 * 20 / 1000 * 0.35));
  if (ids.ultrasonicMount) out.push(mk('Ultrasonic bracket', 'ultrasonic_bracket: front face bracket', 'PLA',
    'flat face down', 30, 3, 50, 25, 50 * 25 * 15 / 1000 * 0.35));
  out.push(mk('Battery tray', 'battery_tray: strap tray on the bottom deck', 'PETG',
    'flat face down', 30, 3, 110, 55, 110 * 55 * 3 / 1000 * 0.4));
  return out;
}

/* ------------------------------------------------------------------ */
/* Checks: same honesty language as the harness — a verdict needs a    */
/* recorded input; without one the check is NOT_CHECKED and names      */
/* what is missing.                                                    */
/* ------------------------------------------------------------------ */

export function runEngineChecks(spec: ForgeSpec, catalogue: CataloguePart[]): ForgeCheck[] {
  const have = byId(catalogue);
  const forge: ForgeData | undefined = spec?.forge;
  const checks: ForgeCheck[] = [];
  const bom: ForgeBomLine[] = forge?.bom ?? [];
  const ids: Record<string, string> = (spec?.forge?.ids ?? {}) as Record<string, string>;

  // Unknown parts: every BOM line must resolve in the catalogue.
  const unknown = bom.filter((b) => b.source !== 'printed' && !have.has(b.partId)).map((b) => b.partId);
  checks.push(unknown.length
    ? { id: 'unknown-parts', verdict: 'ERROR', detail: `BOM lines not in the catalogue: ${unknown.join(', ')}. The engine never invents parts — these are gather requests.` }
    : { id: 'unknown-parts', verdict: 'PASS', detail: 'Every BOM line resolves to a real catalogue part id.' });

  // Web-sourced parts: a build that depends on an UNVERIFIED spec
  // must surface that fact — one combined WARN (the existing
  // severity, no new one) naming each web part in the BOM with its
  // source, so the reader can check it against the datasheet.
  const webUsed = bom.filter((b) => have.get(b.partId)?.web_sourced);
  if (webUsed.length) {
    const names = webUsed.map((b) => {
      const p = have.get(b.partId);
      const src = p?.provenance
        ? ` (source: ${p.provenance.sourceUrl}, fetched ${String(p.provenance.fetchedAt).slice(0, 10)})`
        : '';
      return `${p?.name ?? b.partId}${src}`;
    });
    checks.push({ id: 'unverified-web-parts', verdict: 'WARN', detail: `This build uses web-sourced part(s) whose specs are UNVERIFIED: ${names.join('; ')}. The figures came from a fetched web page, not a datasheet or a measurement — confirm each before building.` });
  }

  // Wheel / motor count agreement.
  const motorQty = bom.filter((b) => ['gearmotor_12v', 'brushless_2207_1960kv', 'servo_mg996r', 'servo_sts3215'].includes(b.partId)).reduce((a, b) => a + b.qty, 0);
  const specMotorCount = num(spec?.motor?.count);
  checks.push(specMotorCount !== null && motorQty > 0
    ? { id: 'motor-count', verdict: specMotorCount === motorQty ? 'PASS' : 'ERROR', detail: `Spec motor count ${specMotorCount} vs BOM motor quantity ${motorQty}.` }
    : { id: 'motor-count', verdict: 'NOT_CHECKED', detail: 'Missing input: spec motor.count or a BOM motor line.' });
  if (spec?.wheel) {
    const wheelQty = bom.filter((b) => b.partId === ids.wheel || b.partId === 'wheel_100mm' || b.partId === 'mecanum_wheel_100mm').reduce((a, b) => a + b.qty, 0);
    const specWheelCount = num(spec?.wheel?.count);
    checks.push(specWheelCount !== null && wheelQty > 0
      ? { id: 'wheel-count', verdict: specWheelCount === wheelQty ? 'PASS' : 'ERROR', detail: `Spec wheel count ${specWheelCount} vs BOM wheel quantity ${wheelQty}.` }
      : { id: 'wheel-count', verdict: 'NOT_CHECKED', detail: 'Missing input: spec wheel.count or a BOM wheel line.' });
  }

  // Voltage: direct vs mediated (Andino rule).
  const wiring: ForgeWiring[] = forge?.wiring ?? [];
  let voltChecked = 0;
  for (const w of wiring) {
    if (w.kind !== 'power' || w.volts === null) continue;
    const target = have.get(w.to);
    const mediated = /driver|regulat|esc/i.test(`${w.from} ${w.why}`) && w.from !== ids.battery;
    const rating = recordedVoltageMax(target);
    if (rating === null) {
      checks.push({ id: `voltage-${w.from}-${w.to}`, verdict: 'NOT_CHECKED', detail: `Missing input: no recorded voltage rating for ${w.to}, so the ${w.volts} V link from ${w.from} cannot be checked.` });
      continue;
    }
    voltChecked += 1;
    if (w.volts > rating && !mediated) {
      checks.push({ id: `voltage-${w.from}-${w.to}`, verdict: 'ERROR', detail: `${w.to} is fed ${w.volts} V direct from ${w.from}, above its recorded rating ${rating} V. Route it through a driver/regulator or pick a rated part.` });
    } else if (w.volts > rating && mediated) {
      checks.push({ id: `voltage-${w.from}-${w.to}`, verdict: 'WARN', detail: `${w.from} → ${w.to} at ${w.volts} V exceeds the recorded ${rating} V rating but is mediated (driver/regulator/ESC in the path) — the mediator's own rating governs; verify it before powering.` });
    } else {
      checks.push({ id: `voltage-${w.from}-${w.to}`, verdict: 'PASS', detail: `${w.from} → ${w.to}: ${w.volts} V is within the recorded rating ${rating} V${mediated ? ' (mediated link)' : ''}.` });
    }
  }
  if (!voltChecked && !checks.some((c) => c.id.startsWith('voltage-'))) {
    checks.push({ id: 'voltage', verdict: 'NOT_CHECKED', detail: 'Missing input: no power link carries both a voltage and a recorded target rating.' });
  }

  // Unpowered components: every powered BOM class needs an inbound power link or a battery of its own.
  const poweredIds = new Set(wiring.filter((w) => w.kind === 'power').map((w) => w.to));
  const needsPower = bom.filter((b) => {
    const pc = have.get(b.partId)?.part_class ?? '';
    return ['actuators', 'drivers', 'sbc', 'microcontrollers', 'flight_control', 'cameras_sensors'].includes(pc);
  });
  const unpowered = needsPower.filter((b) => !poweredIds.has(b.partId) && b.partId !== ids.camera && b.partId !== ids.imu && b.partId !== ids.ultrasonic && b.partId !== ids.lidar);
  // Sensors on a data link still need power in the real build; say so instead of passing silently.
  const dataOnly = needsPower.filter((b) => !poweredIds.has(b.partId) && (b.partId === ids.camera || b.partId === ids.imu || b.partId === ids.ultrasonic || b.partId === ids.lidar));
  checks.push(unpowered.length
    ? { id: 'unpowered', verdict: 'ERROR', detail: `No power path planned for: ${unpowered.map((b) => b.partId).join(', ')}.` }
    : { id: 'unpowered', verdict: 'PASS', detail: 'Every actuator/driver/controller in the BOM has a planned power path.' });
  if (dataOnly.length) {
    checks.push({ id: 'sensor-power', verdict: 'NOT_CHECKED', detail: `Missing input: sensor power rails are not recorded separately for ${dataOnly.map((b) => b.partId).join(', ')} — they are shown on their data link; confirm each sensor's supply before wiring.` });
  }

  // Placement collisions: bounding circles, but only among the deck
  // electronics (battery/controller/driver/regulator) — wheels sit
  // on motor shafts and sensors on mounts by design, so counting
  // them would flag every working robot.
  const placementAll: ForgePlacement[] = forge?.placement ?? [];
  const deckOnly = (r: string) => /battery|controller|driver|regulator/.test(r);
  const placement = placementAll.filter((p) => deckOnly(p.role));
  // Radii are half the smaller footprint dimension (assumptions —
  // most catalogue parts record no footprint), not half-diagonals:
  // half-diagonals flag every dense deck ever built.
  const radiusOf = (r: string) => (r.includes('battery') ? 28 : r.includes('controller') ? 28 : r.includes('driver') ? 15 : 18);
  if (spec?.drivetrain === 'multirotor') {
    checks.push({ id: 'placement-collision', verdict: 'NOT_CHECKED', detail: 'Missing input: a multirotor stack has no plate — parts stack by design, so the bounding-circle plate check does not apply.' });
  } else {
  let collision: string | null = null;
  for (let i = 0; i < placement.length && !collision; i++) {
    for (let j = i + 1; j < placement.length; j++) {
      const a = placement[i]; const b = placement[j];
      const ra = radiusOf(a.role); const rb = radiusOf(b.role);
      if (Math.abs(a.pos_mm[2] - b.pos_mm[2]) > 25) continue; // different deck heights
      const d = Math.hypot(a.pos_mm[0] - b.pos_mm[0], a.pos_mm[1] - b.pos_mm[1]);
      if (d < ra + rb) { collision = `${a.role} (${a.partId}) and ${b.role} (${b.partId}) overlap on the deck (centres ${Math.round(d)} mm apart, footprints need ~${ra + rb} mm).`; break; }
    }
  }
  checks.push(collision
    ? { id: 'placement-collision', verdict: 'ERROR', detail: collision }
    : { id: 'placement-collision', verdict: placement.length ? 'PASS' : 'NOT_CHECKED', detail: placement.length ? 'No placement footprints overlap on the same deck level (bounding-circle check, footprints are assumptions).' : 'Missing input: no placement was generated.' });
  }

  // Battery placement rule.
  const batPlace = placementAll.find((p) => p.partId === ids.battery);
  checks.push(batPlace
    ? { id: 'battery-placement', verdict: batPlace.pos_mm[2] <= 30 && Math.abs(batPlace.pos_mm[0]) <= (spec.length_m ?? 0.3) * 250 ? 'PASS' : 'WARN', detail: `Battery at [${batPlace.pos_mm.join(', ')}] mm — the rule is lowest and central for centre of gravity.` }
    : { id: 'battery-placement', verdict: 'NOT_CHECKED', detail: 'Missing input: no battery placement.' });

  // Print bed fit.
  const prints: ForgePrint[] = forge?.prints ?? [];
  const noFit = prints.filter((p) => p.bed_fit === 'no');
  checks.push(prints.length
    ? { id: 'print-bed-fit', verdict: noFit.length ? 'ERROR' : 'PASS', detail: noFit.length ? `These prints exceed the assumed ${FORGE_BED_MM}×${FORGE_BED_MM} mm bed: ${noFit.map((p) => p.name).join(', ')}. Split them or use a larger printer.` : `All prints fit the assumed ${FORGE_BED_MM}×${FORGE_BED_MM} mm bed (bed size is a labeled assumption).` }
    : { id: 'print-bed-fit', verdict: 'NOT_CHECKED', detail: 'Missing input: no prints were planned.' });

  // Mass envelope: catalogue masses are mostly unrecorded, so this stays an honest abstention.
  checks.push({ id: 'mass-rollup', verdict: 'NOT_CHECKED', detail: `Missing input: most catalogue parts record no mass, so the ${spec?.mass_kg ?? '—'} kg figure is an archetype envelope assumption, not a rollup. Weigh the parts to close this check.` });

  return checks;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

const SIZE_SCALE: Record<ForgeSize, number> = { compact: 0.8, standard: 1, large: 1.3 };

export function generateRobot(briefInput: ForgeBrief | string, catalogue: CataloguePart[]): ForgeSpec {
  const brief = typeof briefInput === 'string' ? parseBrief(briefInput) : briefInput;
  const have = byId(catalogue);
  const sel = selectComponents(brief, catalogue);
  const s = SIZE_SCALE[brief.size];
  const ids = sel.ids;
  const motorPart = have.get(ids.motor ?? ids.servo ?? '');
  const wheelPart = have.get(ids.wheel ?? '');
  const batPart = have.get(ids.battery ?? '');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const spec: Record<string, any> = { name: brief.name, forge: { ids } };
  if (brief.archetype === 'differential_rover' || brief.archetype === 'mecanum_rover') {
    const mecanum = brief.archetype === 'mecanum_rover';
    spec.drivetrain = mecanum ? 'mecanum' : 'differential';
    spec.length_m = round2(0.32 * s); spec.width_m = round2(0.26 * s); spec.height_m = round2((brief.sensors.includes('lidar') ? 0.24 : 0.18) * s);
    spec.mass_kg = round2((mecanum ? 2.4 : 2.1) * s); // envelope assumption — mass check says NOT_CHECKED
    spec.ground_clearance_m = 0.03;
    spec.wheel = { diameter_m: num(wheelPart?.specs?.diameter_m) ?? 0.1, width_m: num(wheelPart?.specs?.width_m) ?? 0.032, count: mecanum ? 4 : 2 };
    spec.motor = { kind: String(motorPart?.specs?.kind ?? 'dc_gearmotor'), voltage_v: recordedVoltageNominal(motorPart), count: mecanum ? 4 : 2, stall_torque_nm: num(motorPart?.specs?.stall_torque_nm) };
    spec.battery = { chemistry: String(batPart?.specs?.chemistry ?? 'lipo'), voltage_v: recordedVoltageNominal(batPart), capacity_mah: num(batPart?.specs?.capacity_mah) };
  } else if (brief.archetype === 'robotic_arm') {
    spec.drivetrain = 'robotic_arm';
    spec.length_m = round2(0.3 * s); spec.width_m = round2(0.2 * s); spec.height_m = round2(0.42 * s);
    spec.mass_kg = round2(1.6 * s);
    spec.ground_clearance_m = null;
    spec.wheel = null;
    spec.motor = { kind: String(motorPart?.specs?.kind ?? 'servo_positional'), voltage_v: 5, count: 4, stall_torque_nm: null };
    spec.battery = { chemistry: String(batPart?.specs?.chemistry ?? 'liion'), voltage_v: recordedVoltageNominal(batPart), capacity_mah: num(batPart?.specs?.capacity_mah) };
  } else {
    spec.drivetrain = 'multirotor';
    spec.length_m = round2(0.22 * s); spec.width_m = round2(0.22 * s); spec.height_m = round2(0.09 * s);
    spec.mass_kg = round2(0.85 * s);
    spec.ground_clearance_m = null;
    spec.wheel = null;
    spec.motor = { kind: String(motorPart?.specs?.kind ?? 'brushless_outrunner'), voltage_v: recordedVoltageNominal(batPart), count: 4, stall_torque_nm: null };
    spec.battery = { chemistry: String(batPart?.specs?.chemistry ?? 'lipo'), voltage_v: recordedVoltageNominal(batPart), capacity_mah: num(batPart?.specs?.capacity_mah) };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const forge: ForgeData & { ids: Record<string, string> } = {
    ids,
    placement: [], wiring: [], prints: [], checks: [], bom: sel.bom,
    assembly: [], gather: sel.gather,
  };
  spec.forge = forge;
  forge.placement = suggestPlacement(spec, catalogue);
  forge.wiring = suggestWiring(spec, catalogue);
  forge.prints = planPrints(spec, catalogue);
  forge.assembly = assemblyOrder(brief.archetype, forge);
  forge.checks = runEngineChecks(spec, catalogue);
  return spec;
}

function assemblyOrder(archetype: ArchetypeId, forge: ForgeData): string[] {
  const prints = forge.prints.map((p) => `Print: ${p.name} (${p.material}, ${p.orientation})`);
  if (archetype === 'multirotor') {
    return [...prints, 'Mount the motors on the frame arms', 'Fit the ESC + flight-controller stack at the centre', 'Fit the receiver, antennas clear of the frame', 'Fit propellers LAST, after a bench power check without props', 'First power: current-limited supply, props off (mandatory first-power step)'];
  }
  if (archetype === 'robotic_arm') {
    return [...prints, 'Build the base: battery, fuse, regulator, controller', 'Wire the 5 V servo rail and check it before connecting servos', 'Fit joint servos from the base up, checking each joint moves freely', 'Fit the gripper last', 'First power: current-limited supply, arm supported (mandatory first-power step)'];
  }
  return [...prints, 'Fit the battery tray and battery (lowest, central)', 'Fit motor mounts, motors and wheels', 'Fit the driver and regulator beside the battery', 'Fit the controller central on the deck', 'Fit sensors: lidar top-centre, camera front, IMU at the centre', 'Wire power first (battery → fuse → driver/regulator), then data', 'First power: current-limited supply, wheels off the ground (mandatory first-power step)'];
}

/* ------------------------------------------------------------------ */
/* Modifications: a small, honest grammar. Anything outside it        */
/* returns null — never a guess. The caller saves the returned spec   */
/* as a NEW version; the diff is diffSpecs-compatible (plain fields). */
/* ------------------------------------------------------------------ */

export interface ForgeModification { spec: ForgeSpec; summary: string }

export function applyModification(spec: ForgeSpec, text: string, catalogue: CataloguePart[]): ForgeModification | null {
  const t = ` ${String(text ?? '').toLowerCase()} `;
  const next: ForgeSpec = JSON.parse(JSON.stringify(spec ?? {}));
  if (!next.forge) return null;
  const have = byId(catalogue);
  const ids: Record<string, string> = next.forge.ids ?? (next.forge.ids = {});

  const addBom = (partId: string, qty: number) => {
    const line = (next.forge.bom as ForgeBomLine[]).find((b) => b.partId === partId);
    if (line) line.qty += qty;
    else next.forge.bom.push({ partId, qty, source: PRINTED_IDS.has(partId) ? 'printed' : 'catalogue' });
  };
  const addSensor = (sensor: string, key: string): boolean => {
    const sp = SENSOR_PARTS[sensor];
    if (!sp || !have.has(sp.partId)) return false;
    ids[key] = sp.partId; addBom(sp.partId, sp.qty);
    if (sp.printedMount) { ids[`${key}Mount`] = sp.printedMount; addBom(sp.printedMount, 1); }
    return true;
  };
  const finish = (summary: string): ForgeModification => {
    next.forge.placement = suggestPlacement(next, catalogue);
    next.forge.wiring = suggestWiring(next, catalogue);
    next.forge.prints = planPrints(next, catalogue);
    next.forge.checks = runEngineChecks(next, catalogue);
    return { spec: next, summary };
  };

  if (/\badd\b.*\bcamera\b/.test(t) && !/\bdepth\b/.test(t)) {
    if (ids.camera) return null; // already fitted — refusing beats duplicating silently
    return addSensor('camera', 'camera') ? finish('Added a camera (camera_rpi_v2) + printed bracket; placement, wiring, prints and checks regenerated.') : null;
  }
  if (/\badd\b.*\b(depth|realsense)\b/.test(t)) {
    if (ids.depth_camera) return null;
    return addSensor('depth_camera', 'depth_camera') ? finish('Added a depth camera (realsense_d435) + printed bracket; placement, wiring, prints and checks regenerated.') : null;
  }
  if (/\badd\b.*\blidar\b/.test(t)) {
    if (ids.lidar) return null;
    if (!addSensor('lidar', 'lidar')) return null;
    next.height_m = round2(Math.max(num(next.height_m) ?? 0.18, 0.24));
    return finish('Added lidar (rplidar_a1) + printed mount on top-centre; height raised to clear the scan plane.');
  }
  if (/\badd\b.*\b(ultrasonic|sonar)\b/.test(t)) {
    if (ids.ultrasonic) return null;
    return addSensor('ultrasonic', 'ultrasonic') ? finish('Added an ultrasonic ranger (ultrasonic_hcsr04) + printed bracket at the front.') : null;
  }
  if (/\badd\b.*\bimu\b/.test(t)) {
    if (ids.imu) return null;
    return addSensor('imu', 'imu') ? finish('Added an IMU (imu_bno055) at the centre axes.') : null;
  }
  if (/\b(make|wider|width)\b.*\bwider\b|\bwider\b/.test(t) && /\b(wider|width)\b/.test(t)) {
    const before = num(next.width_m);
    if (before === null) return null;
    next.width_m = round2(before * 1.25);
    return finish(`Widened the deck: width ${Math.round(before * 1000)} → ${Math.round(next.width_m * 1000)} mm; placement, prints and checks regenerated.`);
  }
  if (/\bbigger battery\b|\bswap\b.*\bbattery\b|\bbattery\b.*\bbigger\b/.test(t)) {
    // The only larger recorded rover pack in the catalogue is the 4S 5200.
    const bigger = have.get('lipo_4s_5200');
    if (!bigger || spec?.drivetrain === 'multirotor') return null;
    ids.battery = 'lipo_4s_5200';
    const bomLine = (next.forge.bom as ForgeBomLine[]).find((b) => b.partId === (spec.forge.ids?.battery ?? ''));
    if (bomLine) bomLine.partId = 'lipo_4s_5200';
    else addBom('lipo_4s_5200', 1);
    next.battery = { chemistry: String(bigger.specs?.chemistry ?? 'lipo'), voltage_v: recordedVoltageNominal(bigger), capacity_mah: num(bigger.specs?.capacity_mah) };
    // Honest consequence: 14.8 V direct into the TB6612 (recorded max
    // 13.5 V) will now ERROR in checks — the modification surfaces it
    // instead of hiding it; the fix is a rated driver, not silence.
    return finish('Swapped in the bigger 4S 5200 mAh pack (lipo_4s_5200). Checks re-run — note the driver voltage verdict: the recorded driver rating may now fail, and the check says so.');
  }
  // Generic add-by-name: "add <part name>" for any other part in
  // the catalogue view the caller passed — built-in parts and
  // confirmed web parts alike (lib/webParts.mergeCatalogue). The
  // part lands on the BOM as a planned addition; the sensor adds
  // above keep their mounts and placement rules, and this branch
  // covers the parts those rules don't. An unknown or ambiguous
  // name refuses (null), like everything outside the grammar.
  const addMatch = t.match(/^\s*add\s+(?:a\s+|an\s+|the\s+)?(.+?)\s*$/);
  if (addMatch) {
    const q = addMatch[1].replace(/\s+/g, ' ').trim();
    const hits = catalogue.filter((p) => {
      const n = String(p.name ?? '').toLowerCase();
      return p.id === q || n === q || n.includes(q);
    });
    const part = hits.length === 1 ? hits[0] : undefined;
    if (!part) return null;
    if ((next.forge.bom as ForgeBomLine[]).some((b) => b.partId === part.id)) return null;
    addBom(part.id, 1);
    ids['added_' + part.id.replace(/[^a-z0-9]+/gi, '_')] = part.id;
    return finish(part.web_sourced
      ? `Added the web-sourced part “${part.name ?? part.id}” (${part.id}) to the plan — its specs are WEB-SOURCED — UNVERIFIED, and the checks flag it. Placement, wiring, prints and checks regenerated.`
      : `Added “${part.name ?? part.id}” (${part.id}) to the plan from the catalogue. Placement, wiring, prints and checks regenerated.`);
  }
  if (/\bremove\b.*\barm\b/.test(t)) {
    if (spec?.drivetrain !== 'robotic_arm') return null;
    // Removing the arm from an arm robot leaves the mobile base parts
    // only if they exist; an arm robot has none — refuse honestly.
    return null;
  }
  return null;
}

/** Synchronize a confirmed planned part with the engine representation.
 * A replacement changes the role/BOM together. An addition gets no invented
 * wiring: missing power paths remain visible in the regenerated checks. */
export function syncPlannedPart(spec: ForgeSpec, part: CataloguePart, catalogue: CataloguePart[], replaceRole?: string): ForgeSpec {
  const next: ForgeSpec = JSON.parse(JSON.stringify(spec));
  if (!next?.forge) return next;
  const ids = next.forge.ids ?? (next.forge.ids = {});
  const oldId = replaceRole ? ids[replaceRole] : undefined;
  const line = oldId ? next.forge.bom.find((b: ForgeBomLine) => b.partId === oldId) : undefined;
  if (line) line.partId = part.id;
  else if (!next.forge.bom.some((b: ForgeBomLine) => b.partId === part.id)) next.forge.bom.push({partId:part.id,qty:1,source:'catalogue'});
  ids[replaceRole || 'added_' + part.id.replace(/[^a-z0-9]+/gi,'_')] = part.id;
  next.forge.placement = suggestPlacement(next,catalogue);
  next.forge.wiring = suggestWiring(next,catalogue);
  next.forge.prints = planPrints(next,catalogue);
  next.forge.checks = runEngineChecks(next,catalogue);
  return next;
}
