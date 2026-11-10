/* Twin critic (2026-11-07): does the 3D twin RobotForge builds from a
 * robot's spec hold together?
 *
 * The anatomy/teardown skills review their own models before showing
 * them: parts must not pass through each other, nothing may float,
 * what stands on the floor must reach it, and pulling the model apart
 * must not drive one part through another. This is that review, run
 * on RobotForge's own twin (components/kit/takeapart.ts → taGeom3d,
 * plus parts placed in the Assembly planner).
 *
 * Pure, zero imports: the caller passes the twin's units. Every check
 * is a bounding-box check on schematic geometry derived from the spec,
 * and says so. Findings come in two groups:
 *   - 'spec'  the spec's own numbers can't be built (wheels bigger than
 *             the robot, parts sharing the same space, a part placed
 *             inside another) — FAIL;
 *   - 'twin'  our drawing of the robot is wrong or incomplete (a
 *             bracket drawn floating, parts that pass through each
 *             other when pulled apart) — WARN: a fix for RobotForge,
 *             not for the robot.
 * When the sizes the twin needs are not recorded, nothing is guessed:
 * every check is NOT_CHECKED and the missing fields are named. */

export type CriticVerdict = 'PASS' | 'WARN' | 'FAIL' | 'NOT_CHECKED';
export type Vec3 = [number, number, number];

export interface CriticMesh { kind: 'box' | 'cyl' | 'sphere'; axis?: string; size: number[]; center: Vec3; rot?: Vec3 }
export interface CriticUnit { part: string; explode: Vec3; meshes: CriticMesh[] }
export interface CriticPlaced { id: string; name: string; sizeM: Vec3; positionM: Vec3; yawDeg: number }

export interface CriticSpec {
  name?: string;
  length_m?: number; width_m?: number; height_m?: number; ground_clearance_m?: number;
  wheel?: { count?: number; diameter_m?: number; width_m?: number };
}

export type TwinClass = 'aerial' | 'arm' | 'humanoid' | 'quadruped' | 'ground';

export interface CriticInput {
  spec: CriticSpec;
  cls: TwinClass;
  units: CriticUnit[];
  /** part id → display name (TaPart.name). */
  names?: Record<string, string>;
  placed?: CriticPlaced[];
  /** the take-apart slider's range, in metres (TakeApartViewer: 60 mm). */
  explodeMaxM?: number;
  /** Set when the units come from a generated model (Omega1's
   * ProjectSim twin) instead of being built from the spec. Its
   * geometry is an estimate, so what it gets wrong is the model's
   * problem (WARN), and the spec's missing sizes don't stop the
   * geometry checks. */
  model?: { joints: string[]; basis: string };
}

export interface CriticFinding {
  id: 'size' | 'overlap' | 'placed' | 'wheels' | 'floor' | 'scrape' | 'height' | 'floating' | 'explode';
  group: 'spec' | 'twin';
  title: string;
  verdict: CriticVerdict;
  detail: string;
  /** the parts it names, as shown to the user. */
  parts: string[];
}

export interface TwinCritique {
  verdict: CriticVerdict;
  findings: CriticFinding[];
  parts: number;
  basis: string;
}

/** Contact closer than this counts as touching; overlap deeper than
 * this counts as passing through. */
export const TOUCH_M = 0.002;
export const PASS_THROUGH_M = 0.0015;
/** Standoffs a placed board may sit on (not drawn). */
export const STANDOFF_M = 0.012;

/* Joints the kit draws on purpose: a motor mount holds the wheel's
 * axle, brackets bolt to the deck, a battery rides inside the body.
 * These pairs may share space at rest. Everything else may not. */
const JOINTS: Record<TwinClass, string[]> = {
  ground: ['wheel|mount', 'mount|plate', 'lidar|plate', 'camera|plate', 'ultrasonic|plate', 'caster|plate'],
  aerial: ['arm|frame', 'arm|arm', 'rotor|arm', 'battery|frame', 'fc|frame', 'camera|frame'],
  quadruped: ['leg|body', 'head|body', 'battery|body'],
  humanoid: ['leg|pelvis', 'pelvis|torso', 'arm|torso', 'head|torso', 'battery|torso'],
  arm: ['link|link', 'link|base', 'gripper|link'],
};
/* What a placed part may sit on (it is mounted to it). */
const MOUNT_BASES = ['plate', 'body', 'torso', 'frame', 'base'];

