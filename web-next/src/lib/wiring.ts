/* Wiring logic, ported one-to-one from the vanilla assets/js/wiring.js
 * "wiring-logic" block (which the Python tests still exercise). Pure:
 * no DOM. Cable facts come only from the spec's own records; a field the
 * data does not name reads "not specified", never a guess. */

export interface WireNode { id: string; label: string; req_label?: string; rated_max_v?: number | null; deck?: boolean; kit?: string | null }
export interface WireCable { gauge_awg?: number | null; connector?: string | null; length_mm?: number | null; [k: string]: unknown }
export interface WireConn { from: string; to: string; kind: 'power' | 'data' | string; label?: string; volts?: number | null; cable?: WireCable | null }
export interface Wiring { nodes: WireNode[]; connections: WireConn[]; note?: string }

export function isWiring(w: unknown): w is Wiring {
  return !!w && typeof w === 'object' && Array.isArray((w as Wiring).nodes) && Array.isArray((w as Wiring).connections) && (w as Wiring).nodes.length > 0;
}

export function nodeMap(w: Wiring): Record<string, WireNode> {
  const m: Record<string, WireNode> = {};
  (w.nodes || []).forEach((n) => { m[n.id] = n; });
  return m;
}

/* Supply depth of each node: BFS from the battery along connections in
 * their from -> to direction. Unreached nodes stay Infinity. */
export function depths(w: Wiring): Record<string, number> {
  const depth: Record<string, number> = {};
  (w.nodes || []).forEach((n) => { depth[n.id] = Infinity; });
  if (!Object.prototype.hasOwnProperty.call(depth, 'battery')) return depth;
  depth.battery = 0;
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach((c) => {
      if (depth[c.from] !== Infinity && depth[c.from] !== undefined && depth[c.to] === Infinity) { depth[c.to] = depth[c.from] + 1; grew = true; }
    });
  }
  return depth;
}

export function stageOf(w: Wiring, depth: Record<string, number>, i: number): number {
  const d = depth[w.connections[i].from];
  return d === undefined || d === Infinity ? Infinity : d + 1;
}

/* Recorded over-voltage only: a fixed-voltage power feed above the
 * target's recorded rated maximum. */
export function badConns(w: Wiring): Set<number> {
  const nodes = nodeMap(w), bad = new Set<number>();
  (w.connections || []).forEach((c, i) => {
    const t = nodes[c.to];
    if (c.kind === 'power' && c.volts != null && t && t.rated_max_v != null && c.volts > t.rated_max_v) bad.add(i);
  });
  return bad;
}

export const volts = (v: number | null | undefined) => (v == null ? 'not specified' : Math.round(v * 10) / 10 + ' V');
export const shortLabel = (n: WireNode | undefined) => (n ? n.label.split(' — ')[0].split(' (')[0] : '?');

function powered(w: Wiring, excludeId: string | null): Set<string> {
  const on = new Set<string>();
  if (excludeId === 'battery' || !nodeMap(w).battery) return on;
  on.add('battery');
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach((c) => {
      if (c.kind !== 'power' || c.from === excludeId || c.to === excludeId) return;
      if (on.has(c.from) && !on.has(c.to)) { on.add(c.to); grew = true; }
    });
  }
  return on;
}

/* If this part dies: the parts that had a power path and lose it
 * (power cables only; data links don't keep a part alive). */
export function failure(w: Wiring, deadId: string): string[] {
  const before = powered(w, null), after = powered(w, deadId);
  return (w.nodes || []).map((n) => n.id).filter((id) => id !== deadId && before.has(id) && !after.has(id));
}

/* Every path through one node: ancestors and descendants over all edges. */
export function trace(w: Wiring, id: string): { nodes: string[]; conns: number[] } {
  const anc = new Set([id]), desc = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    (w.connections || []).forEach((c) => {
      if (anc.has(c.to) && !anc.has(c.from)) { anc.add(c.from); grew = true; }
      if (desc.has(c.from) && !desc.has(c.to)) { desc.add(c.to); grew = true; }
    });
  }
  const conns: number[] = [], nodes = new Set([id]);
  (w.connections || []).forEach((c, i) => {
    if (anc.has(c.from) && desc.has(c.to)) { conns.push(i); nodes.add(c.from); nodes.add(c.to); }
  });
  return { nodes: [...nodes], conns };
}

