"""Photo intake: vision-payload parsing, SAM stream parsing, CLI --photo.

All offline: the SAM fixtures are a REAL sam-3.1 response captured live on
2026-10-26 (TurtleBot photo, concept "wheel", 3 regions). No test here makes
a network call.
"""
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from robotforge import cli
from robotforge.photo import (DOCUMENT_INSTRUCTIONS, DOCUMENT_PREFIX,
                              PHOTO_PREFIX,
                              DocumentDraft, PhotoDraft, SamRegion,
                              parse_document_payload, parse_photo_payload,
                              parse_sam_text, sam_text_from_stream)
from robotforge.schema import RobotSpec, SpecError

FIXTURES = Path(__file__).parent / "fixtures"
EXAMPLE = Path(__file__).parent.parent / "examples" / "pathfinder.json"


def _vision_payload() -> dict:
    spec = json.loads(EXAMPLE.read_text())
    return {"choices": [{"message": {"content": json.dumps({
        "identity_guess": "unknown custom robot",
        "visible_parts": [
            {"kind": "wheel", "count": 4, "position": "corners",
             "notes": "all four visible"},
            {"kind": "rgb_camera", "count": 1, "position": "front",
             "notes": ""},
            {"kind": "mystery", "count": "not-a-number"},  # dropped, not fatal
        ],
        "spec": spec,
    })}}]}


def test_parse_photo_payload():
    draft = parse_photo_payload(_vision_payload())
    assert isinstance(draft.spec, RobotSpec)
    assert draft.spec.name == "pathfinder"
    assert draft.identity_guess == "unknown custom robot"
    wheels = [p for p in draft.visible_parts if p.kind == "wheel"]
    assert len(wheels) == 1 and wheels[0].count == 4
    # the malformed entry was skipped, the valid camera entry kept
    assert [p.kind for p in draft.visible_parts] == ["wheel", "rgb_camera"]


def test_parse_photo_payload_rejects_garbage():
    for bad in ({}, {"choices": []},
                {"choices": [{"message": {"content": "not json"}}]},
                {"choices": [{"message": {"content": '{"nope": 1}'}}]}):
        try:
            parse_photo_payload(bad)
            raise AssertionError(f"expected SpecError for {bad!r}")
        except SpecError:
            pass


def test_sam_text_fixture_three_wheels():
    text = (FIXTURES / "sam_wheel_rider_output.txt").read_text()
    regions = parse_sam_text(text)
    assert len(regions) == 3
    assert regions[0].box == (314, 523, 408, 611)
    assert regions[0].image_w == 620 and regions[0].image_h == 620
    assert regions[0].confidence is not None
    assert abs(regions[0].confidence - 0.9452) < 0.001
    assert [r.object_id for r in regions] == ["0", "1", "2"]


def test_sam_stream_fixture_round_trip():
    raw = (FIXTURES / "sam_stream_wheel_rider.txt").read_text()
    text = sam_text_from_stream(raw.splitlines())
    expected = (FIXTURES / "sam_wheel_rider_output.txt").read_text()
    assert text == expected
    assert len(parse_sam_text(text)) == 3


def test_sam_empty_lane_is_zero_regions_not_error():
    assert parse_sam_text("") == []
    assert sam_text_from_stream([
        'data: {"type": "response.output_text.done", "text": ""}',
        "data: [DONE]",
    ]) == ""


def test_cli_photo_flow(monkeypatch=None):
    """CLI --photo: banner + identity + parts + cross-check lines, spec out.

    Uses plain attribute patching (the suite runs under a direct runner as
    well as pytest, so no pytest fixtures).
    """
    spec = RobotSpec.from_json(EXAMPLE.read_text())
    draft = PhotoDraft(
        spec=spec, identity_guess="test bot 3000",
        visible_parts=[type("P", (), {"kind": "drive wheel", "count": 4,
                                      "position": "corners",
                                      "notes": ""})()])
    calls = {}

    def fake_draft(path):
        calls["photo"] = path
        return draft

    def fake_locate(path, concepts):
        calls["concepts"] = concepts
        return {"wheel": [SamRegion("0", (0, 0, 9, 9), 100, 100, 0.9)] * 3}

    orig_draft, orig_locate = cli.draft_spec_from_photo, cli.locate_parts
    cli.draft_spec_from_photo, cli.locate_parts = fake_draft, fake_locate
    try:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["describe", "--photo", "fake.jpg"])
    finally:
        cli.draft_spec_from_photo, cli.locate_parts = orig_draft, orig_locate
    out = buf.getvalue()
    assert rc == 0
    assert calls["photo"] == "fake.jpg" and calls["concepts"] == ["wheel"]
    assert "ESTIMATED from photo" in out
    assert "identity guess: test bot 3000" in out
    assert "wheel x4" in out
    # Spark said 4, SAM found 3: the disagreement must be printed, not hidden
    assert "Spark saw 4 / SAM found 3 regions — DISAGREE" in out
    assert '"name": "pathfinder"' in out  # spec JSON still emitted


