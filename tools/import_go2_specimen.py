#!/usr/bin/env python3
"""Import external robot descriptions into the Robodex as specimens.

Can an external robot-description database grow the Robodex without
hand-typing specs? The first import (2026-10-29) was the Unitree Go2,
via the `robot_descriptions` Python package, which clones upstream
description repos and exposes each robot as an importable module.
This tool is now name-parameterized: each robot below is one registry
entry, and the Go2 path through it is byte-identical to the original
single-robot script (its manifest still verifies in sync).

    python3 tools/import_go2_specimen.py              # the Go2
    python3 tools/import_go2_specimen.py openmanipulator-x crazyflie-2-1
    python3 tools/import_go2_specimen.py --all

Everything recorded comes out of the actual downloaded files:

- the upstream repo URL and commit, from the clone itself (git);
- the license, from a LICENSE file in the upstream repo — its first
  line and copyright/version line are quoted verbatim in the
  manifest; if the repo had no LICENSE file the manifest would say
  so instead of naming a license;
- the facts, parsed from the description file the source exposes
  (URDF, MJCF or SDF) — nothing is copied from marketing tables.

Outputs per robot:

- catalog/specimens/<slug>.json — the specimen manifest: a source
  block plus honesty notes, with a `facts` block parsed from the
  description file.
- a verification pass over catalog/robots.json: the entry's
  `specimen` block must carry the same facts, license and source
  as this fresh extraction, and its gate status must still be
  NOT_GATED. The script never edits robots.json (a full re-dump
  would churn its formatting) — it fails loudly on drift instead.

The upstream description trees are NOT vendored into this repo: each
manifest pins repo + commit + description path, the same pattern the
Burger specimen uses for its meshes.

Sources per robot:

- Unitree Go2: robot_descriptions module `go2_description`, backed
  by Unitree's own unitree_ros repository (URDF).
- OpenManipulator-X: robot_descriptions module
  `open_manipulator_x_description`, backed by ROBOTIS's own
  open_manipulator repository (URDF).
- Crazyflie 2.1: robot_descriptions module `cf2_description`, backed
  by UTIAS's gym-pybullet-drones repository. That file describes the
  Crazyflie 2.0 — the manifest says so, in so many words; it is not
  silently equated with this entry's 2.1.
- ROBOTIS OP3: robot_descriptions module `op3_mj_description`,
  backed by DeepMind's MuJoCo Menagerie (MJCF) — a simplified model
  of ROBOTIS's humanoid, labeled as one.
- PX4 X500: no robot_descriptions module covers it, so the tool
  clones PX4's own PX4-gazebo-models repository directly and reads
  the x500_base SDF — the same file this entry's specs came from.

Requires the robot_descriptions package for the module-backed
robots (not a runtime dependency of RobotForge — an import-time
tool only):

    pip install robot_descriptions
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ROBOTS_JSON = REPO / "catalog" / "robots.json"
IMPORTED_DATE = "2026-10-29"
DIRECT_CACHE = Path.home() / ".cache" / "robotforge-specimens"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True).stdout.strip()


# ------------------------------------------------------------------
# License reading: quote the file, never assume.
# ------------------------------------------------------------------

def _read_license(license_file: Path, evidence_prefix: str):
    """Return (license_id, evidence) from an actual LICENSE file."""
    lines = [l.strip() for l in
             license_file.read_text(encoding="utf-8").splitlines()
             if l.strip()]
    head = lines[0]
    if head == "BSD 3-Clause License":
        license_id = "BSD-3-Clause"
    elif head == "MIT License":
        license_id = "MIT"
    elif head == "Apache License" and len(lines) > 1 \
            and lines[1].startswith("Version 2.0"):
        license_id = "Apache-2.0"
    else:
        license_id = head
    evidence = (f"{evidence_prefix}: {head!r}; "
                f"{lines[1] if len(lines) > 1 else ''}").rstrip("; ")
    return license_id, evidence


def _no_license():
    return ("no LICENSE file in upstream repo",
            "The upstream repo root has no LICENSE file; "
            "no license is claimed for it.")


# ------------------------------------------------------------------
# URDF fact extraction.
# ------------------------------------------------------------------

def _rot(rpy) -> list:
    r, p, y = rpy
    cr, sr = math.cos(r), math.sin(r)
    cp, sp = math.cos(p), math.sin(p)
    cy, sy = math.cos(y), math.sin(y)
    return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
            [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
            [-sp, cp * sr, cp * cr]]


def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)]
            for i in range(3)]


def _mv(a, v):
    return [sum(a[i][k] * v[k] for k in range(3)) for i in range(3)]


def extract_go2_facts(urdf_path: Path) -> dict:
    """Facts parsed from the Go2 URDF alone — nothing from any table.

    Verbatim from the original single-robot spike: the Go2 manifest
    must stay byte-identical, so this extractor is not generalized.
    """
    root = ET.parse(urdf_path).getroot()
    links = root.findall("link")
    joints = root.findall("joint")
    masses = {}
    for link in links:
        m = link.find("inertial/mass")
        if m is not None:
            masses[link.get("name")] = float(m.get("value"))
    total = sum(masses.values())
    legs = {}
    for prefix in ("FL", "FR", "RL", "RR"):
        legs[prefix] = round(sum(v for k, v in masses.items()
                                 if k.startswith(prefix)), 6)

    # Zero-pose forward kinematics over joint origins: where the
    # feet sit relative to the base origin with every joint at 0.
    children, child_links = {}, set()
    for j in joints:
        parent = j.find("parent").get("link")
        child = j.find("child").get("link")
        origin = j.find("origin")
        xyz = ([float(x) for x in origin.get("xyz", "0 0 0").split()]
               if origin is not None else [0.0, 0.0, 0.0])
        rpy = ([float(x) for x in origin.get("rpy", "0 0 0").split()]
               if origin is not None else [0.0, 0.0, 0.0])
        children.setdefault(parent, []).append((child, xyz, _rot(rpy)))
        child_links.add(child)
    roots = [l.get("name") for l in links if l.get("name") not in child_links]
    pos = {roots[0]: [0.0, 0.0, 0.0]}
    rot = {roots[0]: [[1, 0, 0], [0, 1, 0], [0, 0, 1]]}
    stack = [roots[0]]
    while stack:
        cur = stack.pop()
        for child, xyz, r_local in children.get(cur, []):
            rot[child] = _mul(rot[cur], r_local)
            off = _mv(rot[cur], xyz)
            pos[child] = [pos[cur][i] + off[i] for i in range(3)]
            stack.append(child)
    feet = {n: p for n, p in pos.items() if n.endswith("_foot")}
    xs = [p[0] for p in feet.values()]
    ys = [p[1] for p in feet.values()]

    return {
        "robot_name_in_urdf": root.get("name"),
        "link_count": len(links),
        "links_with_inertial": sum(1 for l in links
                                   if l.find("inertial") is not None),
        "joint_count": len(joints),
        "joints_by_type": dict(sorted(Counter(
            j.get("type") for j in joints).items())),
        "total_mass_kg": round(total, 6),
        "base_link_mass_kg": masses.get("base"),
        "leg_mass_kg_each": sorted(set(legs.values())),
        "zero_pose_foot_span_m": {
            "x": round(max(xs) - min(xs), 3),
            "y": round(max(ys) - min(ys), 3),
        },
        "zero_pose_foot_drop_m": round(abs(feet["FL_foot"][2]), 3),
        "fact_source": ("Parsed from the URDF at the pinned upstream "
                        "commit: link/joint elements, inertial masses, "
                        "and forward kinematics over joint origins at "
                        "the zero pose."),
    }


def _urdf_base_facts(root) -> dict:
    links = root.findall("link")
    joints = root.findall("joint")
    masses = {}
    for link in links:
        m = link.find("inertial/mass")
        if m is not None:
            masses[link.get("name")] = float(m.get("value"))
    child_links = {j.find("child").get("link") for j in joints
                   if j.find("child") is not None}
    roots = [l.get("name") for l in links
             if l.get("name") not in child_links]
    facts = {
        "robot_name_in_urdf": root.get("name"),
        "link_count": len(links),
        "links_with_inertial": sum(1 for l in links
                                   if l.find("inertial") is not None),
        "joint_count": len(joints),
        "joints_by_type": dict(sorted(Counter(
            j.get("type") for j in joints).items())),
        "total_mass_kg": round(sum(masses.values()), 6),
    }
    if roots and masses.get(roots[0]) is not None:
        facts["base_link_mass_kg"] = masses[roots[0]]
    return facts


def extract_arm_facts(urdf_path: Path) -> dict:
    """OpenManipulator-X: base URDF facts + the actuated joint set.

    Degrees of freedom counts actuated joints with mimic followers
    collapsed: the URDF's gripper_right_joint mimics
    gripper_left_joint, so the two prismatic finger joints are one
    gripper DOF — 4 revolute arm joints + 1 gripper = 5, the
    e-Manual's figure, derived here from the file itself.
    """
    root = ET.parse(urdf_path).getroot()
    facts = _urdf_base_facts(root)
    actuated = {"revolute": [], "prismatic": []}
    followers = set()
    for j in root.findall("joint"):
        if j.get("type") in actuated:
            actuated[j.get("type")].append(j.get("name"))
        mimic = j.find("mimic")
        if mimic is not None:
            followers.add(j.get("name"))
    facts["actuated_joints"] = actuated
    facts["degrees_of_freedom"] = (
        sum(len(v) for v in actuated.values()) - len(followers))
    facts["fact_source"] = (
        "Parsed from the URDF at the pinned upstream commit: "
        "link/joint elements, inertial masses, joint types and "
        "mimic tags (the gripper's right finger joint mimics the "
        "left, so the two prismatic joints count as one gripper "
        "degree of freedom).")
    return facts


def extract_cf2_facts(urdf_path: Path) -> dict:
    """Crazyflie 2.0 (cf2p.urdf): base facts + the rotor count.

    The file is a rigid model: every joint is fixed and the four
    propeller links carry zero mass — the facts say exactly that.
    """
    root = ET.parse(urdf_path).getroot()
    facts = _urdf_base_facts(root)
    facts["rotor_count"] = sum(
        1 for l in root.findall("link")
        if l.get("name", "").startswith("prop"))
    facts["fact_source"] = (
        "Parsed from the URDF at the pinned upstream commit: "
        "link/joint elements and inertial masses. Every joint in "
        "the file is fixed and the propeller links carry zero "
        "mass — a rigid-body model with no spinning-rotor dynamics.")
    return facts


# ------------------------------------------------------------------
# MJCF fact extraction (MuJoCo Menagerie OP3).
# ------------------------------------------------------------------

def extract_op3_facts(mjcf_path: Path) -> dict:
    """Facts parsed from the OP3 MJCF alone.

    Joint counting is scoped to <worldbody>: the file's <default>
    section carries an unnamed joint stub that is a property
    class, not a joint. The root body's <freejoint/> counts as one
    free joint alongside the named hinge joints.
    """
    root = ET.parse(mjcf_path).getroot()
    worldbody = root.find("worldbody")
    bodies = worldbody.findall(".//body")
    masses = {}
    for b in bodies:
        i = b.find("inertial")
        if i is not None:
            masses[b.get("name")] = float(i.get("mass"))
    joints = worldbody.findall(".//joint")
    types = Counter(j.get("type", "hinge") for j in joints)
    free = len(worldbody.findall(".//freejoint"))
    if free:
        types["free"] = free
    actuators = root.find("actuator")
    actuator_count = len(list(actuators)) if actuators is not None else 0
    return {
        "robot_name_in_mjcf": root.get("model"),
        "body_count": len(bodies),
        "bodies_with_inertial": len(masses),
        "joint_count": sum(types.values()),
        "joints_by_type": dict(sorted(types.items())),
        "actuator_count": actuator_count,
        "degrees_of_freedom": types.get("hinge", 0),
        "total_mass_kg": round(sum(masses.values()), 6),
        "root_body_mass_kg": masses.get(bodies[0].get("name")),
        "fact_source": ("Parsed from the MJCF at the pinned upstream "
                        "commit: body/inertial elements under "
                        "<worldbody>, joint elements (the <default> "
                        "class stub excluded), the root body's "
                        "<freejoint/> and the <actuator> list."),
    }


# ------------------------------------------------------------------
# SDF fact extraction (PX4 X500 base model).
# ------------------------------------------------------------------

def extract_x500_facts(sdf_path: Path) -> dict:
    """Facts parsed from the x500_base SDF alone."""
    root = ET.parse(sdf_path).getroot()
    model = root.find("model")
    links = model.findall("link")
    joints = model.findall("joint")
    masses = {}
    poses = {}
    for link in links:
        m = link.find("inertial/mass")
        if m is not None:
            masses[link.get("name")] = float(m.text)
        pose = link.find("pose")
        if pose is not None and pose.text:
            poses[link.get("name")] = [float(x)
                                       for x in pose.text.split()[:3]]
    rotors = {n: p for n, p in poses.items() if n.startswith("rotor_")}
    facts = {
        "robot_name_in_sdf": model.get("name"),
        "link_count": len(links),
        "links_with_inertial": len(masses),
        "joint_count": len(joints),
        "joints_by_type": dict(sorted(Counter(
            j.get("type") for j in joints).items())),
        "total_mass_kg": round(sum(masses.values()), 6),
        "base_link_mass_kg": masses.get("base_link"),
        "rotor_count": len(rotors),
    }
    if rotors:
        xs = [p[0] for p in rotors.values()]
        ys = [p[1] for p in rotors.values()]
        facts["rotor_span_m"] = {
            "x": round(max(xs) - min(xs), 3),
            "y": round(max(ys) - min(ys), 3),
        }
    facts["fact_source"] = (
        "Parsed from the SDF at the pinned upstream commit: "
        "link/joint elements, inertial masses and rotor link poses.")
    return facts


# ------------------------------------------------------------------
# Source resolution: where each description actually comes from.
# ------------------------------------------------------------------

def _module_source(module_name: str, attr: str):
    """Resolve a robot_descriptions module to (repo, commit, file...)."""
    mod = __import__(f"robot_descriptions.{module_name}",
                     fromlist=["_"])
    import robot_descriptions
    repo_path = Path(mod.REPOSITORY_PATH)
    desc_path = Path(getattr(mod, attr))
    repo_url = _git(repo_path, "remote", "get-url", "origin")
    if repo_url.endswith(".git"):
        repo_url = repo_url[:-4]
    return {
        "repo_path": repo_path,
        "desc_path": desc_path,
        "desc_rel": str(desc_path.relative_to(repo_path)),
        "repo_url": repo_url,
        "commit": _git(repo_path, "rev-parse", "HEAD"),
        "imported_via": (
            f"robot_descriptions {robot_descriptions.__version__} "
            f"(Python package), module "
            f"robot_descriptions.{module_name}"),
    }


def _direct_source(repo_url: str, desc_rel: str):
    """Clone (once) and resolve a manufacturer's repo directly."""
    name = repo_url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git")
    repo_path = DIRECT_CACHE / name
    if not repo_path.exists():
        DIRECT_CACHE.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", repo_url,
                        str(repo_path)], check=True)
    return {
        "repo_path": repo_path,
        "desc_path": repo_path / desc_rel,
        "desc_rel": desc_rel,
        "repo_url": repo_url,
        "commit": _git(repo_path, "rev-parse", "HEAD"),
        "imported_via": (
            "direct clone of the manufacturer's model repo "
            "(no robot_descriptions module covers this robot); "
            "description read at the pinned commit"),
    }


