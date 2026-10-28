"""URDF generation from a validated RobotSpec.

Day-1 scope: a box chassis with cylindrical wheels placed for differential /
skid-steer layouts — enough for a headless Gazebo spawn and the motion gate.
Richer geometry (casters, sensor meshes, ackermann steering joints) lands
iteratively during the event window.
"""
from __future__ import annotations

from xml.sax.saxutils import escape

from .schema import RobotSpec


def _box_inertial(mass: float, x: float, y: float, z: float) -> str:
    ixx = mass * (y * y + z * z) / 12.0
    iyy = mass * (x * x + z * z) / 12.0
    izz = mass * (x * x + y * y) / 12.0
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
