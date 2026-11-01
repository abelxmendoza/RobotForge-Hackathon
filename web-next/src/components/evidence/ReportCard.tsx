/* One recorded gate report — a port of reportHTML() + meter() from
   assets/js/evidence.js and assets/js/common.js. Every number is
   rendered from catalog/gate-reports.json via @/lib/data; formatting
   matches the vanilla helpers exactly (f3 = toFixed(3) unless a digit
   count is given, meter max 15, locked thresholds pass ≤ 5 /
   fail > 10). The verdict pill is the shared VerdictBadge, whose
   VERDICT_CLASS / VERDICT_LABEL mirror common.js.
   GateReportRun types doc/traj loosely (the JSON is the source of
   truth), so the doc's internal shape is narrowed here. */

import type { GateReportRun } from "@/lib/types";
import { VERDICT_CLASS } from "@/components/robots/shared";
import { VerdictBadge } from "@/components/robots/badges";
import TrajectoryChart, { type TrajPoints } from "./TrajectoryChart";

interface GateCheck {
  name: string;
  error: number;
  unit: string;
  verdict: string;
}
interface GateSuspect {
  field: string;
  reason: string;
}
interface GateProvenance {
  simulator: string;
  gazebo_version: string;
  physics_max_step_s: number;
  spec_sha256: string | null;
  scope: string;
}
interface GateDoc {
  verdict: string;
  provenance?: GateProvenance;
  checks: GateCheck[];
  suspects?: GateSuspect[];
  measurements: {
    drive: { truth_m: number; measured_m: number; commanded_m?: number };
    turn: { truth_deg: number; measured_deg: number; commanded_deg?: number };
    injected_wheel_radius_scale?: number;
  };
}

const CHECK_LABEL: Record<string, string> = {
  drive_distance: "Drive vs ground truth",
  turn_heading: "Turn vs ground truth",
  odometry_distance: "Odometry distance vs truth",
  odometry_heading: "Odometry heading vs truth",
};

function Meter({ check }: { check: GateCheck }) {
  const max = 15;
  const pct = (v: number) => Math.min(100, (Math.abs(v) / max) * 100);
  const unit = check.unit === "deg" ? "°" : check.unit;
  return (
    <div className="metric">
      <div className="metric-top">
        <span className="metric-label">{CHECK_LABEL[check.name] || check.name}</span>
        <VerdictBadge status={check.verdict} />
      </div>
      <div className="metric-value">
        {Number(check.error).toFixed(3)}
        <small>{unit}</small>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={
          Number(check.error).toFixed(2) + unit + " against pass 5" + unit + " and fail 10" + unit
        }
      >
        <span className="z-pass" style={{ width: pct(5) + "%" }}></span>
        <span
          className="z-marg"
          style={{ left: pct(5) + "%", width: pct(10) - pct(5) + "%" }}
        ></span>
        <span
          className={"fill " + VERDICT_CLASS[check.verdict]}
          style={{ width: pct(check.error).toFixed(1) + "%" }}
        ></span>
      </div>
      <div className="meter-scale">
        <span>0</span>
        <span>pass ≤5{unit}</span>
        <span>fail &gt;10{unit}</span>
        <span>15</span>
      </div>
    </div>
  );
}

const f3 = (n: number, d?: number) => Number(n).toFixed(d == null ? 3 : d);

/* Plain words for the gate's suspects (2026-11-01: the page is read
 * by judges and new builders, not only by robotics people). The
 * original field name stays in the technical details below. */
const SUSPECT_PLAIN: Record<string, string> = {
  "wheel.diameter_m": "The wheel size in the spec doesn't match the real wheels.",
  "wheel_separation (robot width / wheel track)":
    "The distance between the wheels is off, or the wheels slip when it turns.",
};

function Told({ label, told, did, off, verdict }: {
  label: string; told: string; did: string; off: string; verdict: string;
}) {
  return (
    <div className={"ev-told " + (VERDICT_CLASS[verdict] ?? "norun")}>
      <span className="ev-told-label">{label}</span>
      <span className="ev-told-main">Told {told} · did {did}</span>
      <span className="ev-told-off">{off} off · <VerdictBadge status={verdict} /></span>
    </div>
  );
}