# ------------------------------------------------------------------
# The registry. Strings in `annotation_note`/`honesty` are part of
# the committed record — the Go2's are verbatim from the spike.
# ------------------------------------------------------------------

def _go2(cfg, src):
    license_file = src["repo_path"] / "LICENSE"
    if license_file.exists():
        lid, ev = _read_license(
            license_file, "LICENSE file at the upstream repo root")
    else:
        lid, ev = _no_license()
    return {
        "source": {
            "repo": src["repo_url"],
            "commit": src["commit"],
            "urdf": src["desc_rel"],
            "package": "go2_description",
            "license": lid,
            "license_evidence": ev,
            "retrieved": IMPORTED_DATE,
        },
        "facts": extract_go2_facts(src["desc_path"]),
        "annotation_note": (
            "This entry arrived by import, not by hand: the "
            "description was downloaded by robot_descriptions "
            "from Unitree's own repository and the facts above "
            "were parsed out of its URDF. Nothing here was gated "
            "— importing a description is not a verdict."),
        "honesty": [
            "Gate status stays NOT_GATED: the motion gate grades "
            "wheeled ground robots, and no walking gate exists yet.",
            "The parts kit stays undefined (kit: null in "
            "catalog/parts-kits.json): the kit generator builds "
            "wheeled kits from a spec's wheel block, and this "
            "robot has no wheels.",
            "The entry's standing dimensions (0.70 x 0.31 x 0.40 m) "
            "come from Unitree's published parameter table, not "
            "from this URDF; the URDF's own zero-pose foot span "
            "(0.387 x 0.284 m) is a different measurement and "
            "neither replaces the other.",
            "The URDF tree is not vendored into this repo — the "
            "manifest pins the upstream repo, commit and URDF "
            "path, and the license above was read from that "
            "repo's LICENSE file, not assumed.",
        ],
    }


