#!/usr/bin/env python3
"""Record the stage-animation source data (catalog/stage-animation.json).

The Living Build Stage's animation capability map may only use
recorded data. Two recorded sources feed it:

1. Each robot's official URDF at the SAME pinned commit
   catalog/physics.json already records for the physics checks —
   parsed here for joint names, types, axes and limits, the same
   way the specimen imports recorded URDF-derived part data.
   Robots whose recorded model is not a plain URDF keep physics'
   own status/reason and record no joints.

2. Each robot's recorded spec (examples/<spec_file>, the file
   catalog/robots.json names): drivetrain, wheel, rotors, the
   sensor entries (kind / position / range_m) and the wiring
   block (nodes + connections, with recorded volts) verbatim.

Nothing is measured, estimated or invented: a field the sources do
not carry is absent from the output, and the capability map in
web-next/src/lib/stageAnimation.ts abstains wherever it is absent.

Run:  python3 tools/extract_stage_animation.py
(needs network for the pinned URDF URLs; the Pathfinder URDF is
generated in-repo and read from web-next/public/urdf/.)
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_joints(urdf_text: str) -> list[dict]:
    root = ET.fromstring(urdf_text)
    joints = []
    for j in root.iter("joint"):
        name = re.sub(r"^\$\{[^}]*\}", "", j.get("name") or "")
        axis_el = j.find("axis")
        axis = None
        if axis_el is not None and axis_el.get("xyz"):
            axis = [float(v) for v in axis_el.get("xyz").split()]
        limit = None
        lim_el = j.find("limit")
        if lim_el is not None:
            limit = {}
            for k in ("lower", "upper", "effort", "velocity"):
                if lim_el.get(k) is not None:
                    limit[k] = float(lim_el.get(k))
        child = j.find("child")
        joints.append({
            "name": name,
            "type": j.get("type"),
            "axis": axis,
            "limit": limit,
            "child_link": re.sub(r"^\$\{[^}]*\}", "", child.get("link")) if child is not None else None,
        })
    return joints


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "robotforge-stage-extractor"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def main() -> int:
    physics = json.loads((REPO / "catalog/physics.json").read_text())["robots"]
    robots = json.loads((REPO / "catalog/robots.json").read_text())["robots"]
    out: dict = {}
    for robot in robots:
        slug = slugify(robot["name"])
        entry: dict = {
            "name": robot["name"],
            "mobility_class": robot.get("mobility_class"),
            "class": robot.get("class"),
        }
        spec_path = REPO / robot["spec_file"]
        spec = json.loads(spec_path.read_text())
        entry["spec"] = {
            "file": robot["spec_file"],
            "drivetrain": spec.get("drivetrain"),
            "wheel": spec.get("wheel"),
            "rotors": spec.get("rotors"),
            "motor": spec.get("motor"),
            "sensors": spec.get("sensors") or [],
            "wiring": spec.get("wiring"),
        }
        phys = physics.get(slug)
        if phys is None:
            entry["physics_status"] = "unknown"
            entry["physics_reason"] = "No physics-check entry is recorded for this robot."
            entry["urdf"] = None
        elif phys.get("status") != "urdf":
            entry["physics_status"] = phys.get("status")
            entry["physics_reason"] = phys.get("reason")
            entry["urdf"] = None
        else:
            entry["physics_status"] = "urdf"
            if phys.get("generated"):
                text = (REPO / "web-next/public" / phys["urdf_url"]).read_text()
                url = phys["urdf_url"]
            else:
                text = fetch(phys["urdf_url"])
                url = phys["urdf_url"]
            entry["urdf"] = {
                "source_label": phys.get("source_label"),
                "urdf_url": url,
                "joints": parse_joints(text),
            }
        out[slug] = entry
        tracks = len(entry["urdf"]["joints"]) if entry.get("urdf") else 0
        print(f"{slug}: physics={entry['physics_status']} joints={tracks}")
    doc = {
        "note": (
            "Recorded source data for the Living Build Stage animation capability map. "
            "URDF joints were parsed by tools/extract_stage_animation.py from each robot's "
            "official URDF at the same pinned commit catalog/physics.json records; spec "
            "fields (drivetrain, wheel, rotors, sensors, wiring) are verbatim from the robot's "
            "recorded spec file. Nothing here is estimated: fields the sources do not "
            "carry are absent, and the animation layer abstains where they are absent."
        ),
        "robots": out,
    }
    target = REPO / "catalog/stage-animation.json"
    target.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
