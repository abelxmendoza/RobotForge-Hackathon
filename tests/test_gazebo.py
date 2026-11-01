"""Launch in Gazebo — the bundle builder (web-next/src/lib/gazebo.ts).

Same shape as the physics suite, because the honesty contract is the
same: the web app cannot run Gazebo, so what ships — and what is
tested — is the complete job it CAN do: assemble a ready-to-run
launch package from each robot's recorded model and hand over the
download plus the exact command.

Coverage:
  - static wiring: RobotDetail mounts GazeboSection beside
    PhysicsSection; the section carries the honest-shape copy and
    builds locally (no Worker/API imports);
  - availability: all 11 catalogue robots resolve to a bundle format
    (7 URDF, the X500's SDF, Andino's xacro) or an honest
    unavailable state with the reason (Mini Pupper: no model
    recorded; OP3: MJCF);
  - synthetic fixtures: package:// rewriting, relative meshes,
    unresolvable references reported, xacro detection;
  - network integration against the pinned sources: real bundles for
    Burger, G1, X500, Andino and Pathfinder — file lists, mesh
    download counts, URDF/SDF/world XML parses in Python,
    launch.py byte-compiles, the README carries both commands, and
    the zip assembled by lib/zip.ts opens in Python's zipfile;
  - a live Gazebo boot test that runs ONLY when gz exists on the
    machine (it does not on this VM — the boot is then honestly
    unverified, and the PR says so; installing Gazebo is out of
    scope).

Run from the repo root:  python -m pytest tests/test_gazebo.py -q
"""
import base64
import json
import py_compile
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web-next"

ALL_SLUGS = [
    "andino", "crazyflie-2-1", "mini-pupper", "openmanipulator-x",
    "pathfinder", "px4-x500", "robotis-op3", "turtlebot3-burger",
    "turtlebot3-waffle-pi", "unitree-g1", "unitree-go2",
]
URDF_SLUGS = [
    "crazyflie-2-1", "openmanipulator-x", "pathfinder",
    "turtlebot3-burger", "turtlebot3-waffle-pi", "unitree-g1", "unitree-go2",
]


# --------------------------------------------------------------------- #
# static wiring
# --------------------------------------------------------------------- #

def test_gazebo_section_wired_beside_physics():
    detail = (WEB / "src/components/robots/RobotDetail.tsx").read_text()
    section = (WEB / "src/components/robots/GazeboSection.tsx").read_text()
    lib = (WEB / "src/lib/gazebo.ts").read_text()
    assert 'import GazeboSection from "./GazeboSection";' in detail
    assert detail.index("<PhysicsSection") < detail.index("<GazeboSection")
    # The honest shape, in the UI's own words.
    assert "Launch in Gazebo" in section
    assert "Runs on your machine" in section
    assert "in the browser" in section
    # Built locally from the recorded model — no Worker/API calls,
    # so demo mode can offer it exactly like the physics checks.
    assert 'from "@/lib/gazebo"' in section
    assert 'from "@/lib/zip"' in section
    assert "@/lib/api" not in section
    assert "buildGazeboLaunch" in lib and "gazeboAvailability" in lib
    assert "Runs on your machine" in lib or "on THEIR" in lib


# --------------------------------------------------------------------- #
# node harness
# --------------------------------------------------------------------- #

