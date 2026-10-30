"""Provenance tests for the scaled specimen imports (Job 2).

Same contract as the Go2 specimen tests (test_go2_specimen.py),
generalized: every imported robot's catalog/specimens/<slug>.json
manifest pins an upstream repo, a commit and a description file
(URDF, MJCF or SDF); the specimen block on the robot's robots.json
entry agrees with the manifest; the license was read from the
upstream repo's actual LICENSE file; and an import never touches
the gate verdict or the parts kit — every specimen robot stays
NOT_GATED with its kit placeholder intact.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "catalog"

# slug -> (expected repo, description-path key, expected suffix,
#          license read from the upstream LICENSE file)
EXPECT = {
    "openmanipulator-x": (
        "https://github.com/ROBOTIS-GIT/open_manipulator", "urdf",
        "open_manipulator_x/open_manipulator_x.urdf", "Apache-2.0"),
    "crazyflie-2-1": (
        "https://github.com/utiasDSL/gym-pybullet-drones", "urdf",
        "gym_pybullet_drones/assets/cf2p.urdf", "MIT"),
    "px4-x500": (
        "https://github.com/PX4/PX4-gazebo-models", "sdf",
        "models/x500_base/model.sdf", "BSD-3-Clause"),
    "robotis-op3": (
        "https://github.com/deepmind/mujoco_menagerie", "mjcf",
        "robotis_op3/op3.xml", "Apache-2.0"),
}


def _robots():
    data = json.loads((CATALOG / "robots.json").read_text(encoding="utf-8"))
    return {r["spec_file"].removeprefix("examples/").removesuffix(".json"): r
            for r in data["robots"]}


def _manifest(slug):
    path = CATALOG / "specimens" / f"{slug}.json"
    assert path.is_file(), f"missing specimen manifest: {path}"
    return json.loads(path.read_text(encoding="utf-8"))["specimen"]


def _check(slug):
    repo_url, key, suffix, license_id = EXPECT[slug]
    spec = _manifest(slug)
    src = spec["source"]
    assert src["repo"] == repo_url
    assert len(src["commit"]) == 40 and int(src["commit"], 16) >= 0
    assert src[key].endswith(suffix)
    assert src["license"] == license_id
    assert "LICENSE" in src["license_evidence"]
    entry = _robots()[slug]
    block = entry.get("specimen")
    assert block, f"{slug} has no specimen block in robots.json"
    assert block["kind"] == "imported_description"
    assert block["manifest"] == f"catalog/specimens/{slug}.json"
    assert block["source_repo"] == src["repo"]
    assert block["source_commit"] == src["commit"]
    assert block[key] == src[key]
    assert block["license"] == src["license"]
    assert block["facts"] == spec["facts"]
    f = spec["facts"]
    assert sum(f["joints_by_type"].values()) == f["joint_count"]
    assert f["total_mass_kg"] > 0
    # An import is provenance, not a verdict — and the parts kit
    # stays exactly as the Robodex pass left it.
    gate = entry["gate_status"]
    assert (gate["status"] if isinstance(gate, dict) else gate) == "NOT_GATED"
    return entry, spec


def test_openmanipulator_x_specimen():
    _, spec = _check("openmanipulator-x")
    f = spec["facts"]
    # 4 arm revolute + a mimicked gripper = 5 DOF; the URDF's
    # inertial sum (0.594057 kg) matches the catalog entry's note.
    assert f["robot_name_in_urdf"] == "open_manipulator_x"
    assert f["degrees_of_freedom"] == 5
    assert f["joints_by_type"] == {"fixed": 2, "prismatic": 2,
                                    "revolute": 4}
    assert f["total_mass_kg"] == 0.594057


def test_crazyflie_specimen_names_the_version_mismatch():
    _, spec = _check("crazyflie-2-1")
    f = spec["facts"]
    assert f["robot_name_in_urdf"] == "cf2"
    assert f["rotor_count"] == 4
    assert f["total_mass_kg"] == 0.027  # 27 g — the 2.0's mass
    # The upstream file describes the Crazyflie 2.0 while the
    # Robodex entry is the 2.1: the manifest must say so, plainly.
    honesty = " ".join(spec["honesty"])
    assert "2.0" in honesty and "2.1" in honesty
    assert "2.0" in spec["annotation_note"]


def test_x500_specimen():
    entry, spec = _check("px4-x500")
    f = spec["facts"]
    assert f["robot_name_in_sdf"] == "x500_base"
    assert f["rotor_count"] == 4
    assert f["rotor_span_m"] == {"x": 0.348, "y": 0.348}
    assert f["total_mass_kg"] == 2.064308
    # The block names its direct-import source (no robot_descriptions
    # module exists for the X500).
    assert "PX4" in entry["specimen"]["source_label"]
    # The entry's pre-existing provenance claimed BSD-3-Clause for
    # these models; the specimen import verified it from the actual
    # upstream LICENSE file at the pinned commit.
    assert "BSD-3-Clause" in entry["provenance"]["license"]


def test_op3_specimen():
    _, spec = _check("robotis-op3")
    f = spec["facts"]
    assert f["robot_name_in_mjcf"] == "robotis_op3"
    # 20 hinge joints + the root body's free joint; 20 position
    # actuators — the OP3's 20-DOF layout, from the file.
    assert f["joints_by_type"] == {"free": 1, "hinge": 20}
    assert f["actuator_count"] == 20
    assert f["degrees_of_freedom"] == 20
    # The menagerie model is simplified: its inertial sum
    # (3.14747 kg) sits below the e-Manual's ~3.5 kg, and the
    # manifest must disclose that rather than hide it.
    assert f["total_mass_kg"] == 3.14747
    assert "simplified" in " ".join(spec["honesty"])


def test_specimen_imports_leave_parts_kits_untouched():
    kits = json.loads(
        (CATALOG / "parts-kits.json").read_text(encoding="utf-8"))["kits"]
    for slug in EXPECT:
        assert kits[slug]["kit"] is None
        assert kits[slug]["reason"]
