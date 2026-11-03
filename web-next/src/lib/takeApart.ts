/* Take-apart / assemble derivation for the Workshop Build tab
 * (components/garage/TakeApartPanel.tsx).
 *
 * The take-apart skill, as a data problem: a robot can only be taken
 * apart along connections its record actually carries, and it can
 * only be put back because the app REMEMBERS those connections —
 * dragging a part around is view state, never an edit to the record.
 * So everything here derives from records, in a strict order:
 *
 *   1. spec.forge (Forge Engine robots): parts from the recorded BOM,
 *      connections from the recorded wiring (catalogue part ids),
 *      home positions from the recorded placement when it covers
 *      every part — otherwise a computed layout, labelled as layout.
 *   2. spec.connections (owner-kept wiring maps, e.g. a stored
 *      Omega1): the connection endpoints ARE the parts; the detail
 *      text rides along as the step text.
 *   3. spec.wiring (the wiring-bench record): nodes are the parts,
 *      its connections are the steps.
 *   4. bare spec fields (battery / motor / wheel / sensors): those
 *      recorded component groups become free-drag part cards with NO
 *      steps — the record names no connections, so none are drawn.
 *   5. none of the above: no recorded build. The panel says so.
 *
 * Nothing is invented anywhere in this file: no fasteners, no extra
 * parts, no connections the record does not name. The module is
 * pure and import-free so the Python gate can copy it verbatim into
 * a node harness (the forgeEngine pattern). */

export interface TakePart { id: string; label: string; detail?: string }
export interface TakeConnection { fromId: string; toId: string; detail: string }
export type TakeSource = 'forge' | 'connections' | 'wiring' | 'spec' | 'none';
export type TakeHomeSource = 'placement' | 'layout' | 'none';

export interface TakeModel {
  parts: TakePart[];
  connections: TakeConnection[];
  /* Home position per part id, in diagram coordinates:
   * x 0..100 across, y 0..TA_H down. */
  home: Record<string, { x: number; y: number }>;
  homeSource: TakeHomeSource;
  source: TakeSource;
}

export interface TakeStep {
  n: number;          // 1-based, in the order the mode walks them
  total: number;
  conn: number;       // index into model.connections (the recorded order)
  verb: 'connect' | 'disconnect';
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  detail: string;
  text: string;
}

/* Diagram coordinate space and the snap radius inside it. */
export const TA_W = 100;
export const TA_H = 84;
export const TA_SNAP = 7;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnySpec = any;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* A tidy deterministic grid — COMPUTED layout, never recorded
 * positions. Part order is the record's order, read left-to-right,
 * top-to-bottom, so the same spec always draws the same diagram. */
export function layoutHome(parts: TakePart[]): Record<string, { x: number; y: number }> {
  const home: Record<string, { x: number; y: number }> = {};
  const n = parts.length;
  if (!n) return home;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  parts.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    home[p.id] = {
      x: 15 + ((col + 0.5) * 70) / cols,
      y: 20 + ((row + 0.5) * 48) / rows,
    };
  });
  return home;
}

/* Home from the Forge Engine's recorded placement (pos_mm, the same
 * top-down convention as the Build tab's placement map: lateral →
 * horizontal, forward → up). Returns null unless EVERY part is
 * placed — a partial placement falls back to the labelled layout
 * rather than mixing recorded and computed positions. */
function placementHome(
  parts: TakePart[],
  placement: { partId?: unknown; pos_mm?: unknown }[],
): Record<string, { x: number; y: number }> | null {
  const byId = new Map<string, [number, number, number]>();
  for (const p of placement) {
    const id = str(p?.partId);
    const pos = p?.pos_mm;
    if (id && Array.isArray(pos) && pos.length >= 2 && typeof pos[0] === 'number' && typeof pos[1] === 'number') {
      byId.set(id, [pos[0], pos[1], typeof pos[2] === 'number' ? pos[2] : 0]);
    }
  }
  if (!parts.every((p) => byId.has(p.id))) return null;
  const xs = parts.map((p) => byId.get(p.id)![1]); // lateral → x
  const ys = parts.map((p) => byId.get(p.id)![0]); // forward → y (up)
  const span = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
  const map = (v: number, vals: number[], lo: number, hi: number) =>
    span(vals) < 1e-9 ? (lo + hi) / 2 : lo + ((v - Math.min(...vals)) / span(vals)) * (hi - lo);
  const home: Record<string, { x: number; y: number }> = {};
  parts.forEach((p) => {
    const pos = byId.get(p.id)!;
    home[p.id] = {
      x: map(pos[1], xs, 15, 85),
      y: map(-pos[0], ys.map((v) => -v), 20, 68),
    };
  });
  return home;
}

