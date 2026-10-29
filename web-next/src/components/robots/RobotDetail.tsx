import type { ReactNode } from "react";
import type { Robot } from "@/lib/types";
import { harnessOf, robotSlug, stabilityOf } from "@/lib/data";
import { REPO_URL } from "@/components/shell/AppShell";
import Term from "@/components/shell/Term";
import {
  classPath, dexId, gateStatusOf, gradeOf, imgSrc, robotImage, specLabel,
  staticCheckOf, type GateRunFull,
} from "./shared";
import { StaticBadge, VerdictBadge } from "./badges";
import CopyButton from "./CopyButton";
import HarnessSection, { asHarnessReport, HarnessBadge } from "./HarnessSection";
import TakeApartViewer from "./takeapart/TakeApartViewer";

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
    .map((run, i) => (run.source ? { i: i + 1, source: run.source } : null))
    .filter((x): x is { i: number; source: string } => x !== null);
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
            <li key={s.i}>Run {s.i}: {s.source}</li>
          ))}
        </ul>
      ) : null}
    </>
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
  ];
  if (check) jump.push({ href: "#stability", label: "Static stability" });
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc(img.src)}
                alt={robot.name + (img.ai ? " (AI concept illustration)" : " (official image)")}
              />
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
