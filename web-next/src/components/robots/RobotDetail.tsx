import type { ReactNode } from "react";
import Link from "next/link";
import type { Robot } from "@/lib/types";
import { gateReports, harnessOf, robotSlug, stabilityOf } from "@/lib/data";
import { REPO_URL } from "@/components/shell/AppShell";
import { assetPath } from "@/components/home/asset";
import Term from "@/components/shell/Term";
import {
  classPath, dexId, evidenceHref, fullReportId, gateStatusOf, gradeOf,
  imgSrc, robotImage, specLabel,
  staticCheckOf, type GateRunFull,
} from "./shared";
import { GateReceipt, StaticBadge, VerdictBadge } from "./badges";
import CopyButton from "./CopyButton";
import PartsKitSection from "./PartsKitSection";
import HarnessSection, { asHarnessReport, HarnessBadge } from "./HarnessSection";
import TakeApartViewer from "./takeapart/TakeApartViewer";
import RobotPhoto from "./RobotPhoto";

/* render_robot_page (site.py): hero, spec + provenance, gate runs,
   static stability summary, harness checks, take-apart, reproduce.
   Verdicts and numbers come only from the robot's recorded data. */

/* The full stability report behind a static check
   (catalog/stability-reports/<slug>.json via stabilityOf) — the
   fields _stability_section renders beyond the summary rows. */
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