export default function ReportCard({
  run,
  index,
}: {
  run: GateReportRun;
  index: number;
}) {
  const d = run.doc as unknown as GateDoc;
  const m = d.measurements;
  const check = (name: string) => d.checks.find((c) => c.name === name);
  const sensorsOk = d.checks
    .filter((c) => c.name.startsWith("odometry_"))
    .every((c) => c.verdict === "PASS");
  const [title, sub] = run.title.split(" — ");
  const head = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : title;
  const injected =
    m.injected_wheel_radius_scale && m.injected_wheel_radius_scale !== 1 ? (
      <tr>
        <th>Injected fault</th>
        <td>
          physical wheels × {m.injected_wheel_radius_scale} (odometry keeps the
          spec size)
        </td>
      </tr>
    ) : null;
  return (
    <article className="card report" id={"run-" + run.id}>
      <div className="card-head">
        <div>
          <div className="eyebrow">{title}</div>
          <h3 style={{ marginTop: 6 }}>{head}</h3>
        </div>
        <VerdictBadge status={d.verdict} lg />
      </div>
      <p className="story">{run.story}</p>
      {/* The plain summary: what it was told, what it really did (the
          simulator's ground truth), and whether its own sensors knew. */}
      <div className="ev-summary">
        <Told label="Drive" told={f3(m.drive.commanded_m ?? 1, 0) + " m"}
          did={f3(m.drive.truth_m, 2) + " m"}
          off={f3(check("drive_distance")?.error ?? 0, 1) + "%"}
          verdict={check("drive_distance")?.verdict ?? ""} />
        <Told label="Turn" told={f3(m.turn.commanded_deg ?? 90, 0) + "°"}
          did={f3(m.turn.truth_deg, 0) + "°"}
          off={f3(check("turn_heading")?.error ?? 0, 1) + "°"}
          verdict={check("turn_heading")?.verdict ?? ""} />
        <div className={"ev-told " + (sensorsOk ? "pass" : "fail")}>
          <span className="ev-told-label">Its own sensors</span>
          <span className="ev-told-main">{sensorsOk ? "Knew where it was" : "Thought it was somewhere else"}</span>
          <span className="ev-told-off">{sensorsOk ? "agreed with reality" : "the robot couldn't tell anything was wrong"}</span>
        </div>
      </div>
      {(d.suspects || []).length ? (
        <div className="ev-fix">
          <strong>What to fix</strong>
          <ul>
            {(d.suspects || []).map((s) => (
              <li key={s.field}>{SUSPECT_PLAIN[s.field] ?? s.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="report-more">
      <summary>Technical details: measurements, path and suspects</summary>
      <div className="report-grid">
        <div>
          <div className="checks">
            {d.checks.map((c) => (
              <Meter key={c.name} check={c} />
            ))}
          </div>
          <table className="kv" style={{ marginTop: 12 }}>
            <tbody>
              <tr>
                <th>Drive: truth / odometry</th>
                <td>
                  {f3(m.drive.truth_m)} m / {f3(m.drive.measured_m)} m
                </td>
              </tr>
              <tr>
                <th>Turn: truth / odometry</th>
                <td>
                  {f3(m.turn.truth_deg, 1)}° / {f3(Math.abs(m.turn.measured_deg), 1)}°
                </td>
              </tr>
              {injected}
              {d.provenance ? (
                <>
                  <tr>
                    <th>Simulator</th>
                    <td>
                      {d.provenance.simulator} {d.provenance.gazebo_version}, physics
                      step {d.provenance.physics_max_step_s * 1000} ms
                    </td>
                  </tr>
                  <tr>
                    <th>Input spec hash</th>
                    <td>
                      {d.provenance.spec_sha256 ? (
                        <code title={d.provenance.spec_sha256}>
                          {d.provenance.spec_sha256.slice(0, 12)}…
                        </code>
                      ) : (
                        "not recorded for this run"
                      )}
                    </td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
          {d.provenance ? (
            <p className="legend">Scope: {d.provenance.scope}.</p>
          ) : null}
        </div>
        <div>
          <TrajectoryChart
            id={"traj-" + index}
            points={run.traj as TrajPoints | undefined}
          />
          <p className="legend">
            White dot: start. Amber dot: where the robot actually ended up
            (ground truth).
          </p>
          {(d.suspects || []).length ? (
            <div className="suspects">
              {(d.suspects || []).map((s) => (
                <div className="callout bad" key={s.field}>
                  <span>
                    <strong>
                      Suspect: <code>{s.field}</code>
                    </strong>
                    <br />
                    {s.reason}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="callout good" style={{ marginTop: 12 }}>
              <span>
                No suspects. Odometry and ground truth agree inside tolerance
                on every check.
              </span>
            </div>
          )}
        </div>
      </div>
      </details>
    </article>
  );
}
