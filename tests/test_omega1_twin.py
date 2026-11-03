"""Omega1 digital twin (built-in Garage specimen): the twin subjects
and their media exist, the estimate labelling is in place, and no
claim the records don't support (autonomy, lidar, a fitted assembly,
the unnamed driver board) sneaks in. Media truth is checked against
the actual GLB files, not the prose."""
import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = (ROOT / "web-next/src/lib/omega1Twin.ts").read_text()
SECTION = (ROOT / "web-next/src/components/garage/Omega1Twin.tsx").read_text()
VIEWER = (ROOT / "web-next/src/components/garage/TwinView.tsx").read_text()
GARAGE = (ROOT / "web-next/src/components/garage/Garage.tsx").read_text()
MEDIA = ROOT / "assets/omega1-twin"

SUBJECT_IDS = [
    "omega1-rover", "hc-sr04", "raspberry-pi", "pi-camera",
    "gearmotor-wheel", "battery-cells", "chassis-plate",
]


def glb_json(path: Path) -> dict:
    data = path.read_bytes()
    assert data[:4] == b"glTF", f"{path.name} is not a GLB"
    jlen = struct.unpack("<I", data[12:16])[0]
    return json.loads(data[20:20 + jlen])


def test_all_seven_subjects_present_rover_first():
    ids = re.findall(r"id: '([a-z0-9-]+)',", LIB)
    assert ids == SUBJECT_IDS
    assert "twinSubjects: TwinSubject[] = [omega1Rover, ...omega1Parts]" in LIB


def test_media_references_resolve_to_real_files():
    names = re.findall(r"\$\{MEDIA\}/([a-z0-9-]+\.(?:glb|jpg))", LIB)
    assert len(names) == 14  # 7 models + 7 previews
    for name in names:
        f = MEDIA / name
        assert f.exists(), f"missing twin media: {name}"
        assert f.stat().st_size > 10_000


def test_glbs_carry_textures_and_rover_link_nodes():
    for slug in SUBJECT_IDS:
        g = glb_json(MEDIA / f"{slug}.glb")
        assert len(g.get("images", [])) >= 1, f"{slug}: texture lost in conversion"
        prims = [p for m in g["meshes"] for p in m["primitives"]]
        assert any("TEXCOORD_0" in p["attributes"] for p in prims), f"{slug}: no UVs"
    rover = glb_json(MEDIA / "omega1-rover.glb")
    node_names = [n.get("name", "") for n in rover["nodes"]]
    for link in ["chassis", "sensor_head", "wheel_front_left", "wheel_front_right",
                 "wheel_rear_left", "wheel_rear_right"]:
        assert any(n == link or n.startswith(link + "__") for n in node_names), \
            f"rover GLB lost its {link} link group (explode needs it)"
    assert "ROVER_LINKS" in LIB and "'sensor_head'" in LIB


def test_estimate_labels_are_in_the_ui():
    assert "ESTIMATED geometry" in LIB
    assert "not measurements" in LIB
    assert "Physics — ProjectSim estimates, not measurements" in SECTION
    assert "estimates, not measurements" in VIEWER
    # the missing-model fallback must call the preview a flat render
    assert "flat preview render" in VIEWER


def test_parts_are_a_gallery_never_a_fitted_assembly():
    assert "separate reconstructions" in LIB.lower()
    assert "not pieces of one fitted assembly" in SECTION
    # explode is wired only for the rover subject
    assert "explode={isRover}" in SECTION
    assert "link !== 'chassis'" in VIEWER or "link !== \"chassis\"" in VIEWER


def test_no_unsupported_claims_about_omega1():
    for text in (LIB, SECTION, VIEWER):
        low = text.lower()
        assert "autonomous" not in low
        assert "lidar" not in low
        assert "slam" not in low
    assert "Manual remote control — Omega1 does not drive itself" in LIB
    assert "Freenove FNK0043" in LIB


def test_unnamed_driver_board_was_not_generated():
    assert "motor-driver" in LIB  # the skip is stated, with its reason
    assert not any("driver" in s for s in SUBJECT_IDS)
    assert "skipped rather than guessed" in LIB


def test_garage_wires_the_builtin_specimen():
    assert "import Omega1Twin from './Omega1Twin'" in GARAGE
    assert "Built-in specimen" in GARAGE
    assert "{twinOpen && <Omega1Twin tab={omegaTab} />}" in GARAGE
    # the twin view replaces the workshop; it never renders alongside it
    assert "{!twinOpen && !adding && robot && draft" in GARAGE
