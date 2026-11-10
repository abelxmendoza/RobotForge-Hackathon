"""VEX V5 building (Abel, 2026-11-10): VEX parts in the catalogue, a
VEX V5 tank-drive template and starter spec, the spec's optional
gearing block, the V5RC motor-power check, and the Workshop's Drive
train tab (web-next/src/lib/drivetrain.ts, a pure module node runs).

Pins:
- the V5 motor ratings are one table, mirrored in Python and TS;
- motor.stall_torque_nm stays the torque at the wheel; gearing that
  disagrees with it is a WARN, never silently "fixed";
- the V5RC cap is checked only for V5 specs and names the rule;
- the Drive train tab computes only from recorded fields and names
  what is missing;
- applying a VEX setup keeps motor.stall_torque_nm in step with it.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from robotforge.catalog import Catalog
from robotforge.schema import RobotSpec, SpecError
from robotforge.validate import validate
from robotforge.vex import V5_CARTRIDGES, V5RC_MOTOR_POWER_CAP_W, v5rc_budget

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "web-next/src/lib/drivetrain.ts"
TAB = (ROOT / "web-next/src/components/garage/DriveTrainTab.tsx").read_text()
GARAGE = (ROOT / "web-next/src/components/garage/Garage.tsx").read_text()
EXAMPLE = json.loads((ROOT / "examples/vex-v5-tank-drive.json").read_text())


def _node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    r = subprocess.run([node, "--experimental-strip-types", "-e", "0"],
                       capture_output=True)
    if r.returncode:
        pytest.skip("node cannot strip TypeScript types")
    return node


def _ts(expr: str):
    script = (f"import * as D from {json.dumps(str(LIB))};\n"
              f"const out = ({expr});\n"
              "process.stdout.write(JSON.stringify(out));")
    r = subprocess.run([_node(), "--experimental-strip-types", "--no-warnings",
                        "--input-type=module", "-e", script],
                       capture_output=True, text=True, cwd=ROOT)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_vex_parts_and_template_load():
    cat = Catalog.load()
    vex = [p for p in cat.parts.values() if p.id.startswith("vex_")]
    assert len(vex) >= 15
    t = cat.templates["vex_v5_tank_drive"]
    assert t.required["vex_v5_m11w"] == 4
    assert t.required["vex_v5_brain"] == 1
    for p in vex:
        assert p.license == "proprietary-part"
        assert "VEX" in p.source


def test_example_spec_is_v5_and_passes_checks():
    spec = RobotSpec.from_dict(EXAMPLE)
    assert spec.gearing and spec.gearing.platform == "vex_v5"
    lines = validate(spec)
    assert [f.check for f in lines] == ["all"], lines
    # round trip keeps the gearing block
    assert RobotSpec.from_dict(spec.to_dict()).gearing == spec.gearing


def test_gearing_rejects_unknown_and_bad_values():
    bad = json.loads(json.dumps(EXAMPLE))
    bad["gearing"]["ratio"] = 2
    with pytest.raises(SpecError):
        RobotSpec.from_dict(bad)
    bad = json.loads(json.dumps(EXAMPLE))
    bad["gearing"]["driving_teeth"] = 0
    with pytest.raises(SpecError):
        RobotSpec.from_dict(bad)


def test_stale_wheel_torque_is_a_warning():
    stale = json.loads(json.dumps(EXAMPLE))
    stale["motor"]["stall_torque_nm"] = 0.35  # the motor shaft value, not the wheel
    checks = {f.check: f.severity for f in validate(RobotSpec.from_dict(stale))}
    assert checks.get("gearing.torque_mismatch") == "WARN"


def test_v5rc_motor_power_cap():
    spec = RobotSpec.from_dict(EXAMPLE)
    b = v5rc_budget(spec, other_motors_w=22)
    assert b["drive_w"] == 44 and b["used_w"] == 66 and b["ok"]
    over = json.loads(json.dumps(EXAMPLE))
    over["motor"]["count"] = 9
    f = [x for x in validate(RobotSpec.from_dict(over)) if x.check == "vex.v5rc_motor_power"]
    assert f and "88 W" in f[0].message and "game manual" in f[0].message
    # not a V5 spec: no cap applies
    plain = json.loads(json.dumps(EXAMPLE))
    plain["gearing"]["platform"] = None
    assert v5rc_budget(RobotSpec.from_dict(plain)) is None


def test_ts_table_mirrors_python():
    carts = _ts("D.V5_CARTRIDGES")
    assert [(c["freeRpm"], c["stallTorqueNm"]) for c in carts] == \
        [(c.free_rpm, c.stall_torque_nm) for c in V5_CARTRIDGES]
    assert _ts("D.V5RC_MOTOR_POWER_CAP_W") == V5RC_MOTOR_POWER_CAP_W
    drive_math = (ROOT / "web-next/src/lib/driveMath.ts").read_text()
    mu = _ts("D.ASSUMED_TRACTION_MU")
    assert f"SIM_TYRE_FRICTION = {mu};" in drive_math


def test_drive_numbers_for_the_example():
    n = _ts(f"D.driveNumbers({json.dumps(EXAMPLE)})")
    assert n["wheelRpm"] == pytest.approx(360)
    assert n["freeSpeedMps"] == pytest.approx(360 / 60 * 3.14159265 * 0.1016, rel=1e-4)
    assert n["wheelStallNm"] == pytest.approx(0.5833)
    assert n["stallPushN"] == pytest.approx(0.5833 * 4 / 0.0508, rel=1e-4)
    assert n["tractionPushN"] == pytest.approx(0.85 * 4.0 * 9.81)
    assert n["pushLimitedBy"] == "traction"
    assert n["missing"] == [] and n["torqueMismatch"] is None


def test_drive_numbers_name_what_is_missing():
    spec = {"drivetrain": "differential", "wheel": {"count": 2}, "motor": {"count": 2}}
    n = _ts(f"D.driveNumbers({json.dumps(spec)})")
    assert n["freeSpeedMps"] is None and n["stallPushN"] is None
    for field in ("wheel.diameter_m", "gearing.motor_free_rpm",
                  "motor.stall_torque_nm", "mass_kg"):
        assert field in n["missing"]


def test_layout_is_none_without_wheels_and_notes_six_wheels():
    assert _ts('D.driveLayout({"drivetrain":"multirotor"})') is None
    six = json.loads(json.dumps(EXAMPLE))
    six["wheel"]["count"] = 6
    six["motor"]["count"] = 6
    lay = _ts(f"D.driveLayout({json.dumps(six)})")
    assert len(lay["wheels"]) == 6 and all(w["driven"] for w in lay["wheels"])
    assert lay["twinWheelNote"] and "4 of these 6" in lay["twinWheelNote"]
    xs = sorted({round(w["x"], 4) for w in lay["wheels"]})
    assert len(xs) == 3  # three axles, evenly spread


def test_applying_a_vex_setup_keeps_wheel_torque_in_step():
    choice = {"cartridgeId": "green", "drivingTeeth": 1, "drivenTeeth": 1, "motorPowerW": 11}
    nxt = _ts(f"D.applyGearing({json.dumps(EXAMPLE)}, D.vexGearing({json.dumps(choice)}))")
    assert nxt["gearing"]["motor_free_rpm"] == 200
    assert nxt["motor"]["stall_torque_nm"] == pytest.approx(1.05)
    # and the Python side agrees: no mismatch warning, still V5
    spec = RobotSpec.from_dict(nxt)
    assert [f.check for f in validate(spec)] == ["all"]


def test_workshop_has_a_drive_train_tab():
    nav = GARAGE.split("const WORK_TABS:", 1)[1].split("];", 1)[0]
    assert "{ id: 'drivetrain', label: 'Drive train'" in nav
    assert "<DriveTrainTab key={robot.id} spec={draft}" in GARAGE
    assert "drivetrain|" in GARAGE  # deep links #tab=drivetrain
    # the tab names its basis and never claims a measurement
    assert "not measurements" in TAB
    assert "check the current game manual" in TAB


STARTERS = (ROOT / "web-next/src/lib/vexStarters.ts").read_text()


@pytest.mark.parametrize("fname", sorted(
    re.findall(r"file: '([^']+)'",
               (Path(__file__).resolve().parents[1]
                / "web-next/src/lib/vexStarters.ts").read_text())))
def test_every_vex_starter_is_a_clean_v5_spec(fname):
    data = json.loads((ROOT / "examples" / fname).read_text())
    spec = RobotSpec.from_dict(data)
    assert spec.gearing.platform == "vex_v5"
    assert [f.check for f in validate(spec)] == ["all"], fname
    budget = v5rc_budget(spec)
    assert budget and budget["ok"], fname
    n = _ts(f"D.driveNumbers({json.dumps(data)})")
    assert n["missing"] == [] and n["torqueMismatch"] is None, fname


def test_starters_cover_different_drive_styles():
    files = re.findall(r"file: '([^']+)'", STARTERS)
    assert len(files) >= 4
    specs = [json.loads((ROOT / "examples" / f).read_text()) for f in files]
    assert {s["drivetrain"] for s in specs} >= {"skid_steer", "mecanum"}
    rpms = {s["gearing"]["motor_free_rpm"] * s["gearing"]["driving_teeth"]
            / s["gearing"]["driven_teeth"] for s in specs}
    assert min(rpms) <= 200 and max(rpms) >= 450  # torque and speed builds
    assert "Start a VEX V5 robot" in GARAGE and "VEX_STARTERS.map" in GARAGE


def test_setup_controls_follow_the_recorded_setup():
    # Codex review on #186: the tab can mount before the selected
    # robot's draft arrives; the controls must re-sync to the draft.
    assert "const recordedKey = JSON.stringify(currentVexChoice(spec));" in TAB
    assert "useEffect(() => { setChoice(JSON.parse(recordedKey) as VexChoice); }, [recordedKey]);" in TAB
