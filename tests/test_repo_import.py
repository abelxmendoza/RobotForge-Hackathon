"""Repo import (web-next/src/lib/repoImport.ts + the /import page).

The import is a browser flow over the public GitHub API, so what
ships — and what is tested — is its deterministic core, exercised
through the node harness in the shape of tests/test_gazebo.py:

  - tree scanning picks the README / license / BOM / model / images
    the import promises to read, and only those;
  - BOM parsing covers CSV files and markdown part tables (incl. the
    recorded fixture's real README part list);
  - the URDF reader extracts links, joints, limits and masses —
    including from the in-repo pathfinder URDF;
  - license detection + the image gate: permissive displays, NC and
    unknown list as links only, attestation overrides and is
    recorded;
  - catalogue matching uses the gather dedupe semantics — a BNO085
    must NOT match the catalogue's BNO055, a Raspberry Pi 4 must NOT
    match its Raspberry Pi 5;
  - the recorded fixture (TheNoobInventor/lidarbot @ 7b4693a) builds
    a provenance-complete specimen through the same builder the live
    flow uses;
  - the Muse pass's quote validation keeps only items whose quote
    is verbatim in the source text;
  - simulation handoff: a URDF specimen produces a physics entry the
    robot pages' engine accepts and a Gazebo bundle via
    lib/gazebo.ts; an SDF specimen produces the generic bundle whose
    world parses and whose launch.py compiles; xacro gets the honest
    not-checked reason.

Run from the repo root:  python -m pytest tests/test_repo_import.py -q
"""
import json
import py_compile
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web-next"
LIB = WEB / "src/lib"


# --------------------------------------------------------------------- #
# static wiring
# --------------------------------------------------------------------- #

def test_import_page_and_links_exist():
    page = (WEB / "src/app/import/page.tsx").read_text()
    assert "Import a repo" in page
    assert "RepoImport" in page
    garage = (WEB / "src/components/garage/Garage.tsx").read_text()
    assert "From repo" in garage
    assert 'href="/import/"' in garage
    assert "/import/?robot=" in garage
    robots = (WEB / "src/components/robots/RobotsIndex.tsx").read_text()
    assert 'href="/import/"' in robots


def test_garage_model_knows_repo_source():
    garage = (LIB / "garage.ts").read_text()
    assert "'repo'" in garage
    assert "From a GitHub repo" in garage
    assert "repoImport" in garage


def test_component_carries_the_honest_copy():
    comp = (WEB / "src/components/import/RepoImport.tsx").read_text()
    # Public-only v1, zip as the documented follow-up.
    assert "Public repos" in comp or "public GitHub" in comp
    assert ".zip" in comp
    # Images are never passed off as the user's own build photos.
    assert "not photos of your build" in comp
    # The gather queue's site-side endpoint is labeled a follow-up.
    assert "follow-up" in comp
    # The Muse pass is gated through the app's live plumbing.
    assert "liveHealth" in comp and "routeOn" in comp and '"/chat"' in comp


def test_demo_fixture_is_recorded_and_pinned():
    fixture = (LIB / "repoImportFixture.ts").read_text()
    assert "RECORDED FIXTURE" in fixture
    assert "7b4693a455d37925e20c3c64635f47bf8b624b88" in fixture
    assert "recorded: true" in fixture
    comp = (WEB / "src/components/import/RepoImport.tsx").read_text()
    assert "repoImportFixture" in comp
    assert "isDemoMode" in comp


# --------------------------------------------------------------------- #
# node harness
# --------------------------------------------------------------------- #

