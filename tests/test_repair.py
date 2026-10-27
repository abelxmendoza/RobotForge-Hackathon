import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.repair import apply_repairs, propose_repairs
from robotforge.schema import RobotSpec

BURGER = Path(__file__).parent.parent / "examples" / "turtlebot3-burger.json"


def _spec():
    return RobotSpec.from_json(BURGER.read_text())


def _report(drive_truth, drive_odom, turn_truth, turn_odom, suspects):
    return {"spec": "turtlebot3-burger", "verdict": "FAIL",
            "measurements": {
                "drive": {"commanded_m": 1.0, "measured_m": drive_odom,
                          "truth_m": drive_truth},
                "turn": {"commanded_deg": 90.0, "measured_deg": turn_odom,
                         "truth_deg": turn_truth},
                "injected_wheel_radius_scale": 0.9},
            "suspects": [{"field": f, "reason": "x"} for f in suspects]}


def test_wheel_repair_recovers_measured_diameter():
    # The 0.9 injection case: truth 0.909, odometry believed 1.011.
    prop = propose_repairs(_spec(), _report(0.909, 1.011, 79.2, 92.5,
                                            ["wheel.diameter_m"]))
    wheel = [c for c in prop.corrections if c.field == "wheel.diameter_m"]
    assert len(wheel) == 1
    # 66 mm * (0.909/1.011) = 59.34 mm — the as-built wheel.
    assert abs(wheel[0].new - 0.0593) < 0.0005
    assert wheel[0].kind == "correction"
    repaired = apply_repairs(_spec(), prop)
    assert repaired.wheel.diameter_m == wheel[0].new


def test_separation_repair_calibrates_width():
    prop = propose_repairs(_spec(), _report(1.0, 1.0, 30.6, 94.6,
                                            ["wheel_separation (robot width / wheel track)"]))
    sep = [c for c in prop.corrections if c.field.startswith("width_m")]
    assert len(sep) == 1 and sep[0].kind == "calibration"
    spec = _spec()
    sep_now = spec.width_m + spec.wheel.width_m
    expected = sep_now * 94.6 / 30.6 - spec.wheel.width_m
    assert abs(sep[0].new - expected) < 1e-4


def test_clean_report_has_no_repairs():
    prop = propose_repairs(_spec(), _report(1.01, 1.009, 88.0, 92.5, []))
    assert prop.corrections == []
    assert prop.notes  # explains why


def test_missing_measurements_degrade_to_notes():
    doc = _report(0.0, 0.0, 0.0, 0.0, ["wheel.diameter_m"])
    prop = propose_repairs(_spec(), doc)
    assert prop.corrections == [] and prop.notes
