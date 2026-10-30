/* Evidence — port of render_evidence() in src/robotforge/site.py and
   the generated app/evidence/index.html.
   Gate reports render from catalog/gate-reports.json (gateReports via
   @/lib/data) exactly as evidence.js rendered them client-side; the
   page is server-rendered, so the vanilla loading state-box never
   appears — the reports are in the static export.
   Per-robot verdicts, static stability and harness checks live on
   the Robots grid and each robot page; this page keeps the gate's
   rules and its reports. */

import type { Metadata } from "next";
import Link from "next/link";
import { gateReports } from "@/lib/data";
import AppShell from "@/components/shell/AppShell";
import ReportCard from "@/components/evidence/ReportCard";
import ReportStrip from "@/components/evidence/ReportStrip";
import HashScroller from "@/components/evidence/HashScroller";
import Term from "@/components/shell/Term";

export const metadata: Metadata = {
  title: "Evidence",
  description:
    "RobotForge gate reports: measured against ground truth at locked thresholds.",
};

export default function EvidencePage() {
  const runs = gateReports;
  return (
    <AppShell
      active="evidence"
      crumbs={[{ label: "App", href: "/forge/" }, { label: "Evidence" }]}
    >
      <HashScroller />
      <div className="page-head">
        <div>
          <div className="eyebrow">Evidence</div>
          <h1>Measured, not believed</h1>
          <p className="lede">
            The gate&apos;s own reports from real runs in Gazebo Sim, each
            graded against simulator ground truth.{" "}
            <Link href="/#workflow">How the test works →</Link>
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
        <h2><Term k="gate">Gate</Term> reports</h2>
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
        <p className="section-more">
          <Link href="/robots/">Every robot&apos;s verdict, static check and wiring check →</Link>
        </p>
      </section>

    </AppShell>
  );
}
