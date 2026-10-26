import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import twin
from robotforge.gate import (DEFAULT_THRESHOLDS, FAIL, MARGINAL, PASS,
                             evaluate_drive, evaluate_run, evaluate_turn)
from robotforge.schema import RobotSpec
from robotforge.twin import generate_sdf, generate_world, parse_last_odom

EXAMPLE = Path(__file__).parent.parent / "examples" / "pathfinder.json"


def test_thresholds_are_the_decided_values():
    t = DEFAULT_THRESHOLDS
    assert (t.position_pass_pct, t.position_fail_pct) == (5.0, 10.0)
    assert (t.heading_pass_deg, t.heading_fail_deg) == (5.0, 10.0)


def test_drive_bands():
    assert evaluate_drive(1.0, 1.04).verdict == PASS       # 4%
    assert evaluate_drive(1.0, 0.93).verdict == MARGINAL    # 7%
    assert evaluate_drive(1.0, 0.85).verdict == FAIL        # 15%
    assert evaluate_drive(1.0, 1.05).verdict == PASS        # boundary
    assert evaluate_drive(1.0, 1.10).verdict == MARGINAL    # boundary


def test_turn_bands_and_wraparound():
    assert evaluate_turn(90.0, 94.0).verdict == PASS
    assert evaluate_turn(90.0, 98.0).verdict == MARGINAL
    assert evaluate_turn(90.0, 105.0).verdict == FAIL
    assert evaluate_turn(0.0, 359.0).error == 1.0           # wraps


def test_run_verdict_is_worst_check():
    rep = evaluate_run([evaluate_drive(1.0, 1.0), evaluate_turn(90.0, 120.0)])
    assert rep.verdict == FAIL
    assert rep.to_dict()["verdict"] == FAIL


def test_sdf_well_formed_with_diffdrive():
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    sdf = generate_sdf(spec)
    root = ET.fromstring(sdf)
    assert root.tag == "sdf"
    text = "".join(root.itertext()) + sdf
    assert "gz-sim-diff-drive-system" in sdf
    assert sdf.count("<left_joint>") == 2 and sdf.count("<right_joint>") == 2
    world = generate_world(spec, "/tmp/model.sdf")
    ET.fromstring(world)


class _DummyBindingsTransport:
    def __init__(self, *args, **kwargs):
        pass


class _DummyCliTransport:
    def __init__(self, *args, **kwargs):
        pass


def test_transport_selection_prefers_bindings_then_falls_back():
    orig_import = twin._import_bindings
    orig_bindings = twin._BindingsTransport
    orig_cli = twin._CliTransport
    try:
        twin._BindingsTransport = _DummyBindingsTransport
        twin._CliTransport = _DummyCliTransport
        # Bindings importable -> bindings transport is chosen.
        twin._import_bindings = lambda: (object, object, object)
        transport, name = twin.make_transport(Path("/tmp/odom.txt"))
        assert isinstance(transport, _DummyBindingsTransport)
        assert name == "gz-transport bindings (gz.transport13)"
        # Bindings not importable -> streamed-CLI fallback is chosen.
        twin._import_bindings = lambda: None
        transport, name = twin.make_transport(Path("/tmp/odom.txt"))
        assert isinstance(transport, _DummyCliTransport)
        assert name == "gz CLI (streamed)"
    finally:
        twin._import_bindings = orig_import
        twin._BindingsTransport = orig_bindings
        twin._CliTransport = orig_cli


def test_parse_last_odom():
    text = ("header { stamp { sec: 1 } } pose { position { x: 0.1 y: 0.0 z: 0.05 } "
            "orientation { x: 0.0 y: 0.0 z: 0.0 w: 1.0 } }\n"
            "pose { position { x: 1.02 y: 0.03 z: 0.05 } "
            "orientation { x: 0.0 y: 0.0 z: 0.7071 w: 0.7071 } }")
    x, y, heading = parse_last_odom(text)
    assert abs(x - 1.02) < 1e-9 and abs(y - 0.03) < 1e-9
    assert abs(heading - 90.0) < 0.1
