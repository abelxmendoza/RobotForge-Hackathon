"""Specimens: a real robot, decomposed part by part from its own
published model.

A specimen starts from the manufacturer's (or project's) official
URDF — never from our imagination — and emits an assembly tree: one
node per URDF link, with the link's world pose computed by forward
kinematics and baked in, its official visual mesh (URL pinned to a
source commit), its mass, and an honesty tier per part:

- REAL_MESH      — the link has a visual mesh in the official model.
- COLLISION_BOX  — no visual mesh is published; the official
                   collision box is what exists, so that is what
                   the viewer draws, labeled as such.
- FRAME_ONLY     — the link is an empty frame in the model (the
                   hardware lives inside another part); the viewer
                   shows a marker, never an invented shape.

RobotForge annotations (display names, plain-language roles, related
catalogue parts) are layered on top of the real tree and declared as
annotations in the output — the tree itself, the poses, the masses
and the tiers come from the source file alone. Meshes stay at their
source (linked, license recorded); nothing here bundles an asset.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path

# RobotForge annotations for the Burger's link tree: display name,
# plain-language role, and catalogue parts that are RELATED (with the
# difference stated — a related part is not the same part).
BURGER_ANNOTATIONS = {
    "base_link": {
        "name": "Chassis — the whole Burger stack",
        "role": "Every plate, board and battery of the Burger, fused "
                "into a single mesh in the official model. ROBOTIS "
                "does not publish the stack plate by plate here.",
        "related": [
            {"part": "chassis_plate",
             "note": "the catalogue's generated plate is one layer of "
                     "this stack, not the whole base"},
        ],
    },
    "wheel_left_link": {
        "name": "Driven wheel + tire (left)",
        "role": "The left drive wheel: a 66 mm tire on its hub, "
                "straight from the official model.",
        "related": [
            {"part": "wheel_100mm",
             "note": "the catalogue wheel is 100 mm — a different, "
                     "larger wheel (Pathfinder size)"},
        ],
    },
    "wheel_right_link": {
        "name": "Driven wheel + tire (right)",
        "role": "The right drive wheel: a 66 mm tire on its hub, "
                "straight from the official model.",
        "related": [
            {"part": "wheel_100mm",
             "note": "the catalogue wheel is 100 mm — a different, "
                     "larger wheel (Pathfinder size)"},
        ],
    },
    "caster_back_link": {
        "name": "Rear caster",
        "role": "The passive rear support. The official model gives "
                "it a collision box but no visual mesh, so the "
                "viewer draws the box, labeled.",
        "related": [
            {"part": "caster_ball",
             "note": "the catalogue's ball caster is the same job "
                     "in a different shape"},
        ],
    },
    "imu_link": {
        "name": "IMU (frame only)",
        "role": "The model carries only the IMU's frame — the sensor "
                "itself sits on the OpenCR board inside the base.",
        "related": [
            {"part": "imu_bno055",
             "note": "a standalone IMU breakout; the Burger's IMU "
                     "is on its controller board instead"},
        ],
    },
    "base_scan": {
        "name": "LDS-01 lidar",
        "role": "The spinning 360° laser scanner on top (HLDS "
                "HLS-LFCD-LDS-01) — the Burger's eyes.",
        "related": [
            {"part": "rplidar_a1",
             "note": "the catalogue's lidar is a Slamtec unit — "
                     "same job, different sensor"},
        ],
    },
}

ANNOTATIONS = {"turtlebot3_burger": BURGER_ANNOTATIONS}

# The body other parts explode away from stays almost still.
_STAY = {"base_link"}


def _nums(text: str | None, n: int) -> list[float]:
    vals = [float(v) for v in (text or "").split()]
    return (vals + [0.0] * n)[:n]


def _rot(rpy: list[float]) -> list[list[float]]:
    """URDF rotation: R = Rz(yaw) * Ry(pitch) * Rx(roll)."""
    r, p, y = rpy
    cr, sr, cp, sp, cy, sy = (math.cos(r), math.sin(r), math.cos(p),
                              math.sin(p), math.cos(y), math.sin(y))
    return [
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp, cp * sr, cp * cr],
    ]


def _mat_vec(m: list[list[float]], v: list[float]) -> list[float]:
    return [sum(m[i][j] * v[j] for j in range(3)) for i in range(3)]


def _mat_mul(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    return [[sum(a[i][k] * b[k][j] for k in range(3))
             for j in range(3)] for i in range(3)]


def _quat(m: list[list[float]]) -> list[float]:
    """Rotation matrix -> quaternion [x, y, z, w]."""
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w, x, y, z = (s / 4, (m[2][1] - m[1][2]) / s,
                      (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s)
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2
        w, x, y, z = ((m[2][1] - m[1][2]) / s, s / 4,
                      (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s)
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2
        w, x, y, z = ((m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s,
                      s / 4, (m[1][2] + m[2][1]) / s)
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2
        w, x, y, z = ((m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s,
                      (m[1][2] + m[2][1]) / s, s / 4)
    return [round(v, 6) for v in (x, y, z, w)]


def _origin(el: ET.Element | None) -> tuple[list[float], list[list[float]]]:
    if el is None:
        return [0.0, 0.0, 0.0], _rot([0.0, 0.0, 0.0])
    return _nums(el.get("xyz"), 3), _rot(_nums(el.get("rpy"), 3))


def _clean(link_name: str) -> str:
    return link_name.replace("${namespace}", "")


def build_specimen(urdf_path: str | Path, *, repo: str, commit: str,
                   package: str, robot_label: str, dex_id: str,
                   license_name: str, retrieved: str) -> dict:
    """Parse a URDF into a specimen assembly tree (see module docs).

    Mesh URLs are pinned to `commit` in `repo` (raw.githubusercontent
    form); `package` is the ROS package name the URDF's package://
    URLs refer to, whose files live at the repo path prefix recorded
    per part.
    """
    root = ET.parse(urdf_path).getroot()
    robot_name = root.get("name", "")

    materials = {}
    for mat in root.findall("material"):
        color = mat.find("color")
        if color is not None:
            materials[mat.get("name")] = _nums(color.get("rgba"), 4)

    joints = {}
    for j in root.findall("joint"):
        p_el, c_el = j.find("parent"), j.find("child")
        parent = _clean(p_el.get("link")) if p_el is not None else ""
        child = _clean(c_el.get("link")) if c_el is not None else ""
        xyz, rot = _origin(j.find("origin"))
        joints[child] = {"parent": parent, "xyz": xyz, "rot": rot,
                         "type": j.get("type", "fixed")}

    # Forward kinematics: world pose per link, root first.
    world: dict[str, tuple[list[float], list[list[float]]]] = {}

    def pose(link: str) -> tuple[list[float], list[list[float]]]:
        if link in world:
            return world[link]
        if link not in joints:  # a root link
            world[link] = ([0.0, 0.0, 0.0], _rot([0.0, 0.0, 0.0]))
            return world[link]
        j = joints[link]
        p_pos, p_rot = pose(j["parent"])
        off = _mat_vec(p_rot, j["xyz"])
        pos = [p_pos[i] + off[i] for i in range(3)]
        rot = _mat_mul(p_rot, j["rot"])
        world[link] = (pos, rot)
        return world[link]

    annotations = ANNOTATIONS.get(robot_name, {})
    raw_base = (f"https://raw.githubusercontent.com/{repo}/{commit}/")
    parts = []
    for link_el in root.findall("link"):
        link = _clean(link_el.get("name"))
        if link == "base_footprint":
            continue  # the ground frame is not a part
        l_pos, l_rot = pose(link)
        ann = annotations.get(link, {})

        visual = link_el.find("visual")
        mesh_rel = None
        scale = 1.0
        v_pos, v_rot = l_pos, l_rot
        mat_name = None
        if visual is not None:
            geo = visual.find("geometry")
            mesh_el = geo.find("mesh") if geo is not None else None
            if mesh_el is not None:
                fn = mesh_el.get("filename", "")
                prefix = f"package://{package}/"
                mesh_rel = fn[len(prefix):] if fn.startswith(prefix) else fn
                sc = _nums(mesh_el.get("scale"), 3)
                scale = sc[0] if sc else 1.0
            o_xyz, o_rot = _origin(visual.find("origin"))
            off = _mat_vec(l_rot, o_xyz)
            v_pos = [l_pos[i] + off[i] for i in range(3)]
            v_rot = _mat_mul(l_rot, o_rot)
            mat_el = visual.find("material")
            mat_name = mat_el.get("name") if mat_el is not None else None

        collision = link_el.find("collision")
        box = None
        b_pos, b_rot = l_pos, l_rot
        if collision is not None:
            geo = collision.find("geometry")
            box_el = geo.find("box") if geo is not None else None
            if box_el is not None:
                box = _nums(box_el.get("size"), 3)
                o_xyz, o_rot = _origin(collision.find("origin"))
                off = _mat_vec(l_rot, o_xyz)
                b_pos = [l_pos[i] + off[i] for i in range(3)]
                b_rot = _mat_mul(l_rot, o_rot)

        mass_el = link_el.find("inertial/mass")
        mass = float(mass_el.get("value")) if mass_el is not None else None

        if mesh_rel:
            tier, pos, rot = "REAL_MESH", v_pos, v_rot
        elif box:
            tier, pos, rot = "COLLISION_BOX", b_pos, b_rot
        else:
            tier, pos, rot = "FRAME_ONLY", l_pos, l_rot

        # Explode: away from the body centre, mostly along the
        # part's own offset; the base stays as the reference.
        if link in _STAY:
            explode = [0.0, 0.0, 0.015]
        else:
            d = [pos[0], pos[1], pos[2] - 0.06]
            if pos[2] <= 0.04:
                d[2] = 0.0  # ground-level parts slide out, never sink
            norm = math.sqrt(sum(v * v for v in d)) or 1.0
            explode = [round(v / norm * 0.09, 4) for v in d]

        part = {
            "id": link,
            "name": ann.get("name", link.replace("_", " ")),
            "role": ann.get("role", ""),
            "tier": tier,
            "position": [round(v, 5) for v in pos],
            "quaternion": _quat(rot),
            "explode": explode,
            "mass_kg": mass,
            "material": mat_name,
            "color_rgba": materials.get(mat_name) if mat_name else None,
            "related_catalog_parts": ann.get("related", []),
        }
        if mesh_rel:
            repo_path = f"{package}/{mesh_rel}"
            part["mesh_file"] = repo_path
            part["mesh_url"] = raw_base + repo_path
            part["scale"] = scale
        if box:
            part["collision_box_m"] = box
        parts.append(part)

    return {
        "specimen": {
            "robot": robot_label,
            "dex_id": dex_id,
            "source": {
                "repo": f"https://github.com/{repo}",
                "commit": commit,
                "urdf": str(urdf_path).split("/")[-1],
                "package": package,
                "license": license_name,
                "retrieved": retrieved,
            },
            "annotation_note": "Display names, roles and catalogue "
                "relations are RobotForge annotations layered on the "
                "official link tree; poses, masses, meshes and tiers "
                "come from the source URDF alone.",
            "honesty": [
                "The official Burger model fuses the whole chassis "
                "stack into one mesh — it is shown as one part "
                "because that is what ROBOTIS publishes.",
                "The rear caster has no visual mesh in the official "
                "model; it is drawn as its official collision box.",
                "The IMU link is an empty frame in the model; a "
                "marker stands at its real position.",
                "Meshes load from the pinned source commit, "
                "license recorded; nothing is re-hosted here.",
            ],
            "parts": parts,
        }
    }
