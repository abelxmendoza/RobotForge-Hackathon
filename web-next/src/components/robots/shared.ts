import type { Robot } from "@/lib/types";
import { assetPath } from "@/components/home/asset";

/* Mirrors of the vanilla generator's helpers (site.py / catalog.py):
   every string here is produced the way the Python code produces it,
   from the same catalog data. */

export const VERDICT_CLASS: Record<string, string> = {
  PASS: "pass", MARGINAL: "marginal", FAIL: "fail", NOT_GATED: "norun",
};
export const VERDICT_LABEL: Record<string, string> = {
  PASS: "Pass", MARGINAL: "Marginal", FAIL: "Fail", NOT_GATED: "Not gated",
};
export const STABILITY_CLASS: Record<string, string> = {
  STABLE: "stable", MARGINAL: "marginal", UNSTABLE: "unstable",
};

/* catalog.MOBILITY_TAXONOMY order (class chips on the index). */
export const MOBILITY_CLASSES = [
  "Aerial", "Ground — wheeled", "Ground — tracked",
  "Legged", "Marine", "Stationary",
] as const;

/* Locked gate thresholds: pass <= 5, fail > 10 (% and degrees). */
export function gradeOf(value: number): string {
  const v = Math.abs(value);
  return v <= 5 ? "pass" : v <= 10 ? "marginal" : "fail";
}

export function dexId(r: Robot): string {
  return `#${String(r.number).padStart(3, "0")}`;
}
export function classPath(r: Robot): string {
  return `${r.mobility_class ?? ""} · ${r.subtype ?? ""}`;
}

export interface RobotImage { src: string; caption: string; ai: boolean }
/* site.py _robot_image: official photo first; the one generated image
   (Pathfinder) is captioned as AI; a repo-local illustration path in
   image_url is used as-is. src is repo-relative — pass through
   assetPath() at render time. */
export function robotImage(r: Robot): RobotImage | null {
  if (r.image_url) return { src: r.image_url, caption: r.image_credit ?? "", ai: false };
  if (r.name === "Pathfinder") {
    return {
      src: "assets/img/pathfinder.jpg",
      caption: "AI concept illustration (muse-image-1.0). Pathfinder is a "
        + "RobotForge design, not built hardware; no photo of it exists.",
      ai: true,
    };
  }
  return null;
}
export function imgSrc(src: string): string {
  return /^(https?:)?\/\//.test(src) ? src : assetPath(src);
}

/* ---- gate status (robots.json gate_status blob) ---- */
export interface GateRunFull {
  drive_error_pct: number | null;
  heading_error_deg: number | null;
  odometry_distance_error_pct: number | null;
  odometry_heading_error_deg: number | null;
  source?: string;
}
export interface GateStatusFull {
  status: string;
  runs: GateRunFull[];
  note?: string;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
export function gateStatusOf(r: Robot): GateStatusFull {
  const gs = r.gate_status;
  if (typeof gs === "string") return { status: gs, runs: [] };
  if (gs && typeof gs === "object") {
    const o = gs as unknown as Record<string, unknown>;
    const runsRaw = Array.isArray(o.runs) ? o.runs : [];
    const runs: GateRunFull[] = runsRaw.map((run) => {
      const q = (run ?? {}) as Record<string, unknown>;
      return {
        drive_error_pct: numOrNull(q.drive_error_pct),
        heading_error_deg: numOrNull(q.heading_error_deg),
        odometry_distance_error_pct: numOrNull(q.odometry_distance_error_pct),
        odometry_heading_error_deg: numOrNull(q.odometry_heading_error_deg),
        source: typeof q.source === "string" ? q.source : undefined,
      };
    });
    return {
      status: typeof o.status === "string" ? o.status : "NOT_GATED",
      runs,
      note: typeof o.note === "string" ? o.note : undefined,
    };
  }
  return { status: "NOT_GATED", runs: [] };
}

/* ---- static stability check (robots.json checks blob) ---- */
export interface StaticCheck {
  type: string;
  date: string;
  report: string;
  grade: string;
  tip_angle_deg: number;
  weakest_margin_mm: number;
  weakest_direction: string;
}
export function staticCheckOf(r: Robot): StaticCheck | null {
  const checks = (r as Record<string, unknown>).checks;
  if (!Array.isArray(checks)) return null;
  for (const c of checks) {
    const o = (c ?? {}) as Record<string, unknown>;
    if (o.type === "static_stability") {
      return {
        type: "static_stability",
        date: String(o.date ?? ""),
        report: String(o.report ?? ""),
        grade: String(o.grade ?? ""),
        tip_angle_deg: typeof o.tip_angle_deg === "number" ? o.tip_angle_deg : 0,
        weakest_margin_mm: typeof o.weakest_margin_mm === "number" ? o.weakest_margin_mm : 0,
        weakest_direction: String(o.weakest_direction ?? ""),
      };
    }
  }
  return null;
}

/* Python str.capitalize() over the underscore-spaced key (spec table
   labels): first letter up, the REST down — "DOF" would become "Dof",
   exactly as the vanilla page renders it. */
export function specLabel(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/* ---- parts catalogue (site.py _parts_catalog) ---- */
export const PART_CLASS_LABEL: Record<string, string> = {
  sbc: "single-board computers",
  cables_connectors: "cables & connectors",
  cameras_sensors: "cameras & sensors",
  safety_protection: "safety & protection",
  memory_storage: "memory & storage",
  propulsion_air: "air propulsion",
};
export function partClassLabel(cls: string): string {
  return PART_CLASS_LABEL[cls] ?? cls.replace(/_/g, " ");
}

/* Python str() of a spec value. Integral floats print with their .0
   in the vanilla catalogue ("voltage v: 12.0"); the keys that carry
   integral floats in parts.json are known and enumerated here. */
const INTEGRAL_FLOAT_KEYS = new Set(["voltage_v", "output_v", "logic_v", "pitch_in"]);
export function pyStr(v: unknown, key?: string): string {
  if (Array.isArray(v)) return v.map((x) => pyStr(x)).join(" / ");
  if (typeof v === "number") {
    if (key && INTEGRAL_FLOAT_KEYS.has(key) && Number.isInteger(v)) return v.toFixed(1);
    return String(v);
  }
  return String(v ?? "");
}
export function partSpecsText(specs: Record<string, unknown> | undefined): string {
  if (!specs) return "";
  return Object.entries(specs)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${pyStr(v, k)}`)
    .join(", ");
}
export function partHaystack(p: {
  name: string; id: string; part_class: string; blurb?: string; used_for?: string;
}): string {
  return [p.name, p.id, p.part_class, p.blurb ?? "", p.used_for ?? ""]
    .join(" ").toLowerCase();
}
