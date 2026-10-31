/* Broken -> fixed replay model.
 *
 * One input, t in [0, 1]: 0 is the broken spec as loaded, 1 is the spec
 * the checks accepted. Every mesh, glow and readout on the Demo page's
 * 3D replay is a pure function of (before, after, beforeLines,
 * afterLines, t), so the picture and the numbers can't drift apart.
 *
 * Only the two ends are real designs that the checks ran on. The frames
 * in between interpolate the numeric spec fields for illustration, and
 * the page says so. Fault glows come from the validator's own check
 * codes on each end, never from the interpolated values. */
import type { RobotSpec } from '@/components/forge/model';
import { PLATE_T, taBuildParts, taGeom3d, type TaUnit } from '@/components/kit/takeapart';
import type { Spec } from './garage';

/* Which parts a failing check points at. Codes are validate.ts's. */
export const FAULT_PARTS: Record<string, string[]> = {
  'geometry.clearance_vs_wheel': ['plate', 'wheel', 'caster', 'mount'],
  'electrical.voltage_match': ['battery', 'mount'],
  'mass.budget': ['battery', 'plate'],
};

/* Battery block size and spot on the deck: kit assumption for the
 * picture (the spec gives voltage and capacity, not a footprint). */
export const BATTERY_BOX: [number, number, number] = [0.10, 0.065, 0.032];

export function faultCodes(lines: string[]): string[] {
  const out = new Set<string>();
  for (const l of lines) {
    const m = /^\[(ERROR|WARN)\] ([a-z_.]+):/.exec(l);
    if (m && FAULT_PARTS[m[2]]) out.add(m[2]);
  }
  return [...out];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* Deep-lerp every finite number two specs share; anything else snaps
 * to whichever end t is nearer. */
export function lerpSpec(a: Spec, b: Spec, t: number): Spec {
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => lerpSpec(x, b[i], t));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out[k] = k in a && k in b ? lerpSpec(a[k], b[k], t) : t < 0.5 ? a[k] : b[k];
    }
    return out;
  }
  return t < 0.5 ? a : b;
}

export interface ReplayUnit extends TaUnit {
  glow: number; // 0..1, how strongly this part shows a fault at t
}

export interface Readout {
  id: string;
  label: string;
  value: string;
  limit: string;
  ok: boolean;
  frac: number; // 0..1 fill for the bar
  band: [number, number]; // the passing range, same 0..1 scale
}

export interface ReplayPose {
  spec: Spec;
  units: ReplayUnit[];
  readouts: Readout[];
  endpoint: 'broken' | 'fixed' | null;
}

function batteryUnit(spec: RobotSpec): TaUnit {
  const C = spec.ground_clearance_m ?? 0;
  const [bx, by, bz] = BATTERY_BOX;
  return {
    part: 'battery',
    explode: [0, 0, 0.6],
    meshes: [{ kind: 'box', size: [bx, by, bz], center: [-spec.length_m * 0.18, 0, C + PLATE_T + bz / 2] }],
  };
}

export function replayUnits(spec: Spec): TaUnit[] {
  const s = spec as RobotSpec;
  const built = taBuildParts(s);
  const units = taGeom3d(s, built.parts, built.pos);
  if (!units.some((u) => u.part === 'battery') && s.battery) units.push(batteryUnit(s));
  return units;
}

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

export function replayPose(before: Spec, after: Spec, beforeLines: string[], afterLines: string[], t: number): ReplayPose {
  const tt = Math.min(1, Math.max(0, t));
  const spec = lerpSpec(before, after, tt);
  const fb = new Set(faultCodes(beforeLines));
  const fa = new Set(faultCodes(afterLines));
  const glowFor = (part: string) => {
    let g = 0;
    for (const c of fb) if (FAULT_PARTS[c].includes(part)) g = Math.max(g, fa.has(c) ? 1 : 1 - tt);
    for (const c of fa) if (FAULT_PARTS[c].includes(part)) g = Math.max(g, fb.has(c) ? 1 : tt);
    return g;
  };
  const units: ReplayUnit[] = replayUnits(spec).map((u) => ({ ...u, glow: glowFor(u.part) }));

  /* Readouts use the same rules as validate.ts, applied to the frame's
   * numbers, so a bar turns green exactly where the rule would pass. */
  const readouts: Readout[] = [];
  const bV = Number(spec.battery?.voltage_v);
  const mV = Number(spec.motor?.voltage_v);
  if (Number.isFinite(bV) && Number.isFinite(mV) && bV > 0) {
    const ok = !(mV > bV * 1.05) && !(mV < bV * 0.5);
    readouts.push({
      id: 'volts',
      label: 'Battery vs motors',
      value: `${fmt(bV)} V battery`,
      limit: `motors ${fmt(mV)} V · pass band ${fmt(mV / 1.05)}–${fmt(mV * 2)} V`,
      ok,
      frac: Math.min(1, bV / (mV * 2.4)),
      band: [1 / (1.05 * 2.4), 2 / 2.4],
    });
  }
  const C = Number(spec.ground_clearance_m);
  const r = Number(spec.wheel?.diameter_m) / 2;
  if (Number.isFinite(C) && Number.isFinite(r) && r > 0) {
    readouts.push({
      id: 'clearance',
      label: 'Ground clearance',
      value: `${fmt(C * 100)} cm`,
      limit: `must not exceed the wheel radius, ${fmt(r * 100)} cm`,
      ok: !(C > r),
      frac: Math.min(1, C / (r * 1.5)),
      band: [0, 1 / 1.5],
    });
  }
  return { spec, units, readouts, endpoint: tt <= 0.001 ? 'broken' : tt >= 0.999 ? 'fixed' : null };
}

/* Ease used by the Play button: slow out of the broken pose, slow into the fixed one. */
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
