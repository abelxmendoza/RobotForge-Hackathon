"""Composer-first generation + app declutter (2026-11-02, Abel's
direction): ALL Forge Engine generation features live inside the main
chatbot composer, and the app is simplified around them.

What is pinned here:
- components/chat/ComposerCreate.tsx exists with the three actions
  (Generate robot / Generate acceptance tests / Modify), calling the
  SAME engine entry points and writing the SAME Garage store records
  the Garage panels used (PLANNED 'generated' first version;
  spec.forgeTests on the latest version; a modification as a NEW
  version, nothing saved outside the grammar).
- Both composer surfaces mount the one shared component: the global
  ChatBar and ForgeThread (/chat's thread + the Workshop's docked
  thread). The logic is not forked.
- Results post through ChatDock.postCreateResult as a local message
  kind (pill + openAction) — rendered by both message renderers
  (ChatMessages and the ForgeThread mirror), with NO grounding
  caption logic attached: the "Grounded in:" caption stays reserved
  for live model answers (PR #122).
- "Open in Workshop" routes through ChatDock.openRobot to
  /garage/#robot=<id>[&tab=<tab>], and Garage's hash reader accepts
  the combined form.
- Declutter: the Garage's standalone Generate panel is gone (a slim
  hint line points at the chat's Create button); the Modify box and
  the Forge Tests section stay; AppShell's More menu no longer
  repeats the side-foot's How-it-works/GitHub links; the landing's
  final CTA band (the hero's two CTAs a third time) is removed —
  hero, demo entry, how-it-works and footer untouched.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web-next"
SRC = WEB / "src"

CREATE = (SRC / "components/chat/ComposerCreate.tsx").read_text()
CHATDOCK = (SRC / "components/chat/ChatDock.tsx").read_text()
CHATBAR = (SRC / "components/chat/ChatBar.tsx").read_text()
CHAT_MESSAGES = (SRC / "components/chat/ChatMessages.tsx").read_text()
FORGE_THREAD = (SRC / "components/forge/ForgeThread.tsx").read_text()
GARAGE = (SRC / "components/garage/Garage.tsx").read_text()
APP_SHELL = (SRC / "components/shell/AppShell.tsx").read_text()
LANDING = (SRC / "app/page.tsx").read_text()
CHAT_CSS = (ROOT / "assets/css/chat.css").read_text()


# --- The Create panel -------------------------------------------------

def test_create_panel_has_the_three_actions():
    assert 'aria-label="Create with the Forge Engine"' in CREATE
    assert "Generate a robot" in CREATE
    assert "Acceptance tests" in CREATE
    assert "Apply as new version" in CREATE
    # The complete form Abel named — heading, explanatory copy, Brief,
    # Type, Size, Sensors, every sensor checkbox, and the button —
    # now lives in this composer component.
    for marker in (
        "Describe it and the Forge Engine picks real catalogue parts, places them, "
        "plans the wiring and prints, and checks its own work",
        "<span>Brief</span>", 'aria-label="Robot brief"',
        "<span>Type</span>", 'aria-label="Robot type"',
        "<span>Size</span>", 'aria-label="Robot size"',
        "<legend>Sensors</legend>",
        "onClick={doGenerate}>Generate robot</button>",
    ):
        assert marker in CREATE, marker
    # The Garage panel's exact option sets, carried over unchanged.
    for marker in ("From the brief", "Differential rover", "Mecanum rover",
                   "Robotic arm", "Multirotor", "Compact", "Standard", "Large",
                   "Lidar", "Camera", "Depth camera", "IMU", "Ultrasonic"):
        assert marker in CREATE, marker


def test_create_panel_calls_the_real_engines():
    assert "parseBrief(prompt" in CREATE
    assert "generateRobot(brief, engineCatalogue())" in CREATE
    assert "generateForgeTests(latest.spec as Spec" in CREATE
    assert "applyModification(spec, text, engineCatalogue())" in CREATE
    # The catalogue it grounds in is the app's own, as the Garage
    # used — since the web knowledge loop (2026-11-03), through the
    # merged view: built-in parts plus the visitor's confirmed web
    # parts, web entries flagged UNVERIFIED (lib/webParts).
    assert "parts as catalogParts" in CREATE


def test_create_panel_writes_the_garage_records():
    # Generation: the PLANNED first-version record, same shape as the
    # Garage's retired addGenerated.
    assert "source: 'generated'" in CREATE
    assert "label: 'Generated plan'" in CREATE
    assert "planned: true" in CREATE
    assert "writeStore(GARAGE_KEY" in CREATE
    # Tests persist onto the latest version as spec.forgeTests.
    assert "forgeTests: plan" in CREATE
    # Modify: a NEW version via the engine grammar + the spec diff,
    # never an in-place edit.
    assert "diffSpecs(spec, mod.spec)" in CREATE
    assert "versions: [...r.versions, v]" in CREATE


def test_create_panel_current_robot_resolution():
    # Workshop selection first (the published snapshot), then this
    # panel's last creation, then the store's most recent robot.
    assert "readWorkshopContext()" in CREATE
    assert "resolveCurrentRobot" in CREATE
    assert "lastCreatedId" in CREATE
    # No robot yet: the panel says so plainly and prompts generation.
    assert "No robot yet — generate one above first" in CREATE
    # A refused modification posts the honest message with examples.
    assert "nothing was saved" in CREATE
    assert "MOD_EXAMPLES" in CREATE


def test_create_panel_is_local_and_honest():
    # No Worker/model calls from the panel: generation must work in
    # demo mode, fully local.
    assert "fetch(" not in CREATE
    assert "postCreateResult(" not in CREATE  # hosts post via the hook
    # Honest labels ride along: planned, predictions not measurements.
    assert "PLANNED, not built yet" in CREATE
    assert "not measurements" in CREATE


# --- Mounting on both composer surfaces -------------------------------

def test_both_composers_use_the_main_wrench_input():
    assert "ComposerCreate" not in CHATBAR
    assert "ComposerCreate" not in FORGE_THREAD
    assert "promptWrench({mode:'design'" in CHATBAR
    assert "router.push('/garage/#wrench')" in CHATBAR
    assert 'runConceptText' in FORGE_THREAD
    assert 'assistant.postCreateResult' in FORGE_THREAD
    assert "✦ Create" in FORGE_THREAD
    assert 'setCreateOpen' not in FORGE_THREAD


# --- Action messages: pill, no grounding ------------------------------

def test_action_messages_are_their_own_kind():
    # The hook's message type + poster carry the new fields.
    assert "pill?: string" in CHATDOCK
    assert "openAction?: { robotId: string; tab?: string; label: string }" in CHATDOCK
    assert "postCreateResult" in CHATDOCK
    # Both renderers draw the pill and the Open action.
    for renderer in (CHAT_MESSAGES, FORGE_THREAD):
        assert "m.pill" in renderer or "message.pill" in renderer
        assert "fbadge local" in renderer
        assert "openAction" in renderer
    # The grounding caption stays exactly where PR #122 put it: on
    # the live-success path only. The Create path never sets it.
    # (The Firecrawl PR widened the live-success condition to
    # "ws || webCaption" — a successful web fetch earns the same
    # caption slot; recorded/Create paths still never set it.)
    assert "grounding:" in CHATDOCK and "ws || webCaption" in CHATDOCK
    create_post = CHATDOCK.split("const postCreateResult")[1].split(");")[0]
    assert "grounding" not in create_post


def test_open_in_workshop_routing():
    assert "openRobot" in CHATDOCK
    assert '"/garage/#" + hash' in CHATDOCK
    assert '"robot=" + robotId' in CHATDOCK
    # Tests results ask for the Simulate tab by name.
    assert "tab: 'simulate'" in CREATE
    assert "Open in Workshop — Simulate tab" in CREATE
    # Garage accepts the combined #robot=<id>&tab=<tab> landing.
    assert "&tab=(overview|build|wiring|drivetrain|specs|simulate|checks|bom|tools|history)" in GARAGE


# --- Declutter ----------------------------------------------------------

def test_garage_panel_removed_hint_and_keeps():
    assert "GeneratePanel" not in GARAGE
    assert "Generate a robot" in GARAGE  # prompt text sent to Wrench, no form
    # None of the standalone panel's form may remain in Garage: no
    # Brief/Type/Size/Sensors controls, no sensor checkbox set, no
    # Generate robot button, and no generation calls in this file.
    for marker in (
        "<span>Brief</span>", 'aria-label="Robot brief"',
        "<span>Type</span>", 'aria-label="Robot type"',
        "<span>Size</span>", 'aria-label="Robot size"',
        "<legend>Sensors</legend>",
        "[['lidar', 'Lidar'], ['camera', 'Camera'], ['depth_camera', 'Depth camera'], "
        "['imu', 'IMU'], ['ultrasonic', 'Ultrasonic']]",
        "onClick={doGenerate}>Generate robot</button>",
        "addGenerated", "generateRobot(", "parseBrief(",
        # Abel's copied block ended with this trailing sidebar line;
        # it is out of Garage too (the same words remain elsewhere in
        # the app for unrelated local Dex records — this pin is only
        # about Garage.tsx).
        "Saved in this browser",
    ):
        assert marker not in GARAGE, marker
    # The slim hint where the panel sat, pointing at the composer.
    assert "press <strong>Create</strong> in the chat to generate a robot, tests, or a modification" in GARAGE
    # Kept: the Modify box (the Checks/Fix flow's home), the Forge
    # Tests section, and every generated-plan tab rendering.
    assert "function ModifyBox" in GARAGE
    assert "function ForgeTestsSection" in GARAGE
    assert "<ForgePlacement spec={draft} />" in GARAGE
    assert "<ForgeWiring spec={draft} />" in GARAGE
    assert "<ForgeChecks spec={draft} />" in GARAGE


def test_nav_dedupe():
    # 2026-11-12: three destinations (Workshop, Library, Robots) fit the
    # phone bar, so the More menu is gone and nothing is folded.
    assert "nav-more-menu" not in APP_SHELL
    assert "more: true" not in APP_SHELL
    # The single remaining copies live in the side-foot.
    foot = APP_SHELL.split('className="side-foot"')[1].split("</div>")[0]
    assert "How it works" in foot
    assert "GitHub" in foot


def test_landing_declutter():
    # The final CTA band repeated the hero's two CTAs (Run the demo /
    # Open the app) a third time on the page; it is removed.
    assert "cta-band" not in LANDING
    assert "See a broken robot get fixed in one click" not in LANDING
    # Kept: hero + its CTAs, the demo entry, how-it-works, footer.
    assert 'className="hero"' in LANDING
    assert "Open the app →" in LANDING
    assert "RunDemoLink" in LANDING
    assert 'id="workflow"' in LANDING
    assert "LandingFooter" in LANDING


def test_create_styles_in_css_source_of_truth():
    for cls in (".chat-bar-create", ".composer-create", ".composer-create-group"):
        assert cls in CHAT_CSS, cls
