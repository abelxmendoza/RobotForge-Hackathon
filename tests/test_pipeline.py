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


def test_motor_above_battery_voltage_requires_power_path_review():
    data = json.loads(EXAMPLE.read_text())
    data["motor"]["voltage_v"] = 24.0
    spec = RobotSpec.from_dict(data)
    findings = validate(spec)
    assert not has_errors(findings)
    assert any(x.check == "electrical.voltage_match" and x.severity == "WARN"
               for x in findings)


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


def test_parse_odom_tolerates_omitted_zero_fields():
    """Protobuf text omits zero-valued fields: at rest / planar motion the
    echo has no position z and no quaternion x/y. The parser must default
    absent components to 0.0 instead of failing to match."""
    import math

    from robotforge.twin import parse_last_odom

    text = (
        "pose {\n"
        "  position {\n"
        "    x: 1.5\n"
        "    y: -0.25\n"
        "  }\n"
        "  orientation {\n"
        "    z: 0.7071\n"
        "    w: 0.7071\n"
        "  }\n"
        "}\n")
    x, y, heading = parse_last_odom(text)
    assert math.isclose(x, 1.5) and math.isclose(y, -0.25)
    assert math.isclose(heading, 90.0, abs_tol=0.01)

    rest = (
        "pose {\n"
        "  position {\n"
        "    x: 0.5\n"
        "    y: 0.5\n"
        "  }\n"
        "  orientation {\n"
        "    w: 1\n"
        "  }\n"
        "}\n")
    x, y, heading = parse_last_odom(rest)
    assert math.isclose(x, 0.5) and math.isclose(y, 0.5)
    assert math.isclose(heading, 0.0, abs_tol=0.01)


def test_parse_odom_full_fields_still_parse():
    import math

    from robotforge.twin import parse_last_odom

    text = (
        "pose {\n"
        "  position {\n"
        "    x: 0.1\n"
        "    y: 0.2\n"
        "    z: 0.0\n"
        "  }\n"
        "  orientation {\n"
        "    x: 0.0\n"
        "    y: 0.0\n"
        "    z: 0.0\n"
        "    w: 1.0\n"
        "  }\n"
        "}\n")
    x, y, heading = parse_last_odom(text)
    assert math.isclose(x, 0.1) and math.isclose(y, 0.2)
    assert math.isclose(heading, 0.0, abs_tol=0.01)


def test_extract_odom_poses_keeps_partial_tail():
    """Stream callers feed echo output in chunks: complete poses are parsed
    in order and a trailing partial pose is returned as the rest, whole."""
    from robotforge.twin import extract_odom_poses

    one = ("pose {\n  position {\n    x: 0.1\n    y: 0.2\n  }\n"
           "  orientation {\n    w: 1\n  }\n}\n")
    two = ("pose {\n  position {\n    x: 0.3\n    y: 0.2\n  }\n"
           "  orientation {\n    w: 1\n  }\n}\n")
    poses, rest = extract_odom_poses(one + two + "pose {\n  position {\n    x: 0.")
    assert len(poses) == 2
    assert poses[0][0] == 0.1 and poses[1][0] == 0.3
    # The tail keeps whatever followed the last complete pose block,
    # including the pose wrapper's own closing brace.
    assert rest == "\n}\npose {\n  position {\n    x: 0."
    # Feeding the rest plus the remainder completes the third pose.
    poses2, rest2 = extract_odom_poses(rest + "4\n    y: 0.2\n  }\n"
                                       "  orientation {\n    w: 1\n  }\n}\n")
    assert len(poses2) == 1 and poses2[0][0] == 0.4
    assert rest2 == "\n}\n"


def test_pose_stable():
    from robotforge.twin import _pose_stable

    assert _pose_stable((1.0, 2.0, 45.0), (1.0, 2.0, 45.0))
    assert _pose_stable((1.0, 2.0, 45.0), (1.0005, 2.0, 45.05))
    assert not _pose_stable((1.0, 2.0, 45.0), (1.01, 2.0, 45.0))
    assert not _pose_stable((1.0, 2.0, 45.0), (1.0, 2.0, 46.0))
    # Wraparound: 179.99 vs -179.99 is 0.02 deg, not 359.98.
    assert _pose_stable((0.0, 0.0, 179.99), (0.0, 0.0, -179.99))


def test_gate_sdf_uses_revolute_joints():
    from robotforge.twin import generate_sdf

    spec = RobotSpec.from_json(EXAMPLE.read_text())
    sdf = generate_sdf(spec)
    assert 'type="revolute"' in sdf
    assert 'type="revolve"' not in sdf


