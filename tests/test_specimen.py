"""Specimen tests: the Burger's assembly tree comes from ROBOTIS's
own URDF — poses by forward kinematics, tiers by what the official
model actually publishes, mesh URLs pinned to the source commit.
The committed specimen JSON is the artifact the kit viewer loads."""
import json
import math
from pathlib import Path

from robotforge.specimen import build_specimen

REPO = Path(__file__).resolve().parent.parent
SPECIMEN = REPO / "catalog" / "specimens" / "turtlebot3-burger.json"
COMMIT = "fc817ce3073af1d6032397c64504134882af5e9a"

FIXTURE = """<?xml version="1.0"?>
<robot name="turtlebot3_burger">
  <material name="dark"><color rgba="0.3 0.3 0.3 1.0"/></material>
  <link name="${namespace}base_footprint"/>
  <joint name="base_joint" type="fixed">
    <parent link="${namespace}base_footprint"/>
    <child link="${namespace}base_link"/>
    <origin xyz="0 0 0.010" rpy="0 0 0"/>
  </joint>
  <link name="${namespace}base_link">
    <visual><origin xyz="-0.032 0 0" rpy="0 0 0"/>
      <geometry><mesh filename="package://turtlebot3_description/meshes/bases/burger_base.stl" scale="0.001 0.001 0.001"/></geometry>
      <material name="dark"/></visual>
    <inertial><mass value="0.8"/></inertial>
  </link>
  <joint name="wheel_left_joint" type="continuous">
    <parent link="${namespace}base_link"/>
    <child link="${namespace}wheel_left_link"/>
    <origin xyz="0 0.08 0.023" rpy="-1.57 0 0"/><axis xyz="0 0 1"/>
  </joint>
  <link name="${namespace}wheel_left_link">
    <visual><origin xyz="0 0 0" rpy="1.57 0 0"/>
      <geometry><mesh filename="package://turtlebot3_description/meshes/wheels/left_tire.stl" scale="0.001 0.001 0.001"/></geometry>
    </visual>
  </link>
  <joint name="caster_joint" type="fixed">
    <parent link="${namespace}base_link"/>
    <child link="${namespace}caster_back_link"/>
    <origin xyz="-0.081 0 -0.004" rpy="0 0 0"/>
  </joint>
  <link name="${namespace}caster_back_link">
    <collision><origin xyz="0 0 0" rpy="0 0 0"/>
      <geometry><box size="0.030 0.009 0.020"/></geometry></collision>
  </link>
  <joint name="imu_joint" type="fixed">
    <parent link="${namespace}base_link"/>
    <child link="${namespace}imu_link"/>
    <origin xyz="-0.032 0 0.068" rpy="0 0 0"/>
  </joint>
  <link name="${namespace}imu_link"/>
</robot>
"""


def _build(tmp_path):
    urdf = tmp_path / "burger.urdf"
    urdf.write_text(FIXTURE)
    return build_specimen(
        urdf, repo="ROBOTIS-GIT/turtlebot3", commit=COMMIT,
        package="turtlebot3_description", robot_label="TurtleBot3 Burger",
        dex_id="#002", license_name="Apache-2.0",
        retrieved="2026-10-26")["specimen"]


def test_fk_poses_match_the_urdf(tmp_path):
    parts = {p["id"]: p for p in _build(tmp_path)["parts"]}
    # base sits 10 mm over the footprint, mesh shifted 32 mm back
    assert parts["base_link"]["position"] == [-0.032, 0.0, 0.01]
    # wheel: joint (0, .08, .023) under a 10 mm base -> z .033, and
    # the joint/visual -90/+90 degree rolls cancel to identity
    wheel = parts["wheel_left_link"]
    assert wheel["position"] == [0.0, 0.08, 0.033]
    assert wheel["quaternion"] == [0.0, 0.0, 0.0, 1.0]
    # imu frame rides 68 mm above the base origin
    assert parts["imu_link"]["position"] == [-0.032, 0.0, 0.078]


def test_tiers_reflect_what_the_model_publishes(tmp_path):
    parts = {p["id"]: p for p in _build(tmp_path)["parts"]}
    assert parts["base_link"]["tier"] == "REAL_MESH"
    assert parts["wheel_left_link"]["tier"] == "REAL_MESH"
    assert parts["caster_back_link"]["tier"] == "COLLISION_BOX"
    assert parts["caster_back_link"]["collision_box_m"] == [0.03, 0.009, 0.02]
    assert parts["imu_link"]["tier"] == "FRAME_ONLY"
    assert "mesh_url" not in parts["imu_link"]


def test_mesh_urls_are_pinned_and_ground_parts_slide_not_sink(tmp_path):
    parts = {p["id"]: p for p in _build(tmp_path)["parts"]}
    url = parts["base_link"]["mesh_url"]
    assert url == ("https://raw.githubusercontent.com/ROBOTIS-GIT/"
                   f"turtlebot3/{COMMIT}/turtlebot3_description/"
                   "meshes/bases/burger_base.stl")
    assert parts["base_link"]["scale"] == 0.001
    assert parts["wheel_left_link"]["explode"][2] == 0.0
    assert parts["wheel_left_link"]["explode"][1] > 0.08


def test_committed_burger_specimen_is_the_real_tree():
    doc = json.loads(SPECIMEN.read_text())["specimen"]
    src = doc["source"]
    assert src["commit"] == COMMIT and len(src["commit"]) == 40
    assert src["license"] == "Apache-2.0"
    assert src["repo"] == "https://github.com/ROBOTIS-GIT/turtlebot3"
    parts = {p["id"]: p for p in doc["parts"]}
    # the real link tree: footprint is a frame, never a part
    assert set(parts) == {"base_link", "wheel_left_link",
                          "wheel_right_link", "caster_back_link",
                          "imu_link", "base_scan"}
    scan = parts["base_scan"]
    assert scan["tier"] == "REAL_MESH"
    assert scan["position"][2] == 0.182  # lidar rides on top
    assert math.isclose(scan["mass_kg"], 0.114)
    assert parts["base_link"]["mass_kg"] > 0.8
    # every mesh URL is pinned to the same commit
    for p in parts.values():
        if "mesh_url" in p:
            assert f"/{COMMIT}/" in p["mesh_url"]
    # the honesty notes ship with the data, not just the code
    assert any("fuses the whole chassis" in h for h in doc["honesty"])


def test_kit_page_wires_the_real_model_mode():
    kit = (REPO / "kit.html").read_text()
    assert 'id="realBtn"' in kit
    assert "STLLoader" in kit
    assert "catalog/specimens/turtlebot3-burger.json" in kit
