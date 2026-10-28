import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import cli, twin
from robotforge.gate import (DEFAULT_THRESHOLDS, FAIL, MARGINAL, PASS,
                             evaluate_drive, evaluate_odometry_distance,
                             evaluate_odometry_heading, evaluate_run,
                             evaluate_turn, suspect_fields)
from robotforge.schema import RobotSpec
from robotforge.twin import (TwinError, extract_named_poses, generate_sdf,
                             generate_world, iter_odom_poses,
                             parse_last_odom)

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


def test_world_carries_truth_broadcaster():
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    world = generate_world(spec, "/tmp/model.sdf")
    # Ground truth comes from the world's dynamic_pose/info stream,
    # published by the SceneBroadcaster system in world frame.
    assert "gz-sim-scene-broadcaster-system" in world
    assert 'name="robotforge_world"' in world


def test_geometry_scale_changes_only_physical_wheels():
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    r = spec.wheel.diameter_m / 2.0
    plain = generate_sdf(spec)
    injected = generate_sdf(spec, geometry_wheel_radius_m=r * 0.9)
    # Odometry (DiffDrive plugin) still believes the paperwork radius...
    assert f"<wheel_radius>{r:.4f}</wheel_radius>" in injected
    # ...but the physical wheel cylinders are the injected size.
    assert f"<radius>{r * 0.9}</radius>" in injected
    assert f"<radius>{r}</radius>" in plain


def test_odometry_checks_measure_belief_vs_truth():
    assert evaluate_odometry_distance(1.0, 1.03).verdict == PASS
    assert evaluate_odometry_distance(1.0, 0.93).verdict == MARGINAL
    assert evaluate_odometry_distance(1.0, 0.85).verdict == FAIL
    assert evaluate_odometry_heading(90.0, 94.0).verdict == PASS
    assert evaluate_odometry_heading(90.0, 70.0).verdict == FAIL


def test_suspects_name_the_right_fields():
    dist_only = suspect_fields([evaluate_odometry_distance(1.0, 0.85),
                                evaluate_odometry_heading(90.0, 91.0)])
    assert [s["field"] for s in dist_only] == ["wheel.diameter_m"]
    head_only = suspect_fields([evaluate_odometry_distance(1.0, 1.01),
                                evaluate_odometry_heading(90.0, 70.0)])
    assert len(head_only) == 1 and "separation" in head_only[0]["field"]
    clean = suspect_fields([evaluate_odometry_distance(1.0, 1.0),
                            evaluate_odometry_heading(90.0, 90.0)])
    assert clean == []
    report = evaluate_run([evaluate_odometry_distance(1.0, 0.85)])
    assert report.to_dict()["suspects"][0]["field"] == "wheel.diameter_m"


def test_truth_pose_echo_parses_like_odometry():
    # A gz.msgs.Pose echo (PosePublisher ground truth) carries the same
    # position/orientation block shape the odometry parser consumes.
    text = ("name: \"pathfinder\"\n"
            "position {\n  x: 1.02\n  y: 0.01\n}\n"
            "orientation {\n  z: 0.7071068\n  w: 0.7071068\n}\n")
    poses = list(iter_odom_poses(text))
    assert len(poses) == 1
    x, y, heading = poses[0]
    assert abs(x - 1.02) < 1e-9 and abs(heading - 90.0) < 0.01


def test_named_pose_filter_takes_model_entity_only():
    text = ('header {\n}\nname: "pathfinder::wheel_rear_left"\n'
            'position {\n  x: -0.16\n  y: 0.171\n}\n'
            'orientation {\n  w: 1\n}\n\n'
            'header {\n}\nname: "pathfinder"\n'
            'position {\n  x: 1.02\n  y: 0.01\n}\n'
            'orientation {\n  z: 0.7071068\n  w: 0.7071068\n}\n')
    poses, rest = extract_named_poses(text, "pathfinder")
    assert len(poses) == 1
    assert abs(poses[0][0] - 1.02) < 1e-9
    assert abs(poses[0][2] - 90.0) < 0.01
    assert rest.strip() == ""  # tail advanced past the non-matching block


def test_differential_twin_has_driven_axle_and_casters():
    spec = RobotSpec.from_json(
        (EXAMPLE.parent / "turtlebot3-burger.json").read_text())
    sdf = generate_sdf(spec)
    assert 'name="wheel_left"' in sdf and 'name="wheel_right"' in sdf
    assert 'name="caster_front"' in sdf and 'name="caster_rear"' in sdf
    assert "front_left" not in sdf  # no skid-steer corners on a diff drive
    assert sdf.count("gz-sim-diff-drive-system") == 1


def test_missing_gz_fails_with_twin_error_not_traceback(tmp_path,
                                                        monkeypatch):
    # A PATH holding nothing makes shutil.which("gz") come back empty on
    # any host, with or without Gazebo installed: the run must refuse
    # with a TwinError before anything spawns, not die inside Popen
    # with a raw FileNotFoundError.
    monkeypatch.setenv("PATH", str(tmp_path))
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    with pytest.raises(TwinError, match=r"Gazebo \(gz\) not found"):
        twin.run_motion_check(spec, tmp_path / "work")


def test_cli_run_gate_without_gz_is_a_clean_error(tmp_path, monkeypatch,
                                                  capsys):
    monkeypatch.setenv("PATH", str(tmp_path))
    rc = cli.main(["run-gate", str(EXAMPLE), "--workdir",
                   str(tmp_path / "work")])
    assert rc == 2
    err = capsys.readouterr().err
    assert "spec error: Gazebo (gz) not found" in err
    assert "Traceback" not in err
