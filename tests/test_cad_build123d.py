"""build123d CAD back end: optional, flag-gated, dimension-checked.

The flag-off and missing-dependency tests run everywhere. The tests
that build real solids skip cleanly when build123d is not installed
(it is an optional dependency — the default OpenSCAD engine and the
rest of the suite must never require it).
"""
import io
import json
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import cli
from robotforge.cad import generate_kit
from robotforge.cad_build123d import (Build123dUnavailableError,
                                      CadDimensionError, _validate_solid,
                                      build_parts, write_kit_build123d)
from robotforge.schema import RobotSpec

EXAMPLES = Path(__file__).parent.parent / "examples"
PATHFINDER = EXAMPLES / "pathfinder.json"
TURTLEBOT = EXAMPLES / "photo-turtlebot.json"


def _spec(path: Path) -> RobotSpec:
    return RobotSpec.from_json(path.read_text())


# ------------------------------------------------------------ gate: flag off
def test_default_engine_is_unchanged_openscad():
    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td) / "kit"
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["cad", str(PATHFINDER),
                           "--out-dir", str(out_dir)])
        assert rc == 0
        for rel in generate_kit(_spec(PATHFINDER)):
            assert (out_dir / rel).is_file(), f"missing {rel}"
        # the build123d back end left no trace in the default path
        assert not list(out_dir.rglob("*.step"))
        assert not list(out_dir.rglob("*.glb"))
        assert not (out_dir / "build123d_manifest.json").exists()


def test_engine_flag_is_registered():
    buf = io.StringIO()
    with redirect_stdout(buf), pytest.raises(SystemExit) as exc:
        cli.main(["cad", "--help"])
    assert exc.value.code == 0
    assert "build123d" in buf.getvalue()


def test_stl_flag_rejected_for_build123d_engine():
    with tempfile.TemporaryDirectory() as td:
        rc = cli.main(["cad", str(PATHFINDER), "--engine", "build123d",
                       "--stl", "--out-dir", str(Path(td) / "kit")])
        assert rc == 2


# ------------------------------------------------- missing optional dependency
def test_missing_build123d_fails_with_install_hint(monkeypatch):
    monkeypatch.setitem(sys.modules, "build123d", None)
    with pytest.raises(Build123dUnavailableError, match="optional"):
        build_parts(_spec(PATHFINDER))


# ------------------------------------------------------------- real back end
def test_build123d_plan_matches_openscad_plan():
    pytest.importorskip("build123d")
    scad_stems = {Path(rel).stem for rel in generate_kit(_spec(PATHFINDER))
                  if rel.endswith(".scad") and "assembly" not in rel}
    exports = build_parts(_spec(PATHFINDER))
    assert {Path(e.step_file).stem for e in exports} == scad_stems


def test_build123d_dimensions_match_spec():
    pytest.importorskip("build123d")
    spec = _spec(PATHFINDER)
    exports = {Path(e.step_file).stem: e for e in build_parts(spec)}
    wheel = exports["wheel"]
    assert wheel.measured_bbox_mm == pytest.approx(
        (spec.wheel.diameter_m * 1000, spec.wheel.diameter_m * 1000,
         spec.wheel.width_m * 1000), abs=0.05)
    chassis = exports["chassis_plate"]
    assert chassis.measured_bbox_mm == pytest.approx(
        (spec.length_m * 1000, spec.width_m * 1000, 4.0), abs=0.05)
    for exp in exports.values():
        assert exp.measured_bbox_mm == pytest.approx(
            exp.expected_bbox_mm, abs=0.05)
        assert exp.volume_mm3 > 0


def test_dimension_gate_fails_loudly_on_mismatch():
    b = pytest.importorskip("build123d")
    solid = b.Box(10, 10, 10)
    with pytest.raises(CadDimensionError, match="spec says"):
        _validate_solid("widget", solid, (12.0, 10.0, 10.0))


def test_write_kit_build123d_exports_step_glb_and_manifest():
    pytest.importorskip("build123d")
    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td) / "kit"
        exports = write_kit_build123d(_spec(TURTLEBOT), out_dir)
        assert len(exports) == 6  # chassis, wheel, mount, caster, lidar, camera
        for exp in exports:
            step = out_dir / exp.step_file
            glb = out_dir / exp.glb_file
            assert step.stat().st_size > 0
            assert glb.stat().st_size > 0
            assert step.read_bytes().startswith(b"ISO-10303-21;")
            assert glb.read_bytes()[:4] == b"glTF"  # binary glTF magic
        manifest = json.loads(
            (out_dir / "build123d_manifest.json").read_text())
        assert manifest["engine"] == "build123d"
        assert manifest["estimated"] is True  # photo draft stays labeled
        assert "ESTIMATED" in manifest["warning"]
        assert len(manifest["parts"]) == len(exports)
        # the reproducibility claim stays scoped: STEP is never
        # promised byte-identical anywhere in the manifest
        assert "not promised byte-identical" in manifest["scope"]


def test_cli_build123d_engine_end_to_end():
    pytest.importorskip("build123d")
    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td) / "kit"
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["cad", str(PATHFINDER), "--engine", "build123d",
                           "--out-dir", str(out_dir)])
        assert rc == 0
        printed = buf.getvalue()
        assert "build123d CAD kit" in printed
        assert "spec-checked" in printed
        assert (out_dir / "parts" / "wheel.step").is_file()
        assert (out_dir / "parts" / "wheel.glb").is_file()
        # no OpenSCAD files leak into a build123d kit
        assert not list(out_dir.rglob("*.scad"))