def _openmanipulator_x(cfg, src):
    license_file = src["repo_path"] / "LICENSE"
    if license_file.exists():
        lid, ev = _read_license(
            license_file, "LICENSE file at the upstream repo root")
    else:
        lid, ev = _no_license()
    return {
        "source": {
            "repo": src["repo_url"],
            "commit": src["commit"],
            "urdf": src["desc_rel"],
            "package": "open_manipulator_x_description",
            "license": lid,
            "license_evidence": ev,
            "retrieved": IMPORTED_DATE,
        },
        "facts": extract_arm_facts(src["desc_path"]),
        "annotation_note": (
            "This entry arrived by import, not by hand: the "
            "description was downloaded by robot_descriptions "
            "from ROBOTIS's own open_manipulator repository and "
            "the facts above were parsed out of its URDF. "
            "Nothing here was gated — importing a description "
            "is not a verdict."),
        "honesty": [
            "Gate status stays NOT_GATED: the motion gate grades "
            "wheeled ground robots, and no arm gate exists yet.",
            "The parts kit stays undefined (kit: null in "
            "catalog/parts-kits.json): the kit generator builds "
            "wheeled kits from a spec's wheel block, and this "
            "robot has no wheels.",
            "The URDF's seven link masses sum to 0.594 kg — the "
            "figure this entry already recorded. The e-Manual's "
            "0.70 kg excludes the base plate; the two figures "
            "describe different things and both stay.",
            "The URDF tree is not vendored into this repo — the "
            "manifest pins the upstream repo, commit and URDF "
            "path, and the license above was read from that "
            "repo's LICENSE file, not assumed.",
        ],
    }


