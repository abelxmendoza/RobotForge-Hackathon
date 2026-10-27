"""Motion acceptance gate.

Thresholds decided by Abel, 2026-10-26:
  position error  <= 5% of commanded distance  -> PASS
                  > 10%                        -> FAIL   (between: MARGINAL)
  heading error   <= 5 degrees                 -> PASS
                  > 10 degrees                 -> FAIL   (between: MARGINAL)

A run's overall verdict is the worst of its checks. The gate is pure logic —
it judges measured results; it does not move the robot (see twin.py).
"""
from __future__ import annotations

from dataclasses import dataclass

PASS, MARGINAL, FAIL = "PASS", "MARGINAL", "FAIL"
_RANK = {PASS: 0, MARGINAL: 1, FAIL: 2}


@dataclass(frozen=True)
class Thresholds:
    position_pass_pct: float = 5.0
    position_fail_pct: float = 10.0
    heading_pass_deg: float = 5.0
    heading_fail_deg: float = 10.0


DEFAULT_THRESHOLDS = Thresholds()


@dataclass
class CheckResult:
    name: str
    commanded: float
    measured: float
    error: float          # percent for position, degrees for heading
    unit: str
    verdict: str


@dataclass
class GateReport:
    checks: list[CheckResult]
    suspects: list[dict] | None = None

    @property
    def verdict(self) -> str:
        return max((c.verdict for c in self.checks),
                   key=lambda v: _RANK[v], default=PASS)

    def to_dict(self) -> dict:
        return {"verdict": self.verdict,
                "checks": [{"name": c.name, "commanded": c.commanded,
                            "measured": c.measured, "error": c.error,
                            "unit": c.unit, "verdict": c.verdict}
                           for c in self.checks],
                "suspects": self.suspects or []}


def _band(error: float, pass_at: float, fail_at: float) -> str:
    if error <= pass_at:
        return PASS
    if error > fail_at:
        return FAIL
    return MARGINAL


def evaluate_drive(commanded_m: float, measured_m: float,
                   thresholds: Thresholds = DEFAULT_THRESHOLDS) -> CheckResult:
    if commanded_m <= 0:
        raise ValueError("commanded distance must be positive")
    pct = round(abs(measured_m - commanded_m) / commanded_m * 100.0, 3)
    return CheckResult("drive_distance", commanded_m, measured_m,
                       pct, "%",
                       _band(pct, thresholds.position_pass_pct,
                             thresholds.position_fail_pct))


def evaluate_turn(commanded_deg: float, measured_deg: float,
                  thresholds: Thresholds = DEFAULT_THRESHOLDS) -> CheckResult:
    err = abs(measured_deg - commanded_deg)
    err = round(min(err, 360.0 - err), 3)  # shortest angular distance
    return CheckResult("turn_heading", commanded_deg, measured_deg,
                       err, "deg",
                       _band(err, thresholds.heading_pass_deg,
                             thresholds.heading_fail_deg))


def evaluate_odometry_distance(truth_m: float, odom_m: float,
                               thresholds: Thresholds = DEFAULT_THRESHOLDS
                               ) -> CheckResult:
    """Odometry accuracy over the drive: what the robot reported vs what
    the simulator ground truth says actually happened."""
    if truth_m <= 0:
        raise ValueError("truth distance must be positive")
    pct = round(abs(odom_m - truth_m) / truth_m * 100.0, 3)
    return CheckResult("odometry_distance", truth_m, odom_m, pct, "%",
                       _band(pct, thresholds.position_pass_pct,
                             thresholds.position_fail_pct))


def evaluate_odometry_heading(truth_deg: float, odom_deg: float,
                              thresholds: Thresholds = DEFAULT_THRESHOLDS
                              ) -> CheckResult:
    """Odometry accuracy over the turn: reported heading change vs the
    ground-truth heading change."""
    err = abs(odom_deg - truth_deg)
    err = round(min(err, 360.0 - err), 3)
    return CheckResult("odometry_heading", truth_deg, odom_deg, err, "deg",
                       _band(err, thresholds.heading_pass_deg,
                             thresholds.heading_fail_deg))


def suspect_fields(checks: list[CheckResult]) -> list[dict]:
    """Name the spec fields a failed odometry check points at.

    A distance-only odometry error is a scale error: the odometry's wheel
    radius does not match the physical wheels. A heading-only error points
    at the track width / wheel separation the odometry integrates over.
    Both failing names both. This is a signature match, stated as a
    suspect, never as a proven root cause.
    """
    bad = {c.name for c in checks if c.verdict in (MARGINAL, FAIL)}
    suspects = []
    if "odometry_distance" in bad:
        suspects.append({
            "field": "wheel.diameter_m",
            "reason": "odometry distance disagrees with ground truth while "
                      "heading agrees — a scale error: the wheel radius "
                      "odometry uses does not match the physical wheels"})
    if "odometry_heading" in bad:
        suspects.append({
            "field": "wheel_separation (robot width / wheel track)",
            "reason": "odometry heading disagrees with ground truth — the "
                      "track width odometry integrates over does not match "
                      "the physical robot (or the wheels scrub/slip in turns)"})
    return suspects


def evaluate_run(results: list[CheckResult]) -> GateReport:
    checks = list(results)
    return GateReport(checks=checks, suspects=suspect_fields(checks))
