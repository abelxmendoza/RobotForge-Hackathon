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
 * says so. Robots that match a Robodex entry also get a link to that
 * entry's in-browser physics checks and — re-gated 2026-11-01 — the
 * entry's Gazebo launch-bundle section itself (the robot pages'
 * GazeboSection, built on lib/gazebo.ts exactly as they use it):
 * the bundle download for the matched entry's recorded model, or
 * that model's recorded unavailable reason (Mini Pupper: no model
 * recorded; OP3: MJCF). A build with no Robodex match gets no
 * bundle: there is no recorded model for it, and a bundle is only
 * ever built from a recorded model — never invented from the spec,
 * and never borrowed from a lookalike name. The match below is the
 * tab's existing narrow one: the spec's name, verbatim or slugified,
 * against catalogue slug/name only. */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { maxSlopeDeg, TERRAINS, type RoverCheck } from '@/lib/rover';
import { robots, physicsOf } from '@/lib/data';
import GazeboSection from '@/components/robots/GazeboSection';
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

/* The robot's side view, drawn at ONE scale from its spec: body length,
 * wheel size, belly clearance and the kerb all use the same pixels per
 * metre (ppm), sized so the body is about 110 px long. Lengths are never
 * clamped one by one; if the robot is too big or small for the scene to
 * keep that true, `exact` goes false and the scene says "not to scale"
 * instead of showing the 100 mm bar. */
interface Shape { ppm: number; bodyW: number; bodyH: number; wheelR: number; clear: number; exact: boolean }
function shapeOf(spec: Spec): Shape {
  const L = Number(spec?.length_m) || 0.3, H = Number(spec?.height_m) || 0.15;
  const gc = Math.max(0, Number(spec?.ground_clearance_m) || 0.02);
  const dia = Number(spec?.wheel?.diameter_m) || 0.06;
  const raw = 110 / L;
  const ppm = Math.min(900, Math.max(30, raw));
  const wheelR = (dia / 2) * ppm, clear = gc * ppm;
  // chassis height is drawn as a box, not a measured length; keep it visible
  const bodyH = Math.max(8, (H - gc) * 0.55 * ppm);
  const exact = ppm === raw && wheelR >= 3;
  return { ppm, bodyW: L * ppm, bodyH, wheelR: Math.max(3, wheelR), clear, exact };
}

/* 100 mm scale bar at the robot's scale, or a plain "not to scale" note. */
function ScaleBar({ shape }: { shape: Shape }) {
  if (!shape.exact) return <text x={14} y={22} className="sim-label">not to scale</text>;
  const w = 0.1 * shape.ppm;
  return (
    <g className="sim-scale" transform="translate(14 18)">
      <line x1={0} y1={0} x2={w} y2={0} /><line x1={0} y1={-4} x2={0} y2={4} /><line x1={w} y1={-4} x2={w} y2={4} />
      <text x={w + 6} y={4} className="sim-label">100 mm</text>
    </g>
  );
}

function Rover({ x, y, angle, shape, spin, tone, hot }: { x: number; y: number; angle: number; shape: Shape; spin: number; tone: string; hot?: 'fail' | 'marginal' | null }) {
  const { bodyW, bodyH, wheelR, clear } = shape;
  return (
    <g transform={`translate(${x} ${y}) rotate(${-angle})`}>
      <rect x={-bodyW / 2} y={-clear - bodyH} width={bodyW} height={bodyH} rx={5} className={'sim-body ' + tone} />
      <rect x={bodyW / 2 - 18} y={-clear - bodyH - 9} width={12} height={9} rx={2} className="sim-sensor" />
      {[-bodyW / 2 + wheelR, bodyW / 2 - wheelR].map((wx) => (
        <g key={wx} transform={`translate(${wx} ${-wheelR}) rotate(${spin})`}>
          <circle r={wheelR} className="sim-wheel" />
          <line x1={-wheelR + 3} y1={0} x2={wheelR - 3} y2={0} className="sim-spoke" />
          <line x1={0} y1={-wheelR + 3} x2={0} y2={wheelR - 3} className="sim-spoke" />
          {hot && <circle r={Math.max(3, wheelR * 0.38)} className={'sim-hub ' + hot}><title>motor near its stall torque</title></circle>}
        </g>
      ))}
    </g>
  );
}