def _crazyflie(cfg, src):
    license_file = src["repo_path"] / "LICENSE"
    if license_file.exists():
        lid, ev = _read_license(
            license_file, "LICENSE file at the upstream repo root")
    else:
        lid, ev = _no_license()
    return {
        "source": {
            "repo": src["repo_url"],
            "commit": src["commit"],
            "urdf": src["desc_rel"],
            "package": "cf2_description",
            "license": lid,
            "license_evidence": ev,
            "retrieved": IMPORTED_DATE,
        },
        "facts": extract_cf2_facts(src["desc_path"]),
        "annotation_note": (
            "This entry arrived by import, not by hand: the "
            "description was located by robot_descriptions "
            "(module cf2_description), which downloads UTIAS's "
            "gym-pybullet-drones repository; the facts above "
            "were parsed out of its cf2p.urdf, which describes "
            "the Crazyflie 2.0 (see the version note under "
            "honesty). Nothing here was gated — importing a "
            "description is not a verdict."),
        "honesty": [
            "VERSION: the upstream file describes the Crazyflie "
            "2.0, not this entry's Crazyflie 2.1 — the two are "
            "not silently equated. The file's total mass is "
            "27 g (the 2.0's figure); the 2.1 datasheet takeoff "
            "weight is 29 g. The entry keeps the 2.1 datasheet "
            "figures; the specimen records the 2.0 file's "
            "numbers, with the difference stated here.",
            "Gate status stays NOT_GATED: the motion gate "
            "grades wheeled ground robots, and no flight gate "
            "exists yet.",
            "The parts kit stays undefined (kit: null in "
            "catalog/parts-kits.json): the kit generator builds "
            "wheeled kits from a spec's wheel block, and this "
            "robot has no wheels.",
            "The file is a rigid model: all five joints are "
            "fixed and the propeller links carry zero mass — "
            "it supports geometry and mass bookkeeping, not "
            "rotor dynamics.",
            "The license recorded here is the license of the "
            "gym-pybullet-drones repository that carries the "
            "file, read from its LICENSE. Bitcraze publishes "
            "the Crazyflie design files themselves as "
            "open-source hardware — see the entry provenance; "
            "the two statements are about different artifacts.",
            "The URDF tree is not vendored into this repo — "
            "the manifest pins the upstream repo, commit and "
            "URDF path.",
        ],
    }


