"""Forge Guide chat tests: the widget rides on every generated page
through the generator (never a hand-edit), the answer engine's data
wiring points at the real catalog files, the intent table's coverage
matches the catalog, and — when node is available — the engine answers
canonical questions from the real recorded data."""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from robotforge import site
from robotforge.catalog import Catalog, Robodex
from robotforge.site import build_site

REPO = Path(__file__).resolve().parent.parent
dex = Robodex.load()
cat = Catalog.load()

INTENTS = json.loads((REPO / "assets/js/chat-intents.json").read_text())
ENGINE_SRC = (REPO / "assets/js/chat-engine.js").read_text()
WIDGET_SRC = (REPO / "assets/js/chat.js").read_text()

WIDGET_BITS = ('id="forge-chat"', 'id="fc-launcher"', 'id="fc-panel"',
               'id="fc-msgs"', 'id="fc-chips"', 'id="fc-form"',
               'id="fc-input"', "not a live AI",
               "recorded data")
ASSET_BITS = ("assets/css/chat.css", "assets/js/chat-engine.js",
              "assets/js/chat.js")

REQUIRED_TOPICS = {
    "identity", "greeting", "gate_thresholds", "gate_how", "marginal",
    "gate_reports", "passed_list", "failed_list", "robodex_list",
    "process", "describe_how", "photo", "twin", "take_apart",
    "import_list", "parts_overview", "buy", "help",
}


def _generated_pages():
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        (out / "index.html").write_text((REPO / "index.html").read_text())
        pages = {}
        for p in build_site(out, dex, cat):
            pages[str(p.relative_to(out))] = p.read_text()
        return pages


def _is_redirect(text):
    return 'http-equiv="refresh"' in text


def test_every_app_page_carries_the_widget():
    pages = _generated_pages()
    app_pages = {rel: text for rel, text in pages.items()
                 if rel.startswith("app/") and not _is_redirect(text)}
    assert len(app_pages) >= 7  # forge, robots, evidence + one per robot
    for rel, text in app_pages.items():
        for bit in WIDGET_BITS + ASSET_BITS:
            assert bit in text, (rel, bit)
    # depth-3 robot pages resolve the assets relative to their depth
    robot_page = next(t for r, t in app_pages.items()
                      if r.startswith("app/robots/") and r.count("/") == 3)
    assert "../../../assets/js/chat.js" in robot_page
    assert "../../../assets/css/chat.css" in robot_page


def test_landing_carries_the_widget_between_markers():
    pages = _generated_pages()
    landing = pages["index.html"]
    assert site.CHAT_START in landing and site.CHAT_END in landing
    for bit in WIDGET_BITS + ASSET_BITS:
        assert bit in landing, bit
    assert landing.count('id="forge-chat"') == 1


def test_chat_injection_is_idempotent():
    landing = (REPO / "index.html").read_text()
    assert site.CHAT_START in landing  # committed landing is generated
    assert site.inject_chat(landing) == landing


def test_widget_label_is_the_honest_one():
    block = site.chat_widget()
    assert "Forge Guide" in block
    assert site.CHAT_HONEST in block
    assert "(not a live AI)" in site.CHAT_HONEST


def test_chat_assets_exist_and_parse():
    for rel in ("assets/css/chat.css", "assets/js/chat.js",
                "assets/js/chat-engine.js", "assets/js/chat-intents.json"):
        assert (REPO / rel).exists(), rel
    assert INTENTS["version"] == 1 and INTENTS["topics"]
    node = shutil.which("node")
    if node:  # syntax-check both scripts when node is around
        for rel in ("assets/js/chat.js", "assets/js/chat-engine.js"):
            r = subprocess.run([node, "--check", str(REPO / rel)],
                               capture_output=True, text=True)
            assert r.returncode == 0, (rel, r.stderr)


def test_engine_wiring_references_the_catalog_files():
    for path in ("catalog/robots.json", "catalog/parts.json",
                 "catalog/gate-reports.json", "assets/js/chat-intents.json"):
        assert path in WIDGET_SRC, path
    # the live-endpoint hook exists and ships empty (local engine answers)
    assert "endpoint: ''" in ENGINE_SRC
    assert "CONFIG" in ENGINE_SRC and "createEngine" in ENGINE_SRC


