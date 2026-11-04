"""Wrench knows which robots are yours (Abel, 2026-11-04).

Your robots are exactly the active robots in your Workshop: the same
list the Robodex's My robots tab shows. Every other robot Wrench
knows (Robodex catalog robots, Omega1's records) is a reference
robot, and Wrench must say so instead of calling it yours. This
compiles the real engine + wrench and drives them with a Workshop
list, the way ChatDock supplies it (EngineData.myRobots).
"""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from tests.test_chat_wrench_eval2 import ENGINE_TS, REPO, WEB, WRENCH_TS

DRIVER = r"""
const fs = require('fs');
const path = require('path');
const [buildDir, root, specPath] = process.argv.slice(2);
const load = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const wrenchMod = require(path.join(buildDir, 'wrench.js'));
const partsDoc = load('catalog/parts.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const out = {};
for (const c of spec.cases) {
  const wrench = wrenchMod.createWrench({
    robots: load('catalog/robots.json').robots,
    parts: partsDoc.parts,
    templates: partsDoc.templates.length,
    templateList: partsDoc.templates,
    kinds: load('catalog/kinds.json').kinds,
    reports: load('catalog/gate-reports.json'),
    intents: load('assets/js/chat-intents.json'),
    root: '',
    myRobots: () => c.mine,
  });
  const r = wrench.answerTurn(c.q, {});
  out[c.id] = { html: r.html, fallback: !!r.fallback };
}
console.log(JSON.stringify(out));
"""

CATALOG = json.loads((REPO / "catalog/robots.json").read_text())["robots"]
DEX_NAME = CATALOG[0]["name"]

CASES = [
    {"id": "list", "q": "what robots do I have?", "mine": ["Rover Two", "Omega1"]},
    {"id": "list_empty", "q": "which robots are mine?", "mine": []},
    {"id": "dex_not_mine", "q": f"is {DEX_NAME} mine?", "mine": ["Rover Two"]},
    {"id": "dex_mine", "q": f"is {DEX_NAME} mine?", "mine": [DEX_NAME]},
    {"id": "omega_absent", "q": "Tell me about Omega1", "mine": []},
    {"id": "omega_present", "q": "Tell me about Omega1", "mine": ["Omega1"]},
    {"id": "own_unknown", "q": "is Zorbo mine?", "mine": ["Rover Two"]},
    {"id": "dex_answer", "q": f"Tell me about {DEX_NAME}", "mine": ["Rover Two"]},
    {"id": "part_not_robot", "q": "do I have a battery?", "mine": ["Rover Two"]},
    {"id": "part_for_robot", "q": f"do I have a battery for {DEX_NAME}?", "mine": [DEX_NAME]},
    {"id": "short_name", "q": f"is {DEX_NAME.split()[-1]} mine?", "mine": []},
]


def _run():
    node = shutil.which("node")
    tsc = WEB / "node_modules/.bin/tsc"
    if not node or not tsc.exists():
        pytest.skip("node / web-next deps not installed")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        r = subprocess.run(
            [str(tsc), str(ENGINE_TS), str(WRENCH_TS), "--module", "commonjs",
             "--target", "es2020", "--moduleResolution", "node", "--skipLibCheck",
             "--outDir", str(tmp / "build")],
            capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, r.stderr[-2000:]
        (tmp / "drive.js").write_text(DRIVER)
        (tmp / "cases.json").write_text(json.dumps({"cases": CASES}))
        r = subprocess.run([node, str(tmp / "drive.js"), str(tmp / "build"), str(REPO),
                            str(tmp / "cases.json")],
                           capture_output=True, text=True, timeout=300)
        assert r.returncode == 0, r.stderr[-2000:]
        return json.loads(r.stdout)


_CACHE = {}


def _text(cid):
    if "r" not in _CACHE:
        _CACHE["r"] = _run()
    html = _CACHE["r"][cid]["html"]
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).replace("&rsquo;", "'")


def test_lists_exactly_the_workshop_robots():
    t = _text("list")
    assert "Rover Two" in t and "Omega1" in t
    assert "not yours" in t


def test_empty_workshop_means_no_robots_of_your_own():
    assert "don't have any robots of your own" in _text("list_empty")


def test_robodex_robot_is_not_yours_until_it_is_in_the_workshop():
    assert "is a Robodex robot, not one of yours" in _text("dex_not_mine")
    assert _text("dex_mine").startswith(" Yes.") or "Yes." in _text("dex_mine")


def test_omega1_is_yours_only_when_in_the_workshop():
    assert "isn't in your Workshop" in _text("omega_absent")
    assert "Omega1 is in your Workshop, so it is one of your robots" in _text("omega_present")


def test_unknown_name_is_not_yours():
    assert "isn't one of your robots" in _text("own_unknown")


def test_robodex_answers_say_whose_robot_it_is():
    assert f"{DEX_NAME} is a Robodex robot, not one of yours" in _text("dex_answer")


def test_part_questions_are_not_ownership_questions():
    assert "isn't one of your robots" not in _text("part_not_robot")
    # a parts question that only MENTIONS a robot is not an ownership ask
    t = _text("part_for_robot")
    assert "is in your Workshop, so it is one of your robots" not in t
    assert "not one of yours: it isn't in your Workshop" not in t


def test_short_robot_name_still_resolves():
    assert "is a Robodex robot, not one of yours" in _text("short_name")
