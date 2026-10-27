"""Starter kinds: defaults are the real reference robots' numbers,
overrides convert units and respect guardrails, impossible combos
are refused by the real validator, and catalogue-only kinds stay
profiles — never dressed up as gateable specs."""
import json

import pytest

from robotforge.cli import main
from robotforge.kinds import KINDS, KindError, resolve_kind


def test_seven_kinds_with_honest_gate_badges():
    assert set(KINDS) == {"differential", "skid-steer", "mecanum",
                          "tracked", "ackermann", "quadcopter", "arm"}
    packs = {k: v["gate_pack"] for k, v in KINDS.items()}
    assert packs["differential"] == "live"
    assert packs["skid-steer"] == "live"
    assert packs["mecanum"] == "partial"
    assert packs["tracked"] == "partial"
    assert packs["ackermann"] == "partial"
    assert packs["quadcopter"] == "catalogue-only"
    assert packs["arm"] == "catalogue-only"


def test_differential_defaults_are_the_burger():
    r = resolve_kind("differential")
    assert r["type"] == "spec"
    s = r["spec"]
    assert s["drivetrain"] == "differential"
    assert s["wheel"]["diameter_m"] == 0.066
    assert s["wheel"]["count"] == 2
    assert s["length_m"] == 0.178 and s["width_m"] == 0.138
    assert s["height_m"] == 0.192  # decks=2 through the deck model
    assert s["battery"]["voltage_v"] == 11.1
    assert r["warnings"] == []


def test_skid_defaults_are_pathfinder():
    s = resolve_kind("skid-steer")["spec"]
    assert s["wheel"]["diameter_m"] == 0.1 and s["wheel"]["count"] == 4
    assert s["length_m"] == 0.42 and s["mass_kg"] == 3.4
    assert s["battery"]["voltage_v"] == 14.8


def test_overrides_convert_mm_and_cells():
    s = resolve_kind("differential",
                     {"wheel_diameter_mm": 100,
                      "battery_cells": 4})["spec"]
    assert s["wheel"]["diameter_m"] == 0.1
    assert s["battery"]["voltage_v"] == 14.8


def test_size_preset_then_override_wins():
    s = resolve_kind("differential", size="L")["spec"]
    assert s["length_m"] == 0.3 and s["height_m"] == 0.263
    s = resolve_kind("differential", {"body_length_mm": 200},
                     size="L")["spec"]
    assert s["length_m"] == 0.2  # explicit --set beats the preset


def test_guardrails_and_unknowns_refuse():
    with pytest.raises(KindError, match="guardrails"):
        resolve_kind("differential", {"wheel_diameter_mm": 500})
    with pytest.raises(KindError, match="no parameter"):
        resolve_kind("differential", {"flux_capacitor": 1})
    with pytest.raises(KindError, match="unknown kind"):
        resolve_kind("hexapod")


def test_impossible_combo_is_refused_by_the_validator():
    # 55 mm of clearance under a 40 mm wheel: the validator's own
    # geometry error, surfaced — not a silently broken starter spec
    with pytest.raises(KindError, match="ground clearance"):
        resolve_kind("differential",
                     {"wheel_diameter_mm": 40,
                      "ground_clearance_mm": 55})


def test_payload_adds_to_mass():
    s = resolve_kind("skid-steer", {"payload_kg": 1.5})["spec"]
    assert s["mass_kg"] == 4.9


def test_mecanum_and_ackermann_extras_are_not_spec_fields():
    r = resolve_kind("mecanum", {"roller_config": "O"})
    assert r["spec"]["drivetrain"] == "mecanum"
    assert r["extras"] == {"roller_config": "O"}
    assert "roller_config" not in r["spec"]
    r = resolve_kind("ackermann", {"max_steer_deg": 35})
    assert r["spec"]["motor"]["count"] == 1
    assert r["extras"]["max_steer_deg"] == 35.0


def test_catalogue_only_kinds_resolve_to_profiles():
    r = resolve_kind("quadcopter", {"prop_in": 6})
    assert r["type"] == "profile" and "spec" not in r
    assert r["gate_pack"] == "catalogue-only"
    assert r["params"]["prop_in"] == 6.0
    assert any("ESC" in h for h in r["bom_hints"])
    r = resolve_kind("arm", {"dof": 5, "gripper": "no"})
    assert r["type"] == "profile"
    assert r["params"]["dof"] == 5 and r["params"]["gripper"] == "no"


def test_cli_list_and_new(capsys, tmp_path):
    assert main(["new", "--list"]) == 0
    out = capsys.readouterr().out
    assert "differential" in out and "catalogue-only" in out
    path = tmp_path / "spec.json"
    assert main(["new", "differential", "--set",
                 "wheel_diameter_mm=120", "--out", str(path)]) == 0
    spec = json.loads(path.read_text())
    assert spec["wheel"]["diameter_m"] == 0.12
    out = capsys.readouterr().out
    assert "gate pack: live" in out


def test_cli_catalogue_only_summary_is_plain(capsys, tmp_path):
    path = tmp_path / "quad.json"
    assert main(["new", "quadcopter", "--out", str(path)]) == 0
    out = capsys.readouterr().out
    assert "CATALOGUE ONLY" in out
    doc = json.loads(path.read_text())
    assert doc["gate_pack"] == "catalogue-only"
    assert "drivetrain" not in doc
