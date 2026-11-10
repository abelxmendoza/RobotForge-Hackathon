"""Wrench answers "how does <robot> work?" with the step-through
explainer (2026-11-07, /explain/ — lib/robotExplainer.ts).

Only when a robot is named (Omega1 or a Robodex robot) or carried over
by "it": "how does the gate work?" keeps its own answer. The Omega1
reply restates only facts its records hold, and states no speed.
"""
import re

from tests.test_chat_wrench_eval2 import _run_cases, _strip

CASES = [
    {"id": "omega", "q": "how does Omega1 work?"},
    {"id": "it", "turns": ["tell me about omega1", "how does it work?"]},
    {"id": "dex", "q": "How does the TurtleBot3 Burger work?"},
    {"id": "gate", "q": "How does the gate work?"},
]

_CACHE = {}


def _res():
    if "r" not in _CACHE:
        _CACHE["r"] = _run_cases(CASES)
    return _CACHE["r"]


def _text(html):
    return re.sub(r"\s+", " ", _strip(html)).strip().lower()


def _routes(ans):
    return [h.get("route", "") for h in (ans.get("hits") or [])]


def test_how_it_works_opens_the_explainer():
    r = _res()
    if r is None:
        import pytest
        pytest.skip("node/tsc not available")
    omega = r["omega"]
    assert not omega["fallback"]
    assert any(x.endswith("explain/?robot=omega1") for x in _routes(omega))
    t = _text(omega["html"])
    assert "pca9685" in t and "one side runs backward" in t and "you do the driving" in t
    assert not re.search(r"\d+(\.\d+)?\s*(m/s|km/h|mph|rpm)", t)
    follow = r["it"]["turns"][1]
    assert any("explain/?robot=omega1" in x for x in _routes(follow))
    dex = r["dex"]
    assert any(re.search(r"explain/\?robot=turtlebot3-burger$", x) for x in _routes(dex))
    # A topic that is not a robot keeps its own answer.
    assert not any("explain/" in x for x in _routes(r["gate"]))
