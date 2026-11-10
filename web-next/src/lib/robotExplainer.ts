/* "How does my robot work?" — a step-through explainer generated from
 * a robot's own record (feature 1 of the post-judging plan; the idea
 * comes from the MIT "anatomy" and "teardown" skills, rebuilt here, not
 * installed).
 *
 * One small model, built from the spec, drives everything the figure
 * shows: which parts light up, which wires carry a pulse, which way each
 * wheel turns, and every number under the figure. The figure never
 * types a number of its own.
 *
 * Honesty contract (same as the rest of the app):
 *  - Parts and wires come from the robot's recorded wiring only:
 *    `spec.connections` (rows with an evidence badge, e.g. Omega1's
 *    DOCUMENTED rows) or `spec.wiring` (nodes + connections). With
 *    neither, parts come from the spec's own fields and the wires are
 *    reported as not recorded. Nothing here invents a part, a voltage
 *    or a channel.
 *  - The ONE link RobotForge may add is "the compute board commands the
 *    motor driver" when both exist and no row joins them. It is marked
 *    INFERRED and says so in words.
 *  - Every fact carries its evidence. A missing value is shown as
 *    "not recorded", never guessed. No speed is ever computed unless
 *    wheel diameter AND motor rpm are both recorded in the spec.
 *  - PLANNED rows describe a future robot and are left out.
 *
 * Pure and import-free (like forgeTests.ts), so node can run it directly
 * in tests/test_robot_explainer.py. `explainerFrame(x, step, t)` is a
 * pure function of time: any frame can be drawn in any order, which is
 * what the stills and jump checks in tools/check_explainer.cjs rely on. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

export type Evidence =
  | 'DOCUMENTED' | 'CODE_DEFAULT' | 'OWNER' | 'SPEC' | 'ESTIMATE' | 'INFERRED' | 'NOT_RECORDED';

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  DOCUMENTED: 'From its docs or code',
  CODE_DEFAULT: 'Code default, not measured',
  OWNER: 'Entered by the owner',
  SPEC: 'Recorded spec',
  ESTIMATE: 'Estimate',
  INFERRED: 'RobotForge’s assumption',
  NOT_RECORDED: 'Not recorded',
};

export type Role = 'power' | 'driver' | 'compute' | 'motor' | 'servo' | 'sensor' | 'other';
export type SensorKind = 'ultrasonic' | 'camera' | 'lidar' | 'ir' | 'imu' | 'adc' | 'depth' | 'other';
export type Side = 'left' | 'right' | null;
export type End = 'front' | 'rear' | null;

export interface XNode {
  id: string;
  label: string;
  short: string;
  role: Role;
  side: Side;
  end: End;
  sensor?: SensorKind;
  /* "×2" style group nodes from spec.wiring ("DC gearmotors ×2"). */
  count: number;
}

export interface XEdge {
  id: string;
  from: string;
  to: string;
  kind: 'power' | 'signal';
  detail: string;
  evidence: Evidence;
}

export interface XFact {
  label: string;
  value: string;
  evidence: Evidence;
}

export type Motion = 'none' | 'forward' | 'turn' | 'sense' | 'actuate';
export type WindowKind = 'battery' | 'compute' | 'driver' | 'wheel' | 'sensor' | 'actuator' | 'none';

export interface XStep {
  id: 'power' | 'think' | 'driver' | 'forward' | 'turn' | 'actuate' | 'sense';
  button: string;
  hint: string;
  sound: string;
  /* Node ids that light up. */
  active: string[];
  /* Edge ids that carry pulses, and whether pulses run to → from. */
  flow: string[];
  reverse: boolean;
  motion: Motion;
  window: { kind: WindowKind; node?: string; title: string; lines: string[] };
  facts: XFact[];
  /* Seconds of figure time for one play of the step. */
  duration: number;
}

export interface XWheel {
  id: string;
  side: 'left' | 'right';
  end: End;
  /* The motor node that drives this wheel (a group node may drive several). */
  motor: string | null;
}

export interface Explainer {
  robotName: string;
  kind: 'wheeled' | 'other';
  bodyClass: 'ground' | 'aerial' | 'legged' | 'arm' | 'other';
  drivetrain: string;
  source: 'connections' | 'wiring' | 'spec';
  nodes: XNode[];
  edges: XEdge[];
  wheels: XWheel[];
  steps: XStep[];
  bigIdea: string;
  /* Plain-words list of what the record does not hold. */
  gaps: string[];
  /* One-line summary of where the parts and wires came from. */
  basis: string;
}

/* ---------------- classification ---------------- */

const RX = {
  power: /\bbatter(y|ies)\b|18650|\blipo\b|li-?ion|\bcells?\b|power bank|\bpsu\b/i,
  driver: /driver|pwm hat|pca9685|\besc\b|motor controller|h-?bridge|l298|tb6612|motor hat|motor board|drv8833/i,
  servo: /servo/i,
  motor: /motor|gearmotor|\bbldc\b/i,
  sensor: /sonar|ultrasonic|hc-sr04|camera|ov5647|lidar|\bimu\b|\bir\b|line[- ]track|\badc\b|ads1115|encoder|\bgps\b|depth|realsense|sensor|tof\b/i,
  compute: /raspberry|\bpi\b|jetson|arduino|esp32|controller|computer|flight controller|stm32|teensy|opencr|\bnuc\b|\bsbc\b|microcontroller|\bmcu\b|board/i,
};