export interface Edge { i: number; d: string; mx: number; my: number; stage: number }
export interface Layout { pos: Record<string, { x: number; y: number }>; width: number; height: number; edges: (Edge | null)[]; depth: Record<string, number>; box: { w: number; h: number } }

/* Deterministic schematic: columns by supply depth, rows in spec order. */
export function layout(w: Wiring): Layout {
  const depth = depths(w);
  let maxDepth = 0;
  (w.nodes || []).forEach((n) => { if (depth[n.id] !== Infinity) maxDepth = Math.max(maxDepth, depth[n.id]); });
  const cols: Record<number, string[]> = {};
  (w.nodes || []).forEach((n) => {
    const d = depth[n.id] === Infinity ? maxDepth + 1 : depth[n.id];
    (cols[d] = cols[d] || []).push(n.id);
  });
  const BW = 170, BH = 54, GX = 208, GY = 94, X0 = 24, Y0 = 24;
  const pos: Layout['pos'] = {};
  let maxRows = 0, maxCol = 0;
  Object.keys(cols).forEach((k) => {
    const d = Number(k);
    maxCol = Math.max(maxCol, d);
    maxRows = Math.max(maxRows, cols[d].length);
    cols[d].forEach((id, row) => { pos[id] = { x: X0 + d * GX, y: Y0 + row * GY }; });
  });
  const width = X0 * 2 + maxCol * GX + BW;
  const height = Y0 * 2 + Math.max(0, maxRows - 1) * GY + BH;
  const pairCount: Record<string, number> = {}, pairSeen: Record<string, number> = {};
  (w.connections || []).forEach((c) => { const k = [c.from, c.to].sort().join('|'); pairCount[k] = (pairCount[k] || 0) + 1; });
  const edges = (w.connections || []).map((c, i) => {
    const a = pos[c.from], b = pos[c.to];
    if (!a || !b) return null;
    const k = [c.from, c.to].sort().join('|');
    const seen = pairSeen[k] || 0; pairSeen[k] = seen + 1;
    const off = (seen - (pairCount[k] - 1) / 2) * 13;
    const x1 = a.x + BW, y1 = a.y + BH / 2 + off, x2 = b.x, y2 = b.y + BH / 2 + off;
    let d: string, mx: number, my: number;
    if (x2 > x1) {
      d = `M${x1} ${y1} C${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`;
      mx = (x1 + 3 * (x1 + 46) + 3 * (x2 - 46) + x2) / 8;
      my = (y1 + 3 * y1 + 3 * y2 + y2) / 8;
    } else {
      const lift = Math.min(y1, y2) - 40;
      d = `M${x1} ${y1} C${x1 + 52} ${lift}, ${x2 - 52} ${lift}, ${x2} ${y2}`;
      mx = (x1 + x2) / 2; my = lift + 16;
    }
    return { i, d, mx, my, stage: stageOf(w, depth, i) };
  });
  return { pos, width, height, edges, depth, box: { w: BW, h: BH } };
}

export function cableField(cable: WireCable | null | undefined, field: 'gauge_awg' | 'connector' | 'length_mm'): string {
  if (!cable || cable[field] == null) return 'not specified';
  if (field === 'gauge_awg') return cable.gauge_awg + ' AWG';
  if (field === 'length_mm') return cable.length_mm + ' mm';
  return String(cable[field]);
}

function connectorShort(connector: unknown): string | null {
  if (!connector) return null;
  const s = String(connector).split(' (')[0];
  return s.length > 24 ? s.slice(0, 23) + '…' : s;
}

function busName(label: string | undefined): string | null {
  const words = ['Dynamixel', 'CSI', 'I2C', 'UART', 'USB', 'TTL', 'serial', 'PWM', 'encoder'];
  const low = ' ' + String(label || '').toLowerCase() + ' ';
  for (const word of words) if (low.includes(word.toLowerCase())) return word;
  return null;
}

