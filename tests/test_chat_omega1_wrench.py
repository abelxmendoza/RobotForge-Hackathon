"""Wrench knows Omega1 (2026-11-03).

Omega1 is the team's real rover and the Workshop's built-in specimen,
and it is the robot the demo is tested on. A real demo-mode
conversation went wrong on every turn:

  "hi"                      -> fine
  "what else can you do?"   -> the starter-kinds picker
  "do you know Omega1?"     -> the "not recorded" fallback
  "im looking at him right now hes in my workshop as a
   "built in specimen""     -> the starter-kinds picker again

This test replays that exact conversation through the compiled
engine + wrench, and checks that every Omega1 fact Wrench states is
one the records hold (lib/omega1Twin.ts OMEGA1_FACTS and
docs/omega1/omega1.extracted.json), and that it never claims a gate
verdict, a size or a mass for Omega1.
"""
import json
import re

from tests.test_chat_wrench_eval2 import REPO, WRENCH_TS, _run_cases, _strip

KINDS_PICKER = ("every custom build starts", "which kind you are building")
FALLBACK = "rather say so than guess"
TWIN_TS = REPO / "web-next/src/lib/omega1Twin.ts"
EXTRACTED = json.loads((REPO / "docs/omega1/omega1.extracted.json").read_text())

TRANSCRIPT = [
    "hi",
    "what else can you do?",
    "do you know Omega1?",
    'im looking at him right now hes in my workshop as a "built in specimen"',
]

CASES = [
    {"id": "t", "turns": TRANSCRIPT},
    {"id": "follow", "turns": ["tell me about omega1", "what's wrong with him?",
                               "has he been gated?", "how heavy is he?"]},
    {"id": "battery", "q": "what battery does Omega1 use?"},
    {"id": "sensors", "q": "What sensors does Omega-1 have?"},
    {"id": "fix", "q": "how do I fix Omega1?"},
    {"id": "improve", "q": "How do I improve my Omega1 twin?"},
    {"id": "andino", "turns": ["do you know Omega1?", "Tell me about Andino"]},
    {"id": "caps", "q": "what can you do"},
    {"id": "chip", "q": "Tell me about Omega1"},
]

_CACHE = {}


def _res():
    if "r" not in _CACHE:
        _CACHE["r"] = _run_cases(CASES)
    return _CACHE["r"]


def _text(html):
    return re.sub(r"\s+", " ", _strip(html)).strip().lower()


def _skip_if_no_toolchain(r):
    if r is None:
        import pytest
        pytest.skip("node/tsc not available")


def test_the_demo_transcript_is_answered():
    r = _res()
    _skip_if_no_toolchain(r)
    hi, caps, know, specimen = [t for t in r["t"]["turns"]]
    # The greeting no longer ends on an orphaned "Try one of these:".
    assert not _text(hi["html"]).endswith("try one of these:")
    assert "guide" not in _text(hi["html"])
    # "what else can you do?" is a capabilities answer, not a build picker.
    for turn in (caps, know, specimen):
        t = _text(turn["html"])
        assert not any(k in t for k in KINDS_PICKER), t
        assert not turn["fallback"]
        assert FALLBACK not in t
    assert "omega1" in _text(caps["html"])
    # "do you know Omega1?" is answered from the records.
    t = _text(know["html"])
    assert "omega1" in t and "freenove fnk0043" in t and "18650" in t
    # The pronoun follow-up stays on Omega1 and explains the specimen.
    t = _text(specimen["html"])
    assert "omega1" in t and "specimen" in t and "estimate" in t


def test_follow_ups_stay_on_omega1_and_stay_honest():
    r = _res()
    _skip_if_no_toolchain(r)
    wrong, gated, heavy = [_text(t["html"]) for t in r["follow"]["turns"][1:]]
    assert "servo" in wrong and "0.20 m" in wrong
    assert "no gate has run" in gated
    assert "not measured" in heavy
    assert not re.search(r"\d+(\.\d+)?\s*kg", heavy)


def test_single_asks():
    r = _res()
    _skip_if_no_toolchain(r)
    assert "7.4 v" in _text(r["battery"]["html"])
    assert "hc-sr04" in _text(r["sensors"]["html"])
    assert "servo" in _text(r["fix"]["html"])
    # How-to asks keep the Workshop's step-by-step topic answer.
    assert "improve this twin" in _text(r["improve"]["html"])
    # Naming a Robodex robot after Omega1 moves on to that robot.
    assert "andino" in _text(r["andino"]["turns"][1]["html"])
    assert "omega1" in _text(r["caps"]["html"])
    # The greeting's "Tell me about Omega1" chip lands on a real answer.
    assert not r["chip"]["fallback"] and "freenove" in _text(r["chip"]["html"])


def test_omega1_never_gets_a_verdict_or_a_number_it_does_not_have():
    r = _res()
    _skip_if_no_toolchain(r)
    turns = r["t"]["turns"][2:] + r["follow"]["turns"]
    turns += [r[k] for k in ("battery", "sensors", "fix")]
    for turn in turns:
        t = _text(turn["html"])
        assert not re.search(r"\b(passed|failed) the gate\b", t), t
        assert "marginal" not in t
        assert not re.search(r"\d+(\.\d+)?\s*(kg|g|mm|cm)\b", t), t


def test_wrench_omega1_facts_match_the_records():
    """wrench.ts restates Omega1's facts (it may import only ./engine);
    each one must still be in OMEGA1_FACTS or the extracted record."""
    src = WRENCH_TS.read_text(encoding="utf-8")
    twin = TWIN_TS.read_text(encoding="utf-8")
    extracted = json.dumps(EXTRACTED)
    for fact in ("Freenove FNK0043", "Raspberry Pi 4B (4 GB)", "HC-SR04",
                 "18650", "7.4 V", "skid-steer", "repair parts"):
        assert fact.lower() in twin.lower(), fact
        assert fact.lower() in src.lower(), fact
    for fact in ("PCA9685", "OV5647", "Jetson", "Xbox", "1300", "1700", "0.04", "0.15 m"):
        assert fact in extracted, fact
