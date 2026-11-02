"""URDF generation from a validated RobotSpec.

Day-1 scope: a box chassis with cylindrical wheels placed for differential /
skid-steer layouts — enough for a headless Gazebo spawn and the motion gate.
Richer geometry (casters, sensor meshes, ackermann steering joints) lands
iteratively during the event window.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

from .schema import RobotSpec


def box_inertia(mass: float, x: float, y: float, z: float) \
        -> tuple[float, float, float]:
    """Principal moments of inertia of a solid box: (ixx, iyy, izz).

    The one place this formula lives. URDF generation below and the
    Gazebo twin's SDF generation (`twin.py`) both call it — the two
    file formats wrap the same numbers differently, the math must not
    drift between them.
    """
    return (mass * (y * y + z * z) / 12.0,
            mass * (x * x + z * z) / 12.0,
            mass * (x * x + y * y) / 12.0)


def _box_inertial(mass: float, x: float, y: float, z: float) -> str:
    ixx, iyy, izz = box_inertia(mass, x, y, z)
    return (f'<inertial><mass value="{mass:.4f}"/>'
            f'<inertia ixx="{ixx:.6f}" ixy="0" ixz="0" iyy="{iyy:.6f}" '
            f'iyz="0" izz="{izz:.6f}"/></inertial>')


def generate_urdf(spec: RobotSpec) -> str:
    name = escape(spec.name)
    r = spec.wheel.diameter_m / 2.0
    chassis_z = spec.ground_clearance_m + spec.height_m / 2.0
    wheel_x = spec.length_m / 2.0 - spec.wheel.diameter_m / 2.0
    wheel_y = spec.width_m / 2.0 + spec.wheel.width_m / 2.0

    parts = ['<?xml version="1.0"?>',
             f'<robot name="{name}">',
             '  <link name="base_link">',
             f'    <visual><geometry><box size="{spec.length_m} {spec.width_m} '
             f'{spec.height_m}"/></geometry></visual>',
             f'    <collision><geometry><box size="{spec.length_m} {spec.width_m} '
             f'{spec.height_m}"/></geometry></collision>',
             f'    {_box_inertial(spec.mass_kg, spec.length_m, spec.width_m, spec.height_m)}',
             '  </link>']

    # Wheel placement: front/rear pairs; a 2-wheel differential layout gets
    # the pair at the chassis centre plus the caller adds casters later.
    if spec.wheel.count == 2:
        positions = [(0.0, wheel_y), (0.0, -wheel_y)]
    else:
        positions = [(wheel_x, wheel_y), (wheel_x, -wheel_y),
                     (-wheel_x, wheel_y), (-wheel_x, -wheel_y)][:spec.wheel.count]

    wheel_mass = spec.component_mass_kg.get("wheels", 0.4) / max(len(positions), 1)
    for i, (x, y) in enumerate(positions):
        side = "left" if y > 0 else "right"
        wname = f"wheel_{i}_{side}"
        parts += [
            f'  <link name="{wname}">',
            f'    <visual><origin rpy="1.5708 0 0"/><geometry>'
            f'<cylinder radius="{r}" length="{spec.wheel.width_m}"/></geometry></visual>',
            f'    <collision><origin rpy="1.5708 0 0"/><geometry>'
            f'<cylinder radius="{r}" length="{spec.wheel.width_m}"/></geometry></collision>',
            f'    {_box_inertial(wheel_mass, r * 2, spec.wheel.width_m, r * 2)}',
            '  </link>',
            f'  <joint name="{wname}_joint" type="continuous">',
            f'    <parent link="base_link"/><child link="{wname}"/>',
            f'    <origin xyz="{x} {y} {r - chassis_z}"/>',
            '    <axis xyz="0 1 0"/>',
            '  </joint>',
        ]
    parts.append('</robot>')
    return "\n".join(parts) + "\n"


def verify_urdf_clearance(
    spec: RobotSpec,
    urdf_xml: str | None = None,
    *,
    tol_m: float = 1e-4,
) -> dict[str, float]:
    """Cross-check wheel contact plane, chassis collision bottom, and declared
    ground clearance in a generated URDF model (conventional wheel-on-ground
    chassis configuration).

    Returns a dict with ``wheel_contact_z``, ``chassis_bottom_z``, and
    ``clearance_m`` (in ``base_link`` frame metres). Raises ``ValueError`` if
    the collision geometry is missing or disagrees with ``spec.ground_clearance_m``.
    """
    if spec.wheel is None or spec.ground_clearance_m is None:
        raise ValueError("verify_urdf_clearance requires a wheeled spec with ground_clearance_m")
    xml_text = generate_urdf(spec) if urdf_xml is None else urdf_xml
    root = ET.fromstring(xml_text)

    base_box = root.find("./link[@name='base_link']/collision/geometry/box")
    if base_box is None or not base_box.get("size"):
        raise ValueError("base_link collision box missing in URDF")
    box_dims = [float(v) for v in base_box.attrib["size"].split()]
    if len(box_dims) != 3:
        raise ValueError("base_link collision box size must have 3 dimensions")
    chassis_bottom_z = -box_dims[2] / 2.0

    wheel_radii: dict[str, float] = {}
    for link in root.findall("./link"):
        lname = link.get("name", "")
        if lname.startswith("wheel_"):
            cyl = link.find("./collision/geometry/cylinder")
            if cyl is None or cyl.get("radius") is None:
                raise ValueError(f"{lname} collision cylinder missing radius in URDF")
            wheel_radii[lname] = float(cyl.attrib["radius"])

    if not wheel_radii:
        raise ValueError("no wheel collision links found in URDF")

    contact_zs: list[float] = []
    for joint in root.findall("./joint"):
        child = joint.find("./child")
        origin = joint.find("./origin")
        cname = child.get("link", "") if child is not None else ""
        if cname in wheel_radii:
            if origin is None or not origin.get("xyz"):
                raise ValueError(f"joint for {cname} missing origin xyz in URDF")
            xyz = [float(v) for v in origin.attrib["xyz"].split()]
            contact_zs.append(xyz[2] - wheel_radii[cname])

    if len(contact_zs) != len(wheel_radii):
        raise ValueError("wheel joint count does not match wheel collision link count in URDF")

    wheel_contact_z = contact_zs[0]
    for z in contact_zs[1:]:
        if not math.isclose(z, wheel_contact_z, abs_tol=tol_m):
            raise ValueError(
                f"wheel contact planes are not coplanar: {z:.6f} m vs {wheel_contact_z:.6f} m"
            )

    clearance_m = chassis_bottom_z - wheel_contact_z
    if not math.isclose(clearance_m, spec.ground_clearance_m, abs_tol=tol_m):
        raise ValueError(
            f"generated URDF collision clearance {clearance_m:.4f} m does not match "
            f"declared ground_clearance_m {spec.ground_clearance_m:.4f} m"
        )
    return {
        "wheel_contact_z": wheel_contact_z,
        "chassis_bottom_z": chassis_bottom_z,
        "clearance_m": clearance_m,
    }


def verify_sdf_clearance(
    spec: RobotSpec,
    sdf_xml: str,
    *,
    tol_m: float = 1e-4,
) -> dict[str, float]:
    """Cross-check wheel contact plane, chassis collision bottom, and declared
    ground clearance in a generated Gazebo SDF model (world frame).
    """
    if spec.wheel is None or spec.ground_clearance_m is None:
        raise ValueError("verify_sdf_clearance requires a wheeled spec with ground_clearance_m")
    root = ET.fromstring(sdf_xml)
    model = root.find("./model")
    if model is None:
        raise ValueError("SDF model element missing")

    base_link = model.find("./link[@name='base_link']")
    if base_link is None:
        raise ValueError("base_link missing in SDF")
    pose_el = base_link.find("./pose")
    size_el = base_link.find("./collision/geometry/box/size")
    if pose_el is None or not pose_el.text or size_el is None or not size_el.text:
        raise ValueError("base_link pose or collision box size missing in SDF")
    base_z = float(pose_el.text.split()[2])
    box_h = float(size_el.text.split()[2])
    chassis_bottom_z = base_z - box_h / 2.0

    contact_zs: list[float] = []
    for link in model.findall("./link"):
        lname = link.get("name", "")
        if lname.startswith("wheel_"):
            wpose = link.find("./pose")
            wrad = link.find("./collision/geometry/cylinder/radius")
            if wpose is None or not wpose.text or wrad is None or not wrad.text:
                raise ValueError(f"{lname} pose or collision cylinder radius missing in SDF")
            wz = float(wpose.text.split()[2])
            wr = float(wrad.text)
            contact_zs.append(wz - wr)

    if not contact_zs:
        raise ValueError("no wheel collision links found in SDF")

    wheel_contact_z = contact_zs[0]
    for z in contact_zs[1:]:
        if not math.isclose(z, wheel_contact_z, abs_tol=tol_m):
            raise ValueError(
                f"SDF wheel contact planes are not coplanar: {z:.6f} m vs {wheel_contact_z:.6f} m"
            )

    clearance_m = chassis_bottom_z - wheel_contact_z
    if not math.isclose(clearance_m, spec.ground_clearance_m, abs_tol=tol_m):
        raise ValueError(
            f"generated SDF collision clearance {clearance_m:.4f} m does not match "
            f"declared ground_clearance_m {spec.ground_clearance_m:.4f} m"
        )
    return {
        "wheel_contact_z": wheel_contact_z,
        "chassis_bottom_z": chassis_bottom_z,
        "clearance_m": clearance_m,
    }