/* Plain-language role for a node: the part family, never an unsourced specific. */
export function role(w: Wiring, id: string): string {
  const n = nodeMap(w)[id];
  const label = n ? shortLabel(n).toLowerCase() : id;
  const has = (s: string) => label.includes(s) || id === s;
  if (id === 'battery') return 'the battery';
  if (has('regulator') || has('buck')) return 'the voltage regulator';
  if (has('distribution') || id === 'pdb') return 'the power distribution board';
  if (has('driver') && !has('dynamixel')) return 'the motor driver';
  if (has('dynamixel')) return 'the Dynamixel bus driver';
  if (has('esc') || id === 'esc') return 'the motor controllers (ESCs)';
  if (has('flight controller') || id === 'fc') return 'the flight controller';
  if (has('pixhawk')) return 'the flight controller';
  if (has('nano') || has('microcontroller') || has('arduino')) return 'the microcontroller';
  if (has('opencr')) return 'the OpenCR controller';
  if (has('raspberry') || has('computer') || has('controller board') || id === 'controller') return 'the computer';
  if (has('control board')) return 'the control board';
  if (has('flight board')) return 'the flight board';
  if (has('lidar')) return 'the lidar';
  if (has('camera')) return 'the camera';
  if (has('imu')) return 'the IMU';
  if (has('ultrasonic')) return 'the ultrasonic ranger';
  if (has('servo') || has('motor')) return 'the motors';
  if (has('power supply')) return 'the power supply';
  return 'the ' + (n ? shortLabel(n).toLowerCase() : id);
}

/* One plain sentence about a cable, from its kind, recorded voltage and label only. */
export function callout(w: Wiring, i: number): string {
  const c = w.connections[i];
  const a = role(w, c.from), b = role(w, c.to);
  const bus = busName(c.label);
  if (c.kind === 'power') {
    if (c.volts != null) return `Carries ${volts(c.volts)} power from ${a} to ${b}.`;
    if (/pwm/i.test(c.label || '')) return `Sends power from ${a} to ${b} as PWM — switched on and off, not a steady voltage, so it is never voltage-checked.`;
    return `Carries power from ${a} to ${b}; the rail voltage is not specified.`;
  }
  if (bus) return `Carries ${bus} data between ${a} and ${b}.`;
  return `Carries data between ${a} and ${b}.`;
}

export function chipText(w: Wiring, i: number, mode: 'simple' | 'full'): string {
  const c = w.connections[i];
  if (mode !== 'full') return c.kind + (c.kind === 'power' ? ' · ' + volts(c.volts) : '');
  const parts = [c.kind === 'power' ? volts(c.volts) : 'data'];
  const conn = connectorShort(c.cable?.connector);
  if (conn) parts.push(conn);
  if (c.cable?.gauge_awg != null) parts.push(c.cable.gauge_awg + ' AWG');
  if (c.cable?.length_mm != null) parts.push(c.cable.length_mm + ' mm');
  return parts.join(' · ');
}

export interface NodeStatus { state: 'bad' | 'ok' | 'unchecked'; feeds: WireConn[]; reason: string }
export function nodeStatus(w: Wiring, id: string): NodeStatus {
  const nodes = nodeMap(w), node = nodes[id], bad = badConns(w), feeds: WireConn[] = [];
  let state: NodeStatus['state'] = 'unchecked', reason = 'no feed is recorded for it';
  (w.connections || []).forEach((c, i) => {
    if (c.to !== id || c.kind !== 'power') return;
    feeds.push(c);
    if (bad.has(i)) state = 'bad';
    else if (c.volts != null && node && node.rated_max_v != null && state === 'unchecked') state = 'ok';
  });
  if (feeds.length && state === 'unchecked') {
    reason = feeds.every((c) => c.volts == null)
      ? 'its feed carries no fixed voltage (PWM or an unspecified rail)'
      : 'the part has no recorded rated maximum to check against';
  }
  return { state, feeds, reason };
}
