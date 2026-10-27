"""Starter kinds: a custom robot begins from a body plan, not a
blank page.

A kind is a reference robot (or class template) plus a short
parameter sheet. The resolver turns kind + size preset + overrides
into a spec dict that flows through the existing RobotSpec
validation untouched — a starter spec that fails validation is
refused with the validator's own findings, never shipped quietly.

Defaults are real numbers from real robots: the differential
kind IS the TurtleBot3 Burger's gated spec, the skid-steer kind
IS Pathfinder's. Kinds whose gate pack does not exist
(quadcopter, arm) resolve to a BOM-level profile instead of a
spec — the profile says CATALOGUE ONLY in its own fields, and the
resolver never dresses one up as a gateable spec.

Parameter units are the units a person thinks in (mm, mAh, kg);
the resolver converts to the spec's SI fields. Derived geometry
(wheel separation, axle placement, caster size, inertia) is the
twin's job and is never a parameter.
"""
from __future__ import annotations

import copy

from .schema import RobotSpec, SpecError
from .validate import has_errors, validate

LIPO_CELL_V = 3.7


class KindError(Exception):
    """Unknown kind/parameter, out-of-range value, or a starter
    spec that fails validation."""


def _p(key, label, unit, default, lo, hi, *, path=None, apply=None,
       ptype="float", choices=None, where="spec"):
    return {"key": key, "label": label, "unit": unit,
            "default": default, "min": lo, "max": hi, "path": path,
            "apply": apply, "type": ptype, "choices": choices,
            "where": where}


def _set_path(spec: dict, path: str, value) -> None:
    node = spec
    parts = path.split(".")
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


def _apply_cells(spec: dict, value) -> None:
    spec["battery"]["voltage_v"] = round(value * LIPO_CELL_V, 1)


def _apply_decks(spec: dict, value) -> None:
    # Burger geometry: a ~50 mm base zone + ~71 mm per deck
    # reproduces the real robot's 192 mm at the default 2 decks.
    spec["height_m"] = round(0.05 + 0.071 * value, 3)


def _apply_payload(spec: dict, value) -> None:
    spec["mass_kg"] = round(spec["mass_kg"] + value, 3)


_APPLIERS = {"cells": _apply_cells, "decks": _apply_decks,
             "payload": _apply_payload}

_BURGER_CORE = {
    "drivetrain": "differential",
    "length_m": 0.178, "width_m": 0.138, "height_m": 0.192,
    "mass_kg": 0.93, "ground_clearance_m": 0.02,
    "wheel": {"diameter_m": 0.066, "width_m": 0.022, "count": 2,
              "driven": True},
    "motor": {"kind": "dc_gearmotor", "count": 2, "voltage_v": 11.1,
              "stall_torque_nm": 0.3},
    "battery": {"chemistry": "lipo", "voltage_v": 11.1,
                "capacity_mah": 1800},
    "sensors": [{"kind": "lidar_2d", "position": "top",
                 "range_m": 3.5}],
}

_PATHFINDER_CORE = {
    "drivetrain": "skid_steer",
    "length_m": 0.42, "width_m": 0.31, "height_m": 0.18,
    "mass_kg": 3.4, "ground_clearance_m": 0.035,
    "wheel": {"diameter_m": 0.1, "width_m": 0.032, "count": 4,
              "driven": True},
    "motor": {"kind": "dc_gearmotor", "count": 4, "voltage_v": 12.0,
              "stall_torque_nm": 0.8},
    "battery": {"chemistry": "lipo", "voltage_v": 14.8,
                "capacity_mah": 5200},
    "sensors": [{"kind": "ultrasonic", "position": "front",
                 "range_m": 3.0},
                {"kind": "imu", "position": "center",
                 "range_m": None}],
}

_ACKERMANN_CORE = {
    "drivetrain": "ackermann",
    "length_m": 0.40, "width_m": 0.21, "height_m": 0.14,
    "mass_kg": 2.2, "ground_clearance_m": 0.025,
    "wheel": {"diameter_m": 0.09, "width_m": 0.03, "count": 4,
              "driven": True},
    "motor": {"kind": "dc_gearmotor", "count": 1, "voltage_v": 11.1,
              "stall_torque_nm": 0.4},
    "battery": {"chemistry": "lipo", "voltage_v": 11.1,
                "capacity_mah": 2200},
    "sensors": [{"kind": "imu", "position": "center",
                 "range_m": None}],
}