RUN_MJS = r"""
import fs from "node:fs";
import {
  pickFiles, detectLicense, imageGate, parseBomCsv, parseBomMarkdown,
  parseUrdf, matchCatalogPart, validateHardwareItems, buildSpecimen,
  withCatalogMatches, physicsEntryFor, parseRepoInput, readmeImages,
  buildImportedSdfBundle, gatherRequestFor,
} from "./repoImport.ts";
import { repoImportFixture } from "./repoImportFixture.ts";
import { buildGazeboLaunch } from "./gazebo.ts";

const [scenario, jobPath, repoRoot] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
const out = {};
try {
  if (scenario === "pick") {
    out.picked = pickFiles(job.tree);
    out.inputs = {};
    for (const s of job.inputs) out.inputs[s] = parseRepoInput(s);
  } else if (scenario === "license") {
    out.cases = job.texts.map((t) => detectLicense(t.text, t.spdx || null));
    out.gates = job.gates.map((g) => imageGate(g.license, g.attested));
  } else if (scenario === "bom") {
    out.csv = parseBomCsv(job.csv, "bom.csv");
    out.md = parseBomMarkdown(job.md, "README.md (part list)");
  } else if (scenario === "urdf") {
    out.synthetic = parseUrdf(job.synthetic);
    const pf = fs.readFileSync(
      repoRoot + "/web-next/public/urdf/pathfinder.urdf", "utf8");
    out.pathfinder = parseUrdf(pf);
  } else if (scenario === "match") {
    out.matches = {};
    for (const name of job.names) {
      out.matches[name] = matchCatalogPart(name, job.catalog);
    }
  } else if (scenario === "quotes") {
    out.kept = validateHardwareItems(job.raw, job.source);
  } else if (scenario === "fixture") {
    const specimen = withCatalogMatches(buildSpecimen(repoImportFixture), job.catalog);
    out.specimen = specimen;
    out.entry = physicsEntryFor(specimen, specimen.packages);
    out.gather = specimen.parts
      .filter((p) => !p.catalogId)
      .slice(0, 2)
      .map((p) => gatherRequestFor(p, specimen, "2026-11-01T00:00:00.000Z"));
    out.readmeImgs = readmeImages(
      repoImportFixture.texts.readme,
      repoImportFixture.ref, repoImportFixture.headSha, "README.md").length;
  } else if (scenario === "readme_parts") {
    const parts = parseBomMarkdown(job.md, "README.md (part list)");
    const spec = withCatalogMatches({ parts: parts.map((p) => ({ ...p, catalogId: null })) }, job.catalog);
    out.parts = spec.parts;
    out.picked = pickFiles(job.tree);
  } else if (scenario === "gazebo") {
    const pfUrl = "urdf/pathfinder.urdf";
    const pf = fs.readFileSync(
      repoRoot + "/web-next/public/urdf/pathfinder.urdf", "utf8");
    const fetchText = async (url) => {
      if (url === pfUrl) return pf;
      throw new Error("no fixture for " + url);
    };
    const bundle = await buildGazeboLaunch({
      slug: "someone-pathfinder",
      robotName: "Pathfinder",
      physics: { status: "urdf", urdf_url: pfUrl, source_label: "fixture" },
    }, fetchText);
    out.urdfBundle = {
      root: bundle.bundleRoot, format: bundle.format,
      files: bundle.files.map((f) => f.path),
      gz: bundle.gzCommand,
    };
    const sdfSpecimen = {
      kind: "repo-import", name: "SDF Bot",
      provenance: {
        repoUrl: "https://github.com/someone/sdfbot", owner: "someone",
        repo: "sdfbot", commitSha: "abc1234" + "0".repeat(33),
        license: { spdx: "MIT", family: "permissive", label: "MIT" },
        importedAt: "2026-11-01T00:00:00.000Z",
        sourceFiles: { model: "models/sdfbot/model.sdf" },
      },
      description: "", model: { path: "models/sdfbot/model.sdf", format: "sdf" },
      packages: {}, hardware: { claudePass: false, items: [] },
      parts: [], images: [], imagesAttested: false,
    };
    const sdf = buildImportedSdfBundle(sdfSpecimen, job.sdf);
    out.sdfBundle = {
      root: sdf.bundleRoot, gz: sdf.gzCommand,
      files: sdf.files.map((f) => ({ path: f.path, content: f.content })),
    };
  }
} catch (e) {
  out.fatal = String(e && e.stack || e);
}
process.stdout.write(JSON.stringify(out));
"""


