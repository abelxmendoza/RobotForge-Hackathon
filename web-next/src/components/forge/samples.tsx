'use client';
/* The recorded sample runs — the React equivalent of forge.js's
 * RUNS table. The same recorded runs the Forge used to walk step by
 * step, replayed into the thread as RECORDED stages. Every artifact
 * is a file in this repository; the step bodies below are the JSX
 * form of the vanilla HTML builders, content unchanged. */
import type { ReactNode } from 'react';
import { fetchJSON, fetchText, ROOT } from './model';
import type {
  DocSheet,
  GateReportRun,
  ListReport,
  RobotSpec,
} from './model';
import { CodeBlock, Findings, Meter, RawJSON, SpecTable, TrajCanvas, Verdict } from './shared';
import { gateReportsDoc } from './data';

export interface SampleStep {
  h: string;
  intro: string;
  body: ReactNode;
}

export interface SampleRun {
  id: string;
  tab: string;
  meta: string;
  names?: string[];
  load: () => Promise<unknown>;
  steps: (data: never) => SampleStep[];
}

export const STEP_NAMES = ['Input', 'Spec', 'Checks', 'Twin & gate', 'Outputs'];

const BROKEN_LINES = [
  '[ERROR] geometry.clearance_vs_wheel: ground clearance 0.060 m exceeds wheel radius 0.050 m — impossible without a lifted chassis design',
  '[WARN] electrical.voltage_match: direct-supply heuristic: motor nominal voltage 11.1 V is far below battery nominal voltage 24 V; verify motor-driver output, regulation, and component voltage limits before approval',
];

interface WordsData {
  spec: RobotSpec;
  reports: { runs: GateReportRun[] };
}
interface PhotoData {
  spec: RobotSpec;
}
interface DocData {
  sheet: DocSheet;
}
interface ListData {
  paste: string;
  report: ListReport;
}

