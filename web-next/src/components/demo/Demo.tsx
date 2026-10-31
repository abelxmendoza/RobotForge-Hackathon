'use client';
/* The one-click demo: one robot, one story, start to finish.
 *
 *   broken robot → engineering checks catch it → Muse Spark proposes a
 *   fix → the checks decide → rover field checks → simulation evidence
 *
 * Reworked 2026-10-30 at Abel's direction ("the demo is bad, it needs a
 * whole reworking"): the old page was six stacked panels that sat empty
 * saying "Waiting for step N" until the run finished. Now:
 *   - a tracker across the top shows the five stages and where you are;
 *   - before the run, one story card explains what will happen — no
 *     empty panels;
 *   - during the run, only stages that have actually been reached are
 *     shown, the current one open, finished ones collapsed to a summary
 *     line you can reopen;
 *   - the finish is a verdict banner (errors before → after, changes,
 *     rover checks) instead of making the reader piece it together;
 *   - the evidence stage says up front that its recorded run is the
 *     ORIGINAL un-broken rover, not a run of the fix.
 *
 * Every step is computed here in the browser except the Muse Spark
 * proposal (live when the endpoint is up, offline textbook rules when
 * it is not, and the banner says which) and the Gazebo evidence, which
 * is a recorded run and is labelled RECORDED. */
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { assetPath } from '@/components/home/asset';
import { forgeValidateSpec } from '@/components/forge/validate';
import { Findings } from '@/components/forge/shared';
import { ModeBanner, useLiveMode } from '@/components/shell/LiveStatus';
import { LoopView, RoverTable } from '@/components/garage/Garage';
import { runForgeLoop, type LoopResult, type LoopRound } from '@/lib/fixloop';
import { checkRover, type RoverCheck } from '@/lib/rover';
import { diffSpecs, fmtValue, GARAGE_KEY, type GarageRobot, type Spec } from '@/lib/garage';
import { readStore, uid, writeStore } from '@/lib/store';
import { gateReports } from '@/lib/data';
import Term from '@/components/shell/Term';

const FixReplay3D = dynamic(() => import('./FixReplay3D'), { ssr: false, loading: () => <p className="faint">Loading the 3D replay…</p> });

/* The robot the demo runs. Omega1 takes this slot once its measured
 * spec is in the repo; until then a repo rover with two real-world
 * build mistakes stands in, and the page says so. */
export const DEMO = {
  specFile: 'examples/broken-indoor-rover.json',
  displayName: 'Indoor Delivery Rover',
  standInFor: 'Omega1',
  story:
    'A small indoor rover with two mistakes that happen in real builds: a 24 V battery on 11.1 V motors, and a chassis set higher than its wheels can lift it.',
  evidenceRun: 'r5-rover',
  evidenceNote:
    'This is a recorded Gazebo run of the original, un-broken Indoor Delivery Rover — the robot this broken copy was made from. It is NOT a run of the repaired spec above. Run robotforge gate on the repaired spec for its own report.',
};

type Stage = 'idle' | 'loading' | 'running' | 'done' | 'error';

const ROVER_OPTS = { terrain: 'indoor', slopeDeg: 10, stepM: 0.01, targetMin: 60 };

const passCount = (checks: RoverCheck[] | null) =>
  checks ? checks.filter((c) => c.status === 'PASS').length : 0;

