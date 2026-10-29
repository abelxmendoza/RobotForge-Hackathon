"""Nominal voltage mismatch must not masquerade as a definitive design failure."""
from robotforge.schema import RobotSpec
from robotforge.validate import validate, has_errors


def spec(battery_v, motor_v):
    return RobotSpec.from_dict({
        "name": "power-path-fixture", "description": "test",
        "drivetrain": "differential",
        "length_m": 0.4, "width_m": 0.3, "height_m": 0.2,
        "mass_kg": 2.0,
        "motor": {"kind": "dc", "voltage_v": motor_v, "count": 2},
        "battery": {"chemistry": "liion", "voltage_v": battery_v,
                    "capacity_mah": 2000},
        "wheel": {"diameter_m": 0.1, "width_m": 0.03, "count": 2},
        "ground_clearance_m": 0.03,
    })


def test_boost_converter_might_resolve_nominal_undervoltage():
    findings = validate(spec(6, 12))
    matches = [f for f in findings if f.check == "electrical.voltage_match"]
    assert len(matches) == 1
    assert matches[0].severity == "WARN"
    assert "boost converter" in matches[0].message
    assert not has_errors(findings)


def test_buck_or_driver_might_resolve_nominal_overvoltage():
    findings = validate(spec(24, 6))
    matches = [f for f in findings if f.check == "electrical.voltage_match"]
    assert len(matches) == 1
    assert matches[0].severity == "WARN"
    assert "motor-driver" in matches[0].message
    assert not has_errors(findings)


def test_matching_nominal_voltages_do_not_trigger_mismatch_warning():
    findings = validate(spec(12, 12))
    assert not any(f.check == "electrical.voltage_match" for f in findings)