RUN_MJS = r"""
import fs from "node:fs";
import { buildGazeboLaunch, gazeboAvailability } from "./gazebo.ts";
import { createZip } from "./zip.ts";

const [scenario, jobPath, repoRoot] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));

const pathfinder = fs.readFileSync(
  repoRoot + "/web-next/public/urdf/pathfinder.urdf", "utf8");
async function fetchText(url) {
  if (url === "urdf/pathfinder.urdf") return pathfinder;
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch " + res.status + " " + url);
  return res.text();
}
function fixtureFetch(map) {
  return async (url) => {
    if (!(url in map)) throw new Error("no fixture for " + url);
    return map[url];
  };
}
function slim(bundle) {
  return {
    slug: bundle.slug, format: bundle.format, bundleRoot: bundle.bundleRoot,
    primaryCommand: bundle.primaryCommand, gzCommand: bundle.gzCommand,
    meshDownloads: bundle.meshDownloads, unresolvedMeshes: bundle.unresolvedMeshes,
    sourceLabel: bundle.sourceLabel, notes: bundle.notes,
    files: bundle.files.map((f) => ({ path: f.path, content: f.content })),
  };
}
const out = {};
try {
  if (scenario === "availability") {
    out.availability = {};
    for (const slug of job.slugs) {
      out.availability[slug] = gazeboAvailability({
        slug, robotName: slug, physics: job.physics[slug],
      });
    }
  } else if (scenario === "build") {
    out.bundles = {};
    for (const spec of job.builds) {
      try {
        out.bundles[spec.slug] = slim(await buildGazeboLaunch(spec.input, fetchText));
      } catch (e) {
        out.bundles[spec.slug] = { error: String(e && e.message || e) };
      }
    }
  } else if (scenario === "fixtures") {
    out.fixtures = {};
    for (const fx of job.fixtures) {
      try {
        out.fixtures[fx.name] = slim(
          await buildGazeboLaunch(fx.input, fixtureFetch(fx.files)));
      } catch (e) {
        out.fixtures[fx.name] = { error: String(e && e.message || e) };
      }
    }
  } else if (scenario === "zip") {
    const bundle = await buildGazeboLaunch(job.input, fixtureFetch(job.files));
    out.zipBase64 = Buffer.from(createZip(bundle.files)).toString("base64");
    out.paths = bundle.files.map((f) => f.path);
  }
} catch (e) {
  out.fatal = String(e && e.stack || e);
}
process.stdout.write(JSON.stringify(out));
"""


def run_node(tmp_path: Path, scenario: str, job: dict) -> dict:
    lib = tmp_path / "lib"
    lib.mkdir()
    gazebo = (WEB / "src/lib/gazebo.ts").read_text()
    gazebo = gazebo.replace('from "./zip"', 'from "./zip.ts"')
    # Type-only import: replace with a local alias so node's type
    # stripping never has to resolve the app's types module.
    gazebo = gazebo.replace(
        'import type { PhysicsEntry } from "./types";',
        "type PhysicsEntry = any;")
    (lib / "gazebo.ts").write_text(gazebo)
    (lib / "zip.ts").write_text((WEB / "src/lib/zip.ts").read_text())
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


def physics_map() -> dict:
    physics = json.loads((ROOT / "catalog/physics.json").read_text())
    return physics["robots"]


def px4_input() -> dict:
    specimen = json.loads(
        (ROOT / "catalog/specimens/px4-x500.json").read_text())
    src = specimen["specimen"]["source"]
    return {"repo": src["repo"], "commit": src["commit"],
            "sdfPath": src["sdf"], "license": src.get("license")}


BUILD_SLUGS = ["turtlebot3-burger", "unitree-g1", "px4-x500", "andino",
               "pathfinder", "crazyflie-2-1"]


@pytest.fixture(scope="module")
def bundles(tmp_path_factory) -> dict:
    tmp = tmp_path_factory.mktemp("gazebo-builds")
    phys = physics_map()
    builds = []
    for slug in BUILD_SLUGS:
        inp = {"slug": slug, "robotName": slug, "physics": phys.get(slug)}
        if slug == "px4-x500":
            inp["px4"] = px4_input()
        if slug == "andino":
            inp["andinoRepoUrl"] = "https://github.com/Ekumen-OS/andino"
        builds.append({"slug": slug, "input": inp})
    result = run_node(tmp, "build", {"builds": builds})
    out = result["bundles"]
    for slug, bundle in out.items():
        if "error" in bundle:
            pytest.skip(f"network build for {slug} unavailable: {bundle['error']}")
    return out


def bundle_file(bundle: dict, rel: str) -> str:
    for f in bundle["files"]:
        if f["path"] == f"{bundle['bundleRoot']}/{rel}":
            return f["content"]
    raise AssertionError(f"{rel} not in bundle: "
                         f"{[f['path'] for f in bundle['files']]}")


