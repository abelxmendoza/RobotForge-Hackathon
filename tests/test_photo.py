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
from robotforge.photo import (PhotoDraft, SamRegion, parse_photo_payload,
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


def test_cli_describe_still_requires_text_or_photo():
    try:
        cli.main(["describe"])
        raise AssertionError("expected SystemExit from argparse")
    except SystemExit as exc:
        assert exc.code == 2