KINDS: dict[str, dict] = {
    "differential": {
        "label": "Differential rover",
        "one_liner": "Two driven wheels + caster support — the "
                     "Burger pattern, generalized.",
        "gate_pack": "live",
        "reference": "TurtleBot3 Burger (specimen #002, gated)",
        "base": _BURGER_CORE,
        "default_name": "my-differential-rover",
        "locked": ["2 driven wheels on one axle", "caster support",
                   "DiffDrive twin"],
        "params": [
            _p("wheel_diameter_mm", "Wheel diameter", "mm", 66, 40,
               150, path="wheel.diameter_m"),
            _p("wheel_width_mm", "Wheel width", "mm", 22, 15, 40,
               path="wheel.width_m"),
            _p("body_length_mm", "Body length", "mm", 178, 120, 450,
               path="length_m"),
            _p("body_width_mm", "Body width", "mm", 138, 100, 400,
               path="width_m"),
            _p("decks", "Decks (stacked plates)", "", 2, 1, 3,
               apply="decks", ptype="int"),
            _p("ground_clearance_mm", "Ground clearance", "mm", 20,
               10, 60, path="ground_clearance_m"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 3, 3, 4,
               apply="cells", ptype="int"),
            _p("battery_capacity_mah", "Battery capacity", "mAh",
               1800, 500, 10000, path="battery.capacity_mah",
               ptype="int"),
            _p("mass_kg", "Total mass (no payload)", "kg", 0.93, 0.2,
               25, path="mass_kg"),
            _p("payload_kg", "Payload margin", "kg", 0, 0, 10,
               apply="payload"),
        ],
        "presets": {
            "S": {"wheel_diameter_mm": 50, "body_length_mm": 150,
                  "body_width_mm": 120},
            "M": {},
            "L": {"wheel_diameter_mm": 100, "body_length_mm": 300,
                  "body_width_mm": 240, "decks": 3},
        },
    },
    "skid-steer": {
        "label": "Skid-steer rover",
        "one_liner": "Four driven wheels, steered by skidding — "
                     "the Pathfinder pattern.",
        "gate_pack": "live",
        "reference": "Pathfinder (gated example; its turn check "
                     "fails on scrub, honestly)",
        "base": _PATHFINDER_CORE,
        "default_name": "my-skid-steer-rover",
        "locked": ["4 driven wheels as two DiffDrive pairs",
                   "skid steering (turns scrub — the gate shows it)"],
        "params": [
            _p("wheel_diameter_mm", "Wheel diameter", "mm", 100, 60,
               200, path="wheel.diameter_m"),
            _p("wheel_width_mm", "Wheel width", "mm", 32, 20, 60,
               path="wheel.width_m"),
            _p("body_length_mm", "Body length", "mm", 420, 250, 700,
               path="length_m"),
            _p("body_width_mm", "Body width", "mm", 310, 200, 500,
               path="width_m"),
            _p("height_mm", "Body height", "mm", 180, 100, 400,
               path="height_m"),
            _p("ground_clearance_mm", "Ground clearance", "mm", 35,
               15, 80, path="ground_clearance_m"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 4, 4, 6,
               apply="cells", ptype="int"),
            _p("battery_capacity_mah", "Battery capacity", "mAh",
               5200, 500, 10000, path="battery.capacity_mah",
               ptype="int"),
            _p("mass_kg", "Total mass (no payload)", "kg", 3.4, 0.2,
               25, path="mass_kg"),
            _p("payload_kg", "Payload margin", "kg", 0, 0, 10,
               apply="payload"),
        ],
        "presets": {
            "S": {"wheel_diameter_mm": 80, "body_length_mm": 320,
                  "body_width_mm": 240},
            "M": {},
            "L": {"wheel_diameter_mm": 150, "body_length_mm": 600,
                  "body_width_mm": 450, "mass_kg": 6},
        },
    },
    "mecanum": {
        "label": "Mecanum rover",
        "one_liner": "Skid-steer body on mecanum rollers — "
                     "drives sideways, at a price.",
        "gate_pack": "partial",
        "gate_note": "Gate grades drive + turn only; strafe is not "
                     "gated, and mecanum odometry is unreliable by "
                     "design.",
        "reference": "Skid-steer body plan + mecanum wheels",
        "base": {**_PATHFINDER_CORE, "drivetrain": "mecanum"},
        "default_name": "my-mecanum-rover",
        "locked": ["4 mecanum wheels", "drive + turn gate only"],
        "params": [
            _p("wheel_diameter_mm", "Wheel diameter", "mm", 100, 60,
               200, path="wheel.diameter_m"),
            _p("wheel_width_mm", "Wheel width", "mm", 32, 20, 60,
               path="wheel.width_m"),
            _p("body_length_mm", "Body length", "mm", 420, 250, 700,
               path="length_m"),
            _p("body_width_mm", "Body width", "mm", 310, 200, 500,
               path="width_m"),
            _p("height_mm", "Body height", "mm", 180, 100, 400,
               path="height_m"),
            _p("ground_clearance_mm", "Ground clearance", "mm", 35,
               15, 80, path="ground_clearance_m"),
            _p("roller_config", "Roller configuration", "", "X",
               None, None, ptype="choice", choices=["X", "O"],
               where="extras"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 4, 4, 6,
               apply="cells", ptype="int"),
            _p("battery_capacity_mah", "Battery capacity", "mAh",
               5200, 500, 10000, path="battery.capacity_mah",
               ptype="int"),
            _p("mass_kg", "Total mass (no payload)", "kg", 3.4, 0.2,
               25, path="mass_kg"),
            _p("payload_kg", "Payload margin", "kg", 0, 0, 10,
               apply="payload"),
        ],
        "presets": {},
    },
    "tracked": {
        "label": "Tracked rover",
        "one_liner": "Tracks for rough ground, on the skid-steer "
                     "body plan.",
        "gate_pack": "partial",
        "gate_note": "The twin approximates tracks as skid-steer "
                     "wheel pairs: scrub is representative, track "
                     "slip is not simulated.",
        "reference": "Skid-steer body plan, tracks approximated",
        "base": {**_PATHFINDER_CORE, "drivetrain": "tracked"},
        "default_name": "my-tracked-rover",
        "locked": ["twin models tracks as skid-steer wheel pairs"],
        "params": [
            _p("sprocket_diameter_mm", "Sprocket diameter", "mm", 80,
               50, 160, path="wheel.diameter_m"),
            _p("track_width_mm", "Track width", "mm", 40, 25, 80,
               path="wheel.width_m"),
            _p("body_length_mm", "Body length (≈ track contact)",
               "mm", 420, 250, 700, path="length_m"),
            _p("body_width_mm", "Body width", "mm", 310, 200, 500,
               path="width_m"),
            _p("height_mm", "Body height", "mm", 180, 100, 400,
               path="height_m"),
            _p("ground_clearance_mm", "Ground clearance", "mm", 35,
               15, 80, path="ground_clearance_m"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 4, 4, 6,
               apply="cells", ptype="int"),
            _p("battery_capacity_mah", "Battery capacity", "mAh",
               5200, 500, 10000, path="battery.capacity_mah",
               ptype="int"),
            _p("mass_kg", "Total mass (no payload)", "kg", 3.4, 0.2,
               25, path="mass_kg"),
            _p("payload_kg", "Payload margin", "kg", 0, 0, 10,
               apply="payload"),
        ],
        "presets": {},
    },
    "ackermann": {
        "label": "RC car (Ackermann)",
        "one_liner": "One drive motor, real steering geometry up "
                     "front.",
        "gate_pack": "partial",
        "gate_note": "The twin grades drive/turn with the 4-wheel "
                     "approximation, not true Ackermann geometry.",
        "reference": "RC car class template",
        "base": _ACKERMANN_CORE,
        "default_name": "my-rc-car",
        "locked": ["1 drive motor + steering servo (BOM)",
                   "4 wheels, front steering"],
        "params": [
            _p("wheel_diameter_mm", "Wheel diameter", "mm", 90, 60,
               130, path="wheel.diameter_m"),
            _p("body_length_mm", "Body length (≈ wheelbase + wheel Ø)",
               "mm", 400, 200, 500, path="length_m"),
            _p("body_width_mm", "Track width (body width)", "mm", 210,
               140, 300, path="width_m"),
            _p("height_mm", "Body height", "mm", 140, 80, 300,
               path="height_m"),
            _p("ground_clearance_mm", "Ground clearance", "mm", 25,
               10, 60, path="ground_clearance_m"),
            _p("max_steer_deg", "Max steering angle", "deg", 30, 15,
               40, where="extras"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 3, 3, 4,
               apply="cells", ptype="int"),
            _p("battery_capacity_mah", "Battery capacity", "mAh",
               2200, 500, 10000, path="battery.capacity_mah",
               ptype="int"),
            _p("mass_kg", "Total mass (no payload)", "kg", 2.2, 0.2,
               25, path="mass_kg"),
            _p("payload_kg", "Payload margin", "kg", 0, 0, 10,
               apply="payload"),
        ],
        "presets": {},
    },
    "quadcopter": {
        "label": "Quadcopter",
        "one_liner": "Four motors, props, a flight controller — "
                     "parts and prints, no gate yet.",
        "gate_pack": "catalogue-only",
        "gate_note": "No flight gate pack exists; this kind drives "
                     "the catalogue, inventory and print kit only.",
        "reference": "Quadcopter class template",
        "base": None,
        "default_name": "my-quadcopter",
        "locked": ["BOM-level kind — no spec, no twin, no gate"],
        "params": [
            _p("frame_wheelbase_mm", "Frame wheelbase (motor to "
               "motor, diagonal)", "mm", 220, 100, 450,
               where="profile"),
            _p("prop_in", "Propeller size", "in", 5, 3, 10,
               where="profile"),
            _p("battery_cells", "Battery cells (LiPo)", "S", 4, 3, 6,
               ptype="int", where="profile"),
            _p("motor_kv", "Motor KV", "KV", 1960, 800, 2800,
               ptype="int", where="profile"),
        ],
        "presets": {},
        "bom_hints": ["4× brushless motors + spares",
                      "4-in-1 ESC (BLHeli_S class)",
                      "flight controller (F405 class)",
                      "props ×4 + spares", "frame + arms (printable)"],
    },
    "arm": {
        "label": "Robot arm",
        "one_liner": "A chain of joint servos with a gripper — "
                     "parts and prints, no gate yet.",
        "gate_pack": "catalogue-only",
        "gate_note": "No arm gate pack exists; this kind drives the "
                     "catalogue, inventory and print kit only.",
        "reference": "Arm class template",
        "base": None,
        "default_name": "my-robot-arm",
        "locked": ["BOM-level kind — no spec, no twin, no gate"],
        "params": [
            _p("dof", "Degrees of freedom", "", 3, 2, 6, ptype="int",
               where="profile"),
            _p("reach_mm", "Reach (links summed)", "mm", 300, 100,
               800, where="profile"),
            _p("servo_torque_kgcm", "Joint servo torque class",
               "kg·cm", 30, 5, 40, where="profile"),
            _p("gripper", "Gripper", "", "yes", None, None,
               ptype="choice", choices=["yes", "no"],
               where="profile"),
        ],
        "presets": {},
        "bom_hints": ["joint servos ×DOF (STS3215 class)",
                      "link shells + brackets (printable)",
                      "base bearing + mounting plate"],
    },
}

