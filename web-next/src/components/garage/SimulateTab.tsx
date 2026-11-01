'use client';
/* Workshop "Simulate" tab (Abel, 2026-11-01): the rover field checks
 * drawn as short animated test runs, driven by the same first-order
 * physics in lib/rover.ts the Checks tab used. Every number and every
 * outcome comes from checkRover(); the drawings only act it out:
 *   - slope: the robot drives up a ramp at the chosen angle and makes
 *     it (PASS / MARGINAL, slower) or stalls and rolls back (FAIL);
 *   - step: it rolls at a kerb sized against its own wheel and climbs
 *     it or stops against it;
 *   - battery: a gauge drains over the estimated runtime against the
 *     target.
 * These are estimates from the spec, not a Gazebo run, and the copy
 * says so. Robots that match a Robodex entry also get links to that
 * entry's recorded driving test and in-browser physics checks. */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { maxSlopeDeg, TERRAINS, type RoverCheck } from '@/lib/rover';
import { robots, physicsOf } from '@/lib/data';
import type { Spec } from '@/lib/garage';

type RoverOpts = { terrain: string; slopeDeg: number; stepM: number; targetMin: number };
const RUN_MS = 3200;

const STATUS_CLS: Record<string, string> = { PASS: 'pass', MARGINAL: 'marginal', FAIL: 'fail', NOT_CHECKED: 'unchecked' };
const STATUS_TXT: Record<string, string> = { PASS: 'Makes it', MARGINAL: 'Just makes it', FAIL: "Doesn't make it", NOT_CHECKED: 'Not checked' };

function useRun(key: string): [number, () => void] {
  const [t, setT] = useState(1);
  const raf = useRef(0);
  const play = () => {
    cancelAnimationFrame(raf.current);
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setT(1); return; }
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / RUN_MS);
      setT(k);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  // replay whenever the inputs change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { play(); return () => cancelAnimationFrame(raf.current); }, [key]);
  return [t, play];
}

const ease = (x: number) => 1 - Math.pow(1 - x, 2);

/* A small side-view rover: body box on two visible wheels. */
function Rover({ x, y, angle, wheelR, spin, tone }: { x: number; y: number; angle: number; wheelR: number; spin: number; tone: string }) {
  const bodyW = 74, bodyH = 22;
  return (
    <g transform={`translate(${x} ${y}) rotate(${-angle})`}>
      <rect x={-bodyW / 2} y={-wheelR - bodyH + 4} width={bodyW} height={bodyH} rx={5} className={'sim-body ' + tone} />
      <rect x={bodyW / 2 - 18} y={-wheelR - bodyH - 6} width={12} height={10} rx={2} className="sim-sensor" />
      {[-bodyW / 2 + wheelR + 2, bodyW / 2 - wheelR - 2].map((wx) => (
        <g key={wx} transform={`translate(${wx} ${-wheelR}) rotate(${spin})`}>
          <circle r={wheelR} className="sim-wheel" />
          <line x1={-wheelR + 3} y1={0} x2={wheelR - 3} y2={0} className="sim-spoke" />
          <line x1={0} y1={-wheelR + 3} x2={0} y2={wheelR - 3} className="sim-spoke" />
        </g>
      ))}
    </g>
  );
}

function SlopeScene({ check, slopeDeg, wheelR }: { check?: RoverCheck; slopeDeg: number; wheelR: number }) {
  const status = check?.status ?? 'NOT_CHECKED';
  const [t, play] = useRun(`${status}-${slopeDeg}`);
  const a = Math.min(Math.max(slopeDeg, 0), 45) * Math.PI / 180;
  const x0 = 30, y0 = 170, len = 300;
  const x1 = x0 + len * Math.cos(a), y1 = y0 - len * Math.sin(a);
  // progress along the ramp (0..1)
  let s: number;
  if (status === 'PASS') s = 0.08 + 0.82 * ease(t);
  else if (status === 'MARGINAL') s = 0.08 + 0.82 * t;
  else if (status === 'FAIL') s = t < 0.55 ? 0.08 + 0.4 * ease(t / 0.55) : 0.48 - 0.4 * ease((t - 0.55) / 0.45);
  else s = 0.08;
  const px = x0 + len * s * Math.cos(a), py = y0 - len * s * Math.sin(a);
  const spin = status === 'NOT_CHECKED' ? 0 : t * (status === 'FAIL' ? 1400 : 700);
  return (
    <figure className="sim-scene">
      <svg viewBox="0 0 380 200" role="img" aria-label={`Slope climb at ${slopeDeg} degrees: ${STATUS_TXT[status]}`}>
        <polygon points={`${x0},${y0} ${x1},${y1} ${x1},${y0}`} className="sim-ground" />
        <line x1={0} y1={y0} x2={380} y2={y0} className="sim-floor" />
        <path d={`M ${x0 + 46} ${y0} A 46 46 0 0 0 ${x0 + 46 * Math.cos(a)} ${y0 - 46 * Math.sin(a)}`} className="sim-angle" />
        <text x={x0 + 54} y={y0 - 8} className="sim-label">{slopeDeg}°</text>
        {status === 'FAIL' && t > 0.5 && t < 0.75 && <text x={px} y={py - 48} className="sim-label sim-warn" textAnchor="middle">wheels slip</text>}
        <Rover x={px} y={py} angle={slopeDeg > 45 ? 45 : slopeDeg} wheelR={wheelR} spin={spin} tone={STATUS_CLS[status]} />
      </svg>
      <figcaption>
        <strong>Slope climb</strong> <span className={'verdict ' + STATUS_CLS[status]}>{STATUS_TXT[status]}</span>
        <span className="faint">{check?.summary}</span>
        <button type="button" className="chip" onClick={play}>Replay</button>
      </figcaption>
    </figure>
  );
}

