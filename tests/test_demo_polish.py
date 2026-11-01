"""Demo polish (web-next): the dismissable demo bar + DEMO pill,
demo entry from a signed-in account, and the lived-in demo seed.

Two layers, following the repo's node-test pattern:

1. Static wiring + honesty: the bar's x and the pill's exit exist
   and are mounted in both topbars; the signed-in panel carries
   "Start demo"; the demo never revalidates a session against the
   Worker; the seed's labels survive the deepening (every seeded
   name still says demo, the PLANNED version uses the garage's
   planned flag, every catalogue id the seed names exists).
2. Node unit tests: the bar dismissal is keyed to the demo
   session's start stamp — it persists inside one demo session
   and a fresh demo start shows the bar again.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "web-next"
LIB = WEB / "src/lib"
SHELL = WEB / "src/components/shell"


# ---------------------------------------------------------------- wiring

def test_side_menu_has_no_demo_entry_but_the_real_doors_stay():
    """Abel (2026-11-01): "the demo in the side menu sucks, take it
    out." The AppShell sidebar NAV carries no demo entry; the demo
    itself is untouched — the landing keeps its RunDemoLink entries
    and the signed-in account panel keeps "Start demo"."""
    shell = (SHELL / "AppShell.tsx").read_text()
    nav = shell.split("const NAV = [", 1)[1].split("];", 1)[0]
    assert 'id: "demo"' not in nav
    assert '"/demo/"' not in nav
    # The rest of the nav is unchanged, in order.
    ids = re.findall(r'id: "(\w+)"', nav)
    # BOM wizard and Evidence left the nav on 2026-11-01; /evidence/
    # stays reachable from robot pages, the demo and Wrench.
    assert ids == ["home", "workshop", "inventory", "robots"], ids
    landing = (WEB / "src/app/page.tsx").read_text()
    assert "RunDemoLink" in landing
    chrome = (WEB / "src/components/home/LandingChrome.tsx").read_text()
    assert "Run the demo" in chrome
    acct = (SHELL / "AccountControl.tsx").read_text()
    assert "Start demo" in acct


def test_demo_bar_is_dismissable_and_the_pill_keeps_the_exit():
    bar = (SHELL / "DemoBar.tsx").read_text()
    # The slim bar gains a real dismiss control wired to the
    # since-keyed dismissal in lib/demoMode.ts.
    assert 'aria-label="Dismiss demo bar"' in bar
    assert "setDemoBarDismissed(true)" in bar
    assert "barDismissed" in bar  # the bar renders nothing while dismissed
    # The pill: visible marker + menu with both recovery actions.
    assert "export function DemoPill" in bar
    assert "Show the demo bar" in bar
    assert "Exit demo" in bar
    assert "setDemoBarDismissed(false)" in bar


def test_demo_welcome_describes_the_deepened_seed_and_wrench():
    bar = (SHELL / "DemoBar.tsx").read_text()
    assert "planned upgrade" in bar
    assert "build history" in bar
    assert "already in" in bar and "progress" in bar  # the Wrench thread
    # Abel's copy correction (2026-11-01): Wrench is the workshop's
    # build partner, not "just a guide".
    assert "build partner" in bar
    assert "Wrench, the guide" not in bar


def test_pill_and_identity_are_mounted_in_both_topbars():
    for chrome in ("AppShell.tsx", "LandingChrome.tsx"):
        src = (WEB / "src/components" / ("shell" if chrome == "AppShell.tsx" else "home") / chrome).read_text()
        assert "DemoPill" in src, chrome
        assert "DemoIdentity" in src, chrome


def test_demo_identity_is_an_obvious_sample_persona():
    ident = (SHELL / "DemoIdentity.tsx").read_text()
    assert "Demo account" in ident
    assert "Sam Rivera" in ident
    # Never the operator's real identity.
    assert "Abel" not in ident
    assert "abelxmendoza" not in ident
    # With a real session present the persona stands down — the
    # account chip already says who is signed in.
    assert "loadSession" in ident


def test_account_menu_starts_the_demo_and_the_demo_skips_revalidation():
    acct = (SHELL / "AccountControl.tsx").read_text()
    # Signed-in panel: Start demo (and Exit demo while in it),
    # entering through the same seed + flag as the anonymous path.
    assert "Start demo" in acct
    assert "seedDemoStores" in acct
    assert "setDemoMode(true)" in acct
    assert "Exit demo" in acct
    # The demo makes no Worker calls: a stored session is adopted
    # as-is, never refreshed against /auth/me while the flag is on.
    assert "isDemoMode() && !frag.token" in acct
    # The sign-in card's guest block carries the demo entry too —
    # since PR #68 the card lives in SignInCard.tsx.
    card = (SHELL / "SignInCard.tsx").read_text()
    assert "DemoEntryButton" in card
    assert 'label="Try the demo"' in card


# ---------------------------------------------------------------- seed

def _seed_source() -> str:
    return (LIB / "demoSeed.ts").read_text()


def test_seed_labels_survive_the_deepening():
    seed = _seed_source()
    # Every named seed entry still carries its demo marker.
    for name in re.findall(r"name: '([^']+)'", seed):
        assert "(demo" in name, name
    assert "(demo sample)" in seed
    assert "Demo sample data" in seed  # SAMPLE_NOTE intact
    assert "sim-only" in seed


def test_seed_garage_has_two_robots_and_a_planned_version():
    seed = _seed_source()
    assert "demo-turtlebot3-burger" in seed
    assert "demo-pathfinder" in seed
    # The Burger's second version is a plan, flagged with the
    # garage's own planned marker — never a fake build.
    assert "planned: true" in seed
    assert "PLANNED" in seed
    # Pathfinder's history: the current version is the recorded
    # spec; only the first build's wheel diameter differs.
    assert "diameter_m: 0.066" in seed
    assert "pathfinder.json" in seed
    spec = json.loads((REPO / "examples" / "pathfinder.json").read_text())
    assert spec["wheel"]["diameter_m"] == 0.1


def test_seed_inventory_reads_used_not_factory_round():
    seed = _seed_source()
    # The 18650 pack is down a cell and used; the Pi is used too.
    assert re.search(r"demo-sample-18650[\s\S]{0,200}?quantity: 5", seed)
    assert seed.count("condition: 'used'") >= 3
    # Dates are spread (a returning user's shelf), not one stamp.
    dates = set(re.findall(r"createdAt: '(\d{4}-\d{2}-\d{2})", seed))
    assert len(dates) >= 5


def test_seed_catalogue_ids_all_exist():
    seed = _seed_source()
    catalog = json.loads((REPO / "catalog" / "parts.json").read_text())
    ids = {p["id"] for p in catalog["parts"]}
    referenced = set(re.findall(r"simFromCatalog\('([a-z0-9_]+)'", seed))
    referenced |= set(re.findall(r"catalogPart\('([a-z0-9_]+)'", seed))
    assert referenced, "seed should reference the catalogue"
    assert referenced <= ids, f"seed names missing catalogue parts: {referenced - ids}"


def test_demo_thread_is_preplayed_through_the_recorded_engine():
    dock = (WEB / "src/components/chat" / "ChatDock.tsx").read_text()
    assert "DEMO_THREAD_QUESTIONS" in dock
    assert "demoThreadRef" in dock
    # The answers are the engine's own output — the seed calls the
    # same answerTurn a typed question hits, never canned HTML.
    assert "wrench.answerTurn(q, mem)" in dock
    for q in ("Tell me about the TurtleBot3 Burger", "And its battery?",
              "Which robots passed the gate?"):
        assert q in dock


# ---------------------------------------------------------------- node units

UNIT_SCRIPT = r"""
import assert from 'node:assert/strict';