function SlopeScene({ check, slopeDeg, shape }: { check?: RoverCheck; slopeDeg: number; shape: Shape }) {
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
        <ScaleBar shape={shape} />
        <Rover x={px} y={py} angle={slopeDeg > 45 ? 45 : slopeDeg} shape={shape} spin={spin} tone={STATUS_CLS[status]}
          hot={status === 'FAIL' && t > 0.3 ? 'fail' : status === 'MARGINAL' && t > 0 && t < 1 ? 'marginal' : null} />
      </svg>
      <figcaption>
        <strong>Slope climb</strong> <span className={'verdict ' + STATUS_CLS[status]}>{STATUS_TXT[status]}</span>
        <span className="faint">{check?.summary}</span>
        <button type="button" className="chip" onClick={play}>Replay</button>
      </figcaption>
    </figure>
  );
}

function StepScene({ check, stepM, shape }: { check?: RoverCheck; stepM: number; shape: Shape }) {
  const { wheelR } = shape;
  const status = check?.status ?? 'NOT_CHECKED';
  const [t, play] = useRun(`${status}-${stepM}`);
  const y0 = 170;
  // kerb drawn at the robot's own scale (a kerb taller than the scene is cut off at the top)
  const h = Math.min(160, Math.max(2, stepM * shape.ppm));
  const kerbX = 220;
  const front = shape.bodyW / 2; // body half-length (front wheel near the nose)
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
        <ScaleBar shape={shape} />
        <Rover x={x} y={y} angle={ang} shape={shape} spin={spin} tone={STATUS_CLS[status]} hot={status === 'FAIL' && t > 0.6 ? 'fail' : null} />
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
  const shape = shapeOf(spec);
  const crr = TERRAINS[opts.terrain] ?? TERRAINS.outdoor;
  const maxSlope = checks ? maxSlopeDeg(spec, crr) : null;
  const match = catalogMatch(spec);
  return (
    <section className="ws-pane ws-sim" aria-label="Simulate">
      <div className="ws-history-head">
        <h3>Simulate</h3>
        <p className="faint">Quick test runs worked out from this robot&apos;s spec. They are physics estimates, not a full simulator run. The robot and kerb are drawn to one scale from its spec (see the 100 mm bar); change the course or the spec and they run again.</p>
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
            <SlopeScene check={byName('rover.slope_climb')} slopeDeg={opts.slopeDeg} shape={shape} />
            <StepScene check={byName('rover.step_climb')} stepM={opts.stepM} shape={shape} />
            <BatteryScene check={byName('rover.runtime')} targetMin={opts.targetMin} />
          </div>
          <details className="g-small faint"><summary>How these are worked out</summary><ul>{checks.flatMap((c) => c.assumptions).filter((a, i, all) => all.indexOf(a) === i).map((a) => <li key={a}>{a}</li>)}</ul></details>
        </>
      )}
      {match && match.physics ? (
        <div className="ws-cards sim-more">
          <Link className="ws-card" href={`/robots/${match.slug}/#physics`}>
            <span className="ws-card-label">In-browser physics</span>
            <strong>Drop test and balance on its real model</strong>
            <span className="ws-card-go">Run the physics checks →</span>
          </Link>
        </div>
      ) : !match ? (
        <div className="ws-cards sim-more">
          <div className="ws-card">
            <span className="ws-card-label">Gazebo launch bundle</span>
            <strong>No bundle for this build</strong>
            <span className="faint g-small">This robot doesn&apos;t match a Robodex entry, so no model is recorded for it — a launch bundle is only ever built from a recorded model, never invented from the spec. To drive-test it on your own computer, export this spec, then run <code>robotforge run-gate spec.json</code> with Gazebo installed. The browser can&apos;t run Gazebo.</span>
          </div>
        </div>
      ) : null}
      {/* The Gazebo bundle offer itself: the robot pages' own
       * section, for the matched entry only. It offers the
       * lib/gazebo.ts bundle download when the entry's recorded
       * model is Gazebo-usable, and shows the recorded reason
       * instead of a button when it is not. Built locally at click
       * time, no Worker calls — the same terms as the robot pages. */}
      {match && <GazeboSection slug={match.slug} robotName={match.name} />}
    </section>
  );
}
