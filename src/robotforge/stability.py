"""Static stability check for legged robots.

The motion gate grades ground robots by driving them. Legged robots
cannot be graded that way yet, so this module computes the one piece of
evidence a spec alone can honestly support: **static** stability — how
far the robot can tip, in its weakest direction, before its centre of
mass passes over the edge of the support polygon its feet make.

Everything here is plane geometry from the spec's declared dimensions:
no simulation, no motion, no dynamics. The result is a *check*, never
a gate verdict, and the site and the catalog keep the two kinds of
evidence separate on purpose.

Model (all assumptions are printed in every report):

- Feet: a quadruped stands on four point feet placed from the body
  length/width with the same fractions the take-apart viewer uses
  (hips at 0.36 x length, knees bowed 0.045 x length, feet at
  0.44 x width). A humanoid stands in double support on two feet; the
  spec publishes no foot dimensions, so each foot is a small rectangle
  sized from the standing height with the viewer's proportions
  (length 0.115 x height, width 0.05 x height, centred 0.032 x height
  ahead of the ankle line at +-0.22 x body width).
- Centre of mass: horizontally at the centre of the body footprint;
  height ASSUMED at 55% of standing height unless the spec declares
  one (no current spec does). Mass is reported for the record — it
  does not enter the tip geometry at all.
- The support polygon is the convex hull of the foot contacts. The
  weakest-direction tip margin is the shortest distance from the CoM
  projection to a polygon edge; the static tip-over angle is
  atan(margin / CoM height) — the angle the body must rotate about
  that edge before the CoM passes over it.

Grades (v1 thresholds, printed on every report; Abel may retune):
tip angle >= 20 deg STABLE, 10-20 deg MARGINAL, < 10 deg UNSTABLE.
A projection outside the polygon is UNSTABLE at any angle.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .schema import RobotSpec

# --- model constants (the assumptions, in one place) -------------------
COM_HEIGHT_FRACTION = 0.55     # of standing height, when undeclared
QUAD_FOOT_X = 0.405            # of body length (hip 0.36 + knee bow 0.045)
QUAD_FOOT_Y = 0.44             # of body width
HUM_FOOT_Y = 0.22              # of body width, ankle line each side
HUM_FOOT_LEN = 0.115           # of standing height
HUM_FOOT_WID = 0.05            # of standing height
HUM_FOOT_FWD = 0.032           # of standing height, centre ahead of ankle

STABLE_AT_DEG = 20.0
MARGINAL_AT_DEG = 10.0

GRADES = ("STABLE", "MARGINAL", "UNSTABLE")


class StabilityError(ValueError):
    """The spec cannot support a static stability check."""


# --- plane geometry ------------------------------------------------------

def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Monotonic-chain hull, CCW, no repeated endpoint."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _edge_margins(p: tuple[float, float],
                  poly: list[tuple[float, float]]):
    """Yield (signed distance, outward unit normal) per polygon edge.

    The hull is CCW, so the interior lies to the left of each directed
    edge and the signed distance is positive for an inside point.
    """
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        length = math.hypot(ex, ey)
        if length == 0:
            continue
        # left normal of the edge direction = inward for CCW polygons
        nx, ny = -ey / length, ex / length
        dist = (p[0] - ax) * nx + (p[1] - ay) * ny
        yield dist, (-nx, -ny)


def direction_name(normal: tuple[float, float]) -> str:
    """Human name for an outward direction: +x forward, +y left."""
    nx, ny = normal
    if abs(nx) >= abs(ny) * 2.4:
        return "forward" if nx > 0 else "backward"
    if abs(ny) >= abs(nx) * 2.4:
        return "to the left" if ny > 0 else "to the right"
    fb = "forward" if nx > 0 else "backward"
    lr = "left" if ny > 0 else "right"
    return f"{fb}-{lr}"


def grade_for(margin_m: float, tip_angle_deg: float) -> str:
    if margin_m < 0:
        return "UNSTABLE"
    if tip_angle_deg >= STABLE_AT_DEG:
        return "STABLE"
    if tip_angle_deg >= MARGINAL_AT_DEG:
        return "MARGINAL"
    return "UNSTABLE"


# --- the check -----------------------------------------------------------

@dataclass
class StabilityReport:
    robot: str
    drivetrain: str
    grade: str
    tip_angle_deg: float
    weakest_margin_m: float
    weakest_margin_pct: float
    weakest_direction: str
    projection_inside: bool
    com_height_m: float
    com_projection: tuple
    support_polygon: list
    feet: list
    support_model: str
    assumptions: list
    edges: list  # of dicts: direction, margin_m, tip_angle_deg
    mass_kg: float
    length_m: float
    width_m: float
    height_m: float
    date: str | None = None

    def to_dict(self) -> dict:
        doc = {
            "check": "static_stability",
            "robot": self.robot,
            "drivetrain": self.drivetrain,
            "method": ("Support-polygon statics from the spec's declared "
                       "dimensions: convex hull of the foot contacts, "
                       "weakest-direction distance from the centre-of-mass "
                       "projection to a polygon edge, tip-over angle "
                       "atan(margin / CoM height). No simulation, no "
                       "motion — a computation, not a gate run."),
            "inputs": {
                "length_m": self.length_m, "width_m": self.width_m,
                "height_m": self.height_m, "mass_kg": self.mass_kg,
                "mass_note": ("Recorded for the record only: mass cancels "
                              "out of tip-over geometry and does not "
                              "affect the grade."),
                "support_model": self.support_model,
                "feet": [list(f) for f in self.feet],
                "support_polygon": [list(p) for p in self.support_polygon],
                "com_projection": list(self.com_projection),
                "com_height_m": self.com_height_m,
            },
            "assumptions": list(self.assumptions),
            "thresholds": {"stable_at_deg": STABLE_AT_DEG,
                           "marginal_at_deg": MARGINAL_AT_DEG,
                           "unit": "static tip-over angle, degrees"},
            "results": {
                "grade": self.grade,
                "tip_angle_deg": round(self.tip_angle_deg, 3),
                "weakest_margin_mm": round(self.weakest_margin_m * 1000, 1),
                "weakest_margin_pct": round(self.weakest_margin_pct, 1),
                "weakest_direction": self.weakest_direction,
                "projection_inside": self.projection_inside,
                "edges": [{"direction": e["direction"],
                           "margin_mm": round(e["margin_m"] * 1000, 1),
                           "tip_angle_deg": round(e["tip_angle_deg"], 3)}
                          for e in self.edges],
            },
        }
        if self.date:
            doc["date"] = self.date
        return doc


def _support_footprint(spec: RobotSpec):
    """(feet, polygon, support_model, assumptions) for a legged spec."""
    L, W, H = spec.length_m, spec.width_m, spec.height_m
    legs = spec.legs.count if spec.legs else 0
    if legs == 4:
        fx, fy = QUAD_FOOT_X * L, QUAD_FOOT_Y * W
        feet = [(fx, fy), (fx, -fy), (-fx, fy), (-fx, -fy)]
        model = ("Four point feet in static stance, placed from the body "
                 "length/width with the take-apart viewer's fractions "
                 f"(x = ±{QUAD_FOOT_X} × length, y = ±{QUAD_FOOT_Y} × width).")
        assumptions = [
            "Feet are points at the viewer's stance placement; the spec "
            "publishes no foot-placement dimensions.",
            "All four feet are on the ground (static stance, no gait).",
        ]
        return feet, convex_hull(feet), model, assumptions
    if legs == 2:
        ay = HUM_FOOT_Y * W
        fl, fw, fwd = HUM_FOOT_LEN * H, HUM_FOOT_WID * H, HUM_FOOT_FWD * H
        feet = []
        corners = []
        for side in (ay, -ay):
            cx, cy = fwd, side
            feet.append((cx, cy))
            for dx in (-fl / 2, fl / 2):
                for dy in (-fw / 2, fw / 2):
                    corners.append((cx + dx, cy + dy))
        model = ("Two feet in double support, each a rectangle "
                 f"{fl:.3f} × {fw:.3f} m (length {HUM_FOOT_LEN} × standing "
                 f"height, width {HUM_FOOT_WID} × height), centred "
                 f"{HUM_FOOT_FWD} × height ahead of the ankle line at "
                 f"±{HUM_FOOT_Y} × body width — the take-apart viewer's "
                 "proportions; the spec publishes no foot dimensions.")
        assumptions = [
            "Foot size is derived from standing height with the viewer's "
            "proportions; it is not a published dimension.",
            "Double support: both feet flat on the ground. A humanoid in "
            "single support, or mid-step, is a dynamics problem this "
            "check does not model.",
        ]
        return feet, convex_hull(corners), model, assumptions
    raise StabilityError(
        f"static stability covers legged robots with 4 legs (quadruped "
        f"stance) or 2 legs (humanoid double support); this spec declares "
        f"{legs} legs")


def check_spec(spec: RobotSpec) -> StabilityReport:
    if spec.legs is None:
        raise StabilityError(
            f"{spec.name}: not a legged robot (no legs declared) — the "
            "static stability check covers legged robots only; wheeled "
            "robots are graded by the motion gate, and flight stability "
            "is a different analysis")
    feet, polygon, model, assumptions = _support_footprint(spec)
    if len(polygon) < 3:
        raise StabilityError("support footprint degenerated to a line — "
                             "no static margin exists")
    com = (0.0, 0.0)
    com_h = COM_HEIGHT_FRACTION * spec.height_m
    assumptions = list(assumptions) + [
        "Centre of mass sits horizontally at the centre of the body "
        "footprint.",
        f"CoM height is ASSUMED at {COM_HEIGHT_FRACTION:.0%} of standing "
        "height — the spec declares no CoM height.",
        "Flat, level ground; rigid body; no payload.",
    ]
    edges = []
    weakest = None
    for dist, normal in _edge_margins(com, polygon):
        angle = math.degrees(math.atan2(dist, com_h)) if dist > 0 else 0.0
        rec = {"direction": direction_name(normal), "margin_m": dist,
               "tip_angle_deg": angle, "_normal": normal}
        edges.append(rec)
        if weakest is None or dist < weakest["margin_m"]:
            weakest = rec
    margin = weakest["margin_m"]
    inside = margin >= 0
    angle = weakest["tip_angle_deg"] if inside else 0.0
    nx, ny = weakest["_normal"]
    half_extent = (abs(nx) * spec.length_m + abs(ny) * spec.width_m) / 2
    pct = (100.0 * margin / half_extent) if half_extent > 0 else 0.0
    clean_edges = [{k: v for k, v in e.items() if not k.startswith("_")}
                   for e in edges]
    return StabilityReport(
        robot=spec.name, drivetrain=spec.drivetrain,
        grade=grade_for(margin, angle), tip_angle_deg=angle,
        weakest_margin_m=margin, weakest_margin_pct=pct,
        weakest_direction=weakest["direction"], projection_inside=inside,
        com_height_m=com_h, com_projection=com, support_polygon=polygon,
        feet=feet, support_model=model, assumptions=assumptions,
        edges=clean_edges, mass_kg=spec.mass_kg,
        length_m=spec.length_m, width_m=spec.width_m,
        height_m=spec.height_m)


def format_stability_report(rep: StabilityReport) -> str:
    d = rep.to_dict()
    r = d["results"]
    lines = [
        f"Static stability check — {rep.robot} ({rep.drivetrain})",
        "Computed from the spec's declared dimensions. This is a "
        "calculation, not a simulation run and not a gate verdict.",
        "",
        f"Grade: {rep.grade} — static tip-over angle "
        f"{rep.tip_angle_deg:.1f}° in the weakest direction "
        f"({rep.weakest_direction})",
        f"Weakest margin: {rep.weakest_margin_m * 1000:.0f} mm from the "
        f"CoM projection to the support-polygon edge "
        f"({rep.weakest_margin_pct:.0f}% of the body's half-extent in "
        "that direction)",
        f"CoM height: {rep.com_height_m:.3f} m (assumed at "
        f"{COM_HEIGHT_FRACTION:.0%} of standing height)",
        "",
        "Per-direction margins:",
    ]
    for e in rep.edges:
        lines.append(f"  {e['direction']:<14} {e['margin_m'] * 1000:6.0f} mm"
                     f"   tip angle {e['tip_angle_deg']:5.1f}°")
    lines += ["", "Assumptions:"]
    lines += [f"  - {a}" for a in rep.assumptions]
    lines += ["",
              f"Thresholds (v1): tip angle ≥ {STABLE_AT_DEG:.0f}° STABLE · "
              f"{MARGINAL_AT_DEG:.0f}–{STABLE_AT_DEG:.0f}° MARGINAL · "
              f"< {MARGINAL_AT_DEG:.0f}° UNSTABLE · projection outside "
              "the polygon is UNSTABLE at any angle."]
    return "\n".join(lines)
