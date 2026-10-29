"""Rover field checks: slope climb, step climb, battery runtime.

The motion gate drives the twin on flat ground. Rover teams ask three
more questions before they buy motors and batteries: will it climb
the slope, will it get over the step, and how long will it run. These
are first-order engineering estimates from the spec's own numbers,
labelled as such — every check names its assumptions, and a check
whose inputs the spec does not carry is NOT_CHECKED with the missing
field named, never a silent pass.

Verdicts: PASS (margin at least MARGIN_OK), MARGINAL (works on paper,
little headroom), FAIL, NOT_CHECKED. They are estimates, not gate
verdicts, and change no other status.

Assumptions (the numbers a rover team would argue about first):

- Usable motor torque is USABLE_TORQUE_FRACTION of stall torque — a
  continuous-duty rule of thumb; running at stall burns motors.
- Rolling resistance coefficients per terrain (TERRAINS).
- A rigid wheel climbs a square step up to STEP_FRACTION of its
  diameter with good traction.
- Battery usable fraction per chemistry (USABLE_CAPACITY).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

from .schema import GROUND_DRIVETRAINS, RobotSpec

G = 9.81
USABLE_TORQUE_FRACTION = 0.4
STEP_FRACTION = 0.4
MARGIN_OK = 1.5
DRIVE_EFFICIENCY = 0.5      # gearbox + driver + motor, end to end
ELECTRONICS_W_DEFAULT = 5.0
MOTOR_NO_LOAD_W = 2.0       # per motor: gearbox friction + no-load current
SKID_FACTOR = 1.5           # skid-steer / tracked turns scrub energy
TERRAINS = {
    "indoor": 0.015,        # hard floor
    "outdoor": 0.05,        # pavement, packed dirt
    "rough": 0.15,          # grass, gravel, sand
}
USABLE_CAPACITY = {"lipo": 0.8, "liion": 0.8, "lifepo4": 0.9,
                   "nimh": 0.8, "lead_acid": 0.5}

PASS, MARGINAL, FAIL, NOT_CHECKED = "PASS", "MARGINAL", "FAIL", "NOT_CHECKED"


@dataclass
class RoverCheck:
    name: str
    status: str
    summary: str
    value: float | None = None
    unit: str = ""
    assumptions: list[str] = field(default_factory=list)


@dataclass
class RoverReport:
    robot: str
    terrain: str
    checks: list[RoverCheck]

    def to_dict(self) -> dict:
        return {"robot": self.robot, "terrain": self.terrain,
                "checks": [asdict(c) for c in self.checks],
                "kind": "estimate"}


def _verdict(margin: float) -> str:
    if margin >= MARGIN_OK:
        return PASS
    if margin >= 1.0:
        return MARGINAL
    return FAIL


def max_slope_deg(spec: RobotSpec, crr: float) -> float | None:
    """Steepest slope the usable wheel torque can hold, in degrees."""
    if spec.wheel is None or not spec.motor.stall_torque_nm:
        return None
    r = spec.wheel.diameter_m / 2.0
    force = (spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION
             * spec.motor.count) / r
    # force = m g (sin a + crr cos a); solve for a.
    k = force / (spec.mass_kg * G)
    rho = math.hypot(1.0, crr)
    if k >= rho:
        return 90.0
    return max(0.0, math.degrees(math.asin(k / rho) - math.atan(crr)))


def check_slope(spec: RobotSpec, slope_deg: float, crr: float) -> RoverCheck:
    name = "rover.slope_climb"
    if spec.wheel is None:
        return RoverCheck(name, NOT_CHECKED, "no wheels in this spec")
    if not spec.motor.stall_torque_nm:
        return RoverCheck(name, NOT_CHECKED,
                          "needs motor.stall_torque_nm (from the motor datasheet)")
    r = spec.wheel.diameter_m / 2.0
    a = math.radians(slope_deg)
    need = spec.mass_kg * G * (math.sin(a) + crr * math.cos(a)) * r
    have = spec.motor.stall_torque_nm * USABLE_TORQUE_FRACTION \
        * spec.motor.count
    margin = have / need if need > 0 else float("inf")
    best = max_slope_deg(spec, crr)
    return RoverCheck(
        name, _verdict(margin),
        f"{slope_deg:g}° slope needs {need:.2f} N·m at the wheels; "
        f"usable {have:.2f} N·m ({margin:.1f}× margin). "
        f"Steepest holdable slope ≈ {best:.0f}°.",
        value=round(best, 1), unit="deg",
        assumptions=[f"usable torque = {USABLE_TORQUE_FRACTION:.0%} of stall",
                     f"rolling resistance {crr:g}",
                     "traction is sufficient (no wheel slip)"])


def check_step(spec: RobotSpec, step_m: float) -> RoverCheck:
    name = "rover.step_climb"
    if spec.wheel is None:
        return RoverCheck(name, NOT_CHECKED, "no wheels in this spec")
    wheel_limit = STEP_FRACTION * spec.wheel.diameter_m
    limits = [wheel_limit]
    detail = f"wheels clear ≈ {wheel_limit * 1000:.0f} mm"
    if spec.ground_clearance_m is not None:
        limits.append(spec.ground_clearance_m)
        detail += f", belly clears {spec.ground_clearance_m * 1000:.0f} mm"
    limit = min(limits)
    margin = limit / step_m if step_m > 0 else float("inf")
    return RoverCheck(
        name, _verdict(margin),
        f"{step_m * 1000:.0f} mm step: {detail}; "
        f"limit {limit * 1000:.0f} mm ({margin:.1f}× margin).",
        value=round(limit, 4), unit="m",
        assumptions=[f"rigid wheels climb ≈ {STEP_FRACTION:.0%} of diameter",
                     "the belly must clear the step edge while crossing"])


def estimate_runtime(spec: RobotSpec, speed_mps: float, crr: float,
                     electronics_w: float) -> tuple[float, float, float]:
    """(runtime_h, energy_wh, draw_w) at a steady speed on flat ground."""
    usable = USABLE_CAPACITY.get(spec.battery.chemistry.lower(), 0.8)
    energy = spec.battery.voltage_v * spec.battery.capacity_mah / 1000.0 * usable
    skid = SKID_FACTOR if spec.drivetrain in ("skid_steer", "tracked") else 1.0
    drive_w = spec.mass_kg * G * crr * skid * speed_mps / DRIVE_EFFICIENCY
    draw = drive_w + MOTOR_NO_LOAD_W * spec.motor.count + electronics_w
    return energy / draw, energy, draw


def check_runtime(spec: RobotSpec, speed_mps: float, crr: float,
                  electronics_w: float, target_min: float) -> RoverCheck:
    name = "rover.runtime"
    hours, energy, draw = estimate_runtime(spec, speed_mps, crr, electronics_w)
    minutes = hours * 60
    margin = minutes / target_min if target_min > 0 else float("inf")
    return RoverCheck(
        name, _verdict(margin),
        f"≈ {minutes:.0f} min driving at {speed_mps:g} m/s "
        f"({energy:.0f} Wh usable, ≈ {draw:.1f} W draw) "
        f"against a {target_min:g} min target.",
        value=round(minutes, 1), unit="min",
        assumptions=[f"drive efficiency {DRIVE_EFFICIENCY:.0%}",
                     f"{MOTOR_NO_LOAD_W:g} W no-load per motor",
                     f"electronics draw {electronics_w:g} W",
                     f"skid-steer/tracked scrub ×{SKID_FACTOR:g}",
                     "flat ground, steady speed; slopes and stops cost more"])


def check_rover(spec: RobotSpec, *, slope_deg: float = 15.0,
                step_m: float = 0.05, terrain: str = "outdoor",
                speed_mps: float = 0.5, electronics_w: float = ELECTRONICS_W_DEFAULT,
                target_min: float = 30.0) -> RoverReport:
    if terrain not in TERRAINS:
        raise ValueError(f"unknown terrain {terrain!r} "
                         f"(expected {'|'.join(TERRAINS)})")
    if spec.drivetrain not in GROUND_DRIVETRAINS:
        raise ValueError(f"rover checks apply to wheeled/tracked robots; "
                         f"{spec.name} is {spec.drivetrain}")
    crr = TERRAINS[terrain]
    return RoverReport(spec.name, terrain, [
        check_slope(spec, slope_deg, crr),
        check_step(spec, step_m),
        check_runtime(spec, speed_mps, crr, electronics_w, target_min),
    ])


def format_rover_report(rep: RoverReport) -> str:
    lines = [f"Rover field checks — {rep.robot} ({rep.terrain} terrain, "
             f"estimates)"]
    for c in rep.checks:
        lines.append(f"[{c.status}] {c.name}: {c.summary}")
        for a in c.assumptions:
            lines.append(f"    assumes: {a}")
    return "\n".join(lines)


def rover_failed(rep: RoverReport) -> bool:
    return any(c.status == FAIL for c in rep.checks)