def run_node(tmp_path: Path, scenario: str, job: dict) -> dict:
    lib = tmp_path / "lib"
    lib.mkdir(exist_ok=True)
    src = (LIB / "repoImport.ts").read_text()
    src = src.replace(
        'import type { PhysicsEntry } from "./types";',
        "type PhysicsEntry = any;")
    src = src.replace('from "./gazebo"', 'from "./gazebo.ts"')
    (lib / "repoImport.ts").write_text(src)
    fixture = (LIB / "repoImportFixture.ts").read_text()
    fixture = fixture.replace('from "./repoImport"', 'from "./repoImport.ts"')
    fixture = fixture.replace(
        'import type { Snapshot } from "./repoImport.ts";',
        "type Snapshot = any;")
    (lib / "repoImportFixture.ts").write_text(fixture)
    gazebo = (LIB / "gazebo.ts").read_text()
    gazebo = gazebo.replace('from "./zip"', 'from "./zip.ts"')
    gazebo = gazebo.replace(
        'import type { PhysicsEntry } from "./types";',
        "type PhysicsEntry = any;")
    (lib / "gazebo.ts").write_text(gazebo)
    (lib / "zip.ts").write_text((LIB / "zip.ts").read_text())
    (lib / "package.json").write_text('{"type": "module"}')
    (lib / "run.mjs").write_text(RUN_MJS)
    job_path = lib / "job.json"
    job_path.write_text(json.dumps(job))
    modules = WEB / "node_modules"
    if modules.exists() and not (lib / "node_modules").exists():
        (lib / "node_modules").symlink_to(modules, target_is_directory=True)
    proc = subprocess.run(
        ["node", "--experimental-strip-types", "run.mjs",
         scenario, str(job_path), str(ROOT)],
        cwd=lib, capture_output=True, text=True, timeout=240)
    assert proc.returncode == 0, proc.stderr[-3000:]
    result = json.loads(proc.stdout)
    assert "fatal" not in result, result.get("fatal")
    return result


def catalog() -> list:
    doc = json.loads((ROOT / "catalog/parts.json").read_text())
    return [{"id": p["id"], "name": p["name"]} for p in doc["parts"]]


# --------------------------------------------------------------------- #
# tree scanning + input parsing
# --------------------------------------------------------------------- #

def test_tree_scan_picks(tmp_path):
    tree = [
        "README.md", "LICENSE", "docs/guide.md",
        "hardware/bom.csv", "hardware/bom.md", "parts.txt",
        "robot_description/urdf/robot.urdf",
        "robot_description/urdf/old.urdf.xacro",
        "models/worlds/arena.sdf", "models/bot/model.sdf",
        "docs/images/bot.png", "docs/images/wiring.jpg",
        "assets/logo.svg", "src/main.py",
        "robot_description/package.xml", "bringup/package.xml",
        "meshes/base.stl",
    ]
    out = run_node(tmp_path, "pick", {
        "tree": tree,
        "inputs": [
            "https://github.com/ROBOTIS-GIT/turtlebot3",
            "TheNoobInventor/lidarbot",
            "https://github.com/ekumenlabs/andino/tree/humble/andino_description",
            "not a repo",
            "https://gitlab.com/a/b",
        ],
    })
    picked = out["picked"]
    assert picked["readme"] == "README.md"

    assert picked["license"] == "LICENSE"
    assert picked["bom"] == "hardware/bom.csv"  # CSV preferred over MD
    assert picked["primaryModel"] == {
        "path": "robot_description/urdf/robot.urdf", "format": "urdf"}
    assert picked["images"] == ["docs/images/bot.png", "docs/images/wiring.jpg"]
    assert len(picked["packageXml"]) == 2
    assert out["inputs"]["https://github.com/ROBOTIS-GIT/turtlebot3"] == {
        "owner": "ROBOTIS-GIT", "repo": "turtlebot3"}
    assert out["inputs"]["TheNoobInventor/lidarbot"] == {
        "owner": "TheNoobInventor", "repo": "lidarbot"}
    assert out["inputs"]["not a repo"] is None
    assert out["inputs"]["https://gitlab.com/a/b"] is None


