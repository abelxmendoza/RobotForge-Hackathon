"""VEX follow-ups (Abel, 2026-11-10): the 2026-27 competition rulebook
profiles (V5RC "Override", VIQRC "Level Up"), VEX IQ parts and starter,
and 6-wheel drives drawn in full by the URDF, Gazebo SDF, take-apart
kit and simulator.

Pins:
- src/robotforge/vex.py and web-next/src/lib/vexRules.ts hold the same
  caps, sizes and mechanism hardware, and give the same verdicts;
- every VEX example and Wrench preset is legal under its rulebook;
- a 6-wheel spec gets six wheels everywhere, the middle pair centred.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from robotforge.catalog import Catalog
from robotforge.cad import wheel_positions
from robotforge.schema import RobotSpec
from robotforge.twin import generate_sdf
from robotforge.urdf import generate_urdf, wheel_layout
from robotforge.validate import validate
from robotforge.vex import MECH_HARDWARE, RULEBOOKS, rulebook_check

ROOT = Path(__file__).resolve().parents[1]
RULES_TS = ROOT / "web-next/src/lib/vexRules.ts"
BUILDS_TS = ROOT / "web-next/src/lib/vexBuilds.ts"
STARTERS_TS = ROOT / "web-next/src/lib/vexStarters.ts"
TAKEAPART_TS = ROOT / "web-next/src/components/robots/takeapart/spec.ts"
TAB = (ROOT / "web-next/src/components/garage/DriveTrainTab.tsx").read_text()
IQ = json.loads((ROOT / "examples/vex-iq-drive-base.json").read_text())
V5 = json.loads((ROOT / "examples/vex-v5-tank-drive.json").read_text())
SPEED6 = json.loads((ROOT / "examples/vex-v5-speed-tank.json").read_text())


def _ts(expr: str):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    script = (f"import * as R from {json.dumps(str(RULES_TS))};\n"
              f"import * as B from {json.dumps(str(BUILDS_TS))};\n"
              f"import * as S from {json.dumps(str(STARTERS_TS))};\n"
              f"import * as T from {json.dumps(str(TAKEAPART_TS))};\n"
              f"const out = ({expr});\n"
              "process.stdout.write(JSON.stringify(out));")
    r = subprocess.run([node, "--experimental-strip-types", "--no-warnings",
                        "--input-type=module", "-e", script],
                       capture_output=True, text=True, cwd=ROOT)
    if r.returncode and "strip-types" in r.stderr:
        pytest.skip("node cannot strip TypeScript types")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _verdicts(report):
    return {(x["rule"], x["verdict"]) for x in report["results"]}


# ------------------------------------------------------------ the rulebooks

def test_python_and_ts_rulebooks_match():
    ts = _ts("{books: R.RULEBOOKS, mech: R.MECH_HARDWARE, w: R.MECH_MOTOR_W}")
    assert set(ts["books"]) == set(RULEBOOKS)
    for rid, py in RULEBOOKS.items():
        t = ts["books"][rid]
        assert t["platform"] == py["platform"]
        assert t["competition"] == py["competition"]
        assert t["season"] == py["season"] and t["game"] == py["game"]
        assert t["manual"] == py["manual"]
        L, W, H = py["size_m"]
        assert t["size"]["lengthM"] == pytest.approx(L)
        assert t["size"]["widthM"] == pytest.approx(W)
        assert t["size"]["heightM"] == pytest.approx(H)
        assert t["motorPowerCapW"] == py["motor_power_cap_w"]
        assert t["drivePowerCapW"] == py["drive_power_cap_w"]
        assert t["motorCountCap"] == py["motor_count_cap"]
        assert t["airTanksCap"] == py["air_tanks_cap"]
        assert t["url"].startswith("https://www.vexrobotics.com/")
        assert t["inspectOnly"], "rules a spec cannot answer are listed"
    for m, (motors, tanks) in MECH_HARDWARE.items():
        assert ts["mech"][m] == {"motors": motors, "airTanks": tanks}


def test_the_2026_27_caps_are_the_manual_numbers():
    v5, iq = RULEBOOKS["v5rc-2026-27"], RULEBOOKS["viqrc-2026-27"]
    assert v5["motor_power_cap_w"] == 88 and v5["drive_power_cap_w"] == 55
    assert [round(x / 0.0254) for x in v5["size_m"]] == [18, 18, 18]
    assert iq["motor_count_cap"] == 6
    assert [round(x / 0.0254) for x in iq["size_m"]] == [20, 11, 15]


@pytest.mark.parametrize("name", ["vex-v5-tank-drive.json",
                                  "vex-v5-speed-tank.json",
                                  "vex-v5-push-drive.json",
                                  "vex-v5-mecanum.json",
                                  "vex-iq-drive-base.json"])
def test_every_vex_starter_is_legal_in_both_languages(name):
    data = json.loads((ROOT / "examples" / name).read_text())
    py = rulebook_check(RobotSpec.from_dict(data))
    assert py is not None and py["ok"], py
    ts = _ts(f"R.rulebookCheck({json.dumps(data)})")
    assert ts["ok"], ts
    assert _verdicts(ts) == _verdicts(py)


def test_starters_list_matches_the_examples_folder():
    files = [s["file"] for s in _ts("S.VEX_STARTERS")]
    for f in files:
        assert (ROOT / "examples" / f).exists(), f
    assert "vex-iq-drive-base.json" in files


def test_six_v5_drive_motors_fail_r11_but_not_r10():
    spec = json.loads(json.dumps(V5))
    spec["motor"]["count"] = 6
    spec["wheel"]["count"] = 6
    py = rulebook_check(RobotSpec.from_dict(spec))
    assert ("R11", "fail") in _verdicts(py) and ("R10", "pass") in _verdicts(py)
    ts = _ts(f"R.rulebookCheck({json.dumps(spec)})")
    assert _verdicts(ts) == _verdicts(py)
    fails = [f for f in validate(RobotSpec.from_dict(spec))
             if f.check == "vex.v5rc_drivetrain_motors"]
    assert fails and "check the current game manual" in fails[0].message


def test_an_iq_robot_with_seven_motors_fails_r9():
    spec = json.loads(json.dumps(IQ))
    spec["motor"]["count"] = 4
    spec["vex_mechanisms"] = ["intake", "lift"]  # 4 + 1 + 2 = 7
    py = rulebook_check(RobotSpec.from_dict(spec))
    assert ("R9", "fail") in _verdicts(py)
    ts = _ts(f"R.rulebookCheck({json.dumps(spec)})")
    assert ("R9", "fail") in _verdicts(ts)
    assert "7 Smart Motors of 6" in next(r["detail"] for r in ts["results"] if r["rule"] == "R9")
    assert any(f.check == "vex.viqrc_motors" for f in validate(RobotSpec.from_dict(spec)))


def test_an_oversize_robot_fails_the_starting_size():
    spec = json.loads(json.dumps(V5))
    spec["length_m"] = 0.5  # 19.7 in
    py = rulebook_check(RobotSpec.from_dict(spec))
    assert ("R3", "fail") in _verdicts(py)
    ts = _ts(f"R.rulebookCheck({json.dumps(spec)})")
    assert ("R3", "fail") in _verdicts(ts)
    assert "length 19.7 in" in next(r["detail"] for r in ts["results"] if r["rule"] == "R3")


def test_non_vex_robots_get_no_rulebook():
    plain = {"name": "x", "drivetrain": "skid_steer", "length_m": 1, "width_m": 1, "height_m": 1}
    assert _ts(f"R.rulebookCheck({json.dumps(plain)})") is None
    assert _ts(f"R.rulebookProblems({json.dumps(plain)})") == []


def test_wrench_presets_are_legal():
    builds = _ts("B.suggestVexBuilds(B.parseVexSuggest('suggest a vex robot for a competition'))")
    assert builds
    for b in builds:
        rep = _ts(f"R.rulebookCheck({json.dumps(b['spec'])})")
        assert rep["ok"], (b["spec"]["name"], rep)


def test_drive_train_tab_shows_the_rules_panel():
    assert "rulebookCheck" in TAB and "RulesPanel" in TAB
    assert 'data-testid="vex-rules"' in TAB
    assert "Check at inspection" in TAB or "inspection" in TAB


# ----------------------------------------------------------------- VEX IQ

def test_iq_parts_and_template_load():
    cat = Catalog.load()
    iq = [p for p in cat.parts.values() if p.id.startswith("vex_iq_")]
    assert len(iq) == 11
    for p in iq:
        assert p.license == "proprietary-part" and "VEX IQ" in p.source
    t = cat.templates["vex_iq_drive_base"]
    assert t.required["vex_iq_motor"] == 2 and t.required["vex_iq_brain"] == 1


def test_iq_starter_validates_clean():
    spec = RobotSpec.from_dict(IQ)
    assert spec.gearing.platform == "vex_iq"
    assert [f.check for f in validate(spec)] == ["all"]


# ------------------------------------------------------- six-wheel drives

def test_six_wheels_get_three_evenly_spaced_pairs():
    spec = RobotSpec.from_dict(SPEED6)
    assert spec.wheel.count == 6
    pos = wheel_layout(spec)
    assert len(pos) == 6
    xs = sorted({round(x, 6) for x, _ in pos})
    assert len(xs) == 3 and xs[1] == 0.0 and xs[0] == -xs[2]
    assert sum(1 for _, y in pos if y > 0) == 3
    assert wheel_positions(spec) == pos  # the take-apart kit agrees


def test_four_and_two_wheel_layouts_are_unchanged():
    spec = RobotSpec.from_dict(V5)
    wx = spec.length_m / 2 - spec.wheel.diameter_m / 2
    wy = spec.width_m / 2 + spec.wheel.width_m / 2
    assert wheel_layout(spec) == [(wx, wy), (wx, -wy), (-wx, wy), (-wx, -wy)]
    two = json.loads(json.dumps(V5))
    two["wheel"]["count"] = 2
    two["drivetrain"] = "differential"
    assert wheel_layout(RobotSpec.from_dict(two)) == [(0.0, wy), (0.0, -wy)]


def test_six_wheel_urdf_and_sdf_have_six_driven_wheels():
    spec = RobotSpec.from_dict(SPEED6)
    urdf = generate_urdf(spec)
    assert len(re.findall(r'<joint name="wheel_\d+_(?:left|right)_joint"', urdf)) == 6
    sdf = generate_sdf(spec)
    assert len(re.findall(r"<left_joint>", sdf)) == 3
    assert len(re.findall(r"<right_joint>", sdf)) == 3
    assert "wheel_mid1_left_joint" in sdf


def test_six_wheel_takeapart_matches_python():
    spec = RobotSpec.from_dict(SPEED6)
    ts = _ts(f"T.taWheelPositions({json.dumps(SPEED6)})")
    assert len(ts) == 6
    for (px, py), (tx, ty) in zip(wheel_layout(spec), ts):
        assert tx == pytest.approx(px) and ty == pytest.approx(py)
