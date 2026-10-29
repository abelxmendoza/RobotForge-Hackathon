"""Gazebo twin: SDF generation + a headless motion run on Gazebo Harmonic.

The spec's URDF is for interchange; for the twin we emit SDF directly (the
format Gazebo simulates) with the DiffDrive system plugin bound to the
spec's wheel geometry — four-wheel skid-steer is expressed as two driven
pairs, which is how DiffDrive models skid steering; a differential spec
gets two driven wheels on a central axle plus passive caster balls.

Runner contract: works on the verified stack (Ubuntu 24.04, Gazebo Harmonic,
`gz sim` server-only). It publishes Twist commands on the model's cmd_vel
topic, captures the DiffDrive odometry stream AND the world's ground-truth
pose stream (dynamic_pose/info, model entity only), and returns both for
the gate — the gate judges the motion against ground truth and the
odometry against ground truth, so a robot whose odometry lies cannot pass
itself. Fault injection (`wheel_radius_scale`) scales only the physical
wheel geometry; the plugin keeps the spec radius. It never fabricates a
result: any failure to run raises TwinError with the step that failed.

Command publish + odometry read go through a transport (see
make_transport): the in-process gz-transport Python bindings when they are
importable — one persistent publisher/subscriber, no per-command process
spawns — with the streamed `gz topic` CLI pair kept as an automatic
fallback. The transport used is printed at the start of every run.

Server placement: by default the runner spawns `gz sim` as a subprocess
and talks to it across processes. gz-transport discovery is UDP
multicast, so on hosts where UDP is unavailable (this sandbox: sendto
returns EPERM even on loopback) cross-process nodes never discover each
other and no odometry arrives. For those hosts run_motion_check falls
back to an in-process server (gz.sim8 Python bindings): the simulator
runs in the runner's own process, where gz-transport discovery/delivery
is process-local and needs no UDP. Same world, same plugins, same
measurements — only where the server process sits changes.
"""
from __future__ import annotations

import gc
import glob
import math
import os
import re
import select
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from .schema import RobotSpec
from .urdf import box_inertia


class TwinError(RuntimeError):
    pass


