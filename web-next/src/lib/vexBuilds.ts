/* VEX V5 build ideas and word edits for Wrench (Abel, 2026-11-10):
 * "suggest 3 VEX builds", "give me two fast VEX drives", then "make
 * #2 faster", "use 6 motors", "switch it to mecanum".
 *
 * Pure, zero imports: node runs it in tests/test_vex.py. Everything
 * is deterministic — the same words always give the same robot — and
 * built from VEX's published motor ratings (mirrors src/robotforge/
 * vex.py and lib/drivetrain.ts). Masses and frame sizes are typical
 * values and every spec's description says so.
 *
 * Spec conventions: motor.stall_torque_nm is the torque at the wheel;
 * the gearing block records the cartridge and gear teeth it comes from.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

const CARTRIDGES = { red: { rpm: 100, nm: 2.1 }, green: { rpm: 200, nm: 1.05 }, blue: { rpm: 600, nm: 0.35 } } as const;
type CartId = keyof typeof CARTRIDGES;
const WHEELS_IN = [2.75, 3.25, 4] as const;
const IN = 0.0254;
const CAP_W = 88;
/** V5RC 2026-27 R11: drivetrain motors at most 55 W (lib/vexRules.ts). */
const DRIVE_CAP_W = 55;

export interface VexBuildParams {
  drive: 'tank' | 'mecanum';
  motors: number;
  wheels: number;
  wheelIn: number;
  wheelKind: 'omni' | 'traction' | 'mecanum';
  cartridge: CartId;
  driving: number;
  driven: number;
  massKg: number;
  /** Scoring mechanisms on top of the drive (drawn in 3D, counted in the 88 W budget). */
  mechs?: VexMech[];
}

/* Mechanisms seen on real V5RC robots (Abel's photos, 2026-11-10):
 * a chain-and-sprocket intake/conveyor, a C-channel lift tower, and
 * pneumatics (air tanks + cylinders, no motor). Watts are the 11 W
 * motors each one typically uses; kg are typical added masses. */
export type VexMech = 'intake' | 'lift' | 'pneumatics';
export const VEX_MECHS: Record<VexMech, { label: string; motors: number; kg: number; what: string }> = {
  intake: { label: 'intake / conveyor', motors: 1, kg: 0.8, what: 'a chain-and-sprocket intake that pulls game pieces up a conveyor' },
  lift: { label: 'lift tower', motors: 2, kg: 1.0, what: 'a C-channel tower lift on two motors, helped by rubber bands' },
  pneumatics: { label: 'pneumatics', motors: 0, kg: 0.6, what: 'air tanks and a cylinder for a clamp or wing (no motor)' },
};
const MECH_ORDER: VexMech[] = ['intake', 'lift', 'pneumatics'];
/** Watts the mechanisms' motors use (11 W each). */
export function mechPowerW(spec: Spec): number {
  const list: unknown = spec?.vex_mechanisms;
  return Array.isArray(list) ? list.reduce((w: number, m) => w + (VEX_MECHS[m as VexMech]?.motors ?? 0) * 11, 0) : 0;
}

export interface VexBuild { id: string; title: string; why: string; focus: string[]; spec: Spec }

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function wheelRpmOf(p: Pick<VexBuildParams, 'cartridge' | 'driving' | 'driven'>): number {
  return CARTRIDGES[p.cartridge].rpm * p.driving / p.driven;
}

function describe(p: VexBuildParams): string {
  const gear = p.driving === p.driven ? 'direct drive' : `geared ${p.driving}:${p.driven}`;
  const kind = p.drive === 'mecanum' ? 'mecanum' : `${p.wheelKind}`;
  const mechs = p.mechs?.length ? ` On top: ${p.mechs.map((m) => VEX_MECHS[m].what).join('; ')}.` : '';
  return `${p.motors} x 11 W Smart Motors, ${p.cartridge} (${CARTRIDGES[p.cartridge].rpm} rpm) cartridges ${gear} to ${p.wheels} x ${p.wheelIn} in ${kind} wheels (${Math.round(wheelRpmOf(p))} rpm at the wheel).${mechs}`;
}

