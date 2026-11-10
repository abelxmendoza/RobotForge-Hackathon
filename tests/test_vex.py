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
BUILDS = ROOT / "web-next/src/lib/vexBuilds.ts"
CHAT = (ROOT / "web-next/src/components/chat/ChatDock.tsx").read_text()
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
              f"import * as B from {json.dumps(str(BUILDS))};\n"
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


# ---- Wrench: several VEX build ideas at once, changed with words ----

@pytest.mark.parametrize("text,count", [
    ("suggest 3 vex builds", 3),
    ("give me two VEX robot ideas", 2),
    ("can you suggest a vex drive base", 1),
    ("show me some vex builds", 3),
])
def test_vex_suggest_parses_counts(text, count):
    assert _ts(f"B.parseVexSuggest({json.dumps(text)})")["count"] == count


@pytest.mark.parametrize("text", [
    "suggest a raspberry pi 5", "make omega1 faster", "what is vex",
])
def test_vex_suggest_ignores_other_asks(text):
    assert _ts(f"B.parseVexSuggest({json.dumps(text)})") is None


@pytest.mark.parametrize("n", [2, 3])
def test_suggestions_are_different_and_valid(n):
    builds = _ts(f"B.suggestVexBuilds({n}, [])")
    assert len(builds) == n
    shapes = {(b["spec"]["drivetrain"], b["spec"]["motor"]["count"],
               b["spec"]["wheel"].get("kind")) for b in builds}
    assert len(shapes) == n  # no two ideas are the same drive
    for b in builds:
        spec = RobotSpec.from_dict(b["spec"])
        assert [f.check for f in validate(spec)] == ["all"], b["title"]
        assert v5rc_budget(spec)["ok"]
        n_ = _ts(f"D.driveNumbers({json.dumps(b['spec'])})")
        assert n_["missing"] == [] and n_["torqueMismatch"] is None


def test_focus_words_pick_matching_builds():
    fast = _ts("B.suggestVexBuilds(1, ['speed'])")[0]["spec"]
    push = _ts("B.suggestVexBuilds(1, ['push'])")[0]["spec"]
    rpm = lambda s: s["gearing"]["motor_free_rpm"] * s["gearing"]["driving_teeth"] / s["gearing"]["driven_teeth"]
    assert rpm(fast) > rpm(push)


@pytest.mark.parametrize("text,target,kinds", [
    ("make #2 faster", 2, ["faster"]),
    ("give the first one six motors", 1, ["motors"]),
    ("switch build 3 to mecanum", 3, ["drive"]),
    ("make it stronger", None, ["stronger"]),
    ("use 3.25 inch traction wheels", None, ["wheelSize", "wheelKind"]),
])
def test_vex_edit_parses(text, target, kinds):
    e = _ts(f"B.parseVexEdit({json.dumps(text)})")
    assert e["target"] == target
    assert [o["kind"] for o in e["ops"]] == kinds


@pytest.mark.parametrize("text", ["add a raspberry pi 5", "how fast is omega1", "hello"])
def test_vex_edit_ignores_other_asks(text):
    assert _ts(f"B.parseVexEdit({json.dumps(text)})") is None


@pytest.mark.parametrize("ops", [
    [{"kind": "faster"}], [{"kind": "stronger"}], [{"kind": "motors", "n": 6}],
    [{"kind": "drive", "drive": "mecanum"}], [{"kind": "wheelSize", "inches": 2.75}],
])
def test_edits_change_the_drive_and_stay_valid(ops):
    base = json.loads((ROOT / "examples/vex-v5-tank-drive.json").read_text())
    out = _ts(f"B.editVexSpec({json.dumps(base)}, {json.dumps(ops)})")
    assert out["changes"] and not out["problems"]
    spec = RobotSpec.from_dict(out["spec"])
    assert [f.check for f in validate(spec)] in (["all"], ["vex.v5rc_motor_power"])
    assert out["spec"]["name"] == base["name"]
    before = _ts(f"D.driveNumbers({json.dumps(base)})")
    after = _ts(f"D.driveNumbers({json.dumps(out['spec'])})")
    assert after["torqueMismatch"] is None
    if ops[0]["kind"] == "faster":
        assert after["freeSpeedMps"] > before["freeSpeedMps"]
    if ops[0]["kind"] == "stronger":
        assert after["stallPushN"] > before["stallPushN"]


def test_impossible_edits_are_refused_not_guessed():
    mec = json.loads((ROOT / "examples/vex-v5-mecanum.json").read_text())
    out = _ts(f"B.editVexSpec({json.dumps(mec)}, [{{kind:'motors', n:6}}])")
    assert out["changes"] == [] and out["problems"]
    omega = {"name": "x", "drivetrain": "skid_steer", "wheel": {"count": 4, "diameter_m": 0.1}}
    out = _ts(f"B.editVexSpec({json.dumps(omega)}, [{{kind:'faster'}}])")
    assert out["changes"] == [] and "not a VEX V5" in out["problems"][0]


def test_wrench_wires_vex_cards():
    assert "if (runVexCommand(q)) return true;" in CHAT
    assert "<VexBuildsCard" in CHAT and "<VexEditCard" in CHAT
    # An edit to a saved robot is a preview until Apply, saved as a new
    # version, and refused if the robot changed since the preview.
    assert "robot.versions.at(-1)?.id !== plan.baseVersionId" in CHAT
    assert "lastApplied.current = { robotId: robot.id, versionId };" in CHAT


# ---- 3D 360 models of VEX builds ----

MODEL = ROOT / "web-next/src/lib/vexModel3d.ts"