def test_tree_scan_prefers_the_robot_over_shared_includes(tmp_path):
    # Regression, found in a live smoke import of ROBOTIS-GIT/turtlebot3:
    # an alphabetical pick lands on common_properties.urdf, an include
    # file with zero links. The repo's own robot file must win.
    out = run_node(tmp_path, "pick", {
        "tree": [
            "turtlebot3_description/urdf/common_properties.urdf",
            "turtlebot3_description/urdf/turtlebot3_burger.urdf",
            "turtlebot3_description/urdf/turtlebot3_waffle.urdf",
        ],
        "inputs": [],
    })
    assert out["picked"]["primaryModel"]["path"].endswith("turtlebot3_burger.urdf")


def test_tree_scan_model_fallbacks(tmp_path):
    out = run_node(tmp_path, "pick", {
        "tree": ["src/x/urdf/bot.urdf.xacro", "README.md"],
        "inputs": [],
    })
    assert out["picked"]["primaryModel"]["format"] == "xacro"
    out = run_node(tmp_path, "pick", {
        "tree": ["models/bot/model.sdf", "worlds/field.sdf"],
        "inputs": [],
    })
    assert out["picked"]["primaryModel"] == {
        "path": "models/bot/model.sdf", "format": "sdf"}


# --------------------------------------------------------------------- #
# license + image gate
# --------------------------------------------------------------------- #

MIT_TEXT = "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy"
APACHE_TEXT = "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/"
NC_TEXT = "Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)"


def test_license_detection_and_gate(tmp_path):
    out = run_node(tmp_path, "license", {
        "texts": [
            {"text": MIT_TEXT}, {"text": APACHE_TEXT},
            {"text": NC_TEXT}, {"text": "All rights reserved, do not copy."},
            {"text": None, "spdx": "BSD-3-Clause"}, {"text": None},
        ],
        "gates": [
            {"license": {"spdx": "MIT", "family": "permissive", "label": "MIT"},
             "attested": False},
            {"license": {"spdx": "CC-BY-NC-SA-4.0", "family": "nc",
                          "label": "CC-BY-NC-SA-4.0"}, "attested": False},
            {"license": {"spdx": "CC-BY-NC-SA-4.0", "family": "nc",
                          "label": "CC-BY-NC-SA-4.0"}, "attested": True},
            {"license": {"spdx": None, "family": "unknown",
                          "label": "no license found"}, "attested": False},
        ],
    })
    cases = out["cases"]
    assert cases[0]["spdx"] == "MIT" and cases[0]["family"] == "permissive"
    assert cases[1]["spdx"] == "Apache-2.0"
    assert cases[2]["family"] == "nc"
    assert cases[3]["family"] == "unknown"
    assert cases[4]["spdx"] == "BSD-3-Clause" and cases[4]["family"] == "permissive"
    assert cases[5]["spdx"] is None and cases[5]["family"] == "unknown"
    gates = out["gates"]
    assert gates[0]["display"] is True
    assert gates[1]["display"] is False and "non-commercial" in gates[1]["reason"]
    assert gates[2]["display"] is True and "attestation" in gates[2]["reason"]
    assert gates[3]["display"] is False


# --------------------------------------------------------------------- #
# BOM parsing
# --------------------------------------------------------------------- #

def test_bom_parsing(tmp_path):
    csv = "Part,Qty,Notes\nRPLIDAR A1,1,2D lidar\n\"Motor, DC\",2,geared\n,,\n"
    md = (
        "## Hardware\n\n|     | Part | Qty |\n| --- | --- | --- |\n"
        "| 1   | Raspberry Pi 4 (4 GB)  | 1 |\n"
        "| 2   | [RPLIDAR A1](https://example.com) | 1 |\n"
        "| 3   | 2 x Motors with encoders | |\n\nSome prose.\n"
    )
    out = run_node(tmp_path, "bom", {"csv": csv, "md": md})
    assert [p["name"] for p in out["csv"]] == ["RPLIDAR A1", "Motor, DC"]
    assert out["csv"][0]["qty"] == 1 and out["csv"][0]["notes"] == "2D lidar"
    names = [p["name"] for p in out["md"]]
    assert names == ["Raspberry Pi 4 (4 GB)", "RPLIDAR A1", "2 x Motors with encoders"]
    assert all(p["sourceFile"].startswith("README.md") for p in out["md"])


# --------------------------------------------------------------------- #
# URDF reading
# --------------------------------------------------------------------- #

