"""Engineering validation for a RobotSpec.

Schema parsing proves the document is well-formed; this module checks whether
the robot it describes is physically coherent. Each check returns Findings with
a severity: ERROR fails the spec (no twin may be generated), WARN is surfaced
to the user, INFO is advisory.
"""
from __future__ import annotations

from dataclasses import dataclass

from .schema import RobotSpec

ERROR, WARN, INFO = "ERROR", "WARN", "INFO"


@dataclass
class Finding:
    severity: str
    check: str
    message: str


def validate(spec: RobotSpec) -> list[Finding]:
    f: list[Finding] = []

    # Geometry: a wheel cannot lift the chassis higher than its radius, and the
    # declared ground clearance must be reachable by the wheel radius.
    radius = spec.wheel.diameter_m / 2.0
    if spec.ground_clearance_m > radius:
        f.append(Finding(ERROR, "geometry.clearance_vs_wheel",
                         f"ground clearance {spec.ground_clearance_m:.3f} m exceeds "
                         f"wheel radius {radius:.3f} m — impossible without a "
                         f"lifted chassis design"))
    if spec.wheel.diameter_m > spec.height_m:
        f.append(Finding(WARN, "geometry.wheel_vs_height",
                         f"wheel diameter {spec.wheel.diameter_m:.3f} m is larger "
                         f"than body height {spec.height_m:.3f} m"))
    if spec.wheel.width_m * spec.wheel.count > spec.length_m * 2 and \
            spec.drivetrain in ("differential", "skid_steer"):
        f.append(Finding(WARN, "geometry.wheel_footprint",
                         "total wheel width looks large relative to body length"))

    # Drivetrain coherence.
    if spec.drivetrain == "differential" and spec.wheel.count != 2:
        f.append(Finding(WARN, "drivetrain.wheel_count",
                         f"differential drive normally has 2 driven wheels, "
                         f"spec declares {spec.wheel.count} wheels"))
    if spec.drivetrain == "ackermann" and spec.wheel.count != 4:
        f.append(Finding(WARN, "drivetrain.wheel_count",
                         "ackermann steering normally uses 4 wheels"))
    if spec.motor.count < 1:
        f.append(Finding(ERROR, "drivetrain.motor_count", "no motors declared"))
    if spec.drivetrain in ("differential", "skid_steer") and spec.motor.count == 1:
        f.append(Finding(WARN, "drivetrain.motor_count",
                         "a single motor cannot drive a differential/skid-steer "
                         "drivetrain without a shared axle gearbox"))

    # Electrical: motor supply must not exceed battery voltage by a wide margin.
    if spec.motor.voltage_v > spec.battery.voltage_v * 1.05:
        f.append(Finding(ERROR, "electrical.voltage_match",
                         f"motor voltage {spec.motor.voltage_v:g} V exceeds battery "
                         f"{spec.battery.voltage_v:g} V — motors would be undervolted "
                         f"or need a boost converter"))
    elif spec.motor.voltage_v < spec.battery.voltage_v * 0.5:
        f.append(Finding(WARN, "electrical.voltage_match",
                         f"motor voltage {spec.motor.voltage_v:g} V is far below "
                         f"battery {spec.battery.voltage_v:g} V — a regulator is "
                         f"required and was not declared"))

    # Mass budget: if component masses are given, they must not exceed the
    # declared total, and should account for a plausible share of it.
    if spec.component_mass_kg:
        total = sum(spec.component_mass_kg.values())
        if total > spec.mass_kg * 1.005:  # 0.5% tolerance for rounding
            f.append(Finding(ERROR, "mass.budget",
                             f"component masses sum to {total:.2f} kg, above the "
                             f"declared total {spec.mass_kg:.2f} kg"))
        elif total < spec.mass_kg * 0.4:
            f.append(Finding(WARN, "mass.budget",
                             f"component masses sum to {total:.2f} kg, only "
                             f"{100 * total / spec.mass_kg:.0f}% of the declared "
                             f"total {spec.mass_kg:.2f} kg — mass is unaccounted for"))

    # Sensors: range, when declared, must be positive and sane.
    for s in spec.sensors:
        if s.range_m is not None and s.range_m <= 0:
            f.append(Finding(ERROR, "sensor.range",
                             f"{s.kind} sensor at {s.position} has non-positive "
                             f"range {s.range_m}"))

    if not f:
        f.append(Finding(INFO, "all", "spec passed all engineering checks"))
    return f


def has_errors(findings: list[Finding]) -> bool:
    return any(x.severity == ERROR for x in findings)