function StepScene({ check, stepM, wheelDiaM, wheelR }: { check?: RoverCheck; stepM: number; wheelDiaM: number; wheelR: number }) {
  const status = check?.status ?? 'NOT_CHECKED';
  const [t, play] = useRun(`${status}-${stepM}`);
  const y0 = 170;
  // kerb height drawn against the wheel: same scale as the wheel radius
  const scale = wheelDiaM > 0 ? (wheelR * 2) / wheelDiaM : 0;
  const h = Math.min(90, Math.max(4, stepM * scale));
  const kerbX = 220;
  const front = 74 / 2; // body half-length (front wheel near the nose)
  let x: number, y = y0, ang = 0;
  const stopX = kerbX - front + wheelR * 0.4;
  if (status === 'PASS' || status === 'MARGINAL') {
    const k = status === 'PASS' ? ease(t) : t;
    x = 60 + k * 270;
    if (x + front > kerbX && x - front < kerbX) { const f = (x + front - kerbX) / (front * 2); ang = Math.sin(f * Math.PI) * 14; y = y0 - h * f; }
    else if (x - front >= kerbX) y = y0 - h;
  } else if (status === 'FAIL') {
    x = Math.min(60 + ease(Math.min(1, t / 0.6)) * 200, stopX);
    if (t > 0.6) x -= Math.sin((t - 0.6) * 18) * 2 * (1 - t);
  } else x = 60;
  const spin = status === 'NOT_CHECKED' ? 0 : t * 900;
  return (
    <figure className="sim-scene">
      <svg viewBox="0 0 380 200" role="img" aria-label={`Step climb over ${Math.round(stepM * 1000)} millimetres: ${STATUS_TXT[status]}`}>
        <line x1={0} y1={y0} x2={kerbX} y2={y0} className="sim-floor" />
        <polygon points={`${kerbX},${y0} ${kerbX},${y0 - h} 380,${y0 - h} 380,200 ${kerbX},200`} className="sim-ground" />
        <text x={kerbX + 8} y={y0 - h / 2 + 4} className="sim-label">{Math.round(stepM * 1000)} mm</text>
        {status === 'FAIL' && t > 0.6 && <text x={stopX} y={y0 - 60} className="sim-label sim-warn" textAnchor="middle">can&apos;t climb it</text>}
        <Rover x={x} y={y} angle={ang} wheelR={wheelR} spin={spin} tone={STATUS_CLS[status]} />
      </svg>
      <figcaption>
        <strong>Step climb</strong> <span className={'verdict ' + STATUS_CLS[status]}>{STATUS_TXT[status]}</span>
        <span className="faint">{check?.summary}</span>
        <button type="button" className="chip" onClick={play}>Replay</button>
      </figcaption>
    </figure>
  );
}

function BatteryScene({ check, targetMin }: { check?: RoverCheck; targetMin: number }) {
  const status = check?.status ?? 'NOT_CHECKED';
  const [t, play] = useRun(`${status}-${check?.value}-${targetMin}`);
  const minutes = typeof check?.value === 'number' ? check.value : 0;
  const span = Math.max(minutes, targetMin) * 1.15 || 1;
  const W = 300;
  const shown = minutes * t;
  const level = minutes > 0 ? Math.max(0, 1 - shown / minutes) : 0;
  return (
    <figure className="sim-scene">
      <svg viewBox="0 0 380 200" role="img" aria-label={`Battery runtime about ${Math.round(minutes)} minutes against a ${targetMin} minute target: ${STATUS_TXT[status]}`}>
        <rect x={40} y={50} width={110} height={56} rx={8} className="sim-batt" />
        <rect x={150} y={68} width={8} height={20} rx={2} className="sim-batt" />
        <rect x={46} y={56} width={98 * level} height={44} rx={4} className={'sim-charge ' + STATUS_CLS[status]} />
        <text x={95} y={84} textAnchor="middle" className="sim-label sim-big">{Math.round(shown)} min</text>
        <line x1={40} y1={150} x2={40 + W} y2={150} className="sim-floor" />
        <rect x={40} y={144} width={W * (shown / span)} height={12} rx={6} className={'sim-charge ' + STATUS_CLS[status]} />
        <line x1={40 + W * (targetMin / span)} y1={134} x2={40 + W * (targetMin / span)} y2={166} className="sim-target" />
        <text x={40 + W * (targetMin / span)} y={128} textAnchor="middle" className="sim-label">target {targetMin} min</text>
      </svg>
      <figcaption>
        <strong>Battery runtime</strong> <span className={'verdict ' + STATUS_CLS[status]}>{STATUS_TXT[status]}</span>
        <span className="faint">{check?.summary}</span>
        <button type="button" className="chip" onClick={play}>Replay</button>
      </figcaption>
    </figure>
  );
}