SYNTHETIC_URDF = """<?xml version="1.0"?>
<robot name="testbot">
  <link name="base_link">
    <inertial><mass value="2.5"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>
  </link>
  <link name="wheel">
    <inertial><mass value="0.25"/></inertial>
  </link>
  <link name="sensor"/>
  <joint name="wheel_joint" type="continuous">
    <parent link="base_link"/><child link="wheel"/>
  </joint>
  <joint name="arm" type="revolute">
    <parent link="base_link"/><child link="sensor"/>
    <limit lower="-1.5" upper="1.5" effort="10" velocity="1"/>
  </joint>
</robot>
"""


def test_urdf_reading(tmp_path):
    out = run_node(tmp_path, "urdf", {"synthetic": SYNTHETIC_URDF})
    syn = out["synthetic"]
    assert syn["name"] == "testbot"
    assert [l["name"] for l in syn["links"]] == ["base_link", "wheel", "sensor"]
    assert syn["links"][0]["massKg"] == 2.5
    assert syn["links"][2]["massKg"] is None
    assert abs(syn["totalMassKg"] - 2.75) < 1e-9
    arm = [j for j in syn["joints"] if j["name"] == "arm"][0]
    assert arm["lower"] == -1.5 and arm["upper"] == 1.5
    assert arm["parent"] == "base_link" and arm["child"] == "sensor"
    pf = out["pathfinder"]
    assert pf["name"] == "pathfinder"
    assert len(pf["links"]) >= 5 and len(pf["joints"]) >= 4
    assert pf["totalMassKg"] and pf["totalMassKg"] > 3


# --------------------------------------------------------------------- #
# catalogue matching — the near-misses must miss
# --------------------------------------------------------------------- #

def test_catalog_matching_near_misses(tmp_path):
    names = [
        "RPLIDAR A1", "RPLIDAR A1 2D lidar", "BNO085", "BNO055",
        "Raspberry Pi 4", "Raspberry Pi 4 (4 GB)", "Raspberry Pi 5",
        "MPU6050 board", "Waveshare Motor Driver HAT",
    ]
    out = run_node(tmp_path, "match", {"names": names, "catalog": catalog()})
    m = out["matches"]
    assert m["RPLIDAR A1"] == "rplidar_a1"
    assert m["RPLIDAR A1 2D lidar"] == "rplidar_a1"
    assert m["BNO085"] is None          # NOT the catalogue's BNO055
    assert m["BNO055"] == "imu_bno055"
    assert m["Raspberry Pi 4"] is None  # NOT the catalogue's Pi 5
    assert m["Raspberry Pi 4 (4 GB)"] is None
    assert m["Raspberry Pi 5"] == "raspberry_pi_5"
    assert m["MPU6050 board"] is None
    assert m["Waveshare Motor Driver HAT"] is None


# --------------------------------------------------------------------- #
# Muse pass quote validation
# --------------------------------------------------------------------- #

def test_quote_validation(tmp_path):
    source = (
        "The robot runs on a Raspberry Pi 4 with an RPLIDAR A1 for SLAM.\n"
        "Two motors with encoders drive the wheels."
    )
    raw = [
        {"name": "Raspberry Pi 4", "category": "computer",
         "quote": "runs on a Raspberry Pi 4"},
        {"name": "Motors with encoders", "category": "motor",
         "quote": "Two motors with encoders drive the wheels."},
        {"name": "Jetson Orin", "category": "computer",
         "quote": "powered by a Jetson Orin"},  # fabricated — not in the text
        {"name": "No quote item", "category": "sensor", "quote": ""},
        {"name": "Bad category", "category": "warp-drive",
         "quote": "RPLIDAR A1 for SLAM"},
    ]
    out = run_node(tmp_path, "quotes", {"raw": raw, "source": source})
    kept = out["kept"]
    assert [k["name"] for k in kept] == [
        "Raspberry Pi 4", "Motors with encoders", "Bad category"]
    assert kept[2]["category"] == "other"  # unknown category coerced, quote real


# --------------------------------------------------------------------- #
# the recorded fixture builds a provenance-complete specimen
# --------------------------------------------------------------------- #