def bundle_paths(bundle: dict) -> list:
    root = bundle["bundleRoot"] + "/"
    return sorted(f["path"][len(root):] for f in bundle["files"])


def assert_bundle_valid(bundle: dict):
    """Every XML file parses; the launch file byte-compiles; the
    README carries both commands; both worlds are real SDF."""
    for f in bundle["files"]:
        if f["path"].endswith((".urdf", ".sdf", ".xml")):
            ET.fromstring(f["content"])  # raises on malformed XML
    launch = bundle_file(bundle, "launch/launch.py")
    with tempfile.NamedTemporaryFile(
            "w", suffix=".py", delete=False) as fh:
        fh.write(launch)
        launch_path = fh.name
    try:
        py_compile.compile(launch_path, doraise=True)
    finally:
        Path(launch_path).unlink(missing_ok=True)
    readme = bundle_file(bundle, "README.md")
    assert bundle["primaryCommand"] in readme
    if bundle["gzCommand"]:
        assert bundle["gzCommand"] in readme
    assert "your machine" in readme  # the honest shape, in the bundle too
    world = ET.fromstring(bundle_file(bundle, "worlds/empty_world.sdf"))
    assert world.tag == "sdf"
    assert world.find("world/model[@name='ground_plane']") is not None
    ET.fromstring(bundle_file(bundle, "worlds/world_with_robot.sdf"))


# --------------------------------------------------------------------- #
# availability across the whole catalogue
# --------------------------------------------------------------------- #

def test_availability_all_eleven(tmp_path):
    result = run_node(tmp_path, "availability",
                      {"slugs": ALL_SLUGS, "physics": physics_map()})
    avail = result["availability"]
    assert set(avail) == set(ALL_SLUGS)
    for slug in URDF_SLUGS:
        assert avail[slug] == {"ok": True, "format": "urdf"}, slug
    assert avail["px4-x500"] == {"ok": True, "format": "sdf"}
    assert avail["andino"] == {"ok": True, "format": "xacro"}
    assert avail["mini-pupper"]["ok"] is False
    assert "No model is recorded" in avail["mini-pupper"]["reason"]
    assert avail["robotis-op3"]["ok"] is False
    assert "MJCF" in avail["robotis-op3"]["reason"]


# --------------------------------------------------------------------- #
# real bundles from the pinned sources
# --------------------------------------------------------------------- #

def test_burger_bundle(bundles):
    b = bundles["turtlebot3-burger"]
    assert b["format"] == "urdf"
    assert b["primaryCommand"] == (
        "cd robotforge-turtlebot3-burger-gazebo && ./fetch_meshes.sh "
        "&& ros2 launch launch/launch.py")
    assert "./expand_model.sh" in b["gzCommand"]  # live xacro macros
    assert bundle_paths(b) == sorted([
        "models/turtlebot3_description/urdf/turtlebot3_burger.urdf",
        "worlds/empty_world.sdf", "worlds/world_with_robot.sdf",
        "launch/launch.py", "package.xml", "fetch_meshes.sh",
        "expand_model.sh", "bundle.json", "README.md",
    ])
    # Mesh resolution from the file itself: base, lidar, two tires.
    assert len(b["meshDownloads"]) == 4
    assert all(d["dest"].startswith("models/turtlebot3_description/meshes/")
               for d in b["meshDownloads"])
    assert all("fc817ce" in d["url"] for d in b["meshDownloads"])
    # package:// mesh URIs rewritten to bundle-relative paths.
    urdf = bundle_file(
        b, "models/turtlebot3_description/urdf/turtlebot3_burger.urdf")
    assert "package://turtlebot3_description/meshes" not in urdf
    assert "../meshes/bases/burger_base.stl" in urdf
    assert b["unresolvedMeshes"] == []
    # The gz variant world includes the xacro expansion, not the raw file.
    world = ET.fromstring(bundle_file(b, "worlds/world_with_robot.sdf"))
    uri = world.find("world/include/uri")
    assert uri is not None and uri.text == "robot.urdf"
    assert_bundle_valid(b)