/** A complete RobotSpec for a VEX V5 drive base. */
export function buildVexSpec(title: string, p: VexBuildParams): Spec {
  const d = r4(p.wheelIn * IN);
  const c = CARTRIDGES[p.cartridge];
  return {
    name: title,
    description: `VEX V5 drive base suggested by Wrench: ${describe(p)} Motor numbers are VEX's published ratings; mass and size are typical values, not measurements of one robot.`,
    drivetrain: p.drive === 'mecanum' ? 'mecanum' : 'skid_steer',
    length_m: 0.38, width_m: 0.38, height_m: p.mechs?.includes('lift') ? 0.45 : p.mechs?.length ? 0.35 : 0.15,
    mass_kg: p.massKg,
    ground_clearance_m: r4(Math.min(0.025, d / 2 * 0.5)),
    wheel: { diameter_m: d, width_m: p.drive === 'mecanum' ? 0.035 : 0.028, count: p.wheels, driven: true, kind: p.wheelKind },
    motor: { kind: 'vex_v5_smart_motor', voltage_v: 12.8, count: p.motors, stall_torque_nm: r4(c.nm * p.driven / p.driving) },
    gearing: { platform: 'vex_v5', motor_free_rpm: c.rpm, motor_shaft_stall_nm: c.nm, driving_teeth: p.driving, driven_teeth: p.driven, motor_power_w: 11 },
    battery: { chemistry: 'liion', voltage_v: 12.8, capacity_mah: 1100 },
    sensors: [{ kind: 'imu', position: 'centre' }],
    component_mass_kg: {},
    ...(p.mechs?.length ? { vex_mechanisms: MECH_ORDER.filter((m) => p.mechs!.includes(m)) } : {}),
  };
}

/* Every preset passes the 2026-27 V5RC rules (lib/vexRules.ts):
 * drivetrain motors at most 55 W (R11), all motors at most 88 W
 * (R10). The old 6 x 11 W drive (66 W) is over R11, so the six-wheel
 * builds put four motors on six wheels, the middle pair chained. */
const PRESETS: { id: string; title: string; why: string; focus: string[]; p: VexBuildParams }[] = [
  { id: 'comp', title: 'VEX Competition Robot', focus: ['competition', 'full', 'speed'],
    why: 'What real V5RC robots look like: a fast six-wheel omni drive with a chain intake/conveyor and pneumatics on top. Drive 44 of 55 W, all motors 55 of 88 W.',
    p: { drive: 'tank', motors: 4, wheels: 6, wheelIn: 3.25, wheelKind: 'omni', cartridge: 'blue', driving: 36, driven: 48, massKg: 6.2, mechs: ['intake', 'pneumatics'] } },
  { id: 'speed6w', title: 'VEX Speed Tank (6-wheel)', focus: ['speed', 'competition'],
    why: 'A fast competition drive: four motors on six wheels, quick across the field and hard to tip. Drive 44 of 55 W, leaving 44 W for an intake or lift.',
    p: { drive: 'tank', motors: 4, wheels: 6, wheelIn: 3.25, wheelKind: 'omni', cartridge: 'blue', driving: 36, driven: 48, massKg: 4.8 } },
  { id: 'push4', title: 'VEX Pushing Drive', focus: ['push', 'defence'],
    why: 'Slow and strong on traction wheels: hard to shove around and good at pushing others. Turns scrub more.',
    p: { drive: 'tank', motors: 4, wheels: 4, wheelIn: 3.25, wheelKind: 'traction', cartridge: 'green', driving: 1, driven: 1, massKg: 4.5 } },
  { id: 'mecanum4', title: 'VEX Mecanum Drive', focus: ['agile', 'strafe'],
    why: 'Slides sideways and spins while moving, great for lining up. Easier to push around than a tank drive.',
    p: { drive: 'mecanum', motors: 4, wheels: 4, wheelIn: 4, wheelKind: 'mecanum', cartridge: 'green', driving: 1, driven: 1, massKg: 4.5 } },
  { id: 'balanced4', title: 'VEX Starter Tank', focus: ['beginner', 'balanced'],
    why: 'A balanced first drive base: simple to build, quick enough, and leaves 44 W for mechanisms.',
    p: { drive: 'tank', motors: 4, wheels: 4, wheelIn: 4, wheelKind: 'omni', cartridge: 'blue', driving: 36, driven: 60, massKg: 4.0 } },
  { id: 'heavy6w', title: 'VEX Heavy Pusher (6-wheel)', focus: ['push', 'defence', 'competition'],
    why: 'Four motors geared down onto six traction wheels for maximum shove while keeping some speed; built to win pushing matches.',
    p: { drive: 'tank', motors: 4, wheels: 6, wheelIn: 3.25, wheelKind: 'traction', cartridge: 'blue', driving: 36, driven: 84, massKg: 5.3 } },
  { id: 'clawbot2', title: 'VEX Simple 2-motor Bot', focus: ['beginner', 'cheap'],
    why: 'The simplest build: two motors, one per side. Slow, but cheap and easy, and leaves 66 W for arms and claws.',
    p: { drive: 'tank', motors: 2, wheels: 4, wheelIn: 4, wheelKind: 'omni', cartridge: 'green', driving: 1, driven: 1, massKg: 3.0 } },
];

