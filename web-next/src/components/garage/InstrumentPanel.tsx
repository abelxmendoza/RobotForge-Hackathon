'use client';
/* Instrument panel (Abel picked the "instrument panel" look, 2026-11-11).
 *
 * Two pieces, both drawn only from numbers the Workshop already has:
 *  - HealthGauges: dial gauges on the Overview. One for the engineering
 *    checks (the validator's verdict), one per rover check (slope, step,
 *    runtime) with the needle at the computed value and a tick at the
 *    target, and one for how many recorded numbers are measured rather
 *    than estimated.
 *  - TestRun: the Test tab's checks as stations on one track, so a
 *    run reads at a glance before the detailed list.
 * Nothing here computes a new result. A check that could not run says
 * NOT CHECKED and keeps an empty dial. */
import type { ReactNode } from 'react';
import type { RoverCheck } from '@/lib/rover';

type Tone = 'pass' | 'marginal' | 'fail' | 'norun';

const ROVER_LABEL: Record<string, string> = {
  'rover.slope_climb': 'Slope',
  'rover.step_climb': 'Step',
  'rover.runtime': 'Runtime',
};

const toneOf = (status: RoverCheck['status']): Tone =>
  status === 'PASS' ? 'pass' : status === 'MARGINAL' ? 'marginal' : status === 'FAIL' ? 'fail' : 'norun';

const toneWord: Record<Tone, string> = { pass: 'Pass', marginal: 'Marginal', fail: 'Fail', norun: 'Not checked' };

export interface RoverTargets { slopeDeg: number; stepM: number; targetMin: number }

/* The value and target of a rover check in display units. */
function roverReading(c: RoverCheck, t: RoverTargets): { value: number | null; target: number; unit: string } {
  if (c.name === 'rover.slope_climb') return { value: c.value, target: t.slopeDeg, unit: '°' };
  if (c.name === 'rover.step_climb') return { value: c.value == null ? null : Math.round(c.value * 1000), target: Math.round(t.stepM * 1000), unit: 'mm' };
  return { value: c.value == null ? null : Math.round(c.value), target: t.targetMin, unit: 'min' };
}

/* A 240° dial. `fill` and `tick` are 0..1 along the arc. */
function Dial({ fill, tick, tone, children, label, sub, title }: { fill: number; tick?: number; tone: Tone; children: ReactNode; label: string; sub: string; title?: string }) {
  const R = 40, C = 50, SWEEP = 240, START = 150;
  const pt = (f: number, r = R) => {
    const a = ((START + SWEEP * f) * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const arc = (f: number) => {
    const [x0, y0] = pt(0);
    const [x1, y1] = pt(f);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${SWEEP * f > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const f = Math.max(0, Math.min(1, fill));
  const ticks = Array.from({ length: 13 }, (_, i) => i / 12);
  return (
    <figure className={`ip-dial ${tone}`} title={title}>
      <svg viewBox="0 0 100 92" aria-hidden="true">
        {ticks.map((t) => {
          const [x0, y0] = pt(t, R + 6);
          const [x1, y1] = pt(t, R + (Math.round(t * 12) % 3 === 0 ? 10 : 8));
          return <line key={t} className="ip-tick" x1={x0} y1={y0} x2={x1} y2={y1} />;
        })}
        <path className="ip-track" d={arc(1)} />
        {f > 0.001 && <path className="ip-fill" d={arc(f)} />}
        {tick != null && (() => {
          const [x0, y0] = pt(Math.min(1, tick), R - 7);
          const [x1, y1] = pt(Math.min(1, tick), R + 7);
          return <line className="ip-target" x1={x0} y1={y0} x2={x1} y2={y1} />;
        })()}
      </svg>
      <div className="ip-read">{children}</div>
      <figcaption>
        <span className="ip-label">{label}</span>
        <span className="ip-sub">{sub}</span>
      </figcaption>
    </figure>
  );
}

export function HealthGauges({ verdict, roverChecks, targets, measured, recorded }: {
  verdict: { cls: string; label: string };
  roverChecks: RoverCheck[] | null;
  targets: RoverTargets;
  /* recorded numbers not guessed from a photo, out of `recorded` */
  measured: number;
  recorded: number;
}) {
  const vTone = (verdict.cls === 'pass' || verdict.cls === 'marginal' || verdict.cls === 'fail' ? verdict.cls : 'norun') as Tone;
  return (
    <section className="ip-panel" aria-label="Robot health">
      <div className="ip-head">
        <span className="eyebrow">Health</span>
        <span className="ip-note">Computed from the spec · not a physical test</span>
      </div>
      <div className="ip-dials">
        <Dial fill={1} tone={vTone} label="Checks" sub={verdict.label}>
          <strong>{vTone === 'pass' ? 'OK' : verdict.label.split(' ')[0]}</strong>
        </Dial>
        {(roverChecks ?? []).map((c) => {
          const tone = toneOf(c.status);
          const { value, target, unit } = roverReading(c, targets);
          /* Scale runs 0 → 2× target; the tick marks the target. */
          const span = target * 2 || 1;
          return (
            <Dial key={c.name} fill={value == null ? 0 : value / span} tick={0.5} tone={tone}
              label={c.name === 'rover.slope_climb' ? 'Steepest slope' : c.name === 'rover.step_climb' ? 'Tallest step' : 'Runtime'} title={c.summary}
              sub={value == null ? 'Not checked · needs data' : `${toneWord[tone]} · target ${target}${unit === '°' ? '°' : ' ' + unit}`}>
              <strong>{value == null ? '—' : value}{value != null && <span className="ip-unit">{unit}</span>}</strong>
            </Dial>
          );
        })}
        <Dial fill={recorded ? measured / recorded : 0} tone={recorded && measured === recorded ? 'pass' : 'marginal'} label="Numbers" sub={recorded ? `${recorded - measured} guessed from a photo` : 'none recorded yet'}
          title="Spec numbers you typed or imported, out of all recorded ones. The rest were estimated from a photo and still need a measurement.">
          <strong>{measured}<span className="ip-unit">/{recorded}</span></strong>
        </Dial>
      </div>
    </section>
  );
}

export function TestRun({ verdict, roverChecks, targets }: {
  verdict: { cls: string; label: string };
  roverChecks: RoverCheck[] | null;
  targets: RoverTargets;
}) {
  const stations: { key: string; label: string; tone: Tone; reading: string }[] = [
    {
      key: 'spec',
      label: 'Spec checks',
      tone: (['pass', 'marginal', 'fail'].includes(verdict.cls) ? verdict.cls : 'norun') as Tone,
      reading: verdict.label,
    },
    ...(roverChecks ?? []).map((c) => {
      const { value, target, unit } = roverReading(c, targets);
      const u = unit === '°' ? '°' : ' ' + unit;
      return {
        key: c.name,
        label: ROVER_LABEL[c.name] ?? c.name,
        tone: toneOf(c.status),
        reading: value == null ? 'not checked' : `${value}${u} vs ${target}${u}`,
      };
    }),
  ];
  const passed = stations.filter((s) => s.tone === 'pass').length;
  return (
    <section className="ip-run" aria-label="Test run">
      <div className="ip-head">
        <span className="eyebrow">Test run</span>
        <span className="ip-note"><b>{passed}</b>/{stations.length} pass · calculated from your specs</span>
      </div>
      <ol className="ip-track-line">
        {stations.map((s, i) => (
          <li key={s.key} className={s.tone}>
            <span className="ip-station" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <span className="ip-st-label">{s.label}</span>
            <span className="ip-st-read">{s.reading}</span>
            <span className="ip-st-tone">{toneWord[s.tone]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
