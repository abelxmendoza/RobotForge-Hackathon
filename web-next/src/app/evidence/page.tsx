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

export const metadata: Metadata = {
  title: "Simulator test drives",
  description:
    "RobotForge gate reports: measured against ground truth at locked thresholds.",
};

export default function EvidencePage() {
  const runs = gateReports;
  return (
    <AppShell
      active="evidence"
      crumbs={[{ label: "App", href: "/garage/" }, { label: "Test drives" }]}
    >
      <HashScroller />
      <div className="page-head">
        <div>
          <div className="eyebrow">Simulator test drives</div>
          <h1>Did the robot really do what it was told?</h1>
          <p className="lede">
            Every robot gets the same test in the Gazebo simulator. Two
            robots passed, and the test caught two that didn&apos;t, even
            though their own sensors said everything was fine.
          </p>
        </div>
      </div>

      <ol className="ev-steps" aria-label="How the test works">
        <li><b>1</b><span><strong>Drive 1 m</strong> straight ahead.</span></li>
        <li><b>2</b><span><strong>Turn 90°</strong> on the spot.</span></li>
        <li><b>3</b><span><strong>Compare</strong> where it really ended up with where it was told to go, and with where it thinks it is.</span></li>
      </ol>
      <p className="faint ev-rule">
        It passes when it lands within 5% of the distance and 5° of the
        turn. Between 5 and 10 is marginal, beyond 10 fails. These limits
        are fixed and never loosened.
      </p>

      <section className="section" id="reports">
        <h2>The four test drives</h2>
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