def _model(expr: str):
    script = (f"import * as THREE from 'three';\n"
              f"import * as M from {json.dumps(str(MODEL))};\n"
              f"import * as B from {json.dumps(str(BUILDS))};\n"
              f"const out = ({expr});\n"
              "process.stdout.write(JSON.stringify(out));")
    r = subprocess.run([_node(), "--experimental-strip-types", "--no-warnings",
                        "--input-type=module", "-e", script],
                       capture_output=True, text=True, cwd=ROOT / "web-next")
    if "Cannot find package 'three'" in r.stderr:
        pytest.skip("web-next node_modules not installed")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_model_layout_follows_the_spec():
    six = json.loads((ROOT / "examples/vex-v5-speed-tank-6m.json").read_text())
    lay = _model(f"M.vexLayout({json.dumps(six)})")
    assert lay["perSide"] == 3 and len(lay["motorXs"]) == 3
    assert lay["cartridge"] == "blue" and (lay["driving"], lay["driven"]) == (36, 48)
    mec = _model(f"M.vexLayout({json.dumps(json.loads((ROOT / 'examples/vex-v5-mecanum.json').read_text()))})")
    assert mec["wheelKind"] == "mecanum"
    two = _model("M.vexLayout(B.suggestVexBuilds(3, ['cheap'])[0].spec)")
    assert two["perSide"] == 2 and len(two["motorXs"]) == 1  # 2-motor bot: one per side


def test_model_draws_every_wheel_motor_and_gear():
    out = _model("""B.suggestVexBuilds(3, []).map((b) => {
      const g = M.buildVexModel(THREE, b.spec); const n = {};
      g.traverse((o) => { if (o.name) n[o.name] = (n[o.name] || 0) + 1; });
      return { wheels: b.spec.wheel.count, motors: b.spec.motor.count,
               geared: b.spec.gearing.driving_teeth !== b.spec.gearing.driven_teeth, n };
    })""")
    for b in out:
        assert b["n"]["wheel"] == b["wheels"]
        assert b["n"]["motor"] == b["motors"]
        assert b["n"].get("gear", 0) == (2 * b["motors"] if b["geared"] else 0)
        assert b["n"]["brain"] == 1


def test_3d_models_shown_on_cards_and_drive_train_tab():
    cards = (ROOT / "web-next/src/components/chat/VexBuilds.tsx").read_text()
    assert cards.count("<VexModel3D") == 3  # each build, Now and After
    assert "<VexModel3D" in TAB and "applyGearing(spec, whatIf)" in TAB
    viewer = (ROOT / "web-next/src/components/garage/VexModel3D.tsx").read_text()
    assert "prefers-reduced-motion" in viewer and "IntersectionObserver" in viewer


# ---- scoring mechanisms (from real V5RC robots: intake, lift, pneumatics) ----

@pytest.mark.parametrize("text,target,ops", [
    ("add an intake to #1", 1, [("addMech", "intake")]),
    ("give #2 a lift", 2, [("addMech", "lift")]),
    ("remove the pneumatics from the first one", 1, [("removeMech", "pneumatics")]),
    ("add a conveyor and air tanks", None, [("addMech", "intake"), ("addMech", "pneumatics")]),
])
def test_mechanism_edits_parse(text, target, ops):
    e = _ts(f"B.parseVexEdit({json.dumps(text)})")
    assert e["target"] == target
    assert [(o["kind"], o.get("mech")) for o in e["ops"]] == ops


def test_competition_robot_counts_mechanisms_in_power_and_mass():
    comp = _ts("B.suggestVexBuilds(1, ['full'])[0]")
    assert comp["spec"]["vex_mechanisms"] == ["intake", "pneumatics"]
    assert _ts(f"B.mechPowerW({json.dumps(comp['spec'])})") == 11
    spec = RobotSpec.from_dict(comp["spec"])  # extra block is ignored by the checker
    assert [f.check for f in validate(spec)] == ["all"]
    out = _ts(f"B.editVexSpec({json.dumps(comp['spec'])}, [{{kind:'addMech', mech:'lift'}}])")
    assert "added lift tower (2 motors)" in out["changes"]
    assert out["spec"]["mass_kg"] == pytest.approx(comp["spec"]["mass_kg"] + 1.0)
    assert any("99 W, over the V5RC 88 W cap" in p for p in out["problems"])
    back = _ts(f"B.editVexSpec({json.dumps(out['spec'])}, [{{kind:'removeMech', mech:'lift'}}])")
    assert back["spec"]["vex_mechanisms"] == ["intake", "pneumatics"] and not back["problems"]
    again = _ts(f"B.editVexSpec({json.dumps(comp['spec'])}, [{{kind:'addMech', mech:'intake'}}])")
    assert again["changes"] == [] and "already has" in again["problems"][0]


def test_model_draws_mechanisms_and_plates():
    out = _model("""(() => {
      const spec = B.editVexSpec(B.suggestVexBuilds(1, ['full'])[0].spec, [{kind:'addMech', mech:'lift'}]).spec;
      const g = M.buildVexModel(THREE, spec); const n = {};
      g.traverse((o) => { if (o.name) n[o.name] = (n[o.name] || 0) + 1; });
      const plain = M.buildVexModel(THREE, B.suggestVexBuilds(3, [])[1].spec); const p = {};
      plain.traverse((o) => { if (o.name) p[o.name] = (p[o.name] || 0) + 1; });
      return { n, p };
    })()""")
    assert out["n"]["licence-plate"] == 2 and out["n"]["air-tank"] == 2 and out["n"]["mech-motor"] == 2
    assert out["p"]["licence-plate"] == 2 and "air-tank" not in out["p"] and "mech-motor" not in out["p"]
