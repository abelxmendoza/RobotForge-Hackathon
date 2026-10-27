/* The report chip strip above the report list — ported from the
   boot() renderer in assets/js/evidence.js: verdict badge, robot
   title, run subtitle, linking to the report's #run-<id> anchor. */

import type { GateReportRun } from "@/lib/types";
import { VerdictBadge } from "@/components/robots/badges";

export default function ReportStrip({ runs }: { runs: GateReportRun[] }) {
  return (
    <>
      {runs.map((r) => {
        const [title, sub] = r.title.split(" — ");
        const verdict = (r.doc as { verdict?: string } | undefined)?.verdict ?? "";
        return (
          <a className="report-chip" href={"#run-" + r.id} key={r.id}>
            <VerdictBadge status={verdict} />
            <b>{title}</b>
            <span>{sub || ""}</span>
          </a>
        );
      })}
    </>
  );
}
