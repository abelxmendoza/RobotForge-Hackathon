"""Engineering validation for a RobotSpec.

Schema parsing proves the document is well-formed; this module checks whether
the robot it describes is physically coherent. Each check returns Findings with
a severity: ERROR fails the spec (no twin may be generated), WARN is surfaced
to the user, INFO is advisory.
"""
from __future__ import annotations

from dataclasses import dataclass

from .schema import RobotSpec, spec_is_estimated
from .urdf import verify_urdf_clearance

ERROR, WARN, INFO = "ERROR", "WARN", "INFO"


@dataclass
class Finding:
    severity: str
    check: str
    message: str


# Prefix for the voltage check: it compares nominal battery and motor
# voltages as if the battery fed the motors directly.
VOLTAGE_HEURISTIC = "direct-supply heuristic: "


def validate(spec: RobotSpec, *, urdf_xml: str | None = None) -> list[Finding]:
    f: list[Finding] = []

    # Ground geometry — only for robots that have wheels. Assumes a
    # conventional axle-mounted wheel-on-ground chassis configuration:
    # a wheel cannot lift the chassis higher than its radius, and the
    # generated collision geometry's chassis bottom above the wheel
    # contact plane must match the declared ground clearance.
    if spec.wheel is not None:
        radius = spec.wheel.diameter_m / 2.0
        if spec.ground_clearance_m is not None and \
                spec.ground_clearance_m > radius:
            f.append(Finding(ERROR, "geometry.clearance_vs_wheel",
                             f"ground clearance {spec.ground_clearance_m:.3f} m exceeds "
                             f"wheel radius {radius:.3f} m — impossible without a "
                             f"lifted chassis design"))
        elif spec.ground_clearance_m is not None:
            try:
                verify_urdf_clearance(spec, urdf_xml)
            except ValueError as exc:
                f.append(Finding(ERROR, "geometry.collision_clearance_mismatch",
                                 str(exc)))
        if spec.wheel.diameter_m > spec.height_m:
            f.append(Finding(WARN, "geometry.wheel_vs_height",
                             f"wheel diameter {spec.wheel.diameter_m:.3f} m is larger "
                             f"than body height {spec.height_m:.3f} m"))
        if spec.wheel.width_m * spec.wheel.count > spec.length_m * 2 and \
                spec.drivetrain in ("differential", "skid_steer"):
            f.append(Finding(WARN, "geometry.wheel_footprint",
                             "total wheel width looks large relative to body length"))

        # Drivetrain coherence (wheeled).
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

    # Class coherence for the non-ground classes. Each class declares
    # its own fields (rotors / legs / arms); a missing block is an
    # error, a surprising count is a warning.
    if spec.drivetrain == "multirotor":
        if spec.rotors is None:
            f.append(Finding(ERROR, "class.rotors_missing",
                             "multirotor spec declares no rotors block"))
        else:
            if spec.rotors.count != spec.motor.count:
                f.append(Finding(WARN, "drivetrain.rotor_motor_match",
                                 f"a multirotor normally has one motor per "
                                 f"rotor, spec declares {spec.rotors.count} "
                                 f"rotors and {spec.motor.count} motors"))
            spacing = min(spec.length_m, spec.width_m)
            if spec.rotors.prop_diameter_m > spacing:
                f.append(Finding(WARN, "geometry.prop_overlap",
                                 f"propeller diameter "
                                 f"{spec.rotors.prop_diameter_m:.3f} m exceeds "
                                 f"the {spacing:.3f} m between neighbouring "
                                 f"motors — the props would overlap"))
    if spec.drivetrain in ("quadruped", "humanoid"):
        if spec.legs is None:
            f.append(Finding(ERROR, "class.legs_missing",
                             f"{spec.drivetrain} spec declares no legs block"))
        else:
            want = 4 if spec.drivetrain == "quadruped" else 2
            if spec.legs.count != want:
                f.append(Finding(WARN, "drivetrain.leg_count",
                                 f"a {spec.drivetrain} normally has {want} "
                                 f"legs, spec declares {spec.legs.count}"))
    if spec.drivetrain in ("humanoid", "robotic_arm"):
        if spec.arms is None:
            f.append(Finding(ERROR, "class.arms_missing",
                             f"{spec.drivetrain} spec declares no arms block"))
        else:
            want = 2 if spec.drivetrain == "humanoid" else 1
            if spec.arms.count != want:
                f.append(Finding(WARN, "drivetrain.arm_count",
                                 f"a {spec.drivetrain} normally has {want} "
                                 f"arm(s), spec declares {spec.arms.count}"))

    # The schema records nominal component voltages, not the actual
    # battery -> regulator -> motor-driver -> motor power path. A mismatch
    # is therefore a review warning, not proof of an impossible design.
    # Do not silently claim that a regulator exists (or is absent).
    # The message says so up front: this compares nominal voltages as if
    # the battery fed the motors directly.
    if spec.motor.voltage_v > spec.battery.voltage_v * 1.05:
        f.append(Finding(WARN, "electrical.voltage_match",
                         f"{VOLTAGE_HEURISTIC}motor nominal voltage {spec.motor.voltage_v:g} V exceeds "
                         f"battery nominal voltage {spec.battery.voltage_v:g} V; "
                         "verify motor-driver output, battery operating range, "
                         "and any boost converter before approval"))
    elif spec.motor.voltage_v < spec.battery.voltage_v * 0.5:
        f.append(Finding(WARN, "electrical.voltage_match",
                         f"{VOLTAGE_HEURISTIC}motor nominal voltage {spec.motor.voltage_v:g} V is far "
                         f"below battery nominal voltage {spec.battery.voltage_v:g} V; "
                         "verify motor-driver output, regulation, and component "
                         "voltage limits before approval"))

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

    # Provenance: a photo draft's dimensions are estimates, not
    # measurements. The engineering checks above still run — a draft
    # should be coherent — but an estimated spec must never collect
    # the clean "passed all engineering checks" line: that is a
    # verdict, and estimates do not earn verdicts. This WARN is also
    # what keeps that line from being appended below.
    if spec_is_estimated(spec):
        f.append(Finding(WARN, "provenance.estimated_dimensions",
                         "every dimension in this spec is ESTIMATED from "
                         "a photo, not measured — the checks ran against "
                         "estimates, so this is not a verdict on the real "
                         "robot; confirm the dimensions before trusting "
                         "the spec"))

    if not f:
        f.append(Finding(INFO, "all", "spec passed all engineering checks"))
    return f


def has_errors(findings: list[Finding]) -> bool:
    return any(x.severity == ERROR for x in findings)