def _op3(cfg, src):
    # Menagerie carries a per-model LICENSE inside robotis_op3/
    # and repeats it in a per-directory section of the root
    # LICENSE; quote the model's own file, and name the section.
    package_license = (src["repo_path"] / "robotis_op3" / "LICENSE")
    root_license = src["repo_path"] / "LICENSE"
    if package_license.exists():
        lid, ev = _read_license(
            package_license,
            "LICENSE file in the robotis_op3 directory of the "
            "upstream repo")
        ev += ("; the repo root LICENSE carries the same text "
               "under the section \"License for contents in the "
               "directory 'robotis_op3/'\"")
    elif root_license.exists():
        lid, ev = _read_license(
            root_license,
            "LICENSE file at the upstream repo root (per-directory "
            "section for 'robotis_op3/')")
    else:
        lid, ev = _no_license()
    return {
        "source": {
            "repo": src["repo_url"],
            "commit": src["commit"],
            "mjcf": src["desc_rel"],
            "package": "robotis_op3",
            "license": lid,
            "license_evidence": ev,
            "retrieved": IMPORTED_DATE,
        },
        "facts": extract_op3_facts(src["desc_path"]),
        "annotation_note": (
            "This entry arrived by import, not by hand: the "
            "description was downloaded by robot_descriptions "
            "(module op3_mj_description) from DeepMind's MuJoCo "
            "Menagerie, a curated mirror of manufacturers' "
            "models; the facts above were parsed out of its "
            "robotis_op3 MJCF. Nothing here was gated — "
            "importing a description is not a verdict."),
        "honesty": [
            "The Menagerie README calls this a 'simplified' "
            "description of the OP3, and it is treated as one: "
            "its inertial total is 3.147 kg, below the "
            "e-Manual's ~3.5 kg (without the skin cover) for "
            "the physical robot. The entry keeps the e-Manual "
            "figure; the model's figure is recorded here, "
            "with the difference stated, not smoothed over.",
            "The model's 20 hinge joints and 20 position "
            "actuators agree with the OP3's 20 Dynamixel servos "
            "and the e-Manual's 20-DOF layout.",
            "Gate status stays NOT_GATED: the motion gate "
            "grades wheeled ground robots, and no walking "
            "gate exists yet.",
            "The parts kit stays undefined (kit: null in "
            "catalog/parts-kits.json): the kit generator builds "
            "wheeled kits from a spec's wheel block, and this "
            "robot has no wheels.",
            "ROBOTIS's own OP3 repositories carry the same "
            "Apache-2.0 license (checked against "
            "ROBOTIS-GIT/ROBOTIS-OP3's root LICENSE during "
            "this import); the license recorded above is the "
            "one read from the Menagerie files themselves.",
            "The MJCF tree is not vendored into this repo — "
            "the manifest pins the upstream repo, commit and "
            "MJCF path.",
        ],
    }


