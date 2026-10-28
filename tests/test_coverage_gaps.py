"""Targeted coverage for previously untested pure logic and error
paths (hardening sweep): repair proposal edge cases + narration
fallbacks, validate's warning branches, listimport's full text
rendering, and kinds' override validation."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge.kinds import KindError, resolve_kind
from robotforge.listimport import render_text
from robotforge.repair import (Correction, RepairProposal, apply_repairs,
                               narrate, propose_repairs, render_proposal_md)
from robotforge.schema import RobotSpec
from robotforge.validate import validate

EXAMPLE = Path(__file__).parent.parent / "examples" / "turtlebot3-burger.json"


def _spec():
    return RobotSpec.from_json(EXAMPLE.read_text())


def _checks(findings):
    return {f.check: f for f in findings}


# ------------------------------------------------------------- repair
def test_proposal_and_correction_to_dict_round_trip():
    c = Correction(field="wheel.diameter_m", old=0.066, new=0.0594,
                   unit="m", kind="correction", basis="measured")
    p = RepairProposal(spec_name="burger", verdict_before="FAIL",
                       corrections=[c], notes=["n1"])
    d = p.to_dict()
    assert d["spec"] == "burger"
    assert d["corrections"][0]["field"] == "wheel.diameter_m"
    assert d["corrections"][0]["new"] == 0.0594
    assert d["notes"] == ["n1"]
    assert p.actionable is True
    assert RepairProposal("x", "PASS").actionable is False


def test_wheel_suspect_without_measurements_becomes_a_note():
    report = {"verdict": "FAIL",
              "suspects": [{"field": "wheel.diameter_m"}],
              "measurements": {"drive": {"truth_m": 0, "measured_m": 0},
                               "turn": {}}}
    p = propose_repairs(_spec(), report)
    assert not p.corrections
    assert any("lacks the measurements" in n for n in p.notes)


def test_separation_repair_refused_when_it_would_shrink_chassis():
    spec = _spec()
    # believed heading tiny vs truth -> effective separation ~0 ->
    # new width below the 50 mm floor must be refused, not proposed.
    report = {"verdict": "FAIL",
              "suspects": [{"field": "wheel.separation_m"}],
              "measurements": {"drive": {},
                               "turn": {"truth_deg": 90.0,
                                        "measured_deg": 1.5}}}
    p = propose_repairs(spec, report)
    assert not p.corrections
    assert any("below 50 mm" in n for n in p.notes)


def test_separation_suspect_with_tiny_turn_becomes_a_note():
    report = {"verdict": "FAIL",
              "suspects": [{"field": "wheel.separation_m"}],
              "measurements": {"drive": {},
                               "turn": {"truth_deg": 0.5,
                                        "measured_deg": 0.4}}}
    p = propose_repairs(_spec(), report)
    assert not p.corrections
    assert any("too small to calibrate" in n for n in p.notes)


def test_apply_repairs_applies_diameter_and_width():
    spec = _spec()
    p = RepairProposal(spec_name=spec.name, verdict_before="FAIL",
                       corrections=[
                           Correction("wheel.diameter_m", spec.wheel.diameter_m,
                                      0.0594, "m", "correction", "b"),
                           Correction("width_m (wheel separation)",
                                      spec.width_m, 0.150, "m",
                                      "calibration", "b")])
    fixed = apply_repairs(spec, p)
    assert fixed.wheel.diameter_m == 0.0594
    assert fixed.width_m == 0.150
    # the original spec is untouched
    assert spec.wheel.diameter_m != 0.0594 or spec.width_m != 0.150


def test_render_proposal_md_includes_narration_corrections_notes():
    p = RepairProposal(
        spec_name="burger", verdict_before="FAIL",
        corrections=[Correction("wheel.diameter_m", 0.066, 0.0594, "m",
                                "correction", "scale 0.9000")],
        notes=["a note"], narration="Plain words.")
    md = render_proposal_md(p)
    assert md.startswith("# Repair proposal — burger")
    assert "Plain words." in md
    assert "**wheel.diameter_m**: 0.066 → 0.0594 m (correction)" in md
    assert "- note: a note" in md
    assert "a proposal is not a verdict" in md


def test_narrate_template_fallback_without_helper(monkeypatch):
    monkeypatch.setenv("RF_META_API_HELPER", "/nonexistent/helper.py")
    p = RepairProposal(
        spec_name="burger", verdict_before="FAIL",
        corrections=[Correction("wheel.diameter_m", 0.066, 0.0594, "m",
                                "correction", "b")])
    out = narrate(p)
    assert out.narration_transport.startswith("template")
    assert "wheel.diameter_m 0.066 → 0.0594 m" in out.narration


def test_narrate_no_corrections_leaves_narration_empty(monkeypatch):
    monkeypatch.setenv("RF_META_API_HELPER", "/nonexistent/helper.py")
    p = RepairProposal(spec_name="burger", verdict_before="FAIL",
                       notes=["nothing computable"])
    out = narrate(p)
    assert out.narration == ""
    assert out.narration_transport == ""


def _write_helper(tmp_path, body):
    helper = tmp_path / "fake_helper.py"
    helper.write_text(body)
    return str(helper)


def test_narrate_uses_helper_when_available(tmp_path, monkeypatch):
    helper = _write_helper(tmp_path, (
        "import json, sys\n"
        "print(json.dumps({'status': 200, 'payload': {'choices': "
        "[{'message': {'content': '  Helper words.  '}}]}}))\n"))
    monkeypatch.setenv("RF_META_API_HELPER", helper)
    p = RepairProposal(
        spec_name="burger", verdict_before="FAIL",
        corrections=[Correction("wheel.diameter_m", 0.066, 0.0594, "m",
                                "correction", "b")])
    out = narrate(p)
    assert out.narration == "Helper words."
    assert out.narration_transport.startswith("meta-connector")


def test_narrate_falls_back_when_helper_fails(tmp_path, monkeypatch):
    helper = _write_helper(tmp_path, "import sys; sys.exit(3)\n")
    monkeypatch.setenv("RF_META_API_HELPER", helper)
    p = RepairProposal(
        spec_name="burger", verdict_before="FAIL",
        corrections=[Correction("wheel.diameter_m", 0.066, 0.0594, "m",
                                "correction", "b")])
    out = narrate(p)
    assert out.narration_transport.startswith("template")
    assert out.narration != ""


# ----------------------------------------------------------- validate
def _mutated(**changes):
    data = json.loads(EXAMPLE.read_text())
    for key, value in changes.items():
        if "." in key:
            head, tail = key.split(".", 1)
            data[head][tail] = value
        else:
            data[key] = value
    return RobotSpec.from_dict(data)


def test_wheel_larger_than_body_height_warns():
    f = _checks(validate(_mutated(**{"wheel.diameter_m": 0.30,
                                     "height_m": 0.20})))
    assert f["geometry.wheel_vs_height"].severity == "WARN"


def test_wheel_footprint_warning():
    f = _checks(validate(_mutated(**{"wheel.width_m": 0.30,
                                     "wheel.count": 4})))
    assert "geometry.wheel_footprint" in f


def test_differential_wheel_count_warning():
    f = _checks(validate(_mutated(**{"wheel.count": 4})))
    assert f["drivetrain.wheel_count"].severity == "WARN"


def test_single_motor_differential_warning():
    f = _checks(validate(_mutated(**{"motor.count": 1})))
    assert f["drivetrain.motor_count"].severity == "WARN"


def test_no_motors_is_an_error():
    f = _checks(validate(_mutated(**{"motor.count": 0})))
    assert f["drivetrain.motor_count"].severity == "ERROR"


def test_component_mass_far_below_total_warns():
    spec = _mutated(component_mass_kg={"chassis": 0.05})
    f = _checks(validate(spec))
    assert f["mass.budget"].severity == "WARN"


def test_component_mass_above_total_is_an_error():
    spec = _mutated(component_mass_kg={"chassis": 99.0})
    f = _checks(validate(spec))
    assert f["mass.budget"].severity == "ERROR"


def test_nonpositive_sensor_range_is_an_error():
    data = json.loads(EXAMPLE.read_text())
    data["sensors"] = [{"kind": "lidar_2d", "position": "top",
                        "range_m": 0}]
    f = _checks(validate(RobotSpec.from_dict(data)))
    assert f["sensor.range"].severity == "ERROR"


def test_legged_robot_without_legs_is_an_error():
    data = json.loads(EXAMPLE.read_text())
    data["drivetrain"] = "quadruped"
    data.pop("wheel", None)
    spec = RobotSpec.from_dict(data)
    f = _checks(validate(spec))
    assert f["class.legs_missing"].severity == "ERROR"


# --------------------------------------------------------- listimport
def test_render_text_full_report():
    report = {
        "items": [{"title": "Motor x4", "price": 12.5, "slot": "motor",
                   "qty": 4, "specs": {}},
                  {"title": "Frame kit", "price": None, "slot": "frame",
                   "qty": 1, "specs": {}}],
        "assembly": {
            "slots": {"motor": {"status": "filled", "label": "Motors",
                                "have": 4, "need": 4},
                      "esc": {"status": "missing", "label": "ESCs",
                              "have": 0, "need": 4}},
            "missing": [{"label": "ESCs", "required": True,
                         "alternatives": [{"store": "Example",
                                            "url": "https://x.test/esc"}]}],
            "warnings": ["check polarity"],
            "bench": [{"title": "soldering iron"}],
            "unidentified": ["mystery box"],
        },
        "wiring": {"connections": [{"from": "battery", "to": "pdb",
                                    "via": "XT60", "note": "main feed"}],
                   "orientation": ["props out"]},
    }
    text = render_text(report)
    assert "IDENTIFIED PARTS" in text
    assert "$12.50" in text
    assert "[OK ] Motors: have 4, need 4" in text
    assert "[MISS] ESCs: have 0, need 4" in text
    assert "ESCs (required)" in text
    assert "search: Example https://x.test/esc" in text
    assert "battery -> pdb [XT60] — main feed" in text
    assert "WARNING: check polarity" in text
    assert "BENCH (not robot parts): 1 items" in text
    assert "? mystery box" in text


# -------------------------------------------------------------- kinds
def test_kind_choice_override_must_be_valid():
    # find a choice-typed param on a live kind and feed it garbage
    from robotforge.kinds import KINDS
    target = None
    for kind_id, kind in KINDS.items():
        for param in kind["params"]:
            if param["type"] == "choice":
                target = (kind_id, param["key"])
                break
        if target:
            break
    assert target, "expected at least one choice param in KINDS"
    with pytest.raises(KindError):
        resolve_kind(target[0], {target[1]: "definitely-not-a-choice"})


def test_kind_size_preset_missing_is_a_kind_error():
    from robotforge.kinds import KINDS
    no_preset = [k for k, v in KINDS.items() if not v["presets"]]
    assert no_preset, "expected at least one kind without presets"
    with pytest.raises(KindError):
        resolve_kind(no_preset[0], size="S")