const FOCUS_WORDS: [string, RegExp][] = [
  ['speed', /\b(fast|faster|fastest|speed|speedy|quick)\b/],
  ['push', /\b(push|pushing|strong|stronger|torque|power(?:ful)?|tough)\b/],
  ['defence', /\b(defen[cs]e|defensive|block)\b/],
  ['agile', /\b(agile|strafe|sideways|holonomic|mecanum|omni ?directional)\b/],
  ['beginner', /\b(beginner|simple|easy|first|starter|basic|new)\b/],
  ['cheap', /\b(cheap|budget|few(?:er)? motors)\b/],
  ['competition', /\b(competition|compete|v5rc|vrc|match)\b/],
  ['full', /\b(full|complete|real|intake|lift|pneumatics?|mechanisms?|scoring)\b/],
];
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, a: 1, an: 1, couple: 2, few: 3 };

/** "suggest 3 VEX builds", "give me two fast vex robots", "vex build ideas for pushing". */
export function parseVexSuggest(text: string): { count: number; focus: string[] } | null {
  const q = text.toLowerCase();
  if (!/\bvex\b/.test(q)) return null;
  if (!/\b(suggest|suggestions?|ideas?|options?|recommend|generate|give me|show me|propose|builds|designs|kinds of)\b/.test(q)) return null;
  if (!/\b(builds?|robots?|designs?|drives?|drivetrains?|drive trains?|bots?|ideas?|options?|setups?)\b/.test(q)) return null;
  const n = q.match(/\b(\d+|one|two|three|four|five|couple|few)\b/);
  // "suggest a VEX drive base" asks for one; otherwise three by default.
  const single = /\b(a|an)\b(?:\s+[\w-]+){0,3}?\s+(build|robot|design|drive|drivetrain|bot|idea|option|setup)\b(?!s)/.test(q);
  let count = n ? (NUM_WORDS[n[1]] ?? Number(n[1])) : single ? 1 : 3;
  count = Math.max(1, Math.min(3, count || 3));
  const focus = FOCUS_WORDS.filter(([, re]) => re.test(q)).map(([f]) => f);
  return { count, focus };
}

