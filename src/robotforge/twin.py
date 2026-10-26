"""Gazebo twin: SDF generation + a headless motion run on Gazebo Harmonic.

The spec's URDF is for interchange; for the twin we emit SDF directly (the
format Gazebo simulates) with the DiffDrive system plugin bound to the
spec's wheel geometry — four-wheel skid-steer is expressed as two driven
pairs, which is how DiffDrive models skid steering.

Runner contract: works on the verified stack (Ubuntu 24.04, Gazebo Harmonic,
`gz sim` server-only). It publishes Twist commands on the model's cmd_vel
topic, captures the DiffDrive odometry stream, and returns the measured
distance / heading for the gate. It never fabricates a result: any failure
to run raises TwinError with the step that failed.
"""
from __future__ import annotations

import math
import re
import subprocess
import time
from pathlib import Path

from .schema import RobotSpec


class TwinError(RuntimeError):
    pass


# ---------------------------------------------------------------- SDF model
def generate_sdf(spec: RobotSpec) -> str:
    r = spec.wheel.diameter_m / 2.0
    chassis_z = spec.ground_clearance_m + spec.height_m / 2.0
    wheel_x = spec.length_m / 2.0 - spec.wheel.diameter_m / 2.0
    wheel_y = spec.width_m / 2.0 + spec.wheel.width_m / 2.0
    wheel_mass = spec.component_mass_kg.get("wheels", 0.4) / 4.0

    def box_inertia(m, x, y, z):
        return (f"<inertial><mass>{m:.4f}</mass>"
                f"<inertia><ixx>{m*(y*y+z*z)/12:.6f}</ixx><ixy>0</ixy><ixz>0</ixz>"
                f"<iyy>{m*(x*x+z*z)/12:.6f}</iyy><iyz>0</iyz>"
                f"<izz>{m*(x*x+y*y)/12:.6f}</izz></inertia></inertial>")

    out = ['<?xml version="1.0"?>', '<sdf version="1.9">',
           f'<model name="{spec.name}">',
           f'  <link name="base_link"><pose>0 0 {chassis_z:.4f} 0 0 0</pose>',
           f'    {box_inertia(spec.mass_kg, spec.length_m, spec.width_m, spec.height_m)}',
           f'    <collision name="c"><geometry><box><size>{spec.length_m} '
           f'{spec.width_m} {spec.height_m}</size></box></geometry></collision>',
           f'    <visual name="v"><geometry><box><size>{spec.length_m} '
           f'{spec.width_m} {spec.height_m}</size></box></geometry></visual>',
           '  </link>']

    joints = []
    for label, x, y in (("front_left", wheel_x, wheel_y),
                        ("front_right", wheel_x, -wheel_y),
                        ("rear_left", -wheel_x, wheel_y),
                        ("rear_right", -wheel_x, -wheel_y)):
        out += [
            f'  <link name="wheel_{label}"><pose>{x:.4f} {y:.4f} {r:.4f} 0 0 0</pose>',
            f'    {box_inertia(wheel_mass, r*2, spec.wheel.width_m, r*2)}',
            f'    <collision name="c"><pose>0 0 0 1.5708 0 0</pose><geometry>'
            f'<cylinder><radius>{r}</radius><length>{spec.wheel.width_m}</length>'
            f'</cylinder></geometry></collision>',
            f'    <visual name="v"><pose>0 0 0 1.5708 0 0</pose><geometry>'
            f'<cylinder><radius>{r}</radius><length>{spec.wheel.width_m}</length>'
            f'</cylinder></geometry></visual>',
            '  </link>',
            f'  <joint name="wheel_{label}_joint" type="revolute">',
            f'    <parent>base_link</parent><child>wheel_{label}</child>',
            '    <axis><xyz>0 1 0</xyz>'
            '<dynamics><damping>0.1</damping></dynamics></axis>',
            '  </joint>',
        ]
        joints.append(f"wheel_{label}_joint")

    left = [j for j in joints if j.endswith("left_joint")]
    right = [j for j in joints if j.endswith("right_joint")]
    plugin = ['  <plugin filename="gz-sim-diff-drive-system" '
              'name="gz::sim::systems::DiffDrive">',
              '    <topic>cmd_vel</topic>']
    plugin += [f'    <left_joint>{j}</left_joint>' for j in left]
    plugin += [f'    <right_joint>{j}</right_joint>' for j in right]
    plugin += [f'    <wheel_separation>{2 * wheel_y:.4f}</wheel_separation>',
               f'    <wheel_radius>{r:.4f}</wheel_radius>',
               '    <odom_topic>odom</odom_topic>',
               '    <odom_publish_frequency>20</odom_publish_frequency>',
               '  </plugin>']
    out += plugin
    out.append('</model></sdf>')
    return "\n".join(out) + "\n"