def test_distance_and_heading_helpers():
    import math

    from robotforge.twin import (distance_between, drive_reached,
                                 heading_change_deg, turn_reached)

    assert math.isclose(distance_between((0, 0, 0), (3, 4, 0)), 5.0)
    assert math.isclose(distance_between((1, 1, 0), (1, 1, 0)), 0.0)
    # Wraparound-safe heading deltas
    assert math.isclose(heading_change_deg(170.0, -170.0), 20.0)
    assert math.isclose(heading_change_deg(-170.0, 170.0), -20.0)
    assert math.isclose(heading_change_deg(0.0, 90.0), 90.0)
    assert math.isclose(heading_change_deg(10.0, 10.0), 0.0)
    # Stop conditions
    assert not drive_reached((0, 0, 0), (0.99, 0, 0), 1.0)
    assert drive_reached((0, 0, 0), (1.0, 0, 0), 1.0)
    assert drive_reached((2, 2, 0), (2, 3.5, 0), 1.0)
    assert not turn_reached(170.0, -175.0, 90.0)   # only 15 deg so far
    assert turn_reached(170.0, -100.0, 90.0)       # wrapped through 180


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


# ---------------------------------------------------------------------------
# Baseten fallback transport chain (all mocked — no live calls)
# ---------------------------------------------------------------------------

from contextlib import contextmanager


@contextmanager
def _describe_env(**updates):
    import os
    saved = {k: os.environ.get(k) for k in updates}
    for k, v in updates.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _ok_proc(spec_dict):
    payload = {"choices": [{"message": {"content": json.dumps(spec_dict)}}]}
    return type("P", (), {"returncode": 0,
                          "stdout": json.dumps({"status": 200,
                                                "payload": payload}),
                          "stderr": ""})()


def _chain_env():
    """Both helpers 'exist' (pointed at real test files); no direct key."""
    return {
        "RF_META_API_HELPER": str(Path(__file__)),
        "RF_BASETEN_HELPER": str(Path(__file__).with_name(
            "test_gate_twin.py")),
        "RF_DESCRIBE_TRANSPORT": None,
        "META_API_KEY": None,
        "RF_MODEL": None,
        "RF_BASETEN_MODEL": None,
        "FIREWORKS_API_KEY": None,
        "RF_FIREWORKS_ENABLED": None,
        "RF_FIREWORKS_MODEL": None,
        "RF_FIREWORKS_API_BASE": None,
    }


def test_describe_falls_back_to_baseten_when_meta_fails():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _chain_env()
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[1] == env["RF_META_API_HELPER"]:
            return type("P", (), {
                "returncode": 0,
                "stdout": json.dumps({"status": 401,
                                      "payload": {"error": "invalid_api_key"}}),
                "stderr": ""})()
        if cmd[1] == env["RF_BASETEN_HELPER"]:
            return _ok_proc(_MOCK_LIVE_SPEC)
        raise AssertionError(f"unexpected helper invoked: {cmd[1]}")

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=fake_run):
            spec = describe_mod.describe_live("a small rover")
    assert spec.name == "pathfinder-live"
    assert not has_errors(validate(spec))
    assert len(calls) == 2  # meta tried first, baseten second
    baseten_argv = calls[1]
    assert baseten_argv[2:4] == ["chat", "--model"]
    assert baseten_argv[4] == "meta-models/muse-spark-open"
    # Baseten is slow: its helper request timeout must be budgeted.
    assert "--timeout" in baseten_argv and "240" in baseten_argv


def test_describe_meta_success_never_calls_baseten():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _chain_env()
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return _ok_proc(_MOCK_LIVE_SPEC)

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=fake_run):
            spec = describe_mod.describe_live("a small rover")
    assert spec.name == "pathfinder-live"
    assert len(calls) == 1
    assert calls[0][1] == env["RF_META_API_HELPER"]


def test_describe_forced_baseten_via_env():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _chain_env()
    env["RF_DESCRIBE_TRANSPORT"] = "baseten"
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if cmd[1] == env["RF_META_API_HELPER"]:
            raise AssertionError("meta helper must not run when forced")
        return _ok_proc(_MOCK_LIVE_SPEC)

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=fake_run):
            spec = describe_mod.describe_live("a small rover")
    assert spec.name == "pathfinder-live"
    assert len(calls) == 1
    assert calls[0][1] == env["RF_BASETEN_HELPER"]
    assert calls[0][4] == "meta-models/muse-spark-open"


def test_describe_all_transports_fail_names_both_errors():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _chain_env()

    def fake_run(cmd, **kwargs):
        if cmd[1] == env["RF_META_API_HELPER"]:
            return type("P", (), {
                "returncode": 0,
                "stdout": json.dumps({"status": 401,
                                      "payload": {"error": "invalid_api_key"}}),
                "stderr": ""})()
        return type("P", (), {"returncode": 1, "stdout": "",
                              "stderr": "boom-baseten"})()

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=fake_run):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                msg = str(exc)
    assert "meta-connector" in msg and "401" in msg
    assert "baseten" in msg and "boom-baseten" in msg


# ---------------------------------------------------------------------------
# Fireworks transport (all mocked — no live calls, no real key)
# ---------------------------------------------------------------------------

import io
import urllib.error


class _FakeFireworksResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