def test_fixture_specimen(tmp_path):
    out = run_node(tmp_path, "fixture", {"catalog": catalog()})
    s = out["specimen"]
    prov = s["provenance"]
    assert s["name"] == "Lidarbot"
    assert prov["repoUrl"] == "https://github.com/TheNoobInventor/lidarbot"
    assert prov["commitSha"] == "7b4693a455d37925e20c3c64635f47bf8b624b88"
    assert prov["license"]["spdx"] == "BSD-3-Clause"
    assert prov["license"]["family"] == "permissive"
    assert prov["recorded"] is True
    assert prov["sourceFiles"]["model"] == "lidarbot_description/urdf/lidarbot.urdf.xacro"
    assert prov["sourceFiles"]["readme"] == "README.md"
    # the README part list became parts; exactly one confident match
    names = {p["name"]: p["catalogId"] for p in s["parts"]}
    assert len(names) >= 15
    assert names["RPLIDAR A1"] == "rplidar_a1"
    assert names["Raspberry Pi 4 (4 GB)"] is None
    assert names["MPU6050 board"] is None
    # images: pinned at the import commit, from the repo's docs/images
    assert len(s["images"]) >= 8
    assert all("/7b4693a455d37925e20c3c64635f47bf8b624b88/" in i["url"]
               for i in s["images"])
    assert any("hardwarecomp" in i["url"] for i in s["images"])
    # xacro model → the honest not-checked physics state
    assert s["model"]["format"] == "xacro"
    assert out["entry"]["status"] == "none"
    assert "xacro" in out["entry"]["reason"]
    # unmatched parts produce gather-queue lines in the documented shape
    g = out["gather"][0]
    assert g["status"] == "needs_sources" and g["requested_by"] == "repo-import"
    assert g["repo"] == prov["repoUrl"] and "github.com" in g["source_file"]
    # README image references were also read (badges excluded)
    assert out["readmeImgs"] >= 5


# --------------------------------------------------------------------- #
# simulation handoff — Gazebo bundles
# --------------------------------------------------------------------- #

SDF_TEXT = """<?xml version="1.0"?>
<sdf version="1.9">
  <model name="sdfbot">
    <link name="base"/>
  </model>
</sdf>
"""


def test_gazebo_bundles(tmp_path):
    out = run_node(tmp_path, "gazebo", {"sdf": SDF_TEXT})
    urdf = out["urdfBundle"]
    assert urdf["format"] == "urdf"
    assert any(f.endswith("launch/launch.py") for f in urdf["files"])
    assert any("world_with_robot" in f for f in urdf["files"])
    assert "gz sim" in urdf["gz"]

    sdf = out["sdfBundle"]
    paths = [f["path"] for f in sdf["files"]]
    assert any(p.endswith("model.sdf") for p in paths)
    assert any(p.endswith("launch/launch.py") for p in paths)
    assert any(p.endswith("bundle.json") for p in paths)
    by_rel = {p.split("/", 1)[1]: c for p, c in
              [(f["path"], f["content"]) for f in sdf["files"]]}
    world = by_rel["worlds/world_with_robot.sdf"]
    ET.fromstring(world)  # the generated world parses as XML
    launch = tmp_path / "launch.py"
    launch.write_text(by_rel["launch/launch.py"])
    py_compile.compile(str(launch), doraise=True)
    assert "generated scaffolding" in by_rel["launch/launch.py"].lower()
    assert "gz sim" in sdf["gz"]


# --------------------------------------------------------------------- #
# Omega1 regressions (abelxmendoza/Omega-Code @ 1d7bb60)
# --------------------------------------------------------------------- #
# Running the import on the real Omega1 repo found three problems: the
# committed virtualenvs (~8,000 files) pushed the robot's own files past
# the 3,000-path cap, the README's REST-route tables were read as parts
# ("Start the simulation loop"), and bare role words matched the wrong
# catalogue parts ("Camera" -> RealSense D435, "Controller" -> a flight
# controller stack). These excerpts are verbatim from that README.

