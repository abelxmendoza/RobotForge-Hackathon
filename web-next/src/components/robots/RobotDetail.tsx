import { generatedRobotAsset } from "@/lib/generatedRobotAssets";
import GeneratedRobotModel from "@/components/garage/GeneratedRobotModel";
import type { ReactNode } from "react";
import Link from "next/link";
import type { Robot } from "@/lib/types";
import { gateReports, harnessOf, robotSlug, stabilityOf } from "@/lib/data";
import { REPO_URL } from "@/components/shell/AppShell";
import { assetPath } from "@/components/home/asset";
import Term from "@/components/shell/Term";
import {
  classPath, dexId, evidenceHref, fullReportId, gateStatusOf, gradeOf,
  imgSrc, latestRun, robotImage, specLabel,
  staticCheckOf, type GateRunFull,
} from "./shared";
import { GateReceipt, VerdictBadge } from "./badges";
import CopyButton from "./CopyButton";
import PartsKitSection from "./PartsKitSection";
import PhysicsSection from "./PhysicsSection";
import GazeboSection from "./GazeboSection";
import HarnessSection, { asHarnessReport } from "./HarnessSection";
import SpecWiring from "@/components/wiring/SpecWiring";
import TakeApartViewer from "./takeapart/TakeApartViewer";
import HeroPhoto from "./HeroPhoto";
import ProfileTabs, { InfoTip, type ProfilePane } from "./ProfileTabs";
import AskWrenchButton from "./AskWrenchButton";

/* The Robodex robot profile (redesigned 2026-11-23, PR "Simplify the
   Robodex robot profile"). A compact hero answers "what is it and does
   it pass", then five tabs hold everything else:
     Overview · 3D · Tests · Parts · Files
   Verdicts and numbers still come only from the robot's recorded data;
   the long honesty notes moved into "How this works" folds, so none
   of them were dropped. Old #section links open the right tab
   (ProfileTabs). */

/* The full stability report behind a static check
   (catalog/stability-reports/<slug>.json via stabilityOf). */
interface StabilityReport {
  method: string;
  inputs: { com_height_m: number; support_model: string };
  results: {
    weakest_margin_pct: number;
    edges: { direction: string; margin_mm: number; tip_angle_deg: number }[];
  };
  assumptions: string[];
}
function asStabilityReport(
  doc: Record<string, unknown> | undefined,
): StabilityReport | null {
  if (!doc || typeof doc !== "object") return null;
  const results = (doc as { results?: unknown }).results;
  if (!results || typeof results !== "object") return null;
  return doc as unknown as StabilityReport;
}

/* ---- hero key numbers --------------------------------------------
   Up to three readouts picked from the robot's own key_specs. The
   short form is the value up to its first aside; the full value is
   in the tooltip and on the Overview tab, and a value the record
   marks as estimated keeps an "est." tag so a short form never
   reads as a measurement. */
const STAT_PICKS: { label: string; keys: RegExp }[] = [
  { label: "Mass", keys: /^(mass|weight|takeoff weight)$/i },
  { label: "Size", keys: /^(size|footprint|dimensions.*|chassis|height.*)$/i },
  { label: "Power", keys: /^(battery|power)$/i },
];
interface KeyStat { label: string; short: string; full: string; est: boolean }
function shortValue(v: string): string {
  let s = v.split(/ — | \(|; /)[0].trim();
  if (s.length > 26) s = s.slice(0, 24).replace(/[\s,·x×]+\S*$/, "") + "…";
  return s;
}
function keyStats(specs: Record<string, unknown>): KeyStat[] {
  const out: KeyStat[] = [];
  for (const pick of STAT_PICKS) {
    const key = Object.keys(specs).find((k) => pick.keys.test(k.trim()));
    if (!key) continue;
    const full = String(specs[key]);
    const short = shortValue(full);
    out.push({
      label: pick.label,
      short,
      full,
      est: /estimat|photo draft/i.test(full) || /~|approx/i.test(short),
    });
  }
  return out;
}

function FmtCell({ v, unit }: { v: number | null; unit: string }) {
  if (v === null) return <td className="num faint">—</td>;
  return (
    <td className="num">
      <span className={`verdict-text ${gradeOf(v)}`}>{v.toFixed(3)}{unit}</span>
    </td>
  );
}

/* One labelled number in the instrument-panel style. */
function Readout({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`pf-readout${tone ? ` ${tone}` : ""}`}>
      <span className="pf-readout-label">{label}</span>
      <span className="pf-readout-value">{value}</span>
    </div>
  );
}

