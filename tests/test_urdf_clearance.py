"""Cross-check generated URDF and SDF collision geometry against declared ground clearance."""
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import pytest

from robotforge.schema import RobotSpec
from robotforge.twin import generate_sdf
from robotforge.urdf import (
    generate_urdf,
    verify_sdf_clearance,
    verify_urdf_clearance,
)
from robotforge.validate import ERROR, validate

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


@pytest.mark.parametrize(
    "spec_file",
    ["pathfinder.json", "turtlebot3-burger.json", "photo-turtlebot.json"],
)
def test_generated_urdf_and_sdf_collision_match_declared_clearance(spec_file: str):
    spec = RobotSpec.from_json((EXAMPLES / spec_file).read_text())
    urdf_info = verify_urdf_clearance(spec)
    assert math.isclose(urdf_info["clearance_m"], spec.ground_clearance_m, abs_tol=1e-6)
    assert math.isclose(
        urdf_info["chassis_bottom_z"] - urdf_info["wheel_contact_z"],
        spec.ground_clearance_m,
        abs_tol=1e-6,
    )

    sdf_xml = generate_sdf(spec)
    sdf_info = verify_sdf_clearance(spec, sdf_xml)
    assert math.isclose(sdf_info["wheel_contact_z"], 0.0, abs_tol=1e-6)
    assert math.isclose(sdf_info["chassis_bottom_z"], spec.ground_clearance_m, abs_tol=1e-4)
    assert math.isclose(sdf_info["clearance_m"], spec.ground_clearance_m, abs_tol=1e-4)


def test_tampered_urdf_single_wheel_non_coplanar_is_flagged_by_validator():
    spec = RobotSpec.from_json((EXAMPLES / "pathfinder.json").read_text())
    root = ET.fromstring(generate_urdf(spec))
    first_joint_origin = root.find("./joint/origin")
    assert first_joint_origin is not None
    xyz = [float(v) for v in first_joint_origin.attrib["xyz"].split()]
    xyz[2] -= 0.02
    first_joint_origin.set("xyz", f"{xyz[0]} {xyz[1]} {xyz[2]}")
    bad_urdf = ET.tostring(root, encoding="unicode")

    with pytest.raises(ValueError, match="not coplanar"):
        verify_urdf_clearance(spec, bad_urdf)

    findings = validate(spec, urdf_xml=bad_urdf)
    assert any(
        f.severity == ERROR and f.check == "geometry.collision_clearance_mismatch"
        for f in findings
    )


def test_uniformly_shifted_urdf_clearance_mismatch_is_rejected():
    spec = RobotSpec.from_json((EXAMPLES / "pathfinder.json").read_text())
    bad_urdf = generate_urdf(spec).replace("-0.075", "-0.095")
    with pytest.raises(ValueError, match="does not match declared ground_clearance_m"):
        verify_urdf_clearance(spec, bad_urdf)


def test_tampered_sdf_collision_clearance_is_rejected():
    spec = RobotSpec.from_json((EXAMPLES / "pathfinder.json").read_text())
    root = ET.fromstring(generate_sdf(spec))
    base_pose = root.find("./model/link[@name='base_link']/pose")
    assert base_pose is not None and base_pose.text is not None
    parts = base_pose.text.split()
    parts[2] = f"{float(parts[2]) + 0.025:.4f}"
    base_pose.text = " ".join(parts)
    bad_sdf = ET.tostring(root, encoding="unicode")

    with pytest.raises(ValueError, match="does not match declared ground_clearance_m"):
        verify_sdf_clearance(spec, bad_sdf)
