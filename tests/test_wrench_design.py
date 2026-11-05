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
    # The component renders only from the single source.
    comp = AVATAR_TSX.read_text()
    assert "WRENCH_ART" in comp and "wrenchArt" in comp


def test_landing_meet_wrench_band():
    page = PAGE_TSX.read_text()
    assert 'id="wrench"' in page
    assert "Meet Wrench" in page
    assert "WRENCH_ART.fullbody" in page
    assert "your robotics co-pilot" in page
    for mood in ["ready", "analyzing", "pass", "fail",
                 "design", "simulate", "report", "poster"]:
        assert f"WRENCH_ART.{mood}" in page, mood
    assert ".wrench-band" in SITE_CSS and ".wrench-moods" in SITE_CSS


def test_chat_surfaces_render_wrenchs_face():
    msgs = CHAT_MESSAGES.read_text()
    # His face on his own messages, the ready head on the empty state,
    # and his pass/fail heads on grounded verdict captions.
    assert "WrenchAvatar" in msgs
    assert 'mood="avatar"' in msgs and 'mood="ready"' in msgs
    assert '"fail" : "pass"' in msgs or "'fail' : 'pass'" in msgs.replace('"', "'")
    # Both chat headers carry him, analyzing while he works.
    for path in [CHAT_BAR, FORGE_THREAD]:
        src = path.read_text()
        assert "WrenchAvatar" in src, path
        assert '"analyzing" : "avatar"' in src or "'analyzing' : 'avatar'" in src, path
        assert "fc-head-id" in src, path
    for cls in [".wrench-head-avatar", ".fc-head-id", ".fc-avatar", ".fc-verdict"]:
        assert cls in CHAT_CSS, cls
