"""Wrench's character design (Abel, 2026-11-04).

Abel supplied Wrench's character sheet and directed that the design
be used for him throughout the app: on the landing page, and in the
composer chat. Like his name (ASSISTANT_NAME), his face has ONE
source — web-next/src/lib/wrenchArt.ts — and every surface renders
from it. These pins keep the art files, the single source, and the
surfaces that use it from drifting apart.
"""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ART_DIR = REPO / "assets/img/wrench"
WRENCH_ART_TS = REPO / "web-next/src/lib/wrenchArt.ts"
AVATAR_TSX = REPO / "web-next/src/components/chat/WrenchAvatar.tsx"
PAGE_TSX = REPO / "web-next/src/app/page.tsx"
CHAT_MESSAGES = REPO / "web-next/src/components/chat/ChatMessages.tsx"
CHAT_BAR = REPO / "web-next/src/components/chat/ChatBar.tsx"
FORGE_THREAD = REPO / "web-next/src/components/forge/ForgeThread.tsx"
CHAT_CSS = (REPO / "assets/css/chat.css").read_text()
SITE_CSS = (REPO / "assets/css/site.css").read_text()

MOODS = ["avatar", "ready", "analyzing", "pass", "fail",
         "fullbody", "design", "simulate", "report", "poster"]


def test_wrench_art_files_exist_and_are_real_jpegs():
    for mood in MOODS:
        f = ART_DIR / f"{mood}.jpg"
        assert f.exists(), f"missing Wrench art: {f}"
        data = f.read_bytes()
        assert len(data) > 2000, f"suspiciously small: {f}"
        assert data[:2] == b"\xff\xd8", f"not a JPEG: {f}"


def test_wrench_art_single_source_lists_every_mood():
    ts = WRENCH_ART_TS.read_text()
    assert ts.count("WRENCH_ART") >= 1
    for mood in MOODS:
        assert f"assets/img/wrench/{mood}.jpg" in ts, mood


def test_landing_meet_wrench_band():
    page = PAGE_TSX.read_text()
    assert 'id="wrench"' in page
    assert "Meet Wrench" in page
    assert "your robotics co-pilot" in page
    # Drawn and animated (WrenchBot), not bitmap crops: the full figure,
    # his three working poses, and the four moods the chat uses.
    assert "WrenchBot" in page and 'pose="full"' in page
    for pose in ["design", "simulate", "report"]:
        assert f'pose="{pose}"' in page, pose
    for mood in ["ready", "thinking", "pass", "fail"]:
        assert f'mood="{mood}"' in page, mood
    # Abel's original sheet stays one click away.
    assert "WRENCH_ART.poster" in page
    for cls in [".wrench-band", ".wrench-stage", ".wrench-poses", ".wrench-moods"]:
        assert cls in SITE_CSS, cls


WRENCH_BOT = REPO / "web-next/src/components/chat/WrenchBot.tsx"
WRENCH_MOOD = REPO / "web-next/src/lib/wrenchMood.ts"


def test_wrench_bot_character():
    src = WRENCH_BOT.read_text()
    for mood in ["idle", "listening", "thinking", "ready", "pass", "fail"]:
        assert f'"{mood}"' in src, mood
    for pose in ["head", "full", "design", "simulate", "report"]:
        assert f'"{pose}"' in src, pose
    # Abel's add-on: a torque power-wrench for a hand, with a socket
    # that spins (faster while he thinks).
    assert "PowerWrench" in src and "wb-socket" in src
    assert ".wb-mood-thinking .wb-socket" in CHAT_CSS
    # Motion is optional: reduced-motion users get a still Wrench.
    assert "prefers-reduced-motion" in CHAT_CSS and ".wb-still" in CHAT_CSS


def test_composer_wrench_follows_the_chat():
    mood = WRENCH_MOOD.read_text()
    assert "isWrenchThinking" in mood and "landedMood" in mood
    for path in [CHAT_BAR, FORGE_THREAD]:
        src = path.read_text()
        assert "useWrenchMood" in src, path
        assert "wb-composer-slot" in src and 'className="wb-composer"' in src, path
        assert "fc-head-id" in src, path
    assert ".wb-composer" in CHAT_CSS


def test_chat_surfaces_render_wrenchs_face():
    msgs = CHAT_MESSAGES.read_text()
    # His face on his own messages, the ready head on the empty state,
    # and his pass/fail heads on grounded verdict captions.
    assert "WrenchAvatar" in msgs
    assert 'mood="avatar"' in msgs and 'mood="ready"' in msgs
    assert '"fail" : "pass"' in msgs or "'fail' : 'pass'" in msgs.replace('"', "'")
    comp = AVATAR_TSX.read_text()
    assert "WrenchBot" in comp
    for cls in [".wrench-head-avatar", ".fc-head-id", ".fc-avatar", ".fc-verdict"]:
        assert cls in CHAT_CSS, cls
