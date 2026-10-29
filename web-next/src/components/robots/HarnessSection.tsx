import { REPO_URL } from "@/components/shell/AppShell";
import Term from "@/components/shell/Term";

/* site.py harness_badge + _harness_section: a third evidence kind,
   kept apart from gate verdicts and static checks. The badge and the
   section print the report's own counts — never a blanket pass —
   plus its findings and, just as prominently, the missing-input list.
   Every value comes from catalog/harness-reports/<slug>.json via
   @/lib/data's harnessOf(); nothing is computed or invented here. */

export interface HarnessCounts { CHECKED: number; PARTIAL: number; NOT_CHECKED: number }
export interface HarnessMissing { input: string; count: number; subjects: string[] }
export interface HarnessFinding { severity: string; message: string }
export interface HarnessReport {
  headline: string;
  date?: string;
  findings?: HarnessFinding[];
  summary: {
    checked_clean: number;
    findings: { WARN: number; ERROR: number; INFO: number };
    states: { CHECKED: number; PARTIAL: number; NOT_CHECKED: number };
    by_check: Record<string, HarnessCounts>;
    missing_inputs: HarnessMissing[];
  };
}

/* Narrow a parsed harness doc to the fields the section renders.
   Returns null when the doc has no summary (not a harness report). */
export function asHarnessReport(
  doc: Record<string, unknown> | undefined,
): HarnessReport | null {
  if (!doc || typeof doc !== "object") return null;
  const summary = (doc as { summary?: unknown }).summary;
  if (!summary || typeof summary !== "object") return null;
  return doc as unknown as HarnessReport;
}

/* site.py harness_badge: dashed amber, counts only — the text is the
   summary's own counts, so the badge cannot drift from the report. */
export function HarnessBadge({ rep, lg = false }: { rep: HarnessReport; lg?: boolean }) {
  const s = rep.summary;
  return (
    <span className={`harness-badge${lg ? " lg" : ""}`}>
      Harness checks: {s.checked_clean} clean · {s.findings.WARN} warn ·{" "}
      {s.findings.ERROR} err · {s.states.NOT_CHECKED} not checked
    </span>
  );
}

export default function HarnessSection({ rep, slug, specFile }:
  { rep: HarnessReport; slug: string; specFile?: string }) {
  const s = rep.summary;
  const reportPath = `catalog/harness-reports/${slug}.json`;
  const findings = rep.findings ?? [];
  const missing = s.missing_inputs;
  return (
    <section className="section" id="harness">
      <h2><Term k="harness">Harness</Term> checks</h2>
      <p className="sub">
        Electrical checks over this robot&apos;s documented wiring. Not a
        simulation; the headline is counts, never a blanket pass.
      </p>
      <div className="card">
        <HarnessBadge rep={rep} lg />
        <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
          {rep.headline}
        </p>
        {/* The per-check table and the missing-data list are long and
            mostly "not checked"; they fold behind the counts above. */}
        <details className="report-more">
        <summary>Check-by-check counts and missing data</summary>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data">
            <thead>
              <tr><th>Check</th><th>Checked</th><th>Partial</th><th>Not checked</th></tr>
            </thead>
            <tbody>
              {Object.entries(s.by_check).map(([name, counts]) => (
                <tr key={name}>
                  <td>{name.replace(/_/g, " ")}</td>
                  <td className="num">{counts.CHECKED}</td>
                  <td className="num">{counts.PARTIAL}</td>
                  <td className="num">{counts.NOT_CHECKED}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {findings.length ? (
          <>
            <p style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
              <strong>Findings</strong> ({findings.length}):
            </p>
            <ul className="prov" style={{ paddingLeft: 18 }}>
              {findings.map((f, i) => (
                <li key={i}><strong>[{f.severity}]</strong> {f.message}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
            Findings: none — the inputs that could be checked raised
            nothing. That is not the same as everything being checked;
            the counts above say how much was.
          </p>
        )}
        {missing.length ? (
          <>
            <p style={{ fontSize: "var(--fs-sm)", marginTop: 12 }}>
              <strong>Missing data</strong> — the datasheets still to
              hunt. A check that could not run says what it needs:
            </p>
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data">
                <thead>
                  <tr><th>Missing input</th><th>Blocks</th><th>Needed by</th></tr>
                </thead>
                <tbody>
                  {missing.map((m, i) => (
                    <tr key={i}>
                      <td><code>{m.input}</code></td>
                      <td className="num">{m.count}</td>
                      <td>
                        {m.subjects.slice(0, 4).join(", ")}
                        {m.subjects.length > 4 ? " …" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        </details>
        <p className="prov" style={{ marginTop: 12 }}>
          <span>
            <strong>Report:</strong>{" "}
            <a href={`${REPO_URL}/blob/main/${reportPath}`}>
              <code>{reportPath}</code>
            </a>{" "}
            · checked {rep.date ?? ""} · reproduce with{" "}
            <code>robotforge harness {specFile ?? ""}</code>
          </span>
        </p>
      </div>
    </section>
  );
}
