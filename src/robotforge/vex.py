"""VEX V5 / IQ drive-train facts and the competition rulebook checks.

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


# ---------------------------------------------------------------------------
# VEX IQ (2nd generation) motor — kb.vex.com "Understanding IQ Smart
# Motor Performance": 120 rpm free speed, 0.414 N·m stall torque,
# 1.4 W peak power. No swappable cartridges; gearing is external.
# ---------------------------------------------------------------------------

IQ_MOTOR_FREE_RPM = 120.0
IQ_MOTOR_STALL_NM = 0.414
IQ_MOTOR_POWER_W = 1.4


def is_vex_iq(spec) -> bool:
    g = getattr(spec, "gearing", None)
    return bool(g and g.platform and g.platform.lower() == "vex_iq")


# ---------------------------------------------------------------------------
# Competition rulebook profiles. Mirrors web-next/src/lib/vexRules.ts
# (tests/test_vex_rules.py keeps the two in step). 2026-27 season,
# both manuals v0.2 released 2026-06-04:
#   V5RC "Override"   https://www.vexrobotics.com/override-manual
#   VIQRC "Level Up"  https://www.vexrobotics.com/level-up-manual
# Manuals change every season; every message says to check the
# current one. Rules a spec cannot answer are listed, never "passed".
# ---------------------------------------------------------------------------

_IN = 0.0254

RULEBOOKS = {
    "v5rc-2026-27": {
        "platform": "vex_v5", "competition": "V5RC", "season": "2026-27",
        "game": "Override",
        "manual": "Override game manual v0.2 (2026-06-04)",
        "size_m": (18 * _IN, 18 * _IN, 18 * _IN),   # length, width, height
        "size_text": "18 x 18 x 18 in, licence plates included",
        "motor_power_cap_w": 88.0, "drive_power_cap_w": 55.0,
        "motor_count_cap": None, "air_tanks_cap": 2,
    },
    "viqrc-2026-27": {
        "platform": "vex_iq", "competition": "VIQRC", "season": "2026-27",
        "game": "Level Up",
        "manual": "Level Up game manual v0.2 (2026-06-04)",
        "size_m": (20 * _IN, 11 * _IN, 15 * _IN),
        "size_text": "11 in wide x 20 in long x 15 in tall",
        "motor_power_cap_w": None, "drive_power_cap_w": None,
        "motor_count_cap": 6, "air_tanks_cap": 2,
    },
}

# Motors and air tanks each scoring mechanism adds (vexRules.ts MECH_HARDWARE).
MECH_HARDWARE = {"intake": (1, 0), "lift": (2, 0), "pneumatics": (0, 2)}
MECH_MOTOR_W = {"vex_v5": 11.0, "vex_iq": IQ_MOTOR_POWER_W}


def rulebook_for(spec) -> str | None:
    g = getattr(spec, "gearing", None)
    plat = (g.platform or "").lower() if g else ""
    for rid, rb in RULEBOOKS.items():
        if rb["platform"] == plat:
            return rid
    return None


def robot_envelope_m(spec) -> tuple[float, float, float]:
    """The whole robot's size, as the twin draws it: wheels sit outside
    the chassis (urdf.wheel_layout puts their centres at width/2 +
    wheel width/2), and the chassis sits ground_clearance_m off the
    floor. Wheel centres are inset by a radius, so length is the
    chassis length."""
    wheel = getattr(spec, "wheel", None)
    w = spec.width_m + (2 * wheel.width_m if wheel is not None else 0.0)
    h = spec.height_m + (spec.ground_clearance_m or 0.0)
    return spec.length_m, w, h


def rulebook_check(spec, rulebook_id: str | None = None) -> dict | None:
    """Check a VEX spec against its platform's rulebook.

    Returns {"rulebook": id, "results": [{rule, label, verdict, detail}],
    "ok": bool} or None for a spec on no VEX platform. Verdicts are
    "pass", "fail" or "unknown" (the spec does not record the input)."""
    rid = rulebook_id or rulebook_for(spec)
    if rid is None:
        return None
    rb = RULEBOOKS[rid]
    mechs = [m for m in getattr(spec, "vex_mechanisms", []) or []
             if m in MECH_HARDWARE]
    mech_motors = sum(MECH_HARDWARE[m][0] for m in mechs)
    tanks = sum(MECH_HARDWARE[m][1] for m in mechs)
    drive_motors = spec.motor.count
    g = spec.gearing
    motor_w = g.motor_power_w if g is not None else None
    r1 = lambda v: round(v * 10) / 10  # noqa: E731
    res = []

    lim_l, lim_w, lim_h = rb["size_m"]
    L, W, H = robot_envelope_m(spec)
    over = []
    if L > lim_l + 1e-6:
        over.append(f"length {r1(L / _IN):g} in")
    if W > lim_w + 1e-6:
        over.append(f"width {r1(W / _IN):g} in (wheels included)")
    if H > lim_h + 1e-6:
        over.append(f"height {r1(H / _IN):g} in (from the floor)")
    res.append({"rule": "R3", "label": "Starting size",
                "verdict": "fail" if over else "pass",
                "detail": (f"over the {rb['size_text']} limit: "
                           + ", ".join(over)) if over else
                          f"fits {rb['size_text']}"})

    if rb["motor_power_cap_w"] is not None:
        if not motor_w:
            res.append({"rule": "R10", "label": "Motor power",
                        "verdict": "unknown",
                        "detail": "gearing.motor_power_w not recorded"})
        else:
            drive_w = r1(drive_motors * motor_w)
            mech_w = r1(mech_motors * MECH_MOTOR_W[rb["platform"]])
            total = r1(drive_w + mech_w)
            cap = rb["motor_power_cap_w"]
            res.append({"rule": "R10", "label": "All motors",
                        "verdict": "pass" if total <= cap + 1e-9 else "fail",
                        "detail": f"{total:g} W of {cap:g} W"
                                  + (f" (drive {drive_w:g} W + mechanisms "
                                     f"{mech_w:g} W)" if mech_w else "")})
            dcap = rb["drive_power_cap_w"]
            res.append({"rule": "R11", "label": "Drivetrain motors",
                        "verdict": "pass" if drive_w <= dcap + 1e-9 else "fail",
                        "detail": f"{drive_motors} x {motor_w:g} W = "
                                  f"{drive_w:g} W of {dcap:g} W"})
    if rb["motor_count_cap"] is not None:
        n = drive_motors + mech_motors
        cap = rb["motor_count_cap"]
        res.append({"rule": "R9", "label": "Motors",
                    "verdict": "pass" if n <= cap else "fail",
                    "detail": f"{n} Smart Motors of {cap}"})
    res.append({"rule": "R25" if rb["platform"] == "vex_v5" else "R16",
                "label": "Air tanks",
                "verdict": "pass" if tanks <= rb["air_tanks_cap"] else "fail",
                "detail": f"{tanks} air tanks of {rb['air_tanks_cap']}"})
    return {"rulebook": rid, "results": res,
            "ok": all(r["verdict"] != "fail" for r in res)}
