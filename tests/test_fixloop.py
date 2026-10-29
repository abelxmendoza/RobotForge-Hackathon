"""The Forge loop: the proposer suggests, the validator decides."""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

from robotforge import fixloop  # noqa: E402
from robotforge.cli import main  # noqa: E402
from robotforge.schema import RobotSpec  # noqa: E402

BROKEN = REPO / "examples" / "broken-indoor-rover.json"


def broken():
    return RobotSpec.from_json(BROKEN.read_text())


def test_rules_loop_resolves_the_broken_rover():
    res = fixloop.run_loop(broken(), fixloop.rules_proposer)
    assert res.resolved
    assert len(res.rounds) == 1
    paths = [c.path for c in res.rounds[0].changes]
    assert "ground_clearance_m" in paths
    assert res.rounds[0].errors_after == 0
    # the final spec is a real, parseable spec
    RobotSpec.from_dict(res.final_spec)


def test_disallowed_and_bad_changes_are_dropped():
    spec = broken().to_dict()
    changes = fixloop.sanitize_changes([
        {"path": "sensors", "value": []},
        {"path": "name", "value": "renamed"},
        {"path": "mass_kg", "value": -1},
        {"path": "wheel.count", "value": 2.5},
        {"path": "wheel.count", "value": True},
        {"path": "ground_clearance_m", "value": "0.04", "reason": "r"},
        {"path": "ground_clearance_m", "value": 0.03},  # duplicate path
    ], spec)
    assert [(c.path, c.value) for c in changes] == [("ground_clearance_m", 0.04)]


def test_loop_stops_after_three_rounds_with_an_unhelpful_model():
    calls = []

    def stubborn(spec, lines):
        calls.append(lines)
        # changes something every time but never the failing field
        return {"changes": [{"path": "length_m",
                             "value": spec["length_m"] + 0.01}],
                "summary": "try a longer body", "_label": "stub"}

    res = fixloop.run_loop(broken(), stubborn)
    assert not res.resolved
    assert len(res.rounds) == 3 == len(calls)
    assert "3 rounds" in res.stop_reason


def test_model_never_sets_the_verdict():
    def liar(spec, lines):
        return {"changes": [{"path": "length_m", "value": 0.5}],
                "summary": "All fixed, it passes now!", "resolved": True}

    res = fixloop.run_loop(broken(), liar, max_rounds=1)
    assert not res.resolved
    assert res.rounds[0].errors_after == 1


def test_live_proposer_parses_fenced_json():
    def chat(system, user):
        assert "You only PROPOSE" in system
        assert "Findings:" in user
        return ("```json\n" + json.dumps({"changes": [
            {"path": "ground_clearance_m", "value": 0.045}],
            "summary": "lower it"}) + "\n```", "stub (model)")

    res = fixloop.run_loop(broken(), fixloop.live_proposer(chat))
    assert res.resolved
    assert res.rounds[0].proposer == "stub (model)"


def test_worker_fix_fields_mirror_python():
    worker = (REPO / "live" / "worker.js").read_text()
    m = re.search(r"const FIX_FIELDS = \{(.*?)\};", worker, re.S)
    pairs = dict(re.findall(r"'([a-z_.]+)': '(\w+)'", m.group(1)))
    assert pairs == fixloop.FIX_FIELDS
    for sentence in ("You only PROPOSE.", "Never invent sensors or new parts.",
                     "Propose the SMALLEST set of field changes"):
        assert sentence in worker and sentence in fixloop.FIX_SYSTEM_PROMPT


def test_cli_fix_mock_writes_the_final_spec(tmp_path, capsys):
    out = tmp_path / "fixed.json"
    assert main(["fix", str(BROKEN), "--mock", "--out", str(out)]) == 0
    assert "RESOLVED" in capsys.readouterr().out
    assert main(["validate", str(out)]) == 0


def test_mock_describe_says_it_is_a_sample(capsys):
    main(["describe", "a six wheel rover", "--mock"])
    assert "OFFLINE SAMPLE" in capsys.readouterr().err