def _fireworks_env(**updates):
    env = _chain_env()
    env.update({
        "FIREWORKS_API_KEY": "test-fireworks-key",
        "RF_FIREWORKS_ENABLED": None,
        "RF_FIREWORKS_MODEL": None,
        "RF_FIREWORKS_API_BASE": None,
    })
    env.update(updates)
    return env


def _fireworks_payload(spec_dict=None):
    return {"choices": [{"message": {
        "content": json.dumps(spec_dict or _MOCK_LIVE_SPEC)}}]}


def test_describe_forced_fireworks_uses_openai_compatible_api():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(RF_DESCRIBE_TRANSPORT="fireworks")
    requests = []

    def fake_urlopen(req, timeout=None):
        requests.append((req, timeout))
        return _FakeFireworksResponse(_fireworks_payload())

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=AssertionError(
                              "connector helpers must not run")):
            with patch.object(describe_mod.urllib.request, "urlopen",
                              side_effect=fake_urlopen):
                spec = describe_mod.describe_live("a small rover")

    assert spec.name == "pathfinder-live"
    assert not has_errors(validate(spec))
    assert len(requests) == 1
    req, timeout = requests[0]
    assert timeout == 180
    assert req.full_url == \
        "https://api.fireworks.ai/inference/v1/chat/completions"
    assert req.get_header("Authorization") == "Bearer test-fireworks-key"
    sent = json.loads(req.data)
    assert sent["model"] == "accounts/fireworks/models/muse-spark-open"
    assert sent["temperature"] == 0.2
    assert sent["max_tokens"] == 4000
    assert sent["messages"][0]["role"] == "system"
    assert sent["messages"][1] == {
        "role": "user", "content": "a small rover"}


def test_describe_fireworks_key_alone_is_not_a_silent_default():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(
        RF_META_API_HELPER=str(Path(__file__).with_name("does-not-exist.py")),
        RF_BASETEN_HELPER=str(Path(__file__).with_name("also-missing.py")))

    with _describe_env(**env):
        with patch.object(describe_mod.urllib.request, "urlopen",
                          side_effect=AssertionError(
                              "Fireworks must not be called")):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                msg = str(exc)
    assert "Fireworks is opt-in" in msg
    assert "RF_FIREWORKS_ENABLED=1" in msg


def test_describe_fireworks_fallback_only_when_enabled():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(
        RF_FIREWORKS_ENABLED="1",
        RF_BASETEN_HELPER=str(Path(__file__).with_name("does-not-exist.py")))
    subprocess_calls = []

    def fake_run(cmd, **kwargs):
        subprocess_calls.append(cmd)
        return type("P", (), {
            "returncode": 0,
            "stdout": json.dumps({"status": 401,
                                  "payload": {"error": "invalid_api_key"}}),
            "stderr": ""})()

    def fake_urlopen(req, timeout=None):
        return _FakeFireworksResponse(_fireworks_payload())

    with _describe_env(**env):
        with patch.object(describe_mod.subprocess, "run",
                          side_effect=fake_run):
            with patch.object(describe_mod.urllib.request, "urlopen",
                              side_effect=fake_urlopen):
                spec = describe_mod.describe_live("a small rover")

    assert spec.name == "pathfinder-live"
    assert len(subprocess_calls) == 1  # Meta failed; Fireworks was next
    assert subprocess_calls[0][1] == env["RF_META_API_HELPER"]


def test_describe_forced_fireworks_missing_key_is_a_clean_error():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(RF_DESCRIBE_TRANSPORT="fireworks",
                         FIREWORKS_API_KEY=None)
    with _describe_env(**env):
        with patch.object(describe_mod.urllib.request, "urlopen",
                          side_effect=AssertionError(
                              "no HTTP call without a key")):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                msg = str(exc)
    assert "fireworks" in msg
    assert "FIREWORKS_API_KEY is not set" in msg


def test_describe_fireworks_http_error_is_a_clean_spec_error():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(RF_DESCRIBE_TRANSPORT="fireworks")

    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError(
            req.full_url, 429, "Too Many Requests", {},
            io.BytesIO(b'{"error":"rate limited"}'))

    with _describe_env(**env):
        with patch.object(describe_mod.urllib.request, "urlopen",
                          side_effect=fake_urlopen):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                msg = str(exc)
    assert "Fireworks API returned HTTP 429" in msg
    assert "rate limited" in msg


def test_describe_fireworks_unexpected_payload_is_a_clean_spec_error():
    from unittest.mock import patch

    from robotforge import describe as describe_mod

    env = _fireworks_env(RF_DESCRIBE_TRANSPORT="fireworks")

    def fake_urlopen(req, timeout=None):
        return _FakeFireworksResponse({"choices": []})

    with _describe_env(**env):
        with patch.object(describe_mod.urllib.request, "urlopen",
                          side_effect=fake_urlopen):
            try:
                describe_mod.describe_live("a small rover")
                raise AssertionError("expected SpecError")
            except SpecError as exc:
                msg = str(exc)
    assert "Fireworks API returned an unexpected response" in msg