# ------------------------------------------------------------------
# document mode (transcription, not estimation)
# ------------------------------------------------------------------

def _document_payload() -> dict:
    spec = json.loads((Path(__file__).parent.parent / "examples" /
                       "turtlebot3-burger.json").read_text())
    for k in ("wiring", "component_mass_kg"):
        spec.pop(k, None)
    spec["description"] = "a burger-class reference robot"
    values = [
        {"label": "Overall length", "printed": "178 mm",
         "field": "length_m"},
        {"label": "Overall width", "printed": "138 mm",
         "field": "width_m"},
        {"label": "Overall height", "printed": "192 mm",
         "field": "height_m"},
        {"label": "Weight", "printed": "0.93 kg", "field": "mass_kg"},
        {"label": "Ground clearance", "printed": "20 mm",
         "field": "ground_clearance_m"},
        {"label": "Wheel diameter", "printed": "66 mm",
         "field": "wheel.diameter_m"},
        {"label": "Wheel width", "printed": "22 mm",
         "field": "wheel.width_m"},
        {"label": "Wheel count", "printed": "2", "field": "wheel.count"},
        {"label": "Motor voltage", "printed": "11.1 V",
         "field": "motor.voltage_v"},
        {"label": "Motor count", "printed": "2", "field": "motor.count"},
        {"label": "Motor stall torque", "printed": "0.3 N·m",
         "field": "motor.stall_torque_nm"},
        {"label": "Battery voltage", "printed": "11.1 V",
         "field": "battery.voltage_v"},
        {"label": "Battery capacity", "printed": "1800 mAh",
         "field": "battery.capacity_mah"},
        {"label": "Lidar range", "printed": "3.5 m",
         "field": "sensors.range_m"},
    ]
    return {"choices": [{"message": {"content": json.dumps({
        "identity_guess": "TurtleBot3 Burger",
        "values": values,
        "spec": spec,
    })}}]}


def test_document_prompt_carries_the_hard_rules():
    assert "TRANSCRIPTION" in DOCUMENT_INSTRUCTIONS
    assert "drawing scale" in DOCUMENT_INSTRUCTIONS
    assert "stays ABSENT" in DOCUMENT_INSTRUCTIONS
    assert "no typical values" in DOCUMENT_INSTRUCTIONS


def test_parse_document_payload_complete():
    draft = parse_document_payload(_document_payload())
    assert isinstance(draft, DocumentDraft)
    assert draft.is_complete and isinstance(draft.spec, RobotSpec)
    assert draft.spec.length_m == 0.178
    assert draft.dropped == []
    assert len(draft.values) == 14
    # the banner prefix is enforced even when the model's text lacks it
    assert draft.spec_data["description"].startswith(DOCUMENT_PREFIX)


def test_parse_document_payload_drops_unbacked_numbers():
    payload = _document_payload()
    data = json.loads(payload["choices"][0]["message"]["content"])
    # mass_kg stays in the spec but loses its transcribed value, and
    # the battery (with its values) disappears entirely: the draft
    # must under-claim, not over-claim.
    data["values"] = [v for v in data["values"]
                      if v["field"] != "mass_kg"]
    data["spec"].pop("battery")
    payload["choices"][0]["message"]["content"] = json.dumps(data)
    draft = parse_document_payload(payload)
    assert "mass_kg" in draft.dropped
    assert "mass_kg" not in draft.spec_data
    assert draft.spec is None and not draft.is_complete  # partial on purpose
    assert draft.spec_data["length_m"] == 0.178  # backed values survive