interface Box { min: Vec3; max: Vec3 }
interface Part { key: string; part: string; label: string; boxes: Box[]; explode: Vec3; placed: boolean }

const pair = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);
const mmText = (m: number) => Math.round(m * 1000) + ' mm';
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function meshBox(m: CriticMesh): Box {
  const [cx, cy, cz] = m.center;
  let h: Vec3;
  if (m.kind === 'sphere') h = [m.size[0], m.size[0], m.size[0]];
  else if (m.kind === 'cyl') {
    const r = m.size[0];
    const half = (m.size[1] ?? 0) / 2;
    h = m.axis === 'x' ? [half, r, r] : m.axis === 'y' ? [r, half, r] : [r, r, half];
  } else {
    const yaw = m.rot?.[2] ?? 0;
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const [sx, sy, sz] = m.size;
    h = [(sx * c + sy * s) / 2, (sx * s + sy * c) / 2, sz / 2];
  }
  return { min: [cx - h[0], cy - h[1], cz - h[2]], max: [cx + h[0], cy + h[1], cz + h[2]] };
}

function shift(b: Box, d: Vec3): Box {
  return { min: [b.min[0] + d[0], b.min[1] + d[1], b.min[2] + d[2]], max: [b.max[0] + d[0], b.max[1] + d[1], b.max[2] + d[2]] };
}

/** How deep two boxes overlap (the smallest axis overlap); ≤ 0 means apart. */
export function boxDepth(a: Box, b: Box): number {
  let d = Infinity;
  for (let k = 0; k < 3; k++) d = Math.min(d, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]));
  return d;
}
/** The gap between two boxes (largest axis separation); ≤ 0 means touching or overlapping. */
export function boxGap(a: Box, b: Box): number {
  let g = -Infinity;
  for (let k = 0; k < 3; k++) g = Math.max(g, Math.max(a.min[k] - b.max[k], b.min[k] - a.max[k]));
  return g;
}

function partDepth(a: Part, b: Part, ea = 0, eb = 0): number {
  let d = -Infinity;
  for (const x of a.boxes) for (const y of b.boxes) {
    const xa = ea ? shift(x, [a.explode[0] * ea, a.explode[1] * ea, a.explode[2] * ea]) : x;
    const yb = eb ? shift(y, [b.explode[0] * eb, b.explode[1] * eb, b.explode[2] * eb]) : y;
    d = Math.max(d, boxDepth(xa, yb));
  }
  return d;
}
function partGap(a: Part, b: Part): number {
  let g = Infinity;
  for (const x of a.boxes) for (const y of b.boxes) g = Math.min(g, boxGap(x, y));
  return g;
}

function sideWords(b: Box[]): string {
  const c = [0, 1, 2].map((k) => b.reduce((s, x) => s + (x.min[k] + x.max[k]) / 2, 0) / b.length);
  const fx = c[0] > 0.01 ? 'front' : c[0] < -0.01 ? 'rear' : '';
  const fy = c[1] > 0.01 ? 'left' : c[1] < -0.01 ? 'right' : '';
  return [fx, fy].filter(Boolean).join(' ');
}