/** 1–3 different builds, the best match for the focus first. */
export function suggestVexBuilds(count: number, focus: string[] = []): VexBuild[] {
  const score = (f: string[]) => focus.reduce((s, w) => s + (f.includes(w) ? 1 : 0), 0);
  const order = PRESETS.map((p, i) => ({ p, i, s: score(p.focus) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const picked: typeof PRESETS = [];
  // never two builds with the same drive style and motor count
  for (const { p } of order) {
    if (picked.length >= count) break;
    if (picked.some((x) => x.p.drive === p.p.drive && x.p.motors === p.p.motors && x.p.wheelKind === p.p.wheelKind
      && x.p.wheels === p.p.wheels && !!x.p.mechs?.length === !!p.p.mechs?.length)) continue;
    picked.push(p);
  }
  return picked.map((x) => ({ id: x.id, title: x.title, why: x.why, focus: x.focus, spec: buildVexSpec(x.title, x.p) }));
}

/* ---------------- word edits ---------------- */

export type VexEditOp =
  | { kind: 'faster' } | { kind: 'stronger' }
  | { kind: 'motors'; n: number }
  | { kind: 'drive'; drive: 'tank' | 'mecanum' }
  | { kind: 'wheelSize'; inches: number }
  | { kind: 'wheelKind'; wheelKind: 'omni' | 'traction' }
  | { kind: 'cartridge'; cartridge: CartId }
  | { kind: 'gear'; driving: number; driven: number }
  | { kind: 'mass'; kg: number }
  | { kind: 'addMech'; mech: VexMech } | { kind: 'removeMech'; mech: VexMech };

export interface VexEditRequest { target: number | null; ops: VexEditOp[] }

/** Word edits to a VEX build. `target` is a suggestion number ("#2",
 *  "build 2", "the second one") or null for the robot on screen. */
export function parseVexEdit(text: string): VexEditRequest | null {
  const q = text.toLowerCase().replace(/[.!?]+$/, '');
  if (!/\b(make|use|switch|change|give|put|gear|set|swap|go|try|with|more|less|fewer|add|remove|drop|take|without|mount)\b/.test(q)) return null;
  const ops: VexEditOp[] = [];
  if (/\b(faster|quicker|more speed|speed (?:it )?up)\b/.test(q)) ops.push({ kind: 'faster' });
  if (/\b(stronger|more (?:torque|pushing(?: power)?|push(?:ing)? force|power)|slower|push harder)\b/.test(q)) ops.push({ kind: 'stronger' });
  const m = q.match(/\b(\d|two|four|six|eight)[- ]motors?\b/) ?? q.match(/\bmotors? (?:to |count (?:to )?)?(\d)\b/);
  if (m) ops.push({ kind: 'motors', n: NUM_WORDS[m[1]] ?? Number(m[1]) });
  if (/\b(mecanum|holonomic|strafe)\b/.test(q) && !/\bno mecanum\b/.test(q)) ops.push({ kind: 'drive', drive: 'mecanum' });
  else if (/\b(tank|skid[- ]?steer)\b/.test(q)) ops.push({ kind: 'drive', drive: 'tank' });
  const w = q.match(/\b(2\.75|3\.25|4)(?:\s*(?:in(?:ch(?:es)?)?|"|”)|\s*-?\s*inch)/);
  if (w) ops.push({ kind: 'wheelSize', inches: Number(w[1]) });
  if (/\b(bigger|larger) wheels?\b/.test(q)) ops.push({ kind: 'wheelSize', inches: 4 });
  if (/\bsmaller wheels?\b/.test(q)) ops.push({ kind: 'wheelSize', inches: 2.75 });
  if (/\btraction wheels?\b/.test(q)) ops.push({ kind: 'wheelKind', wheelKind: 'traction' });
  else if (/\bomni(?:[- ]?directional)? wheels?\b/.test(q)) ops.push({ kind: 'wheelKind', wheelKind: 'omni' });
  const c = q.match(/\b(red|green|blue)(?: cartridges?| gear ?cartridges?| inserts?)\b/) ?? q.match(/\b(100|200|600) ?rpm cartridges?\b/);
  if (c) ops.push({ kind: 'cartridge', cartridge: ({ '100': 'red', '200': 'green', '600': 'blue' } as Record<string, CartId>)[c[1]] ?? c[1] as CartId });
  const g = q.match(/\b(\d{2}):(\d{2})\b/);
  if (g) ops.push({ kind: 'gear', driving: Number(g[1]), driven: Number(g[2]) });
  if (/\bdirect[- ]drive\b/.test(q)) ops.push({ kind: 'gear', driving: 1, driven: 1 });
  const kg = q.match(/\b(?:weigh(?:s|t)?|mass|weight)(?: (?:it|is|to|of))* ([\d.]+) ?kg\b/) ?? q.match(/\b([\d.]+) ?kg\b/);
  if (kg && /\b(weigh|mass|weight|kg)\b/.test(q)) ops.push({ kind: 'mass', kg: Number(kg[1]) });
  const MECH_RE: [VexMech, RegExp][] = [
    ['intake', /\b(intake|conveyor|roller)s?\b/],
    ['lift', /\b(lift|tower|arm|elevator)s?\b/],
    ['pneumatics', /\b(pneumatics?|air tanks?|pistons?|cylinders?)\b/],
  ];
  const removing = /\b(remove|drop|take (?:off|out)|without|no)\b/.test(q);
  for (const [mech, re] of MECH_RE) if (re.test(q)) ops.push({ kind: removing ? 'removeMech' : 'addMech', mech });
  if (!ops.length) return null;
  const ORD: Record<string, number> = { first: 1, second: 2, third: 3, '1st': 1, '2nd': 2, '3rd': 3 };
  const t = q.match(/(?:#|\b(?:build|option|idea|number|no\.?) ?)(\d)\b/) ?? q.match(/\b(first|second|third|1st|2nd|3rd)(?: one| build| option| idea)?\b/);
  const target = t ? (ORD[t[1]] ?? Number(t[1])) : null;
  return { target, ops };
}

/** Current VEX parameters read from a spec (null when it isn't VEX V5). */
export function vexParamsOf(spec: Spec): VexBuildParams | null {
  const g = spec?.gearing;
  if (!g || String(g.platform).toLowerCase() !== 'vex_v5') return null;
  const cart = (Object.keys(CARTRIDGES) as CartId[]).find((k) => CARTRIDGES[k].rpm === g.motor_free_rpm) ?? 'green';
  const d = Number(spec?.wheel?.diameter_m) || 0.1016;
  const wheelIn = WHEELS_IN.reduce((a, b) => (Math.abs(b * IN - d) < Math.abs(a * IN - d) ? b : a), 4 as number);
  return {
    drive: spec.drivetrain === 'mecanum' ? 'mecanum' : 'tank',
    motors: Number(spec?.motor?.count) || 4,
    wheels: Number(spec?.wheel?.count) || 4,
    wheelIn,
    wheelKind: spec.drivetrain === 'mecanum' ? 'mecanum' : spec?.wheel?.kind === 'traction' || (!spec?.wheel?.kind && /traction/i.test(String(spec?.description))) ? 'traction' : 'omni',
    cartridge: cart,
    driving: Number(g.driving_teeth) || 1,
    driven: Number(g.driven_teeth) || 1,
    massKg: Number(spec?.mass_kg) || 4,
    mechs: Array.isArray(spec?.vex_mechanisms) ? MECH_ORDER.filter((m) => spec.vex_mechanisms.includes(m)) : [],
  };
}

/* The common VEX drive setups, slowest (most torque) to fastest:
 * the ladder "faster" and "stronger" step along. */
const LADDER: { cartridge: CartId; driving: number; driven: number; rpm: number }[] = [
  { cartridge: 'red', driving: 1, driven: 1, rpm: 100 },
  { cartridge: 'green', driving: 1, driven: 1, rpm: 200 },
  { cartridge: 'blue', driving: 36, driven: 84, rpm: 600 * 36 / 84 },
  { cartridge: 'blue', driving: 36, driven: 72, rpm: 300 },
  { cartridge: 'blue', driving: 36, driven: 60, rpm: 360 },
  { cartridge: 'blue', driving: 36, driven: 48, rpm: 450 },
  { cartridge: 'blue', driving: 1, driven: 1, rpm: 600 },
];

/** Apply word edits to a VEX V5 spec. Fields other than the drive
 *  (name, sensors, wiring, notes) are kept. */
export function editVexSpec(spec: Spec, ops: VexEditOp[]): { spec: Spec; changes: string[]; problems: string[] } {
  const p0 = vexParamsOf(spec);
  if (!p0) return { spec, changes: [], problems: ['This robot is not a VEX V5 build (its spec has no VEX V5 gearing block).'] };
  const p: VexBuildParams = { ...p0 };
  const changes: string[] = [];
  const problems: string[] = [];
  const rpm0 = wheelRpmOf(p0);
  for (const op of ops) {
    if (op.kind === 'faster' || op.kind === 'stronger') {
      const cur = wheelRpmOf(p);
      const next = op.kind === 'faster'
        ? LADDER.find((s) => s.rpm > cur * 1.12)
        : [...LADDER].reverse().find((s) => s.rpm < cur / 1.12);
      if (!next) { problems.push(op.kind === 'faster' ? 'It is already at the fastest common VEX setup (600 rpm).' : 'It is already at the strongest common VEX setup (100 rpm).'); continue; }
      Object.assign(p, { cartridge: next.cartridge, driving: next.driving, driven: next.driven });
    } else if (op.kind === 'motors') {
      if (![2, 4, 6, 8].includes(op.n)) { problems.push('VEX drives use 2, 4, 6 or 8 motors.'); continue; }
      if (p.drive === 'mecanum' && op.n !== 4) { problems.push('A mecanum drive needs exactly 4 motors, one per wheel.'); continue; }
      p.motors = op.n;
      p.wheels = Math.max(4, op.n);
    } else if (op.kind === 'drive') {
      p.drive = op.drive;
      if (op.drive === 'mecanum') { p.motors = 4; p.wheels = 4; p.wheelIn = 4; p.wheelKind = 'mecanum'; }
      else if (p.wheelKind === 'mecanum') p.wheelKind = 'omni';
    } else if (op.kind === 'wheelSize') {
      if (p.drive === 'mecanum' && op.inches !== 4) { problems.push('VEX mecanum wheels come in 4 in; the size stays 4 in.'); continue; }
      if (op.inches === 2.75 && p.wheelKind === 'traction') { problems.push('VEX traction wheels are 3.25 in here; 2.75 in wheels are omni wheels.'); p.wheelKind = 'omni'; }
      p.wheelIn = op.inches;
    } else if (op.kind === 'wheelKind') {
      if (p.drive === 'mecanum') { problems.push('A mecanum drive keeps its mecanum wheels; switch it to a tank drive first.'); continue; }
      p.wheelKind = op.wheelKind;
      if (op.wheelKind === 'traction') p.wheelIn = 3.25;
    } else if (op.kind === 'cartridge') {
      p.cartridge = op.cartridge;
    } else if (op.kind === 'gear') {
      if ((op.driving === 1) !== (op.driven === 1)) { problems.push('Name both gears, like 36:60, or say direct drive.'); continue; }
      p.driving = op.driving; p.driven = op.driven;
    } else if (op.kind === 'addMech' || op.kind === 'removeMech') {
      const has = (p.mechs ?? []).includes(op.mech);
      if (op.kind === 'addMech' && has) { problems.push(`It already has ${VEX_MECHS[op.mech].label === 'pneumatics' ? 'pneumatics' : 'a ' + VEX_MECHS[op.mech].label}.`); continue; }
      if (op.kind === 'removeMech' && !has) { problems.push(`It has no ${VEX_MECHS[op.mech].label} to remove.`); continue; }
      p.mechs = op.kind === 'addMech' ? MECH_ORDER.filter((m) => m === op.mech || (p.mechs ?? []).includes(m)) : (p.mechs ?? []).filter((m) => m !== op.mech);
      p.massKg = Math.round((p.massKg + (op.kind === 'addMech' ? 1 : -1) * VEX_MECHS[op.mech].kg) * 100) / 100;
    } else if (op.kind === 'mass') {
      if (!(op.kg > 0.5 && op.kg < 20)) { problems.push('That mass looks wrong for a VEX robot.'); continue; }
      p.massKg = op.kg;
    }
  }
  const out = JSON.parse(JSON.stringify(spec));
  const c = CARTRIDGES[p.cartridge];
  out.drivetrain = p.drive === 'mecanum' ? 'mecanum' : 'skid_steer';
  out.mass_kg = p.massKg;
  if (p.mechs?.length) {
    out.vex_mechanisms = p.mechs;
    out.height_m = Math.max(Number(out.height_m) || 0, p.mechs.includes('lift') ? 0.45 : 0.35);
  } else delete out.vex_mechanisms;
  out.wheel = { ...(out.wheel ?? {}), diameter_m: r4(p.wheelIn * IN), count: p.wheels, driven: true, kind: p.wheelKind };
  if (out.ground_clearance_m != null) out.ground_clearance_m = r4(Math.min(Number(out.ground_clearance_m), p.wheelIn * IN / 2 * 0.6));
  out.motor = { ...(out.motor ?? {}), count: p.motors, stall_torque_nm: r4(c.nm * p.driven / p.driving) };
  out.gearing = { ...(out.gearing ?? {}), platform: 'vex_v5', motor_free_rpm: c.rpm, motor_shaft_stall_nm: c.nm, driving_teeth: p.driving, driven_teeth: p.driven, motor_power_w: out.gearing?.motor_power_w ?? 11 };
  if (/^VEX V5 drive base suggested by Wrench:/.test(String(out.description))) {
    out.description = `VEX V5 drive base suggested by Wrench: ${describe(p)} Motor numbers are VEX's published ratings; mass and size are typical values, not measurements of one robot.`;
  }

  if (p.drive !== p0.drive) changes.push(`drive: ${p0.drive} → ${p.drive}`);
  if (p.motors !== p0.motors) changes.push(`motors: ${p0.motors} → ${p.motors}`);
  if (p.wheels !== p0.wheels) changes.push(`wheels: ${p0.wheels} → ${p.wheels}`);
  if (p.wheelIn !== p0.wheelIn) changes.push(`wheel size: ${p0.wheelIn} in → ${p.wheelIn} in`);
  if (p.wheelKind !== p0.wheelKind) changes.push(`wheel type: ${p0.wheelKind} → ${p.wheelKind}`);
  if (p.cartridge !== p0.cartridge) changes.push(`cartridge: ${p0.cartridge} → ${p.cartridge}`);
  if (p.driving !== p0.driving || p.driven !== p0.driven) changes.push(`gearing: ${p0.driving}:${p0.driven} → ${p.driving}:${p.driven}`);
  for (const m of MECH_ORDER) {
    const was = (p0.mechs ?? []).includes(m), now = (p.mechs ?? []).includes(m);
    if (was !== now) changes.push(`${now ? 'added' : 'removed'} ${VEX_MECHS[m].label}${VEX_MECHS[m].motors ? ` (${VEX_MECHS[m].motors} motor${VEX_MECHS[m].motors > 1 ? 's' : ''})` : ''}`);
  }
  if (p.massKg !== p0.massKg) changes.push(`mass: ${p0.massKg} kg → ${p.massKg} kg`);
  const rpm1 = wheelRpmOf(p);
  if (Math.round(rpm1) !== Math.round(rpm0)) changes.push(`wheel speed: ${Math.round(rpm0)} → ${Math.round(rpm1)} rpm`);
  const mechW = (p.mechs ?? []).reduce((w, m) => w + VEX_MECHS[m].motors * 11, 0);
  // Use the motor rating the edited spec records (11 W or 5.5 W), so a
  // warning here agrees with rulebookCheck on the same spec.
  const motorW = Number(out?.gearing?.motor_power_w) > 0 ? Number(out.gearing.motor_power_w) : 11;
  const driveW = Math.round(p.motors * motorW * 10) / 10;
  if (driveW > DRIVE_CAP_W + 1e-9) problems.push(`${p.motors} drive motors use ${driveW} W, over the V5RC 2026-27 ${DRIVE_CAP_W} W drivetrain limit (R11): at most ${Math.floor(DRIVE_CAP_W / motorW)} of the ${motorW} W motors may drive the wheels. Check the current game manual.`);
  if (driveW + mechW > CAP_W + 1e-9) problems.push(`${p.motors} drive motors (${driveW} W)${mechW ? ` plus ${mechW} W of mechanisms` : ''} come to ${driveW + mechW} W, over the V5RC ${CAP_W} W cap. Try fewer drive motors.`);
  return { spec: out, changes, problems };
}
