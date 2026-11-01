"""Omega1 extraction (docs/omega1/omega1.extracted.json).

The file is the first robot run through docs/omega1/EXTRACTION.md. The
rules it must keep: every extracted value cites a file, a line and a
verbatim quote at a pinned commit; every value carries an evidence
level; MEASURE_ME fields stay empty rather than guessed; and the
geometry a twin needs is never filled from code defaults.

Run from the repo root:  python -m pytest tests/test_omega1_extraction.py -q
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs/omega1/omega1.extracted.json"
LEVELS = {"DOCUMENTED", "CODE_DEFAULT", "MEASURE_ME", "MEASURED"}


def load():
    return json.loads(DOC.read_text())


def test_source_is_pinned():
    doc = load()
    assert doc["robot"] == "Omega1"
    assert doc["source"]["repo"] == "https://github.com/abelxmendoza/Omega-Code"
    assert re.fullmatch(r"[0-9a-f]{40}", doc["source"]["commit"])
    assert set(doc["evidence_levels"]) == LEVELS


def test_every_value_is_cited_or_left_empty():
    for key, f in load()["fields"].items():
        assert f["evidence"] in LEVELS, key
        if f["evidence"] == "MEASURE_ME":
            assert f["value"] is None, f"{key} is MEASURE_ME but has a value"
            assert f.get("note"), f"{key} needs a how-to-measure note"
            continue
        assert f["value"] is not None, key
        src = f.get("source")
        if f["evidence"] in {"DOCUMENTED", "CODE_DEFAULT"}:
            assert src, f"{key} has no source"
            assert src["file"] and isinstance(src["line"], int) and src["line"] > 0, key
            assert src["quote"].strip(), key


def test_twin_geometry_is_not_taken_from_code():
    fields = load()["fields"]
    for key in ("geometry.length_m", "geometry.width_m", "geometry.height_m",
                "geometry.track_m", "geometry.wheelbase_m", "wheel.diameter_m",
                "mass_kg"):
        assert fields[key]["evidence"] in {"MEASURE_ME", "MEASURED"}, key
    # The code's wheel numbers are kept, but only as labelled defaults.
    assert fields["wheel.radius_m"]["evidence"] == "CODE_DEFAULT"
    assert fields["wheel.track_m"]["evidence"] == "CODE_DEFAULT"


def test_findings_cite_sources():
    findings = load()["findings"]
    ids = {f["id"] for f in findings}
    assert {"track-wider-than-robot", "no-robot-model", "loose-pitch-servo"} <= ids
    for f in findings:
        assert f["severity"] in {"high", "medium", "low"}
        assert f["text"]
        for s in f["sources"]:
            assert s["file"] and s["line"] > 0 and s["quote"].strip()


def test_docs_link_together():
    extraction = (ROOT / "docs/omega1/EXTRACTION.md").read_text()
    assert "omega1.extracted.json" in extraction
    assert "MEASURE.md" in extraction
    measure = (ROOT / "docs/omega1/MEASURE.md").read_text()
    assert "EXTRACTION.md" in measure
