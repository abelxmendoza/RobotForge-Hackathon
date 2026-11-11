"""Wrench one-part 3D edits (Abel, 2026-11-10; backlog item E, after
the Kimi 3D Make article: "keep the rest, change this one part").

web-next/src/lib/partEdit.ts is pure and runs under node here.

Pins:
- a size phrase changes ONLY the planned spec fields of one part, and
  the check proves it (restKept);
- a bare number is never guessed into a unit; two parts in one phrase
  is refused; a part the robot doesn't have is refused;
- overlapping wheels / clashing propellers are named as problems;
- look phrases go to the 3D route with only a fixed part id and the
  owner's words (the Worker builds the prompt; live/worker.js);
- nothing is saved until Apply / Keep, and a look never edits the spec.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "web-next/src/lib/partEdit.ts"
MESH = (ROOT / "web-next/src/lib/partMesh.ts").read_text()
CARD = (ROOT / "web-next/src/components/chat/PartEditCard.tsx").read_text()
CHAT = (ROOT / "web-next/src/components/chat/ChatDock.tsx").read_text()
ROBOT3D = (ROOT / "web-next/src/components/kit/Robot3D.tsx").read_text()
TURNTABLE = (ROOT / "web-next/src/components/garage/OverviewTurntable.tsx").read_text()
WORKER = (ROOT / "live/worker.js").read_text()

ROVER = {
    "name": "Rover", "drivetrain": "skid_steer", "length_m": 0.25, "width_m": 0.15,
    "height_m": 0.12, "mass_kg": 1.0, "ground_clearance_m": 0.02,
    "wheel": {"diameter_m": 0.065, "width_m": 0.027, "count": 4},
    "motor": {"kind": "dc_gearmotor", "voltage_v": 6, "count": 4},
    "battery": {"chemistry": "liion", "voltage_v": 7.4, "capacity_mah": 2000},
}
QUAD = {
    "name": "Quad", "drivetrain": "multirotor", "length_m": 0.16, "width_m": 0.16,
    "height_m": 0.05, "mass_kg": 0.6,
    "rotors": {"count": 4, "prop_diameter_m": 0.127},
    "motor": {"kind": "brushless", "voltage_v": 14.8, "count": 4},
    "battery": {"chemistry": "lipo", "voltage_v": 14.8, "capacity_mah": 1500},
}


def _node():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    r = subprocess.run([node, "--experimental-strip-types", "-e", "0"], capture_output=True)
    if r.returncode:
        pytest.skip("node cannot strip TypeScript types")
    return node


def _ts(expr: str):
    script = (f"import * as P from {json.dumps(str(LIB))};\n"
              "const run = (f) => { try { return { ok: f() }; } catch (e) { return { error: e.message }; } };\n"
              f"const out = ({expr});\n"
              "process.stdout.write(JSON.stringify(out === undefined ? null : out));")
    r = subprocess.run([_node(), "--experimental-strip-types", "--no-warnings",
                        "--input-type=module", "-e", script],
                       capture_output=True, text=True, cwd=ROOT)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _edit(text, spec=ROVER):
    return _ts(f"run(() => {{ const p = P.parsePartEdit({json.dumps(text)}, {json.dumps(spec)});"
               f" if (!p) return null; const a = P.applyPartEdit({json.dumps(spec)}, p);"
               f" return {{ plan: p, after: a, check: P.checkPartEdit({json.dumps(spec)}, a, p) }}; }})")


def test_lib_is_import_free():
    src = LIB.read_text()
    assert "import " not in src.split("*/", 1)[1].split("export", 1)[0]
    assert not [l for l in src.splitlines() if l.startswith("import ")]


def test_bigger_wheels_change_only_the_wheel_diameter():
    out = _edit("make the wheels bigger")["ok"]
    assert out["plan"]["part"] == "wheels"
    assert out["plan"]["viewId"] == "wheel"
    [c] = out["plan"]["changes"]
    assert c["path"] == "wheel.diameter_m"
    assert c["before"] == 0.065 and c["after"] == pytest.approx(0.0813, abs=1e-4)
    assert out["check"]["restKept"] is True
    assert out["check"]["changedPaths"] == ["wheel.diameter_m"]
    assert out["check"]["problems"] == []
    # everything else in the spec is byte-identical
    after = dict(out["after"])
    after["wheel"] = dict(after["wheel"], diameter_m=0.065)
    assert after == ROVER
    assert any("Top speed ×1.25" in e for e in out["check"]["effects"])


@pytest.mark.parametrize("text,path,value", [
    ("make Rover's wheels 80 mm", "wheel.diameter_m", 0.08),
    ("make the wheels 3.5 in", "wheel.diameter_m", 0.0889),
    ("make the wheels 30mm wide", "wheel.width_m", 0.03),
    ("make the body 30 cm long", "length_m", 0.3),
    ("make the body taller", "height_m", 0.15),
    ("raise the ground clearance to 25 mm", "ground_clearance_m", 0.025),
    ("make the wheels twice as big", "wheel.diameter_m", 0.13),
])
def test_size_phrases_map_to_one_field(text, path, value):
    out = _edit(text)["ok"]
    [c] = out["plan"]["changes"]
    assert c["path"] == path
    assert c["after"] == pytest.approx(value, abs=1e-4)
    assert out["check"]["restKept"] is True


@pytest.mark.parametrize("text,value", [
    ("make the wheels 50% smaller", 0.0325),
    ("make the wheels 20% bigger", 0.078),
    ("increase the wheel diameter by 10 mm", 0.075),
    ("make the wheels 10 mm bigger", 0.075),
    ("reduce the wheels by 1 cm", 0.055),
    ("make the wheels smaller", 0.052),
])
def test_relative_changes_start_from_todays_size(text, value):
    # Codex review on #192: explicit % cuts and "by N mm" are changes
    # from the current size, never the new size itself.
    [c] = _edit(text)["ok"]["plan"]["changes"]
    assert c["path"] == "wheel.diameter_m"
    assert c["after"] == pytest.approx(value, abs=1e-4)


def test_full_cut_is_refused_not_halved():
    assert "outside what RobotForge models" in _edit("make the wheels 100% smaller")["error"]


def test_bigger_body_is_its_footprint_only():
    out = _edit("make the body bigger")["ok"]
    assert [c["path"] for c in out["plan"]["changes"]] == ["length_m", "width_m"]
    assert out["check"]["changedPaths"] == ["length_m", "width_m"]


def test_props_on_a_quad():
    out = _edit("make the props 7 inch", QUAD)["ok"]
    [c] = out["plan"]["changes"]
    assert c["path"] == "rotors.prop_diameter_m"
    assert out["plan"]["viewId"] == "rotor"
    assert out["check"]["problems"], "7 in props on 160 mm motor spacing clash"
    assert any("diameter⁴" in e for e in out["check"]["effects"])


def test_refusals_change_nothing():
    assert "unit" in _edit("make the wheels 9")["error"]
    assert "One part at a time" in _edit("make the wheels and the body bigger")["error"]
    assert "no propellers" in _edit("make the props bigger")["error"]
    assert "outside what RobotForge models" in _edit("make the wheels 5 m")["error"]
    # not an edit at all: other grammars get the phrase
    assert _edit("what wheels does it have?")["ok"] is None
    assert _edit("make the wheels look like knobby tyres")["ok"] is None


def test_overlapping_wheels_are_a_problem():
    out = _edit("make the wheels 200 mm")["ok"]
    assert any("overlap" in p for p in out["check"]["problems"])


def test_look_phrases_and_prompt():
    out = _ts("run(() => { const l = P.parseLookEdit('make the wheels look like knobby off-road tyres', ['plate','wheel']);"
              " return { l, prompt: P.lookPrompt(l) }; })")["ok"]
    assert out["l"]["viewId"] == "wheel"
    assert out["l"]["description"] == "knobby off-road tyres"
    assert out["prompt"].startswith("A single robot wheel with its tyre for a small hobby robot: knobby off-road tyres.")
    missing = _ts("run(() => P.parseLookEdit('make the lidar look like a spinning dome', ['plate','wheel']))")
    assert "no lidar" in missing["error"]
    assert _ts("run(() => P.parseLookEdit('make the wheels bigger', ['wheel']))")["ok"] is None
    capped = _ts("run(() => P.parseLookEdit('make the camera look like ' + 'x'.repeat(400), ['camera']))")["ok"]
    assert len(capped["description"]) == 200


def test_pick_robot_by_name_or_open():
    robots = [{"id": "a", "name": "Omega1"}, {"id": "b", "name": "Rover"}]
    pick = lambda t, o=None: _ts(f"P.pickRobot({json.dumps(t)}, {json.dumps(robots)}, {json.dumps(o)})")
    assert pick("make Omega1's wheels bigger", "b")["id"] == "a"
    assert pick("make the wheels bigger", "b")["id"] == "b"
    assert pick("make the wheels bigger") is None


def test_worker_mesh_route_is_gated_capped_and_off_without_key():
    assert "'/part-mesh', '/part-mesh/status', '/part-mesh/file'" in WORKER  # account gate
    assert "env.MESHY_API_KEY" in WORKER
    assert "part_mesh: Boolean(env.MESHY_API_KEY)" in WORKER
    assert "MESH_DAILY_LIMIT" in WORKER and "MESH_PER_IP_DAILY_LIMIT" in WORKER
    start = WORKER.index("async function handlePartMesh(")
    body = WORKER[start:WORKER.index("async function readMeshTask", start)]
    assert body.index("gateBudget(") < body.index("meshyFetch(")
    assert body.index("gateMeshBudget(") < body.index("meshyFetch(")
    assert "meshPrompt(partId, description)" in body
    assert "data.prompt" not in body


def test_client_sends_only_part_and_words():
    assert "postJSON<MeshJob>('/part-mesh', { part: viewId, description })" in MESH
    assert "isDemoMode()" in MESH


def test_nothing_saved_before_apply_or_keep():
    run = CHAT[CHAT.index("const runPartEditCommand"):CHAT.index("const applyPartEditReq")]
    assert "writeStore" not in run and "saveLookFile" not in run
    apply = CHAT[CHAT.index("const applyPartEditReq"):CHAT.index("const keepPartLook")]
    assert "baseVersionId" in apply and "versions: [...r.versions, version]" in apply
    keep = CHAT[CHAT.index("const keepPartLook"):CHAT.index("const runRemoveLook")]
    assert "versions" not in keep, "a look never edits the spec or adds a version"
    assert "partLooks:" in keep
    assert "Apply as a new version" in CARD and "Keep this look" in CARD


def test_generated_look_is_captioned_and_fitted():
    assert "partLooks" in ROBOT3D and "function fitLook" in ROBOT3D
    assert "LOOK_CAPTION" in TURNTABLE and "LOOK_CAPTION" in CARD
    assert "not CAD" in MESH and "does not change the spec" in MESH