/* The Robodex entry this robot came from, matched by name. */
function catalogMatch(spec: Spec): { slug: string; name: string; physics: boolean } | null {
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const n = norm(spec?.name);
  if (!n) return null;
  const hit = robots.find((r) => r.slug && (norm(r.slug) === n || norm(r.name) === n));
  return hit?.slug ? { slug: hit.slug, name: hit.name, physics: Boolean(physicsOf(hit.slug)) } : null;
}

export default function SimulateTab({ spec, checks, opts, setOpts }: {
  spec: Spec;
  checks: RoverCheck[] | null;
  opts: RoverOpts;
  setOpts: (o: RoverOpts) => void;
}) {
  const byName = (n: string) => checks?.find((c) => c.name === n);
  const wheelDia = Number(spec?.wheel?.diameter_m) || 0;
  const wheelR = Math.max(8, Math.min(22, wheelDia * 160));
  const crr = TERRAINS[opts.terrain] ?? TERRAINS.outdoor;
  const maxSlope = checks ? maxSlopeDeg(spec, crr) : null;
  const match = catalogMatch(spec);
  return (
    <section className="ws-pane ws-sim" aria-label="Simulate">
      <div className="ws-history-head">
        <h3>Simulate</h3>
        <p className="faint">Quick test runs worked out from this robot&apos;s spec. They are physics estimates, not a full simulator run: change the course or the spec and they run again.</p>
      </div>
      {!checks ? (
        <p className="faint">The test runs need a ground robot with wheels, motors and a battery in its spec. This one doesn&apos;t have all three yet; add them in Specs.</p>
      ) : (
        <>
          <div className="g-rover-opts sim-opts">
            <label className="g-field"><span>Terrain</span>
              <select value={opts.terrain} onChange={(e) => setOpts({ ...opts, terrain: e.target.value })}>
                {Object.keys(TERRAINS).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="g-field"><span>Slope <em>°</em></span><input type="number" min={0} max={60} value={opts.slopeDeg} onChange={(e) => setOpts({ ...opts, slopeDeg: Number(e.target.value) || 0 })} /></label>
            <label className="g-field"><span>Step <em>mm</em></span><input type="number" min={0} value={Math.round(opts.stepM * 1000)} onChange={(e) => setOpts({ ...opts, stepM: (Number(e.target.value) || 0) / 1000 })} /></label>
            <label className="g-field"><span>Runtime target <em>min</em></span><input type="number" min={1} value={opts.targetMin} onChange={(e) => setOpts({ ...opts, targetMin: Number(e.target.value) || 1 })} /></label>
          </div>
          {maxSlope != null && <p className="g-small faint">Steepest slope this robot can hold on {opts.terrain}: about {Math.round(maxSlope)}°.</p>}
          <div className="sim-grid">
            <SlopeScene check={byName('rover.slope_climb')} slopeDeg={opts.slopeDeg} wheelR={wheelR} />
            <StepScene check={byName('rover.step_climb')} stepM={opts.stepM} wheelDiaM={wheelDia} wheelR={wheelR} />
            <BatteryScene check={byName('rover.runtime')} targetMin={opts.targetMin} />
          </div>
          <details className="g-small faint"><summary>How these are worked out</summary><ul>{checks.flatMap((c) => c.assumptions).filter((a, i, all) => all.indexOf(a) === i).map((a) => <li key={a}>{a}</li>)}</ul></details>
        </>
      )}
      <div className="ws-cards sim-more">
        {match ? (
          <>
            <Link className="ws-card" href={`/robots/${match.slug}/`}>
              <span className="ws-card-label">Driving test (Gazebo)</span>
              <strong>{match.name}&apos;s recorded run</strong>
              <span className="ws-card-go">Open its robot page →</span>
            </Link>
            {match.physics && (
              <Link className="ws-card" href={`/robots/${match.slug}/#physics`}>
                <span className="ws-card-label">In-browser physics</span>
                <strong>Drop test and balance on its real model</strong>
                <span className="ws-card-go">Run the physics checks →</span>
              </Link>
            )}
          </>
        ) : (
          <div className="ws-card">
            <span className="ws-card-label">Driving test (Gazebo)</span>
            <strong>Runs on your own computer</strong>
            <span className="faint g-small">Export this spec, then run <code>robotforge run-gate spec.json</code> with Gazebo installed. The browser can&apos;t run Gazebo.</span>
          </div>
        )}
      </div>
    </section>
  );
}