/** The twin's parts, named the way a person would: "Wheel (front left)". */
export function criticParts(input: CriticInput): Part[] {
  const names = input.names ?? {};
  const counts: Record<string, number> = {};
  for (const u of input.units) counts[u.part] = (counts[u.part] ?? 0) + 1;
  const seen: Record<string, number> = {};
  const parts: Part[] = input.units.map((u) => {
    seen[u.part] = (seen[u.part] ?? 0) + 1;
    const boxes = u.meshes.map(meshBox);
    return { key: u.part + '#' + seen[u.part], part: u.part, label: names[u.part] ?? u.part, boxes, explode: u.explode, placed: false };
  });
  /* Repeated parts get their side ("Wheel (front left)") when the sides
   * tell them apart, otherwise a number ("Arm segment 2"). */
  Object.keys(counts).filter((id) => counts[id] > 1).forEach((id) => {
    const group = parts.filter((p) => p.part === id);
    const words = group.map((p) => sideWords(p.boxes));
    const distinct = words.every((w) => w) && new Set(words).size === words.length;
    group.forEach((p, i) => { p.label = distinct ? `${p.label} (${words[i]})` : `${p.label} ${i + 1}`; });
  });
  const placedNames: Record<string, number> = {};
  (input.placed ?? []).forEach((p) => { placedNames[p.name] = (placedNames[p.name] ?? 0) + 1; });
  for (const p of input.placed ?? []) {
    const yaw = (p.yawDeg * Math.PI) / 180;
    parts.push({
      key: 'placed:' + p.id, part: 'placed', label: p.name + (placedNames[p.name] > 1 ? ` (placed: ${p.id})` : ' (placed)'), placed: true,
      boxes: [meshBox({ kind: 'box', size: p.sizeM, center: p.positionM, rot: [0, 0, yaw] })],
      explode: [0, 0, 1],
    });
  }
  return parts;
}

function missingSizes(spec: CriticSpec, cls: TwinClass): string[] {
  const miss: string[] = [];
  if (!pos(spec.length_m)) miss.push('length');
  if (!pos(spec.width_m)) miss.push('width');
  if (!pos(spec.height_m)) miss.push('height');
  if (cls === 'ground') {
    if (!pos(spec.wheel?.diameter_m)) miss.push('wheel diameter');
    if (!pos(spec.wheel?.width_m)) miss.push('wheel width');
    if (!(typeof spec.ground_clearance_m === 'number' && spec.ground_clearance_m >= 0)) miss.push('ground clearance');
  }
  return miss;
}

const ALL_IDS: CriticFinding['id'][] = ['overlap', 'placed', 'wheels', 'floor', 'scrape', 'height', 'floating', 'explode'];
/* What may touch the floor: the parts a robot rolls or stands on. */
const FEET = ['wheel', 'caster', 'leg', 'base', 'battery'];
const TITLES: Record<CriticFinding['id'], string> = {
  size: 'Sizes the twin needs',
  overlap: 'Parts sharing the same space',
  placed: 'Placed parts fit',
  wheels: 'Wheels fit the body',
  floor: 'Stands on the floor',
  scrape: 'Only wheels and feet touch the floor',
  height: 'Twin stays inside the recorded height',
  floating: 'Every part is held by something',
  explode: 'Pulls apart cleanly',
};
const GROUP: Record<CriticFinding['id'], 'spec' | 'twin'> = {
  size: 'spec', overlap: 'spec', placed: 'spec', wheels: 'spec', floor: 'spec', scrape: 'twin', height: 'twin', floating: 'twin', explode: 'twin',
};
const f = (id: CriticFinding['id'], verdict: CriticVerdict, detail: string, parts: string[] = []): CriticFinding =>
  ({ id, group: GROUP[id], title: TITLES[id], verdict, detail, parts });

const baseName = (p: Part) => p.label.replace(/ \(.*\)$/, '').replace(/ \d+$/, '');
/** "4 wheels and 2 casters" */
function countText(ps: Part[]): string {
  const n: Record<string, number> = {};
  ps.forEach((p) => { const b = baseName(p).toLowerCase(); n[b] = (n[b] ?? 0) + 1; });
  return Object.entries(n).map(([b, k]) => (k > 1 ? `${k} ${b}s` : `the ${b}`)).join(' and ');
}
/** The joints that do touch, said once each: "Only parts joined on purpose touch: motor mount on wheel, …". */
function joinedText(kit: Part[], rest: Map<string, number>): string {
  const seen = new Set<string>();
  for (let i = 0; i < kit.length; i++) for (let j = i + 1; j < kit.length; j++) {
    if ((rest.get(kit[i].key + '|' + kit[j].key) ?? -1) > PASS_THROUGH_M) seen.add(baseName(kit[i]).toLowerCase() + ' on ' + baseName(kit[j]).toLowerCase());
  }
  return seen.size ? 'Only parts joined on purpose touch: ' + [...seen].join(', ') + '.' : 'No two parts share space.';
}

