/* Evidence — port of render_evidence() in src/robotforge/site.py and
   the generated app/evidence/index.html.
   Gate reports render from catalog/gate-reports.json (gateReports via
   @/lib/data) exactly as evidence.js rendered them client-side; the
   page is server-rendered, so the vanilla loading state-box never
   appears — the reports are in the static export.
   The Robodex verdicts and static-stability tables are derived from
   the same catalog data site.py uses (robots via @/lib/data,
   gateStatusOf / staticCheckOf from the robots shared module).
   The harness table is the one exception: catalog/harness-reports/
   is not part of web-next's synced data, so its rows are transcribed
   verbatim from the vanilla page's rendering of those reports —
   same counts, same dates, nothing recomputed or invented. */

import type { Metadata } from "next";
import Link from "next/link";
import { gateReports, robotSlug, robots } from "@/lib/data";
import { gateStatusOf, gradeOf, staticCheckOf } from "@/components/robots/shared";
import { StaticBadge, VerdictBadge } from "@/components/robots/badges";
import { REPO_URL } from "@/components/shell/AppShell";
import ReportCard from "@/components/evidence/ReportCard";
import ReportStrip from "@/components/evidence/ReportStrip";
import HashScroller from "@/components/evidence/HashScroller";

export const metadata: Metadata = {
  title: "Evidence",
  description:
    "RobotForge gate reports: measured against ground truth at locked thresholds.",
};

interface HarnessRow {
  name: string;
  slug: string;
  clean: number;
  warn: number;
  err: number;
  partial: number;
  notChecked: number;
  date: string;
}
const HARNESS_ROWS: HarnessRow[] = [
  { name: "Andino", slug: "andino", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 34, date: "2026-10-26" },
  { name: "TurtleBot3 Burger", slug: "turtlebot3-burger", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 19, date: "2026-10-26" },
  { name: "TurtleBot3 Waffle Pi", slug: "turtlebot3-waffle-pi", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 23, date: "2026-10-26" },
  { name: "Pathfinder", slug: "pathfinder", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 21, date: "2026-10-26" },
  { name: "PX4 X500", slug: "px4-x500", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 17, date: "2026-10-26" },
  { name: "Crazyflie 2.1", slug: "crazyflie-2-1", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 8, date: "2026-10-26" },
  { name: "Mini Pupper", slug: "mini-pupper", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 8, date: "2026-10-26" },
  { name: "ROBOTIS OP3", slug: "robotis-op3", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 10, date: "2026-10-26" },
  { name: "OpenManipulator-X", slug: "openmanipulator-x", clean: 0, warn: 0, err: 0, partial: 0, notChecked: 10, date: "2026-10-26" },
];