OMEGA1_README = """## Hardware

| Component | Details |
|---|---|
| Compute | Raspberry Pi 4B (4 GB) |
| Motor driver | PCA9685 PWM hat (I2C 0x40) |
| Ultrasonic | HC-SR04 (GPIO 27 trig / GPIO 22 echo) |
| Camera | CSI OV5647 (via libcamera + GStreamer) |
| Controller | Xbox One S/X wireless (via xpad or Bluetooth) |

### Simulation API

| Method | Path | Description |
|---|---|---|
| POST | `/sim/start` | Start the simulation loop |
| POST | `/sim/stop` | Stop the simulation loop |
"""


def test_omega1_readme_parts_and_matches(tmp_path):
    tree = (
        ["README.md", "LICENSE", "image/README/omega1.png"]
        + [f"venv/lib/python3.11/site-packages/pkg{i}/img/x.png" for i in range(5)]
        + ["servers/backend/controllers/lighting/omega1_venv/lib/a.py",
           "servers/backend/.direnv/python-3.11.2/lib/README.md",
           "ui/node_modules/left-pad/README.md"]
    )
    out = run_node(tmp_path, "readme_parts",
                   {"md": OMEGA1_README, "catalog": catalog(), "tree": tree})
    parts = out["parts"]
    # Only the hardware table: the route table is not a part list.
    assert [p["name"] for p in parts] == [
        "Compute", "Motor driver", "Ultrasonic", "Camera", "Controller"]
    by = {p["name"]: p["catalogId"] for p in parts}
    # The real part sits in the Details cell, and it still matches.
    assert by["Ultrasonic"] == "ultrasonic_hcsr04"
    # Role words alone never match: no RealSense for an OV5647.
    assert by["Camera"] is None
    assert by["Controller"] is None
    assert by["Motor driver"] is None
    assert by["Compute"] is None  # a Pi 4B is not the catalogue's Pi 5
    # Vendored trees are not the robot.
    picked = out["picked"]
    assert picked["images"] == ["image/README/omega1.png"]
    assert picked["readme"] == "README.md"


def test_generic_words_never_match(tmp_path):
    names = ["Camera", "Controller", "Motor driver", "Chassis", "Sensors",
             "Ultrasonic", "HC-SR04", "Ultrasonic HC-SR04"]
    out = run_node(tmp_path, "match", {"names": names, "catalog": catalog()})
    m = out["matches"]
    for generic in names[:6]:
        assert m[generic] is None, generic
    assert m["HC-SR04"] == "ultrasonic_hcsr04"
    assert m["Ultrasonic HC-SR04"] == "ultrasonic_hcsr04"


def test_bom_tables_with_link_or_status_columns_survive(tmp_path):
    # Codex review on #96: a "Part | Qty | URL" BOM must not be dropped
    # as a non-part table. Route tables are still skipped.
    md = (
        "| Part | Qty | URL |\n|---|---|---|\n"
        "| HC-SR04 | 1 | https://example.com/hcsr04 |\n\n"
        "| Component | Status | Port |\n|---|---|---|\n"
        "| RPLIDAR A1 | working | /dev/ttyUSB0 |\n\n"
        "| Part | Qty | Command |\n|---|---|---|\n"
        "| BNO055 | 1 | i2cdetect -y 1 |\n\n"
        "| Method | Path | Description |\n|---|---|---|\n"
        "| POST | /sim/start | Start the simulation loop |\n"
    )
    out = run_node(tmp_path, "readme_parts",
                   {"md": md, "catalog": catalog(), "tree": ["README.md"]})
    names = [p["name"] for p in out["parts"]]
    assert names == ["HC-SR04", "RPLIDAR A1", "BNO055"]


def test_notes_never_rename_a_named_part(tmp_path):
    # Codex review on #96: the Details fallback is for role names only.
    md = (
        "| Part | Qty | Notes |\n|---|---|---|\n"
        "| OV5647 | 1 | Raspberry Pi 5 (CSI connector) |\n"
        "| Ultrasonic | 1 | HC-SR04 |\n"
    )
    out = run_node(tmp_path, "readme_parts",
                   {"md": md, "catalog": catalog(), "tree": ["README.md"]})
    by = {p["name"]: p["catalogId"] for p in out["parts"]}
    assert by["OV5647"] is None  # NOT the Pi it plugs into
    assert by["Ultrasonic"] == "ultrasonic_hcsr04"
