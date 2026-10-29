/* The Garage's data model: a robot is a list of versions, each a full
 * spec. "Baseline" is the robot as it is; every hardware upgrade is a
 * new version, so any two can be compared and nothing is overwritten. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Spec = any;

export type VersionSource = 'upload' | 'robodex' | 'starter' | 'photo' | 'edit' | 'muse-fix' | 'inventory';

export interface RobotVersion {
  id: string;
  label: string;
  note: string;
  source: VersionSource;
  createdAt: string;
  spec: Spec;
}

export interface GarageRobot {
  id: string;
  name: string;
  createdAt: string;
  versions: RobotVersion[];
}

export const GARAGE_KEY = 'rf.garage.v1';

export const SOURCE_LABEL: Record<VersionSource, string> = {
  upload: 'Uploaded spec',
  robodex: 'From the Robodex',
  starter: 'Starter kind',
  photo: 'Photo draft (ESTIMATED)',
  edit: 'Edited by hand',
  'muse-fix': 'Fix proposed by Muse Spark',
  inventory: 'Part from inventory',
};

/* The editable fields, grouped the way a builder thinks about them.
 * Paths match fixloop.FIX_FIELDS plus a few the loop may not touch. */
export interface Field { path: string; label: string; unit?: string; kind: 'number' | 'integer' | 'string' | 'select'; options?: string[]; scale?: number }

export const FIELD_GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Body', fields: [
    { path: 'name', label: 'Name', kind: 'string' },
    { path: 'drivetrain', label: 'Drivetrain', kind: 'select', options: ['differential', 'skid_steer', 'ackermann', 'mecanum', 'tracked', 'multirotor', 'quadruped', 'humanoid', 'robotic_arm'] },
    { path: 'length_m', label: 'Length', unit: 'mm', kind: 'number', scale: 1000 },
    { path: 'width_m', label: 'Width', unit: 'mm', kind: 'number', scale: 1000 },
    { path: 'height_m', label: 'Height', unit: 'mm', kind: 'number', scale: 1000 },
    { path: 'mass_kg', label: 'Total mass', unit: 'kg', kind: 'number' },
    { path: 'ground_clearance_m', label: 'Ground clearance', unit: 'mm', kind: 'number', scale: 1000 },
  ] },
  { title: 'Wheels', fields: [
    { path: 'wheel.diameter_m', label: 'Diameter', unit: 'mm', kind: 'number', scale: 1000 },
    { path: 'wheel.width_m', label: 'Width', unit: 'mm', kind: 'number', scale: 1000 },
    { path: 'wheel.count', label: 'Count', kind: 'integer' },
  ] },
  { title: 'Motors', fields: [
    { path: 'motor.kind', label: 'Kind', kind: 'string' },
    { path: 'motor.voltage_v', label: 'Voltage', unit: 'V', kind: 'number' },
    { path: 'motor.count', label: 'Count', kind: 'integer' },
    { path: 'motor.stall_torque_nm', label: 'Stall torque', unit: 'N·m', kind: 'number' },
  ] },
  { title: 'Battery', fields: [
    { path: 'battery.chemistry', label: 'Chemistry', kind: 'select', options: ['lipo', 'liion', 'lifepo4', 'nimh', 'lead_acid'] },
    { path: 'battery.voltage_v', label: 'Voltage', unit: 'V', kind: 'number' },
    { path: 'battery.capacity_mah', label: 'Capacity', unit: 'mAh', kind: 'integer' },
  ] },
];

export function getPath(spec: Spec, path: string): unknown {
  return path.split('.').reduce((o: Spec, k) => (o && typeof o === 'object' ? o[k] : undefined), spec);
}

export function setPath(spec: Spec, path: string, value: unknown): Spec {
  const next = JSON.parse(JSON.stringify(spec ?? {}));
  const keys = path.split('.');
  let o = next;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return next;
}

export interface DiffRow { path: string; before: unknown; after: unknown }

/* Flat diff over every leaf (arrays compared as JSON). */
export function diffSpecs(a: Spec, b: Spec, prefix = ''): DiffRow[] {
  const rows: DiffRow[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const p = prefix ? prefix + '.' + k : k;
    const x = a ? a[k] : undefined;
    const y = b ? b[k] : undefined;
    const isObj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(x) || isObj(y)) {
      rows.push(...diffSpecs(isObj(x) ? x : {}, isObj(y) ? y : {}, p));
    } else if (JSON.stringify(x) !== JSON.stringify(y)) {
      rows.push({ path: p, before: x, after: y });
    }
  }
  return rows;
}

export function fmtValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return String(parseFloat(v.toPrecision(6)));
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v);
}

/* Map a confirmed inventory part onto the spec fields it fills. */
export function partToChanges(part: { category: string; specs: Record<string, unknown>; quantity: number }): { path: string; value: unknown }[] {
  const s = part.specs || {};
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);
  const out: { path: string; value: unknown }[] = [];
  if (part.category === 'battery') {
    if (num('voltage_v')) out.push({ path: 'battery.voltage_v', value: num('voltage_v') });
    if (num('capacity_mah')) out.push({ path: 'battery.capacity_mah', value: Math.round(num('capacity_mah') as number) });
    if (typeof s.chemistry === 'string') out.push({ path: 'battery.chemistry', value: String(s.chemistry).toLowerCase().replace(/[^a-z_0-9]/g, '') });
  }
  if (part.category === 'motor') {
    if (num('voltage_v')) out.push({ path: 'motor.voltage_v', value: num('voltage_v') });
    if (num('stall_torque_nm')) out.push({ path: 'motor.stall_torque_nm', value: num('stall_torque_nm') });
  }
  if (part.category === 'wheel') {
    if (num('diameter_mm')) out.push({ path: 'wheel.diameter_m', value: (num('diameter_mm') as number) / 1000 });
    if (num('width_mm')) out.push({ path: 'wheel.width_m', value: (num('width_mm') as number) / 1000 });
  }
  return out;
}