function sensorKind(label: string): SensorKind {
  const l = label.toLowerCase();
  if (/ultrasonic|sonar|hc-sr04/.test(l)) return 'ultrasonic';
  if (/realsense|depth/.test(l)) return 'depth';
  if (/camera|ov5647|rgb/.test(l)) return 'camera';
  if (/lidar/.test(l)) return 'lidar';
  if (/\bir\b|line/.test(l)) return 'ir';
  if (/\bimu\b|gyro|accel/.test(l)) return 'imu';
  if (/\badc\b|ads1115/.test(l)) return 'adc';
  return 'other';
}

export function classify(label: string): Role {
  if (RX.power.test(label) && !RX.sensor.test(label)) return 'power';
  if (RX.driver.test(label)) return 'driver';
  if (RX.servo.test(label)) return 'servo';
  if (RX.motor.test(label)) return 'motor';
  if (RX.sensor.test(label)) return 'sensor';
  if (RX.compute.test(label)) return 'compute';
  return 'other';
}

function sideOf(label: string): Side {
  if (/\bleft\b/i.test(label)) return 'left';
  if (/\bright\b/i.test(label)) return 'right';
  return null;
}
function endOf(label: string): End {
  if (/\bfront\b|\bupper\b/i.test(label)) return 'front';
  if (/\brear\b|\bback\b|\blower\b/i.test(label)) return 'rear';
  return null;
}
function groupCount(label: string): number {
  const m = /[×x]\s*(\d+)\b/.exec(label) || /\b(\d+)\s*[×x]\b/.exec(label);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 && n < 50 ? n : 1;
}
/* "Battery (2× 18650 in series)" → "Battery"; "Raspberry Pi 4B" stays. */
function shortLabel(label: string): string {
  const s = label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*[—–-]\s.*$/, '').replace(/\s+/g, ' ').trim();
  return s.length > 22 ? s.slice(0, 21).trimEnd() + '…' : s;
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
}

