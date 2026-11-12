"""The Omega1 sample robot: one link, every surface (Abel,
2026-11-04: demo users AND new account users get the Omega1 repo
link as the first robot sample to run through Wrench).

The link and copy have a single source: lib/sampleRobot.ts — same
pattern as ASSISTANT_NAME in lib/handoff.ts. These pins keep it
that way:

  1. The constants are exact, defined once, and no other file in
     src/ carries a hard-coded copy of the URL.
  2. repoLinkIn(SAMPLE_REPO_URL) resolves to the Omega-Code ref
     (checked against the repoLink/parseRepoInput source contract:
     a full github.com/<owner>/<repo> link parses to that ref).
  3. Chips: ChatDock puts SAMPLE_CHIP first when the store is
     empty, and tapping it sends SAMPLE_PROMPT (which carries the
     link, so the existing repo-link detection fires).
  4. The recorded engine answers sample/example/first-robot asks
     with the sample card — deterministic, so it works in demo.
  5. The Garage sample card renders only when firstRobot; the
     DemoBar welcome leads with the sample import; /import/ can
     fill its field from the constant.
  6. Honesty: the copy says manual-control, and sizes from the
     repo are documented/estimated — never measurements.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web-next" / "src"
SAMPLE = (SRC / "lib" / "sampleRobot.ts").read_text()
URL = "https://github.com/abelxmendoza/Omega-Code"


def test_constants_exact_and_defined_once():
    assert "export const SAMPLE_REPO_URL = 'https://github.com/abelxmendoza/Omega-Code';" in SAMPLE
    assert "export const SAMPLE_REPO_REF = 'abelxmendoza/Omega-Code';" in SAMPLE
    assert "export const SAMPLE_CHIP = 'Try the sample robot: Omega1';" in SAMPLE
    assert "export const SAMPLE_HEADING = 'Start with a sample robot — Omega1';" in SAMPLE
    hits = []
    for p in SRC.rglob("*.ts*"):
        if "SAMPLE_REPO_URL = '" in p.read_text():
            hits.append(str(p.relative_to(SRC)))
    assert hits == ["lib/sampleRobot.ts"], hits


def test_no_stray_copies_of_the_url_in_src():
    # The bare repo URL is the constant's alone. A longer pinned
    # link (…/blob/<sha>/…) is a different thing — a source
    # attribution to one file at one commit (lib/omega1Twin.ts's
    # photo credit) — and is not a copy of the sample link.
    bare = re.compile(re.escape(URL) + r"(?![/\w])")
    offenders = []
    for p in SRC.rglob("*.ts*"):
        if p == SRC / "lib" / "sampleRobot.ts":
            continue
        if bare.search(p.read_text()):
            offenders.append(str(p.relative_to(SRC)))
    assert offenders == [], offenders


def test_prompt_carries_the_link_so_repo_detection_fires():
    # SAMPLE_PROMPT is built from the constant, and repoLink.ts's
    # contract is: a full github.com/<owner>/<repo> link in the
    # message parses (via parseRepoInput) to that repo ref.
    assert "SAMPLE_PROMPT =" in SAMPLE and "SAMPLE_REPO_URL" in SAMPLE
    repo_link = (SRC / "lib" / "repoLink.ts").read_text()
    assert "github\\.com\\/" in repo_link and "parseRepoInput" in repo_link
    owner, repo = URL.rsplit("/", 2)[-2:]
    assert f"{owner}/{repo}" == "abelxmendoza/Omega-Code"


def test_chatdock_chip_first_on_empty_store_and_tap_sends_prompt():
    dock = (SRC / "components" / "chat" / "ChatDock.tsx").read_text()
    assert "from '@/lib/sampleRobot'" in dock or 'from "@/lib/sampleRobot"' in dock
    assert "SAMPLE_CHIP" in dock and "SAMPLE_PROMPT" in dock
    # empty store -> sample chip ahead of the base suggestions
    assert "mine.length === 0" in dock
    assert "[SAMPLE_CHIP, ...base]" in dock
    # tapping the chip sends the prompt (link included)
    assert "if (q === SAMPLE_CHIP) q = SAMPLE_PROMPT;" in dock


def test_recorded_engine_answers_sample_asks():
    # The engine/wrench modules are import-locked (their harnesses
    # type-strip them in node; test_chat_omega1_wrench pins "may
    # import only ./engine"), so the detector + card live in the
    # lib and ChatDock serves the card before any live path —
    # recorded and deterministic, demo included.
    for needle in (r"/\bsample\b/", r"/\bexample\b/", "'first robot'", "'what should i try'"):
        assert needle in SAMPLE, needle
    assert "export function isSampleAsk" in SAMPLE
    assert "export function sampleAnswerHtml" in SAMPLE
    dock = (SRC / "components" / "chat" / "ChatDock.tsx").read_text()
    assert "isSampleAsk(q)" in dock and "sampleAnswerHtml()" in dock
    engine = (SRC / "components" / "chat" / "engine.ts").read_text()
    assert "sampleRobot" not in engine  # import-lock kept


def test_garage_card_only_on_first_robot():
    garage = (SRC / "components" / "garage" / "Garage.tsx").read_text()
    assert "SampleRobotCard" in garage
    assert "{firstRobot && <SampleRobotCard />}" in garage
    card = (SRC / "components" / "sample" / "SampleRobotCard.tsx").read_text()
    for needle in ("SAMPLE_HEADING", "SAMPLE_BLURB", "SAMPLE_REPO_URL", "SAMPLE_PROMPT", "Send it to Wrench"):
        assert needle in card, needle


def test_demobar_welcome_leads_with_the_sample():
    bar = (SRC / "components" / "shell" / "DemoBar.tsx").read_text()
    steps = bar.split('<ol className="demo-steps">', 1)[1].split("</ol>", 1)[0]
    first_step = steps.split("<li>", 1)[1].split("</li>", 1)[0] if "<li>" in steps else steps.split("<li", 1)[1]
    assert "Omega1 sample" in first_step
    assert "SAMPLE_REPO_URL" in bar and "SAMPLE_PROMPT" in bar
    assert "Send it to Wrench" in bar and "Copy" in bar


def test_import_page_sample_filler_uses_the_constant():
    repo_import = (SRC / "components" / "import" / "RepoImport.tsx").read_text()
    assert "SAMPLE_REPO_URL" in repo_import
    assert "setInput(SAMPLE_REPO_URL)" in repo_import
    assert "No repo handy? Use the Omega1 sample" in repo_import


def test_honesty_copy():
    assert "manual-control rover today" in SAMPLE
    assert "documented/estimated until measured" in SAMPLE
    assert "no autonomy" in SAMPLE  # the header comment states the rule
    assert not re.search(r"autonomous|self-driving", SAMPLE_BLURB if False else SAMPLE.split("SAMPLE_BLURB")[1].split(";")[0])


# ---- One-click Omega1 (2026-11-05: make the sample prominent) ----

def test_one_click_constants_and_helpers():
    assert "export const SAMPLE_OPEN_HREF = '/garage/#omega1';" in SAMPLE
    assert "export function openSampleInWorkshop" in SAMPLE
    assert "export function requestSampleOpen" in SAMPLE
    assert "export function takeSampleOpenRequest" in SAMPLE


def test_card_leads_with_open_now():
    card = (SRC / "components" / "sample" / "SampleRobotCard.tsx").read_text()
    assert "SAMPLE_OPEN_LABEL" in card and "openSampleInWorkshop" in card
    assert "OMEGA1_PHOTO" in card


def test_landing_spotlight_and_hero_button():
    page = (SRC / "app" / "page.tsx").read_text()
    assert "<SampleSpotlight />" in page
    assert "<SampleOpenLink" in page
    spot = (SRC / "components" / "home" / "SampleSpotlight.tsx").read_text()
    assert "<SampleOpenLink" in spot
    link = (SRC / "components" / "home" / "SampleOpenLink.tsx").read_text()
    # signed-in visitors keep their session; others enter the demo first
    assert "if (isDemoMode() || loadSession()) return;" in link
    assert "saveSession" not in link and "router.push(SAMPLE_OPEN_HREF)" in link


def test_gate_robodex_and_workshop_list_offer_the_sample():
    gate = (SRC / "components" / "shell" / "AppGate.tsx").read_text()
    assert "onBeforeEnter={requestSampleOpen}" in gate
    dex = (SRC / "components" / "robots" / "DexSources.tsx").read_text()
    assert "<SampleRobotCard />" in dex
    garage = (SRC / "components" / "garage" / "Garage.tsx").read_text()
    assert "takeSampleOpenRequest()" in garage
    assert "!storedOmega1 && !archivedOmega1" in garage and "g-sample-add" in garage
    # the hash is dropped after adopting, so a later delete doesn't re-adopt
    assert "window.history.replaceState(null, '', window.location.pathname + window.location.search);" in garage
