/* VEX competition rulebook profiles (Abel, 2026-11-10): the robot rules
 * from the current game manuals that a spec can answer, checked the
 * same way in the Workshop and in `robotforge validate`
 * (src/robotforge/vex.py mirrors this table; tests/test_vex_rules.py
 * keeps the two in step).
 *
 * Sources (2026-27 season, both manuals v0.2, released 2026-06-04):
 * - V5RC "Override": https://www.vexrobotics.com/override-manual
 * - VIQRC "Level Up": https://www.vexrobotics.com/level-up-manual
 * Game manuals change every season and between versions, so every
 * profile names its season and version, and every message says to
 * check the current manual. Rules a spec cannot answer (firmware,
 * official parts only, student-built) are listed as "check at
 * inspection", never marked as passed.
 *
 * Pure, zero imports: node runs it in the tests. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = any;

const IN = 0.0254;

export type RulebookId = 'v5rc-2026-27' | 'viqrc-2026-27';
export type Verdict = 'pass' | 'fail' | 'unknown';

export interface Rulebook {
  id: RulebookId;
  platform: 'vex_v5' | 'vex_iq';
  competition: string;
  season: string;
  game: string;
  manual: string;
  url: string;
  /** Starting size limit, metres (length = front to back). */
  size: { lengthM: number; widthM: number; heightM: number; text: string; rule: string };
  /** Total rated power of every motor on the robot (V5RC only). */
  motorPowerCapW: number | null;
  /** Rated power of the drivetrain motors (V5RC only). */
  drivePowerCapW: number | null;
  /** Number of motors on the robot (VIQRC only). */
  motorCountCap: number | null;
  airTanksCap: number;
  /** Rules a spec cannot answer: shown as things to check at inspection. */
  inspectOnly: string[];
}

export const RULEBOOKS: Record<RulebookId, Rulebook> = {
  'v5rc-2026-27': {
    id: 'v5rc-2026-27', platform: 'vex_v5', competition: 'V5RC', season: '2026-27', game: 'Override',
    manual: 'Override game manual v0.2 (2026-06-04)', url: 'https://www.vexrobotics.com/override-manual',
    size: { lengthM: 18 * IN, widthM: 18 * IN, heightM: 18 * IN, text: '18 × 18 × 18 in, licence plates included', rule: 'R3' },
    motorPowerCapW: 88, drivePowerCapW: 55, motorCountCap: null, airTanksCap: 2,
    inspectOnly: [
      'R4: two licence plates (red or blue) on opposite sides',
      'R6: one V5 Robot Brain, no other microcontrollers',
      'R12: one V5 Robot Battery',
      'R25: pneumatics charged to 100 psi at most, VEX pressure gauge fitted',
      'SG2/SG3: after the start, no wider than 24 in and no taller than 50 in',
    ],
  },
  'viqrc-2026-27': {
    id: 'viqrc-2026-27', platform: 'vex_iq', competition: 'VIQRC', season: '2026-27', game: 'Level Up',
    manual: 'Level Up game manual v0.2 (2026-06-04)', url: 'https://www.vexrobotics.com/level-up-manual',
    size: { lengthM: 20 * IN, widthM: 11 * IN, heightM: 15 * IN, text: '11 in wide × 20 in long × 15 in tall', rule: 'R3' },
    motorPowerCapW: null, drivePowerCapW: null, motorCountCap: 6, airTanksCap: 2,
    inspectOnly: [
      'R4: two licence plates on opposite sides',
      'R6: one VEX IQ Brain',
      'R10: one VEX IQ Robot Battery (or 6 AA cells)',
      'R16: at most one Air Pump',
      'SG2: always fits an 11 × 24 in footprint',
    ],
  },
};

/* Motors and air tanks each scoring mechanism adds (lib/vexBuilds.ts
 * VEX_MECHS uses the same motor counts). */
export const MECH_HARDWARE: Record<string, { motors: number; airTanks: number }> = {
  intake: { motors: 1, airTanks: 0 },
  lift: { motors: 2, airTanks: 0 },
  pneumatics: { motors: 0, airTanks: 2 },
};

/** Rated power of one motor on each platform's mechanisms. */
export const MECH_MOTOR_W: Record<Rulebook['platform'], number> = { vex_v5: 11, vex_iq: 1.4 };

export function rulebookFor(spec: Spec): Rulebook | null {
  const p = String(spec?.gearing?.platform ?? '').toLowerCase();
  return (Object.values(RULEBOOKS) as Rulebook[]).find((r) => r.platform === p) ?? null;
}

export interface RuleResult { rule: string; label: string; verdict: Verdict; detail: string }
export interface RuleReport { rulebook: Rulebook; results: RuleResult[]; ok: boolean; inspectOnly: string[] }

const r1 = (n: number) => Math.round(n * 10) / 10;
const inches = (m: number) => `${r1(m / IN)} in`;