function listWords(ws: string[]): string {
  return ws.length < 2 ? ws.join('') : ws.slice(0, -1).join(', ') + ' and ' + ws[ws.length - 1];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function fmt(n: number, digits = 2): string {
  return String(Number(n.toFixed(digits)));
}

/* ---------------- graph from the record ---------------- */

interface Graph { nodes: XNode[]; edges: XEdge[]; source: Explainer['source']; planned: number }

function makeNode(id: string, label: string, roleHint?: Role): XNode {
  const role = roleHint ?? classify(label);
  return {
    id, label, short: shortLabel(label), role,
    side: sideOf(label), end: endOf(label),
    sensor: role === 'sensor' ? sensorKind(label) : undefined,
    count: groupCount(label),
  };
}

const EVIDENCE_OK = new Set(['DOCUMENTED', 'CODE_DEFAULT', 'OWNER']);

function fromConnections(rows: unknown[]): Graph {
  const nodes = new Map<string, XNode>();
  const edges: XEdge[] = [];
  let planned = 0;
  const node = (label: string) => {
    const id = slug(label);
    if (!nodes.has(id)) nodes.set(id, makeNode(id, label));
    return id;
  };
  rows.forEach((raw, i) => {
    const r = raw as { from?: unknown; to?: unknown; detail?: unknown; evidence?: unknown };
    if (!r || typeof r.from !== 'string' || typeof r.to !== 'string' || !r.from.trim() || !r.to.trim()) return;
    if (r.evidence === 'PLANNED') { planned++; return; }
    const detail = typeof r.detail === 'string' ? r.detail : '';
    const from = node(r.from.trim());
    const to = node(r.to.trim());
    const kind = /^\s*power\b/i.test(detail) || nodes.get(from)!.role === 'power' ? 'power' : 'signal';
    const ev = typeof r.evidence === 'string' && EVIDENCE_OK.has(r.evidence) ? (r.evidence as Evidence) : 'OWNER';
    edges.push({ id: 'e' + i, from, to, kind, detail, evidence: ev });
  });
  return { nodes: [...nodes.values()], edges, source: 'connections', planned };
}

function fromWiring(w: { nodes?: unknown[]; connections?: unknown[] }): Graph {
  const nodes: XNode[] = [];
  for (const raw of w.nodes ?? []) {
    const n = raw as { id?: unknown; label?: unknown };
    if (!n || typeof n.id !== 'string') continue;
    const label = typeof n.label === 'string' && n.label.trim() ? n.label : n.id;
    /* The id is often the clearest role word ("driver", "controller"). */
    const byId = classify(n.id);
    const byLabel = classify(label);
    nodes.push(makeNode(n.id, label, byLabel !== 'other' ? byLabel : byId));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: XEdge[] = [];
  (w.connections ?? []).forEach((raw, i) => {
    const c = raw as { from?: unknown; to?: unknown; kind?: unknown; label?: unknown; volts?: unknown };
    if (!c || typeof c.from !== 'string' || typeof c.to !== 'string' || !ids.has(c.from) || !ids.has(c.to)) return;
    const volts = num(c.volts);
    const label = typeof c.label === 'string' ? c.label : '';
    const detail = [label, volts != null ? fmt(volts, 1) + ' V' : ''].filter(Boolean).join(' · ');
    edges.push({ id: 'e' + i, from: c.from, to: c.to, kind: c.kind === 'power' ? 'power' : 'signal', detail, evidence: 'SPEC' });
  });
  return { nodes, edges, source: 'wiring', planned: 0 };
}

function fromSpecFields(spec: Spec): Graph {
  const nodes: XNode[] = [];
  const b = spec?.battery;
  if (b && typeof b === 'object') {
    const chem = typeof b.chemistry === 'string' ? b.chemistry : '';
    nodes.push(makeNode('battery', ('Battery ' + (chem ? chem.toUpperCase() : '')).trim(), 'power'));
  }
  const compute = spec?.compute;
  const computeName = typeof compute === 'string' ? compute : compute && typeof compute === 'object' ? (compute.name || compute.model || compute.kind) : '';
  if (typeof computeName === 'string' && computeName.trim()) nodes.push(makeNode('compute', computeName.trim(), 'compute'));
  const mc = num(spec?.motor?.count);
  if (mc && mc > 0) nodes.push({ ...makeNode('motors', 'Motors ×' + mc, 'motor'), count: mc });
  const sensors = Array.isArray(spec?.sensors) ? spec.sensors : [];
  sensors.forEach((s: { kind?: unknown; position?: unknown }, i: number) => {
    const kind = typeof s?.kind === 'string' ? s.kind.replace(/_/g, ' ') : 'sensor';
    const n = makeNode('sensor-' + i, kind.replace(/^\w/, (c: string) => c.toUpperCase()), 'sensor');
    if (s?.position === 'front') n.end = 'front';
    if (s?.position === 'rear') n.end = 'rear';
    nodes.push(n);
  });
  return { nodes, edges: [], source: 'spec', planned: 0 };
}

/* ---------------- the explainer ---------------- */

function bodyClassOf(spec: Spec): Explainer['bodyClass'] {
  const d = String(spec?.drivetrain ?? '').toLowerCase();
  if (/differential|skid|ackermann|mecanum|omni|track|wheel/.test(d)) return 'ground';
  if (/leg|biped|humanoid|quadruped|hexapod/.test(d)) return 'legged';
  if (/multi|rotor|aerial|drone|fly|quadcopter|copter/.test(d)) return 'aerial';
  if (/arm|manipulator|fixed/.test(d)) return 'arm';
  if (num(spec?.wheel?.count)) return 'ground';
  return 'other';
}

function wheelsFor(spec: Spec, motors: XNode[]): XWheel[] {
  const count = num(spec?.wheel?.count) ?? 0;
  if (count !== 2 && count !== 4) return [];
  const slots: { side: 'left' | 'right'; end: End }[] = count === 4
    ? [{ side: 'left', end: 'front' }, { side: 'right', end: 'front' }, { side: 'left', end: 'rear' }, { side: 'right', end: 'rear' }]
    : [{ side: 'left', end: null }, { side: 'right', end: null }];
  return slots.map((s, i) => {
    const exact = motors.find((m) => m.side === s.side && (s.end === null || m.end === s.end));
    const sameSide = motors.find((m) => m.side === s.side);
    const group = motors.find((m) => m.side === null);
    const m = exact ?? sameSide ?? group ?? null;
    return { id: 'w' + i, side: s.side, end: s.end, motor: m ? m.id : null };
  });
}

/* "PWM ch 1 fwd / ch 0 back" → {fwd:1, back:0} */
export function channelsOf(detail: string): { fwd: number | null; back: number | null; any: number[] } {
  const any = [...detail.matchAll(/\bch\s*(\d+)/gi)].map((m) => Number(m[1]));
  const fwd = /\bch\s*(\d+)\s*fwd/i.exec(detail);
  const back = /\bch\s*(\d+)\s*back/i.exec(detail);
  return { fwd: fwd ? Number(fwd[1]) : null, back: back ? Number(back[1]) : null, any };
}

function busOf(detail: string): string | null {
  const m = /\b(I2C|SPI|UART|CAN|USB|CSI)\b(\s*0x[0-9a-f]+)?/i.exec(detail);
  return m ? m[0].replace(/\s+/g, ' ') : null;
}

export function buildExplainer(spec: Spec, opts: { name?: string; estimatedPaths?: string[] } = {}): Explainer {
  const name = String(opts.name || spec?.name || 'This robot');
  const est = new Set(opts.estimatedPaths ?? []);
  const evFor = (path: string): Evidence => (est.has(path) ? 'ESTIMATE' : 'SPEC');

  const conns = Array.isArray(spec?.connections) ? spec.connections : [];
  const wiring = spec?.wiring && typeof spec.wiring === 'object' && Array.isArray(spec.wiring.nodes) ? spec.wiring : null;
  const g: Graph = conns.length ? fromConnections(conns) : wiring ? fromWiring(wiring) : fromSpecFields(spec);

  const gaps: string[] = [];
  if (g.planned) gaps.push(`${g.planned} planned connection${g.planned === 1 ? '' : 's'} left out: they describe an upgrade, not the robot as it is.`);
  if (g.source === 'spec') gaps.push('Wiring not recorded, so no wires are drawn. Map the connections in the Wiring tab and the pulses appear.');

  const byRole = (r: Role) => g.nodes.filter((n) => n.role === r);
  const power = byRole('power');
  const drivers = byRole('driver');
  const compute = byRole('compute');
  const motors = byRole('motor');
  const servos = byRole('servo');
  const sensors = byRole('sensor');

  /* The one inferred link: compute → driver when no row joins them. */
  if (compute.length && drivers.length) {
    const c = compute[0];
    const d = drivers[0];
    const joined = g.edges.some((e) => (e.from === c.id && e.to === d.id) || (e.from === d.id && e.to === c.id));
    if (!joined) {
      const bus = g.edges.filter((e) => e.from === d.id).map((e) => busOf(e.detail)).find(Boolean);
      g.edges.push({
        id: 'inferred-cmd', from: c.id, to: d.id, kind: 'signal',
        detail: (bus ? bus + ' (read from the driver’s motor rows) · ' : '') + 'not a recorded row',
        evidence: 'INFERRED',
      });
    }
  }

  const edgesWhere = (f: (e: XEdge) => boolean) => g.edges.filter(f).map((e) => e.id);
  const ids = (ns: XNode[]) => ns.map((n) => n.id);
  const nameOf = (ns: XNode[], fallback: string) => (ns[0] ? ns[0].short : fallback);

  const bodyClass = bodyClassOf(spec);
  const drivetrain = String(spec?.drivetrain ?? '');
  const wheels = bodyClass === 'ground' ? wheelsFor(spec, motors) : [];
  const steerable = /differential|skid/.test(drivetrain.toLowerCase()) && wheels.length > 0;
  const kind: Explainer['kind'] = wheels.length ? 'wheeled' : 'other';
  const remote = /remote control|teleop|xbox|gamepad|joystick/i.test(String(spec?.description ?? ''));

  const steps: XStep[] = [];

  /* 1 · power */
  const b = spec?.battery ?? {};
  const powerFacts: XFact[] = [];
  const v = num(b.voltage_v);
  powerFacts.push(v != null
    ? { label: 'Battery voltage', value: fmt(v, 1) + ' V', evidence: evFor('battery.voltage_v') }
    : { label: 'Battery voltage', value: 'not recorded', evidence: 'NOT_RECORDED' });
  if (typeof b.chemistry === 'string') powerFacts.push({ label: 'Chemistry', value: b.chemistry === 'liion' ? 'Li-ion' : b.chemistry.toUpperCase(), evidence: evFor('battery.chemistry') });
  const cap = num(b.capacity_mah);
  powerFacts.push(cap != null
    ? { label: 'Capacity', value: fmt(cap, 0) + ' mAh', evidence: evFor('battery.capacity_mah') }
    : { label: 'Capacity', value: 'not recorded', evidence: 'NOT_RECORDED' });
  const powerEdges = g.edges.filter((e) => e.kind === 'power');
  for (const e of powerEdges.slice(0, 2)) {
    const to = g.nodes.find((n) => n.id === e.to);
    if (to) powerFacts.push({ label: 'Power to ' + to.short, value: e.detail.replace(/^\s*power\s*[—–-]\s*/i, '') || 'recorded row', evidence: e.evidence });
  }
  if (power.length) {
    const fed = [...new Set(powerEdges.map((e) => g.nodes.find((n) => n.id === e.to)?.short).filter(Boolean))];
    steps.push({
      id: 'power', button: 'Switch on',
      hint: fed.length
        ? `The battery pushes electricity to ${fed.slice(0, 3).join(', ')}. Everything else starts there.`
        : 'The battery is where all the energy comes from. Its wires are not recorded yet.',
      sound: 'click', active: ids(power), flow: edgesWhere((e) => e.kind === 'power'), reverse: false, motion: 'none',
      window: {
        kind: 'battery', node: power[0].id, title: power[0].short,
        lines: [power[0].label, v != null ? fmt(v, 1) + ' V' : 'voltage not recorded'],
      },
      facts: powerFacts, duration: 3,
    });
  } else {
    gaps.push('No battery or power source is recorded.');
  }

  /* 2 · think */
  if (compute.length) {
    const cmd = g.edges.filter((e) => e.from === compute[0].id && (drivers.some((d) => d.id === e.to) || motors.some((m) => m.id === e.to) || servos.some((s) => s.id === e.to)));
    const facts: XFact[] = [{ label: 'Brain', value: compute[0].label, evidence: g.source === 'connections' ? (g.edges.find((e) => e.from === compute[0].id || e.to === compute[0].id)?.evidence ?? 'SPEC') : 'SPEC' }];
    for (const e of cmd.slice(0, 2)) facts.push({ label: 'Talks to ' + (g.nodes.find((n) => n.id === e.to)?.short ?? 'part'), value: e.detail || 'recorded row', evidence: e.evidence });
    if (remote) facts.push({ label: 'Who drives', value: 'You, by remote control', evidence: 'SPEC' });
    steps.push({
      id: 'think', button: 'The brain decides',
      hint: (remote ? `The ${compute[0].short} reads your remote control` : `The ${compute[0].short} runs the robot’s program`) +
        (drivers.length ? ` and tells the ${drivers[0].short} what each motor should do.` : ' and decides what each motor should do.'),
      sound: 'beep', active: ids(compute), flow: cmd.map((e) => e.id), reverse: false, motion: 'none',
      window: { kind: 'compute', node: compute[0].id, title: compute[0].short, lines: [compute[0].label, remote ? 'input: remote control' : 'input: its program'] },
      facts, duration: 3,
    });
  } else {
    gaps.push('No computer or controller board is recorded.');
  }

  /* 3 · driver */
  const driveTargets = [...motors, ...servos];
  if (drivers.length) {
    const rows = g.edges.filter((e) => drivers.some((d) => d.id === e.from) && driveTargets.some((m) => m.id === e.to));
    const facts: XFact[] = rows.slice(0, 4).map((e) => ({ label: g.nodes.find((n) => n.id === e.to)?.short ?? 'Motor', value: e.detail || 'recorded row', evidence: e.evidence }));
    if (!rows.length) facts.push({ label: 'Driver to motors', value: 'not recorded', evidence: 'NOT_RECORDED' });
    steps.push({
      id: 'driver', button: 'The driver fires',
      hint: `A computer pin is far too weak to spin a motor. The ${drivers[0].short} switches the battery’s power to each motor, forward or backward.`,
      sound: 'tik tik', active: [...ids(drivers), ...rows.map((e) => e.to)], flow: rows.map((e) => e.id), reverse: false, motion: 'none',
      window: { kind: 'driver', node: drivers[0].id, title: drivers[0].short, lines: rows.slice(0, 6).map((e) => (g.nodes.find((n) => n.id === e.to)?.short ?? '') + ': ' + e.detail) },
      facts, duration: 3.5,
    });
  } else if (motors.length) {
    gaps.push('No motor driver is recorded, so the step where power is switched to the motors is left out.');
  }

  /* 4 · move */
  const motorRows = g.edges.filter((e) => motors.some((m) => m.id === e.to) && drivers.some((d) => d.id === e.from));
  if (kind === 'wheeled') {
    const wc = num(spec?.wheel?.count) ?? wheels.length;
    const dia = num(spec?.wheel?.diameter_m);
    const rpm = num(spec?.motor?.rpm) ?? num(spec?.motor?.no_load_rpm) ?? num(spec?.motor?.max_rpm);
    const facts: XFact[] = [
      { label: 'Driven wheels', value: String(wc), evidence: evFor('wheel.count') },
      dia != null ? { label: 'Wheel diameter', value: fmt(dia * 1000, 0) + ' mm', evidence: evFor('wheel.diameter_m') } : { label: 'Wheel diameter', value: 'not measured', evidence: 'NOT_RECORDED' },
    ];
    if (typeof spec?.motor?.kind === 'string') facts.push({ label: 'Motor type', value: spec.motor.kind.replace(/_/g, ' '), evidence: evFor('motor.kind') });
    if (dia != null && rpm != null) {
      const ev: Evidence = est.has('wheel.diameter_m') || est.has('motor.rpm') ? 'ESTIMATE' : 'SPEC';
      facts.push({ label: 'Top speed (wheel × rpm, no load)', value: fmt(Math.PI * dia * rpm / 60, 2) + ' m/s', evidence: ev });
    } else {
      facts.push({ label: 'Top speed', value: 'not computed: needs wheel diameter and motor rpm', evidence: 'NOT_RECORDED' });
    }
    const fwdCh = motorRows.map((e) => channelsOf(e.detail).fwd).filter((n): n is number => n != null);
    steps.push({
      id: 'forward', button: 'Roll forward',
      hint: `All ${wc} wheels turn the same way at the same speed, so ${name} rolls straight ahead.`,
      sound: 'whirr', active: ids(motors), flow: motorRows.map((e) => e.id), reverse: false, motion: 'forward',
      window: { kind: 'wheel', title: 'Every wheel', lines: [fwdCh.length ? 'forward channels: ' + fwdCh.join(', ') : 'all motors forward'] },
      facts, duration: 4,
    });
    if (steerable) {
      const skid = /skid/.test(drivetrain.toLowerCase());
      const left = wheels.filter((w) => w.side === 'left').length;
      const backCh = motorRows.filter((e) => g.nodes.find((n) => n.id === e.to)?.side === 'left').map((e) => channelsOf(e.detail).back).filter((n): n is number => n != null);
      const rightFwd = motorRows.filter((e) => g.nodes.find((n) => n.id === e.to)?.side === 'right').map((e) => channelsOf(e.detail).fwd).filter((n): n is number => n != null);
      steps.push({
        id: 'turn', button: 'Turn on the spot',
        hint: `The left wheel${left > 1 ? 's go' : ' goes'} backward and the right wheel${left > 1 ? 's go' : ' goes'} forward, so ${name} spins in place. There is no steering wheel.`,
        sound: skid ? 'skrrt' : 'whirr', active: ids(motors), flow: motorRows.map((e) => e.id), reverse: false, motion: 'turn',
        window: { kind: 'driver', node: drivers[0]?.id, title: drivers[0]?.short ?? 'Motors', lines: [
          backCh.length ? 'left backward: ch ' + backCh.join(', ') : 'left side backward',
          rightFwd.length ? 'right forward: ch ' + rightFwd.join(', ') : 'right side forward',
        ] },
        facts: [
          { label: 'Drivetrain', value: skid ? 'skid-steer' : 'differential', evidence: evFor('drivetrain') },
          { label: 'How it turns', value: 'one side backward, the other forward', evidence: 'INFERRED' },
        ],
        duration: 4,
      });
    }
  } else if (motors.length || servos.length) {
    steps.push({
      id: 'actuate', button: 'Motors move',
      hint: bodyClass === 'aerial' ? 'Each propeller motor speeds up or slows down on its own. That is how it lifts, tilts and turns.'
        : bodyClass === 'legged' ? 'Each joint motor turns a little at a time, one after another, so the legs step.'
        : bodyClass === 'arm' ? 'Each joint has its own motor. Turning them together moves the hand to a point.'
        : 'The motors move the parts they are fixed to.',
      sound: 'whirr', active: ids(driveTargets), flow: motorRows.map((e) => e.id), reverse: false, motion: 'actuate',
      window: { kind: 'actuator', title: driveTargets[0].short, lines: [driveTargets.map((m) => m.short).slice(0, 4).join(', ')] },
      facts: [
        num(spec?.motor?.count) != null ? { label: 'Motors', value: String(spec.motor.count), evidence: evFor('motor.count') } : { label: 'Motors', value: 'count not recorded', evidence: 'NOT_RECORDED' },
      ],
      duration: 4,
    });
  }

  /* 5 · sense */
  const realSensors = sensors.filter((s) => s.sensor !== 'adc');
  if (realSensors.length) {
    const rows = g.edges.filter((e) => realSensors.some((s) => s.id === e.to || s.id === e.from) && compute.some((c) => c.id === e.from || c.id === e.to));
    const specSensors: { kind?: string; range_m?: number }[] = Array.isArray(spec?.sensors) ? spec.sensors : [];
    const facts: XFact[] = rows.slice(0, 4).map((e) => ({ label: g.nodes.find((n) => n.id === (realSensors.some((s) => s.id === e.to) ? e.to : e.from))?.short ?? 'Sensor', value: e.detail || 'recorded row', evidence: e.evidence }));
    specSensors.forEach((s, i) => {
      const r = num(s?.range_m);
      if (r != null) facts.push({ label: String(s.kind ?? 'sensor').replace(/_/g, ' ') + ' range', value: fmt(r, 2) + ' m', evidence: evFor(`sensors.${i}.range_m`) });
    });
    if (!facts.length) facts.push({ label: 'Sensors', value: realSensors.map((s) => s.short).join(', '), evidence: 'SPEC' });
    const has = (k: SensorKind) => realSensors.some((s) => s.sensor === k);
    const what = [
      has('ultrasonic') ? 'measures how far away things are with sound' : '',
      has('lidar') ? 'sweeps a laser around to map the room' : '',
      has('camera') || has('depth') ? 'sends a camera picture' : '',
      has('ir') ? 'watches the floor for a line' : '',
      has('imu') ? 'feels which way it is tilting' : '',
    ].filter(Boolean);
    const brain = compute[0] ? `the ${compute[0].short}` : "its brain";
    steps.push({
      id: 'sense', button: 'Sense the world',
      hint: (what.length ? `It ${listWords(what.slice(0, 3))}. All of it goes back to ${brain}.` : `Its sensors report back to ${brain}.`) +
        (remote ? ' You still do the driving.' : ''),
      sound: has('ultrasonic') ? 'ping' : 'bzz', active: ids(realSensors), flow: rows.map((e) => e.id), reverse: true, motion: 'sense',
      window: { kind: 'sensor', node: realSensors[0].id, title: realSensors[0].short, lines: [realSensors[0].label] },
      facts, duration: 4,
    });
  }

  const bigIdea = steerable
    ? (/skid/.test(drivetrain.toLowerCase())
      ? `${name} turns by spinning one side’s wheels backward.`
      : `${name} steers by running its two wheels at different speeds.`)
    : bodyClass === 'aerial' ? `${name} flies by changing how fast each propeller spins.`
    : bodyClass === 'legged' ? `${name} walks by moving one joint motor after another.`
    : bodyClass === 'arm' ? `${name} reaches by turning every joint motor together.`
    : `Power, a brain and a driver: every motor of ${name} waits for all three.`;

  const basis = g.source === 'connections'
    ? `Parts and wires from ${name}’s ${g.edges.filter((e) => e.evidence !== 'INFERRED').length} recorded wiring rows.`
    : g.source === 'wiring'
    ? `Parts and wires from ${name}’s recorded wiring diagram.`
    : `Parts from ${name}’s spec fields. Its wiring is not recorded.`;

  return {
    robotName: name, kind, bodyClass, drivetrain, source: g.source,
    nodes: g.nodes, edges: g.edges, wheels, steps, bigIdea, gaps, basis,
  };
}

/* ---------------- layout (figure coordinates) ---------------- */

export const FIG = { w: 600, h: 470, cx: 300, cy: 252, bw: 300, bh: 330 };

export interface Placement {
  node: string;
  x: number; y: number; w: number; h: number;
  shape: 'battery' | 'board' | 'motor' | 'sensor' | 'servo' | 'other';
}
export interface WheelPlacement { wheel: string; x: number; y: number; w: number; h: number; side: 'left' | 'right' }
export interface Layout { parts: Placement[]; wheels: WheelPlacement[]; wires: { edge: string; pts: [number, number][] }[] }

function spread(n: number, center: number, gap: number): number[] {
  return Array.from({ length: n }, (_, i) => center + (i - (n - 1) / 2) * gap);
}

export function layoutExplainer(x: Explainer): Layout {
  const { cx, cy, bw, bh } = FIG;
  const top = cy - bh / 2;
  const bottom = cy + bh / 2;
  const inner = bw - 80; /* room between the motor columns */
  const parts: Placement[] = [];
  const role = (r: Role) => x.nodes.filter((n) => n.role === r);
  /* A row of parts centred at y, each at most w wide, all inside `room`. */
  const row = (ns: XNode[], y: number, w: number, h: number, shape: Placement['shape'], room = inner) => {
    if (!ns.length) return;
    const each = Math.min(w, room / ns.length - 8);
    spread(ns.length, cx, each + 8).forEach((px, i) => parts.push({ node: ns[i].id, x: px - each / 2, y: y - h / 2, w: each, h, shape }));
  };
  const pw = role('power');
  const dr = role('driver');
  const co = role('compute');
  const se = role('sensor');
  const sv = role('servo');
  const ot = role('other');
  const adc = se.filter((s) => s.sensor === 'adc');
  row(pw, bottom - 32, 130, 36, 'battery', adc.length ? inner - 70 : inner);
  if (adc.length) {
    const p = parts.filter((q) => q.shape === 'battery').at(-1);
    const shift = 34;
    for (const q of parts) if (q.shape === 'battery') q.x -= shift;
    adc.forEach((s, i) => parts.push({ node: s.id, x: (p ? p.x + p.w + 6 : cx + 40) + i * 4, y: bottom - 42, w: 70, h: 20, shape: 'sensor' }));
  }
  row(dr, cy + 48, 160, 36, 'board');
  row(co, cy - 26, 160, 36, 'board');
  row(ot, cy + 98, 90, 20, 'other');

  /* Motors: next to their wheels when there are wheels, else a ring. */
  const wheels: WheelPlacement[] = [];
  const mo = role('motor');
  if (x.wheels.length) {
    const ww = 34;
    const wh = x.wheels.length === 4 ? 84 : 104;
    for (const w of x.wheels) {
      const wy = w.end === 'front' ? top + 72 : w.end === 'rear' ? bottom - 72 : cy;
      const wx = w.side === 'left' ? cx - bw / 2 - ww - 4 : cx + bw / 2 + 4;
      wheels.push({ wheel: w.id, x: wx, y: wy - wh / 2, w: ww, h: wh, side: w.side });
      if (w.motor) {
        const mx = w.side === 'left' ? cx - bw / 2 + 8 : cx + bw / 2 - 8 - 28;
        parts.push({ node: w.motor, x: mx, y: wy - 14, w: 28, h: 28, shape: 'motor' });
      }
    }
    for (const m of mo) if (!parts.some((p) => p.node === m.id)) parts.push({ node: m.id, x: cx - 14, y: cy + 80, w: 28, h: 28, shape: 'motor' });
  } else {
    const r = Math.min(bw, bh) / 2 + 30;
    const total = Math.max(1, mo.reduce((s, q) => s + Math.min(q.count, 8), 0));
    let k = 0;
    for (const m of mo) {
      for (let j = 0; j < Math.min(Math.max(m.count, 1), 8); j++, k++) {
        const a = -Math.PI / 4 + (k / total) * Math.PI * 2;
        parts.push({ node: m.id, x: cx + Math.cos(a) * r - 14, y: cy + Math.sin(a) * r - 14, w: 28, h: 28, shape: 'motor' });
      }
    }
  }
  /* Sensors on the edge they face; floor and motion sensors inside near the front. */
  const front = se.filter((s) => s.sensor !== 'adc' && s.end !== 'rear' && s.sensor !== 'ir' && s.sensor !== 'imu');
  const under = se.filter((s) => s.sensor === 'ir' || s.sensor === 'imu');
  const rear = se.filter((s) => s.end === 'rear' && s.sensor !== 'adc' && s.sensor !== 'ir' && s.sensor !== 'imu');
  const edgeRow = (ns: XNode[], y: number) => {
    if (!ns.length) return;
    const each = Math.min(96, (bw - 20) / ns.length - 8);
    spread(ns.length, cx, each + 8).forEach((px, i) => parts.push({ node: ns[i].id, x: px - each / 2, y, w: each, h: 24, shape: 'sensor' }));
  };
  edgeRow(front, top - 14);
  edgeRow(rear, bottom - 10);
  row(sv, top + 32, 76, 20, 'servo');
  row(under, top + 60, 130, 20, 'sensor');

  /* Wires: centre to centre with one elbow, one per placement pair
   * (a group motor node placed at two wheels gets two wires). */
  const centre = (p: Placement): [number, number] => [p.x + p.w / 2, p.y + p.h / 2];
  const wires: Layout['wires'] = [];
  for (const e of x.edges) {
    const a = parts.find((p) => p.node === e.from);
    const bs = parts.filter((p) => p.node === e.to);
    if (!a) continue;
    for (const b of bs) {
      const [ax, ay] = centre(a);
      const [bx, by] = centre(b);
      wires.push({ edge: e.id, pts: [[ax, ay], [ax, by], [bx, by]] });
    }
  }
  return { parts, wheels, wires };
}

/* ---------------- frames (pure in t) ---------------- */

export interface Frame {
  step: number;
  t: number;
  /* 0 → 1 across the step. */
  p: number;
  /* 0 → 1 over the first 0.35 s, then held (the lit parts stay lit). */
  glow: number;
  /* 0 → 1 → 0 over the first and last 0.3 s: pulses and sound words. */
  fade: number;
  lit: string[];
  /* Pulses: edge id + position 0..1 along it (already reversed if needed). */
  pulses: { edge: string; s: number }[];
  /* Signed wheel speed per wheel id (+1 forward, -1 backward, 0 still) and tread phase 0..1. */
  wheel: Record<string, { dir: number; phase: number }>;
  /* Robot pose inside the figure: rotation in degrees, scale (it shrinks
   * a little mid-turn so its corners stay in frame) and floor scroll 0..1. */
  rot: number;
  zoom: number;
  floor: number;
  /* Sensor ping ripple 0..1 (repeats). */
  ping: number;
  /* Generic actuator wobble -1..1 for non-wheeled motion. */
  wobble: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/* Smoothstep that never sees a > b (the ANGLE trap the cutaway notes warn about). */
const smooth = (v: number) => { const c = clamp01(v); return c * c * (3 - 2 * c); };

export function explainerFrame(x: Explainer, stepIndex: number, tIn: number): Frame {
  const step = x.steps[Math.max(0, Math.min(x.steps.length - 1, stepIndex))];
  const dur = step ? step.duration : 1;
  const t = Math.max(0, Math.min(dur, Number.isFinite(tIn) ? tIn : 0));
  const p = t / dur;
  const glow = smooth(t / 0.35);
  const fade = smooth(t / 0.3) * smooth((dur - t) / 0.3);
  const out: Frame = { step: stepIndex, t, p, glow: step ? glow : 0, fade: step ? fade : 0, lit: step ? step.active : [], pulses: [], wheel: {}, rot: 0, zoom: 1, floor: 0, ping: 0, wobble: 0 };
  if (!step) return out;

  /* Three pulses per wire, evenly spaced, moving at one wire-length per 1.2 s. */
  for (const id of step.flow) {
    for (let k = 0; k < 3; k++) {
      let s = (t / 1.2 + k / 3) % 1;
      if (step.reverse) s = 1 - s;
      out.pulses.push({ edge: id, s });
    }
  }

  /* Wheel motion. Tread phase must return to 0 at the step's end, so the
   * number of tread cycles per step is a whole number. */
  const cycles = Math.round(dur * 1.5);
  const ramp = smooth(t / 0.5) * smooth((dur - t) / 0.5);
  for (const w of x.wheels) {
    let dir = 0;
    if (step.motion === 'forward') dir = 1;
    if (step.motion === 'turn') dir = w.side === 'left' ? -1 : 1;
    /* Phase integrates the eased speed; using the eased progress keeps it
     * continuous and still lands on a whole number of cycles at the end. */
    const phase = dir === 0 ? 0 : ((dir * smooth(p) * cycles) % 1 + 1) % 1;
    out.wheel[w.id] = { dir: dir * ramp, phase };
  }
  if (step.motion === 'forward') out.floor = (smooth(p) * Math.round(dur)) % 1;
  /* One full turn (counter-clockwise: left side backward), eased, so the
   * robot ends exactly where it started. */
  if (step.motion === 'turn') { out.rot = -360 * smooth(p); out.zoom = 1 - 0.2 * Math.sin(Math.PI * smooth(p)); }
  if (step.motion === 'sense') out.ping = (t / 1.0) % 1;
  if (step.motion === 'actuate') out.wobble = Math.sin(smooth(p) * Math.PI * 2 * Math.round(dur / 1.5)) * ramp;
  return out;
}

/* Total figure time of a full Auto loop, and the step + local time at a
 * global time g (used by the Auto mode and the film capture). */
export function explainerTimeline(x: Explainer, hold = 0.6): { total: number; at: (g: number) => { step: number; t: number } } {
  const lens = x.steps.map((s) => s.duration + hold);
  const total = lens.reduce((a, b) => a + b, 0);
  return {
    total,
    at(g: number) {
      let r = ((g % total) + total) % total;
      for (let i = 0; i < lens.length; i++) {
        if (r < lens[i]) return { step: i, t: Math.min(r, x.steps[i].duration) };
        r -= lens[i];
      }
      return { step: 0, t: 0 };
    },
  };
}

/* Point at fraction s along a polyline. */
export function along(pts: [number, number][], s: number): [number, number] {
  if (pts.length < 2) return pts[0] ?? [0, 0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let want = clamp01(s) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? want / seg[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}
