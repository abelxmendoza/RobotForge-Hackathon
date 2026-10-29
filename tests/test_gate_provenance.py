"""Every gate report carries its Gazebo version, physics step, input hash
and the scope of a simulated PASS."""
import json
import subprocess
from pathlib import Path

from robotforge import twin
from robotforge.schema import RobotSpec
from robotforge.gate import SIM_SCOPE, run_provenance, spec_sha256

ROOT = Path(__file__).resolve().parents[1]


def test_spec_hash_ignores_key_order_but_not_values():
    a = {"name": "x", "mass_kg": 2.0}
    assert spec_sha256(a) == spec_sha256({"mass_kg": 2.0, "name": "x"})
    assert spec_sha256(a) != spec_sha256({"name": "x", "mass_kg": 2.1})


def test_provenance_block_names_version_step_hash_and_scope():
    doc = run_provenance({"name": "x"}, gazebo_version="8.9.0",
                         max_step_s=0.001, robotforge_version="0.1.0")
    assert doc["gazebo_version"] == "8.9.0"
    assert doc["physics_max_step_s"] == 0.001
    assert len(doc["spec_sha256"]) == 64
    assert doc["scope"] == SIM_SCOPE and "not a hardware test" in SIM_SCOPE


def test_world_uses_the_recorded_physics_step():
    spec = RobotSpec.from_dict(json.loads(
        (ROOT / "examples" / "pathfinder.json").read_text()))
    world = twin.generate_world(spec, "model.sdf")
    assert f"<max_step_size>{twin.PHYSICS_MAX_STEP_S:g}</max_step_size>" \
        in world


def test_gazebo_version_reads_the_cli(monkeypatch):
    monkeypatch.setattr(twin.shutil, "which", lambda _: "/usr/bin/gz")
    monkeypatch.setattr(
        twin.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout="8.9.0\n"))
    assert twin.gazebo_version() == "8.9.0"


def test_gazebo_version_never_guesses(monkeypatch):
    monkeypatch.setattr(twin.shutil, "which", lambda _: None)
    monkeypatch.setitem(__import__("sys").modules, "gz.sim8", None)
    assert twin.gazebo_version() == "unknown"