export default function Demo() {
  const lm = useLiveMode('fix', 'mock');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const [broken, setBroken] = useState<Spec | null>(null);
  const [before, setBefore] = useState<string[]>([]);
  const [rounds, setRounds] = useState<LoopRound[]>([]);
  const [loop, setLoop] = useState<LoopResult | null>(null);
  const [saved, setSaved] = useState('');
  const runRef = useRef(0);

  const run = async () => {
    const token = ++runRef.current;
    const mine = () => runRef.current === token;
    setStage('loading');
    setError('');
    setRounds([]);
    setLoop(null);
    setSaved('');
    try {
      const r = await fetch(assetPath(DEMO.specFile));
      if (!r.ok) throw new Error('the demo robot could not be loaded (HTTP ' + r.status + ')');
      const spec = (await r.json()) as Spec;
      if (!mine()) return;
      setBroken(spec);
      setBefore(forgeValidateSpec(spec).lines);
      setStage('running');
      const res = await runForgeLoop(spec, {
        includeWarnings: true,
        onRound: (x) => { if (mine()) setRounds((all) => [...all, x]); },
      });
      if (!mine()) return;
      const failed = res.rounds.find((x) => x.proposer.includes('live call failed'));
      if (failed) lm.noteFailure(new Error(failed.proposer.replace(/^.*live call failed: /, '').replace(/\)$/, '')));
      else if (res.rounds.some((x) => x.live)) lm.noteSuccess();
      setLoop(res);
      setStage('done');
    } catch (e) {
      if (!mine()) return;
      setError((e as Error).message);
      setStage('error');
    }
  };

  const saveToGarage = () => {
    if (!broken || !loop) return;
    const now = new Date().toISOString();
    const robots = readStore<GarageRobot[]>(GARAGE_KEY, []);
    const robot: GarageRobot = {
      id: uid('robot'),
      name: loop.finalSpec.name || DEMO.displayName,
      createdAt: now,
      versions: [
        { id: uid('v'), label: 'Baseline (broken)', note: DEMO.story, source: 'starter', createdAt: now, spec: broken },
        { id: uid('v'), label: 'Forge loop fix', note: 'Changes: ' + diffSpecs(broken, loop.finalSpec).map((d) => d.path).join(', '), source: 'muse-fix', createdAt: now, spec: loop.finalSpec },
      ],
    };
    const err = writeStore(GARAGE_KEY, [...robots, robot]);
    setSaved(err ? 'Couldn’t save: ' + err : 'Saved to My robots with both versions.');
  };

  const after = loop ? forgeValidateSpec(loop.finalSpec).lines : [];
  const errorsBefore = before.filter((l) => l.startsWith('[ERROR]')).length;
  const warnsBefore = before.filter((l) => l.startsWith('[WARN]')).length;
  const errorsAfter = after.filter((l) => l.startsWith('[ERROR]')).length;
  const diff = broken && loop ? diffSpecs(broken, loop.finalSpec) : [];
  const roverBefore: RoverCheck[] | null = broken ? checkRover(broken, ROVER_OPTS).checks : null;
  const roverAfter: RoverCheck[] | null = loop ? checkRover(loop.finalSpec, ROVER_OPTS).checks : null;
  const evidence = gateReports.find((x) => x.id === DEMO.evidenceRun);
  const evDoc = evidence?.doc as unknown as { verdict: string; checks: { name: string; error: number; unit: string; verdict: string }[] } | undefined;

  /* Stage model for the tracker + panels. A stage is only rendered once
   * it has actually been reached; the latest reached stage stays open. */
  const reached = [
    !!broken,
    before.length > 0,
    stage === 'running' || rounds.length > 0 || !!loop,
    !!loop,
    !!loop && !!evDoc,
  ];
  const current = reached.lastIndexOf(true);
  const STAGE_LABELS = [
    'The broken robot',
    'Checks catch it',
    'Spark proposes a fix',
    'The checks decide',
    'Recorded evidence',
  ];

  const panel = (
    idx: number,
    title: ReactNode,
    summaryLine: string,
    body: ReactNode,
  ) =>
    reached[idx] ? (
      <details key={idx} className="demo-panel" open={idx === current || undefined}>
        <summary>
          <span className="n">{idx + 1}</span>
          <span className="demo-panel-title">{title}</span>
          <span className="demo-panel-sum">{summaryLine}</span>
        </summary>
        <div className="demo-panel-body">{body}</div>
      </details>
    ) : null;

  return (
    <div className="demo">
      <ModeBanner mode={lm.mode} reason={lm.reason}>
        {lm.mode === 'mock' ? 'Step 3 uses offline textbook rules instead of Muse Spark; every other step is identical.' : null}
      </ModeBanner>

      <ol className="demo-tracker" aria-label="Demo stages">
        {STAGE_LABELS.map((label, i) => (
          <li
            key={label}
            className={reached[i] ? (i === current && (stage === 'running' || stage === 'loading') ? 'current' : 'done') : ''}
            aria-current={i === current && stage !== 'done' ? 'step' : undefined}
          >
            <span className="n">{reached[i] ? '✓' : i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {stage === 'idle' ? (
        <div className="demo-intro">
          <h2>{DEMO.displayName}, broken on purpose</h2>
          <p>{DEMO.story}</p>
          <p className="faint g-small">
            Stand-in: this slot is for {DEMO.standInFor}. It switches to {DEMO.standInFor}’s
            real measured spec once that is in the repo.
          </p>
          <ol className="demo-intro-list">
            <li>The engineering checks find both mistakes — no AI involved.</li>
            <li>Muse Spark proposes a fix, changing only allow-listed fields.</li>
            <li>The same checks decide whether the fix holds. The model proposes; it never decides.</li>
          </ol>
          <div className="demo-start">
            <button type="button" className="btn btn-primary" onClick={run}>
              Run the demo
            </button>
            <span className="faint">About a minute with live Muse Spark, a second offline. Nothing you do here leaves your browser except the fix request.</span>
          </div>
        </div>
      ) : (
        <div className="demo-start">
          <button type="button" className="btn btn-primary" onClick={run} disabled={stage === 'loading' || stage === 'running'}>
            {stage === 'done' || stage === 'error' ? 'Run it again' : 'Running…'}
          </button>
          <span className="faint">Nothing you do here leaves your browser except the fix request.</span>
        </div>
      )}
      {error && <p className="g-error" role="alert">{error}</p>}

      {loop && (
        <div className={'demo-verdict ' + (loop.resolved ? 'pass' : 'fail')} role="status">
          <strong>
            {loop.resolved
              ? `Fixed: ${errorsBefore} errors → ${errorsAfter} errors`
              : `Not fully fixed: ${errorsBefore} errors → ${errorsAfter} errors`}
          </strong>
          <span>
            {diff.length} change{diff.length === 1 ? '' : 's'} applied · rover field checks{' '}
            {passCount(roverBefore)}/{roverBefore?.length ?? 0} → {passCount(roverAfter)}/{roverAfter?.length ?? 0} passing
            {!loop.resolved && <> · the loop stopped: {loop.stop}</>}
          </span>
        </div>
      )}

      {broken && before.length > 0 && (
        <FixReplay3D
          before={broken}
          after={loop ? loop.finalSpec : null}
          beforeLines={before}
          afterLines={after}
          autoplay
        />
      )}

      <div className="demo-panels">
        {panel(
          0,
          'The broken robot',
          broken ? `${DEMO.displayName} — the spec as loaded` : '',
          <>
            <p>{DEMO.story}</p>
            <p className="faint g-small">Stand-in: this slot is for {DEMO.standInFor}. It switches to {DEMO.standInFor}’s real measured spec once that is in the repo.</p>
            {broken && (
              <table className="kv demo-kv"><tbody>
                <tr><th>Battery</th><td>{fmtValue(broken.battery?.voltage_v)} V {broken.battery?.chemistry}</td></tr>
                <tr><th>Motors</th><td>{broken.motor?.count} × {fmtValue(broken.motor?.voltage_v)} V {broken.motor?.kind}</td></tr>
                <tr><th>Wheels</th><td>{fmtValue(broken.wheel?.diameter_m)} m diameter</td></tr>
                <tr><th>Ground clearance</th><td>{fmtValue(broken.ground_clearance_m)} m</td></tr>
              </tbody></table>
            )}
          </>,
        )}

        {panel(
          1,
          <><Term k="checks">Engineering checks</Term> catch it</>,
          before.length ? `${errorsBefore} errors, ${warnsBefore} warnings` : '',
          <>
            <p>{errorsBefore} error{errorsBefore === 1 ? '' : 's'} and {warnsBefore} warning{warnsBefore === 1 ? '' : 's'}, found by deterministic checks in your browser. No AI involved yet.</p>
            <Findings lines={before} />
          </>,
        )}

        {panel(
          2,
          <>Muse Spark proposes a fix (<Term k="forge_loop">Forge loop</Term>)</>,
          loop ? `${rounds.length} round${rounds.length === 1 ? '' : 's'}` : 'Running…',
          <>
            <p className="faint g-small">The model may only change an allow-listed set of fields, at most three rounds. It proposes; it never decides.</p>
            <LoopView res={loop} rounds={rounds} running={stage === 'running'} live={lm.mode === 'live'} />
          </>,
        )}

        {panel(
          3,
          'The checks decide',
          loop ? `${diff.length} changes · ${errorsAfter} errors left · rover ${passCount(roverBefore)}/${roverBefore?.length ?? 0} → ${passCount(roverAfter)}/${roverAfter?.length ?? 0}` : '',
          <>
            <h3 className="demo-sub">What changed</h3>
            <ul className="g-changes">
              {diff.map((d) => <li key={d.path}><code>{d.path}</code> {fmtValue(d.before)} → <strong>{fmtValue(d.after)}</strong></li>)}
            </ul>
            <h3 className="demo-sub">Re-checked after the fix</h3>
            <Findings lines={after} />
            <h3 className="demo-sub">Rover field checks</h3>
            <p className="faint g-small">Indoor floor, 10° ramp, 10 mm threshold, 60-minute shift. First-order estimates; each names its assumptions in My robots.</p>
            <RoverTable before={roverBefore} after={roverAfter} labels={['Broken', 'Fixed']} />
          </>,
        )}

        {panel(
          4,
          <><Term k="gate">Simulation evidence</Term> <span className="fbadge recorded">RECORDED</span></>,
          evDoc ? `Recorded run — verdict ${evDoc.verdict}` : '',
          <>
            <p><strong>Read this first:</strong> {DEMO.evidenceNote}</p>
            {evDoc && (
              <ul className="demo-ev">
                {evDoc.checks.map((c) => (
                  <li key={c.name}><span className={'verdict ' + c.verdict.toLowerCase()}>{c.verdict}</span> {c.name.replace(/_/g, ' ')}: {c.error} {c.unit === 'deg' ? '°' : c.unit} error</li>
                ))}
              </ul>
            )}
            <p><Link href={'/evidence/#run-' + DEMO.evidenceRun}>Open the full gate report and trajectory →</Link></p>
            <p className="faint g-small">A simulated PASS is not a hardware test: it shows the model met the motion thresholds in Gazebo.</p>
          </>,
        )}
      </div>

      {loop && (
        <div className="demo-end">
          <button type="button" className="btn btn-primary" onClick={saveToGarage}>Save both versions to My robots</button>
          <Link className="btn" href="/garage/">Open My robots</Link>
          {saved && <span className="faint" role="status">{saved}</span>}
        </div>
      )}
    </div>
  );
}