function finish(parts: TakePart[], connections: TakeConnection[], source: TakeSource,
  placed: Record<string, { x: number; y: number }> | null): TakeModel {
  if (!parts.length) return { parts: [], connections: [], home: {}, homeSource: 'none', source: 'none' };
  return {
    parts,
    connections,
    home: placed ?? layoutHome(parts),
    homeSource: placed ? 'placement' : 'layout',
    source,
  };
}

export function deriveTakeApart(spec: AnySpec): TakeModel {
  const s = isObj(spec) ? spec : {};

  /* 1 — Forge Engine record. */
  const forge = isObj(s.forge) ? s.forge : null;
  const bom = Array.isArray(forge?.bom) ? forge.bom : [];
  if (forge && bom.some((b: AnySpec) => str(b?.partId))) {
    const placement = Array.isArray(forge.placement) ? forge.placement : [];
    const role = new Map<string, string>();
    for (const p of placement) if (str(p?.partId)) role.set(str(p.partId), str(p?.role));
    const parts: TakePart[] = [];
    const seen = new Set<string>();
    for (const line of bom) {
      const id = str(line?.partId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const qty = typeof line?.qty === 'number' && line.qty > 1 ? `×${line.qty}` : '';
      const detail = [role.get(id) ?? '', qty].filter(Boolean).join(' · ');
      parts.push({ id, label: role.get(id) || id, detail: detail || undefined });
    }
    const have = new Set(parts.map((p) => p.id));
    const connections: TakeConnection[] = [];
    for (const w of Array.isArray(forge.wiring) ? forge.wiring : []) {
      const fromId = str(w?.from); const toId = str(w?.to);
      if (!fromId || !toId || !have.has(fromId) || !have.has(toId)) continue;
      connections.push({ fromId, toId, detail: str(w?.connector) || str(w?.kind) });
    }
    return finish(parts, connections, 'forge', placementHome(parts, placement));
  }

  /* 2 — Owner-kept connections (spec.connections): endpoints are
   * display names, and the name is the part. */
  const conns = Array.isArray(s.connections) ? s.connections : [];
  if (conns.some((c: AnySpec) => str(c?.from) && str(c?.to))) {
    const parts: TakePart[] = [];
    const seen = new Set<string>();
    const add = (name: string) => {
      if (!seen.has(name)) { seen.add(name); parts.push({ id: name, label: name }); }
    };
    const connections: TakeConnection[] = [];
    for (const c of conns) {
      const fromId = str(c?.from); const toId = str(c?.to);
      if (!fromId || !toId) continue;
      add(fromId); add(toId);
      connections.push({ fromId, toId, detail: str(c?.detail) });
    }
    return finish(parts, connections, 'connections', null);
  }

  /* 3 — The wiring-bench record (spec.wiring). */
  const wiring = isObj(s.wiring) ? s.wiring : null;
  const nodes = Array.isArray(wiring?.nodes) ? wiring.nodes : [];
  if (wiring && nodes.some((n: AnySpec) => str(n?.id))) {
    const parts: TakePart[] = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const id = str(n?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      parts.push({ id, label: str(n?.label) || id });
    }
    const have = new Set(parts.map((p) => p.id));
    const connections: TakeConnection[] = [];
    for (const c of Array.isArray(wiring.connections) ? wiring.connections : []) {
      const fromId = str(c?.from); const toId = str(c?.to);
      if (!fromId || !toId || !have.has(fromId) || !have.has(toId)) continue;
      connections.push({ fromId, toId, detail: str(c?.label) || str(c?.kind) });
    }
    return finish(parts, connections, 'wiring', null);
  }

  /* 4 — Bare recorded component groups: free take-apart, no steps. */
  const parts: TakePart[] = [];
  if (isObj(s.battery)) {
    const detail = [str(s.battery.chemistry), typeof s.battery.voltage_v === 'number' ? `${s.battery.voltage_v} V` : '']
      .filter(Boolean).join(' · ');
    parts.push({ id: 'spec:battery', label: 'Battery', detail: detail || undefined });
  }
  if (isObj(s.motor)) {
    const count = typeof s.motor.count === 'number' && s.motor.count > 1 ? ` ×${s.motor.count}` : '';
    parts.push({ id: 'spec:motor', label: `Motor${count}`, detail: str(s.motor.kind) || undefined });
  }
  if (isObj(s.wheel) && typeof s.wheel.count === 'number' && s.wheel.count > 0) {
    parts.push({ id: 'spec:wheel', label: `Wheels ×${s.wheel.count}`, detail: s.wheel.driven ? 'driven' : undefined });
  }
  if (Array.isArray(s.sensors)) {
    s.sensors.forEach((sen: AnySpec, i: number) => {
      const kind = str(sen?.kind);
      if (!kind) return;
      parts.push({
        id: `spec:sensor:${i}:${kind}`,
        label: kind.replace(/_/g, ' '),
        detail: str(sen?.position) || undefined,
      });
    });
  }
  if (parts.length) return finish(parts, [], 'spec', null);

  /* 5 — No recorded build. */
  return { parts: [], connections: [], home: {}, homeSource: 'none', source: 'none' };
}

/* Assemble walks the recorded connections in their recorded order;
 * disassembly is the SAME steps in exact reverse — never a second,
 * separately-invented order. */
function toStep(model: TakeModel, connIdx: number, n: number, verb: TakeStep['verb']): TakeStep {
  const c = model.connections[connIdx];
  const label = (id: string) => model.parts.find((p) => p.id === id)?.label ?? id;
  const word = verb === 'connect' ? 'Connect' : 'Disconnect';
  return {
    n, total: model.connections.length, conn: connIdx, verb,
    fromId: c.fromId, toId: c.toId,
    fromLabel: label(c.fromId), toLabel: label(c.toId),
    detail: c.detail,
    text: `${word} ${label(c.fromId)} → ${label(c.toId)}${c.detail ? ` — ${c.detail}` : ''}`,
  };
}

export function assembleSteps(model: TakeModel): TakeStep[] {
  return model.connections.map((_, i) => toStep(model, i, i + 1, 'connect'));
}

export function disassembleSteps(model: TakeModel): TakeStep[] {
  return model.connections.map((_, i) => {
    const conn = model.connections.length - 1 - i;
    return toStep(model, conn, i + 1, 'disconnect');
  });
}

/* Where a part sits when it is off the robot: straight out from the
 * diagram centre, deterministic in the home position (a part exactly
 * at the centre fans out by its index, golden-angle). */
export function explodedPos(model: TakeModel, id: string): { x: number; y: number } {
  const home = model.home[id];
  if (!home) return { x: 50, y: TA_H / 2 };
  const homes = model.parts.map((p) => model.home[p.id]).filter(Boolean);
  const cx = homes.reduce((a, h) => a + h.x, 0) / (homes.length || 1);
  const cy = homes.reduce((a, h) => a + h.y, 0) / (homes.length || 1);
  let dx = home.x - cx;
  let dy = home.y - cy;
  if (Math.hypot(dx, dy) < 0.001) {
    const idx = Math.max(0, model.parts.findIndex((p) => p.id === id));
    const a = idx * 2.399963;
    dx = Math.cos(a); dy = Math.sin(a);
  }
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: clamp(home.x + (dx / len) * 30, 10, 90),
    y: clamp(home.y + (dy / len) * 30, 12, TA_H - 8),
  };
}

