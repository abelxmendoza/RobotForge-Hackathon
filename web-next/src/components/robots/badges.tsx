import { STABILITY_CLASS, VERDICT_CLASS, VERDICT_LABEL, type StaticCheck } from "./shared";

/* site.py verdict_badge: the pill. Status comes only from recorded
   gate data — a robot with no runs is NOT_GATED and says so. */
export function VerdictBadge({ status, lg = false }: { status: string; lg?: boolean }) {
  const cls = VERDICT_CLASS[status] ?? "norun";
  const label = VERDICT_LABEL[status] ?? status;
  return <span className={`verdict ${cls}${lg ? " lg" : ""}`}>{label}</span>;
}

/* site.py static_badge: dashed steel-blue, worded as a computation —
   it can never be read as a gate verdict. Tip margin rounds the way
   Python's f"{v:.0f}" renders these values. */
export function StaticBadge({ check, lg = false }: { check: StaticCheck; lg?: boolean }) {
  const cls = STABILITY_CLASS[check.grade] ?? "";
  return (
    <span className={`static-badge ${cls}${lg ? " lg" : ""}`}>
      Static check: {check.grade} — tip margin {check.tip_angle_deg.toFixed(0)}°
    </span>
  );
}