export function critiqueTwin(input: CriticInput): TwinCritique {
  const spec = input?.spec ?? {};
  const cls: TwinClass = input?.cls ?? 'ground';
  const model = input?.model;
  const basis = model?.basis ?? 'Bounding-box checks on RobotForge’s schematic 3D twin, built from this spec’s numbers. They test the model, not the real robot.';
  const miss = missingSizes(spec, cls);
  const notRecorded = 'Not recorded: ' + miss.join(', ') + '. The model’s own sizes are estimates, so nothing is compared against them.';
  if (miss.length && !model) {
    return {
      verdict: 'NOT_CHECKED', parts: 0, basis,
      findings: [
        f('size', 'NOT_CHECKED', 'Not recorded: ' + miss.join(', ') + '. The twin can’t be checked without them, and the critic doesn’t guess them. Measure the robot (or apply a scan) and the checks run.'),
        ...ALL_IDS.map((id) => f(id, 'NOT_CHECKED', 'Waiting on the sizes above.')),
      ],
    };
  }
  const parts = criticParts({ ...input, units: input.units ?? [] });
  const joints = new Set((model?.joints ?? JOINTS[cls] ?? []).map((j) => { const [a, b] = j.split('|'); return pair(a, b); }));
  const findings: CriticFinding[] = [];
  const kit = parts.filter((p) => !p.placed);
  const placed = parts.filter((p) => p.placed);

  /* 1 · kit parts sharing the same space */
  const restDepth = new Map<string, number>();
  const clashes: { a: Part; b: Part; d: number }[] = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i]; const b = parts[j];
    const d = partDepth(a, b);
    restDepth.set(a.key + '|' + b.key, d);
    if (a.placed || b.placed) continue;
    if (d > PASS_THROUGH_M && !joints.has(pair(a.part, b.part))) clashes.push({ a, b, d });
  }
  findings.push(clashes.length && model
    ? { ...f('overlap', 'WARN', clashes.slice(0, 4).map((c) => `${c.a.label} and ${c.b.label} overlap by ${mmText(c.d)}`).join('; ') + '. The generated model draws them in the same space.', [...new Set(clashes.flatMap((c) => [c.a.label, c.b.label]))]), group: 'twin' as const }
    : clashes.length
    ? f('overlap', 'FAIL', clashes.slice(0, 4).map((c) => `${c.a.label} and ${c.b.label} overlap by ${mmText(c.d)}`).join('; ') + (clashes.length > 4 ? `; and ${clashes.length - 4} more` : '') + '. Built from these numbers, they can’t both be there.', [...new Set(clashes.flatMap((c) => [c.a.label, c.b.label]))])
    : f('overlap', 'PASS', `${kit.length} parts checked pairwise. ${joinedText(kit, restDepth)}`));

  /* Which parts rest on the floor, and which are held through touching
   * parts (for a flying robot, through its airframe). Kit parts only:
   * placed parts are judged against these below. */
  const zMin = (p: Part) => Math.min(...p.boxes.map((b) => b.min[2]));
  const onFloor = parts.filter((p) => Math.abs(zMin(p)) <= TOUCH_M);
  const roots = cls === 'aerial' ? kit.filter((p) => p.part === 'frame') : onFloor.filter((p) => !p.placed);
  const held = new Set<Part>(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of kit) {
      if (held.has(p)) continue;
      if ([...held].some((q) => partGap(p, q) <= TOUCH_M)) { held.add(p); grew = true; }
    }
  }

  /* 2 · placed parts (Assembly planner) */
  if (model) findings.push(f('placed', 'NOT_CHECKED', 'Parts placed in the Assembly planner are positioned on the spec-built twin, not on this model.'));
  else if (!placed.length) findings.push(f('placed', 'NOT_CHECKED', 'No parts placed in the Assembly planner yet.'));
  else {
    const bad: { a: Part; b: Part; d: number }[] = [];
    for (const p of placed) for (const q of parts) {
      if (p === q) continue;
      const d = partDepth(p, q);
      if (d <= PASS_THROUGH_M) continue;
      if (!q.placed && MOUNT_BASES.includes(q.part) && d <= 0.004 + PASS_THROUGH_M) continue; // seated on its deck
      if (q.placed && placed.indexOf(q) < placed.indexOf(p)) continue;
      bad.push({ a: p, b: q, d });
    }
    /* A placed part rests on standoffs (up to STANDOFF_M tall, not
     * drawn) on the robot or on another resting placed part. */
    const rests = new Set<Part>();
    let more = true;
    while (more) {
      more = false;
      for (const p of placed) {
        if (rests.has(p)) continue;
        if ([...held, ...rests].some((q) => partGap(p, q) <= STANDOFF_M)) { rests.add(p); more = true; }
      }
    }
    const adrift = placed.filter((p) => !rests.has(p));
    const msgs = [
      ...bad.slice(0, 4).map((c) => `${c.a.label} goes ${mmText(c.d)} into ${c.b.label}`),
      ...adrift.map((p) => `${p.label} floats ${mmText(Math.min(...[...held, ...rests].map((q) => partGap(p, q))))} from anything that could hold it`),
    ];
    findings.push(msgs.length
      ? f('placed', 'FAIL', msgs.join('; ') + '. Move it in the Assembly planner.', [...new Set([...bad.flatMap((c) => [c.a.label, c.b.label]), ...adrift.map((p) => p.label)])])
      : f('placed', 'PASS', `${placed.length} placed part${placed.length === 1 ? '' : 's'} clear of each other and of the robot’s own parts.`));
  }

  /* 3 · wheels (ground robots) */
  if (cls !== 'ground') findings.push(f('wheels', 'NOT_CHECKED', 'Not a wheeled robot.'));
  else if (miss.some((m) => /length|height|wheel|clearance/.test(m))) findings.push(f('wheels', 'NOT_CHECKED', notRecorded));
  else {
    const D = spec.wheel!.diameter_m!;
    const msgs: string[] = [];
    if (D > spec.height_m! + 1e-9) msgs.push(`the wheels (${mmText(D)} across) are taller than the whole robot (${mmText(spec.height_m!)})`);
    if ((spec.wheel?.count ?? 0) >= 4 && D > spec.length_m! / 2 + 1e-9) msgs.push(`front and rear wheels (${mmText(D)} each) don’t fit along a ${mmText(spec.length_m!)} body side by side`);
    if ((spec.wheel?.count ?? 0) === 2 && !(spec.ground_clearance_m! > 0)) msgs.push('ground clearance is 0, so the two balance casters have no size and the robot can’t stay level');
    findings.push(msgs.length
      ? f('wheels', 'FAIL', msgs.join('; ') + '.', kit.filter((p) => p.part === 'wheel' || p.part === 'caster').map((p) => p.label))
      : f('wheels', 'PASS', `${spec.wheel?.count ?? 0} wheels of ${mmText(D)} fit a body ${mmText(spec.length_m!)} long and ${mmText(spec.height_m!)} tall.`));
  }

  /* 4 · the floor: nothing below it, and the robot reaches it. A
   * flying robot is drawn in the air (no landing gear is modelled), so
   * only "nothing below the floor" applies to it. A kit part below the
   * floor is our drawing's fault; a placed part below it is the plan's. */
  const below = parts.filter((p) => zMin(p) < -TOUCH_M);
  const belowText = below.map((p) => `${p.label} reaches ${mmText(-zMin(p))} below the floor`).join('; ') + '.';
  if (below.some((p) => p.placed)) findings.push(f('floor', 'FAIL', belowText + ' Raise it in the Assembly planner.', below.map((p) => p.label)));
  else if (below.length) findings.push({ ...f('floor', 'WARN', belowText + ' Our drawing, not your spec, needs the fix.', below.map((p) => p.label)), group: 'twin' });
  else if (cls === 'aerial') findings.push(f('floor', 'NOT_CHECKED', 'It flies: the twin draws it in the air, and landing gear isn’t modelled. Nothing goes below the floor.'));
  else if (!onFloor.length) findings.push(model ? { ...f('floor', 'WARN', 'No part reaches the floor: the model hovers.'), group: 'twin' } : f('floor', 'FAIL', 'No part reaches the floor: the twin hovers.', []));
  else findings.push(f('floor', 'PASS', 'It stands on ' + countText(onFloor.filter((p) => FEET.includes(p.part) || /wheel/.test(p.part))) + '; nothing goes below the floor.'));

  /* 4b · nothing but wheels, casters and feet drawn down to the floor */
  const feet = onFloor.filter((p) => FEET.includes(p.part) || /wheel/.test(p.part));
  const scrape = onFloor.filter((p) => !feet.includes(p) && !p.placed);
  findings.push(scrape.length
    ? f('scrape', 'WARN', `${countText(scrape).replace(/^the /, 'The ')} ${scrape.length > 1 ? 'are' : 'is'} drawn all the way down to the floor, where ${scrape.length > 1 ? 'they' : 'it'} would drag. The twin should end ${scrape.length > 1 ? 'them' : 'it'} above the floor.`, scrape.map((p) => p.label))
    : f('scrape', feet.length ? 'PASS' : 'NOT_CHECKED', feet.length ? 'Only ' + countText(feet) + ' touch the floor.' : cls === 'aerial' ? 'It flies: nothing is drawn on the floor.' : 'Nothing stands on the floor.'));

  /* 5 · height: the drawing vs the recorded height */
  const tall = !pos(spec.height_m) ? [] : kit.map((p) => ({ p, top: Math.max(...p.boxes.map((b) => b.max[2])) })).filter((x) => x.top > spec.height_m! + TOUCH_M);
  findings.push(!pos(spec.height_m) ? f('height', 'NOT_CHECKED', 'Not recorded: height. The model’s own height is an estimate, so it isn’t compared.')
    : tall.length
    ? f('height', 'WARN', tall.map((x) => `${x.p.label} is drawn ${mmText(x.top - spec.height_m!)} above the recorded ${mmText(spec.height_m!)} height`).join('; ') + '. Our drawing, not your spec, needs the fix.', tall.map((x) => x.p.label))
    : f('height', 'PASS', `Every part is drawn within the recorded ${mmText(spec.height_m!)} height.`));

  /* 6 · floating: every part of the drawing connects to the floor
   * through touching parts (for a flying robot, to its airframe). */
  const loose = kit.filter((p) => !held.has(p));
  findings.push(loose.length
    ? f('floating', 'WARN', loose.map((p) => {
      const g = Math.min(...kit.filter((q) => q !== p && held.has(q)).map((q) => partGap(p, q)));
      return `${p.label} is drawn ${Number.isFinite(g) ? mmText(g) + ' from the nearest part' : 'apart from everything'}`;
    }).join('; ') + '. The real robot needs a mount there, and the twin should draw one.', loose.map((p) => p.label))
    : f('floating', 'PASS', `All ${kit.length} parts touch something that ${cls === 'aerial' ? 'holds on to the airframe' : 'reaches the floor'}.`));

  /* 7 · explode: pulling the model apart must not drive parts through each other */
  const E = input.explodeMaxM ?? 0.06;
  const through: { a: Part; b: Part; e: number }[] = [];
  for (let i = 0; i < kit.length; i++) for (let j = i + 1; j < kit.length; j++) {
    const a = kit[i]; const b = kit[j];
    if ((restDepth.get(a.key + '|' + b.key) ?? -1) > PASS_THROUGH_M) continue; // already together at rest
    for (let s = 1; s <= 12; s++) {
      const e = (E * s) / 12;
      if (partDepth(a, b, e, e) > PASS_THROUGH_M) { through.push({ a, b, e }); break; }
    }
  }
  findings.push(through.length
    ? f('explode', 'WARN', through.slice(0, 4).map((t) => `${t.a.label} passes through ${t.b.label} at ${mmText(t.e)} apart`).join('; ') + (through.length > 4 ? `; and ${through.length - 4} more` : '') + '. The take-apart view needs different pull directions for these.', [...new Set(through.flatMap((t) => [t.a.label, t.b.label]))])
    : f('explode', 'PASS', `Pulled apart to ${mmText(E)}, no two parts pass through each other.`));

  const vs = findings.map((x) => x.verdict);
  const verdict: CriticVerdict = vs.includes('FAIL') ? 'FAIL' : vs.includes('WARN') ? 'WARN' : 'PASS';
  return { verdict, findings, parts: parts.length, basis };
}

