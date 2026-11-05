"""The composer chatbot is called Wrench, and that name stays
(Abel, 2026-11-04: "make sure the composer ai chatbot is called
Wrench and that name stays").

The name has a single source: ASSISTANT_NAME in lib/handoff.ts.
Every surface that names the chatbot — the bottom-bar composer,
the Forge composer, the Workshop embed, copied transcripts, the
/chat page title — renders that constant or the same literal.
These pins keep it that way:

  1. ASSISTANT_NAME is exactly 'Wrench', defined once.
  2. The composer surfaces use the constant for their header,
     placeholder and aria labels (no hardcoded rival name).
  3. User-facing copy that points at the chatbot names Wrench —
     no "ask the assistant" drift in the kit views.
  4. Nothing user-facing renames the bot: no other persona name is
     assigned as the chat's name/title in the chat surfaces.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web-next" / "src"
HANDOFF = (SRC / "lib" / "handoff.ts").read_text()
CHATBAR = (SRC / "components" / "chat" / "ChatBar.tsx").read_text()
FORGE = (SRC / "components" / "forge" / "ForgeThread.tsx").read_text()
CHAT_PAGE = (SRC / "app" / "chat" / "page.tsx").read_text()
COPYTEXT = (SRC / "lib" / "copytext.ts").read_text()


def test_name_constant_is_wrench_and_defined_once():
    assert "export const ASSISTANT_NAME = 'Wrench';" in HANDOFF
    hits = []
    for p in SRC.rglob("*.ts*"):
        if "ASSISTANT_NAME = '" in p.read_text():
            hits.append(str(p.relative_to(SRC)))
    assert hits == ["lib/handoff.ts"], hits


def test_composer_surfaces_render_the_constant():
    assert "<strong>{ASSISTANT_NAME}</strong>" in CHATBAR
    assert "placeholder={`Message ${ASSISTANT_NAME}" in CHATBAR
    assert "aria-label={`Message ${ASSISTANT_NAME}`}" in CHATBAR
    assert "<strong>{ASSISTANT_NAME}</strong>" in FORGE
    assert "`Message ${ASSISTANT_NAME}…`" in FORGE
    assert "title: \"Wrench\"" in CHAT_PAGE          # the /chat page title
    assert "ASSISTANT_NAME}:" in COPYTEXT or "ASSISTANT_NAME}:\\n" in COPYTEXT  # transcript speaker label


def test_kit_copy_names_wrench_not_a_generic_assistant():
    kit = (SRC / "components" / "kit" / "KitViewer.tsx").read_text()
    palette = (SRC / "components" / "kit" / "PartsPalette.tsx").read_text()
    assert "ask Wrench in chat" in kit
    assert "tell Wrench" in palette and "asking Wrench in chat" in palette
    assert "the assistant" not in kit and "the assistant" not in palette


def test_no_rival_persona_name_on_chat_surfaces():
    for text in (CHATBAR, FORGE, CHAT_PAGE):
        for rival in ("Message Torque", "Ask Muse", "Forge assistant", "RoboForge assistant"):
            assert rival not in text