def test_parse_document_payload_rejects_garbage():
    for bad in ({}, {"choices": []},
                {"choices": [{"message": {"content": "not json"}}]},
                {"choices": [{"message": {"content": '{"spec": 4}'}}]}):
        try:
            parse_document_payload(bad)
            raise AssertionError(f"expected SpecError for {bad!r}")
        except SpecError:
            pass


def test_cli_document_flow(monkeypatch=None):
    draft = parse_document_payload(_document_payload())
    orig = cli.draft_spec_from_document
    cli.draft_spec_from_document = lambda path: draft
    try:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = cli.main(["describe", "--document", "sheet.png"])
    finally:
        cli.draft_spec_from_document = orig
    out = buf.getvalue()
    assert rc == 0
    assert "DOCUMENT DRAFT" in out and "transcribed from the document" in out
    assert "178 mm" in out and "length_m" in out
    assert '"name": "turtlebot3-burger"' in out


def test_cli_describe_still_requires_text_or_photo():
    try:
        cli.main(["describe"])
        raise AssertionError("expected SystemExit from argparse")
    except SystemExit as exc:
        assert exc.code == 2


# ------------------------------------------------------------------
# honesty end-to-end: ESTIMATED may build a draft, never a verdict
# ------------------------------------------------------------------

PHOTO_EXAMPLE = Path(__file__).parent.parent / "examples" / \
    "photo-turtlebot.json"
BURGER_EXAMPLE = Path(__file__).parent.parent / "examples" / \
    "turtlebot3-burger.json"


def test_parse_photo_payload_stamps_estimated_prefix():
    payload = _vision_payload()  # the pathfinder spec has no banner
    draft = parse_photo_payload(payload)
    assert draft.spec.description.startswith(PHOTO_PREFIX)
    # and the shared predicate every consumer uses sees it as estimated
    from robotforge.schema import spec_is_estimated
    assert spec_is_estimated(draft.spec)


def test_parse_photo_payload_rejects_nondict_spec():
    bad = {"choices": [{"message": {"content": '{"spec": 4}'}}]}
    try:
        parse_photo_payload(bad)
        raise AssertionError("expected SpecError for non-dict spec")
    except SpecError:
        pass


def test_validate_estimated_spec_gets_no_clean_pass():
    from robotforge.validate import validate
    spec = RobotSpec.from_json(PHOTO_EXAMPLE.read_text())
    lines = [f"[{f.severity}] {f.check}: {f.message}"
             for f in validate(spec)]
    assert any("provenance.estimated_dimensions" in ln for ln in lines)
    assert not any("spec passed all engineering checks" in ln
                   for ln in lines), lines


def test_validate_measured_spec_still_passes_clean():
    from robotforge.validate import validate
    spec = RobotSpec.from_json(BURGER_EXAMPLE.read_text())
    lines = [f"[{f.severity}] {f.check}: {f.message}"
             for f in validate(spec)]
    assert lines == ["[INFO] all: spec passed all engineering checks"]


def test_cli_run_gate_refuses_photo_draft(tmp_path=None):
    """The gate must refuse an ESTIMATED spec before the twin is even
    spawned: no verdict, no gate report."""
    import tempfile
    workdir = Path(tempfile.mkdtemp()) / "gate"
    called = {}
    orig = cli.run_motion_check

    def sentinel(*a, **k):
        called["twin"] = True
        raise AssertionError("twin must not run for a photo draft")

    cli.run_motion_check = sentinel
    try:
        out, err = io.StringIO(), io.StringIO()
        from contextlib import redirect_stderr
        with redirect_stdout(out), redirect_stderr(err):
            rc = cli.main(["run-gate", str(PHOTO_EXAMPLE),
                           "--workdir", str(workdir)])
    finally:
        cli.run_motion_check = orig
    assert rc == 2
    assert "refusing to run the gate on a photo draft" in err.getvalue()
    assert "ESTIMATED" in err.getvalue()  # rejection explains provenance
    assert "twin" not in called
    assert not (workdir / "gate-report.json").exists()
