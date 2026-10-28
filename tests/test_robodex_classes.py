"""Robodex beyond ground rovers: the aerial / legged / stationary
entries, the class-aware schema and validator, and the generalized
take-apart derivation.

The honesty rules under test:
- the four ground founders validate byte-identically to before the
  schema grew class fields (regression lines hardcoded below);
- every new entry is NOT_GATED with no runs, and its gate note says
  why in class terms;
- new-class specs carry the class fields their class needs and no
  wheel block; the JS validator mirror agrees with Python on them,
  including on deliberately broken variants;
- the 2D part derivation and the 3D geometry agree per class
  (one unit per drawn instance), checked in Node like the ground
  parity test.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from robotforge.catalog import Robodex
from robotforge.schema import RobotSpec, SpecError
from robotforge.site import render_robot_page
from robotforge.validate import validate

REPO = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
dex = Robodex.load()

NEW_FILES = {
    "px4-x500": ("multirotor", "Aerial"),
    "crazyflie-2-1": ("multirotor", "Aerial"),
    "unitree-go2": ("quadruped", "Legged"),
    "mini-pupper": ("quadruped", "Legged"),
    "unitree-g1": ("humanoid", "Legged"),
    "robotis-op3": ("humanoid", "Legged"),
    "openmanipulator-x": ("robotic_arm", "Stationary"),
}


def _lines(spec):
    return [f"[{f.severity}] {f.check}: {f.message}" for f in validate(spec)]


def _spec(name):
    return RobotSpec.from_json((REPO / "examples" / f"{name}.json").read_text())


# ---------------------------------------------------------------------
# Regression: the ground fleet's findings do not move
# ---------------------------------------------------------------------

GROUND_BASELINE = {
    "andino": ["[INFO] all: spec passed all engineering checks"],
    "turtlebot3-burger": ["[INFO] all: spec passed all engineering checks"],
    # photo-turtlebot is a photo draft (all dimensions ESTIMATED): it
    # used to sit here with the clean-pass line, which encoded a bug —
    # an estimated spec must never collect a verdict. It now earns the
    # provenance WARN instead (see test_photo.py's honesty tests).
    "photo-turtlebot": [
        "[WARN] provenance.estimated_dimensions: every dimension in "
        "this spec is ESTIMATED from a photo, not measured — the "
        "checks ran against estimates, so this is not a verdict on "
        "the real robot; confirm the dimensions before trusting "
        "the spec"],
    "pathfinder": ["[INFO] all: spec passed all engineering checks"],
    "indoor-delivery-rover": ["[INFO] all: spec passed all engineering checks"],
    "broken-indoor-rover": [
        "[ERROR] geometry.clearance_vs_wheel: ground clearance 0.060 m "
        "exceeds wheel radius 0.050 m — impossible without a lifted "
        "chassis design",
        "[WARN] electrical.voltage_match: motor voltage 11.1 V is far "
        "below battery 24 V — a regulator is required and was not declared",
    ],
}


def test_ground_findings_are_byte_identical():
    for name, expected in GROUND_BASELINE.items():
        assert _lines(_spec(name)) == expected, name


def test_ground_specs_roundtrip_unchanged():
    for name in GROUND_BASELINE:
        spec = _spec(name)
        again = RobotSpec.from_dict(json.loads(json.dumps(spec.to_dict())))
        assert again.to_dict() == spec.to_dict(), name
        assert spec.wheel is not None and spec.ground_clearance_m is not None


# ---------------------------------------------------------------------
# New-class specs: parse, class fields, validation
# ---------------------------------------------------------------------

def test_new_class_specs_parse_with_class_fields():
    for name, (drivetrain, _mobility) in NEW_FILES.items():
        spec = _spec(name)
        assert spec.drivetrain == drivetrain, name
        # non-ground robots declare no wheels and no ground clearance
        assert spec.wheel is None, name
        assert spec.ground_clearance_m is None, name
        again = RobotSpec.from_dict(json.loads(json.dumps(spec.to_dict())))
        assert again.to_dict() == spec.to_dict(), name
    x500 = _spec("px4-x500")
    assert x500.rotors.count == 4 and x500.rotors.prop_diameter_m == 0.279
    go2 = _spec("unitree-go2")
    assert go2.legs.count == 4 and go2.arms is None
    g1 = _spec("unitree-g1")
    assert g1.legs.count == 2 and g1.arms.count == 2
    assert g1.motor.count == 29  # the g1_29dof URDF's revolute joints
    omx = _spec("openmanipulator-x")
    assert omx.arms.count == 1 and omx.legs is None
    assert omx.battery.chemistry == "dc_supply"  # no onboard battery


def test_new_class_specs_validate_clean():
    for name in NEW_FILES:
        assert _lines(_spec(name)) == [
            "[INFO] all: spec passed all engineering checks"], name


def _variant(name, **changes):
    d = json.loads((REPO / "examples" / f"{name}.json").read_text())
    for k, v in changes.items():
        if v is None:
            d.pop(k, None)
        else:
            d[k] = v
    return RobotSpec.from_dict(d)


def test_class_checks_catch_broken_variants():
    # props wider than the motor spacing would overlap
    bad = _variant("px4-x500", rotors={"count": 4, "prop_diameter_m": 0.4})
    lines = _lines(bad)
    assert any("geometry.prop_overlap" in ln for ln in lines), lines
    # one motor per rotor is the multirotor norm
    bad = _variant("px4-x500", motor={"kind": "bldc", "voltage_v": 14.8,
                                      "count": 3, "stall_torque_nm": None})
    assert any("drivetrain.rotor_motor_match" in ln for ln in _lines(bad))
    # a multirotor with no rotors block is an error, not a pass
    bad = _variant("px4-x500", rotors=None)
    assert any("[ERROR] class.rotors_missing" in ln for ln in _lines(bad))
    # a three-legged "quadruped" warns
    bad = _variant("unitree-go2", legs={"count": 3, "segments": 2})
    assert any("drivetrain.leg_count" in ln for ln in _lines(bad))
    # a humanoid with no arms block is an error
    bad = _variant("unitree-g1", arms=None)
    assert any("[ERROR] class.arms_missing" in ln for ln in _lines(bad))
    # a two-armed "manipulator" warns
    bad = _variant("openmanipulator-x", arms={"count": 2, "segments": 3})
    assert any("drivetrain.arm_count" in ln for ln in _lines(bad))


def test_unknown_drivetrain_still_rejected():
    d = json.loads((REPO / "examples" / "px4-x500.json").read_text())
    d["drivetrain"] = "rocket"
    try:
        RobotSpec.from_dict(d)
    except SpecError:
        return
    raise AssertionError("unknown drivetrain accepted")


# ---------------------------------------------------------------------
# Robodex entries: NOT_GATED, honest notes, sourced
# ---------------------------------------------------------------------

def test_new_entries_are_not_gated_with_class_reasons():
    by_name = {r.name: r for r in dex.robots}
    assert len(dex.robots) == 11
    for slug, (_dt, mobility) in NEW_FILES.items():
        entry = next(r for r in dex.robots if r.spec_file == f"examples/{slug}.json")
        assert entry.mobility_class == mobility, entry.name
        gs = entry.gate_status
        assert gs.status == "NOT_GATED", entry.name
        assert not gs.runs, entry.name
        note = gs.note.lower()
        assert "gate" in note, entry.name
        if mobility == "Aerial":
            assert "flight" in note, entry.name
        elif mobility == "Legged":
            assert "legged" in note or "walking" in note, entry.name
        else:
            assert "manipulation" in note, entry.name
        assert entry.provenance.get("license"), entry.name
        assert entry.image_url and entry.image_credit, entry.name
    assert by_name["PX4 X500"].number == 5
    assert by_name["OpenManipulator-X"].number == 11


def test_new_robot_pages_do_not_advertise_ground_commands():
    for r in dex.robots:
        if r.number < 5:
            continue
        page = render_robot_page(r)
        assert "robotforge validate" in page, r.name
        assert "robotforge run-gate" not in page, r.name
        assert "robotforge cad" not in page.split('id="commands"')[1], r.name
        assert "No recorded gate runs yet" in page, r.name


def test_mini_pupper_illustration_is_labeled_and_local():
    entry = next(r for r in dex.robots if r.name == "Mini Pupper")
    assert entry.image_url == "assets/img/illustrations/mini-pupper.svg"
    assert (REPO / entry.image_url).exists()
    assert "illustration" in entry.image_credit.lower()
    assert "not a photo" in entry.image_credit.lower()


# ---------------------------------------------------------------------
# JS mirror parity on the new classes (forge.js)
# ---------------------------------------------------------------------

def _run_forge_validator(specs):
    forge_js = (REPO / "assets/js/forge.js").read_text()
    start = forge_js.index("/* == forge-validate:start == */")
    end = forge_js.index("/* == forge-validate:end == */")
    block = forge_js[start:end]
    driver = (
        "import fs from 'node:fs';\n" + block + "\n"
        "globalThis.__fv = forgeValidateSpec;\n"
        "const specs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));\n"
        "console.log(JSON.stringify(specs.map(s => globalThis.__fv(s))));\n")
    with tempfile.TemporaryDirectory() as tmp:
        dp = Path(tmp) / "driver.mjs"
        sp = Path(tmp) / "specs.json"
        dp.write_text(driver)
        sp.write_text(json.dumps(specs))
        r = subprocess.run([NODE, str(dp), str(sp)],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_forge_validator_matches_python_on_new_classes():
    if not NODE:
        return
    names = list(NEW_FILES)
    specs = [json.loads((REPO / "examples" / f"{n}.json").read_text())
             for n in names]
    broken = json.loads(json.dumps(specs[0]))
    broken["rotors"] = {"count": 4, "prop_diameter_m": 0.4}
    specs.append(broken)
    results = _run_forge_validator(specs)
    for name, spec, res in zip(names + ["px4-x500-broken"], specs, results):
        expected = _lines(RobotSpec.from_dict(spec))
        assert res["lines"] == expected, (name, res["lines"], expected)
        assert res["schemaErrors"] is False, name
    assert any("geometry.prop_overlap" in ln for ln in results[-1]["lines"])


# ---------------------------------------------------------------------
# Node parity: 2D part derivation == 3D unit counts, per class
# ---------------------------------------------------------------------

NODE_CLASS_DRIVER = r"""
const fs = require('fs');
const [robotJs, repo] = process.argv.slice(2);
const src = fs.readFileSync(robotJs, 'utf8');
const mm = m => Math.round(m * 1000);
const head = src.slice(src.indexOf('const PLATE_T'),
  src.indexOf('/* == ta3d-geom:end == */'));
