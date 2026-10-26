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

    @property
    def verdict(self) -> str:
        return max((c.verdict for c in self.checks),
                   key=lambda v: _RANK[v], default=PASS)

    def to_dict(self) -> dict:
        return {"verdict": self.verdict,
                "checks": [{"name": c.name, "commanded": c.commanded,
                            "measured": c.measured, "error": c.error,
                            "unit": c.unit, "verdict": c.verdict}
                           for c in self.checks]}


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


def evaluate_run(results: list[CheckResult]) -> GateReport:
    return GateReport(checks=list(results))
