"""Rover field checks: slope, step, runtime — estimates, never gate verdicts."""
import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

from robotforge import rover  # noqa: E402
from robotforge.cli import main  # noqa: E402
from robotforge.schema import RobotSpec  # noqa: E402


def load(name):
    return RobotSpec.from_json((REPO / "examples" / f"{name}.json").read_text())


def test_slope_matches_hand_calculation():
    spec = load("pathfinder")
    c = rover.check_slope(spec, 15.0, 0.05)
    r = spec.wheel.diameter_m / 2
    a = math.radians(15)
    need = spec.mass_kg * 9.81 * (math.sin(a) + 0.05 * math.cos(a)) * r
    have = spec.motor.stall_torque_nm * 0.4 * spec.motor.count
    assert c.status == "PASS"
    assert f"{need:.2f} N·m" in c.summary and f"{have:.2f} N·m" in c.summary


def test_max_slope_holds_exactly_at_the_limit():
    spec = load("pathfinder")
    best = rover.max_slope_deg(spec, 0.05)
    c = rover.check_slope(spec, best, 0.05)
    assert c.status == "MARGINAL"  # margin is 1.0 at the limit
    assert rover.check_slope(spec, best + 2, 0.05).status == "FAIL"


def test_missing_torque_is_not_checked_and_names_the_field():
    data = json.loads((REPO / "examples" / "pathfinder.json").read_text())
    data["motor"]["stall_torque_nm"] = None
    c = rover.check_slope(RobotSpec.from_dict(data), 10, 0.05)
    assert c.status == "NOT_CHECKED"
    assert "stall_torque_nm" in c.summary


def test_step_limited_by_belly_clearance():
    spec = load("pathfinder")  # 100 mm wheels (40 mm limit), 35 mm clearance
    assert rover.check_step(spec, 0.02).status == "PASS"
    assert rover.check_step(spec, 0.05).status == "FAIL"
    assert rover.check_step(spec, 0.05).value == pytest.approx(0.035)


def test_runtime_scales_with_capacity():
    spec = load("pathfinder")
    h1, _, _ = rover.estimate_runtime(spec, 0.5, 0.05, 5.0)
    data = spec.to_dict()
    data["battery"]["capacity_mah"] *= 2
    h2, _, _ = rover.estimate_runtime(RobotSpec.from_dict(data), 0.5, 0.05, 5.0)
    assert h2 == pytest.approx(2 * h1)


def test_non_ground_robot_is_refused():
    with pytest.raises(ValueError):
        rover.check_rover(load("px4-x500"))


def test_cli_rover_exit_codes(capsys):
    assert main(["rover", str(REPO / "examples/pathfinder.json"),
                 "--step-m", "0.02"]) == 0
    assert main(["rover", str(REPO / "examples/pathfinder.json")]) == 1
    out = capsys.readouterr().out
    assert "[FAIL] rover.step_climb" in out
    assert main(["rover", str(REPO / "examples/px4-x500.json")]) == 2


def test_browser_port_matches_python():
    """web-next's rover.ts gives the same numbers as rover.py."""
    node = __import__("shutil").which("node")
    if not node:
        pytest.skip("node not available")
    ts = REPO / "web-next" / "src" / "lib" / "rover.ts"
    script = f"""
import {{ checkRover }} from '{ts.as_posix()}';
const specs = JSON.parse(process.argv[1]);
console.log(JSON.stringify(specs.map(s => checkRover(s, {{}}))));
"""
    names = ["pathfinder", "turtlebot3-burger", "andino", "indoor-delivery-rover"]
    specs = [json.loads((REPO / "examples" / f"{n}.json").read_text()) for n in names]
    r = subprocess.run([node, "--experimental-strip-types", "--input-type=module",
                        "-e", script, json.dumps(specs)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    js = json.loads(r.stdout)
    for name, spec, got in zip(names, specs, js):
        want = rover.check_rover(RobotSpec.from_dict(spec)).to_dict()["checks"]
        for w, g in zip(want, got["checks"]):
            assert w["status"] == g["status"], (name, w, g)
            if w["value"] is not None:
                assert g["value"] == pytest.approx(w["value"], abs=0.051), (name, w["name"])


def test_browser_port_refuses_cleared_inputs():
    """A field cleared in the Garage arrives as null: NOT_CHECKED, never PASS."""
    node = __import__("shutil").which("node")
    if not node:
        pytest.skip("node not available")
    ts = REPO / "web-next" / "src" / "lib" / "rover.ts"
    spec = json.loads((REPO / "examples" / "pathfinder.json").read_text())
    spec["mass_kg"] = None
    script = f"""
import {{ checkRover }} from '{ts.as_posix()}';
console.log(JSON.stringify(checkRover(JSON.parse(process.argv[1]), {{}})));
"""
    r = subprocess.run([node, "--experimental-strip-types", "--input-type=module",
                        "-e", script, json.dumps(spec)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    checks = {c["name"]: c for c in json.loads(r.stdout)["checks"]}
    assert checks["rover.slope_climb"]["status"] == "NOT_CHECKED"
    assert "mass_kg" in checks["rover.slope_climb"]["summary"]
    assert checks["rover.runtime"]["status"] == "NOT_CHECKED"
    assert checks["rover.step_climb"]["status"] != "NOT_CHECKED"


def test_offline_part_helper_never_confirms_a_negation():
    node = __import__("shutil").which("node")
    if not node:
        pytest.skip("node not available")
    ts = REPO / "web-next" / "src" / "lib" / "inventory.ts"
    script = f"""
import {{ offlinePartReply }} from '{ts.as_posix()}';
const part = {{ name: 'motor?', specs: {{}} }};
const msgs = ["No, that is not correct", "do not confirm", "that's wrong", "yes, that's right", "Yep 12 V"];
console.log(JSON.stringify(msgs.map(m => offlinePartReply(part, m).confirmed)));
"""
    r = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == [False, False, False, True, True]


def test_inventory_merge_keeps_owner_edits_made_during_a_request():
    node = __import__("shutil").which("node")
    if not node:
        pytest.skip("node not available")
    ts = REPO / "web-next" / "src" / "lib" / "inventory.ts"
    script = f"""
import {{ mergeUpdate }} from '{ts.as_posix()}';
const snap = {{ name: 'Identifying…', category: 'other', quantity: 1, condition: 'unknown', specs: {{ voltage_v: 12 }} }};
const latest = {{ ...snap, name: 'My 37 mm motor', specs: {{ voltage_v: 24 }} }};
const out = mergeUpdate(latest, snap, {{ name: 'DC motor', category: 'motor', specs: {{ voltage_v: 6, rpm: 300 }} }});
console.log(JSON.stringify(out));
"""
    r = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["name"] == "My 37 mm motor"      # owner edited it: owner wins
    assert out["category"] == "motor"           # untouched: model fills it
    assert out["specs"] == {"voltage_v": 24, "rpm": 300}