/** Check a VEX spec against its platform's rulebook (null for non-VEX specs). */
export function rulebookCheck(spec: Spec, id?: RulebookId): RuleReport | null {
  const rb = id ? RULEBOOKS[id] : rulebookFor(spec);
  if (!rb) return null;
  const results: RuleResult[] = [];
  const mechs: string[] = Array.isArray(spec?.vex_mechanisms) ? spec.vex_mechanisms.filter((m: unknown) => typeof m === 'string' && m in MECH_HARDWARE) : [];
  const mechMotors = mechs.reduce((n, m) => n + MECH_HARDWARE[m].motors, 0);
  const tanks = mechs.reduce((n, m) => n + MECH_HARDWARE[m].airTanks, 0);
  const driveMotors = Number(spec?.motor?.count);
  const motorW = Number(spec?.gearing?.motor_power_w);

  // Starting size
  const L = Number(spec?.length_m), W = Number(spec?.width_m), H = Number(spec?.height_m);
  if ([L, W, H].every((v) => Number.isFinite(v) && v > 0)) {
    const over: string[] = [];
    if (L > rb.size.lengthM + 1e-6) over.push(`length ${inches(L)}`);
    if (W > rb.size.widthM + 1e-6) over.push(`width ${inches(W)}`);
    if (H > rb.size.heightM + 1e-6) over.push(`height ${inches(H)}`);
    results.push({ rule: rb.size.rule, label: 'Starting size', verdict: over.length ? 'fail' : 'pass',
      detail: over.length ? `Over the ${rb.size.text} limit: ${over.join(', ')}.` : `${inches(L)} long × ${inches(W)} wide × ${inches(H)} tall fits ${rb.size.text}.` });
  } else {
    results.push({ rule: rb.size.rule, label: 'Starting size', verdict: 'unknown', detail: 'The spec does not record all three sizes.' });
  }

  if (rb.drivePowerCapW != null || rb.motorPowerCapW != null) {
    if (!(driveMotors >= 0) || !(motorW > 0)) {
      results.push({ rule: 'R10', label: 'Motor power', verdict: 'unknown', detail: 'The spec does not record the drive motors’ power (gearing.motor_power_w).' });
    } else {
      const driveW = r1(driveMotors * motorW), mechW = r1(mechMotors * MECH_MOTOR_W[rb.platform]), total = r1(driveW + mechW);
      if (rb.motorPowerCapW != null) {
        results.push({ rule: 'R10', label: 'All motors', verdict: total <= rb.motorPowerCapW + 1e-9 ? 'pass' : 'fail',
          detail: `Drive ${driveW} W${mechW ? ` + mechanisms ${mechW} W` : ''} = ${total} W of ${rb.motorPowerCapW} W.` });
      }
      if (rb.drivePowerCapW != null) {
        results.push({ rule: 'R11', label: 'Drivetrain motors', verdict: driveW <= rb.drivePowerCapW + 1e-9 ? 'pass' : 'fail',
          detail: driveW <= rb.drivePowerCapW + 1e-9
            ? `${driveMotors} × ${motorW} W = ${driveW} W of ${rb.drivePowerCapW} W.`
            : `${driveMotors} × ${motorW} W = ${driveW} W, over the ${rb.drivePowerCapW} W drivetrain limit (at most ${Math.floor(rb.drivePowerCapW / motorW)} of these motors on the drive).` });
      }
    }
  }
  if (rb.motorCountCap != null) {
    if (!(driveMotors >= 0)) {
      results.push({ rule: 'R9', label: 'Motors', verdict: 'unknown', detail: 'The spec does not record the motor count.' });
    } else {
      const n = driveMotors + mechMotors;
      results.push({ rule: 'R9', label: 'Motors', verdict: n <= rb.motorCountCap ? 'pass' : 'fail',
        detail: `${driveMotors} drive${mechMotors ? ` + ${mechMotors} mechanism` : ''} = ${n} Smart Motors of ${rb.motorCountCap}, plugged in or not.` });
    }
  }
  results.push({ rule: rb.platform === 'vex_v5' ? 'R25' : 'R16', label: 'Air tanks', verdict: tanks <= rb.airTanksCap ? 'pass' : 'fail',
    detail: tanks ? `${tanks} air tanks of ${rb.airTanksCap}.` : 'No pneumatics.' });

  return { rulebook: rb, results, ok: results.every((r) => r.verdict !== 'fail'), inspectOnly: rb.inspectOnly };
}

/** One-line problems for a failed check, naming the rulebook (for Wrench and edit previews). */
export function rulebookProblems(spec: Spec): string[] {
  const rep = rulebookCheck(spec);
  if (!rep) return [];
  return rep.results.filter((r) => r.verdict === 'fail')
    .map((r) => `${rep.rulebook.competition} ${rep.rulebook.season} ${r.rule} (${r.label}): ${r.detail} Check the current game manual.`);
}
