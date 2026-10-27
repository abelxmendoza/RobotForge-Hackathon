"""Forge Guide build planning: kinds + templates + have-vs-need.

The engine plans from recorded data only: starter kinds from
catalog/kinds.json (kept in sync with robotforge.kinds — the
single source of truth) and reference BOMs from the class
templates in catalog/parts.json. Planning phrasing must not be
hijacked by stray word matches, and questions the topics table
owns (pricing) must not be hijacked by planning either.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from robotforge.kinds import kinds_document

REPO = Path(__file__).resolve().parent.parent

NODE_SCRIPT = r"""
const fs = require('fs');
const FG = require(process.argv[2]);
const root = process.argv[3];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const robots = load('catalog/robots.json');
const parts = load('catalog/parts.json');
const engine = FG.createEngine({
  robots: robots.robots, parts: parts.parts,
  templates: parts.templates.length,
  templateList: parts.templates,
  kinds: load('catalog/kinds.json').kinds,
  reports: load('catalog/gate-reports.json'),
  intents: load('assets/js/chat-intents.json'),
  root: ''
});
const out = {};
for (const q of JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))) {
  const a = engine.answer(q);
  out[q] = { html: a.html || '', fallback: !!a.fallback,
             hits: (a.hits || []).map(h => h.kind + ':' + h.id) };
}
console.log(JSON.stringify(out));
"""

QUESTIONS = [
    "I want to build a rover",
    "What parts do I need to build a differential rover?",
    "Help me plan a quadcopter build",
    "I have wheels and motors, what else do I need?",
    "I have wheels and motors, what else do I need for a differential rover?",
    "What battery should I use for a 4S build?",
    "How much would it cost to build a rover?",
    "What is a Jetson Orin?",
    "Tell me about TurtleBot3 Burger",
]


def _ask():
    node = shutil.which("node")
    if not node:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "ask.js"
        script.write_text(NODE_SCRIPT)
        qfile = Path(tmp) / "questions.json"
        qfile.write_text(json.dumps(QUESTIONS))
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/chat-engine.js"),
             str(REPO), str(qfile)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_kinds_json_is_in_sync_with_kinds_py():
    committed = json.loads((REPO / "catalog/kinds.json").read_text())
    assert committed == kinds_document()


def test_chat_js_loads_kinds_and_templates():
    src = (REPO / "assets/js/chat.js").read_text()
    assert "catalog/kinds.json" in src
    assert "templateList" in src and "kinds:" in src
    intents = json.loads((REPO / "assets/js/chat-intents.json").read_text())
    assert "Plan a differential rover build" in intents["suggestions"]


def test_engine_plans_builds_in_node():
    answers = _ask()
    if answers is None:
        return  # no node here; the sync + wiring tests still hold

    picker = answers["I want to build a rover"]
    assert not picker["fallback"]
    assert sum(1 for h in picker["hits"] if h.startswith("kind:")) == 7

    plan = answers["What parts do I need to build a differential rover?"]
    assert not plan["fallback"]
    assert plan["hits"][0] == "kind:differential"
    assert "gate pack LIVE" in plan["html"]
    assert "part:gearmotor_12v" in plan["hits"]

    quad = answers["Help me plan a quadcopter build"]
    assert "CATALOGUE ONLY" in quad["html"]
    assert quad["hits"][0] == "kind:quadcopter"

    no_kind = answers["I have wheels and motors, what else do I need?"]
    assert not no_kind["fallback"]
    assert "which kind" in no_kind["html"]
    # the old hijack: a lone mecanum wheel card as the whole answer
    assert no_kind["hits"][0].startswith("kind:")

    diff = answers[
        "I have wheels and motors, what else do I need for a "
        "differential rover?"]
    assert "still needs" in diff["html"]
    assert "TB6612FNG" in diff["html"]  # the driver is missing
    assert "Already covered" in diff["html"]
    needs_at = diff["html"].index("still needs")
    covered_at = diff["html"].index("Already covered")
    assert needs_at < covered_at
    # the gearmotor is covered by the motors class, not "needed"
    needs_block = diff["html"][needs_at:covered_at]
    assert "gearmotor" not in needs_block.lower()

    rec = answers["What battery should I use for a 4S build?"]
    assert not rec["fallback"]
    assert rec["hits"] == ["part:lipo_4s_5200", "part:lipo_4s_1500"]

    # planning must not steal what the topics table owns
    cost = answers["How much would it cost to build a rover?"]
    assert "shop links or prices" in cost["html"]
    # ... and the honest fallback still falls back
    assert answers["What is a Jetson Orin?"]["fallback"] is True
    robot = answers["Tell me about TurtleBot3 Burger"]
    assert robot["hits"] == ["robot:turtlebot3-burger"]
