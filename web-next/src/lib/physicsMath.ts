/* Pure math for the in-browser physics checks — no three.js, no
 * Rapier, no DOM. The engine (physicsEngine.ts) reduces a parsed
 * URDF to plain data (link masses with world-space centres of mass,
 * collision shapes as unit-space kinds + column-major 4x4 matrices)
 * and everything computed from that data lives here, so the repo's
 * node-driven tests exercise exactly the code the page runs.
 *
 * Frames: URDF frame throughout — Z is up, metres, kilograms.
 * Matrices are column-major number[16], the layout three.js
 * Matrix4.elements uses, so the engine can hand them over verbatim. */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
export type Mat4 = number[];

export function matTransformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [x, y, z] = v;
  // t = 2 * cross(q.xyz, v); v' = v + qw * t + cross(q.xyz, t)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/* ---- mass properties ------------------------------------------------ */

export interface LinkMass {
  name: string;
  mass: number;
  /** World-space centre of mass of this link (its URDF inertial
   *  origin carried through the joint chain at the zero pose). */
  com: Vec3;
}

export function totalMass(links: LinkMass[]): number {
  return links.reduce((s, l) => s + l.mass, 0);
}

export function centerOfMass(links: LinkMass[]): Vec3 | null {
  const m = totalMass(links);
  if (m <= 0) return null;
  const acc: Vec3 = [0, 0, 0];
  for (const l of links) {
    acc[0] += l.mass * l.com[0];
    acc[1] += l.mass * l.com[1];
    acc[2] += l.mass * l.com[2];
  }
  return [acc[0] / m, acc[1] / m, acc[2] / m];
}

/* Mass audit: the URDF's own sum against the catalogue's stated
 * figure. The 5% band is printed wherever the result is shown. */
export const MASS_AGREE_PCT = 5;
export function massAudit(
  urdfKg: number,
  catalogKg: number | null | undefined,
): { deltaPct: number; agrees: boolean } | null {
  if (catalogKg === null || catalogKg === undefined || catalogKg <= 0) return null;
  const deltaPct = ((urdfKg - catalogKg) / catalogKg) * 100;
  return { deltaPct, agrees: Math.abs(deltaPct) <= MASS_AGREE_PCT };
}

/* ---- collision-shape surface sampling ------------------------------- */

/* A collision shape reduced to a unit-space kind + world matrix.
 * three.js builds URDF primitives as unit geometry (box 1x1x1,
 * sphere r=1, cylinder r=1 h=1 with its axis on +Y) under a scaled
 * mesh, so sampling the unit shape through the mesh's world matrix
 * gives exact surface points for all three. "points" carries
 * pre-transformed samples (mesh-collider bounding boxes). */
export type ShapeSamples =
  | { kind: "box" | "sphere" | "cylinder"; matrix: Mat4 }
  | { kind: "points"; points: Vec3[] };

export function sampleShape(s: ShapeSamples): Vec3[] {
  if (s.kind === "points") return s.points.map((p) => [...p] as Vec3);
  const pts: Vec3[] = [];
  const T = (p: Vec3) => matTransformPoint(s.matrix, p);
  if (s.kind === "box") {
    for (const sx of [-0.5, 0.5])
      for (const sy of [-0.5, 0.5])
        for (const sz of [-0.5, 0.5]) pts.push(T([sx, sy, sz]));
  } else if (s.kind === "sphere") {
    pts.push(T([0, 0, -1]));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pts.push(T([Math.cos(a) * Math.SQRT1_2, Math.sin(a) * Math.SQRT1_2, -Math.SQRT1_2]));
      pts.push(T([Math.cos(a), Math.sin(a), 0]));
    }
    pts.push(T([0, 0, 1]));
  } else {
    // cylinder: axis +Y in unit space; both cap rims + cap centres
    for (const cy of [-0.5, 0.5]) {
      pts.push(T([0, cy, 0]));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push(T([Math.cos(a), cy, Math.sin(a)]));
      }
    }
  }
  return pts;
}

/* ---- support polygon + static stability ----------------------------- */

export type Pt2 = [number, number];

/** Monotonic-chain convex hull, CCW, no repeated endpoint. */
export function convexHull2D(points: Pt2[]): Pt2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq: Pt2[] = [];
  for (const p of pts) {
    const last = uniq[uniq.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) uniq.push(p);
  }
  if (uniq.length <= 2) return uniq;
  const cross = (o: Pt2, a: Pt2, b: Pt2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt2[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt2[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function distToSegment(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return Math.hypot(ex, ey);
}

export interface StabilityResult {
  /** Signed distance from the CoM projection to the nearest polygon
   *  edge: positive inside, negative outside. */
  marginM: number;
  inside: boolean;
  /** Static tip-over angle about the weakest edge:
   *  atan(margin / CoM height) — the model of the Python check. */
  tipAngleDeg: number | null;
  hull: Pt2[];
  contacts: Pt2[];
}

/* Contacts = shape samples within eps of the model's lowest point,
 * projected to the ground plane. The support polygon is their hull.
 * A hull of <3 points cannot hold anything: margin is then the
 * distance to the point/segment, and inside only on it. */
export function staticStability(
  samples: Vec3[],
  com: Vec3,
  contactEpsM = 0.004,
): StabilityResult | null {
  if (!samples.length) return null;
  const minZ = Math.min(...samples.map((p) => p[2]));
  const contactPts: Pt2[] = samples
    .filter((p) => p[2] <= minZ + contactEpsM)
    .map((p) => [p[0], p[1]] as Pt2);
  const hull = convexHull2D(contactPts);
  const proj: Pt2 = [com[0], com[1]];
  if (hull.length === 0) return null;
  if (hull.length === 1) {
    const d = Math.hypot(proj[0] - hull[0][0], proj[1] - hull[0][1]);
    return { marginM: -d, inside: false, tipAngleDeg: null, hull, contacts: contactPts };
  }
  let minDist = Infinity;
  let inside: boolean;
  if (hull.length === 2) {
    minDist = distToSegment(proj, hull[0], hull[1]);
    inside = false;
  } else {
    // CCW hull: inside iff the point is left of (or on) every edge.
    inside = true;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const cr = (b[0] - a[0]) * (proj[1] - a[1]) - (b[1] - a[1]) * (proj[0] - a[0]);
      if (cr < -1e-12) inside = false;
      minDist = Math.min(minDist, distToSegment(proj, a, b));
    }
  }
  const marginM = inside ? minDist : -minDist;
  const comHeight = com[2] - minZ;
  const tipAngleDeg =
    inside && comHeight > 0 ? (Math.atan2(marginM, comHeight) * 180) / Math.PI : null;
  return { marginM, inside, tipAngleDeg, hull, contacts: contactPts };
}

/* ---- settle-test interpretation ------------------------------------- */

/** Angle between the body's rotated +Z axis and the world's +Z. */
export function tiltDegFromQuat(q: Quat): number {
  const up = rotateByQuat(q, [0, 0, 1]);
  const c = Math.max(-1, Math.min(1, up[2]));
  return (Math.acos(c) * 180) / Math.PI;
}

export type SettleVerdict = "stands" | "settles-tilted" | "topples";

export function settleVerdict(tiltDeg: number): SettleVerdict {
  if (tiltDeg < 10) return "stands";
  if (tiltDeg < 45) return "settles-tilted";
  return "topples";
}