def _x500(cfg, src):
    license_file = src["repo_path"] / "LICENSE"
    if license_file.exists():
        lid, ev = _read_license(
            license_file, "LICENSE file at the upstream repo root")
    else:
        lid, ev = _no_license()
    return {
        "source": {
            "repo": src["repo_url"],
            "commit": src["commit"],
            "sdf": src["desc_rel"],
            "package": "x500_base",
            "license": lid,
            "license_evidence": ev,
            "retrieved": IMPORTED_DATE,
        },
        "facts": extract_x500_facts(src["desc_path"]),
        "annotation_note": (
            "This entry arrived by import, not by hand: no "
            "robot_descriptions module covers the X500, so the "
            "tool cloned PX4's own PX4-gazebo-models repository "
            "directly and the facts above were parsed out of "
            "its x500_base SDF — the same file this entry's "
            "specs were originally read from. Nothing here was "
            "gated — importing a description is not a verdict."),
        "honesty": [
            "The specimen covers x500_base, the base airframe "
            "model; PX4 composes its fuller variants (with "
            "cameras, lidar and gimbals) from this base, and "
            "those are not what was imported.",
            "The SDF's total (2.064 kg) is the model's own "
            "bookkeeping — a 2.0 kg base link plus four "
            "0.0160769 kg rotor links — not a weighed "
            "airframe; the entry already states it as the "
            "Gazebo model's sum, and it still does.",
            "Gate status stays NOT_GATED: the motion gate "
            "grades wheeled ground robots, and no flight gate "
            "exists yet.",
            "The parts kit stays undefined (kit: null in "
            "catalog/parts-kits.json): the kit generator builds "
            "wheeled kits from a spec's wheel block, and this "
            "robot has no wheels.",
            "The SDF tree is not vendored into this repo — "
            "the manifest pins the upstream repo, commit and "
            "SDF path, and the license above was read from "
            "that repo's LICENSE file, not assumed.",
        ],
    }