export const RUNS: SampleRun[] = [
  {
    id: 'words',
    tab: 'Words',
    meta: 'Recorded Oct 26, 2026 · examples/indoor-delivery-rover.json',
    load: async () => ({
      spec: await fetchJSON<RobotSpec>('examples/indoor-delivery-rover.json'),
      reports: gateReportsDoc,
    }),
    steps: (d: WordsData) => {
      const rep = d.reports.runs.find((r) => r.id === 'r5-rover')!.doc;
      const traj = d.reports.runs.find((r) => r.id === 'r5-rover')!.traj;
      return [
        {
          h: 'Describe it in plain words',
          intro: 'One paragraph of plain English. No forms, no CAD, no config files.',
          body: (
            <blockquote className="quote">
              “A small indoor delivery rover with differential drive. It is
              about 40 cm long, 30 cm wide and 25 cm tall, weighs 6 kg, rides
              on wheels 10 cm in diameter and 2.5 cm wide, ground clearance
              3 cm, top speed about 1 m/s. It carries a 2D lidar on top for
              navigation and runs from an 11.1 V 5 Ah battery.”
              <cite>
                Sent to Muse Spark through the Meta Model API (Standard mode)
              </cite>
            </blockquote>
          ),
        },
        {
          h: 'Muse Spark drafts the spec',
          intro:
            'The model fills a strict engineering schema. It never writes simulation code, so everything downstream is deterministic.',
          body: (
            <>
              <div className="card" style={{ padding: '4px 20px' }}>
                <SpecTable spec={d.spec} />
              </div>
              <RawJSON obj={d.spec} label="Spec JSON as returned" />
            </>
          ),
        },
        {
          h: 'The checks look for numbers that don’t add up',
          intro:
            'Geometry, mass budget, motor and battery voltage, sensor ranges. An ERROR stops the pipeline: no twin is built from that spec.',
          body: (
            <>
              <Findings lines={['[INFO] all: spec passed all engineering checks']} />
              <div className="card">
                <div className="eyebrow">What a bad spec looks like</div>
                <p
                  className="muted"
                  style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 12px' }}
                >
                  The same rover with two numbers changed: a 24 V battery and
                  6 cm of ground clearance. Real validator output on{' '}
                  <code>examples/broken-indoor-rover.json</code>:
                </p>
                <Findings lines={BROKEN_LINES} />
              </div>
            </>
          ),
        },
        {
          h: 'The twin drives, turns, and is measured',
          intro:
            'The spec becomes a Gazebo twin, headless. It is told to drive 1 m and turn 90°, and graded against where it actually went.',
          body: (
            <>
              <div className="verdict-row">
                <Verdict status={rep.verdict} extra="lg" />
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  All four checks inside the pass line.
                </span>
              </div>
              <div className="two">
                {rep.checks.map((c) => (
                  <Meter key={c.name} check={c} />
                ))}
              </div>
              <div>
                <TrajCanvas pts={traj} />
                <p className="legend">
                  White dot: start. Amber dot: where the twin really ended up.
                </p>
              </div>
              <div className="callout warn">
                <span>
                  The gate tests the spec’s simulated twin, not a physical
                  robot. A PASS means the numbers describe a robot that can do
                  this in simulation.
                </span>
              </div>
            </>
          ),
        },
        {
          h: 'Take the outputs with you',
          intro:
            'Everything the forge made from this paragraph, and the commands that make it again.',
          body: (
            <>
              <ul className="outputs">
                <li>
                  <strong>Robot model (URDF)</strong>
                  <span>For ROS and any simulator that reads URDF.</span>
                  <CodeBlock text="robotforge urdf examples/indoor-delivery-rover.json --out build/rover.urdf" />
                </li>
                <li>
                  <strong>Take-apart parts kit</strong>
                  <span>
                    One OpenSCAD file per printable part, plus an assembly.
                  </span>
                  <CodeBlock text="robotforge cad examples/indoor-delivery-rover.json" />
                </li>
                <li>
                  <strong>Gate report</strong>
                  <span>
                    Re-run the gate on your own machine (needs Gazebo Sim).
                  </span>
                  <CodeBlock text="robotforge run-gate examples/indoor-delivery-rover.json" />
                </li>
              </ul>
              <p style={{ fontSize: 'var(--fs-sm)' }}>
                <a href="../evidence/#run-r5-rover">
                  Read this run’s full gate report &rarr;
                </a>
              </p>
            </>
          ),
        },
      ];
    },
  },
  {
    id: 'photo',
    tab: 'Photo',
    meta: 'Recorded Oct 26, 2026 · examples/photo-turtlebot.json',
    load: async () => ({
      spec: await fetchJSON<RobotSpec>('examples/photo-turtlebot.json'),
    }),
    steps: (d: PhotoData) => [
      {
        h: 'Start from a photo',
        intro:
          'The input was the official TurtleBot family photo. Muse Spark’s vision pass works only from what is visible, and named the robot: “TurtleBot 3 Waffle Pi”.',
        body: (
          <>
            <figure className="photo-in">
              <img
                src="https://emanual.robotis.com/assets/images/platform/turtlebot3/hardware_setup/turtlebot3_models.png"
                alt="The TurtleBot3 lineup, Waffle Pi at right"
                loading="lazy"
              />
            </figure>
            <p className="faint" style={{ fontSize: 12 }}>
              Shown: the official ROBOTIS TurtleBot3 lineup (Waffle Pi at
              right), for reference.
            </p>
          </>
        ),
      },
      {
        h: 'A drafted spec, marked as estimated',
        intro:
          'A photo has no scale reference, so every dimension is an estimate drawn from the robot’s published approximate size.',
        body: (
          <>
            <span className="est">Estimated, not measured</span>
            <div className="card" style={{ padding: '4px 20px' }}>
              <SpecTable spec={d.spec} />
            </div>
            <RawJSON obj={d.spec} label="Spec JSON as drafted" />
          </>
        ),
      },
      {
        h: 'Checks, plus a second model’s opinion',
        intro:
          'The estimated spec passes the engineering checks. SAM 3.1 then locates parts in the photo on its own, and the two answers are printed side by side.',
        body: (
          <>
            <Findings lines={['[INFO] all: spec passed all engineering checks']} />
            <div className="callout">
              <span>
                <strong>Real photo:</strong> SAM located 3 wheel regions
                (confidence 0.945 / 0.816 / 0.785). The spec carries 2 drive
                wheels plus casters. That’s a different question (visible
                regions vs driven wheels), so both numbers stay on the record.
              </span>
            </div>
            <div className="callout bad">
              <span>
                <strong>Flat cartoon test image:</strong> Spark counted 4
                wheels and SAM found 0 regions. The CLI prints{' '}
                <code>Spark saw 4 / SAM found 0 regions — DISAGREE</code>,
                flagged rather than hidden.
              </span>
            </div>
          </>
        ),
      },
      {
        h: 'No verdict without a measurement',
        intro:
          'This spec has not been run through the motion gate, so it has no badge. RobotForge doesn’t borrow a verdict it hasn’t measured.',
        body: (
          <>
            <div className="verdict-row">
              <Verdict status="NOT_GATED" extra="lg" />
            </div>
            <div className="callout warn">
              <span>
                Measure the real robot, update the estimated numbers, and then
                gate it. Until then the spec is a draft.
              </span>
            </div>
          </>
        ),
      },
      {
        h: 'Take the outputs with you',
        intro: 'The drafted spec and the commands that produced it.',
        body: (
          <>
            <ul className="outputs">
              <li>
                <strong>Draft a spec from your own photo</strong>
                <span>
                  Every dimension comes back marked ESTIMATED.
                </span>
                <CodeBlock text="robotforge describe --photo robot.jpg --out robot.json" />
              </li>
              <li>
                <strong>Find the official model files</strong>
                <span>
                  Public repos and twin assets for a named robot, with licenses
                  shown.
                </span>
                <CodeBlock text={'robotforge lookup "TurtleBot 3 Waffle Pi"'} />
              </li>
            </ul>
            <p style={{ fontSize: 'var(--fs-sm)' }}>
              <a href="../robots/turtlebot3-waffle-pi/">
                Open the Waffle Pi in the Robodex &rarr;
              </a>
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'document',
    tab: 'Document',
    meta: 'Recorded Oct 26, 2026 · examples/document-turtlebot3-burger.json',
    names: ['Input', 'Transcription', 'Accuracy', 'Checks & gate', 'Outputs'],
    load: async () => ({
      sheet: await fetchJSON<DocSheet>('examples/document-turtlebot3-burger.json'),
    }),
    steps: (d: DocData) => {
      const r = d.sheet;
      const sc = r.score;
      const fmtN = (v: number | null | undefined) => (v == null ? '—' : String(v));
      return [
        {
          h: 'Start from a spec sheet',
          intro:
            'The input was an IMAGE of printed values: a datasheet-style sheet rendered from the TurtleBot3 Burger’s published specs as recorded in this repo. The vision model read a PNG rendering of it (' +
            r.input.png_bytes +
            ' bytes, sha256 ' +
            r.input.png_sha256.slice(0, 12) +
            '…); the sheet below is its SVG twin — same layout, same printed values.',
          body: (
            <>
              <figure className="photo-in docsheet">
                <img
                  src={ROOT + r.input.display_svg}
                  alt="The TurtleBot3 Burger spec sheet used as this run’s input"
                  loading="lazy"
                />
              </figure>
              <p className="faint" style={{ fontSize: 12 }}>
                Generated by <code>tools/make_spec_sheet.py</code> from{' '}
                <code>examples/turtlebot3-burger.json</code> — a fixture
                rendering of published values, not a ROBOTIS document.
              </p>
            </>
          ),
        },
        {
          h: 'Printed values, transcribed',
          intro:
            'Document mode transcribes what the sheet PRINTS. Nothing is estimated, and nothing is inferred from drawing scale or proportions — a value that isn’t printed stays absent.',
          body: (
            <>
              <span className="docd">
                Document draft — values transcribed from the document; verify
                against the source
              </span>
              <p className="intro" style={{ marginTop: 10 }}>
                Identity, as printed: <strong>{r.identity_guess}</strong>
              </p>
              <div className="eyebrow">
                Transcribed values (as printed → spec field)
              </div>
              <ul className="items">
                {r.values.map((v, i) => (
                  <li key={i}>
                    <span className="title">
                      {v.label}: <strong>{v.printed}</strong>
                    </span>
                    <span className="faint">→ {v.field}</span>
                  </li>
                ))}
              </ul>
              <div className="card" style={{ padding: '4px 20px' }}>
                <SpecTable spec={r.spec} />
              </div>
              <RawJSON obj={r.spec} label="Draft spec JSON as transcribed" />
            </>
          ),
        },
        {
          h: 'Scored against the published values',
          intro:
            'Every printed number on the sheet is a value this repo already holds with a source, so the transcription can be graded exactly, after the printed units are converted (mm → m). A miss would be printed in this table, not rounded away.',
          body: (
            <>
              <p className="score-line">
                <strong>
                  {sc.exact} of {sc.total}
                </strong>{' '}
                printed values transcribed exactly.
              </p>
              <ul className="items">
                {sc.rows.map((row, i) => (
                  <li key={i}>
                    <span className={'slotname' + (row.match ? '' : ' none')}>
                      {row.match ? '✓' : '✗'}
                    </span>
                    <span className="title">
                      {row.field} — printed {row.printed}, expected{' '}
                      {fmtN(row.expected)}
                      {row.match ? '' : ', got ' + fmtN(row.got)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ),
        },
        {
          h: 'Checks pass; the gate has not run',
          intro:
            'The transcribed draft is complete and passes the engineering checks — this is the validator’s real output, recorded with the run. The draft has not been through the motion gate, so it wears no verdict.',
          body: (
            <>
              <Findings lines={r.findings || []} />
              <div className="verdict-row">
                <Verdict status="NOT_GATED" extra="lg" />
              </div>
              <div className="callout warn">
                <span>
                  A transcription is only as good as the sheet it came from: a
                  misprint upstream would be transcribed faithfully. That is
                  why the draft says “verify against the source”.
                </span>
              </div>
            </>
          ),
        },
        {
          h: 'Take the outputs with you',
          intro:
            'The recorded draft, and the commands that make it again from your own sheet.',
          body: (
            <>
              <ul className="outputs">
                <li>
                  <strong>Transcribe your own spec sheet</strong>
                  <span>
                    Printed values only — anything the document doesn’t print
                    stays absent.
                  </span>
                  <CodeBlock text="robotforge describe --document sheet.png --out burger.json" />
                </li>
                <li>
                  <strong>Check the draft</strong>
                  <span>
                    The full validator; add the twin and gate when you want a
                    verdict.
                  </span>
                  <CodeBlock text="robotforge validate burger.json" />
                </li>
              </ul>
              <p style={{ fontSize: 'var(--fs-sm)' }}>
                <a href="../robots/turtlebot3-burger/">
                  Open the Burger in the Robodex &rarr;
                </a>
              </p>
            </>
          ),
        },
      ];
    },
  },
  {
    id: 'list',
    tab: 'Parts list',
    meta: 'Recorded Oct 27, 2026 · robotforge import-list',
    names: ['Input', 'Parts', 'Assembly', 'Twin & gate', 'Outputs'],
    load: async () => ({
      paste: await fetchText('examples/list-import-quad.txt'),
      report: await fetchJSON<ListReport>('examples/list-import-quad.report.json'),
    }),
    steps: (d: ListData) => {
      const a = d.report.assembly;
      const slots = Object.values(a.slots);
      const cls = (s: { status: string }) =>
        s.status === 'filled' ? 'ok' : s.status === 'missing' ? 'miss' : 'kit';
      const word = (s: { status: string }) =>
        s.status === 'filled' ? '✓' : s.status === 'missing' ? 'missing' : 'in kit?';
      return [
        {
          h: 'Paste a shopping list',
          intro:
            'A real order history pasted from Amazon, noise and all: doubled titles, prices, “Add to Cart” lines, and things that aren’t robot parts.',
          body: <pre className="paste">{d.paste.trim()}</pre>,
        },
        {
          h: 'Each line becomes a part',
          intro:
            'Titles are matched to functional slots by deterministic rules. Quantities and specs are read from the title. Anything unmatched is shown, never dropped.',
          body: (
            <ul className="items">
              {d.report.items.map((it, i) => (
                <li key={i}>
                  <span
                    className={
                      'slotname' + (it.slot === 'unidentified' ? ' none' : '')
                    }
                  >
                    {it.slot}
                  </span>
                  <span className="qty">×{it.qty}</span>
                  <span className="title" title={it.title}>
                    {it.title}
                  </span>
                  <span className="price">
                    {it.price != null ? '$' + it.price.toFixed(2) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          ),
        },
        {
          h: 'Assembled into a quadcopter, with gaps found',
          intro:
            'The parts are placed against a quadcopter slot map. This is where you find out what’s missing before you order.',
          body: (
            <>
              <div className="slots">
                {slots.map((s, i) => (
                  <div className={'slot ' + cls(s)} key={i}>
                    <span>{s.label}</span>
                    <span className="have">
                      {s.have}/{s.need} {word(s)}
                    </span>
                  </div>
                ))}
              </div>
              {a.warnings.map((w, i) => (
                <div className="callout warn" key={'w' + i}>
                  <span>
                    <strong>Warning:</strong> {w}
                  </span>
                </div>
              ))}
              {a.unidentified.length ? (
                <div className="callout">
                  <span>
                    <strong>Unidentified, shown not dropped:</strong>{' '}
                    {a.unidentified.join('; ')}
                  </span>
                </div>
              ) : null}
              {a.bench.length ? (
                <div className="callout">
                  <span>
                    <strong>Bench equipment, not robot parts:</strong>{' '}
                    {a.bench.join('; ')}
                  </span>
                </div>
              ) : null}
            </>
          ),
        },
        {
          h: 'No motion gate for this class yet',
          intro:
            'The motion gate covers wheeled ground robots today. A quadcopter gets the assembly check, wiring and missing parts, but no verdict.',
          body: (
            <>
              <div className="verdict-row">
                <Verdict status="NOT_GATED" extra="lg" />
              </div>
              <div className="callout warn">
                <span>
                  A list import tells you whether the parts add up to a robot.
                  It doesn’t claim the robot will fly.
                </span>
              </div>
            </>
          ),
        },
        {
          h: 'What to buy, and how to wire it',
          intro:
            'The missing parts with store search links (never scraped prices), and the suggested wiring with a reason for each connection.',
          body: (
            <>
              <div className="card">
                <div className="eyebrow">Missing</div>
                <ul className="outputs" style={{ marginTop: 12 }}>
                  {a.missing.map((m, i) => (
                    <li key={i}>
                      <strong>
                        {m.label}
                        {m.required ? null : (
                          <span className="faint"> (recommended)</span>
                        )}
                      </strong>
                      <span>
                        {m.alternatives.map((x, j) => (
                          <span key={j}>
                            {j ? ' · ' : ''}
                            <a href={x.url} rel="noopener">
                              Search {x.store}
                            </a>
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="card">
                <div className="eyebrow">Wiring</div>
                <ul className="wires" style={{ marginTop: 12 }}>
                  {d.report.wiring.connections.map((c, i) => (
                    <li key={i}>
                      <b>{c.from}</b>
                      <span className="via">→ {c.via} →</span>
                      <b>{c.to}</b>
                      <p>{c.note}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <CodeBlock text="robotforge import-list my-list.txt --out report.json" />
            </>
          ),
        },
      ];
    },
  },
];