# ---------------------------------------------------------------- SDF model
def generate_sdf(spec: RobotSpec, *,
                 geometry_wheel_radius_m: float | None = None) -> str:
    r = spec.wheel.diameter_m / 2.0
    # Physical wheel geometry radius. Defaults to the spec radius; the
    # gate's fault injection overrides ONLY this, simulating a robot
    # whose as-built wheels differ from its paperwork while its odometry
    # still believes the paperwork (the classic wheel-radius config
    # lie). The DiffDrive plugin below always uses the spec radius.
    gr = r if geometry_wheel_radius_m is None else geometry_wheel_radius_m
    chassis_z = spec.ground_clearance_m + spec.height_m / 2.0
    wheel_x = spec.length_m / 2.0 - spec.wheel.diameter_m / 2.0
    wheel_y = spec.width_m / 2.0 + spec.wheel.width_m / 2.0
    wheel_mass = spec.component_mass_kg.get("wheels", 0.4) / 4.0

    def sdf_inertial(m, x, y, z):
        # The inertia math itself is shared with urdf.py: see
        # box_inertia there. Only the SDF wrapping lives here.
        ixx, iyy, izz = box_inertia(m, x, y, z)
        return (f"<inertial><mass>{m:.4f}</mass>"
                f"<inertia><ixx>{ixx:.6f}</ixx><ixy>0</ixy><ixz>0</ixz>"
                f"<iyy>{iyy:.6f}</iyy><iyz>0</iyz>"
                f"<izz>{izz:.6f}</izz></inertia></inertial>")

    out = ['<?xml version="1.0"?>', '<sdf version="1.9">',
           f'<model name="{spec.name}">',
           f'  <link name="base_link"><pose>0 0 {chassis_z:.4f} 0 0 0</pose>',
           f'    {sdf_inertial(spec.mass_kg, spec.length_m, spec.width_m, spec.height_m)}',
           f'    <collision name="c"><geometry><box><size>{spec.length_m} '
           f'{spec.width_m} {spec.height_m}</size></box></geometry></collision>',
           f'    <visual name="v"><geometry><box><size>{spec.length_m} '
           f'{spec.width_m} {spec.height_m}</size></box></geometry></visual>',
           '  </link>']

    joints = []
    if spec.drivetrain == "differential":
        # Two driven wheels on a central axle + passive caster balls
        # front and rear. Casters are low-friction spheres on fixed
        # joints: they carry the body's ends without steering geometry.
        wheel_positions = (("left", 0.0, wheel_y), ("right", 0.0, -wheel_y))
        caster_r = min(gr, 0.03)
        for label, cx in (("front", spec.length_m / 2.0 - caster_r),
                          ("rear", -spec.length_m / 2.0 + caster_r)):
            out += [
                f'  <link name="caster_{label}"><pose>{cx:.4f} 0 {caster_r:.4f} 0 0 0</pose>',
                f'    {sdf_inertial(0.02, caster_r*2, caster_r*2, caster_r*2)}',
                '    <collision name="c"><geometry>'
                f'<sphere><radius>{caster_r}</radius></sphere></geometry>'
                '<surface><friction><ode><mu>0.05</mu><mu2>0.05</mu2></ode>'
                '</friction></surface></collision>',
                '    <visual name="v"><geometry>'
                f'<sphere><radius>{caster_r}</radius></sphere></geometry></visual>',
                '  </link>',
                f'  <joint name="caster_{label}_joint" type="fixed">',
                f'    <parent>base_link</parent><child>caster_{label}</child>',
                '  </joint>',
            ]
    else:
        wheel_positions = (("front_left", wheel_x, wheel_y),
                           ("front_right", wheel_x, -wheel_y),
                           ("rear_left", -wheel_x, wheel_y),
                           ("rear_right", -wheel_x, -wheel_y))
    for label, x, y in wheel_positions:
        out += [
            f'  <link name="wheel_{label}"><pose>{x:.4f} {y:.4f} {gr:.4f} 0 0 0</pose>',
            f'    {sdf_inertial(wheel_mass, gr*2, spec.wheel.width_m, gr*2)}',
            f'    <collision name="c"><pose>0 0 0 1.5708 0 0</pose><geometry>'
            f'<cylinder><radius>{gr}</radius><length>{spec.wheel.width_m}</length>'
            f'</cylinder></geometry></collision>',
            f'    <visual name="v"><pose>0 0 0 1.5708 0 0</pose><geometry>'
            f'<cylinder><radius>{gr}</radius><length>{spec.wheel.width_m}</length>'
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


# Simulation environments for the wheeled twins. "flat" is the world
# every recorded gate run used: one 100 x 100 plane, mu = 1.0. "ramp"
# and "rough" are generated presets (Wave 3 environment registry —
# the web picker's entries describe these by id); they add static
# geometry only, and no gate run is recorded in them yet, so no
# verdict anywhere cites them.
WORLD_ENVIRONMENTS = ("flat", "ramp", "rough")


def _ramp_model() -> str:
    """One inclined slab ahead of the spawn point: a 4 m run rising
    ~0.48 m (a ~7 degree pitch), wide enough for any Robodex rover."""
    return '''    <model name="ramp">
      <static>true</static>
      <pose>5.5 0 0.36 0 -0.12 0</pose>
      <link name="link">
        <collision name="c"><geometry><box><size>4 3 0.25</size></box></geometry>
          <surface><friction><ode><mu>1.0</mu><mu2>1.0</mu2></ode></friction>
          </surface></collision>
        <visual name="v"><geometry><box><size>4 3 0.25</size></box></geometry></visual>
      </link>
    </model>
'''


def _rough_model() -> str:
    """A deterministic field of low blocks (30-60 mm) either side of
    the drive line: rough ground a wheeled twin must clatter over."""
    boxes = []
    for i, x in enumerate((3.0, 4.5, 6.0, 7.5, 9.0)):
        for j, y in enumerate((-2.25, -0.75, 0.75, 2.25)):
            h = 0.03 if (i + j) % 2 == 0 else 0.06
            boxes.append(
                f'        <collision name="c{i}{j}"><pose>{x} {y} '
                f'{h / 2} 0 0 0</pose><geometry><box><size>1.2 1.2 '
                f'{h}</size></box></geometry></collision>\n'
                f'        <visual name="v{i}{j}"><pose>{x} {y} '
                f'{h / 2} 0 0 0</pose><geometry><box><size>1.2 1.2 '
                f'{h}</size></box></geometry></visual>')
    body = "\n".join(boxes)
    return f'''    <model name="rough_field">
      <static>true</static>
      <link name="link">
{body}
      </link>
    </model>
'''


def generate_world(spec: RobotSpec, model_sdf_path: str,
                   environment: str = "flat") -> str:
    if environment not in WORLD_ENVIRONMENTS:
        raise ValueError(
            f"unknown environment {environment!r}; generated presets "
            f"are {', '.join(WORLD_ENVIRONMENTS)}")
    world = f'''<?xml version="1.0"?>
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
    if environment == "ramp":
        return world.replace("    <include>", _ramp_model() +
                             "    <include>", 1)
    if environment == "rough":
        return world.replace("    <include>", _rough_model() +
                             "    <include>", 1)
    return world


# ------------------------------------------------------------- motion runner
def _yaw_from_quat(x: float, y: float, z: float, w: float) -> float:
    return math.degrees(math.atan2(2 * (w * z + x * y),
                                   1 - 2 * (y * y + z * z)))


_ODOM_POSE = re.compile(
    r"position\s*\{(?P<pos>[^}]*)\}\s*orientation\s*\{(?P<ori>[^}]*)\}", re.M)


def _odom_field(block: str, name: str, default: float = 0.0) -> float:
    m = re.search(name + r":\s*([-\d.e+]+)", block)
    return float(m.group(1)) if m else default


def _pose_from_blocks(pos: str, ori: str) -> tuple[float, float, float]:
    x = _odom_field(pos, "x")
    y = _odom_field(pos, "y")
    qx = _odom_field(ori, "x")
    qy = _odom_field(ori, "y")
    qz = _odom_field(ori, "z")
    qw = _odom_field(ori, "w", 1.0)
    return x, y, _yaw_from_quat(qx, qy, qz, qw)


def extract_odom_poses(text: str):
    """Return (poses, rest): every complete pose in gz echo text, in order,
    plus the unconsumed tail (a trailing partial pose, which stream callers
    keep and re-present once the rest of it arrives)."""
    poses = []
    end = 0
    for m in _ODOM_POSE.finditer(text):
        poses.append(_pose_from_blocks(m.group("pos"), m.group("ori")))
        end = m.end()
    return poses, text[end:]


_POSE_NAME = re.compile(r'name:\s*"([^"]+)"')


def extract_named_poses(text: str, entity: str):
    """Like extract_odom_poses, but only poses whose message names
    `entity` exactly. Pose streams (PosePublisher) can interleave poses
    for links and nested entities ("robot::wheel_left"); ground truth
    for the gate is the model entity alone. The consumed prefix still
    advances past every complete pose block, matching or not, so the
    stream tail stays bounded by one partial message."""
    poses = []
    end = 0
    for m in _ODOM_POSE.finditer(text):
        head = text[max(0, m.start() - 2000):m.start()]
        names = _POSE_NAME.findall(head)
        if names and names[-1] == entity:
            poses.append(_pose_from_blocks(m.group("pos"), m.group("ori")))
        end = m.end()
    return poses, text[end:]


def iter_odom_poses(text: str):
    """Yield (x, y, heading_deg) for each complete pose in gz echo text."""
    poses, _ = extract_odom_poses(text)
    yield from poses


def parse_last_odom(text: str) -> tuple[float, float, float]:
    """Return (x, y, heading_deg) from the last odometry pose in gz echo text.

    Protobuf text output omits scalar fields whose value is zero, so any
    component (position z, quaternion x/y, ...) may be absent; absent means
    0.0 (and an absent quaternion w means the identity value 1.0 is wrong
    only when w is exactly 0, which planar motion never produces here).
    """
    poses = list(iter_odom_poses(text))
    if not poses:
        raise TwinError("no odometry poses captured from the twin run")
    return poses[-1]


def distance_between(start: tuple[float, float, float],
                      pose: tuple[float, float, float]) -> float:
    """Planar distance (m) traveled from start pose to pose."""
    return math.hypot(pose[0] - start[0], pose[1] - start[1])


def heading_change_deg(start_heading: float, heading: float) -> float:
    """Shortest signed heading change from start_heading to heading, in
    (-180, 180] degrees — safe across the +/-180 wrap."""
    return (heading - start_heading + 180.0) % 360.0 - 180.0


def drive_reached(start: tuple[float, float, float],
                  pose: tuple[float, float, float], target_m: float) -> bool:
    return distance_between(start, pose) >= target_m


def turn_reached(start_heading: float, heading: float,
                 target_deg: float) -> bool:
    return abs(heading_change_deg(start_heading, heading)) >= target_deg


class _OdomStream:
    """Live odometry from a long-lived `gz topic -e` echo, read as a pipe
    stream (os.read on the raw fd) instead of polling a growing log file, so
    the feedback loop sees poses as they are published. The raw stream is
    also tee'd to the workdir's odom.txt for inspection."""

    def __init__(self, log_path: Path):
        self._log = log_path.open("wb")
        self._proc = subprocess.Popen(
            ["gz", "topic", "-e", "-t", "/odom"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            start_new_session=True)
        self._tail = ""
        self.latest: tuple[float, float, float] | None = None

    def poll(self) -> tuple[float, float, float] | None:
        """Drain whatever the echo has published; return the latest pose."""
        fd = self._proc.stdout.fileno()
        while True:
            ready, _, _ = select.select([fd], [], [], 0)
            if not ready:
                break
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            self._log.write(chunk)
            self._log.flush()
            self._tail += chunk.decode(errors="replace")
        if self._tail:
            poses, self._tail = extract_odom_poses(self._tail)
            if poses:
                self.latest = poses[-1]
        return self.latest

    def close(self) -> None:
        _kill_group(self._proc)
        self._log.close()


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


class _CmdVelStream:
    """One Twist command re-published continuously on /cmd_vel until changed.

    A one-shot `gz topic -p` is a single point of failure on this stack:
    observed live, a lone publish is sometimes dropped before discovery
    completes (robot never moves) and the call itself takes ~0.85 s. Real
    cmd_vel sources stream, so the current command is re-issued back to
    back; a dropped copy self-heals on the next cycle. Stopping is the
    same mechanism with a zero Twist, held for the whole settle window.
    """

    def __init__(self):
        self._proc: subprocess.Popen | None = None

    def set(self, linear: float, angular: float) -> None:
        self.stop()
        msg = f"linear: {{x: {linear}}}, angular: {{z: {angular}}}"
        loop = ("while :; do gz topic -t /cmd_vel -m gz.msgs.Twist "
                f"-p '{msg}' >/dev/null 2>&1; done")
        self._proc = subprocess.Popen(
            ["bash", "-c", loop], stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True)

    def stop(self) -> None:
        if self._proc is not None:
            _kill_group(self._proc)
            self._proc = None


# ------------------------------------------------------------- transports
def _import_bindings():
    """Import the gz-transport Python bindings (gz.transport13 +
    gz.msgs10), returning (Node, Twist, Odometry) — or None when they are
    not importable on this machine.

    The gz.msgs10 modules are generated protobuf code that predates the
    protobuf runtime newer user site-packages install (protobuf >= 4
    refuses the old generated descriptors), so the first import can fail
    even though the bindings are installed. Selecting the pure-Python
    protobuf implementation before the first msgs import sidesteps that
    version wall: the wire format is identical, only (de)serialization
    speed changes, and Twist/Odometry at odometry rates are far too
    small for that to matter. When protobuf is already loaded with a
    working implementation, the import simply succeeds as-is.
    """
    try:
        from gz.transport13 import Node
    except Exception:
        return None
    if "google.protobuf" not in sys.modules:
        os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION",
                              "python")
    try:
        from gz.msgs10.odometry_pb2 import Odometry
        from gz.msgs10.pose_v_pb2 import Pose_V
        from gz.msgs10.twist_pb2 import Twist
    except Exception:
        return None
    return Node, Twist, Odometry, Pose_V


class _BindingsTransport:
    """Cmd_vel publish + odometry subscribe in-process via one persistent
    gz-transport Node.

    The current Twist is re-published at 20 Hz by a daemon thread — the
    same streaming contract as _CmdVelStream, minus the ~0.85 s process
    startup per publish and the dropped one-shot publishes — and the
    /odom subscription callback keeps the latest pose plus its header
    stamp. Odometry is tee'd to the run log in protobuf text form,
    mirroring the CLI stream's odom.txt.
    """

    _RATE_HZ = 20.0

    def __init__(self, log_path: Path, bindings, model_name: str = ""):
        Node, Twist, Odometry, Pose_V = bindings
        self._Twist = Twist
        self._node = Node()
        self._pub = self._node.advertise("/cmd_vel", Twist)
        self._lock = threading.Lock()
        self._linear = 0.0
        self._angular = 0.0
        self.latest: tuple[float, float, float] | None = None
        self.latest_stamp: tuple[int, int] | None = None
        self._log = log_path.open("ab")
        self._closed = False
        self._node.subscribe(Odometry, "/odom", self._on_odom)
        self._model_name = model_name
        self.truth_latest: tuple[float, float, float] | None = None
        self._node.subscribe(Pose_V, "/world/robotforge_world/dynamic_pose/info",
                             self._on_pose_v)
        self._thread = threading.Thread(target=self._publish_loop,
                                         daemon=True)
        self._thread.start()

    def _on_odom(self, msg) -> None:
        p = msg.pose.position
        q = msg.pose.orientation
        with self._lock:
            self.latest = (p.x, p.y, _yaw_from_quat(q.x, q.y, q.z, q.w))
            self.latest_stamp = (msg.header.stamp.sec,
                                 msg.header.stamp.nsec)
        try:
            self._log.write((str(msg) + "\n").encode())
            self._log.flush()
        except Exception:
            pass  # the log is for inspection; never let it kill odometry

    def _on_pose_v(self, msg) -> None:
        for pose in msg.pose:
            if pose.name == self._model_name:
                p, q = pose.position, pose.orientation
                with self._lock:
                    self.truth_latest = (p.x, p.y, _yaw_from_quat(
                        q.x, q.y, q.z, q.w))

    def _publish_loop(self) -> None:
        period = 1.0 / self._RATE_HZ
        while not self._closed:
            with self._lock:
                linear, angular = self._linear, self._angular
            msg = self._Twist()
            msg.linear.x = linear
            msg.angular.z = angular
            self._pub.publish(msg)
            time.sleep(period)

    def set(self, linear: float, angular: float) -> None:
        with self._lock:
            self._linear, self._angular = linear, angular

    def poll(self) -> tuple[float, float, float] | None:
        with self._lock:
            return self.latest

    def poll_truth(self) -> tuple[float, float, float] | None:
        with self._lock:
            return self.truth_latest

    def close(self) -> None:
        self.set(0.0, 0.0)
        time.sleep(0.15)  # let a few zero Twists out before teardown
        self._closed = True
        self._thread.join(timeout=1.0)
        self._log.close()


class _CliTransport:
    """Adapter giving the streamed-CLI pair (_OdomStream + _CmdVelStream)
    the same set/poll/close interface as _BindingsTransport."""

    def __init__(self, log_path: Path, model_name: str = ""):
        self._odom = _OdomStream(log_path)
        self._truth = _TruthStream(
            log_path.with_name("truth.txt"), model_name)
        self._cmd = _CmdVelStream()

    def set(self, linear: float, angular: float) -> None:
        self._cmd.set(linear, angular)

    def poll(self) -> tuple[float, float, float] | None:
        return self._odom.poll()

    def poll_truth(self) -> tuple[float, float, float] | None:
        return self._truth.poll()

    def close(self) -> None:
        self._cmd.stop()
        self._odom.close()
        self._truth.close()



class _TruthStream:
    """Ground-truth poses from the world's dynamic_pose/info echo (CLI
    transport): the same long-lived `gz topic -e` pattern as _OdomStream,
    parsed with extract_named_poses so only the model entity counts."""

    def __init__(self, log_path: Path, model_name: str):
        self._log = log_path.open("wb")
        self._proc = subprocess.Popen(
            ["gz", "topic", "-e", "-t",
             "/world/robotforge_world/dynamic_pose/info"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            start_new_session=True)
        self._tail = ""
        self._model_name = model_name
        self.latest: tuple[float, float, float] | None = None

    def poll(self) -> tuple[float, float, float] | None:
        fd = self._proc.stdout.fileno()
        while True:
            ready, _, _ = select.select([fd], [], [], 0)
            if not ready:
                break
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            self._log.write(chunk)
            self._log.flush()
            self._tail += chunk.decode(errors="replace")
        if self._tail:
            poses, self._tail = extract_named_poses(self._tail,
                                                    self._model_name)
            if poses:
                self.latest = poses[-1]
        return self.latest

    def close(self) -> None:
        _kill_group(self._proc)
        self._log.close()

def make_transport(log_path: Path, model_name: str = ""):
    """Return (transport, name): the gz-transport bindings when they are
    importable, otherwise the streamed-CLI fallback. The name is printed
    at the start of every run, so a result always states how the twin was
    actuated and measured."""
    bindings = _import_bindings()
    if bindings is not None:
        return _BindingsTransport(log_path, bindings, model_name), \
            "gz-transport bindings (gz.transport13)"
    return _CliTransport(log_path, model_name), "gz CLI (streamed)"


def _require_gz() -> None:
    """Raise TwinError when the Gazebo CLI is not on PATH.

    Every spawn in a twin run needs `gz` — `gz sim` itself plus the
    streamed `gz topic` echo pair of the CLI transport — and a missing
    binary otherwise surfaces as a raw FileNotFoundError traceback from
    subprocess.Popen. Checking once, before anything spawns, turns that
    into the clean TwinError the runner reports every other failure as.
    """
    if shutil.which("gz") is None:
        raise TwinError(
            "Gazebo (gz) not found on PATH — the gate runs the spec in "
            "Gazebo, so gz is required; install Gazebo and re-run")


def _pose_stable(a: tuple[float, float, float],
                 b: tuple[float, float, float]) -> bool:
    """True when two poses are the same within odometry noise (robot
    settled): < 1 mm of translation and < 0.1 deg of heading change."""
    return (math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001
            and abs(heading_change_deg(a[2], b[2])) < 0.1)


def _import_sim_bindings():
    """Import the gz-sim Python bindings (gz.sim8), returning
    (Server, ServerConfig) — or None when they are not importable."""
    try:
        from gz.sim8 import Server, ServerConfig
    except Exception:
        return None
    return Server, ServerConfig


def _ensure_physics_engine_path(workdir: Path) -> None:
    """Make the DART physics engine plugin findable for an in-process
    server (sets GZ_SIM_PHYSICS_ENGINE_PATH when it is unset).

    The Physics system asks the gz-plugin loader for
    "gz-physics-dartsim-plugin", but distro runtime packages ship only
    the versioned library (libgz-physics7-dartsim-plugin.so.7.x) in the
    engine-plugins directory and the loader does not match it — a stock
    headless install then steps iterations with no dynamics and the
    robot never moves. When a versioned plugin is found without an
    unversioned name beside it, link both names into
    <workdir>/engine-plugins and point the loader there. Pure search
    plumbing: the engine itself and every physics parameter are the
    distro's, untouched.
    """
    if os.environ.get("GZ_SIM_PHYSICS_ENGINE_PATH"):
        return
    versioned = None
    for pattern in ("/usr/lib/*/gz-physics-*/engine-plugins",
                    "/usr/lib/gz-physics-*/engine-plugins",
                    "/usr/local/lib/*/gz-physics-*/engine-plugins"):
        for engine_dir in sorted(glob.glob(pattern)):
            names = os.listdir(engine_dir)
            if "libgz-physics-dartsim-plugin.so" in names:
                os.environ["GZ_SIM_PHYSICS_ENGINE_PATH"] = engine_dir
                return
            for name in sorted(names):
                if name.startswith("libgz-physics") \
                        and "dartsim-plugin.so" in name:
                    versioned = Path(engine_dir) / name
    if versioned is None:
        return  # nothing found: leave the loader's defaults to decide
    link_dir = workdir / "engine-plugins"
    link_dir.mkdir(parents=True, exist_ok=True)
    for link_name in ("libgz-physics-dartsim-plugin.so",
                      versioned.name.rsplit(".so", 1)[0] + ".so"):
        link = link_dir / link_name
        try:
            if not link.exists():
                link.symlink_to(versioned)
        except OSError:
            pass
    os.environ["GZ_SIM_PHYSICS_ENGINE_PATH"] = str(link_dir)


def _run_motion_check_once(spec: RobotSpec, workdir: Path, *,
                           drive_m: float = 1.0, speed_mps: float = 0.25,
                           turn_deg: float = 90.0, turn_rate_dps: float = 45.0,
                           wheel_radius_scale: float = 1.0,
                           embedded_server: bool = False) -> dict:
    """One motion run. With embedded_server=False the twin runs in a
    `gz sim` subprocess (the canonical stack); with True the gz-sim
    server runs in this process via the gz.sim8 bindings and commands /
    odometry flow through the bindings transport in the same process.
    The phases, measurements and failure behaviour are identical."""
    workdir.mkdir(parents=True, exist_ok=True)
    model = workdir / "model.sdf"
    world = workdir / "world.sdf"
    model.write_text(generate_sdf(
        spec, geometry_wheel_radius_m=
        spec.wheel.diameter_m / 2.0 * wheel_radius_scale))
    world.write_text(generate_world(spec, str(model.resolve())))

    gz = None
    server = None
    if embedded_server:
        sim = _import_sim_bindings()
        if sim is None:
            raise TwinError(
                "in-process twin requested but the gz-sim Python "
                "bindings (gz.sim8) are not importable")
        _ensure_physics_engine_path(workdir)
        Server, ServerConfig = sim
        config = ServerConfig()
        config.set_sdf_file(str(world.resolve()))
        server = Server(config)
        if not server.run(False, 0, False):
            raise TwinError("in-process gz-sim server failed to start")
    else:
        gz = subprocess.Popen(["gz", "sim", "-s", "-r", str(world)],
                              stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL,
                              start_new_session=True)
    transport = None
    try:
        time.sleep(4.0)  # world load
        if embedded_server:
            if not server.is_running():
                raise TwinError(
                    "in-process gz-sim server exited during startup")
            bindings = _import_bindings()
            if bindings is None:
                raise TwinError(
                    "in-process twin requires the gz-transport Python "
                    "bindings (gz.transport13) for same-process delivery")
            transport = _BindingsTransport(workdir / "odom.txt", bindings,
                                           spec.name)
            transport_name = ("gz-transport bindings (gz.transport13) "
                              "[in-process gz-sim server]")
        else:
            if gz.poll() is not None:
                raise TwinError("gz sim exited during startup")
            transport, transport_name = make_transport(workdir / "odom.txt",
                                                       spec.name)
        print(f"transport: {transport_name}")

        def await_pose(timeout_s: float) -> tuple[float, float, float]:
            deadline = time.monotonic() + timeout_s
            while time.monotonic() < deadline:
                pose = transport.poll()
                if pose is not None:
                    return pose
                time.sleep(0.02)
            raise TwinError("no odometry poses captured from the twin run")

        def run_phase(reached, timeout_s: float, phase: str) -> None:
            """Poll streamed odometry until reached(pose); TwinError on
            timeout. The caller owns the stop command."""
            deadline = time.monotonic() + timeout_s
            while time.monotonic() < deadline:
                pose = transport.poll()
                if pose is not None and reached(pose):
                    return
                time.sleep(0.02)
            raise TwinError(
                f"{phase} phase: target not reached within {timeout_s:.1f} s")

        def settle(min_s: float = 1.0, cap_s: float = 5.0) -> tuple:
            """Stream of poses until the robot is measurably at rest
            (pose stable for 0.3 s), at least min_s, at most cap_s."""
            start = time.monotonic()
            last_change = start
            prev = transport.poll()
            while True:
                now = time.monotonic()
                pose = transport.poll()
                if pose is not None and prev is not None \
                        and not _pose_stable(prev, pose):
                    last_change = now
                if pose is not None:
                    prev = pose
                if now - start >= min_s and now - last_change >= 0.3:
                    break
                if now - start >= cap_s:
                    raise TwinError("robot did not settle after stop")
                time.sleep(0.02)
            if prev is None:
                raise TwinError("no odometry poses captured from the twin run")
            return prev

        def await_truth(timeout_s: float) -> tuple[float, float, float]:
            deadline = time.monotonic() + timeout_s
            while time.monotonic() < deadline:
                pose = transport.poll_truth()
                if pose is not None:
                    return pose
                time.sleep(0.02)
            raise TwinError(
                "no ground-truth poses captured from the twin run")

        start_pose = await_pose(10.0)
        truth_start = await_truth(10.0)

        # Drive phase: stream the velocity; stop at the target distance.
        transport.set(speed_mps, 0.0)
        try:
            run_phase(lambda p: drive_reached(start_pose, p, drive_m),
                      3.0 * drive_m / speed_mps, "drive")
        finally:
            transport.set(0.0, 0.0)
        mid_pose = settle()
        measured_drive = distance_between(start_pose, mid_pose)
        truth_mid = await_truth(10.0)
        truth_drive = distance_between(truth_start, truth_mid)

        # Turn phase: stream the rate; stop at the target heading change.
        transport.set(0.0, math.radians(turn_rate_dps))
        try:
            run_phase(lambda p: turn_reached(mid_pose[2], p[2], turn_deg),
                      3.0 * turn_deg / turn_rate_dps, "turn")
        finally:
            transport.set(0.0, 0.0)
        final_pose = settle()
        truth_final = await_truth(10.0)
        return {"drive": {"commanded_m": drive_m,
                          "measured_m": measured_drive,
                          "truth_m": truth_drive},
                "turn": {"commanded_deg": turn_deg,
                         "measured_deg": final_pose[2],
                         "truth_deg": abs(heading_change_deg(
                             truth_mid[2], truth_final[2]))},
                "injected_wheel_radius_scale": wheel_radius_scale}
    finally:
        if transport is not None:
            transport.close()
        if gz is not None:
            _kill_group(gz)
        if server is not None:
            # The Python bindings expose no stop(): destroying the
            # Server stops its simulation threads.
            del server
            gc.collect()


def run_motion_check(spec: RobotSpec, workdir: Path, *,
                     drive_m: float = 1.0, speed_mps: float = 0.25,
                     turn_deg: float = 90.0, turn_rate_dps: float = 45.0,
                     wheel_radius_scale: float = 1.0,
                     embedded: bool | None = None) -> dict:
    """Run drive + turn in headless Gazebo; return measured results.

    Closed-loop stop: each phase streams a constant velocity command and
    watches the odometry stream, switching to a streamed stop as soon as
    the measured distance / heading change reaches the commanded target
    (no fixed-duration timing and no anticipatory offset). Commands and
    odometry flow through make_transport() — the gz-transport bindings
    when importable, else the streamed gz CLI — and the chosen transport
    is printed as `transport: ...` before the run. Measurements
    are read from odometry once the pose has settled — stability detected
    from the stream, minimum 1 s — the same post-settle measurement the
    earlier open-loop runs took; any residual overshoot is the honest
    result. Each phase has a hard timeout at 3x its nominal duration: on
    timeout the stop is streamed, the robot is given a moment, and
    TwinError is raised instead of returning a number.

    Server placement (`embedded`): False forces the canonical `gz sim`
    subprocess, True forces the in-process gz.sim8 server, and None
    (default) tries the subprocess first and — on hosts where
    cross-process gz-transport discovery cannot work (no UDP) — retries
    once in-process when the bindings for that are importable. The retry
    is a fresh run of the identical phases; a failed run never
    contributes measurements to a later one.

    Raises TwinError on any step that fails — the caller must surface that,
    never a fabricated measurement.
    """
    _require_gz()
    kwargs = dict(drive_m=drive_m, speed_mps=speed_mps, turn_deg=turn_deg,
                  turn_rate_dps=turn_rate_dps,
                  wheel_radius_scale=wheel_radius_scale)
    if embedded is not None:
        return _run_motion_check_once(spec, workdir,
                                      embedded_server=embedded, **kwargs)
    try:
        return _run_motion_check_once(spec, workdir,
                                      embedded_server=False, **kwargs)
    except TwinError as exc:
        if _import_sim_bindings() is None or _import_bindings() is None:
            raise
        print(f"subprocess twin failed ({exc}); retrying with the "
              "in-process gz-sim server (gz.sim8) — cross-process "
              "gz-transport discovery is unavailable on some hosts")
        return _run_motion_check_once(spec, workdir,
                                      embedded_server=True, **kwargs)