ROBOTS = {
    "unitree-go2": {
        "robot_name": "Unitree Go2",
        "short_label": "Go2",
        "dex_id": "#007",
        "manifest": "catalog/specimens/unitree-go2.json",
        "resolve": lambda: _module_source("go2_description",
                                          "URDF_PATH"),
        "build": _go2,
        "desc_key": "urdf",
    },
    "openmanipulator-x": {
        "robot_name": "OpenManipulator-X",
        "short_label": "OpenManipulator-X",
        "dex_id": "#011",
        "manifest": "catalog/specimens/openmanipulator-x.json",
        "resolve": lambda: _module_source(
            "open_manipulator_x_description", "URDF_PATH"),
        "build": _openmanipulator_x,
        "desc_key": "urdf",
    },
    "crazyflie-2-1": {
        "robot_name": "Crazyflie 2.1",
        "short_label": "Crazyflie",
        "dex_id": "#006",
        "manifest": "catalog/specimens/crazyflie-2-1.json",
        "resolve": lambda: _module_source("cf2_description",
                                          "URDF_PATH"),
        "build": _crazyflie,
        "desc_key": "urdf",
    },
    "robotis-op3": {
        "robot_name": "ROBOTIS OP3",
        "short_label": "OP3",
        "dex_id": "#010",
        "manifest": "catalog/specimens/robotis-op3.json",
        "resolve": lambda: _module_source("op3_mj_description",
                                          "MJCF_PATH"),
        "build": _op3,
        "desc_key": "mjcf",
    },
    "px4-x500": {
        "robot_name": "PX4 X500",
        "short_label": "X500",
        "dex_id": "#005",
        "manifest": "catalog/specimens/px4-x500.json",
        "resolve": lambda: _direct_source(
            "https://github.com/PX4/PX4-gazebo-models",
            "models/x500_base/model.sdf"),
        "build": _x500,
        "desc_key": "sdf",
    },
}


