"""Robodex grouping: signatures, family/variant filing, proposals.

Offline and pure: dossiers are the shipped example dossiers
(examples/spotter/*/dossier.json) plus synthetic clones of the real
Spot dossier — the same shape Spotter writes, edited the way a new
spotting of a different configuration would differ.
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.robodex import (ATTACH_VARIANT, FAMILIES_SCHEMA,
                                NEW_FAMILY, NEW_VARIANT, PROPOSE_FAMILY,
                                ConfigSignature, apply_decision,
                                build_example_families, classify_spotting,
                                families_from_dict, families_to_dict,
                                sighting_from_dossier,
                                signature_from_dossier, variant_label)

REPO = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------

def _load_dossier(name):
    return json.loads(
        (REPO / "examples" / "spotter" / name / "dossier.json").read_text())


def _spot():
    return _load_dossier("spot-cpp")


def _andino():
    return _load_dossier("andino")


def _spot_no_arm():
    """The real Spot dossier, edited to a spotting WITHOUT the arm:
    no arm visible part, and no sensor seated at the arm/gripper."""
    d = copy.deepcopy(_spot())
    d["photo"]["visible_parts"] = [
        p for p in d["photo"]["visible_parts"]
        if "arm" not in p["kind"].lower()
        and "manipulator" not in p["kind"].lower()]
    for s in d["draft_spec"]["sensors"]:
        if "arm" in s["position"] or "gripper" in s["position"]:
            s["position"] = "front"
    return d


def _spot_arm_hokuyo():
    """The real Spot dossier plus a Hokuyo URG top lidar: a visible
    lidar part on top and the matching draft sensor."""
    d = copy.deepcopy(_spot())
    d["photo"]["visible_parts"].append({
        "kind": "Hokuyo URG lidar", "count": 1, "position": "top",
        "notes": "Hokuyo URG 2D lidar mounted on top of the body",
        "provenance": "PHOTO-ESTIMATED"})
    d["draft_spec"]["sensors"].append(
        {"kind": "lidar_2d", "position": "top", "range_m": 10})
    return d


def _file(dossier, families, **sighting_ctx):
    """Classify + apply one dossier; return the decision."""
    decision = classify_spotting(dossier, families)
    sighting = sighting_from_dossier(dossier, **sighting_ctx)
    apply_decision(families, decision, sighting)
    return decision


def _spot_family():
    families = []
    _file(_spot(), families)
    assert len(families) == 1
    return families


# ---------------------------------------------------------------------------
# signature extraction on the real dossiers
# ---------------------------------------------------------------------------

def test_signature_andino_real_dossier():
    sig = signature_from_dossier(_andino())
    assert sig.manipulator == "absent"          # inventory, no arm
    assert sig.top_lidar == "rplidar_a1"        # parts guess resolved it
    assert sig.drivetrain == "differential"
    # JSON round-trip is exact
    assert ConfigSignature.from_dict(
        json.loads(json.dumps(sig.to_dict()))) == sig


def test_signature_spot_cpp_real_dossier():
    sig = signature_from_dossier(_spot())
    assert sig.manipulator == "present"         # robot arm visible part
    assert sig.top_lidar == "none"              # inventoried, no lidar
    assert sig.drivetrain == "skid_steer"       # wheeled-schema coercion


def test_signature_no_inventory_is_unknown_not_none():
    bare = {"identity": {"value": "Mystery Bot"}}
    sig = signature_from_dossier(bare)
    assert sig.manipulator == "unknown"
    assert sig.top_lidar == "unknown"
    assert sig.drivetrain == ""
    # "unknown" is a value, never a wildcard: it does not equal "none"
    assert sig != ConfigSignature(manipulator="unknown", top_lidar="none")


# ---------------------------------------------------------------------------
# Abel's four Spot cases
# ---------------------------------------------------------------------------

def test_four_spot_cases_one_family_three_variants():
    families = []

    # (a) Spot + arm -> a new family, variant V1
    decision = _file(_spot(), families, sighting_id="spot-arm-1")
    assert decision.outcome == NEW_FAMILY
    assert len(families) == 1
    family = families[0]
    assert family.name == "Boston Dynamics Spot"
    assert len(family.variants) == 1
    arm_variant = family.variants[0]
    assert arm_variant.signature.manipulator == "present"

    # the same configuration filed again ATTACHES (no new variant)
    decision = classify_spotting(_spot(), families)
    assert decision.outcome == ATTACH_VARIANT
    apply_decision(families, decision,
                   sighting_from_dossier(_spot(),
                                         sighting_id="spot-arm-2"))
    assert len(family.variants) == 1

    # (b) Spot with NO arm -> SAME family, DIFFERENT variant
    decision = _file(_spot_no_arm(), families, sighting_id="spot-base-1")
    assert decision.outcome == NEW_VARIANT
    assert len(families) == 1
    assert len(family.variants) == 2
    base_variant = family.variants[1]
    assert base_variant.signature != arm_variant.signature
    assert base_variant.signature.manipulator == "absent"

    # (c) Spot + arm + Hokuyo URG top lidar -> SAME family, a third
    # variant, and the signature names the lidar
    decision = _file(_spot_arm_hokuyo(), families,
                     sighting_id="spot-hokuyo-1")
    assert decision.outcome == NEW_VARIANT
    assert len(families) == 1
    assert len(family.variants) == 3
    lidar_variant = family.variants[2]
    assert lidar_variant.signature.top_lidar == "hokuyo_urg"
    assert lidar_variant.signature.manipulator == "present"

    # (d) one Spot family, 3 variants, sightings preserved — the arm
    # variant was filed twice and keeps BOTH sightings
    assert len(families) == 1
    assert len(family.variants) == 3
    assert len(arm_variant.sightings) == 2
    assert len(base_variant.sightings) == 1
    assert len(lidar_variant.sightings) == 1
    assert len({v.signature for v in family.variants}) == 3

    # deterministic labels
    assert arm_variant.label == "Boston Dynamics Spot with Arm"
    assert base_variant.label == \
        "Boston Dynamics Spot (base configuration)"
    assert lidar_variant.label == \
        "Boston Dynamics Spot with Arm + top lidar (hokuyo_urg)"


def test_variant_label_single_baseline_family_uses_family_name():
    baseline = ConfigSignature(manipulator="absent", top_lidar="none",
                               drivetrain="skid_steer")
    assert variant_label("Unitree Go2", baseline, variant_count=1) == \
        "Unitree Go2"
    assert variant_label("Unitree Go2", baseline, variant_count=2) == \
        "Unitree Go2 (base configuration)"


# ---------------------------------------------------------------------------
# new families and near-misses
# ---------------------------------------------------------------------------

def _unitree_go2():
    return {
        "schema": "robotforge-spotter/1",
        "identity": {"value": "Unitree Go2", "provenance": "UNKNOWN",
                     "source": "operator-provided identity"},
        "credit": {"value": "Designer not identified by any stage.",
                   "provenance": "UNKNOWN", "source": ""},
        "catalog_match": {"verdict": "NEW", "robot": None,
                          "dex_id": None, "score": 0, "evidence": []},
        "photo": {"path": "examples/spotter/go2/spotted-photo.jpg",
                  "sha256": "f" * 64,
                  "visible_parts": [
                      {"kind": "quadruped leg", "count": 4,
                       "position": "body corners", "notes": "",
                       "provenance": "PHOTO-ESTIMATED"},
                      {"kind": "robot body", "count": 1,
                       "position": "center", "notes": "",
                       "provenance": "PHOTO-ESTIMATED"}]},
        "draft_spec": {"name": "Unitree Go2", "drivetrain": "skid_steer",
                       "length_m": 0.7, "width_m": 0.31,
                       "sensors": []},
        "parts": [],
    }


def test_unknown_robot_is_new_family():
    families = build_example_families()
    decision = classify_spotting(_unitree_go2(), families)
    assert decision.outcome == NEW_FAMILY
    assert decision.family is None


def test_spotmicro_near_miss_does_not_merge_into_spot():
    families = _spot_family()
    d = copy.deepcopy(_spot())
    d["identity"]["value"] = "SpotMicro"     # a DIY quadruped namesake
    d["draft_spec"]["name"] = "SpotMicro"
    decision = classify_spotting(d, families)
    assert decision.outcome == NEW_FAMILY
    assert decision.family is None


# ---------------------------------------------------------------------------
# proposals: contradicted name matches and same-brand relations
# ---------------------------------------------------------------------------

def test_name_exact_but_contradicted_is_proposal_and_applies_nothing():
    families = _spot_family()
    before = families_to_dict(families)
    toy = copy.deepcopy(_spot())
    toy["draft_spec"]["drivetrain"] = "differential"   # Spot record: skid_steer
    toy["draft_spec"]["length_m"] = 0.3                # 3.7x off the record
    toy["draft_spec"]["width_m"] = 0.2
    decision = classify_spotting(toy, families)
    assert decision.outcome == PROPOSE_FAMILY
    assert decision.family is families[0]
    assert any("CONTRADICTS" in e for e in decision.evidence)
    assert decision.confirm                       # what a human must check
    apply_decision(families, decision,
                   sighting_from_dossier(toy, sighting_id="toy-1"))
    assert families_to_dict(families) == before   # mutated NOTHING


def test_same_brand_only_is_proposal():
    families = _spot_family()
    d = copy.deepcopy(_spot())
    d["identity"]["value"] = "Boston Dynamics Atlas"  # brand shared only
    decision = classify_spotting(d, families)
    assert decision.outcome == PROPOSE_FAMILY
    assert decision.confirm
    before = families_to_dict(families)
    apply_decision(families, decision,
                   sighting_from_dossier(d, sighting_id="atlas-1"))
    assert families_to_dict(families) == before


# ---------------------------------------------------------------------------
# serialization + example migration
# ---------------------------------------------------------------------------

def test_example_families_outcomes_and_shape():
    # the two real examples, classified sequentially from an empty dex
    families = []
    assert _file(_andino(), families).outcome == NEW_FAMILY
    assert _file(_spot(), families).outcome == NEW_FAMILY
    assert [f.name for f in families] == ["Andino", "Boston Dynamics Spot"]

    families = build_example_families()
    andino = next(f for f in families if f.name == "Andino")
    spot = next(f for f in families if f.name == "Boston Dynamics Spot")
    assert andino.catalog_dex_id == "#001"     # dossier catalog_match SAME
    assert spot.catalog_dex_id is None         # dossier catalog_match NEW
    for fam in (andino, spot):
        assert len(fam.variants) == 1
        assert len(fam.variants[0].sightings) == 1
    assert spot.variants[0].label == "Boston Dynamics Spot with Arm"
    sighting = spot.variants[0].sightings[0]
    assert sighting.spotted_at == "2026-10-28"          # field-notes.md
    assert sighting.where == "Cal Poly Pomona IRLab"    # field-notes.md
    assert sighting.sha256 == _spot()["photo"]["sha256"]
    assert sighting.photo == _spot()["photo"]["path"]


def test_families_round_trip_preserves_structure():
    families = build_example_families()
    data = families_to_dict(families)
    assert data["schema"] == FAMILIES_SCHEMA
    restored = families_from_dict(json.loads(json.dumps(data)))
    assert families_to_dict(restored) == data
    # signatures survive as ConfigSignature values, payloads as tuples
    sig = restored[0].variants[0].signature
    assert isinstance(sig, ConfigSignature)
    assert isinstance(sig.payloads, tuple)
