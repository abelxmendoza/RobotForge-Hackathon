'use client';
/* The one-click demo: one robot, one story, start to finish.
 *
 *   broken robot → engineering checks catch it → Muse Spark proposes a
 *   fix → the checks decide → rover field checks → simulation evidence
 *
 * Every step is computed here in the browser except the Muse Spark
 * proposal (live when the endpoint is up, offline textbook rules when
 * it is not, and the banner says which) and the Gazebo evidence, which
 * is a recorded run and is labelled RECORDED. */
import { useRef, useState } from 'react';
import Link from 'next/link';
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
    'Recorded Gazebo run of the un-broken Indoor Delivery Rover this copy was made from. The repaired spec below has not been driven in Gazebo from your browser; run robotforge gate on it for its own report.',
};

type Stage = 'idle' | 'loading' | 'running' | 'done' | 'error';

const ROVER_OPTS = { terrain: 'indoor', slopeDeg: 10, stepM: 0.01, targetMin: 60 };

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
  const diff = broken && loop ? diffSpecs(broken, loop.finalSpec) : [];
  const roverBefore: RoverCheck[] | null = broken ? checkRover(broken, ROVER_OPTS).checks : null;
  const roverAfter: RoverCheck[] | null = loop ? checkRover(loop.finalSpec, ROVER_OPTS).checks : null;
  const evidence = gateReports.find((x) => x.id === DEMO.evidenceRun);
  const evDoc = evidence?.doc as unknown as { verdict: string; checks: { name: string; error: number; unit: string; verdict: string }[] } | undefined;

  return (
    <div className="demo">
      <ModeBanner mode={lm.mode} reason={lm.reason}>
        {lm.mode === 'mock' ? 'Step 3 uses offline textbook rules instead of Muse Spark; every other step is identical.' : null}
      </ModeBanner>

      <div className="demo-start">
        <button type="button" className="btn btn-primary" onClick={run} disabled={stage === 'loading' || stage === 'running'}>
          {stage === 'idle' ? 'Run the demo' : stage === 'done' || stage === 'error' ? 'Run it again' : 'Running…'}
        </button>
        <span className="faint">About a minute with live Muse Spark, a second offline. Nothing you do here leaves your browser except the fix request.</span>
      </div>
      {error && <p className="g-error" role="alert">{error}</p>}

      <ol className="demo-steps">
        <li className={broken ? 'on' : ''}>
          <h2><span className="n">1</span> <span>The broken robot</span></h2>
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
        </li>

        <li className={before.length ? 'on' : ''}>
          <h2><span className="n">2</span> <span><Term k="checks">Engineering checks</Term> catch it</span></h2>
          {before.length ? (
            <>
              <p>{errorsBefore} error{errorsBefore === 1 ? '' : 's'} and {warnsBefore} warning{warnsBefore === 1 ? '' : 's'}, found by deterministic checks in your browser. No AI involved yet.</p>
              <Findings lines={before} />
            </>
          ) : <p className="faint">Waiting for step 1.</p>}
        </li>

        <li className={rounds.length || stage === 'running' ? 'on' : ''}>
          <h2><span className="n">3</span> <span>Muse Spark proposes a fix (<Term k="forge_loop">Forge loop</Term>)</span></h2>
          <p className="faint g-small">The model may only change an allow-listed set of fields, at most three rounds. It proposes; it never decides.</p>
          {(stage === 'running' || loop) ? <LoopView res={loop} rounds={rounds} running={stage === 'running'} live={lm.mode === 'live'} /> : <p className="faint">Waiting for step 2.</p>}
        </li>

        <li className={loop ? 'on' : ''}>
          <h2><span className="n">4</span> <span>The checks decide</span></h2>
          {loop ? (
            <>
              <ul className="g-changes">
                {diff.map((d) => <li key={d.path}><code>{d.path}</code> {fmtValue(d.before)} → <strong>{fmtValue(d.after)}</strong></li>)}
              </ul>
              <p>Re-checked after the fix:</p>
              <Findings lines={after} />
            </>
          ) : <p className="faint">Waiting for step 3.</p>}
        </li>

        <li className={loop ? 'on' : ''}>
          <h2><span className="n">5</span> <span>Rover field checks</span></h2>
          {loop ? (
            <>
              <p className="faint g-small">Indoor floor, 10° ramp, 10 mm threshold, 60-minute shift. First-order estimates; each names its assumptions in My robots.</p>
              <RoverTable before={roverBefore} after={roverAfter} labels={['Broken', 'Fixed']} />
            </>
          ) : <p className="faint">Waiting for step 4.</p>}
        </li>

        <li className={loop ? 'on' : ''}>
          <h2><span className="n">6</span> <span><Term k="gate">Simulation evidence</Term> <span className="fbadge recorded">RECORDED</span></span></h2>
          {loop && evDoc ? (
            <>
              <p>{DEMO.evidenceNote}</p>
              <ul className="demo-ev">
                {evDoc.checks.map((c) => (
                  <li key={c.name}><span className={'verdict ' + c.verdict.toLowerCase()}>{c.verdict}</span> {c.name.replace(/_/g, ' ')}: {c.error} {c.unit === 'deg' ? '°' : c.unit} error</li>
                ))}
              </ul>
              <p><Link href={'/evidence/#run-' + DEMO.evidenceRun}>Open the full gate report and trajectory →</Link></p>
              <p className="faint g-small">A simulated PASS is not a hardware test: it shows the model met the motion thresholds in Gazebo.</p>
            </>
          ) : <p className="faint">Waiting for step 5.</p>}
        </li>
      </ol>

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