def import_one(slug: str) -> int:
    cfg = ROBOTS[slug]
    try:
        src = cfg["resolve"]()
    except ImportError:
        print("robot_descriptions is not installed — this import "
              "tool needs it:\n    pip install robot_descriptions",
              file=sys.stderr)
        return 2
    built = cfg["build"](cfg, src)
    source = built["source"]
    manifest = {
        "specimen": {
            "robot": cfg["robot_name"],
            "dex_id": cfg["dex_id"],
            "imported_via": src["imported_via"],
            "source": source,
            "facts": built["facts"],
            "annotation_note": built["annotation_note"],
            "honesty": built["honesty"],
        }
    }
    manifest_path = REPO / cfg["manifest"]
    manifest_path.write_text(json.dumps(manifest, indent=2,
                                        ensure_ascii=False) + "\n",
                             encoding="utf-8")
    print(f"wrote {cfg['manifest']} "
          f"({source['repo']} @ {source['commit'][:8]}, "
          f"{source['license']})")

    # Verify the Robodex entry carries this specimen, unchanged gate.
    robots = json.loads(ROBOTS_JSON.read_text(encoding="utf-8"))["robots"]
    entry = next(r for r in robots if r["name"] == cfg["robot_name"])
    block = entry.get("specimen")
    label = cfg["short_label"]
    if block is None:
        print(f"robots.json: {label} entry has no specimen block "
              "yet — add one matching the manifest.",
              file=sys.stderr)
        return 1
    problems = []
    if block.get("license") != source["license"]:
        problems.append(f"license: entry {block.get('license')!r} "
                        f"!= manifest {source['license']!r}")
    if block.get("source_commit") != source["commit"]:
        problems.append("source_commit drift")
    if block.get("facts") != built["facts"]:
        problems.append("facts drift between entry and manifest")
    if entry["gate_status"]["status"] != "NOT_GATED":
        problems.append("gate status is no longer NOT_GATED")
    if problems:
        print(f"robots.json specimen block out of sync: "
              + "; ".join(problems), file=sys.stderr)
        return 1
    print(f"robots.json: {label} specimen block matches the "
          "manifest; gate status NOT_GATED.")
    return 0


def main(argv: list) -> int:
    slugs = argv[1:]
    if not slugs:
        slugs = ["unitree-go2"]
    if slugs == ["--all"]:
        slugs = list(ROBOTS)
    unknown = [s for s in slugs if s not in ROBOTS]
    if unknown:
        print(f"unknown robot slug(s): {', '.join(unknown)} "
              f"(known: {', '.join(ROBOTS)})", file=sys.stderr)
        return 2
    rc = 0
    for slug in slugs:
        rc = import_one(slug) or rc
    return rc


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
