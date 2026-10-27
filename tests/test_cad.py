"""CAD kit: per-part OpenSCAD files + assembly + parts index.

All offline and deterministic: kits are generated from the two example
specs and checked against the specs' own numbers.
"""
import io
import re
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import cli
from robotforge.cad import (generate_kit, is_estimated, part_infos,
                            render_stls, wheel_positions, write_kit)
from robotforge.schema import RobotSpec

EXAMPLES = Path(__file__).parent.parent / "examples"
PATHFINDER = EXAMPLES / "pathfinder.json"
TURTLEBOT = EXAMPLES / "photo-turtlebot.json"


def _spec(path: Path) -> RobotSpec:
    return RobotSpec.from_json(path.read_text())


def _param(scad: str, name: str) -> float:
    m = re.search(rf"^{re.escape(name)} = ([0-9.]+);", scad, re.M)
    assert m, f"parameter {name} missing"
    return float(m.group(1))


# ---------------------------------------------------------------- structure
def test_pathfinder_kit_structure():
    kit = generate_kit(_spec(PATHFINDER))
    assert set(kit) == {
        "parts/chassis_plate.scad", "parts/wheel.scad",
        "parts/motor_mount.scad", "parts/ultrasonic_bracket.scad",
        "assembly.scad", "parts_index.md",
    }  # skid-steer: no caster; no lidar/camera in the spec, so no such parts


def test_turtlebot_kit_structure():
    kit = generate_kit(_spec(TURTLEBOT))
    assert set(kit) == {
        "parts/chassis_plate.scad", "parts/wheel.scad",
        "parts/motor_mount.scad", "parts/caster.scad",
        "parts/lidar_mount.scad", "parts/camera_bracket.scad",
        "assembly.scad", "parts_index.md",
    }  # differential: casters; lidar + camera in the spec; no ultrasonic


def test_part_quantities():
    pf = {i.filename: i.qty for i in part_infos(_spec(PATHFINDER))}
    assert pf["parts/wheel.scad"] == 4
    assert pf["parts/motor_mount.scad"] == 4
    assert pf["parts/chassis_plate.scad"] == 1
    tb = {i.filename: i.qty for i in part_infos(_spec(TURTLEBOT))}
    assert tb["parts/wheel.scad"] == 2
    assert tb["parts/motor_mount.scad"] == 2
    assert tb["parts/caster.scad"] == 2


# ---------------------------------------------------------------- parameters
def test_pathfinder_parameters_match_spec():
    spec = _spec(PATHFINDER)
    kit = generate_kit(spec)
    chassis = kit["parts/chassis_plate.scad"]
    assert _param(chassis, "chassis_length_mm") == spec.length_m * 1000
    assert _param(chassis, "chassis_width_mm") == spec.width_m * 1000
    wheel = kit["parts/wheel.scad"]
    assert _param(wheel, "wheel_diameter_mm") == spec.wheel.diameter_m * 1000
    assert _param(wheel, "wheel_width_mm") == spec.wheel.width_m * 1000
    mount = kit["parts/motor_mount.scad"]
    # the mount's shaft hole sits at the axle height = wheel radius
    assert _param(mount, "shaft_center_height_mm") == \
        spec.wheel.diameter_m * 1000 / 2


def test_turtlebot_parameters_match_spec():
    spec = _spec(TURTLEBOT)
    kit = generate_kit(spec)
    assert _param(kit["parts/wheel.scad"], "wheel_diameter_mm") == 66
    assert _param(kit["parts/chassis_plate.scad"], "chassis_length_mm") == 306
    # caster ball is sized from the spec's ground clearance
    assert _param(kit["parts/caster.scad"], "caster_ball_diameter_mm") == \
        spec.ground_clearance_m * 1000


# ------------------------------------------------------------------ assembly
def test_assembly_references_resolve_and_counts():
    for path, n_wheels, n_casters in ((PATHFINDER, 4, 0), (TURTLEBOT, 2, 2)):
        kit = generate_kit(_spec(path))
        assembly = kit["assembly.scad"]
        refs = re.findall(r"use <([^>]+)>", assembly)
        assert refs, "assembly imports nothing"
        for ref in refs:
            assert ref in kit, f"assembly references missing file {ref}"
        assert len(re.findall(r"\bwheel\(\);", assembly)) == n_wheels
        assert len(re.findall(r"\bmotor_mount\(\);", assembly)) == n_wheels
        assert len(re.findall(r"\bcaster\(\);", assembly)) == n_casters


def test_wheel_positions_mirror_urdf_layout():
    pf = wheel_positions(_spec(PATHFINDER))
    assert len(pf) == 4
    xs = sorted({round(x, 6) for x, _ in pf})
    # front/rear pairs inset by one wheel radius from the ends (urdf.py)
    inset = round(0.42 / 2 - 0.1 / 2, 6)
    assert xs == [-inset, inset]
    tb = wheel_positions(_spec(TURTLEBOT))
    assert len(tb) == 2 and all(x == 0.0 for x, _ in tb)  # centred pair


# ----------------------------------------------------------------- estimated
def test_estimated_warning_propagation():
    tb_spec = _spec(TURTLEBOT)
    assert is_estimated(tb_spec)
    kit = generate_kit(tb_spec)
    for rel, text in kit.items():
        assert "ESTIMATED" in text, f"{rel} lost the photo-draft warning"
    pf_spec = _spec(PATHFINDER)
    assert not is_estimated(pf_spec)
    for rel, text in generate_kit(pf_spec).items():
        assert "ESTIMATED" not in text, f"{rel} should carry no warning"


def test_index_lists_every_part_and_editing_note():
    spec = _spec(TURTLEBOT)
    kit = generate_kit(spec)
    index = kit["parts_index.md"]
    for info in part_infos(spec):
        assert f"`{info.filename}`" in index
        assert info.name in index
    assert "OpenSCAD" in index and "FreeCAD" in index  # other-CAD note
    # the TurtleBot's internal IMU is listed as not-a-printed-part
    assert "imu" in index


# --------------------------------------------------------------- determinism
def test_kit_generation_is_deterministic():
    for path in (PATHFINDER, TURTLEBOT):
        spec = _spec(path)
        assert generate_kit(spec) == generate_kit(spec)


# ----------------------------------------------------------------------- CLI
def test_cli_cad_writes_kit_and_prints_list():
    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td) / "kit"
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["cad", str(PATHFINDER), "--out-dir", str(out_dir)])
        assert rc == 0
        printed = buf.getvalue()
        for rel in generate_kit(_spec(PATHFINDER)):
            assert (out_dir / rel).is_file(), f"missing {rel}"
            assert rel in printed  # the CLI prints the same parts list
        assert "ESTIMATED" not in printed  # pathfinder is not a photo draft


def test_cli_cad_photo_spec_prints_estimated_banner():
    with tempfile.TemporaryDirectory() as td:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["cad", str(TURTLEBOT),
                           "--out-dir", str(Path(td) / "kit")])
        assert rc == 0
        assert "ESTIMATED" in buf.getvalue()


def test_render_stls_without_openscad_binary():
    if shutil.which("openscad") is not None:
        return  # environment has the binary; the skip path is not testable
    with tempfile.TemporaryDirectory() as td:
        kit_dir = Path(td)
        write_kit(_spec(PATHFINDER), kit_dir)
        assert render_stls(kit_dir) is None  # skipped, not an error