export function isHomeAt(pos: { x: number; y: number }, home: { x: number; y: number }): boolean {
  return Math.hypot(pos.x - home.x, pos.y - home.y) <= TA_SNAP;
}

/* A connection reads restored when BOTH ends are home — the state
 * the app can always get back to because the record never changed. */
export function restoredCount(model: TakeModel, positions: Record<string, { x: number; y: number }>): number {
  return model.connections.filter((c) => {
    const a = positions[c.fromId]; const b = positions[c.toId];
    return !!a && !!b && isHomeAt(a, model.home[c.fromId]) && isHomeAt(b, model.home[c.toId]);
  }).length;
}

/* 3D model resolution for the Build tab turntable, in the order the
 * honesty rules demand: a model that EXISTS for this robot, or none.
 *   twin  — Omega1's ProjectSim twin GLBs (the twin is Omega1's model);
 *   scan  — the owner's own attached scan/model file;
 *   stage — the site's spec-built stage (Robodex/catalogue robots
 *           carry the dimensions it is built from);
 *   none  — no model exists; the panel shows the diagram alone. */
export function resolveModelSource(input: {
  isOmega1: boolean;
  scanFormat?: string | null;
  hasDims: boolean;
}): 'twin' | 'scan' | 'stage' | 'none' {
  if (input.isOmega1) return 'twin';
  if (input.scanFormat) return 'scan';
  if (input.hasDims) return 'stage';
  return 'none';
}