eval(head);
const assert = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };
const FILES = ['px4-x500', 'crazyflie-2-1', 'unitree-go2', 'mini-pupper',
               'unitree-g1', 'robotis-op3', 'openmanipulator-x'];
const out = {};
for (const f of FILES) {
  const spec = JSON.parse(
    fs.readFileSync(repo + '/examples/' + f + '.json', 'utf8'));
  const built = taBuildParts(spec);
  const units = taGeom3d(spec, built.parts, built.pos);
  const counts = {};
  units.forEach(u => { counts[u.part] = (counts[u.part] || 0) + 1; });
  // one 3D unit per drawn instance of each 2D part
  const expect = {};
  for (const p of built.parts) expect[p.id] = p.qty;
  // the gripper part is one unit drawn with two finger meshes
  assert(JSON.stringify(Object.keys(counts).sort()) ===
         JSON.stringify(Object.keys(expect).sort()),
         f + ': part id sets differ ' + JSON.stringify(counts) +
         ' vs ' + JSON.stringify(expect));
  for (const k of Object.keys(expect)) {
    assert(counts[k] === expect[k],
           f + ': ' + k + ' count ' + counts[k] + ' != qty ' + expect[k]);
  }
  for (const p of built.parts) {
    assert(p.file === null, f + ': schematic part ' + p.id + ' names a file');
  }
  for (const u of units) {
    assert(u.explode.length === 3, f + ': explode not a 3-vector');
    assert(u.meshes.length >= 1, f + ': unit without meshes');
    for (const m of u.meshes) {
      assert(m.center.length === 3 && m.center.every(Number.isFinite),
             f + ': bad center for ' + u.part);
      assert(m.size.every(v => Number.isFinite(v) && v > 0),
             f + ': bad size for ' + u.part);
    }
  }
  out[f] = counts;
}
console.log(JSON.stringify(out));
"""


def test_class_geometry_matches_part_list_in_node():
    if not NODE:
        return
    with tempfile.TemporaryDirectory() as td:
        script = Path(td) / "class_geom_driver.js"
        script.write_text(NODE_CLASS_DRIVER)
        r = subprocess.run(
            [NODE, str(script), str(REPO / "assets/js/robot.js"), str(REPO)],
            capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["px4-x500"] == {"frame": 1, "arm": 4, "rotor": 4,
                               "battery": 1, "fc": 1}
    assert out["crazyflie-2-1"] == out["px4-x500"]
    assert out["unitree-go2"] == {"body": 1, "leg": 4, "head": 1, "battery": 1}
    assert out["mini-pupper"] == out["unitree-go2"]
    assert out["unitree-g1"] == {"pelvis": 1, "torso": 1, "head": 1,
                                 "arm": 2, "leg": 2, "battery": 1}
    assert out["robotis-op3"] == out["unitree-g1"]
    assert out["openmanipulator-x"] == {"base": 1, "link": 3,
                                        "gripper": 1, "battery": 1}
