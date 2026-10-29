"""Robodex classification (taxonomy) + 3D take-apart tests.

Part A — the taxonomy lives in ONE place (catalog.MOBILITY_TAXONOMY);
the loader validates every robot's (mobility_class, subtype) pair
against it, and the generated Robodex page renders the class paths
plus "none yet" chips for branches with no robots — structure,
never invented entries.

Part B — the 3D take-apart derives its geometry from the SAME
derivation as the 2D views (taBuildParts/taGeom3d in robot.js).
The Node test runs both against the real spec files and asserts
the same part list and per-part instance counts in both modes.
There is no headless WebGL on this machine, so in-browser 3D
rendering is not exercised here: pages, assets and the shared
geometry are what is verified.
"""
import io
import json
import shutil
import subprocess
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from robotforge.catalog import (MOBILITY_TAXONOMY, Catalog, CatalogError,
                                Robodex, RobotEntry, mobility_subtypes)
from robotforge.cli import main
from robotforge.site import (THREE_IMPORTMAP, THREE_VERSION,
                             render_forge, render_robot_page,
                             render_robots_index)

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()
cat = Catalog.load()

EXPECTED = {
    "Andino": ("Ground — wheeled", "Differential rover"),
    "TurtleBot3 Burger": ("Ground — wheeled", "Differential rover"),
    "TurtleBot3 Waffle Pi": ("Ground — wheeled", "Differential rover"),
    "Pathfinder": ("Ground — wheeled", "Skid-steer rover"),
    "PX4 X500": ("Aerial", "Quadcopter"),
    "Crazyflie 2.1": ("Aerial", "Quadcopter"),
    "Unitree Go2": ("Legged", "Quadruped"),
    "Boston Dynamics Spot": ("Legged", "Quadruped"),
    "Mini Pupper": ("Legged", "Quadruped"),
    "Unitree G1": ("Legged", "Humanoid"),
    "ROBOTIS OP3": ("Legged", "Humanoid"),
    "OpenManipulator-X": ("Stationary", "Robotic arm"),
}


def assert_raises(exc_type, fn):
    try:
        fn()
    except exc_type:
        return
    raise AssertionError(f"expected {exc_type.__name__}")


# ---------------------------------------------------------------------
# Part A — taxonomy
# ---------------------------------------------------------------------

def test_taxonomy_tree_shape():
    classes = [cls for cls, _ in MOBILITY_TAXONOMY]
    assert classes == ["Aerial", "Ground — wheeled", "Ground — tracked",
                       "Legged", "Marine", "Stationary"]
    for cls, subs in MOBILITY_TAXONOMY:
        assert subs, f"{cls}: a class with no subtypes is dead structure"
        assert len(set(subs)) == len(subs), f"{cls}: duplicate subtype"
    assert mobility_subtypes("Ground — wheeled") == (
        "Differential rover", "Skid-steer rover", "Mecanum rover",
        "Car-like")
    assert mobility_subtypes("Nope") == ()


def test_every_robot_is_classified_from_the_tree():
    for r in dex.robots:
        assert r.mobility_class in dict(MOBILITY_TAXONOMY), r.name
        assert r.subtype in mobility_subtypes(r.mobility_class), r.name
        assert r.class_path == f"{r.mobility_class} · {r.subtype}"


def test_every_robot_carries_its_honest_class():
    got = {r.name: (r.mobility_class, r.subtype) for r in dex.robots}
    assert got == EXPECTED, got


def test_loader_rejects_classes_outside_the_tree():
    base = dex.robots[0].to_dict()
    bad = dict(base, mobility_class="Flying")
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(bad))
    # a real subtype under the wrong class is still a rejection
    bad = dict(base, subtype="Quadcopter")
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(bad))
    bad = dict(base, subtype="Tank")
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(bad))
    bad = dict(base)
    del bad["mobility_class"]
    assert_raises(CatalogError, lambda: RobotEntry.from_dict(bad))


def test_robodex_page_shows_class_paths_and_class_filters():
    page = render_robots_index(dex, cat)
    for r in dex.robots:
        assert r.class_path in page, r.name
        assert f'data-mobility="{r.mobility_class}"' in page, r.name
    # every populated class is an enabled chip with its count
    for cls, n in (("Ground — wheeled", 4), ("Aerial", 2),
                   ("Legged", 5), ("Stationary", 1)):
        assert f'data-cfilter="{cls}"' in page, cls
        assert f"{cls} ({n})" in page, cls
        assert f"{cls} — none yet" not in page, cls
    # the still-empty branches show disabled, labelled "none yet" —
    # no entries are invented for them
    for cls in ("Ground — tracked", "Marine"):
        assert f'data-cfilter="{cls}"' in page, cls
        assert f"{cls} — none yet" in page, cls
    assert page.count("disabled") >= 2


def test_robot_pages_show_the_class_path():
    for r in dex.robots:
        page = render_robot_page(r)
        assert f'<div class="cls">{r.class_path}</div>' in page, r.name