/* ---------- generated models (GLB) ----------
 * A GLB's own top-level nodes are its links (Omega1's ProjectSim rover:
 * chassis, sensor_head, four wheels). Each link's box is read from the
 * file itself, the accessors' recorded min/max through every node's
 * transform, so no 3D library is needed and nothing is resampled. */
export type Box3 = { min: Vec3; max: Vec3 };
type Mat = number[];
const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: Mat, b: Mat): Mat {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(n: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat {
  if (n.matrix?.length === 16) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/** Per-link boxes of a binary glTF, in the file's own frame (y up). */
export function glbLinkBoxes(buf: ArrayBuffer): Record<string, Box3> {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file.');
  const len = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  const nodes: { name?: string; children?: number[]; mesh?: number }[] = json.nodes ?? [];
  const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const out: Record<string, Box3> = {};
  const grow = (b: Box3, m: Mat, lo: number[], hi: number[]) => {
    for (let i = 0; i < 8; i++) {
      const p = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
      for (let k = 0; k < 3; k++) {
        const v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
        b.min[k] = Math.min(b.min[k], v); b.max[k] = Math.max(b.max[k], v);
      }
    }
  };
  const walk = (i: number, parent: Mat, b: Box3) => {
    const n = nodes[i];
    const m = mul(parent, trs(n as never));
    if (typeof n.mesh === 'number') {
      for (const prim of json.meshes[n.mesh].primitives ?? []) {
        const a = json.accessors[prim.attributes?.POSITION];
        if (a?.min && a?.max) grow(b, m, a.min, a.max);
      }
    }
    (n.children ?? []).forEach((c) => walk(c, m, b));
  };
  roots.forEach((r) => {
    const b: Box3 = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    walk(r, IDENT, b);
    if (Number.isFinite(b.min[0])) out[nodes[r].name ?? 'node' + r] = b;
  });
  return out;
}

/** A y-up model's links as critic units in the robot frame (x forward
 * = the model's +z, y left = its −x, z up = its +y). Pull-apart
 * directions copy TwinView's: `up` links rise, `fixed` links stay, the
 * rest move straight out from the model's centre; the slider's full
 * travel is 0.45 × the model's largest size. */
export function modelUnits(boxes: Record<string, Box3>, opts: { fixed?: string[]; up?: string[] } = {}): { units: CriticUnit[]; explodeMaxM: number } {
  const all = Object.values(boxes);
  const lo = [0, 1, 2].map((k) => Math.min(...all.map((b) => b.min[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...all.map((b) => b.max[k])));
  const centre = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const span = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k]));
  const units: CriticUnit[] = Object.entries(boxes).map(([name, b]) => {
    const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
    const size: Vec3 = [b.max[2] - b.min[2], b.max[0] - b.min[0], b.max[1] - b.min[1]];
    const center: Vec3 = [c[2], -c[0], c[1]];
    let dir: Vec3 = [0, 0, 0];
    if (opts.up?.includes(name)) dir = [0, 0, 1];
    else if (!opts.fixed?.includes(name)) {
      const dx = c[2] - centre[2]; const dy = -(c[0] - centre[0]);
      const l = Math.hypot(dx, dy);
      dir = l < 1e-8 ? [1, 0, 0] : [dx / l, dy / l, 0];
    }
    return { part: name, explode: dir, meshes: [{ kind: 'box', size, center }] };
  });
  return { units, explodeMaxM: span * 0.45 };
}

/* Omega1's ProjectSim rover: its links and the joints it is generated
 * with (the sensor head and the four wheels hang off the chassis). */
export const OMEGA1_MODEL = {
  joints: ['chassis|sensor_head', 'chassis|wheel_front_left', 'chassis|wheel_front_right', 'chassis|wheel_rear_left', 'chassis|wheel_rear_right'],
  names: { chassis: 'Chassis', sensor_head: 'Sensor head', wheel_front_left: 'Wheel (front left)', wheel_front_right: 'Wheel (front right)', wheel_rear_left: 'Wheel (rear left)', wheel_rear_right: 'Wheel (rear right)' } as Record<string, string>,
  basis: 'Bounding-box checks on Omega1’s ProjectSim twin, read from its own model file. Its shape and scale are ESTIMATES generated from a photo, so a problem here is the model’s, not the robot’s.',
};