export default function EvidencePage() {
  const runs = gateReports;
  return (
    <>
      <HashScroller />
      <div className="page-head">
        <div>
          <div className="eyebrow">Evidence</div>
          <h1>Measured, not believed</h1>
          <p className="lede">
            Every verdict is judged against simulator ground truth, where the
            robot actually went, never against its own odometry alone. These
            are the gate&apos;s own reports from real runs in Gazebo Sim,
            headless, on Oct 26, 2026.
          </p>
        </div>
      </div>

      <div className="cols">
        <div className="card">
          <div className="card-head">
            <h3 style={{ fontSize: "var(--fs-md)" }}>Locked thresholds</h3>
          </div>
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Pass</th>
                  <th>Marginal</th>
                  <th>Fail</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Distance error</td>
                  <td className="num">≤ 5%</td>
                  <td className="num">5–10%</td>
                  <td className="num">&gt; 10%</td>
                </tr>
                <tr>
                  <td>Heading error</td>
                  <td className="num">≤ 5°</td>
                  <td className="num">5–10°</td>
                  <td className="num">&gt; 10°</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 12 }}>
            Printed on every report and never quietly loosened.
          </p>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 style={{ fontSize: "var(--fs-md)" }}>How a run is graded</h3>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
            The twin is commanded to drive 1 m and turn 90°. Drive and turn are
            graded against the simulator&apos;s true pose. Odometry is graded
            against that same truth, so a robot whose sensors are wrong about
            itself can&apos;t pass. When something is off, the gate names the
            spec field to look at first.
          </p>
        </div>
      </div>

      <section className="section" id="reports">
        <h2>Gate reports</h2>
        <p className="sub">
          Two clean passes and two failures the gate caught. Each report shows
          every check, the raw measurements, the ground-truth path, and any
          suspects the gate named.
        </p>
        <div className="report-strip" id="report-strip">
          <ReportStrip runs={runs} />
        </div>
        <div id="report-list" style={{ marginTop: "var(--s5)" }}>
          {runs.map((r, i) => (
            <ReportCard key={r.id} run={r} index={i} />
          ))}
        </div>
      </section>

      <section className="section" id="robots">
        <h2>Robodex verdicts</h2>
        <p className="sub">
          The current verdict for each robot and its latest recorded run.
          Failures stay on the record exactly as measured.
        </p>
        <div className="card" style={{ padding: "8px 8px 4px" }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Verdict</th>
                  <th>Runs</th>
                  <th>Latest drive</th>
                  <th>Latest turn</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => {
                  const gs = gateStatusOf(r);
                  const best = gs.runs.length ? gs.runs[gs.runs.length - 1] : null;
                  const slug = robotSlug(r);
                  return (
                    <tr key={slug}>
                      <td>
                        <Link href={"/robots/" + slug + "/"}>{r.name}</Link>
                      </td>
                      <td>
                        <VerdictBadge status={gs.status} />
                      </td>
                      <td className="num">{gs.runs.length}</td>
                      {best &&
                      best.drive_error_pct != null &&
                      best.heading_error_deg != null ? (
                        <>
                          <td className="num">
                            <span className={"verdict-text " + gradeOf(best.drive_error_pct)}>
                              {best.drive_error_pct.toFixed(3)}%
                            </span>
                          </td>
                          <td className="num">
                            <span className={"verdict-text " + gradeOf(best.heading_error_deg)}>
                              {best.heading_error_deg.toFixed(3)}°
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="num faint">—</td>
                          <td className="num faint">—</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" id="stability-checks">
        <h2>Static stability checks</h2>
        <p className="sub">
          A different kind of evidence, kept separate from the gate reports
          above: for the legged robots, a computation from the spec — the
          support polygon its feet make, and how far the robot can tip before
          its centre of mass passes over the edge. Nothing here was simulated
          or driven, and a static check never changes a gate verdict: every
          robot below is still <strong>Not gated</strong>. Method, inputs and
          assumptions are printed in each report.
        </p>
        <div className="card" style={{ padding: "8px 8px 4px" }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Static check</th>
                  <th>Tip angle</th>
                  <th>Weakest margin</th>
                  <th>Direction</th>
                  <th>Checked</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => {
                  const c = staticCheckOf(r);
                  if (!c) return null;
                  const slug = robotSlug(r);
                  return (
                    <tr key={slug}>
                      <td>
                        <Link href={"/robots/" + slug + "/"}>{r.name}</Link>
                      </td>
                      <td>
                        <StaticBadge check={c} />
                      </td>
                      <td className="num">{c.tip_angle_deg.toFixed(1)}°</td>
                      <td className="num">{c.weakest_margin_mm.toFixed(0)} mm</td>
                      <td>{c.weakest_direction}</td>
                      <td>{c.date}</td>
                      <td>
                        <a href={REPO_URL + "/blob/main/" + c.report}>report</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" id="harness-checks">
        <h2>Harness checks</h2>
        <p className="sub">
          A third kind of evidence, kept separate from gate runs and static
          checks: electrical computations over each robot&apos;s documented
          wiring graph — voltage drop, ampacity, logic levels, rail budgets,
          connector matching. The headline is never a blanket pass; it is
          counts. A check that could not run says which data it is missing,
          and that gap list is printed in full on each robot&apos;s page: it
          is the shopping list of datasheets still to hunt.
        </p>
        <div className="card" style={{ padding: "8px 8px 4px" }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Harness checks</th>
                  <th>Clean</th>
                  <th>Warn</th>
                  <th>Err</th>
                  <th>Partial</th>
                  <th>Not checked</th>
                  <th>Date</th>
                  <th>Report</th>
                </tr>
              </thead>
              <tbody>
                {HARNESS_ROWS.map((r) => (
                  <tr key={r.slug}>
                    <td>
                      <Link href={"/robots/" + r.slug + "/"}>{r.name}</Link>
                    </td>
                    <td>
                      <span className="harness-badge">
                        Harness checks: {r.clean} clean · {r.warn} warn · {r.err}{" "}
                        err · {r.notChecked} not checked
                      </span>
                    </td>
                    <td className="num">{r.clean}</td>
                    <td className="num">{r.warn}</td>
                    <td className="num">{r.err}</td>
                    <td className="num">{r.partial}</td>
                    <td className="num">{r.notChecked}</td>
                    <td>{r.date}</td>
                    <td>
                      <a
                        href={
                          REPO_URL +
                          "/blob/main/catalog/harness-reports/" +
                          r.slug +
                          ".json"
                        }
                      >
                        report
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