function FmtCell({ v, unit }: { v: number | null; unit: string }) {
  if (v === null) return <td className="num faint">—</td>;
  return (
    <td className="num">
      <span className={`verdict-text ${gradeOf(v)}`}>{v.toFixed(3)}{unit}</span>
    </td>
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
        Imported specimen — source: {specimen.source_label ?? "robot_descriptions"} (upstream:{" "}
        <a href={specimen.source_repo}>{upstream}</a>), license:{" "}
        {specimen.license}, imported {specimen.imported}.
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

  const keySpecs = robot.key_specs ?? {};
  const specimen = (robot.specimen ?? null) as SpecimenBlock | null;
  const specKeys = Object.keys(keySpecs).sort();
  const prov = (robot.provenance ?? {}) as Record<string, unknown>;
  const provStr = (k: string): string =>
    typeof prov[k] === "string" ? (prov[k] as string) : "";

  const gateSub: ReactNode = gs.runs.length || ground
    ? "Measured against simulator ground truth at the locked thresholds: pass ≤ 5% / 5°, fail over 10% / 10°. The gate tests the spec's simulated twin, not a physical robot."
    : "The motion gate covers ground robots today. This class has no gate yet, so there is no verdict to show — the note below says why, in the entry's own words.";

  const jump: { href: string; label: string }[] = [
    { href: "#spec", label: "Spec" },
    { href: "#gate", label: "Gate runs" },
    { href: "#parts-kit", label: "Parts kit" },
  ];
  if (check) jump.push({ href: "#stability", label: "Static stability" });
  if (specimen) jump.push({ href: "#specimen", label: "Specimen" });
  if (harnessRep) jump.push({ href: "#harness", label: "Harness checks" });
  if (specFile) {
    jump.push({ href: "#take-apart", label: "Take it apart" });
    jump.push({ href: "#commands", label: "Reproduce" });
  }

  let cmdLines = "";
  let cmdSub: ReactNode = null;
  let taSub: ReactNode = null;
  if (specFile) {
    if (ground) {
      taSub = (
        <>
          Every spec becomes a kit of simple, 3D-printable parts (
          <code>robotforge cad</code>). This viewer lays the kit out the way
          the kit&apos;s own assembly file does, straight from the spec&apos;s
          numbers — flat views, or in 3D with the toggle. Click any part.
        </>
      );
      cmdLines =
        `robotforge validate ${specFile}\n` +
        `robotforge urdf ${specFile} --out build/${slug}.urdf\n` +
        `robotforge cad ${specFile}\n` +
        `robotforge run-gate ${specFile}`;
      cmdSub = "Run these from a clone of the repository.";
    } else {
      taSub = (
        <>
          This viewer derives a schematic take-apart straight from the
          spec&apos;s numbers — the same one-derivation rule as the ground
          kits — flat views, or in 3D with the toggle. It is a schematic of
          the real robot&apos;s layout, not a printable kit:{" "}
          <code>robotforge cad</code> kits cover ground robots only today.
          Click any part.
        </>
      );
      cmdLines =
        `robotforge validate ${specFile}\n` +
        (check ? `robotforge stability ${specFile}\n` : "") +
        `robotforge catalog robot ${robot.number}`;
      cmdSub = (
        <>
          Run these from a clone of the repository. The twin, CAD kit and
          motion gate (<code>urdf</code> / <code>cad</code> /{" "}
          <code>run-gate</code>) cover ground robots today, so they are not
          listed here.
        </>
      );
    }
    if (harnessRep) cmdLines += `\nrobotforge harness ${specFile}`;
  }

  return (
    <>
      <div className="robot-hero">
        {img ? (
          <figure>
            <div className={img.ai ? "ph ai" : "ph"}>
              <RobotPhoto src={imgSrc(img.src)} slug={slug} name={robot.name}
                alt={robot.name + (img.ai ? " (AI concept illustration)" : " (official image)")} />
            </div>
            {img.caption ? <figcaption>{img.caption}</figcaption> : null}
          </figure>
        ) : null}
        <div>
          <span className="dex">{dexId(robot)}</span>
          <h1>{robot.name}</h1>
          <div className="cls">{classPath(robot)}</div>
          <div className="cls faint">{robot.class}</div>
          <VerdictBadge status={gs.status} lg />
          {check ? <StaticBadge check={check} lg /> : null}
          {harnessRep ? <HarnessBadge rep={harnessRep} lg /> : null}
          <GateReceipt gs={gs} />
          {gs.runs.length ? (
            <p style={{ marginTop: 8 }}>
              <Link href={evidenceHref(robot, slug, gateReports)}>
                {fullReportId(robot, gateReports)
                  ? "Evidence: the full gate report →"
                  : "Evidence: the recorded runs and their sources ↓"}
              </Link>
            </p>
          ) : null}
          <p className="desc">{robot.description}</p>
          <nav className="jump" aria-label="On this page">
            {jump.map((j) => (
              <a key={j.href} className="chip" href={j.href}>{j.label}</a>
            ))}
          </nav>
        </div>
      </div>

      <section className="section" id="spec">
        <h2>Spec</h2>
        <div className="cols">
          <div className="card">
            {specKeys.length ? (
              <table className="kv">
                <tbody>
                  {specKeys.map((k) => (
                    <tr key={k}>
                      <th>{specLabel(k)}</th>
                      <td>{String(keySpecs[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="state-box">No key specs recorded yet.</p>
            )}
          </div>
          <div className="card prov">
            <span>
              <strong>Source:</strong> {provStr("source_name")}
              {provStr("source_url") ? (
                <> · <a href={provStr("source_url")}>link</a></>
              ) : null}
            </span>
            {provStr("license") ? (
              <span><strong>License:</strong> {provStr("license")}</span>
            ) : null}
            {specFile ? (
              <span>
                <strong>Spec file:</strong>{" "}
                <a href={`${REPO_URL}/blob/main/${specFile}`}>
                  <code>{specFile}</code>
                </a>
              </span>
            ) : null}
            {provStr("note") ? <span>{provStr("note")}</span> : null}
          </div>
        </div>
      </section>

      {specimen ? <SpecimenSection specimen={specimen} /> : null}

      <section className="section" id="gate">
        <h2><Term k="gate">Gate</Term> runs</h2>
        <p className="sub">{gateSub}</p>
        <div className="card">
          {gs.runs.length ? (
            <RunsTable runs={gs.runs} />
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

      {check ? (
        <section className="section" id="stability">
          <h2>Static stability check</h2>
          <p className="sub">
            A computation from this robot&apos;s spec — support-polygon
            statics, not a simulation run and not a gate verdict. It grades
            how far the robot can tip before its centre of mass passes over
            its feet. The gate status above is unchanged by it: this robot
            is still not gated.
          </p>
          <div className="card">
            <StaticBadge check={check} lg />
            <table className="kv" style={{ marginTop: 12 }}>
              <tbody>
                <tr><th>Grade</th><td>{check.grade}</td></tr>
                <tr>
                  <th>Static tip-over angle (weakest direction)</th>
                  <td>{check.tip_angle_deg.toFixed(1)}° — {check.weakest_direction}</td>
                </tr>
                <tr>
                  <th>Weakest tip margin</th>
                  <td>
                    {check.weakest_margin_mm.toFixed(0)} mm from the
                    centre-of-mass projection to the support-polygon edge
                  </td>
                </tr>
                {stabRep ? (
                  <>
                    <tr>
                      <th>Margin as share of the body&apos;s half-extent</th>
                      <td>{stabRep.results.weakest_margin_pct.toFixed(0)}%</td>
                    </tr>
                    <tr>
                      <th>Centre-of-mass height</th>
                      <td>
                        {stabRep.inputs.com_height_m.toFixed(3)} m — ASSUMED
                        at 55% of standing height (printed in the
                        report&apos;s assumptions, never buried)
                      </td>
                    </tr>
                    <tr>
                      <th>Thresholds (v1, printed on the report)</th>
                      <td>
                        tip angle ≥ 20° STABLE · 10–20° MARGINAL ·
                        &lt; 10° UNSTABLE
                      </td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
            <p className="prov" style={{ marginTop: 12 }}>
              <span>
                <strong>Report:</strong>{" "}
                <a href={`${REPO_URL}/blob/main/${check.report}`}>
                  <code>{check.report}</code>
                </a>{" "}
                · checked {check.date} · reproduce with{" "}
                <code>robotforge stability {specFile ?? ""}</code>
              </span>
            </p>
          </div>
          {stabRep ? (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-head">
                <h3 style={{ fontSize: "var(--fs-md)" }}>How it was computed</h3>
              </div>
              <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
                {stabRep.method}
              </p>
              <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                <strong>Support model:</strong> {stabRep.inputs.support_model}
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
                <strong>Assumptions</strong> (all of them, as printed in
                the report):
              </p>
              <ul className="prov" style={{ paddingLeft: 18 }}>
                {stabRep.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {harnessRep ? (
        <HarnessSection rep={harnessRep} slug={slug} specFile={specFile} />
      ) : null}

      {specFile ? (
        <section className="section" id="take-apart">
          <h2>Take it apart</h2>
          <p className="sub">{taSub}</p>
          <div id="ta">
            <TakeApartViewer specFile={specFile} />
          </div>
        </section>
      ) : null}

      <PartsKitSection slug={slug} />

      {specFile ? (
        <section className="section" id="commands">
          <h2>Reproduce it</h2>
          <p className="sub">{cmdSub}</p>
          <div className="codeblock card" style={{ padding: 0, border: 0, background: "none" }}>
            <pre><code>{cmdLines}</code></pre>
            <CopyButton text={cmdLines} />
          </div>
        </section>
      ) : null}
    </>
  );
}