def generate_world(spec: RobotSpec, model_sdf_path: str) -> str:
    return f'''<?xml version="1.0"?>
<sdf version="1.9">
  <world name="robotforge_world">
    <physics name="default_physics" type="ignored">
      <max_step_size>0.001</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-scene-broadcaster-system"
            name="gz::sim::systems::SceneBroadcaster"/>
    <light name="sun" type="directional"><pose>0 0 10 0 0 0</pose></light>
    <model name="ground_plane">
      <static>true</static>
      <link name="link">
        <collision name="c"><geometry><plane><normal>0 0 1</normal>
          <size>100 100</size></plane></geometry>
          <surface><friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction>
          </surface></collision>
        <visual name="v"><geometry><plane><normal>0 0 1</normal>
          <size>100 100</size></plane></geometry></visual>
      </link>
    </model>
    <include><uri>file://{model_sdf_path}</uri><name>{spec.name}</name>
      <pose>0 0 0 0 0 0</pose></include>
  </world>
</sdf>
'''


# ------------------------------------------------------------- motion runner
def _yaw_from_quat(x: float, y: float, z: float, w: float) -> float:
    return math.degrees(math.atan2(2 * (w * z + x * y),
                                   1 - 2 * (y * y + z * z)))


_ODOM_POSE = re.compile(
    r"position\s*\{(?P<pos>[^}]*)\}\s*orientation\s*\{(?P<ori>[^}]*)\}", re.M)


def _odom_field(block: str, name: str, default: float = 0.0) -> float:
    m = re.search(name + r":\s*([-\d.e+]+)", block)
    return float(m.group(1)) if m else default


def parse_last_odom(text: str) -> tuple[float, float, float]:
    """Return (x, y, heading_deg) from the last odometry pose in gz echo text.

    Protobuf text output omits scalar fields whose value is zero, so any
    component (position z, quaternion x/y, ...) may be absent; absent means
    0.0 (and an absent quaternion w means the identity value 1.0 is wrong
    only when w is exactly 0, which planar motion never produces here).
    """
    matches = _ODOM_POSE.findall(text)
    if not matches:
        raise TwinError("no odometry poses captured from the twin run")
    pos, ori = matches[-1]
    x = _odom_field(pos, "x")
    y = _odom_field(pos, "y")
    qx = _odom_field(ori, "x")
    qy = _odom_field(ori, "y")
    qz = _odom_field(ori, "z")
    qw = _odom_field(ori, "w", 1.0)
    return x, y, _yaw_from_quat(qx, qy, qz, qw)


def run_motion_check(spec: RobotSpec, workdir: Path, *,
                     drive_m: float = 1.0, speed_mps: float = 0.25,
                     turn_deg: float = 90.0, turn_rate_dps: float = 45.0) -> dict:
    """Run drive + turn in headless Gazebo; return measured results.

    Raises TwinError on any step that fails — the caller must surface that,
    never a fabricated measurement.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    model = workdir / "model.sdf"
    world = workdir / "world.sdf"
    model.write_text(generate_sdf(spec))
    world.write_text(generate_world(spec, str(model.resolve())))

    gz = subprocess.Popen(["gz", "sim", "-s", "-r", str(world)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    echo = None
    try:
        time.sleep(4.0)  # world load
        if gz.poll() is not None:
            raise TwinError("gz sim exited during startup")
        odom_log = workdir / "odom.txt"
        echo = subprocess.Popen(["gz", "topic", "-e", "-t", "/odom"],
                                stdout=odom_log.open("w"),
                                stderr=subprocess.DEVNULL)
        time.sleep(1.0)

        def pub(linear: float, angular: float) -> None:
            subprocess.run(
                ["gz", "topic", "-t", "/cmd_vel", "-m", "gz.msgs.Twist",
                 "-p", f"linear: {{x: {linear}}}, angular: {{z: {angular}}}"],
                check=True, timeout=10,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        pub(speed_mps, 0.0)
        time.sleep(drive_m / speed_mps)
        pub(0.0, 0.0)
        time.sleep(1.0)  # settle; drive measurement taken here
        mid = odom_log.read_text() if odom_log.exists() else ""
        dx, dy, _ = parse_last_odom(mid)
        measured_drive = math.hypot(dx, dy)

        pub(0.0, math.radians(turn_rate_dps))
        time.sleep(turn_deg / turn_rate_dps)
        pub(0.0, 0.0)
        time.sleep(1.0)
        final = odom_log.read_text()
        _, _, heading = parse_last_odom(final)
        return {"drive": {"commanded_m": drive_m, "measured_m": measured_drive},
                "turn": {"commanded_deg": turn_deg, "measured_deg": heading}}
    finally:
        if echo is not None:
            echo.terminate()
        gz.terminate()
        try:
            gz.wait(timeout=5)
        except subprocess.TimeoutExpired:
            gz.kill()