// Fake browser storage: string maps + event no-ops, enough for
// lib/demoMode.ts's storage helpers (the React hooks in the file
// are never invoked here).
const makeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
globalThis.window = {
  localStorage: makeStore(),
  sessionStorage: makeStore(),
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const D = await import('./demoMode.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// No demo running: nothing is dismissed.
assert.equal(D.isDemoBarDismissed(), false);

// Enter the demo: the bar starts visible.
D.setDemoMode(true);
assert.equal(D.isDemoMode(), true);
assert.equal(D.isDemoBarDismissed(), false);

// Dismiss it: hidden now, and the answer is a pure storage read,
// so it stays hidden across page loads inside this demo session.
D.setDemoBarDismissed(true);
assert.equal(D.isDemoBarDismissed(), true);
assert.equal(D.isDemoBarDismissed(), true);

// Exit and start a FRESH demo (new start stamp): the dismissal
// was keyed to the old stamp, so the bar shows again.
D.setDemoMode(false);
await sleep(10);
D.setDemoMode(true);
assert.equal(D.isDemoBarDismissed(), false);

// Dismiss + restore inside the new session round-trips too.
D.setDemoBarDismissed(true);
assert.equal(D.isDemoBarDismissed(), true);
D.setDemoBarDismissed(false);
assert.equal(D.isDemoBarDismissed(), false);

console.log('demo bar dismissal unit checks passed');
"""


def _prep_unit_dir(tmp: Path) -> None:
    (tmp / "package.json").write_text('{"type":"module"}')
    (tmp / "demoMode.ts").write_text((LIB / "demoMode.ts").read_text())
    (tmp / "node_modules").symlink_to(WEB / "node_modules")


def test_demo_bar_dismissal_units_in_node(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node unavailable")
    _prep_unit_dir(tmp_path)
    (tmp_path / "run.mjs").write_text(UNIT_SCRIPT)
    result = subprocess.run(
        [node, "--experimental-strip-types", str(tmp_path / "run.mjs"), str(REPO)],
        capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stdout + result.stderr