def test_g1_bundle_relative_meshes(bundles):
    b = bundles["unitree-g1"]
    assert b["format"] == "urdf"
    assert len(b["meshDownloads"]) == 36  # every unique meshes/*.STL ref in the file
    assert all(d["dest"].startswith("models/g1_description/meshes/")
               for d in b["meshDownloads"])
    assert all("267182b" in d["url"] for d in b["meshDownloads"])
    assert "models/g1_description/g1_29dof.urdf" in bundle_paths(b)
    assert_bundle_valid(b)


def test_crazyflie_bundle(bundles):
    b = bundles["crazyflie-2-1"]
    assert b["format"] == "urdf"
    assert len(b["meshDownloads"]) == 1
    assert b["meshDownloads"][0]["dest"].endswith("cf2.dae")
    assert_bundle_valid(b)


def test_pathfinder_bundle_no_fetch_step(bundles):
    b = bundles["pathfinder"]
    assert b["format"] == "urdf"
    assert b["meshDownloads"] == []  # primitive geometry only
    assert "fetch_meshes.sh" not in bundle_paths(b)
    assert b["primaryCommand"] == (
        "cd robotforge-pathfinder-gazebo && ros2 launch launch/launch.py")
    assert_bundle_valid(b)


def test_x500_bundle_native_sdf(bundles):
    b = bundles["px4-x500"]
    assert b["format"] == "sdf"
    assert bundle_paths(b) == sorted([
        "models/x500_base/model.sdf", "models/x500_base/model.config",
        "worlds/empty_world.sdf", "worlds/world_with_robot.sdf",
        "launch/launch.py", "package.xml", "fetch_meshes.sh",
        "bundle.json", "README.md",
    ])
    # The five model:// mesh URIs in the recorded SDF, mirrored.
    assert len(b["meshDownloads"]) == 5
    assert all(d["dest"].startswith("models/x500_base/meshes/")
               for d in b["meshDownloads"])
    assert all("e5997f4" in d["url"] for d in b["meshDownloads"])
    sdf = ET.fromstring(bundle_file(b, "models/x500_base/model.sdf"))
    assert sdf.tag == "sdf"
    config = ET.fromstring(bundle_file(b, "models/x500_base/model.config"))
    assert config.find("name").text == "x500_base"
    assert_bundle_valid(b)


def test_andino_bundle_fetches_and_expands(bundles):
    b = bundles["andino"]
    assert b["format"] == "xacro"
    assert bundle_paths(b) == sorted([
        "worlds/empty_world.sdf", "worlds/world_with_robot.sdf",
        "launch/launch.py", "package.xml", "fetch_model.sh",
        "expand_model.sh", "bundle.json", "README.md",
    ])
    launch = bundle_file(b, "launch/launch.py")
    assert "andino_description" in launch
    assert "use_real_ros_control" in launch
    fetch = bundle_file(b, "fetch_model.sh")
    assert "Ekumen-OS/andino" in fetch and "NOT pinned" in fetch
    assert b["primaryCommand"] == (
        "cd robotforge-andino-gazebo && ./fetch_model.sh "
        "&& ros2 launch launch/launch.py")
    readme = bundle_file(b, "README.md")
    assert "NOT pinned" in readme  # the unpinned fetch is disclosed
    assert_bundle_valid(b)


# --------------------------------------------------------------------- #
# synthetic fixtures (no network)
# --------------------------------------------------------------------- #

FIXTURE_URDF = """<?xml version="1.0"?>
<robot name="pkgbot" xmlns:xacro="http://www.ros.org/wiki/xacro">
  <xacro:arg name="ns" default=""/>
  <link name="base">
    <visual><geometry><mesh filename="package://pkg_a/meshes/base.stl"/></geometry></visual>
    <visual><geometry><mesh filename="meshes/wheel.stl"/></geometry></visual>
    <visual><geometry><mesh filename="package://unknown_pkg/meshes/x.stl"/></geometry></visual>
  </link>
  <joint name="wheel_spin" type="continuous">
    <parent link="base"/><child link="base"/>
  </joint>
</robot>
"""


