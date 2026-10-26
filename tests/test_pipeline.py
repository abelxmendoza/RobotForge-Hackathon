import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.describe import describe_mock
from robotforge.schema import RobotSpec, SpecError
from robotforge.urdf import generate_urdf
from robotforge.validate import has_errors, validate

EXAMPLE = Path(__file__).parent.parent / "examples" / "pathfinder.json"


def test_example_spec_is_valid():
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    assert not has_errors(validate(spec))


def test_mock_describe_round_trips():
    spec = describe_mock("a warehouse rover")
    assert spec.name == "pathfinder"
    assert not has_errors(validate(spec))
    again = RobotSpec.from_dict(json.loads(json.dumps(spec.to_dict())))
    assert again.to_dict() == spec.to_dict()


def test_impossible_clearance_is_an_error():
    data = json.loads(EXAMPLE.read_text())
    data["ground_clearance_m"] = 0.30  # wheel radius is 0.05 m
    spec = RobotSpec.from_dict(data)
    assert has_errors(validate(spec))


def test_motor_above_battery_voltage_is_an_error():
    data = json.loads(EXAMPLE.read_text())
    data["motor"]["voltage_v"] = 24.0
    spec = RobotSpec.from_dict(data)
    assert has_errors(validate(spec))


def test_bad_drivetrain_rejected():
    data = json.loads(EXAMPLE.read_text())
    data["drivetrain"] = "hover"
    try:
        RobotSpec.from_dict(data)
        raise AssertionError("expected SpecError")
    except SpecError:
        pass


def test_urdf_well_formed_and_named():
    import xml.etree.ElementTree as ET
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    root = ET.fromstring(generate_urdf(spec))
    assert root.tag == "robot" and root.get("name") == "pathfinder"
    joints = [j for j in root if j.tag == "joint"]
    assert len(joints) == 4
