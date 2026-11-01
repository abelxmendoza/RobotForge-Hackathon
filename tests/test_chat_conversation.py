"""Wrench conversational layer tests (web-next engine): small talk
is not a data lookup. Greetings, meta questions and context
remarks ("hi i'm using this from my phone" — the exact message
that exposed the bug) must be answered conversationally by the
layer in front of the data path, in both chat and design mode,
while factual questions keep flowing to the recorded data and
unknown facts keep landing on the honest fallback, unchanged.

Follows test_chat.py's pattern: the real engine source runs in
node (type-stripped import of the .ts module) against the real
catalog data; without node, the static wiring checks still hold.
"""
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENGINE_TS = REPO / "web-next/src/components/chat/engine.ts"
FORGE_THREAD = REPO / "web-next/src/components/forge/ForgeThread.tsx"

ENGINE_SRC = ENGINE_TS.read_text()
FALLBACK_MARK = "rather say so than guess"


def test_conversational_layer_wiring():
    # the layer exists, is exported for the design-mode caller, and
    # is consulted at the top of the data path (step 0)
    assert "export function conversationalAnswer" in ENGINE_SRC
    assert 'conversationalAnswer(q, "chat", suggestions)' in ENGINE_SRC
    # design mode checks the layer before sending text to describe
    thread = FORGE_THREAD.read_text()
    assert "conversationalAnswer(value,'design',[])" in thread
    assert thread.index("conversationalAnswer(value,'design',[])") \
        < thread.index("await runText(value)")
    # the honest fallback copy is unchanged
    assert "I don&rsquo;t have that in RobotForge&rsquo;s recorded data" \
        in ENGINE_SRC


NODE_SCRIPT = r"""
import fs from 'node:fs';
const root = process.argv[2];
const load = p => JSON.parse(fs.readFileSync(root + '/' + p, 'utf8'));
const robots = load('catalog/robots.json');
const parts = load('catalog/parts.json');
const FG = await import(root + '/web-next/src/components/chat/engine.ts');
const engine = FG.createEngine({
  robots: robots.robots, parts: parts.parts,
  templates: parts.templates.length,
  templateList: parts.templates,
  kinds: load('catalog/kinds.json').kinds,
  reports: load('catalog/gate-reports.json'),
  intents: load('assets/js/chat-intents.json'),
  root: ''
});
const { chat, design } = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = { chat: {}, design: {} };
for (const q of chat) {
  const a = engine.answer(q);
  out.chat[q] = { html: a.html, fallback: Boolean(a.fallback) };
}
for (const q of design) {
  const c = FG.conversationalAnswer(q, 'design', []);
  out.design[q] = c ? { html: c.html } : null;
}
console.log(JSON.stringify(out));
"""


def _run_node(chat_questions, design_questions):
    node = shutil.which("node")
    if not node:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(tmp) / "conv.mjs"
        script.write_text(NODE_SCRIPT)
        qfile = Path(tmp) / "questions.json"
        qfile.write_text(json.dumps(
            {"chat": chat_questions, "design": design_questions}))
        r = subprocess.run(
            [node, str(script), str(REPO), str(qfile)],
            capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        return json.loads(r.stdout)


def _plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))


CONVERSATIONAL_CHAT = [
    # the bug report, verbatim (plus its capitalised twin)
    "hi i'm using this from my phone",
    "Hi i'm using this from my phone",
    "i'm on my phone",
    # greetings and introductions
    "hi", "Hello", "hey there", "good morning", "Hi, I'm Abel",
    # meta questions
    "who are you", "what can you do", "help", "how do I start",
    # context remarks
    "thanks", "thank you", "cool", "just testing", "bye",
]

FALLBACK_CHAT = [
    "What's the gate verdict for the Xyzzybot 9000?",
    "How do I bake a chocolate cake?",
]

DATA_CHAT = [
    "Tell me about Andino",
    "What are the gate thresholds?",
    "Which robots passed the gate?",
    "hello, what is a ball caster?",
]

DESIGN_CONVERSATIONAL = [
    "hi", "what can you do", "i'm using this from my phone", "thanks",
]

DESIGN_NOT_CONVERSATIONAL = [
    "a differential rover that patrols a warehouse aisle",
    "What's the gate verdict for the Xyzzybot 9000?",
]


def test_conversational_layer_answers_in_node():
    res = _run_node(CONVERSATIONAL_CHAT + FALLBACK_CHAT + DATA_CHAT,
                    DESIGN_CONVERSATIONAL + DESIGN_NOT_CONVERSATIONAL)
    if res is None:
        return  # no node on this machine; wiring tests above still hold

    chat = res["chat"]
    for q in CONVERSATIONAL_CHAT:
        a = chat[q]
        assert not a["fallback"], q
        assert FALLBACK_MARK not in a["html"], q

    # the phone message is answered as a phone remark, not a greeting
    phone = _plain(chat["hi i'm using this from my phone"]["html"])
    assert "phone" in phone.lower()
    assert "browser" in phone.lower()

    # a name introduction is greeted by name
    named = _plain(chat["Hi, I'm Abel"]["html"])
    assert "Abel" in named and "Wrench" in named

    # unknown facts still get the honest fallback, flag and all —
    # the layer must not have weakened the honesty path
    for q in FALLBACK_CHAT:
        a = chat[q]
        assert a["fallback"], q
        assert FALLBACK_MARK in a["html"], q

    # known facts still come from the recorded data, not the layer
    assert "Andino" in chat["Tell me about Andino"]["html"]
    assert "thresholds are locked" in chat["What are the gate thresholds?"]["html"]
    assert "Ball caster" in chat["hello, what is a ball caster?"]["html"]
    for q in DATA_CHAT:
        assert not chat[q]["fallback"], q

    # design mode: small talk steers to describing a robot and
    # never reaches the describe endpoint; real input passes through
    design = res["design"]
    for q in DESIGN_CONVERSATIONAL:
        assert design[q] is not None, q
    assert "draft a spec" in _plain(design["hi"]["html"])
    for q in DESIGN_NOT_CONVERSATIONAL:
        assert design[q] is None, q