function RunsTable({ runs }: { runs: GateRunFull[] }) {
  const sources = runs
    .map((run, i) => (run.source || run.report ? { i: i + 1, source: run.source, report: run.report } : null))
    .filter((x): x is { i: number; source: string | undefined; report: string | undefined } => x !== null);
  return (
    <>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Run</th><th>Drive vs truth</th><th>Turn vs truth</th>
              <th>Odometry distance</th><th>Odometry heading</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, i) => (
              <tr key={i}>
                <td>Run {i + 1}</td>
                <FmtCell v={run.drive_error_pct} unit="%" />
                <FmtCell v={run.heading_error_deg} unit="°" />
                <FmtCell v={run.odometry_distance_error_pct} unit="%" />
                <FmtCell v={run.odometry_heading_error_deg} unit="°" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sources.length ? (
        <ul className="prov" style={{ marginTop: 12, paddingLeft: 18 }}>
          {sources.map((s) => (
            <li key={s.i}>
              Run {s.i}: {s.source}
              {s.report ? (
                <>
                  {" "}· <a href={assetPath(s.report)}>full gate report (JSON)</a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/* An imported description (robots.json `specimen` block, written by
   tools/import_go2_specimen.py — a name-parameterized importer over
   the robot_descriptions package plus, for the X500, a direct clone
   of PX4's model repo). The facts are parsed from the upstream
   description (URDF, MJCF or SDF) at the pinned commit — an import
   is provenance, never a gate verdict. Fact fields are per-class:
   only the rows a robot's file supports are rendered. */
interface SpecimenFacts {
  robot_name_in_urdf?: string;
  robot_name_in_mjcf?: string;
  robot_name_in_sdf?: string;
  link_count?: number;
  links_with_inertial?: number;
  body_count?: number;
  bodies_with_inertial?: number;
  joint_count: number;
  joints_by_type: Record<string, number>;
  actuator_count?: number;
  degrees_of_freedom?: number;
  actuated_joints?: Record<string, string[]>;
  total_mass_kg: number;
  base_link_mass_kg?: number;
  root_body_mass_kg?: number;
  leg_mass_kg_each?: number[];
  zero_pose_foot_span_m?: { x: number; y: number };
  zero_pose_foot_drop_m?: number;
  rotor_count?: number;
  rotor_span_m?: { x: number; y: number };
  fact_source: string;
}
interface SpecimenBlock {
  kind: string;
  manifest: string;
  imported_via: string;
  source_repo: string;
  source_commit: string;
  urdf?: string;
  mjcf?: string;
  sdf?: string;
  license: string;
  imported: string;
  source_label?: string;
  facts: SpecimenFacts;
}

function SpecimenSection({ specimen }: { specimen: SpecimenBlock }) {
  const f = specimen.facts;
  const upstream = specimen.source_repo.replace(/^https?:\/\/github\.com\//, "");
  const joints = Object.entries(f.joints_by_type)
    .map(([t, n]) => `${n} ${t}`).join(", ");
  const rows: [string, string][] = [];
  if (f.link_count !== undefined) {
    rows.push(["Links", `${f.link_count} (${f.links_with_inertial} with inertial data)`]);
  }
  if (f.body_count !== undefined) {
    rows.push(["Bodies", `${f.body_count} (${f.bodies_with_inertial} with inertial data)`]);
  }
  rows.push(["Joints", `${f.joint_count} (${joints})`]);
  if (f.actuator_count !== undefined) {
    rows.push(["Actuators", `${f.actuator_count}`]);
  }
  if (f.degrees_of_freedom !== undefined) {
    rows.push(["Degrees of freedom", `${f.degrees_of_freedom}`]);
  }
  if (f.actuated_joints) {
    const desc = Object.entries(f.actuated_joints)
      .map(([t, names]) => `${names.length} ${t}: ${names.join(", ")}`)
      .join("; ");
    rows.push(["Actuated joints", desc]);
  }
  rows.push(["Total mass (description inertials)", `${f.total_mass_kg} kg`]);
  if (f.base_link_mass_kg !== undefined) {
    rows.push(["Base link mass", `${f.base_link_mass_kg} kg`]);
  }
  if (f.root_body_mass_kg !== undefined) {
    rows.push(["Root body mass", `${f.root_body_mass_kg} kg`]);
  }
  if (f.leg_mass_kg_each) {
    rows.push(["Mass per leg", f.leg_mass_kg_each.map((m) => `${m} kg`).join(", ")]);
  }
  if (f.zero_pose_foot_span_m) {
    rows.push(["Zero-pose foot span", `${f.zero_pose_foot_span_m.x} × ${f.zero_pose_foot_span_m.y} m`]);
  }
  if (f.zero_pose_foot_drop_m !== undefined) {
    rows.push(["Feet below base origin (zero pose)", `${f.zero_pose_foot_drop_m} m`]);
  }
  if (f.rotor_count !== undefined) {
    rows.push(["Rotors", f.rotor_span_m
      ? `${f.rotor_count} (span ${f.rotor_span_m.x} × ${f.rotor_span_m.y} m)`
      : `${f.rotor_count}`]);
  }
  const descPath = specimen.urdf ?? specimen.mjcf ?? specimen.sdf ?? "";
  const descFormat = specimen.urdf ? "URDF" : specimen.mjcf ? "MJCF" : "SDF";
  return (
    <section className="section" id="specimen">
      <h2>Imported specimen</h2>
      <p className="sub">
        From {specimen.source_label ?? "robot_descriptions"} (
        <a href={specimen.source_repo}>{upstream}</a>) · {specimen.license} · imported {specimen.imported}
      </p>
      <div className="card">
        <table className="kv">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: 10 }}>
          {f.fact_source} Full record:{" "}
          <a href={assetPath(specimen.manifest)}>
            <code>{specimen.manifest}</code>
          </a>{" "}
          (upstream {descFormat} <code>{descPath}</code> at commit{" "}
          <code>{specimen.source_commit.slice(0, 8)}</code>, via{" "}
          {specimen.imported_via}).
        </p>
        <p>
          An import is provenance, not a verdict: this entry stays{" "}
          <strong>Not gated</strong>, and no parts kit is defined for it.
        </p>
      </div>
    </section>
  );
}


export default function RobotDetail({ robot }: { robot: Robot }) {
  const slug = robotSlug(robot);
  const img = robotImage(robot);
  const gs = gateStatusOf(robot);
  const check = staticCheckOf(robot);
  const harnessRep = asHarnessReport(harnessOf(slug));
  const stabRep = check ? asStabilityReport(stabilityOf(slug)) : null;
  const ground = (robot.mobility_class ?? "").startsWith("Ground");
  const specFile = robot.spec_file;
  const genAsset = generatedRobotAsset(slug);

  const keySpecs = (robot.key_specs ?? {}) as Record<string, unknown>;
  const specimen = (robot.specimen ?? null) as SpecimenBlock | null;
  const specKeys = Object.keys(keySpecs).sort();
  const stats = keyStats(keySpecs);
  const prov = (robot.provenance ?? {}) as Record<string, unknown>;
  const provStr = (k: string): string =>
    typeof prov[k] === "string" ? (prov[k] as string) : "";
  const reportId = fullReportId(robot, gateReports);
  const last = latestRun(gs);

  /* ---- Reproduce commands (Files tab) ---- */
  let cmdLines = "";
  if (specFile) {
    cmdLines = ground
      ? `robotforge validate ${specFile}\n` +
        `robotforge urdf ${specFile} --out build/${slug}.urdf\n` +
        `robotforge cad ${specFile}\n` +
        `robotforge run-gate ${specFile}`
      : `robotforge validate ${specFile}\n` +
        (check ? `robotforge stability ${specFile}\n` : "") +
        `robotforge catalog robot ${robot.number}`;
    if (harnessRep) cmdLines += `\nrobotforge harness ${specFile}`;
  }

  /* ---- hero status chips: each one opens its test ---- */
  const harnessIssues = harnessRep
    ? harnessRep.summary.findings.WARN + harnessRep.summary.findings.ERROR
    : 0;
  const chips = (
    <div className="pf-chips">
      <a href="#gate" className="pf-chip-link" aria-label="Gate result: open the test">
        <VerdictBadge status={gs.status} lg />
      </a>
      {check ? (
        <a href="#stability" className={`pf-chip stab ${check.grade.toLowerCase()}`}>
          Stability: {check.grade.toLowerCase()}
        </a>
      ) : null}
      {harnessRep ? (
        <a href="#harness" className="pf-chip wiring">
          Wiring: {harnessIssues} {harnessIssues === 1 ? "issue" : "issues"}
          {harnessRep.summary.states.NOT_CHECKED
            ? ` · ${harnessRep.summary.states.NOT_CHECKED} unchecked`
            : ""}
        </a>
      ) : null}
    </div>
  );

  /* ================================================================ */
  /* Overview                                                          */
  const overview = (
    <section className="section pf-section" id="spec">
      <h2>Spec</h2>
      {specKeys.length ? (
        <div className="pf-spec-grid">
          {specKeys.map((k) => (
            <div className="pf-spec" key={k}>
              <span className="pf-spec-label">{specLabel(k)}</span>
              <span className="pf-spec-value">{String(keySpecs[k])}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="state-box">No key specs recorded yet.</p>
      )}
      <p className="pf-source">
        Source: {provStr("source_name") || "not recorded"}
        {provStr("source_url") ? <> · <a href={provStr("source_url")}>link</a></> : null}
        {provStr("license") ? <> · {provStr("license")}</> : null}
      </p>
    </section>
  );

  /* ================================================================ */
  /* 3D                                                                */
  const has3d = Boolean(specFile || genAsset);
  const threeD = has3d ? (
    <>
      {specFile ? (
        <section className="section pf-section" id="take-apart">
          <h2>Take it apart</h2>
          <p className="sub">
            {ground
              ? "The printable kit from this robot's spec. Flat or 3D; click any part."
              : "A schematic take-apart from the spec's numbers. Flat or 3D; click any part."}
          </p>
          <InfoTip>
            {ground ? (
              <>
                Every spec becomes a kit of simple, 3D-printable parts (
                <code>robotforge cad</code>). This viewer lays the kit out the way
                the kit&apos;s own assembly file does, straight from the spec&apos;s
                numbers.
              </>
            ) : (
              <>
                This viewer derives a schematic take-apart straight from the
                spec&apos;s numbers, the same one-derivation rule as the ground
                kits. It is a schematic of the real robot&apos;s layout, not a
                printable kit: <code>robotforge cad</code> kits cover ground
                robots only today.
              </>
            )}
          </InfoTip>
          <div id="ta">
            <TakeApartViewer specFile={specFile} />
          </div>
        </section>
      ) : null}
      {specFile ? <SpecWiring specFile={specFile} /> : null}
      {genAsset ? (
        <section className="section pf-section" id="generated-model">
          <GeneratedRobotModel asset={genAsset} />
        </section>
      ) : null}
    </>
  ) : null;

  /* ================================================================ */
  /* Tests                                                             */
  const gateCard = (
    <section className="section pf-section" id="gate">
      <div className="pf-card-head">
        <h2><Term k="gate">Gate</Term> runs</h2>
        <VerdictBadge status={gs.status} />
      </div>
      <p className="sub">
        {gs.runs.length || ground
          ? "Drive 1 m and turn 90° in simulation, measured against ground truth."
          : "The motion gate covers ground robots today, so this robot has no verdict."}
      </p>
      <InfoTip>
        {gs.runs.length || ground
          ? "Measured against simulator ground truth at the locked thresholds: pass ≤ 5% / 5°, fail over 10% / 10°. The gate tests the spec's simulated twin, not a physical robot."
          : "The motion gate covers ground robots today. This class has no gate yet, so there is no verdict to show; the note below says why, in the entry's own words."}
      </InfoTip>
      <div className="card pf-card">
        {gs.runs.length && last ? (
          <>
            <div className="pf-readouts">
              <Readout label="Runs" value={gs.runs.length} />
              {last.drive_error_pct !== null ? (
                <Readout label="Drive error" value={`${last.drive_error_pct.toFixed(2)}%`}
                  tone={gradeOf(last.drive_error_pct)} />
              ) : null}
              {last.heading_error_deg !== null ? (
                <Readout label="Turn error" value={`${last.heading_error_deg.toFixed(2)}°`}
                  tone={gradeOf(last.heading_error_deg)} />
              ) : null}
            </div>
            <GateReceipt gs={gs} />
            <details className="report-more">
              <summary>All runs and their sources</summary>
              <RunsTable runs={gs.runs} />
            </details>
            <p className="pf-card-foot">
              <Link href={evidenceHref(robot, slug, gateReports)}>
                {reportId ? "Full gate report →" : "Recorded runs and sources ↓"}
              </Link>
            </p>
          </>
        ) : (
          <p className="state-box">
            No recorded gate runs yet. This robot has no verdict until one
            is measured.
          </p>
        )}
        {gs.note ? (
          <div
            className={gs.status === "FAIL" ? "callout bad" : "callout"}
            style={{ marginTop: 12 }}
          >
            <span>{gs.note}</span>
          </div>
        ) : null}
      </div>
    </section>
  );

  const stabilityCard = check ? (
    <section className="section pf-section" id="stability">
      <div className="pf-card-head">
        <h2>Static stability</h2>
        <span className={`pf-chip stab ${check.grade.toLowerCase()}`}>{check.grade.toLowerCase()}</span>
      </div>
      <p className="sub">How far it can tip before it falls, computed from the spec.</p>
      <InfoTip>
        A computation from this robot&apos;s spec: support-polygon statics,
        not a simulation run and not a gate verdict. It grades how far the
        robot can tip before its centre of mass passes over its feet. The
        gate status is unchanged by it. Thresholds (v1, printed on the
        report): tip angle ≥ 20° STABLE · 10–20° MARGINAL · &lt; 10° UNSTABLE.
        {stabRep ? (
          <>
            {" "}Centre-of-mass height {stabRep.inputs.com_height_m.toFixed(3)} m
            is ASSUMED at 55% of standing height.
          </>
        ) : null}
      </InfoTip>
      <div className="card pf-card">
        <div className="pf-readouts">
          <Readout label="Static check" value={check.grade} />
          <Readout label="Tip angle" value={`${check.tip_angle_deg.toFixed(1)}°`} />
          <Readout label="Weakest side" value={check.weakest_direction} />
          <Readout label="Margin" value={`${check.weakest_margin_mm.toFixed(0)} mm`} />
        </div>
        {stabRep ? (
          <details className="report-more">
            <summary>How it was computed</summary>
            <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
              {stabRep.method}
            </p>
            <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
              <strong>Support model:</strong> {stabRep.inputs.support_model} ·{" "}
              <strong>margin</strong> {stabRep.results.weakest_margin_pct.toFixed(0)}% of the
              body&apos;s half-extent
            </p>
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="data">
                <thead>
                  <tr><th>Direction</th><th>Margin</th><th>Tip angle</th></tr>
                </thead>
                <tbody>
                  {stabRep.results.edges.map((ed, i) => (
                    <tr key={i}>
                      <td>{ed.direction}</td>
                      <td className="num">{ed.margin_mm.toFixed(0)} mm</td>
                      <td className="num">{ed.tip_angle_deg.toFixed(1)}°</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
              <strong>Assumptions</strong> (all of them, as printed in the report):
            </p>
            <ul className="prov" style={{ paddingLeft: 18 }}>
              {stabRep.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="pf-card-foot">
          <a href={`${REPO_URL}/blob/main/${check.report}`}>Report</a> · checked {check.date}
        </p>
      </div>
    </section>
  ) : null;

  const tests = (
    <>
      {gateCard}
      <PhysicsSection slug={slug} robotName={robot.name} />
      {stabilityCard}
      {harnessRep ? (
        <HarnessSection rep={harnessRep} slug={slug} specFile={specFile} />
      ) : null}
    </>
  );

  /* ================================================================ */
  /* Files (for builders)                                              */
  const files = (
    <>
      <section className="section pf-section" id="provenance">
        <h2>Where the data comes from</h2>
        <div className="card pf-card">
          <dl className="pf-dl">
            <dt>Source</dt>
            <dd>
              {provStr("source_name") || "not recorded"}
              {provStr("source_url") ? <> · <a href={provStr("source_url")}>link</a></> : null}
            </dd>
            {provStr("license") ? (<><dt>License</dt><dd>{provStr("license")}</dd></>) : null}
            {specFile ? (
              <>
                <dt>Spec file</dt>
                <dd>
                  <a href={`${REPO_URL}/blob/main/${specFile}`}><code>{specFile}</code></a>
                </dd>
              </>
            ) : null}
          </dl>
          {provStr("note") ? <p className="muted pf-note">{provStr("note")}</p> : null}
        </div>
      </section>
      {specimen ? <SpecimenSection specimen={specimen} /> : null}
      <GazeboSection slug={slug} robotName={robot.name} />
      {specFile ? (
        <section className="section pf-section" id="commands">
          <h2>Reproduce it</h2>
          <p className="sub">Run these from a clone of the repository.</p>
          {!ground ? (
            <InfoTip>
              The twin, CAD kit and motion gate (<code>urdf</code> /{" "}
              <code>cad</code> / <code>run-gate</code>) cover ground robots
              today, so they are not listed here.
            </InfoTip>
          ) : null}
          <div className="codeblock card" style={{ padding: 0, border: 0, background: "none" }}>
            <pre><code>{cmdLines}</code></pre>
            <CopyButton text={cmdLines} />
          </div>
        </section>
      ) : null}
    </>
  );

  const panes: ProfilePane[] = [
    { id: "overview", label: "Overview", anchors: ["spec"], content: overview },
  ];
  if (threeD) {
    panes.push({ id: "3d", label: "3D", anchors: ["take-apart", "ta", "wiring", "generated-model"], content: threeD });
  }
  panes.push(
    { id: "tests", label: "Tests", anchors: ["gate", "physics", "stability", "harness"], content: tests },
    { id: "parts", label: "Parts", anchors: ["parts-kit"], content: <PartsKitSection slug={slug} /> },
    { id: "files", label: "Files", anchors: ["provenance", "specimen", "gazebo", "commands"], content: files },
  );

  return (
    <>
      <div className="robot-hero pf-hero">
        {img ? (
          <HeroPhoto src={imgSrc(img.src)} slug={slug} name={robot.name} ai={img.ai}
            caption={img.caption}
            alt={robot.name + (img.ai ? " (AI concept illustration)" : " (official image)")} />
        ) : null}
        <div className="pf-hero-body">
          <span className="dex">{dexId(robot)}</span>
          <h1>{robot.name}</h1>
          <div className="cls">{classPath(robot)}</div>
          {chips}
          {stats.length ? (
            <div className="pf-stats">
              {stats.map((s) => (
                <div className="pf-stat" key={s.label} title={s.full}>
                  <span className="pf-stat-label">{s.label}{s.est ? <em> est.</em> : null}</span>
                  <span className="pf-stat-value">{s.short}</span>
                </div>
              ))}
            </div>
          ) : null}
          {robot.description ? (
            <details className="pf-desc">
              <summary>{robot.description}</summary>
            </details>
          ) : null}
          <div className="pf-actions">
            {has3d ? (
              <a className="btn btn-primary" href="#tab-3d">View in 3D</a>
            ) : null}
            <AskWrenchButton name={robot.name} />
          </div>
        </div>
      </div>

      <ProfileTabs panes={panes} name={robot.name} />
    </>
  );
}
