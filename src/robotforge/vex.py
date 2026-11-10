"""VEX V5 drive-train facts and the V5RC motor-power check.

The numbers here are VEX's published motor ratings, not measurements
of any one robot. web-next/src/lib/drivetrain.ts carries the same
table for the Workshop's Drive train tab; tests/test_vex.py keeps the
two in step.

- V5 Smart Motor (11 W): one motor, three swappable gear cartridges.
  Stall torque scales inversely with the cartridge's free speed.
- V5 Smart Motor (5.5 W): fixed 200 rpm output, half the power.
- V5RC motor rule: the total rated power of all motors on a robot is
  capped (88 W since the 2024-25 season, e.g. 8 x 11 W). The game
  manual changes every season; the cap is a constant here so it is
  easy to update, and every message names it.
"""
from __future__ import annotations

from dataclasses import dataclass

V5RC_MOTOR_POWER_CAP_W = 88.0


@dataclass(frozen=True)
class Cartridge:
    id: str
    label: str
    ratio: str
    free_rpm: float
    stall_torque_nm: float


V5_CARTRIDGES = (
    Cartridge("red", "Red (torque)", "36:1", 100.0, 2.1),
    Cartridge("green", "Green (standard)", "18:1", 200.0, 1.05),
    Cartridge("blue", "Blue (speed)", "6:1", 600.0, 0.35),
)
V5_MOTOR_POWERS_W = (11.0, 5.5)


def cartridge_for_rpm(rpm: float) -> Cartridge | None:
    for c in V5_CARTRIDGES:
        if abs(c.free_rpm - rpm) < 1e-6:
            return c
    return None


def is_vex_v5(spec) -> bool:
    g = getattr(spec, "gearing", None)
    return bool(g and g.platform and g.platform.lower() == "vex_v5")


def drive_motor_power_w(spec) -> float | None:
    """Rated power of the drive motors the spec declares, or None."""
    g = getattr(spec, "gearing", None)
    if g is None or g.motor_power_w is None:
        return None
    return g.motor_power_w * spec.motor.count


def v5rc_budget(spec, other_motors_w: float = 0.0) -> dict | None:
    """Drive motors' share of the V5RC motor-power cap.

    The spec records drive motors only; mechanisms (intake, lift) are
    passed in as other_motors_w. Returns None when the spec is not a
    V5 robot or records no motor power.
    """
    if not is_vex_v5(spec):
        return None
    drive = drive_motor_power_w(spec)
    if drive is None:
        return None
    used = drive + other_motors_w
    return {"cap_w": V5RC_MOTOR_POWER_CAP_W, "drive_w": drive,
            "other_w": other_motors_w, "used_w": used,
            "left_w": V5RC_MOTOR_POWER_CAP_W - used,
            "ok": used <= V5RC_MOTOR_POWER_CAP_W + 1e-9}