def _run_cli(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = main(argv)
    return rc, out.getvalue(), err.getvalue()


def test_cli_and_json_carry_the_taxonomy():
    rc, out, _ = _run_cli(["catalog", "robot", "1"])
    assert rc == 0 and "type: Ground — wheeled · Differential rover" in out
    rc, out, _ = _run_cli(["catalog", "--json"])
    assert rc == 0
    robots = {r["name"]: r for r in json.loads(out)["robots"]}
    for name, (mc, st) in EXPECTED.items():
        assert robots[name]["mobility_class"] == mc, name
        assert robots[name]["subtype"] == st, name


# ---------------------------------------------------------------------
# Part B — 3D take-apart wiring
# ---------------------------------------------------------------------

def test_robot_pages_carry_the_3d_assets_and_importmap():
    assert THREE_VERSION == "0.160.0"
    assert "cdn.jsdelivr.net/npm/three@0.160.0" in THREE_IMPORTMAP
    for r in dex.robots:
        page = render_robot_page(r)
        if not r.spec_file:
            continue
        assert '<script type="importmap">' in page, r.name
        assert "three@0.160.0/build/three.module.js" in page, r.name
        assert "three@0.160.0/examples/jsm/" in page, r.name
        assert ('<script type="module" '
                'src="../../../assets/js/robot3d.js"></script>') in page, \
            r.name
    # the Forge carries the importmap for its scan (.ply) points view
    # (assets/js/scan.js) — but the take-apart module stays robot-only
    forge = render_forge()
    assert '<script type="importmap">' in forge
    assert "assets/js/scan.js" in forge
    assert "robot3d.js" not in forge


def test_viewer_markup_and_module_contracts():
    robot_js = (REPO / "assets/js/robot.js").read_text()
    for marker in ('id="ta-view-2d"', 'id="ta-view-3d"', 'id="ta-3dwrap"',
                   'id="ta-3d-fallback"', "3D unavailable here",
                   "2D-only", "ta3d-geom:start", "ta3d-geom:end",
                   "window.RF3D"):
        assert marker in robot_js, marker
    robot3d_js = (REPO / "assets/js/robot3d.js").read_text()
    for marker in ("await import('three')",
                   "three/addons/controls/OrbitControls.js",
                   "taGeom3d", "taBuildParts", "onFail", "Raycaster",
                   "setExplode", "setSelected"):
        assert marker in robot3d_js, marker
    app_css = (REPO / "assets/css/app.css").read_text()
    assert "#ta-3d canvas" in app_css
    robots_js = (REPO / "assets/js/robots.js").read_text()
    assert "data-cfilter" in robots_js and "dataset.mobility" in robots_js


def test_js_syntax():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; geometry test skips too
    for f in ("robot.js", "robots.js", "robot3d.js"):
        r = subprocess.run([node, "--check", str(REPO / "assets/js" / f)],
                           capture_output=True, text=True, timeout=30)
        assert r.returncode == 0, f"{f}: {r.stderr}"


NODE_GEOM_DRIVER = r"""
const fs = require('fs');
const [robotJs, repo] = process.argv.slice(2);
const src = fs.readFileSync(robotJs, 'utf8');
const mm = m => Math.round(m * 1000);
// robot.js from its part constants through the end of the 3D
// geometry block: the part derivation and nothing that touches
// the DOM at load time.
const head = src.slice(src.indexOf('const PLATE_T'),
  src.indexOf('/* == ta3d-geom:end == */'));
eval(head);
const assert = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
const FILES = ['andino', 'turtlebot3-burger', 'photo-turtlebot',
               'pathfinder'];
const out = {};
for (const f of FILES) {
  const spec = JSON.parse(
    fs.readFileSync(repo + '/examples/' + f + '.json', 'utf8'));
  const built = taBuildParts(spec);
  const units = taGeom3d(spec, built.parts, built.pos);
  const counts = {};
  units.forEach(u => { counts[u.part] = (counts[u.part] || 0) + 1; });
  // the 2D drawing's own instance counts, from the same derivation
  const expect = { plate: 1, wheel: spec.wheel.count,
                   mount: spec.wheel.count };
  if (spec.wheel.count === 2) expect.caster = 2;
  for (const id of ['lidar', 'camera', 'ultrasonic']) {
    if (built.parts.find(p => p.id === id)) expect[id] = 1;
  }
  assert(JSON.stringify(Object.keys(counts).sort()) ===
         JSON.stringify(Object.keys(expect).sort()),
         f + ': part id sets differ ' + JSON.stringify(counts));
  for (const k of Object.keys(expect)) {
    assert(counts[k] === expect[k],
           f + ': ' + k + ' count ' + counts[k] + ' != ' + expect[k]);
  }
  for (const u of units) {
    assert(u.explode.length === 3, f + ': explode not a 3-vector');
    assert(u.meshes.length >= 1, f + ': unit without meshes');
    for (const m of u.meshes) {
      assert(m.center.length === 3 &&
             m.center.every(Number.isFinite),
             f + ': bad center for ' + u.part);
      assert(m.size.every(v => Number.isFinite(v) && v > 0),
             f + ': bad size for ' + u.part);
    }
  }
  const lidar = units.find(u => u.part === 'lidar');
  if (lidar) assert(lidar.meshes.length === 2,
                    f + ': lidar is post + disc, one unit');
  out[f] = counts;
}
console.log(JSON.stringify(out));
"""


def test_3d_geometry_matches_2d_part_list_in_node():
    node = shutil.which("node")
    if not node:
        return  # no node on this machine; page/asset tests still hold
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "geom_driver.js"
        script.write_text(NODE_GEOM_DRIVER)
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/robot.js"),
             str(REPO)],
            capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["pathfinder"]["wheel"] == 4
    assert out["pathfinder"]["mount"] == 4
    assert "caster" not in out["pathfinder"]
    for f in ("andino", "turtlebot3-burger", "photo-turtlebot"):
        assert out[f]["wheel"] == 2 and out[f]["caster"] == 2, f
