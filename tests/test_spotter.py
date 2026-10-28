"""Spotter: catalog match, parts guesses, dossier provenance — offline.

No network, no connector: the lookup stage runs through lookup_robot
with an injected fake GitHub fetch (fixtures shaped like the real API,
mirroring test_lookup.py), the catalog is the repo's real Robodex and
parts catalog, and the photo draft fixture is modelled on a real live
vision draft recorded 2026-10-28 (an Andino catalog photo the model
described without identifying — the honest failure this pipeline is
built to carry, not hide).
"""
import json
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.catalog import Robodex
from robotforge.lookup import lookup_robot
from robotforge.photo import PhotoDraft, VisiblePart
from robotforge.schema import RobotSpec
from robotforge.spotter import (CATALOG, PHOTO_ESTIMATED, PROVENANCES,
                                UNKNOWN, WEB_SOURCED, build_dossier,
                                format_card, guess_parts,
                                load_catalog_spec, match_catalog,
                                spot_robot)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

def _photo_spec_dict():
    """The live vision draft of the Andino catalog photo (2026-10-28):
    the model saw the robot but did not know its name."""
    return {
        "name": "Blue Mini Lidar Bot",
        "description": "Photo draft (all dimensions ESTIMATED): Small "
                       "blue differential-drive robot with top-mounted "
                       "2D lidar.",
        "drivetrain": "differential",
        "length_m": 0.23, "width_m": 0.14, "height_m": 0.13,
        "mass_kg": 0.9,
        "motor": {"kind": "dc_gear", "voltage_v": 6.0, "count": 2,
                  "stall_torque_nm": 0.4},
        "battery": {"chemistry": "Li-ion", "voltage_v": 7.4,
                    "capacity_mah": 2000},
        "sensors": [{"kind": "lidar_2d", "position": "front top",
                     "range_m": 12},
                    {"kind": "ultrasonic", "position": "front",
                     "range_m": 4}],
        "ground_clearance_m": 0.02,
        "wheel": {"diameter_m": 0.065, "width_m": 0.026, "count": 2,
                  "driven": True},
    }


def _photo_draft():
    return PhotoDraft(
        spec=RobotSpec.from_dict(_photo_spec_dict()),
        identity_guess="unknown custom robot",
        visible_parts=[VisiblePart("wheel", 2), VisiblePart("lidar", 1),
                       VisiblePart("chassis", 1)])


def _repo_item(full_name, stars, license_spdx, description=""):
    lic = None
    if license_spdx:
        lic = {"key": license_spdx.lower(), "name": license_spdx,
               "spdx_id": license_spdx}
    owner = full_name.split("/")[0]
    return {"full_name": full_name,
            "html_url": f"https://github.com/{full_name}",
            "owner": {"login": owner}, "description": description,
            "stargazers_count": stars, "license": lic,
            "default_branch": "main"}


def _fake_fetch(url):
    """Dispatch fake GitHub responses by URL shape."""
    if "search/repositories" in url:
        q = urllib.parse.parse_qs(
            urllib.parse.urlparse(url).query)["q"][0]
        if "andino" in q:
            return {"total_count": 2, "items": [
                _repo_item("Ekumen-OS/andino", 339, None,
                           "Andino: differential drive ROS 2 robot"),
                _repo_item("someuser/andino-clone", 3, "MIT",
                           "my andino build log"),
            ]}
        return {"total_count": 0, "items": []}
    if "Ekumen-OS/andino" in url:
        return {"truncated": False, "tree": [
            {"path": "andino_description/urdf/andino.urdf.xacro",
             "type": "blob", "size": 4200, "sha": "b" * 40},
            {"path": "andino_description/meshes/wheel.stl",
             "type": "blob", "size": 900, "sha": "c" * 40},
            {"path": "README.md", "type": "blob", "size": 100,
             "sha": "d" * 40},
        ]}
    return {"truncated": False, "tree": []}


def _andino_report():
    return lookup_robot("Andino", fetch_json=_fake_fetch)


def _catalog_spec(name):
    entry = next(r for r in Robodex.load().robots if r.name == name)
    return load_catalog_spec(entry)


# ---------------------------------------------------------------------------
# catalog match
# ---------------------------------------------------------------------------

def test_match_same_robot_against_its_own_spec():
    m = match_catalog("Andino", _catalog_spec("Andino"))
    assert m.verdict == "SAME"
    assert m.entry.name == "Andino"
    assert any("exact match" in e for e in m.evidence)
    assert any("drivetrain agrees" in e for e in m.evidence)


def test_match_variant_of_family():
    m = match_catalog("Andino X1")
    assert m.verdict == "VARIANT"
    assert m.entry.name == "Andino"
    assert any("family" in e for e in m.evidence)


def test_match_variant_when_spec_contradicts_name():
    # The name says TurtleBot3, the body is Andino-sized: the name
    # match must NOT be called SAME.
    m = match_catalog("TurtleBot 3 Waffle Pi", _catalog_spec("Andino"))
    assert m.verdict == "VARIANT"
    assert any("CONTRADICTS" in e for e in m.evidence)


def test_match_new_robot():
    m = match_catalog("Somebot 9000")
    assert m.verdict == "NEW"
    assert m.entry is None


# ---------------------------------------------------------------------------
# parts guesses
# ---------------------------------------------------------------------------

def test_guess_parts_catalog_spec():
    guesses = {g.label.split(" (")[0]: g
               for g in guess_parts(_catalog_spec("Andino"))}
    assert guesses["battery"].catalog_id == "liion_18650_3s"
    assert guesses["battery"].provenance == CATALOG
    lidar = next(g for g in guess_parts(_catalog_spec("Andino"))
                 if "lidar_2d" in g.label)
    assert lidar.catalog_id == "rplidar_a1"
    # encoders have no catalog part: the guess must stay free text
    enc = next(g for g in guess_parts(_catalog_spec("Andino"))
               if "encoder" in g.label)
    assert enc.catalog_id is None
    assert enc.provenance == PHOTO_ESTIMATED
    assert enc.free_text