_MM_PATHS = {"wheel.diameter_m", "wheel.width_m", "length_m",
             "width_m", "height_m", "ground_clearance_m"}


def _coerce(param: dict, raw, kind_id: str):
    key = param["key"]
    try:
        if param["type"] == "int":
            value = int(raw)
        elif param["type"] == "choice":
            value = str(raw)
            if value not in (param["choices"] or []):
                raise KindError(
                    f"{key} must be one of {param['choices']}, "
                    f"got {raw!r} (kind {kind_id})")
            return value
        else:
            value = float(raw)
    except (TypeError, ValueError):
        raise KindError(f"{key} needs a {param['type']} value, "
                        f"got {raw!r} (kind {kind_id})") from None
    if param["min"] is not None and not (
            param["min"] <= value <= param["max"]):
        raise KindError(
            f"{key}={value} is outside the {kind_id} guardrails "
            f"({param['min']}–{param['max']} {param['unit']}) — the "
            f"range keeps the physics checks meaningful")
    return value


def resolve_kind(kind_id: str, overrides: dict | None = None,
                 size: str | None = None, name: str | None = None) -> dict:
    """Kind + preset + overrides -> a validated starter spec dict,
    or a BOM-level profile for catalogue-only kinds.

    Returns {"type": "spec", "kind": ..., "gate_pack": ...,
    "spec": {...}, "extras": {...}, "warnings": [...]} or
    {"type": "profile", "kind": ..., "gate_pack": "catalogue-only",
    "params": {...}, "bom_hints": [...]}.
    Raises KindError on anything unknown, out of range, or invalid.
    """
    kind = KINDS.get(kind_id)
    if kind is None:
        raise KindError(f"unknown kind {kind_id!r} — kinds: "
                        f"{', '.join(KINDS)}")
    overrides = dict(overrides or {})
    params = {p["key"]: p for p in kind["params"]}
    values = {k: p["default"] for k, p in params.items()}
    if size is not None:
        preset = kind["presets"].get(size)
        if preset is None:
            raise KindError(f"kind {kind_id} has no size presets "
                            f"yet (presets exist for: "
                            f"{', '.join(k for k, v in KINDS.items() if v['presets'])})")
        for key, raw in preset.items():
            values[key] = _coerce(params[key], raw, kind_id)
    for key, raw in overrides.items():
        if key not in params:
            raise KindError(f"kind {kind_id} has no parameter "
                            f"{key!r} — parameters: "
                            f"{', '.join(params)}")
        values[key] = _coerce(params[key], raw, kind_id)

    if kind["base"] is None:
        return {"type": "profile", "kind": kind_id,
                "label": kind["label"],
                "gate_pack": kind["gate_pack"],
                "gate_note": kind.get("gate_note", ""),
                "reference": kind["reference"],
                "name": name or kind["default_name"],
                "params": values,
                "bom_hints": kind.get("bom_hints", [])}

    spec = copy.deepcopy(kind["base"])
    spec["name"] = name or kind["default_name"]
    spec["description"] = (
        f"Custom {kind['label'].lower()} started from the "
        f"{kind_id} starter kind (reference: {kind['reference']}). "
        f"Gate pack: {kind['gate_pack']}.")
    extras = {}
    for p in kind["params"]:
        value = values[p["key"]]
        if p["where"] == "extras":
            extras[p["key"]] = value
        elif p["apply"]:
            _APPLIERS[p["apply"]](spec, value)
        elif p["path"]:
            converted = value / 1000.0 if p["path"] in _MM_PATHS \
                else value
            _set_path(spec, p["path"], converted)
    try:
        parsed = RobotSpec.from_dict(spec)
    except SpecError as exc:
        raise KindError(f"starter spec for {kind_id} does not "
                        f"parse: {exc}") from exc
    findings = validate(parsed)
    if has_errors(findings):
        msgs = "; ".join(f.message for f in findings
                         if f.severity == "ERROR")
        raise KindError(f"those {kind_id} parameters do not make a "
                        f"valid robot: {msgs}")
    warnings = [f.message for f in findings if f.severity == "WARN"]
    return {"type": "spec", "kind": kind_id, "label": kind["label"],
            "gate_pack": kind["gate_pack"],
            "gate_note": kind.get("gate_note", ""),
            "reference": kind["reference"], "spec": spec,
            "extras": extras, "warnings": warnings}


def format_kind_list() -> str:
    lines = ["starter kinds (gate badge shown — a kind never "
             "implies a gate that does not exist):"]
    for kid, k in KINDS.items():
        lines.append(f"  {kid:<14} [{k['gate_pack']}] "
                     f"{k['label']} — {k['one_liner']}")
        lines.append(f"  {'':<14} reference: {k['reference']}")
    return "\n".join(lines)
