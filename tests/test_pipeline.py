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


def test_live_describe_via_connector_helper_is_parsed():
    """Connector transport: fake the helper subprocess, expect a parsed spec.

    No live API call: subprocess.run is replaced, and RF_META_API_HELPER is
    pointed at this test file (any existing file) so describe_live selects
    the connector path.
    """
    import os
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    chat_payload = {
        "choices": [{"message": {"content": json.dumps(_MOCK_LIVE_SPEC)}}]}
    helper_stdout = json.dumps({"status": 200, "payload": chat_payload})

    class _Proc:
        returncode = 0
        stdout = helper_stdout
        stderr = ""

    old = os.environ.get("RF_META_API_HELPER")
    os.environ["RF_META_API_HELPER"] = str(Path(__file__))
    try:
        with patch.object(describe_mod.subprocess, "run",
                          return_value=_Proc()) as run:
            spec = describe_mod.describe_live("a small rover")
    finally:
        if old is None:
            del os.environ["RF_META_API_HELPER"]
        else:
            os.environ["RF_META_API_HELPER"] = old
    argv = run.call_args[0][0]
    assert argv[2:4] == ["chat", "--model"] and argv[4] == "muse-spark-1.3"
    assert spec.name == "pathfinder-live"
    assert not has_errors(validate(spec))


def test_live_describe_connector_http_error_raises():
    import os
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    class _Proc:
        returncode = 0
        stdout = json.dumps({"status": 401,
                             "payload": {"error": "invalid_api_key"}})
        stderr = ""

    old = os.environ.get("RF_META_API_HELPER")
    os.environ["RF_META_API_HELPER"] = str(Path(__file__))
    try:
        with patch.object(describe_mod.subprocess, "run",
                          return_value=_Proc()):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                assert "401" in str(exc)
    finally:
        if old is None:
            del os.environ["RF_META_API_HELPER"]
        else:
            os.environ["RF_META_API_HELPER"] = old


_MOCK_LIVE_SPEC = {
    "name": "pathfinder-live",
    "description": "Four-wheel skid-steer rover (mocked live parse).",
    "drivetrain": "skid_steer",
    "length_m": 0.45, "width_m": 0.35, "height_m": 0.18,
    "mass_kg": 4.2, "ground_clearance_m": 0.04,
    "wheel": {"diameter_m": 0.12, "width_m": 0.04, "count": 4, "driven": True},
    "motor": {"kind": "dc_gearmotor", "voltage_v": 12.0, "count": 4,
              "stall_torque_nm": 1.0},
    "battery": {"chemistry": "lipo", "voltage_v": 14.8, "capacity_mah": 5200},
    "sensors": [{"kind": "rgb_camera", "position": "front", "range_m": None}],
    "component_mass_kg": {},
}
