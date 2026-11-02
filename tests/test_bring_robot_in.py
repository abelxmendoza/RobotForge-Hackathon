"""Workshop "Bring a robot in" leads with the Wrench composer (user ask,
2026-11-02): repo link, photo/spec via the paperclip, or plain words.
The Robodex, spec file and pasted JSON stay as other ways in."""
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web-next/src"
GARAGE = (WEB / "components/garage/Garage.tsx").read_text()
THREAD = (WEB / "components/forge/ForgeThread.tsx").read_text()
PROMPT = (WEB / "lib/wrenchPrompt.ts").read_text()


def test_panel_points_at_the_composer_and_names_repos():
    panel = GARAGE.split("<h2>Bring a robot in</h2>", 1)[1].split("</details>", 1)[0]
    assert "GitHub repo link" in panel
    assert "promptWrench({ mode: 'chat', text: 'https://github.com/' })" in panel
    assert "promptWrench({ attach: true })" in panel
    assert "promptWrench({ mode: 'design'" in panel
    assert "ESTIMATED" in panel  # photo drafts stay labelled honestly
    assert 'className="g-other-ways"' in panel


def test_manual_ways_in_are_kept_but_the_photo_form_is_gone():
    assert "'robodex', 'From the Robodex'" in GARAGE
    assert "'file', 'Spec file'" in GARAGE and "'paste', 'Paste JSON'" in GARAGE
    assert "Take or choose a photo" not in GARAGE


def test_composer_listens_and_repo_links_win_over_design_mode():
    assert 'WRENCH_PROMPT_EVENT = "rf-wrench-prompt"' in PROMPT
    assert "window.addEventListener(WRENCH_PROMPT_EVENT, onPrompt)" in THREAD
    assert "inputMode==='design' && !repoLinkIn(value)" in THREAD


def test_text_intake_drops_a_pending_attachment():
    assert "if (typeof p.text === 'string') { setText(p.text); setAttach(null); }" in THREAD
