"""Workshop "Bring a robot in" leads with the Wrench composer (user ask,
2026-11-02): repo link, photo/spec via the paperclip, or plain words.
The Robodex, spec file and pasted JSON stay as other ways in."""
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web-next/src"
GARAGE = (WEB / "components/garage/Garage.tsx").read_text()
THREAD = (WEB / "components/forge/ForgeThread.tsx").read_text()
PROMPT = (WEB / "lib/wrenchPrompt.ts").read_text()


def test_panel_points_at_the_composer_and_names_optional_scans():
    panel = (WEB / "components/garage/WrenchStart.tsx").read_text()
    assert "promptWrench({mode:'chat'" in panel
    assert "attach:true" in panel
    assert "promptWrench({mode:'design'" in panel
    assert "estimated draft" in panel
    assert "Scaniverse" in panel and "RealSense" in panel


def test_manual_forms_are_replaced_by_wrench_intake():
    # User requested all input through Wrench, including photos and specs.
    assert "'robodex', 'From the Robodex'" not in GARAGE
    assert "'paste', 'Paste JSON'" not in GARAGE
    assert "Take or choose a photo" not in GARAGE
    assert "<WrenchStart" in GARAGE


def test_composer_listens_and_repo_links_win_over_design_mode():
    assert 'WRENCH_PROMPT_EVENT = "rf-wrench-prompt"' in PROMPT
    assert "window.addEventListener(WRENCH_PROMPT_EVENT, onPrompt)" in THREAD
    assert "inputMode==='design' && !repoLinkIn(value)" in THREAD


def test_text_intake_drops_a_pending_attachment():
    assert "if (typeof p.text === 'string') { setText(p.text); setAttach(null); }" in THREAD
