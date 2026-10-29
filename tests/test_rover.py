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
