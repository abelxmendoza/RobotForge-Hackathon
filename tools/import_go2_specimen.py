#!/usr/bin/env python3
"""Import the Unitree Go2 into the Robodex as a labeled specimen.

SPIKE (2026-10-29): can an external robot-description database grow
the Robodex without hand-typing specs? The source here is the
`robot_descriptions` Python package, which clones the upstream
description repos and exposes each robot as an importable module.
For the Go2 that module is `robot_descriptions.go2_description`,
backed by Unitree's own unitree_ros repository.

Everything recorded comes out of the actual downloaded files:

- the upstream repo URL and commit, from the clone itself (git);
- the license, from the LICENSE file at the upstream repo root —
  its first line and copyright line are quoted verbatim in the
  manifest; if the repo had no LICENSE file the manifest would say
  so instead of naming a license;
- the facts (link/joint counts, masses, zero-pose foot geometry),
  parsed from the URDF the package exposes — nothing is copied from
  Unitree's marketing parameter table.

Outputs:

- catalog/specimens/unitree-go2.json — the specimen manifest, in
  the shape of catalog/specimens/turtlebot3-burger.json (a source
  block plus honesty notes), with a `facts` block the Burger
  manifest does not need but an imported entry does.
- a verification pass over catalog/robots.json: the Go2 entry's
  `specimen` block must carry the same facts, license and source
  as this fresh extraction, and its gate status must still be
  NOT_GATED. The script never edits robots.json (a full re-dump
  would churn its formatting) — it fails loudly on drift instead.

The upstream URDF tree is NOT vendored into this repo: the manifest
pins repo + commit + URDF path, the same pattern the Burger
specimen uses for its meshes.

Requires the robot_descriptions package (not a runtime dependency
of RobotForge — an import-time tool only):

    pip install robot_descriptions
    python3 tools/import_go2_specimen.py
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
MANIFEST = REPO / "catalog" / "specimens" / "unitree-go2.json"
ROBOTS = REPO / "catalog" / "robots.json"
ROBOT_NAME = "Unitree Go2"
IMPORTED_DATE = "2026-10-29"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, check=True).stdout.strip()


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


def extract_facts(urdf_path: Path) -> dict:
    """Facts parsed from the URDF alone — nothing from any table."""
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


def main() -> int:
    try:
        from robot_descriptions import go2_description
    except ImportError:
        print("robot_descriptions is not installed — this import tool "
              "needs it:\n    pip install robot_descriptions",
              file=sys.stderr)
        return 2
    import robot_descriptions

    repo_path = Path(go2_description.REPOSITORY_PATH)
    urdf_path = Path(go2_description.URDF_PATH)
    urdf_rel = str(urdf_path.relative_to(repo_path))
    repo_url = _git(repo_path, "remote", "get-url", "origin")
    if repo_url.endswith(".git"):
        repo_url = repo_url[:-4]
    commit = _git(repo_path, "rev-parse", "HEAD")

    license_file = repo_path / "LICENSE"
    if license_file.exists():
        lines = [l.strip() for l in
                 license_file.read_text(encoding="utf-8").splitlines()
                 if l.strip()]
        license_id = ("BSD-3-Clause" if lines[0] == "BSD 3-Clause License"
                      else lines[0])
        license_evidence = (f"LICENSE file at the upstream repo root: "
                            f"{lines[0]!r}; {lines[1]}")
    else:
        license_id = "no LICENSE file in upstream repo"
        license_evidence = ("The upstream repo root has no LICENSE "
                            "file; no license is claimed for it.")

    facts = extract_facts(urdf_path)
    manifest = {
        "specimen": {
            "robot": ROBOT_NAME,
            "dex_id": "#007",
            "imported_via": (
                f"robot_descriptions {robot_descriptions.__version__} "
                "(Python package), module "
                "robot_descriptions.go2_description"),
            "source": {
                "repo": repo_url,
                "commit": commit,
                "urdf": urdf_rel,
                "package": "go2_description",
                "license": license_id,
                "license_evidence": license_evidence,
                "retrieved": IMPORTED_DATE,
            },
            "facts": facts,
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
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2,
                                   ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(f"wrote {MANIFEST.relative_to(REPO)} "
          f"({repo_url} @ {commit[:8]}, {license_id})")

    # Verify the Robodex entry carries this specimen, unchanged gate.
    robots = json.loads(ROBOTS.read_text(encoding="utf-8"))["robots"]
    entry = next(r for r in robots if r["name"] == ROBOT_NAME)
    block = entry.get("specimen")
    if block is None:
        print("robots.json: Go2 entry has no specimen block yet — "
              "add one matching the manifest.", file=sys.stderr)
        return 1
    problems = []
    if block.get("license") != license_id:
        problems.append(f"license: entry {block.get('license')!r} "
                        f"!= manifest {license_id!r}")
    if block.get("source_commit") != commit:
        problems.append("source_commit drift")
    if block.get("facts") != facts:
        problems.append("facts drift between entry and manifest")
    if entry["gate_status"]["status"] != "NOT_GATED":
        problems.append("gate status is no longer NOT_GATED")
    if problems:
        print("robots.json specimen block out of sync: "
              + "; ".join(problems), file=sys.stderr)
        return 1
    print("robots.json: Go2 specimen block matches the manifest; "
          "gate status NOT_GATED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