def test_guess_parts_photo_spec_normalizes_chemistry():
    # The vision model writes "Li-ion"; the catalog writes "liion".
    guesses = guess_parts(RobotSpec.from_dict(_photo_spec_dict()))
    battery = next(g for g in guesses if g.label.startswith("battery"))
    assert battery.catalog_id == "liion_18650_3s"
    wheel = next(g for g in guesses if g.label.startswith("wheel"))
    assert wheel.catalog_id == "wheel_100mm"


# ---------------------------------------------------------------------------
# dossier assembly + provenance
# ---------------------------------------------------------------------------

def _walk_prov_fields(node):
    if isinstance(node, dict):
        if "provenance" in node and "value" in node:
            yield node
        for v in node.values():
            yield from _walk_prov_fields(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk_prov_fields(v)


def test_dossier_full_assembly():
    dossier = build_dossier(
        identity_guess="Andino", photo_draft=_photo_draft(),
        lookup_report=_andino_report())
    d = dossier.to_dict()
    assert d["schema"] == "robotforge-spotter/1"
    # Catalog corroborates the operator identity even though the photo
    # model itself failed to name the robot.
    assert d["catalog_match"]["verdict"] == "SAME"
    assert d["identity"]["provenance"] == UNKNOWN
    assert "unknown custom robot" in d["identity"]["source"]
    assert d["photo"]["identity_guess"] == "unknown custom robot"
    # Credit goes to the makers, from the catalog's provenance record.
    assert d["credit"]["provenance"] == CATALOG
    assert "Ekumen" in d["credit"]["value"]
    # Every provenance-tagged field uses a known tag.
    for f in _walk_prov_fields(d):
        assert f["provenance"] in PROVENANCES
    # Draft fields are photo estimates; catalog values are cross-checks
    # only and the mass disagreement is shown, not merged away.
    mass = next(r for r in d["fields"] if r["field"] == "mass_kg")
    assert mass["draft"]["provenance"] == PHOTO_ESTIMATED
    assert mass["draft"]["value"] == 0.9
    assert mass["catalog"]["provenance"] == CATALOG
    assert mass["agreement"] == "differs"
    assert d["draft_spec"]["mass_kg"] == 0.9  # draft NOT overwritten
    # Parts: several catalog ids, all labelled as guesses with basis.
    ids = {p["catalog_id"] for p in d["parts"] if p["catalog_id"]}
    assert {"liion_18650_3s", "rplidar_a1"} <= ids
    # Sources: web-sourced, license honesty (Ekumen repo states none
    # in the fixture, so the dossier must say "not stated").
    assert d["sources"]
    assert all(s["provenance"] == WEB_SOURCED for s in d["sources"])
    ekumen = next(s for s in d["sources"]
                  if s["name"] == "Ekumen-OS/andino")
    assert ekumen["license"] == "not stated"
    assert ekumen["url"] == "https://github.com/Ekumen-OS/andino"
    # Validation ran on the estimated draft and reported a verdict.
    assert d["validation"]["verdict"] in ("PASS", "FAIL")
    assert d["validation"]["findings"]


def test_dossier_broken_spec_records_fail():
    data = _photo_spec_dict()
    data["ground_clearance_m"] = 0.5     # impossible: wheel radius 0.0325
    dossier = build_dossier(
        identity_guess="Mystery Bot",
        draft_spec=RobotSpec.from_dict(data))
    d = dossier.to_dict()
    assert d["validation"]["verdict"] == "FAIL"
    checks = {f["check"] for f in d["validation"]["findings"]}
    assert "geometry.clearance_vs_wheel" in checks
    assert d["catalog_match"]["verdict"] == "NEW"


def test_dossier_without_stages_is_explicit():
    dossier = build_dossier(identity_guess="Andino")
    d = dossier.to_dict()
    assert d["draft_spec"] is None
    assert d["validation"]["verdict"] == "NOT RUN"
    assert d["parts"] == []
    assert d["sources"] == []


def test_format_card_names_verdict_credit_and_tags():
    dossier = build_dossier(
        identity_guess="Andino", photo_draft=_photo_draft(),
        lookup_report=_andino_report())
    card = format_card(dossier)
    assert "SAME" in card
    assert "Ekumen" in card
    assert "PHOTO-ESTIMATED" in card
    assert "liion_18650_3s" in card
    assert "not measurements" in card  # the honesty note survives


# ---------------------------------------------------------------------------
# orchestration (offline, injected fetch)
# ---------------------------------------------------------------------------

def test_spot_robot_identity_only_offline():
    dossier = spot_robot(identity="Andino", fetch_json=_fake_fetch)
    d = dossier.to_dict()
    stages = {s["stage"]: s["status"] for s in d["stages"]}
    assert stages["photo"] == "skipped"
    assert stages["lookup"] == "ok"
    assert d["catalog_match"]["verdict"] == "SAME"
    assert d["identity"]["provenance"] == UNKNOWN


def test_spot_robot_lookup_failure_degrades_openly():
    def boom(url):
        from robotforge.lookup import LookupError
        raise LookupError("GitHub API rate limit exceeded")
    dossier = spot_robot(identity="Andino", fetch_json=boom)
    d = dossier.to_dict()
    stages = {s["stage"]: s["status"] for s in d["stages"]}
    assert stages["lookup"] == "failed"
    assert d["sources"] == []
    assert d["catalog_match"]["verdict"] == "SAME"  # local stage ok