def test_fixture_bundle_mechanics(tmp_path):
    entry = {
        "robot": "pkgbot", "status": "urdf",
        "urdf_url": "https://example.test/pkg_a/urdf/pkgbot.urdf",
        "packages": {"pkg_a": "https://example.test/pkg_a/"},
        "source_label": "fixture source", "license": "MIT",
    }
    result = run_node(tmp_path, "fixtures", {"fixtures": [{
        "name": "pkgbot",
        "input": {"slug": "pkgbot", "robotName": "PkgBot", "physics": entry},
        "files": {"https://example.test/pkg_a/urdf/pkgbot.urdf": FIXTURE_URDF},
    }]})
    b = result["fixtures"]["pkgbot"]
    assert "error" not in b
    # package:// and relative meshes both resolve; the unknown
    # package is reported, never silently dropped.
    dests = sorted(d["dest"] for d in b["meshDownloads"])
    assert dests == ["models/pkg_a/meshes/base.stl",
                     "models/pkg_a/meshes/wheel.stl"]
    assert b["unresolvedMeshes"] == ["package://unknown_pkg/meshes/x.stl"]
    urdf = bundle_file(b, "models/pkg_a/urdf/pkgbot.urdf")
    assert 'filename="../meshes/base.stl"' in urdf
    # Live xacro tags -> expansion step in both the files and the command.
    assert "expand_model.sh" in bundle_paths(b)
    assert "./expand_model.sh" in b["gzCommand"]
    assert_bundle_valid(b)


def test_zip_assembly_round_trips(tmp_path):
    entry = {
        "robot": "pkgbot", "status": "urdf",
        "urdf_url": "https://example.test/pkg_a/urdf/pkgbot.urdf",
        "packages": {"pkg_a": "https://example.test/pkg_a/"},
        "source_label": "fixture source", "license": "MIT",
    }
    result = run_node(tmp_path, "zip", {
        "input": {"slug": "pkgbot", "robotName": "PkgBot", "physics": entry},
        "files": {"https://example.test/pkg_a/urdf/pkgbot.urdf": FIXTURE_URDF},
    })
    raw = base64.b64decode(result["zipBase64"])
    with zipfile.ZipFile(BytesIO(raw)) as zf:
        assert sorted(zf.namelist()) == sorted(result["paths"])
        assert zf.testzip() is None  # CRCs verify
        readme = zf.read("robotforge-pkgbot-gazebo/README.md").decode()
        assert "ros2 launch launch/launch.py" in readme


# --------------------------------------------------------------------- #
# live boot — only where Gazebo actually exists
# --------------------------------------------------------------------- #

def test_gazebo_boots_the_world_if_installed(tmp_path):
    gz = shutil.which("gz") or shutil.which("gazebo")
    if not gz:
        pytest.skip("gz/gazebo is not installed on this machine — the "
                    "bundle ships with parse-level validation and the "
                    "live boot is honestly unverified (installing "
                    "Gazebo is out of scope for this change)")
    result = run_node(tmp_path, "fixtures", {"fixtures": [{
        "name": "pkgbot",
        "input": {"slug": "pkgbot", "robotName": "PkgBot", "physics": {
            "robot": "pkgbot", "status": "urdf",
            "urdf_url": "https://example.test/pkg_a/urdf/pkgbot.urdf",
            "packages": {"pkg_a": "https://example.test/pkg_a/"},
            "source_label": "fixture source", "license": "MIT"}},
        "files": {"https://example.test/pkg_a/urdf/pkgbot.urdf": FIXTURE_URDF},
    }]})
    b = result["fixtures"]["pkgbot"]
    world = tmp_path / "empty_world.sdf"
    world.write_text(bundle_file(b, "worlds/empty_world.sdf"))
    proc = subprocess.run(
        [gz, "sim", "-s", "-r", str(world), "--iterations", "5"],
        capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