def test_intent_table_coverage():
    topics = {t["id"]: t for t in INTENTS["topics"]}
    assert len(topics) == len(INTENTS["topics"])  # ids unique
    assert REQUIRED_TOPICS <= set(topics)
    for t in INTENTS["topics"]:
        assert t["keywords"], t["id"]
        assert all(isinstance(k, str) and k.strip() for k in t["keywords"])
        assert bool(t.get("answer")) != bool(t.get("handler")), t["id"]
        assert t.get("samples"), t["id"]
        if t.get("handler"):
            assert f"{t['handler']}: function" in ENGINE_SRC, t["handler"]
    assert len(INTENTS["suggestions"]) >= 4
    assert all(isinstance(s, str) and s.strip()
               for s in INTENTS["suggestions"])


def test_intent_threshold_copy_matches_the_locked_constants():
    answer = next(t for t in INTENTS["topics"]
                  if t["id"] == "gate_thresholds")["answer"]
    assert f"≤ {site.PASS_AT:g}%" in answer
    assert f"≤ {site.PASS_AT:g}°" in answer
    assert f"{site.FAIL_AT:g}%" in answer and f"{site.FAIL_AT:g}°" in answer


def _norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9#]+", " ", s.lower())).strip()


def test_catalog_entities_are_reachable_by_the_matcher():
    # The engine derives its match keys from the catalog data itself
    # (names, Robodex numbers, part names/ids) — assert the data gives
    # it something matchable for every robot and a spread of parts.
    assert "findRobots" in ENGINE_SRC and "findParts" in ENGINE_SRC
    for r in dex.robots:
        assert _norm(r.name)
        assert f"#{r.number:03d}" == r.dex_id
        assert r.gate_status.status in ("PASS", "MARGINAL", "FAIL",
                                        "NOT_GATED")
    sampled = {}
    for p in cat.parts.values():
        sampled.setdefault(p.part_class, p)
    assert len(sampled) >= 8
    for p in sampled.values():
        toks = _norm(p.name).split()
        assert len(toks) >= 2 or len(toks[0]) >= 4, p.name
        assert p.blurb and p.used_for, p.id


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
  reports: load('catalog/gate-reports.json'),
  intents: load('assets/js/chat-intents.json'),
  root: ''
});
const out = {};
for (const q of JSON.parse(fs.readFileSync(process.argv[4], 'utf8'))) {
  out[q] = engine.answer(q).html;
}
console.log(JSON.stringify(out));
"""


def _ask_in_node(questions):
    node = shutil.which("node")
    if not node:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "ask.js"
        script.write_text(NODE_SCRIPT)
        qfile = Path(tmp) / "questions.json"
        qfile.write_text(json.dumps(questions))
        r = subprocess.run(
            [node, str(script), str(REPO / "assets/js/chat-engine.js"),
             str(REPO), str(qfile)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def test_engine_answers_from_real_data_in_node():
    suggestions = INTENTS["suggestions"]
    questions = suggestions + [
        "Tell me about Andino",
        "Why did Andino fail?",
        "What are the gate thresholds?",
        "What is a ball caster?",
        "Which robots passed the gate?",
        "Tell me about the Burger",
        "What's in the Robodex?",
        "How do I bake a chocolate cake?",
    ]
    answers = _ask_in_node(questions)
    if answers is None:
        return  # no node on this machine; wiring tests above still hold

    andino = answers["Tell me about Andino"]
    assert "Andino" in andino and "Fail" in andino
    assert 'href="app/robots/andino/"' in andino

    why = answers["Why did Andino fail?"]
    assert "caster" in why and "11.624" in why  # the recorded diagnosis

    thresholds = answers["What are the gate thresholds?"]
    assert "≤ 5%" in thresholds and "10°" in thresholds
    assert "app/evidence/" in thresholds

    caster = answers["What is a ball caster?"]
    assert "Ball caster" in caster

    passed = answers["Which robots passed the gate?"]
    assert "Pathfinder" in passed and "Burger" in passed
    assert "Andino" not in passed

    burger = answers["Tell me about the Burger"]
    assert "TurtleBot3 Burger" in burger and "Pass" in burger

    listing = answers["What's in the Robodex?"]
    for r in dex.robots:
        assert r.name in listing

    fallback = answers["How do I bake a chocolate cake?"]
    assert "rather say so than guess" in fallback

    # every suggested chip must land on a real answer, not the fallback
    for q in suggestions:
        assert "rather say so than guess" not in answers[q], q
