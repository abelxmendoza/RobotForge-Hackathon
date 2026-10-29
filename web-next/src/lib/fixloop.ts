'use client';
/* The Forge loop in the browser: Muse Spark (POST /fix) proposes spec
 * changes, the browser validator decides. Mirrors
 * src/robotforge/fixloop.py; offline it falls back to the same
 * textbook rules. The model never sets the verdict. */
import { forgeValidateSpec } from '@/components/forge/validate';
import { liveHealth, postJSON, routeOn } from '@/components/forge/live';
import { getPath, setPath, type Spec } from './garage';

export const MAX_ROUNDS = 3;

const FIX_FIELDS: Record<string, 'number' | 'integer' | 'string'> = {
  length_m: 'number', width_m: 'number', height_m: 'number',
  mass_kg: 'number', ground_clearance_m: 'number',
  'wheel.diameter_m': 'number', 'wheel.width_m': 'number', 'wheel.count': 'integer',
  'motor.voltage_v': 'number', 'motor.count': 'integer',
  'motor.stall_torque_nm': 'number', 'motor.kind': 'string',
  'battery.voltage_v': 'number', 'battery.capacity_mah': 'integer', 'battery.chemistry': 'string',
};

export interface LoopChange { path: string; before: unknown; value: unknown; reason: string }
export interface LoopRound { n: number; proposer: string; live: boolean; summary: string; changes: LoopChange[]; after: string[]; errorsAfter: number }
export interface LoopResult { start: string[]; rounds: LoopRound[]; finalSpec: Spec; resolved: boolean; stop: string }

function sanitize(raw: unknown, spec: Spec): LoopChange[] {
  const out: LoopChange[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const c of raw) {
    if (out.length >= 6 || !c || typeof c !== 'object') continue;
    const path = String((c as Spec).path || '');
    const kind = FIX_FIELDS[path];
    if (!kind || seen.has(path)) continue;
    let value = (c as Spec).value;
    if (kind === 'string') {
      if (typeof value !== 'string' || !value.trim()) continue;
      value = value.trim().slice(0, 60);
    } else {
      if (typeof value === 'string') value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      if (kind === 'integer' && !Number.isInteger(value)) continue;
    }
    const before = getPath(spec, path);
    if (before === value) continue;
    seen.add(path);
    out.push({ path, before: before ?? null, value, reason: String((c as Spec).reason || '').slice(0, 300) });
  }
  return out;
}

export function rulesProposal(spec: Spec, lines: string[]) {
  const text = lines.join('\n');
  const changes: { path: string; value: unknown; reason: string }[] = [];
  const wheel = spec.wheel || {};
  if (text.includes('geometry.clearance_vs_wheel') && wheel.diameter_m) {
    changes.push({ path: 'ground_clearance_m', value: Math.round((wheel.diameter_m / 2) * 0.8 * 1000) / 1000, reason: 'clearance must sit below the wheel radius; 80% of the radius leaves room for tyre squash' });
  }
  if (text.includes('mass.budget') && text.includes('above the declared total')) {
    const total = Object.values(spec.component_mass_kg || {}).reduce((a: number, b) => a + Number(b), 0);
    changes.push({ path: 'mass_kg', value: Math.round(total * 1.05 * 100) / 100, reason: 'the declared total must cover the parts; 5% added for fasteners and wiring' });
  }
  const motorV = spec.motor && spec.motor.voltage_v;
  if (text.includes('electrical.voltage_match') && motorV) {
    const cells = Math.max(1, Math.ceil(motorV / 3.7 - 0.05));
    changes.push({ path: 'battery.voltage_v', value: Math.round(cells * 3.7 * 10) / 10, reason: `a ${cells}S pack matches the ${motorV} V motors without a converter` });
  }
  return { changes, summary: changes.length ? 'Offline rules: textbook fixes for the findings.' : 'Offline rules have no fix for these findings.' };
}

export async function runForgeLoop(spec: Spec, opts: { includeWarnings: boolean; onRound?: (r: LoopRound) => void }): Promise<LoopResult> {
  const keep = (l: string) => l.startsWith('[ERROR]') || (opts.includeWarnings && l.startsWith('[WARN]'));
  let current = JSON.parse(JSON.stringify(spec));
  let lines = forgeValidateSpec(current).lines;
  const res: LoopResult = { start: lines, rounds: [], finalSpec: current, resolved: false, stop: '' };
  if (!lines.some(keep)) {
    res.resolved = true;
    res.stop = 'nothing to fix';
    return res;
  }
  const live = routeOn(await liveHealth(), 'fix');
  for (let n = 1; n <= MAX_ROUNDS; n++) {
    const targets = lines.filter(keep);
    let doc: { changes?: unknown; summary?: string };
    let proposer = 'Muse Spark';
    let wasLive = live;
    if (live) {
      try {
        doc = await postJSON('/fix', { spec: current, findings: targets });
      } catch (e) {
        doc = rulesProposal(current, targets);
        proposer = 'offline rules (live call failed: ' + (e as Error).message + ')';
        wasLive = false;
      }
    } else {
      doc = rulesProposal(current, targets);
      proposer = 'offline rules';
    }
    const changes = sanitize(doc.changes, current);
    if (!changes.length) {
      res.stop = 'the proposer had no further valid changes';
      break;
    }
    let next = current;
    for (const c of changes) next = setPath(next, c.path, c.value);
    lines = forgeValidateSpec(next).lines;
    current = next;
    const round: LoopRound = { n, proposer, live: wasLive, summary: String(doc.summary || ''), changes, after: lines, errorsAfter: lines.filter((l) => l.startsWith('[ERROR]')).length };
    res.rounds.push(round);
    opts.onRound?.(round);
    if (!lines.some(keep)) {
      res.resolved = true;
      res.stop = `resolved in ${n} round${n > 1 ? 's' : ''}`;
      break;
    }
    if (n === MAX_ROUNDS) res.stop = `stopped after ${MAX_ROUNDS} rounds`;
  }
  res.finalSpec = current;
  return res;
}
